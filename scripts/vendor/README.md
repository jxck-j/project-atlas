# Vendored source data

Unlike `world-atlas` (an npm dependency), the files in this directory have no
package to vendor them for us — they're fetched by hand from public sources
and committed directly, the same "read from disk, no network access at build
time" discipline the rest of `scripts/build*.mjs` already relies on.

## `ne_50m_admin_1_states_provinces.geojson`

- **Source:** Natural Earth 1:50m Cultural Vectors, "Admin 1 – States,
  Provinces" layer, via the `nvkelso/natural-earth-vector` GitHub mirror's
  pre-converted GeoJSON export.
- **Fetched:** 2026-07-22.
- **License:** Public domain (Natural Earth places no restrictions on use).
- **Coverage caveat:** at 1:50m scale, Natural Earth only ships first-level
  administrative boundaries for 9 large countries with complex internal
  geography (Australia, Brazil, Canada, China, India, Indonesia, Russia,
  South Africa, United States) — 294 features total. This is a deliberate
  pilot-scope choice (see `scripts/buildStatesProvincesTopology.mjs`), not a
  bug: the 1:10m resolution of this same layer covers all countries
  (~4,600 features) but is a much larger file (~40 MB uncompressed).
  Swapping this vendored file for the 10m version and re-running
  `npm run build:geo:states` is the upgrade path once broader coverage is
  wanted — no pipeline redesign required.

## `ne_50m_populated_places.geojson`

- **Source:** Natural Earth 1:50m Cultural Vectors, "Populated Places"
  layer, via the same `nvkelso/natural-earth-vector` GitHub mirror.
- **Fetched:** 2026-07-22.
- **License:** Public domain.
- **Coverage caveat:** `scripts/buildCitiesData.mjs` keeps only national
  capitals (`ADM0CAP === 1`) and major global cities (`WORLDCITY === 1`),
  and only those whose country resolves to one of the 193 registered UN
  members (see that script) — 229 features. Two UN members (South Sudan,
  Nauru) have no capital flagged in this dataset at 50m resolution, and
  five non-UN capitals present in the source (Vatican City, Kosovo,
  Bermuda, Somaliland, Taiwan) are excluded rather than left with a
  dangling parent-country reference. Point data needs no topojson
  simplification — this is the one build script in `scripts/` that doesn't
  go through `scripts/lib/topologyPipeline.mjs`.

## `ne_50m_lakes.geojson`

- **Source:** Natural Earth 1:50m Physical Vectors, "Lakes" layer, via the
  same `nvkelso/natural-earth-vector` GitHub mirror.
- **Fetched:** 2026-08-08.
- **License:** Public domain.
- **Coverage caveat:** none applied — `scripts/buildLakesTopology.mjs` keeps
  all 412 source features. Decorative-only layer (see that script's header
  comment): no id-stamping, no `GeoEntityRegistry` entry, no `GeometryMap`
  registration — lakes are physical geography, not political entities.

## `ne_50m_rivers_lake_centerlines.geojson`

- **Source:** Natural Earth 1:50m Physical Vectors, "Rivers + lake
  centerlines" layer, via the same `nvkelso/natural-earth-vector` GitHub
  mirror.
- **Fetched:** 2026-08-08.
- **License:** Public domain.
- **Coverage caveat:** `scripts/buildRiversTopology.mjs` keeps only
  `scalerank <= 3` (major rivers) — 116 of the source's 462 features, a
  deliberate pilot-scope choice mirroring the states/provinces and cities
  precedents above. Raising that constant (up to 6, for full coverage) is
  the upgrade path later, no pipeline redesign required. Decorative-only,
  same reasoning as lakes above.

## `canada/lcsd000b21a_e.{shp,shx,dbf,prj,xml}` — NOT committed

- **Source:** Statistics Canada 2021 Census Subdivision (CSD) cartographic
  boundary file — the Canadian equivalent of the US Census "Places" layer
  `scripts/vendor/census/` already vendors (see `buildUsCitiesData.mjs`'s own
  header comment). Direct, no-login download:
  `https://www12.statcan.gc.ca/census-recensement/2021/geo/sip-pis/boundary-limites/files-fichiers/lcsd000b21a_e.zip`
- **Fetched:** 2026-08-27.
- **License:** Statistics Canada data is available under the Open Government
  Licence – Canada (free reuse with attribution); see
  `www.statcan.gc.ca/en/reference/licence`.
- **NOT committed, unlike every other source in this file** — the shapefile
  unzips to ~300MB, far past GitHub's 50MB per-file threshold every other
  vendored source here respects (the US Census place file, at ~45MB total
  across its four parts, is the closest comparison and stays under it).
  `scripts/vendor/canada/` is gitignored; fetch the zip above by hand,
  unzip it into `scripts/vendor/canada/lcsd000b21a_e/`, and run `npm run
  build:geo:canada-cities` — only that script's processed output
  (`public/geo/canada-cities/`) is committed.
- **Coordinate system caveat:** ships in "NAD83 / Statistics Canada Lambert"
  (a projected CRS, meters), not geographic lat/lng like every other source
  in this file — confirmed via the shapefile's own `.prj` sidecar.
  `buildCanadaCitiesData.mjs` reprojects every ring with `proj4` (added as a
  devDependency for this) before anything downstream touches the
  coordinates. No other vendored source here has needed this.
- **Coverage caveat:** excludes CSDs typed `'NO'`/`'SNO'` (Statistics
  Canada's own "Unorganized"/"Subdivision of Unorganized" statistical
  catch-all for land not part of a real named municipality, confirmed
  against StatCan's own CSD type dictionary) — these aren't settlements, and
  also happen to be the dataset's biggest outliers by raw size (three of
  them in Nunavut alone accounted for ~99% of that province's unsimplified
  shard weight). 4,931 of 5,161 source CSDs kept.

## `canada/population-98100002.zip` — Population by CSD

- **Source:** Statistics Canada Table 98-10-0002-01 ("Population and
  dwelling counts: Canada, provinces and territories, census subdivisions"),
  fetched via the StatCan Web Data Service (WDS) API's
  `getFullTableDownloadCSV` endpoint rather than the interactive table
  browser — a direct, no-login CSV export, the same "found direct path"
  pattern `buildMilitary.mjs`'s SIPRI TIV endpoint and `buildCurrentStatus.mjs`'s
  UNSD zipped-CSV export already use elsewhere in this project.
- **Fetched:** 2026-08-27.
- **License:** Open Government Licence – Canada, same as the boundary file
  above.
- **Committed** (unlike the boundary file above) — the CSV is ~550KB
  zipped, well within every other vendored source's size norm here.
- **Join key:** the table's `DGUID` column is directly comparable to the
  boundary shapefile's own `DGUID` property for a CSD-level row (both are
  `"2021A0005"` + `CSDUID`) — no name-matching pass needed, unlike
  `buildUsCitiesData.mjs`'s hand-curated state-capital list. The table mixes
  every geography level (Canada, provinces, census divisions, CSDs) in one
  file; `buildCanadaCitiesData.mjs` filters to CSD-level rows by DGUID
  schema-type prefix before joining.
