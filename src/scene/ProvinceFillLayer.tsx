import { memo, useEffect, useMemo, useState } from 'react'
import { useThree, type ThreeEvent } from '@react-three/fiber'
import { FrontSide, type Mesh, type Vector3 } from 'three'
import { latLngToVector3 } from '../utils/geo'
import { GLOBE_RADIUS } from './constants'
import { HIGHLIGHT_COLORS } from './highlightColors'
import { HoverLabel } from './EntityRenderLayer'
import { useClickDragGuard } from './useClickDragGuard'
import { useMergedFillsByCountry, type CountryFill } from './useMergedFillsByCountry'
import { getParentCountryId } from './provinceCountryGroups'
import type { GeoEntityEntry } from './geoEntityEntries'

// scene/StatesProvinces.tsx-only replacement for EntityRenderLayer's fill
// rendering, built 2026-08-16 once the LOD gate + front-facing filter
// (both real, both helpful) still left movement choppy over a
// province-dense region (many small countries in view together, e.g.
// Europe — reported directly). EntityRenderLayer's one-mesh-per-entry
// model is fine at country/GeoEntity scale (~193/~55 entries); at
// hundreds of simultaneously-visible provinces, mounting that many
// individually-raycast/redrawn meshes is itself the cost.
//
// First attempt merged EVERY visible province into one single mesh
// globally. That fixed the per-object overhead but traded it for a worse
// problem, confirmed by direct measurement (not guessed): a single merged
// BufferGeometry has no internal spatial acceleration structure, so R3F's
// raycaster (which runs on every native pointermove, unthrottled) does one
// bounding-sphere check for the whole mesh, then a flat linear scan of
// EVERY triangle if that passes. Europe's ~227,000 active triangles at a
// normal zoom (vs. Brazil's ~84,000 at a comparable zoom) meant that scan
// cost scaled directly with province density, not mesh count — "Americas
// fine, Europe still struggling" was the direct symptom. This version
// (scene/useMergedFillsByCountry.ts) merges per COUNTRY instead: coarse
// enough to cut mesh count by ~19x vs. one-per-province, fine enough that
// each country-sized mesh still gets a useful bounding-sphere pre-reject
// from the raycaster — most countries aren't anywhere near the cursor on
// any given pointer move, and now that fact is cheap to check again. See
// LOGBOOK.md's "States/provinces FPS" part 6 for the full profiling story.
//
// Visual result is unchanged from the first attempt: each active country's
// mesh renders the uniform default/dimmed land tint; up to two small
// unraycastable overlay meshes (`raycast={() => null}`, so pointer events
// pass through to whichever country mesh sits underneath) render the
// selected/hovered province's own highlight color and border on top,
// reusing that entry's already-built fillGeometry/borderGeometry.
//
// 2026-08-17: per-country merging alone still wasn't enough — reported
// again as laggy over Europe even with better triangle-count numbers.
// A second, independent cost was compounding it: every pointermove that
// actually changes the hovered province (which is most of them, over many
// small densely-packed provinces) triggered a React re-render with
// Array.find()/some() re-scans of up to ~2,700 visible entries, PLUS every
// active country mesh re-rendering because its callback props
// (onHover/onSelectEntry/wasDragGesture) weren't stable references.
// Fixed with a geometryId-keyed Map for O(1) lookups and React.memo on
// CountryFillMesh (below) backed by useCallback'd callbacks all the way up
// through StatesProvinces.tsx. See LOGBOOK.md's "States/provinces FPS"
// part 7 for the profiling that found this.
const FILL_RADIUS = GLOBE_RADIUS * 1.0
const COLOR_DEFAULT = HIGHLIGHT_COLORS.default.hex
const COLOR_HOVER = HIGHLIGHT_COLORS.hovered.hex
const COLOR_SELECTED = HIGHLIGHT_COLORS.selected.hex

// A tick forward of each country mesh's own polygonOffset (-1), so a
// hovered/selected province's overlay draws in front of its country's
// base fill for that same triangle range instead of z-fighting with it.
const OVERLAY_POLYGON_OFFSET = -2

function neverRaycast() {
  return null
}

interface CountryFillMeshProps {
  countryFill: CountryFill
  baseOpacity: number
  onHover: (geometryId: string | null) => void
  onSelectEntry: (entry: GeoEntityEntry, direction: Vector3) => void
  wasDragGesture: (clientX: number, clientY: number) => boolean
}

