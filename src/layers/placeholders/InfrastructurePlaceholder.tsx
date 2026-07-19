import { useEffect } from 'react'
import { GLOBE_RADIUS } from '../../scene/constants'
import { latLngToVector3 } from '../../utils/geo'
import { registerLayer } from '../layerRegistry'

// Stands in for a future military bases / hospitals / oil fields / ports /
// airports layer. Registration + lifecycle only — no real infrastructure
// data.
export function InfrastructurePlaceholderLayer() {
  useEffect(() => {
    console.debug('[Layer:infrastructure] placeholder active — no real infrastructure data wired up yet')
  }, [])

  const position = latLngToVector3(15, 30, GLOBE_RADIUS * 1.01)

  return (
    <mesh position={position}>
      <boxGeometry args={[0.07, 0.07, 0.07]} />
      <meshBasicMaterial color="#FFD24C" wireframe />
    </mesh>
  )
}

registerLayer({
  id: 'infrastructure',
  label: 'INFRASTRUCTURE',
  description: 'Ports, airports, bases, hospitals, oil fields. Placeholder — no real data yet.',
  category: 'infrastructure',
  defaultEnabled: false,
  component: InfrastructurePlaceholderLayer,
})
