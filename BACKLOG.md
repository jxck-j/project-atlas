# Backlog

Ideas, recommendations, and known gaps that have **not** been implemented —
hand-maintained (unlike `CLAIMS.md`, there's no structured source to
generate this from). Not a roadmap or a commitment; a place to write down
"we should probably..." before it's forgotten. Move an item to
`CHANGELOG.md` (and delete it here) once it's actually built — don't let
this file describe features that already exist.

Grouped by theme, not priority. Each item says *why* it's here, not just
*what*, per this repo's usual convention (see `LOGBOOK.md`).

## Data quality — needs a second pair of eyes

- **Gibraltar's inclusion** in the Territory list was an inference (it
  appears in the v3 spec's Known Relationships but not its explicit entity
  list) — confirm this was the intended reading, not an oversight to
  actually exclude.
- **Only 10 relationships have had a real, citation-level accuracy pass**
  (v3.1.4: Falkland Islands/South Georgia/Gibraltar/BIOT/French Southern &
  Antarctic Lands/Palestine/Akrotiri/Dhekelia claimedBy additions, plus the
  Bajo Nuevo/Serranilla Bank corrections — see `LOGBOOK.md`'s v3.1.4 entry
  for the ICJ/treaty citations behind the latter). Everything else in
  `geoEntities.ts` still carries the original "simplified, hand-curated...
  not a comprehensive or authoritative reference" provenance note — the
  other ~46 GeoEntities' claim/administration data hasn't had the same
  scrutiny and may have similar gaps. One noticed in passing:
  `british-indian-ocean-territory`'s entry doesn't model the US military
  presence at Diego Garcia at all (the UK administers BIOT; the US
  operates a leased naval/air base there, similar in shape to the
  Guantanamo Bay entry's `administeredBy` treatment, but nothing here
  reflects it).
- **Kosovo's `claimedBy: Serbia`** and several Territory `parentEntity`
  values (Curaçao/Aruba/Sint Maarten → Netherlands, Åland → Finland, Cook
  Islands/Niue → New Zealand, Norfolk Island/Heard & McDonald → Australia)
  were added beyond the v3 spec's explicit relationship list, on the
  reasoning that the spec's list read as "at least these," not "only
  these." Worth a deliberate sign-off rather than standing entirely on that
  inference.
- **Crimea's classification as `'territory'`** is a placeholder choice —
  none of the five `GeoEntityType` values actually fit a case that's
  neither a dependency nor one of the four named `geopolitical-entity`
  examples. Worth a real decision (a sixth classification? a special case?)
  rather than leaving it in the bucket that happened to compile.
- **No `GeoEntity` in `geoEntities.ts` populates its own `claims` field** —
  every claim relationship is recorded only as `claimedBy` on the claimed
  side (Taiwan claims Spratly Islands/Scarborough Reef in every practical
  sense, but `taiwan.claims` is `[]`; both reefs list Taiwan in their own
  `claimedBy` instead). `ClaimsOverlayLayer.tsx` and
  `generateClaimsDoc.mjs` both now infer the missing direction (see
  `LOGBOOK.md`'s v3.1.3 entry), so nothing currently reads `.claims` and
  gets a wrong answer — but a future consumer that reads `entity.claims`
  directly, without knowing to union it against everyone else's
  `claimedBy`, will. Worth either actually populating `claims` for real
  entities that have one (Taiwan being the obvious first case) or updating
  `GeoEntity`'s doc comment in `data/types.ts` to say outright that
  `claims` is aspirational/unused so far, rather than implying it's just
  sparsely populated.
- **Country display names are inconsistent between sources**: the country
  topology (`countries-un193.json`, via `DISPLAY_NAME_OVERRIDES`) uses
  short forms ("China"), while `GeoEntityRelation.displayName` values
  written by hand in `geoEntities.ts` mostly use long official forms
  ("People's Republic of China"). Cosmetic — `CLAIMS.md` shows both forms
  for the same country in different sections — but worth normalizing to
  one convention if this data ever needs to cross-reference cleanly against
  itself.

## Visualization

- **Claims overlay's dashed border is a real dash, but the "hatching"
  described in the original spec is still an approximation.** A true
  diagonal cross-hatch fill needs a custom shader/texture —
  `ClaimsOverlayLayer.tsx`'s dashed border + prominent fill was chosen as a
  legible stand-in achievable with stock `three.js` materials. Revisit if a
  literal hatch pattern matters more than "visibly flagged, distinct color."
- **`DASH_SIZE`/`GAP_SIZE` constants in `ClaimsOverlayLayer.tsx` were picked
  by eye against `GLOBE_RADIUS`, not tuned against a running browser** — no
  browser tooling was available in the sessions that built v3.1.0/v3.1.1.
  Worth a visual pass to confirm dash rhythm reads well across both large
  claimants (Russia) and tiny disputed features (Scarborough Reef).
- **`hud/LegendPanel.tsx`'s overlay rows are hardcoded to two specific layer
  ids** (`'parent-territory-overlay'`, `'claims-overlay'`) rather than
  driven generically by the Layer Engine registry. A third geopolitical
  overlay layer would need a manual `LegendPanel.tsx` edit to appear in the
  legend — unlike registering the layer itself, which needs no edits
  anywhere else (see `CLAUDE.md`'s Layer Engine section). Consider adding
  an optional `legendColor`/`legendDescription` field to `LayerDefinition`
  if a third overlay layer is ever added, so the legend can iterate the
  registry instead of naming ids.
- **Crimea still has no rendered geometry** — confirmed to genuinely not
  exist as a standalone polygon anywhere in `world-atlas`'s source data (not
  just unimplemented). Hand-authoring a real sub-region shape is possible
  but was explicitly treated as "not this project's call to make casually"
  as far back as v2.2.0 — revisit only with a deliberate decision, not as a
  drive-by fix.

## Planned engines (named in `CLAUDE.md`, none started)

- **Country Engine** — `data/types.ts`'s `Country` interface has
  `population`/`gdpUsd`/`government`/`region` fields the registry never
  populates; only `id`/`name` are set (`scene/useCountryFeatures.ts`).
  `data/countryProfiles.ts` covers ~60 countries with illustrative,
  hand-written data for the Intelligence Panel only — the two datasets were
  deliberately never merged (see `LOGBOOK.md`'s v2.1 reasoning). A real
  Country Engine would need to decide whether to populate the registry from
  a live source or finally reconcile the two datasets.
- **Relationship Engine** — `data/types.ts`'s `Relationship` type (alliances,
  treaties, trade partnerships, tensions) is schema-only; `data/relationships/
  relationships.json` ships empty. Nothing renders a relationship arc
  between two entities anywhere in the app.
- **Intelligence Engine** — `IntelligencePanel.tsx`'s MILITARY / ECONOMY /
  DIPLOMACY / TECHNOLOGY / CURRENT STATUS sections are hardcoded
  "Awaiting data feed" placeholders for every entity, country or GeoEntity
  alike. Deliberately left unfabricated — see `README.md`'s "Notes for
  future work": fabricating country-level assessments for a defense-context
  demo isn't something to do casually. Real data (or an explicit decision
  to keep these placeholder forever) is still open.
