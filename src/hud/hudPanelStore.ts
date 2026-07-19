import { useSyncExternalStore } from 'react'

// Which single toolbar dropdown (if any) is open. Mutually exclusive —
// opening one closes the other, matching a normal toolbar's behavior.
export type HudPanel = 'search' | 'settings' | 'layers' | null

let openPanel: HudPanel = null
const listeners = new Set<() => void>()

function notify() {
  listeners.forEach((l) => l())
}

export function toggleHudPanel(panel: Exclude<HudPanel, null>) {
  openPanel = openPanel === panel ? null : panel
  notify()
}

export function closeHudPanel() {
  openPanel = null
  notify()
}

function subscribe(listener: () => void) {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

function getSnapshot() {
  return openPanel
}

export function useHudPanel(): HudPanel {
  return useSyncExternalStore(subscribe, getSnapshot)
}
