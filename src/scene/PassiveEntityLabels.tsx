import { useMemo, useRef, useState } from 'react'
import { useFrame, useThree } from '@react-three/fiber'
import { Html } from '@react-three/drei'
import { Vector3 } from 'three'
import { getGlobeRotationY } from './globeRotation'
import { abbreviateCountryName } from './countryAbbreviation'
import { declutterLabels, type DeclutterCandidate } from './labelDeclutter'
import { apparentSizePxFor, computeApparentFontSizePx, type FontSizeConfig } from './useApparentFontSize'
import { GLOBE_RADIUS } from './constants'

// Shared by CountryLabels.tsx and GeoEntityLabels.tsx (v5.2.4, extracted once
// both needed the identical "always-on passive name label, Google-Maps-style
// zoom-adaptive sizing/abbreviation, one uniform color" treatment — the same
// "duplication became real, so extract" call EntityRenderLayer.tsx already
// made for border/fill/hover rendering) and StateProvinceLabels.tsx (v5.2.7,
// via `maxCameraDistance` — see that prop's own comment). See LOGBOOK.md's
// v5.2.3/v5.2.4 entries for why this replaced the old fixed-extent-tier
// system.
const OCCLUDER_RADIUS = GLOBE_RADIUS * 0.98 // matches Globe.tsx's core sphere
const DECLUTTER_INTERVAL_MS = 150

const PROMINENT_APPARENT_PX = 60
// How much wider than the entity's own on-screen diameter the full name is
// allowed to render before falling back to the abbreviation — some overhang
// reads as normal on any atlas (the label doesn't have to fit literally
// inside a small country's borders), it just shouldn't sprawl.
const MAX_NAME_WIDTH_FRACTION = 1.15
const LABEL_COLOR_CLASS = 'text-gray-300'
const LETTER_SPACING_EM = 0.06
// Floor so a heavily-abbreviated, tiny-apparent-size label still claims
// *some* clearance from its neighbors rather than a near-zero radius that
// would let two abbreviations render right on top of each other.
const MIN_SPACING_RADIUS_PX = 12

const Y_AXIS = new Vector3(0, 1, 0)

// Rough average glyph width for uppercase, letter-spaced sans-serif text —
// not measured DOM text, just enough to decide "would this text visually
// overrun the entity's own footprint" without a layout pass every frame.
function estimateTextWidthPx(text: string, fontSizePx: number): number {
  const charWidth = fontSizePx * 0.62
  const spacing = fontSizePx * LETTER_SPACING_EM
  return text.length * charWidth + Math.max(0, text.length - 1) * spacing
}

export interface PassiveLabelSource {
  id: string
  name: string
  extent: number
  localPosition: Vector3
}

interface PassiveLabelCandidate extends DeclutterCandidate, PassiveLabelSource {
  fontSizePx: number
  displayText: string
  prominent: boolean
}

export interface PassiveEntityLabelsProps {
  entries: PassiveLabelSource[]
  // Hides the whole layer — e.g. while anything is selected, matching
  // WaterLabels' own gating so a passive background label never competes
  // with the focused selection UI.
  hidden: boolean
  // Checked every frame (not a prop that changes every render) — e.g.
  // hoveredCountry.ts's getHoveredCountryId, hoveredGeoEntity.ts's,
  // hoveredStateProvince.ts's — so whichever entity already has a glowing
  // HoverLabel elsewhere doesn't also get a redundant passive label.
  // Optional only because a caller might genuinely have nothing to exclude.
  getExcludeId?: () => string | null
  maxVisibleLabels?: number
  minLabelSpacingPx?: number
  // Hides the whole layer once the camera is farther than this — e.g.
  // StateProvinceLabels.tsx (v5.2.7) wants admin-1 names to stay hidden at
  // the default overview and only reveal once you're focused on a
  // particular region, unlike CountryLabels.tsx/GeoEntityLabels.tsx, which
  // show from the default overview distance. Checked alongside `hidden` in
  // the same throttled tick that already reads camera distance for the
  // apparent-size math, rather than a second useFrame/state layer in the
  // caller.
  maxCameraDistance?: number
  // Overrides this layer's font-size floor/ceiling/growth-rate — e.g.
  // StateProvinceLabels.tsx (2026-08-20) wants admin-1 names to read
  // noticeably bigger than country names once zoomed in on a region, not
  // share CountryLabels.tsx/GeoEntityLabels.tsx's ceiling. Defaults (when
  // omitted) match useApparentFontSize.ts's own constants exactly, so every
  // existing caller is unaffected. The width-vs-own-apparent-size
  // abbreviation fallback below still runs on top of whatever font size
  // this produces — that's what keeps a bigger font from actually spilling
  // outside the entity's own footprint, not this config by itself.
  fontSizeConfig?: FontSizeConfig
}

