// Build-time asset generator: extracts the handful of territories that both
// (a) are registered in data/registry/territories.ts and (b) have a real,
// standalone polygon in world-atlas's raw 10m source data, from the same
// source buildCountryTopology.mjs reads. Separate output file (not merged
// into countries-un193.json) because these aren't UN members and don't
// belong in the "exactly 193" set that pipeline guards. Run with
// `npm run build:geo:territories` (or `npm run build:geo`, which runs both
// this and the country build) whenever territoryGeometryIds.ts changes or
// the source topology is updated.
import fs from 'node:fs'
import { feature, quantize } from 'topojson-client'
import { topology } from 'topojson-server'
import { presimplify, simplify, quantile, sphericalTriangleArea } from 'topojson-simplify'
import { TERRITORY_GEOMETRY_IDS } from '../src/entities/territoryGeometryIds.ts'

const SOURCE = 'node_modules/world-atlas/countries-10m.json'
const OUTPUT = 'public/geo/territories.json'

// Same simplification aggressiveness as countries — these are much smaller
// datasets so the size win matters less, but there's no reason for the
// coastline detail level to look inconsistent between a country and a
// territory sitting right next to it (Taiwan/China, W. Sahara/Morocco).
const SIMPLIFY_QUANTILE = 0.35

const raw = JSON.parse(fs.readFileSync(SOURCE, 'utf8'))
const rawFeatures = feature(raw, raw.objects.countries).features

const kept = rawFeatures.filter(
  (f) => f.id !== undefined && f.id !== null && TERRITORY_GEOMETRY_IDS[String(f.id)] !== undefined
)

const expectedCount = Object.keys(TERRITORY_GEOMETRY_IDS).length
if (kept.length !== expectedCount) {
  throw new Error(
    `Expected ${expectedCount} territory geometries, matched ${kept.length} — ` +
      `territoryGeometryIds.ts is out of sync with ${SOURCE}'s feature ids.`
  )
}
console.log(`Matched all ${kept.length} territory geometries.`)

// Rebuild a fresh topology from just the kept features, same reasoning as
// buildCountryTopology.mjs: arcs belonging only to everything else in the
// 255-feature source never make it into this tiny output.
const rebuilt = topology({ territories: { type: 'FeatureCollection', features: kept } })

const presimplified = presimplify(rebuilt, sphericalTriangleArea)
const minWeight = quantile(presimplified, SIMPLIFY_QUANTILE)
const simplified = simplify(presimplified, minWeight)

// presimplify() strips delta-encoding — re-quantize afterward or the output
// stores full-precision floats and balloons in size (see
// buildCountryTopology.mjs for the same gotcha, discovered there first).
const quantized = quantize(simplified, 1e5)

fs.writeFileSync(OUTPUT, JSON.stringify(quantized))

const afterKB = fs.statSync(OUTPUT).size / 1024
console.log(`Wrote ${OUTPUT}`)
console.log(`Output (${kept.length} features, simplified): ${afterKB.toFixed(1)} KB`)
