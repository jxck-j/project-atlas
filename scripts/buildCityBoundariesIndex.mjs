// Derives the small, always-eager-fetched city index scene/useCityIndex.ts
// fetches (public/geo/city-boundaries-index.json) — the label-reveal +
// search source for every country scripts/buildCityBoundaries.mjs has real
// boundary data for. Purely local file reads (the already-written
// public/geo/city-boundaries/{countryId}.json files plus the existing
// public/geo/us-cities-index.json) — NO Overpass/geoBoundaries network
// calls, so this can be re-run any time without depending on those
// sometimes-unreachable sources being up (see buildCityBoundaries.mjs's own
// comment on that).
//
// Scoped to exactly the countries city-boundaries-architecture.md's
// investigation covers today (Jordan, Kuwait, US, the 2026-09-05 Central
// America pass: Costa Rica, El Salvador, Guatemala, Honduras, Nicaragua,
// Panama, Belize, plus Canada/Mexico) — NOT the other 183 UN members. See
// that doc's migration plan.
import fs from 'node:fs'
import { geometryCentroid } from './lib/sphericalGeometry.mjs'

const OUTPUT = 'public/geo/city-boundaries-index.json'
const entries = []

const BOUNDARY_COUNTRIES = [
  { id: '400', name: 'Jordan' },
  { id: '414', name: 'Kuwait' },
  { id: '188', name: 'Costa Rica' },
  { id: '222', name: 'El Salvador' },
  { id: '320', name: 'Guatemala' },
  { id: '340', name: 'Honduras' },
  { id: '558', name: 'Nicaragua' },
  { id: '591', name: 'Panama' },
  { id: '084', name: 'Belize' },
  { id: '124', name: 'Canada' },
]

function addFromBoundaryFile(countryId) {
  const fc = JSON.parse(fs.readFileSync(`public/geo/city-boundaries/${countryId}.json`, 'utf8'))
  for (const f of fc.features) {
    const { lat, lng } = geometryCentroid(f.geometry)
    entries.push({
      id: String(f.id),
      name: f.properties.name,
      lat,
      lng,
      countryId,
      population: f.properties.population ?? 0,
      isCapital: Boolean(f.properties.isCapital),
    })
  }
}

for (const country of BOUNDARY_COUNTRIES) addFromBoundaryFile(country.id)

// Mexico (484) is state-sharded (scripts/buildCityBoundaries.mjs's
// shardByState()), same reason and same shape as the pre-existing US block
// below — the state abbreviation comes from the shard's own filename, since
// nothing in a Mexican municipio's own properties carries it (see
// shardByState()'s own comment for why this had to be a real spatial join
// against Natural Earth's admin-1 polygons in the first place).
const mexicoShardDir = 'public/geo/city-boundaries/484'
for (const shardFile of fs.readdirSync(mexicoShardDir)) {
  const stateAbbrev = shardFile.replace('.json', '')
  const fc = JSON.parse(fs.readFileSync(`${mexicoShardDir}/${shardFile}`, 'utf8'))
  for (const f of fc.features) {
    const { lat, lng } = geometryCentroid(f.geometry)
    entries.push({
      id: String(f.id),
      name: f.properties.name,
      lat,
      lng,
      countryId: '484',
      population: f.properties.population ?? 0,
      isCapital: Boolean(f.properties.isCapital),
      stateAbbrev,
    })
  }
}

const usIndex = JSON.parse(fs.readFileSync('public/geo/us-cities-index.json', 'utf8'))
for (const e of usIndex) {
  entries.push({
    id: e.id,
    name: e.name,
    lat: e.lat,
    lng: e.lng,
    countryId: '840',
    population: e.population,
    isCapital: Boolean(e.isStateCapital),
    stateAbbrev: e.stateAbbrev,
  })
}

fs.writeFileSync(OUTPUT, JSON.stringify(entries))
const kb = fs.statSync(OUTPUT).size / 1024
const perCountryCounts = BOUNDARY_COUNTRIES.map(
  (c) => `${c.name} ${entries.filter((e) => e.countryId === c.id).length}`,
).join(', ')
console.log(
  `Wrote ${OUTPUT}: ${entries.length} entries (${perCountryCounts}, Mexico ${entries.filter((e) => e.countryId === '484').length}, US ${entries.filter((e) => e.countryId === '840').length}), ${(kb / 1024).toFixed(1)} MB`,
)
