import { describe, expect, it } from 'vitest'
import earcut, { deviation, flatten } from 'earcut'
import type { LineString, MultiLineString, Polygon, MultiPolygon, Position } from 'geojson'
import { latLngToVector3 } from '../utils/geo'
import {
  geometryToAngularExtent,
  geometryToBorderSegments,
  geometryToCentroid,
  geometryToFillMesh,
  geometryToLineSegments,
} from './countryGeometry'

// A simple 10x10-degree square, centered nowhere near the antimeridian —
// the "nothing special going on" control case.
const SIMPLE_SQUARE: Polygon = {
  type: 'Polygon',
  coordinates: [
    [
      [-10, -10],
      [10, -10],
      [10, 10],
      [-10, 10],
      [-10, -10],
    ],
  ],
}

// A 20-degree-wide sliver straddling the dateline: from 170°E to 170°W
// (== 190°E), latitude -10..10. Written the way real GeoJSON for a country
// like Fiji or Russia's Far East would be — using raw -170, not a
// pre-unwrapped 190 — specifically to exercise unwrapRingLongitudes.
const ANTIMERIDIAN_SLIVER: Polygon = {
  type: 'Polygon',
  coordinates: [
    [
      [170, -10],
      [-170, -10],
      [-170, 10],
      [170, 10],
      [170, -10],
    ],
  ],
}

describe('geometryToCentroid', () => {
  // Plain average of the 5 ring points (including the repeated closing
  // point) — this function is documented as "not a precise geographic
  // centroid," so the plain arithmetic mean IS the correct expected value:
  // lngs (-10,10,10,-10,-10) sum to -10, /5 = -2; lats (-10,-10,10,10,-10)
  // sum to -10, /5 = -2.
  it('averages a simple square\'s ring points directly', () => {
    expect(geometryToCentroid(SIMPLE_SQUARE)).toEqual({ lat: -2, lng: -2 })
  })

  // Without unwrapping, naively averaging (170, -170, -170, 170, 170) gives
  // 34 -- a meaningless point nowhere near the actual shape. Correctly
  // unwrapped (170, 190, 190, 170, 170), the average is 178, which
  // normalizes to itself (already within -180..180) -- landing inside the
  // sliver, on the 170-190 side, exactly where the shape's extra weight
  // from the two 190-valued points pulls it.
  it('unwraps a dateline-straddling ring before averaging, instead of producing a garbage centroid', () => {
    const centroid = geometryToCentroid(ANTIMERIDIAN_SLIVER)
    expect(centroid.lat).toBeCloseTo(-2, 10)
    expect(centroid.lng).toBeCloseTo(178, 10)
  })

  // "Best" = the polygon with the longest exterior ring (see the function's
  // own doc comment) -- a small triangle plus a larger pentagon should pick
  // the pentagon's centroid, not the triangle's and not an average of both.
  it('picks the polygon with the longest exterior ring out of a MultiPolygon', () => {
    const triangle: Position[] = [
      [0, 0],
      [1, 0],
      [0, 1],
      [0, 0],
    ]
    const pentagon: Position[] = [
      [48, 48],
      [52, 48],
      [53, 50],
      [50, 52],
      [47, 50],
      [48, 48],
    ]
    const multi: MultiPolygon = { type: 'MultiPolygon', coordinates: [[triangle], [pentagon]] }

    const expected = geometryToCentroid({ type: 'Polygon', coordinates: [pentagon] })
    expect(geometryToCentroid(multi)).toEqual(expected)
  })
})

