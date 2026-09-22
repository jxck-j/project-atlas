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

### Twelfth pass: the source-swap-first check, run against every remaining unmatched-town country (2026-09-12)

The Eleventh pass's revised takeaway applied directly, one country at a time, using the same is_in()-at-
exact-coordinate technique that resolved Kuwait: for every residual unmatched town, ask OSM directly what
administrative boundary (if any) actually contains that point, at any level, before assuming the gap needs a
novel fix. Five real, different outcomes came out of this pass — not one uniform result — which is itself
the point: "check per-country, don't batch-assume" continues to hold at this stage of the list, same as
every earlier pass.

**`runGeoBoundariesCountry()` gained a new `extraOsm` option** (`scripts/buildCityBoundaries.mjs`) — three of
the five real fixes below turned out to be "geoBoundaries is mostly right, add a supplemental OSM layer,"
not "replace the source entirely" the way every earlier OSM fix in this file (Jordan, Guyana, Peru, Uruguay,
Kuwait) was. The existing join's "smallest containing polygon wins" rule (built for Argentina's own 7|8 mix
in the Tenth pass) makes this safe: a supplemental candidate only ever gets picked where it's smaller than
whatever geoBoundaries candidate also contains the point, or where geoBoundaries has none at all — it can't
make an already-good geoBoundaries match worse.

- **Costa Rica — full source swap, not a supplement.** geoBoundaries' Distritos (ADM3) left 6 unmatched
  (San Vito, San Rafael, San Felipe, Sabalito, Parrita, Canoas). A direct OSM admin_level=8 query resolves to
  495 real, correctly-named distritos (Isla del Coco, Cóbano, Aguacaliente, Dulce Nombre, ... — spot-checked
  against real Costa Rican distrito names, close to Wikipedia's 472-492 count range). Full swap: 136/137
  kept (up from 131), 0 rejected, 1 unmatched (down from 6). The one residual, Canoas, is a real GeoNames
  coordinate-precision issue, not a coverage gap — an is_in() check on its exact point resolves to Panama's
  own Chiriquí province, across the border, in **both** sources; Costa Rica's real Canoas is a genuine border
  town and the point simply lands on the wrong side of the line.
- **Panama — supplemental, not a swap.** geoBoundaries' Corregimientos (ADM3, 632 units) already covers
  783/801 well; its 17 unmatched were mostly real Guna Yala/Darién communities (Tubualá, Narganá, Mulatupo,
  Ailigandí, Achutupo, Puerto Piña, Gonzalo Vásquez, ...) that turned out to have their own real,
  correctly-named OSM admin_level=8 relations geoBoundaries' download simply doesn't include. Added as
  `extraOsm`: 795/801 kept (up from 783), 1 rejected (unchanged), 5 unmatched (down from 17). The remaining 5
  (a second, Colón-area "Tubualá" point, Palenque, a second Narganá-area point, Mulatupo's own duplicate, and
  Cauchero near the Costa Rica border) have no containing boundary in either source — confirmed via the same
  is_in() check, a real structural gap in this specific stretch of remote coastline, not a technique problem.
- **Canada — supplemental, two different real gaps at once.** geoBoundaries' CSD (ADM3, 5,162 units) already
  covers 3,036/3,296; its 28 unmatched split into two unrelated shapes on inspection — Montreal boroughs
  (Ahuntsic-Cartierville, Vieux-Montréal, ...) are their own real admin_level=10 relations one tier below the
  single CSD-level "Montréal" polygon, while some northern-Quebec/BC settlements (Akulivik, Belcarra, ...)
  have a real admin_level=8 relation the CSD download is simply missing. Querying `admin_level~"^(8|10)$"`
  together and adding both as `extraOsm` resolved both shapes in one pass: 3,194/3,296 kept (up from 3,036),
  89 rejected (down from 232 — several of the newly-added finer OSM boundaries replace a huge
  "Unorganized"-tier CSD match that used to push a real town over the ceiling), 13 unmatched (down from 28).
  The residual 13 are almost all small Newfoundland outport towns (Twillingate, Burgeo, Port au Choix, Trout
  River, ...) with no boundary in either source — a real, sparse-OSM-mapping gap in rural Newfoundland (the
  same shape as Botswana/Libya/South Sudan's sparse tagging, just localized to one province), not a technique
  problem.
- **Venezuela — supplemental, and it improved more than just the unmatched count.** geoBoundaries' Municipios
  (ADM2, 335 units) is real but coarse; its 11 unmatched towns' is_in() checks surfaced a real, comprehensive
  finer tier OSM already has — admin_level=7 Parroquia (parish), Venezuela's actual sub-municipio
  local-government layer (1,215 relations, real names spot-checked: "Parroquia Tumeremo," "Parroquia La
  Guaira," "Parroquia San Rafael"). Added as `extraOsm`: 387/414 kept (up from 320), 25 rejected (down from
  83 — Parroquia's smaller polygons keep many real cities that Municipio's larger ones had pushed past the
  ceiling), 2 unmatched (down from 11). This is the one country in this pass where the fix helped the
  rejected bucket as much as the unmatched one — Municipio wasn't just missing coverage, it was actively too
  coarse for cities it did technically contain. The 2 residual unmatched (Los Roques, an island federal
  dependency; La Aguada) have no containing boundary in either source.
- **Argentina — a third admin_level, not a supplemental query on top of the existing 7|8.** The Tenth pass's
  134 remaining unmatched towns clustered specifically in Buenos Aires and San Juan provinces; a direct
  is_in() check explained why — Buenos Aires Province's partidos (its real municipal-equivalent tier; the
  province has no further sub-partido local government at all) are tagged admin_level=5 ("Partido de Zárate,"
  "Partido de Luján," ...), a third level entirely from the two this file already broadened to in the Tenth
  pass. Widening the existing query to `admin_level~"^(5|7|8)$"` (level 5 resolves to "Departamento" in most
  other provinces — coarser than 7|8 there, but only ever picked when nothing finer contains a point, per the
  existing smallest-wins join rule) eliminated every unmatched town outright: 1,106/1,204 kept (up from
  1,038), 98 rejected (up from 32 — genuinely large departamentos/partidos a real city still doesn't fit
  inside even at this coarser fallback), 0 unmatched (down from 134). Unlike Panama/Canada/Venezuela above,
  this is a query-pattern change to the same single source, not an additional source — Argentina's OSM
  candidates already come from one Overpass query, level 5 is simply now part of the same regex.
- **Honduras — checked and confirmed, no change.** A direct OSM admin_level=6 (Municipio) query reproduces
  geoBoundaries' own ADM2 numbers almost exactly (487 kept, 47 rejected, 10 unmatched vs. 487/46/11) — the two
  sources evidently derive from the same underlying Honduran municipio boundaries. This is a real, useful
  negative result, not a wasted check: it confirms the existing source is already correct and complete rather
  than leaving it merely unverified. Of the 11 originally-logged unmatched towns, one (Magdalena) turned out
  to be a genuine GeoNames country-tag error — its coordinate resolves to El Salvador's San Miguel department,
  not Honduras, in both sources — and the rest are real Caribbean coastal/island towns (Islas de la Bahía,
  Gracias a Dios) sitting in real gaps between municipio polygons that no admin-level swap changes.
- **Colombia — checked and confirmed, a real gap, not a wrong-level problem.** All 3 residual unmatched towns
  (Puerto Escondido, Nuquí, Necoclí — real Chocó/Urabá coastal towns) resolve to no administrative boundary
  at all in OSM, at any level — an is_in() query at each exact coordinate returns only "Colombia" itself, the
  country polygon. A different admin_level or a different source can't fix a point that has no containing
  boundary of any kind in OSM's own data for that stretch of coastline.

**Net effect**: of the 7 countries this pass covered, 5 got a real, verified improvement (Costa Rica, Panama,
Canada, Venezuela, Argentina — Argentina's fix alone took its unmatched count from 134 to 0) and 2 were
checked and confirmed already-correct (Honduras, Colombia) rather than left merely unverified. Total
unmatched towns across all 24 done countries dropped from 228 to about 33 (Kuwait's 1, Costa Rica's 1,
Panama's 5, Canada's 13, Colombia's 3, Venezuela's 2, Honduras's 11 unchanged — Belize's 127 structural-gap
towns excluded from this count per the standing distinction). The "check is_in() at the exact unmatched
coordinate before assuming a fix is needed" technique (not just "try a different admin_level and compare
counts") is what made every one of these five real fixes fast to find — worth using first for whatever
countries pick up this same investigation next, over re-deriving country-wide admin-level survey data that a
per-point check answers more directly.

### Thirteenth pass: all 13 UN Caribbean members, and the snap-to-nearest fallback the Twelfth pass left open (2026-09-12)

The next region after all of North/Central/South America: Antigua and Barbuda, Bahamas, Barbados, Cuba,
Dominica, Dominican Republic, Grenada, Haiti, Jamaica, Saint Kitts and Nevis, Saint Lucia, Saint Vincent and
the Grenadines, Trinidad and Tobago. Same investigate-before-trust discipline as every prior batch — recon
from the Third pass's `cityAdminLevelsReport.json`, then a direct OSM `admin_level` survey for all 13
countries at once (an area-contained Overpass query per country, counting relations per level) before
picking a source, since most of these islands are small enough that a parish/district *is* the only real
local-government tier — no separate municipio/distrito layer exists the way it does on the mainland, so
"coarser than a mainland municipio" here doesn't mean "not city-scale" the way it would elsewhere.

**Nine straightforward confirmations** (OSM's own admin_level relation count matches geoBoundaries' unit
count at the same tier, the same bar Bolivia/Brazil/Colombia/Venezuela's exact matches met in the Tenth
pass): Antigua and Barbuda's Parish and Dependency (ADM1, 8), Barbados's Parish (ADM1, 11), Dominica's Parish
(ADM1, 10), Grenada's Parish (ADM1, 7), Saint Kitts and Nevis's Parish (ADM1, 14), Saint Vincent and the
Grenadines's Parishes (ADM1, 6), Bahamas's Second/Third Schedule Districts (ADM2, 33-34 — real feature names
are island/island-region names: Green Turtle Cay, South Andros, San Salvador, Ragged Island, matching the
Bahamas' real ~31 local-government districts), Cuba's Municipios (ADM2, 168 — OSM's own `admin_level=6`
independently sums to the same ~167-168; real names Niquero/Bayamo/Marianao/Cárdenas confirmed against
Cuba's actual municipio list, Marianao among them as one of Havana's own), and Dominican Republic's
Municipalities (ADM2, 155 vs. OSM's 156; real names Azua de Compostela/Neyba/Tamayo confirmed).

**Two "communities" layers inspected directly, not trusted from canonicalName alone** — the standing Belize/
Guyana/Paraguay lesson: Jamaica's ADM2 "community" (827 units, min 0.10 km²) and Saint Lucia's ADM2
"Communities" (547 units, min 0.01 km²) both turned out to have real named-settlement feature names on direct
download inspection (Jamaica: Irish Town, Norbrook, Mavis Bank, Kingston itself; Saint Lucia: Jacmel, Vanard,
Roseau Valley) — genuine fine-grained village/neighborhood polygons, not an electoral or code-based
mislabeling. No OSM survey found a matching finer tier for either (each country's own OSM admin hierarchy
stops at its parishes/districts), but the real feature names are confirmation enough on their own, the same
bar Paraguay's Distritos met when its canonicalName ("barrios y localidades") was wrong but its real feature
names were right.

**Haiti's Communes (ADM3, 140, OSM `admin_level=8` independently confirms ~143)** is a real, correctly
identified municipal tier — Port au Prince, Delmas, Carrefour, Petionville all present and correctly named.

**Trinidad and Tobago needed OSM instead of geoBoundaries, not just a confirmation of it** — geoBoundaries'
ADM1 (14 units) is missing Arima (a real incorporated borough, population ~33,000) entirely, leaving only 13
of Trinidad's real 14 divisions (2 cities + 5 boroughs + 7 regions, confirmed against Wikipedia) plus Tobago
as a 14th combined feature. A direct OSM `admin_level=4` query has the real, complete set instead — all 14
Trinidad divisions including Arima, plus Tobago itself (also tagged `admin_level=4`, in addition to
`place=island`) as a 15th feature, matching Trinidad and Tobago's real total of 15 administrative divisions
exactly where geoBoundaries' own download falls one short.

**First full run: 0 unmatched across all 13 countries** — the cleanest batch yet (South America's own First
run needed the Argentina/Guyana/Peru/Uruguay fixes; Central America needed Belize's hand-curated list).
2 rejected (too large) in Bahamas (San Andros/Andros Town, real towns in a 2,559 km² island-wide district —
the same coarse-tier trade every prior batch has accepted) and 2 in Dominican Republic (Oviedo/Juancho, both
in a 2,059 km² Pedernales municipio). 9 points across 4 countries came back genuinely unmatched on the first
pass, though — Bahamas (Governor's Harbour, Black Point), Dominican Republic (Palmar de Ocoa), Haiti
(Saint-Marc, Cité Soleil, Jérémie, Grand Gosier — Port-à-Piment resolved cleanly, see below), and Trinidad and
Tobago (Mucurapo).

**Haiti's 4 unmatched are what turned this into a general fix, not a per-country one.** All 4 have a real,
correctly-named containing commune polygon in the geoBoundaries download — confirmed by inspecting the
download directly, the way every "geoBoundaries' label might be wrong" check in this file already does — and
a direct `is_in()` check at each exact coordinate independently confirms the same commune via OSM. The
puzzle: why did the join call these "no containing polygon" when the polygon is right there? Measuring the
actual distance from each point to its own named polygon's nearest edge answered it — 0.04km (Saint-Marc),
0.007km (Cité Soleil), 0.008km (Jérémie), 0.313km (Grand Gosier). These aren't the km-scale genuine
coordinate mismatches Kuwait's Al Funayțis/Costa Rica's Canoas were originally logged as — they're the point
sitting essentially ON the boundary line, a floating-point ray-casting edge case (a point exactly on an edge
can be classified either way depending on rounding), not a real gap between two sources' data.

**Built the fix this file's Twelfth pass entry (and `BACKLOG.md`) already flagged as open: a "snap to
nearest candidate within a small radius" fallback**, now that a real case justified it as a general mechanism
rather than one-off per-country weirdness. `scripts/lib/sphericalGeometry.mjs`'s `distanceToGeometryKm()`
(equirectangular point-to-segment distance, planar-projected around the query point's own latitude — the
same "planar is fine at this scale" call `simplifyGeometry`'s Douglas-Peucker already makes) plus
`joinCityPointsToPolygons()`'s new `SNAP_MAX_KM = 2` fallback: any point that fails normal containment now
also checks whether a candidate's edge sits within 2km, and if so keeps it (subject to the same
rejected/kept area-ceiling logic as a normal match) rather than reporting it unmatched. 2km was picked with
real headroom above the actual motivating cases (tens of meters to ~300m) specifically so it stays well
under the distance to a genuine structural gap (Colombia's Puerto Escondido/Nuquí/Necoclí, previously logged
as having no containing boundary in either source at *any* admin level — meaning the nearest real candidate
there is typically many km away) — confirmed this holds by re-running every country with a known residual
after building it, not just assumed from the constant's size (see below).

**A real correctness bug found immediately: nearest-wins isn't always right-wins.** Haiti's Grand Gosier
snapped to "Thiotte" on the first version of this fallback — a neighboring commune, 0.198km away, genuinely
closer than Grand Gosier's own polygon (0.314km) — even though OSM's own `is_in()` at that exact point
resolves to "Commune de Grand Gosier," not Thiotte. Two real communes' boundaries both happened to pass
close to the same point; picking the globally-nearest one picked the wrong neighbor. Fixed by adding a
name-preference tie-break (`normalizeName()`, diacritic/case/whitespace-insensitive — GeoNames and
geoBoundaries/OSM routinely spell the same place differently: Cité Soleil vs. Cite Soleil, Jérémie vs.
Jeremie, Port-à-Piment vs. Port a Piment): prefer a same-named candidate within SNAP_MAX_KM over a closer
differently-named one, falling back to pure nearest-wins only when no same-named candidate is in range.
Re-running confirmed the fix: Grand Gosier → Grand Gosier (0.314km) instead of → Thiotte.

**Re-ran every country with a real logged residual to see how far the general fix reaches** — not assumed
from Haiti's own numbers alone:

| Country | Before | After | What snapped |
|---|---|---|---|
| Kuwait | 1 unmatched | 0 | Al Funayţīs → الفنيطيس (same place, Arabic name), 0.24km |
| Costa Rica | 1 unmatched | 0 | Canoas → Canoas, 0.018km |
| Panama | 5 unmatched | 0 | 5 real snaps (2 to differently-named neighboring comarca hamlets — a genuine duplicate-GeoNames-point shape already logged in the Twelfth pass, not a new bug) |
| Canada | 13 unmatched | 0 | all 13 snapped (Newfoundland outport towns + Montreal-area/northern gaps) |
| Colombia | 3 unmatched | 0 | Puerto Escondido/Nuquí/Necoclí, all to their own same-named candidate, 0.04-0.44km — **the Twelfth pass's "no boundary in either source" conclusion was too pessimistic**: a same-named polygon exists tens to hundreds of meters away, just not exactly containing the point |
| Honduras | 11 unmatched | 5 | 5 real snaps (Limón, French Harbor→Roatan, El Porvenir→Puerto Cortes, El Achiotal, Corozal→La Ceiba); 5 genuine remaining gaps (Sambo Creek, Río Esteban, Punta Piedra, Jericó — real coastal/island gaps; Magdalena — confirmed GeoNames country-tag error, actually in El Salvador) |
| Venezuela | 2 unmatched | 2 | correctly declined — Los Roques (an offshore federal-dependency island) and La Aguada have nothing within 2km in either source, confirming SNAP_MAX_KM doesn't over-reach |

Venezuela's unchanged 2 is as important a result as the other six's fixes — it confirms the 2km radius is
narrow enough to leave a genuine structural gap alone rather than force-matching it to a distant, wrong
polygon. Total residual unmatched across all 37 done countries is now 7 (Honduras 5, Venezuela 2) — down from
33 before this pass.

Net new coverage from this pass alone: 902 real per-city boundary features across the 13 Caribbean countries
(Antigua and Barbuda 41, Bahamas 26, Barbados 16, Cuba 211, Dominica 20, Dominican Republic 212, Grenada 10,
Haiti 114, Jamaica 104, Saint Kitts and Nevis 18, Saint Lucia 38, Saint Vincent and the Grenadines 25,
Trinidad and Tobago 27), plus corrections to the 6 countries in the table above already shipped. 37 of 193 UN
members now have real city-boundary data; 156 remain.

### Fourteenth pass: Northern Europe, the first Europe batch (2026-09-13)

The next continent after the Americas: Denmark, Estonia, Finland, Iceland, Ireland, Latvia, Lithuania,
Norway, Sweden, United Kingdom (the UN-geoscheme Northern Europe subregion). Unlike every prior region,
this one's own recon already existed — the Third pass's `cityAdminLevelsReport.json` covers all 193
countries — so this pass started straight from that report's per-country finest-level numbers instead of
re-running geoBoundaries' metadata API. That turned out to matter: **two of this batch's ten countries had a
real per-feature join disagree with what looked like the finest plausible level on paper**, the exact
failure mode the report's own caveat (recon "can't replace the real point-in-polygon-against-actual-cities
check") warned about, and a third country's only geoBoundaries level wasn't trustworthy at all.

**Six straightforward confirmations**, all matched to real municipality-level polygons at the areas expected
from independent knowledge of each country's real administrative geography: Denmark's Kommune (ADM2, 98,
Copenhagen → 87.8 km² vs. a real ~86 km²), Estonia's linn/vald (ADM2, 215, Tallinn → "Tallinna linn" 158.5
km² vs. a real ~159 km²), Finland's Kunta (ADM3, 313, Helsinki → 201.1 km² vs. a real ~213 km²), Iceland's
Sveitarfélag (ADM2, 74, Reykjavík → "Reykjavíkurborg" 272.4 km² vs. a real ~273 km²), Latvia's pilsētas un
pagasti (ADM2, 589, Riga → "Rīga" 302.5 km² vs. a real ~307 km²), and Norway's Kommune (ADM2, 431, Oslo →
448.8 km² vs. a real ~454 km², Bergen → 460.9 km² vs. a real ~465 km²). Norway's matched-unit names carry an
odd `" nor"`/`" sme"` suffix and the occasional trailing digit (`"Oslo nor"`, `"Kåfjord nor 2"`) — a
geoBoundaries `shapeName` quirk (Norwegian-language and Northern Sámi dual-name municipalities, plus a
duplicate-name disambiguator) that only affects the diagnostic `matchedAdminUnit` field, not the displayed
city name (`properties.name`, sourced from GeoNames) or the matched area — cosmetic, not a join bug.

**Two real "finest level on paper, wrong level in practice" catches — this pass's actual finding.**
Lithuania's and Sweden's own *finest* geoBoundaries level (ADM3 in both cases) looked exactly like every
other country's finest level in the recon report, but a real join against it put Vilnius inside "Naujamiestis
seniūnija" (4.9 km², one eldership *within* Vilnius) and Stockholm inside "Stockholms domkyrkodistrikt" (2.7
km², one parish *within* Stockholm) — real, correctly-named features, just sub-city administrative fragments,
not the city itself. The same trap as Jordan's mislabeled Liwa and Belize's Constituencies, just one level
down: a level can be genuinely real and correctly labeled and still be the wrong *kind* of unit for "the
city's own boundary." Both countries had a real municipality-count tier exactly one level up in the same
recon data (Lithuania's ADM2, "Unknown" canonicalName, 60 units — Lithuania's real 60 savivaldybės; Sweden's
ADM2, "Municipality," 290 units — Sweden's real 290 kommuner) that a blank/"Unknown" canonicalName alone gave
no reason to prefer over ADM3 without actually running the join. Switched both to ADM2; re-verified Vilnius →
"Vilnius city municipality" 399 km² (real ~401 km²) and Stockholm → "Stockholm" 180.2 km² (real ~188 km²).

**Ireland: geoBoundaries had no usable level at all.** Its only sub-national level (ADM2, "Local Electoral
Areas," 166 units) isn't a coarser-but-real city tier the way Ecuador's cantones are — a real join matched
Dublin to "PEMBROKE LEA-5" (9.4 km²) and Cork to "CORK CITY SOUTH CENTRAL LEA-6" (16.8 km²), both real LEA
electoral-ward fragments *within* those cities. OSM's `admin_level=6` alone has the real 26 traditional
counties, but that's coarse enough to reject Cork (population 224,004, Ireland's second-largest city) and
Galway outright — County Cork/County Galway both exceed even `LOOSE_MAX_SQKM`. `admin_level=7` separately
carries the real city/county authorities the 2014 local-government reform created (Cork, Dublin, Fingal,
South Dublin, Dún Laoghaire-Rathdown, "Cathair na Gaillimhe"/Galway City, Limerick, Waterford) mixed in with
redundant re-tagged county polygons for counties that were never split — the same mixed-granularity shape
Argentina's `admin_level` 7|8 query already established a precedent for in this file. Querying `6|7` together
(smallest containing polygon wins, same rule as every other mixed-level query in this file) resolved Cork to
its own 186 km² authority (a real ~187.5 km²) and Galway to 50.2 km² (matching its real area almost exactly),
while every never-split county still falls back to its level-6 boundary. `overpass-api.de` (this file's usual
endpoint) 504'd on every attempt against Ireland specifically, including a plain `out ids` count query with
no geometry, while it answered every other country in this pass without issue — genuinely reachable but
degraded for this one query shape, not a client-side bug. `overpass.private.coffee` answered the identical
query, so this one query is pinned to that endpoint. **One retry against that same endpoint still came back
degraded** (238 expected relations collapsed to a response missing the entire Dublin metro area, surfacing as
92 cities newly "unmatched" including Dublin itself, population 1,024,027) before a clean retry the same
minute returned the real, complete data with 0 unmatched — worth remembering generally: a 200 response from
either Overpass mirror isn't by itself proof of a complete response, if the kept/unmatched counts move
between two runs of an unmodified query against unmodified source data.

**United Kingdom: real, correctly-named, but the wrong granularity, then the same silent-partial-response
risk again.** geoBoundaries' ADM2 and ADM3 are the same 216-unit "Counties and Unitary Authorities" layer
duplicated at both levels (no finer geoBoundaries tier exists) — a first run rejected 2,839/5,918 points
(48%, dwarfing every other country in this pass, including real cities like Manchester and Birmingham sitting
inside a much larger authority than themselves). OSM's `admin_level=8` has a real, finer 232-238-unit layer
(metropolitan/London boroughs, unitary authorities, non-metropolitan districts) that resolves exactly the
cities the 216-unit tier merges away — added as a supplemental `extraOsm` layer (same pattern as Panama/
Canada/Venezuela) rather than a full source swap, since geoBoundaries' own tier is still real and worth
keeping as the fallback wherever `admin_level=8` doesn't reach city-scale either. `runGeoBoundariesCountry`'s
`extraOsm` gained an optional per-call `endpoint` override for this (`overpass-api.de` 504'd repeatedly on
this specific query too) — the first attempt against `private.coffee` came back with only 5 of the expected
~232 candidates (a **silent** partial response: HTTP 200, valid JSON, just an incomplete `elements` array,
the same failure shape Ireland's retry hit above but with no unmatched-count signal to notice it by, since
those 5 candidates were still enough to keep the run from erroring) — caught only by the rejection rate
(48%, unchanged from the pre-`extraOsm` run) not dropping the way every other supplemental-layer addition in
this file has. A second attempt at the identical query, moments later, returned the real, complete 238-
element response. Rejection rate then dropped to 24.3% (1,437/5,918), back in line with Finland/Norway's own
coarse-tier trade-off, and every checked flagship city matched correctly: Manchester 111.5 km² (real ~115.6),
Birmingham 266.9 km² via `osm-admin8` (real ~267.8), Leeds 548.6 km², Liverpool 112.7 km², Glasgow 177.7 km²,
Edinburgh 262.2 km², Cardiff 141.8 km², Belfast 137.1 km² (all within a few percent of their real areas).
**"London" itself resolves to "City of Westminster" (22 km²)** — GeoNames' London point sits in Westminster
specifically, and Greater London has no single `admin_level=8` polygon of its own (it's a two-tier structure,
boroughs below the GLA) — a real structural limitation of "smallest containing polygon wins" for any city
whose everyday name refers to a multi-borough conurbation rather than one administrative unit, not a bug to
fix here.

**Two genuinely interesting unmatched/rejected findings, not just residual noise:**
`Akrotiri`/`Dhekelia` (the British Sovereign Base Areas on Cyprus, pop. 684/10,000) came back unmatched for
the United Kingdom — GeoNames tags them under the UK's country code since they're UK sovereign territory, but
geographically they're on Cyprus, so naturally neither the UK's geoBoundaries nor its OSM `admin_level=8`
layer contains them. Not a bug; this project's GeoEntity registry already has a real, separate entry for the
Cyprus Sovereign Base Areas as its own `GeoEntity` (see the Geopolitical data architecture section) — a
neat, independent corroboration of that entity's real-world basis, not something this pipeline needs to
reconcile. Sweden's 9 unmatched are all small archipelago islands (Styrsö/Donsö/Brännö off Gothenburg,
Sturkö/Hasslö off Karlskrona, Vaxholm/Rindö in the Stockholm archipelago) — real communities whose GeoNames
point sits just outside their parent municipality's simplified mainland-plus-nearby-islands polygon, the same
shape as Denmark's own single unmatched point (Christiansø, an isolated Baltic islet, pop. 90). Finland's one
unmatched point, Raisio (pop. 25,846, a real independent municipality near Turku, not one of the 2010s-era
merger absorptions that account for the other 112 "rejected" Finnish points below), is a genuine
geoBoundaries data gap rather than a join issue — logged to `BACKLOG.md` rather than chased further this
pass, the same single-country-residual treatment Honduras's own remaining 5 got in the Twelfth pass.

**Finland's 112 rejected points are a real, structural artifact of Finnish municipal history, not a source
or join defect** — the large majority resolve to `Oulu` (3,093 km²), which absorbed several smaller
neighboring municipalities (Ylikiiminki, Yli-Ii, Haukipudas among them) in a 2010s municipal-merger wave;
GeoNames still carries the pre-merger town/neighborhood names as separate points, and they now correctly
fall inside the much larger merged Oulu. The same shape as Ecuador's cantón trade-off, just produced by
municipal mergers instead of always having been one large rural unit.

Total across this batch: 10,458 GeoNames points → 8,323 kept, 2,122 rejected (too large — dominated by the
UK's own residual 24.3% and Ireland's 52.5%, both real coarse-tier trades once the level/source fixes above
landed, not join failures), 13 unmatched (all individually accounted for above). 47 of 193 UN members now
have real city-boundary data; 146 remain.

### Fifteenth pass: Western Europe (2026-09-16) — the cleanest batch yet, and a real Overpass-mirror resilience gap found the hard way

Austria, Belgium, France, Germany, Liechtenstein, Luxembourg, Monaco, Netherlands, Switzerland — the second
Europe batch. Same investigate-before-trust discipline as every prior pass: every candidate level's real
per-feature names checked directly (via geoBoundaries downloads and targeted OSM `is_in()` containment
queries at real city centers), not trusted from recon or a level's on-paper area alone.

**Five straightforward confirmations**, each verified by a real `is_in()` (or direct-download) check landing
on a single, correctly-sized feature: Liechtenstein's Gemeinde (ADM1, 11 — Vaduz confirmed), Netherlands'
Municipality (ADM2, 344 — Amsterdam confirmed as its own 918,117-population level-8 relation, already
correctly labeled by geoBoundaries), Switzerland's Municipality (ADM3, 2286 — Zurich confirmed as its own
level-8 relation), Luxembourg's communes (ADM3, 102 — direct download inspection confirms "Luxembourg" city
appears as one whole feature, not fragmented), and Belgium's communes (ADM4, 589, canonicalName blank in
recon — direct download inspection confirms "Bruxelles | Brussel" appears as one whole feature, population-
bearing, not split into its 19 constituent municipalities).

