# City/Admin Boundary Architecture — Scope & Sourcing

Confirmed 2026-09-03. Companion doc to `infrastructure-layers.md` (same
"scope now, source now, build later" shape) — covers the city/admin-boundary
layer specifically, which sits outside that doc's 15-item infrastructure
list. Not a decision to start building yet; this locks the *source* and
*architecture* decision so building it later doesn't repeat this
investigation.

## The problem with the current approach

Today's city data is two unrelated things:

1. **`public/geo/cities.json`** — 223 curated capital/major-city points,
   global, no boundary geometry.
2. **`public/geo/us-cities-index.json` + `us-cities/*.json`** — 32,608 real
   US city boundaries, sourced from Census TIGER, via a dedicated
   `scripts/buildUsCitiesData.mjs` that only knows how to parse that one
   agency's shapefile schema. Rendered by `scene/UsCityLabels.tsx` (the
   population-ranked, LOD-gated label reveal) and
   `scene/UsCityOutlineHighlight.tsx`/`useUsCityOutline.ts` (lazy per-city
   boundary polygon fetch on select/search).
3. A parallel Canada pipeline (StatCan census-subdivision boundaries,
   `scripts/vendor/canada/`) exists on the `geo-data-engine` branch, not
   merged — a second instance of the same per-country pattern, which is
   what made the pattern's cost visible before a third country got started.

**The actual problem this doc resolves:** the plan on file (Canada done,
then Mexico, then Caribbean, then Central America — see project memory) is
per-country by construction — find that country's own statistics agency,
vendor its shapefile, write a bespoke parser for its schema. That doesn't
reach most of the world, and specifically doesn't reach the countries this
project's own use case (conflict-relevant infrastructure, e.g. military
bases — see `infrastructure-layers.md` item 12) cares most about: neither
Jordan nor Kuwait has an equivalent open, accessible official
city-boundary shapefile pipeline waiting to be vendored the way the US
Census Bureau does.

## Decision

**One global source (OpenStreetMap/Overture) for every country, including
the US — no permanent per-country exception.** The existing
two-piece architecture (lightweight ranked point index for the label/reveal
layer, lazy per-entity boundary fetch for the detail layer) stays
unchanged; only the data source and the components' names generalize:

- `UsCityLabels.tsx` → `CityLabels.tsx` — population-floor/LOD/declutter
  logic is already source-agnostic; only the index it reads changes.
- `UsCityOutlineHighlight.tsx`/`useUsCityOutline.ts` →
  `CityOutlineHighlight.tsx`/`useCityOutline.ts` — same lazy-fetch-on-select
  pattern, pointed at OSM/Overture-derived per-city files instead of
  Census's.
- `STATE_CAPITAL_FLOOR`/`isStateCapital` generalizes to GeoNames' own
  `PPLC` (capital-of-a-political-entity) feature code, so low-population
  capitals get the same floor treatment globally (Montpelier VT was the
  original motivating case; Wellington/Canberra/Naypyidaw are the same
  shape elsewhere).

This is a real, accepted fidelity trade — Census/StatCan official data is
more accurate than OSM's crowd-sourced boundaries for the same cities in
the US/Canada. Traded deliberately for uniform global coverage and one
pipeline instead of N, the same kind of trade-off already logged for
Military/Economy/Technology's sourcing choices.

## Sourcing investigation (2026-09-03 spot checks)

**Point/population layer:** GeoNames — one global file, population figures
and a `PPLC` capital flag included, no per-country access differences.
Not independently re-verified in this pass (well-established, standard
gazetteer); worth a real data-quality spot check before the build script
is written, not before this doc is written.

**Boundary polygon layer — direct OSM check:**

| Query | Result |
|---|---|
| Montpelier, VT | Real `relation`, `boundary=administrative` — city-scale polygon |
| Cupertino, CA | Real `relation`, city-scale polygon |
| Cambridge, MA | Real `relation`, city-scale polygon |
| Ann Arbor, MI | Real `relation`, city-scale polygon |
| Amman, Jordan (Nominatim name search) | Only resolved to a bare point — **later shown to be a search-technique gap, not a real data gap** |
| Kuwait City (Nominatim name search) | Only resolved to a bare point — same technique gap |

**Boundary polygon layer — geoBoundaries cross-check** (William & Mary
geoLab's open, CC-BY-style alternative to GADM; evaluated as a possible
primary source):

