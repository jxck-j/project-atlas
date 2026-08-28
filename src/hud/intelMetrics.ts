import { ICONS } from './iconPaths'

// The four Intelligence Engine status-bar categories — shared between
// IntelligencePanel.tsx's per-entity status bars and AnalyticsPanel.tsx's
// ranked-list thumbnails so both agree on id/label/icon and can't drift
// apart the way two independently-hardcoded copies eventually would (same
// reasoning as scene/highlightColors.ts / hud/panelStyles.ts). Diplomacy was
// dropped entirely (2026-08-26, direct decision — not deferred like
// Technology's once-open items, just cut) rather than shipped as a fifth
// permanently-"Awaiting data feed" placeholder; see
// Intelligence Docs/intelligence-engine-scoring-design.md's own history for
// why it was never built out (§3.4's sourcing was identified but weighting
// never got locked) and CLAUDE.md/LOGBOOK.md for the removal itself. If a
// Diplomacy category is ever built for real, it re-enters here exactly the
// way Technology/Current Status did — a new union member, a new
// INTEL_METRICS entry, real sourced data — not by resurrecting a
// placeholder.
export type IntelMetricId = 'military' | 'economy' | 'technology' | 'current-status'

export const INTEL_METRICS: { id: IntelMetricId; label: string; icon: readonly string[] }[] = [
  { id: 'military', label: 'MILITARY', icon: ICONS.military },
  { id: 'economy', label: 'ECONOMY', icon: ICONS.economy },
  { id: 'technology', label: 'TECHNOLOGY', icon: ICONS.technology },
  { id: 'current-status', label: 'CURRENT STATUS', icon: ICONS.shield },
]
