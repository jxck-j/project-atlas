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

### Seventh pass: wired into the app for the three verified countries (2026-09-04)

Migration plan step 3 (below) is now done, scoped to exactly Jordan/Kuwait/US — the same three countries
the Sixth pass's build script covers, not the other 190. `scene/UsCityLabels.tsx`/
`UsCityOutlineHighlight.tsx`/`useUsCityOutline.ts`/`useUsCitiesIndex.ts` (US-only) were replaced outright
(not kept alongside) by `scene/CityLabels.tsx`/`CityOutlineHighlight.tsx`/`useCityOutline.ts`/
`useCityIndex.ts` — same population-scored/LOD-gated label reveal and on-demand boundary-fetch-on-select
logic, generalized to read a country-tagged index/shard instead of a hardcoded US one.

**New build step**: `scripts/buildCityBoundariesIndex.mjs` (`npm run build:geo:city-boundaries-index`)
derives the small, always-eager-fetched `public/geo/city-boundaries-index.json` (32,771 entries: Jordan
138, Kuwait 25, US 32,608) from the already-written per-country boundary files
(`city-boundaries/{400,414}.json` + `us-cities-index.json`) — pure local file reads, deliberately NOT
re-hitting Overpass/geoBoundaries, so it can be re-run any time those (sometimes-unreachable) sources
aren't. Centroids for Jordan/Kuwait use a new, simpler `geometryCentroid()` in
`scripts/lib/sphericalGeometry.mjs` (largest-ring average, no antimeridian unwrap — safe for these two
countries, would need the same unwrap treatment `scene/countryGeometry.ts`'s `geometryToCentroid` has
before ever reusing this for a country that crosses the dateline).

**`hud/selectionStore.ts`/`hud/SearchBar.tsx` generalized alongside the rendering components**:
`usCityOutline`/`flyToUsCity` → `cityOutline`/`flyToCity`, both now carrying a `countryId` (plus the
US-only `stateAbbrev`) instead of assuming US/state always. Search's `'us-city-boundary'` entry kind
became `'city-boundary'` (label: CITY BOUNDARY) and its dedup-against-cities.json check
(`SAME_PLACE_RADIUS_RAD`) now runs against the generalized index instead of the US-only one — Amman and
Kuwait City's `cities.json` "major world city" entries correctly get suppressed as duplicates of their
own city-boundary entries, the same as US capitals already were.

**`hud/AttributionCredit.tsx` mounted in `App.tsx` for the first time** — this pass is the point real
OSM- (Jordan) and geoBoundaries- (Kuwait) sourced polygons, plus GeoNames-sourced points, actually render
on screen; the component already existed (built alongside the Sixth pass) but was deliberately held
unmounted until something on screen actually needed crediting. Added OpenStreetMap and geoBoundaries
entries alongside the existing GeoNames one.

**Verified live in-browser** (dev server, Chrome): search finds "Amman" (CITY BOUNDARY, distinct from the
states/provinces layer's own "Amman" ADMIN DIVISION result), "Kuwait City" (CITY BOUNDARY), and
"Chicago, IL" (CITY BOUNDARY, state-qualified) — each flies the camera in and draws its real boundary via
`CityOutlineHighlight`. Jordan's Amman and Chicago's Census Place both render as a clearly visible fill/
border at the fly-to-city distance; Kuwait City's matched geoBoundaries district is real (the fetch
succeeds, the correct feature matches) but barely perceptible at the same camera distance — a genuine
zoom-ceiling/rendering-scale finding, not a wiring bug, now logged in `BACKLOG.md`'s "Max zoom" entry
(originally raised hypothetically before this pass; now a confirmed, observed gap).

**Not done in this pass**: the other 190 countries (still needs the same investigate-before-trusting
per-country work the Fourth/Fifth passes did for Jordan/Kuwait/Botswana/Libya/South Sudan), the 3 Kuwait
towns with no containing polygon (per-city fallback, still open), and migration plan steps 4-6
(validating the US output against Census as ground truth, then retiring `buildUsCitiesData.mjs`'s raw
inputs/`us-cities-index.json`/`us-cities/*.json`/`scripts/vendor/canada/` — those stay as-is since
`buildCityBoundaries.mjs`/`buildCityBoundariesIndex.mjs` still read from them directly, not from a
fully-independent US pipeline).

### Eighth pass: Central America (2026-09-05) — the first real batch beyond the original three

