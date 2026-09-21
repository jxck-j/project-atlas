import { describe, expect, it } from 'vitest'
import { DEFAULT_NEWS_RECENCY, NEWS_RECENCY_WINDOWS, getNewsRecencyWindow, isWithinRecency } from './newsRecency'

const NOW = Date.parse('2026-09-21T12:00:00.000Z')
const hoursAgo = (h: number) => new Date(NOW - h * 3600_000).toISOString()

describe('isWithinRecency', () => {
  it('includes an item just inside each window and excludes one just outside', () => {
    for (const [id, hours] of [['24h', 24], ['3d', 72], ['7d', 168], ['14d', 336]] as const) {
      expect(isWithinRecency(hoursAgo(hours - 1), id, NOW)).toBe(true)
      expect(isWithinRecency(hoursAgo(hours + 1), id, NOW)).toBe(false)
    }
  })

  it('includes an item exactly on the boundary', () => {
    expect(isWithinRecency(hoursAgo(24), '24h', NOW)).toBe(true)
  })

  it('windows are nested: anything in a narrower window is in every wider one', () => {
    const item = hoursAgo(30)
    expect(NEWS_RECENCY_WINDOWS.map((w) => isWithinRecency(item, w.id, NOW))).toEqual([false, true, true, true])
  })

  it('treats a slightly-future date (feed clock skew) as within the window', () => {
    expect(isWithinRecency(hoursAgo(-2), '24h', NOW)).toBe(true)
  })

  it('never includes an unparseable date', () => {
    expect(isWithinRecency('not a date', '14d', NOW)).toBe(false)
  })
})

describe('windows', () => {
  it('are ordered narrowest to widest and the default is the widest (the feed retains 14 days)', () => {
    const ms = NEWS_RECENCY_WINDOWS.map((w) => w.ms)
    expect(ms).toEqual([...ms].sort((a, b) => a - b))
    expect(getNewsRecencyWindow(DEFAULT_NEWS_RECENCY).ms).toBe(14 * 24 * 3600_000)
  })
})
