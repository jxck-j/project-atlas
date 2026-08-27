// Build-time asset generator: Canadian city/town/municipality boundaries,
// from a vendored Statistics Canada 2021 Census Subdivision (CSD) cartographic
// boundary shapefile — see scripts/vendor/README.md for provenance. Mirrors
// buildUsCitiesData.mjs's shape/product-direction exactly (sharded-by-region
// output, on-demand single-boundary fetch, no always-on merged layer — see
// that file's header comment for why the always-on version was reworked) so
// the two datasets share one rendering/search code path in src/. The one
// structural difference: CSD is Canada's actual city/town/municipality-level
// unit (Statistics Canada's own equivalent of US Census "Places"), not a
// coarser admin unit — no county-vs-city granularity mismatch to work around
// here the way one exists for Mexico's municipios.
//
// UNLIKE every other script in this file's family, this source needs a real
// reprojection step: the vendored shapefile ships in NAD83 / Statistics
// Canada Lambert (meters), not geographic lat/lng — confirmed via the
// shapefile's own .prj sidecar. proj4 (devDependency, added for this script)
// converts every ring's coordinates before anything downstream (centroid,
// search index, rendering) touches them; every other geometry source in this
// codebase is already lat/lng and has never needed this.
//
// The raw shapefile is ~300MB uncompressed — far past the ~45MB US Census
// place file that's committed directly, and past GitHub's 50MB per-file
// threshold every other scripts/vendor/ source respects. It is NOT committed
// (see .gitignore's scripts/vendor/canada/ rule) — fetch by hand per
// scripts/vendor/README.md. Only this script's processed output
// (public/geo/canada-cities/) ships and is committed, same as every other
// build:geo:* product.
import fs from 'node:fs'
import * as shapefile from 'shapefile'
import proj4 from 'proj4'
import { feature } from 'topojson-client'
import { buildSimplifiedTopology } from './lib/topologyPipeline.mjs'
import { CANADA_PROVINCES } from './lib/canadaProvinces.mjs'

// Unlike buildUsCitiesData.mjs (US Census "Places" polygons are already
// small/compact per city, so that script skips simplification entirely — see
// its own header comment), Canada's CSDs include enormous rural/northern
// units with genuinely complex coastlines (Nunavut's alone, unsimplified,
// wrote a 211MB shard from one province). Simplified per-province (not
// combined across all of Canada) via the same rebuild/presimplify/quantize
// pipeline buildCountryTopology.mjs/buildStatesProvincesTopology.mjs use, at
// the same 0.35 quantile those two already settled on, then converted back
// out of topology into a plain FeatureCollection — so the shard files on
// disk stay a plain GeoJSON FeatureCollection, matching buildUsCitiesData.mjs's
// output shape, and the future rendering/search code can treat both sources
// identically without knowing one went through topology simplification.
const SIMPLIFY_QUANTILE = 0.05

const SHP = 'scripts/vendor/canada/lcsd000b21a_e/lcsd000b21a_e.shp'
const DBF = 'scripts/vendor/canada/lcsd000b21a_e/lcsd000b21a_e.dbf'
const POPULATION_CSV = 'scripts/vendor/canada/population-98100002/98100002.csv'
const SHARDS_DIR = 'public/geo/canada-cities'
const INDEX_OUTPUT = 'public/geo/canada-cities-index.json'

// Exact params transcribed from lcsd000b21a_e.prj's PROJCS definition —
// "NAD83_Statistics_Canada_Lambert" (Lambert Conformal Conic, NAD83/GRS80).
const STATCAN_LAMBERT =
  '+proj=lcc +lat_1=49 +lat_2=77 +lat_0=63.390675 +lon_0=-91.86666666666667 ' +
  '+x_0=6200000 +y_0=3000000 +ellps=GRS80 +datum=NAD83 +units=m +no_defs'
const toWgs84 = proj4(STATCAN_LAMBERT, 'WGS84')

function reprojectRing(ring) {
  return ring.map(([x, y]) => toWgs84.forward([x, y]))
}
function reprojectGeometry(geometry) {
  if (geometry.type === 'Polygon') {
    return { type: 'Polygon', coordinates: geometry.coordinates.map(reprojectRing) }
  }
  if (geometry.type === 'MultiPolygon') {
    return {
      type: 'MultiPolygon',
      coordinates: geometry.coordinates.map((polygon) => polygon.map(reprojectRing)),
    }
  }
  throw new Error(`[buildCanadaCitiesData] unexpected geometry type: ${geometry.type}`)
}

// Statistics Canada Table 98-10-0002-01 mixes every geography level (Canada,
// provinces, census divisions, CSDs) in one CSV. Its DGUID column encodes the
// level in its schema-type segment ("...A0005..." = census subdivision — see
// this table's own metadata) and, for CSD rows, is exactly "2021A0005" +
// CSDUID — the same DGUID the boundary shapefile carries on each feature, so
// no separate name-matching pass is needed the way the US script needs one
// for state capitals. A quote-aware line parser is needed here (unlike a
// naive split(',')) because this file interleaves real value columns with
// "Symbols" columns and quotes every field.
function parseCsvLine(line) {
  const fields = []
  let cur = ''
  let inQuotes = false
  for (let i = 0; i < line.length; i++) {
    const c = line[i]
    if (inQuotes) {
      if (c === '"' && line[i + 1] === '"') {
        cur += '"'
        i++
      } else if (c === '"') {
        inQuotes = false
      } else {
        cur += c
      }
    } else if (c === '"') {
      inQuotes = true
    } else if (c === ',') {
      fields.push(cur)
      cur = ''
    } else {
      cur += c
    }
  }
  fields.push(cur)
  return fields
}