**Austria's own recon-reported "finest" level (ADM4, 7850 units) was the familiar "finest on paper, wrong
kind of unit" trap this file has hit repeatedly (Lithuania/Sweden/Ireland)** — a real `is_in()` check at
Vienna's center resolves the OSM equivalent of ADM4 to "Katastralgemeinde Innere Stadt," a cadastral survey
unit *within* one of Vienna's own districts, not a Gemeinde. ADM3 (2097 units) is Austria's real Gemeinde
tier instead (matching the real ~2,093 count). A real wrinkle checked directly rather than assumed: Vienna's
own Land (state) and Gemeinde (municipality) boundaries coincide in OSM's own tagging — Vienna has no
separate `admin_level=8` relation of its own, only its Land-level `admin_level=4` entry and its 23 internal
districts at `admin_level=9`. Whether this OSM quirk would silently drop Vienna from a geoBoundaries-sourced
ADM3 join was checked directly, not assumed either way: geoBoundaries' own ADM3 download does include "Wien"
as one real, whole feature anyway — its own sourcing isn't a blind mirror of OSM's `admin_level=8` tag, so
this particular OSM quirk doesn't propagate into it.

**Monaco needed a real hybrid, found by testing where each of its 10 GeoNames points actually lands, not
assumed from either candidate level alone.** geoBoundaries' ADM2 (9 quartiers — Fontvieille, Monaco-Ville, La
Condamine, La Rousse, Larvotto, Monte-Carlo, Jardin Exotique, Les Monegetti, Sainte-Dévote) resolves 9 of
Monaco's 10 real named places correctly — Monte-Carlo lands in "Monte-Carlo," La Condamine in "La Condamine,"
etc. But the 10th point — "Monaco" itself, the PPLC/capital entry, population 32,965, the one a search or the
label-reveal layer most often surfaces — lands in "Sainte-Dévote," one specific small quartier with no
special claim to representing the whole city, the same sub-city-fragment trap as every OSM/geoBoundaries
level-mismatch in this file, just affecting one of ten points instead of a whole level. Fixed by special-
casing: the capital point is joined against ADM1 (Monaco's own single whole-country/city polygon, 2.03 km²)
while the other 9 are joined against ADM2's quartiers. 10/10 kept, 0 rejected, 0 unmatched.

**France's ADM5 (35,010 features, canonicalName itself a blended "Arrondissement municipal, Commune simple,
Préfecture, ..." list) turned out to have a real, unfilterable-by-level defect on direct download
inspection** — Paris, Lyon, and Marseille (France's only three communes legally subdivided into their own
arrondissements municipaux) have NO whole-city feature in this file at all, only their 20/9/16 arrondissement
fragments (confirmed: searching the download for "Paris" surfaces "Paris 4e Arrondissement" etc., never bare
"Paris"). A live `is_in()` check at Notre-Dame confirmed OSM's own `admin_level=8` DOES carry a real, whole
"Paris" relation (population 2,133,111, correct) distinct from its own `admin_level=9` arrondissements — so
rather than a full source swap to OSM nationwide (real overkill for 3 of ~35,000 features), the fix drops
ADM5's 45 Paris/Lyon/Marseille arrondissement fragments (an exact `"<City> <N>(er|e) Arrondissement"` name
match — real communes with "Paris"/"Lyon"/"Marseille" as a *substring*, like "Villeparisis" or
"Chazelles-sur-Lyon," don't match this pattern and are correctly left alone) and adds back 3 targeted, cheap
OSM queries (one relation each) for the real whole-city polygons. Verified after the fact: Paris 105.1 km²
(real ~105.4), Lyon 47.9 km² (real ~47.9), Marseille 241.7 km² (real ~240.6) — all three now resolve to their
real administrative area almost exactly. **Result: 15,363/15,363 kept, 0 rejected, 0 unmatched** — the
cleanest large-country result in this project's history, sharded into 96 department files (20.2 MB combined,
largest 1.4 MB) via Natural Earth's own `iso_3166_2` field (France's admin-1 rows here are department-level,
101 of them, not the 13-region level a "state" framing might suggest — `postal` is blank for 99/101 of them,
an unrelated shape from Mexico/Brazil/Peru/Argentina's own province-level rows, so `shardByState()` needed a
non-`postal` abbreviation source for the first time — see below).

**Germany needed a fundamentally different fetch shape, not just a different source or level.**
geoBoundaries' finest level (ADM3, 428 units — kreisfreie Städte + Landkreise, Germany's county-equivalent
tier) is real but only city-scale for the ~107 independent cities; every other town sits inside a whole
Landkreis (mean area 836 km² per the recon report) instead of its own boundary. A direct `is_in()` check
confirmed a real, comprehensive finer tier in OSM: `admin_level=8` (Gemeinde) resolves even a
non-independent town (Dachau, inside Landkreis Dachau) to its own real municipal polygon distinct from its
enclosing Landkreis — the same "geoBoundaries' offering is real but coarser than OSM's own next tier down"
shape as Peru's Provincias/Distritos. A nationwide `admin_level=8` query for Germany's ~10,795 real Gemeinden
proved too heavy for this file's shared Overpass endpoints to answer in one shot — confirmed directly (a bare
`out count`, no geometry, still failed) rather than assumed — so this queries per-Bundesland instead (13
states individually, plus Bavaria split further into its own 7 Regierungsbezirke at `admin_level=5` once
even the whole-Bavaria query alone proved too heavy on its own). Berlin, Hamburg, and Bremen are German
city-states whose Land *is* their Gemeinde — confirmed via the same Vienna-shape `is_in()` check used for
Austria above, both resolve straight from their level-2 country to their own level-4 Land/city boundary with
no municipality level in between — so each is fetched directly by name at `admin_level=4` instead of relying
on the per-state loop to ever find them.

**A real, previously-undiscovered gap in this project's own Overpass-fetch resilience surfaced directly from
running this at Germany's scale — 20 separate area queries against a shared, heavily-loaded public mirror,
far more sustained load than any single-query country in this file has ever put on one mirror in one pass.**
`overpass-api.de` (this file's usual endpoint) went **fully unreachable mid-run** — a real TCP connect
timeout to both of its known IPs, confirmed directly (`curl -v` hung the same way), not a query problem: 9 of
13 states had already fetched successfully against it moments earlier. Switched to
`overpass.private.coffee`, confirmed healthy at the time (the same per-country override Ireland/UK already
needed). Two further, real problems surfaced only once running at this sustained scale, neither hit by any
prior country in this file:

- **`fetchOverpass` had no client-side timeout at all** — a single request to Bayern (before the
  per-Regierungsbezirk split) hung indefinitely past its own `[timeout:120]` Overpass-side directive with
  *no response ever coming back*, so `fetchWithRetry`'s retry loop never got the rejection it needed to move
  on — confirmed by watching the process sit alive, doing nothing, for far longer than any query in this
  file has ever legitimately taken. Fixed with a 180s `AbortSignal.timeout` on every `fetchOverpass` call —
  turns a silent hang into a real, retryable failure without changing behavior for any query that completes
  normally (every one of them, in every prior country, already finishes well under 180s).
- **A single area's total-retry exhaustion used to crash the ENTIRE Germany block**, discarding every other
  state already fetched in the same run — hit twice for real: the first crash (Bayern, on the original
  `overpass-api.de` connect-timeout) lost 9 already-fetched states; the second (Mecklenburg-Vorpommern, on
  `private.coffee` under sustained public load — 6 straight failures, a mix of 504s and the new abort-timeout
  firing) lost the 3 states re-fetched since. Fixed two ways: `fetchGemeinden`'s per-area attempts raised
  from the shared default of 6 to 10 (specifically for Germany, given how aggressively the shared mirror was
  rate-limiting/timing out this pass), and a real try/catch around each area's fetch — a total failure now
  logs the area to a `failedAreas` list in the report and the run continues, the same "report, don't crash"
  discipline every unmatched/rejected list in this file already follows, rather than a silent skip or a
  fatal throw.
- **A third real failure mode — the exact silently-truncated-response shape BACKLOG.md already logged once
  for Ireland/UK in the Fourteenth pass — hit for real here too, and this time there was no human watching
  a rejection-rate to catch it.** Brandenburg's fetch came back a "successful" HTTP 200 with a valid but
  **empty** `elements` array — no error for `fetchWithRetry` to catch, and (unlike the Fourteenth pass's
  UK case) no rejection-rate signal to notice by eye either, since this run's progress log is the only
  thing a human was watching. Caught only because `0 Gemeinden` for a real German state is obviously wrong
  on sight — Brandenburg genuinely has ~409-417. Fixed with a real, generalizable guard this time instead of
  relying on a human to keep noticing: `fetchGemeinden` now throws (folding into the same retry path every
  other error already goes through) whenever a response comes back with fewer than `MIN_PLAUSIBLE_GEMEINDEN`
  (10 — Saarland's real 52 is the smallest this loop ever legitimately expects) elements, and the
  Berlin/Hamburg/Bremen city-state query does the same against its own exactly-known expected count (3).
  Worth carrying this "does the count clear a real, known-plausible floor" check forward as standard
  practice for any future country whose fetch shape allows a cheap sanity bound — not just re-running by eye
  when something looks like it might be wrong.

Sharded by state via Natural Earth's own `iso_3166_2` field, not `postal` — **a real, confirmed data bug in
the vendored Natural Earth file**, found by inspecting it directly rather than trusting the existing
`shardByState()` convention blindly: Brandenburg's `postal` value is "BE," the same value Berlin's real
postal code already uses (should be "BB"). Using `postal` as-is would have silently merged Brandenburg's
cities into Berlin's own shard. `iso_3166_2` ("DE-BB" vs. "DE-BE") has no such collision. `shardByState()`
gained an `abbrevOf` option (a function deriving the shard key from a feature's properties) alongside its
existing `abbrevField` for this — France's own sharding (above) reuses the same option, since its admin-1
rows have no usable `postal` value at all rather than a colliding one.

**A general, cross-country performance fix came out of this pass too, not just Germany-specific ones.**
`pointInGeometry` had no bounding-box pre-check — every city/candidate pair walked the candidate's full ring
regardless of distance, fine at every prior country's scale (Mexico's 2,457 candidates was the previous
high) but genuinely too slow at France's ~35,000-candidate, ~15,000-point scale (an initial unoptimized run
was killed after running substantially longer than every previous country's join combined, still short of
finishing). `sphericalGeometry.mjs` gained `geometryBBox`/`bboxContains` — a cheap `[minLng, minLat, maxLng,
maxLat]` check that can only ever reject a true negative, so it changes nothing about which candidate wins,
only how many full ring walks the join has to do. Re-run with the fix, France's full join completed in
minutes.

**Germany's own fetch needed a second real fix beyond the resilience work above — a wrong admin-level filter,
not just a flaky mirror.** The first full run (after all 20 queries finally succeeded against the congested
mirror) came back with 263 of 11,914 points unmatched — and unlike every other country's residual-unmatched
list in this file, this one was dominated by Germany's own flagship cities: Munich, Cologne, Stuttgart,
Nuremberg, Leipzig, Wuppertal, Wiesbaden, Mannheim, Magdeburg, Lübeck, and more, not a long tail of small
villages. Root cause, found by actually reading the unmatched list rather than assuming the fetch was simply
incomplete: Germany's ~107 kreisfreie Städte (independent cities) are tagged `admin_level=6` in OSM, the same
level a normal Landkreis (county) sits at — confirmed directly by this file's own earlier `is_in()` check on
Munich, which returned no `admin_level=8` result at all, only level 6 ("München"). The per-area query had
filtered to `admin_level=8` only, so it silently found every ordinary town's real Gemeinde but never found a
single kreisfreie Stadt's own boundary. Fixed by widening the filter to `admin_level~"^(6|8)$"` — the same
mixed-level, smallest-containing-polygon-wins pattern Argentina's 5|7|8 and Ireland's 6|7 queries already
established: a kreisfreie Stadt has no `admin_level=8` child of its own, so it's the only, correctly-sized
candidate for its own area, while an ordinary Landkreis's real Gemeinden still win over their own larger
enclosing Landkreis wherever both contain the same point. Re-running the full 20-query fetch (verifying Munich,
Cologne, Stuttgart, Mannheim, Nuremberg, Wiesbaden, Wuppertal, Lübeck, Leipzig, and Magdeburg all resolved to
their own real, correctly-sized polygon afterward — areas within a percent or two of each city's real
administrative area) produced a genuinely clean result: **11,914/11,914 kept, 0 rejected, 0 unmatched** (5
tiny same-name snaps, all well under 1.5km), sharded into 16 state files (23.7 MB combined, largest Bayern at
4.4 MB). Verified live in-browser: searching "Munich" surfaces "Munich, BY" (state-qualified, matching
Mexico/Brazil/Peru/Argentina/France's own sharded-country display convention), flies the camera in, and
renders its real boundary.

**Final status: all 9 Western Europe countries are done and committed** — every one 100% matched (0 rejected,
0 unmatched), 36,763 combined GeoNames points across the pass. 56 of 193 UN members now have real
city-boundary data; 137 remain.

### Sixteenth pass: Southern Europe (2026-09-17) — the third Europe batch, 14 countries, and a real Belgrade-scale finding

Albania, Andorra, Bosnia and Herzegovina, Croatia, Greece, Italy, Malta, Montenegro, North Macedonia,
Portugal, San Marino, Serbia, Slovenia, Spain — the largest single-pass country count yet, chosen as the next
contiguous region per the standing discipline (Southern Europe over a first Africa/Asia/Oceania batch, since
the recon report already had level candidates ready for the whole region).

Same investigate-before-trusting discipline as every prior pass: every candidate level's real per-feature
names checked directly against a live geoBoundaries download, not trusted from
`scripts/cityAdminLevelsReport.json`'s own recon or `canonicalName` alone — several of these had a blank or
garbage `canonicalName` (Bosnia and Herzegovina's literally read `"gbOpen"`, Albania/Italy/Montenegro/San
Marino/Serbia/Slovenia all read `"Unknown"`) but every one resolved to real, correctly-scaled municipality
names on inspection. Twelve of the fourteen were a single straightforward geoBoundaries join with no OSM
supplement needed at all: Albania's pre-2015 communes (ADM3, 373 — a real, deliberate choice of the *finer*
pre-reform tier over the current 61 post-reform bashki, the same reasoning Portugal's freguesia-over-
municipality choice below already established for city-scale matching), Andorra's parishes (ADM1, 7 — all 7
real names present), Bosnia and Herzegovina's opštine/Brčko District (ADM3, 142 — Mostar, Goražde, Brcko
District all real and correctly named despite the garbage canonicalName), Croatia's općine/gradovi (ADM2,
560, including small island units like "Otok Ilovik"), Greece's post-Kallikratis dimoi (ADM3, 326), Malta's
local councils (ADM1, 68), Montenegro's municipalities (ADM1, 23), North Macedonia's opštini (ADM2, 84), San
Marino's castelli (ADM1, 9 — all 9 real names present), Slovenia's municipalities (ADM2, 213), and Portugal's
freguesias (ADM3, 2905).