- **Data Engine** — every dataset in `src/data/registry/` is hand-curated
  and static; there's no live-refresh mechanism, and every provenance note
  says as much (`confidence: 'estimated'`, "not a comprehensive or
  authoritative dataset").
- **Timeline Engine** — no version of Atlas has any time-based dimension
  (dispute history, when a territory changed hands, etc.) — every dataset
  is a single present-tense snapshot.

## Layer Engine

- **`src/layers/placeholders/` (terrain, infrastructure, conflict) are still
  architecture-validating stubs, not real layers** — each is registration +
  lifecycle logging + a trivial debug marker, unchanged since v2.0. A real
  terrain/infrastructure/conflict layer is still a from-scratch build, not
  a placeholder-to-real upgrade.
- **Relationship arcs as a Layer Engine layer** — once the Relationship
  Engine (above) has real data, rendering alliance/tension arcs between
  entities is a natural `geoOverlays`-style layer, following the same
  pattern `ParentOverlayLayer`/`ClaimsOverlayLayer` established.

## Tooling

- **No test suite exists anywhere in this repo** — verification has always
  been `tsc -b --noEmit` + `oxlint` + manual dev-server driving. Fine for a
  demo-scale project; worth reconsidering if `src/data/registry/` keeps
  growing (the kind of id-mismatch bug documented in `LOGBOOK.md`'s v3.0.1
  entry — alpha-3 vs. numeric country ids — is exactly the class of bug a
  handful of registry-level unit tests would have caught immediately
  instead of shipping silently broken).
- **`CLAIMS.md` only covers `claimedBy`/`claims`** — `administeredBy` and
  `parentEntity` relationships (who actually controls Western Sahara,
  which country each Territory belongs to) have no equivalent generated
  register. Could be a second section in `CLAIMS.md` or a sibling generated
  doc if that information turns out to be useful outside the app itself.
- **`data/registry/GeoEntityRegistry.ts`'s `getRelatedEntities()` has no
  UI consumer yet** — built as general-purpose infrastructure for the
  claims overlay and future relationship-graph views, but only
  `ClaimsOverlayLayer.tsx` currently does its own narrower relationship
  walk rather than calling it. Worth revisiting once a second consumer
  actually needs it, to confirm the function's shape is right rather than
  speculative.

## Not yet verified

- **The v3.1.5 "related country" overlay's dual-role case (Gibraltar: UK as
  parent, Spain as claimant, both highlighted simultaneously) has only
  been checked against the data (`tsx`, not a browser)** — confirmed the
  right two countries and roles resolve, but not that the two markers'
  leader-line callouts (each offset from its own country's centroid) don't
  visually crowd each other at typical zoom levels. No browser tooling was
  available this session either.
- **Mobile/narrow-viewport layout for the v3.1 HUD additions**
  (`LegendPanel`/`Telemetry`'s shared bottom-left stack,
  `IntelligencePanel`'s full-width-on-mobile behavior) was reasoned about
  but never checked in an actual narrow browser viewport — no browser
  tooling was available in the sessions that built it.
- **No accessibility pass** (keyboard navigation, ARIA labeling) has been
  done specifically for the v3 additions (`LegendPanel`, the
  claims/territory overlay toggles in `LayerPanel`, `GeoEntityDetails`).
  The rest of the HUD has the same gap; it isn't v3-specific, just never
  addressed.