const population = new Map()
const csvLines = fs.readFileSync(POPULATION_CSV, 'utf8').split('\n')
for (const line of csvLines.slice(1)) {
  if (!line.trim()) continue
  const fields = parseCsvLine(line)
  const dguid = fields[2]
  if (!dguid.startsWith('2021A0005')) continue // not a CSD-level row
  const pop = Number(fields[4])
  population.set(dguid, Number.isFinite(pop) ? pop : 0)
}

const source = await shapefile.open(SHP, DBF)

const featuresByProvince = new Map()
const indexEntries = []

// 'NO' (Unorganized) / 'SNO' (Subdivision of Unorganized) are Statistics
// Canada's own statistical-dissemination catch-all for whatever land ISN'T
// part of a real named municipality (confirmed against StatCan's CSD type
// dictionary) — not settlements themselves. Excluded for the same reason a
// "leftover bucket" wouldn't belong in a cities dataset; they also happen to
// be the single biggest driver of raw file size (three of these in Nunavut
// alone, covering vast uninhabited Arctic archipelago area, accounted for
// ~99% of that province's unsimplified shard weight).
const UNORGANIZED_TYPES = new Set(['NO', 'SNO'])
let excludedUnorganized = 0

let result = await source.read()
while (!result.done) {
  const { geometry, properties } = result.value
  if (UNORGANIZED_TYPES.has(properties.CSDTYPE)) {
    excludedUnorganized++
    result = await source.read()
    continue
  }
  const id = `ca-${properties.CSDUID}`
  const province = CANADA_PROVINCES[properties.PRUID]
  if (!province) throw new Error(`[buildCanadaCitiesData] unrecognized PRUID: ${properties.PRUID}`)
  const [provinceAbbrev, provinceName] = province
  const provinceId = `ca-${provinceAbbrev.toLowerCase()}`

  const reprojected = reprojectGeometry(geometry)

  if (!featuresByProvince.has(provinceAbbrev)) featuresByProvince.set(provinceAbbrev, [])
  featuresByProvince.get(provinceAbbrev).push({
    type: 'Feature',
    id,
    geometry: reprojected,
    properties: { name: properties.CSDNAME },
  })

  indexEntries.push({
    id,
    name: properties.CSDNAME,
    lat: undefined, // filled in below once we compute a cheap centroid
    lng: undefined,
    provinceId,
    provinceAbbrev,
    provinceName,
    population: population.get(properties.DGUID) ?? 0,
  })

  result = await source.read()
}

// Cheap centroid (average of exterior-ring points) — same precision
// trade-off buildUsCitiesData.mjs makes: only used to aim a camera flight,
// not to compute anything exact.
function cheapCentroid(geometry) {
  const ring =
    geometry.type === 'Polygon'
      ? geometry.coordinates[0]
      : geometry.type === 'MultiPolygon'
        ? geometry.coordinates[0][0]
        : []
  if (ring.length === 0) return { lat: 0, lng: 0 }
  let sumLng = 0
  let sumLat = 0
  for (const [lng, lat] of ring) {
    sumLng += lng
    sumLat += lat
  }
  return { lat: sumLat / ring.length, lng: sumLng / ring.length }
}

const featuresById = new Map()
for (const features of featuresByProvince.values()) {
  for (const f of features) featuresById.set(f.id, f)
}
for (const entry of indexEntries) {
  const centroid = cheapCentroid(featuresById.get(entry.id).geometry)
  entry.lat = centroid.lat
  entry.lng = centroid.lng
}

fs.mkdirSync(SHARDS_DIR, { recursive: true })
let totalShardKB = 0
for (const [provinceAbbrev, features] of featuresByProvince) {
  const quantized = buildSimplifiedTopology('csds', features, SIMPLIFY_QUANTILE)
  const collection = feature(quantized, quantized.objects.csds)
  const output = `${SHARDS_DIR}/${provinceAbbrev.toLowerCase()}.json`
  fs.writeFileSync(output, JSON.stringify(collection))
  totalShardKB += fs.statSync(output).size / 1024
}

fs.writeFileSync(INDEX_OUTPUT, JSON.stringify(indexEntries))

console.log(`Excluded ${excludedUnorganized} Unorganized/Subdivision-of-Unorganized CSDs (not real settlements)`)
const withPopulation = indexEntries.filter((e) => e.population > 0).length
console.log(`Matched population for ${withPopulation.toLocaleString()}/${indexEntries.length.toLocaleString()} CSDs from StatCan Table 98-10-0002-01`)

const indexKB = fs.statSync(INDEX_OUTPUT).size / 1024
console.log(`Wrote ${featuresByProvince.size} province/territory shards to ${SHARDS_DIR}/ (${indexEntries.length.toLocaleString()} CSDs total, ${totalShardKB.toFixed(0)} KB combined, avg ${(totalShardKB / featuresByProvince.size).toFixed(0)} KB/region)`)
console.log(`Wrote ${INDEX_OUTPUT} (${indexEntries.length.toLocaleString()} entries): ${indexKB.toFixed(0)} KB`)
