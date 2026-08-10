import { useRef, useState } from 'react'
import { useFrame, useThree } from '@react-three/fiber'
import { Vector3 } from 'three'
import { GLOBE_RADIUS } from './constants'
import { getGlobeRotationY } from './globeRotation'
import { isCandidateVisible } from './labelDeclutter'

// Matches every other analytic front/back-of-globe check in this codebase
// (CountryLabels.tsx, Lakes.tsx, WaterLabels in Globe.tsx) — the core
// sphere's own radius, not the slightly-larger radius most label anchors
// sit at (see labelDeclutter.ts's own comment on why occluderRadius and the
// label's actual anchor radius are deliberately different values).
const OCCLUDER_RADIUS = GLOBE_RADIUS * 0.98
const CHECK_INTERVAL_MS = 100
const Y_AXIS = new Vector3(0, 1, 0)

// Whether a point living inside Globe.tsx's ambient-rotation group is
// currently on the camera-facing hemisphere. `localPosition` is pre-rotation
// (the space a `latLngToVector3` call naturally produces); this hook applies
// the globe's current spin itself before testing, the same rotationY
// compensation CountryLabels.tsx already needed for the identical reason.
//
// Exists specifically for `Html` labels/callouts that persist while
// something stays *selected* rather than only while it's *hovered* — a
// hover-triggered label never needs this (hovering something already proves
// it's front-facing, or the pointer couldn't have reached it), but selection
// persists across camera rotation, and a real mesh (a marker dot, a leader
// `<Line>`) already gets hidden correctly by ordinary WebGL depth-testing
// against the opaque core sphere. `Html` renders as a DOM overlay entirely
// outside that depth buffer, so nothing hides it automatically — see
// LOGBOOK.md's v5.2.1 entry for the bug this was written to fix (an ocean
// label staying visible "through" the globe at every camera angle) and why
// it recurred for selection-triggered labels elsewhere in this file's
// sibling components (PointerMarker.tsx, EntityRenderLayer.tsx's
// HoverLabel, Cities.tsx's CityLabel).
export function useFrontOfGlobeVisible(localPosition: Vector3 | null): boolean {
  const { camera, size } = useThree()
  const [visible, setVisible] = useState(false)
  const hasRun = useRef(false)
  const lastRun = useRef(0)

  useFrame((state) => {
    if (!localPosition) {
      if (visible) setVisible(false)
      return
    }

    const now = state.clock.elapsedTime * 1000
    if (hasRun.current && now - lastRun.current < CHECK_INTERVAL_MS) return
    hasRun.current = true
    lastRun.current = now

    const worldPosition = localPosition.clone().applyAxisAngle(Y_AXIS, getGlobeRotationY())
    const next = isCandidateVisible(worldPosition, camera, size.width, size.height, OCCLUDER_RADIUS)
    if (next !== visible) setVisible(next)
  })

  return visible
}
