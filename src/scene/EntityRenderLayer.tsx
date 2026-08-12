import { useEffect, useMemo, useRef, useState } from 'react'
import { useThree, type ThreeEvent } from '@react-three/fiber'
import { Html } from '@react-three/drei'
import { FrontSide, type Mesh, type Vector3 } from 'three'
import { latLngToVector3 } from '../utils/geo'
import { GLOBE_RADIUS } from './constants'
import { HIGHLIGHT_COLORS } from './highlightColors'
import { useFrontOfGlobeVisible } from './useFrontOfGlobeVisible'
import { useApparentFontSize } from './useApparentFontSize'
import type { GeoEntityEntry } from './geoEntityEntries'

// Shared by scene/Countries.tsx and scene/GeoEntities.tsx (v4.4, "Phase 4"
// dedup) — both rendered one merged border lineSegments + one merged fill
// mesh per entry, with identical hover/select/dim color logic, the same
// click-vs-drag threshold, and the same large-vs-small HoverLabel callout
// choice. Kept separate in each caller (not folded in here) is only what's
// a *real* difference: how entries get built (Countries.tsx still builds
// its own — a country's geometryId and entityId are always the same
// string, where a GeoEntity's sometimes aren't, see geoEntityEntries.ts)
// and what happens when a click resolves to nothing (Countries.tsx falls
// back to selectCountry() so a click never silently no-ops; GeoEntities.tsx
// just no-ops, since every rendered GeoEntity already has a GeometryMap
// registration by the time it's clickable) — both live in each caller's own
// onSelect callback, passed in as a prop.
const FILL_RADIUS = GLOBE_RADIUS * 1.0

// v3.1: sourced from scene/highlightColors.ts, the same palette
// hud/LegendPanel.tsx explains.
const COLOR_DEFAULT = HIGHLIGHT_COLORS.default.hex
const COLOR_HOVER = HIGHLIGHT_COLORS.hovered.hex
const COLOR_SELECTED = HIGHLIGHT_COLORS.selected.hex

// How far (in screen pixels) the pointer may move between down/up and still
// count as a "click" rather than a drag-to-rotate gesture.
const CLICK_MOVE_THRESHOLD = 6

// Hover label — always inline at the entry's own centroid, in the exact
// spot its passive label (CountryLabels.tsx/GeoEntityLabels.tsx/
// StateProvinceLabels.tsx, all via PassiveEntityLabels.tsx) already sits.
// Selection no longer gets its own copy of this label at all (see
// `selectedEntry` below) — only ever rendered for the currently-hovered,
// not-currently-selected entry.
//
// 2026-08-09 (v5.2.7): previously gave small entries (under
// LARGE_ENTITY_THRESHOLD_DEG = 7°) a leader-line + dot + offset callout
// instead — reported directly as unwanted for every entity kind ("get rid
// of the call out line... the hovered text should remain on the country
// but replace the regular visible text"). Removed the size branch
// entirely: every entry now gets the same inline treatment large ones
// already had, positioned at the same centroid PassiveEntityLabels.tsx
// uses, so hovering swaps the passive grey text for this glowing one in
// place rather than sprouting a pointer off to the side.
//
// 2026-08-09 (v5.2.8): font size now comes from
// PassiveEntityLabels.tsx's useApparentFontSize(entry.angularExtent) — the
// exact formula that file uses for the passive label this one replaces —
// instead of a flat `text-xs` (12px), which was bigger than even that
// file's own MAX_FONT_PX (11px) for the LARGEST entity on screen and
// produced a visible size jump on every hover ("two different font sizes
// when hovering... the glowing yellow font should only be the smaller
// size not the big one"). Matching the formula wasn't sufficient on its
// own, though ("the font still gets bigger when hovering") — this Html
// still carried a leftover `distanceFactor={8}`, which applies its own
// distance-dependent CSS scale transform on top of whatever `fontSize` is
// set to. PassiveEntityLabels.tsx's Html has never used distanceFactor
// (fontSizePx there is already meant to BE the final on-screen size), so
// as long as this one still had it, the two could never actually match at
// any camera distance except by coincidence. Dropped here for the same
// reason Globe.tsx's WaterLabels, Lakes.tsx, and UsCityLabels.tsx already
// dropped it: a label sized off apparent screen size shouldn't also get
// an extra unbounded distance-based scale on top.
//
// Only actually needs a front/back-of-globe check for the *selected* case —
// a hovered entry is already known front-facing (the pointer had to reach
// its mesh to hover it) — but selection persists across camera rotation
// while hover doesn't, and this component can't tell which reason it's
// being rendered for. Checking unconditionally is cheap (at most one
// HoverLabel ever mounted now) and always correct either way. See
// useFrontOfGlobeVisible.ts and LOGBOOK.md's v5.2.1 entry.
function HoverLabel({ entry }: { entry: GeoEntityEntry }) {
  const anchor = useMemo(
    () => latLngToVector3(entry.centroid.lat, entry.centroid.lng, GLOBE_RADIUS * 1.006),
    [entry.centroid]
  )
  const labelVisible = useFrontOfGlobeVisible(anchor)
  const fontSizePx = useApparentFontSize(entry.angularExtent)

  if (!labelVisible) return null

  return (
    <Html position={anchor} center zIndexRange={[20, 0]} style={{ pointerEvents: 'none' }}>
      <div
        className="whitespace-nowrap tracking-[0.2em] text-amber-200"
        style={{ fontSize: `${fontSizePx}px`, textShadow: '0 0 8px rgba(255,210,76,0.85)' }}
      >
        {entry.name.toUpperCase()}
      </div>
    </Html>
  )
}