| Country | Finest ADM level | What it actually contains | Source | License |
|---|---|---|---|---|
| Jordan | ADM2 ("Nahias") | Real city-scale Amman polygon (~25km × 13km bbox — genuinely the urban footprint, not the Governorate) | Wikimedia Commons | Public Domain |
| Kuwait | ADM2 ("Areas") | 137 real neighborhood polygons — Qibla, Sharq, Dasman, Salmiya, Hawalli, etc. (actual Kuwait City districts) | OpenStreetMap (via Wambacher boundary extraction) | ODbL |
| USA | ADM2 ("Counties") | Only ~3,143 counties — **no city-level boundaries at all** | US Census TIGER | Public Domain |

geoBoundaries resolved the Middle East question convincingly, but its US
product caps at county level — coarser than the 32,608 real city
boundaries already in this app. Adopting geoBoundaries as the primary
source would have meant a real granularity downgrade for the US, in direct
tension with "same dataset including the US."

**Follow-up — the "Kuwait resolved via OSM" finding above was only half
right, and the `admin_level=8`-everywhere assumption it led to was wrong.**
Re-querying Overpass directly (not through geoBoundaries) surfaced two real
problems with treating raw OSM as the primary source:

- **Amman has no OSM boundary relation at all.** A direct Overpass query
  for `boundary=administrative` named "Amman" within Jordan returns zero
  results. The real, validated city-scale Amman polygon exists only in
  geoBoundaries' data (sourced from Wikimedia Commons, not OSM) — there is
  nothing to extract from OSM here regardless of query technique.
- **`admin_level` numbering isn't consistent enough to hardcode.** Kuwait's
  actual `boundary=administrative` relations sit at levels 2/4/6/7 — no
  level 8 exists at all. Worse, neither level 6 nor level 7 contains the
  neighborhood names geoBoundaries reported (Qibla, Sharq, Dasman,
  Salmiya, Hawalli): level 7 alone has 848 relations, mostly labeled
  "Block 1"/"NA" — a cadastral/planning tier, not neighborhoods. Whatever
  geoBoundaries' extraction did to produce clean Kuwait City district
  polygons, it wasn't a flat `admin_level=X` filter. OSM's own admin-level
  semantics are genuinely per-country (this is a documented OSM modeling
  inconsistency, not specific to Kuwait), so a build script can't assume a
  fixed level number works globally, or even within one country's own
  boundary relations.

## Final source decision

