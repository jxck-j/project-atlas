# Logbook

A running record of meaningful discoveries, non-obvious bugs, and changes of
approach — the *why* behind decisions in the code, for whenever "wait, why did
we do it this way?" comes up later. Not a changelog (see `CHANGELOG.md` for
user-facing *what changed*); this is the debugging/reasoning trail.

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
