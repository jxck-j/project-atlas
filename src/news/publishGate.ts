import { deriveCorroboration, meetsCorroborationFloor } from './corroboration'
import type { Corroboration, NewsEvent, ReviewStatus, Severity } from './types'

// The severity-gated publishing table from news-sourcing-design.md §8.
// Manual review is deliberately minimal: professional agencies and OSINT
// specialists are trusted, corroboration-gated by tier, with no general
// moderation layer. The ONE exception is a head-of-state/government death
// claim, which needs a human even after it clears the Critical floor.

/**
 * Minimum corroboration to publish, by tier. Critical is wire-confirmed OR
 * four distinct outlets (the latter is a 2026-09-20 amendment to §8, since
 * no wire feed is reachable) — 2+ OSINT corroborations and specialist-
 * verified status still do NOT clear it. Every other tier's floor is osint-corroborated (2+);
 * specialist-verified outranks that (Major's "OSINT 2+ or specialist-
 * verified"), so it clears Significant/Routine too — the doc's table lists
 * the alternative only for Major, but a stronger standing satisfying a
 * weaker floor is the only ordering that keeps the ladder coherent.
 */
export const CORROBORATION_FLOOR: Record<Severity, Corroboration> = {
  critical: 'outlet-corroborated (4+)', // wire-confirmed outranks it, so a wire report still clears Critical
  major: 'osint-corroborated (2+)',
  significant: 'osint-corroborated (2+)',
  routine: 'osint-corroborated (2+)',
}

export type PublishDecision =
  /** Below the corroboration floor. The build doesn't emit the Event at all; it's re-evaluated from scratch next run, when more sources may have arrived. */
  | { outcome: 'below-floor'; reviewStatus: null }
  /** Head-of-state death claim that cleared the Critical floor, awaiting a human — the Admin Console's only review queue. Emitted but never reader-visible. */
  | { outcome: 'pending-confirmation'; reviewStatus: 'pending-confirmation' }
  | { outcome: 'publish'; reviewStatus: 'auto-published' | 'manual-only' }

type GateInput = Pick<NewsEvent, 'severity' | 'sources' | 'headOfStateDeathClaim' | 'manuallyConfirmed'>

export function resolvePublishDecision(event: GateInput): PublishDecision {
  // A head-of-state death claim is gated as Critical whatever tier the
  // classifier assigned — it's the highest-consequence, most rumor-prone
  // claim type, so its floor can't depend on a heuristic getting the tier right.
  const gatedSeverity: Severity = event.headOfStateDeathClaim ? 'critical' : event.severity
  const corroboration = deriveCorroboration(event.sources)

  if (!meetsCorroborationFloor(corroboration, CORROBORATION_FLOOR[gatedSeverity])) {
    return { outcome: 'below-floor', reviewStatus: null }
  }
  if (event.headOfStateDeathClaim) {
    return event.manuallyConfirmed
      ? { outcome: 'publish', reviewStatus: 'manual-only' }
      : { outcome: 'pending-confirmation', reviewStatus: 'pending-confirmation' }
  }
  return { outcome: 'publish', reviewStatus: 'auto-published' }
}

/** Reader-facing statuses. Pending and retracted Events stay in the data for audit/the review queue but never render in feeds. */
export function isReaderVisible(status: ReviewStatus): boolean {
  return status === 'auto-published' || status === 'manual-only'
}
