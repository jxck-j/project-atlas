import { create } from 'zustand'
import { Vector3 } from 'three'
import type { ResolvedEntity } from '../entities/types'
import { resolveCountry } from '../entities/EntityResolver'

/**
 * The currently selected geopolitical entity — a country or a territory,
 * resolved through EntityResolver (`entities/EntityResolver.ts`) rather
 * than assumed to always be a country (v2.2.1 migrated selection off
 * Country-only). `id`/`name` are denormalized copies of
 * `entity.id`/`entity.name`, kept at the top level so existing consumers
 * that only care "what's selected, generically" — `IntelligencePanel`,
 * `Countries.tsx`'s highlight logic, `Globe.tsx`'s `CapitalMarker` — didn't
 * need to change as part of this migration. A consumer that needs to know
 * *which kind* of entity this is, or needs kind-specific fields (a
 * territory's claimants, a country's population), reads
 * `entity.kind`/`entity.data`. See `LOGBOOK.md`.
 */
export interface SelectedEntity {
  entity: ResolvedEntity
  id: string
  name: string
  // World-space direction from the globe's center through the entity at
  // the moment it was selected — used to aim the camera flight.
  direction: Vector3
}

interface SelectionState {
  selected: SelectedEntity | null
  // v3.2.0: whether the Intelligence Panel is actually showing. Split out
  // from `selected` specifically for keyboard navigation — arrow-key
  // entity browsing (src/input/SelectionController.ts) needs to update
  // `selected` (the globe highlight, the status bar) on every keypress
  // *without* forcing the panel open every time, the way every pre-v3.2
  // caller (a map click, a search result) always has. See `selectEntity`'s
  // `openInspector` option below and `openInspector()`/`closeInspector()`.
  inspectorOpen: boolean
  // Increments only when a camera flight is explicitly requested (see
  // flyToSelectedCountry), so the camera flight hook can detect "start a new
  // flight" independent of selection changes. Selecting a country does NOT
  // move the camera — it just opens the info panel.
  flightSeq: number
  // Increments when the camera should fly back to the default global view
  // (Home key, double-click on ocean, or the toolbar's globe button). See
  // useCameraReset.
  resetSeq: number
  // World-space direction for flyToUsCity() below — deliberately NOT
  // reusing `selected`/`flightSeq`. US city search results (see
  // hud/SearchBar.tsx) need "fly the camera there" without the highlight,
  // Intelligence Panel entry, or Tab-cycling membership every other
  // selectable thing gets, because US city boundaries have no
  // GeoEntityRegistry entry at all — see scene/UsCityOutlineHighlight.tsx.
  flyToTarget: Vector3 | null
  flyToTargetSeq: number
  // Which US city (if any) should currently draw its boundary outline —
  // the "Google Maps approach" this layer settled on after the always-on
  // 32,608-polygon layer read as visual noise: names/search only by
  // default, one city's real outline appears only once it's actually
  // searched for. Cleared by selectEntity/clearSelection/resetView so it
  // doesn't linger once the user moves on to a normal selection — see
  // flyToUsCity below, which is the only setter (set together with
  // flyToTarget in one atomic update, never on its own).
  usCityOutline: { id: string; stateAbbrev: string; name: string } | null
}

const useSelectionStore = create<SelectionState>(() => ({
  selected: null,
  inspectorOpen: false,
  flightSeq: 0,
  resetSeq: 0,
  flyToTarget: null,
  flyToTargetSeq: 0,
  usCityOutline: null,
}))

export interface SelectEntityOptions {
  /**
   * `true` (the default — every caller before v3.2.0 gets this
   * unconditionally, since none of them pass this option at all) opens the
   * inspector, exactly as `selectEntity` has always behaved. `false` does
   * *not* close it — it leaves `inspectorOpen` exactly as it was. That
   * asymmetry is deliberate: arrow-key navigation
   * (`src/input/SelectionController.ts`) passes `false` so browsing entities
   * doesn't force the panel open on every keypress, but if the panel
   * already happens to be open (from an earlier click, search, or ENTER
   * press) it should keep showing whatever's currently selected, live, not
   * slam shut the moment the user starts navigating with arrows.
   */
  openInspector?: boolean
}

/**
 * The generic selection entry point — takes an already-resolved entity
 * (from `EntityResolver`/`GeometryMap`) plus the world-space direction to
 * aim a camera flight at. Works identically whether `entity.kind` is
 * `'country'` or `'territory'`. `scene/Countries.tsx`'s click handler is
 * the intended caller for map clicks.
 */
export function selectEntity(entity: ResolvedEntity, direction: Vector3, options?: SelectEntityOptions) {
  const shouldOpen = options?.openInspector ?? true
  useSelectionStore.setState((state) => ({
    selected: { entity, id: entity.id, name: entity.name, direction },
    inspectorOpen: shouldOpen ? true : state.inspectorOpen,
    usCityOutline: null,
  }))
}

