// First Tier-1 layer added by the geo-data-engine roadmap's Phase 2 pilot
// (see CLAUDE.md / LOGBOOK.md). Off by default like every layer without a
// specific reason to start enabled (see layers/types.ts's `defaultEnabled`
// doc comment). Since the 1:10m upgrade (2026-08-15, 4,539 features) also
// gated the component itself behind the LOD Engine's 'states' tier (see
// scene/StatesProvinces.tsx), toggling this on no longer floods the default
// global view even before zooming in.
import { registerLayer } from '../layerRegistry'
import { StatesProvinces } from '../../scene/StatesProvinces'

registerLayer({
  id: 'states-provinces',
  label: 'STATES / PROVINCES',
  description:
    'First-level administrative divisions (Natural Earth 1:10m) — nearly every country, revealed once zoomed to roughly country-focus distance or closer.',
  category: 'political',
  defaultEnabled: false,
  component: StatesProvinces,
})
