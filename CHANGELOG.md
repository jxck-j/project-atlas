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
