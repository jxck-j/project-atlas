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
import { abbreviateCountryName } from './countryAbbreviation'
import { apparentSizePx, declutterLabels, type DeclutterCandidate } from './labelDeclutter'
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

// Matches Scene.tsx's <Canvas camera={{ fov: 45 }}> — nothing in this app
// changes FOV dynamically (see grep note in LOGBOOK.md's v5.2.3 entry), so a
// duplicated constant here is simpler than threading the live camera's own
// `fov` field through, the same "matches Globe.tsx's core sphere" tradeoff
// OCCLUDER_RADIUS above already makes.
const CAMERA_FOV_DEG = 45

// 2026-08-09: replaces a fixed 4-tier extent-based size/color/weight ramp
// with continuous values driven by apparentSizePx (labelDeclutter.ts) —
// the country's CURRENT on-screen footprint, not just its fixed real-world
// size. Google Maps-style: the same country reads as a short abbreviation
// from the default overview distance and grows into its full name as you
// zoom in, rather than a country's label treatment being locked in by its
// physical size alone. Reported directly: labels were reading as visibly
// different colors/brightness across countries (varying opacity per tier)
// and small countries' full names were spilling well outside their own
// borders on screen. Font SIZE still varies (matching the country's own
// apparent size keeps the label roughly proportioned to what it's labeling)
// but color is now one constant, and the full-name-vs-abbreviation choice
// is driven by an actual width estimate against the country's own apparent
// diameter instead of never abbreviating at all.
const MIN_FONT_PX = 7
const MAX_FONT_PX = 13
const FONT_TO_APPARENT_RATIO = 0.32
const PROMINENT_APPARENT_PX = 60
// How much wider than the country's own on-screen diameter the full name is
// allowed to render before falling back to the abbreviation — some overhang
// reads as normal on any atlas (the label doesn't have to fit literally
// inside a small country's borders), it just shouldn't sprawl.
const MAX_NAME_WIDTH_FRACTION = 1.15
const LABEL_COLOR_CLASS = 'text-gray-300'

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}

// Rough average glyph width for uppercase, letter-spaced sans-serif text —
// not measured DOM text, just enough to decide "would the full name
// visually overrun this country" without a layout pass every frame.
function estimateTextWidthPx(text: string, fontSizePx: number, letterSpacingEm: number): number {
  const charWidth = fontSizePx * 0.62
  const spacing = fontSizePx * letterSpacingEm
  return text.length * charWidth + Math.max(0, text.length - 1) * spacing
}

const LETTER_SPACING_EM = 0.06

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

  // Read fresh at render time (not the throttled useFrame above) — cheap
  // (a Vector3 length), and keeps font size/abbreviation in sync with the
  // exact camera distance this render is for rather than lagging an extra
  // tick behind the visibility list's own throttle.
  const cameraDistance = camera.position.length()

  return (
    <group>
      {visible.map(({ id, name, extent, localPosition }) => {
        const apparentPx = apparentSizePx(extent, cameraDistance, size.height, CAMERA_FOV_DEG, GLOBE_RADIUS)
        const fontSizePx = clamp(apparentPx * FONT_TO_APPARENT_RATIO, MIN_FONT_PX, MAX_FONT_PX)
        const fullNameWidthPx = estimateTextWidthPx(name.toUpperCase(), fontSizePx, LETTER_SPACING_EM)
        const displayText =
          fullNameWidthPx > apparentPx * MAX_NAME_WIDTH_FRACTION ? abbreviateCountryName(name) : name

        return (
          <Html key={id} position={localPosition} center zIndexRange={[1, 0]} style={{ pointerEvents: 'none' }}>
            <div
              className={`whitespace-nowrap ${LABEL_COLOR_CLASS}`}
              style={{
                fontSize: `${fontSizePx}px`,
                letterSpacing: `${LETTER_SPACING_EM}em`,
                fontWeight: apparentPx >= PROMINENT_APPARENT_PX ? 600 : 400,
              }}
            >
              {displayText.toUpperCase()}
            </div>
          </Html>
        )
      })}
    </group>
  )
}
