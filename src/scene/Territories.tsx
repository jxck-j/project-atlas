import { useEffect, useMemo, useRef, useState } from 'react'
import { useThree, type ThreeEvent } from '@react-three/fiber'
import { Html, Line } from '@react-three/drei'
import { BufferGeometry, Float32BufferAttribute, FrontSide, type Mesh } from 'three'
import { useTerritoryFeatures } from './useTerritoryFeatures'
import {
  geometryToAngularExtent,
  geometryToBorderSegments,
  geometryToCentroid,
  geometryToFillMesh,
} from './countryGeometry'
import { latLngToVector3 } from '../utils/geo'
import { GLOBE_RADIUS } from './constants'
import { selectEntity, useSelection } from '../hud/selectionStore'
import { resolveEntity } from '../entities/EntityResolver'
import { getEntityForGeometry } from '../entities/GeometryMap'
import { getTerritory } from '../data'
import { TERRITORY_GEOMETRY_IDS } from '../entities/territoryGeometryIds'

// Mirrors scene/Countries.tsx closely — same rendering approach (one merged
// border/fill geometry per entity, same hover/select/dim color logic, same
// click-vs-drag threshold), same reason CountryRegistry.ts/
// TerritoryRegistry.ts are two files instead of one generic Registry<T>:
// kept as its own small component rather than generalizing Countries.tsx,
// so this addition can't regress already-verified country click/highlight
// behavior. See CLAUDE.md/LOGBOOK.md.
const BORDER_RADIUS = GLOBE_RADIUS * 1.004
const FILL_RADIUS = GLOBE_RADIUS * 1.0

// Same palette as Countries.tsx, deliberately — a territory should read as
// "another selectable thing on this globe", not a visually different
// category. What kind of entity it is lives in the data (IntelligencePanel,
// search's COUNTRY/TERRITORY tag), not a special on-globe color language.
const COLOR_DEFAULT = '#7FE9FF'
const COLOR_HOVER = '#FFD24C'
const COLOR_SELECTED = '#FF4D4D'

const CLICK_MOVE_THRESHOLD = 6
const LARGE_TERRITORY_THRESHOLD_DEG = 7

interface TerritoryEntry {
  // The rendered shape's own id (a raw ISO numeric code, e.g. "158") — used
  // for hover state and as the GeometryMap lookup key. Deliberately NOT the
  // same as entityId: unlike Countries.tsx (where a polygon's feature id
  // and its country id are the same string by construction), GeometryMap
  // exists specifically so a shape's id and the entity it resolves to CAN
  // differ. selectionStore's `selected.id` is always the resolved entity's
  // id ("taiwan"), never the geometry id — comparing geometryId against
  // `selected.id` directly (as an earlier version of this file did) means
  // isSelected is never true for a selected territory, which renders it as
  // permanently dimmed instead of highlighted. See LOGBOOK.md.
  geometryId: string
  entityId: string
  name: string
  centroid: { lat: number; lng: number }
  angularExtent: number
  borderGeometry: BufferGeometry
  fillGeometry: BufferGeometry | null
}