**Portugal is the one real name-collision trap worth flagging explicitly, even though it needed no code
change**: its 2905 freguesias include many real, differently-located parishes sharing the same name (multiple
distinct "Pinheiro" parishes were the first thing noticed on inspection, in different municipalities
entirely). This is harmless specifically because `joinCityPointsToPolygons` matches by real point-in-polygon
containment, never by name — name is only ever a tie-break for the `SNAP_MAX_KM` fallback — so duplicate
parish names across different municipalities can't cross-match each other. Worth remembering for any future
country with a similarly fine, duplicate-name-prone civil-parish-level tier.

**Italy (ADM4 comuni, 7901 features — matches the real ~7900 comuni count) and Spain (ADM3 municipios, 8205
— matches the real ~8131 count, source-vintage drift accounts for the difference) both needed
`shardByState()`** rather than a flat file, the same "check the actual output file size" discipline as
Mexico/Brazil/France/Germany before them — Italy joins ~11,855 GeoNames points, Spain ~7,400. Italy shards
cleanly on Natural Earth's own `postal` field (110 provinces, no blanks, no collisions). **Spain's own
`postal` field collides the same way Germany's Brandenburg/Berlin bug did** — Ceuta and Melilla both read
`"CE"`, and every mainland province's `postal` value turned out to actually be its *autonomous community's*
code, not a per-province one (every Basque province reads `"PV"`, not a distinct code per province) — caught
by checking the raw vendor file directly rather than assuming `postal` behaves the same way in every country.
`iso_3166_2` has zero collisions across all 52 Spanish provinces and was used instead, the same fix
France/Germany's own blocks needed for an unrelated reason. Both joined with **0 rejected, 0 unmatched**
(Italy: 3 snapped; Spain: 3 snapped).

**Serbia needed a real supplemental-source fix, the same shape as Panama/Canada/Venezuela/UK's own `extraOsm`
above.** Its first run (geoBoundaries ADM2 alone, 145 opštine/gradovi) rejected 44 of 492 points, all matched
to a single "Belgrade" polygon (3235.7 km² — the City of Belgrade's own ADM2 unit spans the whole metro
region, rural exurbs like Mladenovac and Barajevo included, not just the built-up city). Every rejected name
(Vračar, Zvezdara, Palilula, Savski Venac, Stari Grad, Čukarica, Voždovac, Rakovica, Grocka, Barajevo, Sopot,
Mladenovac, ...) turned out to be a real Belgrade inner borough or outer settlement — confirmed directly via a
live Overpass query scoped to Belgrade's own `admin_level=7` area (`area[...][name="Град Београд"]`), which
returned a real, correctly-named `admin_level=9` settlement/borough layer (166 features — the inner boroughs
tagged e.g. `"Београд (Врачар)"`) that resolves the entire rejected list. Added as a supplemental
smallest-containing-polygon-wins source scoped to just Belgrade's own area, not a nationwide `admin_level=9`
fetch (Serbia has thousands of naselja countrywide, and every other Serbian city's own ADM2 unit already
joined with 0 rejections — no reason to pay for a much heavier fetch to fix one city). `overpass-api.de`
504'd/timed-out three times in a row on this specific query during the actual build run (unrelated to the
query itself — a plain recon check against it minutes earlier also hit a "server busy" response, while
`overpass.private.coffee` answered immediately) — pinned to the private.coffee mirror the same way the
Fourteenth pass's Ireland query was. Re-run: **492/492 kept, 0 rejected, 0 unmatched.**

**Two small, genuinely structural residuals, neither chased further**: Montenegro rejected 4 small villages
(Zagrad, Miločani, Kuta, Dučice — all population under 1,000) matched to Nikšić Municipality's 2019 km²
polygon, just over the 2000 km² `SOFT_MAX_SQKM` ceiling — Montenegro's ADM1 is geoBoundaries' finest available
level (confirmed, no ADM2 exists), so unlike Serbia's Belgrade case there's no finer real layer to supplement
with; this is the same "large rural municipality, small low-population village" shape as Jordan's desert
sub-districts, not a data gap. Greece left 2 points unmatched (Kyparissía, Kalamákion) out of 1,986 — in line
with every prior pass's small residual tail (Honduras 5, Sweden 9, United Kingdom 2, ...), not chased since
nothing about 2-out-of-1986 suggested a systemic wrong-level issue the way Germany's 263-major-cities pattern
did.

**Final status: all 14 Southern Europe countries are done and committed** — 25,834 combined GeoNames points
across the pass, all but 6 kept (2 Greece unmatched, 4 Montenegro rejected). 70 of 193 UN members now have
real city-boundary data; 123 remain. Southern and Eastern Europe together were the last un-picked slice of
Europe per this file's own "next logical scope" note — Eastern Europe (Belarus, Bulgaria, Czechia, Hungary,
Moldova, Poland, Romania, Russia, Slovakia, Ukraine) is the natural next Europe batch, though Russia's own
scale/transcontinental extent likely warrants its own dedicated investigation rather than folding into a
routine regional batch the way this pass did.

### Seventeenth pass: Eastern Europe (2026-09-17) — the fourth and last Europe batch, 9 countries, cleanest run yet

Belarus, Bulgaria, Czechia, Hungary, Moldova, Poland, Romania, Slovakia, Ukraine — Russia deliberately excluded
per the Sixteenth pass's own note (its transcontinental scale needs its own dedicated investigation, not a
routine regional batch). Every one of the 9 real-per-feature-checked levels resolved on the FIRST build run
with **0 rejected, 0 unmatched, across all 9 countries** — the first pass in this file's whole history with a
perfectly clean run on every country at once, no follow-up fix commit needed.

Same investigate-before-trusting discipline as every prior pass: every candidate level's real per-feature
names checked directly against a live geoBoundaries (or, for two countries, OSM) download, not trusted from
recon metadata alone. Five straightforward single-source confirmations, each matching a real independently-
known count within the usual vintage drift: Bulgaria's obshtini (ADM2, 265 — exact match), Poland's gminy
(ADM3, 2480 vs. a real ~2477), Czechia's obce (ADM3, 6257 vs. a real ~6254-6258), Slovakia's obce (ADM3, 2941
vs. a real ~2890), Hungary's települések (ADM3, 3357 vs. a real ~3178). All five sit one level below a coarser
district/county tier that was checked and correctly rejected as too coarse — Hungary's own ADM2 is really its
198 járás (districts), each one named after its seat town in a way that could pass for a settlement list at a
glance if only the count (198, not ~3178) hadn't been cross-checked.

**Czechia, Hungary, and Slovakia's own ADM3 downloads have a real, genuine upstream data bug: garbled
diacritics baked into their raw `shapeName` values** (Czechia: `"Kri63nky"`, `"Uhr6nov"`; Hungary: `"Szí©
zhalombatta"`; Slovakia: `"Doln  Srnie"`). Confirmed as a real bug in geoBoundaries' own file, not a
terminal/decode artifact on this project's end — checked the raw response bytes directly (`Kri63nky`'s `6` and
`3` are literal ASCII digit bytes in the source JSON, not a mis-decoded multi-byte character). Harmless for
this project's purposes specifically because `joinCityPointsToPolygons` never uses a candidate polygon's own
name for the final output — every kept feature's `properties.name` is always the GeoNames point's own
(correctly spelled) name; a candidate's name only ever surfaces in the diagnostic `matchedAdminUnit` field and
the `SNAP_MAX_KM` fallback's name tie-break. Also checked each of these three countries' finer ADM4 sibling
level (both Czechia and Slovakia have one) and confirmed it's a sub-municipal cadastral-territory tier, not a
finer settlement tier — real per-feature names there repeat one real municipality split into several
disambiguated pieces (Czechia's `"X u Y"` naming is itself the standard Czech convention for disambiguating
same-named cadastral units, not settlements; Slovakia's `"Male Ko eckn Podhradie"` / `"Velk  Koeeck  Podhradie"`
are two halves of one real village) — using ADM4 would have split real single cities across multiple candidate
polygons for zero benefit, confirming ADM3 as the correct (not merely first-tried) choice for both.

**Romania's only sub-national geoBoundaries level below its 42 counties, ADM2 (3235 units), is mislabeled
`"municipalities"` in geoBoundaries' own metadata** but confirmed by real per-feature inspection to actually be
Romania's full LAU2 tier (comune + orașe + municipii combined — real count ~3181, matching within the usual
vintage drift) — the same "trust the real feature names/count over a wrong metadata label" call already made
for Paraguay's `"barrios y localidades"` mislabel and Bosnia's blank `canonicalName`. Real per-feature names are
ALL CAPS with genuine duplicates across different counties (`"BUJORU"`, `"ISLAZ"`, `"CIUPERCENI"` each appear
twice) — harmless for the same reason Portugal's freguesia name collisions were harmless above: real
point-in-polygon containment, never name-based matching, except for the snap fallback's tie-break among
whatever candidates a single unmatched point is actually near.

**Ukraine's finest geoBoundaries level, ADM3 (10375 units, canonicalName `"Village Councils"`), is a real but
dated snapshot** — the pre-2020-reform silski/miski rady tier (its own ADM2, 495 units, matches the old
pre-reform raion count too, not the post-2020 amalgamated hromada system). Real per-feature names are the
standard Ukrainian adjectival council-name form (`"Tinystivska"`, `"Pushkinska"`) — genuine, not garbled. No
finer level exists in geoBoundaries for Ukraine, so this is simply the finest real option available, the same
"accept the vintage/coarseness the source actually has" call already made for Panama's corregimientos/Costa
Rica's distritos/Ecuador's cantones.

**Belarus needed a real supplemental-source fix, the same shape as Panama/Canada/Venezuela/Serbia's own
`extraOsm` before it.** geoBoundaries' only sub-national level, ADM2 (`"Raion"`, 118 units), turned out to mix
ordinary rural raions with Belarus's 10 oblast-significance cities (Brest, Gomel, Grodno, Mogilev, Vitebsk,
Babruysk, Pinsk, Baranavichy, Zhodzina, Navapolatsk — each administratively independent of any raion) at the
same tier — confirmed directly via a live OSM `admin_level=4-6` query, the same "a tier can silently mix two
different kinds of unit" shape this file's Serbia/Argentina/Ireland/Germany findings already established isn't
safe to assume uniform. A supplemental OSM `admin_level=8` layer (1287 real village/settlement councils —
сельсаветы — e.g. `"Орша"`, `"Ліда"`, `"Глыбокае"`, real Belarusian names) fills in the rural raions the same
smallest-containing-polygon-wins way Panama/Canada/Venezuela/Serbia's own `extraOsm` supplements already do.
Re-run with the supplement in place: **314/314 kept, 0 rejected, 0 unmatched.**

**Moldova switched off geoBoundaries entirely**, the same call already made for Costa Rica/Kuwait — its only
level, ADM1 (37 real raion-equivalent districts, min area 38 km²), is far too coarse for city-scale matching,
the same "geoBoundaries alone won't get there" shape as the original Jordan finding, and geoBoundaries has no
finer level for Moldova at all. Live Overpass recon found Moldova's real base local-government tier
(comună/oraș) is tagged `admin_level=8` in OSM — **not** the `=6` the general Eastern-European convention this
file had assumed might apply (a direct `=6` query came back with zero results, caught before it was blindly
trusted) — 982 relations, real Romanian and, for Transnistria's own settlements, Cyrillic names (`Hîrbovăț`,
`Copceac`, `Кременчуг`, ...), covering rural comune and towns alike. **101/101 kept, 0 rejected, 0 unmatched.**

**File sizes**: none of the 9 needed `shardByState()` — the largest flat outputs (Romania 14.4 MB, Poland 11.3
MB, Ukraine 10.8 MB) all sit comfortably under the United Kingdom's own already-committed 17.3 MB flat file
from the Fourteenth pass, so no new sharding precedent was needed here.

**Final status: all 9 Eastern Europe countries are done and committed** — every one 100% matched (0 rejected,
0 unmatched), 23,149 combined GeoNames points across the pass — the cleanest regional batch this project has
run. **79 of 193 UN members now have real city-boundary data; 114 remain**, all four Europe batches (Northern,
Western, Southern, Eastern) complete except Russia, which still needs its own dedicated investigation before
it can be added (transcontinental scale, likely a poor fit for a single ADM level or even a single OSM query
strategy the way every country in this pass was).

### Eighteenth pass: Middle East (2026-09-18) — 13 countries, this file's first real per-country source gap

