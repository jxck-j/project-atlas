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
