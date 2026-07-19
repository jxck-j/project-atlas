import { useSyncExternalStore } from 'react'
import { feature } from 'topojson-client'
import type { Topology, GeometryCollection } from 'topojson-specification'
import type { Feature } from 'geojson'

// Pre-built by scripts/buildCountryTopology.mjs (`npm run build:geo`): the
// 193 UN member states only, simplified from world-atlas's 10m dataset.
// See that script for why — the filtering/renaming to the UN member set and
// the coastline simplification are both baked in ahead of time rather than
// done here on every page load.
const TOPOLOGY_URL = '/geo/countries-un193.json'

// Singleton store: several HUD/scene components (Countries, SearchBar,
// CommandBar) all need the same country list, and topojson's feature()
// conversion isn't free — fetch and convert once, share the result, rather
// than each consumer independently fetching and re-converting.
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
      const object = topology.objects.countries as GeometryCollection
      // feature()'s own typings default Properties to {} (from
      // topojson-specification, not geojson's GeoJsonProperties) — recast
      // to the geojson Feature type the rest of the app already uses.
      features = feature(topology, object).features as Feature[]
      loaded = true
      notify()
    })
    .catch((err) => {
      // Fail quietly — the globe still works (graticule + nodes) if the
      // geo asset can't be fetched, it just renders without borders.
      console.warn('Country border data unavailable:', err)
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

export function useCountryFeatures(): Feature[] {
  ensureFetch()
  return useSyncExternalStore(subscribe, getFeaturesSnapshot)
}

export function useCountryFeaturesLoaded(): boolean {
  ensureFetch()
  return useSyncExternalStore(subscribe, getLoadedSnapshot)
}
