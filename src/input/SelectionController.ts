// Owns "what should arrow-key/Tab navigation select next" — the pure
// geographic-direction algorithm, and the hook that feeds it live entity
// data and writes the result back through the existing
// `hud/selectionStore.ts`. Deliberately reuses that store's own
// `selectEntity()` rather than introducing a second notion of "what's
// selected" — mouse clicks, search, and keyboard navigation all end up
// calling the exact same function, so `hud/IntelligencePanel.tsx`,
// `scene/GeoEntities.tsx`'s highlight logic, `hud/CommandBar.tsx`, and
// every `geoOverlays` layer stay correct automatically; this file has no
// rendering or highlighting logic of its own to keep in sync with any of
// them.
import { useMemo } from 'react'
import { Vector3 } from 'three'
import { useCountryFeatures } from '../scene/useCountryFeatures'
import { useGeoEntityFeatures } from '../scene/useGeoEntityFeatures'
import { useStatesProvincesFeatures } from '../scene/useStatesProvincesFeatures'
import { geometryToCentroid } from '../scene/countryGeometry'
import { GLOBE_RADIUS } from '../scene/constants'
import { getGlobeRotationY } from '../scene/globeRotation'
import { angularDistance, bearingBetween, latLngToVector3, normalizeAngle } from '../utils/geo'
import { resolveEntity } from '../entities/EntityResolver'
import { ENTITY_GEOMETRY_IDS } from '../entities/entityGeometryIds'
import { selectEntity, useSelection } from '../hud/selectionStore'
import { useLayerEnabledMap } from '../layers'
import { getEntity } from '../data'
import type { GeoEntity, GeoEntityType } from '../data'
import type { NavigationDirection } from './types'

const UP_AXIS = new Vector3(0, 1, 0)

// Same reasoning as scene/GeoEntities.tsx: anything more than 90° off the
// requested bearing reads as "not really in that direction" (it'd be
// backward, or purely sideways) — a half-cone of ±90° is the natural
// boundary, not a tuned magic number.
const DIRECTION_CONE_HALF_ANGLE = Math.PI / 2

const DIRECTION_BEARING: Record<NavigationDirection, number> = {
  north: 0,
  east: Math.PI / 2,
  south: Math.PI,
  west: -Math.PI / 2,
}

// No entity sits exactly at the equator/prime-meridian intersection, so
// this is a safe, arbitrary starting point for "select something" when
// nothing is selected yet and an arrow key is pressed — a coordinate
// default, not a hardcoded entity (see the "do not hardcode countries"
// requirement this system was built against).
const NO_SELECTION_ORIGIN = { lat: 0, lng: 0 }

/** One selectable candidate — country or GeoEntity, normalized to the same shape so the direction algorithm below never has to know which registry it came from. */
export interface NavigableEntity {
  id: string
  name: string
  category: 'country' | GeoEntityType
  lat: number
  lng: number
}

// Fixed, generic — not tied to any specific entity's data, just the seven
// classifications every selectable thing except a city already belongs to
// (country plus six of the seven GeoEntityType values — see data/types.ts's
// GeoEntityType and CLAUDE.md's Geopolitical data architecture section).
// Tab/Shift+Tab cycle through this list. `city` is deliberately omitted —
// cities aren't reachable via arrow-key/Tab keyboard navigation at all, see
// useEntityNavigation below.
const CATEGORY_ORDER: readonly NavigableEntity['category'][] = [
  'country',
  'geopolitical-entity',
  'territory',
  'strategic-region',
  'maritime-feature',
  'geographic-region',
  'administrative-division',
]

/**
 * Finds the nearest candidate roughly in `direction` from `origin`,
 * evaluating every candidate by:
 *
 * 1. Geographic direction — bearingBetween(origin, candidate), kept only if
 *    within `DIRECTION_CONE_HALF_ANGLE` of the requested direction's bearing.
 * 2. Distance — angularDistance(origin, candidate), smallest wins among the
 *    entities the cone kept.
 * 3. Entity availability / selectable status — the caller is responsible
 *    for `candidates` only containing entities that actually exist and are
 *    selectable; this function itself has no notion of either (see
 *    useEntityNavigation below, which builds `candidates` from the same
 *    live registries scene/Countries.tsx and scene/GeoEntities.tsx render
 *    from, plus states/provinces only when that Layer Engine layer is
 *    actually enabled — nothing reaches this function that isn't currently
 *    on the globe. Cities are never included — see useEntityNavigation.
 *
 * Pure and generic: no entity id, name, or type ever appears in this
 * function's logic — it only ever reasons about lat/lng and distance,
 * exactly the "must not rely on screen coordinates... must work generically
 * with any selectable entity" requirement this was built against. Returns
 * `null` if nothing qualifies (e.g. arrow-keying further east than the
 * easternmost candidate).
 */
export function findNearestInDirection(
  origin: { lat: number; lng: number },
  direction: NavigationDirection,
  candidates: NavigableEntity[],
  excludeId?: string
): NavigableEntity | null {
  const targetBearing = DIRECTION_BEARING[direction]
  let best: NavigableEntity | null = null
  let bestDistance = Infinity

  for (const candidate of candidates) {
    if (candidate.id === excludeId) continue
    if (candidate.lat === origin.lat && candidate.lng === origin.lng) continue

    const bearing = bearingBetween(origin, candidate)
    const bearingOffset = Math.abs(normalizeAngle(bearing - targetBearing))
    if (bearingOffset >= DIRECTION_CONE_HALF_ANGLE) continue

    const distance = angularDistance(origin, candidate)
    if (distance < bestDistance) {
      bestDistance = distance
      best = candidate
    }
  }

  return best
}