Bahrain, Cyprus, Iran, Iraq, Israel, Lebanon, Oman, Qatar, Saudi Arabia, Syria, Turkey, United Arab Emirates,
Yemen — Jordan and Kuwait (already done, way back at this file's original proof-of-concept) are
geographically part of this same region but predate "pick the next contiguous region" as a standing
discipline. Much harder than every European batch: 4 of 13 real-per-feature-checked geoBoundaries levels
turned out too coarse and needed a real OSM investigation (Israel, Lebanon, UAE — full or partial source
swaps — and Saudi Arabia, where investigation confirmed there simply isn't a finer source anywhere).

Straightforward confirmations, matching a real independently-known count within the usual vintage drift:
Cyprus's communities (ADM2, 610, real names like "Morfou"/"Kato Pyrgos"), Syria's sub-districts (ADM3, 272,
matching the real ~270 nawahi), and Turkey's districts/ilçe (ADM2, 973, matching the real count almost
exactly). Six real-but-coarse district-level tiers accepted on the same "finest real option, not a technique
failure" basis as Ecuador's cantones/Jordan's own qadas: Bahrain's 4 governorates (confirmed to be the finest
level available in EITHER geoBoundaries or OSM — a direct Overpass check found nothing finer — harmless here
specifically because Bahrain's entire land area is small enough that even a whole governorate sits under
`SOFT_MAX_SQKM`), Iraq's 101 districts (later supplemented, see below), Oman's 61 wilayat (an exact count
match — wilayat genuinely is Oman's base local-government unit, not a coarser tier sitting above one), Qatar's
79 zones (ADM2 — real per-feature names are bare cadastral zone numbers like `"76"`/`"97"`, not named
localities, the same "candidate's own name is never the output's name" harmlessness as every prior garbled/
mislabeled-name finding), Saudi Arabia's 147 governorates (later supplemented, see below), and Yemen's 335
districts (matching the real ~333 count).

**Iran's finest level, ADM4 ("Dehestan", 2772 units), is a real mix of rural sub-district (dehestan) entries
and actual named cities (shahr) at the same tier** — "Tehran", "Lordegan", "Shahr-e Kord", "Bojnord",
"Kazerun" all appear as their own features alongside Persian-labeled rural dehestani. **A real, confirmed
upstream data bug**: many `shapeName` values are literal ASCII `?` characters — verified via the raw response
bytes the same way the Seventeenth pass verified Czechia/Hungary/Slovakia's digit-garbled names — not a
terminal/decode artifact, and harmless for the identical reason: the final output always uses GeoNames' own
name. Iran joined 2523/2632 (96%), 92 rejected (95 of them non-substantial small desert towns; 3 substantial —
Rāvar, Bāfq, Nehbandān — real but small cities in oversized desert dehestani, the accepted trade-off), 17
unmatched (real gaps, including one provincial capital, Yasuj — logged, not chased further given the already
high match rate).

**Israel's finest geoBoundaries level, ADM2 ("Subdistrict", 15 units — e.g. "Tel Aviv"/"HaSharon"/"Haifa"), is
far too coarse** — each subdistrict spans many separate real cities (closer to a US county than a
municipality). Switched off geoBoundaries entirely: a live Overpass query found Israel's real local-authority
tier (city/local council/regional council, ~255 real units) is tagged `admin_level=8` (237 relations — real
names: Rehovot, Ashqelon, Dimona, Arad, Yeruham, Omer, plus regional councils like "מועצה אזורית רמת נגב"),
with a small `admin_level=9` supplement (11 more). **705/724 kept (97%)**, 7 rejected (small Negev desert
settlements in oversized regional councils, the same accepted "real regional council, small population"
shape Israel's OSM tier represents faithfully), and **12 genuinely unmatched — every single one located in the
West Bank** (Ariel, Talmon, Kokhav HaShahar, Nili, Na'ale, Dolev, Beit Horon, Nahliel, El'azar, Giv'on
HaHadasha, Miẕpé Yeriẖo, Naẖal Teqoa'). This is reported here as a plain technical/data-coverage fact, not a
political judgment: neither geoBoundaries' own Israel ADM2 (its 15 subdistricts don't include one covering
this area — Golan Heights IS included as its own subdistrict, but no equivalent West Bank one is) nor the OSM
`admin_level=8` Israeli-local-authority query used for this join returns a boundary relation for any of these
— there is simply no candidate polygon in either checked source for this join to match against, the same
"real, structural gap, not a technique failure" conclusion as Saudi Arabia's major cities below, arrived at by
checking rather than assuming.

**Lebanon's finest geoBoundaries level, ADM2 (26 aqdya/districts), matches the real caza count exactly but is
still far coarser than Lebanon's real municipality tier.** A live Overpass query found Lebanon's real
municipality/quarter tier is tagged `admin_level=7` (1031 relations — Beirut's own inner quarters like
"الأشرفية"/Achrafieh, "باشورة"/Bachoura, "رأس بيروت"/Ras Beirut, mixed with ordinary municipalities elsewhere
like "بعلبك"/Baalbek and "طرابلس"/Tripoli), with a smaller `admin_level=8` supplement (65 more). **A first run
using only this OSM layer left 2 points unmatched, including Zahlé (78,145, a real district capital)** — a
real, small OSM coverage gap for that specific municipality boundary. Rather than a full source swap,
geoBoundaries' own ADM2 was kept as a coarser backstop candidate set alongside the OSM municipality layer —
smallest-containing-polygon-wins means OSM still wins everywhere it actually has a boundary, and the
caza-level polygon only gets used where OSM has a real gap. Re-run: **51/52 kept, 1 rejected** (a single small
mountain village, Aïnâta, falling into Baalbek's 2316.7 km² caza — a real, tiny residual, not chased further).

**Iraq's ADM2 (101 districts/qada) rejected 59 of 173 points on its own, dominated by real substantial cities**
(Najaf 482,576 in a 39,024.9 km² district; Ramadi 223,500; Samarra 158,508) — the same "a district built
around one city can still be huge" shape Saudi Arabia hit below. A live OSM check found a real finer tier:
`admin_level=7` (401 relations, Iraq's actual nahiya/sub-district layer, one level below qada) — added as a
supplemental smallest-wins source. Re-run: **161/173 kept (93%, up from 66%)**, 12 rejected (6 substantial,
all real towns in Anbar's western desert border districts — Safwan, Al-Qaim, Rutbah, Ana — a genuine sparse-
desert residual, not a technique failure), 0 unmatched.

**Saudi Arabia is this file's first real, significant, unresolved source gap** — not a small residual tail
the way every prior country's leftover unmatched/rejected list has been. geoBoundaries' ADM2 (147
governorates) rejected 98 of 160 points on its first run, including the capital itself (Riyadh, 4.2M
population, 8532.8 km² governorate) and roughly a dozen other real million-plus/several-hundred-thousand
cities (Jeddah-area, Ta'if, Buraydah, Ha'il, Tabuk, Khamis Mushait, Madinah, Al Kharj, Al Hufuf, Abha, ...) —
a governorate built around one substantial city can still span thousands of km² of surrounding desert.
**Checked directly whether a finer source exists anywhere, the same discipline as every prior pass, and found
none**: OSM's own `admin_level=6` governorate layer (149 units) is the identical coarse tier under a different
admin_level number, not a finer one; and Riyadh's own real, individually-drawn city-limit boundary
("مدينة الرياض"/Madinat Al Riyad, `admin_level=8`) turned out to be a genuine one-off, not part of a systematic
per-city layer — a nationwide search for similarly-named "مدينة "-prefixed relations found only small planned
communities and UAE cities sharing the same bounding box, not Jeddah, Dammam, Mecca, Medina, Tabuk, Buraydah,
or any of Saudi Arabia's other major cities. **The OSM `admin_level=6` layer was still added as a supplement**
(smallest-wins, so it can only help) since its 149 units vs. geoBoundaries' own 147 hinted at a real coverage
difference — confirmed: it resolved both of the run's 2 originally-unmatched points (Dammam 1.25M and Dhahran
99,540 — a real "Dammam Governorate" relation exists in OSM but not in geoBoundaries' own download). Final:
**62/160 kept, 98 rejected (62 substantial), 0 unmatched.** This is logged plainly in `BACKLOG.md` as a real,
significant, currently-unresolved gap — most of Saudi Arabia's major cities, including its capital, have no
boundary polygon in this project today, and nothing found in either checked source fixes it.

**United Arab Emirates has only ADM1 (the 7 emirates) in geoBoundaries** — far too coarse (Abu Dhabi emirate
alone contains Abu Dhabi city, Al Ain, and vast empty desert). Switched off geoBoundaries entirely: a live
Overpass query found a real, inconsistent mixed-level hierarchy (admin_level 4: 7 emirates; 5: 1; 6: 3; 7: 15;
8: 374, the large majority — real named areas like "Kalba"/"خورفكان" (Khor Fakkan)/"السيف"/"النخيل") — the
same "don't assume a single tier is uniform" lesson this file already learned for Belize/Kuwait/Argentina/
Belarus. **A first run using just levels 4-8 still rejected 57 of 107 points, most of them real Dubai
districts** (Deira, Jebel Ali, Umm Suqeim, Jumeirah, Dubai Marina, ...) falling back to the whole 7214.8 km²
Dubai emirate polygon. Investigation found several real Dubai-district boundaries exist one or two levels
deeper than the initial query reached (e.g. "مدينة دبي للغولف"/Dubai Golf City and "مدينة العمال"/Madinat Al
Ummal at `admin_level=10`) — widened the query to levels 4-10. Re-run: **91/107 kept (85%, up from 46%)**, 15
rejected (11 substantial — mostly real but modern planned developments: Dubai Marina, Dubai Sports City,
Dubai Internet City, Dubai Festival City, Dubai Investments Park, Al Furjan, Knowledge Village, Palm Jumeirah
— a real, plausible "newer development, not yet drawn in OSM" residual, not chased further given how much the
level-9/10 widening already recovered), 1 unmatched (Abu Musa, a small, disputed island — reported as a plain
coverage fact, the same neutral framing as Israel's West Bank finding above).

**File sizes**: none of the 13 needed `shardByState()` — the largest flat output (Turkey, 16.4 MB) sits under
the United Kingdom's own already-committed 17.3 MB flat file, so no new sharding precedent was needed.

**Final status: all 13 Middle East countries are done and committed.** Nine came back with 0 rejected/0
unmatched or only a small single-digit residual tail (Cyprus, Bahrain, Qatar, Lebanon, Oman, Syria, Yemen,
Iraq, Iran); Israel and UAE needed real OSM source work and still carry small, plainly-reported structural
gaps (Israel's West Bank settlements, UAE's newest planned developments, both genuinely absent from every
checked source, not a technique failure); **Saudi Arabia is a real, significant, open gap** — most of its
major cities, including the capital, have no polygon anywhere in this project today, logged prominently in
`BACKLOG.md` rather than presented as resolved. **92 of 193 UN members now have real city-boundary data; 101
remain.**

### Nineteenth pass: Central Asia + Caucasus (2026-09-18) — a real "Latin-script search bug, not a data gap" lesson

Armenia, Azerbaijan, Georgia, Kazakhstan, Kyrgyzstan, Tajikistan, Turkmenistan, Uzbekistan — the westernmost
slice of a west-to-east walk across the rest of Asia (Western Asia/Middle East already done above).
Armenia/Azerbaijan/Georgia are geographically the Caucasus, not Central Asia proper, but folded into this
same pass rather than given their own 3-country batch.

A recurring administrative shape across the whole region: several capitals are "cities of republican/state
significance," administratively independent of any ADM2 district — Armenia's Yerevan, Georgia's Tbilisi, and
Uzbekistan's Tashkent all correctly appear as their own ADM2 feature anyway (confirmed by direct inspection,
no special-casing needed), but Kazakhstan's Astana and Tajikistan's Dushanbe do not, and needed a real
backstop.

**Four straightforward confirmations**, each ADM2 already covering its own capital directly: Armenia's
municipal communities (39, real names like "Stepanavan"/"Hrazdan"/"Gavar"), Azerbaijan's districts/cities (79
— real names carry their own "District"/"City" suffix, e.g. "Baku City"/"Ganja City"), Georgia's
municipalities (68 — real names like "Zugdidi"/"Gudauta", including for Abkhazia, which Georgia doesn't
actually control but geoBoundaries' download still carries), and — after a real fix, see below — Uzbekistan's
tumans (199, an exact count match, Tashkent included).

**Kazakhstan's ADM2 (174 districts) already includes Almaty and Shymkent as their own feature, but not
Astana** (administratively independent, the same shape as every capital in this pass) **— and, far more
significantly, rejected 324 of 352 points on its first run, 92 of them substantial: real major regional
cities** (Karagandy 497,777; Pavlodar 329,002; Oral 330,000; Semey 292,780; Ust-Kamenogorsk 319,067; Atyrau
290,700; ...) **lost to districts spanning thousands to tens of thousands of km², the largest a genuinely
enormous 128,664 km².** Astana itself DOES have a real polygon one level up (geoBoundaries' own ADM1, mixing
oblasts and 3 independent cities) — added as a single supplemental candidate, the Monaco-style capital-vs-rest
hybrid. For the much bigger city-loss problem, a live OSM check found a real, comprehensive finer tier: real
raions at `admin_level=6` (226, closely matching geoBoundaries' own 174) plus a genuinely fine sub-district
layer at `admin_level=8` (907 relations) — Kazakhstan's own "ауыл округі" (rural-district/village-council)
tier, fine enough that a real city inside a huge raion gets its own much smaller polygon separate from the
surrounding rural area. Added as a supplemental smallest-wins source (levels 6|8|9|10) rather than a full
swap. Re-run: **173/352 kept (up from 8%, now 49%), 179 rejected, 41 of them still substantial** — every
regional-capital-scale city from the original list (Karagandy, Pavlodar, Oral, Semey, Ust-Kamenogorsk, Atyrau,
Kostanay, Petropavl, Turkistan) is now kept; what remains is smaller towns (mostly 10,000-40,000 population)
spread across a country large and sparse enough that even a real, comprehensive OSM sub-district layer still
leaves genuine gaps — logged in `BACKLOG.md` as a real, large, but honestly characterized residual, not
chased further given how much the fix already recovered.

**Kyrgyzstan and Turkmenistan surfaced a real bug in this file's OWN investigation technique, not a real data
gap.** Both countries' capitals (Bishkek/Osh; Ashgabat) appeared completely absent from every checked source
on a first pass — geoBoundaries at any level, and a direct Overpass name-search query for "Bishkek"/"Osh"/
"Ashgabat"/"Asgabat" that came back with zero results. **Both cities' real OSM name is in the local script**
(Kyrgyz Cyrillic "Бишкек шаары"/"Ош шаары"; Turkmen Latin-with-diacritics "Aşgabat") — the ASCII name-search
query only ever matched the primary `name` tag directly, never noticing the `name:en` field that actually
carried the Latin transliteration this search was looking for. **A broader, unfiltered area-scoped query (the
same "don't just check by name, check what's actually there" discipline this file has followed since its very
first Jordan/Kuwait findings) found both cities immediately** — Bishkek and Osh at `admin_level=4` (their own
tier, alongside Kyrgyzstan's 7 oblasts), Ashgabat at `admin_level=5`. This also surfaced that BOTH countries'
real city coverage is far richer in OSM than geoBoundaries had suggested: Kyrgyzstan's real `admin_level=6`
tier mixes ordinary raions with real cities carrying their own name (e.g. "Талас шаары"/Talas City, "Каракол
шаары"/Karakol City — none of which geoBoundaries' own ADM2 download included at all), and Turkmenistan's
`admin_level=6` carries real city-level boundaries with their own "şäheri" (city) suffix
("Türkmenbaşy şäheri"/Turkmenbashy, "Baýramaly şäheri"/Bayramaly). Both switched off geoBoundaries entirely in
favor of OSM (Kyrgyzstan: levels 4|6|8|9; Turkmenistan: levels 5|6|7|8, which also sidesteps geoBoundaries'
own ADM2 data-quality issues — 12 of 59 features with a genuinely blank `shapeName`, harmless for this
project's join since the final output's name always comes from GeoNames, but a real upstream data-quality
finding worth recording). Kyrgyzstan: **49/112 kept (up from 0 usable — the original run's "40 kept" already
excluded both capitals), 63 rejected (10 substantial), 0 unmatched.** Turkmenistan: **49/124 kept (up from
15), 75 rejected (26 substantial), 0 unmatched.** Both still carry a real, sizeable residual of smaller towns
in oversized rural districts — the same accepted shape as Kazakhstan above, just at each country's own
smaller scale — logged in `BACKLOG.md`.

**Uzbekistan** (7 remaining substantial rejections after a supplemental OSM layer, levels 6-10, brought it
from 172/221 to 184/221 kept) **and Tajikistan** (2 substantial rejections, largely unchanged by its own
supplemental OSM layer given the residual was already small, plus a Kazakhstan-style ADM1 backstop for
Dushanbe) both close out with small, accepted residuals — real towns in Uzbekistan's own oversized rural
tumans (Mŭynoq, Qŭnghirot, Nurota, ...) and Tajikistan's own remote Pamir highlands (Murghob, Khorugh),
logged in `BACKLOG.md` rather than chased further.

**Azerbaijan and Georgia were left as their original single-source geoBoundaries joins** (26 rejected/0
substantial/1 unmatched, and 10 rejected/0 substantial respectively) — not investigated against OSM the way
every other country in this pass was, since neither had a single substantial rejection to chase; worth a
closer look if either country's own coverage is ever revisited.

**File sizes**: none of the 8 needed `shardByState()` — every output is well under 2 MB.

**Final status: all 8 Central Asia + Caucasus countries are done and committed.** Armenia is a clean 0/0/0;
Azerbaijan and Georgia carry only small, non-substantial residual tails; Uzbekistan, Kyrgyzstan, Turkmenistan,
and Tajikistan each needed real OSM investigation and now carry honestly-reported, sparse-country residuals of
varying size; Kazakhstan needed the most work and still carries the largest remaining residual in this pass
(41 substantial towns) despite a 6x improvement in points kept — a real, large, but no longer indefinitely
chaseable gap given how comprehensive the OSM supplement already is. **100 of 193 UN members now have real
city-boundary data; 93 remain.**

### Twentieth pass: South Asia minus India (2026-09-18) — two more "don't trust canonicalName" catches, and Maldives' first `way`-sourced OSM candidates

Afghanistan, Pakistan, Nepal, Bhutan, Bangladesh, Sri Lanka, Maldives — continuing the west-to-east walk across
Asia the Nineteenth pass started. **India deliberately excluded**, held for its own dedicated investigation
the same way Russia is excluded from every routine regional batch: its recon-reported finest level is ADM5,
649,771 units, min area 0.0004 km² — village scale, nowhere close to city scale, and picking a real level for
a country this size (and this administratively complex — 28 states, 8 union territories, several with their
own naming/tiering quirks) needs its own pass, not a blind fold-in in a batch sized around seven much smaller
countries.

**Afghanistan, Pakistan, and Nepal all confirmed clean on their recon-reported finest level**, each verified
by direct point-in-polygon check against real coordinates, not just trusting the name: Afghanistan's ADM2
(398 wuleswali) contains Kabul, Kandahar, and Mazari Sharif as their own named unit; Pakistan's ADM3 (554
Tehsil) resolves Karachi/Lahore/Islamabad/Faisalabad/Rawalpindi correctly (Karachi and Lahore each split
across multiple named towns/cantonments — real, expected granularity, not a data problem); Nepal's ADM3 (774
Nagarpalika/Gāunpālikā) contains Kathmandu, Pokhara, Biratnagar, Lalitpur, and Bharatpur each as their own
named municipality.

**Bangladesh and Sri Lanka both needed a real override of recon's own reported "finest" level — the same
"canonicalName looks right but isn't" trap this file has hit before (Belize's Constituencies, Lithuania/
Sweden's one-level-too-deep pick).** Bangladesh's recon-reported ADM4 (canonicalName literally "Union
Councils / Municipal Corporations / City Corporations", 5,160 units) sounds exactly like the level this join
needs — but a direct point-in-polygon check against Dhaka/Chattogram/Rajshahi/Sylhet's real coordinates landed
every one of them in an individual city WARD (0.4-0.9 km², e.g. Dhaka → "Ward No-73", Chattogram → "Ward
No-22") — sub-city scale, not a city boundary, despite the name. ADM3 ("subdistricts"/Upazila, 544 units)
landed the same four cities in real city-scale units instead (Dhaka → Kotwali 0.8 km², Chattogram → Kotwali
9.4 km², Rajshahi → Boalia 18.9 km², Sylhet → Sylhet Sadar 318.4 km²) and is used instead. Sri Lanka's
recon-reported ADM4 ("Grama Niladhari Divisions", 14,044 units) has the exact same problem — Colombo, Kandy,
and Jaffna all land in a sub-1 km² GN division, not a real city boundary — while ADM3 ("Divisional
Secretariat", 330 units) puts Colombo directly in its own 22 km² DS division. Both switched to ADM3. Result:
Bangladesh 164/164 kept, 0 rejected, 0 unmatched; Sri Lanka 89/89 kept (1 snapped — Galle, whose real DS
division "Galle4Gravets" carries a garbled name that made this file's own earlier by-name recon check
initially read as "not found," resolved correctly anyway by the point-in-polygon join plus snap fallback), 0
rejected, 0 unmatched. Both clean runs.

**Bhutan's own ADM2 (205 Gewog) — real rural blocks, the finest level geoBoundaries has — doesn't cover the
capital.** Direct point-in-polygon check: Thimphu's own coordinates land inside the surrounding rural "Chang"
Gewog (157 km², not a Thimphu city boundary at all) — Thimphu Thromde (city) is administratively independent
of any Gewog, the same shape as every other capital in this pass. geoBoundaries' ADM2 does, however, already
carry Phuentsholing (note the real spelling — a first-pass name search for "Phuntsholing" missed it entirely,
worth remembering before concluding a country has no coverage from a name search alone) as its own 133.8 km²
unit, confirmed by direct point-in-polygon check against Phuntsholing's real coordinates — no gap or
supplement needed there. A live OSM check found exactly one real Thromde-level boundary in the entire
country: Thimphu itself, `admin_level=5` (the same tier as Bhutan's 20 Dzongkhags) — added as a single
supplemental candidate, the same Kazakhstan/Tajikistan/Monaco "capital point against its own coarser-tier
polygon" pattern already established. Result: 33/34 kept, 0 rejected, 1 unmatched — Nganglam (population 707,
a small border town near Assam, India), a real, small, unrelated residual gap, not chased further.

**Maldives needed a full source swap off geoBoundaries, and surfaced a real gap in this script's own OSM
tooling.** geoBoundaries' finest level (ADM2, "Administrative Atolls," 21 units) is the SAME 21-atoll
partition as its own ADM1 — a whole atoll including its lagoon (up to ~2,300 km²) is nowhere near city scale,
and every city on it would join to the identical huge polygon regardless of which real island it's actually
on. OSM has real, comprehensive per-island coverage instead — 894 `place=island`/`place=islet` features
country-wide, confirmed directly against real inhabited islands (Fuvahmulah, Kulhudhuffushi, Hithadhoo all
present by name) — but **almost every one of them is mapped as a single closed `way`, not a `relation`**,
which this script had never needed to handle before: every prior OSM-sourced country queried
`relation[boundary=administrative]` only, and `osmRelationToGeometry.mjs`'s `relationToGeometry` only knows
how to stitch a relation's member way-segments into rings. Added `wayToGeometry` (a small, generic new helper
in `buildCityBoundaries.mjs` itself) for the much simpler case Overpass's `out geom;` already gives a `way`
element directly — a flat `.geometry` array of `{lat,lon}` points, already closed (verified against a real
island way: first point equals last). Malé itself — the capital, fully urbanized, ~2 km² total — has no
single `place=island` polygon of its own; its administrative area is covered instead by 6 real `admin_level`
8/9 relations (Hulhumalé/Vilimalé at 8, the four wards Galolhu/Henveiru/Maafannu/Machchangolhi at 9), added as
further supplemental candidates alongside the island ways. Result: 34/34 kept, 0 rejected, 0 unmatched — a
clean run, and the smallest output file of any country so far (15 KB).

**File sizes**: none of the 7 needed `shardByState()` — Pakistan's 1888 KB is the largest, well under any
sharding threshold.

**Real, accepted residuals**: Afghanistan (65/320 rejected, 11 substantial — real desert-district scale
losses; a live OSM admin-level check found only 54 `admin_level=7` relations nationwide, far too sparse to be
a comprehensive supplemental tier the way Kazakhstan's `ауыл округі` layer was, so none was added) and Pakistan
(49/572 rejected, 14 substantial — concentrated in Balochistan/Sindh's own oversized desert districts; OSM's
finer `admin_level` tiers there — 27 elements at level 8, 5 at level 9 nationwide — are similarly too sparse to
supplement with) both logged to `BACKLOG.md` as real, honestly-characterized gaps rather than chased with a
supplement that wouldn't actually be comprehensive. Bhutan's single unmatched Nganglam and Bangladesh/Sri
Lanka/Nepal/Maldives' clean 0/0/0 runs need no further entry.

**Final status: all 7 South Asia (minus India) countries are done and committed. 107 of 193 UN members now
have real city-boundary data; 86 remain (India among them, deliberately deferred to its own pass).**

### Twenty-first pass: East Asia (2026-09-18) — China, Japan, Mongolia, North Korea, South Korea, and this
file's largest single country by far

Continuing the west-to-east walk across Asia the Nineteenth/Twentieth passes started. Every level below was
confirmed by a direct point-in-polygon check against real coordinates, not just recon's own `canonicalName`
field — this file's now-standard discipline paid off twice again in this pass alone.

**Japan's recon-reported finest level (ADM2, canonicalName "Subprefectures", 1,742 units) is another
"canonicalName looks wrong but the level is right" case, the mirror image of Bangladesh/Sri Lanka below.** A
real Japanese subprefecture (振興局) is a coarser regional tier that exists only in Hokkaido — nowhere near
1,742 nationwide. The actual content is Japan's real municipality layer (shi/machi/mura, plus city wards for
the largest cities): confirmed directly — Tokyo's Shinjuku and Shibuya each resolve to their own real ward
(15-18 km²), Osaka/Yokohama/Sapporo/Naha/Kyoto each resolve to their own real city polygon. Used as-is.
Result: 2,189/2,190 kept (13 snapped), 0 rejected, 1 unmatched (Minamichita, population 16,617 — a small
peninsula town, a real residual not chased further given the established "only chase what the snap fallback
doesn't already clear" bar). 8,548 KB, no sharding needed.

**South Korea needed the same override this file has now hit repeatedly (Bangladesh/Sri Lanka's ADM4, Belize's
Constituencies): recon's reported finest level (ADM3, "submunicipalities," 3,504 units) sounds plausible but a
direct check lands Seoul's Gangnam, Busan, Incheon, and Daegu each in an individual dong (0.7-1.8 km²) —
neighborhood scale, not a city boundary.** ADM2 ("Si, Kun districts and city districts," 228 units) puts the
same four cities in their own real gu/gun (16.7-104.6 km²) instead, and is used. This still left 10 of 311
points unmatched, all clustered around one place — Yeonggwang County (population 51,688) and 9 of its own
constituent townships. **geoBoundaries' KOR ADM2 download is simply missing this one county entirely**
(confirmed directly: zero features anywhere in the file with "Yeonggwang" in the name) — a real data gap, not
a plausibility rejection. A live OSM check found it cleanly at the same admin_level=6 every other South Korean
county in this dataset sits at; a first Latin-script name search came back empty even though the relation's
own `name:en` tag IS "Yeonggwang" (so, unlike Kyrgyzstan/Turkmenistan's non-Latin-only case, this looks like
an unrelated Overpass query quirk rather than the same root cause), but an exact Korean-name search ("영광군")
found the one missing relation directly. Added as a single supplemental candidate — the same Bhutan/
Kazakhstan/Tajikistan "one specific missing unit, not a whole missing tier" pattern. Result after the fix:
302/311 kept (2 snapped), 9 rejected, 0 unmatched — the 9 rejected are Yeonggwang's own population-0 township
placeholders, landing in the recovered county polygon's own real (sea-inclusive, ~2,106 km² vs. ~470 km² of
actual land — ordinary for a Yellow Sea coastal county's OSM administrative boundary) area, over the
non-substantial ceiling; harmless, the same shape as every other country's population-0 rural-unit residuals.
1,052 KB, no sharding needed.

**Mongolia (ADM2, "soum, düüregs," 339 units) and North Korea (ADM2, "county, city, special city," 179 units,
the finest level geoBoundaries has for PRK — no ADM3 exists) both confirmed clean on their recon-reported
finest level with no override needed:** Ulaanbaatar/Erdenet/Darkhan each land in their own real düüreg/soum,
and Pyongyang/Hamhung/Chongjin/Nampo each land in their own named city unit. North Korea's own special cities
(Pyongyang 1,166 km², Chongjin City 1,892 km²) have no finer internal district split available in this source,
unlike China/Japan/South Korea's largest cities — accepted as the finest real unit obtainable, the same shape
as every other "no OSM alternative either" capital this file has already accepted. A live OSM check for North
Korea found essentially no usable `boundary=administrative` coverage below country level at all — not
surprising for one of the least-mapped OSM countries in the world, and not chased further. Result: North Korea
127/127 kept (1 snapped), 0 rejected, 0 unmatched, 351 KB. Mongolia: only 63/332 kept, 269 rejected (too
large) — a real, structural residual, not a technique failure: Mongolia is the world's most sparsely populated
sovereign country, and most of its 332 GeoNames points are population-0 bag-center villages sitting inside
soums that routinely run 2,000-15,000+ km². A live OSM check for a finer "bag" tier (`admin_level=8`) found
**zero** relations nationwide, confirming soum-level really is the finest comprehensive administrative tier
available from any source here — only 1 of the 269 rejects is even population-substantial (Tosontsengel,
9,526, just over the non-substantial ceiling). 128 KB.

**China needed real sharding, not just a bigger file, and surfaced a real script bug and a real chained
Natural Earth data bug — the most consequential single-country pass in this file since Germany's.**

- **A real script crash, not a China-specific issue**: Japan's ADM2 download has 24 of 1,742 features with a
  JSON `null` `shapeName` (not Turkmenistan's already-tolerated blank `""` — a materially different value that
  crashed `normalizeName`'s `.normalize()` call the instant the snap fallback's name-preference tie-break
  tried to compare against one). Fixed generically in `normalizeName` itself (`(name ?? '')`), not with a
  Japan-specific workaround — any future country with a real `null` name candidate is now covered too.
- ADM3 ("County, City," 2,864 units) is the correct city-plausible level — confirmed directly:
  Beijing/Shanghai/Guangzhou/Shenzhen/Chengdu/Wuhan/Hong Kong each resolve to their own real district (e.g.
  Beijing -> Dongcheng District, 41.75 km², not the whole 4,834 km² "Beijingshi" ADM2 alone would give).
- This app's own GeoNames index carries 16,055 China points — more than any country in this file except the
  US — so the same "one flat country file becomes the huge-eager-fetch problem" shape Mexico/Brazil/Italy/
  Germany/France/Spain already hit applies here too, at a larger scale than any of them (65.8 MB combined
  before sharding). Sharded via `shardByState()` using `iso_3166_2` (not `postal` — see below) against the 32
  CHN entries in the vendored Natural Earth admin-1 file.
- **A real, chained Natural Earth `postal`-field bug, distinct in shape from every prior one this file has
  found** (Germany's Brandenburg/Berlin collision, France's blank values, Spain's autonomous-community-not-
  province values): here the 32 CHN `postal` values ARE all mutually unique (so `shardByState` wouldn't have
  thrown or silently merged two provinces), but four of them are simply WRONG — a rotated mislabeling, not a
  collision. Hebei's own `postal` is "HB" (Hubei's real abbreviation), Henan's is "HE" (Hebei's), Hubei's is
  "HU" (not a real abbreviation for anything), and Hainan's is "HA" (Henan's real abbreviation) — checked
  against the standard GB/T 2260 two-letter provincial codes (HE=Hebei, HA=Henan, HB=Hubei, HI=Hainan).
  `iso_3166_2` does not have this bug and is used instead — caught only because this pass happened to spot-
  check the raw vendor properties directly rather than assuming a unique `postal` value is automatically also
  a correct one. Functionally this would have been harmless either way (`shardByState` only uses the field as
  an output-filename key, never for the actual point-in-polygon match), but a shard file named `ha.json`
  actually holding Henan's cities while `hi.json` doesn't exist at all would have been a confusing trap for
  anyone debugging this data later.
- **A second, smaller NE quirk found the same way**: "Paracel Islands" is itself a real candidate polygon in
  the vendored admin-1 file (a cartographic placeholder, not a real ADM1 unit — its own `iso_3166_2`,
  "CN-X01~", isn't a real province code) that would otherwise directly contain Sansha (population 1,443, the
  real prefecture-level city administratively covering the Paracel/Spratly Islands) and shard it into its own
  nonsense `x01~.json` file instead of the real province, Hainan, Sansha is actually part of. Excluded via
  `abbrevOf` returning `undefined` for that one named entry, so Sansha falls through to `shardByState`'s own
  nearest-real-province-by-centroid fallback instead — confirmed to land correctly in `hi.json`.
- Result: 8,860/16,055 kept (10 snapped), 7,195 rejected, 0 unmatched. 278 of the rejects are population-
  substantial — real geography, not a technique failure: Xinjiang/Inner Mongolia/Tibet/remote Heilongjiang/
  Yunnan county-level cities routinely span 5,000-80,000+ km² (Hami's own Yizhou District alone is 81,117
  km², larger than several UN member states in this file). A live OSM check for a finer township tier
  (`admin_level=9`) in Xinjiang specifically — the province dominating this residual — found exactly 1
  relation nationwide-in-province, confirming no comprehensive finer tier exists anywhere close to this scale,
  the same "not chased further" bar Kazakhstan/Afghanistan/Pakistan's own oversized-district residuals already
  established. Sharded into 31 real province files (Paracel Islands' own placeholder excluded, per above),
  65.8 MB combined, largest single shard (Zhejiang) 6.9 MB — comparable to, not larger than, prior sharded
  countries' own biggest shards.

**File sizes**: none of Japan/Mongolia/North Korea/South Korea needed `shardByState()` — South Korea's 1,052
KB is the largest of the four. China did, per above.

**Real, accepted residuals, both logged to BACKLOG.md**: China's 278 substantial rejects (oversized desert/
plateau counties, no finer comprehensive tier in any checked source) and Japan's single Minamichita unmatched
(a small peninsula town, real residual). North Korea/South Korea/Mongolia's own smaller residuals are
explained in-line above and need no further entry.

**Final status: all 5 East Asia countries are done and committed. 112 of 193 UN members now have real
city-boundary data; 81 remain (India and Russia both still deliberately deferred to their own dedicated
passes).**

### Twenty-second pass: Southeast Asia (2026-09-18) — Brunei, Cambodia, Indonesia, Laos, Malaysia, Myanmar,
Philippines, Singapore, Thailand, Timor-Leste, Vietnam — completing continental/maritime Asia other than
India and Russia

Every level below was confirmed by a direct point-in-polygon check against real coordinates, not just
recon's own canonicalName field.

**Six countries confirmed clean on their recon-reported finest level with no override needed:** Brunei (ADM2,
"Mukim," 38 units — Bandar Seri Begawan and every other real mukim resolve correctly; 3 snapped, 0 rejected, 0
unmatched), Indonesia (ADM2, "regency, city," 519 units — Jakarta splits cleanly into its 5 real "Kota"
cities, e.g. Kota Jakarta Pusat 48.09 km²; Surabaya/Bandung/Medan/Denpasar/Makassar each resolve to their own
whole "Kota" unit), Laos (ADM2, "Districts," 148 units — Vientiane -> Xaysetha, a real district of the
prefecture; 38 rejected, none substantial), Singapore (ADM2, "Divisions," 55 real URA planning areas — clean
121/121), Thailand (ADM2, "districts," 928 units — Bangkok -> Phra Nakhon 5.41 km², a real historic district,
not the whole 1,569 km² city; 24 rejected, none substantial), and Vietnam (ADM2, "District," 708 units —
Hanoi's Hoan Kiem and Ho Chi Minh City's Quan 1 both resolve to their own real central district; 1 unmatched —
Thổ Châu, population 1,829, a small offshore island — and 0 substantial rejects).

**Cambodia needed the same override this file has now hit repeatedly** (Bangladesh/Sri Lanka's ADM4, South
Korea's ADM3): recon's reported finest level (ADM3, canonicalName blank/"Unknown" at every level in this
download, 1,633 units) turned out to be commune/sangkat scale — Phnom Penh lands in an individual 1.00 km²
sangkat ("Boeng Keng Kang Ti *"), neighborhood scale, not a city boundary. ADM2 (197 units, real district/khan
tier despite also reporting "Unknown") puts Phnom Penh in its own real khan (Chamkar Mon, 11.21 km²) and Siem
Reap/Battambang in their own real town-and-surrounding-district unit instead, and is used. Result: 304/341
kept (1 snapped), 37 rejected, none substantial, 0 unmatched.

**Malaysia is the rare case where recon's reported finest level (ADM3, "Mukim," 1,859 units) is the CORRECT
city-plausible pick and the coarser ADM2 ("Districts," 159 units) would have been the wrong, too-coarse
choice** — confirmed directly: ADM2 puts Kuala Lumpur in the whole 242 km² federal territory and Johor Bahru
in its entire 1,145 km² district, while ADM3 resolves each to its own real "Bandar" (town) mukim — Kuala
Lumpur -> BANDAR KUALA LUMPUR (47.36 km²), George Town -> BANDAR GEORGE TOWN (26.10 km², matching real George
Town's urban core), Johor Bahru -> BANDAR JOHOR BAHRU (43.18 km²). Every other country in this pass (and most
before it) had recon's suggested finest level turn out too fine, not too coarse — worth remembering the
override isn't always in the same direction. **But ADM3 barely reaches East Malaysia at all** — only 16 of
1,859 mukim features fall anywhere in Sabah/Sarawak's own longitude/latitude range, a real structural gap
(mukim is historically a Peninsular Malaysia administrative construct; Sabah/Sarawak use a different "land
district" tier, sparsely represented here), not scattered misses — confirmed directly: ADM3 alone left 35 of
740 points unmatched, dominated by Sabah's own state capital and major cities (Kota Kinabalu 500,421; Sandakan
439,050; Tawau 372,615). Fixed by adding ADM2 as a supplemental candidate alongside ADM3 (not a full swap,
since ADM3 already correctly resolves Peninsular Malaysia's much finer real mukims, and the join's own
smallest-containing-polygon-wins rule means ADM2 only ever gets picked where ADM3 has nothing smaller to
offer). Result: 727/740 kept (3 snapped), 0 unmatched, 13 rejected (3 substantial — Lahad Datu 105,622 in a
7,392 km² district, Bandar Nabawan 31,807 in 6,250 km², Kinabatangan 10,256 in 7,339 km², all genuinely huge
rural Sabah interior districts, the same accepted shape as Kazakhstan/Afghanistan/Pakistan/Mongolia/China's
own oversized-district residuals).

**Myanmar confirmed ADM3 ("Township," 330 units, matching recon) over the coarser ADM2 ("District," 74
units)** — Yangon's ADM2 unit ("Yangon (West)," 71.82 km²) is already reasonably city-scale, but Naypyidaw's
ADM2 unit is a genuinely huge 3,526 km² region-tier polygon, while ADM3 resolves Yangon/Mandalay/Naypyidaw
each to their own real township (27.08/15.11/58.66 km²) — the finer, more consistent choice nationwide.
Result: 496/576 kept, 80 rejected (11 substantial — Dawei 136,783 in 6,855 km², Ann 119,714 in 6,279 km²,
Myitkyina 90,894 in 6,239 km², ... concentrated in Myanmar's remote Rakhine/Kachin/Sagaing border townships),
0 unmatched.

**Philippines needed a real fragment-vs-whole-city fix, the France Paris/Lyon/Marseille shape at a smaller
scale.** ADM3 ("Municipalities," 1,647 units, matching recon) correctly resolves every other tested city as
one whole polygon — Quezon City (163.03 km², matching its real area), Cebu City (292.08 km²), Davao City
(2,351.44 km², correctly huge — it's the country's largest city by land area), Baguio City (58.28 km²),
Zamboanga City (1,503.57 km²) — but Manila specifically has NO whole-city feature in this download at all,
only internal-district fragments (Quiapo, Tondo, Binondo, ... several names like "Santa Cruz"/"San Miguel"/
"San Andres"/"San Nicolas" repeated 2-9 times each, since those are also real, unrelated town names elsewhere
in the archipelago — a name-based filter like France's regex would incorrectly catch those other towns too).
Fixed by identifying Manila's own fragments geometrically instead — point-in-polygon against a live-fetched
OSM whole-city candidate — and dropping exactly those (14 of them, fewer than an initial by-name scan of ~35
suggested, confirming the geometric approach was necessary, not just more elegant). Manila's own GeoNames
point would otherwise land in "Quiapo" alone (0.89 km²) despite the city's real 1.9M population — a real,
visually-broken mismatch, not merely a smaller administrative unit the way Beijing/Shanghai's own
district-level matches are. The OSM relation (id 103703, `border_type=highly_urbanized_city`,
`official_name=City of Manila`, `population=1902590` — matching real Manila almost exactly, confirming it's
the right relation) computes to 179.70 km², well over Manila's official 42.88 km² land area — accepted as-is
(likely includes Manila Bay-facing reclamation/port jurisdiction the same way this file has already accepted
sea-inclusive coastal administrative boundaries elsewhere, e.g. South Korea's Yeonggwang in the Twenty-first
pass) rather than chased further, since it's still a single, correctly-named, plausibly-sized whole-city
polygon — a large improvement over the previous 0.89 km² fragment regardless. Result: 4,500/4,529 kept (62
snapped), 28 rejected (0 substantial), 1 unmatched (Cambarus, population 0).

**Indonesia needed real sharding**, the same "one flat country file becomes the huge-eager-fetch problem"
shape China/Mexico/Brazil/Italy/Spain/France/Germany already hit: its own 9,302 GeoNames points produced a
49.8 MB unsharded file. Sharded via `shardByState()` using `iso_3166_2` (not `postal` — Natural Earth's own
IDN rows collide Maluku Utara and Lampung on the same "LA" postal value, another instance of this file's
now-recurring unique-but-wrong-or-colliding `postal` finding, following China's `iso_3166_2` fix in the same
vein). Result: 5,130/9,302 kept (15 snapped), 4,172 rejected (40 substantial — Loa Janan 212,816 in a 25,333
km² East Kalimantan regency, Sampit 166,773 in 15,771 km², Timika 142,909 in 17,906 km², Merauke 116,864 in a
44,201 km² Papua regency larger than Denmark — the same accepted "real geography, not a technique failure"
shape as China/Kazakhstan/Mongolia's own oversized-rural-unit residuals, here spread across Kalimantan/
Papua/remote outer islands), 0 unmatched. 234 of 5,130 kept features matched no Natural Earth province polygon
directly and fell back to nearest-province-by-centroid (real archipelago coastline/small-island simplification
artifacts, the same `shardByState()` fallback path every prior sharded country has also exercised at a smaller
scale). Sharded into 33 real province files, 48.7 MB combined, largest single shard (East Java, "ji.json")
15.6 MB — bigger than any prior sharded country's own largest shard (China's Zhejiang was 6.9 MB), consistent
with Java being the most densely populated large island on Earth; still a per-province lazy load, not the
whole country eagerly fetched, so not chased further.

**File sizes**: none of Brunei/Cambodia/Laos/Malaysia/Myanmar/Singapore/Thailand/Timor-Leste/Vietnam needed
`shardByState()` — Thailand's 4,811 KB is the largest of the nine. Philippines (12,669 KB) also didn't need
it, despite its raw ADM3 download being an enormous 532 MB (the heaviest single geoBoundaries download this
file has ever pulled, ahead of Thailand's own 265 MB ADM2 and Indonesia's 158 MB ADM2 — all three archipelago/
peninsula nations with very fine coastline vertex density at their respective candidate levels, confirmed to
parse and join fine under this environment's available memory without any `--max-old-space-size` override
needed). Indonesia did need sharding, per above.

**Real, accepted residuals, all logged to BACKLOG.md**: Indonesia's 40 substantial rejects (oversized
Kalimantan/Papua/outer-island regencies), Myanmar's 11 substantial rejects (remote Rakhine/Kachin/Sagaing
border townships), Malaysia's 3 substantial rejects (Sabah interior districts, after the ADM2 supplement
already fixed the much larger initial 35-unmatched gap), and Vietnam's single Thổ Châu unmatched (a small
offshore island). Cambodia/Laos/Thailand/Singapore/Brunei/Timor-Leste's own clean-or-small-non-substantial
results need no further entry.

**Final status: all 11 Southeast Asia countries are done and committed. 123 of 193 UN members now have real
city-boundary data; 70 remain (India and Russia both still deliberately deferred to their own dedicated
passes) — every UN member in continental and maritime Asia now has real city-boundary data except those two.**

### Twenty-third pass: Oceania (2026-09-18) — Australia, Fiji, Kiribati, Marshall Islands, Micronesia, Nauru,
New Zealand, Palau, Papua New Guinea, Samoa, Solomon Islands, Tonga, Tuvalu, Vanuatu

Every level confirmed by a direct point-in-polygon (or, for several Pacific atoll nations whose "land" is a
razor-thin reef ring around a lagoon too narrow for a manually-guessed test coordinate to reliably land on,
area-plausibility against a real published figure) check, not just recon's own canonicalName field.

**Six confirmed clean on recon's own reported finest level:** Australia (ADM2, "Local Government Areas," 547
units — Sydney -> the 26.68 km² City of Sydney LGA, Melbourne -> the 37.52 km² City of Melbourne LGA, both
correctly much smaller than their metro areas; Brisbane -> its own genuinely huge 1,344.92 km² LGA, a real
fact about Brisbane's amalgamated council area, not a join error; 3,158/4,901 kept, 39 substantial rejects —
Toowoomba 142,163 in a 12,978 km² regional council, Mildura 34,565 in a 22,084 km² one — the same accepted
"real geography" shape as every prior pass's own oversized-rural-unit residuals, here a well-known real fact
about Australian local government amalgamation, not chased further), Kiribati (ADM2, 24 units — "Tarawa
Teinainano," Kiribati's own name for South Tarawa, computes to a plausible 11.63 km², matching real South
Tarawa's ~15.5 km² land area; 36/37 kept, 1 unmatched), Marshall Islands (ADM1, 24 atolls/islands — this
file's only level, since geoBoundaries has no ADM2 for MHL — Majuro computes to 10.42 km², Kwajalein to 7.24
km², both matching real published atoll land areas; 22/26 kept, 2 unmatched, 2 rejected — both real atoll
lagoon-inclusive areas, e.g. Ailuk's own 3,316 km² whole-atoll figure against a 451-population point, the same
sea/lagoon-inclusion pattern this file has repeatedly accepted), Micronesia (ADM2, "Municipality," 75 units —
Palikir/the seat of government resolves to Sokehs, 55.48 km², Weno resolves to its own 18.66 km² municipality;
57/62 kept, 5 unmatched — all population-0 remote outlying atolls of Yap/Chuuk states), Nauru (ADM1,
"District," 14 units — this file's only level; Yaren exists as its own named district, confirmed by name even
though a manually-guessed test coordinate for a country whose average district is ~1.5 km² landed in the
adjacent Meneng instead — the join's own GeoNames-precise coordinates plus the 2km snap fallback made this a
non-issue in practice, confirmed directly: 15/15 kept, 7 snapped), and Samoa (ADM2, "Districts," 43 units —
Apia resolves to Vaimauga West, 78.63 km², a real constituent district; Apia itself has no single unified city
government, so this is the correct city-plausible granularity; clean 74/74).

**Fiji needed the same override this file has now hit repeatedly:** recon's reported finest level (ADM4,
"Enumeration Areas," a census-statistical unit, not a real administrative one) would obviously be wrong even
before checking coordinates. ADM2 ("Provinces," 15 units) is too coarse in the other direction — Suva lands in
the whole 343.40 km² Rewa province, Nadi in the whole 3,226.72 km² Ba province. ADM3 ("Tikina," Fiji's
traditional district tier, 86 units) resolves both correctly instead — Suva -> Suva (153.99 km²), Nadi -> Nadi
(180.16 km²) — and is used. Result: 15/16 kept, 1 unmatched, 0 rejected.

**Tuvalu and Vanuatu both needed the opposite override from Fiji/Bangladesh/Sri Lanka/South Korea's usual
shape:** recon's own area-based heuristic picked ADM3 as "cityPlausible" for both, but ADM3 in each case
turned out to be bare NUMERIC shapeNames ("841," "904," ...; "110101," "220204," ...) — a statistical/census
enumeration grid with no real place names at all, confirmed by direct inspection, not just a coordinates check
(Vanuatu's own ADM3 landed Port Vila/Luganville in 0.35/0.50 km² numbered cells, nowhere near a real
administrative unit). Both switched to ADM2 instead: Tuvalu's ADM2 ("village," 34 units) carries Funafuti
atoll's own six real constituent villages (Alapi, Fakaifou, Senala, Teone, Vaiaku, Tonga) by name — clean
12/12; Vanuatu's ADM2 ("Municipalities," 65 units, a real mix of the country's actual municipal councils plus
rural area-council wards) resolves Port Vila and Luganville directly to their own named 23.69/24.97 km²
municipalities — 10/10 kept, 1 snapped.

**Papua New Guinea confirmed ADM3** ("Local Level Government areas," 326 units, matching recon) over the
coarser ADM2 ("District," 87 units) — Lae's ADM2 unit is the whole 131.46 km² Lae District, while ADM3
resolves it to the real 43.61 km² "Lae Urban LLG"; same shape for Mount Hagen (312.98 km² District vs. 9.77
km² "Mt Hagen Urban LLG"). Port Moresby is its own National Capital District at both levels (267.57 km², no
finer split available in this source) — accepted as the finest real unit obtainable, the same shape as North
Korea's special cities in the Twenty-first pass. Result: 50/59 kept, 9 rejected, none substantial.

**Tonga confirmed ADM2** ("district," 23 units, matching recon) — Nuku'alofa resolves to Kolofo'ou, 12.56 km²,
one of the capital's own real constituent districts. Clean 47/47 (1 snapped).

**Solomon Islands needed a real supplemental fix:** ADM2 ("Constituency," 50 units) doesn't include Honiara at
all — the capital lands in the surrounding "North West Guadalcanl" constituency (682.91 km²) instead, since
Honiara is administratively independent of Guadalcanal province, the same "capital not part of any ADM2 unit"
shape as every Central Asian capital in the Nineteenth pass. Confirmed a real "Capital Territory (Honiara)"
unit exists at ADM1 (the same tier as Solomon Islands' 9 provinces) — computes to a plausible 30.43 km², close
to Honiara's real ~22 km² official area — added as a single supplemental candidate, the same Bhutan/
Kazakhstan/Tajikistan "one specific missing capital, not a whole missing tier" pattern. Result: clean 23/23.

**New Zealand's Auckland fragmentation was investigated and deliberately left as-is**, NOT given the
Manila/Paris-style whole-city fix, because the whole-city alternative here is actually worse than the
fragments: ADM2 ("Territorial Authorities," 88 units, matching recon) correctly resolves Wellington City
(289.60 km²), Christchurch City (1,483.38 km², a real fact about Christchurch's amalgamated boundary), and
Hamilton City (110.85 km²) as whole cities, but Auckland — uniquely among NZ's territorial authorities, since
its 2010 "supercity" merger replaced its old constituent cities with 21 internal Local Board Areas instead of
one bare "Auckland" unit — has no whole-city ADM2 feature at all. A live OSM check found a same-named
"Auckland" administrative relation (population 1,642,800, matching real Auckland closely, confirming it's the
right relation), but at 16,153 km² — a genuinely enormous figure (real Auckland Council land area is ~4,941
km², so this OSM relation includes substantial Hauraki Gulf/harbor maritime jurisdiction) that would itself be
REJECTED by this script's own LOOSE_MAX_SQKM=5,000 ceiling even for a substantial-population point. Unlike
Manila (a 1.9M-population point landing in a sub-1-km² fragment — a severe, visually-broken mismatch)
Auckland's own GeoNames point lands in a real, reasonably-sized Local Board Area (Waitematā, 19.41 km² — the
same order of magnitude as Beijing/Jakarta/Manila's own accepted district-level matches elsewhere in this
file), so the fragment here is a genuine, acceptable administrative unit, not a broken one — investigated and
left alone rather than "fixed" into something worse. Result: 418/732 kept, 314 rejected (13 substantial — real
NZ "Districts" routinely amalgamate a small town with a vast rural hinterland, e.g. Hastings 88,300 in a
5,213 km² district, Marlborough/Blenheim 29,800 in 10,463 km² — a well-documented, real feature of NZ local
government, not a technique failure).

**Palau's ADM2 ("Hamlets," 77 units, matching recon) needed a real fix, caught only once the actual join ran**
— not by the initial coordinate spot-check, which looked acceptable given Palau's small population scale.
Koror town splits into named hamlets as small as 0.1-0.7 km², and GeoNames carries TWO separate Koror points
("Koror," population 14,000, and "Koror Town," population 12,676) that each landed in one of those tiny
hamlets — a real Manila-severity mismatch (a 12,676-population point in a 0.1 km² polygon), not a merely-finer-
but-still-reasonable unit the way Beijing/Jakarta's own district-level matches are. Fixed the same way Manila
was: 12 of Koror State's own hamlets fall geometrically inside the real whole "Koror" ADM1 state polygon
(45.51 km², plausible for the whole state including outlying islets beyond the town proper) and are dropped in
favor of that single candidate. Both Koror points now correctly resolve to the whole 45.5 km² state. Worth
remembering for any future country: a coordinate-only spot-check can miss a real fragmentation problem that
only shows up once GeoNames' own points are actually run through the join — check the real output, not just
the candidate levels, before calling a small-population country clean.

**File sizes**: none of Fiji/Kiribati/Marshall Islands/Micronesia/Nauru/Palau/Papua New
Guinea/Samoa/Solomon Islands/Tonga/Tuvalu/Vanuatu needed `shardByState()` — New Zealand's 3,731 KB is the
largest of those twelve. Australia (20,067 KB) also didn't need it despite a 4,901-point GeoNames index and a
156 MB raw ADM2 download — well under the ~49 MB threshold that has triggered sharding elsewhere in this file.

**Real, accepted residuals, all logged to BACKLOG.md**: Australia's 39 substantial rejects (Australia's own
famously huge amalgamated regional council areas), New Zealand's 13 substantial rejects (NZ Districts
combining a small town with vast rural hinterland), and Marshall Islands' 2 rejected/2 unmatched (real
lagoon-inclusive atoll areas and small outlying islands). Fiji/Kiribati/Micronesia's own small unmatched
residuals (remote atolls/islands, real geography) need no further entry.

