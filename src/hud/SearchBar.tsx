import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react'
import { Vector3 } from 'three'
import { useCountryFeatures } from '../scene/useCountryFeatures'
import { useGeoEntityFeatures } from '../scene/useGeoEntityFeatures'
import { useStatesProvincesFeatures } from '../scene/useStatesProvincesFeatures'
import { useCitiesFeatures } from '../scene/useCitiesFeatures'
import { useCityIndex } from '../scene/useCityIndex'
import { geometryToCentroid } from '../scene/countryGeometry'
import { angularDistance, latLngToVector3 } from '../utils/geo'
import { GLOBE_RADIUS } from '../scene/constants'
import { getGlobeRotationY } from '../scene/globeRotation'
import { flyToSelectedCountry, flyToCity, selectEntity } from './selectionStore'
import { useHudPanel } from './hudPanelStore'
import { getEntities, getEntity } from '../data'
import type { GeoEntityType } from '../data'
import { resolveEntity } from '../entities/EntityResolver'
import { ENTITY_GEOMETRY_IDS } from '../entities/entityGeometryIds'
import { Icon } from './icons'
import { ICONS } from './iconPaths'

const UP_AXIS = new Vector3(0, 1, 0)
const MAX_RESULTS = 8

// A handful of cities.json's "major world city" entries (Washington D.C.,
// New York, Chicago, Amman, Kuwait City, ...) name the exact same real-world
// place as one specific record in the much larger city-boundary index —
// e.g. cities.json's "Washington,  D.C." and the US index's single place,
// "Washington", ~0.5km apart. Both datasets still need to exist for their
// own render paths (Cities.tsx's always-on capital marker vs
// CityLabels.tsx's population-scored zoom labels/outline highlight — see
// CLAUDE.md), but search should only ever surface one result for a place a
// user would type once. ~50km (0.5deg at the equator, as radians) is
// generous enough to cover the centroid-vs-downtown-point gap between the
// two datasets' coordinates for the same city, while still being far
// smaller than the distance between two different places that happen to
// share a name (e.g. Boston, MA vs Boston, GA).
const SAME_PLACE_RADIUS_RAD = (0.5 * Math.PI) / 180

// Strips a trailing ", ST"/", Country" qualifier so "Washington,  D.C."
// and "Washington" compare equal — cities.json sometimes bakes a
// disambiguator into `name` itself (see its own "Washington,  D.C." double
// space) where the us-cities index instead carries it as a separate
// `stateAbbrev` field.
function baseCityName(name: string): string {
  return name.split(',')[0].trim().toLowerCase()
}

// Every kind of entity search currently knows how to return, normalized to
// one flat shape so matching/ranking/rendering don't need to branch on
// where an entry came from. Adding a future registry (e.g. Conflict) means
// one more block like `geoEntityEntries` below plus one more `kind` union
// member — see CLAUDE.md for the full walkthrough.
//
// 'city-boundary' is deliberately NOT a GeoEntityType — these city
// boundaries have no GeoEntityRegistry entry at all (see
// scene/CityOutlineHighlight.tsx), so `selectEntry()` below branches on
// this kind specifically to fly the camera there via flyToCity()
// instead of resolveEntity()/selectEntity(), which would have nothing to
// resolve. Covers exactly the three countries useCityIndex.ts's index
// covers today (Jordan, Kuwait, US) — see city-boundaries-architecture.md.
interface SearchEntry {
  id: string
  // "City, ST" for a US 'city-boundary' entry (e.g. "Austin, TX") — many
  // US cities share a name across different states (there are 7 different
  // "Austin"s in this dataset alone), so the state qualifier is baked
  // directly into `name` rather than shown separately, the same way a
  // human would disambiguate them in conversation. Jordan/Kuwait entries
  // have no such qualifier — their names are already unambiguous.
  name: string
  kind: 'country' | GeoEntityType | 'city-boundary'
  lat: number
  lng: number
  // Only meaningful for 'city-boundary' — which country's boundary file
  // (public/geo/city-boundaries/{countryId}.json) this city's outline
  // lives in. See useCityOutline.ts.
  countryId?: string
  // Only meaningful for a US 'city-boundary' entry — which state shard
  // (public/geo/city-boundaries/840/{stateAbbrev}.json) to fetch for this
  // city's on-demand outline. See useCityOutline.ts.
  stateAbbrev?: string
}

