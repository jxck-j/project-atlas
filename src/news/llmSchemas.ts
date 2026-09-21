import { z } from 'zod'
import type { Severity, TopicTag } from './types'

// Wire shapes for the two Phase 3 LLM calls (design §6): per-article
// classification, and same-event grouping. The SDK constrains the model's
// output to these schemas (`output_config.format`), and the pipeline
// re-validates anyway — the injected client is an interface, so a fake or a
// future provider gets no free pass. Kept dependency-light: only zod, no SDK.

export const TopicTagSchema = z.enum([
  'conflict-security',
  'terrorism-non-state-actors',
  'diplomacy-politics',
  'economic-trade',
  'energy',
  'humanitarian-displacement',
  'crime-trafficking',
  'science-technology',
])
export const SeveritySchema = z.enum(['critical', 'major', 'significant', 'routine'])

// Compile-time guard: if a tag or tier is added to types.ts, these must follow.
type Equal<A, B> = [A] extends [B] ? ([B] extends [A] ? true : false) : false
const _tagsMatch: Equal<z.infer<typeof TopicTagSchema>, TopicTag> = true
const _severityMatches: Equal<z.infer<typeof SeveritySchema>, Severity> = true
void _tagsMatch
void _severityMatches

export const ClassifiedArticleSchema = z.object({
  /** Echoed back so a result can be matched to its article — validated against the batch. */
  id: z.string(),
  /** Substantively in Atlas's scope (§3), not merely a name/keyword match. */
  relevant: z.boolean(),
  /** How sure the model is of `relevant` AND the tier. `low` is dropped, not queued — §8 leaves head-of-state deaths as the only manual queue. */
  confidence: z.enum(['high', 'medium', 'low']),
  /** True when the piece reports a specific new event/development; false for opinion, analysis, explainers, features, profiles, live-blog hubs. */
  isReport: z.boolean(),
  /** Country names taken from the provided list — the countries the event is ABOUT or materially involves, principal country first. */
  countries: z.array(z.string()),
  topicTags: z.array(TopicTagSchema),
  /** Ids from the provided active-theme list only. */
  systemicThemes: z.array(z.string()),
  severity: SeveritySchema,
  /** One short sentence naming the trigger the tier rests on. Audit trail for calibration; never shown to readers. */
  severityReason: z.string(),
  /** A domestic incident with no state security/diplomatic response and no international dimension (caps at Significant, §5). */
  domesticNoStateResponse: z.boolean(),
  /** The article reports, or reports a claim, that a head of state/government was killed. Recall over precision: this only routes to the manual queue. */
  headOfStateDeathClaim: z.boolean(),
})
export type ClassifiedArticle = z.infer<typeof ClassifiedArticleSchema>

export const ClassifyResponseSchema = z.object({ articles: z.array(ClassifiedArticleSchema) })
export type ClassifyResponse = z.infer<typeof ClassifyResponseSchema>

export const EventGroupSchema = z.object({
  /** Short, neutral, factual — "Explosion reported in Kyiv", never editorializing (§17b). */
  title: z.string(),
  articleIds: z.array(z.string()),
})
export const GroupResponseSchema = z.object({ events: z.array(EventGroupSchema) })
export type GroupResponse = z.infer<typeof GroupResponseSchema>
