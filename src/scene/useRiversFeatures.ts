import { useSyncExternalStore } from 'react'
import { feature } from 'topojson-client'
import type { Topology, GeometryCollection } from 'topojson-specification'
import type { Feature } from 'geojson'

// Pre-built by scripts/buildRiversTopology.mjs (`npm run build:geo:rivers`):
// major rivers (scalerank <= 3) from Natural Earth's 1:50m Physical Vectors
// "Rivers + lake centerlines" layer (see scripts/vendor/README.md for
// provenance and the coverage caveat).
//
// Same "no registry, decorative only" reasoning as useLakesFeatures.ts —
// see that file's header comment.
const TOPOLOGY_URL = '/geo/rivers.json'

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
      const object = topology.objects.rivers as GeometryCollection
      features = feature(topology, object).features as Feature[]
      loaded = true
      notify()
    })
    .catch((err) => {
      console.warn('Rivers geometry unavailable:', err)
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

export function useRiversFeatures(): Feature[] {
  ensureFetch()
  return useSyncExternalStore(subscribe, getFeaturesSnapshot)
}

export function useRiversFeaturesLoaded(): boolean {
  ensureFetch()
  return useSyncExternalStore(subscribe, getLoadedSnapshot)
}
