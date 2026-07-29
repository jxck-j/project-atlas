// Single source of truth for every highlight/selection color the globe
// renders — Countries.tsx, GeoEntities.tsx, and both geoOverlays layers all
// import their colors from here instead of hardcoding their own hex
// literals, and hud/LegendPanel.tsx (v3.1) reads the exact same values to
// explain them. The alternative (five files, five independent copies of
// "#FF4D4D") is exactly how a legend goes stale the first time someone
// tweaks a color in only one of them.
export const HIGHLIGHT_COLORS = {
  default: {
    hex: '#7FC8FF',
    label: 'UNSELECTED',
    description: 'Default border/fill for a country or entity.',
  },
  hovered: {
    hex: '#EAF4FF',
    label: 'HOVERED',
    description: 'The pointer is currently over this entity.',
  },
  selected: {
    hex: '#3F8BFF',
    label: 'SELECTED',
    description: 'The entity you clicked — the primary selection.',
  },
  territoryOverlay: {
    hex: '#4FD1C5',
    label: 'TERRITORY',
    description: 'A dependency/possession of the selected sovereign state.',
  },
  claimsOverlay: {
    hex: '#8C7BFF',
    label: 'CLAIMED',
    description: 'In a sovereignty-claim relationship with the current selection (dashed outline).',
  },
  // v3.1.5: covers both directions a selected GeoEntity can be connected to
  // a Country — as its administering parent (Curaçao -> Netherlands) or as
  // a claimant (Taiwan -> China). Deliberately one color/one role for both:
  // from the viewer's perspective "which country is connected to what I
  // selected" is one question, answered by ClaimsOverlayLayer.tsx's
  // RelatedCountryMarker label ("PARENT — NETHERLANDS" vs.
  // "CLAIMANT — CHINA") rather than by a second color to memorize. See
  // LOGBOOK.md's v3.1.5 entry.
  relatedCountry: {
    hex: '#5B6EF5',
    label: 'RELATED COUNTRY',
    description:
      'A sovereign state directly connected to the current selection — its administering parent or a claimant (dashed blue outline + fill + labeled marker).',
  },
  // v3.3.0: shared by all six layers/geoOverlays/CategoryHighlightLayer.tsx
  // toggles — one color for "every entity in a highlighted category," not
  // one per category, since a viewer flipping between "highlight countries"
  // and "highlight strategic regions" is looking at the same *kind* of cue
  // (a category-wide accent) each time, not a fact that needs its own
  // color to stay distinguishable the way claimed-vs-claimant did.
  categoryHighlight: {
    hex: '#C9B8FF',
    label: 'CATEGORY HIGHLIGHT',
    description: 'Every entity in a category enabled from the Layers panel (e.g. all sovereign states, or all strategic regions) at once.',
  },
} as const
