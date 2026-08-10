import earcut, { flatten } from 'earcut'
import { BufferGeometry, Float32BufferAttribute } from 'three'
import type { Geometry, LineString, MultiLineString, MultiPolygon, Polygon, Position } from 'geojson'
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

function geometryToPolylines(geometry: Geometry): Position[][] {
  return geometry.type === 'LineString'
    ? [(geometry as LineString).coordinates]
    : geometry.type === 'MultiLineString'
      ? (geometry as MultiLineString).coordinates
      : []
}

// 2026-08-08: rivers (LineString/MultiLineString, unlike every other
// geometry this file handles) have no ring to close and no interior to
// fill — geometryToPolygons() returns [] for this geometry type, so
// geometryToBorderSegments/geometryToFillMesh silently produce empty
// output for it. This is the line equivalent of geometryToBorderSegments:
// same "one flat Float32Array of segment pairs per feature, one
// THREE.LineSegments draw call" reasoning, same antimeridian-unwrap
// handling, just walking a line's own points directly instead of a
// polygon ring.
export function geometryToLineSegments(geometry: Geometry, radius: number): Float32Array {
  const lines = geometryToPolylines(geometry)
  const positions: number[] = []

  for (const line of lines) {
    const unwrapped = unwrapRingLongitudes(line)
    for (let i = 0; i < unwrapped.length - 1; i++) {
      const [lngA, latA] = unwrapped[i]
      const [lngB, latB] = unwrapped[i + 1]
      const a = latLngToVector3(latA, lngA, radius)
      const b = latLngToVector3(latB, lngB, radius)
      positions.push(a.x, a.y, a.z, b.x, b.y, b.z)
    }
  }

  return new Float32Array(positions)
}

// 2026-08-07: a documented, real defect (see BACKLOG.md and LOGBOOK.md) —
// a subset of country fill meshes (Brazil, Russia, Canada, USA, Australia,
// Antarctica) render an opaque black gap over part of their interior.
// Root-caused this pass: earcut triangulates correctly in flat lng/lat
// space (its own `deviation()` check, and this codebase's existing
// per-triangle winding check, both already confirmed that), but a large,
// concave country can produce a legitimate "ear" triangle spanning 20-30+
// degrees of arc — one single triangle covering a big notch of coastline.
// The GPU rasterizes each triangle as a FLAT plane in 3D between its three
// projected corners; it has no idea the surface it's approximating is
// curved. For a triangle that wide, the flat plane's middle sags measurably
// *inward* from the sphere's true curved surface — verified directly for
// Brazil's worst offending triangle: its interior dips ~3% of GLOBE_RADIUS
// below the nominal fill radius, well past the opaque core sphere sitting
// only ~2% inward (`Globe.tsx`'s `RADIUS * 0.98`). The core sphere then
// occludes that sagging patch from the camera, rendering black.
//
// Fix: after earcut, recursively subdivide any triangle whose chord sags
// more than a safe margin, splitting its longest edge (in lng/lat space —
// safe here because unwrapPolygonRings() already resolved any antimeridian
// wraparound before earcut ever ran, so a triangle's own vertices are
// always in one consistent, unwrapped longitude frame) until every emitted
// triangle's flat chord stays close enough to the true sphere to be
// visually indistinguishable from it. This is a one-time cost when a
// country's geometry is built (memoized upstream via useMemo), not a
// per-frame cost.
const MAX_CHORD_SAG_FRACTION = 0.0015
// Longest-edge bisection only shrinks the ONE edge picked each split — the
// other two edges of a very obtuse/scalene triangle carry over unchanged
// into each child, so convergence isn't a flat "halves every edge every
// level." Checked empirically: Brazil's real worst-offending triangle
// converges right around depth 8 (uncomfortably close to a cap that size),
// and a deliberately wider synthetic test triangle needed depth 9 and
// still failed at 8. 14 gives real margin over both at negligible cost —
// this only adds triangles in the handful of regions that actually need
// it, not globally (confirmed: Brazil's ~3,610 triangles become ~3,984).
const MAX_SUBDIVISION_DEPTH = 14

