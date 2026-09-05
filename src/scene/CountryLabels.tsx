import { useMemo } from 'react'
import type { Feature } from 'geojson'
import { useCountryFeatures } from './useCountryFeatures'
import { useSelection } from '../hud/selectionStore'
import { geometryToCentroid, geometryToAngularExtent } from './countryGeometry'
import { latLngToVector3 } from '../utils/geo'
import { getHoveredCountryId } from './hoveredCountry'
import { PassiveEntityLabels, type PassiveLabelSource } from './PassiveEntityLabels'
import { GLOBE_RADIUS } from './constants'

// Always-on country name labels — see PassiveEntityLabels.tsx for the
// Google-Maps-style zoom-adaptive sizing/abbreviation/color logic shared
// with GeoEntityLabels.tsx. This file only builds the {id, name, extent,
// localPosition} entries from useCountryFeatures() and wires up the two
// things that are genuinely country-specific: excluding whichever country
// scene/Countries.tsx's own hover state is already glowing a HoverLabel for
// (hoveredCountry.ts), and hiding entirely while anything is selected —
// added directly in response to the US-cities work: once city labels needed
// real screen-space collision avoidance instead of just population/zoom
// thresholds, the same "callouts are overwhelming when zoomed out over a
// cluster of small countries" problem was called out for countries too
// (Balkans, Benelux, Caribbean — plenty of UN members close enough together
// to collide the same way Texas cities did). Deliberately does NOT replace
// scene/Countries.tsx's existing HoverLabel (hover/selection-triggered,
// different styling, shown for exactly one country at a time) — this is a
// separate, always-on layer for every OTHER country, same "selection state
// and passive background labels are different concerns" split
// WaterLabels/CapitalMarker already established.
//
// No population/zoom-tier eligibility gate the way CityLabels needs one
// (32,608 candidates vs. 193) — every registered country is always a
// candidate, ranked by geometryToAngularExtent (this file's existing
// "is this country big enough on screen for an inline label" measure,
// reused unchanged as a general size-priority signal: no population/GDP
// data exists for all 193 countries in this codebase, see data/types.ts's
// Country schema note, so real-world physical size is the only
// dependency-free, exhaustive-coverage signal available). Progressive
// reveal falls entirely out of declutterLabels' screen-space spacing check
// — the same real-world gap between two adjacent small countries maps to
// more screen pixels the closer the camera gets, so nothing else needs to
// track "how zoomed in are we."
export function CountryLabels() {
  const countries = useCountryFeatures()
  const { selected } = useSelection()

  // Computed once per country list load, not per frame — geometryToCentroid/
  // geometryToAngularExtent both walk every ring of a feature's geometry.
  const entries = useMemo<PassiveLabelSource[]>(() => {
    return countries.map((feature: Feature, index: number) => {
      const centroid = geometryToCentroid(feature.geometry)
      const extent = geometryToAngularExtent(feature.geometry)
      const id = feature.id !== undefined && feature.id !== null ? String(feature.id) : `feature-${index}`
      const name = (feature.properties?.name as string) ?? 'Unknown'
      return { id, name, extent, localPosition: latLngToVector3(centroid.lat, centroid.lng, GLOBE_RADIUS * 1.002) }
    })
  }, [countries])

  return <PassiveEntityLabels entries={entries} hidden={selected != null} getExcludeId={getHoveredCountryId} />
}
