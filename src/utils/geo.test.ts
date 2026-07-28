import { describe, expect, it } from 'vitest'
import { angularDistance, bearingBetween, normalizeAngle } from './geo'

// Hand-verified cases, not snapshots — every expected value below is either
// an exact geometric fact (a bearing/distance you can derive on paper) or a
// known invariant of the formula itself, not "whatever the function
// currently returns."

describe('bearingBetween', () => {
  // Cardinal directions from the equator/prime-meridian origin are exactly
  // 0 (north), π/2 (east), π (south), -π/2 (west) — no floating-point
  // approximation needed to state the expected value.
  it('points due north when only latitude increases', () => {
    expect(bearingBetween({ lat: 0, lng: 0 }, { lat: 10, lng: 0 })).toBeCloseTo(0, 10)
  })

  it('points due east when only longitude increases', () => {
    expect(bearingBetween({ lat: 0, lng: 0 }, { lat: 0, lng: 10 })).toBeCloseTo(Math.PI / 2, 10)
  })

  it('points due south when only latitude decreases', () => {
    expect(bearingBetween({ lat: 0, lng: 0 }, { lat: -10, lng: 0 })).toBeCloseTo(Math.PI, 10)
  })

  it('points due west when only longitude decreases', () => {
    expect(bearingBetween({ lat: 0, lng: 0 }, { lat: 0, lng: -10 })).toBeCloseTo(-Math.PI / 2, 10)
  })

  // The doc comment claims this stays correct across the antimeridian the
  // same way countryGeometry.ts's ring unwrapping does. Going from 170°E to
  // -170°E (== 190°E) is a 20° eastward step through the dateline, not the
  // 340° westward step a naive `to.lng - from.lng` subtraction would see —
  // the formula must still resolve this to "due east" (π/2).
  it('resolves a step across the antimeridian to the short way around', () => {
    expect(bearingBetween({ lat: 0, lng: 170 }, { lat: 0, lng: -170 })).toBeCloseTo(Math.PI / 2, 10)
  })
})

describe('angularDistance', () => {
  it('is zero for the same point', () => {
    expect(angularDistance({ lat: 12, lng: 34 }, { lat: 12, lng: 34 })).toBeCloseTo(0, 10)
  })

  // A quarter of the equator (0°,0°) -> (0°,90°) is exactly a quarter
  // great-circle: π/2 radians.
  it('is a quarter circle (π/2) a quarter of the way around the equator', () => {
    expect(angularDistance({ lat: 0, lng: 0 }, { lat: 0, lng: 90 })).toBeCloseTo(Math.PI / 2, 10)
  })

  // Equator to the north pole is also exactly a quarter great-circle.
  it('is a quarter circle (π/2) from the equator to the pole', () => {
    expect(angularDistance({ lat: 0, lng: 0 }, { lat: 90, lng: 0 })).toBeCloseTo(Math.PI / 2, 10)
  })

  // Antipodal points (opposite sides of the sphere) are exactly π radians
  // apart, the maximum possible great-circle distance.
  it('is π (antipodal) for opposite sides of the sphere', () => {
    expect(angularDistance({ lat: 0, lng: 0 }, { lat: 0, lng: 180 })).toBeCloseTo(Math.PI, 10)
  })

  // sin((θ-360°)/2) = -sin(θ/2) is an exact trig identity, and the haversine
  // formula only ever uses this term squared — so a longitude difference
  // written as -358° (crossing the dateline "the long way" numerically)
  // must give the IDENTICAL result to the true short way (+2°), not the
  // ~358° a naive distance would compute. This is the antimeridian-safety
  // property the countryGeometry.ts unwrapping exists for, expressed here
  // for the distance formula instead of geometry.
  it('treats a dateline-crossing pair as ~2° apart, not ~358°', () => {
    const short = angularDistance({ lat: 0, lng: 0 }, { lat: 0, lng: 2 })
    const acrossDateline = angularDistance({ lat: 0, lng: 179 }, { lat: 0, lng: -179 })
    expect(acrossDateline).toBeCloseTo(short, 10)
  })
})

describe('normalizeAngle', () => {
  it('leaves angles already within -π..π unchanged', () => {
    expect(normalizeAngle(0)).toBeCloseTo(0, 10)
    expect(normalizeAngle(Math.PI / 2)).toBeCloseTo(Math.PI / 2, 10)
    expect(normalizeAngle(-Math.PI / 2)).toBeCloseTo(-Math.PI / 2, 10)
  })

  // The boundary itself: the function's `> Math.PI` / `< -Math.PI` checks
  // are strict, so exactly π and exactly -π both pass through unchanged
  // rather than being folded into each other.
  it('leaves the +/-π boundary itself unchanged', () => {
    expect(normalizeAngle(Math.PI)).toBeCloseTo(Math.PI, 10)
    expect(normalizeAngle(-Math.PI)).toBeCloseTo(-Math.PI, 10)
  })

  // 270° (1.5π) is equivalent to -90° (-0.5π) once wrapped into -π..π.
  it('wraps an angle just past +π down past the negative side', () => {
    expect(normalizeAngle(1.5 * Math.PI)).toBeCloseTo(-0.5 * Math.PI, 10)
  })

  // -270° (-1.5π) is equivalent to +90° (0.5π).
  it('wraps an angle just past -π up past the positive side', () => {
    expect(normalizeAngle(-1.5 * Math.PI)).toBeCloseTo(0.5 * Math.PI, 10)
  })

  // A full extra turn (2π) should have no effect at all.
  it('is invariant under adding a full turn', () => {
    expect(normalizeAngle(2.5 * Math.PI)).toBeCloseTo(0.5 * Math.PI, 10)
    expect(normalizeAngle(-2.5 * Math.PI)).toBeCloseTo(-0.5 * Math.PI, 10)
  })
})
