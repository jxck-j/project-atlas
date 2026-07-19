# Logbook

A running record of meaningful discoveries, non-obvious bugs, and changes of
approach — the *why* behind decisions in the code, for whenever "wait, why did
we do it this way?" comes up later. Not a changelog (see `CHANGELOG.md` for
user-facing *what changed*); this is the debugging/reasoning trail.

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
