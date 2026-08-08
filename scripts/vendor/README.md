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
