import type { Alliance } from '../data/allianceMemberships'
import { toggleAllianceHighlight, useHighlightedAllianceId } from './allianceHighlightStore'

// `.alliance-badge` — small pill naming one economic/security bloc. Shared
// by hud/IntelligencePanel.tsx (one country's memberships) and
// hud/AlliancesPanel.tsx (all 18 at once) so the two contexts render and
// behave identically — a click on either toggles the same
// allianceHighlightStore.ts state, which layers/geoOverlays/
// AllianceHighlightLayer.tsx reads to highlight that alliance's member
// countries on the globe. Categorical membership, not a metric, so this
// deliberately doesn't reuse IntelligencePanel.tsx's IntelRow scored-bar
// treatment — no track, no percentage, just the bloc's short abbreviation
// with its full name on hover, now clickable.
export function AllianceBadge({ alliance }: { alliance: Alliance }) {
  const isActive = useHighlightedAllianceId() === alliance.id

  return (
    <button
      type="button"
      title={alliance.name}
      onClick={() => toggleAllianceHighlight(alliance.id)}
      className={`rounded-full border px-2 py-0.5 text-[9.5px] font-bold tracking-[0.08em] transition-colors ${
        isActive
          ? 'border-[#6db0ff] bg-[rgba(63,139,255,0.35)] text-white shadow-[0_0_6px_rgba(63,139,255,0.6)]'
          : 'border-[#2d6fd8] bg-[rgba(45,111,216,0.12)] text-[#8ab4ff] hover:bg-[rgba(45,111,216,0.22)]'
      }`}
    >
      {alliance.abbreviation}
    </button>
  )
}
