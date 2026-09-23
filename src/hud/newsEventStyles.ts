import type { Corroboration, NewsEvent, Severity, TopicTag } from '../news/types'

// Single source of truth for how a v2 Event's severity, corroboration and
// topic tags are colored/labeled — read by NewsPanel.tsx and
// IntelligencePanel.tsx alike, so a badge can't drift between the two. Same
// pattern v1's newsSeverityStyles.ts established, extended to four tiers
// (v1 had three) and to corroboration, which v1 had no concept of.

export const NEWS_SEVERITY_STYLE: Record<Severity, { color: string; label: string }> = {
  routine: { color: '#6d82a8', label: 'Routine' },
  significant: { color: '#f2cb4e', label: 'Significant' },
  major: { color: '#ff9a3c', label: 'Major' },
  critical: { color: '#ff4a42', label: 'Critical' },
}

/**
 * Corroboration is the standing the DOSSIER earned, never an editorial
 * judgment — so the label is the derived value itself, shortened for a badge,
 * and `unconfirmed` is deliberately dimmed rather than alarm-colored: it
 * means "one source so far," not "disputed".
 */
export const CORROBORATION_STYLE: Record<Corroboration, { color: string; label: string }> = {
  'wire-confirmed': { color: '#3f8bff', label: 'WIRE' },
  'outlet-corroborated (3+)': { color: '#4ec9a8', label: 'CORROBORATED' },
  'specialist-verified': { color: '#8a6df0', label: 'SPECIALIST' },
  'osint-corroborated (2+)': { color: '#4e9ac9', label: 'OSINT 2+' },
  unconfirmed: { color: '#51648a', label: 'UNCONFIRMED' },
}

/** Short tab-style labels (§9a's one-word tab names), for chips on a card where the full tag name is too long. */
export const TOPIC_TAG_LABEL: Record<TopicTag, string> = {
  'conflict-security': 'CONFLICT',
  'terrorism-non-state-actors': 'TERRORISM',
  'diplomacy-politics': 'POLITICS',
  'economic-trade': 'BUSINESS',
  energy: 'ENERGY',
  'humanitarian-displacement': 'HUMANITARIAN',
  'crime-trafficking': 'CRIME',
  'science-technology': 'TECH',
}

export function withAlpha(hex: string, alpha: number): string {
  const r = parseInt(hex.slice(1, 3), 16)
  const g = parseInt(hex.slice(3, 5), 16)
  const b = parseInt(hex.slice(5, 7), 16)
  return `rgba(${r}, ${g}, ${b}, ${alpha})`
}

// A pure presentation signal, never a ranking factor — same rule v1 set for
// its own JUST IN badge. Measured against the Event's own timestamp (when it
// happened), not the build's snapshotDate: on an archive-backed build every
// Event shares one snapshotDate, which would make the whole feed "just in".
export const NEWS_BREAKING_WINDOW_MS = 60 * 60 * 1000
export function isEventBreaking(event: NewsEvent, now: number = Date.now()): boolean {
  return now - new Date(event.eventTimestamp).getTime() < NEWS_BREAKING_WINDOW_MS
}
