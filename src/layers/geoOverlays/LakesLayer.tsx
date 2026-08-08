import { registerLayer } from '../layerRegistry'
import { Lakes } from '../../scene/Lakes'

registerLayer({
  id: 'lakes',
  label: 'LAKES',
  description: 'Major lakes (Natural Earth 1:50m, 412 features) — decorative geography, not a selectable entity.',
  category: 'geography',
  defaultEnabled: true,
  component: Lakes,
})
