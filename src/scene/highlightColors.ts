// Single source of truth for every highlight/selection color the globe
// renders — Countries.tsx, GeoEntities.tsx, and both geoOverlays layers all
// import their colors from here instead of hardcoding their own hex
// literals, and hud/LegendPanel.tsx (v3.1) reads the exact same values to
// explain them. The alternative (five files, five independent copies of
// "#FF4D4D") is exactly how a legend goes stale the first time someone
// tweaks a color in only one of them.
//
// 2026-08-08: retuned from a palette where 5 of these 7 slots were all
// blue/indigo/violet shades of each other (default #7FC8FF, selected
// #3F8BFF, claimsOverlay #8C7BFF, relatedCountry #5B6EF5, categoryHighlight
// #C9B8FF) — reported directly as reading "too close" to distinguish at a
// glance. There are exactly 7 slots here and ROYGBIV has exactly 7 hues, so
// each slot now gets its own spectrum hue instead of a shade of blue —
// refined jewel-tone values, not literal crayon-box red/orange/yellow/
// green/blue/indigo/violet. Validated with the dataviz skill's palette
// checker (`--surface #000000 --mode dark`, matching Globe.tsx's now-pitch-
// black ocean) for CVD separation and normal-vision distinctness on the
// adjacent pairs this legend actually renders side by side.
export const HIGHLIGHT_COLORS = {
  // B — the app's base/default identity color, unchanged in spirit from
  // the original (just deepened slightly for separation from indigo/
  // selected below).
  default: {
    hex: '#4A9EFF',
    label: 'UNSELECTED',
    description: 'Default border/fill for a country or entity.',
  },
  // Y — bright yellow reads as "actively under the pointer" on its own,
  // independent of hue-memory the way every other slot here requires.
  hovered: {
    hex: '#F0D64C',
    label: 'HOVERED',
    description: 'The pointer is currently over this entity.',
  },
  // I — indigo: a deep blue-violet, deliberately still "cool" like default
  // (selection is a stronger version of the same base identity) but a
  // distinct hue, not just a darker/lighter version of default's blue.
  selected: {
    hex: '#7B6EF0',
    label: 'SELECTED',
    description: 'The entity you clicked — the primary selection.',
  },
  // G — green, unchanged in spirit from the original spec's own note
  // ("secondary highlight style like a green highlight" — see
  // ParentOverlayLayer.tsx).
  territoryOverlay: {
    hex: '#4FD17E',
    label: 'TERRITORY',
    description: 'A dependency/possession of the selected sovereign state.',
  },
  // R — red: a disputed/claimed relationship reading as red fits the
  // relationship itself, not just spectrum-order bookkeeping.
  claimsOverlay: {
    hex: '#E5342A',
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
  // O — orange: a warm accent, clearly distinct from claimsOverlay's red
  // despite both being warm hues (validated adjacent-pair CVD separation
  // specifically, since these two sit next to each other in the legend).
  relatedCountry: {
    hex: '#F2933D',
    label: 'RELATED COUNTRY',
    description:
      'A sovereign state directly connected to the current selection — its administering parent or a claimant (dashed orange outline + fill + labeled marker).',
  },
  // v3.3.0: shared by all six layers/geoOverlays/CategoryHighlightLayer.tsx
  // toggles — one color for "every entity in a highlighted category," not
  // one per category, since a viewer flipping between "highlight countries"
  // and "highlight strategic regions" is looking at the same *kind* of cue
  // (a category-wide accent) each time, not a fact that needs its own
  // color to stay distinguishable the way claimed-vs-claimant did.
  // Reused again (not a new 8th slot — see this file's own "exactly 7 hues"
  // note above) by layers/geoOverlays/AllianceHighlightLayer.tsx: "every
  // member country of the selected alliance" is the same kind of group-wide
  // accent as a category highlight, just grouped by alliance instead of by
  // GeoEntityType/country.
  // V — violet: the spectrum's last hue, distinct from selected's indigo by
  // both hue and lightness (also validated as an adjacent pair, since this
  // is claimsOverlay/relatedCountry's neighbor in the legend).
  categoryHighlight: {
    hex: '#C77DFF',
    label: 'CATEGORY HIGHLIGHT',
    description: 'Every entity in a category enabled from the Layers panel (e.g. all sovereign states, or all strategic regions) at once.',
  },
} as const
