import { useSyncExternalStore } from 'react'
import { feature } from 'topojson-client'
import type { Topology, GeometryCollection } from 'topojson-specification'
import type { Feature } from 'geojson'
import { registerGeometryMapping } from '../entities/GeometryMap'
import { ENTITY_GEOMETRY_IDS } from '../entities/entityGeometryIds'

// Pre-built by scripts/buildEntityTopology.mjs (`npm run build:geo:entities`):
// every GeoEntity (data/registry/geoEntities.ts) that has a real, standalone
// polygon in the source data — see entityGeometryIds.ts for which ones and
// why not all of them (Crimea has none, at any resolution). Mirrors
// useCountryFeatures.ts's shape (singleton fetch, shared across consumers)
// — see that file for the reasoning, it applies unchanged here.
//
// Replaces the pre-v3 useTerritoryFeatures.ts.
const TOPOLOGY_URL = '/geo/entities.json'

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
      const object = topology.objects.entities as GeometryCollection
      features = feature(topology, object).features as Feature[]

      // Populate GeometryMap so a click on one of these shapes resolves to
      // the right GeoEntity — the same "geometry id -> entity id" chain
      // Countries.tsx's polygons have used since v2.2.1. Numeric-ISO-id
      // features need the ENTITY_GEOMETRY_IDS lookup; features that started
      // out with no numeric id in the source were stamped with their target
      // entity id directly at build time (see entityGeometryIds.ts /
      // buildEntityTopology.mjs), so `String(f.id)` for those IS already the
      // entity id — the `?? geometryId` fallback below covers them without
      // this file needing to know which features were which.
      for (const f of features) {
        const geometryId = f.id !== undefined && f.id !== null ? String(f.id) : undefined
        if (!geometryId) continue
        const entityId = ENTITY_GEOMETRY_IDS[geometryId] ?? geometryId
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
      // Fail quietly, same as useCountryFeatures.ts — entities just don't
      // render if the geo asset can't be fetched.
      console.warn('Entity geometry unavailable:', err)
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

export function useGeoEntityFeatures(): Feature[] {
  ensureFetch()
  return useSyncExternalStore(subscribe, getFeaturesSnapshot)
}

export function useGeoEntityFeaturesLoaded(): boolean {
  ensureFetch()
  return useSyncExternalStore(subscribe, getLoadedSnapshot)
}
