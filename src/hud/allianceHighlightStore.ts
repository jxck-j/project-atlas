import { create } from 'zustand'

// Which single alliance (if any) is currently highlighted on the globe —
// toggled from an AllianceBadge (in IntelligencePanel.tsx or
// AlliancesPanel.tsx), read by layers/geoOverlays/AllianceHighlightLayer.tsx.
// One at a time, not a Set: rendering all 18 alliances' member sets
// simultaneously would just read as "most of the globe is highlighted" —
// see CLAUDE.md's Two-layer split section for why this is a small
// zustand-backed module rather than React context (scene consumers need to
// read this without re-rendering the whole HUD tree).
const useAllianceHighlightStore = create<{ highlightedAllianceId: string | null }>(() => ({
  highlightedAllianceId: null,
}))

/** Highlighting the already-highlighted alliance again clears it — the same click-to-toggle idiom every rail/badge/layer toggle in this app already uses. */
export function toggleAllianceHighlight(id: string) {
  useAllianceHighlightStore.setState((state) => ({
    highlightedAllianceId: state.highlightedAllianceId === id ? null : id,
  }))
}

export function clearAllianceHighlight() {
  useAllianceHighlightStore.setState({ highlightedAllianceId: null })
}

export function useHighlightedAllianceId(): string | null {
  return useAllianceHighlightStore((state) => state.highlightedAllianceId)
}
