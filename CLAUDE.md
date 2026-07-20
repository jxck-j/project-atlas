# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

A command-center-style 3D globe built with React 19 + TypeScript + Vite + Three.js
(via React Three Fiber / drei) + Tailwind v4. The globe renders as a holographic
wireframe projection (graticule grid, glowing country borders, Fresnel atmosphere
rim) rather than a photo-real Earth texture — closer to a tactical display than a
map app. Country data covers exactly the 193 UN member states.

## Commands

```bash
npm run dev        # dev server, http://localhost:5173
npm run build      # tsc -b (project-references typecheck) + vite build to dist/
npm run lint       # oxlint
npm run preview    # preview the production build
npm run build:geo  # regenerate both geo assets below (runs the two npm scripts in sequence)
npm run build:geo:countries    # regenerate public/geo/countries-un193.json (see Data pipeline below)
npm run build:geo:territories  # regenerate public/geo/territories.json (see Territory geometry below)
```

There is no test suite/framework configured in this repo.

`tsc -b --noEmit` (project references mode, not plain `tsc --noEmit`) is the
correct way to typecheck without emitting — matches what `npm run build` does.

## Architecture

Since v2.0, Atlas is organized around long-lived **engines** rather than a flat
feature list — each engine is a self-contained subsystem with its own directory.
Current: the Rendering Engine (`src/scene/`) and the Layer Engine (`src/layers/`,
see below). Planned: Country Engine, Relationship Engine, Intelligence Engine,
Data Engine, Timeline Engine. Before starting a new major version, name which
engine is being expanded and how it reduces future complexity — see
`CHANGELOG.md`'s versioning note and `LOGBOOK.md` for the reasoning behind this.

### Two-layer split: `scene/` vs `hud/`

- `src/scene/` — everything inside the R3F `<Canvas>` (Three.js objects, materials,
  camera controls, geometry math). Composed in `Scene.tsx`, mounted once from `App.tsx`.
- `src/hud/` — plain DOM/Tailwind overlay panels positioned with `fixed` + `z-*`,
  siblings of the Canvas in `App.tsx`, not children of it.
- `src/layers/` — the Layer Engine (see its own section below). Spans both:
  the engine itself renders inside the Canvas, `hud/LayerPanel.tsx` controls it
  from the DOM side.
- `src/data/` — static datasets (UN member list, water body labels, country profiles).
- `src/utils/geo.ts` — the lat/lng ⟷ `Vector3` sphere projection and its inverse,
  shared by both layers.

The scene and HUD layers never share React context. They're bridged by small
`useSyncExternalStore`-based pub/sub stores (`selectionStore.ts`, `settingsStore.ts`,
`telemetryStore.ts`, `hudPanelStore.ts`, plus the non-reactive `globeRotation.ts`
module variable). This exists specifically so a value written every animation
frame (camera orbit angles, FPS, hover lat/lng) doesn't re-render the whole React
tree at 60fps — only components that actually call the corresponding `useX()` hook
re-render, and only when the value actually changes. Follow this pattern for any
new scene→HUD data; don't reach for React context for anything frame-driven.

### Data pipeline: build-time asset, not runtime filtering

`world-atlas`'s `countries-10m.json` (full Natural Earth detail) ships ~255
features: the 193 UN member states plus ~60 dependencies/disputed
territories/uninhabited regions (Antarctica, Puerto Rico, Kosovo, Western
Sahara, ...). `scripts/buildCountryTopology.mjs` (`npm run build:geo`):

1. Filters to exactly the 193 UN members via `src/data/unMembers.ts`'s raw
   Natural-Earth-name allowlist, and expands Natural Earth's abbreviated names
   (`"Dem. Rep. Congo"` → `"Democratic Republic of the Congo"`, etc. — also see
   `DISPLAY_NAME_OVERRIDES` in the same file).
2. Rebuilds a fresh topology from just the kept features (via `topojson-server`)
   so arcs belonging only to dropped territories never make it into the output.
3. Simplifies coastline point density with `topojson-simplify` (spherical
   triangle-area weighting — the source data is lon/lat, not planar).
