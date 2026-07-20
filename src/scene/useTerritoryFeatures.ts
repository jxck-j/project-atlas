import { useSyncExternalStore } from 'react'
import { feature } from 'topojson-client'
import type { Topology, GeometryCollection } from 'topojson-specification'
import type { Feature } from 'geojson'
import { registerGeometryMapping } from '../entities/GeometryMap'
import { TERRITORY_GEOMETRY_IDS } from '../entities/territoryGeometryIds'

// Pre-built by scripts/buildTerritoryTopology.mjs (`npm run
// build:geo:territories`): the subset of registered territories
// (data/registry/territories.ts) that have a real, standalone polygon in
// the source data — see TERRITORY_GEOMETRY_IDS for which ones and why not
// all of them. Mirrors useCountryFeatures.ts's shape (singleton fetch,
// shared across consumers) — see that file for the reasoning, it applies
// unchanged here, just for a much smaller dataset.
const TOPOLOGY_URL = '/geo/territories.json'

let features: Feature[] = []
let loaded = false
let fetchStarted = false
const listeners = new Set<() => void>()

function notify() {
  listeners.forEach((l) => l())
}

function ensureFetch() {
  if (fetchStarted) return
  fetchStarted = true

  fetch(TOPOLOGY_URL)
    .then((res) => {
      if (!res.ok) throw new Error(`Failed to load ${TOPOLOGY_URL}: ${res.status}`)
      return res.json()
    })
    .then((topology: Topology) => {
      const object = topology.objects.territories as GeometryCollection
      features = feature(topology, object).features as Feature[]

      // Populate GeometryMap so a click on one of these shapes resolves to
      // the right territory — the same "geometry id -> entity id" chain
      // Countries.tsx's polygons have used since v2.2.1, now actually
      // exercised for the first time (every id here comes straight out of
      // TERRITORY_GEOMETRY_IDS, so the entity id is never unknown/missing
      // the way a fallback would need to handle).
      for (const f of features) {
        const geometryId = f.id !== undefined && f.id !== null ? String(f.id) : undefined
        const entityId = geometryId ? TERRITORY_GEOMETRY_IDS[geometryId] : undefined
        if (!geometryId || !entityId) continue
        try {
          registerGeometryMapping(geometryId, entityId)
        } catch {
          // Already registered — harmless (Vite HMR re-running this
          // module's top-level code in dev after an edit elsewhere).
        }
      }

      loaded = true
      notify()
    })
    .catch((err) => {
      // Fail quietly, same as useCountryFeatures.ts — territories just
      // don't render if the geo asset can't be fetched.
      console.warn('Territory geometry unavailable:', err)
    })
}

function subscribe(listener: () => void) {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

function getFeaturesSnapshot() {
  return features
}

function getLoadedSnapshot() {
  return loaded
}

export function useTerritoryFeatures(): Feature[] {
  ensureFetch()
  return useSyncExternalStore(subscribe, getFeaturesSnapshot)
}

export function useTerritoryFeaturesLoaded(): boolean {
  ensureFetch()
  return useSyncExternalStore(subscribe, getLoadedSnapshot)
}
