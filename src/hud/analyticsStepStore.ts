import { createStore } from 'zustand/vanilla'

// Plain (non-reactive) publisher for AnalyticsPanel's current ranking-step
// handler. Lets InputManager.tsx route ArrowUp/ArrowDown to "step to the
// previous/next row in the open ranking" while the ANALYTICS tab is active,
// instead of the map's own arrow-key entity navigation
// (input/SelectionController.ts's selectDirection) — which used to fire
// regardless of which top-nav tab was showing, reported directly as arrows
// staying "locked to the map" while looking at Analytics. Read imperatively
// by InputManager at the moment a key is pressed, not subscribed to for
// rendering, so a zustand vanilla store (no React hook) is enough — same
// reasoning scene/globeRotation.ts gives for its own cross-component,
// write-often/read-imperatively value (see CLAUDE.md's "Two-layer split").
//
// The registered handler is a single stable wrapper set once when
// AnalyticsPanel mounts (it's always mounted, per App.tsx) and never
// cleared — it internally delegates to whatever ranking-step logic is
// current via a ref, so it already no-ops correctly whenever no ranking
// view is open (see AnalyticsPanel.tsx's jumpToOffset, which bails when its
// row list is empty) without this store needing to track that itself.
const analyticsStepStore = createStore<{ handler: ((direction: 1 | -1) => void) | null }>(() => ({ handler: null }))

export function setAnalyticsStepHandler(handler: ((direction: 1 | -1) => void) | null): void {
  analyticsStepStore.setState({ handler })
}

export function getAnalyticsStepHandler(): ((direction: 1 | -1) => void) | null {
  return analyticsStepStore.getState().handler
}
