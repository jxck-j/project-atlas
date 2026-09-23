import { describe, expect, it } from 'vitest'
import {
  BREAKING_COOLDOWN_MS,
  BREAKING_DAILY_CAP,
  BREAKING_FRESHNESS_MS,
  LOCK_STALE_MS,
  chronicallyFailingFeeds,
  decideBreakingBuild,
  emptyCycleState,
  findBreakingCandidates,
  lockIsStale,
  parseCycleState,
  recordBreakingAttempt,
  recordBuildResult,
  updateFeedStreaks,
} from './cadence'
import type { ArchivedArticle } from './articleArchive'

const NOW = Date.parse('2026-09-23T12:00:00.000Z')
const ago = (ms: number) => new Date(NOW - ms).toISOString()
const HOUR = 60 * 60 * 1000
const KNOWN = new Set(['bbc', 'aljazeera'])

const art = (extra: Partial<ArchivedArticle> = {}): ArchivedArticle => ({
  sourceId: 'bbc',
  title: 'Weather report for the week',
  url: 'https://x.com/news/1',
  publishedAt: ago(HOUR),
  firstSeenAt: ago(HOUR),
  ...extra,
})

// Headlines that classify.ts's own tests treat as Critical / not.
const CRITICAL = 'Drone attack on Riyadh airport kills 40 civilians, Saudi officials say'
const HOS_DEATH = 'President of Ruritania killed in assassination, officials confirm'

describe('findBreakingCandidates', () => {
  it('flags a fresh Critical-looking article from a vetted source', () => {
    const found = findBreakingCandidates([art({ title: CRITICAL })], KNOWN, NOW)
    expect(found).toHaveLength(1)
    expect(found[0].reason).toBe('critical')
  })

  it('ignores an ordinary article', () => {
    expect(findBreakingCandidates([art()], KNOWN, NOW)).toEqual([])
  })

  it('separates a head-of-state death claim from other Critical items', () => {
    const found = findBreakingCandidates([art({ title: HOS_DEATH, url: 'https://x.com/news/2' })], KNOWN, NOW)
    expect(found.map((c) => c.reason)).toEqual(['head-of-state-death'])
  })

  it('ignores a stale article — a newly added feed backfills its whole window as "new"', () => {
    const stale = art({ title: CRITICAL, publishedAt: ago(BREAKING_FRESHNESS_MS + HOUR) })
    expect(findBreakingCandidates([stale], KNOWN, NOW)).toEqual([])
  })

  it('ignores an article with no publishedAt or a date far in the future', () => {
    expect(findBreakingCandidates([art({ title: CRITICAL, publishedAt: undefined })], KNOWN, NOW)).toEqual([])
    expect(findBreakingCandidates([art({ title: CRITICAL, publishedAt: ago(-5 * HOUR) })], KNOWN, NOW)).toEqual([])
  })

  it('applies the build\'s own first cuts: unknown source, non-English feed, commentary URL', () => {
    expect(findBreakingCandidates([art({ title: CRITICAL, sourceId: 'not-on-roster' })], KNOWN, NOW)).toEqual([])
    expect(findBreakingCandidates([art({ title: CRITICAL, language: 'es' })], KNOWN, NOW)).toEqual([])
    expect(findBreakingCandidates([art({ title: CRITICAL, url: 'https://x.com/opinion/1' })], KNOWN, NOW)).toEqual([])
  })
})

describe('decideBreakingBuild', () => {
  const candidate = findBreakingCandidates([art({ title: CRITICAL })], KNOWN, NOW)

  it('does nothing without candidates', () => {
    expect(decideBreakingBuild([], emptyCycleState(), NOW).run).toBe(false)
  })

  it('runs on a fresh candidate with a clean state', () => {
    expect(decideBreakingBuild(candidate, emptyCycleState(), NOW).run).toBe(true)
  })

  it('holds inside the cooldown, and says how long is left', () => {
    const state = recordBreakingAttempt(emptyCycleState(), NOW - 20 * 60_000)
    const d = decideBreakingBuild(candidate, state, NOW)
    expect(d.run).toBe(false)
    expect(d.reason).toMatch(/cooldown 40 more min/)
  })

  it('runs again once the cooldown has passed', () => {
    const state = recordBreakingAttempt(emptyCycleState(), NOW - BREAKING_COOLDOWN_MS - 1)
    expect(decideBreakingBuild(candidate, state, NOW).run).toBe(true)
  })

  it('stops at the daily cap even when every attempt is outside the cooldown', () => {
    let state = emptyCycleState()
    for (let i = 0; i < BREAKING_DAILY_CAP; i++) state = recordBreakingAttempt(state, NOW - (i + 2) * 1.5 * HOUR)
    const d = decideBreakingBuild(candidate, state, NOW)
    expect(d.run).toBe(false)
    expect(d.reason).toMatch(/daily cap/)
  })

  it('counts a failed attempt against the cooldown too — a broken build must not retry every tick', () => {
    const state = recordBuildResult(recordBreakingAttempt(emptyCycleState(), NOW - 5 * 60_000), false, new Date(NOW).toISOString(), 'boom')
    expect(decideBreakingBuild(candidate, state, NOW).run).toBe(false)
  })

  it('mentions a head-of-state death claim in the reason', () => {
    const c = findBreakingCandidates([art({ title: HOS_DEATH })], KNOWN, NOW)
    expect(decideBreakingBuild(c, emptyCycleState(), NOW).reason).toMatch(/head-of-state/)
  })
})

