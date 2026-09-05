import { Vector3 } from 'three'
import type { Camera } from 'three'

// Google Maps-style label decluttering, shared by every "many passive
// labels at once" layer (CityLabels.tsx today, CountryLabels.tsx next) —
// the actual mechanism that keeps labels from reading as jumbled/
// overwhelming, as opposed to just tuning population/zoom thresholds
// tighter and tighter (tried first for US cities; still wasn't enough on
// its own — see CityLabels.tsx's history). Real Google Maps doesn't just
// gate labels by zoom level, it actively refuses to draw a lower-priority
// label if it would crowd a higher-priority one already placed. This is a
// simplified version of that: candidates are checked in priority order
// (caller sorts first), and each is accepted only if its projected screen
// position isn't within `minSpacingPx` of an already-accepted label's.
// Because the same real-world spacing between two features maps to MORE
// screen pixels the closer the camera gets, zooming in is what naturally
// lets more of them fit without any separate "zoom tier" bookkeeping —
// this one mechanism is what "more zoom = more labels" actually reduces to.
export interface DeclutterCandidate {
  id: string
  worldPosition: Vector3
  // Half of this candidate's own required clearance in px. The final
  // required separation between any two accepted candidates is the SUM of
  // their two radii, not one shared constant — needed once a layer's
  // candidates span a wide range of label sizes (CityLabels.tsx: 6px
  // town names up to 11px bold metro names), where a single fixed spacing
  // is either too loose for the smallest labels or too tight for the
  // biggest ones. Two real, adjacent small cities (Gulfport/Biloxi, MS,
  // ~20px onscreen apart at this app's closest zoom) were both legitimate
  // candidates but the smaller one silently never appeared, because a flat
  // spacing constant tuned for readable big-city labels also applied to
  // two much-narrower small-town labels that would never have actually
  // overlapped. Falls back to minSpacingPx/2 (equivalent to the old
  // fixed-spacing behavior) when a caller doesn't set this per-candidate —
  // CountryLabels.tsx doesn't, and keeps its previous behavior unchanged.
  spacingRadiusPx?: number
}

// Slack around the exact frustum edge so a label anchored just past the
// border (but whose text would still partially render) isn't excluded —
// not real text-width clipping, just enough to avoid a hard pop-in right
// at the screen edge.
const SCREEN_MARGIN_PX = 100

interface ScreenProjection {
  visible: boolean
  px: number
  py: number
}

// A candidate is only actually on screen if BOTH of these hold, and
// they're genuinely different tests:
// - occluderRadius/cameraDistance (the "horizon" dot-product test): is this
//   point hidden by the globe's own curvature (the far side)? This alone
//   stays true for a huge swath of the near hemisphere — 40+ degrees of
//   arc — no matter how zoomed in the camera is, because it only knows
//   about the sphere, not the camera's field of view.
// - the projected px/py bounds check: is this point actually inside the
//   region the camera is currently framing? At close zoom these two
//   diverge hugely — the frustum can be framing just a few degrees of the
//   globe's surface while the horizon test still admits most of a
//   hemisphere. Skipping the frustum half of this test let candidates
//   hundreds of miles outside the current view, but still geometrically
//   facing the camera, consume candidate-pool/label-budget slots ahead of
//   a smaller candidate that actually is on screen (reported as: zoomed
//   into Mississippi to find Hattiesburg, MS and it still wouldn't show up
//   — caused by dozens of bigger, off-screen cities like Atlanta/Memphis/
//   New Orleans, still within the horizon test's much wider cone, eating
//   every slot first).
function projectToScreen(
  worldPosition: Vector3,
  camera: Camera,
  viewportWidth: number,
  viewportHeight: number,
  occluderRadius: number
): ScreenProjection {
  const cameraDistance = camera.position.length()
  const cosHorizon = occluderRadius / cameraDistance
  const cameraDir = camera.position.clone().normalize()
  const dir = worldPosition.clone().normalize()
  const onNearSide = dir.dot(cameraDir) >= cosHorizon

  const ndc = new Vector3().copy(worldPosition).project(camera)
  const px = (ndc.x * 0.5 + 0.5) * viewportWidth
  const py = (1 - (ndc.y * 0.5 + 0.5)) * viewportHeight
  const inFrustumDepth = ndc.z >= -1 && ndc.z <= 1
  const inFramedView =
    px >= -SCREEN_MARGIN_PX &&
    px <= viewportWidth + SCREEN_MARGIN_PX &&
    py >= -SCREEN_MARGIN_PX &&
    py <= viewportHeight + SCREEN_MARGIN_PX

  return { visible: onNearSide && inFrustumDepth && inFramedView, px, py }
}

