// Build-time asset generator: first-level administrative divisions
// (states/provinces), simplified from a vendored Natural Earth 1:50m
// GeoJSON (see scripts/vendor/README.md for provenance) rather than
// world-atlas's countries-10m.json — this dataset has no equivalent inside
// the world-atlas npm package, which only wraps Natural Earth's admin-0
// (country) layer. Run with `npm run build:geo:states` (or
// `npm run build:geo`, which now runs every build:geo:* script in
// sequence) whenever the vendored source file changes.
//
// Deliberately partial coverage: at 1:50m scale, Natural Earth only ships
// admin-1 boundaries for 9 large, geographically complex countries
// (Australia, Brazil, Canada, China, India, Indonesia, Russia, South
// Africa, United States) — 294 features. This is the first Tier-1 layer of
// the geo-data-engine roadmap's Phase 2 pilot: proving the
// build-script -> registry -> GeometryMap -> Layer Engine chain generalizes
// past countries/GeoEntities, not shipping exhaustive worldwide coverage.
// Swapping in the 1:10m version of the same Natural Earth layer (~4,600
// features globally, ~40MB uncompressed) is the upgrade path later — same
// script, same pipeline, just a bigger vendored source file.
import fs from 'node:fs'
import { ALPHA3_TO_NUMERIC } from './lib/iso3166.mjs'
import { readSourceFeatures, buildSimplifiedTopology, writeTopologyOutput } from './lib/topologyPipeline.mjs'

const SOURCE = 'scripts/vendor/ne_50m_admin_1_states_provinces.geojson'
const OUTPUT = 'public/geo/states-provinces.json'

// Much smaller/simpler shapes than country coastlines at this same
// resolution already provide (admin-1 boundaries are mostly straight lines
// through land, not detailed coastline) — no reason for a different
// aggressiveness than the other two layers use.
const SIMPLIFY_QUANTILE = 0.35

const rawFeatures = readSourceFeatures(SOURCE)

const kept = rawFeatures.map((f) => {
  // Stable id: the province's own ISO 3166-2 code (e.g. "AU-WA"), lowercased
  // to match this codebase's slug convention elsewhere (see GeoEntity.id's
  // doc comment in data/types.ts). Stamped directly onto the feature as its
  // topology id, the same "no numeric id in the source, so stamp the target
  // registry id before rebuilding" move buildEntityTopology.mjs already
  // makes for its 11 id-less entities — geometryId and entityId are
  // therefore always the same string for this layer, same as those 11.
  const id = f.properties.iso_3166_2.toLowerCase()

  const parentCountryId = ALPHA3_TO_NUMERIC[f.properties.adm0_a3]
  if (!parentCountryId) {
    throw new Error(
      `[buildStatesProvincesTopology] no numeric country id for adm0_a3 "${f.properties.adm0_a3}" ` +
        `(province "${f.properties.name}") — add it to scripts/lib/iso3166.mjs.`
    )
  }

  return {
    ...f,
    id,
    properties: {
      name: f.properties.name,
      parentCountryId,
      parentCountryName: f.properties.admin,
    },
  }
})

const seen = new Set()
for (const f of kept) {
  if (seen.has(f.id)) {
    throw new Error(`[buildStatesProvincesTopology] duplicate province id "${f.id}" after stamping.`)
  }
  seen.add(f.id)
}
console.log(`Matched all ${kept.length} state/province geometries.`)

// Rebuild a fresh topology from just the kept features, same reasoning as
// buildCountryTopology.mjs/buildEntityTopology.mjs.
const quantized = buildSimplifiedTopology('provinces', kept, SIMPLIFY_QUANTILE)

const afterKB = writeTopologyOutput(OUTPUT, quantized)

const beforeKB = fs.statSync(SOURCE).size / 1024
console.log(`Wrote ${OUTPUT}`)
console.log(`Source (uncompressed): ${beforeKB.toFixed(0)} KB`)
console.log(`Output (${kept.length} features, simplified): ${afterKB.toFixed(1)} KB`)
