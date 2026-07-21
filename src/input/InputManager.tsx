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
import type { ActionCommand } from './types'

export function InputManager() {
  const { selected, inspectorOpen } = useSelection()
  const { selectDirection, cycleCategory } = useEntityNavigation()

  useKeyboardController((command: ActionCommand) => {
    switch (command) {
      case 'select-north':
        selectDirection('north')
        break
      case 'select-south':
        selectDirection('south')
        break
      case 'select-east':
        selectDirection('east')
        break
      case 'select-west':
        selectDirection('west')
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
    }
  })

  return null
}
