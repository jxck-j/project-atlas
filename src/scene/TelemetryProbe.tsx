import { useFrame, useThree } from '@react-three/fiber'
import { useRef } from 'react'
import { Spherical } from 'three'
import { publishTelemetry } from '../hud/telemetryStore'
import { publishLodDistance } from '../lod'

const FPS_UPDATE_INTERVAL_MS = 500

export function TelemetryProbe() {
  const { camera } = useThree()
  const frameCount = useRef(0)
  const spherical = useRef(new Spherical())
  const fpsFrames = useRef(0)
  const fpsLastTime = useRef(performance.now())

  useFrame(() => {
    frameCount.current += 1
    fpsFrames.current += 1

    const now = performance.now()
    const fpsElapsed = now - fpsLastTime.current
    if (fpsElapsed >= FPS_UPDATE_INTERVAL_MS) {
      publishTelemetry({ fps: Math.round((fpsFrames.current * 1000) / fpsElapsed) })
      fpsFrames.current = 0
      fpsLastTime.current = now
    }

    if (frameCount.current % 6 !== 0) return // throttle DOM updates

    spherical.current.setFromVector3(camera.position)
    publishTelemetry({
      azimuthDeg: (spherical.current.theta * 180) / Math.PI,
      polarDeg: (spherical.current.phi * 180) / Math.PI,
      distance: spherical.current.radius,
    })
    // Same already-computed distance, fanned out to the LOD Engine's store
    // too — no second per-frame camera read needed (see lodStore.ts).
    publishLodDistance(spherical.current.radius)
  })

  return null
}