The first test of the "how do we tackle the other 190" question the Seventh pass left open. Central
America (Belize, Costa Rica, El Salvador, Guatemala, Honduras, Nicaragua, Panama — the 7 UN members,
per this project's own North America/Central America/Caribbean split) was picked as the next scope,
prompted directly by the Kuwait finding above: **not every country has a "city" tier at all — some
only have regions/districts, and the pipeline needs to tell the difference before trusting a source,
not after.**

**Recon reused, not redone**: `scripts/cityAdminLevelsReport.json` (the Third pass's all-193-country
geoBoundaries survey) already had a finest-level candidate for all 7 — but its `canonicalName` field is
sometimes blank ("Unknown") or, worse, technically present but wrong, exactly the trap that made
Jordan's mislabeled Liwa level look plausible before. **Real independent-source verification (Wikipedia/
Local Government History wiki, not geoBoundaries' own metadata) before trusting any of them:**

- **Costa Rica** — ADM3, 472-492 units (source count varies by year; geoBoundaries' own snapshot is
  slightly dated), confirmed as real **Distritos** (Provincia → Cantón → Distrito).
- **El Salvador / Guatemala / Honduras** — ADM2, confirmed as real **Municipios**, geoBoundaries' own
  canonicalName was already correct and unambiguous for all three.
- **Nicaragua** — ADM2 (153 units, canonicalName blank in the metadata), confirmed as real **Municipios**
  (Departamento → Municipio, 153 municipios nested in 17 first-level units — matches geoBoundaries' own
  ADM1 count exactly).
- **Panama** — ADM3 (633 units, canonicalName blank), confirmed as real **Corregimientos** (Provincia/
  Comarca → Distrito → Corregimiento) — independent sources cite 640-702 depending on year, same "count
  drifts, identity doesn't" pattern as Costa Rica.
- **Belize — the one real "geoBoundaries has nothing" case, found before it wasted a network round-trip
  on a bad source.** geoBoundaries' only sub-national level for Belize is **"Constituencies"** — Belize's
  31 electoral constituencies, used solely for electing National Assembly members. Real, but cross-cutting
  political geography, not nested settlement boundaries — confirmed against Belize's Local Government
  History wiki and the 2021 municipal elections article. Using it directly would have joined GeoNames
  points against electoral geometry with no relationship to actual town/city footprints. Belize's real
  local-government layer — **9 municipalities** (2 cities, 7 towns, each with an elected council) — has
  no equivalent in geoBoundaries at all.

**Belize's real data exists in OSM, but the "admin_level isn't consistent enough to hardcode" lesson
Kuwait already taught applies again, worse this time.** A direct area-contained Overpass query
(`admin_level=7|8`, same technique as every prior direct-OSM check) found Belize City, Belmopan, and the
combined "San Ignacio & Santa Elena" twin-town council at `admin_level=7`, while the other 6 real towns
(Corozal Town, Orange Walk Town, Dangriga Town, San Pedro Town, Benque Viejo del Carmen, Punta Gorda
Town) sit at `admin_level=8` — **mixed in at that same level with unrelated unincorporated villages**
(Spanish Lookout, Ladyville, Bella Vista, Blue Creek, Hopkins Village, Roseville Mennonite Community, ...)
that OSM tags identically. No flat `admin_level` filter separates "real municipality" from "informal
village" here. With only 9 real municipalities to find, a **hand-curated name list** (verified against
the actual query results, not assumed) was simpler and more correct than trying to infer the distinction
from tags alone — see `scripts/buildCityBoundaries.mjs`'s `BELIZE_MUNICIPALITY_NAMES` set.

**A second, unrelated real bug found by actually running the join against real data:** Panama and
Honduras's geoBoundaries downloads turned out to be **unsimplified full-resolution source shapefiles**,
not pre-simplified data — one Panama corregimiento ("Arco Iris") alone had 631,536 points, and the first
real run produced a 291MB Panama output file and a 159MB Honduras one (Jordan/Kuwait's own geometry never
had anywhere near this vertex density, so this went unnoticed until a country with denser source data hit
the pipeline). The same "check the real output file size, don't assume" discipline that caught the
Sixth pass's US-mega-file bug caught this too. Fixed with a plain-JS Douglas-Peucker simplifier
(`scripts/lib/sphericalGeometry.mjs`'s `simplifyGeometry`, `SIMPLIFY_EPSILON_DEG = 0.001` ≈ 111m at the
equator, applied to every kept feature regardless of country) — verified before picking the constant, not
guessed: a typical Panama feature dropped from ~12,850 points to ~342 with <0.2% area distortion, and even
the "Arco Iris" outlier dropped to ~9,200 points at <1% distortion. Real result: Panama 291MB → 2.6MB,
Honduras 159MB → 1.5MB (Jordan/Kuwait's already-modest files shrank too, from 1.2MB/58KB to 245KB/16KB,
confirming the fix is harmless on geometry that never needed it).

**Final per-country join results** (`npm run build:geo:city-boundaries`, GeoNames points → kept/rejected/
unmatched, same threshold policy as Jordan/Kuwait):

| Country | Points | Kept | Rejected (too large) | Unmatched (no polygon) |
|---|---|---|---|---|
| Costa Rica | 137 | 131 | 0 | 6 |
| El Salvador | 102 | 102 | 0 | 0 |
| Guatemala | 340 | 335 | 5 | 0 |
| Honduras | 544 | 487 | 46 | 11 |
| Nicaragua | 168 | 157 | 11 | 0 |
| Panama | 801 | 783 | 1 | 17 |
| Belize | 138 | 11 | 0 | **127** |

Every rejected/unmatched entry was spot-checked for plausibility, not just counted: Honduras's rejections
are real small villages (population ~900-1,600) landing in genuinely huge municipios (2,000-7,300 km²);
Panama's unmatched are real Guna Yala (San Blas) archipelago communities (Ustupo, Tubualá, Narganá, ...) —
an indigenous comarca whose settlements don't cleanly fall inside the standard corregimiento layer, a real
coverage gap rather than a join bug.

