import { describe, expect, it } from 'vitest'
import { isLodLevelActive, LOD_LEVELS, resolveActiveLevels, resolveDeepestLevel } from './lodLevels'

// These tests exercise the REAL LOD_LEVELS data (not a mock ladder) against
// its own documented threshold values (2.85/2.85/2.7/2.6/2.55/2.52 — see
// lodLevels.ts's comment for why each was tuned where it is), so a future
// change to those numbers is a deliberate, visible diff to these
// expectations rather than a silent behavior change. Expected values below
// are derived directly from LOD_LEVELS' own definitions, not guessed.

// resolveActiveLevels filters LOD_LEVELS in its own DECLARATION order, not
// sorted by revealDistance — so whenever 'states' is active it always sits
// right after 'countries' and before 'lakes'/'rivers' in the returned
// array, regardless of how its numeric threshold (2.85) compares to the
// city tiers declared after it. Don't be tempted to reorder these expected
// arrays to match threshold size; match LOD_LEVELS' declaration order.
//
// 'states' moved from revealDistance: null to 5.0 on 2026-08-15, tightened
// to 2.5, eased to 3.5, then dialed to 2.8 — all on 2026-08-17 — then eased
// again to 2.85 on 2026-08-20, matching metro-areas exactly per a direct
// request that states/provinces read at the same zoom level as major
// cities (see lodLevels.ts's own comment). States and metro-areas now share
// one threshold rather than states trailing it by one tier. Kept out of
// ALWAYS_ON and added explicitly at the distances where it's active
// instead, mirroring how metro-areas/large-cities/etc. are already handled.
const ALWAYS_ON = ['earth', 'countries', 'lakes', 'rivers']
const ALWAYS_ON_WITH_STATES = ['earth', 'countries', 'states', 'lakes', 'rivers']

describe('resolveActiveLevels', () => {
  it('returns only the always-on levels when zoomed all the way out', () => {
    const ids = resolveActiveLevels(10).map((l) => l.id)
    expect(ids).toEqual(ALWAYS_ON)
  })

  it('unlocks metro-areas AND states together, exactly at their shared 2.85 threshold, not before', () => {
    expect(resolveActiveLevels(2.86).map((l) => l.id)).toEqual(ALWAYS_ON)
    expect(resolveActiveLevels(2.85).map((l) => l.id)).toEqual([...ALWAYS_ON_WITH_STATES, 'metro-areas'])
  })

  it('is cumulative — reaching a deeper tier keeps every shallower one active', () => {
    // 2.6 clears metro-areas/states (2.85), large-cities (2.7), and
    // medium-cities (2.6) itself, but not small-cities (2.55) or
    // every-incorporated-city (2.52), since distance <= revealDistance is
    // false for those two.
    const ids = resolveActiveLevels(2.6).map((l) => l.id)
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

    for (const distance of [10, 2.85, 2.6, 2.52, 0]) {
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

  it('is "medium-cities" at distance 2.6', () => {
    expect(resolveDeepestLevel(2.6).id).toBe('medium-cities')
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
    expect(isLodLevelActive('metro-areas', 2.85)).toBe(true)
    expect(isLodLevelActive('metro-areas', 2.86)).toBe(false)
  })

  it('matches resolveActiveLevels at the states boundary — now shared with metro-areas', () => {
    expect(isLodLevelActive('states', 2.85)).toBe(true)
    expect(isLodLevelActive('states', 2.86)).toBe(false)
  })

  it('is always false for a reserved (implemented: false) level', () => {
    expect(isLodLevelActive('roads', 0)).toBe(false)
    expect(isLodLevelActive('roads', 2.52)).toBe(false)
  })
})
