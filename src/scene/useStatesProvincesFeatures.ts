import { useSyncExternalStore } from 'react'
import { feature, mesh } from 'topojson-client'
import type { Topology, GeometryCollection } from 'topojson-specification'
import type { Feature, MultiLineString } from 'geojson'
import { registerGeometryMapping } from '../entities/GeometryMap'
import { registerEntity } from '../data'

// Pre-built by scripts/buildStatesProvincesTopology.mjs
// (`npm run build:geo:states`): first-level administrative divisions for
// nearly every country (Natural Earth's 1:10m admin-1 layer, upgraded
// 2026-08-15 from the 1:50m layer's 9-large-country pilot — see that
// script and scripts/vendor/README.md for coverage detail).
//
// Unlike useGeoEntityFeatures.ts (which only maps geometry ids onto
// already-registered GeoEntity records from the hand-authored
// data/registry/geoEntities.ts dataset), there is no hand-curated dataset
// of administrative divisions — thousands of provinces don't warrant the
// kind of per-entity diplomatic-relationship research geoEntities.ts's 56
// records got. So this hook *creates* each GeoEntity record from the
// fetched geometry's own properties, the same way useCountryFeatures.ts
// creates Country records from fetched geometry rather than a hand-authored
// list.
const TOPOLOGY_URL = '/geo/states-provinces.json'

let features: Feature[] = []
// v6.2.5: the deduplicated boundary line — every arc the province object
// touches (interior admin-1 boundaries AND coastline), each walked exactly
// once, via topojson-client's mesh(). Exists specifically because rendering
// borders from `features`' own per-province rings draws every interior
// boundary TWICE — once as part of each of the two provinces sharing it —
// and (back when both were dashed, see LOGBOOK.md's v6.2.5 entry) each
// copy computed its own independent dash phase, which reliably looked
// solid wherever the two phases happened to mostly cover each other's gaps
// (reported directly for the Pará/Mato Grosso border, but not specific to
// that pair). scene/StatesProvinces.tsx switched this line from dashed to
// solid on 2026-08-16, which retires that specific artifact, but mesh()
// still earns its keep: two overlapping semi-transparent solid lines at a
// shared edge would still visibly double that edge's opacity without it.
// mesh() is the standard, correct way to draw polygon boundaries without
// this duplication: each arc in the topology is walked exactly once
// regardless of how many polygons reference it.
let boundary: MultiLineString | null = null
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
      const object = topology.objects.provinces as GeometryCollection
      features = feature(topology, object).features as Feature[]
      boundary = mesh(topology, object)

      for (const f of features) {
        // Every feature was stamped with its own registry id as `feature.id`
        // at build time (its lowercased ISO 3166-2 code) — geometryId and
        // entityId are always the same string here, the same "no numeric id
        // in the source" case buildEntityTopology.mjs's 11 id-less entities
        // already establish the pattern for.
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
            type: 'administrative-division',
            parentEntity,
            // An administrative division's parent country is always its
            // sole administrator too — there's no split-control or disputed
            // case in this dataset the way Western Sahara's does.
            administeredBy: parentEntity ? [parentEntity] : [],
            claimedBy: [],
            claims: [],
            provenance: {
              source: "Natural Earth 1:10m Admin-1 States/Provinces (vendored — see scripts/vendor/README.md)",
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
      // Fail quietly, same as useCountryFeatures.ts/useGeoEntityFeatures.ts —
      // this layer just doesn't render if the geo asset can't be fetched.
      console.warn('States/provinces geometry unavailable:', err)
    })
}

function subscribe(listener: () => void) {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

function getFeaturesSnapshot() {
  return features
}

function getBoundarySnapshot() {
  return boundary
}

function getLoadedSnapshot() {
  return loaded
}

export function useStatesProvincesFeatures(): Feature[] {
  ensureFetch()
  return useSyncExternalStore(subscribe, getFeaturesSnapshot)
}

export function useStatesProvincesBoundary(): MultiLineString | null {
  ensureFetch()
  return useSyncExternalStore(subscribe, getBoundarySnapshot)
}

export function useStatesProvincesFeaturesLoaded(): boolean {
  ensureFetch()
  return useSyncExternalStore(subscribe, getLoadedSnapshot)
}
