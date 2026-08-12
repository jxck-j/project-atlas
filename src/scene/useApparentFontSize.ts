import { useState } from 'react'
import { useFrame, useThree } from '@react-three/fiber'
import { apparentSizePx } from './labelDeclutter'
import { GLOBE_RADIUS } from './constants'

// Pulled out of PassiveEntityLabels.tsx (v5.2.8, a plain .ts module so
// EntityRenderLayer.tsx's HoverLabel can import the hook below without that
// file exporting a non-component value from itself — oxlint's
// react-refresh rule flags that, correctly; see geoEntityEntries.ts's own
// header comment for the same reasoning applied there first) — single
// source of truth for "how big should this entity's label read on screen
// right now," shared by the passive label layer's own per-candidate loop
// and HoverLabel's single-entity hook. Reported directly as two different
// sizes when hovering ("the glowing yellow font should only be the smaller
// size not the big one") after HoverLabel used to hardcode a flat 12px
// regardless of the entity's apparent size — bigger than even
// MAX_FONT_PX (11px) for the LARGEST entity on screen, so hovering ANY
// entity produced a visible jump. One formula now backs both.

// Matches Scene.tsx's <Canvas camera={{ fov: 45 }}> — nothing in this app
// changes FOV dynamically, so a duplicated constant here is simpler than
// threading the live camera's own `fov` field through, the same "matches
// Globe.tsx's core sphere" tradeoff PassiveEntityLabels.tsx's own
// OCCLUDER_RADIUS makes.
const CAMERA_FOV_DEG = 45

// 2026-08-09 (v5.2.5): FONT_TO_APPARENT_RATIO was 0.32 and MAX_FONT_PX was
// 13 — together they made font size hit its ceiling at a mere 41px apparent
// size (a country barely bigger than a small dot at the default overview
// distance), so nearly every country of at least moderate size rendered at
// the SAME maxed-out size regardless of actual zoom — reported directly as
// "text too big at zoomed out levels" (not zoom-adaptive in practice for
// most countries) and, worse, silently broke the abbreviation-to-full-name
// transition for long names: since the rendered font (and therefore the
// estimated text width) stops growing once it hits MAX_FONT_PX while a
// country's actual apparent size keeps growing as you zoom in, a long name
// (Democratic Republic of the Congo, 33 characters) needed apparentPx to
// nearly reach CAMERA_MIN_DISTANCE before its capped width finally fell
// under the growing MAX_NAME_WIDTH_FRACTION threshold — reported as "DRC
// stays abbreviated even when zoomed in." Lowering the ratio (so font size
// grows more gradually and doesn't saturate until a country is genuinely
// large on screen) and the cap (so a long name's width ceiling is lower,
// letting apparentPx's threshold overtake it at a normal "zoomed in on
// this country" distance instead of only at the absolute closest zoom)
// fixes both at once — see LOGBOOK.md's v5.2.5 entry for the numbers this
// was tuned against.
export const MIN_FONT_PX = 6
export const MAX_FONT_PX = 11
const FONT_TO_APPARENT_RATIO = 0.12

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}

// This module's own CAMERA_FOV_DEG/GLOBE_RADIUS baked in, so callers (this
// file's own hook below, PassiveEntityLabels.tsx's per-candidate loop) don't
// each need their own copy of the FOV constant just to call
// labelDeclutter.ts's apparentSizePx directly.
export function apparentSizePxFor(extent: number, cameraDistance: number, viewportHeight: number): number {
  return apparentSizePx(extent, cameraDistance, viewportHeight, CAMERA_FOV_DEG, GLOBE_RADIUS)
}

// Pure — usable directly in PassiveEntityLabels.tsx's per-candidate loop
// (can't call the hook below there; hooks can't run a variable number of
// times per render).
export function computeApparentFontSizePx(extent: number, cameraDistance: number, viewportHeight: number): number {
  return clamp(apparentSizePxFor(extent, cameraDistance, viewportHeight) * FONT_TO_APPARENT_RATIO, MIN_FONT_PX, MAX_FONT_PX)
}

// Reactive wrapper for a single entity (EntityRenderLayer.tsx's HoverLabel —
// at most one ever mounted at a time since v5.2.8, so there's no
// spacing/candidate-pool cost to amortize the way the passive layer's
// per-candidate work has, and no throttle here unlike that file's full
// declutter pass).
export function useApparentFontSize(extent: number): number {
  const { camera, size } = useThree()
  const [fontSizePx, setFontSizePx] = useState(MIN_FONT_PX)

  useFrame(() => {
    const next = computeApparentFontSizePx(extent, camera.position.length(), size.height)
    if (next !== fontSizePx) setFontSizePx(next)
  })

  return fontSizePx
}
