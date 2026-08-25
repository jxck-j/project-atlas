import type { SanctionTier } from '../data/currentStatus'

// Single source of truth for the three OFAC sanction tiers' color + label —
// read by hud/IntelligencePanel.tsx (the SanctionBadge/SanctionTierMenu
// chips), layers/geoOverlays/SanctionHighlightLayer.tsx (the globe
// highlight), and hud/LegendPanel.tsx (explaining whichever tier is
// currently highlighted) — so a tier's badge color, its globe highlight
// color, and its legend swatch can never drift apart, the same discipline
// scene/highlightColors.ts already established for selection/relationship
// colors. Deliberately NOT added to that file — it's a closed set of
// exactly 7 ROYGBIV hues for a different, unrelated categorical concept
// (see its own header comment); sanction tiers get their own small,
// separate palette instead, the same way IntelligencePanel.tsx's
// CONFLICT_TYPE_STYLE colors already live outside it for the same reason.
export const SANCTION_TIER_STYLE: Record<NonNullable<SanctionTier>, { color: string; label: string }> = {
  red: { color: '#ff6b63', label: 'Comprehensive embargo' },
  orange: { color: '#ff9d5c', label: 'Sectoral/hybrid sanctions' },
  yellow: { color: '#f2cb4e', label: 'List-based sanctions (SDN/Consolidated List)' },
}

// A translucent tint of one of the tier colors above, for a badge/chip
// background — derived rather than hand-duplicated as a second hardcoded
// string per tier, so the background can never end up a shade that doesn't
// actually match its own border/text color.
export function withAlpha(hex: string, alpha: number): string {
  const r = parseInt(hex.slice(1, 3), 16)
  const g = parseInt(hex.slice(3, 5), 16)
  const b = parseInt(hex.slice(5, 7), 16)
  return `rgba(${r}, ${g}, ${b}, ${alpha})`
}
