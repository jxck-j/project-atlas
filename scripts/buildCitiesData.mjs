// Build-time asset generator: national capitals + major world cities,
// from a vendored Natural Earth 1:50m GeoJSON (see scripts/vendor/README.md
// for provenance/coverage caveats). Run with `npm run build:geo:cities` (or
// `npm run build:geo`) whenever the vendored source changes.
//
// Deliberately does NOT go through scripts/lib/topologyPipeline.mjs: that
// pipeline's rebuild/presimplify/quantile/simplify/quantize steps exist to
// cut coastline point density on polygons. A Point feature is one
// coordinate pair — there's nothing to simplify, and no shared arcs between
// points to benefit from topology encoding the way adjacent polygons do.
// Output is a plain GeoJSON FeatureCollection, not a TopoJSON Topology.
import fs from 'node:fs'
import { feature } from 'topojson-client'
import { ALPHA3_TO_NUMERIC } from './lib/iso3166.mjs'

const SOURCE = 'scripts/vendor/ne_50m_populated_places.geojson'
const COUNTRIES_SOURCE = 'public/geo/countries-un193.json'
const OUTPUT = 'public/geo/cities.json'

const raw = JSON.parse(fs.readFileSync(SOURCE, 'utf8'))

// The set of numeric ISO ids actually registered as UN-member Countries at
// runtime (see useCountryFeatures.ts) — built from the same output this
// script's sibling (buildCountryTopology.mjs) already produces, so a
// city whose country doesn't resolve to a real registered Country (Vatican
// City, Kosovo, Bermuda, Somaliland, Taiwan — none are UN members) can be
// excluded rather than shipped with a parentCountryId that never resolves
// via getCountry(). Requires countries-un193.json to already exist —
// npm run build:geo runs build:geo:countries first for exactly this reason.
const countriesTopo = JSON.parse(fs.readFileSync(COUNTRIES_SOURCE, 'utf8'))
const countryFeatures = feature(countriesTopo, countriesTopo.objects.countries).features
const validCountryIds = new Set(countryFeatures.map((f) => String(f.id)))

const candidates = raw.features.filter((f) => f.properties.ADM0CAP === 1 || f.properties.WORLDCITY === 1)

const seenNeId = new Set()
const kept = []
for (const f of candidates) {
  const neId = f.properties.NE_ID
  if (seenNeId.has(neId)) continue // capital + world-city overlap (41 of them)
  seenNeId.add(neId)

  const parentCountryId = ALPHA3_TO_NUMERIC[f.properties.ADM0_A3]
  if (!parentCountryId || !validCountryIds.has(parentCountryId)) continue // non-UN-member capital, see README

  const slug = `${String(f.properties.NAMEASCII).toLowerCase().replace(/[^a-z0-9]+/g, '-')}-${f.properties.ADM0_A3.toLowerCase()}`

  kept.push({
    type: 'Feature',
    id: slug,
    geometry: f.geometry,
    properties: {
      name: f.properties.NAME,
      isCapital: f.properties.ADM0CAP === 1,
      parentCountryId,
      parentCountryName: f.properties.ADM0NAME,
      population: f.properties.POP_MAX > 0 ? f.properties.POP_MAX : undefined,
    },
  })
}

const seenSlug = new Set()
for (const f of kept) {
  if (seenSlug.has(f.id)) {
    throw new Error(`[buildCitiesData] duplicate city slug "${f.id}" — two cities with the same name+country.`)
  }
  seenSlug.add(f.id)
}

const capitalCount = kept.filter((f) => f.properties.isCapital).length
console.log(`Kept ${kept.length} cities (${capitalCount} capitals, ${kept.length - capitalCount} other major cities).`)

const output = { type: 'FeatureCollection', features: kept }
fs.writeFileSync(OUTPUT, JSON.stringify(output))

const afterKB = fs.statSync(OUTPUT).size / 1024
console.log(`Wrote ${OUTPUT}`)
console.log(`Output (${kept.length} features): ${afterKB.toFixed(1)} KB`)