describe('geometryToAngularExtent', () => {
  it('is 20 for a simple 20-degree-wide/tall square', () => {
    expect(geometryToAngularExtent(SIMPLE_SQUARE)).toBeCloseTo(20, 10)
  })

  // Naively, minLng=-170/maxLng=170 would give a 340-degree "extent" --
  // wildly wrong for a shape that's actually 20 degrees wide. Unwrapped,
  // the true range is 170..190, an extent of 20.
  it('is 20 (not ~340) for the dateline-straddling sliver', () => {
    expect(geometryToAngularExtent(ANTIMERIDIAN_SLIVER)).toBeCloseTo(20, 10)
  })

  // 2026-08-09: previously combined every polygon's independently-unwrapped
  // points into one running bounding box, spanning the gap between two
  // far-apart polygons as if they were one shape — for a real MultiPolygon
  // country with a distant exclave (Russia's Kaliningrad vs. its Far East,
  // the USA's Alaska/Hawaii vs. the mainland), that meant the "how big does
  // this look" answer partly reflected the empty ocean between disconnected
  // pieces, not either piece's own size. Now takes the MAX of each
  // polygon's own independently-computed extent instead — matching what
  // this function is actually used for (sizing the single landmass a label
  // sits on, not the union of every disconnected piece a country owns). See
  // LOGBOOK.md's v5.2.4 entry.
  it('takes the larger polygon\'s own extent, not a combined bounding box across the gap', () => {
    const small: Position[] = [
      [0, 0],
      [5, 0],
      [5, 5],
      [0, 5],
      [0, 0],
    ]
    const large: Position[] = [
      [50, 50],
      [90, 50],
      [90, 90],
      [50, 90],
      [50, 50],
    ]
    const multi: MultiPolygon = { type: 'MultiPolygon', coordinates: [[small], [large]] }
    // Each polygon's own extent: small=5, large=40. Max is 40 — NOT the
    // combined-bbox 90 that would span the gap between them (lat 0..90,
    // lng 0..90).
    expect(geometryToAngularExtent(multi)).toBeCloseTo(40, 10)
  })

  // The actual real-world bug this replaced: two exclaves of the same
  // country on OPPOSITE branches of the antimeridian wrap, each unwrapped
  // independently (correctly, in isolation) but then combined into one
  // running min/max with no shared reference between them — e.g. Russia's
  // Kaliningrad (~20°E) and Far East (~170°E, which some geometry unwraps
  // toward -190°E instead depending on which points precede it) reportedly
  // combined into a ~503-degree "extent", an impossible value for any real
  // bounding box (max possible is 360) that then broke downstream trig in
  // labelDeclutter.ts's apparentSizePx (sin of a bogus half-angle past 180°
  // flips sign) — surfaced as "why does the USA/Russia abbreviate, they
  // have huge footprints."
  it('does not produce an impossible (>360 degree) result for exclaves on opposite antimeridian branches', () => {
    const westExclave: Position[] = [
      [19, 54],
      [20, 54],
      [20, 55],
      [19, 55],
      [19, 54],
    ]
    const eastExclave: Position[] = [
      [-170, 66],
      [-169, 66],
      [-169, 67],
      [-170, 67],
      [-170, 66],
    ]
    const multi: MultiPolygon = { type: 'MultiPolygon', coordinates: [[westExclave], [eastExclave]] }
    // Each exclave is individually tiny (~1 degree across); the max of the
    // two independent, correctly-bounded extents should be small — nowhere
    // near the ~500+ degrees the old combined-bounding-box bug produced.
    expect(geometryToAngularExtent(multi)).toBeLessThan(5)
  })
})

