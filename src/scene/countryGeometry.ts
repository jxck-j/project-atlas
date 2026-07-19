import earcut, { flatten } from 'earcut'
import { BufferGeometry, Float32BufferAttribute } from 'three'
import type { Geometry, MultiPolygon, Polygon, Position } from 'geojson'
import { latLngToVector3 } from '../utils/geo'

// Walks a ring and shifts each point's longitude by a multiple of 360° so it
// stays within 180° of the previous point. Without this, a ring that crosses
// the antimeridian (e.g. Russia's Far East, ±180°) alternates between ~+180
// and ~-180, which reads to 2D triangulation (and to a naive average) as a
// polygon spanning the entire globe instead of a narrow sliver near the
// dateline.
function unwrapRingLongitudes(ring: Position[]): Position[] {
  if (ring.length === 0) return ring

  const result: Position[] = [ring[0]]
  let prevLng = ring[0][0]

  for (let i = 1; i < ring.length; i++) {
    const [lng, lat] = ring[i]
    let unwrapped = lng
    while (unwrapped - prevLng > 180) unwrapped -= 360
    while (unwrapped - prevLng < -180) unwrapped += 360
    result.push([unwrapped, lat])
    prevLng = unwrapped
  }

  return result
}

// Unwraps every ring of a polygon (exterior + holes) into a shared longitude
// frame: the exterior ring is unwrapped against itself, then each hole's
// starting point is shifted to sit within 180° of the exterior's reference
// point before being unwrapped against itself. Keeps holes consistent with
// their exterior so earcut still cuts them out correctly.
function unwrapPolygonRings(rings: Position[][]): Position[][] {
  if (rings.length === 0) return rings

  const exterior = unwrapRingLongitudes(rings[0])
  const referenceLng = exterior[0][0]
  const unwrapped: Position[][] = [exterior]

  for (let i = 1; i < rings.length; i++) {
    const hole = rings[i]
    if (hole.length === 0) {
      unwrapped.push(hole)
      continue
    }
    let firstLng = hole[0][0]
    while (firstLng - referenceLng > 180) firstLng -= 360
    while (firstLng - referenceLng < -180) firstLng += 360
    const shifted: Position[] = [[firstLng, hole[0][1]], ...hole.slice(1)]
    unwrapped.push(unwrapRingLongitudes(shifted))
  }

  return unwrapped
}

function geometryToPolygons(geometry: Geometry): Position[][][] {
  return geometry.type === 'Polygon'
    ? [(geometry as Polygon).coordinates]
    : geometry.type === 'MultiPolygon'
      ? (geometry as MultiPolygon).coordinates
      : []
}

// GeoJSON coordinates are [lng, lat]. Projects every ring of a country (both
// Polygon and MultiPolygon geometries, exterior rings and holes) onto the
// globe and packs them into ONE flat position array of consecutive [a, b]
// segment pairs, meant to be drawn with a single THREE.LineSegments per
// country rather than one <Line> per ring. A country with several islands
// and enclave holes can easily have 10+ rings — one draw call per ring
// across 193 countries adds up to thousands of draw calls, which is far
// more expensive in practice than the vertex count itself.
export function geometryToBorderSegments(geometry: Geometry, radius: number): Float32Array {
  const polygons = geometryToPolygons(geometry)
  const positions: number[] = []

  for (const rings of polygons) {
    for (const ring of rings) {
      const unwrapped = unwrapRingLongitudes(ring)
      for (let i = 0; i < unwrapped.length - 1; i++) {
        const [lngA, latA] = unwrapped[i]
        const [lngB, latB] = unwrapped[i + 1]
        const a = latLngToVector3(latA, lngA, radius)
        const b = latLngToVector3(latB, lngB, radius)
        positions.push(a.x, a.y, a.z, b.x, b.y, b.z)
      }
    }
  }

  return new Float32Array(positions)
}

// Triangulates every polygon of a country (exterior ring minus holes) via
// earcut in lng/lat space and merges them all into ONE BufferGeometry —
// island nations / archipelagos naturally have several polygons, and (as
// with borders above) rendering each as its own mesh multiplies draw calls
// far more than it needs to for a handful of extra islands.
export function geometryToFillMesh(geometry: Geometry, radius: number): BufferGeometry | null {
  const polygons = geometryToPolygons(geometry)
  const positions: number[] = []
  const indices: number[] = []
  let vertexOffset = 0

  for (const rings of polygons) {
    if (rings.length === 0 || rings[0].length < 3) continue

    const flat = flatten(unwrapPolygonRings(rings))
    const polyIndices = earcut(flat.vertices, flat.holes, flat.dimensions)
    if (polyIndices.length === 0) continue

    for (let i = 0; i < flat.vertices.length; i += 2) {
      const lng = flat.vertices[i]
      const lat = flat.vertices[i + 1]
      const p = latLngToVector3(lat, lng, radius)
      positions.push(p.x, p.y, p.z)
    }
    for (const idx of polyIndices) {
      indices.push(idx + vertexOffset)
    }
    vertexOffset += flat.vertices.length / 2
  }

  if (positions.length === 0) return null

  const geo = new BufferGeometry()
  geo.setAttribute('position', new Float32BufferAttribute(positions, 3))
  geo.setIndex(indices)
  geo.computeVertexNormals()
  return geo
}

// A simple (non-area-weighted) centroid of the largest polygon's exterior
// ring — good enough to aim a camera flight at a country, not meant to be
// a precise geographic centroid.
export function geometryToCentroid(geometry: Geometry): { lat: number; lng: number } {
  const polygons = geometryToPolygons(geometry)

  let best: Position[] | null = null
  for (const rings of polygons) {
    const exterior = rings[0]
    if (exterior && (!best || exterior.length > best.length)) best = exterior
  }
  if (!best || best.length === 0) return { lat: 0, lng: 0 }

  const unwrapped = unwrapRingLongitudes(best)

  let sumLng = 0
  let sumLat = 0
  for (const [lng, lat] of unwrapped) {
    sumLng += lng
    sumLat += lat
  }

  let lng = sumLng / unwrapped.length
  while (lng > 180) lng -= 360
  while (lng < -180) lng += 360

  return { lat: sumLat / unwrapped.length, lng }
}

// Max angular extent (degrees) across latitude and longitude, used to decide
// whether a country is "large" enough on screen for an inline hover label or
// needs a leader-line callout instead. Computed per-polygon (each exterior
// ring unwrapped against itself) since separate polygons of a MultiPolygon
// (e.g. Alaska vs. the continental US) are often far apart and unwrapping
// them against a shared reference wouldn't be meaningful.
export function geometryToAngularExtent(geometry: Geometry): number {
  const polygons = geometryToPolygons(geometry)

  let minLat = Infinity
  let maxLat = -Infinity
  let minLng = Infinity
  let maxLng = -Infinity

  for (const rings of polygons) {
    const exterior = rings[0]
    if (!exterior || exterior.length === 0) continue

    const unwrapped = unwrapRingLongitudes(exterior)
    for (const [lng, lat] of unwrapped) {
      if (lat < minLat) minLat = lat
      if (lat > maxLat) maxLat = lat
      if (lng < minLng) minLng = lng
      if (lng > maxLng) maxLng = lng
    }
  }

  if (!isFinite(minLat)) return 0
  return Math.max(maxLat - minLat, maxLng - minLng)
}
