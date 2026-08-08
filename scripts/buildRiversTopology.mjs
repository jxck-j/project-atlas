// Build-time asset generator: major rivers, simplified from a vendored
// Natural Earth 1:50m GeoJSON (see scripts/vendor/README.md for
// provenance). Run with `npm run build:geo:rivers` (or `npm run
// build:geo`) whenever the vendored source file changes.
//
// Decorative-only layer, same reasoning as buildLakesTopology.mjs (see that
// file's header comment) — no id-stamping, no registry, no GeometryMap.
//
// Geometry is LineString/MultiLineString, not Polygon/MultiPolygon —
// countryGeometry.ts's geometryToFillMesh/geometryToBorderSegments only
// handle ring-based geometry (see that file's geometryToPolygons(), which
// returns [] for anything else), so rivers need their own rendering path
// (scene/Rivers.tsx + a small geometryToLineSegments-style helper) rather
// than reusing EntityRenderLayer. This script only builds the topology
// asset; that rendering gap is handled on the component side.
import fs from 'node:fs'
import { readSourceFeatures, buildSimplifiedTopology, writeTopologyOutput } from './lib/topologyPipeline.mjs'

const SOURCE = 'scripts/vendor/ne_50m_rivers_lake_centerlines.geojson'
const OUTPUT = 'public/geo/rivers.json'

// Same aggressiveness as the other 1:50m-sourced layers.
const SIMPLIFY_QUANTILE = 0.35

// Deliberate pilot scope, mirroring states/provinces' "9 countries only"
// and cities' "capitals + major cities only" precedents: the source's 462
// features range scalerank 1 (27 features, major rivers like the Amazon/
// Nile/Mississippi) through 6 (207 features, minor tributaries) — keeping
// only scalerank <= MAX_SCALERANK gives ~116 major rivers globally instead
// of cluttering the globe with every minor tributary at default zoom.
// Raising this constant (up to 6, for all 462) is the upgrade path later,
// same "no pipeline redesign" shape as the 1:10m upgrade path documented
// for states/provinces.
const MAX_SCALERANK = 3

const rawFeatures = readSourceFeatures(SOURCE)

const kept = rawFeatures
  .filter((f) => f.properties.scalerank <= MAX_SCALERANK)
  .map((f) => ({
    ...f,
    properties: {
      name: f.properties.name ?? null,
    },
  }))

console.log(`Matched ${kept.length} of ${rawFeatures.length} river geometries (scalerank <= ${MAX_SCALERANK}).`)

const quantized = buildSimplifiedTopology('rivers', kept, SIMPLIFY_QUANTILE)

const afterKB = writeTopologyOutput(OUTPUT, quantized)

const beforeKB = fs.statSync(SOURCE).size / 1024
console.log(`Wrote ${OUTPUT}`)
console.log(`Source (uncompressed): ${beforeKB.toFixed(0)} KB`)
console.log(`Output (${kept.length} features, simplified): ${afterKB.toFixed(1)} KB`)
