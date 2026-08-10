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

## v5.2.5 — Retune country label sizing: long names, overall size

**Bug fix + tuning, on top of v5.2.3's label system.** Reported: the
Democratic Republic of the Congo stayed abbreviated ("DRC") even when
zoomed in close, and country text generally read as too big at zoomed-out
levels. Both traced to the same two constants: `FONT_TO_APPARENT_RATIO`
(0.32) and `MAX_FONT_PX` (13) together made font size saturate at its
ceiling from a mere 41px apparent size — a country barely bigger than a
dot at the default overview distance — so most countries of at least
moderate size rendered at the same maxed-out size regardless of actual
zoom, and a long name's estimated text width (which stops growing once
font size hits that ceiling) needed the country's apparent size to nearly
reach `CAMERA_MIN_DISTANCE` before finally clearing the growing
abbreviation threshold. Lowered the ratio (0.12) and the cap (11px, floor
also nudged down to 6px) — verified numerically against the real
`apparentSizePx`/`estimateTextWidthPx` functions: the Democratic Republic
of the Congo now shows its full name once zoomed to a normal "focused on
this country" distance instead of only at maximum zoom, while Russia/USA/
Canada (already correctly full-name from v5.2.4) are unaffected, and
medium countries like Zambia render at a visibly smaller, less bold size
at the default overview instead of already maxed out — incidentally also
reducing how often a label spills into a neighboring country's territory
(reported: Zambia's label overlapping the DRC), since a smaller font means
less rendered width to spill with. See `LOGBOOK.md`.

## v5.2.4 — Fix corrupted country sizing, add territory labels, fix oversized water labels

Four related fixes from one round of feedback on v5.2.3's new label system:

**Fixed a real bug in `geometryToAngularExtent`** (`countryGeometry.ts`) that
corrupted the size computation for any country with a distant exclave
crossing the antimeridian on a different wrap "branch" than its mainland
(Russia's Kaliningrad vs. its Far East, the USA's Alaska/Hawaii vs. the
mainland) — reported as "why is the USA/Russia abbreviated, they have huge
footprints." The bug combined every polygon's independently-unwrapped
points into one running bounding box; for these countries that produced
results past 360 degrees (Russia computed as ~503°), which then broke
`apparentSizePx`'s trig (`sin` of a bogus half-angle past 180° flips sign).
Now takes the max of each polygon's own independent extent instead — see
`countryGeometry.test.ts`'s new regression tests.

**Gave each label its own spacing radius instead of one flat constant for
everyone** — extracted the passive-label logic shared by
`CountryLabels.tsx` and a new `GeoEntityLabels.tsx` into
`PassiveEntityLabels.tsx`, and while doing so, sized each candidate's
declutter spacing requirement off its own rendered width (the same
per-candidate `spacingRadiusPx` fix `labelDeclutter.ts` already documents
for the Gulfport/Biloxi regression) instead of a flat constant tuned for
the biggest labels. Investigated the reported "Lebanon shows before Israel
even though Israel is bigger" directly: Israel wasn't losing to Lebanon,
it was losing a spacing conflict against Jordan (bigger, higher declutter
priority) while Lebanon happened to sit far enough away to clear — a
flat, one-size-fits-all spacing radius made that kind of collision more
likely than it needs to be. Real improvement, not a guarantee: a greedy
priority-ordered declutter pass can still reject a smaller neighbor next
to a big one at some zoom levels — that's inherent to the algorithm, not
something this fix eliminates entirely.

**Extended the same always-on passive label treatment to GeoEntities**
(`GeoEntityLabels.tsx`) — territories like Greenland previously had no
passive label at all, only `EntityRenderLayer.tsx`'s hover/selection-
triggered `HoverLabel`, unlike every UN member country. Shares
`PassiveEntityLabels.tsx` with `CountryLabels.tsx`, so it gets the same
zoom-adaptive sizing/abbreviation/color for free.

**Fixed water-body labels reading "extremely too big" once zoomed in close**
(the Strait of Hormuz overlapping the Persian Gulf, the Red Sea overlapping
sovereign states) — `WaterLabels` (`Globe.tsx`) used `Html`'s
`distanceFactor` prop, which scales a label to a CONSTANT WORLD-SPACE size
— the closer the camera gets, the bigger it reads on screen, unbounded.
Dropped it, the same fix `UsCityLabels.tsx` already documents for the
identical reason. Water bodies have no polygon data to size against the
way countries/GeoEntities now do, so this doesn't give them apparent-size-
based scaling — it just stops them from growing without limit, leaving a
small, fixed on-screen size at every zoom level.

See `LOGBOOK.md`.

## v5.2.3 — Google-Maps-style country labels: abbreviation, sizing, one uniform color

Tunes `CountryLabels.tsx`'s always-on passive country-name layer — same
feature, three complaints: small countries' names weren't abbreviating the
way Google Maps abbreviates a small country to something like "UK" at low
zoom; a full name could visibly sprawl outside the country's own on-screen
shape; and label color varied noticeably between countries (a fixed 4-tier
opacity ramp keyed to physical size), reading as an inconsistent, patchy
palette rather than one coherent label layer.

Replaced the old fixed extent-based 4-tier size/color/weight ramp with
continuous values driven by a new `apparentSizePx` helper
(`labelDeclutter.ts`) — the country's *current* on-screen footprint (extent
+ live camera distance + FOV), not just its fixed real-world size. Font size
now tracks that footprint directly (clamped), and the full name is only
shown when a rough width estimate fits within it (`MAX_NAME_WIDTH_FRACTION`
= 1.15x, some overhang reads as normal on any atlas); otherwise a new
`countryAbbreviation.ts` derives a short form on the fly (initials of
significant words for multi-word names — "United Kingdom" -> "UK",
"Democratic Republic of the Congo" -> "DRC" — first 3 letters for
single-word ones). No new ISO-code data file needed. Color is now one
constant (`text-gray-300`, light grey) for every country, full stop — only
size and font-weight still vary by apparent size. The same country now
abbreviates from the default overview distance and grows into its full name
as you zoom in, rather than a country's label treatment being locked in by
physical size alone (confirmed directly: even the USA, physically enormous,
abbreviates to "USA" at overview distance because "UNITED STATES OF
AMERICA" doesn't fit its own on-screen width there). See `LOGBOOK.md`.

## v5.2.2 — Fix the same far-side label bleed for selection markers/callouts

**Bug fix, same root cause as v5.2.1.** After fixing `WaterLabels`, asked
whether any other `Html` label had the same problem — yes: any label that
persists while something stays *selected* (not just *hovered*) had the
identical latent bug, since selection can survive the globe rotating the
selected thing out of view while a hover-triggered label can't (hovering
requires the pointer to already be over a front-facing mesh). Verified
directly: selecting a country by clicking its polygon (no camera flight),
then rotating it to the far side, left its name label and capital marker
fully readable "through" the globe indefinitely.

