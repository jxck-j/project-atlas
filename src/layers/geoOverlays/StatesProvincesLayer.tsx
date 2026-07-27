// First Tier-1 layer added by the geo-data-engine roadmap's Phase 2 pilot
// (see CLAUDE.md / LOGBOOK.md). Off by default like every layer without a
// specific reason to start enabled (see layers/types.ts's `defaultEnabled`
// doc comment) — 294 extra polygons on top of every country would clutter
// the default view.
import { registerLayer } from '../layerRegistry'
import { StatesProvinces } from '../../scene/StatesProvinces'

registerLayer({
  id: 'states-provinces',
  label: 'STATES / PROVINCES',
  description:
    'First-level administrative divisions. Currently Natural Earth’s 1:50m dataset, which only covers 9 large countries (Australia, Brazil, Canada, China, India, Indonesia, Russia, South Africa, United States).',
  category: 'political',
  defaultEnabled: false,
  component: StatesProvinces,
})
