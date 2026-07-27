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
import { DISPLAY_NAME_OVERRIDES, UN_MEMBER_RAW_NAMES } from '../src/data/unMembers.ts'
import { readSourceFeatures, buildSimplifiedTopology, writeTopologyOutput } from './lib/topologyPipeline.mjs'

const SOURCE = 'node_modules/world-atlas/countries-10m.json'
const OUTPUT = 'public/geo/countries-un193.json'

// Quantile of simplification "weight" (visual significance) below which
// coordinates are dropped. 0.35 removes the least-significant ~35% of
// coastline points — indistinguishable at normal zoom, a real cut to
// render cost. Raise it for more aggressive simplification.
const SIMPLIFY_QUANTILE = 0.35

const rawFeatures = readSourceFeatures(SOURCE, 'countries')

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
const quantized = buildSimplifiedTopology('countries', kept, SIMPLIFY_QUANTILE)

const afterKB = writeTopologyOutput(OUTPUT, quantized)

const beforeKB = fs.statSync(SOURCE).size / 1024
console.log(`Wrote ${OUTPUT}`)
console.log(`Source 10m (255 features): ${beforeKB.toFixed(0)} KB`)
console.log(`Output (193 features, simplified): ${afterKB.toFixed(0)} KB`)
