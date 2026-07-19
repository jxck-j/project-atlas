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
npm run build:geo  # regenerate public/geo/countries-un193.json (see Data pipeline below)
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
`SearchBar.tsx`, `CommandBar.tsx`).

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

- `hud/selectionStore.ts` — the selected country (`id`/`name`/world-space
  `direction`), `flightSeq` (camera-flight trigger), `resetSeq` (reset-view
  trigger). Read via `useSelection()`.
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

### Geopolitical data architecture (`src/data/{countries,territories,conflicts,relationships}/`)

Schema-only foundation (v2.1) for future layers — `types.ts` has the
`Country`/`Territory`/`Conflict`/`Relationship` interfaces, each JSON file
is an empty `[]`. Nothing renders this, nothing is registered as a layer,
and nothing populates it yet. Deliberately separate from two things that
already exist and might look similar at a glance:

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
guaranteed disjoint. When a future layer actually consumes this data, it's
expected to register through the Layer Engine above the same way the
placeholders do — this data architecture and the Layer Engine are
independent pieces that a real layer will eventually connect.

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
