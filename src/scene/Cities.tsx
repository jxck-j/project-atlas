import { useEffect, useMemo, useRef, useState } from 'react'
import { useThree, type ThreeEvent } from '@react-three/fiber'
import { Html, Line } from '@react-three/drei'
import type { Feature } from 'geojson'
import type { Mesh } from 'three'
import { useCitiesFeatures } from './useCitiesFeatures'
import { latLngToVector3 } from '../utils/geo'
import { GLOBE_RADIUS } from './constants'
import { HIGHLIGHT_COLORS } from './highlightColors'
import { useFrontOfGlobeVisible } from './useFrontOfGlobeVisible'
import { selectEntity, useSelection } from '../hud/selectionStore'
import { resolveEntity } from '../entities/EntityResolver'
import { getEntityForGeometry } from '../entities/GeometryMap'

// Renders the 'city' GeoEntityType (national capitals + major world cities)
// as point markers — genuinely different from every other selectable thing
// on this globe (Countries.tsx, GeoEntities.tsx, StatesProvinces.tsx), which
// all render a merged border/fill polygon mesh. A city is one coordinate,
// not a shape: no earcut triangulation, no antimeridian unwrapping, no
// border segments — just a small sphere at {lat, lng}, the same visual
// primitive PointerMarker.tsx already uses for a single always-shown
// marker, but multiplied to ~223 independently hoverable/clickable
// instances. Kept as its own component/file rather than generalizing
// PointerMarker itself: that component is deliberately passive (no pointer
// handlers, always labeled) for its existing callers (CapitalMarker,
// ClaimsOverlayLayer's related-country marker), and forcing hover/click
// state and conditional labeling into it would complicate call sites that
// don't need either.
const MARKER_RADIUS = GLOBE_RADIUS * 1.006
const CALLOUT_RADIUS = GLOBE_RADIUS * 1.1
const CALLOUT_OFFSET_DEG = 4
const DOT_RADIUS = 0.007

const COLOR_DEFAULT = HIGHLIGHT_COLORS.default.hex
const COLOR_HOVER = HIGHLIGHT_COLORS.hovered.hex
const COLOR_SELECTED = HIGHLIGHT_COLORS.selected.hex

const CLICK_MOVE_THRESHOLD = 6

interface CityEntry {
  id: string
  name: string
  lat: number
  lng: number
}

function buildCityEntries(features: Feature[]): CityEntry[] {
  return features.flatMap((f) => {
    const id = f.id !== undefined && f.id !== null ? String(f.id) : undefined
    if (!id || f.geometry.type !== 'Point') return []
    const [lng, lat] = f.geometry.coordinates
    return [{ id, name: (f.properties?.name as string) ?? 'Unknown', lat, lng }]
  })
}

// Only the *selected* case (persists across camera rotation) actually needs
// the front/back-of-globe gate — a hovered city's dot is only reachable by
// the pointer while front-facing — but checking unconditionally is cheap
// (at most two CityLabels mounted at once) and always correct either way.
// See useFrontOfGlobeVisible.ts and LOGBOOK.md's v5.2.1 entry.
function CityLabel({ entry }: { entry: CityEntry }) {
  const anchor = useMemo(() => latLngToVector3(entry.lat, entry.lng, MARKER_RADIUS), [entry.lat, entry.lng])
  const calloutPoint = useMemo(
    () => latLngToVector3(entry.lat - CALLOUT_OFFSET_DEG, entry.lng + CALLOUT_OFFSET_DEG, CALLOUT_RADIUS),
    [entry.lat, entry.lng]
  )
  const labelVisible = useFrontOfGlobeVisible(calloutPoint)

  return (
    <group>
      {/* Real Three.js object, already correctly depth-tested against the
          core sphere — only the Html label below needs the explicit gate. */}
      <Line points={[anchor, calloutPoint]} color="#FFD24C" lineWidth={1} transparent opacity={0.85} />
      {labelVisible && (
        <Html position={calloutPoint} center distanceFactor={8} zIndexRange={[20, 0]} style={{ pointerEvents: 'none' }}>
          <div
            className="whitespace-nowrap text-xs tracking-[0.2em] text-amber-200"
            style={{ textShadow: '0 0 8px rgba(255,210,76,0.85)' }}
          >
            {entry.name.toUpperCase()}
          </div>
        </Html>
      )}
    </group>
  )
}

export function Cities() {
  const features = useCitiesFeatures()
  const { gl } = useThree()
  const { selected } = useSelection()
  const [hoveredId, setHoveredId] = useState<string | null>(null)
  const dragStart = useRef<{ x: number; y: number } | null>(null)

  useEffect(() => {
    const onDown = (e: PointerEvent) => {
      dragStart.current = { x: e.clientX, y: e.clientY }
    }
    window.addEventListener('pointerdown', onDown)
    return () => window.removeEventListener('pointerdown', onDown)
  }, [])

  useEffect(() => {
    gl.domElement.style.cursor = hoveredId ? 'pointer' : 'auto'
  }, [gl, hoveredId])

  const entries = useMemo(() => buildCityEntries(features), [features])

  const hoveredEntry = hoveredId ? entries.find((e) => e.id === hoveredId) : undefined
  const selectedEntry = selected ? entries.find((e) => e.id === selected.id) : undefined

  function handlePointerUp(entry: CityEntry, e: ThreeEvent<PointerEvent>) {
    e.stopPropagation()
    const start = dragStart.current
    if (start) {
      const dx = e.nativeEvent.clientX - start.x
      const dy = e.nativeEvent.clientY - start.y
      if (Math.hypot(dx, dy) > CLICK_MOVE_THRESHOLD) return
    }

    const anchor = latLngToVector3(entry.lat, entry.lng, MARKER_RADIUS)
    const worldPoint = (e.object as Mesh).localToWorld(anchor.clone())
    const direction = worldPoint.normalize()

    const resolved = getEntityForGeometry(entry.id) ?? resolveEntity(entry.id)
    if (!resolved) return

    selectEntity(resolved, direction)
  }

  return (
    <group>
      {entries.map((entry) => {
        const isSelected = selected?.id === entry.id
        const isHovered = hoveredId === entry.id
        const color = isSelected ? COLOR_SELECTED : isHovered ? COLOR_HOVER : COLOR_DEFAULT
        const anchor = latLngToVector3(entry.lat, entry.lng, MARKER_RADIUS)

        return (
          <mesh
            key={entry.id}
            position={anchor}
            onPointerOver={(e) => {
              e.stopPropagation()
              setHoveredId(entry.id)
            }}
            onPointerOut={(e) => {
              e.stopPropagation()
              setHoveredId((current) => (current === entry.id ? null : current))
            }}
            onPointerUp={(e) => handlePointerUp(entry, e)}
            onDoubleClick={(e) => e.stopPropagation()}
          >
            <sphereGeometry args={[DOT_RADIUS, 8, 8]} />
            <meshBasicMaterial color={color} transparent opacity={isSelected || isHovered ? 1 : 0.75} />
          </mesh>
        )
      })}
      {selectedEntry && <CityLabel key={`selected-${selectedEntry.id}`} entry={selectedEntry} />}
      {hoveredEntry && hoveredEntry.id !== selectedEntry?.id && (
        <CityLabel key={`hovered-${hoveredEntry.id}`} entry={hoveredEntry} />
      )}
    </group>
  )
}
