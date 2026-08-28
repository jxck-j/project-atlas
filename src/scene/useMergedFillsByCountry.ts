import { useMemo } from 'react'
import { buildMergedProvinceFill, type MergedProvinceFill } from './mergedProvinceFill'
import { groupEntriesByCountry } from './provinceCountryGroups'
import type { GeoEntityEntry } from './geoEntityEntries'

export interface CountryFill {
  merged: MergedProvinceFill
  // The exact entries used to build `merged` — faceToEntryIndex indexes
  // into THIS array, not the full global entries list.
  entries: GeoEntityEntry[]
}

// Builds one merged fill mesh PER COUNTRY, not one for the whole visible
// globe (scene/ProvinceFillLayer.tsx's first attempt, 2026-08-16) and not
// one per province (EntityRenderLayer, before that). Memoized on `entries`
// alone — the FULL, unfiltered list, stable once
// useStatesProvincesFeatures.ts's fetch completes — so this only rebuilds
// when the underlying data changes, never on camera movement.
//
// Why per-country instead of one global merged mesh: confirmed directly
// (console instrumentation, not guessed) that a single mesh covering every
// currently-visible province scales badly with density — Europe had ~2,750
// active provinces / ~227,000 triangles at a normal "looking at Europe"
// zoom vs. Brazil's ~866 / ~84,000 at a comparable zoom on South America,
// and EVERY one of those triangles gets tested on EVERY pointer-move event
// (R3F raycasts on native pointermove, not throttled), since a single
// merged BufferGeometry has no internal spatial acceleration structure —
// Three.js's raycaster does one bounding-sphere check for the whole mesh,
// then a flat linear scan of every triangle if that passes. The
// PER-PROVINCE design this replaced had the opposite problem (too many
// separate objects, each cheap to raycast-reject via its own small
// bounding sphere, but far too many of them to register/reconcile). One
// mesh per country keeps a useful bounding-sphere pre-check (a country-
// sized area, not global) while cutting mesh count by roughly the same
// factor as provinces-per-country (~4,539 provinces / ~235 countries with
// coverage ≈ 19x fewer meshes than one-per-province). See LOGBOOK.md's
// "States/provinces FPS" part 6 for the full profiling story.
export function useMergedFillsByCountry(entries: GeoEntityEntry[]): Map<string, CountryFill> {
  return useMemo(() => {
    const groups = groupEntriesByCountry(entries)
    const result = new Map<string, CountryFill>()
    for (const [countryId, countryEntries] of groups) {
      const merged = buildMergedProvinceFill(countryEntries)
      if (merged) result.set(countryId, { merged, entries: countryEntries })
    }
    return result
  }, [entries])
}
