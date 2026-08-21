# Project Atlas — Interactive Holographic Globe

A "Global Command Interface" — a command-center-style 3D globe visualization
covering all 193 UN member states, built with React, TypeScript, Vite, Three.js,
React Three Fiber, drei, and Tailwind CSS v4.

## Design direction

Rather than a photo-real Earth texture, the globe renders as a **holographic
wireframe projection**: real-world country borders (from Natural Earth
GeoJSON/TopoJSON data) rendered as thin glowing lines over a pitch-black
ocean, a subtle Fresnel atmosphere rim, and pulsing capital-city markers —
closer to a Halo/TRON/JARVIS tactical display than a map app. The lat/long
graticule grid this used to also render (v5.0.0 and earlier) was removed in
v5.1.0 — see that entry in `CHANGELOG.md`. v6.2.1 added back a single fixed
reference line, the equator (`scene/Equator.tsx`) — narrower in scope than
the removed grid, which crisscrossed the whole globe.

The HUD follows a "glass command console" aesthetic (v5.0.0): a dark
near-black background, a full-spectrum ROYGBIV-mapped highlight palette
(v5.1.0, see `scene/highlightColors.ts`), condensed tracked-out uppercase text
(`Rajdhani` for nearly everything, `JetBrains Mono` reserved for live
numeric readouts — telemetry, FPS, coordinates — see `src/index.css`), and
glass panels throughout: rounded corners, a translucent backdrop blur, and
thin borders (the shared chrome lives in `hud/panelStyles.ts`). A full-width
top bar (`hud/TopNav.tsx`) carries the brand mark, primary navigation, and
search/utilities; a left sidebar (`hud/SideRail.tsx`) carries the
map's selectable categories. There's no corner-bracket/scanline overlay —
that pre-v5 "instrument panel" treatment (`hud/HUDFrame.tsx`) was removed in
favor of the cleaner glass-panel look.

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
npm run build:geo  # regenerate public/geo/{countries-un193,entities,states-provinces,cities,lakes,rivers}.json
npm run docs:claims # regenerate CLAIMS.md from data/registry/geoEntities.ts
npm test           # Vitest — pure-function coverage (geo.ts, lodLevels.ts, labelDeclutter.ts, countryGeometry.ts, countryAbbreviation.ts)
```

Verify changes with `tsc -b --noEmit`, `npm run lint` (oxlint), `npm test`,
and by actually driving the dev server — the test suite covers this
project's pure geometry/math functions, not component behavior.

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
  click the brand mark in the top bar (v5.0.0 — previously a dedicated 🌍
  button in a top-left toolbar). Clears the current selection and
  cinematically flies the camera back to the default framing.
- The top bar's right-hand utility cluster (v5.0.0) has an always-visible
  **Search** field (type a name, press Enter — matches any country, any
  GeoEntity classification, or any of the 32,608 US Census places as of
  v4.2, then selects/flies the camera there; a matched US city also draws
  its real boundary on demand), a **Layers** button, and a **Settings**
  button (camera rotate/zoom sensitivity, with a reset). Favorites/
  notifications/account icons are also present but not wired to anything
  yet. **As of v6.5.0 the Layers button opens Layer Presets** — save the
  current on/off state of every layer under a name, then click it later to
  restore that whole configuration at once, rather than re-toggling each
  layer by hand. Presets persist across reloads (saved to this browser).
  Toggling individual layers is still done from the sidebar (every
  category row still opens the toggle list, unchanged) — this button only
  snapshots/restores the whole thing.
- The top bar's **ANALYTICS** tab (v6.4.0) opens a full-screen dashboard: one
  clickable thumbnail per Intelligence Engine metric (Military, Economy,
  Diplomacy, Technology, Current Status). Only **Military** has real data —
  clicking it shows every one of the 193 UN member states ranked by score;
  the other four are disabled, showing the same "no assessment data
  currently sourced" state the intelligence panel's own status bars already
  use for them. Clicking a country in the ranked list opens its intelligence
  panel without leaving the ranked list.
- The left **sidebar** (v5.0.0) lists the map's ten selectable sections —
  Overview, Countries, Cities, Military, Economy, Infrastructure, Conflicts,
  Environment, Weather, Filters. Selecting one scopes the Layer Panel to
  that section's real registered Layer Engine categories (e.g. Countries →
  the `political`/`geopolitical`/`highlight` categories); Economy, Weather,
  and Filters have no layers registered under them yet and render visibly
  disabled rather than as dead buttons.
- **Water body labels** (oceans always; seas/gulfs/straits/bays once you zoom
  in past a threshold) sit on the globe surface and hide themselves on the far
  side of the sphere so they don't float through it.
- **Lakes and rivers** (v5.2.0, Natural Earth 1:50m — 412 lakes, 116 major
  rivers) render always-on as opaque pitch-black fill/lines with a thin cyan
  outline, the same "reads as real open water" treatment as the ocean —
  decorative physical geography, not selectable or searchable. Lake names
  appear as labels only once zoomed all the way in.
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
  the eight selectable categories (v4.0 added administrative divisions,
  v4.1 added cities). Inspector: **Enter** opens it, **Escape**
  closes it first and clears the selection on a second press, **I**
  toggles it. HUD: **L** toggles the Layer Panel, **/** opens search.
  Disabled while typing in a text field. Full reference in the
  ⚙ Settings panel.
- **Progressive labels** (v4.3) — country names are always shown (biggest
  countries first, screen-space decluttered so nearby small countries don't
  overlap); zooming in past roughly a single US state's scale progressively
  reveals US city names too, biggest metros first, down to every
  incorporated place at the closest zoom — see the LOD Engine below.
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
    Scene.tsx                Canvas setup (frameloop="demand" — R3F renders only
                               when something calls invalidate(), see CLAUDE.md),
                               lighting, starfield; composes Globe + camera + probes
    Globe.tsx                 Composes Countries, GeoEntities, CapitalMarker,
                               WaterLabels, and the core/atmosphere shells;
                               owns the ambient self-rotation and the
                               double-click-on-ocean / hover-coordinate
                               handlers on the core sphere (always-opaque,
                               pitch-black since v5.1.0).
                               CapitalMarker (country-only, since v2.3.0
                               explicitly checks entity.kind) shows the
                               selected country's capital
    Countries.tsx             Builds one GeoEntityEntry per country (merged
                               border lineSegments + merged fill mesh PER
                               COUNTRY, not per ring/polygon — see
                               countryGeometry.ts) and renders through
                               EntityRenderLayer.tsx; owns country-specific
                               entry-building and the selectCountry() click
                               fallback
    GeoEntities.tsx            (v3.0.0, replacing v2.3.0's Territories.tsx)
                               Every registered GeoEntity with real geometry
                               (53 of 54 — everything except Crimea, see
                               CLAUDE.md), rendered through
                               EntityRenderLayer.tsx. Primary selection only
                               — no parent/claims overlay logic here, that's
                               layers/geoOverlays/. Publishes hover state to
                               hoveredGeoEntity.ts (v5.2.7, converting
                               EntityRenderLayer's geometryId to the
                               corresponding entityId first) so
                               GeoEntityLabels.tsx can exclude whichever
                               entity is currently hover-glowing
    hoveredGeoEntity.ts             (v5.2.7) hoveredCountry.ts's pattern,
                               generalized for GeoEntities — see
                               GeoEntities.tsx above
    EntityRenderLayer.tsx       (v4.5.0) The rendering Countries.tsx and
                               GeoEntities.tsx used to each keep their own
                               copy of — border/fill mesh per entry,
                               hover/select/dim color logic, click-vs-drag
                               threshold, HoverLabel — extracted once
                               countryGeometry.ts had test coverage (v4.3.1)
                               to guard against a regression. HoverLabel
                               (v5.2.7) renders every entry the same way
                               regardless of size — inline, glowing, at the
                               entry's own centroid — replacing its passive
                               label in place; previously anything under
                               LARGE_ENTITY_THRESHOLD_DEG (7°) got a
                               leader-line + dot + offset callout instead,
                               reported as unwanted for every entity kind.
                               Each caller keeps only its real differences
                               (how entries get built, what happens on a
                               click-resolution miss) and passes an
                               onSelect callback in; StatesProvinces.tsx
                               (below) adopted it too once GeoEntities.tsx's
                               copy was folded in
    geoEntityEntries.ts        (v3.0.0) The "raw GeoJSON feature -> renderable
                               entry" logic pulled out of GeoEntities.tsx into
                               a plain .ts module so the geoOverlays layers
                               can share it without a .tsx file exporting a
                               non-component value from itself
    StatesProvinces.tsx        (v4.0) 294 admin-1 state/province boundaries
                               across 9 large countries — same
                               EntityRenderLayer.tsx rendering as
                               GeoEntities.tsx, own file since provinces are
                               conditionally rendered (toggled) in a way the
                               other five classifications aren't
    StateProvinceLabels.tsx        (v5.2.7) Same PassiveEntityLabels.tsx
                               treatment as CountryLabels.tsx/
                               GeoEntityLabels.tsx, mounted alongside
                               StatesProvinces.tsx's EntityRenderLayer so it
                               shares that layer's on/off toggle — but a much
                               tighter reveal distance (~3.2, vs. countries'
                               default-overview ~6.5): state/province names
                               stay hidden until you're focused on a region
    hoveredStateProvince.ts        (v5.2.7) hoveredCountry.ts's pattern,
                               written by StatesProvinces.tsx so
                               StateProvinceLabels.tsx can exclude whichever
                               province EntityRenderLayer's HoverLabel is
                               already glowing (now at the same centroid
                               position — see EntityRenderLayer.tsx below)
    useStatesProvincesFeatures.ts (v4.0) Fetches states-provinces.json;
                               creates GeoEntity records directly from the
                               fetched geometry (unlike useGeoEntityFeatures.ts,
                               which only maps geometry onto an already
                               hand-curated dataset)
    Cities.tsx                 (v4.1) 223 capital/major-city point markers —
                               small spheres + hover/select labels, a new
                               geometry shape (every prior selectable thing
                               was a merged border/fill polygon)
    useCitiesFeatures.ts        (v4.1) Same "create GeoEntity records from
                               fetched geometry" pattern as
                               useStatesProvincesFeatures.ts, for points
    useUsCitiesIndex.ts          (v4.2) The lightweight, always-loaded
                               search index for all 32,608 US Census places
                               (id/name/lat/lng/state) — deliberately
                               separate from the on-demand geometry fetch
                               below, since SearchBar.tsx only ever needs
                               this to find a city and fly there
    UsCityOutlineHighlight.tsx  (v4.2) Draws exactly one US city's boundary
                               on demand — always mounted, renders nothing
                               until a search result sets one via
                               selectionStore.ts's usCityOutline. NOT part
                               of the GeoEntityType/selectable-entity system
                               every other classification above joined —
                               see LOGBOOK.md's v4.2 entry for why an
                               always-on version of this layer was tried
                               first and reworked
    useUsCityOutline.ts          (v4.2) Fetches one state's US-cities
                               geometry shard on demand, cached per state
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
    Lakes.tsx                     (v5.2.0) Always-on decorative water layer —
                               412 Natural Earth lakes merged into one fill
                               mesh + one border lineSegments (no per-feature
                               interactivity); opaque pitch-black fill since
                               land polygons have no actual holes where a
                               lake sits, so a translucent tint read as
                               geographically wrong
    Rivers.tsx                    (v5.2.0) Same always-on pattern as
                               Lakes.tsx, but LineString geometry rendered
                               via countryGeometry.ts's new
                               geometryToLineSegments (no ring to close, no
                               interior to fill) instead of the border/fill
                               pair; 116 of 462 source features (scalerank
                               <= 3, major rivers only)
    useLakesFeatures.ts             Fetches + parses lakes.json once, mirrors
                               useCountryFeatures.ts's singleton pattern
    useRiversFeatures.ts             Same, for rivers.json
    coreSphereRef.ts               (v5.2.0) Plain non-reactive module-level
                               ref to Globe.tsx's core sphere mesh — lets
                               Lakes.tsx/Rivers.tsx (Layer Engine-mounted,
                               not direct children of Globe.tsx) occlude
                               their own Html labels against it the same way
                               WaterLabels does via a prop
    CountryLabels.tsx            (v4.3; Google-Maps-style abbreviation/sizing
                               v5.2.3) Thin wrapper (v5.2.4) — builds
                               {id, name, extent, localPosition} entries from
                               useCountryFeatures() and hands them to
                               PassiveEntityLabels.tsx, which owns the actual
                               sizing/abbreviation/declutter/rendering logic
                               shared with GeoEntityLabels.tsx below. Still
                               owns what's genuinely country-specific: hiding
                               entirely while selected, and excluding
                               whichever country hoveredCountry.ts says
                               already has a glowing HoverLabel elsewhere
    GeoEntityLabels.tsx             (v5.2.4) Same always-on passive label
                               treatment, extended to the 55 rendered
                               GeoEntities (territories like Greenland,
                               de facto states, strategic areas, ...) —
                               previously had no passive label at all, only
                               EntityRenderLayer.tsx's hover/selection-
                               triggered HoverLabel. Excludes whichever
                               entity is currently hover-glowing via
                               hoveredGeoEntity.ts (v5.2.7) — needed once
                               HoverLabel stopped using a leader-line
                               callout and started rendering at the same
                               centroid this passive label uses
    PassiveEntityLabels.tsx          (v5.2.4) Extracted once CountryLabels.tsx
                               and GeoEntityLabels.tsx needed the identical
                               zoom-adaptive treatment — apparent-size-driven
                               font size (labelDeclutter.ts's apparentSizePx),
                               full-name-vs-abbreviation via
                               countryAbbreviation.ts, one uniform text
                               color, and a per-candidate declutter spacing
                               radius (half the label's own estimated
                               rendered width, not one flat constant for
                               every label — same fix labelDeclutter.ts
                               documents for the Gulfport/Biloxi regression,
                               now also applied here). Optional
                               maxCameraDistance prop (v5.2.7) hides the
                               whole layer past a given zoom — how
                               StateProvinceLabels.tsx gets its own, much
                               tighter reveal distance than
                               CountryLabels.tsx/GeoEntityLabels.tsx
    countryAbbreviation.ts          (v5.2.3) Pure abbreviation derivation —
                               initials of significant words for multi-word
                               names ("United Kingdom" -> "UK"), first 3
                               letters for single-word ones ("Ukraine" ->
                               "UKR") — no ISO code lookup table needed
    UsCityLabels.tsx              (v4.3) Progressive US city label reveal —
                               Google-Maps-style, ranked by real Census
                               population, gated by the LOD Engine below
    labelDeclutter.ts             (v4.3) Shared screen-space decluttering:
                               rejects a lower-priority label if it would
                               land within spacing distance of an
                               already-accepted one. apparentSizePx (v5.2.3)
                               estimates a feature's CURRENT on-screen pixel
                               size from its angular extent + live camera
                               distance/FOV — the Google-Maps "big enough for
                               its full name right now" question, which
                               depends on zoom, not just the feature's fixed
                               real-world size
    hoveredCountry.ts              (v4.3, zustand vanilla store since v4.4.0)
                               Non-reactive publisher so CountryLabels.tsx
                               can exclude whichever country Countries.tsx's
                               own hover state is already labeling
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
    globeRotation.ts          Non-reactive publisher (zustand vanilla store
                               since v4.4.0) of the globe's current Y
                               rotation, read by SearchBar to aim a fly-to
                               without a clicked mesh to read a world matrix from
    tweenMath.ts              Shared easing + angle-interpolation helpers
    AtmosphereMaterial.tsx    Custom Fresnel-glow shader material (drei shaderMaterial)
    TelemetryProbe.tsx        Samples camera spherical coords + FPS each frame
                               -> HUD telemetryStore
    constants.ts              Shared GLOBE_RADIUS + camera distance bounds.
                               CAMERA_MIN_DISTANCE tightened twice since v1
                               (v4.2, then v4.3) — see LOGBOOK.md for why
                               each step was more conservative than a first
                               attempt that broke rendering
    highlightColors.ts         (v3.1.0, repalletted v5.0.0 and v5.1.0) Single
                               source of truth for every highlight/selection
                               color the globe renders — Countries.tsx,
                               GeoEntities.tsx, and both geoOverlays layers
                               all source their colors from here;
                               hud/LegendPanel.tsx explains the same values.
                               v5.0.0 shifted the 7-color palette from the
                               original red/yellow/green/magenta/purple
                               scheme into a blue/cyan/violet family; v5.1.0
                               reverted that (reported as reading too
                               similar) to a refined ROYGBIV mapping — one
                               spectrum hue per slot, ordered by the app's
                               actual legend order, not the literal rainbow
                               order
  lod/                       The LOD Engine (v4.3) — architecturally parallel
                               to the Layer Engine below, owns the camera-
                               distance ladder zoom-gated content reveals
                               against
    types.ts                    LodLevelId union naming the full intended
                               zoom progression (Earth -> Countries ->
                               States/Provinces -> Lakes -> Rivers -> Metro
                               Areas -> city tiers -> Every Incorporated
                               City -> Roads/Rail/Airports/Ports/Military
                               Bases/Infrastructure); Lakes/Rivers (v5.2.0)
                               are the first of the originally-reserved ids
                               to actually ship, both always-on like
                               Countries/States; the remaining five stay
                               reserved (implemented: false, no work behind
                               them yet)
    lodLevels.ts                 The ordered ladder + pure
                               resolveActiveLevels/resolveDeepestLevel/
                               isLodLevelActive functions — a level is
                               active whenever distance <= its
                               revealDistance, checked independently per
                               level (not first-match-wins), which is what
                               makes the ladder cumulative
    lodStore.ts                   Zustand store (v4.4.0) holding
                               {distance, level} for consumers without their
                               own per-frame camera access, fed by
                               TelemetryProbe.tsx; useLodLevel() selects only
                               the level field so it doesn't rerender every
                               frame's distance update
    index.ts                       Barrel — import from here, not individual
                               files
  layers/                    The Layer Engine (v2.0) — pluggable visualization
                               modules; Globe.tsx only ever mounts <LayerEngine />
    types.ts                   The LayerDefinition contract every layer implements
    layerRegistry.ts            Plain registerLayer()/getLayerDefinitions() catalog
    layerStore.ts                Enabled/disabled runtime state (zustand,
                                 same pattern as the hud/*Store.ts files
                                 since v4.4.0)
    layerPresetsStore.ts           (v6.5.0) Named snapshots of layerStore's
                                 enabled map, save/apply/delete, persisted to
                                 localStorage — see hud/LayerPresetsPanel.tsx
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
                                 prominent-fill treatment (no callout marker
                                 as of v4.1.1 — the highlight alone reads
                                 clearly) on Country geometry, fetched independently
                                 via useCountryFeatures(). Every color sourced
                                 from scene/highlightColors.ts
    CategoryHighlightLayer.tsx    (v3.3.0, extended v4.0) Seven layers, one
                                 per selectable classification (country +
                                 six of the seven GeoEntityType values —
                                 city, v4.1, is deliberately excluded: its
                                 point-marker geometry has no honest
                                 equivalent to the dashed-border + fill
                                 overlay this system uses for polygons).
                                 Independently toggleable (not one mutually-
                                 exclusive picker), all default off
    StatesProvincesLayer.tsx      (v4.0) Registers the administrative-division
                                 classification with the Layer Engine, off by
                                 default in the Layer Panel
    CitiesLayer.tsx                (v4.1) Registers the city classification
                                 (category 'population', a new free-form
                                 value), off by default
    LakesLayer.tsx                 (v5.2.0) Registers scene/Lakes.tsx,
                                 default on — decorative physical geography,
                                 not a toggleable classification the way the
                                 layers above are
    RiversLayer.tsx                 (v5.2.0) Same, for scene/Rivers.tsx
  hud/                       Plain DOM/Tailwind overlay, siblings of the Canvas
    panelStyles.ts              (v5.0.0) Single source of truth for the glass-
                                 panel chrome (rounded corners, translucent
                                 blur, thin border) every panel below shares
    TopNav.tsx                  (v5.0.0) Full-width top bar: brand mark (left,
                                 also resets view) / MAP·INTELLIGENCE·LAYERS·
                                 ANALYTICS·DATABASE tabs (middle — MAP and, as
                                 of v6.4.0, ANALYTICS are wired) /
                                 search·favorites·notifications·
                                 account·layers·settings (right). Replaces
                                 Header.tsx + Toolbar.tsx (both removed)
    SideRail.tsx                 (v5.0.0) Left sidebar of ten selectable
                                 sections; each scopes LayerPanel.tsx to that
                                 section's real registered Layer Engine
                                 categories (see sideNavItems.ts)
    sideNavItems.ts               (v5.0.0) The sidebar's section -> Layer
                                 Engine category mapping — plain .ts (not
                                 .tsx) so LayerPanel.tsx can import it too
                                 without breaking Fast Refresh
    navStore.ts                  (v5.0.0) Which sidebar section / top-nav tab
                                 is active (zustand, same pattern as every
                                 other store in this directory)
    icons.tsx / iconPaths.ts     (v5.0.0) Shared stroked-path icon set for
                                 the HUD chrome; path data lives in the plain
                                 .ts module for the same Fast-Refresh reason
                                 as sideNavItems.ts
    SearchBar.tsx               Now rendered inline inside TopNav.tsx's
                                 utility cluster (v5.0.0, previously its own
                                 fixed-position dropdown). Name -> select +
                                 fly-to, across countries AND every GeoEntity
                                 classification since v3.0.0 (ranked dropdown,
                                 entity type shown per result). Since v4.2
                                 also matches any of the 32,608 US Census
                                 places (search index only — see
                                 scene/useUsCitiesIndex.ts below); selecting
                                 one flies there and draws that one city's
                                 real boundary on demand, shown as "City, ST"
                                 to disambiguate same-named places across
                                 states
    LayerPanel.tsx               Toggle list for registered layers, grouped by
                                 category (opened from every SideRail category
                                 row, or the L key; scoped by SideRail's active
                                 section as of v5.0.0)
    LayerPresetsPanel.tsx        (v6.5.0) Opened from TopNav's Layers button
                                 instead, as of v6.5.0 — save/apply/delete a
                                 named snapshot of every layer's on/off state
                                 (layers/layerPresetsStore.ts), persisted to
                                 localStorage (this codebase's first use of it)
    SettingsPanel.tsx           Camera sensitivity sliders + (v3.2.0)
                                 KEYBOARD SHORTCUTS reference (opened from
                                 TopNav's Settings button)
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
                                 cards (v3.0.0, one layout for all seven
                                 non-sovereign classifications as of v4.1),
                                 dispatched on entity kind. Restyled v5.0.0
                                 to a gradient masthead + sectioned body;
                                 gained an INTELLIGENCE SUMMARY block of
                                 progress-bar metric rows (chrome only — no
                                 score field exists anywhere in the schema,
                                 so every bar renders in its empty state) and
                                 a RELATIONSHIPS feed-row list for GeoEntities,
                                 driven by the real parentEntity/
                                 administeredBy/claimedBy/claims data that was
                                 already here, just recast as feed rows
    AnalyticsPanel.tsx           (v6.4.0) Full-screen dashboard behind
                                 TopNav's ANALYTICS tab — one clickable
                                 thumbnail per Intelligence Engine metric,
                                 drilling into a ranked list of all 193
                                 countries. Only MILITARY has real data
                                 (data/militaryScores.ts); the other four
                                 render the same "Awaiting data feed" state
                                 IntelligencePanel.tsx already uses for them.
                                 Clicking a row selects the country without
                                 closing the list or moving the camera
    intelMetrics.ts               (v6.4.0) The five metric ids/labels/icons,
                                 shared between IntelligencePanel.tsx's status
                                 bars and AnalyticsPanel.tsx's thumbnails
    hudPanelStore.ts             Which single top-bar dropdown is open
    selectionStore.ts             Selected entity (country or GeoEntity,
                                 since v2.2.1 — see entities/) + usCityOutline
                                 (v4.2 — which one US city's on-demand
                                 boundary is currently shown, if any) +
                                 flyToUsCity() (one atomic update, not two
                                 sequential ones — see LOGBOOK.md's v4.2
                                 entry for the timing hazard that fixed) +
                                 inspectorOpen
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
                               registry for all seven non-sovereign
                               classifications as of v4.1; administeredBy and
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
  buildCitiesData.mjs          (v4.1, npm run build:geo:cities) Natural
                             Earth 1:50m populated places — 223 features
                             (195 national capitals + 28 major world
                             cities). Point geometry has nothing to
                             topologically simplify, so this is the first
                             build:geo:* script that skips
                             lib/topologyPipeline.mjs entirely
  buildUsCitiesData.mjs        (v4.2, npm run build:geo:us-cities — NOT
                             part of the default build:geo chain; much
                             slower/heavier than every script above) Parses
                             a vendored US Census Bureau cartographic
                             boundary shapefile (scripts/vendor/census/, via
                             the shapefile npm package) into 56 per-state
                             geometry shards plus one lightweight search
                             index. No topojson simplification — a single
                             city's raw 1:500,000 Census polygon is small
                             enough on its own
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
  cities.json                   (v4.1) Generated output of
                             buildCitiesData.mjs — fetched at runtime by
                             useCitiesFeatures.ts
  us-cities-index.json          (v4.2) Always-loaded search index for all
                             32,608 US Census places — fetched at runtime
                             by useUsCitiesIndex.ts
  us-cities/{state}.json         (v4.2) 56 per-state geometry shards — one
                             fetched on demand per search result, by
                             useUsCityOutline.ts
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
- **Adding a zoom-gated dataset** (roads, rail, rivers, airports, ports,
  military bases, infrastructure — all already reserved as `LodLevelId`
  members in `lod/types.ts`) means giving that id a real `revealDistance`
  in `lod/lodLevels.ts` and flipping `implemented` to `true`, then having
  the new layer check `isLodLevelActive(id, distance)` — never touching
  camera bounds or any existing layer's logic. `UsCityLabels.tsx`'s own
  population floor per tier is a plain object keyed by `LodLevelId`
  (`CITY_POPULATION_FLOOR`), kept in that file rather than in `lod/`
  itself, since population scoring is a cities-specific concept the LOD
  Engine shouldn't need to know about.
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
  subscribe from plain components via a zustand store since v4.4.0) is the
  intended pattern for any other camera- or scene-driven HUD data — avoids
  re-rendering the whole React tree at 60fps.
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
  per-ring/per-polygon (a real 7,234→386 draw-call fix), and the
  `frameloop="demand"` `invalidate()` convention every direct-mutation
  animation has to follow (v4.3.2 — replaced an earlier `frameloop="never"`/
  manual `advance()` approach whose units bug is documented there too).
- See `BACKLOG.md` (v3.1.2) for the fuller, hand-maintained list of open
  ideas/gaps this section only samples — data points needing verification,
  visualization approximations worth revisiting, and every planned engine's
  actual status.
