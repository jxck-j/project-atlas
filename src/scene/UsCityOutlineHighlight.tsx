import { useMemo } from 'react'
import { FrontSide } from 'three'
import { BufferGeometry, Float32BufferAttribute } from 'three'
import { Html } from '@react-three/drei'
import { useUsCityOutlineGeometry } from './useUsCityOutline'
import { geometryToBorderSegments, geometryToFillMesh, geometryToCentroid } from './countryGeometry'
import { latLngToVector3 } from '../utils/geo'
import { GLOBE_RADIUS } from './constants'
import { HIGHLIGHT_COLORS } from './highlightColors'

// Draws exactly one US city's boundary outline — the one currently set via
// selectionStore.ts's showUsCityOutline(), from a search result
// (hud/SearchBar.tsx). Always mounted (see scene/Globe.tsx, alongside
// CapitalMarker — same "renders nothing most of the time" pattern), not a
// toggleable Layer Engine layer: this isn't a layer a user turns on, it's a
// direct consequence of searching for a specific city.
//
// Client-side geometryToBorderSegments/geometryToFillMesh calls, unlike
// every polygon layer that renders many features at once (Countries.tsx,
// GeoEntities.tsx, StatesProvinces.tsx all precompute this once per feature
// via useMemo over the whole feature list) — here there's only ever at
// most one feature to process, so doing it on demand instead of at build
// time is cheap and avoids needing a separate precomputed asset just for
// this.
const BORDER_RADIUS = GLOBE_RADIUS * 1.006
const FILL_RADIUS = GLOBE_RADIUS * 1.0
const COLOR = HIGHLIGHT_COLORS.selected.hex

export function UsCityOutlineHighlight() {
  const active = useUsCityOutlineGeometry()

  const geometries = useMemo(() => {
    if (!active) return null
    const borderGeometry = new BufferGeometry()
    borderGeometry.setAttribute(
      'position',
      new Float32BufferAttribute(geometryToBorderSegments(active.geometry, BORDER_RADIUS), 3)
    )
    const centroid = geometryToCentroid(active.geometry)
    return {
      borderGeometry,
      fillGeometry: geometryToFillMesh(active.geometry, FILL_RADIUS),
      labelAnchor: latLngToVector3(centroid.lat, centroid.lng, GLOBE_RADIUS * 1.02),
    }
  }, [active])

  if (!geometries || !active) return null

  return (
    <group>
      <lineSegments geometry={geometries.borderGeometry}>
        <lineBasicMaterial color={COLOR} transparent opacity={0.95} />
      </lineSegments>
      {geometries.fillGeometry && (
        <mesh geometry={geometries.fillGeometry}>
          <meshBasicMaterial color={COLOR} transparent opacity={0.2} side={FrontSide} depthWrite={false} />
        </mesh>
      )}
      {/* No distanceFactor — see UsCityLabels.tsx for the full story, but
          the short version here is worse: flyToUsCity() centers the camera
          exactly on this label, and drei's Html only recomputes its
          distanceFactor scale when the label's PROJECTED SCREEN position
          moves by more than a small epsilon (see Html.js's useFrame — the
          scale/transform update is gated behind that check, not a plain
          "every frame" update). A point dead-center in the viewport barely
          moves in screen X/Y as the camera dollies straight toward or away
          from it, so scrolling to zoom out after arriving here left the
          label frozen at whatever (already oversized, at this close a
          range) scale it had the instant the fly-in animation landed —
          reported as "stays the same size no matter how far you zoom out."
          Omitting distanceFactor makes the scale a constant 1 with nothing
          to freeze in a stale state. */}
      <Html position={geometries.labelAnchor} center zIndexRange={[20, 0]} style={{ pointerEvents: 'none' }}>
        <div
          className="whitespace-nowrap font-mono text-xs tracking-[0.2em] text-cyan-100"
          style={{ textShadow: '0 0 8px rgba(76,224,255,0.85)' }}
        >
          {active.name.toUpperCase()}
        </div>
      </Html>
    </group>
  )
}
