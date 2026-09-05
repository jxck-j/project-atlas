import { useMemo, useRef, useState } from 'react'
import type { RefObject } from 'react'
import { useFrame, useThree } from '@react-three/fiber'
import { Html } from '@react-three/drei'
import { BufferGeometry, FrontSide, Float32BufferAttribute, Vector3, type Object3D } from 'three'
import type { Feature, MultiPolygon, Polygon, Position } from 'geojson'
import { useLakesFeatures } from './useLakesFeatures'
import { geometryToBorderSegments, geometryToFillMesh } from './countryGeometry'
import { GLOBE_RADIUS, CAMERA_MIN_DISTANCE } from './constants'
import { coreSphereRef } from './coreSphereRef'
import { getGlobeRotationY } from './globeRotation'
import { declutterLabels, type DeclutterCandidate } from './labelDeclutter'
import { latLngToVector3 } from '../utils/geo'

// Small radius bump above nominal (GLOBE_RADIUS * 1.0, the land fill's own
// radius) — same "sit visibly on top, avoid z-fighting" reasoning every
// other overlay in this codebase uses (see ParentOverlayLayer.tsx's
// OVERLAY_RADIUS_FACTOR), not because lakes are meant to read as physically
// raised.
const FILL_RADIUS = GLOBE_RADIUS * 1.001
const BORDER_RADIUS = GLOBE_RADIUS * 1.0015
// 2026-08-08: was a translucent blue fill (#3FA9E0 @ 35% opacity) over the
// solid land underneath — reported directly as geographically wrong,
// because the land fill has no actual hole where a lake sits (confirmed:
// the US country polygon has zero interior holes anywhere, so a lake
// toggled off — or, with the old translucent fill, even toggled on —
// still showed as solid land through/under the tint). A true geometric
// cutout (subtracting lake polygons from country/state polygons at build
// time) was the alternative, rejected as too large a change for this
// pass — new polygon-clipping dependency, touches the core country/states
// build pipeline, and doesn't help rivers either way (no area to
// subtract from a line). This fill is opaque pitch black instead — the
// same color as the ocean/core sphere — so a lake reads as real open
// water regardless of what the land geometry underneath actually is,
// without touching that geometry at all. The border stays a thin cyan
// outline (WATER_LINE_COLOR) purely to define the shoreline shape against
// the near-black land around it, which itself sits at very low fill
// opacity most of the time (see EntityRenderLayer.tsx).
const FILL_COLOR = '#000000'
const WATER_LINE_COLOR = '#67E8F9'

// Anchored to CAMERA_MIN_DISTANCE (constants.ts, 2.5 — the closest the
// camera can physically get), not an independently-chosen number, so
// "zoomed all the way in" is the literal, only condition under which any
// lake label can appear. +0.3, not +0.1: US_CITY_FOCUS_DISTANCE
// (constants.ts, GLOBE_RADIUS * 1.1 = 2.64 — where a search-driven "fly to
// this US city" flight actually lands) needs to already be inside this
// threshold, confirmed directly via a debug console.log while testing this
// feature — 2.64 is already "zoomed all the way into a specific place" for
// any practical purpose, and a smaller margin left that whole (very common)
// path never revealing any lake label at all, only a manual scroll past it.
const LABEL_REVEAL_DISTANCE = CAMERA_MIN_DISTANCE + 0.3
const MAJOR_SCALERANK_MAX = 1

// Merges every lake feature's fill/border geometry into ONE BufferGeometry
// each — same "one draw call per layer, not one per feature" reasoning
// countryGeometry.ts's own functions already apply within a single
// MultiPolygon country. Lakes have no per-feature interactivity (see this
// module's own header comment below), so there's no reason to keep 412
// separate meshes the way Countries.tsx keeps one mesh per country for
// click/hover purposes.
function mergeLakeGeometry(features: Feature[], fillRadius: number, borderRadius: number) {
  const fillPositions: number[] = []
  const fillIndices: number[] = []
  const borderPositions: number[] = []

  for (const f of features) {
    const fillGeo = geometryToFillMesh(f.geometry, fillRadius)
    if (fillGeo) {
      const posArray = fillGeo.attributes.position.array
      const base = fillPositions.length / 3
      for (let i = 0; i < posArray.length; i++) fillPositions.push(posArray[i])

      const indexArray = fillGeo.index?.array
      if (indexArray) {
        for (let i = 0; i < indexArray.length; i++) fillIndices.push(indexArray[i] + base)
      }
    }

    const segments = geometryToBorderSegments(f.geometry, borderRadius)
    for (let i = 0; i < segments.length; i++) borderPositions.push(segments[i])
  }

  const fillGeometry = new BufferGeometry()
  fillGeometry.setAttribute('position', new Float32BufferAttribute(fillPositions, 3))
  fillGeometry.setIndex(fillIndices)
  fillGeometry.computeVertexNormals()

  const borderGeometry = new BufferGeometry()
  borderGeometry.setAttribute('position', new Float32BufferAttribute(borderPositions, 3))

  return { fillGeometry, borderGeometry }
}

