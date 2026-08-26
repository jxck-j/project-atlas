// Public entry point for the input layer (v3.2.0, "Phase 3.2: Keyboard
// Navigation & Entity Selection"). Mounted exactly once from App.tsx,
// outside the R3F <Canvas> — same reasoning most of this file's
// dependencies (SelectionController's registry hooks, selectionStore,
// hudPanelStore) already work from either side of that boundary. Renders
// nothing; it's a controller, not a visual component — matches
// `scene/TelemetryProbe.tsx`'s "no DOM/visual output, purely wires one
// system to another" shape, one layer over in the HUD tree instead of the
// scene tree.
//
// Deliberately thin: this file owns *routing* (which command goes to which
// system), never the mechanics of any single command. KeyboardController
// resolves raw key events into commands; SelectionController and
// CameraController do the actual work; this file is the switch statement
// connecting the two, plus the couple of one-line actions
// (openInspector/closeInspector/clearSelection/toggleHudPanel) that don't
// warrant their own controller file.
//
// scene/CameraControls.tsx separately mounts `useCameraController` (see
// CameraController.ts) for the continuous WASDQE nudges — that half of the
// camera system has to live inside the Canvas (it needs the OrbitControls
// ref), so it isn't wired through here. This file only ever calls
// CameraController's two one-shot exports (resetCamera, focusOnSelection).
import { useKeyboardController } from './KeyboardController'
import { useEntityNavigation } from './SelectionController'
import { focusOnSelection, resetCamera } from './CameraController'
import { clearSelection, closeInspector, openInspector, useSelection } from '../hud/selectionStore'
import { toggleHudPanel } from '../hud/hudPanelStore'
import { toggleAmbientRotation } from '../hud/settingsStore'
import { useTopNavTab } from '../hud/navStore'
import { getAnalyticsStepHandler } from '../hud/analyticsStepStore'
import type { ActionCommand } from './types'

export function InputManager() {
  const { selected, inspectorOpen } = useSelection()
  const { selectDirection, cycleCategory } = useEntityNavigation()
  const activeTab = useTopNavTab()

  useKeyboardController((command: ActionCommand) => {
    switch (command) {
      // Arrow keys are dual-purpose, routed by which top-nav tab is
      // actually showing — direct report: arrows stayed "locked to the
      // map" (silently moving the hidden globe's selection) even while
      // looking at Analytics, since selectDirection() used to fire
      // unconditionally regardless of tab. While ANALYTICS is active,
      // ArrowUp/ArrowDown step through the open ranking instead (see
      // hud/analyticsStepStore.ts/AnalyticsPanel.tsx's jumpToOffset) —
      // ArrowLeft/ArrowRight have no ranking meaning, so they no-op there.
      // On any OTHER non-map tab (intelligence/news/database, none of which
      // have a real view yet), all four just no-op — there's nothing
      // on-screen for them to affect either way.
      case 'select-north':
        if (activeTab === 'analytics') getAnalyticsStepHandler()?.(-1)
        else if (activeTab === 'map') selectDirection('north')
        break
      case 'select-south':
        if (activeTab === 'analytics') getAnalyticsStepHandler()?.(1)
        else if (activeTab === 'map') selectDirection('south')
        break
      case 'select-east':
        if (activeTab === 'map') selectDirection('east')
        break
      case 'select-west':
        if (activeTab === 'map') selectDirection('west')
        break
      case 'cycle-category-forward':
        cycleCategory(true)
        break
      case 'cycle-category-backward':
        cycleCategory(false)
        break
      case 'reset-view':
        resetCamera()
        break
      case 'focus-selection':
        focusOnSelection()
        break
      case 'open-inspector':
        openInspector()
        break
      case 'toggle-inspector':
        if (!selected) break
        if (inspectorOpen) closeInspector()
        else openInspector()
        break
      case 'dismiss':
        // Two-stage, per the spec: close the inspector first if it's open
        // (leaving the selection itself, and the globe highlight, intact —
        // arrow keys keep working right after), only clear the selection
        // entirely on a *second* Escape once the inspector's already closed.
        if (inspectorOpen) closeInspector()
        else clearSelection()
        break
      case 'toggle-layers':
        toggleHudPanel('layers')
        break
      case 'open-search':
        toggleHudPanel('search')
        break
      case 'toggle-ambient-rotation':
        toggleAmbientRotation()
        break
    }
  })

  return null
}
