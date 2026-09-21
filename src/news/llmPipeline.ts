import { stableHash } from './hash'
import { clusterArticles, MAX_CLUSTER_SPAN_MS, type ClusterArticle } from './clustering'
import {
  classifySystemPrompt,
  classifyUserMessage,
  groupSystemPrompt,
  groupUserMessage,
  PROMPT_VERSION,
  type GroupPromptArticle,
  type PromptArticle,
} from './llmPrompts'
import { ClassifyResponseSchema, GroupResponseSchema, type ClassifiedArticle } from './llmSchemas'
import { applySeverityCaps } from './severity'
import type { Severity, SystemicThemeConfig, TopicTag } from './types'

// The Phase 3 orchestration: batch articles through classification, then group
// the survivors into Events. Provider-agnostic on purpose — it talks to an
// injected `LlmCall`, so the tests run on a fake with no network and no spend,
// and the SDK-bound implementation lives in scripts/lib/newsLlm.mjs.
//
// Trust boundary: everything an LlmCall returns is UNTRUSTED. The SDK
// constrains output to the schema, and this file re-validates it, then checks
// every id, country name and theme id against what it actually sent. A model
// (or an article that talks the model into something) can therefore change an
// article's tags and tier, but cannot invent an article, a country, or a
// theme — and cannot publish anything, because the corroboration gate that
// decides that lives in code and counts distinct sources, not model opinion.
// Every failure path fails CLOSED (drop / don't merge), never open.

export interface LlmRequest {
  kind: 'classify' | 'group'
  system: string
  user: string
}

export interface LlmUsage {
  calls: number
  inputTokens: number
  outputTokens: number
  cacheReadTokens: number
  cacheWriteTokens: number
}

export interface LlmResponse {
  /** Parsed JSON, unvalidated as far as this file is concerned. */
  output: unknown
  usage?: Partial<LlmUsage>
}

export type LlmCall = (request: LlmRequest) => Promise<LlmResponse>

export const emptyUsage = (): LlmUsage => ({ calls: 0, inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 })

function addUsage(total: LlmUsage, u: Partial<LlmUsage> | undefined): void {
  total.calls += 1
  total.inputTokens += u?.inputTokens ?? 0
  total.outputTokens += u?.outputTokens ?? 0
  total.cacheReadTokens += u?.cacheReadTokens ?? 0
  total.cacheWriteTokens += u?.cacheWriteTokens ?? 0
}

// ---------------------------------------------------------------------------
// Classification

export interface ClassifyItem extends PromptArticle {
  url: string
}

export interface LlmClassification {
  relevant: boolean
  confidence: 'high' | 'medium' | 'low'
  isReport: boolean
  countryIds: string[]
  topicTags: TopicTag[]
  systemicThemes: string[]
  /** Already run through applySeverityCaps. */
  severity: Severity
  severityReason: string
  headOfStateDeathClaim: boolean
}

export type ClassifyOutcome = { status: 'ok'; result: LlmClassification; cached: boolean } | { status: 'failed'; reason: string }

/** Only ever holds schema-valid model output, so a cached entry can be replayed without re-validation. Keyed by classificationCacheKey. */
export interface ClassificationCache {
  get(key: string): ClassifiedArticle | undefined
  set(key: string, value: ClassifiedArticle): void
}

export interface ClassifyDeps {
  call: LlmCall
  /** Model id — part of the cache key, since a different model is a different classifier. */
  model: string
  /** Registry id (numeric ISO id, or 'taiwan') and display name. The model answers with names; lookup is case-insensitive. */
  countries: { id: string; name: string }[]
  themes: SystemicThemeConfig[]
  cache?: ClassificationCache
  batchSize?: number
  concurrency?: number
  usage: LlmUsage
}

export const DEFAULT_BATCH_SIZE = 25