**Final status: all 14 Oceania countries are done and committed. 137 of 193 UN members now have real
city-boundary data; 56 remain (India and Russia both still deliberately deferred to their own dedicated
passes) — every UN member outside Africa, India, and Russia now has real city-boundary data.**

### Twenty-fourth pass: North Africa + South Sudan (2026-09-18) — the first Africa batch: Algeria, Egypt,
Libya, Morocco, Sudan, South Sudan, Tunisia

The first slice of Africa, deliberately starting with the smallest/most-already-researched countries: Libya
and South Sudan were directly investigated back in the Fourth pass (2026-09-04), before this file's real
per-feature join even existed, and confirmed then to have genuine structural coverage gaps rather than a
hidden finer level to discover. This pass reuses those findings rather than re-investigating from scratch,
and turns them into real joins for the first time.

**Four confirmed clean on recon's own reported finest level:** Algeria (ADM3, "Communes," 1,540 units —
Algiers -> Sidi M'Hamed, a real 2.17 km² commune of the capital; Oran/Constantine each resolve to their own
whole commune; 318/353 kept, 35 rejected, 13 substantial — real oversized Saharan communes, not chased
further), Egypt (ADM2, "marakiz and aqsam" — markaz/qism, Egypt's real district tier for rural/urban areas
respectively, 365 units — Cairo -> Qasr Al-Nile, 1.09 km²; Alexandria -> Bab Sharqi, 6.32 km²; Giza and Luxor
each resolve to their own whole qism; 227/260 kept, 33 rejected, 25 substantial — Upper Egypt's own oversized
rural marakiz), Morocco (ADM2, 75 prefectures/provinces — Morocco's real ADM2 tier, no finer level exists in
this source at all — Casablanca -> its own 215.07 km² prefecture, Rabat -> 113.18 km²; Marrakesh's own
prefecture is a genuinely large 2,617.43 km² urban-plus-rural unit, the finest available, not a technique
failure; 176/480 kept, 304 rejected, 78 substantial — Morocco's rural "province"-level units, as opposed to
its urban "prefecture"-level ones, routinely span large agricultural/desert hinterlands around one real town),
and Sudan (ADM2, "District," 189 units — Omdurman -> Um Durman, 1,221.84 km²; Port Sudan -> its own 565.71
km² district; Khartoum's own test coordinate landed in the adjacent Jebel Awlia district, 782.47 km², rather
than central Khartoum's own — real coordinate imprecision on this pass's own manual check, not a data
problem, given Omdurman/Port Sudan both resolved correctly; 52/112 kept, 60 rejected, 51 substantial — a live
OSM check for a finer tier found `admin_level=6` returning only 129 relations, FEWER than geoBoundaries' own
189 districts — not a finer comprehensive tier, just an incomplete alternative encoding of the same one — and
`admin_level=7` returning zero nationwide, confirming no finer source exists, the same "not chased further"
bar Kazakhstan/Afghanistan/Pakistan's own oversized-district residuals already established).

**Tunisia needed the same override this file has now hit repeatedly:** recon's reported finest level (ADM3,
"imada"/sector, 2,077 units, canonicalName blank/"Unknown" at every level in this download) resolves Tunis to
a 1.76 km² sub-city sector ("الحدائق") and Sfax to a 0.83 km² one ("المدينة") — real named units, but
neighborhood/ward scale, the same trap as Bangladesh/Sri Lanka/Cambodia/South Korea's own ADM-too-fine
overrides. ADM2 ("delegation," Tunisia's real district tier, 264 units) resolves both to their own real
delegation instead — Tunis -> "باب بحر" (Bab Bhar), 11.01 km²; Sfax -> "صفاقس المدينة" (Sfax Al-Madina), 28.84
km² — and is used. Result: 280/286 kept (1 snapped), 6 rejected, none substantial — the cleanest result in
this pass.

**Libya's baladiyat (ADM1, 22 units — geoBoundaries has no ADM2 for LBY at all) is confirmed, per the Fourth
pass's own direct OSM investigation, to be the finest tier that exists anywhere for Libya** — OSM's own
`admin_level` 6/9/10 are all empty nationwide, no hidden finer government layer exists to discover. Genuinely
coarse (Tripoli's own baladiya is 2,619.84 km², Benghazi's is 9,835.40 km² — both spanning the whole city plus
a large rural hinterland). Result: only 16/119 kept, 103 rejected, 57 substantial (including Benghazi itself,
757,490 population, and Misratah, 355,657, in a 49,770 km² baladiya) — this pass's worst ratio, expected and
already predicted by the Fourth pass rather than a surprise.

**South Sudan's counties (ADM2, 78 units, matching recon) are similarly confirmed coarse nationwide** (Juba's
own county is 18,447.35 km², far past even the loose ceiling) — the Fourth pass's own exception (a genuine
`admin_level=8` Juba-neighborhood tier, 37 relations, still current) was added as a supplemental candidate,
the same Kazakhstan/Bhutan/South Korea "single-capital OSM supplement" pattern. **Worth being honest about:
this supplement measured zero benefit in this specific run** — every one of the 7 kept South Sudan features
came from the plain ADM2 source, none from the neighborhood supplement. Direct investigation found why:
GeoNames' own "Juba" coordinate (31.58247, 4.85165) sits in a real gap between the neighborhood polygons — the
nearest one, "Hai Nyakama," comes within roughly 0.02° of it but doesn't quite contain it, and since Juba's
own ADM2 county polygon *does* contain the point, the join's snap-to-nearest fallback (which only activates
when NO candidate contains the point at all) never triggers either — a real architecture nuance, not a bug:
"a huge-but-real containing polygon beats no polygon," so a too-large match still wins over a nearby-but-
non-containing smaller one. Kept in the code anyway (it's still the technique the Fourth pass called for, and
correctly implemented), but the honest result is: 7/23 kept, 15 rejected (11 substantial, Juba's own 450,000-
population point among them), 1 unmatched.

