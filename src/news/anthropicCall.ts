import type Anthropic from '@anthropic-ai/sdk'
import { zodOutputFormat } from '@anthropic-ai/sdk/helpers/zod'
import type { LlmCall, LlmRequest, LlmResponse } from './llmPipeline'
import { ClassifyResponseSchema, GroupResponseSchema } from './llmSchemas'

// The one file that talks to the Anthropic SDK: it turns an LlmRequest into a
// Messages API call and hands back parsed JSON. The client is passed in (the
// build script owns credentials and env), so nothing here reads process.env.
// llmPipeline.ts re-validates whatever comes back — this file's job is only to
// make the call correctly and refuse to hand back a truncated or refused one.

/** Sonnet 5 (J's decision, 2026-09-20). Also the model id the classification cache keys on. */
export const NEWS_MODEL = 'claude-sonnet-5'

// Effort per call: Sonnet 5 follows effort strictly, so classification (a bounded
// per-article judgment) runs at medium and grouping (cross-article, where a wrong
// merge fabricates corroboration) at high. Both are first guesses to revisit
// against the calibration audit, not measured optima.
const EFFORT = { classify: 'medium', group: 'high' } as const

// Output ceiling includes thinking tokens. Classification emits ~120 tokens per
// article x 25; grouping emits one line per event. Grouping is streamed because
// the SDK requires it for max_tokens this large (HTTP timeouts).
const MAX_TOKENS = { classify: 16_000, group: 48_000 } as const

function usageOf(u: { input_tokens: number; output_tokens: number; cache_read_input_tokens?: number | null; cache_creation_input_tokens?: number | null }): LlmResponse['usage'] {
  return {
    inputTokens: u.input_tokens,
    outputTokens: u.output_tokens,
    cacheReadTokens: u.cache_read_input_tokens ?? 0,
    cacheWriteTokens: u.cache_creation_input_tokens ?? 0,
  }
}

function params(request: LlmRequest, model: string) {
  const schema = request.kind === 'classify' ? ClassifyResponseSchema : GroupResponseSchema
  return {
    model,
    max_tokens: MAX_TOKENS[request.kind],
    // The stable rubric goes first and is cached: batch 2..N of a run (and the grouping call) read it at a tenth of the price.
    system: [{ type: 'text' as const, text: request.system, cache_control: { type: 'ephemeral' as const } }],
    messages: [{ role: 'user' as const, content: request.user }],
    thinking: { type: 'adaptive' as const },
    output_config: { effort: EFFORT[request.kind], format: zodOutputFormat(schema) },
  }
}

export function createAnthropicCall(client: Anthropic, model: string = NEWS_MODEL): LlmCall {
  return async (request) => {
    const p = params(request, model)
    const message = request.kind === 'group' ? await client.messages.stream(p).finalMessage() : await client.messages.parse(p)
    // A refusal or a truncated answer is a failed call, not a partial result: the
    // pipeline retries once and then fails the batch closed.
    if (message.stop_reason === 'refusal') throw new Error('model refused the request')
    if (message.stop_reason === 'max_tokens') throw new Error('response truncated at max_tokens')
    const parsed = (message as { parsed_output?: unknown }).parsed_output
    if (parsed === null || parsed === undefined) throw new Error('no parsed output')
    return { output: parsed, usage: usageOf(message.usage) }
  }
}

/**
 * Dry-run call: measures the exact INPUT tokens of each request with the free
 * count_tokens endpoint and generates nothing. It answers every article as
 * irrelevant so the pipeline finishes without a grouping call; the script
 * projects grouping and output cost from the counts (see estimateRunCost).
 */
export function createCountingCall(client: Anthropic, model: string = NEWS_MODEL): LlmCall {
  return async (request) => {
    const p = params(request, model)
    const counted = await client.messages.countTokens({ model, system: p.system, messages: p.messages })
    const ids = [...request.user.matchAll(/<article id="([^"]+)"/g)].map((m) => m[1])
    const articles = ids.map((id) => ({
      id,
      relevant: false,
      confidence: 'high' as const,
      isReport: false,
      countries: [],
      topicTags: [],
      systemicThemes: [],
      severity: 'routine' as const,
      severityReason: 'dry run',
      domesticNoStateResponse: false,
      headOfStateDeathClaim: false,
    }))
    return { output: { articles, events: [] }, usage: { inputTokens: counted.input_tokens } }
  }
}

// ---------------------------------------------------------------------------
// Cost. Sonnet 5 list price, cached 2026-06-24 in the claude-api skill — re-check
// before trusting the dollar figure. Cache reads bill at 0.1x input, writes at 1.25x.

export interface Pricing {
  inputPerMTok: number
  outputPerMTok: number
}
export const SONNET_5_PRICING: Pricing = { inputPerMTok: 2, outputPerMTok: 10 }

export function costUsd(usage: { inputTokens: number; outputTokens: number; cacheReadTokens: number; cacheWriteTokens: number }, pricing: Pricing = SONNET_5_PRICING): number {
  const perTok = (rate: number) => rate / 1_000_000
  return (
    usage.inputTokens * perTok(pricing.inputPerMTok) +
    usage.cacheWriteTokens * perTok(pricing.inputPerMTok * 1.25) +
    usage.cacheReadTokens * perTok(pricing.inputPerMTok * 0.1) +
    usage.outputTokens * perTok(pricing.outputPerMTok)
  )
}

/**
 * Projects a full run from a dry run's exact input tokens. The OUTPUT side is an
 * assumption, not a measurement, until a limited live run replaces it: about
 * `outputPerArticle` tokens per classified article (incl. thinking), grouping's
 * input at `groupInputPerArticle` per accepted article, `acceptRate` of
 * candidates surviving classification. All three are stated so the report can
 * show its assumptions rather than a bare number.
 */
export function estimateRunCost(
  classifyInputTokens: number,
  candidates: number,
  assumptions: { outputPerArticle: number; groupInputPerArticle: number; acceptRate: number; groupOutputPerArticle: number } = {
    outputPerArticle: 150,
    groupInputPerArticle: 130,
    acceptRate: 0.35,
    groupOutputPerArticle: 20,
  },
  pricing: Pricing = SONNET_5_PRICING,
): { usd: number; assumptions: typeof assumptions } {
  const accepted = Math.round(candidates * assumptions.acceptRate)
  const usd = costUsd(
    {
      inputTokens: classifyInputTokens + accepted * assumptions.groupInputPerArticle,
      outputTokens: candidates * assumptions.outputPerArticle + accepted * assumptions.groupOutputPerArticle,
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
    },
    pricing,
  )
  return { usd, assumptions }
}