**Belize's 127/138 unmatched is a different, real shape worth naming on its own — not "low coverage," but
"coverage genuinely doesn't exist outside actual incorporated places."** Every one of Belize's 9 real
municipalities was found and kept; the other ~92% of GeoNames points are villages/rural communities that
sit entirely outside any of the 9 municipal boundaries, because Belize's local-government system simply
doesn't cover most of the country's land area — there is no enclosing polygon for those points to fall
into, unlike a join failure where a real containing unit exists but got rejected or missed. This is the
concrete version of the plan's "region-only" classification: Belize isn't a Botswana/Libya/South-Sudan-
style total gap (it has real, usable city data for its actual cities), but it's also not
"full national coverage" the way Jordan/Kuwait/the Central America six otherwise are — a third, distinct
outcome the per-country source table should track explicitly going forward, not collapse into either of
the other two.

**Wired in immediately, not left as a standalone script this time** — `scripts/buildCityBoundariesIndex.mjs`
extended to fold in all 7 new countries (34,777 combined index entries, 5.4MB), no frontend code changes
needed: `scene/useCityIndex.ts`/`useCityOutline.ts`/`CityLabels.tsx`/`CityOutlineHighlight.tsx` are already
country-generic (see the Seventh pass), so a brand-new country just needs its two files
(`city-boundaries-index.json` regenerated, `city-boundaries/{id}.json` written) to work — verified live in
the browser for Panama City and Belize City, both correctly search as CITY BOUNDARY, fly the camera in, and
fetch their real boundary file (`591.json`/`084.json`, both 200). The already-logged max-zoom-ceiling
finding (BACKLOG.md) reproduces here too, unsurprisingly — Panama's corregimientos are similar scale to
Kuwait's districts.

**Net effect on scope**: 9 countries now have real city-boundary data (Jordan, Kuwait, US, Costa Rica, El
Salvador, Guatemala, Honduras, Nicaragua, Panama) plus Belize's partial-by-nature 9-municipality set — 10
total, 183 UN members still unstarted. The approach validated here (recon reuse → independent-source
verification of the finest level's real identity → geoBoundaries as default, OSM/hand-curated fallback only
where geoBoundaries has nothing usable → real per-feature join → check real output file size before calling
it done) is the template for the next batch, not just a Central-America-specific one-off.

### Ninth pass: Canada and Mexico (2026-09-05) — the old per-country vendored plan formally retired

This project's memory carried an older plan from before this doc existed: vendor each country's own
statistics agency data (StatCan for Canada, then a Mexico equivalent), one bespoke parser per country. That
plan is exactly what this doc's Decision section already rejected — a leftover from it, `scripts/vendor/canada/`
(a 155MB StatCan census-subdivision shapefile, fetched by hand, never wired to any build script), was still
sitting untracked in the repo. This pass resolved Canada and Mexico the same investigate-before-trusting way
as every other country, confirmed the vendored data added nothing over the general pipeline, and formally
retired it.

**Both verified clean, no per-country exceptions needed** (recon reused from the Third pass's
`cityAdminLevelsReport.json`, then independently cross-checked against the live geoBoundaries API, each
level's real per-feature names, and Wikipedia — not just geoBoundaries' own metadata, per this doc's
standing discipline):

