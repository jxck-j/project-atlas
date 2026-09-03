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

**Resolution — re-ran the OSM check for Kuwait properly:** geoBoundaries'
Kuwait layer citing OpenStreetMap as its source (rather than a separate
survey) was the tell that the earlier "Kuwait City has no OSM boundary"
finding was wrong — a technique problem, not a data gap. Kuwait's 137
district relations exist directly in OSM; a plain Nominatim
name-text-search for "Kuwait City" just never surfaces them, since none of
them are literally named that. Re-verified the same technique gap doesn't
apply to the US spot-check cities (those resolve fine by name), confirming
OSM's real US city-boundary coverage (commonly itself Census-TIGER-derived
on import) reaches genuine city level, not just counties.

## Final source decision

**OpenStreetMap/Overture, queried by area-containment (e.g. Overpass
`admin_level=8` within a country boundary), not by name-text search.**
Name search under-reports real coverage — this is the same lesson already
logged in `infrastructure-layers.md`'s military-bases section (a
`military=*`-only tag filter missed Ali Al Salem/Muwaffaq Salti because
they're tagged `aeroway=aerodrome`) — a second, independent case of "query
by what's actually there, not by what you expect the record to be named or
tagged as."

**geoBoundaries stays as a documented fallback**, not the primary source —
worth reaching for on a specific country if the real build script turns up
sparse OSM boundary coverage there, not something to architect around
preemptively.

## Migration plan

1. Build the global point/population index (GeoNames-sourced), replacing
   `cities.json`'s 223-entry curated list with full global coverage.
2. Build the OSM/Overture boundary extraction (`admin_level`-based,
   area-contained, unioned across the relevant boundary/place tags per the
   technique lesson above), producing the same per-city lazy-fetch file
   shape `us-cities/*.json` already established.
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

- GeoNames data-quality spot check not yet done (only reasoned about, not
  verified the way the boundary sources were).
- Attribution requirements for ODbL-licensed OSM-derived boundaries (most
  countries' finest-level data, per the Kuwait finding above) not yet
  checked against how this app currently handles/displays data attribution
  — needs resolving before shipping, not before this doc.
- Exact query technique (which tag/level union per country) still needs
  real design once the build script is written — the Jordan/Kuwait checks
  here prove the approach works, not the final query shape.
- Whether every country reaches genuine city-level granularity the way
  Jordan/Kuwait/the US spot checks did, or whether some countries land at
  a coarser level (the way Jordan's ADM2 is districts within a governorate,
  not neighborhoods), is unverified beyond the countries checked here.
