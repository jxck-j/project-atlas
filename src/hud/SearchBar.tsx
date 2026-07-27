import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react'
import { Vector3 } from 'three'
import { useCountryFeatures } from '../scene/useCountryFeatures'
import { useGeoEntityFeatures } from '../scene/useGeoEntityFeatures'
import { useStatesProvincesFeatures } from '../scene/useStatesProvincesFeatures'
import { geometryToCentroid } from '../scene/countryGeometry'
import { latLngToVector3 } from '../utils/geo'
import { GLOBE_RADIUS } from '../scene/constants'
import { getGlobeRotationY } from '../scene/globeRotation'
import { flyToSelectedCountry, selectEntity } from './selectionStore'
import { useHudPanel } from './hudPanelStore'
import { getEntities, getEntity } from '../data'
import type { GeoEntityType } from '../data'
import { resolveEntity } from '../entities/EntityResolver'
import { ENTITY_GEOMETRY_IDS } from '../entities/entityGeometryIds'

const UP_AXIS = new Vector3(0, 1, 0)
const MAX_RESULTS = 8

// Every kind of entity search currently knows how to return, normalized to
// one flat shape so matching/ranking/rendering don't need to branch on
// where an entry came from. Adding a future registry (e.g. Conflict) means
// one more block like `geoEntityEntries` below plus one more `kind` union
// member — see CLAUDE.md for the full walkthrough.
interface SearchEntry {
  id: string
  name: string
  kind: 'country' | GeoEntityType
  lat: number
  lng: number
}

const ENTITY_TYPE_LABEL: Record<SearchEntry['kind'], string> = {
  country: 'COUNTRY',
  'geopolitical-entity': 'GEOPOLITICAL',
  territory: 'TERRITORY',
  'strategic-region': 'STRATEGIC',
  'maritime-feature': 'MARITIME',
  'geographic-region': 'REGION',
  'administrative-division': 'ADMIN DIVISION',
}