function HoverLabel({ territory }: { territory: TerritoryEntry }) {
  const isLarge = territory.angularExtent >= LARGE_TERRITORY_THRESHOLD_DEG

  const anchor = useMemo(
    () => latLngToVector3(territory.centroid.lat, territory.centroid.lng, GLOBE_RADIUS * 1.006),
    [territory.centroid]
  )
  const calloutPoint = useMemo(
    () => latLngToVector3(territory.centroid.lat, territory.centroid.lng, GLOBE_RADIUS * 1.35),
    [territory.centroid]
  )

  if (isLarge) {
    return (
      <Html position={anchor} center distanceFactor={8} zIndexRange={[20, 0]} style={{ pointerEvents: 'none' }}>
        <div
          className="whitespace-nowrap font-mono text-xs tracking-[0.2em] text-amber-200"
          style={{ textShadow: '0 0 8px rgba(255,210,76,0.85)' }}
        >
          {territory.name.toUpperCase()}
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
          {territory.name.toUpperCase()}
        </div>
      </Html>
    </group>
  )
}

export function Territories() {
  const features = useTerritoryFeatures()
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
  // two effects ever fires per hover change. The one edge case — the
  // pointer moving directly between an adjacent country and territory shape
  // in a single frame, so both effects fire in the same commit — can very
  // briefly leave the wrong cursor showing; it self-corrects on the next
  // hover change. Not worth a shared hover-cursor store for that.
  useEffect(() => {
    gl.domElement.style.cursor = hoveredId ? 'pointer' : 'auto'
  }, [gl, hoveredId])

  const territories = useMemo<TerritoryEntry[]>(() => {
    return features.flatMap((f) => {
      const geometryId = f.id !== undefined && f.id !== null ? String(f.id) : undefined
      const entityId = geometryId ? TERRITORY_GEOMETRY_IDS[geometryId] : undefined
      if (!geometryId || !entityId) return []

      // Prefer the registered Territory's real display name ("Western
      // Sahara") over the raw source name ("W. Sahara") — the geometry file
      // doesn't rename features the way buildCountryTopology.mjs's
      // DISPLAY_NAME_OVERRIDES does for countries, so the nicer name lives
      // in TerritoryRegistry instead.
      const name = getTerritory(entityId)?.name ?? (f.properties?.name as string) ?? 'Unknown'

      const borderGeometry = new BufferGeometry()
      borderGeometry.setAttribute(
        'position',
        new Float32BufferAttribute(geometryToBorderSegments(f.geometry, BORDER_RADIUS), 3)
      )

      return [
        {
          geometryId,
          entityId,
          name,
          centroid: geometryToCentroid(f.geometry),
          angularExtent: geometryToAngularExtent(f.geometry),
          borderGeometry,
          fillGeometry: geometryToFillMesh(f.geometry, FILL_RADIUS),
        },
      ]
    })
  }, [features])

  const hoveredTerritory = hoveredId ? territories.find((t) => t.geometryId === hoveredId) : undefined
  const selectedTerritory = selected ? territories.find((t) => t.entityId === selected.id) : undefined

  function handlePointerUp(territory: TerritoryEntry, e: ThreeEvent<PointerEvent>) {
    e.stopPropagation()
    const start = dragStart.current
    if (start) {
      const dx = e.nativeEvent.clientX - start.x
      const dy = e.nativeEvent.clientY - start.y
      if (Math.hypot(dx, dy) > CLICK_MOVE_THRESHOLD) return
    }

    const localCentroid = latLngToVector3(territory.centroid.lat, territory.centroid.lng, FILL_RADIUS)
    const worldPoint = (e.object as Mesh).localToWorld(localCentroid.clone())
    const direction = worldPoint.normalize()

    // GeometryMap always has this shape's mapping by the time it's
    // clickable (useTerritoryFeatures.ts registers it as soon as the
    // geometry loads), so getEntityForGeometry should never miss here — the
    // resolveEntity() fallback exists for symmetry with Countries.tsx's
    // handler, not because a real gap is expected.
    const resolved = getEntityForGeometry(territory.geometryId) ?? resolveEntity(territory.entityId)
    if (!resolved) return

    selectEntity(resolved, direction)
  }

  return (
    <group>
      {territories.map((territory) => {
        const isSelected = selected?.id === territory.entityId
        const isHovered = hoveredId === territory.geometryId
        const isDimmed = selected != null && !isSelected

        const color = isSelected ? COLOR_SELECTED : isHovered ? COLOR_HOVER : COLOR_DEFAULT
        const fillOpacity = isSelected ? 0.24 : isHovered ? 0.16 : isDimmed ? 0.02 : 0.05
        const lineOpacity = isDimmed ? 0.12 : isSelected || isHovered ? 0.95 : 0.55

        return (
          <group key={territory.geometryId}>
            <lineSegments geometry={territory.borderGeometry}>
              <lineBasicMaterial color={color} transparent opacity={lineOpacity} />
            </lineSegments>
            {territory.fillGeometry && (
              <mesh
                geometry={territory.fillGeometry}
                onPointerOver={(e) => {
                  e.stopPropagation()
                  setHoveredId(territory.geometryId)
                }}
                onPointerOut={(e) => {
                  e.stopPropagation()
                  setHoveredId((current) => (current === territory.geometryId ? null : current))
                }}
                onPointerUp={(e) => handlePointerUp(territory, e)}
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
      {selectedTerritory && (
        <HoverLabel key={`selected-${selectedTerritory.geometryId}`} territory={selectedTerritory} />
      )}
      {hoveredTerritory && hoveredTerritory.geometryId !== selectedTerritory?.geometryId && (
        <HoverLabel key={`hovered-${hoveredTerritory.geometryId}`} territory={hoveredTerritory} />
      )}
    </group>
  )
}
