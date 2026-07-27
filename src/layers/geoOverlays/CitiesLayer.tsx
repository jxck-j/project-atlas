// Second Tier-1 layer added by the geo-data-engine roadmap's Phase 3 (see
// CLAUDE.md / LOGBOOK.md). Off by default like every layer without a
// specific reason to start enabled — 223 extra markers by default would
// clutter the view, same reasoning StatesProvincesLayer.tsx gives.
//
// category: 'population', not 'political' — matches the vision doc's own
// grouping (states/provinces are a Political layer, cities are a
// Population layer), and this app's `category` field is a free-form string
// specifically so a new grouping like this never requires touching
// LayerPanel.tsx (see layers/types.ts).
import { registerLayer } from '../layerRegistry'
import { Cities } from '../../scene/Cities'

registerLayer({
  id: 'cities',
  label: 'CAPITALS / MAJOR CITIES',
  description:
    'National capitals and major world cities. 223 features — see scripts/vendor/README.md for coverage caveats.',
  category: 'population',
  defaultEnabled: false,
  component: Cities,
})
