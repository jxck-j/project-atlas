// "Every country currently under the sanction tier selected from
// SanctionTierMenu.tsx" — driven by hud/sanctionHighlightStore.ts, not
// selectionStore.ts's `selected`, mirroring AllianceHighlightLayer.tsx
// exactly (a many-countries-at-once concern, not a relationship to the
// single selected entity). CURRENT_STATUS is keyed by the same numeric ISO
// topology id buildCountryEntries() returns as `entry.id` (see
// data/currentStatus.ts's own header comment), so this needs no name/ISO3
// join the way AllianceHighlightLayer.tsx does.
import { useMemo } from 'react'
import { registerLayer } from '../layerRegistry'
import { useCountryFeatures } from '../../scene/useCountryFeatures'
import { buildCountryEntries } from '../../scene/countryEntries'
import { GLOBE_RADIUS } from '../../scene/constants'
import { CURRENT_STATUS } from '../../data/currentStatus'
import { SANCTION_TIER_STYLE } from '../../scene/sanctionTierColors'
import { useHighlightedSanctionTier } from '../../hud/sanctionHighlightStore'
import { CategoryHighlightGeometry } from './CategoryHighlightLayer'

const BORDER_RADIUS = GLOBE_RADIUS * 1.005
const FILL_RADIUS = GLOBE_RADIUS * 1.0

export function SanctionHighlightLayer() {
  const highlightedTier = useHighlightedSanctionTier()
  const features = useCountryFeatures()
  const entries = useMemo(() => buildCountryEntries(features, BORDER_RADIUS, FILL_RADIUS), [features])

  if (!highlightedTier) return null

  const tierEntries = entries.filter((entry) => CURRENT_STATUS[entry.id]?.sanctionTier === highlightedTier)

  return <CategoryHighlightGeometry entries={tierEntries} color={SANCTION_TIER_STYLE[highlightedTier].color} />
}

registerLayer({
  id: 'sanction-highlight',
  label: 'SANCTION HIGHLIGHT',
  description: 'Highlights every country under the OFAC sanction tier currently selected from the Current Status sanction menu.',
  category: 'geopolitical',
  defaultEnabled: true,
  component: SanctionHighlightLayer,
})
