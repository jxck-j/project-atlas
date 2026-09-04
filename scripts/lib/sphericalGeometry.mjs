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
