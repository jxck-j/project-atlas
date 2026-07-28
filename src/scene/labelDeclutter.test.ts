import { describe, expect, it } from 'vitest'
import { OrthographicCamera, Vector3 } from 'three'
import { declutterLabels, isCandidateVisible, type DeclutterCandidate } from './labelDeclutter'

// An orthographic camera makes the projection math exactly hand-computable
// (no perspective-divide/FOV trig to reason about): with left/right/top/
// bottom = -1/1/1/-1, world-space X and Y map straight to NDC X/Y with no
// scaling, so `px = (ndc.x * 0.5 + 0.5) * viewportWidth` reduces to a plain
// linear relationship we can invert by hand for any test point.
function makeCamera(distanceFromOrigin = 10): OrthographicCamera {
  const camera = new OrthographicCamera(-1, 1, 1, -1, 0.1, 100)
  camera.position.set(0, 0, distanceFromOrigin)
  camera.updateMatrixWorld(true)
  return camera
}

const VIEWPORT_W = 800
const VIEWPORT_H = 600

describe('isCandidateVisible — horizon (sphere-curvature) test', () => {
  // occluderRadius = 0 makes cosHorizon = 0/cameraDistance = 0 always, so
  // "on the near side" reduces to the exact, trivial condition
  // dot(dir, cameraDir) >= 0 — the camera-facing hemisphere, inclusive of
  // its boundary at exactly 90°.
  it('is visible dead-center in front of the camera', () => {
    const camera = makeCamera()
    expect(isCandidateVisible(new Vector3(0, 0, 1), camera, VIEWPORT_W, VIEWPORT_H, 0)).toBe(true)
  })

  it('is not visible directly behind the globe from the camera', () => {
    const camera = makeCamera()
    // (0,0,-1): dot with cameraDir (0,0,1) is -1, which is < cosHorizon (0)
    // — the far side of the sphere, regardless of screen projection.
    expect(isCandidateVisible(new Vector3(0, 0, -1), camera, VIEWPORT_W, VIEWPORT_H, 0)).toBe(false)
  })

  it('includes the exact 90-degree limb as visible (boundary is inclusive)', () => {
    const camera = makeCamera()
    // (1,0,0): dot with cameraDir (0,0,1) is exactly 0 == cosHorizon (0).
    expect(isCandidateVisible(new Vector3(1, 0, 0), camera, VIEWPORT_W, VIEWPORT_H, 0)).toBe(true)
  })

  it('respects a real (nonzero) horizon angle from occluderRadius/cameraDistance', () => {
    const camera = makeCamera(10)
    // occluderRadius=5, cameraDistance=10 -> cosHorizon=0.5 -> a 60-degree
    // cutoff from the camera-facing axis (cos(60 deg) = 0.5 exactly).
    // A point at 45 degrees (dot = cos(45 deg) ~= 0.707) is inside that
    // cutoff; a point at exactly 90 degrees (dot = 0) is well outside it.
    const at45deg = new Vector3(1, 0, 1) // normalizes to (0.707, 0, 0.707)
    const at90deg = new Vector3(1, 0, 0)
    expect(isCandidateVisible(at45deg, camera, VIEWPORT_W, VIEWPORT_H, 5)).toBe(true)
    expect(isCandidateVisible(at90deg, camera, VIEWPORT_W, VIEWPORT_H, 5)).toBe(false)
  })
})

describe('isCandidateVisible — screen-frustum test', () => {
  it('is visible just past the screen edge, within the margin slack', () => {
    const camera = makeCamera()
    // world x=1.05 -> ndc.x=1.05 (halfWidth=1) -> px=(1.05*0.5+0.5)*800=820,
    // within the 800+100=900 margin cutoff.
    expect(isCandidateVisible(new Vector3(1.05, 0, 1), camera, VIEWPORT_W, VIEWPORT_H, 0)).toBe(true)
  })

  it('is not visible well past the screen edge, outside the margin slack', () => {
    const camera = makeCamera()
    // world x=1.3 -> ndc.x=1.3 -> px=(1.3*0.5+0.5)*800=920, past the 900
    // margin cutoff.
    expect(isCandidateVisible(new Vector3(1.3, 0, 1), camera, VIEWPORT_W, VIEWPORT_H, 0)).toBe(false)
  })

  it('is not visible behind the camera, even though it is on the near side of the horizon test', () => {
    const camera = makeCamera(10)
    // World point (0,0,15) is BEHIND a camera positioned at (0,0,10) looking
    // toward -Z. dir=(0,0,1) still dots to +1 with cameraDir (0,0,1), so
    // it passes the horizon test — but in view space this is z=+5 (behind
    // the camera), which for this camera's near/far (0.1/100) maps via the
    // standard orthographic ndc_z = (-2/(f-n))*viewZ - (f+n)/(f-n) formula
    // to ndc_z = (-2/99.9)*5 - (100.1/99.9) ~= -1.10, outside the valid
    // [-1, 1] depth range. Confirms the depth check is a real, separate
    // gate from the horizon test, not redundant with it.
    expect(isCandidateVisible(new Vector3(0, 0, 15), camera, VIEWPORT_W, VIEWPORT_H, 0)).toBe(false)
  })
})

