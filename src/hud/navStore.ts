import { create } from 'zustand'

// Which sidebar section is active. Each id maps to zero or more *real*
// Layer Engine categories (see SIDE_NAV_ITEMS in SideRail.tsx) — selecting
// one scopes hud/LayerPanel.tsx to the layers registered under those
// categories, rather than introducing any parallel notion of what's
// visible. 'overview' is the unfiltered default.
//
// Same zustand-backed pattern as every other store in this directory
// (v4.4.0) — see CLAUDE.md's "Two-layer split" section.
export type SideNavId =
  | 'overview'
  | 'countries'
  | 'cities'
  | 'military'
  | 'economy'
  | 'infrastructure'
  | 'conflicts'
  | 'environment'
  | 'weather'
  | 'filters'
  | 'alliances'

// Which top-bar tab is active. 'map' and 'analytics' have a real view
// behind them (see TopNav.tsx); the rest are rendered inactive because no
// corresponding view exists yet. 'news' (previously 'layers' — replaced
// since SideRail already owns layer selection, making a top-bar LAYERS tab
// redundant) has no view either, same as 'database'. 'intelligence' was
// dropped entirely in v6.9.2 — direct decision, judged redundant with
// IntelligencePanel.tsx (per-entity) and AnalyticsPanel.tsx (cross-country
// rankings), which already cover the Intelligence Engine.
export type TopNavTab = 'map' | 'news' | 'analytics' | 'database'

const useNavStore = create<{ section: SideNavId; tab: TopNavTab; sideRailCollapsed: boolean }>(() => ({
  section: 'overview',
  tab: 'map',
  sideRailCollapsed: false,
}))

export function setSideNavSection(section: SideNavId) {
  useNavStore.setState({ section })
}

export function useSideNavSection(): SideNavId {
  return useNavStore((state) => state.section)
}

export function setTopNavTab(tab: TopNavTab) {
  useNavStore.setState({ tab })
}

export function useTopNavTab(): TopNavTab {
  return useNavStore((state) => state.tab)
}

// Collapsed state for hud/SideRail.tsx's own hide/show toggle — independent
// of `section` (collapsing the rail doesn't clear or change which section is
// active, it just stops showing the list of them).
export function toggleSideRail() {
  useNavStore.setState((state) => ({ sideRailCollapsed: !state.sideRailCollapsed }))
}

export function useSideRailCollapsed(): boolean {
  return useNavStore((state) => state.sideRailCollapsed)
}