**File sizes**: none of these seven needed `shardByState()` — Morocco's 1,172 KB is the largest.

**Real, accepted residuals, all logged to BACKLOG.md**: Libya (57 substantial rejects, the worst ratio in this
pass, already predicted by the Fourth pass), Sudan (51 substantial rejects, confirmed via a fresh live OSM
check that no finer tier exists), Morocco (78 substantial rejects, real rural-province scale), Algeria (13
substantial rejects), Egypt (25 substantial rejects), and South Sudan (11 substantial rejects even with the
Juba supplement, for the coordinate-gap reason explained above). Tunisia's clean result needs no entry.

**Final status: 7 of Africa's 54 UN members are done and committed. 144 of 193 UN members now have real
city-boundary data; 49 remain — all in Africa (47 more) plus India and Russia.**

### Twenty-fifth pass: West Africa (2026-09-18) — Benin, Burkina Faso, Cabo Verde, Côte d'Ivoire, Gambia,
Ghana, Guinea, Guinea-Bissau, Liberia, Mali, Mauritania, Niger, Nigeria, Senegal, Sierra Leone, Togo

The second Africa batch. Every level confirmed by a direct point-in-polygon check against real coordinates,
not just recon's own canonicalName field.

**Ten confirmed clean on recon's own reported finest level:** Benin (ADM3, "Arrondissements," 546 units —
Cotonou/Porto-Novo each resolve to their own real arrondissement; clean 87/87), Cabo Verde (ADM2, "freguesia,"
32 units — Praia resolves to its own 98.21 km² freguesia; clean 228/228), Côte d'Ivoire (ADM3, "Departments,"
510 units — Abidjan resolves to its own whole 555.43 km² department, not fragmented into its 10 real
communes; Yamoussoukro likewise its own department; this pass's largest GeoNames index by far, 5,136 points,
4,968 kept, 168 rejected, none substantial — real rural departments, and no sharding needed despite the
count, 14,107 KB), Ghana (ADM2, "Districts," 260 units — Accra -> Ayawaso West, 32.77 km²; Kumasi -> its own
21.72 km² metropolis), Guinea (ADM3, "sub-prefecture," 340 units — Conakry's own 5 real communes (Kaloum,
Dixinn, Matam, Matoto, Ratoma) are all present by name, a first coordinate check just missed the narrow
peninsula), Guinea-Bissau (ADM2, 39 units — Bissau resolves to its own 188.90 km² "Bissau Autonomous
Sector"), Liberia (ADM2, "Districts," 136 units — Monrovia resolves to its own 196.52 km² "Greater
Monrovia"), Mali (ADM3, "Commune," 701 units — Bamako resolves to its own "Commune III," one of its 6 real
communes; Sikasso to its own whole commune), Mauritania (ADM2, 57 units — Nouakchott resolves to Tevragh
Zein, one of its 9 real moughataa; 22 of 88 substantial rejects — Zouérat's own mining-region moughataa is a
genuinely enormous 167,659 km², real Saharan geography), Niger (ADM3, "Communes," 266 units — Niamey/Zinder
each resolve to their own real numbered commune), Nigeria (ADM2, "Local Government Areas," 774 units — an
exact match to Nigeria's real LGA count; Lagos/Ikeja -> its own 41.04 km² LGA, Abuja -> the real 1,481.83 km²
Municipal Area Council, Kano -> Kano Municipal, 14.96 km², Ibadan -> Egbeda, one of its several constituent
LGAs; 790/927 kept, 137 rejected, 15 substantial), Senegal (ADM3, "arrondissement," 121 units — Dakar ->
Almadies, 31.82 km²), and Togo (ADM2, "Prefectures," 37 units — Lomé's own "Lomé Commune," 130.46 km², is a
real distinct unit from the surrounding rural prefectures, not fragmented further).

**Gambia and Sierra Leone both needed the same override this file has now hit repeatedly:** recon's own
area-heuristic pick was one level too fine. Gambia's ADM3 ("Ward," 120 units, 0.13 km² min) resolves Banjul to
"New Town East" — sub-city scale — while ADM2 ("District," 48 units) resolves it to "Banjul Central" (0.78
km², the same order of magnitude as Cairo's own accepted qism-level matches) and Serekunda to "Serrekunda
Central" (3.94 km²); ADM2 is used — clean 180/180 (4 snapped). Sierra Leone's ADM4 (recon's own
"cityPlausible" pick, 1,322 units) turned out to have a real, additional data-quality problem on top of being
too fine — several features have a literal blank `shapeName`, and its own recon-reported canonicalName
("Counties") isn't even a real Sierra Leonean administrative term. ADM3 ("Chiefdoms," Sierra Leone's real
traditional-authority tier, still used for Freetown's own internal wards) resolves Freetown to "West II," 6.69
km², and is used instead — 86/88 kept, 2 rejected, none substantial.

**Burkina Faso surfaced a real, previously-unseen class of geoBoundaries data-quality bug: not a blank/wrong-
but-unique/garbled name (Turkmenistan/China/Iran's own prior findings), but a genuine shapeName/geometry
MISALIGNMENT.** The feature actually named "Ouagadougou" in ADM3 has a bounding box roughly 150 km southwest
of the real capital, and the feature that actually DOES contain Ouagadougou's real coordinates is named
"Bereba" instead (a real Burkinabè commune, but nowhere near the capital); the same displacement pattern
repeats for "Bobo-dioulasso," whose own polygon sits roughly 150-200 km northeast of the real city. Confirmed
by checking both features' real bounding boxes directly, not just a single coordinate miss — this is a
systematic misalignment affecting (at least) the country's two largest cities, not an isolated one-off, so
ADM3 is untrustworthy for this join even though its recon-reported unit count looked plausible. ADM2
("Province," 45 units) has no such problem — Ouagadougou correctly resolves to Kadiogo Province (2,880.32
km², the real province containing the capital) — and is used instead, at real province-level coarseness
rather than a wrong city-level match. Result: 37/118 kept, 81 rejected, 45 substantial (including
Bobo-Dioulasso itself, 904,920 population, now correctly — if coarsely — located in Houet Province, 11,592
km², rather than silently mismatched to a wrong location 150+ km away).

**File sizes**: none of these sixteen needed `shardByState()` — Côte d'Ivoire's 14,107 KB is the largest,
despite having by far the most GeoNames points of any country in this pass.

**Real, accepted residuals, all logged to BACKLOG.md**: Mauritania (22 substantial, Saharan moughataa scale),
Burkina Faso (45 substantial, real province-level coarseness after the ADM3 misalignment fix), Nigeria (15
substantial), Niger (8 substantial), Senegal (4 substantial), Mali (6 substantial, 1 unmatched), and Ghana (1
substantial). Benin/Cabo Verde/Gambia's own clean results and Guinea/Guinea-Bissau/Liberia/Sierra
Leone/Togo/Côte d'Ivoire's small non-substantial residuals need no further entry.

**Final status: 23 of Africa's 54 UN members are done and committed. 160 of 193 UN members now have real
city-boundary data; 33 remain — all in Africa (31 more) plus India and Russia.**

### Twenty-sixth pass: Central Africa (2026-09-18) — Cameroon, Central African Republic, Chad, Congo, DR
Congo, Equatorial Guinea, Gabon, São Tomé and Príncipe

The third Africa batch. Every level confirmed by a direct point-in-polygon check against real coordinates,
not just recon's own canonicalName field.

**Five confirmed clean on recon's own reported finest level:** Cameroon (ADM3, 360 units — Douala -> Douala
I, 32.20 km²; Yaoundé -> Yaoundé III, 68.46 km²; 124/145 kept, 21 rejected, 10 substantial), Chad (ADM2,
"Departments," 70 units — N'Djamena resolves to its own 426.53 km² department; Moundou has no unit of its own
name in this download at all, a real gap not chased further; 18/74 kept, 38 substantial rejects — Chad's own
vast Sahelian departments), Equatorial Guinea (ADM2, 28 units — Malabo resolves to its own 383.32 km²
district; clean-ish 25/27, 1 snapped), Gabon (ADM2, "Department," 49 units — Libreville resolves to its own
185.53 km² department; 13/50 kept, 12 substantial rejects, real rainforest-department scale), and São Tomé
and Príncipe (ADM2, "Districts," 7 units — the capital resolves to Água Grande, 22.46 km²; clean 51/51).

**Central African Republic needed the same override this file has now hit repeatedly:** recon's own
area-heuristic pick, ADM5 ("quartiers," 202 units), only covers Bangui at all (202 nationwide is nowhere
close to a comprehensive tier for the whole country) and resolves Bangui itself to a 0.32 km² neighborhood —
too fine even for the one city it covers. ADM3 ("Municipalities," 175 units, comprehensive nationwide)
resolves Bangui to Arrondissement 1 (8.16 km², one of Bangui's real 8 arrondissements) and — confirmed with a
second, non-capital town — Mbaiki to its own real unit; used instead. Result: 38/51 kept, 13 rejected, 6
substantial.

**Congo (Republic of the) surfaced a second, more severe instance of Burkina Faso's own shapeName/geometry
misalignment bug** (Twenty-fifth pass) — not isolated to one or two features this time, but confirmed across
at least three spot-checked ADM2 features nationwide. "Ngamaba (Brazzaville)" and "Loandjili (Pointe Noire)"
— real named arrondissements of Congo's own two biggest cities — both have bounding boxes roughly 300-400 km
from the real cities of those names (and are themselves thousands of km² — utterly implausible for a single
urban arrondissement). A third, unrelated spot check ("Owando," a real northern town with no "(city)"
annotation at all) is *also* displaced roughly 150-200 km from its real location, confirming this isn't
limited to the two annotated entries — the whole ADM2 level is untrustworthy for this join, not a two-feature
patch. Switched to ADM1 ("Départements," 12 units — Congo's 10 rural departments plus Brazzaville and
Pointe-Noire as their own units at the same tier) instead, confirmed correctly located for both cities that
matter most. **This still left Brazzaville itself (population 1,982,000) rejected outright** — its own
correctly-located ADM1 department is a real but huge 6,065.32 km², past even the loose ceiling. A live OSM
check found a genuine, separate "Brazzaville (commune)" relation (distinct from "Brazzaville (département)"),
342.52 km² — a plausible real urban-commune scale — added as a single supplemental candidate, the same
Bhutan/Kazakhstan/South Korea "one specific missing finer unit for the capital" pattern. Result: only 4/60
kept overall (real Congo-wide rural-department coarseness), but both of the country's two most important
cities — Brazzaville and Pointe-Noire — now resolve correctly at real city scale rather than being either
silently mismatched or dropped.

**DR Congo's own Kinshasa "territory, city" unit (10,656.04 km²) is real geography** — the province-city
genuinely spans that much rural hinterland — **but far past the loose ceiling, so the capital's own GeoNames
point (population 16,000,000, one of the largest cities on Earth) would have been REJECTED outright**, along
with several of its own million-plus-population sub-areas (Masina, 485,167). A live OSM check (bbox-scoped to
the real city rather than an ISO3166-2 area query, which timed out — Kinshasa's own vast province polygon
made the area-based query too expensive) confirmed a real, comprehensive `admin_level=7` commune tier —
Kinshasa's own real communes (Kintambo, Bandalungwa, Gombe, Kinshasa, Masina, ...) — added as a supplemental
layer, the same "split the megacity into its own real districts" pattern Beijing/Jakarta/Manila already
established. Both Kinshasa (now 3.1 km², its own central commune) and Masina (39 km²) resolve correctly.
Result: 37/118 kept, 81 rejected, 79 substantial — DR Congo's own remaining rural territories are still
genuinely enormous (Sandoa territory alone is 29,712 km²), the worst substantial-rejection ratio of any
country in this pass, but the capital itself is now correctly represented rather than the single largest
population figure in this entire project's history being silently dropped.

**File sizes**: none of these eight needed `shardByState()` — Cameroon's 429 KB is the largest.

**Real, accepted residuals, all logged to BACKLOG.md**: DR Congo (79 substantial, the worst ratio in this
pass — genuinely vast rural territories, not chased further given the capital fix already addressed the
single highest-value gap), Chad (38 substantial, Sahelian department scale), Congo (27 substantial, real
department-level coarseness away from its two now-fixed cities), Gabon (12 substantial), Cameroon (10
substantial), and CAR (6 substantial). Equatorial Guinea and São Tomé and Príncipe's own clean results need
no further entry.

**Final status: 31 of Africa's 54 UN members are done and committed. 168 of 193 UN members now have real
city-boundary data; 25 remain — all in Africa (23 more) plus India and Russia.**

### Twenty-seventh pass: East Africa (2026-09-18) — Burundi, Comoros, Djibouti, Eritrea, Ethiopia, Kenya,
Madagascar, Malawi, Mauritius, Mozambique, Rwanda, Seychelles, Somalia, Tanzania, Uganda, Zambia, Zimbabwe

The fourth Africa batch, and the largest single-pass country count in this file's history (17). Every level
confirmed by a direct point-in-polygon check against real coordinates, not just recon's own canonicalName
field.

**Eight confirmed clean on recon's own reported finest level:** Comoros (ADM3, "Commune," 55 units — clean
119/119, 11 snapped), Djibouti (ADM2, "Districts," 11 units — 19/32 kept, 13 rejected, none substantial),
Eritrea (ADM2, "districts," 58 units — 16/19 kept, 1 unmatched, a small offshore island), Ethiopia (ADM3, 690
units — Addis Ababa resolves to Lideta, 11.02 km², one of its 10 real sub-cities; 224/255 kept, 26
substantial rejects), Mauritius (ADM1, 12 units — this file's only level for MUS; 115/116 kept, 1 unmatched),
Mozambique (ADM3, "Administrative Postos," 411 units — 89/94 kept), Seychelles (ADM3, "Districts," 27 units —
clean 26/26), and Somalia (ADM2, "Districts," 118 units — Mogadishu resolves to HODAN, 8.11 km²; Hargeisa's
own district a genuinely huge 8,459 km²; 24/76 kept, 27 substantial rejects — real district-scale coarseness
across a country with limited comprehensive mapping, not chased further).

**Three confirmed clean at a level OTHER than recon's own "cityPlausible" flag:** Tanzania (ADM3, 3,644
units, matching recon's actual "finest" flag rather than its cityPlausible pick — Dar es Salaam resolves to
Ubungo, 10.04 km², one of its real 5 municipal districts; 322/324 kept), Uganda (ADM4, "Sub-counties," 1,521
units, matching recon's own suggestion despite geoBoundaries' own confusingly-swapped canonicalNames for this
country — ADM2 labeled "Counties," ADM3 labeled "District," backwards from Uganda's real Region > District >
County > Sub-county hierarchy — Kampala resolves to Kawempe Division, 30.98 km², one of its own real 5 city
divisions; ADM2 and ADM3 both just return the same whole "Kampala" at two different, overlapping scales,
confirming those two levels are unusable for this city regardless of their real meaning elsewhere in the
country; clean 212/212), and Zambia (ADM2, "Districts," 116 units — Lusaka/Kitwe each resolve to their own
whole district; 54/98 kept, 35 substantial rejects, real vast rural districts).

**Zimbabwe confirmed ADM2** ("District," 91 units) over its own recon-flagged ADM3 ("Ward") — Harare/Bulawayo
each resolve to their own whole, comfortably-under-the-loose-ceiling district (662.42/547.35 km²); ADM3's real
numbered wards (e.g. "Harare 6," 8.23 km²) are genuine Zimbabwean administrative units, not an enumeration
artifact the way Vanuatu's numeric ADM3 was, but fragment the two cities into 40+ pieces apiece for no benefit
ADM2 doesn't already provide at whole-city scale. Result: 32/69 kept, 5 substantial rejects.

**Burundi, Kenya, Madagascar, and Rwanda all needed the same override this file has now hit repeatedly** —
recon's own area-heuristic pick was one level too fine. Burundi's ADM3 ("Collines," 2,615 units) is a rural
hill-cluster tier, while ADM2 (119 units) resolves Bujumbura to Mukaza, 16.50 km², one of its real communes —
clean 33/33. Kenya's ADM3 ("Ward," 1,452 units) resolves Nairobi to a 3.94 km² ward — sub-city scale — while
ADM2 ("Sub-Counties," 290 units) resolves it to Starehe, 16.91 km², and Mombasa to Mvita, 14.78 km², both real
sub-counties at a more consistent city-district scale; 268/336 kept, 26 substantial rejects. Madagascar's
ADM4 ("fokontany," 17,465 units) is village/neighborhood scale, while ADM3 ("commune," 1,579 units, matching
its own recon-reported canonicalName) resolves Antananarivo to its own real 6e Arrondissement, 17.65 km²;
151/152 kept. Rwanda's ADM5 ("Villages," 14,815 units) is obviously far too fine, while ADM2 (30 units —
Rwanda's real district tier; Kigali City itself splits into 3 of these districts) resolves Kigali to
Nyarugenge, 133.06 km², one of its own 3 real constituent districts; clean 51/51.

