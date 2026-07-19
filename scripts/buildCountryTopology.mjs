// Build-time asset generator: takes world-atlas's full-detail 10m country
// topology, keeps only the 193 UN member states (dropping the ~60
// dependencies/disputed territories/uninhabited regions Natural Earth also
// ships), and simplifies the coastlines. Run with `npm run build:geo`
// whenever unMembers.ts changes or the source topology is updated.
//
// The 110m/50m pre-baked resolutions drop several small UN members as
// separate polygons entirely (Malta, Singapore, Nauru, Tuvalu, ...), so we
// start from 10m (full detail) and simplify ourselves — that keeps every
// country while cutting the point density that was making the app choppy
// at full 10m detail across 193 countries.
import fs from 'node:fs'
import { feature, quantize } from 'topojson-client'
import { topology } from 'topojson-server'
import { presimplify, simplify, quantile, sphericalTriangleArea } from 'topojson-simplify'
import { DISPLAY_NAME_OVERRIDES, UN_MEMBER_RAW_NAMES } from '../src/data/unMembers.ts'

const SOURCE = 'node_modules/world-atlas/countries-10m.json'
const OUTPUT = 'public/geo/countries-un193.json'

// Quantile of simplification "weight" (visual significance) below which
// coordinates are dropped. 0.35 removes the least-significant ~35% of
// coastline points — indistinguishable at normal zoom, a real cut to
// render cost. Raise it for more aggressive simplification.
const SIMPLIFY_QUANTILE = 0.35

const raw = JSON.parse(fs.readFileSync(SOURCE, 'utf8'))
const rawFeatures = feature(raw, raw.objects.countries).features

const kept = rawFeatures
  .filter((f) => UN_MEMBER_RAW_NAMES.has(f.properties?.name))
  .map((f) => {
    const displayName = DISPLAY_NAME_OVERRIDES[f.properties?.name]
    if (!displayName) return f
    return { ...f, properties: { ...f.properties, name: displayName } }
  })

if (kept.length !== UN_MEMBER_RAW_NAMES.size) {
  throw new Error(
    `Expected ${UN_MEMBER_RAW_NAMES.size} UN members, matched ${kept.length} — ` +
      `unMembers.ts is out of sync with ${SOURCE}'s feature names.`
  )
}
console.log(`Matched all ${kept.length} UN member states.`)

// Rebuild a fresh topology from just the kept features, rather than
// filtering the original topology's geometries — this way arcs that only
// belonged to dropped territories never make it into the output at all,
// instead of sitting there unused.
const rebuilt = topology({ countries: { type: 'FeatureCollection', features: kept } })

const presimplified = presimplify(rebuilt, sphericalTriangleArea)
const minWeight = quantile(presimplified, SIMPLIFY_QUANTILE)
const simplified = simplify(presimplified, minWeight)

// presimplify() strips delta-encoding (it needs raw floats to compute
// weights), and simplify() doesn't restore it — without re-quantizing, the
// output is stored as full-precision floating-point coordinates and ends
// up LARGER than the unsimplified, still-quantized source file.
const quantized = quantize(simplified, 1e5)

fs.writeFileSync(OUTPUT, JSON.stringify(quantized))

const beforeKB = fs.statSync(SOURCE).size / 1024
const afterKB = fs.statSync(OUTPUT).size / 1024
console.log(`Wrote ${OUTPUT}`)
console.log(`Source 10m (255 features): ${beforeKB.toFixed(0)} KB`)
console.log(`Output (193 features, simplified): ${afterKB.toFixed(0)} KB`)
