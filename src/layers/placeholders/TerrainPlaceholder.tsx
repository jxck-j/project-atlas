import { useEffect } from 'react'
import { GLOBE_RADIUS } from '../../scene/constants'
import { latLngToVector3 } from '../../utils/geo'
import { registerLayer } from '../layerRegistry'

// Stands in for a future elevation/rivers/mountain-ranges layer. Registration
// + lifecycle only — no real terrain data. See CLAUDE.md's Layer Engine
// section for what a real layer module needs beyond this.
export function TerrainPlaceholderLayer() {
  useEffect(() => {
    console.debug('[Layer:terrain] placeholder active — no real terrain data wired up yet')
  }, [])

  const position = latLngToVector3(15, -30, GLOBE_RADIUS * 1.01)

  return (
    <mesh position={position}>
      <icosahedronGeometry args={[0.05, 0]} />
      <meshBasicMaterial color="#7FE9FF" wireframe />
    </mesh>
  )
}

registerLayer({
  id: 'terrain',
  label: 'TERRAIN',
  description: 'Elevation, rivers, mountain ranges. Placeholder — no real data yet.',
  category: 'geography',
  defaultEnabled: false,
  component: TerrainPlaceholderLayer,
})
