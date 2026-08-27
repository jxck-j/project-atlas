import type { DemographicGroup } from '../data/currentStatus'

// A display segment is a raw DemographicGroup, plus — only for a synthesized
// "Other" bucket — the real constituent groups it aggregates, for
// SegmentedBar's tooltip. Deliberately not added to DemographicGroup itself
// (src/data/currentStatus.ts) — that type is raw, sourced data; the "Other"
// bucket only exists at render time, never in the data file.
export interface DemographicDisplaySegment extends DemographicGroup {
  breakdown?: DemographicGroup[]
}

// Never eligible for a top-4 slot, regardless of size — always folded into
// the synthesized "Other" bucket instead. Source-agnostic (applies whether a
// group came from UNSD or the Factbook fallback — see
// scripts/buildCurrentStatus.mjs's own DEMOGRAPHICS header comment): a
// literal "Other" entry (either source can emit one — Factbook's own free
// text, or a UNSD census that used that exact label) is never a real named
// group worth its own slot, and UNSD's "Not Stated"/"Unknown"/"Refused to
// Respond" are real population that didn't answer the question at all, not
// an ethnic/religious group. Matched by exact (trimmed, case-insensitive)
// name — "other/stateless/unspecified" (a real compound Factbook label) is
// NOT "Other" and stays normally rankable; only literal "Other" folds.
const NON_RANKABLE_NAMES = new Set(['other', 'not stated', 'unknown', 'refused to respond'])

function isNonRankable(group: DemographicGroup): boolean {
  return NON_RANKABLE_NAMES.has(group.name.trim().toLowerCase())
}

// Below this, a shortfall from 100% reads as ordinary rounding drift in the
// source data (Taiwan's Factbook figures sum to ~97.3%, Greece's UNSD/
// Factbook mix to ~101%) rather than a real, meaningful reporting gap — not
// worth a visible sliver for every country whose numbers don't land on
// exactly 100.0.
const UNKNOWN_THRESHOLD_PCT = 1

// Render-time transform for a country's raw ethnicGroups/religions list
// (src/data/currentStatus.ts, UNSD-primary/Factbook-fallback sourced) into
// what SegmentedBar.tsx actually draws — up to 4 named, rankable groups,
// then a synthesized "Other" bucket (real groups beyond position 4, AND any
// non-rankable group regardless of its own size — see NON_RANKABLE_NAMES
// above), then a synthesized "Unknown" segment covering whatever's left
// over from 100% after everything the source actually reported. "Other" and
// "Unknown" are kept as two DIFFERENT segments, not merged — they mean
// different things: "Other" is real, named minor groups the source
// reported but didn't break out individually; "Unknown" is population the
// source's own figures simply don't account for at all (Malta's Factbook
// religion text is literally "Roman Catholic (official) more than 90%"
// with nothing else — the remaining ~10% isn't "other religions we
// aggregated," it's "not stated by this source"). Reporting it as an
// explicit "Unknown" segment rather than silently leaving the bar short of
// 100% isn't fabricating a number — the real fact being displayed is
// "the source doesn't say," which is exactly what the segment states.
//
// Kept as its own plain function (not baked into the build script) for the
// same "raw facts in the data file, presentation shaping downstream" split
// src/data/currentStatus.ts's own header comment documents for
// population/gdpUsd — a future caller that wants the real, ungrouped list
// (a full breakdown table, say) isn't stuck with only this shape, and the
// build script never has to guess a country's true completeness at
// generation time.
//
// Always re-sorts descending itself rather than trusting the caller's order
// — a pure function shouldn't depend on an invariant it doesn't enforce.
export function groupTopFourPlusOther(groups: DemographicGroup[]): DemographicDisplaySegment[] {
  // No real data at all is NOT the same fact as "real data that doesn't add
  // up to 100%" — the former means the source has nothing whatsoever (the
  // caller already treats this as "skip the whole section," e.g.
  // IntelligencePanel's `currentStatus.ethnicGroups &&` gate, and
  // AnalyticsPanel's ranked-list columns render "—" for it), the latter
  // means the source reported SOME real, named figures that a genuine gap
  // remains under. Synthesizing "Unknown 100%" for a country with literally
  // no source data at all would misrepresent silence as a measured, total
  // data gap — stay empty here instead, unchanged from before "Unknown" was
  // introduced.
  if (groups.length === 0) return []

  const sorted = [...groups].sort((a, b) => b.pct - a.pct)
  const rankable = sorted.filter((g) => !isNonRankable(g))
  const nonRankable = sorted.filter(isNonRankable)

  const top4 = rankable.slice(0, 4)
  const rest = [...rankable.slice(4), ...nonRankable].sort((a, b) => b.pct - a.pct)

  const segments: DemographicDisplaySegment[] = [...top4]
  if (rest.length > 0) {
    const otherPct = rest.reduce((sum, g) => sum + g.pct, 0)
    segments.push({ name: 'Other', pct: otherPct, breakdown: rest })
  }

  const reportedPct = sorted.reduce((sum, g) => sum + g.pct, 0)
  const unknownPct = 100 - reportedPct
  if (unknownPct > UNKNOWN_THRESHOLD_PCT) {
    segments.push({ name: 'Unknown', pct: unknownPct })
  }

  return segments
}
