import { classifyText } from './classify'
import { BUILD_LANGUAGES, isCommentaryUrl } from './eventBuilder'
import { decodeHtmlEntities } from './htmlEntities'
import type { ArchivedArticle } from './articleArchive'

// Phase 6 (cadence): the pure decisions behind unattended News builds. No fs, no network, no clock — scripts/newsCycle.mjs is
// the shell that supplies those. Same split as articleArchive.ts / scripts/lib/newsArchive.mjs.
//
// TWO TRIGGERS, ONE BUILD (news-sourcing-design.md §2): the full build runs at fixed times (10AM/10PM), and a cheap watcher
// may pull the next one forward when something Critical-looking has just arrived. The watcher only decides WHEN to build. It
// never publishes anything and never lowers a bar — the build it triggers is the same build, with the same corroboration
// gate, so a false alarm costs one early build and nothing else.

/** How recent an article must be to count as breaking. A newly added feed backfills its whole window as "new" to the archive; those are not news. */
export const BREAKING_FRESHNESS_MS = 6 * 60 * 60 * 1000

/** Minimum gap between two event-triggered build attempts. A running war yields Critical-looking headlines all day; without this it would rebuild on every watch tick. */
export const BREAKING_COOLDOWN_MS = 60 * 60 * 1000

/** Hard ceiling on event-triggered attempts per rolling 24h, so a stuck trigger can never turn into a build loop. Scheduled builds don't count. */
export const BREAKING_DAILY_CAP = 12

/** A run that died mid-build leaves its lock behind; past this age the lock is treated as abandoned even if the pid is still alive (pid reuse). */
export const LOCK_STALE_MS = 45 * 60 * 1000

/** A feed that has failed this many runs in a row is reported as chronically down rather than as a one-off blip. */
export const CHRONIC_FEED_FAILURES = 3

export interface BreakingCandidate {
  article: ArchivedArticle
  /** `head-of-state-death` is called out separately: it routes to the manual review queue, not to publication, and is worth a human's early attention. */
  reason: 'critical' | 'head-of-state-death'
}

/**
 * Which archived articles look Critical by the same keyword rules the build uses. Applies the build's own first cuts (vetted
 * source, English, not commentary) so the watcher doesn't wake the build for something the build would immediately drop.
 * A candidate is a SIGNAL, not an Event: Critical still needs a wire report or three distinct outlets, and one article never has that.
 */
export function findBreakingCandidates(articles: readonly ArchivedArticle[], knownSourceIds: ReadonlySet<string>, nowMs: number): BreakingCandidate[] {
  const out: BreakingCandidate[] = []
  for (const article of articles) {
    if (!knownSourceIds.has(article.sourceId)) continue
    if (!BUILD_LANGUAGES.has(article.language ?? 'en')) continue
    if (isCommentaryUrl(article.url)) continue
    // No publishedAt means no way to tell fresh from backfill. The build falls back to "now" for such items; a trigger must not.
    const published = article.publishedAt ? Date.parse(article.publishedAt) : Number.NaN
    if (Number.isNaN(published)) continue
    const age = nowMs - published
    // A small negative age is clock skew between a feed and this machine; a large one is a mis-dated item.
    if (age > BREAKING_FRESHNESS_MS || age < -60 * 60 * 1000) continue
    const c = classifyText(`${decodeHtmlEntities(article.title)}. ${decodeHtmlEntities(article.description ?? '')}`)
    if (c.headOfStateDeathClaim) out.push({ article, reason: 'head-of-state-death' })
    else if (c.severity === 'critical') out.push({ article, reason: 'critical' })
  }
  return out
}

/** Persisted between runs (archive/news/cycle-state.json). Everything here is regenerable in the sense that losing it only resets the cooldown and streaks. */
export interface CycleState {
  /** When the last SUCCESSFUL build finished. Articles first seen after this are the ones no published file reflects yet. */
  lastBuildAt?: string
  lastBuildOk?: boolean
  lastBuildError?: string
  consecutiveBuildFailures: number
  /** ISO times of event-triggered build ATTEMPTS (success or not), pruned to the last 24h. */
  breakingAttempts: string[]
  /** Consecutive failed runs per feed URL. Absent means 0. */
  feedFailureStreaks: Record<string, number>
}

export const emptyCycleState = (): CycleState => ({ consecutiveBuildFailures: 0, breakingAttempts: [], feedFailureStreaks: {} })