describe('geometryToBorderSegments', () => {
  // A triangle over three points with exactly-known projections:
  // (lat 0, lng 0)   -> (r, 0, 0)
  // (lat 0, lng -90) -> (0, 0, r)   [-(r*sin90*cos90)=0, r*sin90*sin90=r... see below]
  // (lat 90, lng 0)  -> (0, r, 0)   [the north pole, independent of lng]
  // Derived directly from latLngToVector3's formula (phi=(90-lat)*pi/180,
  // theta=(lng+180)*pi/180, x=-(r*sin(phi)*cos(theta)), y=r*cos(phi),
  // z=r*sin(phi)*sin(theta)) rather than guessed, so this doubles as a
  // cross-check that geometryToBorderSegments feeds the right lat/lng into
  // that function in the right order.
  const RADIUS = 5
  const TRIANGLE: Polygon = {
    type: 'Polygon',
    coordinates: [
      [
        [0, 0],
        [-90, 0],
        [0, 90],
        [0, 0],
      ],
    ],
  }

  it('emits (ringPoints - 1) segments of 6 floats each', () => {
    const segments = geometryToBorderSegments(TRIANGLE, RADIUS)
    // 4 ring points (including the closing duplicate) -> 3 segments -> 18 floats.
    expect(segments.length).toBe(18)
  })

  it('projects each segment endpoint through latLngToVector3 with the unwrapped lat/lng', () => {
    const segments = Array.from(geometryToBorderSegments(TRIANGLE, RADIUS))
    const p0 = latLngToVector3(0, 0, RADIUS)
    const p1 = latLngToVector3(0, -90, RADIUS)
    const p2 = latLngToVector3(90, 0, RADIUS)

    const expected = [
      p0.x, p0.y, p0.z, p1.x, p1.y, p1.z, // segment 0: p0 -> p1
      p1.x, p1.y, p1.z, p2.x, p2.y, p2.z, // segment 1: p1 -> p2
      p2.x, p2.y, p2.z, p0.x, p0.y, p0.z, // segment 2: p2 -> p0 (closing)
    ]
    for (let i = 0; i < expected.length; i++) {
      expect(segments[i]).toBeCloseTo(expected[i], 5)
    }
  })

  it('merges a MultiPolygon into one array, equal to the concatenation of its parts', () => {
    const squareA: Polygon = {
      type: 'Polygon',
      coordinates: [
        [
          [0, 0],
          [10, 0],
          [10, 10],
          [0, 10],
          [0, 0],
        ],
      ],
    }
    const squareB: Polygon = {
      type: 'Polygon',
      coordinates: [
        [
          [100, 0],
          [110, 0],
          [110, 10],
          [100, 10],
          [100, 0],
        ],
      ],
    }
    const multi: MultiPolygon = { type: 'MultiPolygon', coordinates: [squareA.coordinates, squareB.coordinates] }

    const segmentsA = geometryToBorderSegments(squareA, RADIUS)
    const segmentsB = geometryToBorderSegments(squareB, RADIUS)
    const combined = geometryToBorderSegments(multi, RADIUS)

    expect(combined.length).toBe(segmentsA.length + segmentsB.length)
    expect(Array.from(combined)).toEqual([...Array.from(segmentsA), ...Array.from(segmentsB)])
  })
})

// 2026-08-08: geometryToLineSegments is the LineString/MultiLineString
// equivalent of geometryToBorderSegments above (added for rivers, which
// have no ring to close and no interior — see countryGeometry.ts's own
// comment on this function). Mirrors that describe block's structure and
// reuses the exact same three-point projection derivation, since a
// LineString is just an unclosed version of the same ring data
// geometryToBorderSegments already walks.
describe('geometryToLineSegments', () => {
  const RADIUS = 5
  const OPEN_LINE: LineString = {
    type: 'LineString',
    coordinates: [
      [0, 0],
      [-90, 0],
      [0, 90],
    ],
  }

  it('emits (points - 1) segments of 6 floats each, and does NOT close the ring', () => {
    const segments = geometryToLineSegments(OPEN_LINE, RADIUS)
    // 3 points, unclosed -> 2 segments -> 12 floats (not 18, which a closed
    // triangle would give — this is the key behavioral difference from
    // geometryToBorderSegments).
    expect(segments.length).toBe(12)
  })

  it('projects each segment endpoint through latLngToVector3 in point order', () => {
    const segments = Array.from(geometryToLineSegments(OPEN_LINE, RADIUS))
    const p0 = latLngToVector3(0, 0, RADIUS)
    const p1 = latLngToVector3(0, -90, RADIUS)
    const p2 = latLngToVector3(90, 0, RADIUS)

    const expected = [
      p0.x, p0.y, p0.z, p1.x, p1.y, p1.z, // segment 0: p0 -> p1
      p1.x, p1.y, p1.z, p2.x, p2.y, p2.z, // segment 1: p1 -> p2
      // no closing segment back to p0 -- that's the whole point of a line
    ]
    for (let i = 0; i < expected.length; i++) {
      expect(segments[i]).toBeCloseTo(expected[i], 5)
    }
  })

  it('merges a MultiLineString into one array, equal to the concatenation of its parts', () => {
    const lineA: LineString = {
      type: 'LineString',
      coordinates: [
        [0, 0],
        [10, 0],
        [10, 10],
      ],
    }
    const lineB: LineString = {
      type: 'LineString',
      coordinates: [
        [100, 0],
        [110, 0],
      ],
    }
    const multi: MultiLineString = { type: 'MultiLineString', coordinates: [lineA.coordinates, lineB.coordinates] }

    const segmentsA = geometryToLineSegments(lineA, RADIUS)
    const segmentsB = geometryToLineSegments(lineB, RADIUS)
    const combined = geometryToLineSegments(multi, RADIUS)

    expect(combined.length).toBe(segmentsA.length + segmentsB.length)
    expect(Array.from(combined)).toEqual([...Array.from(segmentsA), ...Array.from(segmentsB)])
  })

  it('returns an empty array for Polygon geometry (not its job)', () => {
    const segments = geometryToLineSegments(SIMPLE_SQUARE, RADIUS)
    expect(segments.length).toBe(0)
  })
})

