// Shared vocabulary for the input layer (v3.2.0, "Phase 3.2") — see
// InputManager.tsx for the overview. Kept in its own file so
// KeyboardController/CameraController/SelectionController can all import
// the same command names without importing each other.

/** Camera nudges that apply continuously while their key is held — see CameraController.ts. */
export type CameraNudgeCommand = 'zoom-in' | 'zoom-out' | 'rotate-left' | 'rotate-right' | 'tilt-up' | 'tilt-down'

/** The four cardinal directions arrow-key entity navigation supports — see SelectionController.ts. */
export type NavigationDirection = 'north' | 'south' | 'east' | 'west'

/** Everything else: one keypress, one effect, dispatched once on keydown. */
export type ActionCommand =
  | 'reset-view'
  | 'focus-selection'
  | 'select-north'
  | 'select-south'
  | 'select-east'
  | 'select-west'
  | 'open-inspector'
  | 'dismiss'
  | 'cycle-category-forward'
  | 'cycle-category-backward'
  | 'toggle-layers'
  | 'toggle-inspector'
  | 'open-search'

export type Command = CameraNudgeCommand | ActionCommand
