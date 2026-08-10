import { useMemo } from 'react'
import { useGeoEntityFeatures } from './useGeoEntityFeatures'
import { buildGeoEntityEntries } from './geoEntityEntries'
import { useSelection } from '../hud/selectionStore'
import { latLngToVector3 } from '../utils/geo'
import { GLOBE_RADIUS } from './constants'
import { getHoveredGeoEntityId } from './hoveredGeoEntity'
import { PassiveEntityLabels, type PassiveLabelSource } from './PassiveEntityLabels'

// Always-on GeoEntity name labels (v5.2.4) — the same passive, Google-Maps-
// style zoom-adaptive treatment CountryLabels.tsx gives the 193 UN members,
// extended to the 55 rendered GeoEntities (dependencies/territories like
// Greenland, de facto states, strategic areas, ...). Reported directly:
// territories had no equivalent always-on label at all, only
// EntityRenderLayer.tsx's hover/selection-triggered HoverLabel — so a
// territory's name was invisible unless you were already hovering or had
// selected it, unlike every UN member country.
//
// Reuses buildGeoEntityEntries (geoEntityEntries.ts) for {name, centroid,
// angularExtent} — the same function scene/GeoEntities.tsx and the
// geoOverlays layers already call independently for their own needs (see
// that file's own header comment); this is one more caller, not a new
// pattern. The border/fill BufferGeometry work that function also does is
// wasted here (this layer only needs the three plain fields), the same
// small, accepted duplication ClaimsOverlayLayer.tsx's own independent call
// already established rather than threading entries through as a prop.
//
// Excludes whichever entity GeoEntities.tsx's own hover state is already
// glow-labeling, via hoveredGeoEntity.ts (v5.2.7) — the same
// hoveredCountry.ts pattern CountryLabels.tsx already used. Went from
// "harmless duplication, not worth a new publisher store" to a real bug
// once EntityRenderLayer.tsx's HoverLabel stopped using a leader-line
// callout and started rendering at the exact same centroid this passive
// label does (see LOGBOOK.md's v5.2.7 entry) — without this, a hovered
// entity would show both labels stacked exactly on top of each other
// instead of the hover label replacing the passive one.
export function GeoEntityLabels() {
  const features = useGeoEntityFeatures()
  const { selected } = useSelection()

  const entries = useMemo<PassiveLabelSource[]>(() => {
    return buildGeoEntityEntries(features).map((entry) => ({
      id: entry.entityId,
      name: entry.name,
      extent: entry.angularExtent,
      localPosition: latLngToVector3(entry.centroid.lat, entry.centroid.lng, GLOBE_RADIUS * 1.002),
    }))
  }, [features])

  // Lower ceiling than CountryLabels.tsx's default 80 — only 55 GeoEntities
  // exist at all, most of them small/niche; there's no reason to reserve
  // budget for more than could ever be candidates.
  return (
    <PassiveEntityLabels
      entries={entries}
      hidden={selected != null}
      getExcludeId={getHoveredGeoEntityId}
      maxVisibleLabels={55}
    />
  )
}
