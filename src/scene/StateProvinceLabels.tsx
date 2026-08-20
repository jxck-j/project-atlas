import { useMemo } from 'react'
import { latLngToVector3 } from '../utils/geo'
import { GLOBE_RADIUS, CAMERA_MIN_DISTANCE } from './constants'
import { getHoveredStateProvinceId } from './hoveredStateProvince'
import { PassiveEntityLabels, type PassiveLabelSource } from './PassiveEntityLabels'
import { STATE_LABEL_FONT_CONFIG } from './stateLabelFontConfig'
import type { GeoEntityEntry } from './geoEntityEntries'

// Always-on passive admin-1 (state/province) name labels (v5.2.7) — the
// same PassiveEntityLabels.tsx treatment CountryLabels.tsx/
// GeoEntityLabels.tsx already give countries and GeoEntities, extended here
// once StatesProvinces.tsx needed it too: "next political states should
// have the same behavior as [countries] and show their names." Kept as its
// own file (not folded into StatesProvinces.tsx) purely because that file
// already has its own header comment explaining why it's separate from
// GeoEntities.tsx; this mirrors that same "real difference, not just
// duplication" reasoning — StatesProvinces.tsx is itself a toggleable Layer
// Engine layer, so this label layer needs to live inside it and share its
// on/off state, but the two concerns (entity rendering vs. passive label
// rendering) still don't need to be the same component.
//
// Reveal threshold is deliberately its own, much tighter distance than
// CountryLabels.tsx/GeoEntityLabels.tsx (which show from the default
// overview, ~6.5) — reported directly: state/province names should stay
// hidden until you're actually focused on a region, not compete with
// country names at the world view. Anchored between two existing
// reference points rather than picked in isolation: further out than
// Lakes.tsx's LABEL_REVEAL_DISTANCE (CAMERA_MIN_DISTANCE + 0.3 = 2.8, this
// app's tightest existing label gate) since state names are a coarser
// "focused on a region" signal, not an extreme-close-up detail; closer in
// than the distance a single country already fills the view (~3.5-4) since
// several of the only 9 countries this layer covers (especially Russia,
// Canada, the US) are large enough to have multiple in view together at a
// merely "focused on this region" zoom, and their states shouldn't have to
// wait for a single-country-filling zoom to appear.
const STATE_LABEL_REVEAL_DISTANCE = CAMERA_MIN_DISTANCE + 0.7

export function StateProvinceLabels({ entries, hidden }: { entries: GeoEntityEntry[]; hidden: boolean }) {
  const labelSources = useMemo<PassiveLabelSource[]>(() => {
    return entries.map((entry) => ({
      id: entry.entityId,
      name: entry.name,
      extent: entry.angularExtent,
      localPosition: latLngToVector3(entry.centroid.lat, entry.centroid.lng, GLOBE_RADIUS * 1.002),
    }))
  }, [entries])

  return (
    <PassiveEntityLabels
      entries={labelSources}
      hidden={hidden}
      getExcludeId={getHoveredStateProvinceId}
      maxCameraDistance={STATE_LABEL_REVEAL_DISTANCE}
      maxVisibleLabels={40}
      fontSizeConfig={STATE_LABEL_FONT_CONFIG}
    />
  )
}
