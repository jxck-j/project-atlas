// Owns the one global `keydown`/`keyup` listener this whole input layer
// needs — everything else (SelectionController, CameraController,
// InputManager) reacts to commands this module resolves, never touches
// `window` directly. Two different dispatch shapes, matching how the two
// kinds of command actually behave:
//
// - Continuous (camera nudges: WASDQE) — held down, not one-shot. Tracked
//   in a plain module-level Set, mutated on keydown/keyup, read
//   imperatively every animation frame by CameraController.useCameraController
//   (see that file). Deliberately NOT React state — a value that changes
//   this often (every frame while a key is held) re-rendering the component
//   tree would be exactly the "60fps re-render" problem
//   `selectionStore.ts`/`telemetryStore.ts`/`globeRotation.ts` already
//   solve the same way elsewhere in this codebase (see CLAUDE.md's
//   "Two-layer split" section) — a plain mutable value read on demand, no
//   subscription.
// - One-shot (everything else: arrows, Enter, Esc, Tab, Space, R, L, I, /) —
//   dispatched exactly once per keydown via a callback, registered through
//   `useKeyboardController()`.
import { useEffect, useRef } from 'react'
import { invalidate } from '@react-three/fiber'
import type { ActionCommand, CameraNudgeCommand } from './types'

/**
 * Keyboard shortcuts must respect application focus — typing in the search
 * bar (or any text input) must never trigger a shortcut. Exported so
 * `hud/SettingsPanel.tsx`'s shortcuts reference and any future input-aware
 * code can reuse the same check rather than each re-deriving it.
 * `CameraControls.tsx`'s pre-existing Home-key handler has its own
 * equivalent inline check (not touched here — see that file) predating
 * this module; this is the same rule, just factored out for new code.
 */
export function isTypingInField(): boolean {
  const active = document.activeElement
  if (active instanceof HTMLInputElement || active instanceof HTMLTextAreaElement) return true
  return active instanceof HTMLElement && active.isContentEditable
}

const CONTINUOUS_KEY_MAP: Record<string, CameraNudgeCommand> = {
  w: 'zoom-in',
  s: 'zoom-out',
  a: 'rotate-left',
  d: 'rotate-right',
  q: 'tilt-up',
  e: 'tilt-down',
}

// Case-sensitivity note: `e.key` for a plain letter press is already
// lowercase ('w'); it only becomes 'W' with Shift held. Lowercasing before
// lookup means Shift+W still zooms in rather than silently doing nothing —
// there's no shifted variant of any of these bindings, so there's nothing
// to lose by treating them the same.
const ONE_SHOT_KEY_MAP: Record<string, ActionCommand> = {
  r: 'reset-view',
  ' ': 'focus-selection',
  arrowup: 'select-north',
  arrowdown: 'select-south',
  arrowleft: 'select-west',
  arrowright: 'select-east',
  enter: 'open-inspector',
  escape: 'dismiss',
  l: 'toggle-layers',
  i: 'toggle-inspector',
  '/': 'open-search',
  t: 'toggle-ambient-rotation',
}

// Currently-held continuous camera commands — see the module doc comment
// above for why this is a plain Set, not React state.
const activeCameraCommands = new Set<CameraNudgeCommand>()

/** Read imperatively, once per animation frame, by CameraController.useCameraController — never call this from a React render. */
export function getActiveCameraCommands(): ReadonlySet<CameraNudgeCommand> {
  return activeCameraCommands
}

/**
 * Attaches the app's single keyboard listener and dispatches one-shot
 * commands to `onCommand`. Mount exactly once (InputManager.tsx does this)
 * — a second mount would attach a second `window` listener and double-fire
 * every command.
 *
 * `onCommand` is read through a ref updated on every render rather than
 * depended on directly, so the underlying `window.addEventListener` call
 * (and the Set instance above) never needs to be torn down and re-attached
 * just because the caller's callback closure changed — the listener always
 * calls whatever `onCommand` most recently was, without ever re-running the
 * `useEffect` that sets it up.
 */
export function useKeyboardController(onCommand: (command: ActionCommand) => void): void {
  const onCommandRef = useRef(onCommand)
  onCommandRef.current = onCommand

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      // Never hijack a browser/OS shortcut (Ctrl+W close tab, Cmd+R
      // reload, Alt+Tab, ...) — only Shift is a meaningful modifier here
      // (Tab vs. Shift+Tab), so any other modifier means "not for us."
      if (e.ctrlKey || e.metaKey || e.altKey) return
      if (isTypingInField()) return

      if (e.key === 'Tab') {
        e.preventDefault()
        onCommandRef.current(e.shiftKey ? 'cycle-category-backward' : 'cycle-category-forward')
        return
      }

      const key = e.key.toLowerCase()

      const continuous = CONTINUOUS_KEY_MAP[key]
      if (continuous) {
        e.preventDefault()
        activeCameraCommands.add(continuous)
        // Phase 2 (Plan.md): this Set mutation happens entirely outside
        // React and outside the Canvas tree (see the module doc comment
        // above for why) — under demand mode, nothing else would ever
        // cause the first frame that lets
        // input/CameraController.ts's useFrame notice this key is held at
        // all. invalidate() (bare import, not tied to any component) is
        // the same function R3F exposes for exactly this "wake the render
        // loop from outside a component" case.
        invalidate()
        return
      }

      const oneShot = ONE_SHOT_KEY_MAP[key]
      if (oneShot) {
        e.preventDefault()
        onCommandRef.current(oneShot)
      }
    }

    function onKeyUp(e: KeyboardEvent) {
      const command = CONTINUOUS_KEY_MAP[e.key.toLowerCase()]
      if (command) activeCameraCommands.delete(command)
    }

    // A held key's keyup can be lost entirely (alt-tabbing away, the OS
    // swallowing focus, ...) — without this the camera would keep nudging
    // forever with no way to stop it short of pressing the same key again.
    function onBlur() {
      activeCameraCommands.clear()
    }

    window.addEventListener('keydown', onKeyDown)
    window.addEventListener('keyup', onKeyUp)
    window.addEventListener('blur', onBlur)
    return () => {
      window.removeEventListener('keydown', onKeyDown)
      window.removeEventListener('keyup', onKeyUp)
      window.removeEventListener('blur', onBlur)
      activeCameraCommands.clear()
    }
  }, [])
}
