# Vendored source data

Unlike `world-atlas` (an npm dependency), the files in this directory have no
package to vendor them for us — they're fetched by hand from public sources
and committed directly, the same "read from disk, no network access at build
time" discipline the rest of `scripts/build*.mjs` already relies on.

## `ne_10m_admin_1_states_provinces.geojson`

- **Source:** Natural Earth 1:10m Cultural Vectors, "Admin 1 – States,
  Provinces" layer, via the `nvkelso/natural-earth-vector` GitHub mirror's
  pre-converted GeoJSON export.
- **Fetched:** 2026-08-15 (upgraded from the 1:50m resolution of the same
  layer, fetched 2026-07-22 — see `CHANGELOG.md`/`LOGBOOK.md` for the
  upgrade).
- **License:** Public domain (Natural Earth places no restrictions on use).
- **Size:** ~40 MB uncompressed, 4,596 raw features across 251 distinct
  `adm0_a3` values — committed as-is rather than gitignored; under GitHub's
  50 MB per-file warning threshold.
- **Coverage caveat:** `scripts/buildStatesProvincesTopology.mjs` keeps only
  features whose `adm0_a3` resolves to a `scripts/lib/iso3166.mjs` numeric
  country id (4,539 of 4,596 kept). All 193 UN member states get coverage
  (some via `SDS`, a non-standard alias this dataset uses for South Sudan
  instead of the canonical `SSD` — see that file's own comment), plus 42
  more ISO-coded non-UN territories/dependencies that happen to already
  have a numeric ISO code (Taiwan, Hong Kong, Puerto Rico, Greenland,
  Antarctica, ...) even though those don't resolve against
  `CountryRegistry` (UN members only). The 57 skipped features have no ISO
  country code at all — Kosovo (30), Western Sahara, Somaliland, Northern
  Cyprus, the Gaza Strip/West Bank, the Spratly Islands, Guantanamo Bay,
  Baikonur, the Siachen Glacier, the two Cyprus Sovereign Base Areas, and a
  handful of uninhabited dependencies (Åland, Clipperton Island, Ashmore
  and Cartier Islands, Coral Sea Islands, the Indian Ocean Territories) —
  see `BACKLOG.md`'s "Geographic coverage" section for the full list and
  the open question of whether any should route into `GeoEntity` instead.

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

## `military/sipri-milex.xlsx`, `military/sipri-top100.xlsx`

- **Source:** SIPRI Military Expenditure Database (`sipri.org/databases/milex`)
  and SIPRI Top 100 Arms-Producing Companies Database
  (`sipri.org/databases/armsindustry`) — both direct, no-login Excel
  downloads.
- **Fetched:** 2026-08-19/20 (milex `v1.2`, revised 2026-04-27; top-100
  covers 2002–2024).
- **License:** SIPRI makes both databases freely available for public,
  non-commercial use; see `sipri.org/about/terms-and-conditions`.
- **Used by:** `scripts/buildMilitary.mjs` — expenditure (`Current US$`
  sheet, most recent year with a real value per country) and
  defense-industrial base (sum of `Arms revenues (2024)` grouped by HQ
  `Country`, true-zero for every country absent from the Top 100).
  `scripts/buildMilitary.mjs` also pulls a third SIPRI dataset (arms-import
  TIV) live at build time rather than from a vendored file here — see that
  script's own header comment for why (its documented CSV-export API is
  decommissioned; the live portal's real backend had to be reverse-engineered
  instead of vendored, since it requires a per-run POST query rather than a
  static downloadable file).
- **Not re-downloaded automatically:** `buildMilitary.mjs` only fetches these
  if the local file is missing — delete the file under `military/` to force
  a refresh against whatever SIPRI is currently serving.

## `ucdp/ucdp-prio-acd-261-csv.zip`, `ucdp/GEDEvent_v26_01_26_06.csv`, `ucdp/GEDEvent_v26_0_7.csv`

