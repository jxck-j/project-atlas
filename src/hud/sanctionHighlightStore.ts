import { create } from 'zustand'
import type { SanctionTier } from '../data/currentStatus'

// Which single sanction tier (if any) is currently highlighted on the
// globe — toggled from SanctionTierMenu.tsx's per-tier icon, read by
// layers/geoOverlays/SanctionHighlightLayer.tsx. One at a time, not a Set —
// same reasoning as hud/allianceHighlightStore.ts (this file's direct
// template): highlighting more than one tier at once just reads as "most
// sanctioned countries are highlighted," not a meaningful comparison.
const useSanctionHighlightStore = create<{ highlightedTier: NonNullable<SanctionTier> | null }>(() => ({
  highlightedTier: null,
}))

/** Highlighting the already-highlighted tier again clears it — same click-to-toggle idiom as toggleAllianceHighlight. */
export function toggleSanctionTierHighlight(tier: NonNullable<SanctionTier>) {
  useSanctionHighlightStore.setState((state) => ({
    highlightedTier: state.highlightedTier === tier ? null : tier,
  }))
}

export function clearSanctionTierHighlight() {
  useSanctionHighlightStore.setState({ highlightedTier: null })
}

export function useHighlightedSanctionTier(): NonNullable<SanctionTier> | null {
  return useSanctionHighlightStore((state) => state.highlightedTier)
}