export function SearchBar() {
  const isOpen = useHudPanel() === 'search'
  const features = useCountryFeatures()
  const geoFeatures = useGeoEntityFeatures()
  const provinceFeatures = useStatesProvincesFeatures()
  const [query, setQuery] = useState('')
  const inputRef = useRef<HTMLInputElement>(null)

  const countryEntries = useMemo<SearchEntry[]>(() => {
    return features.map((f, index) => {
      const centroid = geometryToCentroid(f.geometry)
      return {
        id: f.id !== undefined && f.id !== null ? String(f.id) : `feature-${index}`,
        name: (f.properties?.name as string) ?? 'Unknown',
        kind: 'country' as const,
        lat: centroid.lat,
        lng: centroid.lng,
      }
    })
  }, [features])

  // Every GeoEntity that has a rendered shape (see
  // entities/entityGeometryIds.ts — the large majority of the v3 dataset)
  // derives its search centroid from that geometry, the same way
  // countryEntries does above — no need to hand-maintain ~54 lat/lng pairs
  // in the registry when the geometry already has an authoritative one.
  const geoEntityGeometryEntries = useMemo<SearchEntry[]>(() => {
    return geoFeatures.flatMap((f) => {
      const geometryId = f.id !== undefined && f.id !== null ? String(f.id) : undefined
      if (!geometryId) return []
      const entityId = ENTITY_GEOMETRY_IDS[geometryId] ?? geometryId
      const registryEntity = getEntity(entityId)
      const centroid = geometryToCentroid(f.geometry)
      return [
        {
          id: entityId,
          name: registryEntity?.name ?? (f.properties?.name as string) ?? 'Unknown',
          kind: registryEntity?.type ?? ('territory' as const),
          lat: centroid.lat,
          lng: centroid.lng,
        },
      ]
    })
  }, [geoFeatures])

  // States/provinces: same "derive the search centroid from the rendered
  // geometry" reasoning as geoEntityGeometryEntries above, but every
  // feature's geometry id already equals its entity id (see
  // useStatesProvincesFeatures.ts) — no ENTITY_GEOMETRY_IDS lookup needed.
  const provinceEntries = useMemo<SearchEntry[]>(() => {
    return provinceFeatures.flatMap((f) => {
      const id = f.id !== undefined && f.id !== null ? String(f.id) : undefined
      if (!id) return []
      const registryEntity = getEntity(id)
      const centroid = geometryToCentroid(f.geometry)
      return [
        {
          id,
          name: registryEntity?.name ?? (f.properties?.name as string) ?? 'Unknown',
          kind: registryEntity?.type ?? ('administrative-division' as const),
          lat: centroid.lat,
          lng: centroid.lng,
        },
      ]
    })
  }, [provinceFeatures])

  // GeoEntityRegistry entries with no rendered geometry (currently only
  // Crimea — see entityGeometryIds.ts) fall back to their own `location`
  // field. Skipped entirely if that's also absent: there'd be nowhere to
  // fly the camera to, and search shouldn't return a result it can't select.
  const geoEntityLocationOnlyEntries = useMemo<SearchEntry[]>(() => {
    const geometryBackedIds = new Set([
      ...geoEntityGeometryEntries.map((e) => e.id),
      ...provinceEntries.map((e) => e.id),
    ])
    return getEntities().flatMap((entity) => {
      if (geometryBackedIds.has(entity.id) || !entity.location) return []
      return [
        {
          id: entity.id,
          name: entity.name,
          kind: entity.type,
          lat: entity.location.lat,
          lng: entity.location.lng,
        },
      ]
    })
  }, [geoEntityGeometryEntries, provinceEntries])

  const entries = useMemo<SearchEntry[]>(
    () => [...countryEntries, ...geoEntityGeometryEntries, ...provinceEntries, ...geoEntityLocationOnlyEntries],
    [countryEntries, geoEntityGeometryEntries, provinceEntries, geoEntityLocationOnlyEntries],
  )

  // Ranked, not just filtered: exact name matches first, then
  // starts-with, then contains — same three-tier ordering the old
  // single-best-match logic used, just computed once (a single pass over
  // `entries`) instead of up to three separate `.find()` scans, and capped
  // to MAX_RESULTS so the dropdown stays short.
  const matches = useMemo<SearchEntry[]>(() => {
    const q = query.trim().toLowerCase()
    if (!q) return []
    const exact: SearchEntry[] = []
    const starts: SearchEntry[] = []
    const includes: SearchEntry[] = []
    for (const entry of entries) {
      const name = entry.name.toLowerCase()
      if (name === q) exact.push(entry)
      else if (name.startsWith(q)) starts.push(entry)
      else if (name.includes(q)) includes.push(entry)
    }
    return [...exact, ...starts, ...includes].slice(0, MAX_RESULTS)
  }, [entries, query])

  const notFound = query.trim().length > 0 && matches.length === 0

  useEffect(() => {
    if (isOpen) inputRef.current?.focus()
  }, [isOpen])

  if (!isOpen) return null

  function selectEntry(entry: SearchEntry) {
    // Resolves through EntityResolver (Country Registry, then Territory
    // Registry) rather than assuming a country the way the old
    // selectCountry() call did — the same resolution path
    // scene/Countries.tsx's click handler uses, so a search-selected
    // territory produces an identical SelectedEntity to a (future)
    // geometry click on one.
    const resolved = resolveEntity(entry.id)
    if (!resolved) return

    // Same technique as the click handler: project the entity's centroid
    // through the globe's CURRENT rotation to get a live world-space
    // direction, since there's no clicked mesh to read localToWorld() from.
    const local = latLngToVector3(entry.lat, entry.lng, GLOBE_RADIUS)
    const direction = local.applyAxisAngle(UP_AXIS, getGlobeRotationY()).normalize()

    selectEntity(resolved, direction)
    flyToSelectedCountry()
    setQuery('')
  }

  function handleSubmit(e: FormEvent) {
    e.preventDefault()
    const top = matches[0]
    if (!top) return
    selectEntry(top)
  }

  return (
    <div className="pointer-events-auto fixed top-24 left-4 md:top-28 md:left-8 z-30 w-40 md:w-48">
      <div className="border border-cyan-400/25 bg-cyan-950/25 backdrop-blur-sm px-4 py-3 font-mono">
        <div className="mb-2 text-amber-400/90 tracking-[0.25em] text-[10px] md:text-xs">SEARCH</div>
        <form onSubmit={handleSubmit}>
          <input
            ref={inputRef}
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="SEARCH..."
            className="w-full border border-cyan-400/25 bg-cyan-950/30 px-2 py-1.5 font-mono text-[11px] tracking-[0.05em] text-cyan-100 placeholder:text-cyan-500/40 outline-none focus:border-cyan-300"
          />
        </form>
        {matches.length > 0 && (
          <ul className="mt-1.5 max-h-56 overflow-y-auto border border-cyan-400/25 bg-cyan-950/40">
            {matches.map((entry) => (
              <li key={`${entry.kind}-${entry.id}`}>
                <button
                  type="button"
                  onClick={() => selectEntry(entry)}
                  className="flex w-full items-baseline justify-between gap-2 px-2 py-1.5 text-left font-mono text-[11px] text-cyan-100 hover:bg-cyan-400/10"
                >
                  <span className="truncate">{entry.name}</span>
                  <span className="shrink-0 text-[9px] tracking-[0.15em] text-cyan-500/60">
                    {ENTITY_TYPE_LABEL[entry.kind]}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
        {notFound && (
          <div className="mt-1.5 text-[10px] tracking-[0.1em] text-red-400/80">NOT FOUND</div>
        )}
      </div>
    </div>
  )
}