// One country's worth of provinces, merged into one mesh — this component
// exists (rather than inlining the JSX in a .map()) purely so each
// instance gets its own resolveEntry/handlePointer* closures scoped to its
// own countryFill, the same way EntityRenderLayer's per-entry .map() scopes
// a closure per entry, just one level coarser.
//
// Wrapped in React.memo (2026-08-17): a country mesh's own visual output
// only depends on countryFill (stable per country, cached) and baseOpacity
// (only changes when selection toggles on/off) — never on hoveredId, which
// changes far more often. Without memo, every one of the ~100+ active
// country meshes re-rendered on every hover change even though at most one
// of them was ever visually affected by it (via the small overlay mesh
// ProvinceFillLayer renders separately) — measured as a real, avoidable
// cost, worse specifically over dense regions where hover changes on
// nearly every pointermove (small provinces) rather than rarely (large
// ones). Only pays off because onHover/onSelectEntry/wasDragGesture below
// are now stable references too (useCallback in their owners) — an
// unstable prop would defeat this memo on every render regardless. See
// LOGBOOK.md's "States/provinces FPS" part 7.
const CountryFillMesh = memo(function CountryFillMesh({
  countryFill,
  baseOpacity,
  onHover,
  onSelectEntry,
  wasDragGesture,
}: CountryFillMeshProps) {
  function resolveEntry(e: ThreeEvent<PointerEvent>): GeoEntityEntry | null {
    if (e.faceIndex == null) return null
    const entryIndex = countryFill.merged.faceToEntryIndex[e.faceIndex]
    return countryFill.entries[entryIndex] ?? null
  }

  function handlePointerMove(e: ThreeEvent<PointerEvent>) {
    e.stopPropagation()
    onHover(resolveEntry(e)?.geometryId ?? null)
  }

  function handlePointerOut(e: ThreeEvent<PointerEvent>) {
    e.stopPropagation()
    onHover(null)
  }

  function handlePointerUp(e: ThreeEvent<PointerEvent>) {
    e.stopPropagation()
    if (wasDragGesture(e.nativeEvent.clientX, e.nativeEvent.clientY)) return // was a drag, not a click

    const entry = resolveEntry(e)
    if (!entry) return

    // Use the clicked mesh's CURRENT world matrix so the direction is
    // correct even while the globe is mid-rotation at the moment of click
    // — same reasoning as EntityRenderLayer's own handlePointerUp.
    const localCentroid = latLngToVector3(entry.centroid.lat, entry.centroid.lng, FILL_RADIUS)
    const worldPoint = (e.object as Mesh).localToWorld(localCentroid.clone())
    onSelectEntry(entry, worldPoint.normalize())
  }

  return (
    <mesh
      geometry={countryFill.merged.geometry}
      onPointerMove={handlePointerMove}
      onPointerOut={handlePointerOut}
      onPointerUp={handlePointerUp}
      // Stops a double-click on a province from falling through to the
      // core sphere's "reset to global view" handler.
      onDoubleClick={(e) => e.stopPropagation()}
    >
      <meshBasicMaterial
        color={COLOR_DEFAULT}
        transparent
        opacity={baseOpacity}
        side={FrontSide}
        depthWrite={false}
        polygonOffset
        polygonOffsetFactor={-1}
        polygonOffsetUnits={-1}
      />
    </mesh>
  )
})

export interface ProvinceFillLayerProps {
  // The FULL, unfiltered province list — used only to build (and cache)
  // each country's merged geometry once. Stable once the underlying fetch
  // completes, so this never drives a rebuild on camera movement.
  allEntries: GeoEntityEntry[]
  // The currently front-facing/on-screen subset (useFrontFacingEntries) —
  // determines which countries' already-built meshes are actually mounted,
  // and is what selected/hovered-entry lookups search.
  visibleEntries: GeoEntityEntry[]
  selectedEntityId: string | undefined
  onSelect: (entry: GeoEntityEntry, direction: Vector3) => void
  onHoverChange?: (geometryId: string | null) => void
}