**Malawi's override is a different shape from the others**: recon's own pick, ADM3 ("Traditional
Authorities," 245 units), turned out to have real, uneven coverage on top of being the wrong administrative
concept for a city — Malawi's 4 main cities are legally separate from the rural Traditional Authority
structure, and this download only carries an explicit "City" unit for Blantyre (350.10 km², itself not
containing a direct coordinate check — likely a real but imperfectly-digitized boundary), with no equivalent
unit for Lilongwe, the capital, at all. ADM2 ("district," 28 units) at least resolves every city to a real,
unambiguous whole district — Blantyre to its own 2,033.05 km² district — though Lilongwe's own district
(6,247.85 km², combining the city with a large rural hinterland) is genuinely past even the loose ceiling, and
a live OSM check found no separate Lilongwe-city-only boundary either (OSM's own "Lilongwe" relation is the
same coarse admin_level=4 district) — a real, confirmed gap for the capital specifically, not chased further.
Result: 25/39 kept, 6 substantial rejects (Lilongwe, Mzuzu, Mzimba, Mangochi, Monkey Bay, Kasungu).

**File sizes**: none of these seventeen needed `shardByState()` — Kenya's 953 KB is the largest.

**Real, accepted residuals, all logged to BACKLOG.md**: Zambia (35 substantial), Somalia (27 substantial),
Kenya (26 substantial), Ethiopia (26 substantial), Malawi (6 substantial, including the capital), and
Zimbabwe (5 substantial). Djibouti/Eritrea/Mauritius/Mozambique/Tanzania's own small non-substantial residuals
and Burundi/Comoros/Madagascar/Rwanda/Seychelles/Uganda's own clean results need no further entry.

**Final status: 48 of Africa's 54 UN members are done and committed. 185 of 193 UN members now have real
city-boundary data; 8 remain — all in Africa (6 more: Angola, Botswana, Eswatini, Lesotho, Namibia, South
Africa) plus India and Russia.**

### Twenty-eighth pass: Southern Africa (2026-09-18) — Angola, Botswana, Eswatini, Lesotho, Namibia, South
Africa — completing Africa

The fifth and final Africa batch. Every level confirmed by a direct point-in-polygon check against real
coordinates, not just recon's own canonicalName field.

**Four confirmed clean on recon's own reported finest level:** Angola (ADM3, "Communes," 558 units — Luanda
resolves to Maianga, 28.07 km², one of its real communes; 397/565 kept, 12 substantial rejects), Eswatini
(ADM2, 53 units — Mbabane resolves to its own real "Inkhundla Mbabane," 103.12 km², Eswatini's real
administrative term; clean 25/25), Lesotho (ADM2, "constituencies," 78 units — Maseru resolves to its own
142.11 km² constituency; clean 47/47), and South Africa (ADM3, "Local municipality," 213 units, NOT recon's
own ADM4 "Ward" cityPlausible pick — Johannesburg resolves to the whole "City of Johannesburg," 1,648.02 km²;
Cape Town to "City of Cape Town," 2,446.43 km²; Durban to "eThekwini," 2,558.90 km² — all correctly whole, not
fragmented into their own thousands of wards).

**South Africa's own residual is this pass's largest and most systemic**: 341/989 kept, 648 rejected, 153
substantial — including Pretoria itself (2,112,693 population), whose own "City of Tshwane" metro is a real
6,310.24 km² unit, just over the loose ceiling. Unlike Auckland/Manila's own fragment-vs-whole-city problem,
this isn't a data gap or a wrong level — South Africa's real post-1994 municipal demarcation genuinely
consolidated most of the country's cities into large multi-town "local municipalities" spanning that much
area (Bloemfontein/Mangaung 9,898.8 km², Welkom/Matjhabeng 5,699.1 km², Polokwane 5,065.4 km², George 5,192.9
km², Potchefstroom/Ventersdorp-Tlokwe 6,409.7 km²) — a well-documented real fact about South African local
government, the same shape as Christchurch/Brisbane's own genuinely-huge amalgamated council areas elsewhere
in this file, just far more pervasive here (affecting the majority of the country's mid-size cities, not one
or two outliers). ADM4 ("Ward," 4,392 units) would fragment every one of these into sub-few-km² pieces — the
same over-fragmentation this file has rejected everywhere else it's appeared (Bangladesh, Kenya, Zimbabwe,
...) — so ADM3 stays the right choice despite the high rejection count.

**Botswana's ADM2 (25 units) was already directly investigated back in the Fourth pass (2026-09-04)** and
confirmed to be the finest tier that exists anywhere for this country — OSM's own real sub-district tier is
almost entirely unmapped (2 of 23 sub-districts). This pass turns that finding into a real join for the first
time: confirmed again directly (Gaborone resolves to its own whole 1,326.81 km² district; Francistown, the
country's second city, has no unit of its own name in this download at all — it lands in the surrounding
"Masungu" sub-district instead, the same real, already-documented gap, not a new finding). Result: 15/139
kept, 26 substantial rejects.

