# Logbook

A running record of meaningful discoveries, non-obvious bugs, and changes of
approach — the *why* behind decisions in the code, for whenever "wait, why did
we do it this way?" comes up later. Not a changelog (see `CHANGELOG.md` for
user-facing *what changed*); this is the debugging/reasoning trail.

## 2026-08-09 — v5.2.1: `Html`'s raycast `occlude` never actually hid a far-side water label

**Reported as: "I can see the ocean wording through the globe" — Indian
Ocean visible from the USA, Gulf of Mexico visible from the Indian Ocean.
Not an edge/terminator glitch — every water body, every zoom level,
static or moving.** `WaterLabels` (`Globe.tsx`) hid far-side labels by
passing `occlude={[coreSphereRef]}` to `Html`, which runs a per-frame
raycast from the camera to each label's anchor point and toggles
`display: none` on a miss/hit. Manually inspecting the DOM
(`getComputedStyle`/the inline `display` drei sets) across several camera
positions initially showed *correct* `display: none` toggling, which
briefly suggested no bug existed — but that only held for the handful of
static states tested; the report was that it doesn't hold up in real,
continuous interaction.

**Root-caused by comparison, not by debugging the raycast itself.**
`CountryLabels.tsx` and `UsCityLabels.tsx` both solve this exact "is this
point on the near or far hemisphere" problem already, and *don't* use
`occlude` — they use `labelDeclutter.ts`'s analytic dot-product test
(`isCandidateVisible`/`projectToScreen`'s `onNearSide` check) instead,
with an explicit comment on `UsCityLabels.tsx` explaining the raycast
prop is deliberately unused because the analytic test already excluded
far-side candidates. `Lakes.tsx` (v5.2.0) actually runs *both* — it
already calls `declutterLabels` (analytic) before ever reaching `Html`,
then also passes `occlude` redundantly on top, which is why its lake-name
labels never displayed the reported symptom: the analytic filter alone
was already doing the real work, and the redundant `occlude` prop was
inert. `WaterLabels` was the *only* consumer of this app's front/back
test still depending on `occlude` alone for it, and the only one
reported broken — strong evidence the raycast approach itself is what's
unreliable here (never isolated exactly why; `frameloop="demand"` making
`Html`'s internal occlusion `useFrame` run at some indeterminate cadence
relative to camera movement is the leading suspect, not confirmed).

**Fix:** gave `WaterLabels` the same analytic check, dropping `occlude`
entirely — no new mechanism, just stopped being the one holdout using a
different, broken one. Needed the same `rotationY` compensation
`CountryLabels.tsx` already has: `WaterLabels` renders inside `Globe.tsx`'s
ambient-rotation group, so a label's local (pre-rotation) position isn't
its current *world* position, which the camera-relative analytic math
needs — `getGlobeRotationY()` supplies the current spin to reconstruct it,
exactly as `CountryLabels.tsx` already does for the same reason. Worth
remembering: when two components solve the same "is this visible" problem
with two different mechanisms and only one is reported broken, check
whether the working one's approach just needs porting over before
debugging the broken mechanism itself.

## 2026-08-08 — v5.2.0: a tinted fill over solid land reads as wrong, even when the tint is "correct"

**Lakes' first implementation was a translucent blue fill, and it looked
like a bug even though the geometry was right.** Country/state fill meshes
have no interior holes anywhere — confirmed on the US polygon specifically
— so a lake polygon drawn on top of one, translucent, still shows solid
land tinted blue through it rather than open water. The honest fix is a
geometric cutout (subtract lake polygons from country/state polygons at
build time), rejected for this pass as too large: a new polygon-clipping
dependency, touching the core country/states build pipeline that
`countryGeometry.ts`'s test coverage (v4.3.1) exists specifically to guard.
Landed on opaque pitch-black fill instead — same color as the ocean/core
sphere, so a lake reads as real open water regardless of what's
underneath, without touching land geometry at all. Deferred to
`BACKLOG.md` rather than treated as solved.

**Rivers are the first geometry type in `countryGeometry.ts` with no ring
and no interior.** Every function there — `geometryToBorderSegments`,
`geometryToFillMesh`, even the antimeridian unwrapper they both call —
assumes a `Polygon`/`MultiPolygon`. A `LineString` river has neither a
ring to close nor an interior to triangulate; calling the existing
polygon functions on one silently returns empty output (well-formed,
no crash, just nothing rendered — worth remembering as a debugging trap:
"nothing rendered" doesn't always mean the fetch/registration failed).
New `geometryToLineSegments` walks the line's own points directly,
reusing the antimeridian-unwrap and per-segment projection logic but
skipping the ring-closing step polygons need.

**A Layer Engine-mounted component can't receive a prop the way a direct
child of `Globe.tsx` can.** `WaterLabels` occludes its `Html` labels
against the core sphere via a ref passed down as a prop — straightforward,
since it's rendered directly inside `Globe.tsx`. `Lakes.tsx`/`Rivers.tsx`
mount through the Layer Engine instead (`LakesLayer.tsx`/`RiversLayer.tsx`
-> `LayerManager.tsx`), several component boundaries away from
`Globe.tsx`'s own JSX, so there's no prop path down to them at all. Fix
mirrors `globeRotation.ts`'s existing scene-to-HUD pattern in the opposite
direction: `coreSphereRef.ts` exports a plain `{ current }` box at module
scope; `Globe.tsx` assigns its core sphere mesh's `ref` prop to that
export directly instead of a local `useRef`, and `Lakes.tsx`/`Rivers.tsx`
import the same object. Worth remembering as the general answer whenever
a Layer Engine component needs something only `Globe.tsx` itself holds a
ref to.

## 2026-08-08 — v5.1.0: the black hole was a flat triangle sagging below a curved sphere

**Root cause of the v5.0.0 black-gap defect, finally found.** Every
explanation the earlier investigation ruled out (triangulation error, flipped
winding, a missing-geometry gap, an overlapping GeoEntity) was checked
correctly — the defect was never in `earcut`'s 2D triangulation at all. It's
a projection problem: earcut can legitimately produce one "ear" triangle
spanning 20-30+ degrees of arc to cover a wide concave notch in a country's
coastline. The GPU renders every triangle as a flat plane between its three
projected corners — it has no idea the surface it's approximating is a
sphere. For a triangle that wide, the flat plane's middle sags measurably
*inward* from the sphere's true curved surface. Measured directly against
Brazil's actual worst-offending triangle (extracted from the real shipped
`countries-un193.json`, not a synthetic case): it dipped **3.04% of
`GLOBE_RADIUS`** below the nominal fill radius — comfortably past the opaque
core sphere sitting only ~2% inward (`Globe.tsx`'s `RADIUS * 0.98`), which
then occludes the sagging patch from the camera.

**Confirmed the mechanism, not just the correlation, before writing the
fix.** Rather than patching based on "the worst offenders are the
highest-vertex-count countries" (the only lead the original investigation
had), this pass wrote a standalone script projecting the real triangle's
three corners through the exact `latLngToVector3` formula, linearly
interpolated across the flat triangle in 3D (matching what the GPU
rasterizer actually does), and measured the resulting radius at the
interpolated midpoint directly. That's what turned "probably a
big-country-shaped coincidence" into "here is the exact geometric
mechanism, here is the exact percentage, here is why 2%-inward is the
threshold that matters."

**Fix: recursive triangle subdivision keyed on measured sag, not a fixed
angular threshold.** `countryGeometry.ts`'s `emitTriangle()` computes actual
chord sag (project the triangle's 3 corners, sample the 3 edge midpoints +
centroid, compare each sample's radius against the nominal one) and splits
the longest edge (in lng/lat space — safe because `unwrapPolygonRings()`
already resolved any antimeridian wraparound before earcut ever ran)
whenever the sag exceeds a safe fraction of the radius, recursing on the two
resulting triangles. A fixed angular threshold (e.g. "split any triangle
wider than 10°") would have been a proxy for the real constraint; measuring
the actual projected sag is exact and self-documenting.

**A depth cap chosen without checking convergence first can silently
under-subdivide.** The first version capped recursion at depth 8 and looked
fine against Brazil's real triangle — sag came in right at the edge of the
safe threshold. A deliberately more obtuse synthetic test triangle (added to
`countryGeometry.test.ts` specifically to stress this) failed at depth 8 and
needed depth 9 to actually converge — longest-edge bisection only shrinks
the *one* edge it picks each split, so a scalene/obtuse triangle's other two
edges carry over unchanged into each child, and convergence isn't the flat
"halves every edge every level" intuition suggests. Depth cranked to 14 for
real margin over both cases; the added cost is negligible (Brazil's mainland
went from 3,610 to 3,984 triangles — only the handful of bad "ears" needed
splitting, not the whole mesh).

**Same session, three other tuning changes landed alongside the fix** (see
`CHANGELOG.md`'s v5.1.0 entry for the user-facing description of each):
the core sphere (ocean) is now always fully opaque and pitch black instead
of a translucent-while-idle navy shell; the lat/long graticule grid is
removed outright; and `highlightColors.ts`'s 7-slot palette moved from
v5.0.0's blue/cyan/violet family (reported as reading too similar to
distinguish at a glance — 5 of 7 slots were shades of the same few hues) to
one ROYGBIV spectrum hue per slot, validated with the dataviz skill's
palette checker against the app's actual near-black surface rather than
picked by eye.

## 2026-07-28 — v5.0.0: a country's fill mesh can raycast correctly, triangulate perfectly, and still render as a black hole

**Raising a country's fill opacity from ~5% to solid surfaced a real,
previously-invisible rendering defect.** While trying a navy-land/charcoal-
water/gold-border restyle of the globe (a session detour that was ultimately
reverted — see below), a chunk of Brazil's interior rendered as an opaque
black gap instead of the country's fill color. Once flagged, the same defect
was confirmed on Russia, Canada, USA, Australia, and Antarctica. It had
presumably always been there; `EntityRenderLayer.tsx`'s default fill opacity
(0.05) was low enough that nobody had ever noticed.

Diagnosing it black-box (no WebGL frame debugger available, and
`countryGeometry.ts` is under a standing "no changes without sign-off"
constraint, so this stayed read-only) ruled out every explanation that
usually causes a hole in a triangulated fill:
- **Not a triangulation defect** — `earcut.deviation()` against the actual
  shipped `countries-un193.json` came back ~1e-15 for all 43 of Brazil's
  MultiPolygon sub-polygons and all 214 of Russia's. A real triangulation
  failure shows up as deviation near 1, not 1e-15.
- **Not inconsistent triangle winding** — a custom per-triangle orientation
  check (independent of `deviation()`, since a small minority of
  wrong-winding triangles can hide inside an otherwise-correct area sum)
  found 0 flipped triangles in either mesh.
- **Not a missing-geometry gap** — hovering the black region fires the fill
  mesh's own `onPointerOver` (cursor → `pointer`), proving real triangles
  exist there and R3F's picking resolves to them correctly.
- **Not an overlapping GeoEntity** — no registered GeoEntity's centroid
  falls inside Brazil's bounding box.
- **Confirmed anchored to the globe's surface**, not a screen-space
  overlay — the black region rotates with the mesh when the camera moves.

Root cause is still open (logged in `BACKLOG.md`). The one pattern found:
all six affected features are among the highest-vertex-count meshes in the
dataset (Russia's mainland alone is 8,964 vertices; Brazil's merged 43-
polygon fill totals ~4,200) — circumstantial, not proven, but the only lead
that survived the above.

**A "restyle to match this mockup" request needs the mockup treated as
data, not vibes.** The whole v5.0.0 pass (palette, typography, panel chrome,
layout) was done by extracting literal values from the reference — hex
codes from its CSS/Three.js color literals, exact px/rgba spacing from its
`.panel`/`.panel-head` rules — rather than eyeballing "looks navy-ish."
Where the reference didn't cleanly cover an existing concept (5 of
`highlightColors.ts`'s 7 semantic slots have no equivalent in a screenshot
that only ever shows one selection state; the reference has no monospace
font at all, this app has a real functional reason to keep one for numeric
readouts), that gap got flagged and asked about explicitly rather than
silently invented — see `CHANGELOG.md`'s v5.0.0 entry for how each of those
landed.

**A "tactical HUD" decorative layer and a "glass console" one are different
visual identities, not a reskin of the same idea.** `hud/HUDFrame.tsx`'s
corner brackets + scanlines + vignette (this app's pre-v5 identity, per
`CLAUDE.md`'s "closer to a tactical display than a map app") has no
equivalent anywhere in the v5 reference — recoloring it to fit the new
palette would have kept an aesthetic the redesign was actively moving away
from. Removed it entirely rather than adapt it, once asked directly (this
was flagged as a genuine judgment call, not assumed).

**The navy/charcoal/gold globe-fill experiment (dot-fill, then solid) was
reverted the same session it was built.** Both attempts got as far as
passing typecheck/lint/tests/build and a real browser click-through before
the user judged the result worse than the pre-existing look and asked for a
full revert — the HUD chrome changes were unaffected since they'd already
been committed to (this session's) working state independently. Lesson
carried forward: this project's "verify in a real browser" step catches
things typecheck/lint/tests structurally cannot — matching valid code to
"looks right" is still a separate, necessary check.

## 2026-07-26 — v4.3: a private distance table doesn't scale past its first consumer

**`UsCityLabels.tsx`'s population/zoom-tier gate started as a private
`REVEAL_TIERS` array with no way for another feature to reuse or even see
its thresholds.** Generalized into the LOD Engine (`src/lod/`) specifically
so the next zoom-gated dataset (rivers, roads, ...) has one shared,
ordered ladder to plug into instead of a second hand-copied distance table.
Reformulating each level's "active" check as independent and cumulative
(`distance <= revealDistance`, checked per level) rather than a
descending, first-match-wins scan also turned out to remove an entire
footgun: the old scan needed a separate `NO_CITIES_ABOVE_DISTANCE` upper-
bound constant purely to stop its first threshold from incorrectly
matching from very far away, which the independent-check formulation never
needed in the first place.

**A candidate-pool filter needs an "is this actually on screen" test, not
just "is this on the near side of the globe."** The sphere-horizon
dot-product test alone (is this point facing the camera, not hidden by the
globe's curvature) stays true for 40+ degrees of arc regardless of zoom.
The camera's actual framed field of view at close zoom can be only a few
degrees wide. Those two facts together meant a candidate-pool filter built
on the horizon test alone let cities hundreds of miles outside the current
view, but still technically front-facing, consume every candidate/label-
budget slot ahead of a real, smaller city that actually was on screen —
reported as a specific real town, well inside the population floor for its
zoom tier, never appearing no matter how far you zoomed into its own
state. Fixed by projecting to screen space and checking the actual
viewport bounds too, not just curvature.

**A flat label-spacing constant assumes every label is roughly the same
size.** It isn't — this layer's labels range from 6px town names to 11px
bold metro names, a real difference in on-screen width. Applying one
shared minimum-spacing constant to that whole range meant a legibility
threshold tuned for the biggest labels was also silently rejecting much
narrower labels that were never actually at risk of overlapping. Fixed by
having each candidate carry its own spacing radius, summed pairwise,
instead of one constant for everyone.

**Promotion note:** cherry-picking this work onto `main` surfaced a real
gap from excluding an unrelated commit — `UsCityOutlineHighlight.tsx`
(v4.2) was originally mounted in `Globe.tsx` by a later branch commit that
also happened to touch ambient rotation (already shipped independently on
`main` as v3.3.1, so excluded here as redundant). Excluding that commit
silently left `UsCityOutlineHighlight` unmounted dead code on `main` after
v4.2 landed; resolving this commit's cherry-pick conflict in `Globe.tsx`
restored the mount alongside the new label components. Worth remembering
next time a promotion excludes a commit: check whether anything *else* in
that commit was actually load-bearing.

## 2026-07-26 — v4.2: 32,608 places is a scale where "always render everything" stops being an option

**The first implementation shipped as one always-on merged-polygon layer
(every boundary precomputed into a single buffer, the same
one-merged-geometry-per-entity approach that works well for 193 countries
and 294 provinces) and it read as visual noise in review — "clustered
dots/blobs," not legible city shapes.** Tracing one real city's geometry
(Austin, TX) all the way through the pipeline confirmed the underlying data
was structurally correct; the actual problem was scale interacting with an
existing limitation — this app's `LineBasicMaterial`-only borders have no
real line width on any platform, which is fine when 193 countries' worth of
borders are spread across a whole globe, but becomes illegible once
thousands of small, often-fragmented polygons (Austin alone has many,
from its own annexation history) are packed into city-block-sized screen
regions all at once. The fix was a **product-shape change** — search-
triggered, one-city-at-a-time reveal — not a rendering tweak, because no
amount of color/opacity tuning fixes "too many thin lines in too small a
space" when the actual requirement is "find one specific city," not
"see every city's outline simultaneously."

**Camera zoom has much less headroom than it looks like.** Pushing
`CAMERA_MIN_DISTANCE` from `GLOBE_RADIUS * 1.35` down to `* 1.005` (~35x
closer, aiming to resolve individual city polygons) packed the camera into
the same thin geometry shell as every other surface radius in the scene
(core sphere, country fill, borders, atmosphere shells) — grazing/near-
tangent viewing angles ended up looking through surface geometry instead of
at it. Settled on a more conservative `* 1.05` (~13x closer) instead; this
constant would be revisited twice more later (v4.3).

**Two real, separate bugs surfaced building the on-demand outline fetch:**
- `useSyncExternalStore`'s `getSnapshot` must return a stable reference
  when nothing's changed — an early version of the outline-fetch hook built
  a fresh object literal on every call, causing an infinite re-render loop
  that froze/crashed the browser tab. Fixed by caching the resolved result
  and only recomputing when the underlying (city id, shard-loaded) key
  changes.
- Two sequential store mutations for one logical action — `flyToDirection()`
  then `showUsCityOutline()` as separate calls — left a window where a
  subscriber could read inconsistent intermediate state between them.
  Collapsed into one atomic `flyToUsCity()`.

## 2026-07-26 — v4.1: a classification doesn't have to join every existing system to fit in

**`city` was deliberately left out of `CategoryHighlightLayer.tsx`/
`LegendPanel.tsx` even though every other `GeoEntityType` member is wired
into both.** That highlight system's visual (a dashed border plus a fill
overlay) is inherently a polygon operation — there's no honest equivalent
for a single point marker, and forcing one in just to keep a "every
classification supports every feature" rule would have meant either a fake
highlight effect or quietly changing what "highlighted" means. Everything
else (`GeoEntityRegistry`, `EntityResolver`, search, Tab-cycling,
`IntelligencePanel`'s `GeoEntityDetails` card) still treats `city`
identically to the other six — the exclusion is scoped to exactly the one
system where it doesn't make sense, not a reason to treat cities as a
second-class classification everywhere.

**Filtering to "real UN members" needed to check the actual runtime output,
not just ISO code validity.** A capital whose country has a valid-looking
ISO code isn't necessarily one of the 193 *registered* UN members this app
actually renders — cross-checking against `countries-un193.json`'s own
generated output (not the raw source data's country list) is what caught
the 5 non-UN capitals in the source (Vatican City, Kosovo, Bermuda,
Somaliland, Taiwan) that would otherwise have shipped a `parentCountryId`
pointing at a country that doesn't exist in this app's own registry.

**Point geometry needed a real branch in the build pipeline, not just a
smaller polygon.** `topologyPipeline.mjs`'s rebuild/presimplify/simplify/
quantize steps all exist to reduce coastline point density — meaningless
for a single lat/lng pair. `buildCitiesData.mjs` skips that pipeline
entirely rather than routing a point through machinery built for polygons
and hoping it's a no-op.

## 2026-07-26 — v4.0: states/provinces proves the Data Engine pattern before the Data Engine exists

**Added a dataset from a source this app had never used before (Natural
Earth's admin-1 boundaries, vendored directly, no npm wrapper) specifically
to test whether the existing architecture could absorb a new geographic
classification without special-casing it — before committing to build a
formal Data Engine.** Every consumer that dispatches on `GeoEntityType`
(`IntelligencePanel`, `SearchBar`, `CategoryHighlightLayer`,
`SelectionController`'s Tab-cycling, `LegendPanel`) already switched
generically on `kind`/`type` rather than enumerating classifications by
name, so adding `administrative-division` as a sixth member was additive
everywhere except the handful of `Record<GeoEntityType, ...>` maps
TypeScript itself flagged as needing the new key. That result is the actual
value of this version: the pattern (new vendored source → new build script
→ new `GeoEntityType` member → zero changes to existing rendering/
selection/HUD code) is now proven, not just planned.

**Deliberately partial coverage (9 countries) instead of waiting for
complete data.** The 1:50m resolution Natural Earth ships only usefully
resolves admin-1 boundaries for a handful of large countries — smaller
countries' subdivisions are either missing or too coarse to be worth
rendering at this zoom range. Shipping the resolution-limited pilot now,
with the 1:10m upgrade path documented (`BACKLOG.md`), was chosen over
blocking the whole feature on sourcing better data for every country.

**`topologyPipeline.mjs`'s `readSourceFeatures()` needed to accept a plain
GeoJSON `FeatureCollection`, not just the TopoJSON `Topology` every prior
build script fed it** — Natural Earth ships admin-1 boundaries as GeoJSON
directly, no topology-conversion step. Generalizing that one function
(rather than duplicating the pipeline's back half a second time, which is
exactly what v3.3.2's extraction happened one commit earlier specifically
to prevent) was the actual reason that refactor's timing mattered.

## 2026-07-23 — v3.3.1: ambient rotation moved from an inferred behavior to a persistent setting

**Replaced a "stop while selected, resume on deselect" heuristic with a
plain on/off setting the user controls directly, because the heuristic had
no state of its own — it inferred the right `autoRotate` value from
`selected` changing, which only works if selection is the only thing that
ever needs to suspend rotation.** `scene/CameraControls.tsx` used to watch
`selected` with a `wasSelected` ref and flip `autoRotate` back to `true`
the instant it saw a transition from *something selected* to *nothing
selected* — correct as far as it went, but it meant "is rotation currently
on" was never an explicit fact anywhere, only ever re-derived from
selection state at the moment of a transition. A `ambientRotationEnabled`
boolean in `settingsStore.ts` (default `false` — previously ambient
rotation was always on while nothing was selected, flipped per direct
request), toggled by a new **T** key binding, makes "should the globe be
spinning right now" a real, independently-inspectable value instead of
something reconstructed from a side effect of selection changes. The two
camera-flight completion handlers (`useCameraFlight.ts`, `useCameraReset.ts`)
that used to hardcode `controls.autoRotate = true` once a flight finished
now read the same setting instead, so a flight that completes while
ambient rotation is off doesn't silently turn it back on.

## 2026-07-21 — v3.3.0: six independent toggles instead of one picker, and why the second copy of a pattern is when you extract it

**Registered six Layer Engine layers instead of building one "pick a
category" control, because the Layer Engine already solves exactly that
problem.** First instinct for "highlight all entities of one category" was
a small new store (`highlightedCategory: Category | null`) plus a new HUD
control to set it — but that's a parallel toggle mechanism sitting right
next to a Layer Engine that already does "independently enable/disable any
number of registered visualizations," built in v2.0 specifically so future
overlays would never need new HUD plumbing. Registering six layers (one per
classification, `category: 'highlight'` so they group together in
`LayerPanel.tsx`) meant the feature needed zero new store, zero new HUD
component, and zero edits to `LayerPanel.tsx` — it already iterates
`getLayerDefinitions()` generically. It also came with a capability a
single mutually-exclusive picker wouldn't have: enabling two categories at
once (sovereign states *and* strategic regions, say) just works, because
that's already how independently-toggleable layers behave. Worth noticing
when a new feature's "obvious" first design (a dedicated store + control)
is actually reinventing a mechanism that already exists one directory over.

**`scene/PointerMarker.tsx` and `scene/countryEntries.ts` both got
extracted for the same reason, on the same day: a second consumer arrived
needing the exact same thing, not a similar thing.** `CategoryHighlightLayer.tsx`'s
sovereign-states highlight needed precisely the "raw country feature →
border/fill `BufferGeometry`" logic `ClaimsOverlayLayer.tsx`'s related-
country rendering already had inline — not almost the same, byte-for-byte
the same, just called from a different place. Same story for the marker:
`Globe.tsx`'s `CapitalMarker` and `ClaimsOverlayLayer.tsx`'s claimant/
parent marker had independently near-identical "dot + leader line + label"
implementations that had already drifted apart in their exact sizing
(0.009 vs. 0.014 dot radius, `RADIUS × 1.3` vs. `× 1.32` callout distance,
±9° vs. ±10° swing) before this session even started — which is itself
the evidence for extracting a shared component now rather than continuing
to patch two copies: two independent "make it smaller" edits would have
produced two independently-tuned-by-feel sizes, drifting a third time.
One shared `PointerMarker.tsx`, tuned once, used twice, can't do that.

**The "too big, comes out too far" complaint was resolved by comparing
values across the file, not by picking new numbers from scratch.** Read
both markers' actual constants before touching either
(`CapitalMarker`: dot 0.009, callout `RADIUS × 1.3`, swing ±9°;
`RelatedCountryMarker`: dot 0.014, callout `RADIUS × 1.32`, swing ±10°) —
both already near the upper end of what this app's own established
"small-entity leader-line callout" convention uses elsewhere
(`Countries.tsx`/`GeoEntities.tsx`'s `HoverLabel` goes out to
`RADIUS × 1.35` for country/entity *names*, which is a comparable
convention but wasn't part of this complaint and was left untouched — the
report was specifically about the claimant/capital markers, not every
leader-line callout in the app). New shared constants (dot 0.007, callout
`RADIUS × 1.1`, swing ±4°) are a genuine reduction across the board, not
just "smaller than whichever one was worse."

## 2026-07-21 — v3.2.0: teaching selectEntity() a third argument without teaching its three existing callers anything new

**The one place "purely additive" needed a real design decision, not just
new files.** Keyboard arrow-key navigation has to call the same
`selectEntity()` every other selection path uses — that's the whole point
of "keyboard and mouse selection must use the same underlying state" — but
every existing caller (`Countries.tsx`, `GeoEntities.tsx`, `SearchBar.tsx`)
was written assuming selecting something always opens the Intelligence
Panel, because pre-v3.2 that was simply true. Arrow-key browsing needs to
update the globe highlight and status bar on *every keypress* without
yanking the panel open each time (ENTER does that, deliberately, per the
spec). Two ways to reconcile this without touching any of the three
existing call sites: (a) give `selectEntity()` a new required parameter
and update all three anyway, or (b) make the new parameter optional with a
default that reproduces every existing caller's behavior exactly. Went
with (b) — `options?.openInspector` defaults to `true`, so
`selectEntity(resolved, direction)` (all three existing call sites,
unedited) behaves identically to before v3.2.0 existed. Verified by
grepping for every `selectEntity(` call site before considering this done,
not just reasoning about it.

**`openInspector: false` means "don't force it open," not "force it
closed."** First draft had the false branch set `inspectorOpen: false`
unconditionally — which would mean arrow-keying to a new entity while the
panel happened to already be open (say, from an earlier click) would slam
it shut on every keypress, actively fighting the user's own prior action.
Changed to `shouldOpen ? true : state.inspectorOpen` — `false` leaves
whatever was already there alone. Net effect: if the panel's closed,
arrow-key browsing stays closed (matches the spec — only ENTER opens it);
if it's already open, arrow-key browsing updates it live as you navigate,
which reads as a feature (a live preview while browsing) rather than
something that needed to be prevented.

**Reused `useCameraFlight.ts`/`useCameraReset.ts`'s exact spherical-camera
pattern for WASDQE instead of finding a new way to drive OrbitControls.**
Both existing hooks already manipulate the camera the only way this app
ever does: read `camera.position.clone().sub(target)` into a `Spherical`,
adjust theta/phi/radius, write back via `camera.position.copy(target).add
(offset)` + `controls.update()`. Three.js's `OrbitControls` doesn't expose
public rotate/zoom methods to call directly (only internal, underscore-
prefixed ones not meant for external use) — rather than reach for those,
`CameraController.ts`'s per-frame nudge is the same three-line pattern
`useCameraFlight`/`useCameraReset` already use, just applied every frame
instead of tweened between two fixed points. One consequence this pattern
gave for free: checking `controls.enabled` before nudging (the same flag
`useCameraFlight`/`useCameraReset` already set to `false` while a flight
owns the camera) means a held WASD key can never fight an in-progress
"FOCUS CAMERA" tween — no new coordination code needed, just reading a flag
that already existed for exactly this reason.

**A keydown listener that reads `useSelection()`/`useInspectorOpen()`
values needs a ref, or it dispatches against stale state.**
`useKeyboardController` attaches its `window.addEventListener` exactly
once (empty-deps `useEffect`, deliberately — re-attaching on every render
would mean the DOM listener count and the Set of held keys could drift).
But `InputManager`'s `onCommand` closure captures whatever `selected`/
`inspectorOpen` were *at the render that created it* — if the listener
call the exact function object from that one render forever, Escape would
keep testing against whatever the selection was when the app first
mounted. Standard fix, applied here: `useKeyboardController` stores the
callback in a ref, reassigned on every render (`onCommandRef.current =
onCommand`, a plain assignment, not inside an effect), and the
once-attached listener always calls `onCommandRef.current(...)` — always
the latest closure, without ever tearing down and re-creating the actual
DOM listener.

**Verified the directional algorithm against real geography before
trusting it, and found a pre-existing precision limit instead of a new
bug.** Couldn't import `SelectionController.ts` directly for testing — it
transitively pulls in `hud/selectionStore.ts`, which reads
`import.meta.env.DEV` (a Vite-only global `tsx` doesn't provide) — so
verified a standalone copy of the pure bearing/distance functions against
`countries-un193.json` instead. Fiji (sitting almost exactly on the
antimeridian) resolved sensibly in all four directions, confirming the
great-circle bearing formula handles ±180° wraparound correctly (a naive
`lng2 - lng1` would not have — see `countryGeometry.ts`'s ring-unwrapping
doc comment for the same underlying issue in a different context). Germany
returned Luxembourg for *both* "south" and "west," which looked wrong at
first — until checking `geometryToCentroid()` itself, whose own doc
comment already says "simple (non-area-weighted) centroid... not meant to
be a precise geographic centroid." The new algorithm is faithfully
reusing the same centroid every other consumer (hover labels, camera
flight targets, search) already relies on — inheriting its imprecision
is consistent behavior, not a new defect, and "fixing" `geometryToCentroid`
itself was out of scope (see the "do not rewrite existing functionality"
constraint this feature was built under). Flagged in `BACKLOG.md` instead
of silently accepted.

## 2026-07-21 — v3.1.5: the blue overlay was scoped to "claimant" when the real concept was "connected country"

**39 territory entries got real `claimedBy` data (v3.0.0-v3.1.4) without
anyone noticing the visualization only ever looked at `claimedBy`.** The
report that triggered this fix: select Curaçao, expect the Netherlands to
highlight the way China highlighted when Taiwan was selected — it didn't.
Curaçao has no `claimedBy` (it's an uncontested Netherlands dependency,
correctly modeled that way), so `useClaimantCountryIds` — which only ever
read `geoEntity.claimedBy` — had nothing to find. The bug wasn't in the
data (Curaçao's `parentEntity: Netherlands` was correct and had been since
v3.0.0) or even really in the overlay code (it did exactly what its name
said: show claimants) — it was a scope mismatch between what the feature
was named/built for ("claimant countries") and what a user reasonably
expects "the country connected to what I selected" to mean, which spans
both `parentEntity` and `claimedBy`. Worth remembering: a feature that
"does what it says" can still under-deliver if the name itself was scoped
narrower than the actual user need — the fix here was mostly a reframing
(one mechanism serving two relationship kinds, distinguished by a role
label) more than new logic.

**Gibraltar turned out to be a real test case for "a country can be both a
parent and a claimant of different entities, or even the same one."**
After adding Spain as a claimant (v3.1.4) on top of Gibraltar's existing
UK parent (v3.0.0), Gibraltar became the one entity in this dataset with
two *different* countries in two *different* roles simultaneously. Built
`useRelatedCountryRoles` to return `Map<countryId, Set<role>>` rather than
a plain `Set<countryId>` specifically so this case wouldn't need special-
casing — the same country appearing as both `parent` and `claimant` for
one entity (not represented anywhere currently, but structurally possible)
would just join both role labels on one marker instead of needing a second
data structure or a "which one wins" tiebreak. Verified with `tsx` against
the real registry before considering this done, same discipline as
v3.0.1/v3.1.4: Curaçao → Netherlands (parent only), Taiwan → China
(claimant only, unaffected regression check), Gibraltar → UK (parent) +
Spain (claimant) both rendered, Puerto Rico → USA (parent only, still no
claimant since it remains uncontested).

## 2026-07-21 — v3.1.4: verified every numeric id again before trusting a user-supplied correction list

**Re-ran the exact verification `LOGBOOK.md`'s v3.0.1 entry describes,
before touching any data.** That entry's whole point was: alpha-3 codes
("USA", "ESP") are not what this app's Country Registry actually keys on —
the raw ISO 3166-1 *numeric* code from the topology is, and assuming
otherwise shipped a real bug that made two overlay layers silently do
nothing for an entire version. This iteration added five new country
references (Spain, Mauritius, Madagascar, Israel, Cyprus) that had never
appeared in `geoEntities.ts` before — rather than trusting general
knowledge of ISO numeric codes, queried `public/geo/countries-un193.json`
directly the same way the v3.0.1 fix did, confirmed all five (and the
already-used Argentina/USA/Jamaica/Honduras/Nicaragua, to be sure nothing
had drifted) before writing a single `toCountry()` call. Cheap insurance
against repeating a bug that already had its own postmortem in this file.

**`dependency()`'s "uncontroversial" framing needed a correction, not just
a new parameter.** The helper's original doc comment described every
Territory it builds as having "no dispute" — true when it was written (the
40 entries it covered were all uncontested dependencies), false the moment
Gibraltar/Falklands/South Georgia/BIOT/French Southern & Antarctic Lands
needed a `claimedBy` list while keeping their single uncontested
administering parent. Fixed the comment alongside the code change, not
just the code: "who administers this" and "does anyone dispute it" are
independent facts (the same distinction `GeoEntity`'s own doc comment in
`data/types.ts` already draws between `administeredBy` and `claimedBy` for
every other entry) — a helper named for the common case shouldn't have a
comment that quietly asserts the common case is the only case.

**Nicaragua's Bajo Nuevo/Serranilla claims were not "possibly disputable
opinion" — they were superseded by name.** The 2012 ICJ judgment
(*Territorial and Maritime Dispute, Nicaragua v. Colombia*) is a specific,
citable ruling that resolved the exact claim this dataset had been
carrying since v3.0.0 as if still live. Removing Nicaragua (and Honduras,
per its own 1986 bilateral treaty with Colombia) and adding the US's
still-unrelinquished 1856 Guano Islands Act claim isn't a judgment call the
way Kosovo's `claimedBy: Serbia` or the Territory `parentEntity` additions
in v3.0.0 were (see that entry) — it's a correction against a specific
legal source, and the code comment above both entries now cites it by
name and year so the next person to touch this file doesn't have to take
it on faith either.

## 2026-07-21 — v3.1.3: "claimed by" and "claims" are supposed to be the same fact from two ends, and this dataset only ever writes one of them

**A GeoEntity's `claims` field is real infrastructure with zero real data
in it.** `data/types.ts`'s doc comment for `GeoEntity.claims` is explicit
that it's the inverse of `claimedBy` — "every entity THIS entity claims
sovereignty over" — and `LOGBOOK.md`'s own v3.0.0 entry already flagged
that "most entries in this dataset only populate `claimedBy`... `claims`
exists for the cases that do." What that entry didn't spell out: as of
v3.1.2, *no* entry populates `claims` — Taiwan claims Spratly Islands and
Scarborough Reef in every practical sense (both reefs list Taiwan in their
own `claimedBy`), but Taiwan's own `claims` array is `[]`. The first version
of `generateClaimsDoc.mjs`'s complete-roster rewrite read `entity.claims`
directly and printed "Claims: None" for Taiwan — technically accurate to
the field, factually wrong about the relationship. Caught by spot-checking
Taiwan's entry against what `ClaimsOverlayLayer.tsx` already does at
runtime (`useClaimRelatedEntityIds` scans `[...claimedBy, ...claims]`
together specifically because of this — see that file's comments), not by
assuming the raw field was the whole story.

**Fix: infer the missing direction instead of requiring the data to state
both.** Built `inferredClaimsByKey` — one pass over every entity's
`claimedBy`, inverted into "what does the claimant claim" — and union it
with each entity's explicit `claims` when rendering. Same general lesson as
`ClaimsOverlayLayer.tsx`'s own `useClaimRelatedEntityIds`/
`useClaimantCountryIds` split from v3.1.0: a bidirectional relationship
recorded on only one side needs the *reader* (whether that's a render
layer or a doc generator) to reconstruct the other side, not a hope that
every future data entry remembers to populate both fields symmetrically.
If `geoEntities.ts` ever does start populating `claims` directly, this
still works unchanged — the union just becomes redundant with itself,
not wrong.

## 2026-07-21 — v3.1.1: a generated doc still needs its own presentation layer, and why plain `node` can run one script but not the next

**Generating `CLAIMS.md` straight from `GeoEntityRelation.displayName`
almost shipped a register where seven Antarctic claimants all had the same
17-word section header.** `displayName` strings in `geoEntities.ts` are
written to read naturally inline in the Intelligence Panel's
"Claimed by: X, Y, Z" sentence — Antarctica's claimants all carry a
"(claim suspended under the Antarctic Treaty)" qualifier for exactly that
context, and Guantanamo Bay's Cuba entry carries "(disputes the lease's
continued legitimacy)" the same way. First pass at `generateClaimsDoc.mjs`
used `displayName` verbatim as both the inline text *and* the "By
claimant" section's `### heading` — correct for the former, noisy for the
latter (a heading repeated seven times differing only in which country
precedes an identical 8-word parenthetical isn't a scannable index). Fixed
with a `canonicalLabel()` step that strips a trailing parenthetical for
grouping/heading purposes only — the full annotated text still appears in
the "By disputed entity" section via the unmodified `formatRelation()`.
Same lesson as `data/countryProfiles.ts` vs. `data/types.ts`'s `Country`
(see that split's own reasoning in `CLAUDE.md`): one field written for one
presentation context doesn't automatically read well in a different one,
even when the underlying fact is identical.

**Why `buildEntityTopology.mjs` runs under plain `node` but
`generateClaimsDoc.mjs` needed `tsx`.** Both are `.mjs` scripts importing a
`.ts` module. The difference is what that module imports in turn:
`entityGeometryIds.ts` (read by `buildEntityTopology.mjs`) has zero
imports of its own — a leaf module, and Node's built-in TypeScript
stripping (stable by Node 24, this repo's runtime) only strips types, it
doesn't add bundler-style extension resolution. `geoEntities.ts` (needed
here, to read the live registry rather than re-deriving claim data by
hand) imports `./GeoEntityRegistry` and `../types` with no extension —
resolves fine under Vite/`tsx` (enhanced resolution, the same reason the
app itself never needs `.ts` suffixes in its own imports) but throws
`ERR_MODULE_NOT_FOUND` under plain `node`. Added `tsx` as a real
devDependency rather than continuing to reach for `npx --yes tsx`
ad hoc — that path only worked at all in earlier verification steps this
session because of network access this project's own CI/regeneration
shouldn't have to depend on.

## 2026-07-21 — v3.1.0: computeLineDistances() isn't a BufferGeometry method, a legend almost got hidden behind the panel it exists to explain, and "claimed" needed a mirror-image "claimant"

**The claims overlay only ever pointed one direction, because a Country
and a GeoEntity render through two unconnected systems.** First pass at
v3.1's dashed claims overlay (and, before that, v3.0's pulsing-color one)
only ever populated `claimRelatedIds` by scanning for `ref.type ===
'geo-entity'` — clicking China correctly flagged Taiwan/Spratly
Islands/Scarborough Reef, and it was tempting to call the overlay done
there, since that matches the v3 spec's own worked example exactly. But
selecting Taiwan showed nothing for China: `ref.type === 'country'`
relations were being silently filtered out of the same loop, because a
`Country` has no rendered presence in `scene/GeoEntities.tsx`'s geometry at
all — it's a completely different component (`Countries.tsx`), fetching a
completely different topology (`useCountryFeatures()`, not
`useGeoEntityFeatures()`). "Highlight the claimant" and "highlight the
claimed" look like the same problem from the data model's side
(`GeoEntityRelation` either way) but are NOT the same problem from the
rendering side — one target type has geometry sitting right there in the
same entry list, the other requires fetching an entirely separate feature
collection and building geometry from scratch. Fixed by giving
`ClaimsOverlayLayer.tsx` a second, independent sub-component
(`ClaimantCountriesOverlay`) that fetches country features directly and
renders on that geometry — and giving it an intentionally different visual
treatment (blue instead of magenta, a prominent fill covering the whole
country rather than a near-invisible tint, plus a labeled pulsing marker)
rather than just reusing `CLAIM_COLOR`, so "X claims Y" and "Y is claimed
by X" don't read as the identical fact rendered twice. General lesson,
worth remembering the next time a relationship field spans two
different entity kinds: check whether "the other end of this relationship"
is even representable in the renderer that's about to loop over it, not
just whether the data model can express the reference.

**`THREE.Line.prototype.computeLineDistances()` operates on an object
instance, not a geometry.** Reached for it expecting a `BufferGeometry`
method (the same shape as `computeVertexNormals()`, `computeBoundingBox()`,
etc.) — it isn't one. It lives on `Line` (and `LineSegments`, which extends
`Line` without overriding it), reads `this.geometry.attributes.position`,
and writes the `lineDistance` attribute back onto `this.geometry`. That's
awkward for this codebase's shape: `scene/geoEntityEntries.ts`'s
`buildGeoEntityEntries()` builds a plain `BufferGeometry` with no scene
object attached to it yet — `GeoEntities.tsx`, `ParentOverlayLayer.tsx`, and
`ClaimsOverlayLayer.tsx` each mount their own `<lineSegments>` from the same
shared geometry later, independently, so there's no single "the" Line
instance to call the method on even if timing allowed it. Ported the
algorithm itself (it's ~10 lines, verbatim from three.js's source) into a
standalone function operating directly on a `BufferGeometry`, called once
right after the border geometry is built — every entry is dash-ready before
any component ever sees it, and `LineBasicMaterial` (every other consumer)
silently ignores the extra attribute.

**The legend almost shipped in the one spot that hides it exactly when it's
needed.** First draft put `LegendPanel` at bottom-right, mirroring
`Telemetry.tsx`'s bottom-left placement for visual symmetry. Caught before
shipping: `hud/IntelligencePanel.tsx` is `fixed inset-y-0 right-0` at
`z-30` — it covers the *entire* right edge, top to bottom, for as long as
anything is selected, not just a corner. A legend explaining
selection/overlay colors is specifically most useful exactly when something
is selected — meaning bottom-right (or top-right, same problem) would be
covered by the one panel that's guaranteed to be open whenever the legend
had anything to say. Moved it to stack with `Telemetry.tsx` in a shared
bottom-left flex column instead (`App.tsx`), which meant pulling both
components' own `fixed bottom-* left-*` wrapper out into that shared
container — neither had to start hardcoding pixel offsets to stack above
the other, flexbox does it regardless of either one's actual rendered
height (which varies: `LegendPanel`'s row count depends on which overlay
layers are enabled). General lesson: before placing a new always-on HUD
element, check what covers that screen region under the state where the
element would actually be read, not just the empty/idle state it looks
fine in during a first pass.

## 2026-07-21 — v3.0.1: the overlays were architecturally correct and functionally inert, because of two id spaces that look identical

**The bug: every `EntityRef{type:'country', id:...}` in `geoEntities.ts`
used the wrong id space.** `Country.id` in this app is not ISO 3166-1
alpha-3 ("USA", "CHN") — it's whatever `scene/useCountryFeatures.ts`
registers straight off the topojson feature id (`String(f.id)`), which for
`world-atlas`'s source data is the ISO 3166-1 **numeric** code as a
zero-padded string ("840", "156"). Nothing in the country pipeline ever
remaps numeric to alpha-3 — `buildCountryTopology.mjs` only filters and
renames by *display name*, never touches `id`. `data/registry/geoEntities.ts`
was written using alpha-3 codes throughout (`toCountry('USA', ...)`,
`toCountry('CHN', ...)`, 27 codes across ~40 call sites) because alpha-3 is
the standard, human-readable convention — and because `data/types.ts`'s own
`Country.id` doc comment explicitly says "Convention: ISO 3166-1 alpha-3."
That comment describes the *intended* convention for a `Country` record's
own id; it does not describe what id a rendered country polygon actually
carries at runtime, and nothing forced those two to be checked against each
other before shipping.

**Why this didn't throw, warn, or fail typecheck.** `EntityRef.id` is `string`
— any string typechecks. `ParentOverlayLayer`/`ClaimsOverlayLayer` compare
`ref.id === selected.id` and simply get `false` for every comparison,
forever, which reads identically to "nothing here is related to the
selection" — the correct, silent, expected result for the overwhelming
majority of clicks (most countries have no dependencies and are claimed by
nobody). The bug was invisible in exactly the cases someone would casually
click to check the feature, and only detectable by clicking specifically
US/China/a claimed entity and noticing the *absence* of an overlay — the
same "confirmed by screenshot, not by a type error" shape as the
`TerritoryEntry` geometryId/entityId bug in v2.3.0's entry below. Worth
repeating the lesson from that entry here since it bit twice: comparing two
values that are "obviously" the same id space is exactly the kind of
assumption that needs an explicit check, not a glance at the type
signature — `string === string` compiles whether or not the two strings
came from compatible universes.

**How it was actually caught:** the user reported the overlays "aren't
actually implemented" after presumably clicking through the running app.
Rather than assume the fix was a missing `defaultEnabled: true` (Claims
Overlay does default off, and that's a real secondary gap — see below), the
id equality checks were traced end to end and verified against the
*compiled* topology (`public/geo/countries-un193.json`), not assumed from
the source alpha-3 codes — that's what surfaced the actual mismatch.
Verified the fix the same way: ran the real dataset through `tsx` (no
browser available this session) and confirmed selecting China's real id
(`"156"`) now resolves exactly the three entities the v3 spec's own example
names (Taiwan, Spratly Islands, Scarborough Reef), and selecting the US's
real id (`"840"`) resolves its 6 registered dependencies.

**The secondary gap, fixed at the same time:** `ClaimsOverlayLayer`
defaulted to `defaultEnabled: false`, reading the spec's "when enabled" as
"starts off." Changed to default-on — a toggle a first-time viewer has to
discover in the Layer Panel before the spec's own headline example (click
China, see Taiwan/Spratly flagged) becomes visible isn't "implemented," from
a user's perspective, even once the underlying logic is correct. The layer
is still a real toggle (switchable off in the Layer Panel like any other
layer) — only the starting state changed.

**Fix:** `ISO_ALPHA3_TO_NUMERIC`, a lookup table in `geoEntities.ts` scoped
to exactly the 27 country codes that file references, with `countryRef()`
resolving through it. Kept the alpha-3 codes at every call site rather than
rewriting ~40 lines to numeric codes directly — "USA"/"CHN" stay readable
for whoever edits this file next; only the one function that turns them
into an `EntityRef` needed to change. Throws on an unmapped code rather than
silently producing a broken ref again, so adding a 28th country reference
without extending the table fails loudly at module load instead of
compiling into another invisible no-op.

## 2026-07-21 — v3.0.0: one registry instead of five, and the judgment calls the spec left open

**Why one `GeoEntity` interface instead of five (`GeopoliticalEntity`,
`Territory`, `StrategicRegion`, `MaritimeFeature`, `GeographicRegion`), each
with their own registry.** The spec named five classifications and asked for
one `GeoEntityRegistry.ts` with `registerEntity`/`getEntity`/`getEntities`/
`getEntitiesByType`/`getRelatedEntities` — that function list only makes
sense over one registry, not five, since `getEntitiesByType` implies
filtering a single collection rather than picking which of five to call. The
alternative (mirroring `CountryRegistry`/`TerritoryRegistry` — a separate
file per kind, deliberately duplicated so one addition can't regress another,
per the v2.3.0 entry below) stops making sense once there are five kinds that
share one relationship shape: `parentEntity`/`administeredBy`/`claimedBy`/
`claims` apply identically to a disputed maritime feature and a Crown
dependency. Five interfaces would mean five near-identical copies of the same
four fields; one `GeoEntity` with a `type: GeoEntityType` discriminant is what
the spec's own registry shape was already implying.

**Every requested entity turned out to have real, standalone polygon
geometry in `world-atlas`'s 10m source** — including things that looked like
they might not (Guantanamo Bay, Baikonur, the Spratly Islands, the Cyprus UN
Buffer Zone). Checked this before writing any data by dumping every feature
id/name in the source topology rather than assuming. Eleven of the fifty-five
have no numeric ISO id (Kosovo and ten others) but are still separate named
features — matched by raw source name instead, at build time, and given a
stable synthetic id (their target `GeoEntityRegistry` id, stamped on before
the topology rebuild) so nothing downstream has to know which features
started out id-less. This meant the "some territories can't be geometrically
represented, they stay search-only" situation `TERRITORY_GEOMETRY_IDS`
documented for Crimea did NOT generalize to the new entity set — Crimea
remains the only geometry-less entity in v3, unchanged from pre-v3.

**Judgment calls the spec left ambiguous or silent on — flagged here rather
than guessed-and-hidden:**

- **Gibraltar** appears in the spec's Known Relationships section
  (`parentEntity: United Kingdom`) but not in its explicit Territory list.
  Added as a 40th Territory entry on the assumption this was an omission,
  not a deliberate exclusion — it has real source geometry and an
  unambiguous relationship, so leaving it out felt more likely to be wrong
  than including it. Trivial to remove (`src/data/registry/geoEntities.ts`,
  one `register(dependency(...))` call) if that assumption doesn't hold.
- **Crimea** isn't in the v3 spec's entity list at all, but existed in the
  pre-v3 dataset. Carried forward rather than dropped (removing working,
  previously-shipped functionality wasn't asked for), classified as
  `'territory'` for lack of a better fit among the five v3 types — it isn't
  a dependency, but none of the other four classifications (primary
  political significance / strategic-military / maritime / treaty-region)
  describe it better either.
- **Several parent relationships beyond the spec's explicit list** were
  added where uncontroversial and easily verified (Curaçao/Aruba/Sint
  Maarten → Netherlands, Åland → Finland, Norfolk Island/Heard & McDonald →
  Australia, Cook Islands/Niue → New Zealand) — the spec's Known
  Relationships section reads as "at least these," not "only these," and
  leaving 10 of 39 Territory entries with no parent at all seemed a worse
  default than filling in well-established facts.
- **Claimants for Bajo Nuevo Bank / Serranilla Bank** aren't in the spec at
  all (only Spratly Islands, Scarborough Reef, and Siachen Glacier have
  spec'd claimedBy lists). Added Colombia/Jamaica/Nicaragua/Honduras per
  well-documented real disputes, at `confidence: 'estimated'` like
  everything else in this dataset — flagged here specifically because this
  is the least-verified corner of the v3 data and the one most likely to
  need a correction from someone who actually knows the dispute.
- **"Claims overlay" hatching** is approximated with a distinct pulsing
  outline color + near-zero fill, not a true diagonal-hatch texture — native
  `LineBasicMaterial`/`MeshBasicMaterial` can't do that without a custom
  shader, which felt like scope the spec's "future-compatible... visualization
  layer" framing didn't ask for yet. The infrastructure (a real Layer Engine
  layer, real bidirectional claim data via `getRelatedEntities`) is there for
  a future pass to swap in a real hatch shader without touching the data
  model.

See `CHANGELOG.md`'s v3.0.0 entry for the full file-by-file breakdown.

## 2026-07-20 — v2.3.0: a shape's own id is not the same thing as what it means, and two ways that bit us in one afternoon

**The core bug: `TerritoryEntry` compared a geometry id to an entity id
because `Countries.tsx` never had to tell the two apart.** Mirroring
`Countries.tsx` for `Territories.tsx` meant copying `const isSelected =
selected?.id === entry.id` — correct for countries, where a rendered
polygon's own topojson feature id *is* the country's registry id, no
translation needed. `GeometryMap` (v2.2.0) exists specifically because that
assumption doesn't hold for territories: Taiwan's shape id is `"158"` (an
ISO numeric code), its entity id is `"taiwan"` (the `TerritoryRegistry`
slug), and `selectionStore`'s `selected.id` is always the *entity* id
(whatever `EntityResolver` resolved to), never the raw geometry id. So
`isSelected` silently evaluated to `false` for every territory, always —
the selected shape rendered with the same faint dimmed treatment as
everything else instead of the red "selected" highlight, and the bug
produced no error, no warning, nothing to grep for. It only became visible
by actually looking at a screenshot of a selected territory and noticing
the highlight wasn't there. Fixed by giving `TerritoryEntry` two ids —
`geometryId` for hover state and `GeometryMap` lookups, `entityId` for
comparison against `selected.id` — rather than the one `Countries.tsx`
gets away with. Worth remembering generally: when copying a pattern from
code where "the shape's id" and "the thing's id" happen to be the same
string, check whether that's a coincidence of the specific case or an
actual invariant — it was deliberately *not* an invariant here, that's the
entire reason `GeometryMap` exists, and the copy-paste re-introduced the
assumption it was built to remove.

**The second bug, found while screenshotting the first one: selecting the
Taiwan *territory* showed Taipei's capital marker — a country's UI
artifact leaking onto a territory selection.** `Globe.tsx`'s
`CapitalMarker` has always looked up `COUNTRY_PROFILES[selected.name]` by
name alone, no check on what kind of thing was selected. That was
harmless through v2.2.x because nothing named the same as a
`COUNTRY_PROFILES` entry could ever be selected except an actual country
— territories weren't independently selectable yet. `countryProfiles.ts`
happens to carry a `"Taiwan"` entry (ordinary illustrative country data,
written long before the Territory registry existed, with no knowledge of
it). The moment `Territories.tsx` made `selected.name === "Taiwan"` a real
possibility for a *Territory* selection, that name collision stopped being
theoretical and started rendering a live UI bug: Taipei's marker and
leader-line label, layered right on top of the territory's own hover
label, on a screenshot that was supposed to be showing off the highlight
fix. Fixed by gating on `selected.entity.kind === 'country'` before the
name lookup. The pattern connecting both bugs: neither was a bug in the
code that shipped it (`Countries.tsx`'s id comparison and
`CapitalMarker`'s name lookup were both completely correct for the only
case that could reach them at the time) — both were assumptions that
quietly stopped holding the instant a second, structurally-different case
started running through the same code path for the first time. That's the
specific risk worth watching for whenever "make X also work for
territories" is the task: not "does the new code have bugs" but "does
existing code near it have an unstated country-only assumption that new
code just made reachable."

**How the click-vs-drag testing actually got resolved.** Automated
verification for this version needed to click a real point on the
rendered globe, not just drive `selectEntity()` through search/devtools —
the whole point was proving the *mesh* is clickable. First attempts
(clicking a fixed screen offset computed from one earlier screenshot)
flaked intermittently, and turned out not to be an app bug at all: `Globe.
tsx` only freezes ambient auto-rotation while `selected != null`, so
closing the Intelligence panel via clearSelection() (rather than
resetView()) leaves the camera in place but *resumes* rotation, drifting
the just-tested shape out from under a fixed pixel within a second or two.
Separately, the exact resting camera angle after a search-triggered flight
varies run to run by a degree or two, because ambient rotation keeps
accumulating for however long the test script takes to get from page load
to clicking the search result — real wall-clock timing, not seeded or
deterministic. Fixed the *test*, not the app: keep something selected
(freezing rotation) for the whole interaction sequence, and locate the
target by spiraling outward from screen center checking the canvas cursor
style, rather than trusting one hardcoded offset. Worth remembering for
any future test against this globe: never assume a screen position stays
valid across more than one action unless something is currently selected.

## 2026-07-19 — v2.2.4: two "unimported by design" datasets collided the moment one of them stopped being unimported

**Search needing real, named territory results (China/Taiwan/Puerto
Rico/Crimea/Western Sahara) forced a decision every prior version had
deferred: something has to actually load territory data into the running
app.** Every version since v2.1.2 kept `exampleTerritories.ts` explicitly
unimported — proving the schema without taking an implicit editorial
position by shipping specific disputed-territory data live. That constraint
doesn't disappear just because search needs data to return; it means the
example file still isn't the answer. `data/registry/territories.ts` is a
new, separate "real" dataset (same three disputed entries, reworded
slightly, plus Puerto Rico as a genuinely uncontroversial fourth) that *is*
wired in, via a side-effect import in `data/index.ts`. The distinction is
about what's promised, not what's technically true: `exampleTerritories.ts`
was always documented as "not authoritative, not this project's position";
`territories.ts` inherits that same caveat in its own provenance data, it
just also happens to be the thing the running app actually shows. Whether
that's a real distinction or a fig leaf is worth being honest about — the
data is nearly identical. What changed is that shipping *something* live
was no longer optional once a feature (search) needed to return it.

**This exact collision — two independently-reasonable "unimported by
design" decisions turning into a live bug the moment one stopped being
true — is worth a specific callout.** v2.2.3's `__debugSelectTerritory`
hook imported `exampleTerritories.ts` to guarantee something was
registered before letting you select it, reasoned about as safe because
*nothing else* registered territories at the time. The moment
`territories.ts` started registering the same ids for real, that
assumption silently broke: both modules ran on every dev page load,
`exampleTerritories.ts`'s `registerTerritory()` calls have no try/catch
(never needed one — it was supposed to be the only registrant), and the
second one to run threw an uncaught "already registered" error into the
console on every single page load. tsc and oxlint both stayed clean
through this; it only showed up as a `pageerror` during live Playwright
verification. Fixed by dropping the `exampleTerritories.ts` import from the
hook entirely (real data covers the same ids now, so nothing needs it) —
but the general lesson is the sharper one: an "unimported by design" file
is an implicit dependency of anything that *does* import it, and a note in
that file's own docstring doesn't warn the next person adding a second,
independent import of the same underlying ids. Grepping for existing
importers of a thing you're about to duplicate the effect of — not just
reading its docstring — is the actual check.

## 2026-07-19 — v2.2.3: the verification hook stayed, on purpose

**The user asked "i can't see the hud and territory changes at all in my
local host browser" — and they were right, by design.** Two different
things were being reported as one. Country cards were an explicit
pixel-identical requirement in v2.2.2, so there is genuinely nothing new
to notice there. Territory cards are new, but every version from v2.1.2
onward deliberately kept territories disconnected from real interaction
("do not connect visualization yet," "do not add highlighting," "do not
modify rendering behavior yet") — no territory has clickable geometry, and
the example data files are never imported by the running app. So a normal
user clicking around the live globe was never going to hit a Territory
card. The only place it had ever rendered was in a screenshot from a debug
hook that was then reverted.

**Decided to keep a version of that hook permanently, dev-only, rather
than either reverting it again or building real territory geometry.**
Building real clickable geometry for Taiwan/Crimea/Western Sahara is a
meaningfully larger task (they aren't part of the rendered UN-193 country
set, and Crimea has no standalone polygon in the source data at all) and
wasn't what was being asked — the user wanted to *see the existing work*,
not a new feature. `window.__debugSelectTerritory(id)` in
`hud/selectionStore.ts`, gated by `import.meta.env.DEV`, gives a reliable
way to do that from the browser console without hitting the module-
identity trap described below, and costs nothing in production since Vite
statically eliminates the dead branch. Worth remembering: a verification
hook that answers "how would anyone actually confirm this without a test
framework" is sometimes worth productizing as a permanent dev affordance,
not just a disposable scaffold — especially for a feature that has no
other way to be observed yet.

## 2026-07-19 — v2.2.2: Entity-based Intelligence HUD, and how to verify a panel with no test framework

**Verifying the Territory card was harder than expected, and the first
approach silently failed.** Tried driving the live app by dynamically
`import()`-ing `selectionStore.ts` from inside `page.evaluate()` and
calling `selectEntity()` on the result. It ran without error and returned
a correctly-resolved territory — but the panel never updated. The likely
cause: a dynamic `import()` injected into the page from outside Vite's own
transform pipeline doesn't reliably resolve to the *same* module instance
the already-mounted React tree is subscribed to (module identity is
URL-keyed, and there's no guarantee the ad hoc path matches Vite's internal
resolution exactly) — so the call almost certainly updated a second,
orphaned copy of the store's `state`/`listeners` that nothing was
listening to. Fixed by temporarily adding a debug hook (`window.
__debugSelectEntity = selectEntity`, guarded by `import.meta.env.DEV`)
*inside* `selectionStore.ts` itself, guaranteeing the call hits the exact
singleton the app uses — then reverted it immediately after confirming
the screenshot, before committing. `git status`/`git diff` after reverting
showed the file byte-identical to before, confirming no debug residue
shipped. Worth remembering next time something needs to be forced into a
running app's state for a screenshot: reach for a temporary hook *inside*
the real module, not a fresh import from outside it.

**Why Territory cards omit CONTROLLER/CLAIMANTS individually instead of
falling back to one "no data" message.** `Territory.status` is a required
field, so anything that resolves as a territory at all always has at least
a Political Status to show — there's no realistic "this territory has
literally nothing to display" case the way an unprofiled country has.
`controllingAuthorities`/`claimants` being empty arrays is the actual
"nothing here" case, and it's per-field, so the omission is per-row
(matching "if no territory fields exist, gracefully omit them" literally)
rather than an all-or-nothing panel-level fallback.

**How this generalizes to a future entity kind (organization, conflict,
infrastructure, ...).** The dispatch in `IntelligencePanel.tsx` is a
two-way check on `selected.entity.kind` — deliberately not a registry/
plugin system like the Layer Engine's (the task said not to touch that,
and two cases don't justify one anyway; see "three similar lines is better
than a premature abstraction"). Adding a third kind means: extend
`ResolvedEntity`'s union in `entities/types.ts`, write one more
`XDetails({ x: X })` component following the same shape as `CountryDetails`/
`TerritoryDetails` (reuse `DataRow`, gracefully omit missing fields), and
add one more arm to the panel's kind check. Nothing about the panel's
outer structure (header, FOCUS CAMERA, close button, the pending-sections
footer) changes — only the middle section swaps.

## 2026-07-19 — v2.2.1: wiring selection to Entity Resolution — the empty-registry problem

**The Country Registry being empty would have silently broken every single
country selection the moment the click handler started calling
`resolveEntity()`.** This was the biggest risk in this version and almost
got missed: v2.1.1 through v2.2.0 built `CountryRegistry`, `EntityResolver`,
and `GeometryMap`, but nothing had ever actually called `registerCountry()`
with real data — `data/countries/countries.json` is still an empty `[]`
(see v2.1's LOGBOOK entry: populating it was explicitly deferred). If
`Countries.tsx`'s click handler had switched to `resolveEntity(id)` without
first making sure the registry actually had all 193 countries in it, every
click would have resolved to `undefined` and (depending on the fallback
logic) either selected nothing or silently regressed to synthesized,
data-less entities — a direct violation of "preserve existing country
functionality," the task's first requirement. Caught this by tracing
through what `resolveEntity` would actually do against the registry's real
(empty) state before writing the click handler, not after.

**Fix: `useCountryFeatures.ts` now registers every fetched feature into the
Country Registry, in the same `.then()` callback that already sets
`features`.** Considered doing this bootstrap in `Countries.tsx` instead
(a `useEffect` on mount), but `useCountryFeatures` is the actual singleton
source of truth (`SearchBar`/`CommandBar`/`Countries` all read from it) and
already runs its population logic exactly once, guarded by the existing
`fetchStarted` flag — piggybacking on that guarantee is more reliable than
adding a second, independent "run once" mechanism in a component that
isn't even the only consumer of the feature list.

**Why `SelectedEntity` denormalizes `id`/`name` instead of consumers
reading `entity.id`/`entity.name`.** Could have required
`IntelligencePanel.tsx` to change `selected.name` to `selected.entity.name`
— a small, mechanical, three-line diff. Chose not to, specifically because
the task said "do not redesign the HUD yet," and even a one-line property
path change is still a change to a file the task asked to leave alone.
Denormalizing costs a small amount of duplication (`id`/`name` exist at two
levels of the object); the payoff is `IntelligencePanel.tsx`,
`Countries.tsx`'s highlight comparisons, `Globe.tsx`'s `CapitalMarker`, and
`useCameraFlight.ts` all needed exactly zero changes, verified by `git
status` showing only the three files that actually needed to change.

**Why `selectCountry()` still exists, unchanged in signature, instead of
updating `SearchBar.tsx` to call `selectEntity()` directly.** Same
reasoning as above, applied to "do not change search": `SearchBar.tsx`
only ever finds countries (it searches the rendered country list;
territories were never in that list), so there was no *behavioral* reason
it needed to change. Kept it calling the exact same function with the
exact same signature, and moved the entity-resolution logic *inside*
`selectCountry()` instead — the compatibility wrapper absorbs the
migration so the search code doesn't have to know it happened.

## 2026-07-19 — v2.2.0: Geometry Map, and Crimea has no polygon

**Crimea does not exist as a standalone feature in Natural Earth's country
data, at any resolution this project has touched.** Went looking for a real
geometry id to use for Crimea's placeholder mapping, the same way Taiwan
(158) and Western Sahara (732) have real ISO 3166-1 numeric ids in the raw
10m source. There isn't one — Crimea is geometrically part of Ukraine's
polygon in this data, not a separately-clickable shape. This is a genuinely
useful thing to have discovered now rather than when someone tries to
actually make Crimea selectable: representing it as its own clickable
region will eventually need either a hand-authored sub-polygon clipped out
of Ukraine's border, or a point-in-region test layered on top of the
existing polygon — not just a registry entry. `GeometryMap` doesn't solve
this (a synthetic placeholder id stands in for now, clearly labeled as
such); it just means the *next* piece of work in this direction has a known
shape instead of being a surprise.

**Why `getEntityForGeometry` resolves all the way to a `ResolvedEntity`
instead of stopping at the entity id.** Could have kept `GeometryMap`
narrowly scoped to "geometry id -> entity id" and made callers chain
`resolveEntity()` themselves. Didn't, because the whole point of this
version (per the goal: prepare the globe for independent territory
selection) is that a future click handler should be able to ask one
question — "what entity does this polygon represent, if any" — and get one
answer. Splitting that into two calls a consumer has to remember to chain
would just relocate the "does this caller know about both registries"
problem `EntityResolver` already solved in v2.1.3, one level up.

**Why `registerGeometryMapping` throws on a duplicate, matching
`CountryRegistry`/`TerritoryRegistry` rather than reconsidering the
convention.** No new reasoning here beyond what's already in the v2.1.1
entry — kept for consistency, since two entities claiming the same polygon
id is exactly the same *kind* of bug as two data sources disagreeing about
a country id, and there's still no benign (HMR-like) reason for a
legitimate duplicate to occur.

## 2026-07-19 — v2.1.3: Entity Resolution layer

**`GeopoliticalEntity` is deliberately just the fields Country and Territory
already both have — no changes to either.** First instinct was to add a
discriminant field (something like `entityKind`) directly to `Country` and
`Territory` in `data/types.ts`, so they'd formally `extends
GeopoliticalEntity`. Decided against it: those two interfaces were already
revised twice this week (v2.1's initial shape, v2.1.2's control/claims
split), and this version's actual job is the resolution layer, not another
schema change. TypeScript's structural typing means `GeopoliticalEntity`
containing only `id`/`name`/`aliases`/`provenance` is satisfied by both
types exactly as they stand today — the interface describes their existing
common ground rather than asking them to grow into it. The discriminant
(`kind`) and the normalized `location` live on `ResolvedEntity` instead,
which `EntityResolver` constructs — so the "unification" happens at
resolution time, not by mutating the source schemas.

**Why `resolveEntity`/`resolveCountry`/`resolveTerritory` return `undefined`
for a miss instead of throwing.** `CountryRegistry.registerCountry()` and
`TerritoryRegistry.registerTerritory()` throw on a *duplicate* registration
because that's a real bug (two sources disagreeing about one id).
Resolution is different: "this id isn't a country" is an entirely normal,
expected outcome for `resolveCountry()` when checking an id that turns out
to be a territory (or vice versa, or neither) — `resolveEntity()`'s whole
implementation is `resolveCountry(id) ?? resolveTerritory(id)`, which only
works cleanly if a miss is a value, not an exception.

**Why this isn't wired into `scene/Countries.tsx`'s click handler yet, even
though "resolve a clicked polygon" is literally the module's stated
purpose.** Explicitly out of scope for this version — the task was the
resolution *seam*, not changing what a click does. Wiring it in means
`Countries.tsx`'s `handlePointerUp` would need to look up the clicked
polygon's id through `resolveEntity()` and branch on `.kind` before calling
`selectCountry()` (which — see `selectionStore.ts` — is currently
country-shaped: `id`/`name`/`direction`, no concept of "this is a
territory"). That's a real, deliberate design decision about how
territory selection should work in the HUD/selection model, not something
to decide as a side effect of adding a resolver.

## 2026-07-19 — v2.1.2: Territory Registry, and separating control from claims

**Why `controllingAuthorities` and `claimants` are separate fields instead of
one field with a type flag.** The original v2.1 `Territory` design had a
single `claimants: TerritoryClaimant[]` list where `claimType` could be
`'de-facto-control'` alongside `'recognized-sovereign'`/`'disputed-claim'`/
`'historical-claim'` — i.e., control was modeled as *one kind of claim*.
Working through the Taiwan/Crimea/Western Sahara examples exposed why that's
the wrong shape: control and claimed sovereignty are answers to two
different questions ("who runs this place" vs. "who says they own it") that
routinely disagree — Russia controls Crimea; that is a separate fact from
whether that control is internationally recognized as legitimate, and the
overwhelming majority of claimants/recognition disagree with it. Modeling
control as a *kind of claim* implicitly encodes an assumption ("control is
itself a claim, on the same axis as recognized sovereignty") that isn't
neutral — it flattens two independent facts onto one scale. Splitting them
into `controllingAuthorities` and `claimants` means a consumer reads two
separate lists and draws its own conclusions (or, more likely, just renders
both) instead of this data model pre-deciding how they relate.

**Why `controllingAuthorities` is a list, not a single value.** Almost
modeled it as `controllingAuthority: ControllingAuthority | null` (singular)
before writing the Western Sahara example, where it became obvious that's
wrong: Morocco and the Polisario Front/SADR each genuinely administer part
of the territory, split by a berm. A singular field would have forced
picking one, which is exactly the "single political interpretation" this
version was asked not to force. Added `extent` as free-text prose (not a
percentage) for the same reason `Conflict.severity` uses a coarse band
instead of a casualty count — precise proportions are themselves usually
contested, and a fake-precise number would just relocate the same problem.

**Why `ControllingAuthority`/`TerritoryClaimant` both take an optional
`ref` plus a required `displayName`, instead of always requiring a
`Country` reference.** Taiwan's controlling authority is its own
government, which isn't a registered UN-member `Country` in this dataset
(see `unMembers.ts` — the app's country data is deliberately scoped to the
193 UN members). Western Sahara's second controlling authority (the
Polisario Front/SADR) has the same problem. Requiring `ref` would make
these — arguably the *most* important examples for this schema to handle
correctly — unrepresentable. This mirrors `ConflictParticipant`'s existing
`ref?`/`displayName?` shape from v2.1, just with `displayName` made
required here since (unlike a conflict participant, which is at least
usually a country) an unregistered claimant/administrator is closer to the
common case for disputed territories than the exception.

**Why the example territories live in an unimported file rather than in
`territories.json`.** `territories.json` is meant to eventually hold a real,
sourced dataset — populating it with three illustrative, admittedly-
simplified examples would make it ambiguous later whether the file's
contents are "the real data" or "worked examples," especially since JSON
can't hold the neutrality caveats these specific examples need inline.
Keeping them in a `.ts` file that's never imported by the app gets the
worked-example value (and lets `tsc` type-check them, which a JSON file
wouldn't) without that ambiguity. Verified they actually register
correctly (all three, no throw, `western-sahara` shows both controlling
authorities) by running the module directly — see the file for the import
line that would wire it in, which nothing currently uses.

## 2026-07-19 — v2.1.1: Country Registry

**Duplicate registration throws here, unlike the Layer Registry's warn-and-
overwrite.** Copied the Layer Registry's shape almost exactly, but changed
this one behavior on purpose. Layer re-registration is a normal, harmless
occurrence (Vite HMR re-executing a placeholder module on save) where
overwriting-with-a-warning is the right call. A duplicate *country*
registration has no equivalent benign cause yet — nothing auto-registers
countries at all right now, so the only way to hit this is two data sources
genuinely disagreeing about the same id, which is a real bug worth stopping
on rather than silently picking whichever one happened to register last.
If a future dynamic-loading system needs idempotent re-registration (a live
refresh re-fetching the same country), that's on the loader to handle
explicitly (check-then-register, or `removeCountry()` first) — the registry
itself stays strict.

**The registry doesn't import `countries.json`.** Deliberately left the
"populate the registry from the JSON file" step undone here, even though
`countries.json` already exists (from v2.1) and importing it would have
been one line. Two reasons: first, it's still an empty array, so wiring it
up right now accomplishes nothing observable — there's nothing to verify
against. Second, and more importantly, baking a specific data source into
the registry module would undercut the actual point of this version ("query
geopolitical entities without knowing where the data comes from") — the
registry is supposed to be the stable seam a future loader plugs into, not
itself coupled to one particular loading strategy. Whatever seeds it later
(a JSON loader, an API-backed Data Engine, both) is a separate, deliberate
piece of work, the same way `layers/placeholders/index.ts` — not
`layerRegistry.ts` — is what actually knows which layers exist.

## 2026-07-19 — v2.1: Data architecture foundations

**Why this is v2.1, not v3.0.** By the changelog's own rule, "a new data
layer" is listed as a new-major-version example — this looked like v3.0
material at first pass. Decided against it: v3.0 (or whichever major is
next) should be a *shippable* new capability, the same way v2.0's Layer
Engine wasn't just types-on-paper but a working, wired-in mount/unmount
system with a HUD toggle. This is one step earlier than that — schema with
nothing populated and nothing reading it — so it's a point release under
v2, not its own major version. Worth naming explicitly since "when does
prep work get its own major version" will come up again.

**Numeric population/GDP instead of the formatted strings `countryProfiles.ts`
uses.** That file stores `"335 Million"` / `"$27.4 Trillion"` because it only
ever feeds directly into the IntelligencePanel's text display. This new
`Country` type is meant for layers that will *compute* with the data —
sort by population, threshold by GDP, choose a marker size — so it stores
plain numbers and leaves formatting to whatever eventually displays them.
Deliberately did not attempt to merge or migrate `countryProfiles.ts` onto
this — that's a real decision (does the intelligence panel become a
consumer of this data, or stay independent?) that shouldn't be made as a
side effect of adding an unrelated schema.

**`EntityRef` is `{ type, id }`, not a bare string id.** Territory ids and
country ids aren't drawn from a shared namespace (countries use ISO
3166-1 alpha-3; territories use ad hoc slugs, since no equivalent standard
covers disputed/dependent regions) — nothing currently guarantees they
can't collide, and a consumer resolving a `Conflict`'s participant or a
`Relationship`'s party needs to know which collection to look in regardless.
Cheap to add now; the alternative (a bare string, disambiguated by
convention or by checking both collections) is the kind of implicit
contract that's easy to get subtly wrong once more than one person/session
is writing data against it.

**Category-shaped fields (`Country.region`, `Territory.status`, etc.) stay
open strings where there's no fixed real-world enumeration.** Same
reasoning as the Layer Engine's `category` field (see the v2.0 entry
below): a closed union means every future region/status value edits a type
file it has no other reason to touch. Where the set of values genuinely
*is* fixed and small (`ConflictParticipant.role`, `Relationship.directionality`)
a union is still used — the distinction is whether new values are expected
over time, not a blanket rule either way.

**Conflict data deliberately has no casualty/statistical fields.** Added a
coarse `severity: 'low' | 'medium' | 'high' | 'unknown'` band instead of
anything numeric. This dataset has no editorial process behind it yet and
ships empty — the same caution the project already applied to
IntelligencePanel's Military/Economy/Diplomacy placeholder sections
("Awaiting data feed" rather than fabricated assessments) extends to not
even shaping a field that would invite a future contributor to casually
fill in sensitive numbers without one.

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
