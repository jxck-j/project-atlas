// Shared machinery behind every scripts/build*Topology.mjs asset generator.
// Each script still owns its own feature filtering/matching logic — which
// features to keep and how to key/rename them is genuinely per-layer (UN
// member allowlisting + display-name overrides for countries, numeric-id/
// name-key matching + id-stamping for GeoEntities, and whatever a future
// layer's own matching rules are). What's identical across every script is
// the back half: rebuild a fresh topology from just the kept features (so
// arcs belonging only to dropped features never make it into the output),
// simplify, and re-quantize. See buildCountryTopology.mjs's comments for why
// each of these steps exists — kept there as the canonical narrative rather
// than duplicated here.
import fs from 'node:fs'
import { feature, quantize } from 'topojson-client'
import { topology } from 'topojson-server'
import { presimplify, simplify, quantile, sphericalTriangleArea } from 'topojson-simplify'

// Handles both source shapes this pipeline has needed so far: a TopoJSON
// Topology (world-atlas's countries-10m.json — pass sourceObjectName to
// pick which of its `objects` to convert) or a plain GeoJSON
// FeatureCollection (a vendored file with no topology to begin with, e.g.
// Natural Earth's admin-1 states/provinces export) — sourceObjectName is
// ignored for that shape since there's only one feature list to read.
export function readSourceFeatures(sourcePath, sourceObjectName) {
  const raw = JSON.parse(fs.readFileSync(sourcePath, 'utf8'))
  if (raw.type === 'FeatureCollection') return raw.features
  return feature(raw, raw.objects[sourceObjectName]).features
}

export function buildSimplifiedTopology(objectName, keptFeatures, simplifyQuantile) {
  const rebuilt = topology({ [objectName]: { type: 'FeatureCollection', features: keptFeatures } })

  const presimplified = presimplify(rebuilt, sphericalTriangleArea)
  const minWeight = quantile(presimplified, simplifyQuantile)
  const simplified = simplify(presimplified, minWeight)

  // presimplify() strips delta-encoding to compute weights, and simplify()
  // doesn't restore it — without re-quantizing afterward, the output is
  // stored as raw floating-point coordinates and ends up *larger* than the
  // unsimplified source.
  return quantize(simplified, 1e5)
}

// Writes the topology and returns its size in KB, for the caller's own
// size-reporting console.log — each script formats/labels that message
// slightly differently (feature counts, decimal precision), so the message
// itself stays in each script rather than being standardized away here.
export function writeTopologyOutput(outputPath, quantizedTopology) {
  fs.writeFileSync(outputPath, JSON.stringify(quantizedTopology))
  return fs.statSync(outputPath).size / 1024
}