export interface EntityRenderLayerProps {
  entries: GeoEntityEntry[]
  selectedEntityId: string | undefined
  onSelect: (entry: GeoEntityEntry, direction: Vector3) => void
  // Propagates the hovered geometry id out to each caller's own hover-id
  // publisher (Countries.tsx's hoveredCountry.ts, GeoEntities.tsx's
  // hoveredGeoEntity.ts, StatesProvinces.tsx's hoveredStateProvince.ts —
  // all three since v5.2.7) so that entry's PassiveEntityLabels.tsx layer
  // excludes whichever entity this one is already glow-labeling via
  // HoverLabel.
  onHoverChange?: (geometryId: string | null) => void
}

export function EntityRenderLayer({ entries, selectedEntityId, onSelect, onHoverChange }: EntityRenderLayerProps) {
  const { gl } = useThree()
  const [hoveredId, setHoveredId] = useState<string | null>(null)
  const dragStart = useRef<{ x: number; y: number } | null>(null)

  // Track where a pointer-down started (in screen space) so a drag-to-rotate
  // gesture over an entry doesn't get misread as a click-to-select.
  useEffect(() => {
    const onDown = (e: PointerEvent) => {
      dragStart.current = { x: e.clientX, y: e.clientY }
    }
    window.addEventListener('pointerdown', onDown)
    return () => window.removeEventListener('pointerdown', onDown)
  }, [])

  // Reflect hover state as a cursor change on the canvas itself.
  useEffect(() => {
    gl.domElement.style.cursor = hoveredId ? 'pointer' : 'auto'
  }, [gl, hoveredId])

  // Propagates only on an actual change to hoveredId, which is itself
  // already guarded against unhover-after-rehover races by the functional
  // setHoveredId update below — so this needs no guard of its own.
  useEffect(() => {
    onHoverChange?.(hoveredId)
  }, [hoveredId, onHoverChange])

  const hoveredEntry = hoveredId ? entries.find((e) => e.geometryId === hoveredId) : undefined

  function handlePointerUp(entry: GeoEntityEntry, e: ThreeEvent<PointerEvent>) {
    e.stopPropagation()
    const start = dragStart.current
    if (start) {
      const dx = e.nativeEvent.clientX - start.x
      const dy = e.nativeEvent.clientY - start.y
      if (Math.hypot(dx, dy) > CLICK_MOVE_THRESHOLD) return // was a drag, not a click
    }

    // Use the clicked mesh's CURRENT world matrix so the direction is
    // correct even while the globe is mid-rotation at the moment of click.
    const localCentroid = latLngToVector3(entry.centroid.lat, entry.centroid.lng, FILL_RADIUS)
    const worldPoint = (e.object as Mesh).localToWorld(localCentroid.clone())
    const direction = worldPoint.normalize()

    onSelect(entry, direction)
  }

  return (
    <group>
      {entries.map((entry) => {
        const isSelected = entry.entityId === selectedEntityId
        const isHovered = hoveredId === entry.geometryId
        const isDimmed = selectedEntityId != null && !isSelected

        const color = isSelected ? COLOR_SELECTED : isHovered ? COLOR_HOVER : COLOR_DEFAULT
        // A faint always-on land tint (distinct from the hover/select fill)
        // so landmasses read against open ocean even at rest.
        const fillOpacity = isSelected ? 0.24 : isHovered ? 0.16 : isDimmed ? 0.02 : 0.05
        const lineOpacity = isDimmed ? 0.12 : isSelected || isHovered ? 0.95 : 0.55

        return (
          <group key={entry.geometryId}>
            {/* Native LineBasicMaterial ignores `linewidth` on effectively
                every platform (WebGL caps it to 1px) — the hover/select
                emphasis that used to come from a thicker line relies on
                color + opacity alone. */}
            <lineSegments geometry={entry.borderGeometry}>
              <lineBasicMaterial color={color} transparent opacity={lineOpacity} />
            </lineSegments>
            {entry.fillGeometry && (
              <mesh
                geometry={entry.fillGeometry}
                onPointerOver={(e) => {
                  e.stopPropagation()
                  setHoveredId(entry.geometryId)
                }}
                onPointerOut={(e) => {
                  e.stopPropagation()
                  setHoveredId((current) => (current === entry.geometryId ? null : current))
                }}
                onPointerUp={(e) => handlePointerUp(entry, e)}
                // Stops a double-click on an entry from falling through to
                // the core sphere's "reset to global view" handler — that
                // should only fire on empty ocean, not on a country/entity.
                onDoubleClick={(e) => e.stopPropagation()}
              >
                <meshBasicMaterial
                  color={color}
                  transparent
                  opacity={fillOpacity}
                  // FrontSide (not DoubleSide) so a pointer ray can't pass
                  // through a gap on the near hemisphere and hit an entry's
                  // back-facing triangles on the far side of the globe.
                  side={FrontSide}
                  depthWrite={false}
                  // Nudges this layer's depth forward of the core sphere
                  // sitting right underneath it, to avoid z-fighting flicker.
                  polygonOffset
                  polygonOffsetFactor={-1}
                  polygonOffsetUnits={-1}
                />
              </mesh>
            )}
          </group>
        )
      })}
      {/* 2026-08-09 (v5.2.8): a selected entity no longer gets its own glow
          label at all — reported directly as redundant with
          IntelligencePanel.tsx's own name heading, which is already on
          screen for as long as anything's selected. Only ever renders for
          the hovered entry, and only when it isn't ALSO the selected one
          (hovering the thing you already have selected shouldn't
          resurrect the redundant label either). */}
      {hoveredEntry && hoveredEntry.entityId !== selectedEntityId && (
        <HoverLabel key={hoveredEntry.geometryId} entry={hoveredEntry} />
      )}
    </group>
  )
}
