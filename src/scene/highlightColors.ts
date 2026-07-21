// Single source of truth for every highlight/selection color the globe
// renders — Countries.tsx, GeoEntities.tsx, and both geoOverlays layers all
// import their colors from here instead of hardcoding their own hex
// literals, and hud/LegendPanel.tsx (v3.1) reads the exact same values to
// explain them. The alternative (five files, five independent copies of
// "#FF4D4D") is exactly how a legend goes stale the first time someone
// tweaks a color in only one of them.
export const HIGHLIGHT_COLORS = {
  default: {
    hex: '#7FE9FF',
    label: 'UNSELECTED',
    description: 'Default border/fill for a country or entity.',
  },
  hovered: {
    hex: '#FFD24C',
    label: 'HOVERED',
    description: 'The pointer is currently over this entity.',
  },
  selected: {
    hex: '#FF4D4D',
    label: 'SELECTED',
    description: 'The entity you clicked — the primary selection.',
  },
  territoryOverlay: {
    hex: '#39FF6A',
    label: 'TERRITORY',
    description: 'A dependency/possession of the selected sovereign state.',
  },
  claimsOverlay: {
    hex: '#FF5CD6',
    label: 'CLAIMED',
    description: 'In a sovereignty-claim relationship with the current selection (dashed outline).',
  },
  claimant: {
    hex: '#4C8DFF',
    label: 'CLAIMANT',
    description: 'A sovereign state that claims the current selection (dashed blue outline + fill).',
  },
} as const
