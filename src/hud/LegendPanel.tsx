import { useLayerEnabledMap } from '../layers'
import { HIGHLIGHT_COLORS } from '../scene/highlightColors'
import { SANCTION_TIER_STYLE } from '../scene/sanctionTierColors'
import { useHighlightedAllianceId } from './allianceHighlightStore'
import { useHighlightedSanctionTier } from './sanctionHighlightStore'
import { PANEL_SECTION_LABEL, PANEL_SURFACE } from './panelStyles'

// v3.1: answers "why is Taiwan red." Always-on, not a toggle — mirrors
// Telemetry.tsx's "always-on info readout" treatment rather than joining
// the Toolbar's mutually-exclusive
// search/layers/settings group, since a legend is a passive reference you
// glance at, not something you'd deliberately open and close.
//
// Deliberately stacked with Telemetry in App.tsx's shared bottom-left flex
// column, not given its own bottom-right or top-right spot: both would sit
// under `hud/IntelligencePanel.tsx`, which covers the full right edge
// (`inset-y-0 right-0`, z-30) the entire time something is selected — which
// is exactly when the overlay colors this legend explains are on screen.
// Bottom-left is the one always-visible corner regardless of selection
// state.
//
// v5.1: a plain two-column key — swatch + label, nothing else drawn around
// either — replacing an earlier attempt at pill-shaped chips that turned out
// to just be more chrome to look at, not less. The full-sentence description
// still isn't printed inline (that was the original layout, and it cost
// several permanent lines of screen space for facts most of the time don't
// need reading twice) — it's on each row's native `title` tooltip instead,
// still sourced from the exact same HIGHLIGHT_COLORS entry.
//
// Every color/label/description still comes from scene/highlightColors.ts —
// the exact same values Countries.tsx, GeoEntities.tsx, and every
// geoOverlays layer render with — so this can't drift out of sync with
// what's actually on screen. The overlay rows (TERRITORY; CLAIMED + RELATED
// COUNTRY together, since ClaimsOverlayLayer/"Relationships Overlay" renders
// both directions of these relationships — see that file's v3.1.5 comments;
// CATEGORY HIGHLIGHT, v3.3.0) are conditional on the relevant layer(s)
// actually being enabled (read via the Layer Engine barrel, same as
// LayerPanel.tsx): showing a "CLAIMED" row while the overlay is toggled off
// would describe a color nothing on screen currently uses.
//
// CATEGORY_HIGHLIGHT_LAYER_IDS lists all six of
// CategoryHighlightLayer.tsx's registered layer ids (administrative-division
// deliberately excluded — see that file) rather than iterating the Layer
// Engine registry generically (unlike LayerPanel.tsx, which lists *every*
// registered layer and so never needs updating) — this is still the one
// place named in BACKLOG.md as worth generalizing if a fourth overlay
// concept shows up: a `legend` field on `LayerDefinition` itself, so this
// file could iterate the registry instead of naming ids. Six is small
// enough that hand-listing them here was the pragmatic call for now, same
// reasoning the two hardcoded ids below already used.
function LegendKey({ color, label, description }: { color: string; label: string; description: string }) {
  return (
    <div title={description} className="flex cursor-default items-center gap-1.5 text-[#b7c6e6]">
      <span
        className="h-1.5 w-1.5 shrink-0 rounded-full"
        style={{ backgroundColor: color, boxShadow: `0 0 5px 1px ${color}` }}
      />
      <span className="truncate tracking-[0.08em]">{label}</span>
    </div>
  )
}

const CATEGORY_HIGHLIGHT_LAYER_IDS = [
  'highlight-country',
  'highlight-geopolitical-entity',
  'highlight-territory',
  'highlight-strategic-region',
  'highlight-maritime-feature',
  'highlight-geographic-region',
]

export function LegendPanel() {
  const enabledMap = useLayerEnabledMap()
  const highlightedAllianceId = useHighlightedAllianceId()
  const highlightedSanctionTier = useHighlightedSanctionTier()
  const anyCategoryHighlightEnabled =
    CATEGORY_HIGHLIGHT_LAYER_IDS.some((id) => enabledMap[id]) ||
    (enabledMap['alliance-highlight'] && highlightedAllianceId != null)

  // Sanction tiers get their own color per tier (unlike alliance/category
  // highlights, which all share HIGHLIGHT_COLORS.categoryHighlight — see
  // scene/sanctionTierColors.ts's own header comment for why), so this
  // entry is built fresh from whichever tier is actually highlighted right
  // now, rather than reused from the fixed HIGHLIGHT_COLORS set below.
  const sanctionEntry =
    enabledMap['sanction-highlight'] && highlightedSanctionTier
      ? {
          hex: SANCTION_TIER_STYLE[highlightedSanctionTier].color,
          label: `${highlightedSanctionTier.toUpperCase()} SANCTIONS`,
          description: SANCTION_TIER_STYLE[highlightedSanctionTier].label,
        }
      : null

  const entries = [
    HIGHLIGHT_COLORS.default,
    HIGHLIGHT_COLORS.hovered,
    HIGHLIGHT_COLORS.selected,
    ...(enabledMap['parent-territory-overlay'] ? [HIGHLIGHT_COLORS.territoryOverlay] : []),
    ...(enabledMap['claims-overlay'] ? [HIGHLIGHT_COLORS.claimsOverlay, HIGHLIGHT_COLORS.relatedCountry] : []),
    ...(anyCategoryHighlightEnabled ? [HIGHLIGHT_COLORS.categoryHighlight] : []),
    ...(sanctionEntry ? [sanctionEntry] : []),
  ]

  return (
    <div className={`${PANEL_SURFACE} min-w-[190px] max-w-[280px] px-4 py-3 text-[10px] md:text-[10.5px]`}>
      <div className={`${PANEL_SECTION_LABEL} mb-2`}>LEGEND</div>
      <div className="grid grid-cols-2 gap-x-3 gap-y-1.5">
        {entries.map((entry) => (
          <LegendKey key={entry.label} color={entry.hex} label={entry.label} description={entry.description} />
        ))}
      </div>
    </div>
  )
}
