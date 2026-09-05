// Minimal point-in-polygon + spherical polygon area utilities for the city-
// boundary per-feature join (see city-boundaries-architecture.md's "Second
// refinement"/"Fifth pass" sections) — no turf/topojson dependency, small
// enough to hand-roll and keep dependency-free for this one join.
//
// Deliberately separate from scene/countryGeometry.ts: that file's earcut-
// based triangulation is a rendering concern (turning a polygon into GPU
// triangles); this is a build-time-only geometric query (does point X fall
// inside polygon Y, and how big is Y) that never touches Three.js/earcut at
// all — no reason for a build script to import rendering-layer code.

const EARTH_RADIUS_KM = 6371.0088
const toRad = (deg) => (deg * Math.PI) / 180

function pointInRing([lng, lat], ring) {
  let inside = false
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i]
    const [xj, yj] = ring[j]
    const intersects = yi > lat !== yj > lat && lng < ((xj - xi) * (lat - yi)) / (yj - yi) + xi
    if (intersects) inside = !inside
  }
  return inside
}

// GeoJSON Polygon coordinates: [outerRing, ...holeRings]. A point counts if
// it's in the outer ring and not in any hole.
function pointInPolygonCoords(point, polygonCoords) {
  if (!pointInRing(point, polygonCoords[0])) return false
  for (let i = 1; i < polygonCoords.length; i++) {
    if (pointInRing(point, polygonCoords[i])) return false
  }
  return true
}

export function pointInGeometry(point, geometry) {
  if (geometry.type === 'Polygon') return pointInPolygonCoords(point, geometry.coordinates)
  if (geometry.type === 'MultiPolygon') return geometry.coordinates.some((poly) => pointInPolygonCoords(point, poly))
  throw new Error(`pointInGeometry: unsupported geometry type ${geometry.type}`)
}

// Chamberlain & Duquette spherical polygon area (the same approximation
// Turf.js's `area` module uses) — a signed ring sum scaled by R^2. Hole
// rings wind the opposite direction from the outer ring, so summing them
// with the same formula subtracts their area naturally.
function ringAreaSqKm(ring) {
  if (ring.length < 3) return 0
  let total = 0
  for (let i = 0; i < ring.length; i++) {
    const [lng1, lat1] = ring[i === 0 ? ring.length - 1 : i - 1]
    const [, lat2] = ring[i]
    const [lng3] = ring[(i + 1) % ring.length]
    total += (toRad(lng3) - toRad(lng1)) * Math.sin(toRad(lat2))
  }
  return (total * EARTH_RADIUS_KM * EARTH_RADIUS_KM) / 2
}

function polygonAreaSqKm(polygonCoords) {
  const outer = Math.abs(ringAreaSqKm(polygonCoords[0]))
  let holes = 0
  for (let i = 1; i < polygonCoords.length; i++) holes += Math.abs(ringAreaSqKm(polygonCoords[i]))
  return outer - holes
}

export function geometryAreaSqKm(geometry) {
  if (geometry.type === 'Polygon') return polygonAreaSqKm(geometry.coordinates)
  if (geometry.type === 'MultiPolygon') return geometry.coordinates.reduce((sum, poly) => sum + polygonAreaSqKm(poly), 0)
  throw new Error(`geometryAreaSqKm: unsupported geometry type ${geometry.type}`)
}

// Simple centroid for the city-boundaries-index build: average of the
// largest ring's vertices. Deliberately NOT scene/countryGeometry.ts's
// geometryToCentroid — that one unwraps antimeridian-crossing rings first,
// which this doesn't need for any country this join covers today (Jordan,
// Kuwait sit nowhere near +/-180deg); revisit with the same unwrap
// treatment before ever reusing this for a country that does cross it.
function largestRing(geometry) {
  const polygons = geometry.type === 'Polygon' ? [geometry.coordinates] : geometry.coordinates
  let best = null
  for (const rings of polygons) {
    const exterior = rings[0]
    if (exterior && (!best || exterior.length > best.length)) best = exterior
  }
  return best
}

