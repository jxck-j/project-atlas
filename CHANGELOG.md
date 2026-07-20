# Changelog

Versioning here isn't semver. It's:

- **New major version (v1, v2, v3, ...)** — a new capability was added: a new
  panel, a new data layer, a new interaction mode. Example: adding the search
  bar, adding points of interest, adding a filter section.
- **Point release (v1.1, v1.2, ... v2.1, ...)** — an existing feature was
  changed, tuned, moved, or fixed within the current major version. Example:
  adjusting transparency, moving the search bar, a bug fix.

Each entry should say *what* changed and, where it's not obvious, *why*.

Starting with v2.0, Atlas is organized around long-lived **engines** rather
than a flat feature list (Rendering, Layer, and eventually Country,
Relationship, Intelligence, Data, Timeline). Every new major version should
name which engine it expands and how that reduces future complexity — see
`CLAUDE.md`'s Architecture section.

## v2.3.0 — Territories get real, clickable, highlighted geometry

Point release under v2 (same call as v2.2.0's "Geometry Map" entry: new
files/behavior, but it completes infrastructure v2.1-v2.2 already built —
GeometryMap, EntityResolver, entity-based selection — rather than
introducing a new system the way v2.0's Layer Engine did). This is the
first version where a territory has any presence on the globe itself:
Taiwan, Puerto Rico, and Western Sahara are now real rendered shapes you
can hover and click, exactly like a country. `scene/countryGeometry.ts`'s
border/fill/centroid math — built for countries — turned out to need zero
changes to serve a second entity kind, which is the whole reason that
module exists as generic geometry math rather than country-specific code.

### Added

- `src/entities/territoryGeometryIds.ts`: single source of truth mapping a
  raw ISO 3166-1 numeric id (`"158"`, `"630"`, `"732"`) to the territory
  registry id it belongs to (`taiwan`, `puerto-rico`, `western-sahara`) —
  used by both the new build script and the new runtime hook so they can't
  drift apart.
- `scripts/buildTerritoryTopology.mjs` (`npm run build:geo:territories`,
  folded into `npm run build:geo`): extracts just those three features from
  the same `world-atlas` 10m source `buildCountryTopology.mjs` already
  reads, simplifies and re-quantizes them the same way, writes
  `public/geo/territories.json`. Separate output file from
  `countries-un193.json` — these aren't UN members and don't belong in the
  "exactly 193" set that pipeline guards.
- `src/scene/useTerritoryFeatures.ts`: fetches that file, converts it to
  GeoJSON, and — this is the part that actually makes clicking work —
  calls `registerGeometryMapping(geometryId, entityId)` for each feature,
  finally exercising the `polygon_id -> entity_id -> EntityResolver` chain
  `GeometryMap.ts` (v2.2.0) built and left unused until now.
- `src/scene/Territories.tsx`: mirrors `Countries.tsx` closely — same
  merged-geometry-per-entity approach, same hover/select/dim color logic
  (identical palette, deliberately: a territory reads as "another
  selectable thing," not a different visual category), same click-vs-drag
  threshold. Kept as its own file rather than generalizing `Countries.tsx`
  into a shared component, so this addition couldn't regress already-
  verified country behavior — same reasoning `CountryRegistry.ts`/
  `TerritoryRegistry.ts` are two files instead of one generic `Registry<T>`.
- `Globe.tsx` now mounts `<Territories />` alongside `<Countries />`.
- `hud/CommandBar.tsx`: a new `TERRITORIES` segment next to `COUNTRIES`,
  reflecting the same "what's actually rendered right now" semantics
  (`useTerritoryFeatures().length`), not the full registry count — Crimea
  (registered but geometry-less) intentionally doesn't count toward it.

### Fixed

Two real bugs turned up during live verification, both from places where
territories quietly inherited an assumption that only ever had to be true
for countries:

- **Selected territories rendered dimmed instead of highlighted.**
  `TerritoryEntry` initially stored one `id` (the shape's own geometry id,
  e.g. `"158"`) and compared it directly against `selected.id` — which is
  always the *resolved entity's* id (`"taiwan"`). For a country these are
  the same string by construction, so `Countries.tsx`'s identical-looking
  comparison works; for a territory they're deliberately different (that's
  the entire point of `GeometryMap`), so `isSelected` was always `false`
  and a selected territory got the same faint dimmed treatment as
  everything else instead of the red selected color. Fixed by splitting
  `TerritoryEntry` into `geometryId` (hover state, `GeometryMap` lookups)
  and `entityId` (compared against `selected.id`).
- **Selecting the Taiwan territory showed Taipei's capital marker.**
  `Globe.tsx`'s `CapitalMarker` looked up `COUNTRY_PROFILES[selected.name]`
  by name only, with no check on `selected.entity.kind`. `countryProfiles.ts`
  happens to have a `"Taiwan"` entry (illustrative country data, unrelated
  to the Territory registry entry of the same name) — since territories
  were never independently selectable before this version, the name
  collision was latent and harmless. The moment a Territory named "Taiwan"
  became selectable, `selected.name === "Taiwan"` started matching that
  country-profile entry and showing its capital marker on a Territory
  selection. Fixed by gating on `selected.entity.kind === 'country'` first.

### Notes

- Crimea still has no rendered geometry — it has no standalone polygon
  anywhere in the source data at any resolution (see v2.2.0/LOGBOOK.md),
  so there's nothing for `buildTerritoryTopology.mjs` to extract. It stays
  selectable via search only until a real sub-region shape exists.
- Verified live, not just type-checked: hovering Taiwan's actual rendered
  shape shows the gold hover label; clicking it opens the Territory panel
  with no camera flight (matches "click just opens the panel," unchanged
  from countries); clicking a country (China) while a territory was
  selected correctly switches the panel, and clicking back onto Taiwan's
  shape switches it back — real geometry, both directions, through
  `GeometryMap -> EntityResolver -> selectEntity`. Zero console errors
  throughout. Country click/hover/highlight behavior (Japan) reconfirmed
  unchanged.
- See `LOGBOOK.md` for why both fixed bugs are examples of the same root
  cause — a hardcoded assumption that was only ever exercised by countries
  before now, quietly relied upon, and only surfaces once a Territory
  actually runs the same code path for the first time.

## v2.2.4 — Search expanded to all registered entities

Point release. `hud/SearchBar.tsx` no longer only searches the rendered
country list — it now searches every registered `Country` and `Territory`
and shows each result's entity type. Same "extend an existing feature to a
new entity kind" shape as v2.2.1 (selection) and v2.2.2 (the Intelligence
HUD); search is the third and, for now, last of the pieces that assumed
"selectable thing" meant "country."