4. Re-quantizes the result (`topojson-client`'s `quantize`) — **required**:
   `presimplify()` strips delta-encoding to compute weights, and without
   re-quantizing afterward the output is stored as raw floating-point
   coordinates and ends up *larger* than the unsimplified source.

The output, `public/geo/countries-un193.json`, is what the app actually fetches
at runtime (`useCountryFeatures.ts`) — no filtering or renaming happens in the
browser. Re-run `npm run build:geo` if `unMembers.ts` changes or the source
`world-atlas` version bumps. `useCountryFeatures.ts` is a singleton store (fetch
once, `useSyncExternalStore` to share the result) because topojson's `feature()`
conversion isn't free and several components need the same list (`Countries.tsx`,
`SearchBar.tsx`, `CommandBar.tsx`). Since v2.2.1 it also registers each fetched
feature into the Country Registry (minimal id/name records) right after they
load — the prerequisite that makes `EntityResolver` able to resolve a real,
rendered country at all (see "Entity Resolution" and `LOGBOOK.md`).

### Country geometry (`scene/countryGeometry.ts`)

Two non-obvious things here matter a lot:

- **Antimeridian unwrapping.** A ring crossing ±180° longitude (Russia's Far
  East, Fiji, etc.) needs its points shifted by ±360° increments so consecutive
  points stay within 180° of each other, *before* earcut triangulation, before
  border-line projection, and before centroid calculation. Skipping this makes
  earcut (which works in flat lng/lat space) produce triangles that span the
  entire globe instead of a narrow sliver near the dateline. `unwrapRingLongitudes`
  / `unwrapPolygonRings` handle this; verify with `earcut.deviation()` if you
  touch this code — it should be ~0, not ~1+.
- **One merged geometry per country, not one per ring/polygon.** Countries with
  several islands or enclave holes (common even after simplification) used to
  render as ~1-10 separate `<Line>`/`<mesh>` objects each. Across 193 countries
  that was ~7,200 draw calls and the dominant performance cost — far more than
  raw vertex count. `geometryToBorderSegments` returns one flat `Float32Array` of
  segment pairs per country (rendered as a single `<lineSegments>`), and
  `geometryToFillMesh` returns one merged `BufferGeometry` per country (rendered
  as a single `<mesh>`). Don't reintroduce per-ring/per-polygon meshes without a
  good reason. One consequence: native `LineBasicMaterial` ignores `linewidth` on
  effectively every platform, so border hover/select emphasis is color+opacity
  only, not thickness.
- Country fill meshes use `side={FrontSide}` (not `DoubleSide`) deliberately — with
  `DoubleSide`, a pointer ray that misses every near-hemisphere country (e.g. a gap
  over open ocean) can continue through the globe and hit a country's back-facing
  triangles on the *far* side, causing wrong-country click-throughs.

Every function in this file is generic over any GeoJSON `Geometry` — nothing
in it is country-specific despite the file name. `scene/Territories.tsx`
(v2.3.0) reuses all four functions unchanged to render territory geometry;
this module needed zero changes to serve a second entity kind.

### Territory geometry (`scene/Territories.tsx`, v2.3.0)

Closely mirrors `scene/Countries.tsx` — same merged-geometry-per-entity
approach (via `countryGeometry.ts`, see above), same hover/select/dim color
logic and palette (deliberately identical to countries — a territory reads
as "another selectable thing on this globe," not a different visual
category), same click-vs-drag threshold. Kept as its own file rather than
generalizing `Countries.tsx` into a shared component — same reasoning
`CountryRegistry.ts`/`TerritoryRegistry.ts` are two files instead of one
generic `Registry<T>` (see below): duplication here means this addition
can't regress already-verified country click/highlight behavior.

**The one thing that is NOT safe to copy from `Countries.tsx` verbatim:**
a country's rendered polygon id and its registry id are the same string by
construction, so `Countries.tsx` compares `selected?.id === country.id`
directly. A territory's rendered shape id (`"158"`, an ISO numeric code)
and its entity id (`"taiwan"`, the `TerritoryRegistry` slug) are
*deliberately* different — that's the whole reason `GeometryMap` exists —
so `TerritoryEntry` carries both `geometryId` (hover state, `GeometryMap`
lookups) and `entityId` (compared against `selected.id`) rather than one
`id`. Getting this wrong doesn't throw or warn — it silently makes
`isSelected` always `false`, so a selected territory renders with the same
faint dimmed treatment as everything else instead of highlighted. See
`LOGBOOK.md`'s v2.3.0 entry for how this was actually found (a screenshot,
not a type error) and a second, related bug it surfaced
(`Globe.tsx`'s `CapitalMarker` needing to check `selected.entity.kind`,
not just look up `selected.name` by string).

