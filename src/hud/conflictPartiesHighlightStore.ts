import { create } from 'zustand'

export interface ConflictPartiesHighlight {
  // Identifies which chip this is (not derived from countryIds/color, since
  // two different conflicts can resolve to the same single country — every
  // civil war's side_a is always just that one country — and comparing on
  // countryIds alone would make clicking a different chip for the same
  // country look like nothing happened).
  key: string
  countryIds: string[]
  color: string
}

// Which single conflict chip's parties (if any) are currently highlighted
// on the globe — toggled from IntelligencePanel.tsx's ConflictChip, read by
// layers/geoOverlays/ConflictPartiesHighlightLayer.tsx. One at a time, not a
// Set — same reasoning as allianceHighlightStore.ts/sanctionHighlightStore.ts.
const useConflictPartiesHighlightStore = create<{ highlight: ConflictPartiesHighlight | null }>(() => ({
  highlight: null,
}))

/** Highlighting the already-highlighted chip again clears it — same click-to-toggle idiom as toggleAllianceHighlight/toggleSanctionTierHighlight. */
export function toggleConflictPartiesHighlight(next: ConflictPartiesHighlight) {
  useConflictPartiesHighlightStore.setState((state) => ({
    highlight: state.highlight?.key === next.key ? null : next,
  }))
}

export function clearConflictPartiesHighlight() {
  useConflictPartiesHighlightStore.setState({ highlight: null })
}

export function useConflictPartiesHighlight(): ConflictPartiesHighlight | null {
  return useConflictPartiesHighlightStore((state) => state.highlight)
}