export function PassiveEntityLabels({
  entries,
  hidden,
  getExcludeId,
  maxVisibleLabels = 80,
  minLabelSpacingPx = 80,
  maxCameraDistance,
  fontSizeConfig,
}: PassiveEntityLabelsProps) {
  const { camera, size } = useThree()
  const [visible, setVisible] = useState<PassiveLabelCandidate[]>([])
  // Checked every frame, NOT gated behind the DECLUTTER_INTERVAL_MS throttle
  // below — reported directly: hovering a country briefly showed both its
  // passive grey label and its glowing hover label at once ("only the
  // yellow one should show"). The full declutter recompute only needs to
  // run every ~150ms (expensive: spacing math over every candidate), but
  // reacting to a hover starting/ending doesn't need to wait for that —
  // EntityRenderLayer.tsx's hover color change already forces a frame that
  // same tick (a React-driven prop change auto-invalidates under
  // frameloop="demand"), so checking getExcludeId() on every rendered frame
  // and filtering it out at render time (below) removes the flash instead
  // of just shortening it.
  const [excludedId, setExcludedId] = useState<string | null>(null)
  const hasRun = useRef(false)
  const lastRun = useRef(0)

  // Sorted once per entry-list change, not per frame — declutterLabels reads
  // its input as already priority-ordered.
  const ranked = useMemo(() => [...entries].sort((a, b) => b.extent - a.extent), [entries])

  useFrame((state) => {
    const currentExcludeId = getExcludeId?.() ?? null
    if (currentExcludeId !== excludedId) setExcludedId(currentExcludeId)

    const now = state.clock.elapsedTime * 1000
    // `hasRun` (not just comparing `now` to the interval) guarantees the
    // very first frame after mount always runs this check regardless of
    // what elapsedTime happens to already be — see Globe.tsx's WaterLabels
    // for the same guard and why it matters under frameloop="demand".
    if (hasRun.current && now - lastRun.current < DECLUTTER_INTERVAL_MS) return
    hasRun.current = true
    lastRun.current = now

    const cameraDistance = camera.position.length()
    const tooFarOut = maxCameraDistance != null && cameraDistance > maxCameraDistance

    if (hidden || tooFarOut) {
      if (visible.length > 0) setVisible([])
      return
    }

    const rotationY = getGlobeRotationY()

    const candidates: PassiveLabelCandidate[] = ranked
      .filter((entry) => entry.id !== currentExcludeId)
      .map((entry) => {
        const apparentPx = apparentSizePxFor(entry.extent, cameraDistance, size.height)
        const fontSizePx = computeApparentFontSizePx(entry.extent, cameraDistance, size.height, fontSizeConfig)
        const fullNameWidthPx = estimateTextWidthPx(entry.name.toUpperCase(), fontSizePx)
        const useAbbreviation = fullNameWidthPx > apparentPx * MAX_NAME_WIDTH_FRACTION
        const displayText = useAbbreviation ? abbreviateCountryName(entry.name) : entry.name
        const shownWidthPx = useAbbreviation
          ? estimateTextWidthPx(displayText.toUpperCase(), fontSizePx)
          : fullNameWidthPx

        return {
          ...entry,
          worldPosition: entry.localPosition.clone().applyAxisAngle(Y_AXIS, rotationY),
          fontSizePx,
          displayText,
          prominent: apparentPx >= PROMINENT_APPARENT_PX,
          // Half the label's OWN estimated rendered width, not a flat
          // constant — a tiny abbreviated label needs far less clearance
          // than a big full name, which is what actually lets tightly
          // clustered small countries/territories (reported: Israel losing
          // a spacing conflict to a bigger neighbor while a country even
          // farther away still won its own slot) share the same
          // neighborhood instead of one flat radius reserving more space
          // than most labels actually use. Same "per-candidate radius, not
          // one shared constant" fix labelDeclutter.ts's own doc comment
          // already documents for the Gulfport/Biloxi regression.
          spacingRadiusPx: Math.max(shownWidthPx / 2, MIN_SPACING_RADIUS_PX),
        }
      })

    const next = declutterLabels(
      candidates,
      camera,
      size.width,
      size.height,
      OCCLUDER_RADIUS,
      minLabelSpacingPx,
      maxVisibleLabels
    )
    setVisible(next)
  })

  return (
    <group>
      {visible
        .filter(({ id }) => id !== excludedId)
        .map(({ id, displayText, fontSizePx, prominent, localPosition }) => (
          <Html key={id} position={localPosition} center zIndexRange={[1, 0]} style={{ pointerEvents: 'none' }}>
            <div
              className={`whitespace-nowrap ${LABEL_COLOR_CLASS}`}
              style={{
                fontSize: `${fontSizePx}px`,
                letterSpacing: `${LETTER_SPACING_EM}em`,
                fontWeight: prominent ? 600 : 400,
              }}
            >
              {displayText.toUpperCase()}
            </div>
          </Html>
        ))}
    </group>
  )
}