`scripts/buildTerritoryTopology.mjs` (`npm run build:geo:territories`)
extracts real geometry from the same `world-atlas` 10m source
`buildCountryTopology.mjs` reads, for the subset of registered territories
that have a standalone polygon there — see `entities/territoryGeometryIds.ts`
(the id -> territory-id map both the build script and
`scene/useTerritoryFeatures.ts` share) for which ones and why not all four:
Crimea still has no rendered geometry, for the same "no standalone polygon
anywhere in the source data" reason noted below — it stays selectable via
search only.

### Camera system

`CameraControls.tsx` owns a single `OrbitControls` ref and composes several
hooks that all imperatively toggle `controls.autoRotate`/`controls.enabled`
rather than fighting over React props:

- `useFlickAutoRotate.ts` — stops ambient rotation on manual grab, resumes it
  (in the flick direction) only if released while still moving fast.
- `useCameraFlight.ts` — cinematic tween to a selected country. **Not**
  triggered by selection itself — `selectCountry()` only opens the info panel;
  a separate `flyToSelectedCountry()` (wired to the panel's "FOCUS CAMERA"
  button, and to the search bar's Enter-to-fly) bumps `flightSeq` in
  `selectionStore.ts`, which is what the hook actually watches.
- `useCameraReset.ts` — flies back to the default global view. Triggered by
  `resetView()` (Home key, double-click on empty ocean, or the toolbar's globe
  button), which also clears the current selection.
- Both flight hooks share the easing helpers in `tweenMath.ts` and the same
  "rotate leads, zoom follows, both ease to a stop together" shape.

The core sphere mesh doubles as the double-click-on-ocean target: country fill
meshes sit in front of it and call `stopPropagation()` on `onDoubleClick`, so the
core sphere's handler only fires when the double-click didn't land on a country.

### Frame loop

`Scene.tsx`'s `<Canvas>` runs `frameloop="never"` — R3F's own render loop is
disabled — and `scene/FrameRateCap.tsx` drives it manually via R3F's exported
`advance(timestamp)`, skipping renders inside the same `1000/60ms` window. This
was added specifically because 193 fully-detailed countries pushed enough
GPU/CPU work that letting the browser render on every display refresh (120Hz+
monitors) made things worse, not better.

**Gotcha if you touch this:** `advance()` feeds its argument straight into
`state.clock.elapsedTime`, which Three.js's `Clock` (and therefore every
`delta`-based animation — ambient rotation, `OrbitControls` damping/autoRotate,
camera flights) tracks in **seconds**. `requestAnimationFrame`'s timestamp is in
**milliseconds**. Passing it through unconverted makes every computed delta
~1000x too large — this exact bug once made the globe spin wildly. Always
convert (`time / 1000`) before calling `advance()`.

### Selection & HUD panel state

