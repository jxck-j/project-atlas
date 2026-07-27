import { useSyncExternalStore } from 'react'
import type { Feature, Geometry } from 'geojson'
import { useSelection } from '../hud/selectionStore'

// Fetches ONE state's shard of city boundaries (public/geo/us-cities/{ab}.json
// — see scripts/buildUsCitiesData.mjs), on demand, only once a city in that
// state is actually searched for. Cached per state so re-searching a
// different city in the same state doesn't re-fetch. Deliberately not a
// singleton "fetch everything up front" store like every other useXFeatures
// hook in this directory — the whole point of sharding by state was to
// avoid ever pulling in all 32,608 boundaries at once.
const shardCache = new Map<string, Feature[]>()
const inFlight = new Map<string, Promise<void>>()
const listeners = new Set<() => void>()

function notify() {
  listeners.forEach((l) => l())
}

function ensureShardFetch(stateAbbrev: string) {
  const key = stateAbbrev.toLowerCase()
  if (shardCache.has(key) || inFlight.has(key)) return

  const promise = fetch(`/geo/us-cities/${key}.json`)
    .then((res) => {
      if (!res.ok) throw new Error(`Failed to load us-cities/${key}.json: ${res.status}`)
      return res.json()
    })
    .then((collection: { features: Feature[] }) => {
      shardCache.set(key, collection.features)
      notify()
    })
    .catch((err) => {
      console.warn(`US city outline data unavailable for state "${stateAbbrev}":`, err)
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

// useSyncExternalStore requires getSnapshot to return a STABLE reference
// when nothing has actually changed — building a fresh `{ name, geometry }`
// object literal on every call (as an earlier version of this hook did)
// makes React see a "new" snapshot on every single render, which
// retriggers a render, which calls getSnapshot again, forever. Cache the
// resolved result and only recompute when the composite key (which city,
// and whether its shard has finished loading) actually changes.
let lastKey: string | null = null
let lastResult: { name: string; geometry: Geometry } | null = null

function getSnapshot(usCityOutline: { id: string; stateAbbrev: string; name: string } | null) {
  if (!usCityOutline) {
    lastKey = null
    lastResult = null
    return lastResult
  }

  const stateKey = usCityOutline.stateAbbrev.toLowerCase()
  const hasShard = shardCache.has(stateKey)
  const key = `${stateKey}:${usCityOutline.id}:${hasShard}`
  if (key === lastKey) return lastResult

  lastKey = key
  const match = hasShard ? shardCache.get(stateKey)!.find((f) => f.id === usCityOutline.id) : undefined
  lastResult = match ? { name: usCityOutline.name, geometry: match.geometry } : null
  return lastResult
}

/** The currently-active US city outline's geometry, or null if none is set or its shard hasn't loaded yet. */
export function useUsCityOutlineGeometry(): { name: string; geometry: Geometry } | null {
  const { usCityOutline } = useSelection()

  if (usCityOutline) ensureShardFetch(usCityOutline.stateAbbrev)

  return useSyncExternalStore(subscribe, () => getSnapshot(usCityOutline))
}