const ENTITY_TYPE_LABEL: Record<SearchEntry['kind'], string> = {
  country: 'COUNTRY',
  'geopolitical-entity': 'GEOPOLITICAL',
  territory: 'TERRITORY',
  'strategic-region': 'STRATEGIC',
  'maritime-feature': 'MARITIME',
  'geographic-region': 'REGION',
  'administrative-division': 'ADMIN DIVISION',
  city: 'CITY',
  'city-boundary': 'CITY BOUNDARY',
}

export function SearchBar() {
  const isOpen = useHudPanel() === 'search'
  const features = useCountryFeatures()
  const geoFeatures = useGeoEntityFeatures()
  const provinceFeatures = useStatesProvincesFeatures()
  const cityFeatures = useCitiesFeatures()
  const cityIndex = useCityIndex()
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

  // Cities: same "geometry id already equals entity id" shortcut as
  // provinceEntries, but reading lat/lng straight off Point coordinates —
  // geometryToCentroid assumes Polygon/MultiPolygon and would silently
  // return {lat:0,lng:0} for a Point, so it's deliberately not reused here.
  //
  // Skips any entry that's really the same place as one already in
  // cityIndex (see SAME_PLACE_RADIUS_RAD above) — keeping the
  // city-boundary entry instead of this one. cities.json's world-city
  // dataset has no state qualifier at all, so e.g. Atlanta/GA and
  // Washington/D.C. would otherwise show up as bare "Atlanta"/"Washington,
  // D.C." here, indistinguishable from same-named places in other states;
  // and selecting this entry flies the camera there with no boundary
  // outline (see CityOutlineHighlight.tsx), which read as a worse,
  // silently-broken result for the exact same query a city-boundary search
  // already answers properly.
  const cityEntries = useMemo<SearchEntry[]>(() => {
    return cityFeatures.flatMap((f) => {
      const id = f.id !== undefined && f.id !== null ? String(f.id) : undefined
      if (!id || f.geometry.type !== 'Point') return []
      const [lng, lat] = f.geometry.coordinates
      const registryEntity = getEntity(id)
      const name = registryEntity?.name ?? (f.properties?.name as string) ?? 'Unknown'
      const entryName = baseCityName(name)
      const duplicatesIndexedCity = cityIndex.some(
        (c) => baseCityName(c.name) === entryName && angularDistance({ lat, lng }, c) < SAME_PLACE_RADIUS_RAD
      )
      if (duplicatesIndexedCity) return []
      return [
        {
          id,
          name,
          kind: registryEntity?.type ?? ('city' as const),
          lat,
          lng,
        },
      ]
    })
  }, [cityFeatures, cityIndex])

  // City boundaries (Jordan, Kuwait, US): not a GeoEntityRegistry lookup at
  // all — the index entry itself already has everything a search result
  // needs (id/name/lat/lng/countryId). See the 'city-boundary' kind's doc
  // comment above. Always included, unfiltered — cityEntries above is the
  // one that skips a duplicate, so this list doesn't need to know
  // cityEntries exists. Only US entries get a state-qualified name — Jordan/
  // Kuwait names are already unambiguous within their own country.
  const cityBoundaryEntries = useMemo<SearchEntry[]>(() => {
    return cityIndex.map((entry) => ({
      id: entry.id,
      name: entry.stateAbbrev ? `${entry.name}, ${entry.stateAbbrev}` : entry.name,
      kind: 'city-boundary' as const,
      lat: entry.lat,
      lng: entry.lng,
      countryId: entry.countryId,
      stateAbbrev: entry.stateAbbrev,
    }))
  }, [cityIndex])

  // GeoEntityRegistry entries with no rendered geometry (currently only
  // Crimea — see entityGeometryIds.ts) fall back to their own `location`
  // field. Skipped entirely if that's also absent: there'd be nowhere to
  // fly the camera to, and search shouldn't return a result it can't select.
  const geoEntityLocationOnlyEntries = useMemo<SearchEntry[]>(() => {
    const geometryBackedIds = new Set([
      ...geoEntityGeometryEntries.map((e) => e.id),
      ...provinceEntries.map((e) => e.id),
      ...cityEntries.map((e) => e.id),
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
  }, [geoEntityGeometryEntries, provinceEntries, cityEntries])

  const entries = useMemo<SearchEntry[]>(
    () => [
      ...countryEntries,
      ...geoEntityGeometryEntries,
      ...provinceEntries,
      ...cityEntries,
      ...geoEntityLocationOnlyEntries,
      ...cityBoundaryEntries,
    ],
    [countryEntries, geoEntityGeometryEntries, provinceEntries, cityEntries, geoEntityLocationOnlyEntries, cityBoundaryEntries],
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

  function selectEntry(entry: SearchEntry) {
    // Same technique as the click handler: project the entity's centroid
    // through the globe's CURRENT rotation to get a live world-space
    // direction, since there's no clicked mesh to read localToWorld() from.
    const local = latLngToVector3(entry.lat, entry.lng, GLOBE_RADIUS)
    const direction = local.applyAxisAngle(UP_AXIS, getGlobeRotationY()).normalize()

    // City boundaries have no GeoEntityRegistry entry to resolve — see this
    // file's 'city-boundary' kind doc comment. Fly there directly, skipping
    // selection entirely, so nothing highlights and the Intelligence Panel
    // doesn't open — just its boundary outline appears
    // (scene/CityOutlineHighlight.tsx).
    if (entry.kind === 'city-boundary' && entry.countryId) {
      flyToCity(direction, { id: entry.id, countryId: entry.countryId, stateAbbrev: entry.stateAbbrev, name: entry.name })
      setQuery('')
      return
    }

    // Resolves through EntityResolver (Country Registry, then Territory
    // Registry) rather than assuming a country the way the old
    // selectCountry() call did — the same resolution path
    // scene/Countries.tsx's click handler uses, so a search-selected
    // territory produces an identical SelectedEntity to a (future)
    // geometry click on one.
    const resolved = resolveEntity(entry.id)
    if (!resolved) return

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
    // Inline in the top bar's utility cluster (see TopNav.tsx) rather than
    // its own fixed-position dropdown — the reference keeps the search
    // field permanently visible there. `useHudPanel() === 'search'` no
    // longer gates rendering, only focus, so the existing "/" shortcut and
    // toolbar toggle still land the caret here.
    <div className="relative w-[150px] md:w-[210px]">
      <div
        className={`flex h-9 items-center gap-2 rounded-full border bg-[rgba(15,23,40,0.9)] px-3.5 transition-colors ${
          isOpen ? 'border-[#3f8bff]' : 'border-[#1c2c4b]'
        }`}
      >
        <span className="shrink-0 text-[#5a729a]">
          <Icon paths={ICONS.search} size={14} />
        </span>
        <form onSubmit={handleSubmit} className="min-w-0 flex-1">
          <input
            ref={inputRef}
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search location..."
            aria-label="Search location"
            className="w-full bg-transparent text-[12.5px] text-[#dce8fb] outline-none placeholder:text-[#51648a]"
          />
        </form>
      </div>

      {matches.length > 0 && (
        <ul className="absolute top-full right-0 z-50 mt-2 max-h-72 w-[260px] overflow-y-auto rounded-lg border border-[#172440] bg-[rgba(7,11,20,0.97)] shadow-[0_10px_34px_rgba(0,0,0,0.55)] backdrop-blur-[12px]">
          {matches.map((entry) => (
            <li key={`${entry.kind}-${entry.id}`}>
              <button
                type="button"
                onClick={() => selectEntry(entry)}
                className="flex w-full items-baseline justify-between gap-2 px-3 py-2 text-left text-[11.5px] text-[#dce8fb] hover:bg-[rgba(63,139,255,0.14)]"
              >
                <span className="truncate">{entry.name}</span>
                <span className="shrink-0 text-[9px] tracking-[0.15em] text-[#6d82a8]">
                  {/* Taiwan reads COUNTRY here — direct request ("Taiwan
                      should be recognized as a country") — even though it's
                      still a GeoEntity architecturally (kind === 'geopolitical-
                      entity'/GEOPOLITICAL for every OTHER entry of that
                      type, e.g. Kosovo/Palestine, which this deliberately
                      does NOT relabel). Scoped by explicit id check, not a
                      kind/type change, so nothing else that branches on
                      entry.kind is affected. */}
                  {entry.id === 'taiwan' ? 'COUNTRY' : ENTITY_TYPE_LABEL[entry.kind]}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
      {notFound && (
        <div className="absolute top-full right-0 z-50 mt-2 w-[260px] rounded-lg border border-[#172440] bg-[rgba(7,11,20,0.97)] px-3 py-2 text-[10px] tracking-[0.1em] text-[#ff4a42] backdrop-blur-[12px]">
          NOT FOUND
        </div>
      )}
    </div>
  )
}