### Added

- `data/registry/territories.ts` — the first **real**, always-loaded
  territory data (Taiwan, Puerto Rico, Crimea, Western Sahara), registered
  into `TerritoryRegistry` as a side effect of importing `data/index.ts`.
  Distinct from `registry/exampleTerritories.ts`, which stays deliberately
  unimported (same neutral framing, reused). Puerto Rico is new — added
  specifically because it's an uncontroversial dependency (`status:
  'dependency'`, `parentCountryId: 'USA'`, no claimants), unlike the other
  three, which are all genuinely disputed.
- `hud/SearchBar.tsx`: results are now a live, ranked (exact → starts-with
  → contains) dropdown of up to 8 matches across countries *and*
  territories, each row labeled `COUNTRY` or `TERRITORY`. Selecting a
  result — by click, or Enter for the top match — resolves the id through
  `EntityResolver.resolveEntity()` and calls the generic `selectEntity()`,
  the same resolution path a map click uses, instead of the old
  country-only `selectCountry()`.

### Fixed

- `hud/selectionStore.ts`'s v2.2.3 dev-only `__debugSelectTerritory` hook
  used to import `registry/exampleTerritories.ts` to guarantee something
  was registered to select. With real territory data now always loaded,
  that import started throwing an uncaught "already registered" error on
  every dev page load (both modules register the same ids). Removed —
  `EntityResolver`'s own `../data` import already pulls in the real
  dataset, so the hook needs nothing extra.

### Notes

- No changes to `scene/CameraControls.tsx`, `useCameraFlight.ts`, or any
  highlighting logic in `scene/Countries.tsx` — camera behavior and
  highlighting are exactly as before for country selections; territory
  selections still don't highlight anything on the globe (no territory has
  real geometry yet — see v2.2.0/v2.2.1's notes).
- Verified live: typed each of China/Taiwan/Puerto Rico/Crimea/Western
  Sahara into search and confirmed the dropdown returns exactly one result
  per query with the correct type label; clicked the Puerto Rico result
  and confirmed a real camera flight plus a correct Territory card;
  confirmed Enter-to-fly on an exact country match (Japan) and the
  NOT FOUND state both still work. Zero console errors after the fix above.
- See `CLAUDE.md` for how a future registry (Conflict, Relationship, ...)
  plugs into search the same way Territory just did.

## v2.2.3 — Dev-only console hook for territory selection

Point release. No architecture change — this exists because there is
currently no way to reach a Territory card through normal interaction at
all: no territory has real clickable geometry on the globe yet, and
`exampleTerritories`/`exampleGeometryMappings` are never imported by the
running app (both true since v2.1.2/v2.2.0, by explicit design). Country
selection/rendering is untouched.

### Added

- `hud/selectionStore.ts`: in dev builds only (`import.meta.env.DEV`, dead-
  code-eliminated from production), installs
  `window.__debugSelectTerritory(id)` — resolves `id` through
  `EntityResolver` and, if found, selects it through the same store
  instance the mounted app already uses, so the Intelligence panel
  re-renders for real. Unknown ids `console.warn` instead of throwing.
  Try `'taiwan'`, `'crimea'`, or `'western-sahara'`.

### Notes

- This is the same technique used to verify Territory cards for v2.2.2,
  kept around instead of reverted, since it's the only way to see that
  work without first building real territory geometry (a separate, larger
  future task).

## v2.2.2 — Intelligence HUD upgraded to Entity-based

Point release. The Intelligence panel no longer assumes the selected thing
is always a country — it renders a different, kind-appropriate set of
fields depending on `selected.entity.kind`. Country cards are pixel-
identical to before; Territory cards are new.

### Changed

- `hud/IntelligencePanel.tsx` now dispatches on `selected.entity.kind`:
  `CountryDetails` (unchanged — same `COUNTRY_PROFILES` lookup, same four
  fields, same fallback message) for `'country'`, new `TerritoryDetails`
  for `'territory'`.
- **Territory cards** show: ENTITY TYPE (`"Territory"`), CONTROLLER
  (`Territory.controllingAuthorities`, joined — omitted entirely if
  empty), CLAIMANTS (`Territory.claimants`, joined — omitted if empty),
  POLITICAL STATUS (`Territory.status`, title-cased). No new components,
  no new styling — every row reuses the existing `DataRow`.

### Notes

- No new tabs, no styling changes, no changes to `src/layers/`.
- Verified live in a browser, not just type-checked: confirmed the country
  card (Japan, via search) is unchanged, then force-selected the
  `western-sahara` example territory (which has split control — two
  controllers, two claimants) through the app's own live selection store
  and confirmed every field rendered correctly, gracefully, with the exact
  same visual styling as a country card. Zero console errors.
- See `LOGBOOK.md` for how the country/territory split is meant to extend
  to future entity kinds.

## v2.2.1 — Selection migrated to Entity Resolution

Point release. The first version in this series that actually wires the
Entity Resolution/Geometry Map architecture (v2.1.3/v2.2.0) into live
behavior — everything before this was unconnected scaffolding. Country
selection is verified pixel-identical to before; territory selection is
now structurally possible (once real territory geometry exists — still not
built).

### Changed

- **Selection pipeline**: a map click now resolves `polygon_id ->
  (GeometryMap ??) EntityResolver -> SelectedEntity`, instead of directly
  constructing a country selection from the clicked polygon's own
  id/name. See `scene/Countries.tsx`'s `handlePointerUp`.
- `hud/selectionStore.ts`: `selected` is now a generic `SelectedEntity`
  (wraps a `ResolvedEntity` — country *or* territory) instead of
  `SelectedCountry`. `id`/`name`/`direction` stay denormalized at the top
  level, so `IntelligencePanel.tsx`, `Countries.tsx`'s highlight logic, and
  `Globe.tsx`'s `CapitalMarker` needed **zero changes** — they already only
  read those generic fields. New `selectEntity(entity, direction)` is the
  generic entry point; `selectCountry({id, name, direction})` still exists
  unchanged as a country-only compatibility wrapper for `hud/SearchBar.tsx`.
- `scene/useCountryFeatures.ts` now registers each fetched country feature
  into the Country Registry (minimal id/name records) right after they
  load — a necessary prerequisite this version depends on: without it, the
  registry would still be empty and every resolution would fail. See
  `LOGBOOK.md`.

### Notes

- **Zero changes** to `hud/SearchBar.tsx`, `hud/IntelligencePanel.tsx`,
  `scene/Globe.tsx`, `scene/CameraControls.tsx`, or `scene/useCameraFlight.ts`
  — confirmed via `git status` (only `selectionStore.ts`, `Countries.tsx`,
  `useCountryFeatures.ts` touched).
- Verified live in a browser, not just type-checked: search-select and
  map-click-select both produce an identical panel/highlight/camera-flight
  experience, zero console errors.
- If entity resolution ever somehow misses for a real click (shouldn't
  happen now that the registry is populated), the click handler falls back
  to the old country-shaped selection path rather than silently selecting
  nothing.

## v2.2.0 — Geometry Map

Point release under v2 (per the project's own convention this is arguably
borderline — it's a new file/API, but still architectural prep with no
shippable behavior change, the same character as v2.1.x). Completes the
`polygon_id -> entity_id -> EntityResolver` chain a future click handler
will use. No rendering, highlighting, or `Globe.tsx` changes.

### Added

- `src/entities/GeometryMap.ts`: `registerGeometryMapping(geometryId,
  entityId)`, `hasGeometryMapping(geometryId)`, `getEntityForGeometry
  (geometryId)` — the last one walks the full chain (geometry id -> entity
  id -> `resolveEntity()`) and returns a ready-to-use `ResolvedEntity`.
  Plain `Map<string, string>` storage, same duplicate-throws convention as
  `CountryRegistry`/`TerritoryRegistry`.
- `src/entities/exampleGeometryMappings.ts`: placeholder mappings for
  Taiwan (`"158"`) and Western Sahara (`"732"`) — their real ISO 3166-1
  numeric ids from the raw Natural Earth source data, even though neither
  is part of the rendered UN-193 set — and Crimea (a synthetic id, since
  Crimea has no standalone polygon anywhere in the source data; see
  `LOGBOOK.md`). **Not imported anywhere the app loads.**

### Notes

- Verified end to end at runtime: `getEntityForGeometry('158')` resolves
  through to the full Taiwan territory record; an unmapped id correctly
  returns `undefined` from both `hasGeometryMapping` and
  `getEntityForGeometry`.
- `scene/Countries.tsx` still uses a rendered polygon's own GeoJSON feature
  id directly as its country id — this version doesn't change that, it
  builds the seam that would let it stop being a hardcoded 1:1 assumption.

## v2.1.3 — Entity Resolution layer

Point release. Adds the seam that will eventually let a clicked map polygon
resolve to a country *or* a territory, without the click handler needing to
know which registry to check. No rendering, HUD, or search changes — the
globe still treats every selectable polygon as a country, unchanged.

### Added

- `src/entities/types.ts`: `GeopoliticalEntity`, the minimal shape every
  entity has (`id`/`name`/`aliases`/`provenance`) — `Country` and
  `Territory` already satisfy it structurally, no changes made to either.
  `ResolvedEntity`, a discriminated union (`kind: 'country' | 'territory'`)
  with a normalized `location` (`Country.capital`/`Territory.location`
  under one name) and `data` (the full original record).
- `src/entities/EntityResolver.ts`: `resolveEntity(id)` (checks the Country
  Registry, then the Territory Registry), `resolveCountry(id)`,
  `resolveTerritory(id)`. Returns `undefined` for an unregistered id rather
  than throwing — resolution is a lookup, not an assertion.

### Notes

- Verified end to end (not just type-checked): registered a test country,
  resolved it and the v2.1.2 example territories through `resolveEntity`,
  confirmed cross-registry lookups (`resolveCountry` on a territory id,
  `resolveTerritory` on a country id) correctly return `undefined`.
- Nothing imports this yet. `scene/Countries.tsx` still calls
  `selectCountry()` directly on click — wiring the globe's click handler
  through `resolveEntity()` is future work, not this version.
- See `CLAUDE.md` for how future systems are expected to consume this
  instead of `CountryRegistry`/`TerritoryRegistry` directly.

## v2.1.2 — Territory Registry: control vs. claims

Point release. Extends the schema/registry architecture to politically
complex territories (disputed areas, unrecognized states, split-control
regions) — still no visualization, no change to country rendering or
`Globe.tsx`.

### Added

- `src/data/registry/TerritoryRegistry.ts`: `registerTerritory`/
  `getTerritory`/`getTerritories`, same architecture as `CountryRegistry.ts`
  (register throws on duplicate id; doesn't import any JSON itself).
- **Schema revision** in `data/types.ts`: `Territory` now has
  `controllingAuthorities: ControllingAuthority[]` (who administers it in
  practice, right now — a list, since control is often split) as a field
  *independent* from `claimants: TerritoryClaimant[]` (who claims
  sovereignty). Previously "de-facto-control" was one of several possible
  values inside a claimant's `claimType`, conflating control with claiming;
  it's now its own field. `TerritoryClaimant` and the new
  `ControllingAuthority` both accept an optional `countryRef`/`ref` plus a
  required `displayName`, since the relevant entity (a de facto government,
  an unrecognized state) is frequently not itself a registered UN-member
  `Country` in this dataset.
- `src/data/registry/exampleTerritories.ts`: three illustrative entries
  (Taiwan, Crimea, Western Sahara) exercising the schema against real,
  non-trivial cases — including Western Sahara's genuinely split control
  (Morocco administers most of the territory; the Polisario Front/SADR
  administers the rest). **Not imported anywhere the app loads** — exists to
  validate the schema and as a worked example, not to ship as real data.
  Explicitly caveated in-file as illustrative, not this project's editorial
  position on any of these disputes.

### Notes

- `getCountries`/`getTerritory`/`getTerritories`/`registerTerritory` are now
  re-exported from `data/index.ts` alongside the Country registry.
- See `LOGBOOK.md` for why control and claims are separate fields rather
  than one field with a type flag, and `CLAUDE.md` for why that separation
  is what keeps this data-driven rather than hardcoded.

## v2.1.1 — Country Registry

Point release. Adds the query seam future layers/HUD code will use to look
up countries, mirroring `src/layers/layerRegistry.ts`'s architecture —
still no visualization, no data, no change to existing globe behavior.

### Added

- `src/data/registry/CountryRegistry.ts`: `registerCountry`/`getCountry`/
  `getCountries`/`removeCountry` over a plain, non-reactive `Map<string,
  Country>`. Registering a duplicate id **throws** (deliberately stricter
  than the Layer Registry's warn-and-overwrite — see `LOGBOOK.md`).
- `src/data/index.ts`: public barrel re-exporting the data types and
  registry functions — the intended single import point for any future
  consumer, so nothing needs to import `data/countries/countries.json` (or
  any other data type's JSON) directly.

### Notes

- The registry holds no opinion about where `Country` records come from —
  it doesn't import `countries.json` itself. That JSON is still empty, and
  nothing populates the registry yet; this version is the mechanism, not
  the wiring.
- No existing files changed besides documentation and `package.json`'s
  version — verified via `git status`.

## v2.1 — Data architecture foundations

Point release, not a new major version — this is preparatory schema/type
work with nothing populated and nothing consuming it yet, not a shippable
capability in its own right. (Contrast with v2.0's Layer Engine, which was
also "architectural only" but stood up a working, wired-in system — this is
one step earlier than that: the data shape future layers will read from.)

### Added

- `src/data/types.ts`: TypeScript interfaces for `Country`, `Territory`,
  `Conflict`, and `Relationship`, plus shared helper types (`EntityRef`,
  `GeoPoint`, `DataProvenance`). Attribute/facts data, deliberately separate
  from both the rendering geometry in `scene/countryGeometry.ts` and the
  existing presentation-formatted `data/countryProfiles.ts`.
- `src/data/{countries,territories,conflicts,relationships}/*.json`: empty
  (`[]`) data files matching those interfaces — the schema exists, nothing
  is populated.

### Notes

- Nothing renders, nothing is wired into the Layer Engine or `Globe.tsx`,
  and no existing functionality changed — verified via `git status` showing
  only new files.
- See `LOGBOOK.md` for the reasoning behind specific type decisions (numeric
  vs. formatted population/GDP, the discriminated `EntityRef`, why category-
  like fields stay open strings).

## v2.0 — Layer Engine

Architectural only — no new production visualization. Builds the plugin
system future visualization modules (terrain, infrastructure, conflict
zones, relationship arcs, live data, ...) will register through, so adding
one never again means editing `Globe.tsx`.

### Added

- Layer Engine (`src/layers/`): a registry (`registerLayer`/
  `getLayerDefinitions`), a runtime enabled/disabled store (same
  `useSyncExternalStore` pattern as the rest of the HUD state), a manager
  that mounts/unmounts enabled layers with per-layer error isolation and
  lifecycle logging, and a single `<LayerEngine />` entry point that
  `Globe.tsx` renders.
- Layer Panel (top-left toolbar, 🗂): lists every registered layer grouped by
  category with an on/off toggle.
- Three placeholder layers (terrain, infrastructure, conflict) demonstrating
  the registration workflow end to end — each is registration + lifecycle
  logging + a trivial debug marker, not real data or visualization.

### Notes

- Existing v1.0 functionality (globe, countries, camera, search, settings,
  intelligence panel) is unchanged — the Layer Engine is purely additive.
- See `LOGBOOK.md` for the reasoning behind the Registry/Store/Manager/Engine
  split and the registration-via-import-side-effect pattern.

## v1.0 — Initial release

The baseline globe, HUD, and interaction model, covering all 193 UN member
states.

### Added

- Holographic wireframe globe: graticule grid, glowing country borders/fills,
  Fresnel atmosphere rim, translucent-while-idle / solid-while-selected core
  shell.
- Country data for all 193 UN member states (not the ~255-feature raw Natural
  Earth set, which also includes dependencies/disputed territories/uninhabited
  regions) — see `scripts/buildCountryTopology.mjs`.
- Click a country to select it (opens the intelligence panel with government/
  capital/population/GDP for the ~60 countries with profile data); hover a
  country to see its name (inline for large countries, leader-line callout for
  small ones); hover the globe to read live lat/lng coordinates.
- Capital-city marker (leader-line callout) for the selected country, when
  profile data exists for it.
- Ocean/sea/gulf/strait/bay labels — oceans always visible, smaller bodies
  reveal on zoom.
- Camera: drag-to-orbit with flick-to-spin, scroll-to-zoom, ambient idle
  auto-rotation, a cinematic "FOCUS CAMERA" fly-to for the selected country,
  and reset-to-global-view via Home key / double-click on ocean / toolbar
  button.
- HUD: top-left toolbar (reset view / search / settings), search-by-name with
  fly-to, camera sensitivity settings, bottom status bar (ready state,
  connection status, country count, FPS, hover coordinates), bottom-left
  orbit telemetry.

### Notes

- Performance: country geometry is simplified and merged to one draw call per
  country (border + fill) rather than one per ring/polygon — see `LOGBOOK.md`
  for why this mattered a lot more than raw vertex count.
- `data/countryProfiles.ts` is illustrative demo data, not a live feed — see
  README.