/** A stale entry is worse than a miss, so the key carries everything the answer depends on: prompt version, model, the active-theme set (it's in the prompt), and the article text. */
export function classificationCacheKey(item: ClassifyItem, model: string, activeThemeIds: string[] = []): string {
  return stableHash([PROMPT_VERSION, model, [...activeThemeIds].sort().join(','), item.url, item.title, item.summary].join('\u0001'))
}

async function mapWithConcurrency<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const results: R[] = new Array(items.length)
  let next = 0
  const worker = async () => {
    while (next < items.length) {
      const i = next++
      results[i] = await fn(items[i])
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker))
  return results
}

function normalize(raw: ClassifiedArticle, themes: SystemicThemeConfig[], idByName: Map<string, string>): LlmClassification {
  const activeThemeIds = new Set(themes.filter((t) => t.status === 'active').map((t) => t.id))
  const countryIds = [...new Set(raw.countries.map((n) => idByName.get(n.trim().toLowerCase())).filter((id): id is string => Boolean(id)))]
  const topicTags = [...new Set(raw.topicTags)]
  return {
    relevant: raw.relevant,
    confidence: raw.confidence,
    isReport: raw.isReport,
    countryIds,
    topicTags,
    systemicThemes: [...new Set(raw.systemicThemes.filter((id) => activeThemeIds.has(id)))],
    // Caps are code, not model discretion (§3/§5): a domestic-only incident
    // stays at Significant however grim, sci-tech/crime alone stays at Major.
    severity: applySeverityCaps(raw.severity, { topicTags, domesticNoStateResponse: raw.domesticNoStateResponse }),
    severityReason: raw.severityReason.trim(),
    headOfStateDeathClaim: raw.headOfStateDeathClaim,
  }
}

async function classifyBatch(batch: ClassifyItem[], system: string, deps: ClassifyDeps): Promise<Map<string, ClassifiedArticle>> {
  const user = classifyUserMessage(batch)
  const wanted = new Set(batch.map((b) => b.id))
  let lastError = ''
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const response = await deps.call({ kind: 'classify', system, user })
      addUsage(deps.usage, response.usage)
      const parsed = ClassifyResponseSchema.safeParse(response.output)
      if (!parsed.success) {
        lastError = `schema: ${parsed.error.issues[0]?.message ?? 'invalid'}`
        continue
      }
      const byId = new Map<string, ClassifiedArticle>()
      for (const entry of parsed.data.articles) if (wanted.has(entry.id) && !byId.has(entry.id)) byId.set(entry.id, entry)
      return byId
    } catch (err) {
      lastError = err instanceof Error ? err.message : String(err)
    }
  }
  throw new Error(lastError || 'classification failed')
}

/** Classifies every item. Never throws for a bad batch — those items come back `failed` and are dropped by the caller. */
export async function classifyArticles(items: ClassifyItem[], deps: ClassifyDeps): Promise<Map<string, ClassifyOutcome>> {
  const outcomes = new Map<string, ClassifyOutcome>()
  const idByName = new Map(deps.countries.map((c) => [c.name.toLowerCase(), c.id]))
  const activeThemeIds = deps.themes.filter((t) => t.status === 'active').map((t) => t.id)
  const misses: ClassifyItem[] = []
  for (const item of items) {
    const hit = deps.cache?.get(classificationCacheKey(item, deps.model, activeThemeIds))
    if (hit) outcomes.set(item.id, { status: 'ok', result: normalize(hit, deps.themes, idByName), cached: true })
    else misses.push(item)
  }
  if (misses.length === 0) return outcomes

  const size = deps.batchSize ?? DEFAULT_BATCH_SIZE
  const batches: ClassifyItem[][] = []
  for (let i = 0; i < misses.length; i += size) batches.push(misses.slice(i, i + size))
  const system = classifySystemPrompt(deps.countries.map((c) => c.name), deps.themes)

  const run = async (batch: ClassifyItem[]) => {
    try {
      const byId = await classifyBatch(batch, system, deps)
      for (const item of batch) {
        const raw = byId.get(item.id)
        if (!raw) {
          outcomes.set(item.id, { status: 'failed', reason: 'missing from response' })
          continue
        }
        deps.cache?.set(classificationCacheKey(item, deps.model, activeThemeIds), raw)
        outcomes.set(item.id, { status: 'ok', result: normalize(raw, deps.themes, idByName), cached: false })
      }
    } catch (err) {
      const reason = err instanceof Error ? err.message : String(err)
      for (const item of batch) outcomes.set(item.id, { status: 'failed', reason })
    }
  }

  // First batch alone: it writes the prompt cache the rest then read.
  await run(batches[0])
  await mapWithConcurrency(batches.slice(1), deps.concurrency ?? 4, run)
  return outcomes
}