describe('geometryToFillMesh', () => {
  it('returns null when every ring is degenerate (fewer than 3 points)', () => {
    const degenerate: Polygon = { type: 'Polygon', coordinates: [[[0, 0], [1, 1]]] }
    expect(geometryToFillMesh(degenerate, 5)).toBeNull()
  })

  it('triangulates a simple polygon into a valid, non-empty index list', () => {
    const geo = geometryToFillMesh(SIMPLE_SQUARE, 5)
    expect(geo).not.toBeNull()
    const indexCount = geo!.index!.count
    expect(indexCount).toBeGreaterThanOrEqual(3) // at least one triangle
    expect(indexCount % 3).toBe(0) // triangles only, never a partial one
    expect(geo!.attributes.position.count * 3).toBe(geo!.attributes.position.array.length)
  })

  it('does not throw and still produces a valid mesh for a dateline-straddling polygon', () => {
    const geo = geometryToFillMesh(ANTIMERIDIAN_SLIVER, 5)
    expect(geo).not.toBeNull()
    expect(geo!.index!.count % 3).toBe(0)
    expect(geo!.index!.count).toBeGreaterThanOrEqual(3)
  })

  // earcut.deviation() is this codebase's own documented correctness check
  // for antimeridian handling (see CLAUDE.md's Country geometry section:
  // "verify with earcut.deviation() ... it should be ~0, not ~1+"). Since
  // unwrapRingLongitudes isn't exported, this reimplements just enough of
  // its documented algorithm (shift each point by +/-360 to stay within
  // 180 degrees of the previous one) to build an independent reference: if
  // this hand-rolled unwrap is correct, feeding its output to earcut must
  // triangulate cleanly. That's the same property geometryToFillMesh's real
  // (unexported) unwrap step is relied upon to provide internally.
  it('a correctly unwrapped dateline ring triangulates with ~0 earcut deviation', () => {
    function unwrapRing(ring: Position[]): Position[] {
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

    const raw = ANTIMERIDIAN_SLIVER.coordinates[0]
    const unwrapped = unwrapRing(raw)
    // Sanity check on the reference itself: 170 -> 190, not left at -170.
    expect(unwrapped.map(([lng]) => lng)).toEqual([170, 190, 190, 170, 170])

    const flat = flatten([unwrapped])
    const indices = earcut(flat.vertices, flat.holes, flat.dimensions)
    const result = deviation(flat.vertices, flat.holes, flat.dimensions, indices)
    expect(result).toBeLessThan(0.01)
  })

  it('merges a MultiPolygon into one geometry, equal in size to the sum of its parts', () => {
    const squareA: Polygon = {
      type: 'Polygon',
      coordinates: [
        [
          [0, 0],
          [10, 0],
          [10, 10],
          [0, 10],
          [0, 0],
        ],
      ],
    }
    const squareB: Polygon = {
      type: 'Polygon',
      coordinates: [
        [
          [100, 0],
          [110, 0],
          [110, 10],
          [100, 10],
          [100, 0],
        ],
      ],
    }
    const multi: MultiPolygon = { type: 'MultiPolygon', coordinates: [squareA.coordinates, squareB.coordinates] }

    const geoA = geometryToFillMesh(squareA, 5)!
    const geoB = geometryToFillMesh(squareB, 5)!
    const combined = geometryToFillMesh(multi, 5)!

    expect(combined.attributes.position.count).toBe(geoA.attributes.position.count + geoB.attributes.position.count)
    expect(combined.index!.count).toBe(geoA.index!.count + geoB.index!.count)
  })
})

// 2026-08-07/08: covers the "black gap" defect documented in BACKLOG.md and
// in this file's own header comment above geometryToFillMesh — confirmed
// (via a standalone script against the real shipped countries-un193.json)
// to be caused by a single wide earcut "ear" triangle whose flat 3D chord
// sags measurably below the sphere's true curved surface once projected,
// dipping past the opaque core sphere and rendering black. A 3-point ring
// this wide is structurally the same shape as the real offending triangle
// found in Brazil's mainland polygon (earcut of a bare triangle just
// returns it unchanged, so this exercises the exact same "one huge flat
// triangle" case without needing the full 3,613-point real ring).
describe('geometryToFillMesh subdivides wide triangles (black-gap fix)', () => {
  const WIDE_TRIANGLE: Polygon = {
    type: 'Polygon',
    coordinates: [
      [
        [-40, -30],
        [40, -20],
        [-10, 35],
        [-40, -30],
      ],
    ],
  }
  const RADIUS = 5
  // Mirrors countryGeometry.ts's own MAX_CHORD_SAG_FRACTION -- re-derived
  // here (not imported) so this is a black-box check against
  // geometryToFillMesh's actual output, not a test of the internal
  // constant's value.
  const MAX_CHORD_SAG_FRACTION = 0.0015

  it('emits more than one triangle for a single wide input triangle', () => {
    const geo = geometryToFillMesh(WIDE_TRIANGLE, RADIUS)!
    expect(geo).not.toBeNull()
    // A naive (unfixed) triangulation of a bare 3-point ring is exactly one
    // triangle -- more than that proves subdivision actually ran.
    expect(geo.index!.count / 3).toBeGreaterThan(1)
  })

  it('keeps every output triangle\'s chord within the safe sag bound', () => {
    const geo = geometryToFillMesh(WIDE_TRIANGLE, RADIUS)!
    const pos = geo.attributes.position.array
    const idx = geo.index!.array
    const maxSafeSag = RADIUS * MAX_CHORD_SAG_FRACTION * 1.01 // 1% slack for float rounding

    const at = (vertexIndex: number): [number, number, number] => [
      pos[vertexIndex * 3],
      pos[vertexIndex * 3 + 1],
      pos[vertexIndex * 3 + 2],
    ]
    const midpoint = (a: [number, number, number], b: [number, number, number]): [number, number, number] => [
      (a[0] + b[0]) / 2,
      (a[1] + b[1]) / 2,
      (a[2] + b[2]) / 2,
    ]
    const radiusOf = ([x, y, z]: [number, number, number]) => Math.sqrt(x * x + y * y + z * z)

    for (let i = 0; i < idx.length; i += 3) {
      const a = at(idx[i])
      const b = at(idx[i + 1])
      const c = at(idx[i + 2])
      for (const edgeMid of [midpoint(a, b), midpoint(b, c), midpoint(c, a)]) {
        const sag = RADIUS - radiusOf(edgeMid)
        expect(sag).toBeLessThanOrEqual(maxSafeSag)
      }
    }
  })

  it('leaves a small triangle (e.g. Luxembourg-scale) untouched', () => {
    // A triangle far too small to sag meaningfully shouldn't be subdivided
    // at all -- confirms the fix is targeted, not a blanket re-tessellation
    // of every country's geometry.
    const SMALL_TRIANGLE: Polygon = {
      type: 'Polygon',
      coordinates: [
        [
          [5.8, 49.5],
          [6.2, 49.5],
          [6.0, 49.9],
          [5.8, 49.5],
        ],
      ],
    }
    const geo = geometryToFillMesh(SMALL_TRIANGLE, RADIUS)!
    expect(geo.index!.count / 3).toBe(1)
  })
})
