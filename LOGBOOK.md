# Logbook

A running record of meaningful discoveries, non-obvious bugs, and changes of
approach — the *why* behind decisions in the code, for whenever "wait, why did
we do it this way?" comes up later. Not a changelog (see `CHANGELOG.md` for
user-facing *what changed*); this is the debugging/reasoning trail.

## 2026-07-19 — v2.0: Layer Engine architecture

**Why split Registry, Store, Manager, and Engine into four pieces instead of
one file.** They change for different reasons and at different rates: the
Registry is a static catalog (what layers *exist*, populated once at import
time); the Store is runtime state (what's *enabled right now*, changes on
every toggle); the Manager is rendering/lifecycle logic (how enabled layers
actually get mounted/unmounted/isolated); the Engine is the public seam
(`Globe.tsx`'s only integration point). Collapsing these would work today
with three placeholder layers, but the whole point of this version is
future engines (Country, Relationship, Intelligence, Data, Timeline) being
able to register layers without caring how mounting/toggling works — that
requires the contract (Registry) to stay decoupled from the mechanism
(Manager).

**Category is a free-form string, not a closed union.** First draft used a
`LayerCategory` union (`'geography' | 'infrastructure' | 'conflict' | ...`)
with a `CATEGORY_LABELS` lookup table in `LayerPanel.tsx`. That meant every
future engine introducing a new grouping (a Timeline Engine's layers might
want a "temporal" category, say) would have to edit a HUD file it has no
other reason to touch — exactly the coupling this version exists to remove.
Switched to a plain string, displayed as-is (uppercased) in the panel. Costs
autocomplete/typo-safety on the category field; worth it for not needing to
touch `LayerPanel.tsx` to add a category.

**Registration happens as an import side effect, not an explicit call from
some central setup function.** A layer module calls `registerLayer()` at its
own top level, and the only thing that "installs" it is one import line in
`placeholders/index.ts`. This only works because ES module evaluation runs
the entire import graph before React renders anything — so as long as
*something* reachable from `main.tsx` imports the barrel (`src/layers/index.ts`,
which imports `LayerEngine.tsx`, which imports `placeholders/`), registration
is guaranteed complete before any component that reads the registry actually
renders, regardless of which file happens to import which first. Documented
this explicitly in `CLAUDE.md` because it's the kind of thing that looks like
a race condition until you think through module evaluation order.

**Per-layer error boundaries, even though v2.0 has no real layers yet.** Added
`LayerErrorBoundary` (a class component — no hook equivalent exists) wrapping
each mounted layer individually. Not strictly required for three placeholder
markers that can't fail, but "future layers should be addable without
modifying Globe.tsx" implies those future layers (live APIs, databases,
whoever writes them) shouldn't be able to take the whole globe down if they
have a bug. Cheap to add now, much more annoying to retrofit once several
real layers depend on the current no-isolation behavior.

