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
// investigation covers today (Jordan, Kuwait, US, the 2026-09-04 Central
// America pass: Costa Rica, El Salvador, Guatemala, Honduras, Nicaragua,
// Panama, Belize, the 2026-09-05 Canada/Mexico pass, the 2026-09-05
// South America pass: all twelve UN members — Argentina, Bolivia, Brazil,
// Chile, Colombia, Ecuador, Guyana, Paraguay, Peru, Suriname, Uruguay,
// Venezuela, plus the 2026-09-12 Caribbean pass: Antigua and Barbuda,
// Bahamas, Barbados, Cuba, Dominica, Dominican Republic, Grenada, Haiti,
// Jamaica, Saint Kitts and Nevis, Saint Lucia, Saint Vincent and the
// Grenadines, Trinidad and Tobago, plus the 2026-09-13 Northern Europe pass:
// Denmark, Estonia, Finland, Iceland, Ireland, Latvia, Lithuania, Norway,
// Sweden, United Kingdom, plus the 2026-09-16 Western Europe pass: Austria,
// Belgium, France, Germany, Liechtenstein, Luxembourg, Monaco, Netherlands,
// Switzerland, plus the 2026-09-17 Southern Europe pass: Albania, Andorra,
// Bosnia and Herzegovina, Croatia, Greece, Italy, Malta, Montenegro, North
// Macedonia, Portugal, San Marino, Serbia, Slovenia, Spain) — NOT the other
// 123 UN members yet. See that doc's migration plan.
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
  { id: '068', name: 'Bolivia' },
  { id: '152', name: 'Chile' },
  { id: '170', name: 'Colombia' },
  { id: '218', name: 'Ecuador' },
  { id: '328', name: 'Guyana' },
  { id: '600', name: 'Paraguay' },
  { id: '740', name: 'Suriname' },
  { id: '858', name: 'Uruguay' },
  { id: '862', name: 'Venezuela' },
  { id: '028', name: 'Antigua and Barbuda' },
  { id: '044', name: 'Bahamas' },
  { id: '052', name: 'Barbados' },
  { id: '192', name: 'Cuba' },
  { id: '212', name: 'Dominica' },
  { id: '214', name: 'Dominican Republic' },
  { id: '308', name: 'Grenada' },
  { id: '332', name: 'Haiti' },
  { id: '388', name: 'Jamaica' },
  { id: '659', name: 'Saint Kitts and Nevis' },
  { id: '662', name: 'Saint Lucia' },
  { id: '670', name: 'Saint Vincent and the Grenadines' },
  { id: '780', name: 'Trinidad and Tobago' },
  { id: '208', name: 'Denmark' },
  { id: '233', name: 'Estonia' },
  { id: '246', name: 'Finland' },
  { id: '352', name: 'Iceland' },
  { id: '372', name: 'Ireland' },
  { id: '428', name: 'Latvia' },
  { id: '440', name: 'Lithuania' },
  { id: '578', name: 'Norway' },
  { id: '752', name: 'Sweden' },
  { id: '826', name: 'United Kingdom' },
  { id: '040', name: 'Austria' },
  { id: '056', name: 'Belgium' },
  { id: '438', name: 'Liechtenstein' },
  { id: '442', name: 'Luxembourg' },
  { id: '492', name: 'Monaco' },
  { id: '528', name: 'Netherlands' },
  { id: '756', name: 'Switzerland' },
  { id: '008', name: 'Albania' },
  { id: '020', name: 'Andorra' },
  { id: '070', name: 'Bosnia and Herzegovina' },
  { id: '191', name: 'Croatia' },
  { id: '300', name: 'Greece' },
  { id: '470', name: 'Malta' },
  { id: '499', name: 'Montenegro' },
  { id: '807', name: 'North Macedonia' },
  { id: '674', name: 'San Marino' },
  { id: '688', name: 'Serbia' },
  { id: '705', name: 'Slovenia' },
  { id: '620', name: 'Portugal' },
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

// Mexico (484), Brazil (076), Peru (604), and Argentina (032) are
// state-sharded (scripts/buildCityBoundaries.mjs's shardByState()) — the
// state abbreviation comes from each shard's own filename, since nothing in
// a Mexican municipio's, Brazilian município's, Peruvian distrito's, or
// Argentine locality's own properties carries it (see shardByState()'s own
// comment for why this had to be a real spatial join against Natural
// Earth's admin-1 polygons in the first place).
function addFromShardedDir(countryId) {
  const shardDir = `public/geo/city-boundaries/${countryId}`
  for (const shardFile of fs.readdirSync(shardDir)) {
    const stateAbbrev = shardFile.replace('.json', '')
    const fc = JSON.parse(fs.readFileSync(`${shardDir}/${shardFile}`, 'utf8'))
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
        stateAbbrev,
      })
    }
  }
}
addFromShardedDir('484')
addFromShardedDir('076')
addFromShardedDir('604')
addFromShardedDir('032')
addFromShardedDir('250')
addFromShardedDir('276')
addFromShardedDir('380')
addFromShardedDir('724')

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
  `Wrote ${OUTPUT}: ${entries.length} entries (${perCountryCounts}, Mexico ${entries.filter((e) => e.countryId === '484').length}, Brazil ${entries.filter((e) => e.countryId === '076').length}, Peru ${entries.filter((e) => e.countryId === '604').length}, Argentina ${entries.filter((e) => e.countryId === '032').length}, France ${entries.filter((e) => e.countryId === '250').length}, Germany ${entries.filter((e) => e.countryId === '276').length}, Italy ${entries.filter((e) => e.countryId === '380').length}, Spain ${entries.filter((e) => e.countryId === '724').length}, US ${entries.filter((e) => e.countryId === '840').length}), ${(kb / 1024).toFixed(1)} MB`,
)
