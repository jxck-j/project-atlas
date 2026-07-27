import { useMemo, useRef, useState } from 'react'
import { useFrame, useThree } from '@react-three/fiber'
import { Html } from '@react-three/drei'
import { Vector3 } from 'three'
import type { Feature } from 'geojson'
import { useCountryFeatures } from './useCountryFeatures'
import { useSelection } from '../hud/selectionStore'
import { geometryToCentroid, geometryToAngularExtent } from './countryGeometry'
import { latLngToVector3 } from '../utils/geo'
import { getGlobeRotationY } from './globeRotation'
import { getHoveredCountryId } from './hoveredCountry'
import { declutterLabels, type DeclutterCandidate } from './labelDeclutter'
import { GLOBE_RADIUS } from './constants'

// Always-on country name labels, decluttered the same way UsCityLabels.tsx
// is (see labelDeclutter.ts) — added directly in response to the US-cities
// work: once city labels needed real screen-space collision avoidance
// instead of just population/zoom thresholds, the same "callouts are
// overwhelming when zoomed out over a cluster of small countries" problem
// was called out for countries too (Balkans, Benelux, Caribbean — plenty of
// UN members close enough together to collide the same way Texas cities
// did). Deliberately does NOT replace scene/Countries.tsx's existing
// HoverLabel (hover/selection-triggered, different styling, shown for
// exactly one country at a time) — this is a separate, always-on layer for
// every OTHER country, same "selection state and passive background labels
// are different concerns" split WaterLabels/CapitalMarker already
// established. Hidden entirely while anything is selected, matching
// WaterLabels' own gating; the hovered (but not selected) country is
// excluded individually (see hoveredCountry.ts) rather than hiding the
// whole layer, so its glowing HoverLabel is the only name shown for it
// while every other country's passive label keeps showing normally.
//
// No population/zoom-tier eligibility gate the way UsCityLabels needs one
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
const OCCLUDER_RADIUS = GLOBE_RADIUS * 0.98 // matches Globe.tsx's core sphere
const MIN_LABEL_SPACING_PX = 80
const MAX_VISIBLE_LABELS = 80
const DECLUTTER_INTERVAL_MS = 150

const Y_AXIS = new Vector3(0, 1, 0)

// Same idea as UsCityLabels' LABEL_STYLE_TIERS — visual weight scales with
// the same angular-extent score used for declutter priority, so the
// biggest countries (Russia, Canada, ...) read as more prominent than a
// small one that only won a quiet corner of the map.
const LABEL_STYLE_TIERS: [minExtent: number, className: string][] = [
  [40, 'text-[12px] font-semibold tracking-[0.08em] text-cyan-100/85'],
  [20, 'text-[10px] font-medium tracking-[0.06em] text-cyan-200/70'],
  [10, 'text-[9px] tracking-[0.05em] text-cyan-300/60'],
  [0, 'text-[8px] tracking-[0.04em] text-cyan-400/50'],
]

function labelClassName(extent: number): string {
  for (const [minExtent, className] of LABEL_STYLE_TIERS) {
    if (extent >= minExtent) return className
  }
  return LABEL_STYLE_TIERS[LABEL_STYLE_TIERS.length - 1][1]
}

interface CountryCandidate extends DeclutterCandidate {
  name: string
  extent: number
  localPosition: Vector3
}

export function CountryLabels() {
  const countries = useCountryFeatures()
  const { selected } = useSelection()
  const { camera, size } = useThree()
  const [visible, setVisible] = useState<CountryCandidate[]>([])
  const lastRun = useRef(0)

  // Computed once per country list load, not per frame — geometryToCentroid/
  // geometryToAngularExtent both walk every ring of a feature's geometry.
  const ranked = useMemo(() => {
    const entries = countries.map((feature: Feature, index: number) => {
      const centroid = geometryToCentroid(feature.geometry)
      const extent = geometryToAngularExtent(feature.geometry)
      const id = feature.id !== undefined && feature.id !== null ? String(feature.id) : `feature-${index}`
      const name = (feature.properties?.name as string) ?? 'Unknown'
      return { id, name, extent, localPosition: latLngToVector3(centroid.lat, centroid.lng, GLOBE_RADIUS * 1.002) }
    })
    entries.sort((a, b) => b.extent - a.extent)
    return entries
  }, [countries])

  useFrame((state) => {
    const now = state.clock.elapsedTime * 1000
    if (now - lastRun.current < DECLUTTER_INTERVAL_MS) return
    lastRun.current = now

    if (selected) {
      if (visible.length > 0) setVisible([])
      return
    }

    const rotationY = getGlobeRotationY()
    const hoveredId = getHoveredCountryId()
    const candidates: CountryCandidate[] = ranked
      .filter((entry) => entry.id !== hoveredId)
      .map((entry) => ({
        ...entry,
        worldPosition: entry.localPosition.clone().applyAxisAngle(Y_AXIS, rotationY),
      }))

    const next = declutterLabels(
      candidates,
      camera,
      size.width,
      size.height,
      OCCLUDER_RADIUS,
      MIN_LABEL_SPACING_PX,
      MAX_VISIBLE_LABELS
    )
    setVisible(next)
  })

  return (
    <group>
      {visible.map(({ id, name, extent, localPosition }) => (
        <Html key={id} position={localPosition} center zIndexRange={[1, 0]} style={{ pointerEvents: 'none' }}>
          <div className={`whitespace-nowrap font-mono ${labelClassName(extent)}`}>{name.toUpperCase()}</div>
        </Html>
      ))}
    </group>
  )
}
