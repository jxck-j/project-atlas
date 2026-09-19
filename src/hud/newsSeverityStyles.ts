import type { NewsItem, NewsSeverity } from '../data'

// Single source of truth for severity-tier color + label — read by both
// IntelligencePanel.tsx's Recent News section and NewsPanel.tsx, so a
// severity badge can never drift between the two. Same pattern as
// scene/sanctionTierColors.ts's SANCTION_TIER_STYLE.
export const NEWS_SEVERITY_STYLE: Record<NewsSeverity, { color: string; label: string }> = {
  routine: { color: '#6d82a8', label: 'Routine' },
  significant: { color: '#f2cb4e', label: 'Significant' },
  'high-stakes': { color: '#ff6b63', label: 'High-stakes' },
}

export function withAlpha(hex: string, alpha: number): string {
  const r = parseInt(hex.slice(1, 3), 16)
  const g = parseInt(hex.slice(3, 5), 16)
  const b = parseInt(hex.slice(5, 7), 16)
  return `rgba(${r}, ${g}, ${b}, ${alpha})`
}

// Shared with hud/IntelligencePanel.tsx's Recent News section so both
// "JUST IN" badges use the same freshness window — a pure presentation
// signal, never a ranking factor (see NewsPanel.tsx's own comment).
export const NEWS_BREAKING_WINDOW_MS = 60 * 60 * 1000
export function isNewsItemBreaking(item: NewsItem): boolean {
  return Date.now() - new Date(item.snapshotDate).getTime() < NEWS_BREAKING_WINDOW_MS
}
