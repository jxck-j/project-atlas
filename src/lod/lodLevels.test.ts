import { describe, expect, it } from 'vitest'
import { isLodLevelActive, LOD_LEVELS, resolveActiveLevels, resolveDeepestLevel } from './lodLevels'

// These tests exercise the REAL LOD_LEVELS data (not a mock ladder) against
// its own documented threshold values (4.8/4.0/3.4/2.9/2.52 — see
// lodLevels.ts's comment for why each was tuned where it is, including the
// 2026-08-27 retune that moved every city-tier number, and 'states', which
// moved with metro-areas to stay in sync per its own 2026-08-20 design
// intent), so a future change to those numbers is a deliberate, visible diff
// to these expectations rather than a silent behavior change. Expected
// values below are derived directly from LOD_LEVELS' own definitions, not
// guessed.

// resolveActiveLevels filters LOD_LEVELS in its own DECLARATION order, not
// sorted by revealDistance — so whenever 'states' is active it always sits
// right after 'countries' and before 'lakes'/'rivers' in the returned
// array, regardless of how its numeric threshold compares to the city tiers
// declared after it. Don't be tempted to reorder these expected arrays to
// match threshold size; match LOD_LEVELS' declaration order. Kept out of
// ALWAYS_ON and added explicitly at the distances where it's active
// instead, mirroring how metro-areas/large-cities/etc. are already handled.
const ALWAYS_ON = ['earth', 'countries', 'lakes', 'rivers']
const ALWAYS_ON_WITH_STATES = ['earth', 'countries', 'states', 'lakes', 'rivers']

describe('resolveActiveLevels', () => {
  it('returns only the always-on levels when zoomed all the way out', () => {
    const ids = resolveActiveLevels(10).map((l) => l.id)
    expect(ids).toEqual(ALWAYS_ON)
  })

  it('unlocks metro-areas AND states together, exactly at their shared 4.8 threshold, not before', () => {
    expect(resolveActiveLevels(4.81).map((l) => l.id)).toEqual(ALWAYS_ON)
    expect(resolveActiveLevels(4.8).map((l) => l.id)).toEqual([...ALWAYS_ON_WITH_STATES, 'metro-areas'])
  })

  it('is cumulative — reaching a deeper tier keeps every shallower one active', () => {
    // 3.4 clears metro-areas/states (4.8), large-cities (4.0), and
    // medium-cities (3.4) itself, but not small-cities (2.9) or
    // every-incorporated-city (2.52), since distance <= revealDistance is
    // false for those two.
    const ids = resolveActiveLevels(3.4).map((l) => l.id)
    expect(ids).toEqual([...ALWAYS_ON_WITH_STATES, 'metro-areas', 'large-cities', 'medium-cities'])
  })

  it('activates every implemented tier at the closest zoom (2.52)', () => {
    const ids = resolveActiveLevels(2.52).map((l) => l.id)
    expect(ids).toEqual([
      ...ALWAYS_ON_WITH_STATES,
      'metro-areas',
      'large-cities',
      'medium-cities',
      'small-cities',
      'every-incorporated-city',
    ])
  })

  it('never includes a reserved (implemented: false) level, at any distance', () => {
    const reservedIds = LOD_LEVELS.filter((l) => !l.implemented).map((l) => l.id)
    expect(reservedIds).not.toHaveLength(0) // sanity check the fixture itself still has reserved entries

    for (const distance of [10, 4.8, 3.4, 2.52, 0]) {
      const activeIds = resolveActiveLevels(distance).map((l) => l.id)
      for (const reservedId of reservedIds) {
        expect(activeIds).not.toContain(reservedId)
      }
    }
  })
})

describe('resolveDeepestLevel', () => {
  it('is "rivers" (the deepest always-on level) when zoomed all the way out', () => {
    expect(resolveDeepestLevel(10).id).toBe('rivers')
  })

  it('is "medium-cities" at distance 3.4', () => {
    expect(resolveDeepestLevel(3.4).id).toBe('medium-cities')
  })

  it('is "every-incorporated-city" at and below the closest defined threshold', () => {
    // 'states' being active doesn't change this — it's declared earlier in
    // LOD_LEVELS than large-cities/medium-cities/etc., so it's never the
    // LAST active entry regardless of distance; "deepest" here is about
    // declaration-order position, not which threshold is numerically
    // smallest.
    expect(resolveDeepestLevel(2.52).id).toBe('every-incorporated-city')
    // Closer than any defined threshold still resolves to the deepest tier
    // rather than throwing or returning something undefined — there's
    // nothing deeper to fall through to.
    expect(resolveDeepestLevel(2.0).id).toBe('every-incorporated-city')
  })
})

describe('isLodLevelActive', () => {
  it('is always true for an always-on (revealDistance: null) level', () => {
    expect(isLodLevelActive('earth', 0)).toBe(true)
    expect(isLodLevelActive('earth', 1000)).toBe(true)
  })

  it('matches resolveActiveLevels at the metro-areas boundary', () => {
    expect(isLodLevelActive('metro-areas', 4.8)).toBe(true)
    expect(isLodLevelActive('metro-areas', 4.81)).toBe(false)
  })

  it('matches resolveActiveLevels at the states boundary — shared with metro-areas', () => {
    expect(isLodLevelActive('states', 4.8)).toBe(true)
    expect(isLodLevelActive('states', 4.81)).toBe(false)
  })

  it('is always false for a reserved (implemented: false) level', () => {
    expect(isLodLevelActive('roads', 0)).toBe(false)
    expect(isLodLevelActive('roads', 2.52)).toBe(false)
  })
})
