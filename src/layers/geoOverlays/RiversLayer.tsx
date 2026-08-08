import { registerLayer } from '../layerRegistry'
import { Rivers } from '../../scene/Rivers'

registerLayer({
  id: 'rivers',
  label: 'RIVERS',
  description: 'Major rivers (Natural Earth 1:50m, scalerank <= 3, 116 features) — decorative geography, not a selectable entity.',
  category: 'geography',
  defaultEnabled: true,
  component: Rivers,
})
