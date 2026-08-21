import { ICONS } from './iconPaths'

// The five Intelligence Engine status-bar categories — shared between
// IntelligencePanel.tsx's per-entity status bars and AnalyticsPanel.tsx's
// ranked-list thumbnails so both agree on id/label/icon and can't drift
// apart the way two independently-hardcoded copies eventually would (same
// reasoning as scene/highlightColors.ts / hud/panelStyles.ts).
export type IntelMetricId = 'military' | 'economy' | 'diplomacy' | 'technology' | 'current-status'

export const INTEL_METRICS: { id: IntelMetricId; label: string; icon: readonly string[] }[] = [
  { id: 'military', label: 'MILITARY', icon: ICONS.military },
  { id: 'economy', label: 'ECONOMY', icon: ICONS.economy },
  { id: 'diplomacy', label: 'DIPLOMACY', icon: ICONS.diplomacy },
  { id: 'technology', label: 'TECHNOLOGY', icon: ICONS.technology },
  { id: 'current-status', label: 'CURRENT STATUS', icon: ICONS.shield },
]
