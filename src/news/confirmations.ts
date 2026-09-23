import type { NewsEvent } from './types'

// The persistence half of the head-of-state-death review queue (design §8,
// §14) — Phase 5. Pure, like everything else in src/news/: the Admin Console
// writes these records through its local API, and buildNewsEvents.mjs reads
// them back in so a decision survives the next rebuild.
//
// WHY THIS EXISTS AT ALL: the build is stateless. Each run re-clusters the
// archive from scratch and re-runs the gate, so a `manuallyConfirmed` flag set
// on an in-memory Event evaporates the moment the run ends (BACKLOG.md called
// this out as a Phase 5 problem). Without a store, confirming a claim would
// publish it exactly once and then silently un-publish it on the next build.
//
// WHY A RECORD MATCHES ON URLs, NOT JUST THE EVENT ID: an Event's id is keyed
// to its EARLIEST member article's URL, so it survives later reports joining
// the cluster but NOT an earlier report arriving (a slower feed catching up, a
// re-fetch that back-fills). That would hand the same real-world claim a new
// id and quietly drop the decision on the floor. A decision therefore records
// every member URL it was made over, and any overlap re-attaches it.

export type ReviewDecision = 'confirmed' | 'rejected'

export interface ConfirmationRecord {
  /** The Event id at decision time. Checked first; `articleUrls` is the fallback that survives re-keying. */
  eventId: string
  decision: ReviewDecision
  /** The Event's title at decision time. Stored so the file reads as a review trail rather than opaque hashes. */
  title: string
  /** Every source `refUrl` in the dossier at decision time — the durable match key. */
  articleUrls: string[]
  /** ISO 8601. */
  decidedAt: string
  /** Free-text reviewer note: what was checked, which report settled it. */
  note?: string
}

export type ReviewState = ReviewDecision | 'undecided'

type MatchableEvent = Pick<NewsEvent, 'id' | 'sources'>

const urlsOf = (event: MatchableEvent): string[] => event.sources.map((s) => s.refUrl)

/**
 * The record covering this Event, if one exists: same id, or any shared member
 * URL. A later record wins on a tie, so re-deciding a claim overrides the
 * earlier call without needing the old record deleted first.
 */
export function findConfirmation(records: ConfirmationRecord[], event: MatchableEvent): ConfirmationRecord | undefined {
  const urls = new Set(urlsOf(event))
  let match: ConfirmationRecord | undefined
  for (const record of records) {
    if (record.eventId === event.id || record.articleUrls.some((u) => urls.has(u))) {
      if (!match || record.decidedAt >= match.decidedAt) match = record
    }
  }
  return match
}

export function resolveReviewState(records: ConfirmationRecord[], event: MatchableEvent): ReviewState {
  return findConfirmation(records, event)?.decision ?? 'undecided'
}

/**
 * Upsert a decision. Every record the Event already matches is replaced by the
 * new one rather than left behind, so two half-overlapping clusters that later
 * merge can't leave a stale 'rejected' sitting next to a fresh 'confirmed'.
 * Returns a new array; never mutates.
 */
export function recordDecision(
  records: ConfirmationRecord[],
  event: Pick<NewsEvent, 'id' | 'title' | 'sources'>,
  decision: ReviewDecision,
  now: string,
  note?: string,
): ConfirmationRecord[] {
  const urls = new Set(urlsOf(event))
  const kept = records.filter((r) => r.eventId !== event.id && !r.articleUrls.some((u) => urls.has(u)))
  return [
    ...kept,
    {
      eventId: event.id,
      decision,
      title: event.title,
      articleUrls: [...urls],
      decidedAt: now,
      ...(note ? { note } : {}),
    },
  ]
}
