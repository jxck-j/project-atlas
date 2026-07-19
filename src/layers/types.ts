import type { ComponentType } from 'react'

export interface LayerDefinition {
  // Stable unique key. Also used as the React key when mounting/unmounting
  // and as the layerStore's state key.
  id: string
  // HUD display name, e.g. "TERRAIN".
  label: string
  // Shown as a tooltip in the Layer Panel.
  description: string
  // Free-form grouping label for the Layer Panel (e.g. "geography",
  // "infrastructure", "conflict", "diplomatic"). Displayed as-is
  // (uppercased) rather than looked up in a fixed table, so introducing a
  // new category never requires touching LayerPanel.tsx.
  category: string
  // Visibility when the app first loads. Layers register themselves with
  // this off by default unless there's a specific reason a layer should be
  // on from the start.
  defaultEnabled: boolean
  // The component mounted (inside LayerManager, inside the globe's rotating
  // group) while this layer is enabled. Takes no props — a layer owns its
  // own data fetching/state internally, the same way Countries.tsx or
  // WaterLabels.tsx do today.
  component: ComponentType
}