Fixed `EntityRenderLayer.tsx`'s `HoverLabel` (country/GeoEntity/state name
on selection), `Cities.tsx`'s `CityLabel` (capital/major-city name on
selection), and `PointerMarker.tsx` (so both `Globe.tsx`'s `CapitalMarker`
and `ClaimsOverlayLayer.tsx`'s related-country marker inherit the fix) —
new shared `scene/useFrontOfGlobeVisible.ts` hook, generalizing the analytic
check `WaterLabels` got in v5.2.1 rather than duplicating it three more
times. `UsCityOutlineHighlight.tsx` was checked and doesn't need this: its
only setter (`flyToUsCity()`) always moves the camera there in the same
action, so it can never end up selected-but-off-screen.

## v5.2.1 — Fix water-body labels bleeding through the far side of the globe

**Bug fix.** `WaterLabels` (ocean/sea/gulf/strait/bay names) was hiding
far-side labels with `Html`'s raycast-based `occlude` prop — reported as
never actually working: a label like "INDIAN OCEAN" or "GULF OF MEXICO"
stayed visible straight through the globe regardless of camera position,
zoom level, or whether the globe was moving or static, not just as an
occasional glitch near the horizon. Replaced with the same analytic
dot-product front/back-of-globe test `CountryLabels.tsx` and
`Lakes.tsx`/`Rivers.tsx` already use (`labelDeclutter.ts`'s
`isCandidateVisible`), including the same rotationY compensation
`CountryLabels.tsx` needs for labels living inside the ambient-rotation
group. No new mechanism introduced — this app had already solved "is this
point on the near or far hemisphere" correctly once; `WaterLabels` was the
one remaining consumer of the different, broken one. See `LOGBOOK.md`.

## v5.2.0 — Lakes and rivers: physical-geography water layers

New data layer within the existing **Rendering Engine** and **LOD Engine**
(v4.3) — the first of that engine's seven originally-reserved zoom-gated
ids (`rivers`) to actually ship, alongside a new `lakes` id added directly
as implemented in the same pass. Both render always-on, the same "always
render, never zoom-gated" treatment as countries/states. A point release,
not a new major version — this fills in ids the LOD Engine already
reserved and uses the Layer Engine as-is, rather than expanding either
engine's own architecture.

**Lakes** (412 features) and **rivers** (116 of 462 source features,
`scalerank <= 3` — major rivers only, mirroring the states/provinces and
cities pilot-scope precedent) come from Natural Earth's 1:50m Physical
Vectors layers, built by two new scripts
(`scripts/buildLakesTopology.mjs`/`buildRiversTopology.mjs`, wired into
`npm run build:geo`) following the exact same
filter-simplify-requantize pipeline `buildCountryTopology.mjs` established.
Both are decorative-only: no `GeoEntityRegistry` entry, no `GeometryMap`
registration, not selectable or searchable — physical geography, not a
political entity.

**Rivers needed a new geometry primitive.** Every existing function in
`countryGeometry.ts` assumes a polygon (a ring to close, an interior to
fill); a river is a `LineString`/`MultiLineString` with neither. New
`geometryToLineSegments` walks a line's points directly (same antimeridian-
unwrap handling, same "one merged Float32Array, one draw call" reasoning as
`geometryToBorderSegments`) without attempting to triangulate a fill.

**Lake fill is opaque pitch-black, not a translucent blue tint.** The
obvious first approach — a translucent tint over the land underneath — read
as geographically wrong, because country/state fill meshes have no actual
hole where a lake sits (confirmed: the US polygon has zero interior holes
anywhere), so a lake showed as solid land through the tint. A true
geometric cutout (subtracting lake polygons from country/state polygons at
build time) was rejected as too large a change for this pass — new
polygon-clipping dependency, touches the core country/states build
pipeline, and doesn't help rivers either way (no area to subtract from a
line). Opaque pitch-black fill (matching the ocean/core sphere) reads as
real open water instead, regardless of what land geometry sits underneath,
without touching that geometry at all. See `BACKLOG.md` for the deferred
geometric-cutout item.

**New shared module, `scene/coreSphereRef.ts`.** `WaterLabels` already
occludes its labels against Globe.tsx's core sphere mesh via a ref passed
as a prop — Lakes.tsx/Rivers.tsx can't receive that same ref that way,
since Layer Engine-mounted components aren't direct children of Globe.tsx.
`coreSphereRef` is a plain module-level `{ current }` box (same
non-reactive "value crosses the scene boundary without a store" pattern
`globeRotation.ts` established) that Globe.tsx assigns its core sphere's
`ref` prop to directly, so both call sites share the exact same mesh
instance.

## v5.1.0 — Black-gap fill fix, opaque pitch-black ocean, grid removed, ROYGBIV legend palette

**Fixed the black-gap fill defect** (present since before v5.0.0, first
noticed and investigated — but not root-caused — in that release): a subset
of country fill meshes (Brazil, Russia, Canada, USA, Australia, Antarctica)
rendered an opaque black gap over part of their interior. Root cause: earcut
can legitimately produce one large "ear" triangle spanning 20-30+ degrees of
arc to cover a wide concave coastline notch; the GPU renders that triangle
as a flat plane between its three corners, which sags measurably *inward*
from the sphere's true curved surface once wide enough — Brazil's worst
offender dipped 3.04% of `GLOBE_RADIUS` below the nominal fill surface, past
the opaque core sphere sitting only ~2% inward, which then occludes the
sagging patch. `countryGeometry.ts`'s `geometryToFillMesh` now recursively
subdivides any triangle whose measured chord sag exceeds a safe threshold
(a one-time cost at geometry-build time, not per-frame) — see
`LOGBOOK.md`'s v5.1.0 entry for the full diagnosis and why the fix measures
actual sag rather than using a fixed angular threshold. New Vitest coverage
in `countryGeometry.test.ts` (`geometryToFillMesh subdivides wide triangles`)
guards this specifically.

**The ocean is now always fully opaque and pitch black.** `Globe.tsx`'s core
sphere previously faded to 35% opacity while idle (only going solid once a
country was selected) and rendered as a dark navy (`#04141C`); it's now
`#000000` and fully opaque at all times.

**Removed the lat/long graticule grid.** `Globe.tsx`'s `GraticuleGrid`
component (and its render call) is gone outright, not just hidden — the
crisscrossing overlay it drew across the whole globe.

**Retuned `highlightColors.ts`'s 7-slot palette from v5.0.0's blue/cyan/
violet family to one ROYGBIV spectrum hue per slot** — reported directly
that 5 of the 7 slots (default, selected, claimsOverlay, relatedCountry,
categoryHighlight) read as shades of the same blue/indigo/violet family,
too close to distinguish at a glance. There are exactly 7 legend slots and
ROYGBIV has exactly 7 hues, so each slot now gets its own spectrum color
instead: blue (default), yellow (hovered), indigo (selected), green
(territory), red (claimed), orange (related country), violet (category
highlight) — refined jewel-tone values, not literal crayon-box primaries.
Validated with the dataviz skill's palette checker (CVD separation +
normal-vision distinctness) against the app's actual near-black surface
rather than picked by eye. Updated the handful of code comments
(`ClaimsOverlayLayer.tsx`, `LegendPanel.tsx`, `CLAUDE.md`) that named the
old colors by hue ("dashed magenta," "dashed blue") to match.

## v5.0.0 — Glass-console HUD: TopNav + SideRail replace Header/Toolbar

A full visual overhaul of the HUD chrome and navigation, driven by an
external design reference (a mockup image + a matching React/CSS artifact),
built in reviewed stages across a session rather than landed as one diff:
palette, typography, panel chrome, then layout.

**Colors** — `scene/highlightColors.ts`'s 7-color palette shifted from the
original red/yellow/green/magenta/purple scheme into a blue/cyan/violet
family sampled from the reference, keeping all 7 slots distinguishable
(`hud/LegendPanel.tsx` picks the new values up automatically, since it
already read from this file rather than hardcoding its own).

**Typography** — the root font moved from Chakra Petch/JetBrains Mono to
`Rajdhani` (`src/index.css`'s `--font-display` token, now also the
`html/body/#root` default). `JetBrains Mono` is kept, but scoped down to
only genuine numeric/data readouts — `CommandBar.tsx`'s counts/FPS/
coordinates, `SettingsPanel.tsx`'s sensitivity value, and the whole
`Telemetry.tsx` panel — rather than being the default for every label and
scene-text element it used to cover.

**Panel chrome** — new `hud/panelStyles.ts` is the single source of truth
for the glass-panel look (rounded corners, translucent backdrop blur, thin
border) every panel now shares, mirroring the "one file, everyone imports
it" precedent `highlightColors.ts` already established. `hud/HUDFrame.tsx`
(the corner-bracket/vignette/scanline "tactical display" overlay) is
removed — the reference has no equivalent, and the glass panels now carry
the "framed" feeling on their own.

