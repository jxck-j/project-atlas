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
