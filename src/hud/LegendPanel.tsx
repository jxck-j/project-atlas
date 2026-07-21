import { useLayerEnabledMap } from '../layers'
import { HIGHLIGHT_COLORS } from '../scene/highlightColors'

// v3.1: answers "why is Taiwan magenta/pink" (reported as "purple" — close
// enough on a dark background that it's worth explaining, not renaming).
// Always-on, not a toggle — mirrors Telemetry.tsx's "always-on info
// readout" treatment rather than joining the Toolbar's mutually-exclusive
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
// Every color/label/description comes from scene/highlightColors.ts — the
// exact same values Countries.tsx, GeoEntities.tsx, and both geoOverlays
// layers render with — so this can't drift out of sync with what's actually
// on screen. The overlay rows (TERRITORY; CLAIMED + CLAIMANT together,
// since ClaimsOverlayLayer renders both directions of the same
// relationship) are conditional on that overlay's layer actually being
// enabled (read via the Layer Engine barrel, same as LayerPanel.tsx):
// showing "CLAIMED = magenta" while Claims Overlay is toggled off would
// describe a color nothing on screen currently uses.
function LegendRow({ color, label, description }: { color: string; label: string; description: string }) {
  return (
    <div className="flex items-start gap-2">
      <span
        className="mt-1 h-2 w-2 shrink-0 rounded-full"
        style={{ backgroundColor: color, boxShadow: `0 0 5px 1px ${color}` }}
      />
      <div className="space-y-0.5">
        <div className="text-cyan-100 tracking-[0.15em]">{label}</div>
        <div className="text-cyan-500/50 text-[9px] leading-tight">{description}</div>
      </div>
    </div>
  )
}

export function LegendPanel() {
  const enabledMap = useLayerEnabledMap()

  return (
    <div className="border border-cyan-400/25 bg-cyan-950/20 backdrop-blur-sm px-4 py-3 font-mono text-[10px] md:text-xs space-y-2.5 min-w-[190px] max-w-[240px]">
      <div className="text-amber-400/90 tracking-[0.25em] mb-1">LEGEND</div>

      <LegendRow
        color={HIGHLIGHT_COLORS.default.hex}
        label={HIGHLIGHT_COLORS.default.label}
        description={HIGHLIGHT_COLORS.default.description}
      />
      <LegendRow
        color={HIGHLIGHT_COLORS.hovered.hex}
        label={HIGHLIGHT_COLORS.hovered.label}
        description={HIGHLIGHT_COLORS.hovered.description}
      />
      <LegendRow
        color={HIGHLIGHT_COLORS.selected.hex}
        label={HIGHLIGHT_COLORS.selected.label}
        description={HIGHLIGHT_COLORS.selected.description}
      />
      {enabledMap['parent-territory-overlay'] && (
        <LegendRow
          color={HIGHLIGHT_COLORS.territoryOverlay.hex}
          label={HIGHLIGHT_COLORS.territoryOverlay.label}
          description={HIGHLIGHT_COLORS.territoryOverlay.description}
        />
      )}
      {enabledMap['claims-overlay'] && (
        <>
          <LegendRow
            color={HIGHLIGHT_COLORS.claimsOverlay.hex}
            label={HIGHLIGHT_COLORS.claimsOverlay.label}
            description={HIGHLIGHT_COLORS.claimsOverlay.description}
          />
          <LegendRow
            color={HIGHLIGHT_COLORS.claimant.hex}
            label={HIGHLIGHT_COLORS.claimant.label}
            description={HIGHLIGHT_COLORS.claimant.description}
          />
        </>
      )}
    </div>
  )
}