/** Tolerant read: a missing or corrupt state file must never stop a build, only reset the cooldown. */
export function parseCycleState(text: string | undefined): CycleState {
  if (!text) return emptyCycleState()
  try {
    const raw = JSON.parse(text) as Partial<CycleState>
    return {
      ...emptyCycleState(),
      ...(typeof raw.lastBuildAt === 'string' ? { lastBuildAt: raw.lastBuildAt } : {}),
      ...(typeof raw.lastBuildOk === 'boolean' ? { lastBuildOk: raw.lastBuildOk } : {}),
      ...(typeof raw.lastBuildError === 'string' ? { lastBuildError: raw.lastBuildError } : {}),
      consecutiveBuildFailures: Number.isFinite(raw.consecutiveBuildFailures) ? Math.max(0, Number(raw.consecutiveBuildFailures)) : 0,
      breakingAttempts: Array.isArray(raw.breakingAttempts) ? raw.breakingAttempts.filter((t): t is string => typeof t === 'string') : [],
      feedFailureStreaks: raw.feedFailureStreaks && typeof raw.feedFailureStreaks === 'object' ? { ...raw.feedFailureStreaks } : {},
    }
  } catch {
    return emptyCycleState()
  }
}

const DAY_MS = 24 * 60 * 60 * 1000

export interface BreakingDecision {
  run: boolean
  reason: string
}

/** Whether the watcher should start an out-of-schedule build now. Pure: every input, including the clock, is an argument. */
export function decideBreakingBuild(candidates: readonly BreakingCandidate[], state: CycleState, nowMs: number): BreakingDecision {
  if (candidates.length === 0) return { run: false, reason: 'no fresh Critical-looking articles since the last build' }
  const recent = state.breakingAttempts.map((t) => Date.parse(t)).filter((t) => !Number.isNaN(t) && nowMs - t < DAY_MS)
  const last = Math.max(0, ...recent)
  if (last > 0 && nowMs - last < BREAKING_COOLDOWN_MS) {
    const waitMin = Math.ceil((BREAKING_COOLDOWN_MS - (nowMs - last)) / 60_000)
    return { run: false, reason: `${candidates.length} candidate(s) waiting, cooldown ${waitMin} more min` }
  }
  if (recent.length >= BREAKING_DAILY_CAP) return { run: false, reason: `${candidates.length} candidate(s) waiting, daily cap of ${BREAKING_DAILY_CAP} event-triggered builds reached` }
  const hos = candidates.some((c) => c.reason === 'head-of-state-death')
  return { run: true, reason: `${candidates.length} fresh Critical-looking article(s)${hos ? ' incl. a head-of-state death claim' : ''}` }
}

/** Records one event-triggered attempt and drops entries older than 24h. */
export function recordBreakingAttempt(state: CycleState, nowMs: number): CycleState {
  const kept = state.breakingAttempts.filter((t) => nowMs - Date.parse(t) < DAY_MS)
  return { ...state, breakingAttempts: [...kept, new Date(nowMs).toISOString()] }
}

export function recordBuildResult(state: CycleState, ok: boolean, nowIso: string, error?: string): CycleState {
  if (ok) {
    const { lastBuildError: _dropped, ...rest } = state
    return { ...rest, lastBuildAt: nowIso, lastBuildOk: true, consecutiveBuildFailures: 0 }
  }
  // lastBuildAt deliberately untouched: the published file still reflects the last GOOD build, so anything newer stays a candidate.
  return { ...state, lastBuildOk: false, lastBuildError: error ?? 'unknown error', consecutiveBuildFailures: state.consecutiveBuildFailures + 1 }
}

/**
 * Advances each feed's consecutive-failure streak after one fetch. A feed that answered resets to zero (and is dropped from
 * the map); a feed that failed increments. A feed missing from BOTH lists — removed from feeds.json since — is forgotten.
 */
export function updateFeedStreaks(prev: Record<string, number>, allFeedUrls: readonly string[], failedUrls: readonly string[]): Record<string, number> {
  const failed = new Set(failedUrls)
  const next: Record<string, number> = {}
  for (const url of allFeedUrls) if (failed.has(url)) next[url] = (prev[url] ?? 0) + 1
  return next
}

export const chronicallyFailingFeeds = (streaks: Record<string, number>, threshold = CHRONIC_FEED_FAILURES): string[] =>
  Object.entries(streaks)
    .filter(([, n]) => n >= threshold)
    .map(([url]) => url)
    .sort()

export interface LockInfo {
  pid: number
  at: string
  mode: string
}

/** A lock is stale when its run is provably gone (pid dead) or has been "running" longer than any real build. */
export function lockIsStale(info: LockInfo | undefined, nowMs: number, pidAlive: boolean): boolean {
  if (!info) return true
  const at = Date.parse(info.at)
  if (Number.isNaN(at)) return true
  return !pidAlive || nowMs - at > LOCK_STALE_MS
}
