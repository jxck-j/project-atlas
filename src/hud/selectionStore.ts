import { useSyncExternalStore } from 'react'
import { Vector3 } from 'three'

export interface SelectedCountry {
  id: string
  name: string
  // World-space direction from the globe's center through the country at
  // the moment it was clicked — used to aim the camera flight.
  direction: Vector3
}

interface SelectionState {
  selected: SelectedCountry | null
  // Increments only when a camera flight is explicitly requested (see
  // flyToSelectedCountry), so the camera flight hook can detect "start a new
  // flight" independent of selection changes. Selecting a country does NOT
  // move the camera — it just opens the info panel.
  flightSeq: number
  // Increments when the camera should fly back to the default global view
  // (Home key, double-click on ocean, or the toolbar's globe button). See
  // useCameraReset.
  resetSeq: number
}

let state: SelectionState = { selected: null, flightSeq: 0, resetSeq: 0 }
const listeners = new Set<() => void>()

function notify() {
  listeners.forEach((l) => l())
}

export function selectCountry(country: SelectedCountry) {
  state = { ...state, selected: country }
  notify()
}

export function clearSelection() {
  state = { ...state, selected: null }
  notify()
}

// Explicitly kicks off a camera flight to the currently selected country.
// Separate from selectCountry so clicking a country never auto-moves the
// camera — this is only called from an opt-in UI action (e.g. a panel
// button).
export function flyToSelectedCountry() {
  if (!state.selected) return
  state = { ...state, flightSeq: state.flightSeq + 1 }
  notify()
}

// Deselects whatever's selected and kicks off a camera flight back to the
// default global view.
export function resetView() {
  state = { ...state, selected: null, resetSeq: state.resetSeq + 1 }
  notify()
}

function subscribe(listener: () => void) {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

function getSnapshot() {
  return state
}

export function useSelection() {
  return useSyncExternalStore(subscribe, getSnapshot)
}