/**
 * Builds the live candidate list (every rendered country, every rendered
 * GeoEntity, and states/provinces while that layer is enabled — never
 * cities, see the comment below) and exposes the two keyboard-driven
 * selection actions:
 * `selectDirection` (arrow keys) and `cycleCategory` (Tab/Shift+Tab). Both
 * resolve through `entities/EntityResolver.ts` and write through
 * `hud/selectionStore.ts`'s `selectEntity()` — the same path a map click or
 * a search result takes — with `openInspector: false`, since arrow-key
 * navigation is meant to update the globe highlight/status bar without
 * forcing the inspector open (see selectionStore.ts's `SelectEntityOptions`
 * doc comment for why `false` here means "don't force it open," not "force
 * it closed" — an already-open inspector just live-updates as you navigate).
 */
export function useEntityNavigation() {
  const countryFeatures = useCountryFeatures()
  const geoEntityFeatures = useGeoEntityFeatures()
  const provinceFeatures = useStatesProvincesFeatures()
  const { selected } = useSelection()
  // Countries and GeoEntities render unconditionally (Globe.tsx mounts
  // <Countries />/<GeoEntities /> directly), but states/provinces are an
  // ordinary Layer Engine layer (off by default — see
  // StatesProvincesLayer.tsx) mounted only while enabled. Without this
  // check, arrow-key/Tab navigation could select — and fly the camera to —
  // a state/province that isn't actually rendered on the globe, because
  // useStatesProvincesFeatures() fetches the same geometry regardless of
  // whether its layer is toggled on.
  //
  // Cities have no equivalent gate here at all — reported directly that
  // arrow-key navigation shouldn't reach cities, full stop, not "only while
  // the cities layer happens to be on" the way states/provinces works.
  // Cities stay selectable by click or search either way; this file just
  // never builds candidates for them.
  const enabledLayers = useLayerEnabledMap()

  const candidates = useMemo<NavigableEntity[]>(() => {
    const countryEntries = countryFeatures.map((f, index) => {
      const centroid = geometryToCentroid(f.geometry)
      return {
        id: f.id !== undefined && f.id !== null ? String(f.id) : `feature-${index}`,
        name: (f.properties?.name as string) ?? 'Unknown',
        category: 'country' as const,
        lat: centroid.lat,
        lng: centroid.lng,
      }
    })

    const geoEntityEntries = geoEntityFeatures.flatMap((f) => {
      const geometryId = f.id !== undefined && f.id !== null ? String(f.id) : undefined
      if (!geometryId) return []
      const entityId = ENTITY_GEOMETRY_IDS[geometryId] ?? geometryId
      const registryEntity = getEntity(entityId)
      const centroid = geometryToCentroid(f.geometry)
      return [
        {
          id: entityId,
          name: registryEntity?.name ?? (f.properties?.name as string) ?? 'Unknown',
          category: registryEntity?.type ?? ('territory' as const),
          lat: centroid.lat,
          lng: centroid.lng,
        },
      ]
    })

    // States/provinces: same shape as geoEntityEntries above, but every
    // feature's geometry id already equals its entity id (see
    // useStatesProvincesFeatures.ts) — no ENTITY_GEOMETRY_IDS lookup needed.
    // Gated on the 'states-provinces' layer actually being enabled (see the
    // comment on enabledLayers above) — StatesProvincesLayer.tsx registers
    // it with defaultEnabled: false, so this is empty until the user turns
    // it on.
    const provinceEntries = !(enabledLayers['states-provinces'] ?? false) ? [] : provinceFeatures.flatMap((f) => {
      const id = f.id !== undefined && f.id !== null ? String(f.id) : undefined
      if (!id) return []
      const registryEntity = getEntity(id)
      const centroid = geometryToCentroid(f.geometry)
      return [
        {
          id,
          name: registryEntity?.name ?? (f.properties?.name as string) ?? 'Unknown',
          category: registryEntity?.type ?? ('administrative-division' as const),
          lat: centroid.lat,
          lng: centroid.lng,
        },
      ]
    })

    return [...countryEntries, ...geoEntityEntries, ...provinceEntries]
  }, [countryFeatures, geoEntityFeatures, provinceFeatures, enabledLayers])

  function goTo(candidate: NavigableEntity) {
    const resolved = resolveEntity(candidate.id)
    if (!resolved) return
    const local = latLngToVector3(candidate.lat, candidate.lng, GLOBE_RADIUS)
    const direction = local.applyAxisAngle(UP_AXIS, getGlobeRotationY()).normalize()
    selectEntity(resolved, direction, { openInspector: false })
  }

  function selectDirection(direction: NavigationDirection) {
    const current = selected ? candidates.find((c) => c.id === selected.id) : undefined
    const origin = current ?? NO_SELECTION_ORIGIN
    const next = findNearestInDirection(origin, direction, candidates, current?.id)
    if (next) goTo(next)
  }

  function currentCategory(): NavigableEntity['category'] | undefined {
    if (!selected) return undefined
    if (selected.entity.kind === 'country') return 'country'
    return (selected.entity.data as GeoEntity).type
  }

  function cycleCategory(forward: boolean) {
    const currentIndex = (() => {
      const category = currentCategory()
      return category ? CATEGORY_ORDER.indexOf(category) : -1
    })()

    const nextIndex = forward
      ? (currentIndex + 1) % CATEGORY_ORDER.length
      : (currentIndex - 1 + CATEGORY_ORDER.length) % CATEGORY_ORDER.length
    const nextCategory = CATEGORY_ORDER[nextIndex]

    const inCategory = candidates
      .filter((c) => c.category === nextCategory)
      .sort((a, b) => a.name.localeCompare(b.name))
    const first = inCategory[0]
    if (first) goTo(first)
  }

  return { selectDirection, cycleCategory }
}