function candidate(id: string, x: number, spacingRadiusPx?: number): DeclutterCandidate {
  return { id, worldPosition: new Vector3(x, 0, 1), spacingRadiusPx }
}

describe('declutterLabels', () => {
  it('accepts a candidate that is far enough from an already-accepted one', () => {
    const camera = makeCamera()
    // px delta between x=0 and x=0.5 is 0.5*0.5*800=200px, well past any
    // spacing requirement below.
    const result = declutterLabels([candidate('a', 0, 20), candidate('c', 0.5, 20)], camera, VIEWPORT_W, VIEWPORT_H, 0, 70, 10)
    expect(result.map((c) => c.id)).toEqual(['a', 'c'])
  })

  it('rejects a lower-priority candidate too close to an already-accepted one', () => {
    const camera = makeCamera()
    // px delta between x=0 and x=0.02 is 0.02*0.5*800=8px, well inside the
    // 20+20=40px combined radius.
    const result = declutterLabels([candidate('a', 0, 20), candidate('b', 0.02, 20)], camera, VIEWPORT_W, VIEWPORT_H, 0, 70, 10)
    expect(result.map((c) => c.id)).toEqual(['a'])
  })

  it('stops accepting once maxCount is reached, regardless of remaining spacing', () => {
    const camera = makeCamera()
    // Three candidates 200px apart each (well clear of any spacing
    // requirement) but maxCount=2 should still cut it off after two.
    const candidates = [candidate('a', -0.5, 10), candidate('b', 0, 10), candidate('c', 0.5, 10)]
    const result = declutterLabels(candidates, camera, VIEWPORT_W, VIEWPORT_H, 0, 70, 2)
    expect(result.map((c) => c.id)).toEqual(['a', 'b'])
  })

  // Regression pair for the real bug this per-candidate radius fixed
  // (Gulfport/Biloxi, MS — see labelDeclutter.ts's DeclutterCandidate doc
  // comment): two small-town labels 30px apart on screen. Two small
  // candidates should both fit; the same 30px gap would NOT have been
  // enough room under the old flat-constant behavior.
  describe('per-candidate spacingRadiusPx (Gulfport/Biloxi regression)', () => {
    // x=0.075 -> px delta = 0.075*0.5*800 = 30px from x=0.
    const first = candidate('gulfport', 0, 14)
    const second = candidate('biloxi', 0.075, 14)

    it('fits two small-radius candidates 30px apart (14+14=28 <= 30)', () => {
      const camera = makeCamera()
      const result = declutterLabels([first, second], camera, VIEWPORT_W, VIEWPORT_H, 0, 70, 10)
      expect(result.map((c) => c.id)).toEqual(['gulfport', 'biloxi'])
    })

    it('would have rejected the same 30px gap under the old flat-constant behavior', () => {
      const camera = makeCamera()
      // Same two screen positions, but without spacingRadiusPx set — falls
      // back to minSpacingPx/2 = 35 each, a 70px combined requirement that
      // 30px does not clear. This is exactly the bug: a spacing constant
      // tuned for big-metro labels also rejecting two much narrower
      // small-town labels that were never actually at risk of overlapping.
      const withoutRadius: DeclutterCandidate[] = [
        { id: 'gulfport', worldPosition: first.worldPosition },
        { id: 'biloxi', worldPosition: second.worldPosition },
      ]
      const result = declutterLabels(withoutRadius, camera, VIEWPORT_W, VIEWPORT_H, 0, 70, 10)
      expect(result.map((c) => c.id)).toEqual(['gulfport'])
    })
  })

  it('excludes a candidate that fails the visibility test before spacing is even considered', () => {
    const camera = makeCamera()
    // Behind the sphere entirely (see the horizon tests above) — must never
    // appear in the result, independent of how much spacing it has.
    const behind: DeclutterCandidate = { id: 'hidden', worldPosition: new Vector3(0, 0, -1), spacingRadiusPx: 5 }
    const result = declutterLabels([behind], camera, VIEWPORT_W, VIEWPORT_H, 0, 70, 10)
    expect(result).toEqual([])
  })
})
