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
