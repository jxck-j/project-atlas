import { useRef, useState } from 'react'
import { useFrame, useThree } from '@react-three/fiber'
import { Vector3 } from 'three'
import { latLngToVector3 } from '../utils/geo'
import { GLOBE_RADIUS } from './constants'
import { getGlobeRotationY } from './globeRotation'
import { isCandidateVisible } from './labelDeclutter'
import type { GeoEntityEntry } from './geoEntityEntries'

// Same analytic per-point check (horizon dot-product + NDC frustum + screen
// bounds, all three — see labelDeclutter.ts's projectToScreen) and same
// throttled-useFrame pattern useFrontOfGlobeVisible.ts already established
// for a single point, generalized here to filter a whole entry list at
// once. Built for StatesProvinces.tsx (2026-08-16): once the 1:10m upgrade
// made every one of ~4,500 provinces mount as its own individually-
// hoverable/clickable mesh the moment the LOD Engine's 'states' tier
// reveals them (src/lod), rendering every province on the ENTIRE globe —
// including the far hemisphere, and off-screen ones outside the current
// framing — regardless of what's actually on screen was reported directly
// as still choppy even after the LOD gate. A back-facing or off-screen
// province mesh was always invisible anyway (FrontSide culling + the
// opaque core sphere's depth test already hid it) — this doesn't change
// what's visually rendered, only skips mounting/raycasting meshes that
// were never going to draw anything in the first place.
const OCCLUDER_RADIUS = GLOBE_RADIUS * 0.98
const CHECK_INTERVAL_MS = 150
const Y_AXIS = new Vector3(0, 1, 0)

// `entries.filter()` preserves the source array's own order, and that
// source order doesn't change between recomputes (only which elements
// pass) — so two filter results covering the same set are also the same
// SEQUENCE, and a plain index-wise reference comparison is enough to
// detect "nothing actually changed" without a Set/sort. Skipping the state
// update in that case matters more here than it would for a plain list
// filter: scene/ProvinceFillLayer.tsx rebuilds a merged GPU buffer from
// this hook's result, so an unnecessary update isn't just a wasted
// re-render, it's a wasted geometry rebuild.
function sameEntries(a: GeoEntityEntry[], b: GeoEntityEntry[]): boolean {
  if (a.length !== b.length) return false
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) return false
  }
  return true
}

export function useFrontFacingEntries(entries: GeoEntityEntry[]): GeoEntityEntry[] {
  const { camera, size } = useThree()
  const [visible, setVisible] = useState(entries)
  const lastRun = useRef(0)
  const lastEntries = useRef(entries)

  useFrame((state) => {
    // A new `entries` reference (features just finished fetching, or the
    // layer just mounted) bypasses the throttle so the list doesn't sit on
    // a stale (possibly empty, pre-fetch) filtered result until the next
    // scheduled recompute.
    const entriesChanged = entries !== lastEntries.current
    const now = state.clock.elapsedTime * 1000
    if (!entriesChanged && now - lastRun.current < CHECK_INTERVAL_MS) return
    lastRun.current = now
    lastEntries.current = entries

    const rotationY = getGlobeRotationY()
    const next = entries.filter((entry) => {
      const local = latLngToVector3(entry.centroid.lat, entry.centroid.lng, GLOBE_RADIUS)
      const world = local.applyAxisAngle(Y_AXIS, rotationY)
      return isCandidateVisible(world, camera, size.width, size.height, OCCLUDER_RADIUS)
    })
    setVisible((current) => (sameEntries(current, next) ? current : next))
  })

  return visible
}