describe('recordBreakingAttempt', () => {
  it('drops attempts older than 24h', () => {
    const old = recordBreakingAttempt(emptyCycleState(), NOW - 25 * HOUR)
    const next = recordBreakingAttempt(old, NOW)
    expect(next.breakingAttempts).toEqual([new Date(NOW).toISOString()])
  })
})

describe('recordBuildResult', () => {
  it('a success stamps lastBuildAt and clears the failure count and error', () => {
    const failed = recordBuildResult(emptyCycleState(), false, ago(2 * HOUR), 'no network')
    const ok = recordBuildResult(failed, true, ago(0))
    expect(ok.lastBuildAt).toBe(ago(0))
    expect(ok.lastBuildOk).toBe(true)
    expect(ok.consecutiveBuildFailures).toBe(0)
    expect(ok.lastBuildError).toBeUndefined()
  })

  it('a failure keeps lastBuildAt (the published file is still the old one) and counts up', () => {
    const good = recordBuildResult(emptyCycleState(), true, ago(5 * HOUR))
    const bad = recordBuildResult(recordBuildResult(good, false, ago(1 * HOUR), 'x'), false, ago(0), 'y')
    expect(bad.lastBuildAt).toBe(ago(5 * HOUR))
    expect(bad.consecutiveBuildFailures).toBe(2)
    expect(bad.lastBuildError).toBe('y')
  })
})

describe('parseCycleState', () => {
  it('falls back to empty for missing or corrupt text', () => {
    expect(parseCycleState(undefined)).toEqual(emptyCycleState())
    expect(parseCycleState('{not json')).toEqual(emptyCycleState())
  })

  it('round-trips a real state and ignores wrong-typed fields', () => {
    const state = recordBreakingAttempt(recordBuildResult(emptyCycleState(), true, ago(HOUR)), NOW)
    expect(parseCycleState(JSON.stringify(state))).toEqual(state)
    expect(parseCycleState('{"lastBuildAt": 5, "breakingAttempts": "x", "consecutiveBuildFailures": "n"}')).toEqual(emptyCycleState())
  })
})

describe('feed failure streaks', () => {
  const feeds = ['a', 'b', 'c']

  it('increments a failing feed, resets one that recovered, and forgets a removed one', () => {
    const one = updateFeedStreaks({}, feeds, ['a', 'b'])
    expect(one).toEqual({ a: 1, b: 1 })
    const two = updateFeedStreaks({ ...one, gone: 9 }, feeds, ['a'])
    expect(two).toEqual({ a: 2 })
  })

  it('reports only feeds at or past the chronic threshold, sorted', () => {
    expect(chronicallyFailingFeeds({ b: 3, a: 5, c: 2 })).toEqual(['a', 'b'])
    expect(chronicallyFailingFeeds({ a: 1 })).toEqual([])
  })
})

describe('lockIsStale', () => {
  const fresh = { pid: 1, at: ago(60_000), mode: 'build' }

  it('holds for a live, recent run', () => {
    expect(lockIsStale(fresh, NOW, true)).toBe(false)
  })
  it('breaks when the process is gone', () => {
    expect(lockIsStale(fresh, NOW, false)).toBe(true)
  })
  it('breaks when it has outlived any real build, even with a live pid (pid reuse)', () => {
    expect(lockIsStale({ ...fresh, at: ago(LOCK_STALE_MS + 1) }, NOW, true)).toBe(true)
  })
  it('treats an unreadable lock as stale', () => {
    expect(lockIsStale(undefined, NOW, true)).toBe(true)
    expect(lockIsStale({ ...fresh, at: 'garbage' }, NOW, true)).toBe(true)
  })
})
