// "Every country on either side of the conflict currently selected from a
// Current Status conflict chip" — driven by
// hud/conflictPartiesHighlightStore.ts, mirroring
// AllianceHighlightLayer.tsx/SanctionHighlightLayer.tsx's shape, but the
// highlighted id set is ad hoc per click (resolved in
// hud/IntelligencePanel.tsx's ConflictChip from the conflict's own
// side_a/side_b text) rather than a fixed category/tier membership list.
import { useMemo } from 'react'
import { registerLayer } from '../layerRegistry'
import { useCountryFeatures } from '../../scene/useCountryFeatures'
import { buildCountryEntries } from '../../scene/countryEntries'
import { GLOBE_RADIUS } from '../../scene/constants'
import { useConflictPartiesHighlight } from '../../hud/conflictPartiesHighlightStore'
import { CategoryHighlightGeometry } from './CategoryHighlightLayer'

const BORDER_RADIUS = GLOBE_RADIUS * 1.005
const FILL_RADIUS = GLOBE_RADIUS * 1.0

export function ConflictPartiesHighlightLayer() {
  const highlight = useConflictPartiesHighlight()
  const features = useCountryFeatures()
  const entries = useMemo(() => buildCountryEntries(features, BORDER_RADIUS, FILL_RADIUS), [features])

  if (!highlight) return null

  const partyEntries = entries.filter((entry) => highlight.countryIds.includes(entry.id))
  return <CategoryHighlightGeometry entries={partyEntries} color={highlight.color} />
}

registerLayer({
  id: 'conflict-parties-highlight',
  label: 'CONFLICT PARTIES HIGHLIGHT',
  description: 'Highlights the country/countries on each side of the conflict currently selected from a Current Status conflict chip.',
  category: 'geopolitical',
  defaultEnabled: true,
  component: ConflictPartiesHighlightLayer,
})
