// "Which countries belong to the alliance currently selected from an
// AllianceBadge" — driven by hud/allianceHighlightStore.ts, not by
// selectionStore.ts's `selected` the way ParentOverlayLayer/
// ClaimsOverlayLayer are. Alliance membership highlighting is a many-
// countries-at-once concern (up to 55, for the AU), not a relationship to
// the single currently-selected entity, so it doesn't fit either of those
// two overlays' selection-driven shape — but it's the exact same "draw an
// extra highlighted pass on top of Countries.tsx" idea
// CategoryHighlightLayer.tsx already established, so this reuses that
// file's shared CategoryHighlightGeometry renderer instead of duplicating
// the border/fill JSX a third time.
import { useMemo } from 'react'
import { registerLayer } from '../layerRegistry'
import { useCountryFeatures } from '../../scene/useCountryFeatures'
import { buildCountryEntries } from '../../scene/countryEntries'
import { GLOBE_RADIUS } from '../../scene/constants'
import { ALLIANCES } from '../../data/allianceMemberships'
import { COUNTRY_NAME_TO_ISO3 } from '../../data/countryIso3'
import { useHighlightedAllianceId } from '../../hud/allianceHighlightStore'
import { CategoryHighlightGeometry } from './CategoryHighlightLayer'

const BORDER_RADIUS = GLOBE_RADIUS * 1.005
const FILL_RADIUS = GLOBE_RADIUS * 1.0

export function AllianceHighlightLayer() {
  const highlightedId = useHighlightedAllianceId()
  const features = useCountryFeatures()
  const entries = useMemo(() => buildCountryEntries(features, BORDER_RADIUS, FILL_RADIUS), [features])

  if (!highlightedId) return null
  const alliance = ALLIANCES.find((a) => a.id === highlightedId)
  if (!alliance) return null

  // Country features carry a topology id, not ISO3 (see countryIso3.ts's
  // own header) — join through COUNTRY_NAME_TO_ISO3 by name, same as
  // hud/IntelligencePanel.tsx's per-country badge derivation.
  const memberEntries = entries.filter((entry) => {
    const iso3 = COUNTRY_NAME_TO_ISO3[entry.name]
    return iso3 != null && alliance.memberCountryCodes.includes(iso3)
  })

  return <CategoryHighlightGeometry entries={memberEntries} />
}

registerLayer({
  id: 'alliance-highlight',
  label: 'ALLIANCE HIGHLIGHT',
  description: 'Highlights every member country of the alliance currently selected from an AllianceBadge (IntelligencePanel or AlliancesPanel).',
  category: 'geopolitical',
  defaultEnabled: true,
  component: AllianceHighlightLayer,
})