**`LayerPanel.tsx` lives in `hud/`, not `layers/`.** Everything else in the
Layer Engine lives together in `src/layers/` (types, registry, store,
manager, engine), but the toggle UI follows the existing rule that all
DOM/Tailwind HUD panels live in `hud/` (see `CLAUDE.md`'s "Two-layer split")
and import whatever scene-side state they need — `LayerPanel.tsx` imports
from `'../layers'` the same way `SettingsPanel.tsx` imports from
`'./settingsStore'`. Kept the engine's own directory scene-only rather than
mixing HUD components into it.

**Only three placeholder layers, not one per forbidden topic.** The spec
listed a long list of things not to build (terrain, rivers, military bases,
hospitals, oil fields, ports, airports, conflict visualization, relationship
arcs, live APIs, ...). Rather than one placeholder per item, built three
spanning distinct categories (geography/terrain, infrastructure, conflict) —
enough to prove the registry groups by category correctly and that multiple
layers can be enabled simultaneously without interference, without padding
the placeholder set past what's needed to validate the architecture.

## 2026-07-18 — Initial build session

**Antimeridian triangulation bug (Russia, and any country crossing ±180°).**
`earcut` triangulates in flat lng/lat space. A ring that crosses the
antimeridian (Russia's Far East, Fiji) alternates between longitudes near
+180 and -180; without unwrapping, earcut reads that as a polygon spanning
the *entire* globe and produces garbage triangles. Confirmed with
`earcut.deviation()`: 1.85 (badly wrong) before a fix, ~0 after. Fix: shift
each ring's longitudes by ±360° increments so consecutive points stay within
180° of each other, before triangulation, before border-line projection, and
before centroid calculation. See `unwrapRingLongitudes`/`unwrapPolygonRings`
in `countryGeometry.ts`.

**Click-through to the wrong hemisphere.** Country fill meshes used
`DoubleSide`. When a pointer ray missed every near-hemisphere country (e.g. a
gap over open ocean at low simplification), it would keep going through the
globe and hit a *different* country's back-facing triangles on the far side —
so a click could select a country nowhere near the cursor. Fix: `FrontSide`
only. Verified the fix wouldn't just make everything unclickable by checking
triangle winding direction first (57/59 sample triangles outward-facing,
confirming normals point the right way for `FrontSide` to work).

**Duplicate feature IDs collided three countries into one.** Kosovo, N.
Cyprus, and Somaliland all have no numeric `id` in the source topology.
`String(f.id)` gave all three the literal string `"undefined"` — they
compared equal for selection purposes and shared a React key, so selecting
one would sometimes visibly select/highlight another. Fix: fall back to
`` `feature-${index}` `` (always unique) instead of trusting `String(f.id)`
alone. Worth checking for this pattern anywhere else features get keyed by id.

**"All 193 UN members" needed the 10m dataset, not 110m/50m.** world-atlas's
pre-baked lower resolutions silently drop several small member states as
separate polygons entirely (Malta, Singapore, Nauru, Tuvalu, Marshall
Islands, ...) — they're too small to survive that level of simplification.
Had to start from full 10m detail and do our own filtering + simplification
in `scripts/buildCountryTopology.mjs` to get all 193 without losing any.

**Rebuilding a topology without quantization makes it *bigger*, not smaller.**
First attempt at `buildCountryTopology.mjs`: filter to 193 features, rebuild
via `topojson-server`'s `topology()`, simplify, write out — result was 5.9MB,
*larger* than the original 3.6MB 10m source. Two things needed fixing:
(1) `topology()` needs an explicit quantization argument or it emits raw
floating-point coordinates instead of the source's delta-encoded integers;
(2) `presimplify()` strips delta-encoding entirely to compute simplification
weights, and `simplify()` doesn't restore it — the output has to be
re-quantized afterward (`topojson-client`'s `quantize()`) or it's stored as
full-precision floats. Final result: 1.3MB, correctly smaller.

**The real performance bottleneck was draw call count, not vertex density.**
After switching to the UN-193 dataset at full 10m detail, the app dropped to
~25fps. First fix (coastline simplification via the quantization work above,
plus disabling antialiasing/lowering `dpr`) helped but didn't solve it.
Actually profiling draw calls (instrumenting `drawElements`/`drawArrays` on
the WebGL context) found ~5,700 draw calls *per frame* — because countries
with multiple islands/holes/exclaves were rendering one `<Line>`/`<mesh>` per
ring/polygon: 193 countries produced 3,625 border-line objects + 3,609
fill-mesh objects. Merging each country's rings into one `lineSegments` and
its polygons into one `mesh` cut that to 386 objects total and fixed the
frame rate. Lesson: profile draw calls before assuming vertex/triangle count
is the bottleneck at this kind of object-count scale. Tradeoff taken: native
`LineBasicMaterial` ignores `linewidth` on essentially every platform, so
border hover/select emphasis lost its thickness cue and relies on
color/opacity only now.

**`frameloop="never"` + manual `advance()` needs seconds, not milliseconds.**
Added a hard 60fps cap by disabling R3F's own render loop and driving it
manually via `advance(timestamp)` on a throttled `requestAnimationFrame`.
Passed the raw rAF timestamp (milliseconds) straight through — `advance()`
feeds it directly into `state.clock.elapsedTime`, which Three.js's `Clock`
(and everything that reads `delta` from it: ambient rotation, OrbitControls
autoRotate/damping, camera flights) tracks in seconds. Every computed delta
came out ~1000x too large, and the globe spun wildly. Fix: `advance(time /
1000)`.

**`Html`'s `occlude` prop occludes against everything by default, not just
what you'd expect.** Water body labels used `occlude` to hide themselves on
the far side of the globe, but with no ref array it raycasts the whole scene
— including the atmosphere glow shells, which sit in front of every label
regardless of which hemisphere it's on. Result: no water labels ever showed,
on either side. Fix: `occlude={[coreSphereRef]}`, occluding against
specifically the core sphere rather than the whole scene graph.

**Capital markers and country-name labels can land on top of each other.**
A country's capital is often close to its geographic centroid — exactly
where the country-name hover label anchors. A purely radial leader-line
callout for the capital put both labels in nearly the same screen position
at normal zoom. Fix: offset the capital's callout diagonally (shift lat/lng,
not just push the radius out) so the two leader lines visibly diverge.
