import { create } from 'zustand'

// Which single toolbar dropdown (if any) is open. Mutually exclusive —
// opening one closes the other, matching a normal toolbar's behavior.
export type HudPanel = 'search' | 'settings' | 'layers' | null

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
