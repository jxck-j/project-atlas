import { useSyncExternalStore } from 'react'
import type { Feature, Geometry } from 'geojson'
import { useSelection } from '../hud/selectionStore'

// Canadian counterpart to useUsCityOutline.ts — fetches ONE province's shard
// of city boundaries (public/geo/canada-cities/{ab}.json), on demand, only
// once a city in that province is actually searched for. Same caching/
// dedup/stable-snapshot shape as the US version; see that file's own
// comments for why each piece is built the way it is (deliberately a
// parallel implementation, not yet a shared generic — see
// useCanadaCitiesIndex.ts's header comment).
const shardCache = new Map<string, Feature[]>()
const inFlight = new Map<string, Promise<void>>()
const listeners = new Set<() => void>()

function notify() {
  listeners.forEach((l) => l())
}

function ensureShardFetch(provinceAbbrev: string) {
  const key = provinceAbbrev.toLowerCase()
  if (shardCache.has(key) || inFlight.has(key)) return

  const promise = fetch(`/geo/canada-cities/${key}.json`)
    .then((res) => {
      if (!res.ok) throw new Error(`Failed to load canada-cities/${key}.json: ${res.status}`)
      return res.json()
    })
    .then((collection: { features: Feature[] }) => {
      shardCache.set(key, collection.features)
      notify()
    })
    .catch((err) => {
      console.warn(`Canada city outline data unavailable for province "${provinceAbbrev}":`, err)
    })
    .finally(() => {
      inFlight.delete(key)
    })

  inFlight.set(key, promise)
}

function subscribe(listener: () => void) {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

let lastKey: string | null = null
let lastResult: { name: string; geometry: Geometry } | null = null

function getSnapshot(caCityOutline: { id: string; provinceAbbrev: string; name: string } | null) {
  if (!caCityOutline) {
    lastKey = null
    lastResult = null
    return lastResult
  }

  const provinceKey = caCityOutline.provinceAbbrev.toLowerCase()
  const hasShard = shardCache.has(provinceKey)
  const key = `${provinceKey}:${caCityOutline.id}:${hasShard}`
  if (key === lastKey) return lastResult

  lastKey = key
  const match = hasShard ? shardCache.get(provinceKey)!.find((f) => f.id === caCityOutline.id) : undefined
  lastResult = match ? { name: caCityOutline.name, geometry: match.geometry } : null
  return lastResult
}

/** The currently-active Canadian city outline's geometry, or null if none is set or its shard hasn't loaded yet. */
export function useCanadaCityOutlineGeometry(): { name: string; geometry: Geometry } | null {
  const { caCityOutline } = useSelection()

  if (caCityOutline) ensureShardFetch(caCityOutline.provinceAbbrev)

  return useSyncExternalStore(subscribe, () => getSnapshot(caCityOutline))
}
