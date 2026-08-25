# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

A command-center-style 3D globe built with React 19 + TypeScript + Vite + Three.js
(via React Three Fiber / drei) + Tailwind v4. The globe renders as a holographic
wireframe projection (glowing country borders, a static equator line, Fresnel
atmosphere rim) rather than a photo-real Earth texture — closer to a tactical
display than a map app. A full lat/long graticule grid also rendered through
v5.0.0 but was removed in v5.1.0 (see `README.md`'s "Design direction"); v6.2.1
added back only the single equator line, not the full grid. Country data covers
exactly the 193 UN member states.

## Branch context

`main` is the shipped baseline (currently v4.5.0) — `README.md`,
`CHANGELOG.md`, and `BACKLOG.md` at the repo root describe *only* `main`'s
state, and stay that way regardless of what other branches are doing.

`geo-data-engine` is a **prototyping/test-suite branch**, not a
feature branch headed for a normal merge — it's where the next tier of
geographic data (rivers/lakes, then streets; states/provinces, capitals,
and all 32,608 US city boundaries already promoted to `main` as v4.0–v4.3,
plus the Vitest safety net/`frameloop="demand"`/zustand-store/
`EntityRenderLayer` engineering work promoted as v4.3.1–v4.5.0) gets built
and logic-tested before any of it is judged ready for `main`. Work on this
branch is expected to include false starts and reworks that wouldn't
normally show up in `main`'s history (see `GEO_ENGINE_README.md`'s "Lessons
learned" for a real example — an always-on rendering approach that
shipped, then got reworked after review, within the same branch).

**This branch keeps its own doc set — `GEO_ENGINE_README.md` and
`GEO_ENGINE_CHANGELOG.md` — instead of writing into the root `README.md`/
`CHANGELOG.md`/`BACKLOG.md`.** Don't add this branch's prototyping content
to those files; they represent `main`, and this branch isn't `main` yet. If
`geo-data-engine` (or specific pieces of it) is ever promoted, the
promoting change is expected to fold the relevant `GEO_ENGINE_*.md`
sections into the root docs directly and retire the `GEO_ENGINE_*.md`
files — not keep two doc sets running in parallel indefinitely. This
branch was last reset to match `main`'s tip on 2026-07-28 (after the
v4.3.1–v4.5.0 promotion) — its own `GEO_ENGINE_*.md` files don't exist yet
again until new prototyping work on this branch creates them.

## Commands

```bash
npm run dev        # dev server, http://localhost:5173
npm run build      # tsc -b (project-references typecheck) + vite build to dist/
npm run lint       # oxlint
npm run preview    # preview the production build
npm run build:geo  # regenerate the four geo assets below (runs the npm scripts in sequence)
npm run build:geo:countries  # regenerate public/geo/countries-un193.json (see Data pipeline below)
npm run build:geo:entities   # regenerate public/geo/entities.json (see GeoEntity geometry below)
npm run build:geo:states     # regenerate public/geo/states-provinces.json (4,539 admin-1 features, 235 countries/territories)
npm run build:geo:cities     # regenerate public/geo/cities.json (223 capital/major-city point markers)
npm run build:geo:us-cities  # regenerate public/geo/us-cities-index.json + public/geo/us-cities/*.json
                              # (NOT part of build:geo — much slower/heavier; run by hand when the vendored
                              # Census shapefile changes)
npm run docs:claims          # regenerate CLAIMS.md from data/registry/geoEntities.ts (see Geopolitical data architecture below)
npm run build:military       # regenerate src/data/militaryScores.ts (Intelligence Engine — see Geopolitical data architecture below)
npm run build:economy        # regenerate src/data/economyScores.ts (Intelligence Engine — see Geopolitical data architecture below)
npm run build:technology     # regenerate src/data/technologyScores.ts (Intelligence Engine — see Geopolitical data architecture below)
npm run build:current-status # regenerate src/data/currentStatus.ts (Intelligence Engine — see Geopolitical data architecture below)
npm test                     # Vitest — pure-function coverage (geo.ts, lodLevels.ts, labelDeclutter.ts, countryGeometry.ts, countryAbbreviation.ts)
```

`tsc -b --noEmit` (project references mode, not plain `tsc --noEmit`) is the
correct way to typecheck without emitting — matches what `npm run build` does.

Vitest (`vitest.config.ts`, separate from `vite.config.ts` — build-only
concerns like `manualChunks` have no meaning for the test runner) covers this
project's pure geometry/math functions (`utils/geo.ts`'s
`bearingBetween`/`angularDistance`/`normalizeAngle`, `lod/lodLevels.ts`'s
`resolveActiveLevels`/`resolveDeepestLevel`/`isLodLevelActive`,
`scene/labelDeclutter.ts`, `scene/countryGeometry.ts`'s merge/triangulate
logic) with hand-verified expected values rather than snapshots — these are
exactly the functions tied to this project's documented bug history (the
`CAMERA_MIN_DISTANCE` tightening, the `flyToUsCity()` timing hazard, the
antimeridian-unwrapping earcut deviation). It does not cover component
behavior — verify UI changes by actually driving the dev server.

## Architecture

