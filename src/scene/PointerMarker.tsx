// Shared "pulsing dot + leader line + text label" callout (v3.3.0) —
// extracted after both of this app's two marker components
// (Globe.tsx's CapitalMarker, layers/geoOverlays/ClaimsOverlayLayer.tsx's
// RelatedCountryMarker) needed the same "too big, comes out too far"
// fix. Before this, each had its own copy of the pattern with its own
// slightly-different sizing that had drifted; one shared, deliberately
// subtle implementation means they can't drift apart again, and a future
// third marker gets the tuned version for free.
//
// Sizing note: previously each marker used its own ad hoc values (dot
// radius up to 0.014, callout distance up to GLOBE_RADIUS * 1.32, a wide
// ±9-10° diagonal offset) that read as oversized and obscured the globe
// around small entities — exactly the complaint this component fixes.
// These constants are deliberately smaller across the board: a callout
// that sits close to the surface and doesn't swing far sideways reads as
// "a subtle pointer" rather than "a label that ate the neighborhood."
import { useRef } from 'react'
import { invalidate, useFrame } from '@react-three/fiber'
import { Html, Line } from '@react-three/drei'
import type { Mesh } from 'three'
import { latLngToVector3 } from '../utils/geo'
import { GLOBE_RADIUS } from './constants'
import { useFrontOfGlobeVisible } from './useFrontOfGlobeVisible'

const DOT_RADIUS = 0.007
const CALLOUT_RADIUS_FACTOR = 1.1
const DEFAULT_CALLOUT_OFFSET_DEG = 4
const PULSE_SPEED = 2.4
const PULSE_AMPLITUDE = 0.12

export interface PointerMarkerProps {
  /** Geographic location the dot sits on. */
  lat: number
  lng: number
  color: string
  /** Already-formatted display text — this component doesn't uppercase or otherwise reformat it. */
  label: string
  /**
   * How far (degrees) the callout swings diagonally from directly above the
   * dot, so the label doesn't sit on top of it. Same diagonal-not-radial
   * convention the pre-v3.3 markers established (a capital is often near
   * its country's centroid, which is also where the hover/select name
   * label anchors — a purely radial line would stack the two) — just a
   * smaller default swing than before.
   */
  calloutOffsetDeg?: number
}

/**
 * A small pulsing dot at `{lat, lng}` plus a short leader line out to a text
 * label — used for anything that needs to draw the eye to one specific
 * point without dominating the view around it. Deliberately generic (no
 * knowledge of capitals, claimants, or any specific entity kind) — see
 * `scene/Globe.tsx`'s `CapitalMarker` and
 * `layers/geoOverlays/ClaimsOverlayLayer.tsx`'s `RelatedCountryMarker` for
 * the two current callers, each of which only supplies *what* to show and
 * *what color*, not *how*.
 */
export function PointerMarker({ lat, lng, color, label, calloutOffsetDeg = DEFAULT_CALLOUT_OFFSET_DEG }: PointerMarkerProps) {
  const dotRef = useRef<Mesh>(null)

  // Phase 2 (Plan.md): a raw scale mutation, not a JSX prop, so demand mode
  // never auto-invalidates for it — invalidate() every tick is what keeps
  // this pulsing continuously for as long as the marker stays mounted,
  // instead of freezing after one frame.
  useFrame(({ clock }) => {
    if (!dotRef.current) return
    const t = clock.getElapsedTime()
    dotRef.current.scale.setScalar(1 + Math.sin(t * PULSE_SPEED) * PULSE_AMPLITUDE)
    invalidate()
  })

  const anchor = latLngToVector3(lat, lng, GLOBE_RADIUS * 1.006)
  const calloutPoint = latLngToVector3(
    lat - calloutOffsetDeg,
    lng + calloutOffsetDeg,
    GLOBE_RADIUS * CALLOUT_RADIUS_FACTOR
  )

  // The dot and leader line are real Three.js objects, so ordinary WebGL
  // depth-testing against the (opaque) core sphere already hides them
  // correctly when this marker is on the far side — only the Html callout
  // needs an explicit check, since Html renders as a DOM overlay outside
  // that depth buffer. See useFrontOfGlobeVisible.ts.
  const labelVisible = useFrontOfGlobeVisible(calloutPoint)

  return (
    <group>
      <mesh ref={dotRef} position={anchor}>
        <sphereGeometry args={[DOT_RADIUS, 8, 8]} />
        <meshBasicMaterial color={color} />
      </mesh>
      <Line points={[anchor, calloutPoint]} color={color} lineWidth={1} transparent opacity={0.7} />
      {labelVisible && (
        <Html position={calloutPoint} center distanceFactor={8} zIndexRange={[15, 0]} style={{ pointerEvents: 'none' }}>
          <div
            className="whitespace-nowrap text-[8px] tracking-[0.15em]"
            style={{ color, textShadow: `0 0 4px ${color}` }}
          >
            {label}
          </div>
        </Html>
      )}
    </group>
  )
}
