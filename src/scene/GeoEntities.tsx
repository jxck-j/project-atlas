import { useEffect, useMemo, useRef, useState } from 'react'
import { useThree, type ThreeEvent } from '@react-three/fiber'
import { Html, Line } from '@react-three/drei'
import { FrontSide, type Mesh } from 'three'
import { useGeoEntityFeatures } from './useGeoEntityFeatures'
import { buildGeoEntityEntries, type GeoEntityEntry } from './geoEntityEntries'
import { latLngToVector3 } from '../utils/geo'
import { GLOBE_RADIUS } from './constants'
import { selectEntity, useSelection } from '../hud/selectionStore'
import { resolveEntity } from '../entities/EntityResolver'
import { getEntityForGeometry } from '../entities/GeometryMap'

// Renders every non-country GeoEntity (all five v3 classifications — see
// data/types.ts's GeoEntityType) with a real rendered shape. Mirrors
// scene/Countries.tsx closely — same rendering approach (one merged
// border/fill geometry per entity, same hover/select/dim color logic, same
// click-vs-drag threshold), same reason CountryRegistry.ts/
// GeoEntityRegistry.ts are two files instead of one generic Registry<T>:
// kept as its own component rather than generalizing Countries.tsx, so this
// can't regress already-verified country click/highlight behavior.
//
// Deliberately does ONLY primary selection here — no parent/claims overlay
// logic. Those live in src/layers/geoOverlays/ as their own Layer Engine
// layers, reading this same geometry independently, per CLAUDE.md's "don't
// hardcode entity behavior inside Globe rendering components" rule.
//
// Replaces the pre-v3 scene/Territories.tsx.
// FILL_RADIUS is also relevant to this file's click-direction math; the
// matching BORDER_RADIUS lives in scene/geoEntityEntries.ts alongside the
// geometry-building code that actually uses it.
const FILL_RADIUS = GLOBE_RADIUS * 1.0

// Same palette as Countries.tsx, deliberately — a GeoEntity should read as
// "another selectable thing on this globe", not a visually different
// category. What kind of entity it is lives in the data (IntelligencePanel,
// search's type tag), not a special on-globe color language.
const COLOR_DEFAULT = '#7FE9FF'
const COLOR_HOVER = '#FFD24C'
const COLOR_SELECTED = '#FF4D4D'

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

export function GeoEntities() {
  const features = useGeoEntityFeatures()
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

  // Same cursor-styling effect as Countries.tsx, independently. The two
  // components can't both be hovered at once (a pointer hits at most one
  // mesh per raycast), so in the overwhelmingly common case only one of the
  // two effects ever fires per hover change.
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

    // GeometryMap always has this shape's mapping by the time it's
    // clickable (useGeoEntityFeatures.ts registers it as soon as the
    // geometry loads), so getEntityForGeometry should never miss here — the
    // resolveEntity() fallback exists for symmetry with Countries.tsx's
    // handler, not because a real gap is expected.
    const resolved = getEntityForGeometry(entity.geometryId) ?? resolveEntity(entity.entityId)
    if (!resolved) return

    // Normal-selection behavior per the v3 spec: only the clicked entity
    // gets the primary highlight — no automatic selection of claimants,
    // parents, or related entities. Nothing extra to do here; that's
    // already what selectEntity() does.
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
