import { useSyncExternalStore } from 'react'
import { feature } from 'topojson-client'
import type { Topology, GeometryCollection } from 'topojson-specification'
import type { Feature } from 'geojson'

// Pre-built by scripts/buildLakesTopology.mjs (`npm run build:geo:lakes`):
// major lakes from Natural Earth's 1:50m Physical Vectors "Lakes" layer
// (see scripts/vendor/README.md for provenance).
//
// Unlike useStatesProvincesFeatures.ts, this hook does NOT call
// registerEntity/registerGeometryMapping — lakes are physical geography,
// not political entities, so there's no GeoEntity record to create and
// nothing for EntityResolver/GeometryMap to ever need to resolve. This
// layer is rendered decoratively only (see scene/Lakes.tsx and
// GEO_ENGINE_README.md's "Lakes & rivers" section for the reasoning): no
// click-to-select, no intelligence panel. That's what keeps this hook so
// much simpler than the states/provinces one it's otherwise modeled on.
const TOPOLOGY_URL = '/geo/lakes.json'

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
      const object = topology.objects.lakes as GeometryCollection
      features = feature(topology, object).features as Feature[]
      loaded = true
      notify()
    })
    .catch((err) => {
      // Fail quietly, same as every other geo fetch hook in this codebase —
      // this layer just doesn't render if the geo asset can't be fetched.
      console.warn('Lakes geometry unavailable:', err)
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

export function useLakesFeatures(): Feature[] {
  ensureFetch()
  return useSyncExternalStore(subscribe, getFeaturesSnapshot)
}

export function useLakesFeaturesLoaded(): boolean {
  ensureFetch()
  return useSyncExternalStore(subscribe, getLoadedSnapshot)
}