**Namibia surfaced a fourth instance of the shapeName/geometry misalignment bug** (Burkina Faso, Twenty-fifth
pass; Congo, Twenty-sixth pass) — narrower in scope than either of those, but real: the feature named "Opuwo"
in ADM2 has a bounding box sitting exactly where Walvis Bay is (14.48-14.55°E, -22.98 to -22.92°S), nowhere
near the real Opuwo (a Kunene-region town roughly 5° of latitude further north), while the two features
actually named "Walvisbay Urban"/"Walvisbay Rural" are themselves wildly oversized (36,683 km² and 10,958
km², both with bounding boxes well inland/south of the real coastal town) — a real, three-feature
swap/corruption, not a two-feature isolated case the way Windhoek's own correctly-positioned "Windhoek Rural"
(209.08 km², confirmed to actually contain Windhoek's real coordinates) shows the rest of the file isn't
uniformly broken. A live OSM check found no separate Walvis Bay or Opuwo administrative boundary to
substitute either. All three confirmed-corrupted features were dropped from the candidate list entirely
(rather than left in to risk silently mislabeling some other real town's point under a wrong name) — Walvis
Bay and Opuwo's own GeoNames points become an honest, logged gap instead of a silently wrong match. Result:
23/93 kept, 67 rejected (12 substantial), 3 unmatched (Schlip, Kalkrand, Groot Aub — small towns near the
excluded Walvis Bay/Opuwo area).

**File sizes**: none of these six needed `shardByState()` — South Africa's 2,099 KB is the largest, despite a
46 MB raw ADM3 download (the geoBoundaries fetch hit a real transient network termination on its first
attempt — `[retry 1/6] terminated` — and succeeded cleanly on retry, the existing retry infrastructure working
exactly as designed).

**Real, accepted residuals, all logged to BACKLOG.md**: South Africa (153 substantial — the largest count of
any single country in this entire project, a real reflection of nationwide municipal consolidation, not a
technique failure), Botswana (26 substantial, an already-documented structural gap), Angola (12 substantial),
and Namibia (12 substantial, 3 unmatched from the shapeName-misalignment exclusion). Eswatini/Lesotho's own
clean results need no further entry.

**Final status: all 54 of Africa's UN members are done and committed — Africa is complete. 191 of 193 UN
members now have real city-boundary data; only India and Russia remain, both still deliberately deferred to
their own dedicated investigations.**

### Twenty-ninth pass: India (2026-09-19) — the first of the two held-back giants, and a real "recon picked a level 100x too fine" case

India was excluded from every routine batch since the Twentieth pass because recon's own reported finest
level (ADM5, 649,771 villages, min 0.0004 km²) is nowhere near city scale. This pass checked every candidate
level against ~30 real cities by direct point-in-polygon before picking one, rather than trusting recon.

**ADM3 ("Sub-District," 6,836 units — tehsil/taluka/mandal) is the right level.** Mumbai -> Mumbai Suburban
406.5 km², Chennai -> Chennai 174.5, Kolkata -> Kolkata 202.9, Nagpur -> Nagpur (Urban) 192.3, Indore -> Indore
201.2, Chandigarh -> Chandigarh 118.4, Pune -> Pune City 413.9. Both neighbors were rejected on evidence, not
assumption: ADM2 (736 districts) is a whole district for most cities (Pune 15,699 km², Ahmedabad 7,272 km²,
Lucknow 2,543 km²); ADM4 ("CD Block," 7,152) is a rural community-development-block tier that's inconsistent
for cities (Indore 1,019.7 km², Bhopal 1,301.9 km²) and mislabels some (Shimla -> "Mashobra," Chennai spelled
"Channai"). **This is a third distinct "recon too fine" shape** alongside Bangladesh/Sri Lanka's ward-scale
levels and Tuvalu/Vanuatu's bare enumeration grids: a census-village tier, four orders of magnitude finer than
any city.

**Real-join dry run before touching the build script** (a scratch copy of the join's exact thresholds/snap
logic, no writes): 7,070 of 7,112 GeoNames points kept, 41 rejected, 1 unmatched. Two checks on it: (1) a
same-name probe (does a *uniquely*-named candidate exist that the point did NOT land in?) found 203 apparent
disagreements >25 km apart, but every one inspected was a homonym or spelling variant (a Pune neighborhood
"Shivaji Nagar" vs. an unrelated unique "Shivaji Nagar" 1,500 km away; "Nizāmābād" -> "Nizamabad Rural"), not
the shapeName/geometry misalignment the Africa campaign found four times — the landed polygon was the
geographically correct one each time. (2) The 41 rejects are all genuine sparse-region oversized units.

**Two megacities had the exact Manila/Paris "fragments instead of a whole city" shape**, confirmed by counting
ADM3 centroids inside each city's own OSM relation: **Delhi** (31 fragments — Kotwali 29 km², Seema Puri 5 km²,
Rajouri Garden 10 km² — vs. rel/21180767's whole-city 1,392.2 km²) and **Hyderabad** (27 fragments — Charminar
6 km², Asif Nagar 9.6 km² — vs. rel/7868535's GHMC-scale 611.0 km²). Same fix as Manila: drop the fragments
whose centroid falls inside the whole-city relation (58 total) and add the relation as one candidate. The
build fetches both by relation id and throws if either's name/admin_level tag has changed, rather than
silently trusting a stale id. **Bengaluru** (2 ADM3 taluks inside OSM's 719.1 km² relation) and **Jaipur** (1
unit inside OSM's 392.3 km²) were checked and deliberately NOT given this fix — ADM3 already resolves each to
one city-plausible unit, so replacing them would be churn, not a fix (the Auckland lesson: check net benefit
before applying the pattern reflexively). **A pleasant side effect worth knowing:** New Delhi, the capital,
stayed on ADM3's "Chanakya Puri" (35.1 km²) instead of being folded into the 1,392 km² Delhi polygon, because
OSM's Delhi L8 relation excludes the NDMC/cantonment area, so Chanakya Puri's centroid fell outside it and the
fragment-drop never touched it — a better capital boundary than the fix was designed to produce.

**No other OSM tier exists to supplement with.** An `is_in()` check at 8 major-city coordinates found India's
city-level tagging inconsistent: Delhi/Hyderabad/Jaipur at admin_level 8, Bengaluru at 7, and Mumbai/Ahmedabad/
Pune/Lucknow with no city-level relation at all. A nationwide OSM layer would not be comprehensive, so none was
added beyond the two whole-city fixes above.

**Sharded by state, keyed on `iso_3166_2`, NOT `postal`** — Natural Earth's India `postal` is `null` for
Gujarat, which `shardByState()`'s truthiness filter silently drops (every Gujarati city would have fallen to
the nearest-state-by-centroid fallback). `iso_3166_2` has 36 unique non-null values. This is the third country
where `postal` was unusable (Germany, Spain, now India) and a *different* failure mode from the first two
(null rather than colliding) — worth checking a shard key for nulls as well as uniqueness. 28 features matched
no state polygon directly (coastal/island simplification artifacts) and used the nearest-state fallback, logged
as always. Output: 36 state files, 30.5 MB combined, largest Tamil Nadu at 5.3 MB (Uttar Pradesh 3.0, Maharashtra
2.7) — under Mexico's Veracruz precedent (11.9 MB). `'356'` added to `useCityOutline.ts`'s
`STATE_SHARDED_COUNTRIES` and `addFromShardedDir('356')` to `buildCityBoundariesIndex.mjs`; the index grew
30.05 -> 31.12 MB (+7,070 entries).

**Verification so far:** typecheck clean, 96/96 Vitest, the build matched the dry run exactly (7,070 kept, 15
snapped, 41 rejected, 1 unmatched). **Not yet checked in the browser** — see this pass's own note in the
migration plan below; a real UI check of Delhi/Hyderabad/Mumbai outlines is still owed.

**Real, accepted residuals, logged to BACKLOG.md:** 41 rejected (11 substantial — Bhuj, Jaisalmer, Leh, ...),
1 unmatched (Sarupathar), and Surat/Ahmedabad/Mumbai resolving to sub-city-but-plausible ADM3 units.

**Final status: India is done. 192 of 193 UN members now have real city-boundary data; only Russia remains.**
(Superseded by the Thirtieth pass below — Russia is now done too.)

### Thirtieth pass: Russia (2026-09-19) — the last UN member, and a real "federal cities have no ADM2" gap

Russia was held back from every routine batch alongside India. Unlike India, recon was not misleading: its
report lists only ADM1 (83 federal subjects) and ADM2 ("Raion," 2,327 features, OSM/Wambacher 2017), so there
was no over-fine level to override.

**ADM2 is the right level**, checked by direct point-in-polygon against all 99 headline-tier Russian cities
before writing anything: every regional city lands in its own whole urban okrug/raion at city scale (Kazan 633
km², Omsk 578, Samara 542, Krasnodar 837, Ryazan 223, Pskov 95), and the shapeNames are geometrically aligned
with their polygons — no Africa-campaign-style misalignment seen. Shipped result: 3,120 of 5,322 GeoNames points
kept.

**Moscow and Saint Petersburg have no ADM2 features at all** (they are federal cities, ADM1-only), so Moscow,
Saint Petersburg, and every district-scale GeoNames point inside them (Yasenevo, Bibirevo, Kalininskiy,
Krasnogvargeisky, ...) came back unmatched. OSM has real finer tiers for both — Moscow L8 (132 districts and
New Moscow settlements), Saint Petersburg L5 (18 raions; its L8, 111 municipal formations, is too fine). Handled
the Monaco way, as two joins with different candidate sets: (1) the three whole-unit points (Moscow, Saint
Petersburg, and Zelenograd) join against their whole OSM relation (rel/102269 L4, rel/337422 L4, rel/1320358
L5), because the centre-of-city Moscow point would otherwise land in a ~7 km² central district — the
France/Manila/Delhi fragments-instead-of-whole-city shape; (2) every other point joins against ADM2 plus the
Moscow L8 districts plus the SPb L5 raions, smallest-containing-polygon wins. The build fetches each whole-unit
relation by id and throws if its name/admin_level tag has changed. **Zelenograd needed its own entry only
because the first run showed it landing in a 4 km² "Staroye Kryukovo District" fragment** — a 215k-population
headline point in one of its five districts — caught by inspecting the actual output, not the join counts.
Saint Petersburg's whole-city polygon computes to 2,271 km² against its official ~1,439 km²: accepted as
sea-inclusive (Gulf of Finland-facing administrative boundary), the same call as Manila and Yeonggwang.

**Sharded by federal subject, with two Natural Earth corrections found by checking geometry, not labels.**
`iso_3166_2` is unique, but `RU-MOW` (43,797 km², named "Moskovskaya") is actually Moscow **oblast** and
`RU-MOS` (2,841 km², contains the Kremlin) is Moscow **city** — swapped relative to ISO 3166-2 — so
`russiaShardKey()` swaps them back (city = MOW, oblast = MOS); `RU-X01~` is a nameless 38 km² Yamal sliver and
is dropped. `postal` is unusable (CK/VO/MS collide, one null) — the fourth country where `postal` failed,
and a fourth distinct failure mode. Separately, NE's simplified Moscow-city polygon does not cover the New
Moscow/Zelenograd exclaves, so 15 Moscow-city district features landed in the *oblast* shard on the first run;
`shardByState()` gained an optional `forcedAbbrevOf(feature)` hook and anything sourced from a Moscow/SPb OSM
tier is now sharded by source instead of geometry. Fallbacks to nearest-state dropped from 25 to 9. Output: 83
files, 23.0 MB combined, largest `mos.json` (Moscow oblast) 3.4 MB — under the Mexico/Veracruz precedent.
`'643'` added to `useCityOutline.ts`'s `STATE_SHARDED_COUNTRIES` and `addFromShardedDir('643')` to
`buildCityBoundariesIndex.mjs`; the index is now 218,736 entries, 31.6 MB (+3,120).

**Real, accepted residual: 2,202 of 5,319 non-federal-city points rejected as too large (174 substantial)** —
Russia's real rural municipal districts are enormous and a town is one settlement inside one (Ukhta 102,187 in a
13,490 km² okrug; Mezhdurechensk, Serov, Vorkuta, Vyborg, Beloretsk, Neryungri, Tikhvin, Krasnokamensk are the
other ≥50k rejects). A direct Cyrillic-name OSM check on 15 of the biggest rejects found no comprehensive finer
tier — only Vyborg has an L8 relation; every other hit was a village-tagged hamlet — the same conclusion as
India, so none was added. Zero unmatched, zero snapped. **Crimea/Sevastopol:** GeoNames files them under
Ukraine, not Russia, so Simferopol and Sevastopol are not in this shard at all and no Russian polygon claims
them — consistent with this project's contested-territory posture (Crimea stays a search-only GeoEntity). The
shard key for NE's `UA-43`/`UA-40` rows exists but currently receives no features.

**No antimeridian handling needed:** checked all 3,120 output features directly — none straddles ±180° (Chukotka
contributes only Anadyr; its other units are rejected as too large), so `geometryCentroid`'s no-unwrap
limitation (see the Seventh pass) is not triggered.

**Verification so far:** typecheck clean, 96/96 Vitest, the build's join counts and shard contents checked
against real Moscow/SPb/Zelenograd/Kazan/Yasenevo/Kalininskiy entries. **Not yet checked in the browser** — a
real UI check of Moscow, Saint Petersburg, Zelenograd, and one regional city (Kazan) outline is still owed.

**Final status: all 193 UN members now have real city-boundary data.**

### Thirty-first pass: US validation + cutover (2026-09-21) — migration plan steps 4-5, and a real cross-project centroid bug found only because a second source existed to check against

**Step 4 (validate the new pipeline's US output against the old Census pipeline as ground truth):** since
`buildCityBoundaries.mjs`'s US block did no independent join — it only reshaped `buildUsCitiesData.mjs`'s
existing `us-cities-index.json`/`us-cities/*.json` output into `public/geo/city-boundaries/840/{state}.json` —
this was really validating the *reshape*, not a new geometric join. Result: byte-for-byte lossless. All 56
state files, all 32,608 features present both sides, zero geometry diffs, zero name diffs, zero features
missing a `us-cities-index.json` population/capital match. Spot-checked the 10 largest cities by real
population against known figures — all matched (New York 8.26M ... Austin 0.98M), `isCapital` correctly true
only for Phoenix/Austin among them.

**Step 5 (cut over, retire the old pipeline):** `scene/CityLabels.tsx`/`CityOutlineHighlight.tsx`/
`useCityIndex.ts`/`useCityOutline.ts` were already reading exclusively from `city-boundaries-index.json` /
`city-boundaries/{countryId}/...` for the US (the Seventh-pass generalization already covered it) — the only
remaining consumer of the old `us-cities-index.json` file was `buildCityBoundariesIndex.mjs`'s own US block,
which read it directly instead of going through the generic `addFromShardedDir()` path every other
state-sharded country already uses. Switched it to `addFromShardedDir('840')` and confirmed identical
`population`/`isCapital`/`name` output (see the centroid exception below). With that, retired: `scripts/
buildUsCitiesData.mjs`, `scripts/lib/usStateCapitals.mjs` (its only consumer), `public/geo/us-cities-index.json`,
`public/geo/us-cities/*.json` (56 files), and the now-dead US reshape block + `US_INDEX`/`US_SHARD_DIR`
constants in `buildCityBoundaries.mjs` — `public/geo/city-boundaries/840/` is a static, already-committed
artifact now, the same conceptual status as e.g. Libya's ADM1-only data; `ONLY=840` is a deliberate no-op if
`buildCityBoundaries.mjs` is ever re-run. Also dropped `build:geo:us-cities` from `package.json`/CLAUDE.md.
`scripts/vendor/canada/`, the migration plan's other named retirement target, turned out to already be gone
from the repo (never committed, or cleaned up in an earlier pass) — nothing to do there.

**Real bug found by the switch, not by inspection: `sphericalGeometry.mjs`'s `largestRing()` picked a
MultiPolygon's ring with the most VERTICES, not the most AREA — silently wrong for any country with a city
whose exclave/island fragment happens to be more heavily digitized than its own main body.** Only surfaced
because switching the US to `addFromShardedDir()` gave two independently-computed centroids for the same
32,608 real cities to diff against each other (the old US-only `cheapCentroid()` in `buildUsCitiesData.mjs` had
its own, different bug — see below — but landed correctly often enough to expose this one by disagreement).
29 US cities moved by 20km+, including major ones: Houston (36km), Dallas (36km), San Antonio (25km), Corpus
Christi (41km), San Diego (28km), Tulsa (24km). Root cause confirmed on Houston/Dallas/etc. and independently
on a non-US case (Kapingamarangi, Micronesia): its MultiPolygon carries nine real ~0.02°-wide islet rings
(4-7 vertices each, correctly clustered around 154.8°E/1.05°N) plus one degenerate zero-area 7-vertex "ring"
729km away at 155.16°E/7.62°N — enough vertices to win the old comparison outright, producing a centroid
730km from every real islet. **Fixed by comparing actual area** (`ringAreaSqKm`, already existed in the same
file for a different purpose, just never reused here) **instead of vertex count** — one function, ~10 lines,
in `largestRing()`. Re-verified Houston/Dallas/San Antonio/Corpus Christi/San Diego against real-world
city-center coordinates post-fix: all now within 4-18km, which is the expected range for a real polygon
centroid of a large, irregularly-shaped city limit (not an exact "downtown" point) rather than a symptom of a
remaining bug.

This function (`geometryCentroid()`) is shared by every country's `city-boundaries-index.json` entry (not just
US), so the fix's blast radius is project-wide: regenerating the index after the fix moved 251 non-US entries
by 20km+ (some much further — several outer-island/atoll municipalities in Micronesia, Portugal, Malaysia,
Indonesia, Russia, Chile, Australia moved 150-730km, the same "degenerate/small-but-high-vertex fragment
beat the real landmass" shape as Kapingamarangi). Not exhaustively re-verified one by one given the volume,
but the mechanism is sound (area is the objectively correct "largest part of a multi-part shape" criterion,
vertex count never was) and every case actually inspected confirmed the fix, not a regression. This only
touches the lightweight always-fetched index — none of the 193 committed `city-boundaries/{countryId}/...`
per-feature geometry files needed or got regenerated (`geometryCentroid()` is also used inside
`buildCityBoundaries.mjs` itself for shard-key/candidate-scoring decisions during the real join, so a future
`ONLY=<id>` rebuild of any country now benefits from the same fix there too, quietly, without needing its own
pass).

**One more real, independent bug in the now-retired `buildUsCitiesData.mjs`'s own `cheapCentroid()`:** for a
MultiPolygon it always averaged `geometry.coordinates[0][0]` — the first ring of the first polygon,
unconditionally, no largest-anything comparison at all. Richmond, CA (many disconnected shoreline/island
parts) and several other complex-shaped cities differed from the new centroid even where the new function's
vertex-vs-area distinction wasn't itself in play, confirming the old US-only path had its own, differently-shaped
version of the same class of bug. Not worth a standalone fix now that the file is retired — `addFromShardedDir()`
already replaces it project-wide.

**Cosmetic fix caught in the same pass:** `hud/SearchBar.tsx`'s search-dropdown state qualifier
(`"Richmond, CA"`) read `entry.stateAbbrev` verbatim, which is the lowercase shard-file-derived value
(`scene/useCityOutline.ts`'s `STATE_SHARDED_COUNTRIES` convention, e.g. `"ca"`) for every state-sharded
country — US used to get real uppercase postal codes through its own now-retired index path, so switching it
onto the shared path would have silently regressed "Richmond, CA" to "Richmond, ca" in search results. Fixed
by uppercasing at display time (`entry.stateAbbrev.toUpperCase()`) rather than changing the stored value,
since the stored lowercase value is what `shardUrl()` needs to build a working fetch path. This was already a
live (if minor, unnoticed) quirk for all 12 other state-sharded countries — e.g. Mexico showed "Aguascalientes,
ag" — not something newly introduced by the US cutover.

**A second real bug, reported directly after this pass shipped:** search results for "Houston" showed Canada's
and the UK's Houstons as bare "Houston" — indistinguishable from each other and from Houston, TX. Root cause:
`hud/SearchBar.tsx`'s `cityBoundaryEntries` only ever qualified a name with its US-style state abbreviation
(`STATE_SHARDED_COUNTRIES`); everything else got no qualifier at all, on the assumption (accurate back when
this index covered 3 countries, stale the moment it covered 193) that "every other country's city names are
already unambiguous." Neither Canada (124) nor the UK (826) is state-sharded, so both hit that bare-name path.

First fix attempt only qualified a non-sharded entry when its bare name actually collided with something else
in the index, to avoid degrading exact-match search ranking for the (large majority of) names that never
collide. **Direct follow-up feedback: always show the state/province/country, not conditionally** — replaced
the collision check with an unconditional one: every `city-boundary` entry now reads "City, ST" (state-sharded
countries) or "City, Country" (everyone else), full stop. `countryNameById` (built off the same
`useCountryFeatures()` data `countryEntries` already uses) supplies the country name. Accepted consequence:
exact-name ranking (`matches`'s exact/starts-with/contains tiers) effectively never hits the "exact" tier for
a city-boundary result any more, since the qualifier is now always appended — that's the direct cost of the
explicit "always" requirement, not an oversight. Houston now reads: "Houston, Canada", "Houston, United
Kingdom", and 7 US states' worth of "Houston, XX" — 10 total. Amman reads "Amman, Jordan"; Kuwait City reads
"Kuwait City, Kuwait". Verified directly against the built index (simulated the same lookup logic outside
React) rather than just reasoning about it. Typecheck/lint/Vitest all clean after both fixes.

**Verification:** typecheck, lint, and Vitest all clean; `city-boundaries-index.json` regenerated (218,736
entries, 193 countries, unchanged counts per country — only lat/lng values and this file's own internal
US-specific code path changed). Migration plan step 6 (write the final decision into LOGBOOK.md, once
browser-verified) is still open.

**Thirty-second pass (2026-09-22): two follow-ups from J's own browser verification pass.** First real
finding: Saint Petersburg's search result read "Saint Petersburg, SPE" — a Russian federal-subject code, not a
recognizable qualifier. Root cause: the Thirty-first pass's "always qualify" fix (above) treated every
`STATE_SHARDED_COUNTRIES` entry the same as the US, showing its region abbreviation — correct for the US
("Richmond, CA"), but every other state-sharded country (Russia, Mexico, Brazil, Peru, Argentina, France,
Germany, Italy, Spain, China, Indonesia, India) shards its data by state/province purely for file-size
reasons, not because a user would recognize the region code the way a US postal abbreviation reads. Fixed in
`hud/SearchBar.tsx`'s `cityBoundaryEntries`: the state-abbreviation qualifier now only applies when
`entry.countryId === US_COUNTRY_ID` ('840'); every other state-sharded country falls through to its country
name instead, same as a non-sharded country already did — "Saint Petersburg, Russia", not "Saint Petersburg,
SPE". Second, unrelated addition in the same session: admin-division (state/province) search results had no
qualifier at all (a bare "Amazonas" doesn't say which of Brazil/Peru/Colombia/Venezuela), unlike
city-boundary results, which already always qualify — `provinceEntries` now appends the parent country's name
(`registryEntity.parentEntity.displayName`, already stamped onto every division at registration time in
`useStatesProvincesFeatures.ts`) the same unconditional way city-boundary entries do. Typecheck/lint clean;
browser-verified by J directly (this fix was written in response to a live browser check, not caught by
inspection).

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
2. ~~Not started~~ — **done for 191 countries** (`scripts/buildCityBoundaries.mjs`,
   `npm run build:geo:city-boundaries`; see the Sixth pass for the two real bugs caught building it,
   the Eighth pass for the Central America batch + the vertex-density/simplification bug that batch
   surfaced, the Ninth pass for Canada/Mexico + the Mexico-file-size bug/state-sharding fix, the
   Tenth pass for all 12 South American UN members + the Guyana/Peru/Argentina/Uruguay
   OSM-over-geoBoundaries fixes, the Overpass-endpoint swap, and the `ONLY=` scoping flag, the
   Thirteenth pass for all 13 UN Caribbean members + the general snap-to-nearest join fallback, the
   Sixteenth pass for all 14 Southern Europe UN members + the Serbia/Belgrade `extraOsm` fix, the
   Seventeenth pass for all 9 Eastern Europe UN members + the Belarus `extraOsm` fix and Moldova's
   full OSM source swap — the first pass with a perfectly clean 0-rejected/0-unmatched run across
   every country on the first try — and the Eighteenth pass for all 13 Middle East UN members +
   real OSM source work for Israel/Lebanon/Iraq/UAE and Saudi Arabia's still-open major-cities gap).
   Real per-feature join for Jordan/Argentina (OSM `admin_level` 6 / 5|7|8), Guyana/Peru/Uruguay (OSM
   `admin_level` 6 / 8 / 8), Trinidad and Tobago (OSM `admin_level` 4), Kuwait/Costa Rica (OSM, switched off
   geoBoundaries entirely — see their own entries), El Salvador/Guatemala/Honduras/Nicaragua/Canada/Mexico/
   Bolivia/Brazil/Chile/Colombia/Ecuador/Paraguay/Suriname/Antigua and Barbuda/Bahamas/Barbados/Cuba/
   Dominica/Dominican Republic/Grenada/Haiti/Jamaica/Saint Kitts and Nevis/Saint Lucia/Saint Vincent and the
   Grenadines (geoBoundaries, each level independently verified — see the Eighth/Ninth/Tenth/Thirteenth
   passes), Panama/Venezuela/United Kingdom (geoBoundaries + a supplemental OSM layer via `extraOsm`), Ireland
   (OSM `admin_level` 6|7, on `overpass.private.coffee` rather than this file's usual endpoint — see the
   Fourteenth pass), Denmark/Estonia/Finland/Iceland/Latvia/Lithuania/Norway/Sweden (geoBoundaries, each level
   independently verified — see the Fourteenth pass, including two real wrong-level catches on Lithuania and
   Sweden's own recon-reported "finest" level), Belize (OSM, hand-curated 9-municipality name list), and
   Liechtenstein/Netherlands/Switzerland/Luxembourg/Belgium/Austria (geoBoundaries, each level independently
   verified), Monaco (a real hybrid — the capital point against ADM1's whole-country polygon, every other
   point against ADM2's quartiers), France (geoBoundaries ADM5 with its 45 Paris/Lyon/Marseille
   arrondissement-municipal fragments dropped and replaced by 3 targeted OSM whole-city polygons), and Germany
   (OSM `admin_level` 6|8 per-Bundesland/Regierungsbezirke — 6 needed alongside 8 specifically to catch
   kreisfreie Städte, missed entirely by an `8`-only first attempt — see the Fifteenth pass for all of Western
   Europe's findings), and Albania/Andorra/Bosnia and Herzegovina/Croatia/Greece/Italy/Malta/Montenegro/North
   Macedonia/Portugal/San Marino/Slovenia/Spain (geoBoundaries, each level independently verified; Italy and
   Spain both sharded by state — see the Sixteenth pass) and Serbia (geoBoundaries plus a supplemental OSM
   `admin_level=9` layer scoped to Belgrade's own area — see the Sixteenth pass), and Bulgaria/Czechia/
   Hungary/Poland/Slovakia/Romania/Ukraine (geoBoundaries, each level independently verified — see the
   Seventeenth pass, including the Czechia/Hungary/Slovakia garbled-`shapeName` finding and Romania's
   mislabeled-but-confirmed-correct `canonicalName`) and Belarus (geoBoundaries plus a supplemental OSM
   `admin_level=8` layer of village/settlement councils — see the Seventeenth pass) and Moldova (OSM,
   switched off geoBoundaries entirely — see the Seventeenth pass), and Cyprus/Syria/Turkey/Bahrain/Oman/
   Qatar/Yemen (geoBoundaries, each level independently verified — see the Eighteenth pass, including
   Iran's confirmed-genuine `?`-garbled `shapeName`s) and Iraq/Saudi Arabia (geoBoundaries plus a
   supplemental OSM layer — Iraq's real nahiya tier closed most of its gap, Saudi Arabia's own
   `admin_level=6` supplement is the same coarse tier under a different name and leaves most of its major
   cities, including the capital, still unmatched by any checked source) and Israel/Lebanon/United Arab
   Emirates (OSM primary or full swap — Lebanon backstopped by geoBoundaries' own coarser ADM2 where OSM
   has a real gap), and Armenia/Georgia (geoBoundaries, no supplement needed) and Azerbaijan (geoBoundaries,
   small residual not chased) and Uzbekistan/Kazakhstan/Tajikistan (geoBoundaries plus a supplemental OSM
   layer, Kazakhstan's the largest fix in this file's history — 8% to 49% kept — and still the largest
   remaining residual) and Kyrgyzstan/Turkmenistan (OSM, switched off geoBoundaries entirely after a
   Latin-script name-search bug briefly made both capitals look like a real data gap — see the Nineteenth
   pass), and Afghanistan/Pakistan/Nepal (geoBoundaries, each level independently verified — see the
   Twentieth pass) and Bangladesh/Sri Lanka (geoBoundaries, but overriding recon's own reported "finest"
   level after a real canonicalName-vs-reality mismatch — both actually resolve to ward/GND-scale polygons at
   the recon-suggested level, one level too fine, the same trap Lithuania/Sweden's recon hit — see the
   Twentieth pass) and Bhutan (geoBoundaries, which already covers Phuentsholing as its own ADM2 unit, plus a
   single supplemental OSM `admin_level=5` Thromde polygon for the capital, Thimphu, which ADM2 doesn't cover
   — see the Twentieth pass) and Maldives (OSM, switched off geoBoundaries entirely — the
   first country whose OSM candidates are sourced from `way` elements via a new `wayToGeometry` helper rather
   than `relation`-only `boundary=administrative` queries — see the Twentieth pass) and Japan (geoBoundaries,
   overriding recon's own reported "Subprefectures" canonicalName — a real Hokkaido-only regional tier, not
   the 1,742-unit real municipality layer actually in the file — see the Twenty-first pass) and Mongolia/North
   Korea (geoBoundaries, each level independently verified, no supplement needed or available — see the
   Twenty-first pass) and South Korea (geoBoundaries, overriding recon's own reported "submunicipalities"
   level after the same canonicalName-vs-reality mismatch as Bangladesh/Sri Lanka, plus a single supplemental
   OSM `admin_level=6` polygon for Yeonggwang County, entirely missing from the geoBoundaries download — see
   the Twenty-first pass) and China (geoBoundaries ADM3, independently verified against 7 major cities, sharded
   by province via `iso_3166_2` after catching a real chained `postal`-field mislabeling bug across 4
   provinces — see the Twenty-first pass) and Brunei/Indonesia/Laos/Singapore/Thailand/Vietnam (geoBoundaries,
   each level independently verified — see the Twenty-second pass) and Cambodia (geoBoundaries, overriding
   recon's own reported "finest" level — a real commune/sangkat-scale mismatch, the same trap Bangladesh/Sri
   Lanka/South Korea's recon hit — see the Twenty-second pass) and Malaysia (geoBoundaries ADM3, the rare case
   where recon's suggested finest level was the CORRECT city-plausible pick, plus a supplemental ADM2 layer for
   Sabah/Sarawak, where the ADM3 "Mukim" tier barely reaches at all — see the Twenty-second pass) and Myanmar
   (geoBoundaries ADM3, confirmed finer and more consistent than the coarser ADM2 — see the Twenty-second pass)
   and Philippines (geoBoundaries ADM3 with Manila's own internal-district fragments dropped, identified
   geometrically rather than by name, and replaced with a single whole-city OSM polygon — the France
   Paris/Lyon/Marseille shape at a smaller scale — see the Twenty-second pass) and Australia/Kiribati/Marshall
   Islands/Micronesia/Nauru/Samoa (geoBoundaries, each level independently verified — see the Twenty-third
   pass) and Fiji (geoBoundaries, overriding recon's own "Enumeration Areas" reported finest level for the real
   ADM3 "Tikina" tier) and Tuvalu/Vanuatu (geoBoundaries ADM2, overriding recon's own area-heuristic pick of
   ADM3, which turned out to be bare numeric census-grid shapeNames with no real names at all — the opposite
   override direction from every other country in this file) and Papua New Guinea (geoBoundaries ADM3,
   confirmed finer and more consistent than the coarser ADM2) and Tonga (geoBoundaries ADM2, matching recon)
   and Solomon Islands (geoBoundaries ADM2 plus a single supplemental ADM1 candidate for Honiara, entirely
   missing from ADM2) and New Zealand (geoBoundaries ADM2; Auckland's own internal-fragment issue investigated
   and deliberately left as-is, since the only whole-city OSM alternative is an even-less-plausible 16,153 km²)
   and Palau (geoBoundaries ADM2 with Koror's own internal-hamlet fragments dropped and replaced with the whole
   ADM1 Koror state, a real fix caught only once the actual join ran, not by the initial coordinate check — see
   the Twenty-third pass) and Algeria/Egypt/Morocco/Sudan (geoBoundaries, each level independently verified,
   the finest available for Morocco/Sudan specifically per a fresh live OSM check — see the Twenty-fourth pass)
   and Tunisia (geoBoundaries, overriding recon's own "imada" reported finest level for the coarser real
   "delegation" tier) and Libya (geoBoundaries ADM1, the only level that exists for LBY — its own baladiyat,
   confirmed the finest tier anywhere back in the Fourth pass) and South Sudan (geoBoundaries ADM2 plus a
   supplemental Juba-neighborhood OSM layer from that same Fourth pass — measured zero actual benefit in this
   run, a real coordinate-gap finding logged rather than silently assumed to help — see the Twenty-fourth
   pass) and Benin/Cabo Verde/Côte d'Ivoire/Ghana/Guinea/Guinea-Bissau/Liberia/Mali/Mauritania/Niger/Nigeria/
   Senegal/Togo (geoBoundaries, each level independently verified — see the Twenty-fifth pass) and
   Gambia/Sierra Leone (geoBoundaries, overriding recon's own reported finest level for a coarser real tier —
   the same "recon's area heuristic picked something one level too fine" trap this file keeps re-finding) and
   Burkina Faso (geoBoundaries ADM2, after a real shapeName/geometry MISALIGNMENT bug at ADM3 — not a blank or
   garbled name like prior findings, but the "Ouagadougou"/"Bobo-dioulasso" features' own polygons sitting
   150+ km from the real cities of those names — see the Twenty-fifth pass) and Cameroon/Chad/Equatorial
   Guinea/Gabon/São Tomé and Príncipe (geoBoundaries, each level independently verified — see the Twenty-sixth
   pass) and Central African Republic (geoBoundaries ADM3, overriding recon's own "quartiers" reported finest
   level, which only covers Bangui at all) and Congo (geoBoundaries ADM1 after a second, more severe instance
   of Burkina Faso's own shapeName/geometry misalignment bug at ADM2 — confirmed across 3+ features, not a
   two-feature patch — plus a single supplemental OSM commune for Brazzaville itself, otherwise rejected as
   too large even at the correct ADM1 department) and DR Congo (geoBoundaries ADM2 plus a supplemental OSM
   commune layer for Kinshasa, without which the capital — 16,000,000 population, one of the largest cities on
   Earth — would have been silently dropped entirely — see the Twenty-sixth pass) and
   Comoros/Djibouti/Eritrea/Ethiopia/Mauritius/Mozambique/Seychelles/Somalia/Tanzania/Uganda/Zambia/Zimbabwe
   (geoBoundaries, each level independently verified — see the Twenty-seventh pass) and
   Burundi/Kenya/Madagascar/Rwanda (geoBoundaries, overriding recon's own reported finest level for a coarser
   real tier — recon's area heuristic picked something one level too fine in each case) and Malawi
   (geoBoundaries ADM2, after recon's own ADM3 pick turned out to be the wrong administrative concept for a
   city with uneven coverage — Malawi's cities are legally separate from the rural Traditional Authority
   structure this level represents; Lilongwe itself stays a real, confirmed gap even at ADM2, no finer source
   found anywhere) and Angola/Eswatini/Lesotho (geoBoundaries, each level independently verified — see the
   Twenty-eighth pass) and South Africa (geoBoundaries ADM3, not recon's own ADM4 "Ward" pick — a real,
   pervasive residual from South Africa's own post-1994 municipal consolidation, the largest substantial-
   reject count of any single country in this project) and Botswana (geoBoundaries ADM2, the finest tier
   confirmed to exist anywhere back in the Fourth pass) and Namibia (geoBoundaries ADM2 with 3 confirmed
   shapeName/geometry-misaligned features dropped — a fourth instance of the Twenty-fifth/Twenty-sixth passes'
   own misalignment bug — see the Twenty-eighth pass) against the already-shipped
   GeoNames city index; US reused `buildUsCitiesData.mjs`'s
   existing Census output directly, reshaped in place, still sharded by state. Output in
   `public/geo/city-boundaries/` (Mexico, Brazil, Peru, Argentina, France, Germany, Italy, Spain, China,
   Indonesia, and India all sharded by state/province/department — see `shardByState()`).
   **India was done in its own dedicated pass (Twenty-ninth, 2026-09-19, geoBoundaries ADM3 with Delhi/
   Hyderabad whole-city OSM fixes, sharded by state).** **Russia was done in its own dedicated pass
   (Thirtieth, 2026-09-19, geoBoundaries ADM2 plus OSM whole-city relations for Moscow/Saint Petersburg/
   Zelenograd and OSM district tiers for the first two, sharded by federal subject) — with that, all 193 UN
   members have city-boundary data.**
   **The join now has a general "snap to nearest candidate within a small radius" fallback**
   (`joinCityPointsToPolygons`'s `SNAP_MAX_KM`, built in the Thirteenth pass) for the exact shape the
   Eleventh/Twelfth passes' Al Funayţīs/Canoas findings called out as needing one — a real polygon exists,
   just not quite containing the point. Re-run against every country with a logged residual: Kuwait, Costa
   Rica, Panama, Canada, and Colombia all dropped to 0 unmatched; Honduras dropped from 11 to 5 (real
   remaining coastal/island gaps plus one confirmed GeoNames country-tag error); Venezuela correctly stayed
   at 2 (confirmed nothing within the 2km radius, so the fallback didn't force a wrong match). See the
   Thirteenth pass's own table for the full before/after and what each snap actually matched to. Total
   residual unmatched across all 47 done countries: 20 (Honduras 5, Venezuela 2 from before this pass, plus
   Denmark 1, Finland 1, Sweden 9, United Kingdom 2 from the Fourteenth pass — see that pass for what each of
   the new ones actually is) — real, structural residuals now, not further-fixable by this mechanism. Also
   not done: further tuning
   Mexico's largest state shards (Veracruz's 11.9MB is still well above the US precedent — see the Ninth
   pass).
3. ~~Generalize `UsCityLabels.tsx`/`UsCityOutlineHighlight.tsx`/
   `useUsCityOutline.ts` into source-agnostic `CityLabels.tsx`/
   `CityOutlineHighlight.tsx`/`useCityOutline.ts`.~~ — **done** (Seventh pass), and confirmed to need
   zero further changes when 7 more countries were added in the Eighth pass — the generalization
   held.
4. ~~Validate the new pipeline's US output against the existing Census data
   as ground truth (does it find the same major cities, comparable
   population figures, reasonable boundary shapes) before cutover.~~ —
   **done** (Thirty-first pass, 2026-09-21): byte-for-byte lossless, since
   the US path was always a reshape of the same Census data, not an
   independent join.
5. ~~Cut over, then retire `buildUsCitiesData.mjs`, `us-cities-index.json`,
   `us-cities/*.json`, and `scripts/vendor/canada/` (already dead weight —
   never going to be used now).~~ — **done** (Thirty-first pass,
   2026-09-21). `scripts/vendor/canada/` was already gone from the repo by
   the time this ran. Also surfaced and fixed a real project-wide centroid
   bug (`largestRing()` picking by vertex count instead of area) along the
   way — see that pass's own entry.
6. ~~Write the final decision + trade-off into `LOGBOOK.md` once built and
   verified in-browser, per this project's existing discipline for sourced
   data decisions.~~ — **done** (2026-09-22, see LOGBOOK.md's own entry).
   J's browser check (Saint Petersburg/Moscow/Zelenograd outlines, Houston
   search disambiguation, corrected US label positions) surfaced the
   Thirty-second pass's two search-qualifier fixes above; everything else
   confirmed good. The campaign is closed.

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
  scoped to the 100 countries with real boundary data committed so far (Seventh/Eighth/Ninth/Tenth/
  Thirteenth/Fourteenth/Fifteenth/Sixteenth/Seventeenth/Eighteenth/Nineteenth passes), not this 193-country GeoNames index. Wiring the label/reveal layer up to
  this file for the other 93 countries (once each has its own verified
  boundary source) is still open — this only produces the two-tier data
  shape a future pass would consume.
- ~~Attribution UI still genuinely unresolved~~ — **built and mounted**,
  see above.
