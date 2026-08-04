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

// Which top-bar tab is active. Only 'map' has anything behind it today —
// the other three are rendered inactive (see TopNav.tsx) because no
// corresponding view exists.
export type TopNavTab = 'map' | 'intelligence' | 'layers' | 'analytics' | 'database'

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
