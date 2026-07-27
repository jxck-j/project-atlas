// Build-time asset generator: US city boundaries, from a vendored Census
// cartographic boundary shapefile — see scripts/vendor/README.md for
// provenance. Second iteration of this script — the first (a single
// pre-merged binary buffer of all 32,608 boundaries, rendered as one
// always-on layer) shipped, but was replaced after two real problems
// surfaced in review: the always-on polygon layer read as visual noise
// ("clustered dots/blobs") rather than legible city shapes, and reworking
// the product direction around it (Google Maps-style: names only, by
// default; a specific city's outline only appears when that city is
// searched for) made the merged-blob shape wrong regardless — showing one
// city's outline on demand needs that one city's geometry addressable on
// its own, not baked into a single giant buffer covering all 32,608 at
// once. See CLAUDE.md / LOGBOOK.md.
//
// Output is now sharded by state (~52 files: 50 states + DC + territories
// present in the source) rather than one file:
// - Nobody needs more than one state's cities at a time (hud/SearchBar.tsx
//   already knows which state a searched city belongs to, from the search
//   index below, before it needs that city's actual geometry) — sharding
//   means an on-demand single-city outline fetch pulls in one state's
//   worth of data (tens to low hundreds of KB) instead of all 32,608
//   boundaries.
// - No topojson simplification here (unlike every polygon-based sibling
//   script) — a single city's polygon at raw 1:500,000 Census precision is
//   small and cheap to render on its own; simplification only mattered
//   when this was one giant always-rendered merged layer, which no longer
//   exists.
import fs from 'node:fs'
import * as shapefile from 'shapefile'
import { US_STATE_CAPITALS } from './lib/usStateCapitals.mjs'

const SHP = 'scripts/vendor/census/cb_2023_us_place_500k.shp'
const DBF = 'scripts/vendor/census/cb_2023_us_place_500k.dbf'
const POPULATION_CSV = 'scripts/vendor/census/place_population_2023.csv'
const SHARDS_DIR = 'public/geo/us-cities'
const INDEX_OUTPUT = 'public/geo/us-cities-index.json'

// State capitals aren't flagged in either Census source above, and
// Natural Earth's populated-places dataset (this app's other populated-
// places source, see buildCitiesData.mjs) doesn't carry a usable ADM1CAP
// flag for the US either (checked directly: 0 of its 769 US entries at
// 1:10m resolution have it set) — hence the hand-curated list.
const stateCapitals = new Set(US_STATE_CAPITALS.map(([state, name]) => `${state}|${name}`))

fs.mkdirSync(SHARDS_DIR, { recursive: true })

// Population estimates, joined by GEOID (STATE FIPS + PLACE FIPS, 7 digits —
// matches the shapefile's own GEOID property below). This is a SEPARATE
// Census product from the boundary shapefile (the "Places" cartographic
// boundary file itself carries no population field, only ALAND/AWATER —
// land area alone turned out to be a bad proxy for "major city": ranking by
// it surfaces sprawling, sparsely-populated places like Sitka/Wrangell/
// Juneau, AK ahead of NYC/LA/Chicago). See vendor/README.md for exact
// provenance. Only covers incorporated places (~19,500 of this dataset's
// 32,608) — Census-Designated Places (unincorporated communities, no local
// government) aren't estimated by this program at all and are left
// unpopulated (population 0) rather than guessed at; see that same README
// note for what that means for CDP ranking.
const population = new Map()
for (const line of fs.readFileSync(POPULATION_CSV, 'utf8').split('\n').slice(1)) {
  if (!line.trim()) continue
  const [state, place, pop] = line.split(',')
  population.set(`${state}${place}`, Number(pop))
}

const source = await shapefile.open(SHP, DBF)

const featuresByState = new Map()
const indexEntries = []

let result = await source.read()
while (!result.done) {
  const { geometry, properties } = result.value
  const id = properties.GEOIDFQ
  const stateAbbrev = properties.STUSPS
  const stateId = `us-${stateAbbrev.toLowerCase()}`

  if (!featuresByState.has(stateAbbrev)) featuresByState.set(stateAbbrev, [])
  featuresByState.get(stateAbbrev).push({ type: 'Feature', id, geometry, properties: { name: properties.NAME } })

  indexEntries.push({
    id,
    name: properties.NAME,
    lat: undefined, // filled in below once we compute a cheap centroid
    lng: undefined,
    stateId,
    stateAbbrev,
    stateName: properties.STATE_NAME,
    population: population.get(properties.GEOID) ?? 0,
    isStateCapital: stateCapitals.has(`${stateAbbrev}|${properties.NAME}`),
  })

  result = await source.read()
}

// Cheap centroid (average of exterior-ring points) for the search index —
// doesn't need geometryToCentroid's spherical-triangle precision, this is
// only ever used to aim a camera flight, not to compute anything exact.
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
for (const features of featuresByState.values()) {
  for (const f of features) featuresById.set(f.id, f)
}
for (const entry of indexEntries) {
  const centroid = cheapCentroid(featuresById.get(entry.id).geometry)
  entry.lat = centroid.lat
  entry.lng = centroid.lng
}

let totalShardKB = 0
for (const [stateAbbrev, features] of featuresByState) {
  const collection = { type: 'FeatureCollection', features }
  const output = `${SHARDS_DIR}/${stateAbbrev.toLowerCase()}.json`
  fs.writeFileSync(output, JSON.stringify(collection))
  totalShardKB += fs.statSync(output).size / 1024
}

const matchedCapitals = indexEntries.filter((e) => e.isStateCapital).length
if (matchedCapitals !== US_STATE_CAPITALS.length) {
  throw new Error(
    `[buildUsCitiesData] matched ${matchedCapitals}/${US_STATE_CAPITALS.length} state capitals — a name in usStateCapitals.mjs no longer matches this vintage of the Census source exactly.`
  )
}

fs.writeFileSync(INDEX_OUTPUT, JSON.stringify(indexEntries))

const withPopulation = indexEntries.filter((e) => e.population > 0).length
console.log(`Matched population estimates for ${withPopulation.toLocaleString()}/${indexEntries.length.toLocaleString()} places (the rest are Census-Designated Places, not estimated by this Census program)`)

const indexKB = fs.statSync(INDEX_OUTPUT).size / 1024
console.log(`Wrote ${featuresByState.size} state shards to ${SHARDS_DIR}/ (${indexEntries.length.toLocaleString()} cities total, ${totalShardKB.toFixed(0)} KB combined, avg ${(totalShardKB / featuresByState.size).toFixed(0)} KB/state)`)
console.log(`Wrote ${INDEX_OUTPUT} (${indexEntries.length.toLocaleString()} entries): ${indexKB.toFixed(0)} KB`)
