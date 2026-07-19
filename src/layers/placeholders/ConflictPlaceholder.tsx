import { useEffect } from 'react'
import { GLOBE_RADIUS } from '../../scene/constants'
import { latLngToVector3 } from '../../utils/geo'
import { registerLayer } from '../layerRegistry'

// Stands in for a future conflict-visualization layer (strikes, drone
// activity, disputed territories). Registration + lifecycle only — no real
// conflict data, and deliberately not attempting anything resembling real
// visualization of active conflicts.
export function ConflictPlaceholderLayer() {
  useEffect(() => {
    console.debug('[Layer:conflict] placeholder active — no real conflict data wired up yet')
  }, [])

  const position = latLngToVector3(-25, 0, GLOBE_RADIUS * 1.01)

  return (
    <mesh position={position}>
      <octahedronGeometry args={[0.06, 0]} />
      <meshBasicMaterial color="#FF4D4D" wireframe />
    </mesh>
  )
}

registerLayer({
  id: 'conflict',
  label: 'CONFLICT',
  description: 'Conflict zones, disputed territories. Placeholder — no real data yet.',
  category: 'conflict',
  defaultEnabled: false,
  component: ConflictPlaceholderLayer,
})
