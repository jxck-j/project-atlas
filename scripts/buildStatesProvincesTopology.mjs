// Build-time asset generator: first-level administrative divisions
// (states/provinces), simplified from a vendored Natural Earth GeoJSON
// (see scripts/vendor/README.md for provenance) rather than world-atlas's
// countries-10m.json — this dataset has no equivalent inside the
// world-atlas npm package, which only wraps Natural Earth's admin-0
// (country) layer. Run with `npm run build:geo:states` (or
// `npm run build:geo`, which now runs every build:geo:* script in
// sequence) whenever the vendored source file changes.
//
// Upgraded from the 1:50m resolution (294 features, 9 large countries —
// the only ones that resolution usefully covers) to the 1:10m resolution
// of the same Natural Earth layer as of the source vendored 2026-08-15:
// ~4,600 features across ~250 adm0_a3 values (more than the 193 UN members
// since Natural Earth's admin-1 layer also covers dependencies/disputed
// territories not in this app's country topology). This is the first
// Tier-1 layer of the geo-data-engine roadmap's Phase 2 pilot: proving the
// build-script -> registry -> GeometryMap -> Layer Engine chain generalizes
// past countries/GeoEntities.
import fs from 'node:fs'
import { ALPHA3_TO_NUMERIC } from './lib/iso3166.mjs'
import { readSourceFeatures, buildSimplifiedTopology, writeTopologyOutput } from './lib/topologyPipeline.mjs'

const SOURCE = 'scripts/vendor/ne_10m_admin_1_states_provinces.geojson'
const OUTPUT = 'public/geo/states-provinces.json'

// Much smaller/simpler shapes than country coastlines at this same
// resolution already provide (admin-1 boundaries are mostly straight lines
// through land, not detailed coastline) — no reason for a different
// aggressiveness than the other two layers use.
const SIMPLIFY_QUANTILE = 0.35

const rawFeatures = readSourceFeatures(SOURCE)

// adm0_a3 values with no entry in ALPHA3_TO_NUMERIC are, at the 1:10m
// resolution, never a missing UN member (that table is complete for all
// 193 — see iso3166.mjs) — they're non-sovereign rows this layer has no
// parent-country concept for: Natural Earth's own GeoEntity-shaped
// classifications (Kosovo, Western Sahara, Guantanamo Bay, the Cyprus
// Sovereign Base Areas, ...) and a handful of uninhabited dependencies
// (Åland, Clipperton Island, ...). Skipped rather than thrown on — logged
// here, and in BACKLOG.md, as a real scope boundary of this layer (states/
// provinces of sovereign countries only) rather than a data gap to chase.
const skippedByCountry = new Map()

const kept = rawFeatures.flatMap((f) => {
  const parentCountryId = ALPHA3_TO_NUMERIC[f.properties.adm0_a3]
  if (!parentCountryId) {
    const key = `${f.properties.adm0_a3} (${f.properties.admin})`
    skippedByCountry.set(key, (skippedByCountry.get(key) ?? 0) + 1)
    return []
  }

  // Stable id: the province's own adm1_code (e.g. "AUS-2043"), lowercased
  // to match this codebase's slug convention elsewhere (see GeoEntity.id's
  // doc comment in data/types.ts). Not iso_3166_2 — at 1:10m resolution
  // that code collides across 60 groups of genuinely distinct provinces
  // (e.g. all 9 Bosnian cantons share "ba-bih"; Sudan's Southern Darfur and
  // Eastern Darfur both share "sd-ds"), which the duplicate-id check below
  // would otherwise reject. adm1_code has none of these collisions and is
  // present on every feature. Stamped directly onto the feature as its
  // topology id, the same "stamp the target registry id before rebuilding"
  // move buildEntityTopology.mjs already makes for its 11 id-less entities
  // — geometryId and entityId are therefore always the same string for
  // this layer, same as those 11.
  const id = f.properties.adm1_code.toLowerCase()

  return [
    {
      ...f,
      id,
      properties: {
        name: f.properties.name,
        parentCountryId,
        parentCountryName: f.properties.admin,
      },
    },
  ]
})

const seen = new Set()
for (const f of kept) {
  if (seen.has(f.id)) {
    throw new Error(`[buildStatesProvincesTopology] duplicate province id "${f.id}" after stamping.`)
  }
  seen.add(f.id)
}
console.log(`Matched ${kept.length} state/province geometries.`)
if (skippedByCountry.size > 0) {
  const skippedTotal = [...skippedByCountry.values()].reduce((a, b) => a + b, 0)
  console.log(`Skipped ${skippedTotal} features with no parent country (${skippedByCountry.size} distinct adm0_a3 values):`)
  for (const [key, count] of [...skippedByCountry.entries()].sort()) {
    console.log(`  ${key}: ${count}`)
  }
}

// Rebuild a fresh topology from just the kept features, same reasoning as
// buildCountryTopology.mjs/buildEntityTopology.mjs.
const quantized = buildSimplifiedTopology('provinces', kept, SIMPLIFY_QUANTILE)

const afterKB = writeTopologyOutput(OUTPUT, quantized)

const beforeKB = fs.statSync(SOURCE).size / 1024
console.log(`Wrote ${OUTPUT}`)
console.log(`Source (uncompressed): ${beforeKB.toFixed(0)} KB`)
console.log(`Output (${kept.length} features, simplified): ${afterKB.toFixed(1)} KB`)
