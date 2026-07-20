import { useSyncExternalStore } from 'react'
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

/**
 * The generic selection entry point — takes an already-resolved entity
 * (from `EntityResolver`/`GeometryMap`) plus the world-space direction to
 * aim a camera flight at. Works identically whether `entity.kind` is
 * `'country'` or `'territory'`. `scene/Countries.tsx`'s click handler is
 * the intended caller for map clicks.
 */
export function selectEntity(entity: ResolvedEntity, direction: Vector3) {
  state = {
    ...state,
    selected: { entity, id: entity.id, name: entity.name, direction },
  }
  notify()
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
  state = { ...state, selected: null }
  notify()
}

// Explicitly kicks off a camera flight to the currently selected entity.
// Separate from selectEntity/selectCountry so selecting something never
// auto-moves the camera — this is only called from an opt-in UI action
// (e.g. a panel button).
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

// Dev-only console helper: territories have no clickable geometry wired
// into the live scene yet (registering real geometry for Taiwan/Crimea/
// Western Sahara is out of scope through v2.2.2 — see LOGBOOK.md), so
// there's currently no way to reach a Territory card through normal
// interaction. This lets you trigger one by hand from devtools, e.g.
// __debugSelectTerritory('western-sahara'). Calling selectEntity() from
// inside this module (rather than a separately-imported copy) guarantees
// it's the same singleton store the mounted React tree subscribes to.
// import.meta.env.DEV is statically replaced at build time, so this whole
// branch is dead-code-eliminated from production builds.
if (import.meta.env.DEV) {
  void import('../data/registry/exampleTerritories').then(() => {
    void import('../entities/EntityResolver').then(({ resolveTerritory }) => {
      ;(window as unknown as { __debugSelectTerritory?: (id: string) => void }).__debugSelectTerritory = (
        id: string,
      ) => {
        const resolved = resolveTerritory(id)
        if (!resolved) {
          console.warn(
            `[debug] no territory "${id}" — try 'taiwan', 'crimea', or 'western-sahara'`,
          )
          return
        }
        selectEntity(resolved, new Vector3(1, 0, 0))
      }
      console.info(
        "[debug] __debugSelectTerritory('taiwan' | 'crimea' | 'western-sahara') is available in this console — dev build only.",
      )
    })
  })
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