- **Source:** the UCDP/PRIO Armed Conflict Dataset v26.1 (annual, 1946-2025) and two UCDP Candidate Events
  Dataset releases (Jan-Jun 2026 combined, July 2026 individual) — all three direct, no-login downloads from
  `ucdp.uu.se/downloads/`. The UCDP API (`ucdpapi.pcr.uu.se`) was checked first and requires a free but
  manually-issued access token (email request to UCDP's API maintainer, not self-service) — these direct file
  downloads need neither a token nor an account, so `scripts/buildCurrentStatus.mjs` uses them instead.
- **Fetched:** 2026-08-23/24.
- **License:** UCDP data is free to use for research/non-commercial purposes with attribution; see
  `ucdp.uu.se/downloads/` for its terms.
- **Used by:** `scripts/buildCurrentStatus.mjs` — the annual dataset is the only UCDP product that classifies
  a conflict's `type_of_conflict`; the Candidate releases fill the gap for 2026 activity the annual release
  hasn't caught up to yet. See that script's own header comment and `LOGBOOK.md`'s 2026-08-26 entry for the
  full matching logic between the two.
- **Not re-downloaded automatically, and goes stale on its own schedule:** the annual dataset updates roughly
  yearly; the Candidate dataset updates monthly. Re-running the build script against a newer release means
  bumping the version/URL constants at the top of `scripts/buildCurrentStatus.mjs` and deleting the
  now-superseded vendored file(s) here to force a re-download — the script won't detect a newer release on
  its own.

## `gleditsch-ward/iisystem.dat`, `gleditsch-ward/microstatessystem.dat`

- **Source:** Kristian Skrede Gleditsch's own site (`ksgleditsch.com/data/`) — the originating academic
  maintainer of the Gleditsch-Ward (GW) state-system country code list UCDP's own datasets key every country
  reference to, not a third-party mirror.
- **Fetched:** 2026-08-23.
- **License:** publicly posted for research use; no login or registration required.
- **Used by:** `scripts/buildCurrentStatus.mjs`, via `scripts/lib/gleditschWard.mjs` — bridges UCDP's
  `gwno_loc`/`country_id` numeric codes back to this project's UN-193 topology names. See that lib module's
  own header comment for the source files' Windows-1252 encoding quirk and the alias table it required.

## `unsd/unsd-ethnic-tablecode26.zip`, `unsd/unsd-religion-tablecode28.zip`

- **Source:** the UN Statistics Division's Demographic Statistics Database (`data.un.org`/UNdata), tableCode 26
  ("Population by national and/or ethnic group...") and tableCode 28 ("Population by religion..."). No
  documented bulk API exists, but UNdata's own "Export" button hits a real, unauthenticated, CORS-open
  zipped-CSV endpoint (`UNSD_DOWNLOAD_BASE` in `scripts/buildCurrentStatus.mjs`) — the same "found a legitimate
  direct path around a gated/undocumented UI" precedent as the SIPRI TIV endpoint above.
- **Fetched:** 2026-08-26.
- **License:** UN Statistics Division data is freely available for public use with attribution; see
  `data.un.org` for its terms.
- **Used by:** `scripts/buildCurrentStatus.mjs` — ethnicity's primary source, and religion's fallback for any
  country ARDA has no profile for (see the `arda/` entry below for religion's own primary source). See that
  script's own DEMOGRAPHICS header comment and `LOGBOOK.md` for the full ingestion/quality-gate logic.
- **Not re-downloaded automatically:** delete the zip under `unsd/` to force a re-fetch against whatever UNSD
  is currently serving.

## `arda/_country-list.html`, `arda/profiles/*.html`

- **Source:** ARDA (`thearda.com/world-religion/national-profiles`) — Brill's World Religion Database, an
  academic compilation (not a national census), scraped per-country from each profile page's own "Religious
  Adherents" table (`arda/profiles/{code}.html`, one per ARDA country/region code) plus the full country/region
  `<select>` list (`_country-list.html`, fetched once with no `u` query param, used to build the name→code
  map).
- **Fetched:** 2026-08-27, WRD edition 2025 (the edition year shown in each page's own table heading, not a
  fetch date — see `religionsSnapshotDate` in `src/data/currentStatus.ts`).
- **License:** ARDA publishes these profiles for public research/reference use; see thearda.com's own terms.
- **Used by:** `scripts/buildCurrentStatus.mjs` — religion's primary source (194/194 countries resolved in the
  real run), ahead of UNSD/Factbook. See that script's own DEMOGRAPHICS header comment for the category-
  granularity rules (Christianity expanded into sub-denominations, every other religion top-level-only) and
  `LOGBOOK.md`'s 2026-08-27 entries for the real cases (Sudan, South Korea) this was verified against,
  including a real "double affiliation" data characteristic (totals legitimately exceeding 100% for ~30
  countries) that `hud/SegmentedBar.tsx` has to render around.
- **Not re-downloaded automatically, and goes stale on its own schedule:** ARDA republishes a new WRD edition
  roughly annually. Delete `arda/_country-list.html` and/or specific files under `arda/profiles/` to force a
  re-fetch against whatever ARDA is currently serving.

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
