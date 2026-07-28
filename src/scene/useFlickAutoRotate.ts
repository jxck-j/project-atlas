import { useEffect, useRef } from 'react'
import { invalidate, useThree } from '@react-three/fiber'
import type { RefObject } from 'react'
import type { OrbitControls as OrbitControlsImpl } from 'three-stdlib'

// Below this release speed (px/ms), the drag just stops — no resumed spin.
const FLICK_THRESHOLD = 0.35
// Converts release speed into an OrbitControls autoRotateSpeed value.
const FLICK_SPEED_SCALE = 2.4
const MIN_AUTOROTATE_SPEED = 0.3
const MAX_AUTOROTATE_SPEED = 1.8

export function useFlickAutoRotate(controlsRef: RefObject<OrbitControlsImpl | null>) {
  const { gl } = useThree()
  const dragging = useRef(false)
  const lastX = useRef(0)
  const lastT = useRef(0)
  const velocity = useRef(0)

  useEffect(() => {
    const el = gl.domElement

    const onDown = (e: PointerEvent) => {
      dragging.current = true
      lastX.current = e.clientX
      lastT.current = performance.now()
      velocity.current = 0
      // Any manual grab immediately halts the ambient idle rotation.
      if (controlsRef.current) controlsRef.current.autoRotate = false
    }

    const onMove = (e: PointerEvent) => {
      if (!dragging.current) return
      const now = performance.now()
      const dt = now - lastT.current
      if (dt > 0) {
        const instVelocity = (e.clientX - lastX.current) / dt
        // Exponential smoothing so a single jittery sample can't dominate
        // the flick read, while still weighting the most recent motion.
        velocity.current = velocity.current * 0.6 + instVelocity * 0.4
      }
      lastX.current = e.clientX
      lastT.current = now
    }

    const onUp = () => {
      if (!dragging.current) return
      dragging.current = false

      const controls = controlsRef.current
      if (!controls) return

      const speed = Math.abs(velocity.current)
      if (speed > FLICK_THRESHOLD) {
        const direction = Math.sign(velocity.current)
        const mapped = Math.min(
          MAX_AUTOROTATE_SPEED,
          Math.max(MIN_AUTOROTATE_SPEED, speed * FLICK_SPEED_SCALE)
        )
        controls.autoRotateSpeed = direction * mapped
        controls.autoRotate = true
        // Phase 2 (Plan.md): this pointerup handler runs entirely outside
        // React (a raw DOM listener, see below) — by the time it fires, the
        // drag that was sustaining frames via its own pointermove-driven
        // 'change' events may have already let the demand loop go idle.
        // Without this, a flick could silently set autoRotate=true and
        // never actually get a frame to act on it.
        invalidate()
      } else {
        controls.autoRotate = false
      }
    }

    el.addEventListener('pointerdown', onDown)
    el.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
    window.addEventListener('pointercancel', onUp)

    return () => {
      el.removeEventListener('pointerdown', onDown)
      el.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
      window.removeEventListener('pointercancel', onUp)
    }
  }, [gl, controlsRef])
}