**Intelligence panel content** — `IntelligencePanel.tsx` gained an
INTELLIGENCE SUMMARY block of progress-bar metric rows and a RELATIONSHIPS
feed-row list, matching the reference's visual language. The metric bars
are chrome only, deliberately rendered in their empty state (flat track,
em-dash, an explicit "no assessment data is currently sourced" note) — no
score field exists anywhere in `data/types.ts`, and fabricating one would
contradict this project's own documented policy against inventing
geopolitical assessments (see the Intelligence Engine backlog item). The
feed rows, by contrast, are driven entirely by real data: `GeoEntity`'s
`parentEntity`/`administeredBy`/`claimedBy`/`claims` fields, already shown
in this panel as plain text, recast as feed rows with `since`'s year filling
the reference's timestamp column and colors sourced from
`highlightColors.ts`.

**Layout** — `hud/Header.tsx` and `hud/Toolbar.tsx` are replaced by two new
components. `hud/TopNav.tsx` is a full-width top bar: brand mark (left, also
resets the view), MAP/INTELLIGENCE/LAYERS/ANALYTICS/DATABASE tabs (middle —
only MAP has a view behind it; the rest render visibly disabled with a
tooltip rather than as dead buttons), and search/favorites/notifications/
account/layers/settings (right — only search/layers/settings are wired).
`hud/SideRail.tsx` is a left sidebar of ten sections and is genuinely
functional, not just decorative: each one scopes `LayerPanel.tsx` to that
section's real registered Layer Engine categories via a plain mapping table
(`hud/sideNavItems.ts`) matched against the `category` field layers already
register under — a newly registered layer joins the right section
automatically, no edit needed here. Sections with nothing registered yet
(Economy, Weather, Filters) render disabled rather than as no-op buttons.
`SearchBar.tsx` moved from its own fixed-position dropdown into an
always-visible pill inside `TopNav`'s utility cluster.

New supporting files: `hud/icons.tsx`/`hud/iconPaths.ts` (the HUD's shared
icon set, split into a renderer + a plain-data module for the same
Fast-Refresh reason `scene/geoEntityEntries.ts` is split from
`GeoEntities.tsx`) and `hud/navStore.ts` (which sidebar section / top-nav tab
is active — zustand, same pattern as every other store in this directory).

Verified with `tsc -b --noEmit`, `oxlint`, `npm test`, `npm run build`, and a
manual click-through in a real browser after each stage — selection, hover
labels, and small-country leader-line callouts were specifically
re-confirmed working after the panel/layout changes, since none of this
touched `EntityResolver.ts`, `GeometryMap.ts`, `selectionStore.ts`, or how
`countryGeometry.ts` builds/resolves geometry.

A separate attempt in the same investigation to reskin the globe itself
(navy/charcoal/gold solid-fill countries, and a glowing-dot-fill rendering
mode) was tried and reverted — see `BACKLOG.md`'s Visualization section for
what came out of that: a real, still-unexplained rendering defect on
several large countries (Brazil, Russia, Canada, USA, Australia,
Antarctica), invisible at this app's low default fill opacity but worth
investigating separately.

Not promoted from `geo-data-engine` — this work is unrelated to that
branch's geographic-data charter, so it was committed directly to `main`.

## v4.5.0 — Countries/GeoEntities/StatesProvinces dedup into EntityRenderLayer

