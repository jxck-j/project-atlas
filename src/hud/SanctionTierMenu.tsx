// The popover opened by clicking IntelligencePanel.tsx's SanctionBadge.
// Deliberately global, not scoped to whichever country is currently
// selected — the whole point (direct request) is "what if someone wants to
// see all sanctions," not just the selected country's own tier. Three
// sections (RED/ORANGE/YELLOW), each with a clickable tier icon (toggles
// sanctionHighlightStore.ts, highlighting every country in that tier on the
// globe — layers/geoOverlays/SanctionHighlightLayer.tsx) and a row of
// clickable country chips (selects + flies to that country, same
// centroid-through-current-rotation technique SearchBar.tsx's
// selectEntry() uses, since there's no click point on the globe to derive
// a direction from here).
import { Vector3 } from 'three'
import { CURRENT_STATUS, type SanctionTier } from '../data/currentStatus'
import { SANCTION_TIER_STYLE, withAlpha } from '../scene/sanctionTierColors'
import { useCountryFeatures } from '../scene/useCountryFeatures'
import { geometryToCentroid } from '../scene/countryGeometry'
import { latLngToVector3 } from '../utils/geo'
import { GLOBE_RADIUS } from '../scene/constants'
import { getGlobeRotationY } from '../scene/globeRotation'
import { flyToSelectedCountry, selectEntity } from './selectionStore'
import { resolveEntity } from '../entities/EntityResolver'
import { toggleSanctionTierHighlight, useHighlightedSanctionTier } from './sanctionHighlightStore'

const UP_AXIS = new Vector3(0, 1, 0)

const TIER_ORDER: NonNullable<SanctionTier>[] = ['red', 'orange', 'yellow']

// Grouped once from the generated build output, not recomputed per render —
// data/currentStatus.ts is static build-time data, so its 193 entries'
// tier membership never changes within a session.
const COUNTRIES_BY_TIER: Record<NonNullable<SanctionTier>, { id: string; name: string }[]> = {
  red: [],
  orange: [],
  yellow: [],
}
for (const [id, status] of Object.entries(CURRENT_STATUS)) {
  if (status.sanctionTier) COUNTRIES_BY_TIER[status.sanctionTier].push({ id, name: status.name })
}
for (const tier of TIER_ORDER) COUNTRIES_BY_TIER[tier].sort((a, b) => a.name.localeCompare(b.name))

// The clickable version of IntelligencePanel.tsx's SanctionBadge — same "S"
// mark, but toggling sanctionHighlightStore.ts instead of just carrying a
// tooltip, and with an active-state treatment (filled instead of outlined)
// so it's obvious which tier (if any) is currently highlighted.
function TierIcon({ tier }: { tier: NonNullable<SanctionTier> }) {
  const style = SANCTION_TIER_STYLE[tier]
  const isHighlighted = useHighlightedSanctionTier() === tier
  return (
    <button
      type="button"
      title={`Highlight every ${tier.toUpperCase()}-tier country on the globe`}
      onClick={() => toggleSanctionTierHighlight(tier)}
      className="grid h-5 w-5 shrink-0 place-items-center rounded-full border text-[10px] leading-none font-extrabold transition-colors"
      style={{
        borderColor: style.color,
        backgroundColor: isHighlighted ? style.color : withAlpha(style.color, 0.2),
        color: isHighlighted ? '#0a0f1a' : style.color,
        boxShadow: isHighlighted ? `0 0 8px ${style.color}` : undefined,
      }}
    >
      S
    </button>
  )
}

export function SanctionTierMenu({ onSelectCountry }: { onSelectCountry: () => void }) {
  const features = useCountryFeatures()

  function selectCountryById(id: string) {
    const feature = features.find((f) => (f.id !== undefined && f.id !== null ? String(f.id) : undefined) === id)
    const resolved = resolveEntity(id)
    if (!feature || !resolved) return

    // No click point to derive a direction from here — same technique
    // SearchBar.tsx's selectEntry() uses: project the country's centroid
    // through the globe's CURRENT rotation to get a live world-space
    // direction.
    const centroid = geometryToCentroid(feature.geometry)
    const local = latLngToVector3(centroid.lat, centroid.lng, GLOBE_RADIUS)
    const direction = local.applyAxisAngle(UP_AXIS, getGlobeRotationY()).normalize()

    selectEntity(resolved, direction)
    flyToSelectedCountry()
    onSelectCountry()
  }

  return (
    <div className="absolute top-full right-0 left-0 z-20 mt-2 max-h-[320px] overflow-y-auto rounded-lg border border-[#172440] bg-[rgba(7,11,20,0.97)] p-3 shadow-[0_10px_34px_rgba(0,0,0,0.55)] backdrop-blur-[12px]">
      {TIER_ORDER.map((tier) => (
        <div key={tier} className="py-1.5 first:pt-0 last:pb-0">
          <div className="mb-1.5 flex items-center gap-2">
            <TierIcon tier={tier} />
            <span className="text-[9.5px] font-bold tracking-[0.1em] text-[#aebfdc]">{tier.toUpperCase()}</span>
            <span className="truncate text-[9px] text-[#51648a]">{SANCTION_TIER_STYLE[tier].label}</span>
          </div>
          <div className="flex flex-wrap gap-1.5">
            {COUNTRIES_BY_TIER[tier].map((country) => (
              <button
                key={country.id}
                type="button"
                onClick={() => selectCountryById(country.id)}
                className="rounded-full border border-[#2d4066] bg-[rgba(20,33,58,0.6)] px-2 py-0.5 text-[9.5px] font-semibold text-[#c6d6f0] transition-colors hover:border-[#4d95ff] hover:bg-[rgba(63,139,255,0.14)] hover:text-white"
              >
                {country.name}
              </button>
            ))}
          </div>
        </div>
      ))}
    </div>
  )
}