export function geometryCentroid(geometry) {
  const ring = largestRing(geometry)
  if (!ring || ring.length === 0) return { lat: 0, lng: 0 }
  let sumLng = 0
  let sumLat = 0
  for (const [lng, lat] of ring) {
    sumLng += lng
    sumLat += lat
  }
  return { lat: sumLat / ring.length, lng: sumLng / ring.length }
}

// Plain-JS Douglas-Peucker line simplification, in flat lng/lat space (no
// spherical projection — fine at city-boundary scale, where a polygon never
// spans enough distance for planar-vs-spherical distance to matter visibly).
// Built for scripts/buildCityBoundaries.mjs specifically: some countries'
// geoBoundaries downloads turned out to be unsimplified full-resolution
// source shapefiles rather than pre-simplified data (Panama: one
// corregimiento alone had 631,536 points; Honduras averaged 17,208
// points/feature) — nothing like Jordan/Kuwait's much lighter geometry,
// producing a 291MB/159MB single-country output file, the same "huge flat
// file" mistake this project's US-city-boundaries sharding was built
// specifically to avoid, just from raw vertex density this time instead of
// feature count. Deliberately NOT scene/countryGeometry.ts's earcut/
// antimeridian-unwrap machinery or a topojson-based shared-arc simplify
// (buildCountryTopology.mjs's approach) — these are independent per-city
// Features with no shared borders to preserve between them, so a simple
// per-ring simplify is enough and doesn't need topology at all.
function perpendicularDistance([px, py], [x1, y1], [x2, y2]) {
  const dx = x2 - x1
  const dy = y2 - y1
  if (dx === 0 && dy === 0) return Math.hypot(px - x1, py - y1)
  const t = ((px - x1) * dx + (py - y1) * dy) / (dx * dx + dy * dy)
  const cx = x1 + t * dx
  const cy = y1 + t * dy
  return Math.hypot(px - cx, py - cy)
}

function simplifyRing(points, epsilonDeg) {
  if (points.length < 4) return points // need at least a closed triangle (4 pts w/ repeat) to simplify safely
  let maxDist = 0
  let index = 0
  const first = points[0]
  const last = points[points.length - 1]
  for (let i = 1; i < points.length - 1; i++) {
    const dist = perpendicularDistance(points[i], first, last)
    if (dist > maxDist) {
      maxDist = dist
      index = i
    }
  }
  if (maxDist <= epsilonDeg) return [first, last]
  const left = simplifyRing(points.slice(0, index + 1), epsilonDeg)
  const right = simplifyRing(points.slice(index), epsilonDeg)
  return left.slice(0, -1).concat(right)
}

// Rounds to ~1cm precision (7 decimal places) — geoBoundaries' raw downloads
// carry far more precision than that (15+ decimal digits observed), which
// bloats JSON size for no visible benefit at any zoom this app renders at.
function roundCoord([lng, lat]) {
  return [Math.round(lng * 1e7) / 1e7, Math.round(lat * 1e7) / 1e7]
}

function simplifyPolygonCoords(polygonCoords, epsilonDeg) {
  return polygonCoords.map((ring) => simplifyRing(ring, epsilonDeg).map(roundCoord))
}

export function simplifyGeometry(geometry, epsilonDeg) {
  if (geometry.type === 'Polygon') {
    return { type: 'Polygon', coordinates: simplifyPolygonCoords(geometry.coordinates, epsilonDeg) }
  }
  if (geometry.type === 'MultiPolygon') {
    return {
      type: 'MultiPolygon',
      coordinates: geometry.coordinates.map((poly) => simplifyPolygonCoords(poly, epsilonDeg)),
    }
  }
  throw new Error(`simplifyGeometry: unsupported geometry type ${geometry.type}`)
}
