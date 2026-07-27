import { useEffect, useMemo, useRef, useState } from 'react'
import { useThree, type ThreeEvent } from '@react-three/fiber'
import { Html, Line } from '@react-three/drei'
import { FrontSide, type Mesh } from 'three'
import { useStatesProvincesFeatures } from './useStatesProvincesFeatures'
import { buildGeoEntityEntries, type GeoEntityEntry } from './geoEntityEntries'
import { latLngToVector3 } from '../utils/geo'
import { GLOBE_RADIUS } from './constants'
import { HIGHLIGHT_COLORS } from './highlightColors'
import { selectEntity, useSelection } from '../hud/selectionStore'
import { resolveEntity } from '../entities/EntityResolver'
import { getEntityForGeometry } from '../entities/GeometryMap'

// Renders the 'administrative-division' GeoEntityType (states/provinces) as
// a Layer Engine layer — off by default (see StatesProvincesLayer.tsx),
// since 294 more polygons on top of every country by default would clutter
// the view. Deliberately its own component rather than folding this into
// GeoEntities.tsx: same reasoning CLAUDE.md gives for why GeoEntities.tsx is
// its own file instead of a generalized Countries.tsx — this can't regress
// already-verified GeoEntity click/highlight behavior, and provinces are
// conditionally rendered (toggled) in a way the other five classifications
// aren't.
//
// buildGeoEntityEntries() (scene/geoEntityEntries.ts) already works
// unchanged here — it looks up geometryId in ENTITY_GEOMETRY_IDS and falls
// back to `?? geometryId` when that lookup misses, which is exactly this
// layer's case (every province's geometry id already equals its entity id —
// see useStatesProvincesFeatures.ts), and getEntity() resolves it against
// the same GeoEntityRegistry provinces were registered into. Nothing about
// that function needed to know a sixth classification exists.
const FILL_RADIUS = GLOBE_RADIUS * 1.0

// Same palette as Countries.tsx/GeoEntities.tsx, deliberately — see
// GeoEntities.tsx's comment: what kind of entity this is lives in the data,
// not a special on-globe color language.
const COLOR_DEFAULT = HIGHLIGHT_COLORS.default.hex
const COLOR_HOVER = HIGHLIGHT_COLORS.hovered.hex
const COLOR_SELECTED = HIGHLIGHT_COLORS.selected.hex

const CLICK_MOVE_THRESHOLD = 6
const LARGE_ENTITY_THRESHOLD_DEG = 7

function HoverLabel({ entity }: { entity: GeoEntityEntry }) {
  const isLarge = entity.angularExtent >= LARGE_ENTITY_THRESHOLD_DEG

  const anchor = useMemo(
    () => latLngToVector3(entity.centroid.lat, entity.centroid.lng, GLOBE_RADIUS * 1.006),
    [entity.centroid]
  )
  const calloutPoint = useMemo(
    () => latLngToVector3(entity.centroid.lat, entity.centroid.lng, GLOBE_RADIUS * 1.35),
    [entity.centroid]
  )

  if (isLarge) {
    return (
      <Html position={anchor} center distanceFactor={8} zIndexRange={[20, 0]} style={{ pointerEvents: 'none' }}>
        <div
          className="whitespace-nowrap font-mono text-xs tracking-[0.2em] text-amber-200"
          style={{ textShadow: '0 0 8px rgba(255,210,76,0.85)' }}
        >
          {entity.name.toUpperCase()}
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
          {entity.name.toUpperCase()}
        </div>
      </Html>
    </group>
  )
}

export function StatesProvinces() {
  const features = useStatesProvincesFeatures()
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

  const entities = useMemo<GeoEntityEntry[]>(() => buildGeoEntityEntries(features), [features])

  const hoveredEntity = hoveredId ? entities.find((t) => t.geometryId === hoveredId) : undefined
  const selectedEntity = selected ? entities.find((t) => t.entityId === selected.id) : undefined

  function handlePointerUp(entity: GeoEntityEntry, e: ThreeEvent<PointerEvent>) {
    e.stopPropagation()
    const start = dragStart.current
    if (start) {
      const dx = e.nativeEvent.clientX - start.x
      const dy = e.nativeEvent.clientY - start.y
      if (Math.hypot(dx, dy) > CLICK_MOVE_THRESHOLD) return
    }

    const localCentroid = latLngToVector3(entity.centroid.lat, entity.centroid.lng, FILL_RADIUS)
    const worldPoint = (e.object as Mesh).localToWorld(localCentroid.clone())
    const direction = worldPoint.normalize()

    const resolved = getEntityForGeometry(entity.geometryId) ?? resolveEntity(entity.entityId)
    if (!resolved) return

    selectEntity(resolved, direction)
  }

  return (
    <group>
      {entities.map((entity) => {
        const isSelected = selected?.id === entity.entityId
        const isHovered = hoveredId === entity.geometryId
        const isDimmed = selected != null && !isSelected

        const color = isSelected ? COLOR_SELECTED : isHovered ? COLOR_HOVER : COLOR_DEFAULT
        const fillOpacity = isSelected ? 0.24 : isHovered ? 0.16 : isDimmed ? 0.02 : 0.05
        const lineOpacity = isDimmed ? 0.12 : isSelected || isHovered ? 0.95 : 0.55

        return (
          <group key={entity.geometryId}>
            <lineSegments geometry={entity.borderGeometry}>
              <lineBasicMaterial color={color} transparent opacity={lineOpacity} />
            </lineSegments>
            {entity.fillGeometry && (
              <mesh
                geometry={entity.fillGeometry}
                onPointerOver={(e) => {
                  e.stopPropagation()
                  setHoveredId(entity.geometryId)
                }}
                onPointerOut={(e) => {
                  e.stopPropagation()
                  setHoveredId((current) => (current === entity.geometryId ? null : current))
                }}
                onPointerUp={(e) => handlePointerUp(entity, e)}
                onDoubleClick={(e) => e.stopPropagation()}
              >
                <meshBasicMaterial
                  color={color}
                  transparent
                  opacity={fillOpacity}
                  side={FrontSide}
                  depthWrite={false}
                  polygonOffset
                  polygonOffsetFactor={-1}
                  polygonOffsetUnits={-1}
                />
              </mesh>
            )}
          </group>
        )
      })}
      {selectedEntity && <HoverLabel key={`selected-${selectedEntity.geometryId}`} entity={selectedEntity} />}
      {hoveredEntity && hoveredEntity.geometryId !== selectedEntity?.geometryId && (
        <HoverLabel key={`hovered-${hoveredEntity.geometryId}`} entity={hoveredEntity} />
      )}
    </group>
  )
}