`scene/Countries.tsx` and `scene/GeoEntities.tsx` had nearly identical
rendering logic — one merged border/fill mesh per entry, hover/select/dim
color computation, the click-vs-drag threshold, the `HoverLabel`
large-vs-small callout choice — kept as two separate copies specifically so
neither could regress the other's already-verified click/highlight
behavior. Now that `countryGeometry.ts` has Vitest coverage (v4.3.1) as a
regression guard, that rendering is extracted into a new
`scene/EntityRenderLayer.tsx`, shared by both. Each caller keeps only its
real differences: `Countries.tsx` builds its own entries (a country's
`geometryId`/`entityId` are always the same string, unlike a GeoEntity's)
and falls back to `selectCountry()` on a click-resolution miss;
`GeoEntities.tsx` just no-ops, since every rendered GeoEntity already has a
`GeometryMap` registration by the time it's clickable.

`scene/StatesProvinces.tsx` had the same copy of this pattern a third time
— adopted onto `EntityRenderLayer.tsx` too, same reasoning.

Verified with `tsc -b --noEmit`, `oxlint`, `npm test`, and a manual visual
click-through of country, GeoEntity, and states/provinces selection/hover.

Promoted from `geo-data-engine`.

## v4.4.0 — Stores migrated to zustand

`selectionStore.ts`, `settingsStore.ts`, `telemetryStore.ts`, `layerStore.ts`,
`lodStore.ts`, `hudPanelStore.ts`, and the two non-reactive publishers
(`globeRotation.ts`, `hoveredCountry.ts`) all replace their hand-rolled
`useSyncExternalStore` + module-`let` + listener-`Set` boilerplate with
zustand — `create()` for the reactive stores, `zustand/vanilla`'s
`createStore()` for the two publishers that never needed a React hook.
Every exported function and hook name/signature is unchanged
(`selectEntity()`, `flyToUsCity()`, `useSelection()`, etc.), so no consuming
component needed to change — only what's underneath them did.

`lodStore.ts` keeps its "only rerender on an actual LOD-tier change, not
every frame's raw distance update" behavior via a zustand selector
(`useLodStore((state) => state.level)`) rather than the manual
reference-equality check the old version needed.

Verified with `tsc -b --noEmit`, `oxlint`, `npm test`, and a full manual
click-through of selection, search, every keyboard shortcut, layer toggles,
and camera reset — the highest-regression-risk phase of this refactor,
since it touches nearly every file that reads shared state.

Promoted from `geo-data-engine`.

## v4.3.2 — `frameloop="demand"` replaces the manual `advance()` render loop

Deletes `FrameRateCap.tsx` (the `frameloop="never"` + manual `advance()`
60fps cap) and switches `Scene.tsx`'s Canvas to `frameloop="demand"`. R3F
now only renders when something calls `invalidate()` — automatic for any
React-driven prop change, but not for a Three object mutated directly
inside a `useFrame` callback, so every animation that does that (ambient
self-rotation, `PointerMarker`'s pulse, camera flights/reset, WASDQE
nudging, flick-to-spin, the ambient-rotation toggle) got an explicit
`invalidate()` call added at its mutation site. Net effect: a fully idle
globe now renders zero frames instead of a steady 60fps, and the
milliseconds-vs-seconds `advance()` units bug documented in `CLAUDE.md`
can't recur — there's no manual clock-feeding left to get wrong.

Verified interactively: drag, scroll-zoom, hover, click-select, FOCUS
CAMERA flight, Home/reset, held WASDQE nudging, and the T ambient-rotation
toggle (including rendering actually stopping when idle) all work
correctly with zero console errors.

Promoted from `geo-data-engine`.

## v4.3.1 — Vitest safety net

Adds Vitest (`vitest.config.ts`, kept separate from `vite.config.ts` — build-
only concerns like `manualChunks` have no meaning for the test runner) and 53
tests across the pure-function modules with the most documented bug history
in this project: `utils/geo.ts` (`bearingBetween`/`angularDistance` exact
cardinal-direction and antimeridian-crossing cases, `normalizeAngle`'s ±π
boundary), `lod/lodLevels.ts` (`resolveActiveLevels`/`resolveDeepestLevel`/
`isLodLevelActive` against the real `LOD_LEVELS` ladder, confirming it's
cumulative and reserved levels never activate), `scene/labelDeclutter.ts`
(an `OrthographicCamera` makes the projection math exactly hand-computable;
includes a direct regression pair for the Gulfport/Biloxi per-candidate-
spacing bug), and `scene/countryGeometry.ts` (antimeridian-unwrapping
correctness via `earcut.deviation()`, segment/mesh structural validity,
MultiPolygon merge behavior). All hand-verified expected values, not
snapshots.

One real, previously-undocumented behavior surfaced while writing these:
`geometryToAngularExtent` computes one bounding box across an entire
MultiPolygon rather than each polygon's own extent maxed separately — worth
knowing if this is ever reused to size something per-polygon.

Promoted from `geo-data-engine`.

## v4.3 — Progressive US city/country label reveal, and a new LOD Engine

New capability: Google-Maps-style progressive label reveal. `UsCityLabels.tsx`
shows US city names (not polygons — that's still v4.2's separate,
search-triggered `UsCityOutlineHighlight.tsx`) ranked by real 2023 Census
city-proper population, joined against a new Census population-estimates
product (`scripts/lib/usStateCapitals.mjs` hand-curates the state-capitals
list, since no dataset flags that itself), with a synthetic population
floor so small notable capitals (Montpelier, VT; Pierre, SD) still qualify.
Biggest metros appear first as you zoom in; smaller towns integrate at
progressively tighter zoom. `CountryLabels.tsx` adds the same always-on
treatment for country names, ranked by on-screen angular extent (no
population data exists for all 193 countries).

This introduces a new engine: **the LOD Engine (`src/lod/`)**, architecturally
parallel to the Layer Engine, generalizing the population/zoom-tier logic
above into a reusable, ordered ladder spanning this app's full intended
zoom progression — Earth → Countries → States/Provinces → Metro Areas →
Large/Medium/Small Cities → Every Incorporated City → (reserved, not yet
built) Roads/Rail/Rivers/Airports/Ports/Military Bases/Infrastructure.
Every future zoom-gated dataset gets one shared place to declare "I'm
active below distance X" instead of inventing its own disconnected
threshold the way `UsCityLabels.tsx` had to the first time.

### Added

- **`scene/labelDeclutter.ts`** — shared Google-Maps-style screen-space
  decluttering: candidates are checked in priority order and a
  lower-priority one is rejected if it would land within spacing distance
  of an already-accepted label. Real-world spacing maps to more screen
  pixels the closer the camera gets, so "zoom in for more labels" falls out
  of this one mechanism with no separate zoom-tier bookkeeping needed. Used
  by both `UsCityLabels.tsx` and `CountryLabels.tsx`.
- **`src/lod/`** — `types.ts`'s `LodLevelId` union names the full
  progression above, the last seven ids reserved (`implemented: false`, no
  geometry/store/camera work behind them yet); `lodLevels.ts` is the
  ordered ladder plus pure `resolveActiveLevels`/`resolveDeepestLevel`/
  `isLodLevelActive` functions; `lodStore.ts` is a non-reactive publisher
  (same shape as `globeRotation.ts`/`telemetryStore.ts`) for consumers
  without their own per-frame camera access, fed by one added line in
  `scene/TelemetryProbe.tsx`. Each level's "active" check is independent
  and cumulative (`distance <= level.revealDistance`), which also removes
  the need for a separate upper-bound guard a first-match-wins scan would
  otherwise need.

### Fixed

- **A candidate-pool filter needs an "is this actually on screen" test,
  not just "is this on the near side of the globe."** The sphere-horizon
  dot-product test alone stays true for 40+ degrees of arc regardless of
  zoom, while the camera's actual framed view at close zoom can be a few
  degrees wide — so cities hundreds of miles outside the current view, but
  still technically front-facing, were consuming every candidate/label-
  budget slot ahead of a real, smaller, actually-on-screen city (a real
  city, ranked in the mid-hundreds nationally by population, never
  appearing no matter how far you zoomed into its own state, because
  bigger cities elsewhere in the country — off-screen but still passing the
  sphere-horizon check — consumed every slot first). Fixed by projecting to
  screen space and checking against the actual viewport bounds too
  (`labelDeclutter.ts`'s `isCandidateVisible`/`projectToScreen`).
- **A single flat label-spacing constant breaks down once label sizes vary
  a lot.** One shared spacing constant (tuned for legible big-metro labels)
  also applied to two adjacent small-town labels a third that size — the
  smaller-population one of the pair always lost even though neither label
  was anywhere near that width. `labelDeclutter.ts`'s spacing check now
  sums each candidate's own radius (scaled to its label tier) instead of
  comparing against one shared constant.

### Changed

- `scene/constants.ts`'s `CAMERA_MIN_DISTANCE`: `GLOBE_RADIUS * 1.05`
  (2.52, ~335km altitude) → a flat `2.5` (~265km) — a small further
  tightening, nowhere near the `* 1.005` jump that broke rendering in v4.2.
  The LOD Engine's `every-incorporated-city` level keeps its own
  independent `2.52` rather than deriving it from this constant — the two
  are conceptually different (rendering safety vs. product/legibility
  threshold) and shouldn't silently retune each other.
- The `every-incorporated-city` tier floors population at `1`, not `0` —
  excludes the unincorporated Census-Designated Places this dataset leaves
  at population 0, matching the tier's own name.

## v4.2 — All 32,608 US city boundaries: search + on-demand outline

New capability: every US Census incorporated place and Census-Designated
Place (32,608 total) is now findable by name and, once found, shows its
real boundary — but **deliberately not as a rendered layer you can toggle
on**, and not part of the selectable-entity/`GeoEntityType` system every
other classification above joined. `scripts/buildUsCitiesData.mjs` (`npm
run build:geo:us-cities`, parsing a vendored US Census Bureau cartographic
boundary shapefile via the new `shapefile` dependency — not part of the
default `build:geo` chain, much slower/heavier than every other geo build
script) writes 56 per-state geometry shards
(`public/geo/us-cities/{state}.json`) plus one lightweight, always-loaded
search index (`public/geo/us-cities-index.json`, id/name/lat/lng/state —
no polygon data). Searching and selecting a result fetches that one city's
shard on demand and draws only its boundary
(`scene/UsCityOutlineHighlight.tsx`); nothing else about 32,608 places is
ever loaded or rendered at once. Search results show `"City, ST"` (e.g.
"Austin, TX") to disambiguate same-named places across states.

### Changed (mid-implementation pivot)

- **First pass shipped as one always-on merged-polygon layer (all 32,608
  boundaries in a single precomputed buffer) and was reworked after it read
  as visual noise in review** — "clustered dots/blobs," not legible city
  shapes. One city's geometry (Austin, TX) was traced through the full
  pipeline and confirmed structurally correct; the actual problem was
  real-world city-boundary complexity (many small/fragmented polygons —
  Austin's own annexation history alone) combined with this app's
  line-only, no-real-width borders, becoming illegible at city-block scale
  with all 32,608 rendered simultaneously. Replaced with the search +
  on-demand single-outline shape described above.
- `scene/constants.ts`'s `CAMERA_MIN_DISTANCE` reduced from `GLOBE_RADIUS *
  1.35` to `* 1.05` (an earlier attempt at `* 1.005`, meant to resolve
  individual city polygons, packed the camera into the same thin geometry
  shell as the core sphere/country fill/borders/atmosphere and caused
  visible clipping artifacts at grazing angles — backed off). New
  `US_CITY_FOCUS_DISTANCE` constant for the closer framing a US city search
  flies to. `scene/Scene.tsx`'s camera `near` clip plane moved from `0.1`
  to `0.03` to match.

## v4.1.1 — Remove claimant callout marker, keep the highlight

Point release. A claimed GeoEntity's related-country overlay
(`ClaimsOverlayLayer.tsx`) still gets its dashed border + prominent fill
when the claimant role applies, but no longer a pulsing "CLAIMANT —
\<NAME\>" labeled marker — that stays only for the uncontested `'parent'`
role (e.g. Puerto Rico → USA), where there's no dispute for the highlight
alone to already communicate. A disputed claim reads clearly enough from
the highlight itself.

## v4.1 — Capitals and major world cities

New capability: 223 point-marker cities (195 national capitals + 28 other
major world cities) — Natural Earth's 1:50m populated places, filtered to
countries that resolve to one of the 193 registered UN members (cross-
checked against `countries-un193.json`'s own output, not just ISO-code
validity). Excludes 5 non-UN capitals present in the source (Vatican City,
Kosovo, Bermuda, Somaliland, Taiwan) rather than ship a dangling parent
country reference; South Sudan and Nauru have no capital flagged at this
resolution (see `BACKLOG.md`).

Point geometry is a first for this app's data pipeline — a single
coordinate has nothing to topologically simplify, so
`buildCitiesData.mjs` is the first `build:geo:*` script that skips
`topologyPipeline.mjs` entirely, and `scene/Cities.tsx` renders small
sphere markers with hover/select labels rather than the merged border/fill
geometry every polygon-based layer above uses.

### Added

- **`city`** — a seventh `GeoEntityType` (`src/data/types.ts`). Folded into
  the existing `GeoEntityRegistry`/`EntityResolver`/search/Tab-cycling
  plumbing rather than given its own top-level `ResolvedEntity.kind`, even
  though its rendering treatment (point marker, not merged polygon) differs
  from every other classification — see that file's doc comment.
  Deliberately **not** wired into `CategoryHighlightLayer.tsx`/
  `LegendPanel.tsx` the way the other six classifications are: that
  system's highlight visual (dashed border + fill overlay) is inherently
  polygon-shaped and has no honest equivalent for a point marker yet.
- `scripts/buildCitiesData.mjs` (`npm run build:geo:cities`, part of the
  default `build:geo` chain).
- `scene/Cities.tsx` / `scene/useCitiesFeatures.ts` — point-marker
  rendering and registry population, fully selectable/searchable.
- `layers/geoOverlays/CitiesLayer.tsx` — registered with the Layer Engine
  under a new free-form category, `'population'` (`LayerPanel.tsx` never
  needed to know it exists), off by default.

## v4.0 — States/provinces: a second geographic classification, and the geo-data pipeline generalized to bring one in

New capability: 294 state/province boundaries across 9 large countries
(Australia, Brazil, Canada, China, India, Indonesia, Russia, South Africa,
United States) — Natural Earth's 1:50m admin-1 GeoJSON, vendored directly
since no npm package wraps it the way `world-atlas` wraps country (admin-0)
boundaries. Deliberately partial coverage, not a scope cut hiding a bug —
9 countries is what the 1:50m resolution actually covers well; the 1:10m
version of the same dataset covers every country and is the documented
upgrade path (swap the vendored file, rerun `npm run build:geo:states`).
Fully selectable/searchable/highlightable, same as a country.

This is the first dataset added to this app that comes from neither
`world-atlas` nor the hand-curated `data/registry/geoEntities.ts` — proving
out, end to end, the pattern a future formal Data Engine (see `CLAUDE.md`'s
Architecture section) would need: a new vendored source, a new build
script, and a new `GeoEntityType` member, without changing how any
existing consumer (`IntelligencePanel`, `SearchBar`,
`CategoryHighlightLayer`, `SelectionController`'s Tab-cycling,
`LegendPanel`) dispatches on entity kind, since all of them already
switch generically on `kind`/`type` rather than enumerating
classifications ad hoc.

### Added

- **`administrative-division`** — a sixth `GeoEntityType` (`src/data/types.ts`).
- `scripts/buildStatesProvincesTopology.mjs` (`npm run build:geo:states`,
  now part of the default `build:geo` chain) — reuses the shared pipeline
  from v3.3.2, generalized (`topologyPipeline.mjs`'s `readSourceFeatures()`)
  to accept a plain GeoJSON `FeatureCollection` alongside the TopoJSON
  `Topology` case every prior script fed it.
- `scripts/lib/iso3166.mjs` — a complete ISO 3166-1 alpha-3 → numeric
  country-code table, so a build script can resolve a province's parent
  country to its existing `CountryRegistry` id.
- `scene/StatesProvinces.tsx` / `scene/useStatesProvincesFeatures.ts` — same
  rendering approach as `GeoEntities.tsx` (merged-geometry-per-entity, same
  hover/select/dim palette), kept as its own file rather than generalizing
  `GeoEntities.tsx` for the same reason `Countries.tsx`/`GeoEntities.tsx`
  are already two files instead of one — this addition can't regress
  already-verified rendering behavior. Creates `GeoEntity` records directly
  from fetched geometry (mirroring `useCountryFeatures.ts`) rather than only
  mapping geometry onto an already-curated dataset the way
  `useGeoEntityFeatures.ts` does — 294 provinces don't warrant the
  per-entity research `geoEntities.ts`'s 56 hand-curated entities got.
- `layers/geoOverlays/StatesProvincesLayer.tsx` — registered with the
  existing Layer Engine, off by default in the Layer Panel.

## v3.3.2 — Shared build:geo pipeline

Point release: internal build-script refactor, zero runtime/UI change.
`scripts/buildCountryTopology.mjs` and `scripts/buildEntityTopology.mjs`
had grown nearly identical rebuild/presimplify/quantile/simplify/quantize
back halves; that shared machinery moved into
`scripts/lib/topologyPipeline.mjs`, with each script keeping only its own
per-layer feature filtering/matching logic. Verified zero behavior change
— both generated JSON assets are byte-identical to their pre-refactor
output. First step of the geo-data-engine roadmap's build-pipeline
generalization (see `GEO_ENGINE_README.md`), needed once a third
topology-building script (states/provinces, next) would otherwise have
duplicated the same back half a second time.

## v3.3.1 — Ambient rotation becomes a persistent toggle

Point release: changes how the globe's idle ambient rotation is controlled,
without adding a new panel or interaction mode. Previously the globe always
auto-rotated while nothing was selected and froze the instant something
was selected, with no user control over that behavior at all. Ambient
rotation is now off by default and controlled directly by the user with a
new **T** key binding (`settingsStore.ts`'s `ambientRotationEnabled`,
default `false`) — replacing the old "stop while selected, resume on
deselect" heuristic in `scene/CameraControls.tsx`/`scene/Globe.tsx`, which
had no persistent state of its own and inferred the right behavior from
selection changes instead. Camera flights (`useCameraFlight.ts`,
`useCameraReset.ts`) still force rotation off for their own duration, then
restore whatever the setting is currently set to, rather than
unconditionally turning it back on. `SettingsPanel.tsx`'s keyboard
shortcuts reference lists the new binding.

## v3.3.0 — Category highlighting, and subtler markers

New capability (category highlighting is a new interaction/visualization
mode) plus a quality-of-life fix to two existing markers. Kept as "3.3"
rather than a new major-version number for the same reason v3.1.0/v3.2.0
were — deepens the existing Layer Engine rather than introducing a new
engine.

### Added

- **`layers/geoOverlays/CategoryHighlightLayer.tsx`**: six new Layer Engine
  layers (SOVEREIGN STATES, GEOPOLITICAL ENTITIES, TERRITORIES, STRATEGIC /
  MILITARY REGIONS, MARITIME FEATURES, GEOGRAPHIC REGIONS), each
  highlighting every entity in that one classification at once, independent
  of and simultaneous with whatever's currently selected. Registered as
  six ordinary toggles (not a single mutually-exclusive picker) — enabling
  more than one at once (e.g. "sovereign states" + "strategic regions"
  together) just works, and `LayerPanel.tsx` needed zero code changes since
  it already renders whatever's registered generically. `hud/LegendPanel.tsx`
  gained a CATEGORY HIGHLIGHT row, shown whenever any of the six is enabled.
- `scene/countryEntries.ts`: `buildCountryEntries()`, the "raw country
  feature → border/fill geometry" builder factored out once a second
  consumer needed it (`ClaimsOverlayLayer.tsx`'s related-country rendering
  used to build this inline; `CategoryHighlightLayer.tsx`'s sovereign-state
  highlight needed the identical thing). Mirrors `geoEntityEntries.ts`'s
  `buildGeoEntityEntries()` for the GeoEntity side.
- `scene/PointerMarker.tsx`: a shared "pulsing dot + leader line + label"
  callout, extracted after two independent complaints about the same
  underlying pattern (see "Fixed," below) — `Globe.tsx`'s `CapitalMarker`
  and `ClaimsOverlayLayer.tsx`'s related-country marker both now render
  through this one, tuned component instead of each carrying its own
  slightly-different, oversized copy.

### Fixed

- **Capital markers and claimant/parent-country markers were reported as
  too large and their callouts swinging too far from the globe surface,
  obscuring the view around small entities** (Puerto Rico was the reported
  case). Both markers' dot radius, callout distance
  (`GLOBE_RADIUS × 1.3`/`1.32` → `× 1.1`), diagonal swing (±9-10° → ±4°),
  and pulse amplitude are all reduced in the new shared
  `scene/PointerMarker.tsx` — a deliberate, across-the-board resizing, not
  a per-marker patch, so the two can't drift back out of sync with each
  other the way their previous independent implementations had.

### Notes

- "Only military territories, only sovereign territories" from the
  request maps to this app's existing six-way classification
  (`'country'` for sovereign states, `'strategic-region'` for
  military/strategic significance — see `data/types.ts`'s `GeoEntityType`)
  rather than new category concepts of their own. Flagged in `BACKLOG.md`
  for confirmation, same as other wording interpretations in this project's
  history.

## v3.2.0 — Keyboard Navigation & Entity Selection ("Phase 3.2")

New capability — a new interaction mode (this repo's own versioning note
above says that's a major-version-tier change; kept as "3.2" specifically
per this feature's own "Phase 3.2" naming rather than bumped to v4, since
it deepens the existing Rendering/Layer engines' input handling rather than
introducing a new engine of its own — see `CLAUDE.md`'s new "Input Layer"
section for the reasoning).

Entirely additive: every existing system (globe rendering, Country/GeoEntity
registries, Layer Engine, HUD, camera, mouse selection) is unchanged and
untouched at the logic level — see `LOGBOOK.md` for the one place this
required a small, deliberate extension (`selectEntity`'s new optional third
argument) rather than a pure addition, and why it doesn't change any
existing caller's behavior.

### Added

- **`src/input/`** — a new top-level module, parallel to `scene/`/`hud/`/
  `data/`/`entities/`/`layers/`: `types.ts` (the command vocabulary),
  `KeyboardController.ts` (the one global keydown/keyup listener, focus
  rules, key bindings), `SelectionController.ts` (the geographic-direction
  algorithm + Tab category cycling), `CameraController.ts` (WASDQE camera
  nudging + thin wrappers around existing reset/focus actions),
  `InputManager.tsx` (routes one-shot commands to the right system, mounted
  once from `App.tsx`).
- **Camera controls**: W/S zoom, A/D rotate, Q/E tilt (held-continuous,
  driven by `useFrame` the same way `useCameraFlight`/`useCameraReset`
  already animate the camera — spherical coordinates around the fixed
  globe-center target, clamped to the existing `CAMERA_MIN/MAX_DISTANCE`
  and `CAMERA_MIN/MAX_POLAR_ANGLE` bounds), R (reset view — the existing
  `resetView()`, same as Home/double-click-ocean/the toolbar button), Space
  (focus camera on the selection — the existing `flyToSelectedCountry()`,
  same as the panel's "FOCUS CAMERA" button).
- **Entity navigation**: arrow keys select the nearest entity in that
  geographic direction from the current selection, evaluated generically —
  great-circle bearing (kept only within a ±90° cone of the requested
  direction) then great-circle distance among what's left, over every
  currently-rendered country and GeoEntity. No entity names or ids appear
  anywhere in the algorithm itself. Tab/Shift+Tab cycle forward/backward
  through the six selectable categories (country + the five `GeoEntityType`
  values), landing on the alphabetically-first entity in each.
- **Inspector controls**: Enter opens the Intelligence Panel for the
  current selection; Escape is two-stage (closes the panel first, clears
  the selection on a second press); I toggles the panel; L toggles the
  Layer Panel; **/** opens search (see "S key conflict," below).
- `hud/SettingsPanel.tsx`: a "KEYBOARD SHORTCUTS" reference section,
  hand-written (not generated — the binding table is small and fixed, not
  data worth wiring through a store).
- `hud/CommandBar.tsx`: a SELECTED segment showing the current selection's
  name — synchronized automatically, since it reads the same
  `selectionStore.ts` every other consumer does.
- `utils/geo.ts`: `bearingBetween`/`angularDistance`/`normalizeAngle` —
  generic great-circle math, added alongside the existing lat/lng ⟷
  `Vector3` functions since `SelectionController.ts`'s algorithm needed it
  and nothing selection-specific belongs in it.

### Fixed / resolved during implementation

- **The spec bound `S` to both "zoom out" (Camera Controls) and "open
  search" (HUD Controls).** Asked the user directly rather than guessing;
  resolved to S = zoom out (keeps the WASD block coherent), search bound to
  `/` instead (the standard web convention for focus-search).

## v3.1.5 — Parent countries get the same visual treatment claimants already had

Point release. Fixes a real gap: selecting Curaçao never highlighted the
Netherlands — the "related country" overlay built in v3.1.0/v3.1.1 only
ever looked at `claimedBy` (claimants), never `parentEntity`, so every
uncontroversial dependency (~40 entries) had no visual counterpart at all
when selected, only the 19 disputed entities did.

### Fixed

- `ClaimsOverlayLayer.tsx`'s country-side overlay (previously "claimant
  countries only") now also resolves a selected GeoEntity's
  `parentEntity`, highlighting that country with the same dashed-blue-
  outline + prominent-fill treatment already used for claimants. One
  mechanism, two roles — the country gets a labeled marker reading
  "PARENT — NETHERLANDS" or "CLAIMANT — CHINA" (or both, joined, for the
  rare entity connected to a country both ways — Gibraltar is exactly this
  case: UK as parent, Spain as claimant, both shown simultaneously).
- Renamed accordingly: `HIGHLIGHT_COLORS.claimant` → `.relatedCountry`,
  the layer's Layer Panel label from "CLAIMS OVERLAY" to "RELATIONSHIPS
  OVERLAY" (id unchanged — `'claims-overlay'` — to avoid unrelated churn
  to `LegendPanel.tsx`'s lookup). `hud/LegendPanel.tsx` updated to match.
- Verified against the real dataset (not just read): Curaçao → Netherlands
  (parent), Taiwan → China (claimant, regression check), Gibraltar → both
  UK and Spain simultaneously with distinct role labels, Puerto Rico →
  USA (parent, no claimant). See `LOGBOOK.md`.

## v3.1.4 — Ten claim relationships corrected against real-world sources

Point release. `data/registry/geoEntities.ts` data correction, prompted by
an explicit list of gaps/errors — not a broad re-audit.

### Fixed

- **Added missing `claimedBy` entries**: Falkland Islands and South Georgia
  & South Sandwich Islands (Argentina), Gibraltar (Spain), British Indian
  Ocean Territory (Mauritius — backed by the ICJ's 2019 advisory opinion,
  subsequent UN General Assembly resolutions, and the 2024/2025 UK-Mauritius
  treaty negotiations), French Southern and Antarctic Lands (Madagascar's
  claim to the Îles Éparses, Mauritius's claim to Tromelin Island —
  separate sub-claims, not a claim to the whole territory), Palestine
  (Israel), and both Cyprus Sovereign Base Areas, Akrotiri and Dhekelia
  (Republic of Cyprus, on decolonization grounds predating and separate
  from the Cyprus Buffer Zone dispute).
- **Bajo Nuevo Bank / Serranilla Bank claimants corrected against the ICJ's
  2012 *Territorial and Maritime Dispute (Nicaragua v. Colombia)* ruling**:
  Nicaragua's claim to both banks was formally rejected by that judgment
  and is removed from both entries; Honduras separately recognized
  Colombian sovereignty over Serranilla in the 1986 Ramírez-López Treaty
  and is removed from that entry. The United States' 1856 Guano Islands Act
  claim — never formally relinquished for either bank — is added to both.
- `dependency()` (the shorthand constructor for the ~40 uncontroversial
  Territory entries) now accepts an optional `claimedBy` array, so a
  territory can have exactly one uncontested administering parent (no
  change needed there) while still carrying a real external sovereignty
  claim — the two facts are independent, and five entries now need both at
  once.
- `CLAIMS.md` regenerated: disputed-entity count goes from 11 to 19; every
  newly-affected UN member state's derived "Claims" line was verified
  individually (Argentina, Spain, Mauritius, Madagascar, USA, Israel,
  Cyprus each show the expected additions; Honduras/Nicaragua both now show
  "None"). See `LOGBOOK.md`.

## v3.1.3 — CLAIMS.md now covers all 193 countries and all 56 GeoEntities

Point release. Documentation-generator fix, not app behavior.

### Fixed

- **`CLAIMS.md` only listed the 11 entities with an active dispute** —
  correct for a "disputes register" but not what was asked for
  ("every country and entity on this list"). `scripts/generateClaimsDoc.mjs`
  rewritten to produce a complete roster: every UN member state (sourced
  from `public/geo/countries-un193.json`, the exact topology
  `useCountryFeatures.ts` fetches at runtime — not a second, hand-typed
  country list) and every registered GeoEntity, each showing its claim
  relationships or "None". The original filtered summary is kept as a
  "Summary: active disputes" section at the top, not replaced.
- **A GeoEntity's own `Claims` field is not reliably populated in this
  dataset** — every entity's explicit `claims` array is currently empty;
  the only claim relationships that exist are recorded as `claimedBy` on
  the *claimed* entity (e.g. Spratly Islands' `claimedBy` lists Taiwan;
  Taiwan's own `claims` array was never filled in to match). Reading
  `entity.claims` directly would have shown "Claims: None" for Taiwan
  despite it genuinely claiming Spratly Islands and Scarborough Reef. The
  generator now infers each entity's effective claims by inverting every
  `claimedBy` relation across the whole registry, so the roster is complete
  regardless of which side of a claim pair the data happens to be recorded
  on. See `LOGBOOK.md`.

## v3.1.2 — BACKLOG.md: everything flagged but not built, in one place

Point release. Documentation only — no `src/` runtime code changed.

### Added

- `BACKLOG.md` (repo root): hand-maintained, unlike `CLAIMS.md` — there's no
  structured data to generate a backlog from. Collects every "not yet
  implemented"/"needs a second look" item scattered across this session's
  `LOGBOOK.md`/`CHANGELOG.md` entries and `CLAUDE.md`'s "Planned" engine
  list into one place: unverified data (Bajo Nuevo/Serranilla claimants,
  the Gibraltar/Kosovo/Crimea judgment calls from v3.0.0), visualization
  approximations worth revisiting (the claims overlay's dash-as-hatching
  stand-in, `LegendPanel.tsx`'s hardcoded overlay-layer ids), each planned
  engine's actual (empty) status, and things never verified for lack of
  browser tooling this session (mobile layout, accessibility). Explicitly
  scoped to stay accurate: an item should move to `CHANGELOG.md` (and be
  deleted here) once it's actually built, not accumulate as stale aspiration.

## v3.1.1 — CLAIMS.md: a generated register of every claimant/claimed relationship

Point release. Adds a documentation artifact, not app behavior — no
`src/` runtime code changed.

### Added

- `CLAIMS.md` (repo root): every `GeoEntity` with a nonempty `claimedBy` or
  `claims`, listed two ways — by disputed entity ("Taiwan: claimed by
  People's Republic of China") and by claimant, inverted ("People's
  Republic of China: Scarborough Reef, Spratly Islands, Taiwan"). 11
  disputed entities, 25 distinct claimants as of this writing.
- `scripts/generateClaimsDoc.mjs` (`npm run docs:claims`): generates
  `CLAIMS.md` directly from `data/registry/geoEntities.ts` via
  `GeoEntityRegistry` — the same registry `EntityResolver`,
  `scene/GeoEntities.tsx`, and the `geoOverlays` layers all read at
  runtime. `CLAIMS.md` is a build artifact, not hand-maintained — same
  reasoning `public/geo/*.json` are generated from `geoEntities.ts`/
  `unMembers.ts` rather than hand-edited: one source of truth, no drift
  between what the doc says and what the app actually renders. Rerun
  whenever `geoEntities.ts` changes.
- `tsx` added as a real devDependency (previously only used ad hoc via
  `npx`). Needed because `geoEntities.ts`/`GeoEntityRegistry.ts` import
  each other with extensionless relative specifiers, which plain Node's
  built-in TypeScript support doesn't resolve — `scripts/buildEntityTopology.mjs`
  gets away with plain `node` only because `entityGeometryIds.ts` (the one
  `.ts` file it imports) has zero imports of its own. See `LOGBOOK.md`.

## v3.1.0 — Claimant countries get their own visual treatment, dashed claim borders, and a legend

Point release under v3 (same call v2.2.0's "Geometry Map" and v2.3.0 made
for themselves — see those entries: new files/behavior, but it completes
and explains a capability v3.0 already shipped, rather than introducing a
new one).

### Added

- **`ClaimsOverlayLayer.tsx` now renders both directions of a claim
  relationship, on two different geometry systems.** v3.0's claims overlay
  only ever highlighted other `GeoEntity` records — selecting China
  correctly flagged Taiwan/Spratly Islands/Scarborough Reef (all
  GeoEntities), but selecting Taiwan showed nothing at all for China,
  because China is a `Country`, rendered by a completely separate component
  (`Countries.tsx`) on completely separate geometry (`useCountryFeatures()`,
  not the GeoEntity topology). `ClaimantCountriesOverlay` (new, same file)
  fetches country features directly and highlights whichever countries
  appear in the selected GeoEntity's `claimedBy` with `ref.type ===
  'country'` — a **new, deliberately distinct visual convention**: a dashed
  blue outline (blue, not the claimed side's magenta) with a prominent
  fill covering the claimant's whole area (not just a thin outline), plus a
  pulsing marker with an explicit "CLAIMANT — <NAME>" text label, so the
  two directions of the same relationship never look like the same fact
  pointed two ways.
- `scene/highlightColors.ts`: the single source of truth for every
  highlight/selection color the globe renders, including the new
  `claimant` entry. `Countries.tsx`, `GeoEntities.tsx`,
  `ParentOverlayLayer.tsx`, and `ClaimsOverlayLayer.tsx` all now import
  their colors from here instead of independent hex literals — the same
  values `hud/LegendPanel.tsx` (below) explains, so the two can never drift
  apart.
- `hud/LegendPanel.tsx`: an always-on panel (not a Toolbar toggle — see the
  file for why) explaining what each on-globe color means: UNSELECTED /
  HOVERED / SELECTED always shown; TERRITORY shown while the territory
  overlay is enabled; CLAIMED and CLAIMANT shown together while the claims
  overlay is enabled. Stacked with `Telemetry.tsx` in a shared bottom-left
  flex column in `App.tsx` — the one corner that stays visible regardless
  of selection state, since `IntelligencePanel.tsx` covers the entire right
  edge (`inset-y-0 right-0`) the whole time something's selected, which is
  exactly when the overlay colors this legend explains are on screen. See
  `LOGBOOK.md`.

### Changed

- `ClaimsOverlayLayer.tsx`: the GeoEntity-vs-GeoEntity "hatching style" is
  now a real dashed border (`LineDashedMaterial`) instead of v3.0's
  pulsing-solid-line approximation. `scene/geoEntityEntries.ts`'s
  `buildGeoEntityEntries()` now precomputes each entry's border geometry
  `lineDistance` attribute (`computeLineDistances()`, ported from
  `THREE.Line`'s own implementation since that method only exists on a
  `Line`/`LineSegments` *instance*, not a bare `BufferGeometry`) so every
  entry is dash-ready without the overlay layer needing to do anything
  beyond picking `<lineDashedMaterial>`.
- `ParentOverlayLayer.tsx`: no visual change here beyond sourcing its green
  from the new shared palette — it already matched the "green highlight"
  ask as of v3.0.1.

## v3.0.1 — Fixing the bug that made both v3 overlays silently do nothing

Point release. v3.0.0 shipped `ParentOverlayLayer`/`ClaimsOverlayLayer` as
real Layer Engine layers, but every `toCountry()` reference in
`geoEntities.ts` used an ISO 3166-1 **alpha-3** code (`'USA'`, `'CHN'`) while
this app's actual Country Registry ids — and therefore `selected.id`
whenever a country is clicked — are the raw **numeric** ISO 3166-1 codes
straight from `world-atlas`'s source topology (`'840'`, `'156'`; see
`scene/useCountryFeatures.ts`, which never remaps them). Every equality
check the two overlays depend on (`parentEntity.ref.id === selected.id`,
`claimedBy[].ref.id === selected.id`) therefore never matched anything —
clicking United States or China rendered no overlay at all, architecture
correct, data silently disconnected from it. See `LOGBOOK.md` for how this
was found and verified.

### Fixed

- `data/registry/geoEntities.ts`: added `ISO_ALPHA3_TO_NUMERIC`, a lookup
  `countryRef()` now resolves through — every `toCountry()` call site keeps
  its human-readable alpha-3 code, but the `EntityRef` it produces now
  carries the actual numeric id the rest of the app uses. Verified against
  the real dataset: selecting China (`"156"`) now surfaces exactly
  `taiwan`/`spratly-islands`/`scarborough-reef` as claims-related; selecting
  the United States (`"840"`) now surfaces its 6 registered dependencies as
  parent-overlay children.
- `ParentOverlayLayer.tsx`: color changed from violet (`#B98CFF`) to green
  (`#39FF6A`, matching the spec's "like a green highlight"); fill opacity
  raised from 0.12 to 0.28 so it reads as an actual highlight rather than a
  faint tint.
- `ClaimsOverlayLayer.tsx`: `defaultEnabled` changed from `false` to `true`
  — the v3 spec's "when enabled" describes the layer being a toggle (still
  listed, still switchable off in the Layer Panel), not a requirement that
  it start off and stay undiscovered. Fill opacity raised from 0.06 to 0.1.

## v3.0.0 — Every entity type isn't a country: the GeoEntity system

New major version — expands the geopolitical data architecture and Entity
Resolution foundations v2.1-v2.3 laid down (still inside `src/data/` and
`src/entities/`; this doesn't stand up a new top-level engine directory)
beyond "Territory is the only non-sovereign classification that exists."
Those versions built the Territory Registry, Entity Resolution, and Geometry
Map specifically to generalize past countries, but only ever had one
non-sovereign shape (Territory: dependencies + disputed areas) to prove it
against. v3 replaces that single shape with `GeoEntity` — one interface, discriminated by a
`GeoEntityType` (`geopolitical-entity` | `territory` | `strategic-region` |
`maritime-feature` | `geographic-region`), covering everything from
de-facto/partially-recognized states (Taiwan, Kosovo, Palestine, Western
Sahara) to overseas dependencies (Puerto Rico, Hong Kong, Greenland, and 36
more), military installations (Guantanamo Bay, the Cyprus Sovereign Base
Areas, Baikonur), disputed maritime features (the Spratly Islands,
Scarborough Reef), and treaty-governed regions (Antarctica) — 56 entities in
total, 55 with real rendered geometry (only Crimea stays geometry-less, for
the same "no standalone polygon anywhere in the source data" reason it's had
since v2.3.0).

This reduces future complexity the way `CLAUDE.md`'s versioning note asks a
new major version to: any future non-sovereign entity kind (a UN trusteeship,
a breakaway region, whatever comes next) is a new `GeoEntityType` value and a
few `registerEntity()` calls, not a new registry/resolver/renderer/search
block/panel component the way going from Country to Territory once was, and
the way Territory to a second non-sovereign shape would have been again
without this generalization.

### Added

- `GeoEntity` (`src/data/types.ts`): one interface for all five non-sovereign
  classifications, with a uniform relationship shape —
  `parentEntity`/`administeredBy`/`claimedBy`/`claims`, all built from the
  same `GeoEntityRelation` (`ref` optional, `displayName` always present —
  carried forward from the pre-v3 `ControllingAuthority`/`TerritoryClaimant`
  design). Replaces the Territory-only `Territory`/`ControllingAuthority`/
  `TerritoryClaimant` types.
- `src/data/registry/GeoEntityRegistry.ts`: `registerEntity`/`getEntity`/
  `getEntities`/`getEntitiesByType`/`getRelatedEntities` — the last one new
  (no Territory-Registry equivalent existed): walks every relationship field
  in both directions to answer "what's connected to this entity at all,"
  for the claims overlay and any future relationship-graph consumer.
  Replaces `TerritoryRegistry.ts`.
- `src/data/registry/geoEntities.ts`: the real dataset — 56 entities, real
  parent/administration/claim relationships for the ones the source data
  supports (see the file for the full list and its sourcing caveat).
  Replaces `registry/territories.ts`.
- `src/entities/entityGeometryIds.ts`: extends the pre-v3 numeric-id-only
  lookup with a second map for the eleven entities that have no numeric id
  in `world-atlas`'s source data at all (Kosovo, both Cyprus Sovereign Base
  Areas, Guantanamo Bay, Baikonur, the Cyprus UN Buffer Zone, Siachen
  Glacier, and four disputed maritime features) — matched by raw source
  name instead, and stamped with their target entity id before the topology
  rebuild. Replaces `territoryGeometryIds.ts`.
- `scripts/buildEntityTopology.mjs` (`npm run build:geo:entities`): same
  pipeline as the pre-v3 territory build, extended to match features by name
  as well as numeric id. Produces `public/geo/entities.json` (55 features,
  ~176KB). Replaces `buildTerritoryTopology.mjs`.
- `src/scene/geoEntityEntries.ts` / `src/scene/GeoEntities.tsx`: renders
  every GeoEntity with real geometry — same merged-geometry-per-entity
  approach, same palette, same click/hover/select behavior as
  `Countries.tsx` — with **primary selection only**. Replaces
  `useTerritoryFeatures.ts`/`Territories.tsx`.
- `src/layers/geoOverlays/` (`ParentOverlayLayer.tsx`, `ClaimsOverlayLayer.tsx`):
  the "parent relationship overlay" and "claims overlay" from the v3 spec,
  built as real Layer Engine layers rather than logic inside
  `GeoEntities.tsx` — the first non-placeholder layers the Layer Engine has
  ever hosted, exercising the "real layer set" composition point
  `CLAUDE.md`'s Layer Engine section had anticipated but never used.
  `ParentOverlayLayer` (default **on**) highlights a selected sovereign
  state's dependent GeoEntities in a secondary color. `ClaimsOverlayLayer`
  (default **off** — the spec frames claims as opt-in) highlights every
  entity in a claim relationship with the current selection, in a color
  never reused elsewhere on the globe, with zero fill (never the same
  treatment as the primary selection).
- `IntelligencePanel.tsx`'s `GeoEntityDetails`: one panel layout for all five
  classifications (ENTITY TYPE / PARENT ENTITY / ADMINISTERED BY / CLAIMED
  BY / CLAIMS / plus strategic/treaty metadata where present), replacing the
  Territory-only `TerritoryDetails`.
- `SearchBar.tsx` now returns all six kinds (country + five `GeoEntityType`
  values), tagged accordingly in the dropdown.

### Notes

- Countries (`SovereignState` in the spec) are explicitly unchanged —
  `CountryRegistry`, `Countries.tsx`, and the UN-193 pipeline weren't
  touched.
- Normal-selection behavior (click an entity, only it highlights — no
  automatic selection of claimants/parents) required no new code: it's just
  what `selectEntity()` already did. The two overlays are additive emphasis
  layers on top, not a replacement for it.
- See `LOGBOOK.md` for the judgment calls this version's spec left open
  (Gibraltar, Crimea's classification, which real-world parent/claimant
  relationships were added beyond the spec's explicit list) and why they
  were resolved the way they were.

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
