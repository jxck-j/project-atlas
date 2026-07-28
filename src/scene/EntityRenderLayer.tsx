import { useEffect, useMemo, useRef, useState } from 'react'
import { useThree, type ThreeEvent } from '@react-three/fiber'
import { Html, Line } from '@react-three/drei'
import { FrontSide, type Mesh, type Vector3 } from 'three'
import { latLngToVector3 } from '../utils/geo'
import { GLOBE_RADIUS } from './constants'
import { HIGHLIGHT_COLORS } from './highlightColors'
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

// Angular bounding-box extent (degrees) above which an entry gets an inline
// hover label instead of a leader-line callout. The median country is ~6.4°
// (e.g. Ghana); the smallest are sub-2° (Qatar, Luxembourg) — 7° comfortably
// separates "big enough to label in place" from "needs a pointer".
const LARGE_ENTITY_THRESHOLD_DEG = 7

// Hover label: large entries get an inline name at their centroid; small
// ones get a leader-line callout (a radial line out to the label), matching
// atlas annotation conventions for tiny nations/features.
function HoverLabel({ entry }: { entry: GeoEntityEntry }) {
  const isLarge = entry.angularExtent >= LARGE_ENTITY_THRESHOLD_DEG

  const anchor = useMemo(
    () => latLngToVector3(entry.centroid.lat, entry.centroid.lng, GLOBE_RADIUS * 1.006),
    [entry.centroid]
  )
  const calloutPoint = useMemo(
    () => latLngToVector3(entry.centroid.lat, entry.centroid.lng, GLOBE_RADIUS * 1.35),
    [entry.centroid]
  )

  if (isLarge) {
    return (
      <Html position={anchor} center distanceFactor={8} zIndexRange={[20, 0]} style={{ pointerEvents: 'none' }}>
        <div
          className="whitespace-nowrap font-mono text-xs tracking-[0.2em] text-amber-200"
          style={{ textShadow: '0 0 8px rgba(255,210,76,0.85)' }}
        >
          {entry.name.toUpperCase()}
        </div>
      </Html>
    )
  }

  return (
    <group>
      <Line points={[anchor, calloutPoint]} color="#FFD24C" lineWidth={1} transparent opacity={0.85} />
      <mesh position={anchor}>
        <sphereGeometry args={[0.01, 8, 8]} />
        <meshBasicMaterial color="#FFD24C" />
      </mesh>
      <Html
        position={calloutPoint}
        center
        distanceFactor={8}
        zIndexRange={[20, 0]}
        style={{ pointerEvents: 'none' }}
      >
        <div
          className="whitespace-nowrap font-mono text-xs tracking-[0.2em] text-amber-200"
          style={{ textShadow: '0 0 8px rgba(255,210,76,0.85)' }}
        >
          {entry.name.toUpperCase()}
        </div>
      </Html>
    </group>
  )
}

export interface EntityRenderLayerProps {
  entries: GeoEntityEntry[]
  selectedEntityId: string | undefined
  onSelect: (entry: GeoEntityEntry, direction: Vector3) => void
  // Country-only: propagates the hovered geometry id out to
  // scene/hoveredCountry.ts so CountryLabels.tsx can suppress a redundant
  // passive label for whatever this layer is already glow-labeling via
  // HoverLabel. GeoEntities has no equivalent always-on label layer, so it
  // omits this prop.
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
  const selectedEntry = selectedEntityId != null ? entries.find((e) => e.entityId === selectedEntityId) : undefined

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
      {selectedEntry && <HoverLabel key={`selected-${selectedEntry.geometryId}`} entry={selectedEntry} />}
      {hoveredEntry && hoveredEntry.geometryId !== selectedEntry?.geometryId && (
        <HoverLabel key={`hovered-${hoveredEntry.geometryId}`} entry={hoveredEntry} />
      )}
    </group>
  )
}