- **Canada — ADM3 (5,162 units) is, per geoBoundaries' own `boundarySourceURL`, literally Statistics
  Canada's Census Subdivision (CSD) file, 2016 vintage.** Wikipedia confirms CSD is Canada's real
  municipality-equivalent tier (also covering reserves/unorganized territories, which is why its area
  spread runs from 0.0003 km² to over 1,000,000 km² — the same "tiny + huge in one tier" shape Jordan's
  qadas already established the area-plausibility filter needs to handle, not a new problem). Real,
  per-feature names confirmed directly (e.g. "Riverhead," a real Newfoundland CSD).
  **The vendored `scripts/vendor/canada/lcsd000b21a_e.zip` turned out to be a newer (2021) copy of this
  exact same StatCan CSD dataset** — 5,161 records (vs. geoBoundaries' 5,162) with the same field
  richness (CSDUID/name/type/land area/province — nothing beyond what geoBoundaries' own
  `shapeName`/`shapeID` already gives the join). Given the choice, the user's own instruction was direct:
  use whichever source has more data, and if they're the same, use the general source over a bespoke one.
  They're the same. **geoBoundaries wins — zero new parsing code, same download-and-join pattern already
  proven for Kuwait/Central America**, rather than writing a shapefile parser for a 5-year currency
  difference the join doesn't actually need.
- **Mexico — ADM2 (2,457 units) is genuinely municipios**, Wikipedia-confirmed (2,462 today, same
  count-drifts-by-vintage pattern as Costa Rica/Panama) — real per-feature names confirmed (e.g. "Jesús
  María" in Aguascalientes). **One real, logged-not-fixed finding**: Mexico City's 16 alcaldías are
  included in this ADM2 set, and some of their names collide with unrelated municipios elsewhere in the
  country (checked directly: "Cuauhtémoc" appears 4 times, "Benito Juárez" 7 times, across CDMX and
  several other states) — harmless for the actual join, which is point-in-polygon against real geometry
  and never name-based, but worth knowing before any future name-keyed lookup against this data.

**Real per-country join results** (`npm run build:geo:city-boundaries`, same threshold policy as every
prior pass):

| Country | Points | Kept | Rejected (too large) | Unmatched (no polygon) |
|---|---|---|---|---|
| Canada | 3,296 | 3,036 | 232 | 28 |
| Mexico | 16,880 | 14,545 | 2,335 | 0 |

**A real bug, caught the same way the Sixth/Eighth passes' file-size bugs were — by checking the actual
output, not assuming the design was sufficient:** Mexico's join produced a single flat
`city-boundaries/484.json` at **69.9MB — bigger than the exact merged-US-file mistake the Sixth pass
already caught and fixed once** (49MB, fixed by sharding by state). Nothing about the per-feature join
itself was wrong; a country large enough to need 14,545 kept features can also be large enough that ONE
country file is itself the "huge eager-shaped file" problem this project has now hit three times at three
different layers (the original 28MB global-cities file, the US's 49MB merged file, now Mexico's 70MB one).
**Fixed the same way**: `scripts/buildCityBoundaries.mjs`'s new `shardByState()` does a real per-feature
point-in-polygon match of each kept municipio's centroid against Mexico's own admin-1 polygons (reusing
`scripts/vendor/ne_10m_admin_1_states_provinces.geojson`, already vendored for `buildStatesProvincesTopology.mjs`
— no new source needed), grouped into `public/geo/city-boundaries/484/{postal}.json` (32 files, one per
state, matching the two-letter postal codes Natural Earth already carries — same shape as
`us-cities/{state}.json`). 47 of 14,545 features (mostly small coastal/island fragments) matched no state
polygon directly and fell back to nearest-state-by-centroid, logged not silent. Result: 68.3MB combined
across 32 files, avg 2.2MB/state — **still a real, logged residual**: the largest single shard (Veracruz,
212 municipios, 11.9MB) is over 3x the largest existing US state shard (Texas, 3.7MB), so "sharded" here
doesn't yet mean "uniformly small" the way it does for the US. Not fixed further in this pass — flagged for
whoever next tunes `SIMPLIFY_EPSILON_DEG` or considers a second sharding axis.

`useCityOutline.ts`'s previously-US-only state-sharding path (`STATE_SHARDED_COUNTRIES`, was a bare `'840'`
check) generalized to a small set including Mexico's `'484'`; `buildCityBoundariesIndex.mjs` gained a
Mexico-specific loader reading the sharded directory and stamping each entry's `stateAbbrev` from the
shard's own filename (mirroring the pre-existing US block). No changes needed to `SearchBar.tsx` — it
already renders `${name}, ${stateAbbrev}` generically whenever `stateAbbrev` is present, so Mexican search
results now read "Guadalajara, JA" the same way US ones read "Chicago, IL," with zero new code.

**A real, transient operational finding, not a data bug**: the Overpass mirror this script depends on for
Jordan/Belize (`overpass.private.coffee`, working as of the Fourth/Fifth/Eighth passes) accepted a TCP
connection but never responded during this pass (confirmed directly with `curl -v`, not assumed from the
build script hanging). Added `SKIP_OSM=1` as an escape hatch so a re-run needing only the
geoBoundaries-sourced countries (Kuwait, Central America, Canada, Mexico, US) isn't blocked on an
unrelated, unreachable endpoint — Jordan/Belize's own already-committed output is untouched by a
`SKIP_OSM=1` run.

**Verified live in-browser** (dev server, Chrome, with network-request inspection, not just a visual
glance): searching "Toronto" surfaces the real Canadian city (CITY BOUNDARY, unqualified — Canada isn't
state-sharded, so no province suffix, matching Jordan/Kuwait's existing unqualified display) and flies to
a clearly visible, correctly-shaped Census Subdivision boundary right on Lake Ontario's shore, fetched from
`city-boundaries/124.json` (200). Searching "Guadalajara" surfaces "Guadalajara, JA" (CITY BOUNDARY,
state-qualified, distinct from the states/provinces layer's own "Guadalajara" ADMIN DIVISION result) and
correctly fetches `city-boundaries/484/ja.json` (200) — confirming the new state-sharding path resolves
end to end. Guadalajara's own boundary renders at the same barely-perceptible scale as Kuwait's
already-logged max-zoom-ceiling finding (BACKLOG.md) — reproduces the known gap, not a new one.

**`scripts/vendor/canada/` is now confirmed, not just asserted, to be safe to delete** — its data doesn't
beat geoBoundaries' own copy of the same StatCan dataset on either count or field richness, and nothing in
the shipped pipeline reads from it. Left in place pending an explicit decision on deleting 155MB of
hand-downloaded local data (a call for whoever's driving, not assumed here).

**Net effect on scope**: 12 countries now have real city-boundary data (Jordan, Kuwait, US, Costa Rica, El
Salvador, Guatemala, Honduras, Nicaragua, Panama, Belize, Canada, Mexico) — 181 UN members still
unstarted. `public/geo/city-boundaries-index.json` now carries 52,358 entries (8.1 MB) across all twelve.

### Tenth pass: South America, all twelve UN members (2026-09-05)

Recon reused from the Third pass's `cityAdminLevelsReport.json`, then every country independently verified
the same way as every prior pass — geoBoundaries' own `canonicalName` cross-checked against Wikipedia/an
outside source, real per-feature names spot-checked (not just metadata trusted), consistent with the
standing "geoBoundaries' own labels can be wrong" lesson from Belize's constituencies and Guyana's finding
below.

**Six confirmed clean on the first check, and staying on geoBoundaries** — real, correctly-identified
municipality/commune-level divisions with counts matching (within the usual vintage drift) their
independently-sourced totals: Bolivia's Municipios (ADM3, 339 — exact match against Wikipedia), Brazil's
Municipios (ADM2, 5,570 — exact match), Chile's Comunas (ADM3, 345 vs. 346), Colombia's Municipios (ADM2,
1,122 — exact match), Paraguay's Distritos (ADM2, 247 vs. 267 — geoBoundaries' own metadata mislabels the
source as "barrios y localidades," but the actual feature names in the live download — Aregua, Atyra,
Asuncion, ... — are real Paraguayan distrito names, confirmed by inspecting the download itself, not the
metadata label), and Venezuela's Municipios (ADM2, 335 — exact match). Brazil was pre-emptively sharded by
state from the start (`shardByState()`, 26 files, 23 MB combined) rather than checked-then-fixed — it has
more municipios than Mexico (5,570 vs. 2,457), the country whose flat output already hit 70MB once.
**Suriname's Ressorten (ADM2, 62 vs. 63)** also confirmed clean and stayed on geoBoundaries.
**Uruguay's Municipios (ADM2, 124 vs. 125) also confirmed clean at this stage** — real, correctly-identified,
count matching — but was replaced after shipping anyway; see the correction below.

**Four real per-country findings, from actually running the join against real data — not from the recon
alone:**

- **Guyana: geoBoundaries' own ADM2 ("Neighbourhood Councils," 27 units) turned out to be a false lead.**
  Its real feature names ("III-1 Essequibo Islands", "X-1 Right Bank Essequibo", ...) are electoral
  sub-region codes, not Guyana's actual 70 Neighbourhood Democratic Councils + 10 municipalities (80 real
  local-government areas per Guyana's own Department of Public Information/Wikipedia) — the same
  "geoBoundaries' metadata can be wrong, verify the real feature names" lesson Belize's constituencies
  already taught. A direct area-contained Overpass query found the real thing instead: `admin_level=6`
  resolves to 115 relations with genuine names ("City of Georgetown", "New Amsterdam", and real NDC-style
  combined-village names like "Aberdeen - Zorg-en-Vlygt" matching Guyana's actual NDC naming convention).
  23/23 GeoNames points matched with real per-feature names, 21 kept.
- **Peru: geoBoundaries' finest level (Provincias, ADM2, 196 units, mean area 6,565 km²) is real but far too
  coarse.** Peru's actual municipal-equivalent tier is the Distrito (1,873 of them, per Wikipedia) — one
  level deeper than anything geoBoundaries exposes for this country. A live Overpass query for
  `admin_level=8` returned 1,891 relations with genuine distrito names (Alto de la Alianza, Cairani, Calana,
  Candarave, Coronel Gregorio Albarracín Lanchipa, ...), matching Peru's real district count almost exactly.
  This query is ~21x the size of Jordan's (89 relations) and reliably 504-timed-out against
  `overpass.private.coffee` — even a tags-only version with no geometry — which is what prompted checking
  `overpass-api.de` directly (previously logged as unreachable from this environment, back in the Fourth
  pass) and finding it reachable, fast, and able to resolve the full out-geom fetch in ~9s. **This became the
  one Overpass endpoint the whole script uses now** — `overpass.private.coffee` also 504-timed-out on
  Jordan's own unchanged query partway through this pass (real mirror flakiness recurring a second time,
  not a query regression), and re-running everything against `overpass-api.de` instead reproduced Jordan's
  exact prior numbers (138/148 kept). 2,149/2,296 (94%) kept, sharded by region (25 files, 5.9 MB combined).
- **Argentina: geoBoundaries' Departamentos/Partidos (ADM2, 526 units, a real, correctly-identified tier —
  378 departamentos + 135 partidos + 15 CABA comunas, matching the real ~528 total) is NOT the same kind of
  "coarser but workable" trade Ecuador's cantones turned out to be.** The first real join rejected 762/1,204
  points (63%) — and unlike every other coarse-tier rejection logged in this file, the rejected list was
  dominated by genuine provincial-capital cities, not villages in empty rural land: Paraná (pop. 247,139),
  Neuquén (231,198), Formosa (222,226), San Luis (169,947), Comodoro Rivadavia (140,850), San Rafael, Río
  Gallegos, Bariloche. Every one of these departamentos is simply larger than even `LOOSE_MAX_SQKM` (5,000
  km²) in real, populated (non-desert) Argentine provinces — Argentina's population density outside Buenos
  Aires is low enough that a departamento built around one substantial city can still span several thousand
  km². Raising the ceiling to fit Río Gallegos's 33,525 km² departamento would also admit Jordan's actual
  empty deserts (Qada Al-Jafr 28,170 km², Ruwayshid 21,523 km²) as "kept," defeating the point of the
  ceiling — this needed a different source, not a different threshold. A direct OSM check found a real,
  comprehensive `admin_level=8` locality tier instead (2,025 relations nationwide, including real names like
  Buenos Aires, Resistencia, and real surrounding towns), which specifically fixed all four wrongly-rejected
  capitals above. **`admin_level=8` alone still left 417/1,204 unmatched** — spot-checked the largest
  (San Miguel de Tucumán, pop. 548,866, Argentina's 5th-largest city) directly against Overpass and found it
  tagged `admin_level=7`, not 8 — the same "admin_level isn't consistent enough to hardcode, even within one
  country" lesson Kuwait/Belize already taught, recurring a third time. Broadened to `7|8` (Belize's own
  precedent), which also required changing `joinCityPointsToPolygons()` itself: with two levels queried
  together, a real city's `admin_level=7` polygon can sit inside or overlap a larger enclosing
  `admin_level=8` relation, both containing the same point, so the join now keeps the **smallest** containing
  candidate rather than the first one `Array.find()` happened to return — a no-op for every single-level
  source already in this file (a clean partition has at most one containing candidate per point), but
  load-bearing for Argentina. Final result: 1,038/1,204 kept (86%), sharded by province (23 files, 1.5 MB
  combined). **134 remain unmatched, clustered specifically in Buenos Aires and San Juan provinces**
  (Ciudad de Las Heras, San Rafael, San Juan, Zárate, Luján, Olavarría, Berisso, Campana, ... — all real,
  substantial cities) — those two provinces' OSM admin boundaries likely follow a different tagging
  convention than the `admin_level=7` "Municipio de X" pattern that resolved most other provinces cleanly.
  Not investigated further in this pass (logged, not chased) — a real residual gap the same shape as
  Kuwait's 3 or Panama's 17 unmatched towns, just larger in absolute count.

- **Uruguay: geoBoundaries' Municipios (ADM2, 124 units) is real and correctly identified, but has a genuine
  structural gap that a real user report caught in production, not this pass's own review.** First real join:
  103/154 kept, 49 unmatched (32%) — spot-checking the unmatched list found it was, with almost no exception,
  every one of Uruguay's 18 departmental capital cities (Salto, Rivera, Paysandú, Tacuarembó, Melo, Artigas,
  Mercedes, Durazno, Minas, Florida, San José de Mayo, Colonia del Sacramento, Rocha, Fray Bentos, Treinta y
  Tres, Trinidad, ...) — confirmed directly against the live geoBoundaries download, none of these names
  appear anywhere in the 124-feature municipio file. Uruguay's municipio law leaves departmental capitals
  under direct departmental (Intendencia) governance rather than requiring them to form their own municipio,
  so there was no municipio polygon for these cities to match — logged in `BACKLOG.md` as a real structural
  gap, the opposite shape of Belize's (Belize covers its few actual cities and has nothing for the rest of
  the country; Uruguay covers most of the country but has a real carve-out for its most important cities
  specifically), and shipped as-is pending a source that could actually reach them.
  **A direct user report the same day** ("looking at Flores... there are no cities, not even the capital,
  Trinidad") turned out to be the sharpest possible illustration of exactly this gap: Flores department has
  essentially no other town, so losing only its own capital meant the entire department showed nothing.
  Confirmed Trinidad was real in the source (GeoNames, population 22,897) and simply absent from every kept/
  rejected/unmatched bucket for the wrong reason (unmatched, not rejected) — the same root cause already
  logged, now with a concrete, visible consequence. A direct area-contained Overpass query for
  `admin_level=8` found real, comprehensive coverage instead: 628 relations nationwide tagged
  `place=city/town/village` — a populated-place layer, not an administrative-subdivision one, genuinely
  different in kind from every other source in this file — including every departmental capital alongside
  hundreds of smaller towns and beach resorts. Replaced geoBoundaries with this source entirely (not merged):
  144/154 kept (94%, up from 103), 0 rejected, 10 unmatched (small towns only, largest 7,235 population — no
  capitals). Trinidad itself now resolves to a real 6.7 km² polygon. The general lesson already emerging from
  Guyana/Peru/Argentina above — "a country's real settlement geometry can live in OSM under a populated-place
  tag with no administrative-subdivision equivalent at all, not just under a different `admin_level` number
  or a differently-named tier" — is worth carrying into the next 169-country walk as its own thing to check
  for, not only "does a finer administrative level exist."

**Final per-country join results** (`npm run build:geo:city-boundaries`, same threshold policy as every
prior pass):

| Country | Points | Kept | Rejected (too large) | Unmatched (no polygon) |
|---|---|---|---|---|
| Argentina | 1,204 | 1,038 | 32 | 134 |
| Bolivia | 183 | 124 | 59 | 0 |
| Brazil | 5,897 | 5,367 | 528 | 2 |
| Chile | 315 | 262 | 52 | 1 |
| Colombia | 1,179 | 1,116 | 60 | 3 |
| Ecuador | 542 | 441 | 100 | 1 |
| Guyana | 23 | 21 | 2 | 0 |
| Paraguay | 173 | 154 | 19 | 0 |
| Peru | 2,296 | 2,149 | 146 | 1 |
| Suriname | 35 | 32 | 3 | 0 |
| Uruguay | 154 | 144 | 0 | 10 |
| Venezuela | 414 | 320 | 83 | 11 |

(Uruguay's row is its final, post-fix OSM result — see the finding above; its first geoBoundaries-sourced
run was 103 kept/2 rejected/49 unmatched.)

Ecuador's 100 rejections were spot-checked the same way as every prior pass, not just counted: real small
towns in genuinely large cantones (Puerto Francisco de Orellana, pop. 48,144, in a 7,078 km² cantón; Puyo,
pop. 24,881, in a 19,924 km² one) — the same accepted "coarse tier, real fidelity trade" shape as Jordan's
qadas and Panama's corregimientos, not a systematic failure the way Argentina's first run was.

**`ONLY=<comma-separated numeric ids>` added to `buildCityBoundaries.mjs`** — the Argentina fix needed a
second real network round-trip after the rest of South America was already committed-quality, and the
script's original design (always processes all countries top to bottom, one file, no way to target a subset)
would have re-downloaded Mexico/Canada/Brazil/etc.'s already-good output for nothing. Every country block now
checks `shouldRun(numericId)` before doing any network work; omitting `ONLY` entirely reproduces the original
full-run behavior unchanged. Worth keeping for the remaining 169-country walk, where a single-country
re-fetch (a source swap, a bug fix) is going to keep being more common than a fresh full run.

**A real bug in `ONLY` itself, caught immediately by the Uruguay fix needing a second scoped run**: the first
`ONLY=032` (Argentina) re-run silently overwrote `scripts/cityBoundariesReport.json` with only Argentina's
entry, discarding every other country's already-good report data — the report object started empty on every
run regardless of scope, so a partial run produced a partial file. Fixed by seeding `report` from the
existing file on disk when present; a full, unscoped run still overwrites everything correctly, since every
country really did just get re-verified in that case. No effect on the actual boundary data (`city-boundaries/
*.json`), only on this diagnostic-only report file — but worth remembering that `ONLY` needs this treatment
for any other file this script writes cumulatively across countries, not just the report.

**Net effect on scope**: 24 countries now have real city-boundary data (Jordan, Kuwait, US, the 7 Central
American UN members, Canada, Mexico, and all 12 South American UN members) — 169 UN members still
unstarted. `public/geo/city-boundaries-index.json` now carries 63,485 entries (9.8 MB) across all
twenty-four. Verified in-browser is still pending as of this write-up — see the Open Items section.

### Eleventh pass: recovering lost diagnostics, and the first real per-city fallback fix (2026-09-12)

**Found first: `scripts/cityBoundariesReport.json` had silently lost its entries for 10 of the 24 done
countries** (Jordan, Kuwait, Belize, the other 5 Central American countries, Canada, Mexico) — only the 12
South American countries' entries survived. Root cause, traced through git history rather than guessed: this
predates the Tenth pass's own documented `ONLY=` overwrite bug. The first `ONLY=032` (Argentina-only) run,
before the seed-from-disk fix existed, wiped the file down to `{argentina: ...}`; the fix itself was correct,
but by the time it landed, it could only ever seed from that already-wiped file — so the South America run
that followed only ever re-added South America's own 12 keys, and the other 10 countries' diagnostic data
(which specific towns are unmatched, by name/population/coordinates) never came back. This never touched the
actual boundary output (`public/geo/city-boundaries/*.json`), only the diagnostics file — but it meant this
project had no record of which towns needed a fallback for 10 of its 24 done countries. Fixed by re-running
`ONLY=400,414,188,222,320,340,558,591,084,124,484` against the same live sources — every kept/rejected/
unmatched count reproduced exactly (confirming the sources are stable), restoring the full diagnostic detail
with zero change to production data.

**With the real per-town data back, tested the open "per-city fallback" item directly against Kuwait's 3
unmatched towns (Al Mahbūlah, Al Funayţīs, Al Fințās) — and it turned out not to need a bespoke per-city
mechanism at all.** Querying Overpass's `is_in()` at each exact coordinate (a direct "what areas contain this
point" lookup, not a guess at which admin_level/tag to search for) found real `admin_level=6` boundaries,
sourced from Kuwait's own municipal authority (`baladia.gov.kw`), for 2 of the 3 — Al Mahbūlah and Al
Fințās — that geoBoundaries' ADM2 (137 features) simply doesn't cover. This is the exact same "swap the
country's source to OSM's own layer" technique already proven for Jordan/Argentina/Guyana/Peru/Uruguay, not a
new kind of fix. Fetching Kuwait's *entire* `admin_level=6` layer (the same query shape as Jordan's) and
re-running the full join confirms it: 192 real, named relations (Kuwait's own municipal neighborhoods, not an
electoral or metadata-mismatched layer — spot-checked several names against real Kuwaiti place names), 27/28
kept, 0 rejected — up from geoBoundaries' 25/28 kept, 0 rejected, 3 unmatched, with no new rejections
introduced. **Kuwait switched to this source** (`scripts/buildCityBoundaries.mjs`, same `admin_level=6`
Overpass query pattern as Jordan).

