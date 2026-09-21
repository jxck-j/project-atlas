import type { Severity, TopicTag } from './types'

// Severity rules from news-sourcing-design.md §5. This file holds the parts
// of the tier table that are pure arithmetic/ordering — the numeric
// thresholds, the caps, the fallback rule. Deciding *which* trigger an
// article actually hits (keyword heuristics in v1, the LLM pass in Phase 3)
// is classification, not policy, and lives with the build pipeline.

/** Higher = more severe. */
export const SEVERITY_RANK: Record<Severity, number> = {
  critical: 3,
  major: 2,
  significant: 1,
  routine: 0,
}

/** Sort comparator, most severe first. */
export function compareSeverity(a: Severity, b: Severity): number {
  return SEVERITY_RANK[b] - SEVERITY_RANK[a]
}

export function maxSeverity(severities: Severity[]): Severity {
  return severities.reduce((best, s) => (SEVERITY_RANK[s] > SEVERITY_RANK[best] ? s : best), 'routine' as Severity)
}

/** Lowers `severity` to `cap` if it exceeds it; never raises. */
export function capSeverity(severity: Severity, cap: Severity): Severity {
  return SEVERITY_RANK[severity] > SEVERITY_RANK[cap] ? cap : severity
}

// ---------------------------------------------------------------------------
// Numeric thresholds. All INTERNALLY SET JUDGMENT CALLS, not borrowed/citable
// figures (unlike UCDP's 25+/year, used for Current Status) — the design doc
// logs this explicitly (§5). If Atlas's "sourced or unscored" standard is
// ever extended to non-scored features, these are the numbers that would need
// their own justification on record.

/** Conflict/Terrorism: 10+ deaths in a single reported incident is Critical. */
export const MASS_CASUALTY_CRITICAL_DEATHS = 10

/**
 * Humanitarian thresholds are deliberately separate from the conflict number:
 * disasters have a much higher base rate (a "routine" earthquake often
 * exceeds 10 deaths), so reusing 10 would make Critical trivially easy to hit.
 */
export const HUMANITARIAN_CRITICAL_DEATHS = 500
export const HUMANITARIAN_CRITICAL_DISPLACED = 500_000
export const HUMANITARIAN_MAJOR_DEATHS = 50
export const HUMANITARIAN_MAJOR_DISPLACED = 10_000

/** Conflict/Terrorism single-incident death count → Critical, or null when the count alone doesn't decide (caller continues to the Major/Significant heuristics). */
export function massCasualtySeverity(deathsInSingleIncident: number): 'critical' | null {
  return deathsInSingleIncident >= MASS_CASUALTY_CRITICAL_DEATHS ? 'critical' : null
}

export interface HumanitarianFigures {
  /** Deaths in a single disaster event. */
  deaths?: number
  /** People displaced / requiring emergency shelter. */
  displaced?: number
  /** A PHEIC-equivalent outbreak declaration. */
  pheic?: boolean
  /**
   * People under an evacuation ORDER or ADVISORY — told to leave, not yet displaced. Counted one tier below the same number of people
   * actually displaced (J, 2026-09-21): 500,000+ under evacuation reaches Major, never Critical. (10,000+ would be one tier below Major,
   * i.e. Significant — already the humanitarian baseline — so only the upper figure changes anything.)
   */
  evacuationOrdered?: number
}

/** Humanitarian & Displacement tier from the stated figures, or null when neither the Critical nor Major bar is met. Either figure alone is enough (the doc's "OR"). */
export function humanitarianSeverity({ deaths = 0, displaced = 0, pheic = false, evacuationOrdered = 0 }: HumanitarianFigures): 'critical' | 'major' | null {
  if (pheic || deaths >= HUMANITARIAN_CRITICAL_DEATHS || displaced >= HUMANITARIAN_CRITICAL_DISPLACED) return 'critical'
  if (deaths >= HUMANITARIAN_MAJOR_DEATHS || displaced >= HUMANITARIAN_MAJOR_DISPLACED || evacuationOrdered >= HUMANITARIAN_CRITICAL_DISPLACED) return 'major'
  return null
}

/**
 * Fallback for anything matching no explicit trigger: Significant if it
 * substantively names a leader/government body/military unit taking a real
 * action, Routine otherwise. Runs only AFTER the relevance gate — it never
 * decides relevance itself.
 */
export function fallbackSeverity(namesActorTakingRealAction: boolean): 'significant' | 'routine' {
  return namesActorTakingRealAction ? 'significant' : 'routine'
}

export interface SeverityCapContext {
  topicTags: TopicTag[]
  /** A domestic incident (crime, shooting, disaster) with no state security/diplomatic response and no international dimension. */
  domesticNoStateResponse?: boolean
}

const TAGS_THAT_CANT_REACH_CRITICAL_ALONE: ReadonlySet<TopicTag> = new Set(['crime-trafficking', 'science-technology'])

/**
 * Structural caps applied after a raw tier is chosen (§3 resolved item, §5):
 *  - A domestic incident with no state response stays in scope but is capped
 *    at Significant regardless of casualty count. (Once a state response
 *    attaches, the caller passes `domesticNoStateResponse: false` and the
 *    normal rules can lift it to Major.)
 *  - Crime & Trafficking / Science & Technology have no Critical trigger of
 *    their own — an Event carrying only those tags caps at Major; it reaches
 *    Critical only by also carrying another tag whose Critical trigger fired.
 */
export function applySeverityCaps(severity: Severity, { topicTags, domesticNoStateResponse = false }: SeverityCapContext): Severity {
  let result = severity
  if (domesticNoStateResponse) result = capSeverity(result, 'significant')
  if (topicTags.length > 0 && topicTags.every((t) => TAGS_THAT_CANT_REACH_CRITICAL_ALONE.has(t))) {
    result = capSeverity(result, 'major')
  }
  return result
}
