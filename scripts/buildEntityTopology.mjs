// Build-time asset generator: extracts every entity registered in
// data/registry/geoEntities.ts that has a real, standalone polygon in
// world-atlas's raw 10m source data, from the same source
// buildCountryTopology.mjs reads. Separate output file (not merged into
// countries-un193.json) because these aren't UN members and don't belong in
// the "exactly 193" set that pipeline guards. Run with
// `npm run build:geo:entities` (or `npm run build:geo`, which runs both this
// and the country build) whenever entityGeometryIds.ts changes or the
// source topology is updated.
//
// Replaces the pre-v3 buildTerritoryTopology.mjs, which only had to match
// features by numeric id (all 3 pre-v3 territories had one). The v3 dataset
// includes 11 entities with NO numeric id in the source at all (Kosovo,
// the Cyprus Sovereign Base Areas, Guantanamo Bay, Baikonur, the Cyprus UN
// Buffer Zone, Siachen Glacier, and four disputed South China Sea/Caribbean
// features) — those are matched by their raw `properties.name` instead
// (ENTITY_GEOMETRY_NAME_KEYS), and explicitly stamped with their target
// GeoEntityRegistry id as `feature.id` *before* the topology is rebuilt, so
// the output is uniform: every kept feature has a resolvable `id`, and
// scene/useGeoEntityFeatures.ts never needs to know which features started
// out id-less.
import fs from 'node:fs'
import { feature, quantize } from 'topojson-client'
import { topology } from 'topojson-server'
import { presimplify, simplify, quantile, sphericalTriangleArea } from 'topojson-simplify'
import { ENTITY_GEOMETRY_IDS, ENTITY_GEOMETRY_NAME_KEYS } from '../src/entities/entityGeometryIds.ts'

const SOURCE = 'node_modules/world-atlas/countries-10m.json'
const OUTPUT = 'public/geo/entities.json'

// Same simplification aggressiveness as countries — these are much smaller
// datasets so the size win matters less, but there's no reason for the
// coastline detail level to look inconsistent between, say, a country and a
// territory sitting right next to it (Taiwan/China, W. Sahara/Morocco).
const SIMPLIFY_QUANTILE = 0.35

const raw = JSON.parse(fs.readFileSync(SOURCE, 'utf8'))
const rawFeatures = feature(raw, raw.objects.countries).features

const kept = []
for (const f of rawFeatures) {
  const numericId = f.id !== undefined && f.id !== null ? String(f.id) : undefined
  const entityIdFromNumericId = numericId ? ENTITY_GEOMETRY_IDS[numericId] : undefined
  if (entityIdFromNumericId) {
    kept.push(f)
    continue
  }

  const sourceName = f.properties?.name
  const entityIdFromName = sourceName ? ENTITY_GEOMETRY_NAME_KEYS[sourceName] : undefined
  if (entityIdFromName) {
    // This feature has no numeric id in the source — stamp the target
    // GeoEntityRegistry id directly onto it so the rebuilt topology carries
    // a stable, resolvable id, the same as every numeric-id feature does.
    f.id = entityIdFromName
    kept.push(f)
  }
}

const expectedCount = Object.keys(ENTITY_GEOMETRY_IDS).length + Object.keys(ENTITY_GEOMETRY_NAME_KEYS).length
if (kept.length !== expectedCount) {
  throw new Error(
    `Expected ${expectedCount} entity geometries, matched ${kept.length} — ` +
      `entityGeometryIds.ts is out of sync with ${SOURCE}'s feature ids/names.`
  )
}
console.log(`Matched all ${kept.length} entity geometries.`)

// Rebuild a fresh topology from just the kept features, same reasoning as
// buildCountryTopology.mjs: arcs belonging only to everything else in the
// 255-feature source never make it into this output.
const rebuilt = topology({ entities: { type: 'FeatureCollection', features: kept } })

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
