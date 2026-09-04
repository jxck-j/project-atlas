// Assembles an Overpass `out geom;` relation (boundary=administrative,
// role=outer/inner way segments with inline geometry) into GeoJSON-shaped
// Polygon/MultiPolygon coordinates. Standard greedy endpoint-stitching —
// OSM boundary relations are almost always several way segments that need
// connecting into closed rings, not one closed way each (verified against
// Jordan's real admin_level=6 data: 89/89 relations needed stitching, 0 had
// a single already-closed outer way).
function eqPoint(a, b) {
  return a[0] === b[0] && a[1] === b[1]
}

function stitchToRings(segments) {
  const remaining = segments.map((s) => s.slice())
  const rings = []
  while (remaining.length) {
    let current = remaining.shift()
    let progress = true
    while (!eqPoint(current[0], current[current.length - 1]) && progress) {
      progress = false
      for (let i = 0; i < remaining.length; i++) {
        const seg = remaining[i]
        if (eqPoint(current[current.length - 1], seg[0])) {
          current = current.concat(seg.slice(1))
        } else if (eqPoint(current[current.length - 1], seg[seg.length - 1])) {
          current = current.concat(seg.slice(0, -1).reverse())
        } else if (eqPoint(current[0], seg[seg.length - 1])) {
          current = seg.slice(0, -1).concat(current)
        } else if (eqPoint(current[0], seg[0])) {
          current = seg.slice(1).reverse().concat(current)
        } else {
          continue
        }
        remaining.splice(i, 1)
        progress = true
        break
      }
    }
    rings.push(current)
  }
  return rings
}

// relation: an Overpass element with .members[] each having role + geometry
// ([{lat,lon}, ...]). Returns { geometry: GeoJSON MultiPolygon, closed:
// boolean, outerRingCount, innerRingCount }. `closed: false` is a real
// data-completeness signal (a ring that never made it back to its start
// point — missing way data) — callers should skip/flag those rather than
// silently rendering a malformed polygon.
export function relationToGeometry(relation) {
  const outerSegs = relation.members.filter((m) => m.role === 'outer' && m.geometry).map((m) => m.geometry.map((p) => [p.lon, p.lat]))
  const innerSegs = relation.members.filter((m) => m.role === 'inner' && m.geometry).map((m) => m.geometry.map((p) => [p.lon, p.lat]))

  const outerRings = stitchToRings(outerSegs)
  const innerRings = stitchToRings(innerSegs)

  let closed = true
  for (const r of [...outerRings, ...innerRings]) {
    if (!eqPoint(r[0], r[r.length - 1])) closed = false
  }

  // Assign each hole to whichever outer ring's bbox contains its first
  // point. Good enough here (Jordan/Kuwait have zero inner rings in
  // practice) — a real winding/containment check would be needed for a
  // country whose relations actually have holes.
  const polygons = outerRings.map((outer) => [outer])
  for (const hole of innerRings) {
    const [hx, hy] = hole[0]
    const owner = polygons.find(([outer]) => {
      const lons = outer.map((p) => p[0])
      const lats = outer.map((p) => p[1])
      return hx >= Math.min(...lons) && hx <= Math.max(...lons) && hy >= Math.min(...lats) && hy <= Math.max(...lats)
    })
    if (owner) owner.push(hole)
  }

  return {
    geometry: { type: 'MultiPolygon', coordinates: polygons },
    closed,
    outerRingCount: outerRings.length,
    innerRingCount: innerRings.length,
  }
}
