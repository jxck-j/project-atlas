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

## Migration plan

1. Build the global point/population index (GeoNames-sourced), replacing
   `cities.json`'s 223-entry curated list with full global coverage.
2. Build the boundary extraction: geoBoundaries' finest available ADM
   level per country by default, falling back to a direct, area-contained
   OSM query only where geoBoundaries doesn't reach city-level granularity
   (the US today) or has no coverage for that country at all — producing
   the same per-city lazy-fetch file shape `us-cities/*.json` already
   established.
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
  ODbL-and-mixed-licensed boundaries both do. No attribution UI exists
  anywhere in `src/hud/` today (checked — `IntelligencePanel.tsx`'s
  per-component source citations are a different thing, individual
  data-point sourcing in the drilldowns, not a basemap/dataset credit).
  Needs a real UI decision (placement, styling) before this ships — not
  resolved here, just confirmed real and scoped.
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