**geoBoundaries as the default per-country source, not a fallback** — it
has already solved the actual hard problem (which admin level or relation
set is city-equivalent, per country, including cases like Kuwait where raw
OSM tagging doesn't cleanly answer that on its own), across whatever mix of
official/Wikimedia/OSM-derived data each country's finest tier actually
comes from. **Direct OSM queries (area-contained, not name-search) fill in
only where geoBoundaries doesn't reach city-level granularity** — confirmed
so far just for the US (geoBoundaries caps at counties; OSM's
`admin_level=8` there does have real, largely Census-TIGER-derived city
boundaries) — or where geoBoundaries has no entry for a country at all.

This reverses the first draft of this section, which had OSM as primary and
geoBoundaries as fallback — written before the Amman/Kuwait re-check above.
The area-containment-not-name-search lesson is still real and still
applies to whichever direct OSM queries the US (and any other
geoBoundaries-insufficient country) still needs.

## Second refinement: per-feature, not per-country — and two real per-country findings

**The "pick one source per country" framing above still doesn't survive contact with real data.** Tried
building a per-country classifier (does this country's finest level read as city-scale, on average?) and it
failed immediately: Jordan's finest geoBoundaries level has a *mean* feature area (3,281 km²) bigger than the
US county level's *median* (2,273 km²) — even though Jordan's own Amman feature is genuinely city-scale
(~325 km²). The reason: a single administrative level can mix small urban jurisdictions with enormous, nearly
empty desert ones in the same file. No per-country scalar (mean, median, whatever) separates that.

**The real algorithm has to be per-feature, matched against real cities, not a blanket per-country source
pick.** For every real GeoNames city point, find whichever boundary polygon (at whatever source/level a
country uses) actually contains that point, and check *that one polygon's* area. If it's plausibly city-sized,
keep it as that city's boundary. If not (a whole desert sub-district, a whole US county), that specific city
doesn't get a boundary from that source — only *that city* needs a fallback, not its whole country. This is
still not implemented — it's the corrected design, replacing the per-country framing above.

**Two real per-country findings, from actually checking rather than assuming:**

- **Jordan: the right level is Qada/Nahia (OSM `admin_level=6`), not geoBoundaries' offering.**
  geoBoundaries' Jordan ADM2 (labeled "Nahias" in their own metadata) is actually mislabeled — it's the
  Liwa/District level (52 features, matching Wikipedia's independently-stated "52 alwiya"; names cross-verify
  directly, e.g. "Al-Jiza"/"Wadi al-Sayr"/"Sahab" appear in both). The real Qada/sub-district level (a genuine
  city-plus-surrounding-villages cluster, per direct correction) is *finer* than what geoBoundaries exposes for
  Jordan at all — checked their metadata, no ADM3 exists. Found it directly in OSM instead:
  `admin_level=6` resolves to 89 real, correctly-tagged sub-districts (`قضاء ماركا` = Qada Marka, `ناحية عمان` =
  Nahia Amman, `Sahab Sub-District`, ...) — median area 342 km² (vs. the Liwa level's 784 km²), and Amman's own
  entry tightens to 76 km² (vs. ~325 km² at the Liwa level). Real improvement, not just relabeling — but
  **doesn't eliminate the per-feature filter**: Qada Al-Jafr is still 50,353 km² and Qada Al-Azraq 9,368 km²,
  correctly-named real sub-districts that are still vast desert, not a city cluster. Jordan's admin_level=6 is
  better raw material, not a clean solved case.
- **The US doesn't need OSM or geoBoundaries at all.** `buildUsCitiesData.mjs` already produces real, official
  Census Places boundaries (32,608 of them) — more authoritative than anything OSM/geoBoundaries would give,
  and already built/working. The right move is to feed that *existing* output into the unified per-country
  shard format directly, not re-derive similar data from OSM. Simpler and higher-fidelity than the original
  plan.

**Net effect on the per-country source table**: US = reuse existing Census pipeline (no new sourcing needed).
Jordan = OSM `admin_level=6`, verified. Kuwait = geoBoundaries ADM2, verified (from the investigation above).
The other 190 countries are **unverified** — each needs the same real-data check (not an assumption) before
being trusted: does geoBoundaries reach a plausible level, and if not, what does OSM actually call the right
tier in that specific country's own tagging. This is real, unfinished work — nothing beyond these three
countries has been checked.

**Status at handoff: design only, nothing built yet against this refined model.** The two-tier GeoNames
index (migration plan step 1) and the attribution UI are the only things actually implemented so far. The
boundary extraction script itself (step 2) has not been started — a fresh session picking this up should:
(1) implement the per-feature point-in-polygon + area-check join described above, (2) wire in the three known
sources (Census reuse for US, OSM `admin_level=6` for Jordan, geoBoundaries ADM2 for Kuwait) as a first
real, working proof of concept limited to those three countries, verify it in-browser/output before scaling,
then (3) work through the remaining 190 countries the same investigate-before-trusting way — not in one blind
193-country batch.

### Third pass: a per-country admin-level survey, for all 193 countries (2026-09-03)

Step (3) above — working through the other 190 countries — starts with a cheaper first pass than a real
per-feature join: `scripts/researchCityAdminLevels.mjs` (`npm run research:city-admin-levels`) queries
geoBoundaries' own metadata API (`geoboundaries.org/api/current/gbOpen/{ISO3}/ALL/`) for every UN-193
country and records, per ADM level, its local term (`boundaryCanonical`), unit count, and min/mean/max
area in km². **This is reconnaissance, not the per-feature join itself** — it can't replace the real
point-in-polygon-against-actual-cities check the Second refinement section above establishes is necessary
(a level's small *minimum* area, the signal this script filters on, is exactly the trap that made Jordan's
ADM2 look plausible before the real per-feature/per-country check found it was mislabeled Liwas, not
Nahias). What it *does* give: a real, per-country read of what geoBoundaries actually has on offer, so the
190-country walk isn't starting from zero. Report-only, same discipline as
`buildGeoEntityEconomics.mjs` — writes `scripts/cityAdminLevelsReport.json`, never touches curated data.
Full results browsable at the "What Each Country Calls a City" artifact (published 2026-09-03; ask if the
link is needed again — it's not re-derivable from the repo alone since it also embeds the run's output).

**Results:** 190 of 193 countries have at least one ADM level whose smallest feature is ≤ 500 km²
(the same "worth a closer look" bar, not a validation) — reachable via geoBoundaries in principle, pending
the real per-feature filter. Three don't:

- **Botswana** — finest available level (ADM2, 25 units) has a 691 km² minimum. No level geoBoundaries
  offers gets close to city-scale.
- **Libya** — finest available level (ADM1 "Districts," 22 units) has a 1,333 km² minimum — coarser than
  Botswana's, and it's Libya's *only* level below the country as a whole (no ADM2 exists in geoBoundaries
  for Libya at all).
- **South Sudan** — finest available level (ADM2 "counties," 78 units) has a 755 km² minimum. Real,
  genuine geoBoundaries coverage (states down to counties, sourced from South Sudan's own National Bureau
  of Statistics/OCHA) — it's just coarser than the city-scale bar, the same shape as Botswana/Libya, not a
  missing-data case.

  **First run of this script misreported South Sudan as having zero `gbOpen` coverage at all — a real bug
  in the script, caught by direct spot-check (2026-09-04), not a geoBoundaries gap.** Cause: `iso3166.mjs`'s
  `ALPHA3_TO_NUMERIC` deliberately aliases both `SSD` (the real ISO code) and `SDS` (a non-standard code
  Natural Earth's admin-1 layer uses for South Sudan specifically — see that file's own comment) to the same
  numeric id, for `buildStatesProvincesTopology.mjs`'s benefit. This script's naive numeric-id → alpha3
  reversal (`NUMERIC_TO_ALPHA3[num] = a3` for every entry) let whichever alias iterates last silently win —
  `SDS`, which isn't a real ISO 3166-1 code and 404s against geoBoundaries' API — misreporting a real 200-with-
  data response as "no coverage." Fixed by making the reversal keep the first (canonical) alias instead of the
  last; verified this is the only duplicated numeric id in the table today. Worth remembering for **any** future
  script built on `NUMERIC_TO_ALPHA3`, not just this one — the underlying alias is correct and intentional,
  but a naive reversal isn't.

These three are the confirmed next candidates for the same kind of direct-OSM-query investigation that
resolved Jordan — unverified beyond "geoBoundaries alone won't get there," exactly the same status Jordan
and Kuwait had before their own real checks.

**Kept for cross-reference, not as new findings:** re-running this survey reproduced the already-known Jordan/
Kuwait/US numbers (Jordan ADM2 "Nahias," 52 units, 9.8 km² min — the same mislabeled level the Second
refinement section above already found; Kuwait ADM2 "Areas," 138 units — matching the 137 previously spot-
checked directly; US ADM2 "Counties," 3,233 units, no city-level reach) — confirms the script's numbers agree
with the hand-verified findings already on file, not a reason to trust the other 187 countries' numbers to
the same depth yet.

### Fourth pass: direct OSM checks for Botswana, Libya, South Sudan (2026-09-04)

Real per-country investigation (area-contained Overpass queries scanning `admin_level` 3-10, same technique
as Jordan/Kuwait — not name search) for the three countries the third-pass survey flagged as too coarse.
**Unlike Jordan, none of these three resolved to "geoBoundaries mislabeled a level, OSM has the real finer
one."** Three different shapes instead:

- **Botswana — no usable finer source, real gap.** OSM `admin_level=4` (16 relations: South-East District,
  Kgatleng District, Central District, ...) is the district level, coarser than geoBoundaries' own ADM2.
  `admin_level=6` — the real sub-district tier (Wikipedia: 23 sub-districts) — exists in OSM's tagging scheme
  but is almost entirely untagged: only 2 of 23 sub-districts have a real relation (Tsabong, Hukuntsi).
  `admin_level=8` (village) has exactly 1 relation nationwide (Gweta). geoBoundaries' own ADM2 (25 units, 691
  km² min — already essentially the sub-district level, just more complete than OSM's 2-of-23) remains the
  best available source. No city-scale boundary source currently exists for Botswana from either geoBoundaries
  or OSM — a real, unresolved gap, not a technique problem to solve by querying differently.
- **Libya — baladiyat really is the finest *official* tier; this isn't a hidden-level case like Jordan.**
  OSM `admin_level=4` (23 relations: بنغازي/Benghazi, درنة/Derna, الكفرة/Kufra, ...) matches geoBoundaries'
  own 22-23 baladiyat count almost exactly — OSM and geoBoundaries agree on where the ladder stops. `admin_level`
  6/9/10 are all empty — no hidden finer government tier exists to discover, confirmed by a source outside
  either dataset: Libya's baladiyat replaced the governorate system and a further governorate layer was
  proposed but never actually implemented (Wikipedia's Baladiyat/Subdivisions-of-Libya articles), so there's
  no real administrative unit between "baladiyah" (a district that can span an entire city like Benghazi plus
  its surrounding area) and individual named places. Getting a real Tripoli- or Benghazi-scale polygon would
  need a fundamentally different technique than "walk the admin hierarchy deeper" — a place/landuse-tagged
  urban-extent polygon instead of an administrative boundary — which is a different investigation, not
  attempted in this pass.
- **South Sudan — the same shape as Botswana, plus one real exception.** OSM `admin_level=5` (80 relations:
  Maban, Rumbek Centre, Cueibet, ...) is the county tier, matching geoBoundaries' own 78 counties — not
  finer. `admin_level=7` (payam, the real next tier down — 540 real payams per Wikipedia) is essentially
  unmapped: 2 relations nationwide. **The one real exception: `admin_level=8` has 37 relations, all genuine
  Juba neighborhoods** (Munuki West, Hai Juba Nabari, Juba Quarter Council, Hai Orselim, ...) — real
  city-scale data, but capital-only, not a nationwide tier the way Jordan's `admin_level=6` was. A future
  per-feature join could use this for Juba specifically; every other South Sudanese town/city still has
  nothing finer than its 755 km²-minimum county.

**Net effect:** Jordan and Kuwait remain the only two countries where a real per-country OSM/geoBoundaries
check produced a usable *nationwide* finer source. Botswana, Libya, and South Sudan are now confirmed
(not just suspected) real coverage gaps rather than open questions — each investigated the same real,
skeptical way this project's country-code-join bugs (the South Sudan `SSD`/`SDS` alias mixup earlier in this
doc, among others) established the need for: every ISO2 code queried here (BW/LY/SS) was confirmed directly
against `ISO3166-1` alpha-2 before use, not assumed from the country name. South Sudan gets a partial win
(Juba); Botswana and Libya get none. All three stay logged as unresolved in `BACKLOG.md` rather than silently
accepting the coarse geoBoundaries level as "good enough" for their capitals.

### Fifth pass: the real per-feature join, proven end to end for Jordan and Kuwait (2026-09-04)

Built and ran the actual per-feature point-in-polygon + area-check join the Second refinement section design
called for — not just metadata triage this time, real geometry. Method: fetch real candidate polygons
(Jordan: OSM `admin_level=6` via Overpass `out geom;`, assembled from way segments into rings — 89 relations,
0 with holes, all closed; Kuwait: geoBoundaries' own ADM2 GeoJSON, downloaded directly, 137 features), then
for every real GeoNames point already in `public/geo/global-cities-headline.json`/`global-cities/{id}.json`
(no new city sourcing — reused the already-shipped output), find the containing polygon via ray-casting and
keep it only if its spherical area (Chamberlain & Duquette approximation, the same one Turf.js's `area` module
uses) is ≤ 2,000 km². No production code changed — this lived in a scratch script, not `scripts/`.

**Jordan: 148/148 points matched (100%), 135 kept, 13 rejected.** Every rejection was a real desert
qada — Umm ar Raşāş, the Azraq qadas, Al Jafr (28,170 km²), Ruwayshid (21,523 km²) — exactly the shape the
Second refinement section predicted ("Qada Al-Jafr is still 50,353 km²... correctly-named real sub-districts
that are still vast desert"). All 5 headline-tier cities kept, including Amman (277.5 km², matched to Qada
Marka specifically — not the same figure as the ~76 km² noted in the Third refinement pass, because that
earlier number came from matching a qada *named* "Amman," while this join correctly finds whichever qada
actually *contains* Amman's real coordinate, which is Marka — a real demonstration of why per-feature beats
name-matching). **One genuine edge case the threshold is responsible for, not a bug:** Aqaba (95,048
population, a real port city) landed in a 2,042 km² qada — 42 km² over the cutoff — and got rejected. The
2,000 km² figure is a placeholder, not a validated constant; this is exactly the kind of tuning call a real
build script needs to make deliberately (e.g. combine the area check with population density, or raise the
ceiling and accept some real deserts alongside it) rather than something this proof of concept should have
silently gotten right.

**Kuwait: 25/28 matched, 24 kept, 1 rejected, 3 unmatched.** The 1 rejection (Al Wafrah → 3,501 km²) is real
farmland/desert near the Saudi border. **The 3 unmatched points are a different, real finding: geoBoundaries'
137 ADM2 polygons have actual gaps between them** — Al Mahbūlah, Al Funayţīs, Al Finţās (real, populated
coastal towns south of Kuwait City: 18,178 / 1,878 / 23,071 population) fall in no polygon at all. Not a join
bug — geoBoundaries' Kuwait coverage isn't contiguous. Both headline cities (Kuwait City, Al Aḩmadī) matched
and kept correctly.

**What this validates:** the core architecture works end to end for both verified countries, using data
already in the repo. **What it doesn't resolve yet:** the plausibility threshold is still a placeholder
(Aqaba's near-miss shows it needs real thought, not just a round number), Kuwait's polygon gaps mean even a
"verified" source needs a per-city fallback path (not just a per-country one), and this hasn't touched the US
Census-reuse path, output-file format, or the `CityLabels.tsx`/`CityOutlineHighlight.tsx` consumer side yet —
migration plan steps 2 (formalize into a real script + fold in US), 3, and 4 below are all still open.

### Sixth pass: formalized into a real build script — `scripts/buildCityBoundaries.mjs` (2026-09-04)

The Fifth pass's scratch proof of concept is now a real, committed script (`npm run build:geo:city-boundaries`),
covering exactly the three verified countries per the migration plan below — not the other 190 yet. Reusable
join logic moved to `scripts/lib/sphericalGeometry.mjs` (point-in-polygon, spherical polygon area) and
`scripts/lib/osmRelationToGeometry.mjs` (Overpass `out geom;` way-stitching), both written generically enough
for the eventual 190-country pass, not Jordan/Kuwait-specific. Output: `public/geo/city-boundaries/{countryId}.json`
(Jordan, Kuwait) — a GeoJSON `FeatureCollection` per country, `id`/`geometry`/`properties.name` shape matching
`us-cities/{state}.json`'s existing convention, plus `population`/`isCapital`/`areaSqKm`/`source`/
`matchedAdminUnit` — and `scripts/cityBoundariesReport.json` (every unmatched/rejected city, same "report,
don't silently drop" discipline as `buildGeoEntityEconomics.mjs`/`researchCityAdminLevels.mjs`).

**Two real bugs caught by actually running it against real data, not assumed correct from the design alone:**

- **The area-plausibility ceiling's "does this city deserve leniency" check was wired to the wrong population
  threshold.** First version reused `global-cities-headline.json`'s own `HEADLINE_POPULATION_FLOOR` (200,000 —
  a "worth eager-fetching globally" cutoff) to decide which cities got the looser area ceiling. Aqaba —
  95,048 population, the Fifth pass's own motivating example for why a looser ceiling was needed at all —
  still got rejected on the first real run, because 95,048 < 200,000. Two genuinely different questions
  (which cities are worth loading eagerly vs. which cities deserve area leniency) had been collapsed into one
  constant. Fixed with a separate, independent, much lower bar:
  `SUBSTANTIAL_POPULATION_FLOOR = 10,000` (or national capital) grants `LOOSE_MAX_SQKM = 5,000` instead of the
  default `SOFT_MAX_SQKM = 2,000`. Re-running correctly kept Aqaba, Ma'an (50,350 pop), Al Azraq ash Shamālī
  (14,800 pop), and Kuwait's Al Wafrah — Jordan's kept count rose from 135→138, Kuwait's rejected count
  dropped from 1→0. **Rukban** (85,000 population, but its matched polygon is 21,523 km² — Ruwayshid
  Sub-District, the same enormous desert unit Ar Ruwayshid/Ruwaished also fall into) correctly stays
  rejected even with the leniency — real population inside a genuinely too-large polygon should still be
  excluded, and the fix didn't accidentally make the ceiling unconditional.
- **The US path silently regressed the exact problem this project already solved once.** First version merged
  all 56 `us-cities/{state}.json` files into one `public/geo/city-boundaries/840.json` — 32,608 features, 49 MB,
  a single eager-shaped file. That's precisely the "huge flat file" mistake the two-tier GeoNames index
  (headline + per-country detail shards, see the Migration plan's step 1 below) was built specifically to
  avoid, just recreated one layer down (per-country instead of global) for the one country large enough to
  actually hit it. Caught by checking the real output file size, not by re-reading the design intent and
  assuming it followed it. Fixed by keeping the US output sharded by state
  (`public/geo/city-boundaries/840/{state}.json`, same 56 files `us-cities/` already uses) instead of merging —
  same total data, same per-state fetch granularity that already worked, reshaped in place rather than
  collapsed.

**Final validated numbers:** Jordan 138/148 kept (10 rejected, 0 unmatched), Kuwait 25/28 kept (0 rejected,
3 unmatched — geoBoundaries' real polygon gaps, unresolved, see the Fifth pass section), US 32,608 Census
Places carried over unchanged across 56 state shards. Still open: the 3 Kuwait towns with no containing
polygon at all (need a per-city fallback source, not just the per-country one), and everything downstream in
the migration plan (the other 190 countries, the consumer-side components, cutover).

**Only Jordan's and Kuwait's output is committed** (`public/geo/city-boundaries/{400,414}.json` — real data
that cost a real Overpass/geoBoundaries round-trip to produce). **The US output
(`public/geo/city-boundaries/840/`) is `.gitignore`d, not committed** — it's a reshaped duplicate of
already-committed `public/geo/us-cities/*.json` (47 MB), regenerable in seconds with no network calls, so
checking in a second ~50 MB copy of the same underlying data would only double repo size for nothing. Run
`npm run build:geo:city-boundaries` to regenerate it locally.

## Migration plan

1. ~~Build the global point/population index (GeoNames-sourced)~~ — **done**
   (`scripts/buildGlobalCitiesData.mjs`, `npm run build:geo:cities-global`,
   not yet part of `build:geo` or wired into any component). Real output,
   as a two-tier split (see Open Items below for why a flat file was
   rejected after building it once): `global-cities-headline.json` (3,099
   entries, 386 KB, always eager-fetched) + 193 per-country detail shards
   in `global-cities/` (230,698 entries, 27.8 MB combined, lazy-fetched).
   233,797 populated places total across all 193 UN member states.
   Surfaced one real finding along the way: Israel is the only UN member
   with no `PPLC`-flagged capital in GeoNames — Jerusalem is tagged `PPLA`,
   almost certainly because its status as Israel's capital is
   internationally disputed. Logged in `BACKLOG.md`'s Geographic coverage
   section rather than silently patched either direction. Still replaces
   `cities.json`'s 223-entry curated list, not yet cut over.
2. ~~Not started~~ — **done for the 3 verified countries** (`scripts/buildCityBoundaries.mjs`,
   `npm run build:geo:city-boundaries`; see the Sixth pass section above for the two real bugs
   caught building it). Real per-feature join for Jordan (OSM `admin_level=6`) and Kuwait
   (geoBoundaries ADM2) against the already-shipped GeoNames city index; US reused
   `buildUsCitiesData.mjs`'s existing Census output directly, reshaped in place, still sharded by
   state. Output in `public/geo/city-boundaries/`. **Not done: the other 190 countries** — each
   needs the same investigate-before-trusting treatment (Fourth pass) before its own join can run,
   not a blind batch extension of this script. Also not done: a per-*city* fallback for the 3 Kuwait
   towns this pass found with no containing polygon at all (a per-country source can still leave
   individual cities with nothing).
3. Generalize `UsCityLabels.tsx`/`UsCityOutlineHighlight.tsx`/
   `useUsCityOutline.ts` into source-agnostic `CityLabels.tsx`/
   `CityOutlineHighlight.tsx`/`useCityOutline.ts`.
4. Validate the new pipeline's US output against the existing Census data
   as ground truth (does it find the same major cities, comparable
   population figures, reasonable boundary shapes) before cutover.
5. Cut over, then retire `buildUsCitiesData.mjs`, `us-cities-index.json`,
   `us-cities/*.json`, and `scripts/vendor/canada/` (already dead weight —
   never going to be used now).
6. Write the final decision + trade-off into `LOGBOOK.md` once built and
   verified in-browser, per this project's existing discipline for sourced
   data decisions.

## Open items

- ~~GeoNames data-quality spot check~~ — **done.** Amman resolved correctly
  as `PPLC` (capital), population 1,275,857, matching real-world city-proper
  figures. Kuwait City also resolved correctly as `PPLC`, but with a real
  low-population nuance worth knowing before the build script is written:
  its official population (60,064) is genuinely smaller than several other
  Kuwaiti governorates GeoNames tracks separately (Al Ahmadi 637,411;
  Hawalli 164,212) — "Kuwait City" in casual usage spans multiple
  governorates Kuwait's own administrative structure keeps distinct. This
  is exactly the case the `PPLC`-floor generalization (from
  `STATE_CAPITAL_FLOOR`) exists to handle, not a data quality problem.
  Coverage: 1,756 populated places for Jordan, 127 for Kuwait alone — far
  beyond the current 223-entry curated list. License: CC BY 4.0
  (attribution required — see below).
- **Attribution is now a confirmed requirement, not just an open
  question.** This app has never needed a data-attribution UI before —
  every source used today (Natural Earth, Census TIGER, StatCan, World
  Bank WDI) is public-domain-equivalent or doesn't require display
  attribution. GeoNames (CC BY 4.0) and OSM/geoBoundaries'
  ODbL-and-mixed-licensed boundaries both do. ~~No attribution UI exists
  anywhere in `src/hud/` today~~ — **built.** `src/hud/AttributionCredit.tsx`
  — bottom-right (the one open HUD corner, and the universal web-map
  attribution convention), small/unobtrusive text links, an extensible
  `ATTRIBUTIONS` array (GeoNames only so far — add OSM/geoBoundaries once
  the boundary script ships). **Deliberately NOT mounted in `App.tsx`
  yet** — wiring it in happens at cutover (migration plan step 5),
  alongside the data it credits actually going live; crediting a source
  nothing on screen renders from yet would misrepresent what's showing.
- Exact query technique (which geoBoundaries ADM level per country, and
  what the OSM fallback query looks like for country's geoBoundaries can't
  reach deep enough) still needs real design once the build script is
  written. **The `admin_level=8`-everywhere assumption from the first draft
  of this doc was checked and found wrong** (see the Final source decision
  section above) — whatever the fallback query technique ends up being, it
  cannot hardcode a single admin_level number across countries, and
  possibly not even within one country's own relation set.
- Whether every country reaches genuine city-level granularity the way
  Jordan/Kuwait/the US spot checks did, or whether some countries land at
  a coarser level (the way Jordan's ADM2 is districts within a governorate,
  not neighborhoods), is unverified beyond the countries checked here.
- ~~The real global-cities-index output is 28.2 MB, eager-fetched in
  full~~ — **decided and built.** Rather than pick between "shard by
  country" and "shard by zoom/LOD tier," combined them: a small always-
  eager-fetched **headline** file (population ≥ `HEADLINE_POPULATION_FLOOR`
  = 200,000, or any national capital regardless of population, via the same
  floor logic as `STATE_CAPITAL_FLOOR`) plus **detail** shards, one per
  country, fetched lazily only once a consumer's LOD tier and front-facing
  country actually need small-town-level coverage. This is the general
  pattern intended for every future large zoom-gated dataset in this
  project's roadmap (buildings, hospitals, the reserved LOD tiers in
  `src/lod/types.ts`) to follow, not just cities — see LOGBOOK.md's entry
  for the full reasoning, including why "shard by country alone" doesn't
  work for a whole-earth view needing major cities from many countries at
  once. Real output: `global-cities-headline.json` is 3,099 entries, 386 KB
  (down from 28.2 MB eager); 193 per-country detail shards average 148 KB,
  largest (US) ~2.7 MB, median 18 KB — see
  `scripts/buildGlobalCitiesData.mjs`. The consumer side (which hook
  fetches which tier, and when — the generalized `CityLabels.tsx`/
  `CityOutlineHighlight.tsx` work) is migration plan step 3, not done yet;
  this only produces the two-tier data shape.
- Attribution UI still genuinely unresolved (see above) — a placement
  recommendation exists (bottom-right, unobtrusive, matching the HUD's
  existing thin-line/low-opacity styling — the one open HUD corner, and the
  universal web-map-attribution convention) but hasn't been built or
  confirmed.
