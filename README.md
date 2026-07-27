# Project Atlas — Interactive Holographic Globe

A "Global Command Interface" — a command-center-style 3D globe visualization
covering all 193 UN member states, built with React, TypeScript, Vite, Three.js,
React Three Fiber, drei, and Tailwind CSS v4.

## Design direction

Rather than a photo-real Earth texture, the globe renders as a **holographic
wireframe projection**: a graticule grid, real-world country borders (from
Natural Earth GeoJSON/TopoJSON data) rendered as thin glowing lines, a subtle
Fresnel atmosphere rim, and pulsing capital-city markers — closer to a
Halo/TRON/JARVIS tactical display than a map app.

The HUD follows the same aesthetic throughout: a dark cyan/near-black
background, cyan for default UI state, amber for section labels and
emphasis, monospaced/tracked-out uppercase text (`JetBrains Mono` for body
text, `Chakra Petch` for display headings — see `src/index.css`), thin
bordered panels with a translucent backdrop blur, and a corner-bracket +
scanline overlay (`hud/HUDFrame.tsx`) reinforcing the "instrument panel"
feel.

## Stack

React 19 · TypeScript · Vite · Three.js · `@react-three/fiber` · `@react-three/drei`
· Tailwind CSS v4 · `topojson-client`/`topojson-server`/`topojson-simplify` ·
`earcut` · `world-atlas` (source geo data)

## Getting started

```bash
npm install
npm run dev        # start dev server (http://localhost:5173)
npm run build      # type-check + production build to dist/
npm run preview    # preview the production build
npm run build:geo  # regenerate public/geo/{countries-un193,entities,states-provinces}.json
npm run docs:claims # regenerate CLAIMS.md from data/registry/geoEntities.ts
```

There's no test suite in this repo — verify changes with `tsc -b --noEmit`,
`npm run lint` (oxlint), and by actually driving the dev server.

## Interaction

- **Drag** — orbit the camera around the globe (inertial damping, keeps drifting
  briefly after release). **Flick** — release a drag while still moving fast and
  the globe keeps spinning in that direction until grabbed again; a normal
  release just lets it settle.
- **Scroll / pinch** — zoom in and out (clamped so the camera can never clip
  inside the globe or zoom out past visual context).
- The globe **auto-rotates slowly when idle**, freezing as soon as a country is
  selected.
- **Hovering a country** brightens its border/fill and shows its name — inline
  for large countries, as a leader-line callout (pointing off to a label) for
  small ones, matching atlas annotation conventions.
- **Clicking a country** selects it immediately: it turns red, every other
  country dims, the intelligence panel slides in from the right with whatever
  data is available for it, and the globe's core shell goes from a translucent
  holographic sphere to fully solid. Clicking does **not** move the camera —
  the panel has an explicit **FOCUS CAMERA** button for that (a cinematic
  rotate-then-zoom tween). If the country has capital-city data, a marker with
  a pointed leader-line callout appears. A quick drag-then-release over a
  country is correctly ignored as a rotate gesture, not a click.
- **Reset to the global view** — press **Home**, double-click empty ocean, or
  click the 🌍 button in the top-left toolbar. Clears the current selection and
  cinematically flies the camera back to the default framing.
- The top-left **toolbar** also has 🔍 **Search** (type a country name, press
  Enter — selects it and flies the camera there), 🗂 **Layers** (toggle
  visualization layers on/off — as of v2.0 these are architecture-validating
  placeholders, not real data; see Layer Engine below), and ⚙ **Settings**
  (camera rotate/zoom sensitivity, with a reset).
- **Water body labels** (oceans always; seas/gulfs/straits/bays once you zoom
  in past a threshold) sit on the globe surface and hide themselves on the far
  side of the sphere so they don't float through it.
- Closing the intelligence panel (✕) clears the selection.
- **Ambient rotation** (v3.3.1) is off by default and toggled with **T** —
  see the Keyboard bullet below. It's still frozen automatically while a
  country/entity is selected, so the focused thing never drifts out from
  under the camera.