function triangleMaxSag(p0: Position, p1: Position, p2: Position, radius: number): number {
  const v0 = latLngToVector3(p0[1], p0[0], radius)
  const v1 = latLngToVector3(p1[1], p1[0], radius)
  const v2 = latLngToVector3(p2[1], p2[0], radius)

  // Samples the 3 edge midpoints and the centroid — cheap, and catches the
  // worst dip for the wide/obtuse "ear" triangles this fix targets (their
  // interior sag is dominated by their longest edge, not deep interior
  // points far from every edge).
  const samples = [
    [(v0.x + v1.x) / 2, (v0.y + v1.y) / 2, (v0.z + v1.z) / 2],
    [(v1.x + v2.x) / 2, (v1.y + v2.y) / 2, (v1.z + v2.z) / 2],
    [(v2.x + v0.x) / 2, (v2.y + v0.y) / 2, (v2.z + v0.z) / 2],
    [(v0.x + v1.x + v2.x) / 3, (v0.y + v1.y + v2.y) / 3, (v0.z + v1.z + v2.z) / 3],
  ]

  let maxSag = 0
  for (const [x, y, z] of samples) {
    const sampleRadius = Math.sqrt(x * x + y * y + z * z)
    maxSag = Math.max(maxSag, radius - sampleRadius)
  }
  return maxSag
}