export type ClassificationRoute = 'accept' | 'not-relevant' | 'low-confidence' | 'not-a-report' | 'no-country' | 'no-topic'

/**
 * Three-way routing from design §6, with its manual-review leg removed: §8 and
 * §13.3 make head-of-state death claims the ONLY manual queue, so a
 * low-confidence item is dropped (and reported) rather than parked for a
 * human. If article-body reads are ever added, low-confidence is where they slot in.
 */
export function routeClassification(c: LlmClassification): ClassificationRoute {
  if (!c.relevant) return 'not-relevant'
  if (c.confidence === 'low') return 'low-confidence'
  if (!c.isReport) return 'not-a-report'
  if (c.countryIds.length === 0) return 'no-country'
  if (c.topicTags.length === 0) return 'no-topic'
  return 'accept'
}

// ---------------------------------------------------------------------------
// Same-event grouping

export interface GroupItem extends GroupPromptArticle, ClusterArticle {}

export interface EventGroup {
  title: string
  /** Time-ordered, so [0] is the first report. */
  members: GroupItem[]
}

export interface GroupDeps {
  call: LlmCall
  usage: LlmUsage
  /** A group larger than this is treated as a model error and re-clustered heuristically. */
  maxGroupSize?: number
  /** Items per call. Above this the input is split into consecutive time windows, and events can't merge across them. */
  windowSize?: number
}

export const MAX_GROUP_SIZE = 30
// One call covers a whole run's accepted articles (~450 in the live sample), so cross-outlet
// events near a window edge aren't split. 600 x ~130 input tokens fits comfortably, and the
// output (one short line per event) fits the 48k ceiling in anthropicCall.ts.
export const GROUP_WINDOW_SIZE = 600

export interface GroupResult {
  groups: EventGroup[]
  /** Ids the model omitted or repeated, or groups a guard split — for the audit report. */
  anomalies: { missing: number; duplicated: number; unknown: number; splitByGuard: number; oversized: number; windows: number; fellBackToHeuristic: boolean }
}

function cleanTitle(raw: string, fallback: string): string {
  const t = raw.replace(/\s+/g, ' ').trim()
  return t.length === 0 ? fallback : t.length > 140 ? `${t.slice(0, 139)}…` : t
}

/** Connected components under "shares a country" — an event whose members have no country in common is two events. */
function splitByCountryConnectivity(members: GroupItem[]): GroupItem[][] {
  const parent = members.map((_, i) => i)
  const find = (i: number): number => (parent[i] === i ? i : (parent[i] = find(parent[i])))
  for (let i = 0; i < members.length; i++)
    for (let j = i + 1; j < members.length; j++)
      if (members[i].linkedEntityIds.some((id) => members[j].linkedEntityIds.includes(id))) parent[find(i)] = find(j)
  const comps = new Map<number, GroupItem[]>()
  members.forEach((m, i) => comps.set(find(i), [...(comps.get(find(i)) ?? []), m]))
  return [...comps.values()]
}

