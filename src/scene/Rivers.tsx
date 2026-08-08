import { useMemo } from 'react'
import { BufferGeometry, Float32BufferAttribute } from 'three'
import { useRiversFeatures } from './useRiversFeatures'
import { geometryToLineSegments } from './countryGeometry'
import { GLOBE_RADIUS } from './constants'

const RIVER_RADIUS = GLOBE_RADIUS * 1.0015
// 2026-08-08: was #4FC3F7 — reported directly as reading too close to
// highlightColors.ts's political default border color (#4A9EFF): with the
// states/provinces overlay on, a river running near a state boundary could
// look like it was dividing territory, not flowing through it. Retuned to
// the same water-cyan (#67E8F9, Tailwind cyan-300) scene/Lakes.tsx already
// uses for lake borders/labels — visually a distinct "this is water," not
// a shade of the political-boundary blue.
const RIVER_COLOR = '#67E8F9'

// Decorative-only layer, same reasoning as Lakes.tsx (see that file's
// header comment) — no click-to-select, no GeoEntity record. Merged into
// ONE draw call for all 116 rivers, same "one mesh per layer, not one per
// feature" reasoning geometryToBorderSegments already applies within a
// single country.
export function Rivers() {
  const features = useRiversFeatures()
  const geometry = useMemo(() => {
    const positions: number[] = []
    for (const f of features) {
      const segments = geometryToLineSegments(f.geometry, RIVER_RADIUS)
      for (let i = 0; i < segments.length; i++) positions.push(segments[i])
    }
    const geo = new BufferGeometry()
    geo.setAttribute('position', new Float32BufferAttribute(positions, 3))
    return geo
  }, [features])

  if (features.length === 0) return null

  return (
    <lineSegments geometry={geometry}>
      <lineBasicMaterial color={RIVER_COLOR} transparent opacity={0.75} />
    </lineSegments>
  )
}
