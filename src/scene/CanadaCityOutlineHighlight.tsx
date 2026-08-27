import { useMemo } from 'react'
import { FrontSide } from 'three'
import { BufferGeometry, Float32BufferAttribute } from 'three'
import { Html } from '@react-three/drei'
import { useCanadaCityOutlineGeometry } from './useCanadaCityOutline'
import { geometryToBorderSegments, geometryToFillMesh, geometryToCentroid } from './countryGeometry'
import { latLngToVector3 } from '../utils/geo'
import { GLOBE_RADIUS } from './constants'
import { HIGHLIGHT_COLORS } from './highlightColors'

// Canadian counterpart to UsCityOutlineHighlight.tsx — draws exactly one
// Canadian city's boundary outline, set via selectionStore.ts's
// flyToCaCity(). Always mounted (see Globe.tsx), same reasoning as the US
// version: this isn't a toggleable layer, it's a direct consequence of
// searching for a specific city.
const BORDER_RADIUS = GLOBE_RADIUS * 1.006
const FILL_RADIUS = GLOBE_RADIUS * 1.0
const COLOR = HIGHLIGHT_COLORS.selected.hex

export function CanadaCityOutlineHighlight() {
  const active = useCanadaCityOutlineGeometry()

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
      {/* No distanceFactor — see UsCityLabels.tsx/UsCityOutlineHighlight.tsx
          for the full story (a frozen-scale bug once flyToUsCity's landing
          spot sits dead-center in the viewport). Same fix applies here
          since flyToCaCity shares the exact same camera-flight mechanism. */}
      <Html position={geometries.labelAnchor} center zIndexRange={[20, 0]} style={{ pointerEvents: 'none' }}>
        <div
          className="whitespace-nowrap text-xs tracking-[0.2em] text-cyan-100"
          style={{ textShadow: '0 0 8px rgba(76,224,255,0.85)' }}
        >
          {active.name.toUpperCase()}
        </div>
      </Html>
    </group>
  )
}
