import { useEffect, useRef } from 'react'
import { advance } from '@react-three/fiber'

const TARGET_FPS = 60
const FRAME_INTERVAL_MS = 1000 / TARGET_FPS

// Requires the Canvas to use frameloop="never" — R3F's own render loop is
// then fully disabled, and this drives it manually, skipping renders that
// land inside the same 1000/60ms window instead of rendering every display
// refresh (which on a 120/144Hz monitor pushes far more GPU work per
// second than the scene's ~193-country geometry can sustain).
export function FrameRateCap() {
  const rafId = useRef(0)
  const lastRenderTime = useRef(0)

  useEffect(() => {
    function loop(time: number) {
      rafId.current = requestAnimationFrame(loop)
      const elapsed = time - lastRenderTime.current
      if (elapsed >= FRAME_INTERVAL_MS) {
        lastRenderTime.current = time - (elapsed % FRAME_INTERVAL_MS)
        // advance() feeds this straight into state.clock.elapsedTime, which
        // Three.js's Clock (and therefore every delta-based animation —
        // ambient rotation, OrbitControls damping/autoRotate, camera
        // flights) tracks in SECONDS. requestAnimationFrame's timestamp is
        // in milliseconds — passing it through unconverted made every delta
        // ~1000x too large, which is what was spinning the globe wildly.
        advance(time / 1000)
      }
    }
    rafId.current = requestAnimationFrame(loop)
    return () => cancelAnimationFrame(rafId.current)
  }, [])

  return null
}