**The third town, Al Funayţīs, is a genuinely different kind of gap — not a missing-data problem.** Its own
OSM relation (17935319, also `baladia.gov.kw`-sourced, real name, closes into a valid ~3 km² polygon —
verified by hand-tracing all 12 outer-way segments end-to-end before trusting `relationToGeometry()`'s own
"closed: true" report) exists and is correctly matched by name. GeoNames' own point coordinate for Al
Funayţīs simply lands just outside that polygon's edge — plausible given the polygon is only ~3 km² and
Kuwait's `admin_level=6` layer packs 192 of these next to each other with no room for a point to drift. A
strict point-in-polygon join can't fix this; it would need a "snap to nearest candidate within some small
radius if no exact containment" fallback, which is a real, different kind of change from every fix in this
file so far (all of them were source swaps, not join-logic changes) and wasn't built here — logged in
`BACKLOG.md` instead of attempted speculatively.

**Revised takeaway on the open "per-city fallback" migration-plan item**: for most of the 228 individually
unmatched towns logged across the remaining 12 done countries (Costa Rica 6, Honduras 11, Panama 17, Canada
28, Argentina 134, and smaller counts elsewhere — Belize's 127 excluded, per the structural-gap distinction
above), the likely fix is the same one that just worked for Kuwait: check whether OSM's own admin boundary
layer (fetched country-wide, the same way every OSM-sourced country in this file already is) covers the gap
geoBoundaries left, before reaching for anything more novel. A real per-point "nearest polygon within radius"
fallback (for cases shaped like Al Funayţīs, where the real boundary exists but a point sits just outside it)
is still a distinct, unbuilt idea — worth its own pass once the source-swap approach has been tried on the
rest of the list.

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
2. ~~Not started~~ — **done for 24 countries** (`scripts/buildCityBoundaries.mjs`,
   `npm run build:geo:city-boundaries`; see the Sixth pass for the two real bugs caught building it,
   the Eighth pass for the Central America batch + the vertex-density/simplification bug that batch
   surfaced, the Ninth pass for Canada/Mexico + the Mexico-file-size bug/state-sharding fix, and the
   Tenth pass for all 12 South American UN members + the Guyana/Peru/Argentina/Uruguay
   OSM-over-geoBoundaries fixes, the Overpass-endpoint swap, and the `ONLY=` scoping flag).
   Real per-feature join for Jordan/Argentina (OSM `admin_level` 6 / 7|8), Guyana/Peru/Uruguay (OSM
   `admin_level` 6 / 8 / 8), Kuwait/Costa Rica/El Salvador/Guatemala/Honduras/Nicaragua/Panama/Canada/
   Mexico/Bolivia/Brazil/Chile/Colombia/Ecuador/Paraguay/Suriname/Venezuela (geoBoundaries, each level
   independently verified — see the Eighth/Ninth/Tenth passes), and Belize (OSM, hand-curated
   9-municipality name list) against the already-shipped GeoNames city index; US reused
   `buildUsCitiesData.mjs`'s existing Census output directly, reshaped in place, still sharded by state.
   Output in `public/geo/city-boundaries/` (Mexico, Brazil, Peru, and Argentina all sharded by
   state/province — see `shardByState()`).
   **Not done: the other 169 countries** — each needs the same investigate-before-trusting treatment
   (Fourth/Eighth/Tenth pass) before its own join can run, not a blind batch extension of this script. Also
   not done: the same source-swap-first check for every country's own residual unmatched towns (Panama's
   17, Honduras's 11, Costa Rica's 6, Canada's 28, Colombia's 3, Venezuela's 11, Uruguay's 10, and
   Argentina's 134 — a per-country source can still leave individual cities with nothing; Belize's 127 is a
   different, structural case, not a fallback candidate — see the Eighth/Tenth passes). **Kuwait's own 3 were
   the first tried, in the Eleventh pass**: switching to OSM's own `admin_level=6` layer fixed 2 (down to 1
   real remaining case, a coordinate-precision mismatch rather than missing data — see that pass for why a
   true per-*point* fallback, not just a per-*country* source swap, is still a distinct, unbuilt idea worth
   its own pass). Also not done: further tuning
   Mexico's largest state shards (Veracruz's 11.9MB is still well above the US precedent — see the Ninth
   pass).
