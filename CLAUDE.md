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

## Before revising a decided area

LOGBOOK.md is the project's decision history — CLAUDE.md states current
state, LOGBOOK.md states why it got that way. Several categories here
(Economy, Current Status, Technology, Demographics) have had decisions
revised after initial ship — coverage floors added, weighting switched,
sourcing changed. Before changing behavior in an area with prior history,
check LOGBOOK.md's entries for that area first, so a settled call doesn't
get re-litigated or silently reversed without knowing it was already
decided and why.

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
  `SelectionController` OR `hud/analyticsStepStore.ts` (tab-dependent — see
  below), R/Space → `CameraController`'s wrappers,
  Enter/Escape/I → `openInspector`/`closeInspector`/`clearSelection`
  (Escape is two-stage: closes the panel first if open, only clears the
  selection on a second press once it's already closed), L/`/` →
  `toggleHudPanel('layers' | 'search')`.

  **Arrow routing is tab-aware (v6.8.1 follow-up fix)** — direct report:
  arrows stayed "locked to the map" (silently driving `SelectionController`'s
  entity navigation on a globe hidden behind whatever tab was actually
  showing) regardless of which top-nav tab was active. `InputManager` now
  reads `useTopNavTab()` and branches the four `select-*` commands: on
  `'map'`, unchanged — `selectDirection(...)`. On `'analytics'`,
  ArrowUp/ArrowDown call `getAnalyticsStepHandler()?.(-1 | 1)`
  (`hud/analyticsStepStore.ts` — a plain, non-reactive publisher
  `hud/AnalyticsPanel.tsx` points at its current `jumpToOffset`, same
  "cross-component value, read imperatively, not React state"
  pattern `scene/globeRotation.ts` already established) instead, stepping
  the open ranking; ArrowLeft/ArrowRight no-op there (no ranking-list
  meaning for "left"/"right"). On any other tab (news/database — neither
  has a real view yet), all four no-op. Only the four
  arrow commands are tab-gated — R/Space/WASDQE/Tab/Enter/Escape/L/`/`
  are unchanged and still always target the map/inspector regardless of
  tab, since only the arrow behavior was reported as wrong.

**v6.9.2: the INTELLIGENCE top-nav tab was dropped entirely** — direct decision, not left as a fourth
"not available yet" placeholder alongside NEWS/DATABASE. It was judged redundant before ever getting a real
view: the Intelligence Engine already has two homes, `hud/IntelligencePanel.tsx` (per-entity drill-down) and
`hud/AnalyticsPanel.tsx` (the cross-country rankings the wired ANALYTICS tab opens), and a third,
dashboard-style destination for the same data wasn't asked for. Removed by dropping `'intelligence'` from
`hud/navStore.ts`'s `TopNavTab` union and its `TABS` entry in `hud/TopNav.tsx`; `input/InputManager.tsx`'s
tab-aware arrow routing needed no logic change (it only ever branched on `'map'`/`'analytics'` explicitly and
already fell through to no-op for everything else), just a comment update. NEWS and DATABASE are unaffected
and still render as inert, disabled tabs. If a genuinely new view (e.g. a flat, searchable table over the
country/GeoEntity registries) is ever built for the DATABASE tab, it's expected to follow this same pattern —
flip `wired: true` in `TABS`, nothing else in `TopNav.tsx`/`InputManager.tsx` needs to change to accommodate it.

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
`HudPanel`'s) with NEWS, still inert like INTELLIGENCE/DATABASE were at the time — direct request, since
`SideRail.tsx` already owns real layer selection, leaving that tab-strip destination pure duplication.
**v6.9.2 dropped the INTELLIGENCE tab entirely** — see this file's own "INTELLIGENCE tab dropped" entry
further down; NEWS/DATABASE are unaffected and still inert placeholders.

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

Schema + query-layer foundation for future layers. Deliberately separate from
two things that already exist and might look similar at a glance:

- `scene/countryGeometry.ts` — that's border/fill *geometry*, this is
  attribute *facts* (population, claimants, participants, scores, ...).
- `data/countryProfiles.ts` — already-shipped, presentation-formatted data for
  the IntelligencePanel (government type, capital name/coordinates, factbook
  snapshot metadata). The `Country` type stores facts as plain, unformatted
  values instead, meant to be computed on (sorted, filtered, thresholded) by
  layers — formatting is a presentation concern downstream of this.

**`population`/`gdpUsd` (+ `populationYear`/`gdpYear`) are auto-merged into the
`Country` registry** — `scripts/buildGovCapitalPopGdp.mjs` writes
`data/countryEconomics.ts` (World Bank-sourced), and `useCountryFeatures.ts`
reads it alongside each country's id/name. This is a narrow, deliberate
exception to "geometry facts and presentation data are separate," not a
general merge policy. `IntelligencePanel.tsx` reads the raw numbers off
`Country` and formats them at render time via `utils/formatScale.ts`
(`formatPopulation`/`formatGdp`) rather than storing pre-formatted strings, so
a threshold-crossing correction (millions → billions) is a formatter change,
not a rebuild.

**What stays manual-only, and why:** `government`/`governmentNote` (a stable
"Presidential Republic" vs. a transitional/contested government string is a
judgment call no source API states cleanly) and
`capital`/`capitalLat`/`capitalLng` (a handful of countries have genuine
multi-capital ambiguity, resolved by hand, logged in `BACKLOG.md`) stay in
`countryProfiles.ts`, hand-curated, never auto-merged. `population`/`gdpUsd`
were judged safe to auto-merge specifically because the source is unambiguous
per country, every gap is logged to `BACKLOG.md` rather than guessed, and
merging only populates `Country`-only fields — it can never overwrite a
hand-curated one. A future field being considered for the same treatment
should meet that same bar.

### Intelligence Engine scoring data

Four categories have real, sourced 0-100 (or categorical) data:
**Military**, **Economy**, **Technology**, **Current Status**. This is a
separate, NOT-yet-merged dataset from the `Country`/`countryProfiles.ts`
auto-merge above — don't confuse the two. Diplomacy was designed but never
shipped real data and was removed entirely (see its own subsection below).
The full scoring-design rationale (locked components, zero-vs-coverage-gap
classification, weighting decisions, and every revision's reasoning) lives in
`Intelligence Docs/intelligence-engine-scoring-design.md` and `LOGBOOK.md` —
**not duplicated here; check LOGBOOK.md before changing normalization,
weighting, or coverage-floor logic in any of these categories, since most of
them have already been revised at least once post-launch.**

Shared UI shape across all four:

- **`hud/IntelligencePanel.tsx`**'s INTELLIGENCE SUMMARY renders one `IntelRow`
  per scored category (Military/Economy/Technology as a 0-100 bar; Current
  Status as `ConflictChip`/`SanctionBadge` chips instead of a bar, since
  neither of its fields is a magnitude). `IntelRow`'s bar fill is a single
  solid color per row, computed by `intelValueColor(value)` (red at 0 → amber
  at 50 → green at 100), applied identically to the adjacent value text.
  `hud/intelMetrics.ts` is the shared source for metric ids/labels/icons
  (`INTEL_METRICS`) and `utils/intelValueColor.ts` for the color ramp, so
  `IntelligencePanel.tsx` and `AnalyticsPanel.tsx` can't drift on either.
- **Citation drill-down**: Military/Economy/Technology status-bar rows are
  `<button>`s — clicking collapses the other rows and expands every scored
  component (raw value, source name/URL, snapshot year/date; a missing
  component still gets a row showing "—", never omitted). Clicking again (or
  changing selection) collapses back. All three drilldowns share
  `IntelligencePanel.tsx`'s `sourceLabel()` helper and the same
  `<button>`/collapse mechanics; only the row data differs per category.
  Current Status has no drilldown — its chip-expand interaction (below) is a
  different, lighter mechanism.
- **`hud/AnalyticsPanel.tsx`** is the full-screen dashboard mounted from
  `hud/TopNav.tsx`'s ANALYTICS tab — one clickable thumbnail per metric,
  drilling into a ranked/filtered list of every registered country (plus
  Taiwan — see its own subsection). Military/Economy/Technology share generic
  ranked-list machinery: `BaseRankedRow`/`AnalyticsColumn<TRow>`/
  `compareRows`/`SortableHeader`/`ColumnHeaderRow`/`RankedListRow`, with
  `MILITARY_COLUMNS`/`ECONOMY_COLUMNS`/`TECHNOLOGY_COLUMNS` and their own
  `buildXRows()` functions as the only category-specific pieces (each
  category's component shapes are genuinely different types). Sort state
  (`{ key, direction }`) resets to `SCORE`/descending whenever the active
  metric changes; every column header is click-to-sort, a coverage gap
  (`raw === null`) always sorts last regardless of direction, and ties break
  alphabetically. Clicking a row calls `selectEntity()` (same as a map click
  or search result) but never `flyToSelectedCountry()` — the globe is hidden
  behind this full-screen view, so `direction` is computed but the flight
  itself waits until the user switches back to the MAP tab. The ranked list
  stays open across a row click (does not auto-close). Current Status and
  Demographics (below) use their own bespoke row/header components instead of
  this shared machinery, since neither has a single SCORE number to rank by.
- **`RankingLookupBar`** (in `AnalyticsPanel.tsx`) is a jump-to-country search
  scoped to whichever ranking is open — deliberately not `SearchBar.tsx`'s
  `selectEntry()`, since that would open `IntelligencePanel` on top of this
  full-screen view. It scrolls the matching row into view
  (`scrollIntoView({ behavior: 'auto', ... })` — instant, not smooth; a smooth
  scroll combined with the same-tick highlight state update was found to
  render a blank transient frame) and flashes a self-clearing glow highlight.
  Chevron buttons (and ArrowUp/ArrowDown while the search box is focused) step
  the highlighted row to its neighbor in the list's current on-screen order,
  reading `lookupHighlightId` first and falling back to `selected?.id` so
  stepping works right after a plain row click too. Stepping always calls
  `closeInspector()` (never `selectCountryRow()`) — it moves the highlight
  cursor without opening or re-syncing `IntelligencePanel`; only an explicit
  row click opens the panel. The header (breadcrumb, lookup bar, step
  buttons, source label) is `sticky top-0` with an opaque background so
  scrolling rows pass behind it, not through it.

#### Military (`src/data/militaryScores.ts`, `scripts/buildMilitary.mjs`)

`npm run build:military` generates scores for all 193 countries from SIPRI
expenditure/industrial-base xlsx, World Bank WDI, CIA Factbook, FAS Nuclear
Notebook, and a reverse-engineered SIPRI arms-transfers endpoint (see the
script's header comment for the sourcing trail). 5 scored components:
expenditure (double-weighted — an explicit, on-the-record exception to the
design doc's "weights need citable backing" discipline), % of GDP, personnel,
nuclear warheads, defense-industrial base revenue. Log-min-max normalized,
with a coverage-floor/confidence-tier system and explicit true-zero-vs-
coverage-gap classification (a confirmed no-standing-military country renders
`N/A`, not a scored `0.0` — genuinely inapplicable, not merely unmeasured).
Arms-import dependency (TIV) is sourced but demoted to a non-scoring
annotation, shown last and visually subordinate in the drilldown. `BACKLOG.md`
tracks per-field sourcing gaps (air fleet is backlogged — paywalled source, no
free equivalent) and is regenerated by the build script itself.
`MILITARY_SCORES` is keyed by `Country.id` (the numeric ISO topology id) and
only applies to `'country'` selections — plus Taiwan (see below).

#### Economy (`src/data/economyScores.ts`, `scripts/buildEconomy.mjs`)

`npm run build:economy` generates 5 World Bank WDI components: nominal GDP
(log-min-max normalized, double-weighted), GDP per capita PPP (percentile
rank), 5yr-trailing real GDP growth (percentile rank), unemployment
(percentile rank, inverted), inflation (gaussian centered on a 2% target —
`score = 100 * exp(-((inflation - 2.0)^2) / (2 * 1.0^2))`, σ = 1.0pp taken
from the Bank of England's own tolerance band, not derived from sample
spread — used directly, no percentile step). GDP per capita stays percentile
rank rather than log-min-max, since log-min-max is only appropriate where raw
magnitude itself is the point (aggregate economic size), not per-capita
prosperity. `EconomyScore` carries a real per-component `raw`/`normalized`/
`year`/`sourceUrl` breakdown, same shape as `MilitaryScore`, for the shared
citation drilldown. Coverage floor requires ≥3 of 5 components present to
score at all (below that, `value` stays `null`); `coveragePresent` (what the
floor and confidence tiers key off) is computed from the undoubled component
list even though GDP counts twice in the actual composite average, so a
doubled component can't cross the floor on a technicality.

**Taiwan is a one-off exception**: WDI structurally excludes Taiwan, so
`buildEconomy.mjs`'s `buildTaiwanScore()` sources all 5 of its components from
IMF WEO instead (the only IMF/WEO dependency left in this script), filtered to
actual-year-only data (WEO includes forward projections; those are excluded).
Taiwan is appended to the ranking pool before percentiles are computed, so it
participates in the same 194-way ranking as every country, and is keyed by its
GeoEntity registry id (`'taiwan'`) rather than a numeric topology id — the one
exception to this file's numeric-id-keying convention.

#### Technology (`src/data/technologyScores.ts`, `scripts/buildTechnology.mjs`)

`npm run build:technology` generates 4 equal-weighted, percentile-rank-
normalized components: R&D expenditure (% GDP, WDI `GB.XPD.RSDV.GD.ZS`),
patent applications by residents per million population (WDI's WIPO-sourced
`IP.PAT.RESD` ÷ `SP.POP.TOTL`), high-tech exports (% of manufactured exports,
WDI `TX.VAL.TECH.MF.ZS`), and the ITU ICT Development Index. Coverage floor
needs ≥3 of 4 present to score. See the design doc's "Investigated and not
included" subsection for the 9 other candidates that didn't clear this
project's open-data/coverage/single-purpose bar.

**The ICT Development Index has no live API** (`datahub.itu.int` 403s an
unauthenticated fetch; ITU's bulk-data access is request-only). `IDI_2024` in
`buildTechnology.mjs` is a hand-transcribed snapshot (172 economies) of ITU's
published 2024 edition, parsed deterministically from the sourced Wikipedia
wikitable rather than eyeballed, to avoid transcription error. **Re-running
the build script refreshes the 3 WDI-sourced components but NOT `IDI_2024`** —
that needs a by-hand update against ITU's next published edition. India is
genuinely absent from ITU's own table (confirmed by inspecting the raw
wikitext, not a parsing gap) — a real, logged coverage gap, not a guess.

#### Current Status (`src/data/currentStatus.ts`, `scripts/buildCurrentStatus.mjs`)

Not a 0-100 composite — two independent, categorical fields per country:
`conflicts: ConflictEntry[]` (UCDP-sourced — `conflictType`, optional
`conflictName`, `snapshotDate`, `source`) and `sanctionTier: 'red' | 'orange'
| 'yellow' | null` (+ `sanctionPrograms`). Every country gets an explicit
`conflicts: []`/`sanctionTier: null` when neither applies — absence is a real,
positive fact here, never omitted the way an unscored Military/Economy
component is.

**Conflicts**: `conflictType` comes from the annual UCDP/PRIO Armed Conflict
Dataset's own classification where available, falling back to
`'unclassified'` for a conflict the monthly UCDP Candidate Events Dataset has
caught but no annual release has typed yet — no manual override path.
Countries are matched primarily by UCDP's Gleditsch-Ward numeric codes
(`scripts/lib/gleditschWard.mjs` bridges these to this project's UN-193
topology names), **plus** a name-resolution pass that also attaches a
Candidate/GED conflict to every named `side_a`/`side_b` government, not just
the event's own geolocated `country_id` — needed because a remote participant
(e.g. the US in a conflict physically located elsewhere) has no GW-coded
territory link in that dataset the way the ACD's `gwno_loc` field provides.

**Sanctions**: a small hand-maintained seed, three OFAC tiers — RED
(comprehensive embargo: Cuba, Iran, North Korea, Syria — fully verified
against each program's own regulatory text), ORANGE (sectoral/hybrid: Russia,
Belarus, Venezuela, Myanmar, Sudan, Nicaragua), YELLOW (list-based only,
SDN/Consolidated List screening: Afghanistan, Central African Republic, DR
Congo, Ethiopia, Iraq, Lebanon, Libya, Mali, Somalia, South Sudan, Yemen).
Only RED is fully per-program verified; ORANGE/YELLOW are secondary-source
seeds flagged in `BACKLOG.md` for verification. Not a live pull (see
`LOGBOOK.md` for why, and `BACKLOG.md` for it as a standing live-pull
candidate).

**Rendering**: `ConflictChip` (one per entry, colored/labeled by
`conflictType` via `scene/conflictTypeStyles.ts`, citation in a tooltip;
labels are plain-language — "INTERNATIONAL WAR", "CIVIL WAR", "FOREIGN-BACKED
CIVIL WAR", "COLONIAL CONFLICT", "RECENTLY DETECTED" — display-only, the
underlying `ConflictType` values are unchanged) and `SanctionBadge` (a
compact "S" mark colored by tier via `scene/sanctionTierColors.ts`, hidden
when `sanctionTier` is `null`). `CurrentStatusRow` collapses to a headline
("AT WAR (6)" / "NO ACTIVE CONFLICTS") and only reveals chips on click.
`shortenConflictName()` differentiates same-type chips for one country by
stripping this country's own name out of the raw `conflictName`. Clicking a
chip highlights the resolved party/parties on the globe via
`resolvePartyCountryIds()` (a non-state side like a rebel group is skipped;
the viewed country is the fallback if nothing else resolves) — routed through
`hud/conflictPartiesHighlightStore.ts` and
`layers/geoOverlays/ConflictPartiesHighlightLayer.tsx`.

`SanctionBadge` is clickable, opening `hud/SanctionTierMenu.tsx` — a global
popover across all 193 countries listing every tier's members as clickable
chips, plus a per-tier "S" icon that toggles
`hud/sanctionHighlightStore.ts`'s `highlightedTier` (one tier at a time), read
by `layers/geoOverlays/SanctionHighlightLayer.tsx`. Clicking a country chip
resolves + selects + flies the camera to it and closes the menu (outside
click or Escape also close it).

**`AnalyticsPanel.tsx`** renders Current Status as its own filtered/sortable
list, not the shared ranked-list machinery (no SCORE bar to rank by).
`buildCurrentStatusRows()` maps every country to `{id, name, conflicts,
sanctionTier}`; three filter tabs (ALL / ACTIVE CONFLICT / SANCTIONED, with
live counts) sit above the list; `SortableHeader` drives order by COUNTRY,
CONFLICTS (default — a real sortable integer), or SANCTION (by tier
severity). Each row shows one colored dot per distinct `conflictType` plus
the total count, and the same colored "S" badge — SANCTION is a plain,
non-clickable cell here (a row-level click already selects the country, so a
second click meaning on the same small badge would be ambiguous). **The
CONFLICTS cell is the one exception** — it's its own click target (a nested
`<button>` with `stopPropagation()`, since the row itself is a
`<div role="button">` rather than a real `<button>` to allow the nesting) that
expands each `ConflictEntry` as a small pill inline in the list, independent
per-row `useState` (not lifted, so re-sorting can't detach an expansion from
the wrong country).

#### Demographics (ethnicity + religion)

An informational-only extension of `currentStatus.ts`, **not** a scored
Intelligence Engine category: `ethnicGroups`/`religions:
{name: string; pct: number}[] | undefined`, each resolved **independently**
per field, with its own `ethnicGroupsSnapshotDate`/`religionsSnapshotDate`
recording which source and year resolved it. **The two fields go through
completely different, independent priority chains — ethnicity's is
unchanged from its original design, religion's was replaced entirely**:

- `ethnicGroups`: UN Statistics Division (UNSD) → CIA Factbook.
- `religions`: ARDA World Religion Database → UNSD → CIA Factbook.

**Ethnicity — UN Statistics Division primary** (data.un.org/UNdata,
tableCode 26), pulled via UNdata's unauthenticated CORS-open zipped-CSV
export endpoint (`UNSD_DOWNLOAD_BASE` in `buildCurrentStatus.mjs`) — no
documented bulk API exists, so this is a found direct path around a gated
UI, the same pattern as `buildMilitary.mjs`'s SIPRI TIV endpoint. Filtered
to Area="Total"/Sex="Both Sexes"; a country's most recent year with an
explicit "Total" group row is used as the percentage denominator — a year
with no Total row is treated as "UNSD has nothing," falling through to
Factbook rather than inferring a total by summing components.
`UNSD_NAME_ALIASES` bridges ~11 real name mismatches between UNSD and this
app's UN-193 topology names.

**A UNSD ethnicity result is also rejected — falling through to Factbook the
same as "UNSD has nothing" — when its single largest group is a
generic/residual label** (`isDominatedByGenericBucket()`: exact-match
against `other`, `not stated`, `not specified`, `not applicable`, `not
asked`, `not declared`, `unknown`, `refused to respond`, `refused to
answer`, at ≥50% share). Real case this was built against: Poland's UNSD
ethnic table codes 98.19% of the population as a literal "Other" row (the
census schedule only enumerates named minority nationalities, so the
implicitly-Polish majority has no row of its own), while Factbook plainly
states "Polish 96.9%" — technically present UNSD data that adds to 100% is
still less informative than a same-size Factbook figure when the largest
slice has no real name. Same shape for Costa Rica/Colombia/Bolivia's
ethnicity — every occurrence is logged to `BACKLOG.md`, never silently
swapped. This is a real, deliberately low bar (50%) — a country whose
minor/immigrant groups happen to collectively make up a modest "other"
share, without dominating the result, is left on UNSD.

**Religion — ARDA (thearda.com) World Religion Database primary.** Switched
from UNSD-primary because ARDA's own coverage is close to universal (real
run: 194/194 countries) where UNSD's religion table has real gaps (Russia
has zero rows — religion has never been a census question there) and the
same generic-bucket problem ethnicity's quality gate exists for. Scraped
from each country's own `thearda.com/world-religion/national-profiles?u=
{code}c` page's "Religious Adherents" table (`ARDA_NAME_ALIASES` bridges
~13 real name mismatches, e.g. `Turkey` → `Turkey/Türkiye`, `North Korea` →
`Korea, (North) Democratic Republic of`) — never the page's separate,
State-Department-sourced prose ("Religious demographics" section further
down the same page), which has been observed to disagree with the table
itself (Sudan's prose says "70 percent... Muslim," the table's own row says
91.36%). Cited as `"World Religion Database (Brill), via ARDA {year}"`,
dated by the WRD edition year in the table's own heading, not any
country-specific census year — this is an academic compilation on its own
publication timeline, not raw census data.

**Category granularity is asymmetric on purpose: every top-level religion is
one candidate EXCEPT Christians**, which is expanded into its own indented
sub-denomination rows (Catholics, Protestants, Orthodox, Independents,
unaffiliated Christians, ...), each competing directly against every other
religion's top-level row in the same ranking pool — confirmed against a
real case (Sudan) before shipping: Muslims 91.36%, Catholics 3.22%, Ethnic
religionists 2.77%, and Protestants 1.54% all compete on equal footing, so
Sudan's real top-4 is Muslims/Catholics/Ethnic-religionists/Protestants,
with everything else (Agnostics, Orthodox, Atheists, ...) folding into
Other. A country with a fragmented Christian population can plausibly show
multiple Christian sub-groups in one top-4 (Catholics AND Protestants) at
once. A non-Christian religion's own sub-rows (Sunnis/Shias under Muslims)
are read but discarded — real constituent detail with no display path here.
**When a non-Christian top-level row has no value of its own but its
children do** (Sudan's "Non-Religious" row is blank; its children
"Agnostics"/"Atheists" are real, measured values) **the children are used as
individual candidates instead of discarding real data** — confirmed with
the user rather than assumed, since ARDA's real page structure didn't match
what the original design brief's own example list implied. If Christians'
sub-rows don't sum to the parent total by more than
`CHRISTIAN_REMAINDER_THRESHOLD_PCT` (0.5 points — below that is ordinary
independent-rounding noise across 5-6 separately-rounded figures), the
shortfall becomes its own "Other Christian" candidate.

**A country's raw religion percentages can legitimately sum well past
100%** — ARDA's own "double affiliation" data for ~30 real countries (South
Korea's real, well-documented Buddhist/Confucianist/folk-religion overlap
sums to ~117%; several small Pacific nations with syncretic Christian
denominations run as high as ~144%) — verified against the live page, not a
parsing bug. `hud/SegmentedBar.tsx` scales down rendered segment WIDTHS
proportionally whenever the true total exceeds 100% (`widthScale = 100 /
totalPct`), so segments can never overflow the bar's fixed-width,
`overflow-hidden` track and get silently clipped — the legend/tooltip text
still shows each segment's real, unscaled percentage, only the visual width
is adjusted. A normal (≤100%) total scales by exactly 1, unchanged.

**Fallback (both fields): CIA World Factbook** for whatever the chain above
doesn't cover — for religion, this only fires for a country with neither an
ARDA profile nor UNSD table 28 coverage. `parseFactbookPctList()` extracts
comma-separated "<name> <pct>%" clauses, handling paren-depth-aware comma
splitting for multi-item asides, stripping each segment's own parenthetical
content before matching, decoding HTML entities before parsing, and
accepting leading-dot decimals. `resolveFactbookDemographics()` only parses
and gap-logs whichever field(s) the caller still actually needs (an explicit
`{needsEthnic, needsReligion}` flag) — added specifically because, once ARDA
resolves religion for nearly every country, calling this function only for
a country's *ethnicity* gap would otherwise still unconditionally log a
spurious "Religions... left unsourced" BACKLOG.md entry for a field that
was never actually missing. A country/field with nothing parseable from any
source in its chain gets `undefined`, logged to a marker-delimited
`BACKLOG.md` section.

**Grouping is a render-time concern**, not done in the build script —
`hud/demographicsGrouping.ts`'s `groupTopFourPlusOther()` sorts descending,
excludes a fixed `NON_RANKABLE_NAMES` set (`other`, `not stated`, `unknown`,
`refused to respond`, matched case-insensitively) from the top-4 pool
regardless of size, and folds everything past position 4 plus every
non-rankable group into a synthesized "Other" segment with a `breakdown` for
`hud/SegmentedBar.tsx`'s tooltip. A **separate synthesized "Unknown" segment**
(`{name: 'Unknown', pct: 100 - reportedSum}`) is appended whenever a
country's reported figures fall short of 100% by more than a 1-point
threshold (ordinary rounding drift below that) — kept distinct from "Other"
on purpose: "Other" is real named groups the source chose not to break out,
"Unknown" is population the source's figures don't cover at all. Guarded so a
country with zero source data (`groups` empty) never synthesizes "Unknown
100%" — it still renders as "—", and guarded the other direction too (a
negative shortfall, i.e. a >100% total, never produces a negative-percentage
segment — see the SegmentedBar width-scaling note above for how a >100%
total is actually handled). Colored via a dedicated
`DEMOGRAPHIC_UNKNOWN_COLOR`, not cycled into the 5-slot named-group palette.
`hud/demographicColors.ts` reuses 5 of `scene/highlightColors.ts`'s existing
hex values rather than inventing new ones.

`IntelligencePanel.tsx` renders a DEMOGRAPHICS section (ETHNICITY/RELIGION,
each its own `SegmentedBar`) below INTELLIGENCE SUMMARY, skipped entirely
when a country has neither field. `AnalyticsPanel.tsx` has its own ETHNICITY
and RELIGION thumbnails with bespoke `DemographicHeaderRow`/
`DemographicListRow` components (not the shared ranked-list machinery — no
natural single ranking axis, since each country's largest group has a
different name); default sort is alphabetical by country, with GROUP 1-4 /
OTHER / UNKNOWN as the other sortable columns.

**Known gap: US ethnicity has no Hispanic/Latino breakdown.** Both UNSD and
Factbook mirror the same US Census Bureau RACE categories (White, Black,
Asian, ...), not a separate Hispanic/non-Hispanic ethnicity question — no
Census Bureau override exists in this codebase. A real fix would need
hand-sourced ACS table B03002 data layered on top; flagged in `BACKLOG.md`,
not built speculatively.

### Taiwan recognized as a country across the Intelligence Engine

Taiwan is treated as a country everywhere the Intelligence Engine surfaces
data, while staying a `GeoEntity` architecturally — **not** merged into the
193-country `CountryRegistry`/topology, since only `GeoEntity` has claim
fields (`claimedBy: China`), and `Country` doesn't. Real, sourced data exists
per category:

- **Military**: all 5 components real — SIPRI's own sheets include a literal
  "Taiwan" row for expenditure/%GDP/Top-100 revenue (matched by literal name
  via `findYearSeriesForLiteralName()`, bypassing the topology-based name
  matcher); personnel comes from CIA Factbook, the same fallback path every
  other country already uses when WDI has no personnel figure.
- **Economy**: real (IMF WEO one-off — see Economy above).
- **Technology**: 3 of 4 components real (R&D expenditure from Taiwan's own
  NSTC figure; patents-per-million from TIPO, Taiwan's IP office; high-tech
  exports % — added 2026-08-27 — computed directly from UN Comtrade itself,
  reporter code 490 "Other Asia, nes" (the long-documented code Taiwan's own
  trade data is filed under, since Comtrade can't publish a Taiwan-labeled
  reporter), SITC Rev.4-classified export values summed per the OECD/Eurostat
  high-tech product list, divided by SITC sections 5-8 minus division 68 —
  same-source, not a cross-source substitute the way Economy's IMF WEO
  override or Military's CIA Factbook personnel fallback are; see
  `scripts/buildTechnology.mjs`'s `TAIWAN_HIGH_TECH_EXPORTS_PCT` comment for
  the full code list, the two transcription errors it fixed against
  Eurostat's published list, and the sanity check against South Korea/
  Malaysia's real WDI values). The ICT Development Index remains a genuine,
  logged gap — ITU doesn't publish Taiwan data at all. 3-of-4 coverage
  crosses the coverage floor, so Taiwan's Technology composite is now a real
  `'proxy'`-confidence score, not `null`/`'unavailable'`.
- **Current Status**: `conflicts: []`, `sanctionTier: null` — both real
  positive facts (UCDP's 25+ battle-death threshold hasn't been crossed;
  no active OFAC program), pushed directly rather than derived from the
  193-topology-keyed conflict datasets Taiwan isn't part of.
- **`data/registry/geoEntities.ts`'s Taiwan entry** has real `population`/
  `gdpUsd` (IMF WEO, the GDP figure reused verbatim from `economyScores.ts`'s
  Taiwan entry so the two can't drift) via an `imfWeoProvenance()` helper.
- **`data/countryProfiles.ts`** has a hand-added Taiwan entry (Semi-
  Presidential Republic, Taipei) so `CountryDetails` has real GOVERNMENT/
  CAPITAL data — see "Data quirks" below.

**UI generalization, not special-casing, except where the layout genuinely
differs:** `IntelligencePanel.tsx`'s `xIntelValue()` helpers key every lookup
by `selected.id` directly (works for a numeric country id or `'taiwan'`
identically — and is forward-compatible for any future GeoEntity that gains
score data). The one deliberate exception is OVERVIEW: a GeoEntity's
`ENTITY TYPE`/`STRATEGIC SIGNIFICANCE` layout doesn't fit "recognized as a
country," so `taiwanAsCountryLike(entity): Country` shapes a
`Country`-compatible object from Taiwan's GeoEntity + profile data and hands
it to the unmodified `CountryDetails` component, dispatched by an explicit
`selected.entity.data.id === 'taiwan'` check at one call site — every other
GeoEntity is unaffected. `SearchBar.tsx` tags Taiwan `COUNTRY` via an explicit
id check (every other geopolitical-entity result still reads `GEOPOLITICAL`).
`AnalyticsPanel.tsx`'s ranked-row builders iterate `getRankableCountries()`
(`[...getCountries(), getEntity('taiwan')]`) so Taiwan's row flows through the
same sort/filter/column/highlight machinery as every real country, with a
`centroidById` entry derived the same way `SelectionController.ts` already
derives GeoEntity centroids. `hud/CommandBar.tsx`'s COUNTRIES count includes
Taiwan (+1); its ENTITIES segment was relabeled TERRITORIES (label text only,
still counts rendered GeoEntity geometry including Taiwan's).

### Diplomacy — removed

Diplomacy was designed (§3.4 of the scoring-design doc: embassy network size,
treaty ratification counts, UN voting alignment, sanctions-coalition
participation, mediated-negotiation track record) but its weighting and
confidence-model alignment were never locked, and it shipped only ever as a
permanent "Awaiting data feed" placeholder. It was removed entirely rather
than kept as a placeholder — deleted from `hud/intelMetrics.ts`'s
`IntelMetricId` union and `INTEL_METRICS`; every consumer (`AnalyticsPanel.tsx`'s
`METRIC_AVAILABLE`, `IntelligencePanel.tsx`'s render loop and summary caption)
is driven generically off `INTEL_METRICS`, so no other code references it.
**`ICONS.diplomacy` (`hud/iconPaths.ts`) is intentionally still present** —
`hud/sideNavItems.ts`'s ALLIANCES tab reuses that icon for an unrelated
purpose. **The `METRIC_AVAILABLE`/`MetricThumbnail` "Awaiting data feed" path
is intentionally still present too** — it's the extensibility point a future
5th category would use if one is ever added; see the design doc's Status
header, updated to state the removal plainly rather than describing Diplomacy
as merely deferred. All 4 remaining categories (Military, Economy, Technology,
Current Status) have real data and real UI treatment — there is no
placeholder category currently shown anywhere in the Intelligence Engine.

### Entity/relationship type architecture

`EntityRef` (`{ type: 'country' | 'territory' | 'geo-entity', id: string }`)
is how `Conflict.participants`, `Relationship.parties`, and every `GeoEntity`
relationship field point at other records — discriminated rather than a bare
string id because country ids (ISO 3166-1 alpha-3) and GeoEntity ids (ad hoc
slugs) aren't guaranteed disjoint. `'territory'` is a legacy discriminant kept
only so old data type-checks — nothing emits it anymore; use `'geo-entity'`.

**`data/registry/CountryRegistry.ts`** — `registerCountry`/`getCountry`/
`getCountries`/`removeCountry` over a plain `Map`, structurally identical to
`layers/layerRegistry.ts`, with one deliberate difference: registering a
duplicate id **throws** here (no benign reason like Vite HMR for a duplicate
yet). Has no opinion about where `Country` records come from. Import types
and registry functions from the barrel, `data/index.ts`, not individual
files.

**`data/registry/GeoEntityRegistry.ts`** — the same `Map`-backed pattern
(`registerEntity`/`getEntity`/`getEntities`/`getEntitiesByType`/
`getRelatedEntities`) for everything geopolitically significant that isn't a
UN-member sovereign state: de facto/partially-recognized states, dependencies/
autonomous regions/SARs, strategically/militarily significant areas, disputed
maritime features, and treaty-governed regions — see `GeoEntityType` in
`data/types.ts` for the full five-way classification. `getRelatedEntities(id)`
walks every relationship field in *both* directions (what `id` points at, and
what points at `id`), for consumers like `ClaimsOverlayLayer` that need
everything connected to an id regardless of direction.

One interface, `GeoEntity`, covers all five classifications. The central
design decision: **who controls an entity and who claims it are separate
fields**, `administeredBy` (a list — real-world control is often split, e.g.
Western Sahara) and `claimedBy`, since they frequently disagree. `parentEntity`
(singular, optional) captures the uncontroversial "formally part of"
relationship (Puerto Rico → USA) separately from the contested
`administeredBy`/`claimedBy` fields. `claims` is the inverse of `claimedBy` —
kept as its own field (not one bidirectional list) so a claims-overlay
consumer can walk outward from a selection independently of walking inward.
**Nothing in the current dataset actually populates `claims`** — every claim
is recorded only as `claimedBy` on the claimed entity (e.g. Taiwan claims the
Spratly Islands in every practical sense, but `taiwan.claims` is `[]`; the
Spratly Islands' own `claimedBy` lists Taiwan instead). `ClaimsOverlayLayer.tsx`
and `scripts/generateClaimsDoc.mjs` both account for this by reading
`[...claimedBy, ...claims]` together — a new consumer reading `entity.claims`
alone will get an incomplete answer. Every relation (`GeoEntityRelation`)
accepts an optional `Country`/`GeoEntity` reference plus a required
`displayName`, since the relevant government is frequently not a registered
UN-member `Country` (Taiwan's own government, the Polisario Front/SADR).

**`population`/`gdpUsd` on `GeoEntity` are hand-populated, per entity, in
`registry/geoEntities.ts` itself — unlike `Country`'s, they are NOT
auto-merged.** `scripts/buildGeoEntityEconomics.mjs` queries the same World
Bank WDI indicators for every entity with a resident population, but only
ever writes a **report** (`scripts/geoEntityEconomicsReport.json` + a
marker-delimited `BACKLOG.md` section) — never into `geoEntities.ts` directly.
The reason: that file's relationship data (`administeredBy`/`claimedBy`/...)
is hand-curated with no API equivalent, so auto-writing just the economic
half every run risks silently clobbering hand-curated content if the file's
shape ever changes; a human reads the report and edits by hand instead. 23 of
56 entities have real WDI-sourced figures; 16 more were queried and
genuinely have no WDI data (left with an explicit "No WDI data" comment,
never silently blank); Taiwan/Western Sahara/Crimea are deliberately
deferred (Taiwan needs IMF WEO instead of WDI; the other two have contested
administration, so "population of X" isn't a single unambiguous query); the
3 uninhabited entries were never queried at all.

**`data/registry/geoEntities.ts`** is the real, always-imported dataset (56
entities) — imported as a side effect of `data/index.ts` so the registry is
populated before anything reads it. Its `provenance.source` carries a
"simplified, not comprehensive or authoritative" caveat, same as every
dataset in this directory.

**`CLAIMS.md`** (repo root) is a generated, complete roster of all 193 UN
member states plus every registered GeoEntity and their claim relationships
("None" where there are none), with an "active disputes" summary up top.
Produced by `scripts/generateClaimsDoc.mjs` (`npm run docs:claims`) reading
`GeoEntityRegistry` directly — **regenerate it after editing any
`claimedBy`/`claims`/`countries-un193.json` field; never hand-edit
`CLAIMS.md` itself.**

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
  selection (every UN member has an entry) but stays in place.
  **`COUNTRY_PROFILES` has one deliberate non-UN entry, Taiwan** — added
  2026-08-26 alongside "Taiwan recognized across the Intelligence Engine"
  (see this file's own entry further down) so `CountryDetails` has real
  GOVERNMENT/CAPITAL data to render for it. An EARLIER version of this
  paragraph claimed this entry already existed, as a "worked example" of
  why `CapitalMarker` gates on `selected.entity.kind === 'country'` rather
  than a name-only lookup — that claim turned out to be stale/inaccurate
  when actually checked (no Taiwan entry existed in the file at all before
  2026-08-26); `CapitalMarker`'s own kind-based gate is real and unaffected,
  but wasn't actually being exercised by a live Taiwan profile entry the
  way this doc used to imply.

## Code style

- Verify changes by typechecking (`tsc -b --noEmit`), linting (`oxlint`),
  running the Vitest suite (`npm test`), and actually running the dev
  server — Vitest covers this repo's pure geometry/math functions, not
  component behavior, so the dev-server check is still required for
  anything UI-facing.
- Comments are used sparingly, mainly to explain *why* something non-obvious is
  done (see examples throughout `countryGeometry.ts`, `Globe.tsx`), not to
  restate what the code does.