// A rough (flat-plane, not a true two-point screen projection) estimate of
// how large a feature spanning `extentDeg` of arc on a sphere of
// `sphereRadius` currently reads on screen, in pixels — the Google-Maps-
// style "is this country big enough right now to spell out in full, or
// should it read as an abbreviation" question CountryLabels.tsx needs,
// which depends on the CURRENT camera distance, not just the feature's own
// real-world size (a small country can earn its full name once you're
// zoomed in close enough, and a large one still reads as an abbreviation
// from the default overview distance). Deliberately approximate: computing
// a real two-point screen-space size (project the near/far edge of the
// feature and measure the pixel gap) would be more accurate but isn't worth
// it for a "should this be short or long" threshold decision — this uses
// the standard "world units visible per pixel at distance d, given a
// vertical FOV" relationship instead of the full NDC projection
// projectToScreen already does for point visibility.
export function apparentSizePx(
  extentDeg: number,
  cameraDistance: number,
  viewportHeight: number,
  fovDeg: number,
  sphereRadius: number
): number {
  if (cameraDistance <= 0) return 0
  const extentRad = (extentDeg * Math.PI) / 180
  // Chord length of an arc of extentRad radians on a circle of sphereRadius
  // — the real-world "diameter" this feature spans.
  const worldDiameter = 2 * sphereRadius * Math.sin(extentRad / 2)
  const fovRad = (fovDeg * Math.PI) / 180
  const worldHeightAtDistance = 2 * cameraDistance * Math.tan(fovRad / 2)
  if (worldHeightAtDistance <= 0) return 0
  return (worldDiameter / worldHeightAtDistance) * viewportHeight
}

// Exported so callers that build a candidate pool BEFORE calling
// declutterLabels (CityLabels.tsx's population/zoom-tier prefilter) can
// use the same real "is this on screen" test instead of a cheaper but
// wrong approximation — see CityLabels.tsx for why that pool-filtering
// step needs this too, not just the declutter pass itself.
export function isCandidateVisible(
  worldPosition: Vector3,
  camera: Camera,
  viewportWidth: number,
  viewportHeight: number,
  occluderRadius: number
): boolean {
  return projectToScreen(worldPosition, camera, viewportWidth, viewportHeight, occluderRadius).visible
}

export function declutterLabels<T extends DeclutterCandidate>(
  candidatesByPriority: T[],
  camera: Camera,
  viewportWidth: number,
  viewportHeight: number,
  occluderRadius: number,
  minSpacingPx: number,
  maxCount: number
): T[] {
  const accepted: T[] = []
  const acceptedPx: [number, number][] = []

  for (const candidate of candidatesByPriority) {
    if (accepted.length >= maxCount) break

    const { visible, px, py } = projectToScreen(candidate.worldPosition, camera, viewportWidth, viewportHeight, occluderRadius)
    if (!visible) continue

    const radius = candidate.spacingRadiusPx ?? minSpacingPx / 2
    const tooClose = accepted.some((acceptedCandidate, i) => {
      const requiredDist = radius + (acceptedCandidate.spacingRadiusPx ?? minSpacingPx / 2)
      const [ax, ay] = acceptedPx[i]
      const dx = ax - px
      const dy = ay - py
      return dx * dx + dy * dy < requiredDist * requiredDist
    })
    if (tooClose) continue

    accepted.push(candidate)
    acceptedPx.push([px, py])
  }

  return accepted
}