export function ProvinceFillLayer({
  allEntries,
  visibleEntries,
  selectedEntityId,
  onSelect,
  onHoverChange,
}: ProvinceFillLayerProps) {
  const { gl } = useThree()
  const [hoveredId, setHoveredId] = useState<string | null>(null)
  const wasDragGesture = useClickDragGuard()

  const fillsByCountry = useMergedFillsByCountry(allEntries)

  const activeCountryIds = useMemo(() => {
    const ids = new Set<string>()
    for (const entry of visibleEntries) {
      const countryId = getParentCountryId(entry)
      if (countryId) ids.add(countryId)
    }
    return ids
  }, [visibleEntries])

  // O(1) lookups instead of Array.find()/some() re-scans of visibleEntries
  // (up to ~2,700 provinces over a dense region) on every hover/selection
  // check. Keyed by geometryId, which — for every province — already
  // equals its entityId (see StatesProvinces.tsx's handleHoverChange), so
  // this one map serves both the geometryId-keyed hover lookup and the
  // entityId-keyed selection lookup below. See LOGBOOK.md's "States/
  // provinces FPS" part 7.
  const visibleEntryById = useMemo(() => new Map(visibleEntries.map((entry) => [entry.geometryId, entry])), [visibleEntries])

  useEffect(() => {
    gl.domElement.style.cursor = hoveredId ? 'pointer' : 'auto'
  }, [gl, hoveredId])

  useEffect(() => {
    onHoverChange?.(hoveredId)
  }, [hoveredId, onHoverChange])

  // A hovered province that rotates out of view (excluded by
  // useFrontFacingEntries' next filter pass) doesn't fire a synthetic
  // pointerout — clear stale hover state directly rather than leave it
  // pointing at a geometryId no longer present in `visibleEntries`.
  useEffect(() => {
    if (hoveredId && !visibleEntryById.has(hoveredId)) {
      setHoveredId(null)
    }
  }, [visibleEntryById, hoveredId])

  const selectedEntry = selectedEntityId ? visibleEntryById.get(selectedEntityId) : undefined
  const hoveredEntry = hoveredId ? visibleEntryById.get(hoveredId) : undefined

  // Matches EntityRenderLayer's own fillOpacity for the default/dimmed
  // cases (0.05 / 0.02) — every country mesh renders its provinces
  // uniformly, since "is anything selected" is the only fact that
  // distinguishes them; the selected entry itself gets its own brighter
  // overlay below.
  const baseOpacity = selectedEntityId != null ? 0.02 : 0.05

  return (
    <>
      {[...activeCountryIds].map((countryId) => {
        const countryFill = fillsByCountry.get(countryId)
        if (!countryFill) return null
        return (
          <CountryFillMesh
            key={countryId}
            countryFill={countryFill}
            baseOpacity={baseOpacity}
            onHover={setHoveredId}
            onSelectEntry={onSelect}
            wasDragGesture={wasDragGesture}
          />
        )
      })}
      {selectedEntry?.fillGeometry && (
        <mesh geometry={selectedEntry.fillGeometry} raycast={neverRaycast}>
          <meshBasicMaterial
            color={COLOR_SELECTED}
            transparent
            opacity={0.24}
            side={FrontSide}
            depthWrite={false}
            polygonOffset
            polygonOffsetFactor={OVERLAY_POLYGON_OFFSET}
            polygonOffsetUnits={OVERLAY_POLYGON_OFFSET}
          />
        </mesh>
      )}
      {selectedEntry && (
        <lineSegments geometry={selectedEntry.borderGeometry} raycast={neverRaycast}>
          <lineBasicMaterial color={COLOR_SELECTED} transparent opacity={0.95} />
        </lineSegments>
      )}
      {hoveredEntry && hoveredEntry.entityId !== selectedEntityId && (
        <>
          {hoveredEntry.fillGeometry && (
            <mesh geometry={hoveredEntry.fillGeometry} raycast={neverRaycast}>
              <meshBasicMaterial
                color={COLOR_HOVER}
                transparent
                opacity={0.16}
                side={FrontSide}
                depthWrite={false}
                polygonOffset
                polygonOffsetFactor={OVERLAY_POLYGON_OFFSET}
                polygonOffsetUnits={OVERLAY_POLYGON_OFFSET}
              />
            </mesh>
          )}
          <lineSegments geometry={hoveredEntry.borderGeometry} raycast={neverRaycast}>
            <lineBasicMaterial color={COLOR_HOVER} transparent opacity={0.95} />
          </lineSegments>
          <HoverLabel key={hoveredEntry.geometryId} entry={hoveredEntry} />
        </>
      )}
    </>
  )
}
