import { useEffect, useState } from 'react'
import type { Feature } from 'geojson'
import { buildGeoEntityEntries, type GeoEntityEntry } from './geoEntityEntries'

// How many raw features' worth of earcut triangulation to run per chunk.
// Chosen so each chunk costs roughly 100-150ms (measured: ~1.3-1.7s for
// all 4,539 states/provinces features, ~0.3-0.4ms/feature) — short enough
// that the page stays responsive between chunks, long enough that this
// doesn't need dozens of scheduling round-trips to finish.
const CHUNK_SIZE = 400

// requestIdleCallback isn't available in Safari — a plain setTimeout
// fallback still yields to the event loop between chunks, which is the
// property that actually matters here (the browser gets to paint/handle
// input between chunks), even without idle-time scheduling's "only run
// when otherwise idle" refinement.
const scheduleChunk: (callback: () => void) => void =
  typeof requestIdleCallback === 'function'
    ? (callback) => requestIdleCallback(callback, { timeout: 100 })
    : (callback) => setTimeout(callback, 0)

// Builds GeoEntityEntry[] from raw features across multiple event-loop
// turns instead of all at once. Exists specifically because
// buildGeoEntityEntries's earcut triangulation, run synchronously for all
// 4,539 states/provinces features, blocked the main thread for 1.3-1.7
// SECONDS every time this layer mounted — measured directly, not guessed
// (see LOGBOOK.md's "States/provinces FPS" part 8). Chunking trades that
// single frozen moment for a progressive reveal: provinces populate over
// roughly the same total wall-clock time (a few hundred ms per chunk), but
// the page stays responsive between chunks, and every downstream consumer
// (useFrontFacingEntries, ProvinceFillLayer, StateProvinceLabels) already
// treats its `entities` input as just an array that's fine to grow.
// StatesProvinces.tsx's <BoundaryMesh> is unaffected — it's built
// separately (useStatesProvincesFeatures.ts's own mesh() call, not this
// function) and already shows the full boundary immediately, so borders
// appear before fills catch up during that reveal window.
export function useChunkedGeoEntityEntries(features: Feature[]): GeoEntityEntry[] {
  const [entities, setEntities] = useState<GeoEntityEntry[]>([])

  useEffect(() => {
    if (features.length === 0) {
      setEntities([])
      return
    }

    setEntities([])
    let cancelled = false
    let offset = 0

    function processNextChunk() {
      if (cancelled) return
      const slice = features.slice(offset, offset + CHUNK_SIZE)
      offset += CHUNK_SIZE

      const built = buildGeoEntityEntries(slice)
      setEntities((current) => [...current, ...built])

      if (offset < features.length) {
        scheduleChunk(processNextChunk)
      }
    }

    scheduleChunk(processNextChunk)

    return () => {
      cancelled = true
    }
  }, [features])

  return entities
}