// 2026-08-08: countryGeometry.ts's shared geometryToCentroid() is a plain
// average of a ring's own vertices — fine for the country-scale uses it's
// documented for (aiming a camera flight, hover-label placement on a
// roughly-convex landmass), but reported directly as landing labels
// visibly outside the lake for elongated/crescent/reservoir shapes, which
// this dataset has plenty of (long, narrow reservoirs especially). This is
// the true area-weighted centroid of a simple polygon (the standard
// "centroid of a polygon" shoelace-adjacent formula) instead of a vertex
// average — it's pulled toward where the polygon's actual AREA is
// concentrated, not wherever a ring happens to have more sample points,
// which keeps it inside the shape for any polygon that isn't pathologically
// concave (a reasonable bet for a lake shoreline). Kept local to this file
// rather than added to countryGeometry.ts's shared, tested
// geometryToCentroid — that function's existing contract (and its Vitest
// coverage) is deliberately about a different, simpler notion of centroid,
// and countries/GeoEntities have never reported this problem in practice.
function polygonAreaCentroid(ring: Position[]): { lat: number; lng: number } {
  let areaSum = 0
  let cxSum = 0
  let cySum = 0

  for (let i = 0; i < ring.length - 1; i++) {
    const [x0, y0] = ring[i]
    const [x1, y1] = ring[i + 1]
    const cross = x0 * y1 - x1 * y0
    areaSum += cross
    cxSum += (x0 + x1) * cross
    cySum += (y0 + y1) * cross
  }

  const area = areaSum / 2
  // Degenerate ring (zero area, e.g. a near-collinear sliver) — fall back
  // to a plain vertex average rather than dividing by ~0.
  if (Math.abs(area) < 1e-10) {
    let sumLng = 0
    let sumLat = 0
    for (const [lng, lat] of ring) {
      sumLng += lng
      sumLat += lat
    }
    return { lng: sumLng / ring.length, lat: sumLat / ring.length }
  }

  return { lng: cxSum / (6 * area), lat: cySum / (6 * area) }
}

function lakeLabelCentroid(geometry: Feature['geometry']): { lat: number; lng: number } {
  const polygons: Position[][][] =
    geometry.type === 'Polygon'
      ? [(geometry as Polygon).coordinates]
      : geometry.type === 'MultiPolygon'
        ? (geometry as MultiPolygon).coordinates
        : []

  // Same "pick the largest part" reasoning geometryToCentroid uses for a
  // MultiPolygon — labeling wherever the biggest piece of the lake is,
  // not an average across disconnected parts that could land in the gap
  // between them.
  let best: Position[] | null = null
  for (const rings of polygons) {
    const exterior = rings[0]
    if (exterior && (!best || exterior.length > best.length)) best = exterior
  }
  if (!best || best.length < 4) return { lat: 0, lng: 0 }

  return polygonAreaCentroid(best)
}

// Deliberately NOT extending DeclutterCandidate — that interface requires
// `worldPosition`, which depends on the globe's current rotation and so is
// only meaningful computed fresh each throttled frame (see the useFrame
// below), not stored alongside the rest of a candidate's static data.
interface LakeCandidate {
  id: string
  name: string
  major: boolean
  localPosition: Vector3
  spacingRadiusPx: number
}

// Sorted major-first (declutterLabels reads its input as already
// priority-ordered) — a small lake losing its spot to a bigger one nearby
// is the same "let zoom, not a zoom-tier table, be what unlocks more
// labels" behavior CityLabels.tsx already established for cities.
function buildLakeCandidates(features: Feature[]): LakeCandidate[] {
  const candidates = features.flatMap((f) => {
    const name = (f.properties?.name as string | null) ?? null
    if (!name) return []
    const scalerank = (f.properties?.scalerank as number | undefined) ?? 6
    const { lat, lng } = lakeLabelCentroid(f.geometry)
    const localPosition = latLngToVector3(lat, lng, GLOBE_RADIUS * 1.002)
    return [{ id: name, name, major: scalerank <= MAJOR_SCALERANK_MAX, localPosition, spacingRadiusPx: 24 }]
  })
  return candidates.sort((a, b) => Number(b.major) - Number(a.major))
}

