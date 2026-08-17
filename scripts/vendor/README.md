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