- **Keyboard** (v3.2.0, "Phase 3.2") — full navigation without a mouse,
  reading from and writing to the exact same selection state as clicking/
  search. Camera: **W/S** zoom, **A/D** rotate, **Q/E** tilt, **R** reset
  view, **Space** focus camera on the selection, **T** toggle ambient
  rotation (v3.3.1). Entity navigation:
  **arrow keys** select the nearest entity in that geographic direction
  (evaluated by real bearing/distance, not screen position — see
  `CLAUDE.md`'s Input Layer section), **Tab**/**Shift+Tab** cycle through
  the seven selectable categories (v4.0 adds administrative divisions).
  Inspector: **Enter** opens it, **Escape**
  closes it first and clears the selection on a second press, **I**
  toggles it. HUD: **L** toggles the Layer Panel, **/** opens search.
  Disabled while typing in a text field. Full reference in the
  ⚙ Settings panel.
- **Category highlighting** (v3.3.0, extended v4.0) — the 🗂 Layers panel has
  a HIGHLIGHT group with one toggle per selectable classification (sovereign
  states, geopolitical entities, territories, strategic/military regions,
  maritime features, geographic regions, administrative divisions).
  Enabling one highlights every entity in
  that category at once, in violet, independent of and simultaneous with
  the current selection — toggle more than one on together and both
  categories stay highlighted.

## Architecture

```
src/
  scene/                    Everything inside the R3F <Canvas>
    Scene.tsx                Canvas setup (frameloop="never" — see FrameRateCap),
                               lighting, starfield; composes Globe + camera + probes
    Globe.tsx                 Composes graticule, Countries, GeoEntities,
                               CapitalMarker, WaterLabels, and the core/
                               atmosphere shells; owns the ambient
                               self-rotation and the double-click-on-ocean /
                               hover-coordinate handlers on the core sphere.
                               CapitalMarker (country-only, since v2.3.0
                               explicitly checks entity.kind) shows the
                               selected country's capital
    Countries.tsx             Renders one merged border lineSegments + one merged
                               fill mesh PER COUNTRY (not per ring/polygon — see
                               countryGeometry.ts); owns hover state, cursor, and
                               kicks off selection on click
    GeoEntities.tsx            (v3.0.0, replacing v2.3.0's Territories.tsx)
                               Same rendering approach as Countries.tsx, for
                               every registered GeoEntity with real geometry
                               (53 of 54 — everything except Crimea, see
                               CLAUDE.md). Primary selection only — no
                               parent/claims overlay logic here, that's
                               layers/geoOverlays/. Own file, not a shared
                               component with Countries.tsx, so this can't
                               regress already-verified country behavior
    geoEntityEntries.ts        (v3.0.0) The "raw GeoJSON feature -> renderable
                               entry" logic pulled out of GeoEntities.tsx into
                               a plain .ts module so the geoOverlays layers
                               can share it without a .tsx file exporting a
                               non-component value from itself
    StatesProvinces.tsx        (v4.0) 294 admin-1 state/province boundaries
                               across 9 large countries — same rendering
                               approach as GeoEntities.tsx, own file for the
                               same "can't regress verified behavior" reason
    useStatesProvincesFeatures.ts (v4.0) Fetches states-provinces.json;
                               creates GeoEntity records directly from the
                               fetched geometry (unlike useGeoEntityFeatures.ts,
                               which only maps geometry onto an already
                               hand-curated dataset)
    countryGeometry.ts         GeoJSON -> antimeridian-safe border segments /
                               earcut-triangulated fill geometry / centroid /
                               angular extent, all merged per-country and
                               projected onto the sphere. Fully generic —
                               geoEntityEntries.ts (v3.0.0) reuses it unchanged
    countryEntries.ts           (v3.3.0) buildCountryEntries() — "raw country
                               feature -> border/fill geometry", factored out
                               of ClaimsOverlayLayer.tsx once
                               CategoryHighlightLayer.tsx needed the same
                               thing; mirrors geoEntityEntries.ts for the
                               GeoEntity side
    PointerMarker.tsx            (v3.3.0) Shared "pulsing dot + leader line +
                               label" callout — Globe.tsx's CapitalMarker and
                               ClaimsOverlayLayer.tsx's related-country
                               marker both render through this one, tuned
                               component after both were reported as too
                               large/far-swinging
    useCountryFeatures.ts     Fetches + parses countries-un193.json once,
                               shared via a singleton useSyncExternalStore;
                               also registers each feature into the Country
                               Registry (v2.2.1) so EntityResolver can
                               resolve a real click
    useGeoEntityFeatures.ts    (v3.0.0, replacing useTerritoryFeatures.ts)
                               Same pattern as useCountryFeatures.ts for
                               entities.json; registers real GeometryMap
                               mappings (geometry id -> entity id) as each of
                               the 55 rendered features loads
    CameraControls.tsx        OrbitControls setup: clipping-safe distance
                               bounds, sensitivity wiring, Home-key handling,
                               composes the flight/reset/flick hooks below
    useFlickAutoRotate.ts     Pointer-velocity tracking: stop-on-drag /
                               resume-on-flick for ambient rotation
    useCameraFlight.ts        Cinematic tween to a selected country — triggered
                               only by flyToSelectedCountry(), not by selection
    useCameraReset.ts         Cinematic tween back to the default global view
    globeRotation.ts          Non-reactive publisher of the globe's current Y
                               rotation, read by SearchBar to aim a fly-to
                               without a clicked mesh to read a world matrix from
    tweenMath.ts              Shared easing + angle-interpolation helpers
    AtmosphereMaterial.tsx    Custom Fresnel-glow shader material (drei shaderMaterial)
    TelemetryProbe.tsx        Samples camera spherical coords + FPS each frame
                               -> HUD telemetryStore
    FrameRateCap.tsx          Manually drives R3F's render loop (advance()) at a
                               hard 60fps cap — see CLAUDE.md for a real bug this
                               caused if you touch it
    constants.ts              Shared GLOBE_RADIUS + camera distance bounds
    highlightColors.ts         (v3.1.0) Single source of truth for every
                               highlight/selection color the globe renders —
                               Countries.tsx, GeoEntities.tsx, and both
                               geoOverlays layers all source their colors
                               from here; hud/LegendPanel.tsx explains the
                               same values
  layers/                    The Layer Engine (v2.0) — pluggable visualization
                               modules; Globe.tsx only ever mounts <LayerEngine />
    types.ts                   The LayerDefinition contract every layer implements
    layerRegistry.ts            Plain registerLayer()/getLayerDefinitions() catalog
    layerStore.ts                Enabled/disabled runtime state (useSyncExternalStore,
                                 same pattern as the hud/*Store.ts files)
    LayerManager.tsx              Mounts/unmounts enabled layers, per-layer error
                                 boundary, mount/unmount lifecycle logging
    LayerEngine.tsx                Public entry point — the only thing Globe.tsx
                                 imports from this directory
    LayerErrorBoundary.tsx          Isolates one layer's crash from the rest
    index.ts                       Barrel — import from here, not individual files
    placeholders/                  Example layers demonstrating registration +
                                 lifecycle only (terrain/infrastructure/conflict);
                                 no real data or production visualization yet
    geoOverlays/                    (v3.0.0) The first real (non-placeholder)
                                 layers: ParentOverlayLayer.tsx (default on,
                                 green — highlights a selected sovereign's
                                 dependent GeoEntities) and
                                 ClaimsOverlayLayer.tsx (default on).
                                 ClaimsOverlayLayer renders BOTH directions
                                 of a claim (v3.1.0): claimed GeoEntities get
                                 a magenta dashed border on GeoEntity
                                 geometry; claimant Countries (a Country has
                                 no presence in GeoEntity geometry at all)
                                 get a separate blue dashed-border +
                                 prominent-fill + labeled-marker treatment
                                 on Country geometry, fetched independently
                                 via useCountryFeatures(). Every color sourced
                                 from scene/highlightColors.ts
    CategoryHighlightLayer.tsx    (v3.3.0, extended v4.0) Seven layers, one
                                 per selectable classification (country + the
                                 six GeoEntityType values) — "highlight every
                                 sovereign state at once," etc. Independently
                                 toggleable (not one mutually-exclusive
                                 picker), all default off
    StatesProvincesLayer.tsx      (v4.0) Registers the administrative-division
                                 classification with the Layer Engine, off by
                                 default in the Layer Panel
  hud/                       Plain DOM/Tailwind overlay, siblings of the Canvas
    HUDFrame.tsx               Corner brackets, vignette, scanline overlay
    Header.tsx                 Top title bar
    Toolbar.tsx                Top-left icon bar: reset view / search / layers / settings
    SearchBar.tsx               Name -> select + fly-to, across countries AND
                                 every GeoEntity classification since v3.0.0
                                 (ranked dropdown, entity type shown per result)
    LayerPanel.tsx               Toggle list for registered layers, grouped by
                                 category (toggled via Toolbar)
    SettingsPanel.tsx           Camera sensitivity sliders + (v3.2.0)
                                 KEYBOARD SHORTCUTS reference (toggled via
                                 Toolbar)
    Telemetry.tsx               Live orbit readout (az/el/range) — stacked
                                 with LegendPanel.tsx in a shared bottom-left
                                 flex column in App.tsx (v3.1.0), no longer
                                 self-positioned
    LegendPanel.tsx              (v3.1.0) Always-on color key, reading
                                 scene/highlightColors.ts — deliberately
                                 bottom-left, not right-side, since
                                 IntelligencePanel covers the whole right
                                 edge whenever it'd matter most
    CommandBar.tsx               Bottom status bar: ready/connected/country
                                 count/entity count (v3.0.0)/selected entity
                                 (v3.2.0)/FPS/hover coordinates
    IntelligencePanel.tsx       Right-side sliding panel with the selected
                                 entity's data + FOCUS CAMERA button — country
                                 cards (v1, unchanged) or GeoEntityDetails
                                 cards (v3.0.0, one layout for all six
                                 non-sovereign classifications as of v4.0),
                                 dispatched on entity kind
    hudPanelStore.ts             Which single toolbar dropdown is open
    selectionStore.ts             Selected entity (country or GeoEntity,
                                 since v2.2.1 — see entities/) + inspectorOpen
                                 (v3.2.0, separate from selection itself —
                                 see CLAUDE.md) + camera flight/reset
                                 triggers. Dev builds also get
                                 window.__debugSelectEntity(id) (v2.2.3,
                                 generalized v3.0.0) — most useful for
                                 Crimea, the one entity with no rendered
                                 geometry to click
    settingsStore.ts              User-adjustable camera sensitivity
    telemetryStore.ts             Camera telemetry, FPS, hover lat/lng
  data/
    unMembers.ts               The 193 UN member states' raw Natural-Earth names
                               + display-name overrides — used by the build
                               script below, not at runtime
    waterBodies.ts              Ocean/sea/gulf/strait/bay label coordinates
    countryProfiles.ts          Illustrative government/capital/population/GDP
                               data for ~60 of the 193 countries, keyed by name
    types.ts                    Country/GeoEntity/Conflict/Relationship
                               interfaces for future layers (v2.1, schema-
                               only for Conflict/Relationship; GeoEntity is
                               real, v3.0.0 — see below)
    index.ts                     Public barrel: import types + registry
                               functions from here, not individual files
    registry/CountryRegistry.ts   registerCountry/getCountry/getCountries/
                               removeCountry (v2.1.1) — same architecture as
                               layers/layerRegistry.ts; doesn't import the
                               JSON below itself, see CLAUDE.md
    registry/GeoEntityRegistry.ts (v3.0.0, replacing TerritoryRegistry.ts)
                               registerEntity/getEntity/getEntities/
                               getEntitiesByType/getRelatedEntities — one
                               registry for all six non-sovereign
                               classifications as of v4.0; administeredBy and
                               claimedBy are separate fields, see CLAUDE.md
    registry/geoEntities.ts     (v3.0.0, replacing registry/territories.ts
                               and exampleTerritories.ts) The REAL, always-
                               loaded dataset — 56 entities across all five
                               GeoEntityType classifications, imported as a
                               side effect of index.ts. 53 also have real
                               rendered geometry — see scene/GeoEntities.tsx
                               and entities/entityGeometryIds.ts
    countries/countries.json    Empty — matches the Country[] schema
    conflicts/conflicts.json      Empty — matches the Conflict[] schema
    relationships/relationships.json  Empty — matches the Relationship[] schema
  entities/                   Entity Resolution layer (v2.1.3, extended
                               v2.2.0) — wired into the click -> select
                               pipeline as of v2.2.1, see scene/Countries.tsx
    types.ts                    GeopoliticalEntity (shared shape Country and
                               GeoEntity already satisfy) + ResolvedEntity
                               (the discriminated union EntityResolver returns,
                               kind: 'country' | 'geo-entity')
    EntityResolver.ts            resolveEntity/resolveCountry/resolveGeoEntity
                               — checks Country Registry then GeoEntity
                               Registry, hides which one an id came from
    GeometryMap.ts                (v2.2.0) registerGeometryMapping/
                               hasGeometryMapping/getEntityForGeometry —
                               polygon_id -> entity_id -> EntityResolver.
                               Real mappings registered for every rendered
                               GeoEntity since v3.0.0 (see
                               useGeoEntityFeatures.ts above)
    entityGeometryIds.ts         (v3.0.0, replacing territoryGeometryIds.ts)
                               Two maps: numeric-ISO-id features ("158" ->
                               "taiwan") and the 11 features with no numeric
                               id in the source, matched by raw name instead.
                               buildEntityTopology.mjs and
                               useGeoEntityFeatures.ts both read it, so the
                               build-time allowlist and runtime lookup
                               can't drift apart
  utils/
    geo.ts                    lat/lng <-> Vector3 sphere projection and its
                               inverse, plus (v3.2.0) bearingBetween/
                               angularDistance/normalizeAngle — great-circle
                               math for input/SelectionController.ts
  input/                     (v3.2.0, "Phase 3.2") Keyboard navigation —
                               see CLAUDE.md's Input Layer section for the
                               full picture
    types.ts                    Command vocabulary shared by every file below
    KeyboardController.ts        The one global keydown/keyup listener,
                               focus rules, key bindings, the held-key Set
                               CameraController.ts reads every frame
    SelectionController.ts       findNearestInDirection() (pure,
                               generic — no entity ids/names in the logic)
                               + useEntityNavigation() (arrow keys, Tab
                               category cycling), writing through the
                               existing selectEntity()
    CameraController.ts          WASDQE held-key camera nudging (mounted
                               inside scene/CameraControls.tsx) + one-line
                               wrappers around the existing resetView()/
                               flyToSelectedCountry() for R/Space
    InputManager.tsx              Mounted once from App.tsx; routes
                               one-shot commands (arrows, Enter, Escape,
                               Tab, L, /) to the right system — renders
                               nothing
  App.tsx                     Composes Scene + all HUD layers
  index.css                   Tailwind v4 entry + font tokens + reduced-motion
scripts/
  buildCountryTopology.mjs   Build-time asset generator (npm run
                             build:geo:countries): filters world-atlas's
                             10m data to the 193 UN members, simplifies
                             coastlines, re-quantizes
  buildEntityTopology.mjs     (v3.0.0, replacing buildTerritoryTopology.mjs)
                             Same pipeline (npm run build:geo:entities), for
                             every registered GeoEntity with a standalone
                             polygon in the same source (55 features) — see
                             entityGeometryIds.ts
  lib/topologyPipeline.mjs    (v3.3.2) Shared rebuild/presimplify/quantile/
                             simplify/quantize steps, extracted once a third
                             build script needed them
  lib/iso3166.mjs              (v4.0) ISO 3166-1 alpha-3 -> numeric country
                             code table, so a build script can resolve a
                             feature's parent Country
  buildStatesProvincesTopology.mjs (v4.0, npm run build:geo:states) Natural
                             Earth 1:50m admin-1 boundaries, vendored
                             directly (scripts/vendor/) since no npm package
                             wraps it — 294 features across 9 large countries
  generateClaimsDoc.mjs        (v3.1.1, rewritten v3.1.3, npm run
                             docs:claims) Reads countries-un193.json AND
                             GeoEntityRegistry, writes ../CLAIMS.md — a
                             complete roster of all 193 countries + every
                             registered GeoEntity, not just disputed ones.
                             Run via tsx, not plain node (geoEntities.ts's
                             extensionless relative imports don't resolve
                             under Node's built-in TS support the way they
                             do under tsx)
public/geo/
  countries-un193.json       Generated output of buildCountryTopology.mjs —
                             fetched at runtime by useCountryFeatures.ts
  entities.json                (v3.0.0, replacing territories.json)
                             Generated output of buildEntityTopology.mjs —
                             fetched at runtime by useGeoEntityFeatures.ts
  states-provinces.json        (v4.0) Generated output of
                             buildStatesProvincesTopology.mjs — fetched at
                             runtime by useStatesProvincesFeatures.ts
```

This separation (scene layer vs. HUD layer, data vs. rendering, a small pub/sub
store instead of React context re-renders on every animation frame) gives new
features — more overlays, live data, further camera choreography — clean seams
to build against without refactoring the globe itself.

## Notes for future work

- **Adding a visualization layer** (terrain, infrastructure, conflict zones,
  relationship arcs, live data, ...) means writing a module that calls
  `registerLayer()` and adding one import line to `layers/placeholders/index.ts`
  (or wherever a "real" layer set eventually gets composed) — never editing
  `Globe.tsx`. See `CLAUDE.md`'s Layer Engine section for the full workflow.
- **`data/types.ts`** — `GeoEntity` (v3.0.0, real and populated — see
  `data/registry/geoEntities.ts`) covers every non-sovereign classification;
  `Conflict`/`Relationship` are still schema-only, backed by empty
  `data/{conflicts,relationships}/*.json`. Query countries/GeoEntities
  through `data/registry/CountryRegistry.ts` / `GeoEntityRegistry.ts`, not
  by importing the JSON directly. For a disputed entity, "who administers
  it" and "who claims it" are separate fields on purpose — see
  `CLAUDE.md`'s "Geopolitical data architecture" section before adding
  logic that treats them as the same thing.
- **`entities/EntityResolver.ts`** is how the app looks up "what entity is
  this id" — `resolveEntity(id)`/`resolveCountry(id)`/`resolveGeoEntity(id)`,
  checking both registries and returning a uniform `ResolvedEntity`. Wired
  into the globe's click handling as of v2.2.1 — see `CLAUDE.md`'s "Entity
  Resolution" section.
- **`entities/GeometryMap.ts`** is the piece above that: since a rendered
  shape's own id doesn't necessarily have to equal its entity's registry id,
  the click handler checks `getEntityForGeometry(shapeId)` first, falling
  back to treating the shape's id as an entity id directly (true for every
  country, and for the 11 GeoEntities whose geometry id was stamped to equal
  their entity id at build time — see `entities/entityGeometryIds.ts`). Real
  mappings are registered for all 55 rendered features as of v3.0.0.
- **Adding a new GeoEntity** (a future dispute, a newly-relevant strategic
  region, ...) means: add it to `data/registry/geoEntities.ts`, and — if it
  has a standalone polygon in `world-atlas`'s 10m source (check first, most
  things do — see `LOGBOOK.md`'s v3.0.0 entry) — add it to
  `entities/entityGeometryIds.ts` and rerun `npm run build:geo:entities`.
  Selection/highlighting/the panel all already work — `hud/selectionStore.ts`'s
  `SelectedEntity`, `scene/GeoEntities.tsx`'s click handler, and
  `hud/IntelligencePanel.tsx`'s `GeoEntityDetails` card don't special-case
  any one classification. See `LOGBOOK.md`'s v2.2.1/v2.2.2/v3.0.0 entries.
- `scene/constants.ts` exports `GLOBE_RADIUS` so any new overlay feature
  (markers, arcs, selection highlights) can share the same sphere projection
  without reaching into `Globe.tsx` and risking circular imports.
- `telemetryStore.ts` / `settingsStore.ts` / `selectionStore.ts` / `hudPanelStore.ts`'s
  pattern (publish from inside the R3F frame loop or a DOM event handler,
  subscribe from plain components via `useSyncExternalStore`) is the intended
  pattern for any other camera- or scene-driven HUD data — avoids re-rendering
  the whole React tree at 60fps.
- **`countryProfiles.ts` is illustrative demo data, not a live feed.**
  Government/capital are stable facts; population and GDP are rounded,
  approximate snapshots that will drift out of date. Swap in a real data
  source before this is anything but a portfolio piece. Only ~60 of the 193
  countries are covered; the intelligence panel degrades gracefully ("No
  profile data available") for the rest.
- The Military / Economy / Diplomacy / Technology / Current Status sections
  in the intelligence panel are intentionally left as labeled placeholders
  ("Awaiting data feed") — the brief didn't specify what should populate
  them, and fabricating country-level assessments for a defense-context demo
  isn't something to do casually. That's real future work.
- See `CLAUDE.md` for the harder-won technical details: antimeridian
  triangulation, why country geometry is merged per-country instead of
  per-ring/per-polygon (a real 7,234→386 draw-call fix), and a
  `frameloop="never"`/`advance()` units bug worth not repeating.
- See `BACKLOG.md` (v3.1.2) for the fuller, hand-maintained list of open
  ideas/gaps this section only samples — data points needing verification,
  visualization approximations worth revisiting, and every planned engine's
  actual status.