// 2026-08-08, second pass: the first version rendered a separate <Html> DOM
// element for every named lake (up to ~320) the instant the camera crossed
// LABEL_REVEAL_DISTANCE, regardless of whether that specific lake was
// anywhere near what the camera was actually framing — reported directly
// as tanking FPS, and (since Html billboards independently of the 3D scene)
// reading as a swarm of text "swimming" around rather than calm, sparse
// labels the way WaterLabels' 27 hand-curated water bodies do. Rebuilt on
// CityLabels.tsx's existing labelDeclutter.ts machinery instead of a
// bespoke fix — the exact same "many candidates, show only a small,
// spaced-out, currently-on-screen subset" problem this app already solved
// once, tested, for 32,608 city candidates. A far smaller MAX_VISIBLE_LABELS
// than CityLabels' 120 (lake names are a sparse detail layer, not a
// primary map feature) is what actually gives the "just a couple of names
// near where you're looking" feel that was being asked for.
const OCCLUDER_RADIUS = GLOBE_RADIUS * 0.98 // matches Globe.tsx's core sphere
const MIN_LABEL_SPACING_PX = 40
const MAX_VISIBLE_LABELS = 12
const DECLUTTER_INTERVAL_MS = 150

const ROTATION_AXIS = new Vector3(0, 1, 0)

function LakeLabels({ visible }: { visible: LakeCandidate[] }) {
  return (
    <group>
      {visible.map((candidate) => (
        <Html
          key={candidate.id}
          position={candidate.localPosition}
          center
          occlude={[coreSphereRef as RefObject<Object3D>]}
          // 2026-08-08: dropped distanceFactor entirely — that prop scales
          // an Html label's apparent size in proportion to how close the
          // camera is to its anchor point, and this layer only ever shows
          // labels within a very narrow, EXTREME close-range zoom band
          // (LABEL_REVEAL_DISTANCE, barely above CAMERA_MIN_DISTANCE).
          // With distanceFactor still set, even a 3px CSS size rendered as
          // text spanning most of the screen — confirmed directly in a
          // live browser. CityLabels.tsx already solved exactly this:
          // its own comment says almost word for word "deliberately NO
          // distanceFactor... this label set is shown down to this app's
          // closest zoom," for the identical reason. Fixed pixel sizes
          // below are sized to match, not scaled by proximity.
          zIndexRange={[1, 0]}
          style={{ pointerEvents: 'none' }}
        >
          <div
            className={`whitespace-nowrap italic text-cyan-300/35 ${
              candidate.major ? 'text-[7px] tracking-[0.06em]' : 'text-[6px] tracking-[0.04em]'
            }`}
          >
            {candidate.name}
          </div>
        </Html>
      ))}
    </group>
  )
}

// Decorative-only layer — no click-to-select, no GeoEntity record, no
// EntityResolver/GeometryMap integration. Lakes are physical geography, not
// political entities; see GEO_ENGINE_README.md's "Lakes & rivers" section
// for the full reasoning behind that call.
export function Lakes() {
  const features = useLakesFeatures()
  const { camera, size } = useThree()
  const [visible, setVisible] = useState<LakeCandidate[]>([])
  const lastRun = useRef(0)

  const { fillGeometry, borderGeometry } = useMemo(
    () => mergeLakeGeometry(features, FILL_RADIUS, BORDER_RADIUS),
    [features]
  )
  const candidates = useMemo(() => buildLakeCandidates(features), [features])

  useFrame((state) => {
    const now = state.clock.elapsedTime * 1000
    if (now - lastRun.current < DECLUTTER_INTERVAL_MS) return
    lastRun.current = now

    if (camera.position.length() >= LABEL_REVEAL_DISTANCE) {
      if (visible.length > 0) setVisible([])
      return
    }

    const rotationY = getGlobeRotationY()
    const withWorldPosition: (LakeCandidate & DeclutterCandidate)[] = candidates.map((c) => ({
      ...c,
      worldPosition: c.localPosition.clone().applyAxisAngle(ROTATION_AXIS, rotationY),
    }))
    const next = declutterLabels(
      withWorldPosition,
      camera,
      size.width,
      size.height,
      OCCLUDER_RADIUS,
      MIN_LABEL_SPACING_PX,
      MAX_VISIBLE_LABELS
    )
    setVisible(next)
  })

  if (features.length === 0) return null

  return (
    <group>
      <mesh geometry={fillGeometry}>
        <meshBasicMaterial color={FILL_COLOR} side={FrontSide} />
      </mesh>
      <lineSegments geometry={borderGeometry}>
        <lineBasicMaterial color={WATER_LINE_COLOR} transparent opacity={0.6} />
      </lineSegments>
      <LakeLabels visible={visible} />
    </group>
  )
}
