import { useMemo } from 'react'
import { BufferGeometry, Float32BufferAttribute } from 'three'
import { latLngToVector3 } from '../utils/geo'
import { GLOBE_RADIUS } from './constants'

// Same elevation Countries.tsx/EntityRenderLayer.tsx draw borders at
// (GLOBE_RADIUS * 1.004) — sits just above the fill layer, consistent with
// every other line drawn on the globe's surface.
const EQUATOR_RADIUS = GLOBE_RADIUS * 1.004
const SEGMENTS = 256
const EQUATOR_COLOR = '#4CE0FF'

// A static reference line, not a selectable entity — no hover/select state,
// no registry entry. Lives alongside the atmosphere shells in Globe.tsx
// rather than as a Layer Engine layer since it's part of the base
// holographic-projection look (see CLAUDE.md's opening description),
// not a toggleable dataset.
export function Equator() {
  const geometry = useMemo(() => {
    const points: number[] = []
    for (let i = 0; i <= SEGMENTS; i++) {
      const lng = (i / SEGMENTS) * 360 - 180
      const { x, y, z } = latLngToVector3(0, lng, EQUATOR_RADIUS)
      points.push(x, y, z)
    }
    const geo = new BufferGeometry()
    geo.setAttribute('position', new Float32BufferAttribute(points, 3))
    return geo
  }, [])

  return (
    <lineLoop geometry={geometry}>
      <lineBasicMaterial color={EQUATOR_COLOR} transparent opacity={0.3} />
    </lineLoop>
  )
}