- `hud/selectionStore.ts` — `selected: SelectedEntity | null` (since v2.2.1:
  wraps a full `ResolvedEntity` — country *or* territory — from
  `entities/EntityResolver.ts`, plus denormalized `id`/`name`/world-space
  `direction` at the top level so generic consumers don't need to reach
  into `entity.*`), `flightSeq` (camera-flight trigger), `resetSeq`
  (reset-view trigger). Read via `useSelection()`. Two ways to select:
  `selectEntity(resolvedEntity, direction)` (generic — what
  `scene/Countries.tsx`'s click handler *and*, since v2.2.4, `hud/
  SearchBar.tsx`'s result selection use, both resolving through
  `EntityResolver.resolveEntity()` first) and `selectCountry({id, name,
  direction})` (a narrower country-only wrapper, kept for any caller that
  only ever has a country id/name in hand and doesn't want to resolve it
  itself; resolves through the Country Registry internally). See the Entity
  Resolution section below and `LOGBOOK.md` for why the migration was
  shaped this way.
- `hud/hudPanelStore.ts` — which single toolbar dropdown (`'search' | 'settings'
  | null`) is open; mutually exclusive, toggled from `Toolbar.tsx`.
- A country's fill/border color and opacity in `Countries.tsx` are computed
  per-country from `isSelected` / `isHovered` / `isDimmed` (dimmed = some other
  country is selected) — there's no separate "theme" object, it's inline per-render.
- The hover/selected country's name label (`HoverLabel` in `Countries.tsx`) shows
  for *either* hover or selection (selection persists the label even without
  hovering). Water-body labels (`WaterLabels`) only show when nothing is
  selected; the capital marker (`CapitalMarker`, both in `Globe.tsx`) only shows
  when the selected country has profile data in `countryProfiles.ts`.
  `WaterLabels` uses `Html`'s `occlude` prop against a ref to the core sphere
  specifically, **not** the whole scene (`occlude={true}`/no ref) — occluding
  against everything also catches the atmosphere glow shells (which sit in front
  of every label regardless of which hemisphere it's on) and hides all labels
  unconditionally, always.
- **`hud/IntelligencePanel.tsx`** (v2.2.2) dispatches on
  `selected.entity.kind`: `CountryDetails` (unchanged since v1 — same
  `COUNTRY_PROFILES` lookup, same GOVERNMENT/CAPITAL/POPULATION/GDP rows,
  same "no profile data" fallback) for `'country'`, `TerritoryDetails`
  (new) for `'territory'` — ENTITY TYPE / CONTROLLER / CLAIMANTS /
  POLITICAL STATUS, reusing the same `DataRow` component, each of
  CONTROLLER/CLAIMANTS omitted individually if that array is empty rather
  than falling back to one blanket "no data" message. Deliberately a
  two-way check, not a registry/plugin system like the Layer Engine's — a
  third entity kind means one more `XDetails` component and one more arm
  of the check, not a new abstraction layer. See `LOGBOOK.md`.

### Layer Engine (`src/layers/`)

A plugin system for pluggable visualization modules, added in v2.0 so future
overlays (terrain, infrastructure, conflict zones, relationship arcs, live
data, ...) never require editing `Globe.tsx` again. As of v2.0 the only
layers that exist are architecture-validating placeholders — see
`src/layers/placeholders/`.

**Pieces, and why they're separate:**

- `types.ts` — the `LayerDefinition` contract: `id`, `label`, `description`,
  `category` (a free-form string, not a closed union — deliberately, so a new
  category never requires touching `LayerPanel.tsx`), `defaultEnabled`, and
  `component` (a prop-less `ComponentType` the layer mounts while enabled).
- `layerRegistry.ts` — a plain `Map`, not reactive. `registerLayer(def)` /
  `getLayerDefinitions()`. Layers register themselves as an **import side
  effect** — see the registration workflow below.
- `layerStore.ts` — the *runtime enabled/disabled state*, separate from the
  registry (which is just the static catalog of what's available). Same
  `useSyncExternalStore` pub/sub pattern as every other store in this repo
  (`selectionStore.ts` etc.) — see the "Two-layer split" section above for why.
- `LayerManager.tsx` — reads the registry + store every render and mounts/
  unmounts each enabled layer's component. Wraps each layer in its own
  `LayerErrorBoundary` (a class component — error boundaries require one) so
  one broken layer can't crash the whole globe, and logs mount/unmount for
  each layer (`console.info('[LayerEngine] "<id>" mounted')`) — the "lifecycle"
  placeholder layers exist to demonstrate.
- `LayerEngine.tsx` — the public entry point. This is the **only** file
  `Globe.tsx` imports from `src/layers/`; it renders `LayerManager` and, as an
  import side effect, pulls in `placeholders/` (bootstrapping registration).
  Nothing else in the scene knows or needs to know what layers exist.
- `index.ts` — the barrel. Both `LayerEngine` (scene side) and `hud/LayerPanel.tsx`
  (HUD side) should import from here (`'../layers'`), not from individual
  files — importing the barrel is what guarantees registration has happened
  before anything reads the registry or store.

**Registration workflow — how to add a new layer:**

1. Write a module that calls `registerLayer({...})` at the top level (module
   load time, not inside a component) — see any file in `placeholders/` for
   the shape.
2. Add one import line for that module to `placeholders/index.ts` (or, for a
   non-placeholder/production layer, wherever the app's "real" layer set ends
   up being composed — that composition point doesn't exist yet since v2.0 is
   placeholders-only, but it's the same one-line-import pattern).
3. Nothing else changes. `Globe.tsx`, `LayerManager.tsx`, and `LayerPanel.tsx`
   never need to know the new layer exists — they only deal with
   `LayerDefinition`s and the enabled-state map.

**How future engines integrate:** the Layer Engine doesn't know or care which
engine produced a `LayerDefinition` — it only deals with the contract in
`types.ts`. A future Country Engine, Relationship Engine, Intelligence Engine,
etc. is expected to own its own data/state internally and hand the Layer
Engine a component via `registerLayer()`, the same way the placeholders do.
That decoupling — engines produce layers, the Layer Engine only knows how to
register/toggle/mount/unmount them — is the reason this version exists.

### Geopolitical data architecture (`src/data/`)

Schema + query-layer foundation for future layers (v2.1 added the schema,
v2.1.1 added the registry below). Nothing renders this, nothing is
registered as a layer, and no country data is populated yet. Deliberately
separate from two things that already exist and might look similar at a
glance:

- `scene/countryGeometry.ts` — that's border/fill *geometry*, this is
  attribute *facts* (population, claimants, participants, ...).
- `data/countryProfiles.ts` — that's already-shipped, presentation-formatted
  data for the IntelligencePanel (population as `"335 Million"`). The new
  `Country` type stores the same kind of facts as plain numbers instead,
  because it's meant to be computed on (sorted, filtered, thresholded) by
  future layers — formatting is a presentation concern downstream of this.
  The two datasets are not merged; see `LOGBOOK.md` for why that's a
  separate decision, not a side effect of adding this schema.

`EntityRef` (`{ type: 'country' | 'territory', id: string }`) is how
`Conflict.participants` and `Relationship.parties` point at other records —
discriminated rather than a bare string id because country ids (ISO
3166-1 alpha-3) and territory ids (ad hoc slugs, no standard exists) aren't
guaranteed disjoint.

**`data/registry/CountryRegistry.ts`** is the query seam: `registerCountry`/
`getCountry`/`getCountries`/`removeCountry` over a plain `Map`, structurally
identical to `layers/layerRegistry.ts` (see that section above) with one
deliberate difference — registering a duplicate id **throws** here instead
of warning-and-overwriting, since there's no benign reason (like Vite HMR)
for the same country id to be registered twice yet. The registry doesn't
import `countries.json` itself and has no opinion about where `Country`
records come from; whatever eventually seeds it (a JSON loader, a future
Data Engine) is separate, deliberate work, the same way `layers/placeholders/`
— not `layerRegistry.ts` — is what actually knows which layers exist. Import
both types and registry functions from the barrel, `data/index.ts`, not
individual files — mirrors `layers/index.ts`'s role for the Layer Engine.

When a future layer actually consumes this data, it's expected to call
`getCountry()`/`getCountries()` for whatever it needs and register itself
through the Layer Engine the same way the placeholders do — this data
architecture and the Layer Engine are independent pieces that a real layer
will eventually connect.

**`data/registry/TerritoryRegistry.ts`** (v2.1.2) is the same pattern —
`registerTerritory`/`getTerritory`/`getTerritories` — for politically
complex territories (disputed areas, unrecognized states): Taiwan, Crimea,
Western Sahara, that kind of thing. The `Territory` type's central design
decision, and the reason this section exists rather than just pointing back
to the Country Registry description above: **who controls a territory and
who claims it are two separate fields**, `controllingAuthorities` and
`claimants`, not one field with a type flag. They frequently disagree (a
government can control territory that isn't internationally recognized as
rightfully theirs), and `controllingAuthorities` is a *list* — real-world
control is often split (Western Sahara has two administrators, divided by a
berm) — so the type doesn't force picking one administrator or resolving
the dispute itself. Both `ControllingAuthority` and `TerritoryClaimant`
accept an optional `Country`/`Territory` reference plus a required
`displayName`, because the relevant government is frequently *not* a
registered UN-member `Country` (Taiwan's own government, the Polisario
Front/SADR).

Worked examples for all three live in `data/registry/exampleTerritories.ts`
— **not imported anywhere the app loads**, on purpose. It's there to prove
the schema holds up against real, complicated cases (and to type-check,
which a JSON file can't) without those specific illustrative entries being
mistaken for "the real dataset" or this project's editorial position on any
of the disputes involved. See `LOGBOOK.md` for the full reasoning behind
the control/claims split.

**`data/registry/territories.ts`** (v2.2.4) is the real counterpart —
**this one *is* imported** (as a side effect of `data/index.ts`, so
`TerritoryRegistry` is populated before anything reads it). Same three
disputed entries as `exampleTerritories.ts`, reworded slightly, plus a
fourth: Puerto Rico, a genuinely uncontroversial dependency
(`status: 'dependency'`, `parentCountryId: 'USA'`, no claimants) included
specifically so not every real territory in search is a live dispute. Its
own `provenance.source` still carries the same "simplified, not
authoritative" caveat `exampleTerritories.ts` uses — being the dataset the
app actually loads doesn't make it a sourced, comprehensive one. See
`LOGBOOK.md` for why this needed to be a separate file rather than just
importing `exampleTerritories.ts`, and for a real bug this split caused
(v2.2.3's debug hook importing `exampleTerritories.ts` started throwing on
every dev page load once both files tried to register the same ids).

### Entity Resolution (`src/entities/`)

The seam between "an id came from a clicked map polygon" and "which
registry actually holds that id" (v2.1.3). **Wired into the live selection
pipeline as of v2.2.1** — `scene/Countries.tsx`'s click handler now
resolves through this (see "Selection & HUD panel state" above) instead of
constructing a country selection directly from the clicked polygon.

- **`types.ts`** — `GeopoliticalEntity`, the minimal shape
  (`id`/`name`/`aliases`/`provenance`) both `Country` and `Territory`
  already satisfy exactly as they're defined in `data/types.ts` — nothing
  was added to either interface for this. `ResolvedEntity` is the
  discriminated union `EntityResolver` actually returns: a
  `GeopoliticalEntity`'s fields plus `kind` (`'country' | 'territory'`, so
  a consumer can narrow), a normalized `location` (`Country.capital` and
  `Territory.location` are the same `GeoPoint` shape under different field
  names — `ResolvedEntity` picks one), and `data` (the full original
  record, for kind-specific fields like a country's `population` or a
  territory's `claimants`).
- **`EntityResolver.ts`** — `resolveEntity(id)` checks the Country
  Registry, then the Territory Registry (`resolveCountry(id) ??
  resolveTerritory(id)`); `resolveCountry(id)`/`resolveTerritory(id)` check
  one specifically. All three return `undefined` for a miss rather than
  throwing — unlike `registerCountry`/`registerTerritory`, where a
  duplicate id is a real bug worth throwing on, "this id isn't a country"
  is an expected, normal outcome here (that's what makes the `??` chain in
  `resolveEntity` work).

**The intended convention going forward:** once something starts consuming
resolved entities (a future click handler, a future layer), it should call
`resolveEntity()`/`resolveCountry()`/`resolveTerritory()` and never import
`CountryRegistry`/`TerritoryRegistry` directly — the same "import the
barrel, not the implementation" discipline as `data/index.ts` and
`layers/index.ts` elsewhere in this codebase, one level up. A future
Country Engine, Relationship Engine, or anything else that needs to look up
"what entity is this id" is expected to go through here, not reimplement
Country-then-Territory fallback logic itself.

**`GeometryMap.ts`** (v2.2.0, same directory) is the layer above this one:
`registerGeometryMapping(geometryId, entityId)` / `hasGeometryMapping
(geometryId)` / `getEntityForGeometry(geometryId)`. It completes the chain
implied by "resolve a clicked polygon into an entity":

```
polygon_id -> entity_id -> EntityResolver -> GeopoliticalEntity
```

`getEntityForGeometry` walks the whole thing and returns a ready-to-use
`ResolvedEntity` directly, rather than making every caller chain a
geometry-id lookup into a separate `resolveEntity()` call. Storage is a
plain `Map<string, string>` (geometry id -> entity id) — it doesn't know or
care what *kind* of geometry produced an id (a country polygon today, a
hand-authored territory shape or a point marker later), which is what
"support multiple geometry types" means in practice: there's no type
branching to extend, every id is opaque.

**This is the piece that makes territory selection possible without
touching `scene/Countries.tsx`'s rendering.** As of v2.2.1, the click
handler calls `getEntityForGeometry(polygonId) ?? resolveEntity(polygonId)`
— it checks `GeometryMap` first, and only falls back to treating the
polygon's own id as an entity id directly, which is what actually resolves
every country today for actual UN-member polygons; since v2.3.0, real
territory shapes also register through here — see "Territory geometry"
above). `exampleGeometryMappings.ts` (v2.2.0's placeholder file, still
**not imported anywhere the app loads**) is now superseded for two of its
three entries: `scene/useTerritoryFeatures.ts` registers real mappings for
Taiwan (`"158"`) and Western Sahara (`"732"`) using the same ISO numeric
ids this placeholder file anticipated. Its Crimea mapping
(`'placeholder-crimea-subregion'`) is still the only one that exists
anywhere, synthetic id and all — **Crimea has no standalone polygon
anywhere in the source data at all**, being geometrically part of
Ukraine's. See `LOGBOOK.md`.

Since v2.3.0, clicking Taiwan, Puerto Rico, or Western Sahara's actual
rendered shape on the globe reaches a Territory card, the same as clicking
any country — see "Territory geometry" above. Crimea is still reachable
only via search or the console helper below, since it has no rendered
shape to click. `hud/selectionStore.ts` also installs a dev-only console
helper (v2.2.3): `window.__debugSelectTerritory('taiwan' | 'puerto-rico' |
'crimea' | 'western-sahara')`, gated by `import.meta.env.DEV` and
eliminated from production builds — a console shortcut, redundant with
search/clicking for three of the four but still the only way to reach
Crimea's card outside search.

### Search (`hud/SearchBar.tsx`)

Since v2.2.4, search covers every registered `Country` *and* `Territory`,
not just the rendered country list. It builds one flat, ranked (exact →
starts-with → contains) list from two sources — `useCountryFeatures()`'s
features (via `geometryToCentroid`, same as before v2.2.4) and
`getTerritories()` (filtering out any territory with no `location`, since
there'd be nowhere to fly the camera) — and renders the top 8 as a live
dropdown, each row tagged `COUNTRY` or `TERRITORY`. Selecting a result (by
click, or Enter for the top match) calls `resolveEntity(id)` from
`entities/EntityResolver.ts` and passes the result to the generic
`selectEntity()` — not the old country-only `selectCountry()` — the same
resolution path a map click uses (see "Selection & HUD panel state"
above), so a search-selected territory produces an identical
`SelectedEntity` to a geometry click on one.

**Currently searchable entity types: `country` (193, from the rendered
UN-193 topology) and `territory` (4, from `data/registry/territories.ts` —
Taiwan, Puerto Rico, Crimea, Western Sahara).**

**Adding a future registry to search** (Conflict, Relationship, or
whatever a future engine introduces) is additive, mirroring exactly how
Territory was added on top of Country:

1. The new type needs a registry (`registerX`/`getX`s, same `Map`-backed
   shape as `CountryRegistry.ts`/`TerritoryRegistry.ts`) and needs to
   satisfy `entities/types.ts`'s `GeopoliticalEntity` shape
   (`id`/`name`/`aliases`/`provenance`) — no changes to the type itself if
   it already has those fields, same as `Country`/`Territory` needed none.
2. Add a `resolveX(id)` function to `entities/EntityResolver.ts` and fold
   it into `resolveEntity()`'s fallback chain (`resolveCountry(id) ??
   resolveTerritory(id) ?? resolveX(id)`), plus one more `ResolvedEntity`
   union member in `entities/types.ts`.
3. In `SearchBar.tsx`: one more block shaped like `territoryEntries`
   (map the registry's records to `SearchEntry`, skip any without a
   location), append it into `entries`, and add the new `kind` to
   `SearchEntry`'s union and `ENTITY_TYPE_LABEL`.
4. If real data should ship live (not just prove the schema), give it its
   own always-imported file like `registry/territories.ts` — never repurpose
   an explicitly-unimported example file for that (see `LOGBOOK.md`'s
   v2.2.4 entry for a real bug that came from almost doing exactly that).

Nothing about ranking, the dropdown UI, camera flight, or highlighting
needs to change — they're already generic over `SearchEntry`/
`ResolvedEntity` and don't know or care how many kinds exist.

### Data quirks worth knowing

- A handful of features in the topology have no numeric `id` (disputed
  territories in the pre-filter source data). Falling back to `String(f.id)`
  alone collides them all onto `"undefined"`, breaking both React keys and
  selection equality checks. The fallback is `` `feature-${index}` `` — keep this
  pattern if you add another feature-keyed list.
- `data/countryProfiles.ts` is illustrative demo data (government/capital are
  stable facts; population/GDP are rounded approximate snapshots), covering
  ~60 of the 193 countries. The intelligence panel degrades gracefully ("No
  profile data available") for the rest — don't assume every country has a
  profile.

## Code style

- No test framework is set up — verify changes by typechecking (`tsc -b
  --noEmit`), linting (`oxlint`), and actually running the dev server.
- Comments are used sparingly, mainly to explain *why* something non-obvious is
  done (see examples throughout `countryGeometry.ts`, `Globe.tsx`), not to
  restate what the code does.
