// Build-time asset generator: major lakes, simplified from a vendored
// Natural Earth 1:50m GeoJSON (see scripts/vendor/README.md for
// provenance). Run with `npm run build:geo:lakes` (or `npm run build:geo`)
// whenever the vendored source file changes.
//
// Unlike states/provinces (an administrative/political layer registered
// into GeoEntityRegistry with real claim/administration relationships),
// lakes and rivers are physical geography, not political entities — they
// have no government, no claims, nothing an EntityResolver lookup would
// ever need to answer. This layer is rendered decoratively only (no
// GeoEntity record, no GeometryMap registration, no click-to-select): see
// GEO_ENGINE_README.md's "Lakes & rivers" section for the reasoning. That's
// what keeps this script so much simpler than
// buildStatesProvincesTopology.mjs — no id-stamping, no parent-country
// resolution, no duplicate-id guard, because nothing downstream needs a
// stable per-feature identity.
import fs from 'node:fs'
import { readSourceFeatures, buildSimplifiedTopology, writeTopologyOutput } from './lib/topologyPipeline.mjs'

const SOURCE = 'scripts/vendor/ne_50m_lakes.geojson'
const OUTPUT = 'public/geo/lakes.json'

// Same aggressiveness as the other two 1:50m-sourced layers (countries,
// states/provinces) — no reason for lake shorelines to need a different
// tolerance.
const SIMPLIFY_QUANTILE = 0.35

const rawFeatures = readSourceFeatures(SOURCE)

// Kept as-is: 412 features at 1:50m is already a reasonable pilot scope
// (comparable order of magnitude to states/provinces' 294), so unlike
// rivers in the sibling script, no scalerank filtering is applied here.
// Properties trimmed to just what scene/Lakes.tsx's rendering needs (name +
// scalerank, the latter driving label text size/reveal the same way
// scene/Globe.tsx's WaterLabels already differentiates oceans from smaller
// seas) — this is a decorative layer, not a data layer, so nothing else is
// kept.
const kept = rawFeatures.map((f) => ({
  ...f,
  properties: {
    name: f.properties.name ?? null,
    scalerank: f.properties.scalerank,
  },
}))

console.log(`Matched all ${kept.length} lake geometries.`)

const quantized = buildSimplifiedTopology('lakes', kept, SIMPLIFY_QUANTILE)

const afterKB = writeTopologyOutput(OUTPUT, quantized)

const beforeKB = fs.statSync(SOURCE).size / 1024
console.log(`Wrote ${OUTPUT}`)
console.log(`Source (uncompressed): ${beforeKB.toFixed(0)} KB`)
console.log(`Output (${kept.length} features, simplified): ${afterKB.toFixed(1)} KB`)