// Emits one earcut triangle (as [lng, lat] corners) into positions/indices,
// recursively splitting its longest edge first whenever its chord sag is
// still above the safe threshold. depth caps recursion on pathological
// input (e.g. a triangle spanning close to half the globe) — 8 levels
// quarters edge length ~256x, far more than any real country needs.
function emitTriangle(
  p0: Position,
  p1: Position,
  p2: Position,
  radius: number,
  positions: number[],
  indices: number[],
  depth: number
): void {
  const sag = triangleMaxSag(p0, p1, p2, radius)
  if (depth >= MAX_SUBDIVISION_DEPTH || sag <= radius * MAX_CHORD_SAG_FRACTION) {
    const base = positions.length / 3
    for (const [lng, lat] of [p0, p1, p2]) {
      const v = latLngToVector3(lat, lng, radius)
      positions.push(v.x, v.y, v.z)
    }
    indices.push(base, base + 1, base + 2)
    return
  }

  const d01 = (p0[0] - p1[0]) ** 2 + (p0[1] - p1[1]) ** 2
  const d12 = (p1[0] - p2[0]) ** 2 + (p1[1] - p2[1]) ** 2
  const d20 = (p2[0] - p0[0]) ** 2 + (p2[1] - p0[1]) ** 2

  if (d01 >= d12 && d01 >= d20) {
    const mid: Position = [(p0[0] + p1[0]) / 2, (p0[1] + p1[1]) / 2]
    emitTriangle(p0, mid, p2, radius, positions, indices, depth + 1)
    emitTriangle(mid, p1, p2, radius, positions, indices, depth + 1)
  } else if (d12 >= d20) {
    const mid: Position = [(p1[0] + p2[0]) / 2, (p1[1] + p2[1]) / 2]
    emitTriangle(p1, mid, p0, radius, positions, indices, depth + 1)
    emitTriangle(mid, p2, p0, radius, positions, indices, depth + 1)
  } else {
    const mid: Position = [(p2[0] + p0[0]) / 2, (p2[1] + p0[1]) / 2]
    emitTriangle(p2, mid, p1, radius, positions, indices, depth + 1)
    emitTriangle(mid, p0, p1, radius, positions, indices, depth + 1)
  }
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

  for (const rings of polygons) {
    if (rings.length === 0 || rings[0].length < 3) continue

    const flat = flatten(unwrapPolygonRings(rings))
    const polyIndices = earcut(flat.vertices, flat.holes, flat.dimensions)
    if (polyIndices.length === 0) continue

    for (let i = 0; i < polyIndices.length; i += 3) {
      const ia = polyIndices[i]
      const ib = polyIndices[i + 1]
      const ic = polyIndices[i + 2]
      const p0: Position = [flat.vertices[ia * 2], flat.vertices[ia * 2 + 1]]
      const p1: Position = [flat.vertices[ib * 2], flat.vertices[ib * 2 + 1]]
      const p2: Position = [flat.vertices[ic * 2], flat.vertices[ic * 2 + 1]]
      emitTriangle(p0, p1, p2, radius, positions, indices, 0)
    }
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
// needs a leader-line callout instead (and, since v5.2.4, to estimate a
// label's actual apparent on-screen size — see labelDeclutter.ts's
// apparentSizePx). Computed per-polygon — each exterior ring unwrapped
// against ONLY ITSELF, with the single largest resulting span taken as the
// answer — since separate polygons of a MultiPolygon (e.g. Alaska/Hawaii vs.
// the continental US, Kaliningrad vs. the rest of Russia) are often
// genuinely far apart, and a combined bounding box across all of them
// doesn't represent "how big does the landmass under this country's label
// actually look" (the label sits on the single largest piece — see
// geometryToCentroid's "largest ring by point count" rule — not on some
// point in the empty space between disconnected exclaves).
//
// 2026-08-09: previously combined every ring's independently-unwrapped
// points into ONE running min/max — for a country whose separate polygons
// straddle the antimeridian on different "branches" of the ±180° wrap (any
// country with an Arctic/Pacific exclave far from its mainland: Russia's
// Kaliningrad and Far East, the USA's Hawaii and Alaska), that combined the
// two branches' longitudes as if they were part of one bounding box,
// producing nonsense (Russia computed as ~503°, well past the 360° a real
// bounding box can even span) that then broke downstream trig math
// (apparentSizePx's `sin` of a bogus half-angle past 180° flips sign,
// making both of these countries' labels register as having ~0 or negative
// apparent size and always fall back to their abbreviation, even at close
// zoom — reported directly: "why is the USA abbreviated, it has one of the
// largest footprints"). Taking the max PER-RING span instead can't produce
// that kind of runaway value (a single connected ring's own unwrap never
// needs to cross more than one dateline), and happens to also match this
// function's original documented intent, which the old combined-bounding-
// box code didn't actually implement despite what its own comment said.
// Known accepted tradeoff, not a new regression: a true multi-island
// archipelago that doesn't cross the antimeridian (Indonesia, Philippines)
// reports only its single largest island's extent, undercounting the
// visual spread of the whole nation — real, but nowhere near as wrong as
// the bug this replaced, and not something reported as an issue.
//
// 2026-08-09 (v5.2.6): "a single connected ring's own unwrap never needs to
// cross more than one dateline" (above) turned out to have one exception:
// Antarctica's coastline ring runs all the way around the pole, touching
// every longitude, rather than just dipping near the antimeridian once.
// `unwrapRingLongitudes` still "works" on it in the sense that it doesn't
// throw or produce a per-point error, but the CUMULATIVE drift as you
// walk all the way around a pole-encircling ring means its last point
// unwraps to roughly 360° away from its first, even though they're the
// same physical point (rings are closed) — the min/max longitude then
// spans a nonsense-for-this-purpose ~360°, and `sin(360°/2) = sin(180°) ≈
// 0` in `apparentSizePx` collapses Antarctica's apparent size to zero at
// every zoom level, always falling back to its abbreviation ("Antarctica
// is abbreviated even zoomed all the way out, despite having plenty of
// room"). A normal ring — even a huge one, even one that legitimately
// crosses the antimeridian once (Russia's mainland) — always closes back
// to within a few degrees of its own starting unwrapped longitude, because
// the unwrap direction it drifted during the ring cancels out by the time
// it returns to its own start; only a ring that encircles a pole doesn't
// cancel out, since it keeps drifting the same direction all the way
// around. That gives a cheap, reliable detector with a huge margin (~0 vs
// ~360, no real ring lands in between): if a ring's unwrapped last point
// is more than 180° from its unwrapped first point, it encircles a pole,
// and its longitude span is meaningless (it "spans" every longitude by
// definition) — only its latitude span (how far it reaches from the pole)
// says anything real about its size.
export function geometryToAngularExtent(geometry: Geometry): number {
  const polygons = geometryToPolygons(geometry)

  let maxExtent = 0

  for (const rings of polygons) {
    const exterior = rings[0]
    if (!exterior || exterior.length === 0) continue

    const unwrapped = unwrapRingLongitudes(exterior)
    let minLat = Infinity
    let maxLat = -Infinity
    let minLng = Infinity
    let maxLng = -Infinity
    for (const [lng, lat] of unwrapped) {
      if (lat < minLat) minLat = lat
      if (lat > maxLat) maxLat = lat
      if (lng < minLng) minLng = lng
      if (lng > maxLng) maxLng = lng
    }

    const closureGapDeg = Math.abs(unwrapped[unwrapped.length - 1][0] - unwrapped[0][0])
    const encirclesPole = closureGapDeg > 180
    const ringExtent = encirclesPole ? maxLat - minLat : Math.max(maxLat - minLat, maxLng - minLng)
    if (ringExtent > maxExtent) maxExtent = ringExtent
  }

  return maxExtent
}
