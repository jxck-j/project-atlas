import { useSyncExternalStore } from 'react'
import type { Feature, FeatureCollection } from 'geojson'
import { registerGeometryMapping } from '../entities/GeometryMap'
import { registerEntity } from '../data'

// Pre-built by scripts/buildCitiesData.mjs (`npm run build:geo:cities`):
// national capitals + major world cities (see that script for the coverage
// caveat). Unlike every other useXFeatures hook in this directory, the
// fetched asset is a plain GeoJSON FeatureCollection, not a TopoJSON
// Topology — point data has no shared arcs to benefit from topology
// encoding, so there's no `feature()` conversion step here.
//
// Creates each GeoEntity record from the fetched feature's own properties,
// same reasoning as useStatesProvincesFeatures.ts: 223 cities don't warrant
// hand-curated treatment the way data/registry/geoEntities.ts's 56 records
// get.
const DATA_URL = '/geo/cities.json'

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

  fetch(DATA_URL)
    .then((res) => {
      if (!res.ok) throw new Error(`Failed to load ${DATA_URL}: ${res.status}`)
      return res.json()
    })
    .then((collection: FeatureCollection) => {
      features = collection.features

      for (const f of features) {
        // Every feature was stamped with its own registry id as `feature.id`
        // at build time (a `${asciiName}-${countryAlpha3}` slug) — geometryId
        // and entityId are always the same string here, same convention
        // useStatesProvincesFeatures.ts already established.
        const geometryId = f.id !== undefined && f.id !== null ? String(f.id) : undefined
        if (!geometryId) continue

        const name = (f.properties?.name as string) ?? 'Unknown'
        const parentCountryId = f.properties?.parentCountryId as string | undefined
        const parentCountryName = f.properties?.parentCountryName as string | undefined
        const parentEntity = parentCountryId
          ? { ref: { type: 'country' as const, id: parentCountryId }, displayName: parentCountryName ?? 'Unknown' }
          : undefined

        try {
          registerEntity({
            id: geometryId,
            name,
            aliases: [],
            type: 'city',
            parentEntity,
            administeredBy: parentEntity ? [parentEntity] : [],
            claimedBy: [],
            claims: [],
            provenance: {
              source: 'Natural Earth 1:50m Populated Places (vendored, partial coverage — see scripts/vendor/README.md)',
              confidence: 'confirmed',
            },
          })
        } catch {
          // Already registered — harmless (Vite HMR re-running this
          // module's top-level code in dev after an edit elsewhere).
        }

        try {
          registerGeometryMapping(geometryId, geometryId)
        } catch {
          // Same HMR reasoning as above.
        }
      }

      loaded = true
      notify()
    })
    .catch((err) => {
      // Fail quietly, same as every other useXFeatures hook — this layer
      // just doesn't render if the geo asset can't be fetched.
      console.warn('City data unavailable:', err)
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

export function useCitiesFeatures(): Feature[] {
  ensureFetch()
  return useSyncExternalStore(subscribe, getFeaturesSnapshot)
}

export function useCitiesFeaturesLoaded(): boolean {
  ensureFetch()
  return useSyncExternalStore(subscribe, getLoadedSnapshot)
}