Since v2.0, Atlas is organized around long-lived **engines** rather than a flat
feature list — each engine is a self-contained subsystem with its own directory.
Current: the Rendering Engine (`src/scene/`), the Layer Engine (`src/layers/`,
see below), and the LOD Engine (`src/lod/`, v4.3 — owns the camera-distance
ladder zoom-gated content like `UsCityLabels.tsx` reveals against, and the
plug-in point for future zoom-gated datasets: Roads, Rail, Rivers, Airports,
Ports, Military Bases, Infrastructure). Planned: Country Engine, Relationship
Engine, Intelligence Engine, Data Engine, Timeline Engine. Before starting a
new major version, name which engine is being expanded and how it reduces
future complexity — see `CHANGELOG.md`'s versioning note and `LOGBOOK.md` for
the reasoning behind this.

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
zustand-backed pub/sub stores (v4.4.0 — `selectionStore.ts`, `settingsStore.ts`,
`telemetryStore.ts`, `layerStore.ts`, `lodStore.ts`, `hudPanelStore.ts`, plus the
non-reactive `globeRotation.ts`/`hoveredCountry.ts` modules, built on zustand's
vanilla `createStore` since neither ever needed a React hook). This exists
specifically so a value written every animation frame (camera orbit angles,
FPS, hover lat/lng) doesn't re-render the whole React tree at 60fps — only
components that actually call the corresponding `useX()` hook re-render, and
only when the value actually changes (a bare `useStore()` call subscribes to
the whole state and re-renders on any change, matching the pre-v4.4.0
`useSyncExternalStore` behavior exactly; a hook that only needs one field —
`lodStore.ts`'s `useLodLevel()` is the example to copy — should pass a
selector instead, e.g. `useLodStore((state) => state.level)`, so it only
re-renders when that field's reference actually changes). Every store keeps
its pre-migration exported function/hook names and signatures unchanged —
`selectEntity()`, `flyToUsCity()`, etc. — only the internal implementation
moved off hand-rolled `useSyncExternalStore` boilerplate. Follow this pattern
for any new scene→HUD data; don't reach for React context for anything
frame-driven.

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
- **`geometryToAngularExtent` takes the MAX of each polygon's own
  independently-unwrapped extent, not a combined bounding box across every
  polygon** (v5.2.4) — a MultiPolygon country's separate pieces (Russia's
  Kaliningrad exclave vs. its Far East, the USA's Alaska/Hawaii vs. the
  mainland) can each unwrap correctly in isolation but land on different
  360°-multiple "branches" relative to each other; combining them into one
  running min/max produced results past 360° for Russia specifically
  (~503°), which then broke `labelDeclutter.ts`'s `apparentSizePx` (`sin` of
  a bogus half-angle past 180° flips sign). If you're computing anything
  that needs "how big does the single landmass under this entity's label
  actually look," use this function; don't reach for a from-scratch
  combined bounding box across a MultiPolygon's rings — see this file's own
  header comment and `LOGBOOK.md`'s v5.2.4 entry for the full reasoning
  and the accepted tradeoff (a true archipelago that doesn't cross the
  antimeridian, like Indonesia, now reports only its single largest
  island's extent).
  **A ring that encircles a pole (v5.2.6) needs its longitude span
  ignored entirely, not just kept per-ring.** Antarctica's coastline runs
  all the way around the pole rather than dipping near the antimeridian
  once — `unwrapRingLongitudes` doesn't error on it, but the cumulative
  drift over a full lap doesn't cancel out to ~0 like it does for every
  other ring's closure back to its own start; it lands ~360° away instead,
  which `geometryToAngularExtent` used to report as the extent (`sin(180°)
  ≈ 0` in `apparentSizePx`, permanently collapsing Antarctica's apparent
  size to zero — always abbreviated, regardless of zoom). A ring whose
  unwrapped last point is more than 180° from its unwrapped first point
  encircles a pole; use only its latitude span in that case. See
  `LOGBOOK.md`'s v5.2.6 entry.

Every function in this file is generic over any GeoJSON `Geometry` — nothing
in it is country-specific despite the file name. `scene/GeoEntities.tsx`
(v3.0.0, replacing v2.3.0's `Territories.tsx`) reuses all four functions
unchanged to render every non-country entity; this module needed zero
changes to serve a second, then a five-classification-wide, entity kind.

### GeoEntity geometry (`scene/GeoEntities.tsx`, `scene/geoEntityEntries.ts`, v3.0.0)

Closely mirrors `scene/Countries.tsx` — same merged-geometry-per-entity
approach (via `countryGeometry.ts`, see above), same hover/select/dim color
logic and palette (deliberately identical to countries — a GeoEntity reads
as "another selectable thing on this globe," not a different visual
category), same click-vs-drag threshold. Through v4.4.0 this was kept as
its own file rather than generalizing `Countries.tsx` into a shared
component — same reasoning `CountryRegistry.ts`/`GeoEntityRegistry.ts` are
two files instead of one generic `Registry<T>` (see below): duplication
meant this addition couldn't regress already-verified country
click/highlight behavior.

**v4.5.0 extracted that shared rendering into `scene/EntityRenderLayer.tsx`**
once `countryGeometry.ts` had Phase 1 test coverage (v4.3.1) to guard
against exactly the regression the duplication above was written to avoid.
`Countries.tsx` and `GeoEntities.tsx` each build their own `GeoEntityEntry[]`
and pass an `onSelect` callback into one shared `<EntityRenderLayer>`, which
owns the border/fill mesh per entry, hover/select/dim color computation, the
click-vs-drag threshold (`scene/useClickDragGuard.ts`, its own module as of
2026-08-16 — oxlint's react-refresh rule flags a hook exported alongside
components from the same `.tsx` file), and `HoverLabel` (exported from
`EntityRenderLayer.tsx` as of that same date — see below for why).
`StatesProvinces.tsx` used `EntityRenderLayer` too from
v4.4 through 2026-08-15, but stopped once province count made its
one-mesh-per-entry model the bottleneck itself — see below. `HoverLabel`
(v5.2.7) renders every entry the same way
regardless of size — inline, glowing, at the entry's own centroid, the
exact position `PassiveEntityLabels.tsx`'s passive label for that same
entry already occupies — replacing that passive label in place rather than
sprouting a leader-line callout off to the side, which is what every
entity under `LARGE_ENTITY_THRESHOLD_DEG` (7°) got before. Because hover
and passive labels now share a position, each caller also needs to
publish its own hovered id (`Countries.tsx`'s pre-existing
`hoveredCountry.ts`, `GeoEntities.tsx`'s `hoveredGeoEntity.ts`,
`StatesProvinces.tsx`'s `hoveredStateProvince.ts`, all v5.2.7 except the
first) so its own passive-label layer excludes whichever entity is
currently hover-glowing — otherwise the two labels stack exactly on top of
each other instead of one replacing the other. Each publisher converts
`EntityRenderLayer`'s reported geometryId to the corresponding entityId
before publishing (needed for `GeoEntities.tsx` specifically — 44 of 55
GeoEntities have a geometry id that differs from their entity id, see
below). **v5.2.8** fixed `HoverLabel` rendering visibly bigger than the
passive label it replaces — two stacked causes: it had hardcoded a flat
font size instead of sharing `PassiveEntityLabels.tsx`'s apparent-size
formula (now factored into `scene/useApparentFontSize.ts`, imported by
both), and its `<Html>` still carried a leftover `distanceFactor` prop
applying its own distance-based scale on top, which the passive label's
`<Html>` has never used (see "Frame loop"'s `WaterLabels`/`Lakes.tsx`/
`UsCityLabels.tsx` precedent for dropping it). The same version also
stopped rendering `HoverLabel` at all for a *selected-but-not-hovered*
entity — `IntelligencePanel.tsx`'s name heading already covers that case
— so it's hover-only now; see the correction below and `LOGBOOK.md`'s
v5.2.8 entry. What stays in each caller is only what's a *real* difference:
how entries get built (see below), and what happens when a click resolves
to nothing — `Countries.tsx` falls back to `selectCountry()` so a click
never silently no-ops, `GeoEntities.tsx` and `StatesProvinces.tsx` just
no-op, since every rendered shape in those two already has a `GeometryMap`
registration by the time it's clickable.

**v6.3.3** made that shared apparent-size formula configurable rather than
one fixed set of constants — `useApparentFontSize.ts`'s
`computeApparentFontSizePx`/`useApparentFontSize` and
`PassiveEntityLabels.tsx`/`HoverLabel` (`EntityRenderLayer.tsx`) now all take
an optional `FontSizeConfig` (min/max font px, apparent-size ratio),
defaulting to the original constants so every pre-existing caller is
unchanged. `scene/stateLabelFontConfig.ts` is the first override: a direct
request (with a concrete example, Hessen in Germany) that state/province
labels read about 1.67x bigger than country labels at every zoom level, not
just a raised ceiling — scaling the floor/ceiling/ratio by the same factor
reproduces the identical growth curve, just uniformly bigger. Kept as its
own plain `.ts` module (not exported from `StateProvinceLabels.tsx`) for the
same oxlint react-refresh reason `geoEntityEntries.ts`/`useClickDragGuard.ts`
already are, and imported by both `StateProvinceLabels.tsx`'s passive layer
and `ProvinceFillLayer.tsx`'s `HoverLabel` call — the two are meant to read
as the same size at all times per the v5.2.8 fix above, so overriding only
one would just relocate that same mismatch bug.

**`StatesProvinces.tsx` grew its own rendering path separate from
`EntityRenderLayer` once province count made the shared component's
one-mesh-per-entry model the actual performance bottleneck, not just a
different visual treatment.** The path there: v6.2.4 added dashed borders
(`LineDashedMaterial` instead of solid) so a province boundary read as
visually distinct from a country one; v6.2.5 added a deduplicated boundary
line (`useStatesProvincesFeatures.ts`'s `useStatesProvincesBoundary()`,
built via `topojson-client`'s `mesh()` — every arc walked exactly once
regardless of how many provinces reference it) as `StatesProvinces.tsx`'s
own `BoundaryMesh` component, since rendering every province's own full
border ring drew every INTERNAL admin-1 boundary twice (once from each
adjacent province's ring), which while both were dashed reliably looked
solid wherever the two independently-phased dash patterns happened to
mostly cover each other's gaps (reported for a Brazilian state pair — see
`LOGBOOK.md`'s v6.2.5 entry). Both of those lived as `EntityRenderLayer`
props (`dashedBorders`, `hideDefaultBorders`) at the time.

**The 1:10m upgrade (below) changed the actual scale this layer needed to
handle — 294 provinces to 4,539 — and everything downstream of that had to
be revisited, not just tuned.** Dashing was dropped entirely (2026-08-16):
even after normalizing dash count per ring (`countryGeometry.ts`'s
distance functions), a technically-correct dash pattern across thousands
of small boundaries just read as visual noise, reported directly as a
preference; `BoundaryMesh` now renders solid at a muted opacity instead.
More fundamentally, `EntityRenderLayer` mounting one individually-
raycast/redrawn mesh per province (fine at Countries.tsx/GeoEntities.tsx's
~193/~55 scale) became the FPS bottleneck itself once there were thousands
of them — confirmed directly as "destroying fps," and confirmed AGAIN
after an LOD-gate-only fix (only render once zoomed in) and a front-facing
filter (`scene/useFrontFacingEntries.ts`, exclude back-facing/off-screen
provinces) each helped but didn't fully resolve it, especially over a
province-dense region like Europe where a front-facing filter excludes
little. `scene/ProvinceFillLayer.tsx` (2026-08-16) is the actual fix:
one merged mesh (`scene/mergedProvinceFill.ts`) handles hit-testing via
triangle `faceIndex` → entry lookup instead of one mesh per entry, plus
small unraycastable overlay meshes/borders for whichever entry is
hovered/selected — same visual result, same click precision (same
triangles, just concatenated into one buffer), far fewer objects. Since
`StatesProvinces.tsx` no longer calls `EntityRenderLayer` at all, that
component's now-dead `dashedBorders`/`hideDefaultBorders` props were
removed along with it rather than left in place with no caller — see
`LOGBOOK.md`'s "States/provinces FPS" parts 1-4 for the full trail of what
was tried, including the two attempts that turned out insufficient once
actually checked in the browser, and `BACKLOG.md` for whether this is
confirmed fully resolved.

`GeoEntities.tsx` deliberately does **only** primary selection (hover,
click, highlight the one clicked entity) — no parent-overlay or
claims-overlay logic lives here. Those are `src/layers/geoOverlays/`'s job
(see the Layer Engine section below); keeping this file selection-only is
what "don't hardcode entity behavior inside Globe rendering components"
means in practice. The entry-building logic (`buildGeoEntityEntries`) lives
in its own plain `.ts` module, `scene/geoEntityEntries.ts`, specifically so
`GeoEntities.tsx`, `ParentOverlayLayer.tsx`, and `ClaimsOverlayLayer.tsx` can
all derive the same {geometryId, entityId, geometry, ...} entries from the
same raw features without a `.tsx` component file exporting a non-component
value from itself (oxlint's `react-refresh` rule flags that, correctly).

**The one thing that is NOT safe to assume equal between `Countries.tsx`
and a GeoEntity:** a country's rendered polygon id and its registry id are
the same string by construction — since v4.5.0, `Countries.tsx` builds its
own entries with `geometryId`/`entityId` both set to that one id (so they
feed into the same `EntityRenderLayer` a GeoEntity does), but the two
fields are only ever the *same value by coincidence of a country's shape*,
not because `EntityRenderLayer` assumes it. A GeoEntity's rendered shape id
and its entity id are only *sometimes* the same string: 44 of the 55
rendered entities have a numeric ISO id in the source (`"158"` for Taiwan)
that differs from their registry id (`"taiwan"`) — that's the whole reason
`GeometryMap` exists — while the other 11 (Kosovo, the Cyprus Sovereign
Base Areas, Guantanamo Bay, Baikonur, the Cyprus UN Buffer Zone, Siachen
Glacier, and four disputed maritime features) have no numeric id in the
source at all, so the build script stamps their target registry id
directly onto the feature as its geometry id — for those, geometryId and
entityId happen to already be the same string. Either way, `GeoEntityEntry`
carries both `geometryId` (hover state, `GeometryMap` lookups) and
`entityId` (what `EntityRenderLayer` compares against `selectedEntityId`)
rather than one `id`, because the equality can't be assumed in general.
Getting this wrong doesn't throw or warn — it silently makes `isSelected`
always `false`, so a selected entity renders with the same faint dimmed
treatment as everything else instead of highlighted. See `LOGBOOK.md`'s
v2.3.0 entry for how this exact bug was originally found for Territory (a
screenshot, not a type error) and a second, related bug it surfaced
(`Globe.tsx`'s `CapitalMarker` needing to check `selected.entity.kind`,
not just look up `selected.name` by string) — both lessons carried forward
unchanged into v3's broader entity set.

`scripts/buildEntityTopology.mjs` (`npm run build:geo:entities`) extracts
real geometry from the same `world-atlas` 10m source
`buildCountryTopology.mjs` reads, for every registered GeoEntity that has a
standalone polygon there — see `entities/entityGeometryIds.ts` (two maps:
`ENTITY_GEOMETRY_IDS` for numeric-id features, `ENTITY_GEOMETRY_NAME_KEYS`
for the 11 id-less ones, matched by raw source name and re-stamped with
their target id before the topology rebuild) for which entities and why not
all of them: Crimea still has no rendered geometry anywhere in the source
data, at any resolution — it stays selectable via search or the dev console
helper only, exactly as it has since v2.3.0.

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
- `input/CameraController.ts`'s `useCameraController.ts` (v3.2.0) — held-key
  WASDQE nudging, reusing the same spherical-coordinates-around-target
  approach as the flight hooks above, applied every frame instead of
  tweened. See "Input Layer" below for the full picture; mentioned here
  because it's mounted in this same hook composition, right alongside the
  four above.

The core sphere mesh doubles as the double-click-on-ocean target: country fill
meshes sit in front of it and call `stopPropagation()` on `onDoubleClick`, so the
core sphere's handler only fires when the double-click didn't land on a country.

### Frame loop

`Scene.tsx`'s `<Canvas>` runs `frameloop="demand"` (v4.3.2) — R3F only
renders when something calls `invalidate()`, not on every display refresh.
This still exists for the same reason the earlier approach did: 193
fully-detailed countries push enough GPU/CPU work that rendering on every
frame of a 120Hz+ monitor made things worse, not better; demand mode means
a fully idle globe (nothing selected, ambient rotation off, no camera
input) renders zero frames.

`invalidate()` is automatic for any React-driven prop change on a Three
object (a color/opacity update coming from JSX), but **not** for a Three
object mutated directly inside a `useFrame` callback — that's the case
every animation in this codebase falls into, so each needs its own explicit
call: `Globe.tsx`'s ambient self-rotation, `PointerMarker.tsx`'s pulse,
`useCameraFlight.ts`/`useCameraReset.ts` (both the effect that starts a
flight and the per-tick mutation during it), `input/CameraController.ts`'s
WASDQE nudging (plus the actual key-down handler in
`input/KeyboardController.ts`, which is what lets a held key's `useFrame`
notice it's held at all in the first place), `useFlickAutoRotate.ts`'s
flick-to-spin, and `CameraControls.tsx`'s ambient-rotation toggle effect
(the T key). If you add a new animation that mutates a Three object
directly inside `useFrame` rather than through a React prop, it needs its
own `invalidate()` call too, or it'll silently never render past its first
frame while idle.

**History, if you're wondering why this looks different from what an older
version of this file described:** before v4.3.2, this ran
`frameloop="never"` with `scene/FrameRateCap.tsx` manually calling R3F's
exported `advance(timestamp)` every frame, capping at `1000/60ms`.
`advance()` feeds its argument straight into `state.clock.elapsedTime`,
which Three.js's `Clock` (and therefore every `delta`-based animation)
tracks in **seconds** — `requestAnimationFrame`'s timestamp is in
**milliseconds**, and passing it through unconverted once made every
computed delta ~1000x too large, spinning the globe wildly. That whole
class of bug is gone under `frameloop="demand"`: there's no `advance()`
call and no manual clock feeding left to get wrong.

### Selection & HUD panel state

- `hud/selectionStore.ts` — `selected: SelectedEntity | null` (since v2.2.1:
  wraps a full `ResolvedEntity` — country *or* GeoEntity (v3.0.0; any of the
  five non-sovereign classifications) — from
  `entities/EntityResolver.ts`, plus denormalized `id`/`name`/world-space
  `direction` at the top level so generic consumers don't need to reach
  into `entity.*`), `inspectorOpen` (v3.2.0 — see below), `flightSeq`
  (camera-flight trigger), `resetSeq` (reset-view trigger). Read via
  `useSelection()`. Two ways to select: `selectEntity(resolvedEntity,
  direction, options?)` (generic — what `scene/Countries.tsx`'s click
  handler, `hud/SearchBar.tsx`'s result selection, and (v3.2.0)
  `input/SelectionController.ts`'s arrow-key navigation all use, resolving
  through `EntityResolver.resolveEntity()` first) and `selectCountry({id,
  name, direction})` (a narrower country-only wrapper, kept for any caller
  that only ever has a country id/name in hand and doesn't want to resolve
  it itself; resolves through the Country Registry internally). See the
  Entity Resolution section below and `LOGBOOK.md` for why the migration
  was shaped this way.
- **`inspectorOpen: boolean`** (v3.2.0) is deliberately a separate fact from
  `selected` — see `hud/IntelligencePanel.tsx`'s `isOpen = selected != null
  && inspectorOpen`. Every selection path before v3.2.0 (map click, search)
  always opened the panel, so `selectEntity`'s third argument,
  `options?.openInspector`, defaults to `true` when omitted — every one of
  those call sites is unchanged and behaves identically. Only
  keyboard arrow-key navigation passes `{ openInspector: false }`,
  and even then `false` means "leave `inspectorOpen` as it was," not "force
  it closed" — an already-open panel keeps live-updating as you arrow
  through entities; a closed one stays closed until Enter (`openInspector()`)
  explicitly opens it. See the Input Layer section below and
  `LOGBOOK.md`'s v3.2.0 entry.
- `hud/hudPanelStore.ts` — which single toolbar dropdown (`'search' |
  'settings' | 'layers' | 'alliances' | null`, v6.2.0 added the last one) is
  open; mutually exclusive, toggled from `hud/TopNav.tsx`/`hud/SideRail.tsx`.
- A country's fill/border color and opacity in `Countries.tsx` are computed
  per-country from `isSelected` / `isHovered` / `isDimmed` (dimmed = some other
  country is selected) — there's no separate "theme" object, it's inline per-render.
- The hover country's name label (`HoverLabel`, in the shared
  `scene/EntityRenderLayer.tsx` — see "Rendering Engine" below) shows only
  while actually hovered. **Through v5.2.7 it also persisted for whatever
  was selected, even without hovering; v5.2.8 dropped that** —
  `IntelligencePanel.tsx`'s own name heading already covers a selected
  entity for as long as anything's selected, so the two were redundant.
  Water-body labels (`WaterLabels`) only show when nothing is
  selected; the capital marker (`CapitalMarker`, both in `Globe.tsx`) only shows
  when the selected country has profile data in `countryProfiles.ts`.
  `CapitalMarker` renders through `scene/PointerMarker.tsx` (v3.3.0) — a
  shared "pulsing dot + leader line + label" callout also used by
  `ClaimsOverlayLayer.tsx`'s related-country marker, after both had
  independently drifted into being reported as too large/far-swinging;
  tune sizing there, not in either caller, so the two can't drift apart
  again.
  `WaterLabels` (v5.2.1) determines front/back-of-globe visibility the same
  way `CountryLabels.tsx` and `Lakes.tsx`/`Rivers.tsx` do — an analytic
  dot-product check (`labelDeclutter.ts`'s `isCandidateVisible`) against the
  core sphere's radius, computed per-frame with the globe's current ambient
  rotation factored in — not `Html`'s raycast-based `occlude` prop. It used
  `occlude` originally, but that never reliably hid a far-side label in
  practice (reported as an ocean name staying visible "through" the globe at
  every zoom level and camera angle, not just near the terminator); rather
  than debug why the raycast approach was unreliable, it was replaced with
  the mechanism this codebase had already solved once.
  **`scene/useFrontOfGlobeVisible.ts`** (v5.2.2) generalizes that same
  analytic check into a small hook for every *other* `Html` label that
  persists while something stays selected rather than only while it's
  hovered: `Cities.tsx`'s `CityLabel` and `PointerMarker.tsx` (so both
  `CapitalMarker` and `ClaimsOverlayLayer.tsx`'s related-country marker get
  it for free), plus `EntityRenderLayer.tsx`'s `HoverLabel` — which used to
  fit that same description (selection persisted it without hovering) but,
  since v5.2.8, is hover-only; it keeps the same unconditional check anyway
  because a hovered entry is already known front-facing, so the check is
  merely cheap and harmless there now rather than load-bearing. All
  three had the identical latent bug `WaterLabels` did — reported first for
  ocean names, but the actual root cause (an `Html` label has no WebGL
  depth buffer to be hidden by, unlike the real `<mesh>`/`<Line>` dot and
  leader line every one of these markers also draws) applies to any
  selection-triggered label, not just water bodies. `scene/UsCityLabels.tsx`
  needed no version of this: it never persists a label past what
  `declutterLabels` already re-evaluates continuously.
  `WaterLabels` (v5.2.4) also dropped `Html`'s `distanceFactor` prop — that
  scales a label to a constant world-space size, which reads BIGGER on
  screen the closer the camera gets, unbounded; reported directly as sea/
  strait/gulf names growing "extremely too big" and overlapping once
  zoomed in close (Strait of Hormuz over the Persian Gulf, Red Sea over
  sovereign states). `UsCityLabels.tsx` already documents dropping this
  exact prop for the identical reason. Water bodies have no polygon data
  to size against the way countries/GeoEntities do (see
  `data/waterBodies.ts`), so this only stops the unbounded growth — it
  doesn't give them apparent-size-based scaling.
  See `LOGBOOK.md`'s v5.2.1, v5.2.2, and v5.2.4 entries.
- **`hud/IntelligencePanel.tsx`** (v2.2.2) dispatches on
  `selected.entity.kind`: `CountryDetails` (unchanged since v1 — same
  `COUNTRY_PROFILES` lookup, same GOVERNMENT/CAPITAL/POPULATION/GDP rows,
  same "no profile data" fallback) for `'country'`, `GeoEntityDetails`
  (v3.0.0, replacing v2.2.2's Territory-only `TerritoryDetails`) for
  `'geo-entity'` — ENTITY TYPE / SOVEREIGN STATE / ADMINISTERING POWER /
  CLAIMANT(S) / TERRITORIAL CLAIMS, plus STRATEGIC SIGNIFICANCE / TREATY FRAMEWORK when
  `GeoEntity.metadata` carries them, reusing the same `DataRow` component.
  **v6.1.0 added POPULATION/GDP rows** (same source-year-in-parens
  treatment and `utils/formatScale.ts` formatting as `CountryDetails`'s),
  shown only for the minority of GeoEntities that have them — see the
  Geopolitical data architecture section below for which entities do and
  why. Every relationship field is allowed to be empty/absent (see
  `data/types.ts`), so each row is omitted individually rather than falling
  back to one blanket "no data" message. Still deliberately a two-way
  check, not a registry/plugin system like the Layer Engine's — one
  `GeoEntityDetails` component covers all five non-sovereign
  classifications because they share one relationship shape (see the
  Geopolitical data architecture section below); the dispatch itself only
  ever needed to grow to two arms, not five, because `kind` is `'country' |
  'geo-entity'`, not one member per `GeoEntityType`. See `LOGBOOK.md`.
- **`scene/highlightColors.ts`** (v3.1.0) is the single source of truth for
  every highlight/selection color the globe renders — `Countries.tsx`,
  `GeoEntities.tsx`, and every `geoOverlays` layer (below) all import their
  colors from here rather than each hardcoding their own hex literal.
  **`hud/LegendPanel.tsx`** reads the exact same values to explain them, so
  the two can never drift apart. Deliberately always-on (stacked with
  `Telemetry.tsx` in a shared bottom-left flex column in `App.tsx`, not a
  Toolbar toggle) and deliberately bottom-left, not bottom-right/top-right —
  `IntelligencePanel.tsx` covers the entire right edge
  (`inset-y-0 right-0`) for as long as anything's selected, which is
  exactly when the overlay colors this legend explains are on screen. See
  `LOGBOOK.md`'s v3.1.0 entry.
- **`ClaimsOverlayLayer.tsx` renders a claim relationship in both
  directions, on two unconnected geometry systems** (v3.1.0). Selecting a
  Country (China) highlights the GeoEntities it claims (Taiwan, Spratly
  Islands, ...) with a dashed red border, drawn on the same GeoEntity
  geometry `scene/GeoEntities.tsx` uses. Selecting a claimed GeoEntity
  (Taiwan) highlights the Country claiming it (China) with a **different**
  treatment — dashed orange border, a prominent fill covering the whole
  country (not a thin outline) — drawn on `Countries.tsx`'s geometry
  instead, fetched independently via `useCountryFeatures()`. The two
  directions can't share rendering code because a `Country` has no
  presence in the GeoEntity feature collection at all; don't assume "the
  other end of a relationship" is representable by whatever loop is
  already iterating one side of it. See `LOGBOOK.md`'s v3.1.0 entry for
  how this gap was found. A claimant no longer gets `PointerMarker`'s
  pulsing "CLAIMANT — \<NAME\>" callout as of v4.1.1 — the dashed
  border + fill highlight alone reads clearly enough for a disputed claim.
  The marker is still shown for the uncontested `'parent'` role (e.g.
  Puerto Rico → USA), where there's no dispute to read from a highlight
  alone. **v6.2.4: `useRelatedCountryRoles()` skips this entirely for a
  selected `'administrative-division'`** (a state/province) — every
  province's `parentEntity`/`administeredBy` points at its own sovereign
  country by construction (`useStatesProvincesFeatures.ts`), so without
  this carve-out every one of the provinces would highlight its own
  country on every select, which isn't a relationship worth flagging the
  way an uncontested dependency or a disputed claim is. Every other
  `GeoEntityType` is unaffected.
- **`CategoryHighlightLayer.tsx`** (v3.3.0) registers six ordinary Layer
  Engine layers — one per selectable classification (`'country'` plus the
  five `GeoEntityType` values) — each drawing every entity in that one
  classification with the same additive highlight treatment
  (`scene/countryEntries.ts`'s `buildCountryEntries()` for the `'country'`
  layer, `scene/geoEntityEntries.ts`'s `buildGeoEntityEntries()` filtered by
  `type` for the other five), independent of and simultaneous with the
  current selection. Six independent toggles rather than one "pick a
  category" store/control — `hud/LayerPanel.tsx` already renders whatever's
  registered generically, so this needed zero new HUD plumbing, and
  enabling more than one category at once (e.g. sovereign states *and*
  strategic regions) just works the way any two independently-toggleable
  layers do. `hud/LegendPanel.tsx` shows one CATEGORY HIGHLIGHT row if any
  of the six `'highlight-*'` ids is enabled — see `LOGBOOK.md`'s v3.3.0
  entry.

### Input Layer (`src/input/`, v3.2.0, "Phase 3.2")

A dedicated module for keyboard input, parallel to `scene/`/`hud/`/`data/`/
`entities/`/`layers/` — added specifically so keyboard logic never lives
inside a Globe component (per this feature's own brief) and so mouse and
keyboard selection are guaranteed to end up in the same place: every
command this layer resolves is routed through the *existing*
`hud/selectionStore.ts`/`hud/hudPanelStore.ts` functions, never a parallel
selection concept.

**Pieces, and why they're separate:**

- `types.ts` — the command vocabulary (`CameraNudgeCommand`,
  `NavigationDirection`, `ActionCommand`), imported by every other file here
  so none of them import each other just to share a type.
- `KeyboardController.ts` — the *only* `window` keydown/keyup listener this
  entire app installs for gameplay-style input (`scene/CameraControls.tsx`
  separately keeps its own pre-existing, narrower Home-key listener —
  untouched, not folded into this). Owns the key-binding table, the focus
  rule (`isTypingInField()` — typing in the search bar or any text input
  suppresses every shortcut), and a plain `Set<CameraNudgeCommand>` of
  currently-held camera keys. That Set is deliberately *not* React state —
  read imperatively, once per animation frame, by `CameraController.ts` —
  for the same "a value that changes 60×/second shouldn't trigger
  React re-renders" reason `telemetryStore.ts`/`globeRotation.ts` are
  plain pub/sub instead of context (see "Two-layer split" above).
  `useKeyboardController(onCommand)` is mounted exactly once, by
  `InputManager.tsx`; its callback is stored in a ref reassigned every
  render rather than depended on directly, so the one-shot commands
  (arrows, Enter, Escape, ...) always dispatch against the *current*
  render's closure without the underlying `window` listener ever being
  torn down and re-attached.
- `CameraController.ts` — two things: `useCameraController(controlsRef)`
  (mounted inside `scene/CameraControls.tsx`, alongside
  `useFlickAutoRotate`/`useCameraFlight`/`useCameraReset` — an addition to
  that hook composition, not a change to any of the existing three) applies
  WASDQE nudges every frame using the *same* spherical-coordinates-around-
  target pattern `useCameraFlight.ts`/`useCameraReset.ts` already use to
  animate the camera, clamped to the same `CAMERA_MIN/MAX_DISTANCE` and
  `CAMERA_MIN/MAX_POLAR_ANGLE` bounds, and bails out whenever
  `controls.enabled` is false — the same flag those two hooks already set
  while a cinematic flight owns the camera, so a held key can never fight
  an in-progress flight. Separately, `resetCamera()`/`focusOnSelection()`
  are one-line wrappers around the *existing* `resetView()`/
  `flyToSelectedCountry()` — R and Space don't introduce any new camera
  behavior, they're keyboard aliases for actions the Home key/toolbar
  button and the panel's "FOCUS CAMERA" button already trigger.
- `SelectionController.ts` — `findNearestInDirection(origin, direction,
  candidates, excludeId?)`, a pure function with no entity ids, names, or
  types anywhere in its logic: great-circle bearing (`utils/geo.ts`'s
  `bearingBetween`, kept only within a ±90° cone of the requested
  direction) then great-circle distance (`angularDistance`) among what's
  left. `useEntityNavigation()` builds the live candidate list from
  `useCountryFeatures()` + `useGeoEntityFeatures()` (centroids via
  `scene/countryGeometry.ts`'s `geometryToCentroid`) unconditionally, plus
  `useStatesProvincesFeatures()` only while the `'states-provinces'` Layer
  Engine layer is actually enabled (that layer is off by default — see
  `layers/geoOverlays/StatesProvincesLayer.tsx` — and without this gate,
  arrow-key navigation could select and fly to a state/province that isn't
  rendered on the globe at all). Cities are excluded entirely, regardless of
  whether the `'cities'` layer is on — reported directly that arrow-key
  navigation shouldn't reach cities; they stay selectable by click or search,
  just never a keyboard-navigation candidate. Calls the *existing*
  `selectEntity()` with `{ openInspector: false }`. Also owns Tab/Shift+Tab
  category cycling — seven fixed categories (`'country'` plus six of the
  seven `GeoEntityType` values, `'city'` omitted for the same reason), landing
  on the alphabetically-first entity in whichever category comes next. See
  `LOGBOOK.md`'s v3.2.0 entry for why `geometryToCentroid`'s known
  (pre-existing, documented) imprecision means this occasionally picks a
  geographically-surprising neighbor — inherited, not new.
- `InputManager.tsx` — mounted once from `App.tsx` (outside the Canvas,
  like every other HUD component), renders nothing. The one file that knows
  the full mapping from one-shot command to system: arrows →
  `SelectionController`, R/Space → `CameraController`'s wrappers,
  Enter/Escape/I → `openInspector`/`closeInspector`/`clearSelection`
  (Escape is two-stage: closes the panel first if open, only clears the
  selection on a second press once it's already closed), L/`/` →
  `toggleHudPanel('layers' | 'search')`.

**Why WASDQE camera nudging lives in `scene/CameraControls.tsx`'s hook tree
but the keyboard listener itself lives in `InputManager.tsx`, outside the
Canvas:** `useCameraController` needs the `OrbitControls` ref, which only
exists inside the Canvas; `useKeyboardController`/`useEntityNavigation`
need `useCountryFeatures()`/`useGeoEntityFeatures()`/`useSelection()`,
which work identically on either side of that boundary. Rather than thread
a ref across the boundary, `KeyboardController.ts`'s `Set` of held keys is
the bridge — written to from the (outside-Canvas) listener, read from
inside the Canvas every frame — the same "plain module-level value crosses
the boundary, nothing reactive has to" pattern `globeRotation.ts` already
established for the opposite direction (scene → HUD).

`hud/SettingsPanel.tsx`'s "KEYBOARD SHORTCUTS" section is a hand-written
mirror of `KeyboardController.ts`'s key maps, not generated from them — the
binding table is small and fixed, not data worth wiring through a store.
Keep the two in sync by hand if a binding changes.

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
  zustand-backed pub/sub pattern as every other store in this repo
  (`selectionStore.ts` etc., v4.4.0) — see the "Two-layer split" section
  above for why.
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
2. Add one import line for that module to `placeholders/index.ts` for an
   architecture-validating placeholder, or to `geoOverlays/index.ts` (v3.0.0
   — the first real, non-placeholder layer set; see `ParentOverlayLayer.tsx`/
   `ClaimsOverlayLayer.tsx` for the pattern) for a production layer. Both
   barrels are imported side-effect-only from `LayerEngine.tsx` — that's the
   composition point CLAUDE.md used to describe as "doesn't exist yet."
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

**A layer's control surface doesn't have to be `LayerPanel.tsx` (v6.2.0).**
`layers/geoOverlays/AllianceHighlightLayer.tsx` (highlights the member
countries of whichever alliance is currently picked from an
`hud/AllianceBadge.tsx` pill — see `data/allianceMemberships.ts`) registers
exactly like any other layer, but its own on/off state is driven by
`hud/allianceHighlightStore.ts`, not a `LayerPanel` toggle row a user finds
by browsing categories. The pill-browsing UI for it, `hud/AlliancesPanel.tsx`,
opens from its own `SideRail.tsx` tab (`sideNavItems.ts`'s `SIDE_NAV_ITEMS`,
undocumented elsewhere in this file — a left-docked, collapsible tab strip,
parallel to `LayerPanel.tsx`/`SettingsPanel.tsx`, that filters `LayerPanel`
by Layer Engine category) via a new optional `SideNavItem.panel` field
naming which `HudPanel` that tab opens — every item before this one omits it
and defaults to `'layers'`; ALLIANCES is the first to set it to `'alliances'`
instead, since "browse and click a pill" doesn't fit `LayerPanel`'s
one-row-per-toggle layout. `SideRail.tsx`'s click handler reads this field
generically rather than hardcoding `'layers'`, so a future tab can open its
own dedicated panel the same way without another rewrite of that handler.

**`layers/layerPresetsStore.ts` + `hud/LayerPresetsPanel.tsx` (v6.5.0)** — direct request: a user who's already
arranged a combination of layers they like shouldn't have to re-toggle each one by hand next time they want
it. A preset is a named snapshot (`{id, name, layers: Record<layerId, boolean>, createdAt}`) of
`layerStore.ts`'s enabled map at save time, captured via `getLayerDefinitions()` + `isLayerEnabled()` and
restored via `setLayerEnabled()` (both pre-existing exports — this needed no changes to `layerStore.ts`
itself). `applyLayerPreset()` only touches layer ids that are both in the saved snapshot AND still
registered today: a layer removed from the app since the preset was saved has nothing left to restore, and a
layer registered *since* the preset was saved isn't mentioned in the snapshot at all, so applying an old
preset never silently forces an unrelated layer off. Presets persist to `localStorage`
(`atlas.layerPresets`) — this codebase's first use of it. Every other piece of UI state
(`hud/settingsStore.ts`'s camera sensitivity, `layerStore.ts`'s own live enabled map) resets to defaults on
reload; a saved preset is the deliberate exception, since "store" is the whole point of the feature.

This reassigns, rather than reuses, `hud/TopNav.tsx`'s Layers icon button: before v6.5.0 it toggled the same
`'layers'` `HudPanel` (`hud/LayerPanel.tsx`'s per-layer toggle list) that every `SideRail.tsx` category row
also opens. As of v6.5.0 it opens a new, distinct `'layerPresets'` `HudPanel` (`hud/LayerPresetsPanel.tsx`)
instead — save-current-config / apply / delete, not another toggle list — while every `SideRail.tsx` row is
unchanged and still opens `'layers'`. The two panels share the exact same fixed-position dock
(`top-[72px] left-[168px]`) every other `HudPanel`-driven panel uses, and are mutually exclusive the same way
(only one `HudPanel` open at a time) — a user can still get to individual per-layer toggles from the sidebar
at any time; this panel only adds a way to snapshot/restore the whole map at once, it doesn't replace the
toggle list.

**v6.5.1** replaced the panel header's preset-count badge with a ✕ close button (`closeHudPanel()`, styled
like `IntelligencePanel.tsx`'s own) — every other panel this size has no way to close itself short of
re-clicking the toolbar icon that opened it; direct request. **v6.5.2** replaced `hud/TopNav.tsx`'s top-bar
LAYERS tab (the tab-strip one, `navStore.ts`'s `TopNavTab` — a different, unrelated `'layers'` string from
`HudPanel`'s) with NEWS, still inert like INTELLIGENCE/DATABASE — direct request, since `SideRail.tsx` already
owns real layer selection, leaving that tab-strip destination pure duplication.

### LOD Engine (`src/lod/`, v4.3)

A registry + store for the camera-distance ladder any zoom-gated content
reveals against, architecturally parallel to the Layer Engine above but
solving a different problem: the Layer Engine is about *what's toggleable*,
the LOD Engine is about *what distance unlocks it*. Added once
`scene/UsCityLabels.tsx`'s population/zoom-tier gate (a private
`REVEAL_TIERS` distance table nothing else could see or reuse) needed
generalizing ahead of future zoom-gated datasets (rivers, roads, ...) that
would otherwise each invent their own disconnected threshold.

**Pieces, and why they're separate:**

- `types.ts` — `LodLevelId`, a union naming the *entire* intended zoom
  progression up front: `'earth' | 'countries' | 'states' | 'metro-areas' |
  'large-cities' | 'medium-cities' | 'small-cities' |
  'every-incorporated-city'` (all implemented) plus `'roads' | 'rail' |
  'rivers' | 'airports' | 'ports' | 'military-bases' | 'infrastructure'`
  (reserved, `implemented: false`, no geometry/store/camera work behind
  them yet). Reserving the ids now — before any of those datasets exist —
  is what lets a future dataset plug in without a second camera/LOD
  redesign: it only ever needs a real `revealDistance` and
  `implemented: true` in `lodLevels.ts`, never a new id or a new resolver.
- `lodLevels.ts` — the ordered `LOD_LEVELS` array plus three pure functions:
  `resolveActiveLevels(distance)` (every implemented level currently
  active), `resolveDeepestLevel(distance)` (the single most-detailed active
  level — what a HUD readout means by "current zoom"), and
  `isLodLevelActive(id, distance)`. A level is active whenever `distance <=
  level.revealDistance` (or always, if `revealDistance` is `null`),
  checked **independently per level**, not via a descending first-match-
  wins scan — that's what makes the ladder cumulative (unlocking
  small-cities doesn't hide metro-areas) without needing a separate upper-
  bound guard the way an earlier, scan-based version needed
  `NO_CITIES_ABOVE_DISTANCE` purely to stop its first threshold from
  matching from very far away.
- `lodStore.ts` — a zustand store (v4.4.0) holding `{ distance, level }`,
  for consumers *without* their own per-frame camera access (a HUD panel, a
  future layer mounted outside the component that already computes
  distance). Fed by one added line in `scene/TelemetryProbe.tsx`
  (`publishLodDistance(spherical.current.radius)`) — it already computes
  camera distance every frame for the orbit telemetry HUD, so this is one
  more publish target, not a second `useFrame` subscriber duplicating that
  work. `useLodLevel()` selects only the `level` field
  (`useLodStore((state) => state.level)`), so a component re-renders on an
  actual LOD-tier change, not on every frame's `distance` update — the same
  "only rerender when the id changes, not the raw distance" behavior the
  pre-zustand version got from a manual reference-equality check.
  `getLodDistance()`/`getCurrentLodLevel()` remain plain imperative reads
  off `useLodStore.getState()` for non-React or per-frame consumers. A
  component that already has `camera` via `useThree()` every frame
  (`UsCityLabels.tsx`) should call `lodLevels.ts`'s pure functions directly
  with its own locally-computed distance instead of round-tripping through
  this store.
- `index.ts` — the barrel. Import from here, not individual files — same
  discipline as `data/index.ts`/`layers/index.ts` elsewhere in this repo.

**What deliberately does NOT live here:** population thresholds, label
styling, and spacing radii are all cities-specific concepts that stay in
`scene/UsCityLabels.tsx` (`CITY_POPULATION_FLOOR`, keyed by `LodLevelId`)
rather than being generalized into the LOD Engine itself — the engine only
ever answers "is this zoom stage active," never anything about what a
consumer does once it is. Keeping that boundary is what lets a future Roads
layer, say, check `isLodLevelActive('roads', distance)` without the LOD
Engine needing to know or care that "roads" has nothing like a population
score.

**How to add a future zoom-gated dataset:** give its reserved `LodLevelId`
a real `revealDistance` and flip `implemented` to `true` in
`lodLevels.ts`, then have the new layer/component check
`isLodLevelActive(id, distance)` (or `resolveDeepestLevel`, if it needs to
know the single deepest active tier). Never touch `scene/constants.ts`'s
camera bounds for this — see that file's own comment for why going tighter
than the current `CAMERA_MIN_DISTANCE` is a rendering-engine concern
(country/state fill-border-atmosphere shell separation), not something the
LOD Engine's distance thresholds should ever need to force by themselves.

### Geopolitical data architecture (`src/data/`)

Schema + query-layer foundation for future layers (v2.1 added the schema,
v2.1.1 added the registry below). Deliberately separate from two things
that already exist and might look similar at a glance:

- `scene/countryGeometry.ts` — that's border/fill *geometry*, this is
  attribute *facts* (population, claimants, participants, ...).
- `data/countryProfiles.ts` — that's already-shipped, presentation-formatted
  data for the IntelligencePanel (government type, capital name/coordinates,
  factbook snapshot metadata). The `Country` type stores facts as plain,
  unformatted values instead, because it's meant to be computed on (sorted,
  filtered, thresholded) by future layers — formatting is a presentation
  concern downstream of this.

**As of `scripts/buildGovCapitalPopGdp.mjs` (2026-08-13), `population` and
`gdpUsd` (+ their `populationYear`/`gdpYear` companions) *are* auto-merged
into the `Country` registry** — `useCountryFeatures.ts` reads them off
`data/countryEconomics.ts` (build-script output, World Bank-sourced) and
registers them alongside each country's id/name. This is a narrow,
deliberate exception to "the two datasets are not merged," not a reversal
of it — see the reasoning below for why these two fields specifically were
judged safe and the rest weren't. `IntelligencePanel.tsx` reads the raw
numbers off `Country` and formats them at render time via
`utils/formatScale.ts` (`formatPopulation`/`formatGdp` — the one place
unit-scale logic lives), rather than reading a pre-formatted string; see
`LOGBOOK.md`'s 2026-08-13 entry for why storing formatted strings at build
time was rejected (a threshold-crossing correction, e.g. millions ->
billions, would silently require a full rebuild instead of a one-line
formatter change).

**What stays manual-only, and why:** `government`/`governmentNote`
(distinguishing a stable "Presidential Republic" from a transitional/
contested government string — Chad, Gabon, Sudan, Libya, Yemen, Afghanistan,
etc. — is a judgment call, not something a source API states cleanly) and
`capital`/`capitalLat`/`capitalLng` (a handful of countries have genuine
multi-capital ambiguity — South Africa, Bolivia, ... — resolved by hand,
logged in `BACKLOG.md` rather than guessed) all stay in
`countryProfiles.ts`, hand-curated, never auto-merged. `population`/`gdpUsd`
were judged safe to auto-merge specifically because the source
(World Bank API, date-range queried) is unambiguous per country, every gap
is logged explicitly to `BACKLOG.md` rather than silently left blank or
backfilled, and merging can't overwrite a hand-curated field — it only
populates `Country`-only fields `countryProfiles.ts` never had in the first
place. A future field being considered for the same treatment should meet
that same bar: unambiguous source, gaps logged not guessed, no collision
with a field that already requires human judgment.

**Intelligence Engine scoring data (v6.3.0, `src/data/militaryScores.ts`) is a separate, NOT-yet-merged
dataset** — don't confuse it with the `Country`/`countryProfiles.ts` auto-merge above.
`scripts/buildMilitary.mjs` (`npm run build:military`) generates real, sourced Military scores for all 193
countries (SIPRI expenditure/industrial-base xlsx, World Bank WDI, CIA Factbook, FAS Nuclear Notebook, and a
reverse-engineered SIPRI arms-transfers endpoint — see that script's own header comment for the full sourcing
trail). The full scoring design — locked components, zero-classification (true-zero vs. coverage-gap), the
log-min-max normalization, the coverage-floor/confidence tiers, and two documented mid-flight revisions
(arms-import dependency demoted to a non-scoring annotation; expenditure double-weighted as an explicit,
on-the-record exception to this doc's own "weights need citable backing" discipline) — lives in
`Intelligence Docs/intelligence-engine-scoring-design.md`, not duplicated here. `BACKLOG.md` tracks per-field
sourcing gaps (regenerated by the build script itself) and the standing deviations from the original
7-component design (air fleet backlogged — paywalled source, no free equivalent).

**v6.3.1/v6.3.2 wired this data into `hud/IntelligencePanel.tsx`'s MILITARY status bar** — the first of the
five status bars (Military/Economy/Diplomacy/Technology/Current Status) to move off placeholder chrome, per
the design doc's launch scope (§8: "ship Military and Economy first"). **Economy joined it in v6.6.0** (see
below); **Current Status joined in v6.7.0, but not as a bar** — see its own section further down for why it
gets a `ConflictChip`/`SanctionBadge` treatment instead of an `IntelRow`. **Technology joined in v6.8.0** (see
its own section further down) — the fourth of the five to move off placeholder chrome. Only Diplomacy remains
"Awaiting data feed" — its sourcing/weighting isn't locked yet (design doc §9). `IntelRow`'s bar fill is a single
solid color, not a gradient, computed once per row by
`intelValueColor(value)` (interpolating red at 0 → amber at 50 → green at 100) and applied identically to
the numeric value text beside it, so a country's number and its bar always read as the same color.
`MILITARY_SCORES` is looked up by `Country.id` (the same numeric ISO topology id both this file and
`countryEconomics.ts` key on — see that file's own comment) and only for `'country'` selections; no
GeoEntity has a military score, so a GeoEntity selection falls through to the same empty state the other
four metrics already render. A confirmed no-standing-military country (`MilitaryScore.confirmed`) renders
`N/A` rather than a scored `0.0` — the composite is genuinely inapplicable there, not merely unmeasured, so
it doesn't share the ordinary "no data" em-dash either.

**Citation drill-down (v6.3.2, design doc §7 "status bars are clickable"):** the MILITARY row is a `<button>`
whenever a `MilitaryScore` record exists for the selection (effectively always, for a country) — clicking it
collapses the other four rows out of the panel and drops down all 5 scored components (expenditure, % of
GDP, personnel, nuclear warheads, defense-industrial base revenue), each with a friendly source name linking
to its real citation URL, its formatted value, and its snapshot year/date; a component with no data for that
country still gets a row, showing "—", rather than being silently omitted. The sourced-but-not-scored
arms-import (TIV) annotation renders last, visually subordinate and labeled "not scored." Clicking the row
again (or selecting a different entity — the drill-down resets on `selected.id` change) collapses back to
the normal 5-row view. **ECONOMY got the identical treatment in v6.6.0** (`EconomyDrilldown`, its own 5
components — see below) — the two categories' drill-downs share `IntelligencePanel.tsx`'s `sourceLabel()`
helper (renamed from the Military-only `militarySourceLabel()` it started as, once Economy needed the exact
same "World Bank (WDI)" branch that function already had) and the same `<button>`/collapse mechanics, just
different row data. **TECHNOLOGY got the identical treatment in v6.8.0** (`TechnologyDrilldown`, its own 4
components — see below), reusing the same `sourceLabel()` helper again (extended with an `itu.int` branch).
Diplomacy still has no component data to drill into; Current Status never used this mechanism at all — its
`ConflictChip`/`SanctionBadge` treatment (above) is a different, lighter interaction, not a missing drill-down.

**`hud/AnalyticsPanel.tsx` (v6.4.0)** is the first thing mounted from `hud/TopNav.tsx`'s previously-inert
ANALYTICS tab (`navStore.ts`'s `TopNavTab` already reserved the id; `TABS` in `TopNav.tsx` just needed
`wired: true`) — a full-screen dashboard, not another docked `LayerPanel`/`AlliancesPanel`-style rail panel,
specifically so a 193-row ranked list has room to read. It shows one clickable thumbnail per
`hud/intelMetrics.ts` metric (the same five ids/labels/icons `IntelligencePanel.tsx`'s status bars use —
pulled into that shared module, along with `utils/intelValueColor.ts`'s red→amber→green interpolation, so the
two surfaces can't drift apart on what a score's color or a metric's icon means); clicking MILITARY's — at
launch, the only one with real per-country data behind it — drills into every registered country ranked by
`MILITARY_SCORES`, sorted by the score's real underlying value (not the displayed one, so a confirmed
no-standing-military country's real, sourced 0 still ranks correctly below every actually-measured country,
while an `'unavailable'`-confidence country's `null` value sorts last of all). ECONOMY joined it in v6.6.0
(see below), TECHNOLOGY in v6.8.0 (see below). The remaining thumbnails (Diplomacy; Current Status until
v6.7.2, see its own section) render the identical "Awaiting data feed — no assessment data currently sourced"
copy `IntelligencePanel.tsx`
already uses for those metrics — same "don't fabricate a ranking with nothing sourced behind it" discipline,
not a separate decision. Clicking a ranked-list row calls the same `selectEntity()` a map click or search
result does (`IntelligencePanel.tsx` slides open on top of this view, at its own higher z-index) but
deliberately does **not** call `flyToSelectedCountry()` — the globe is hidden behind this full-screen overlay
while it's open, so a flight nobody can see would be pointless; `direction` is still computed correctly (same
centroid-through-current-rotation technique `SearchBar.tsx`'s `selectEntry` uses) so `FOCUS CAMERA` in the
now-open `IntelligencePanel` still works once the user switches back to the MAP tab. The ranked list stays
open across a row click — confirmed as the preferred behavior over auto-closing back to the map, so a user
can click through several countries' summaries without re-navigating the ranking each time.

**v6.5.3: the MILITARY ranked list shows all 5 scored components as columns, not just the composite bar** —
direct request. `RankedRow` carries the selected country's `MilitaryScore.components` straight through
(`buildMilitaryRows` — see below), and each row renders EXPENDITURE / % GDP / PERSONNEL / NUCLEAR / DEF.
INDUSTRY alongside the existing SCORE bar, reusing the exact same `formatGdp`/`formatPopulation` formatting
`IntelligencePanel.tsx`'s `MilitaryDrilldown` already uses for these same fields — a genuine coverage gap
(`raw === null`) renders "—", never a fabricated value. Chose columns over an expand-per-row accordion (the
pattern `MilitaryDrilldown` itself uses) specifically because a row here is already a click target for
selecting the country — stacking a second, different click meaning onto the same row would be ambiguous,
where a column is always visible and needs no extra interaction. The 5 metric columns are `xl:`-only
(`hidden ... xl:block`) with a matching header row directly above the list using the identical column
widths/gaps so the two never drift apart; below that breakpoint only rank/name/score show. The drill-down
view's own container widened from `max-w-3xl` to `max-w-6xl` to fit.

**v6.5.4: every column header in that same ranked list is click-to-sort** — direct request. `buildMilitaryRows`
(renamed from `buildMilitaryRanking`) returns the 193 rows unsorted; `AnalyticsPanel`'s own sort state
(`{ key, direction }`, reset to the `SCORE`/descending default whenever the active metric changes) picks
which case a comparator actually orders them by, recomputed fresh each render the same not-memoized way the
rest of this row-building already is. Clicking the already-active header flips `asc`/`desc`; clicking a
different one switches to it (descending for a metric — reads as "biggest first" on first click — ascending
for COUNTRY, i.e. A→Z first). Re-sorting only ever reorders `RankedListRow`s — no row's `value`/`components`
are touched by which column is driving the order, so a country's SCORE (or any other cell) never changes
just because a different column is now sorted. A coverage gap on a metric column (`raw === null`) sorts last
**regardless of direction** — otherwise ascending would turn "no data" into "the best" value — while the
SCORE column itself has no such branch, since `scoreSortValue` already has no `null` case (an
`'unavailable'`-confidence country resolves to `-1`, same as the original v6.4.0 ranking). Every tie (most
visibly, the long run of countries at `nuclearWarheads: 0`) breaks alphabetically for a stable, predictable
order. `SortableHeader` carries no `display` utility of its own in its base classes — see `LOGBOOK.md`'s
v6.5.4 entry for the `hidden`+unconditional-`flex` conflict that would have caused if it had.

**v6.6.0: Economy joined Military as a second real, sourced Intelligence Engine category** —
`scripts/buildEconomy.mjs` (`npm run build:economy`, per `Intelligence Docs/buildEconomy-prompt.md`
implementing the design doc's §3.2) generates `src/data/economyScores.ts`: 5 World Bank WDI components (GDP —
nominal as of 2026-08-22, was PPP through v6.6.2, see below — GDP per capita PPP, 5yr-trailing real GDP
growth, unemployment, inflation — the last two inverted, lower is better; originally equal-weighted, GDP
double-weighted as of v6.6.2 — see below), **percentile-rank
normalized** (average/fractional rank for ties — stopped
and asked the user before writing this, per the build prompt's own "stop and ask before picking a
tie-breaking convention" instruction — see `LOGBOOK.md`), a **deliberate divergence** from Military's
log-min-max, not an inconsistency (GDP's outlier skew is exactly the problem percentile rank was originally
adopted project-wide to solve — design doc §4). `EconomyScore` extends the design doc's illustrative flat
`CategoryScore` the same way `MilitaryScore` already does — a real per-component `raw`/`normalized`/`year`/
`sourceUrl` breakdown instead of a bare `sources: string[]` — needed for the identical citation drill-down
(design doc §7) every category is meant to eventually get, not just Military.

**v6.6.1: added a coverage floor** — launched on the design doc's plain weighted-sourceCoverage model with no
floor at all (any 1 of 5 components present still produced a value), which real output broke: Monaco and
Liechtenstein (1 of 5 present — just GDP growth) outranked fully-measured economies because a single
percentile stood in for the whole composite with nothing to average against. Now needs >= 3 of 5 present to
score at all (`>= 0.8` measured / `=== 3` (as a component count) proxy / `<= 2` unavailable — `value` stays
`null` below the floor rather than being computed then withheld) — this borrows Military's "you need a floor"
idea, applied to Economy's own shape, not Military's actual coverage-floor MECHANISM (which also changes
true-zero-vs-coverage-gap handling Economy doesn't have). Caught before shipping: the patch spec described the
tiers as literal float comparisons (`sourceCoverage === 0.6` for the proxy case), but `3 * 0.2 === 0.6` is
`false` in JavaScript floating point — implemented against the integer `coveragePresent` count instead
(`=== 3`, exact) rather than the literal float form. See `LOGBOOK.md`'s v6.6.1 entry.

**v6.6.2: GDP (PPP) double-weighted** — mirrors `buildMilitary.mjs`'s existing expenditure double-weight, for
the matching reason. Real output showed large, mature economies (the US specifically) landing well below
smaller, faster-growing ones despite GDP/GDP-per-capita being near-maxed: not a data bug, a structural one —
the same absolute dollar increase is mechanically a much smaller percentage of a $29T base than a $50B one,
so equal-weighting "size" against "growth rate" always penalizes size. `finalizeCountry` now averages over a
separate `weightedNormalized` list (`gdpPpp`'s percentile counted twice) rather than `presentNormalized`
directly, while `coveragePresent` — what the v6.6.1 coverage floor and confidence tiering actually key off —
stays computed from the original, undoubled list; the two lists deliberately serve different jobs, so a
double-counted `gdpPpp` never lets a country cross the coverage floor on a technicality. If `gdpPpp` itself is
a country's missing component, both copies are filtered out of the average — never a partial/half-weight,
identical to Military's own "neither copy counts" rule. Verified by hand against `debug/
economy-component-breakdown.json` before trusting the full rebuild (recomputed the US's composite from its 5
stored percentiles with `gdpPpp` doubled — matched exactly) and confirmed live in the Analytics ECONOMY
ranking: China 80.4 → 83.6 (now #1), US 73.2 → 77.6 (was outside the top 10, now #7).

**2026-08-22: the "GDP size" component switched from PPP-adjusted to NOMINAL GDP** (direct request; field
renamed `gdpPpp` → `gdpNominal` throughout `buildEconomy.mjs`, `economyScores.ts`, and both UI consumers) —
`GDP_NOMINAL_INDICATOR` is now World Bank's `NY.GDP.MKTP.CD`, was `NY.GDP.MKTP.PP.CD`. GDP per capita stays
PPP-adjusted, unaffected — only the aggregate "how big is this economy" metric changed. The double-weighting
from v6.6.2 carried over unchanged, just applied to the new metric. This same change also **fully removed**
the standalone IMF WEO trial (`scripts/buildEconomyWeo.mjs`, `hud/useEconomyScoresWeo.ts`, and the WDI/IMF WEO
toggle UI in both `AnalyticsPanel.tsx` and `IntelligencePanel.tsx`, all added 2026-08-22 and reverted the same
day once the trial's actual purpose — resolved — was to source Taiwan, not to re-source the whole category)
— Economy is 100% World Bank WDI again, with one narrow, permanent exception:

**Taiwan (2026-08-22, direct request, kept from the otherwise-removed trial)** — WDI structurally excludes
Taiwan (see `scripts/buildGeoEntityEconomics.mjs`'s identical reasoning for the same country), so
`buildEconomy.mjs` sources all 5 of Taiwan's components from IMF WEO as a one-off `buildTaiwanScore()`,
appended to `built` before the percentile ranking runs (so Taiwan's real values participate in the same
193-vs-1 ranking pool, not a segregated one) — the ONLY IMF/WEO dependency left in this script. Resolved to
the same "most recent ACTUAL year only" standard the WDI components already meet by construction (WDI has no
forward projections; a WEO series does, so those are explicitly filtered out via the same
`COUNTRY_UPDATE_DATE`-derived vintage-year technique the removed trial used — see `LOGBOOK.md`'s 2026-08-22
entry for the full trail, including a real unit-conversion bug caught along the way: IMF's `NGDPD` indicator
is commonly documented as reporting GDP in billions, but the live API's raw observation values are already in
whole current US$ — Taiwan's 2024 figure came back as `801495464000`, not `801.495464`; an initial `× 1e9`
conversion produced a $801-sextillion GDP before being caught and removed). Taiwan is keyed by its GeoEntity
registry id (`'taiwan'`) rather than a numeric ISO topology id — the one exception to this file's "keyed by
numeric id" convention, called out in both the file header and the `ECONOMY_SCORES` type comment. No UI
wiring was added for GeoEntity Economy selection — Taiwan's score exists in the generated data (and factors
into every other country's percentile ranking) but isn't yet surfaced anywhere a GeoEntity selection is made,
the same pre-existing "no score for GeoEntities" gap Military already has.

**2026-08-22: inflation switched from inverted-percentile to DISTANCE FROM A 2% TARGET** — `INFLATION_TARGET_PCT
= 2.0` (Federal Reserve and Bank of England both state 2% as their explicit longer-run target). Fixed a real
misrepresentation the old "lower is always better" method had: inflation near 0% (or negative, i.e.
deflation) used to score as excellent, when deflation is its own economic hazard. **Superseded four days later
by the gaussian method below** — this percentile-of-distance version, and the diff-preservation scaffolding
built to review it (`rankInflationOld`, `_diffOnly`, `writeInflationScoringDiff()`), no longer exist in the
script. See `LOGBOOK.md`'s 2026-08-22 and 2026-08-26 entries for the full history of both changes.

**2026-08-26: GDP (size) → log-min-max; inflation → gaussian around 2%, no percentile step** — two independent
patches, requested together. Growth and unemployment unaffected by either.

GDP (nominal): switched from percentile rank to log-min-max (`buildLogMinMaxNormalizer`, identical
epsilon/min/max derivation to `buildMilitary.mjs`'s own log-min-max normalizer). GDP per capita stays
percentile rank — log-min-max only makes sense where raw magnitude itself carries weight (aggregate economic
size/power), not for a per-capita prosperity comparison. Real motivation: China's GDP percentile was 100.00
against the US's 99.47 under the old method — a gap that barely registered even with GDP double-weighted,
despite the real ~$10.6T dollar difference. Post-patch: US 100.00, China 96.60 on the same component — real
and directionally correct, though log compression keeps it from being a huge gap. GDP stays double-weighted
in the composite, unchanged.

Inflation: switched again, this time to a gaussian centered on the same 2% target —
`score = 100 * exp(-((inflation - 2.0)^2) / (2 * 1.0^2))`, used directly, no percentile step at all. σ = 1.0pp
is a fixed, real policy threshold (the Bank of England's own tolerance band — a governor's open letter is
required if CPI moves more than 1pp from target), deliberately NOT derived from the sample's own spread,
which would get distorted by hyperinflation outliers. Verified by hand against real output: Taiwan's
2.180626% → 98.38, the US's 2.94953% → 63.71, both matching the script's own computed values exactly.

Both changes are normalization-only — missing raw values still produce a null score for the coverage floor in
both cases, and confidence tiers were unaffected by either change. Real before/after on the US-vs-China case
the GDP rationale was built around: under the last committed version (PPP GDP percentile + distance-percentile
inflation) the US scored 77.6 and China 83.6; under this patch, US 79.5 and China 69.7 — the US now clearly
leads, driven by both the GDP log-min-max widening and China's near-zero inflation (0.22%) scoring poorly
under the gaussian (20.4) against the US's near-target 2.95% (63.7). See `LOGBOOK.md`'s 2026-08-26 entry for
the full diff, including the dataset-wide movers.

Wiring it into `IntelligencePanel.tsx`/`AnalyticsPanel.tsx` was a separate step from the build script itself
(the build prompt's own explicit scope boundary: "rendering is a separate task"), and is what actually
justified generalizing `AnalyticsPanel.tsx`'s ranked-list machinery rather than pasting a second near-copy of
the Military version next to it: `BaseRankedRow`/`AnalyticsColumn<TRow>`/`compareRows`/`SortableHeader`/
`ColumnHeaderRow`/`RankedListRow` are now generic over any category's row shape, and `MILITARY_COLUMNS`/
`ECONOMY_COLUMNS` are the only genuinely category-specific pieces left (each category still gets its own
`buildXRows` function, since the underlying `MilitaryScore`/`EconomyScore` component shapes are real,
different types — nothing about extracting the shared machinery erased that). `IntelligencePanel.tsx`
similarly generalized in smaller ways: `militarySourceLabel()` → `sourceLabel()` (Economy needed the exact
same "World Bank (WDI)" URL-matching branch that function already had), `IntelRow`'s `confidence` prop
widened from the Military-only `MilitaryConfidence` type to a local `ScoreConfidence` union both
`MilitaryConfidence`/`EconomyConfidence` already structurally are, and the footer caption under
INTELLIGENCE SUMMARY now composes a sentence from however many of Military/Economy are actually resolved for
the current selection (`sourcedParts`/`unsourcedLabels`) rather than a Military-only hardcoded string.
`utils/formatScale.ts` gained `formatGdpPerCapita` (World Bank's GDP indicators are already in whole current-
international dollars, not millions like SIPRI's Top-100 arms revenue — see `buildEconomy.mjs`'s own
comment — but a per-capita figure is too small for `formatGdp`'s Million/Billion/Trillion tiers, which assume
an aggregate country-level GDP the way `formatArea` already flags for a different reason).

**2026-08-26: Current Status (`src/data/currentStatus.ts`, `scripts/buildCurrentStatus.mjs`) is the third
Intelligence Engine category with real, sourced data, wired into `hud/IntelligencePanel.tsx`.** Unlike
Military/Economy, it was never intended to converge on a 0-100 composite: it's two independent, categorical
fields per country, `conflicts: ConflictEntry[]` (a real UCDP-sourced conflict record per entry —
`conflictType`, an optional `conflictName`, `snapshotDate`, and `source`) and `sanctionTier: 'red' | 'orange' |
'yellow' | null` (+ `sanctionPrograms`), per the locked design in `Intelligence Docs/intelligence-engine-
scoring-design.md` §3.5. `conflictType` comes from the annual UCDP/PRIO Armed Conflict Dataset's own
classification where available, falling back to `'unclassified'` for a conflict the monthly UCDP Candidate
Events Dataset has caught in the current year but no annual release has typed yet — no manual override path,
that's the honest state until UCDP itself classifies it. Countries are matched to conflicts primarily by
UCDP's own Gleditsch-Ward numeric country codes (`scripts/lib/gleditschWard.mjs` bridges these to this
project's UN-193 topology names), not by name-string matching — **with one deliberate exception, added
2026-08-26: `buildCurrentStatus.mjs` also resolves each Candidate/GED row's named `side_a`/`side_b`
governments by name and attaches the conflict to those countries too, not just to `country_id` (the event's
LOCATION, which is all UCDP's own GW-coded field gives for Candidate/GED — unlike the ACD's `gwno_loc`, which
already lists every named side's territory).** See that script's own header comment and `LOGBOOK.md`'s
2026-08-26 entry for the real case (the US absent from its own "Iran vs. Israel, United States of America"
Candidate detection, since no event in that dataset was geolocated on US soil) this was caught against.
`sanctionTier` is a small hand-maintained seed, **revised
2026-08-24 from a single `sanctioned: boolean` to three OFAC tiers** — RED (comprehensive embargo: Cuba, Iran,
North Korea, Syria — fully verified against each program's own OFAC regulatory text), ORANGE (sectoral/hybrid:
Russia, Belarus, Venezuela, Myanmar, Sudan, Nicaragua), YELLOW (list-based only, SDN/Consolidated List
screening: Afghanistan, Central African Republic, DR Congo, Ethiopia, Iraq, Lebanon, Libya, Mali, Somalia,
South Sudan, Yemen) — `null` means no active OFAC country program. Only RED is fully verified per-program;
ORANGE/YELLOW are secondary-source seeds flagged in `BACKLOG.md` for per-program verification before this ships
as more than portfolio-demo-confidence data. Not a live pull either way — see `LOGBOOK.md`'s 2026-08-26 entry
for why, and `BACKLOG.md` for it as a standing live-pull candidate if that ever needs to change. Every country
gets an explicit `conflicts: []`/`sanctionTier: null` when neither applies — absence is a real, positive fact
here, not a missing-data state, so it's never omitted the way an unscored Military/Economy component is.
Rendering: `ConflictChip` (one per entry, colored/labeled by `conflictType`, citation in a tooltip) and
`SanctionBadge` (a compact "S" mark colored by tier, program name(s) in its tooltip, hidden when `sanctionTier`
is `null`) — deliberately not `IntelRow`'s bar treatment, since neither field is a magnitude.
`Intelligence Docs/current-status/` is where a real sanction logo is expected to land and replace the
placeholder S badge. **`AnalyticsPanel.tsx` wiring landed later (below), once `IntelligencePanel.tsx`'s own
Current Status treatment had stabilized.**

**`SanctionBadge` is clickable (direct request), opening `hud/SanctionTierMenu.tsx`** — a popover, global
across all 193 countries rather than scoped to the selected country's own tier ("what if someone wants to see
all sanctions"), listing all three tiers with every country in each as a clickable chip. Each tier also gets
its own small "S" icon, clicking which toggles `hud/sanctionHighlightStore.ts`'s `highlightedTier` (one tier
at a time, same "not a Set" reasoning `allianceHighlightStore.ts` already documents) — read by
`layers/geoOverlays/SanctionHighlightLayer.tsx`, which mirrors `AllianceHighlightLayer.tsx` exactly except it
needs no name/ISO3 join (`data/currentStatus.ts` is already keyed by the same numeric topology id
`buildCountryEntries()` returns) and needs a *different* color per tier instead of one shared category-
highlight color — `layers/geoOverlays/CategoryHighlightLayer.tsx`'s `CategoryHighlightGeometry` gained an
optional `color` prop for this (defaults to the existing shared violet, so every other caller is unchanged).
Clicking a country chip resolves + selects + flies the camera to it (same centroid-through-current-rotation
technique `SearchBar.tsx`'s `selectEntry()` uses, since there's no click point on the globe to derive a
direction from here) and closes the menu. The menu itself closes on an outside click (a `pointerdown` listener
scoped to the badge+menu's own wrapping ref, so the badge's own click keeps sole control of its own toggle —
not a race with the outside-click handler) or Escape.
`scene/sanctionTierColors.ts` is the single source for the three tier colors (+ plain-English label) —
deliberately NOT added to `scene/highlightColors.ts`'s closed 7-hue ROYGBIV set (see that file's own header
comment); read by `SanctionBadge`/`SanctionTierMenu`, `SanctionHighlightLayer`, and `hud/LegendPanel.tsx`
(which adds a legend row for whichever tier is currently highlighted, built fresh per-tier rather than reused
from the fixed `HIGHLIGHT_COLORS` set the way every other legend row is).

**Conflict chips got the same "reduce jargon, reduce clutter" pass sanctions did, plus their own
click-to-highlight (direct feedback + follow-up request).** `CONFLICT_TYPE_STYLE`'s labels are now plain
language (interstate → "INTERNATIONAL WAR", internal → "CIVIL WAR", internationalized_internal →
"FOREIGN-BACKED CIVIL WAR", extrasystemic → "COLONIAL CONFLICT", unclassified → "RECENTLY DETECTED") —
display-only; the underlying `ConflictType` values are unchanged. `CurrentStatusRow` no longer shows the chip
row by default: it collapses to a headline ("AT WAR (6)" / "NO ACTIVE CONFLICTS", `isExpanded` local state,
deliberately independent of `expandedMetric` — see that state's own doc comment for why a citation drilldown
and this lighter expand aren't the same mechanism) and only reveals the chips on click, mirroring Military/
Economy's own collapsed-bar-until-clicked shape rather than inventing a new one. `shortenConflictName()`
differentiates same-type chips for one country (Myanmar's 5 "CIVIL WAR" entries used to be identical) by
pulling the other party out of `ConflictEntry.conflictName` (already sourced, previously tooltip-only) —
strips this country's own "Government of X" from a PRIO-shaped name or the leading "Country: " from a
Candidate-shaped one, so a chip reads "CIVIL WAR — KNU." Clicking a chip highlights the resolved party/parties
on the globe: `resolvePartyCountryIds()` reuses the same string-parsing idea one level further, splitting a
PRIO-shaped name into every named side and resolving each piece against the real country list — a non-state
side (a rebel group) never resolves and is skipped (correct: no geometry to highlight), and the viewed
country's own id is the fallback whenever nothing else resolves, so a click never no-ops. New pieces mirror
existing precedent exactly: `hud/conflictPartiesHighlightStore.ts` is `sanctionHighlightStore.ts`'s shape
with an ad hoc id list instead of a fixed tier; `layers/geoOverlays/ConflictPartiesHighlightLayer.tsx` is
`SanctionHighlightLayer.tsx`'s shape; the highlight is colored the same as the clicked chip. See `LOGBOOK.md`'s
2026-08-26 entry for the full reasoning and the real multi-country case this was verified against (the UK's
Yemen conflict entry, whose real `side_a` is "Government of United Kingdom, Government of United States of
America" — clicking it highlights the UK, the US, AND Yemen).

**`AnalyticsPanel.tsx` wiring (v6.7.2) is the last of the four Intelligence Engine surfaces Current Status
needed** — the same "still hardcoded 'Awaiting data feed'" gap Diplomacy/Technology still have (see above),
closed the way the design doc's §3.5 always said it would have to be: a filtered/sortable list, not the
`BaseRankedRow`/`AnalyticsColumn`/`RankedListRow` machinery Military/Economy's ranked lists share, since
Current Status has no single number to put in a SCORE bar. `buildCurrentStatusRows()` maps every registered
country to `{ id, name, conflicts, sanctionTier }` (`CURRENT_STATUS[country.id]`, same numeric-topology-id
keying every other Intelligence Engine dataset uses); three filter tabs (ALL / ACTIVE CONFLICT / SANCTIONED,
with live counts) sit above the list instead of column headers driving what's *shown*, while `SortableHeader`
(already generic over `sortKey`/`activeSort`/`onSort` — it never actually depended on `BaseRankedRow`) still
drives what *order* the filtered rows render in: COUNTRY, CONFLICTS (default sort — the design doc's own "no
single number to rank by" is true of SCORE specifically, not of "how many conflicts," which is a real,
sortable integer), and SANCTION (sorted by tier severity, RED > ORANGE > YELLOW > none — a real ordering of
*how much OFAC restricts a country*, not a magnitude comparison the way Military/Economy's SCORE column is).
Each row shows one colored dot per distinct `conflictType` present plus the total count, and the same
red/orange/yellow "S" badge `IntelligencePanel.tsx` renders — both colored via `scene/conflictTypeStyles.ts`/
`scene/sanctionTierColors.ts` so a color can never drift between the two surfaces. The SANCTION badge is
deliberately **not** clickable the way `IntelligencePanel.tsx`'s `SanctionBadge` is (no `SanctionTierMenu`
popover) — a row here already selects the country on click, so a second, different click meaning on the same
badge would be ambiguous, the same reasoning v6.5.3's Military metric columns being plain cells (not their own
click target) already established. **The CONFLICTS cell is the one exception to that rule, added in v6.7.4 —
see below.** `scene/conflictTypeStyles.ts` is a new small module — `CONFLICT_TYPE_STYLE`
(label + color per `ConflictType`) moved out of `IntelligencePanel.tsx`, which now imports it, specifically so
`AnalyticsPanel.tsx` could use the identical colors without a second hardcoded copy silently drifting from the
first — same "one source of truth" reasoning `scene/sanctionTierColors.ts`/`scene/highlightColors.ts` already
established for their own color sets. With this, four of the five Intelligence Engine metrics have real UI
treatment where real data exists: Military, Economy, and (as of v6.8.0) Technology share the ranked-list/bar/
drill-down machinery, Current Status gets its own filtered-list treatment, and only Diplomacy still renders
the honest "Awaiting data feed" placeholder on both surfaces until its weighting is locked (design doc §9).

**v6.7.4: the CONFLICTS cell became its own click target, deliberately breaking the "a row here already
selects the country on click" rule stated above** — direct request: clicking the conflict counter should
reveal the conflicts themselves, not select the country, while clicking anywhere else on the row (including
the SANCTION cell, unchanged) still selects the country as usual. This is the one CONFLICTS/SANCTION asymmetry
in the row, and it's deliberate — SANCTION stayed a plain cell (see above) precisely because a second click
meaning on the same small badge would be ambiguous, but CONFLICTS is a distinct, clearly-bounded cell with its
own real content (multiple typed entries) worth revealing, which the "ambiguous second meaning" objection
doesn't apply to the same way. Discussed with the user before implementing — two options were on the table:
expand the conflicts inline in the list (chosen) vs. select the country and open `IntelligencePanel` with its
CURRENT STATUS row pre-expanded; inline expand won because it keeps the user's place in a 193-row ranked list
instead of navigating them away from it, matching "not the country" in the request literally. **Mechanically,
this meant the row itself could no longer be a single `<button>`** — a `<button>` can't contain another
interactive `<button>`, and the CONFLICTS cell needed to be one. `CurrentStatusListRow`'s outer element is now
a `<div role="button" tabIndex={0} onClick={onSelect} onKeyDown={...}>` (Enter/Space still selects the country,
matching what a real `<button>` would do) instead, with the CONFLICTS cell's own nested `<button>` calling
`e.stopPropagation()` so its click never also fires the row's `onSelect`. Expanding shows each `ConflictEntry`
as a small pill (type label + name, colored via `CONFLICT_TYPE_STYLE`) — deliberately lighter than
`IntelligencePanel.tsx`'s `ConflictChip`: no per-entry click-to-highlight (the globe isn't visible behind this
full-screen view) and no country-name-aware short label (`shortenConflictName()` stays local to
`IntelligencePanel.tsx` — not worth promoting to a shared module for one caller that doesn't need the globe
interaction the shortening exists to support in the first place). Expand state is local `useState` per row,
not lifted to `AnalyticsPanel` — each row is keyed by `row.id` in the list, so re-sorting the list can't detach
an open row's expansion from the wrong country, and multiple rows can be expanded independently (no
accordion-style "only one open at a time," since nothing about this asked for that).

**2026-08-25/26: Technology (`src/data/technologyScores.ts`, `scripts/buildTechnology.mjs`) is the fourth
real, sourced Intelligence Engine category, wired into both `IntelligencePanel.tsx` and `AnalyticsPanel.tsx`
in v6.8.0.** Per the design doc's §3.3, finalized 2026-08-25 at 4 locked, equal-weighted components after a
5th/6th-component investigation (nine candidates checked, none cleared this project's open-data/coverage/
single-purpose bar — see the design doc's own "Investigated and not included" subsection): R&D expenditure
(% GDP, World Bank WDI `GB.XPD.RSDV.GD.ZS`), patent applications by residents per million population (World
Bank's WIPO-sourced `IP.PAT.RESD` divided by `SP.POP.TOTL`, fetched independently rather than year-matched —
see `patentsPerMillion`'s own comment in the build script), high-tech exports (% of manufactured exports,
World Bank WDI `TX.VAL.TECH.MF.ZS`), and the ITU ICT Development Index. All 4 normalized via percentile rank
(the same average/fractional-tie convention Economy's own percentile-ranked components use) and averaged with
equal weight — no GDP-style outlier skew here the way Economy's own GDP component had, so unlike that one
component, nothing in Technology needed log-min-max. Confidence uses a coverage floor scaled from Economy's
own precedent down to 4 components (need ≥3 of 4 present to score at all: 4/4 `'measured'`, 3/4 `'proxy'`,
≤2/4 `'unavailable'`).

**The ICT Development Index component has no live API to pull from** — `datahub.itu.int` returns a 403 to an
unauthenticated fetch, and ITU's own bulk-data access is effectively "request it," the same closed-data
pattern that ruled out the IMF AI Preparedness Index as a Technology candidate in the design doc's
investigation. `IDI_2024` in `buildTechnology.mjs` is a hand-transcribed snapshot of ITU's own published 2024
edition (2022 reference-year data, the same relaunched-2023 methodology the design doc calls for) — 172
economies, extracted with a deterministic regex parse of the sourced, ISO3-sorted wikitable at
en.wikipedia.org/wiki/ICT_Development_Index (itself citing itu.int/itu-d/reports/statistics/IDI2024/)
rather than eyeballed by hand or summarized through a lossy model pass, to avoid transcription error across
172 rows. This is the same "hand-maintained, cited, real published values, not a live pull" precedent
`buildMilitary.mjs`'s `NUCLEAR_WARHEADS` table (FAS Nuclear Notebook — no API either) and `currentStatus.ts`'s
`sanctionTier` seed already established — re-running the build script refreshes the 3 WDI-sourced components
but does **not** refresh `IDI_2024`; that needs a by-hand update against ITU's next published edition.
India — genuinely absent from ITU's own 2024 table (not a parsing gap; confirmed by inspecting the raw
wikitext directly, where the row sequence jumps straight from Indonesia to Ireland) — is exactly the kind of
real coverage gap this component was expected to have per the design doc's own "~165 economies" estimate;
logged to `BACKLOG.md` like any other gap, not guessed at.

Real, verified live-fetch coverage across all 193 countries (2026-08-25 run): R&D expenditure 145, patents
per million 148, high-tech exports 175, ICT Development Index 170 — lower than the design doc's original
rough per-component estimates (~190/~190/~150/~165) for the first two WDI indicators specifically, now the
real, measured numbers rather than a pre-build guess. 124 countries land on `'measured'`, 27 on `'proxy'`, 42
on `'unavailable'`. `IntelligencePanel.tsx`/`AnalyticsPanel.tsx` wiring mirrors Economy's exactly:
`technologyIntelValue()`/`TechnologyDrilldown` alongside `economyIntelValue()`/`EconomyDrilldown`,
`TECHNOLOGY_COLUMNS`/`buildTechnologyRows()` alongside `ECONOMY_COLUMNS`/`buildEconomyRows()`, `sourceLabel()`
gained an `itu.int` branch, and `METRIC_AVAILABLE.technology` flipped to `true`. No GeoEntity — including
Taiwan — has a Technology score: unlike Economy, which sources Taiwan from IMF WEO specifically because WDI
excludes it, Technology draws no non-WDI fallback for any country, so Taiwan is simply absent here the same
way it's absent from Military. See `LOGBOOK.md`'s 2026-08-25/26 entries for the full sourcing trail.

`EntityRef` (`{ type: 'country' | 'territory' | 'geo-entity', id: string }`)
is how `Conflict.participants`, `Relationship.parties`, and every
`GeoEntity` relationship field point at other records — discriminated
rather than a bare string id because country ids (ISO 3166-1 alpha-3) and
GeoEntity ids (ad hoc slugs, no standard exists) aren't guaranteed disjoint.
`'territory'` is a legacy discriminant value kept only so old data that
still uses it type-checks; nothing in this codebase emits it anymore as of
v3.0.0 — use `'geo-entity'`.

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

**`data/registry/GeoEntityRegistry.ts`** (v3.0.0, replacing v2.1.2's
`TerritoryRegistry.ts`) is the same `Map`-backed pattern —
`registerEntity`/`getEntity`/`getEntities`/`getEntitiesByType`/
`getRelatedEntities` — for everything geopolitically significant that isn't
a UN-member sovereign state: de facto/partially-recognized states (Taiwan,
Kosovo, Palestine, Western Sahara), dependencies/autonomous regions/SARs
(Puerto Rico, Hong Kong, Greenland, 37 more), strategically/militarily
significant areas (Guantanamo Bay, the Cyprus Sovereign Base Areas,
Baikonur, the Siachen Glacier), disputed maritime features (the Spratly
Islands, Scarborough Reef), and treaty-governed regions (Antarctica) — see
`GeoEntityType` in `data/types.ts` for the full five-way classification.
`getEntitiesByType(type)` filters the registry by that classification;
`getRelatedEntities(id)` walks every relationship field (below) in *both*
directions — entities `id` points at, and entities that point at `id` — for
consumers like `ClaimsOverlayLayer` that need "what's connected to this at
all" rather than one specific direction.

One interface, `GeoEntity`, covers all five classifications — not five
separate interfaces the way `TerritoryRegistry` once needed only one for.
The central design decision, carried forward from the pre-v3 `Territory`
type: **who controls an entity and who claims it are separate fields**,
`administeredBy` and `claimedBy`, not one field with a type flag. They
frequently disagree (a government can control territory that isn't
internationally recognized as rightfully theirs), and `administeredBy` is a
*list* — real-world control is often split (Western Sahara has two
administrators, divided by a berm) — so the type doesn't force picking one
administrator or resolving the dispute itself. A `parentEntity` (singular,
optional) captures the uncontroversial "formally part of" relationship
(Puerto Rico -> USA) separately from the contested `administeredBy`/
`claimedBy` fields, so a plain dependency isn't modeled as more disputed
than it is. `claims` is the inverse of `claimedBy` — what this entity
claims, as opposed to who claims it — kept as its own field rather than one
bidirectional list specifically so a claims-overlay consumer can walk
outward from a selection independently of walking inward. Every relation
(`GeoEntityRelation`) accepts an optional `Country`/`GeoEntity` reference
plus a required `displayName`, because the relevant government is
frequently *not* a registered UN-member `Country` (Taiwan's own government,
the Polisario Front/SADR) — same reasoning the pre-v3
`ControllingAuthority`/`TerritoryClaimant` types established, carried
forward unchanged.

**`population`/`gdpUsd` (+ `populationYear`/`gdpYear`), added in v6.1.0,
mirror `Country`'s fields of the same name — but unlike `Country`'s, which
`scripts/buildGovCapitalPopGdp.mjs` auto-merges into every UN member at
runtime (see above), a `GeoEntity`'s are populated by hand, per entity, in
`registry/geoEntities.ts` itself.** The difference is deliberate, not an
oversight: `scripts/buildGeoEntityEconomics.mjs` queries the World Bank's
WDI API (the same `NY.GDP.MKTP.CD`/`SP.POP.TOTL` indicators, same
date-range-lookback methodology as the country script) for every
`'territory'`/`'geopolitical-entity'` GeoEntity with a resident population,
but only ever writes a **report**
(`scripts/geoEntityEconomicsReport.json`, plus an idempotent marker-delimited
`BACKLOG.md` section listing every no-WDI-data/partial/deferred entity —
same pattern as `buildGovCapitalPopGdp.mjs`'s own gap report, see
`BACKLOG.md`'s "Data sourcing (`buildGeoEntityEconomics.mjs`)" section) —
never into `geoEntities.ts` directly. That file's relationship data
(`administeredBy`/`claimedBy`/...)
is hand-curated and has no API equivalent to auto-merge against, so
auto-writing just the population/gdpUsd half every run would risk silently
clobbering hand-curated content the next time the file's shape changes;
a human reads the report and edits `geoEntities.ts` by hand instead, the
same way every other field in that file already is. Result: 23 of the 56
entities have real, WDI-sourced figures (Puerto Rico, Hong Kong, Macao,
Kosovo, Palestine, ...), each with a per-field comment citing the exact WDI
entity name/code/year and a `wdiProvenance()`-built `provenance` explaining
the split (population/gdpUsd are sourced and confirmed; the entity's
relationship data stays a simplified, hand-curated entry regardless). 16
more were queried and came back with genuinely no WDI data (Jersey,
Guernsey, Åland, ...) — left unscored with an explicit "No WDI data"
comment, not silently blank. Three are deliberately deferred, not
oversights: Taiwan (WDI structurally excludes it — needs IMF World Economic
Outlook sourcing instead, not done here), and Western Sahara/Crimea (both
have contested administration, so "population of X" isn't a single
unambiguous WDI query the way an uncontested dependency's is — each needs
its own human sourcing call). The three uninhabited entries (Heard
Island/McDonald Islands, U.S. Minor Outlying Islands, South Georgia and the
South Sandwich Islands) were never queried at all. See `LOGBOOK.md`'s
v6.1.0 entry, and `hud/IntelligencePanel.tsx`'s `GeoEntityDetails` (above)
for the render side.

**`data/registry/geoEntities.ts`** (v3.0.0, replacing v2.2.4's
`registry/territories.ts`) is the real, always-imported dataset — imported
as a side effect of `data/index.ts`, so `GeoEntityRegistry` is populated
before anything reads it. 56 entities: the v3 spec's 55 (including
Gibraltar — see below) plus Crimea,
carried forward from the pre-v3 dataset even though it isn't in that spec
(removing shipped functionality wasn't asked for). Its own
`provenance.source` carries the same "simplified, not comprehensive or
authoritative" caveat every dataset in this directory uses. See
`LOGBOOK.md`'s v3.0.0 entry for the judgment calls this file had to make
where the spec was ambiguous or silent (Gibraltar's inclusion, Crimea's
classification, which real-world parent/claimant relationships were added
beyond the spec's explicit list).

**`CLAIMS.md`** (repo root, v3.1.1, rewritten v3.1.3) is a generated,
complete roster — all 193 UN member states (sourced from `public/geo/
countries-un193.json`, the same topology `useCountryFeatures.ts` fetches at
runtime, not a second hand-typed list) and all registered GeoEntities, each
showing its claim relationships or "None," plus a "Summary: active
disputes" section up top for the 11 that actually have one. Produced by
`scripts/generateClaimsDoc.mjs` (`npm run docs:claims`) reading
`GeoEntityRegistry` directly, not hand-maintained — same "one source of
truth, no drift" reasoning `public/geo/*.json` being generated rather than
hand-edited already established in this codebase. Regenerate it after
editing any `claimedBy`/`claims`/`countries-un193.json` field; don't
hand-edit `CLAIMS.md` itself.

**Note for anyone reading `claims` off a `GeoEntity` directly instead of
through this generator:** `claimedBy` and `claims` are meant to be the same
fact recorded from two ends (see `GeoEntity`'s doc comment above), but
nothing in this dataset currently populates `claims` — every claim is
recorded only as `claimedBy` on the claimed entity (Taiwan claims Spratly
Islands/Scarborough Reef in every practical sense, but `taiwan.claims` is
`[]`; both reefs list Taiwan in their own `claimedBy` instead).
`ClaimsOverlayLayer.tsx` already accounts for this (it reads
`[...claimedBy, ...claims]` together — see that file) and
`generateClaimsDoc.mjs` infers the missing direction the same way; a new
consumer reading `entity.claims` alone will get an incomplete answer. See
`LOGBOOK.md`'s v3.1.3 entry.

`data/registry/exampleTerritories.ts` (the pre-v3 illustrative,
deliberately-unimported schema-validation file) was removed in v3.0.0 —
its job (prove the schema holds up against real, complicated cases without
being mistaken for the real dataset) is now served by `geoEntities.ts`
itself, which is real, imported, *and* already covers the complicated
cases (split control, non-Country claimants, multi-party maritime disputes)
that file existed to validate.

### Entity Resolution (`src/entities/`)

The seam between "an id came from a clicked map polygon" and "which
registry actually holds that id" (v2.1.3). **Wired into the live selection
pipeline as of v2.2.1** — `scene/Countries.tsx`'s click handler now
resolves through this (see "Selection & HUD panel state" above) instead of
constructing a country selection directly from the clicked polygon.

- **`types.ts`** — `GeopoliticalEntity`, the minimal shape
  (`id`/`name`/`aliases`/`provenance`) both `Country` and `GeoEntity`
  already satisfy exactly as they're defined in `data/types.ts` — nothing
  was added to either interface for this. `ResolvedEntity` is the
  discriminated union `EntityResolver` actually returns: a
  `GeopoliticalEntity`'s fields plus `kind` (`'country' | 'geo-entity'`, so
  a consumer can narrow — deliberately just two members, not one per
  `GeoEntityType`; a consumer that needs the finer classification reads
  `data.type`), a normalized `location` (`Country.capital` and
  `GeoEntity.location` are the same `GeoPoint` shape under different field
  names — `ResolvedEntity` picks one), and `data` (the full original
  record, for kind-specific fields like a country's `population` or a
  GeoEntity's `claimedBy`).
- **`EntityResolver.ts`** — `resolveEntity(id)` checks the Country
  Registry, then the GeoEntity Registry (`resolveCountry(id) ??
  resolveGeoEntity(id)`); `resolveCountry(id)`/`resolveGeoEntity(id)` check
  one specifically. All three return `undefined` for a miss rather than
  throwing — unlike `registerCountry`/`registerEntity`, where a
  duplicate id is a real bug worth throwing on, "this id isn't a country"
  is an expected, normal outcome here (that's what makes the `??` chain in
  `resolveEntity` work).

**The intended convention going forward:** once something starts consuming
resolved entities (a future click handler, a future layer), it should call
`resolveEntity()`/`resolveCountry()`/`resolveGeoEntity()` and never import
`CountryRegistry`/`GeoEntityRegistry` directly — the same "import the
barrel, not the implementation" discipline as `data/index.ts` and
`layers/index.ts` elsewhere in this codebase, one level up. A future
Country Engine, Relationship Engine, or anything else that needs to look up
"what entity is this id" is expected to go through here, not reimplement
Country-then-GeoEntity fallback logic itself.

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

**This is the piece that makes GeoEntity selection possible without
touching `scene/Countries.tsx`'s rendering.** As of v2.2.1, the click
handler calls `getEntityForGeometry(polygonId) ?? resolveEntity(polygonId)`
— it checks `GeometryMap` first, and only falls back to treating the
polygon's own id as an entity id directly, which is what actually resolves
every country today for actual UN-member polygons. Since v2.3.0 (Territory)
and v3.0.0 (the full GeoEntity set), real entity shapes also register
through here — `scene/useGeoEntityFeatures.ts` registers a mapping for all
55 rendered features as soon as the geometry loads. `exampleGeometryMappings.ts`
(v2.2.0's placeholder file, never imported anywhere the app loads) was
removed in v3.0.0 — every mapping it anticipated (and many more) is now a
real registration, except its synthetic Crimea mapping, which nothing
replaced: **Crimea has no standalone polygon anywhere in the source data at
all**, being geometrically part of Ukraine's. See `LOGBOOK.md`.

Since v3.0.0, clicking almost any GeoEntity's actual rendered shape on the
globe reaches its card, the same as clicking any country — see "GeoEntity
geometry" above (55 of 56 entities have real geometry — every one except
Crimea, which has no standalone polygon anywhere in the source data).
Crimea is
still reachable only via search or the console helper below, since it has
no rendered shape to click. `hud/selectionStore.ts` also installs a
dev-only console helper (v2.2.3, generalized in v3.0.0):
`window.__debugSelectEntity(id)`, e.g. `__debugSelectEntity('crimea')` —
gated by `import.meta.env.DEV` and eliminated from production builds. A
missing/misspelled id prints every currently-registered entity id to the
console rather than a fixed, now-stale example list.

### Search (`hud/SearchBar.tsx`)

Since v2.2.4, search covers every registered `Country` *and* GeoEntity, not
just the rendered country list — broadened in v3.0.0 from Territory-only to
all five `GeoEntityType` classifications. It builds one flat, ranked (exact
→ starts-with → contains) list from three sources — `useCountryFeatures()`'s
features (via `geometryToCentroid`, unchanged since before v2.2.4),
`useGeoEntityFeatures()`'s features (same `geometryToCentroid` derivation,
since the large majority of GeoEntity records have real rendered geometry —
see "GeoEntity geometry" above — and there's no reason to hand-maintain
~54 separate lat/lng pairs in the registry when the geometry already has an
authoritative one), and `getEntities()` filtered to records with a
`location` but *no* rendered geometry (currently just Crimea) — and renders
the top 8 as a live dropdown, each row tagged by kind. Selecting a result
(by click, or Enter for the top match) calls `resolveEntity(id)` from
`entities/EntityResolver.ts` and passes the result to the generic
`selectEntity()` — not the old country-only `selectCountry()` — the same
resolution path a map click uses (see "Selection & HUD panel state"
above), so a search-selected GeoEntity produces an identical
`SelectedEntity` to a geometry click on one.

**Currently searchable entity types: `country` (193, from the rendered
UN-193 topology) and all five `GeoEntityType` values (56 total, from
`data/registry/geoEntities.ts`) — tagged `COUNTRY` / `GEOPOLITICAL` /
`TERRITORY` / `STRATEGIC` / `MARITIME` / `REGION` respectively.**

**Adding a future registry to search** (Conflict, Relationship, or
whatever a future engine introduces) is additive, mirroring exactly how
GeoEntity was added on top of Country:

1. The new type needs a registry (`registerX`/`getX`s, same `Map`-backed
   shape as `CountryRegistry.ts`/`GeoEntityRegistry.ts`) and needs to
   satisfy `entities/types.ts`'s `GeopoliticalEntity` shape
   (`id`/`name`/`aliases`/`provenance`) — no changes to the type itself if
   it already has those fields, same as `Country`/`GeoEntity` needed none.
2. Add a `resolveX(id)` function to `entities/EntityResolver.ts` and fold
   it into `resolveEntity()`'s fallback chain (`resolveCountry(id) ??
   resolveGeoEntity(id) ?? resolveX(id)`), plus one more `ResolvedEntity`
   union member in `entities/types.ts`.
3. In `SearchBar.tsx`: one more block shaped like `geoEntityGeometryEntries`
   (map the registry's records to `SearchEntry`, skip any without a
   location/geometry), append it into `entries`, and add the new `kind` to
   `SearchEntry`'s union and `ENTITY_TYPE_LABEL`.
4. If real data should ship live (not just prove the schema), give it its
   own always-imported file like `registry/geoEntities.ts` — never repurpose
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
  stable facts; population/GDP are rounded approximate snapshots). **As of
  2026-08-12, all 193 UN member states have a profile** (originally ~60;
  the remaining 132 were filled in after being reported as "a lot of
  countries are missing their capitals" — see that file's own header
  comment for the caveats specific to that batch, including a few
  governments labeled descriptively rather than forced into a standard
  republic/monarchy category because they were mid-transition when
  written). `IntelligencePanel.tsx`'s CountryDetails "No profile data
  available" fallback is now effectively unreachable through normal
  selection (every UN member has an entry) but stays in place —
  `COUNTRY_PROFILES` still has one deliberate non-UN entry, Taiwan, kept
  as the worked example in this file's "GeoEntity geometry" section of why
  `CapitalMarker` gates on `selected.entity.kind === 'country'` rather
  than a name-only lookup.

## Code style

- Verify changes by typechecking (`tsc -b --noEmit`), linting (`oxlint`),
  running the Vitest suite (`npm test`), and actually running the dev
  server — Vitest covers this repo's pure geometry/math functions, not
  component behavior, so the dev-server check is still required for
  anything UI-facing.
- Comments are used sparingly, mainly to explain *why* something non-obvious is
  done (see examples throughout `countryGeometry.ts`, `Globe.tsx`), not to
  restate what the code does.
