import { describe, expect, it } from 'vitest'
import { isLodLevelActive, LOD_LEVELS, resolveActiveLevels, resolveDeepestLevel } from './lodLevels'

// These tests exercise the REAL LOD_LEVELS data (not a mock ladder) against
// its own documented threshold values (4.8/4.0/3.4/2.9/2.52 — see
// lodLevels.ts's comment for why each was tuned where it is, including the
// 2026-08-27 retune that moved every city-tier number except
// every-incorporated-city's), so a future change to those numbers is a
// deliberate, visible diff to these expectations rather than a silent
// behavior change. Expected values below are derived directly from
// LOD_LEVELS' own definitions, not guessed.

const ALWAYS_ON = ['earth', 'countries', 'states', 'lakes', 'rivers']

describe('resolveActiveLevels', () => {
  it('returns only the always-on levels when zoomed all the way out', () => {
    const ids = resolveActiveLevels(10).map((l) => l.id)
    expect(ids).toEqual(ALWAYS_ON)
  })

  it('unlocks metro-areas exactly at its 4.8 threshold, not before', () => {
    expect(resolveActiveLevels(4.81).map((l) => l.id)).toEqual(ALWAYS_ON)
    expect(resolveActiveLevels(4.8).map((l) => l.id)).toEqual([...ALWAYS_ON, 'metro-areas'])
  })

  it('is cumulative — reaching a deeper tier keeps every shallower one active', () => {
    // 3.4 clears metro-areas (4.8), large-cities (4.0), and medium-cities
    // (3.4) itself, but not small-cities (2.9) or every-incorporated-city
    // (2.52), since distance <= revealDistance is false for those two.
    const ids = resolveActiveLevels(3.4).map((l) => l.id)
    expect(ids).toEqual([...ALWAYS_ON, 'metro-areas', 'large-cities', 'medium-cities'])
  })

  it('activates every implemented tier at the closest zoom (2.52)', () => {
    const ids = resolveActiveLevels(2.52).map((l) => l.id)
    expect(ids).toEqual([
      ...ALWAYS_ON,
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

  it('is always false for a reserved (implemented: false) level', () => {
    expect(isLodLevelActive('roads', 0)).toBe(false)
    expect(isLodLevelActive('roads', 2.52)).toBe(false)
  })
})