/** Greedy split so no piece spans more than MAX_CLUSTER_SPAN_MS. Input must be time-ordered. */
function splitBySpan(members: GroupItem[]): GroupItem[][] {
  const pieces: GroupItem[][] = []
  for (const m of members) {
    const cur = pieces[pieces.length - 1]
    if (cur && m.time - cur[0].time <= MAX_CLUSTER_SPAN_MS) cur.push(m)
    else pieces.push([m])
  }
  return pieces
}

function heuristicGroups(items: GroupItem[]): EventGroup[] {
  return clusterArticles(items).map((members) => ({ title: members[0].title, members }))
}

async function groupWindow(items: GroupItem[], deps: GroupDeps, anomalies: GroupResult['anomalies']): Promise<EventGroup[]> {
  const system = groupSystemPrompt()
  const user = groupUserMessage(items)
  let parsed: ReturnType<typeof GroupResponseSchema.safeParse> | undefined
  for (let attempt = 0; attempt < 2 && !parsed?.success; attempt++) {
    try {
      const response = await deps.call({ kind: 'group', system, user })
      addUsage(deps.usage, response.usage)
      parsed = GroupResponseSchema.safeParse(response.output)
    } catch {
      parsed = undefined
    }
  }
  if (!parsed?.success) {
    // Fail closed: no LLM opinion means the heuristic's split-leaning clusters, never a bigger merge.
    anomalies.fellBackToHeuristic = true
    return heuristicGroups(items)
  }

  const byId = new Map(items.map((i) => [i.id, i]))
  const assigned = new Set<string>()
  const raw: { title: string; members: GroupItem[] }[] = []
  for (const g of parsed.data.events) {
    const members: GroupItem[] = []
    for (const id of g.articleIds) {
      const item = byId.get(id)
      if (!item) {
        anomalies.unknown++
        continue
      }
      if (assigned.has(id)) {
        anomalies.duplicated++
        continue
      }
      assigned.add(id)
      members.push(item)
    }
    if (members.length > 0) raw.push({ title: g.title, members })
  }
  for (const item of items)
    if (!assigned.has(item.id)) {
      anomalies.missing++
      raw.push({ title: item.title, members: [item] })
    }

  const maxSize = deps.maxGroupSize ?? MAX_GROUP_SIZE
  const out: EventGroup[] = []
  for (const g of raw) {
    const ordered = [...g.members].sort((a, b) => a.time - b.time || a.key.localeCompare(b.key))
    if (ordered.length > maxSize) {
      // A group this big is far likelier a model error than one real event.
      anomalies.oversized++
      out.push(...heuristicGroups(ordered))
      continue
    }
    const pieces = splitBySpan(ordered).flatMap((p) => splitByCountryConnectivity(p))
    if (pieces.length > 1) anomalies.splitByGuard++
    for (const piece of pieces) {
      const members = [...piece].sort((a, b) => a.time - b.time || a.key.localeCompare(b.key))
      out.push({ title: pieces.length === 1 ? cleanTitle(g.title, members[0].title) : members[0].title, members })
    }
  }
  return out
}

/** Groups items into Events. Guards run after the model: a group is only as good as the checks code can make of it. */
export async function groupArticles(items: GroupItem[], deps: GroupDeps): Promise<GroupResult> {
  const anomalies: GroupResult['anomalies'] = { missing: 0, duplicated: 0, unknown: 0, splitByGuard: 0, oversized: 0, windows: 0, fellBackToHeuristic: false }
  if (items.length === 0) return { groups: [], anomalies }
  const ordered = [...items].sort((a, b) => a.time - b.time || a.key.localeCompare(b.key))
  const size = deps.windowSize ?? GROUP_WINDOW_SIZE
  const groups: EventGroup[] = []
  for (let i = 0; i < ordered.length; i += size) {
    anomalies.windows++
    groups.push(...(await groupWindow(ordered.slice(i, i + size), deps, anomalies)))
  }
  return { groups, anomalies }
}