/**
 * Country-only selection, kept so `hud/SearchBar.tsx` — which only ever
 * finds countries, since it searches the rendered country list and
 * territories aren't part of that list — doesn't need to change as part of
 * the entity migration. Resolves through the Country Registry so a
 * search-selected country produces the exact same `SelectedEntity` shape a
 * map click does; synthesizes a minimal one as a last-resort fallback if
 * the id somehow isn't registered (shouldn't happen once
 * `useCountryFeatures.ts` has populated the registry, but a click/search
 * selection should never just silently do nothing).
 */
export function selectCountry(country: { id: string; name: string; direction: Vector3 }) {
  const resolved: ResolvedEntity =
    resolveCountry(country.id) ?? {
      kind: 'country',
      id: country.id,
      name: country.name,
      aliases: [],
      data: { id: country.id, name: country.name, aliases: [], status: 'un-member' },
    }
  selectEntity(resolved, country.direction)
}

export function clearSelection() {
  useSelectionStore.setState({ selected: null, inspectorOpen: false, usCityOutline: null })
}

// v3.2.0. Opening does nothing without a selection to show — there's
// nothing for ENTER/the "I" key to open onto. Both are idempotent (opening
// an already-open panel, or closing an already-closed one, is a harmless
// no-op) since keyboard commands shouldn't need to track panel state
// themselves before calling these.
export function openInspector() {
  if (!useSelectionStore.getState().selected) return
  useSelectionStore.setState({ inspectorOpen: true })
}

export function closeInspector() {
  useSelectionStore.setState({ inspectorOpen: false })
}

// Explicitly kicks off a camera flight to the currently selected entity.
// Separate from selectEntity/selectCountry so selecting something never
// auto-moves the camera — this is only called from an opt-in UI action
// (e.g. a panel button).
export function flyToSelectedCountry() {
  if (!useSelectionStore.getState().selected) return
  useSelectionStore.setState((state) => ({ flightSeq: state.flightSeq + 1 }))
}

// Flies to a US city search result AND sets its boundary outline in one
// atomic update — `selected` stays untouched, so nothing highlights and the
// Intelligence Panel doesn't open. Deliberately one function/one notify()
// rather than two sequential setters (a "fly the camera" call followed by a
// separate "show this outline" call) — two sequential state updates leave a
// window where a subscriber could re-render on the first update before the
// second lands, briefly observing flyToTarget set but usCityOutline still
// null (or vice versa). scene/CameraControls.tsx's idle-rotation-resume
// effect reads both via `isFocused = selected != null || usCityOutline !=
// null` — an inconsistent intermediate read there is exactly the kind of
// thing that wouldn't reproduce in an automated/scripted test's tighter
// timing but could on a real, human-timed interaction. One update removes
// the window entirely rather than relying on React's batching to paper
// over it.
export function flyToUsCity(direction: Vector3, target: { id: string; stateAbbrev: string; name: string }) {
  useSelectionStore.setState((state) => ({
    flyToTarget: direction,
    flyToTargetSeq: state.flyToTargetSeq + 1,
    usCityOutline: target,
  }))
}

// Deselects whatever's selected and kicks off a camera flight back to the
// default global view.
export function resetView() {
  useSelectionStore.setState((state) => ({
    selected: null,
    inspectorOpen: false,
    resetSeq: state.resetSeq + 1,
    usCityOutline: null,
  }))
}

// Dev-only console helper. Every GeoEntity is now searchable for real
// (v2.2.4 wired the pre-v3 territory dataset into search; v3 broadened that
// to all five GeoEntity classifications — see CLAUDE.md), so this is no
// longer the only way to reach a GeoEntity card — it's kept as a quick
// console shortcut, most useful for entities with no rendered geometry
// (currently only Crimea — see entities/entityGeometryIds.ts) that can't be
// reached by clicking the globe at all.
if (import.meta.env.DEV) {
  void Promise.all([import('../entities/EntityResolver'), import('../data')]).then(
    ([{ resolveGeoEntity }, { getEntities }]) => {
      ;(window as unknown as { __debugSelectEntity?: (id: string) => void }).__debugSelectEntity = (
        id: string,
      ) => {
        const resolved = resolveGeoEntity(id)
        if (!resolved) {
          const ids = getEntities()
            .map((e) => e.id)
            .join("', '")
          console.warn(`[debug] no entity "${id}" — try one of: '${ids}'`)
          return
        }
        selectEntity(resolved, new Vector3(1, 0, 0))
      }
      console.info(
        "[debug] __debugSelectEntity(id) is available in this console — dev build only, e.g. __debugSelectEntity('crimea'). Most GeoEntities are also selectable directly on the globe and via search now.",
      )
    },
  )
}

export function useSelection() {
  return useSelectionStore()
}