3. ~~Generalize `UsCityLabels.tsx`/`UsCityOutlineHighlight.tsx`/
   `useUsCityOutline.ts` into source-agnostic `CityLabels.tsx`/
   `CityOutlineHighlight.tsx`/`useCityOutline.ts`.~~ — **done** (Seventh pass), and confirmed to need
   zero further changes when 7 more countries were added in the Eighth pass — the generalization
   held.
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
  anywhere in `src/hud/` today~~ — **built, and mounted** (Seventh pass
  above). `src/hud/AttributionCredit.tsx` — bottom-right (the one open HUD
  corner, and the universal web-map attribution convention), small/
  unobtrusive text links, `ATTRIBUTIONS` now lists GeoNames, OpenStreetMap,
  and geoBoundaries. Mounted in `App.tsx` as of the Seventh pass, once
  `CityLabels.tsx`/`CityOutlineHighlight.tsx` actually put OSM- and
  geoBoundaries-sourced polygons on screen for real — not held for the full
  cutover (migration plan step 5) after all, since crediting a source that
  genuinely renders something today (even for only 3 of 193 countries) is
  accurate, not premature.
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
  `scripts/buildGlobalCitiesData.mjs`. **Still not consumed by anything** —
  `CityLabels.tsx`/`CityOutlineHighlight.tsx` read a separate, much smaller
  `city-boundaries-index.json` (`scripts/buildCityBoundariesIndex.mjs`)
  scoped to the 12 countries with real boundary data (Seventh/Eighth/Ninth passes),
  not this 193-country GeoNames index. Wiring the label/reveal layer up to
  this file for the other 183 countries (once each has its own verified
  boundary source) is still open — this only produces the two-tier data
  shape a future pass would consume.
- ~~Attribution UI still genuinely unresolved~~ — **built and mounted**,
  see above.
