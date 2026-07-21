import { Vector3 } from 'three'

/**
 * Converts geographic coordinates to a point on a sphere.
 * lat: degrees, -90 (south) to 90 (north)
 * lng: degrees, -180 (west) to 180 (east)
 * radius: sphere radius
 */
export function latLngToVector3(lat: number, lng: number, radius: number): Vector3 {
  const phi = (90 - lat) * (Math.PI / 180)
  const theta = (lng + 180) * (Math.PI / 180)

  const x = -(radius * Math.sin(phi) * Math.cos(theta))
  const z = radius * Math.sin(phi) * Math.sin(theta)
  const y = radius * Math.cos(phi)

  return new Vector3(x, y, z)
}

export function latLngPathToPoints(path: [number, number][], radius: number): Vector3[] {
  return path.map(([lat, lng]) => latLngToVector3(lat, lng, radius))
}

/**
 * Inverse of latLngToVector3: given a point in the globe's local (unrotated)
 * space, recovers the lat/lng it was projected from.
 */
export function vector3ToLatLng(point: Vector3, radius: number): { lat: number; lng: number } {
  const phi = Math.acos(Math.max(-1, Math.min(1, point.y / radius)))
  const lat = 90 - (phi * 180) / Math.PI
  const sinPhi = Math.sin(phi) || 1e-9
  const theta = Math.atan2(point.z / (radius * sinPhi), -point.x / (radius * sinPhi))
  let lng = (theta * 180) / Math.PI - 180
  while (lng > 180) lng -= 360
  while (lng < -180) lng += 360
  return { lat, lng }
}

// --- Great-circle bearing/distance (v3.2.0) -------------------------------
// Added for src/input/SelectionController.ts's directional entity
// navigation (arrow keys), but kept here rather than in input/ — this is
// generic lat/lng math with no dependency on selection, entities, or
// anything input-specific, exactly the boundary the rest of this file
// already draws. Standard great-circle formulas; both take/return radians
// internally but plain-number lat/lng in degrees at the boundary, matching
// every other function in this file.

function toRadians(degrees: number): number {
  return (degrees * Math.PI) / 180
}

/**
 * Initial compass bearing from `from` to `to`, in radians, where 0 = north,
 * π/2 = east, π = south, -π/2 = west (range: -π to π). Uses the standard
 * great-circle bearing formula rather than a naive `lng2 - lng1`
 * subtraction specifically so it stays correct across the antimeridian
 * (±180°) the same way `scene/countryGeometry.ts`'s ring unwrapping handles
 * it for polygon geometry — see that file's doc comment for why a naive
 * longitude difference breaks down there for the same underlying reason.
 */
export function bearingBetween(
  from: { lat: number; lng: number },
  to: { lat: number; lng: number }
): number {
  const lat1 = toRadians(from.lat)
  const lat2 = toRadians(to.lat)
  const deltaLng = toRadians(to.lng - from.lng)
  const y = Math.sin(deltaLng) * Math.cos(lat2)
  const x = Math.cos(lat1) * Math.sin(lat2) - Math.sin(lat1) * Math.cos(lat2) * Math.cos(deltaLng)
  return Math.atan2(y, x)
}

/**
 * Great-circle angular separation between two points, in radians (0 = same
 * point, π = antipodal) — proportional to true distance but deliberately
 * left as an angle rather than multiplied by Earth's radius, since every
 * caller only ever compares two of these against each other (which
 * candidate is closer), never needs an absolute distance in km/miles.
 */
export function angularDistance(
  from: { lat: number; lng: number },
  to: { lat: number; lng: number }
): number {
  const lat1 = toRadians(from.lat)
  const lat2 = toRadians(to.lat)
  const deltaLat = lat2 - lat1
  const deltaLng = toRadians(to.lng - from.lng)
  const a =
    Math.sin(deltaLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(deltaLng / 2) ** 2
  return 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))
}

/** Normalizes an angle (radians) to the range -π..π — e.g. for comparing two bearings regardless of which side of the ±π wraparound they fall on. */
export function normalizeAngle(radians: number): number {
  let a = radians % (Math.PI * 2)
  if (a > Math.PI) a -= Math.PI * 2
  if (a < -Math.PI) a += Math.PI * 2
  return a
}
