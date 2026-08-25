import type { ConflictType } from '../data/currentStatus'

// Single source of truth for each UCDP ConflictType's display label + color —
// read by hud/IntelligencePanel.tsx (ConflictChip) and hud/AnalyticsPanel.tsx
// (the CURRENT STATUS ranked/filtered view), so a conflict type's chip color
// on one surface can never drift from its color on the other — same
// discipline scene/sanctionTierColors.ts already established for sanction
// tiers, and scene/highlightColors.ts for selection/relationship colors.
//
// Labels are plain-language, not UCDP's own technical vocabulary
// ("internationalized_internal", "extrasystemic") — direct feedback that the
// raw terms read as confusing jargon to anyone outside conflict studies. The
// underlying ConflictType values themselves are unchanged (they're what's
// actually sourced from UCDP and what a future citation needs to stay
// accurate to), only this display-layer label differs.
//
// Color choice reflects roughly how a term reads to a general audience (a
// full international war vs. an unconfirmed candidate detection), not any
// real UCDP ranking — UCDP itself doesn't rank these types against each
// other.
export const CONFLICT_TYPE_STYLE: Record<ConflictType, { label: string; color: string; background: string }> = {
  interstate: { label: 'INTERNATIONAL WAR', color: '#ff6b63', background: 'rgba(255,74,66,0.16)' },
  internationalized_internal: { label: 'FOREIGN-BACKED CIVIL WAR', color: '#ff9d5c', background: 'rgba(255,138,61,0.16)' },
  internal: { label: 'CIVIL WAR', color: '#e0a340', background: 'rgba(224,163,64,0.16)' },
  extrasystemic: { label: 'COLONIAL CONFLICT', color: '#c084fc', background: 'rgba(192,132,252,0.16)' },
  unclassified: { label: 'RECENTLY DETECTED', color: '#8aa0c6', background: 'rgba(109,130,168,0.16)' },
}
