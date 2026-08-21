import { create } from 'zustand'

// Which single toolbar dropdown (if any) is open. Mutually exclusive —
// opening one closes the other, matching a normal toolbar's behavior.
// 'layerPresets' (v6.5.0) is TopNav.tsx's Layers icon button's own panel —
// distinct from 'layers' (hud/LayerPanel.tsx's per-layer toggle list,
// opened from every SideRail category row) since saving/applying a whole
// layer configuration is a different interaction than toggling one layer.
export type HudPanel = 'search' | 'settings' | 'layers' | 'alliances' | 'layerPresets' | null

const useHudPanelStore = create<{ panel: HudPanel }>(() => ({ panel: null }))

export function toggleHudPanel(panel: Exclude<HudPanel, null>) {
  useHudPanelStore.setState((state) => ({ panel: state.panel === panel ? null : panel }))
}

export function closeHudPanel() {
  useHudPanelStore.setState({ panel: null })
}

export function useHudPanel(): HudPanel {
  return useHudPanelStore((state) => state.panel)
}
