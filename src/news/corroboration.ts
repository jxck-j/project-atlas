import type { Corroboration, SourceEntry } from './types'

// Corroboration is a computation over an Event's dossier, not a stored field
// (news-sourcing-design.md §17a) — an Event with a Reuters entry and a BBC
// entry is wire-confirmed by inspection, there's nothing separate to keep in
// sync. The floor table it's checked against is publishGate.ts's job.

/** Higher = stronger evidentiary standing. */
export const CORROBORATION_RANK: Record<Corroboration, number> = {
  'wire-confirmed': 4,
  // Ranked above specialist-verified on purpose: Critical accepts three
  // outlets but NOT a lone specialist, and a linear ladder can only express
  // that by putting this rung between wire and specialist.
  'outlet-corroborated (3+)': 3,
  'specialist-verified': 2,
  'osint-corroborated (2+)': 1,
  unconfirmed: 0,
}

/**
 * Distinct outlets that let an Event clear Critical without a wire report. A judgment call set directly by J, not a citable figure:
 * 4 on 2026-09-20, lowered to 3 on 2026-09-21. Lower means more reach and more exposure to one syndicated story counted several times.
 */
export const CRITICAL_OUTLET_COUNT = 3

/**
 * Categories that can never count, whatever their stored flag says. Community
 * discussion is the §9b hard wall ("never evidence"); live video's status is
 * still an open question in §17c, so it's excluded conservatively rather than
 * guessed at. Enforcing this here, not only at build time, means a
 * mis-stamped `countsTowardCorroboration: true` can't breach the wall.
 */
const NEVER_COUNTS = new Set<SourceEntry['sourceCategory']>(['community-discussion', 'live-video'])

function counts(entry: SourceEntry): boolean {
  return entry.countsTowardCorroboration && !NEVER_COUNTS.has(entry.sourceCategory)
}

function isWire(entry: SourceEntry): boolean {
  return entry.sourceCategory === 'outlet' && entry.tier === 'wire'
}

/**
 * Only non-state outlets count toward Critical's three (J, 2026-09-20). A
 * state-controlled outlet can sit in the dossier and be displayed, but three
 * state media echoing one claim is not corroboration — a state-media claim
 * reaches Critical only alongside three non-state outlets. Judged on the
 * entry's own `pressControl`, so `'state-run-democratic'` (Focus Taiwan) and
 * unlabeled outlets (including state-funded ones like Al Jazeera, whose
 * `caveat` isn't a pressControl) still count.
 */
function countsTowardCriticalOutlets(entry: SourceEntry): boolean {
  return entry.sourceCategory === 'outlet' && entry.pressControl !== 'state-controlled'
}

function isStateControlled(entry: SourceEntry): boolean {
  return entry.sourceCategory === 'outlet' && entry.pressControl === 'state-controlled'
}

function isSpecialistVerified(entry: SourceEntry): boolean {
  return (entry.sourceCategory === 'analysis' || entry.sourceCategory === 'first-hand') && entry.specialistVerified === true
}

/**
 * - wire-confirmed: any one counting entry from a wire-tier outlet (a single
 *   wire report satisfies every floor, same as v1's wire bypass).
 * - outlet-corroborated (3+): counting entries from at least
 *   CRITICAL_OUTLET_COUNT distinct NON-STATE `'outlet'` sources (see
 *   countsTowardCriticalOutlets). Analysis orgs, first-hand, official statements,
 *   and state-controlled outlets don't count toward the three. This is the
 *   stand-in for a wire report while no wire feed is reachable. Known
 *   weakness: it counts sources, not independent newsgathering, so three
 *   outlets running one syndicated AP story pass — logged in BACKLOG.md
 *   rather than guessed at.
 * - specialist-verified: any one counting entry from ISW/ACLED/Bellingcat or a
 *   §15a tier-1 verification-specialist channel.
 * - osint-corroborated (2+): counting entries from at least two DISTINCT
 *   sources, AT LEAST ONE of them not state-controlled (J, 2026-09-23). Distinct
 *   by `sourceId`, so two feeds from one outlet, or two posts from one channel,
 *   are one source, not two. State media can be the second source, never the
 *   whole count: the first build over the full roster published a Yemen
 *   airstrike Event on IRNA + the Houthi SABA alone, two allied state outlets.
 * - unconfirmed otherwise.
 * The highest applicable state wins.
 */
export function deriveCorroboration(sources: SourceEntry[]): Corroboration {
  const counting = sources.filter(counts)
  if (counting.some(isWire)) return 'wire-confirmed'
  const outletCount = new Set(counting.filter(countsTowardCriticalOutlets).map((e) => e.sourceId)).size
  if (outletCount >= CRITICAL_OUTLET_COUNT) return 'outlet-corroborated (3+)'
  if (counting.some(isSpecialistVerified)) return 'specialist-verified'
  if (new Set(counting.map((e) => e.sourceId)).size >= 2 && counting.some((e) => !isStateControlled(e))) return 'osint-corroborated (2+)'
  return 'unconfirmed'
}

/** True when `actual` is at least as strong as `floor`. */
export function meetsCorroborationFloor(actual: Corroboration, floor: Corroboration): boolean {
  return CORROBORATION_RANK[actual] >= CORROBORATION_RANK[floor]
}
