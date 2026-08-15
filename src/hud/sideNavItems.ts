import { ICONS } from './iconPaths'
import type { HudPanel } from './hudPanelStore'
import type { SideNavId } from './navStore'

// The left rail's sections. Each maps to the *real* Layer Engine categories
// its label describes — `categories` is matched against the `category` field
// layers already register themselves under (layers/types.ts), so this list
// needs no knowledge of individual layer ids and a newly registered layer
// joins the right section automatically.
//
// An empty `categories` array means "nothing is registered under this
// heading yet": ECONOMY, WEATHER, and FILTERS have no backing layers, so
// SideRail renders them visibly inactive rather than as working buttons that
// do nothing. OVERVIEW is the unfiltered default and deliberately has no
// categories of its own — LayerPanel treats it as "show everything."
//
// In a plain .ts module rather than SideRail.tsx because LayerPanel.tsx also
// reads it, and a .tsx file exporting a non-component value breaks Fast
// Refresh (oxlint's react-refresh rule) — same split as
// scene/geoEntityEntries.ts.
export interface SideNavItem {
  id: SideNavId
  label: string
  icon: readonly string[]
  categories: string[]
  /**
   * Which HudPanel this item opens — omitted means 'layers' (every item
   * before ALLIANCES). ALLIANCES is the first item that opens a different,
   * dedicated panel (AlliancesPanel.tsx) instead of filtering LayerPanel by
   * category — see SideRail.tsx's click handler, generalized to read this
   * field rather than hardcoding 'layers'.
   */
  panel?: Exclude<HudPanel, null>
}

export const SIDE_NAV_ITEMS: SideNavItem[] = [
  { id: 'overview', label: 'OVERVIEW', icon: ICONS.overview, categories: [] },
  { id: 'countries', label: 'COUNTRIES', icon: ICONS.globe, categories: ['political', 'geopolitical', 'highlight'] },
  { id: 'cities', label: 'CITIES', icon: ICONS.city, categories: ['population'] },
  { id: 'military', label: 'MILITARY', icon: ICONS.military, categories: ['highlight'] },
  { id: 'economy', label: 'ECONOMY', icon: ICONS.economy, categories: [] },
  { id: 'infrastructure', label: 'INFRASTRUCTURE', icon: ICONS.infrastructure, categories: ['infrastructure'] },
  { id: 'conflicts', label: 'CONFLICTS', icon: ICONS.conflict, categories: ['conflict'] },
  { id: 'environment', label: 'ENVIRONMENT', icon: ICONS.environment, categories: ['geography'] },
  { id: 'weather', label: 'WEATHER', icon: ICONS.weather, categories: [] },
  { id: 'filters', label: 'FILTERS', icon: ICONS.filter, categories: [] },
  { id: 'alliances', label: 'ALLIANCES', icon: ICONS.diplomacy, categories: [], panel: 'alliances' },
]
