// Derives the small, always-eager-fetched city index scene/useCityIndex.ts
// fetches (public/geo/city-boundaries-index.json) — the label-reveal +
// search source for every country scripts/buildCityBoundaries.mjs has real
// boundary data for. Purely local file reads (the already-written
// public/geo/city-boundaries/{countryId}[.json|/{state}.json] files) — NO
// Overpass/geoBoundaries network calls, so this can be re-run any time
// without depending on those sometimes-unreachable sources being up (see
// buildCityBoundaries.mjs's own comment on that).
//
// Covers all 193 UN member states as of the Thirtieth pass (Russia,
// 2026-09-19) — see city-boundaries-architecture.md's migration plan for
// the full per-region pass history. US (840) reads through the same
// addFromShardedDir() path as every other state-sharded country (Thirty-
// first pass, 2026-09-21) — it used to read public/geo/us-cities-index.json
// directly, the last consumer of that now-retired file; see this repo's own
// city-boundaries-architecture.md for why.
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
  { id: '112', name: 'Belarus' },
  { id: '100', name: 'Bulgaria' },
  { id: '203', name: 'Czechia' },
  { id: '348', name: 'Hungary' },
  { id: '498', name: 'Moldova' },
  { id: '616', name: 'Poland' },
  { id: '642', name: 'Romania' },
  { id: '703', name: 'Slovakia' },
  { id: '804', name: 'Ukraine' },
  { id: '196', name: 'Cyprus' },
  { id: '760', name: 'Syria' },
  { id: '792', name: 'Turkey' },
  { id: '048', name: 'Bahrain' },
  { id: '368', name: 'Iraq' },
  { id: '512', name: 'Oman' },
  { id: '634', name: 'Qatar' },
  { id: '682', name: 'Saudi Arabia' },
  { id: '887', name: 'Yemen' },
  { id: '364', name: 'Iran' },
  { id: '376', name: 'Israel' },
  { id: '422', name: 'Lebanon' },
  { id: '784', name: 'United Arab Emirates' },
  { id: '051', name: 'Armenia' },
  { id: '031', name: 'Azerbaijan' },
  { id: '268', name: 'Georgia' },
  { id: '860', name: 'Uzbekistan' },
  { id: '417', name: 'Kyrgyzstan' },
  { id: '795', name: 'Turkmenistan' },
  { id: '398', name: 'Kazakhstan' },
  { id: '762', name: 'Tajikistan' },
  { id: '004', name: 'Afghanistan' },
  { id: '586', name: 'Pakistan' },
  { id: '524', name: 'Nepal' },
  { id: '064', name: 'Bhutan' },
  { id: '050', name: 'Bangladesh' },
  { id: '144', name: 'Sri Lanka' },
  { id: '462', name: 'Maldives' },
  { id: '392', name: 'Japan' },
  { id: '496', name: 'Mongolia' },
  { id: '408', name: 'North Korea' },
  { id: '410', name: 'South Korea' },
  { id: '096', name: 'Brunei' },
  { id: '116', name: 'Cambodia' },
  { id: '418', name: 'Laos' },
  { id: '458', name: 'Malaysia' },
  { id: '104', name: 'Myanmar' },
  { id: '608', name: 'Philippines' },
  { id: '702', name: 'Singapore' },
  { id: '764', name: 'Thailand' },
  { id: '626', name: 'Timor-Leste' },
  { id: '704', name: 'Vietnam' },
  { id: '036', name: 'Australia' },
  { id: '242', name: 'Fiji' },
  { id: '296', name: 'Kiribati' },
  { id: '584', name: 'Marshall Islands' },
  { id: '583', name: 'Micronesia' },
  { id: '520', name: 'Nauru' },
  { id: '554', name: 'New Zealand' },
  { id: '585', name: 'Palau' },
  { id: '598', name: 'Papua New Guinea' },
  { id: '882', name: 'Samoa' },
  { id: '090', name: 'Solomon Islands' },
  { id: '776', name: 'Tonga' },
  { id: '798', name: 'Tuvalu' },
  { id: '548', name: 'Vanuatu' },
  { id: '012', name: 'Algeria' },
  { id: '818', name: 'Egypt' },
  { id: '434', name: 'Libya' },
  { id: '504', name: 'Morocco' },
  { id: '729', name: 'Sudan' },
  { id: '728', name: 'South Sudan' },
  { id: '788', name: 'Tunisia' },
  { id: '204', name: 'Benin' },
  { id: '854', name: 'Burkina Faso' },
  { id: '132', name: 'Cabo Verde' },
  { id: '384', name: "Côte d'Ivoire" },
  { id: '270', name: 'Gambia' },
  { id: '288', name: 'Ghana' },
  { id: '324', name: 'Guinea' },
  { id: '624', name: 'Guinea-Bissau' },
  { id: '430', name: 'Liberia' },
  { id: '466', name: 'Mali' },
  { id: '478', name: 'Mauritania' },
  { id: '562', name: 'Niger' },
  { id: '566', name: 'Nigeria' },
  { id: '686', name: 'Senegal' },
  { id: '694', name: 'Sierra Leone' },
  { id: '768', name: 'Togo' },
  { id: '120', name: 'Cameroon' },
  { id: '140', name: 'Central African Republic' },
  { id: '148', name: 'Chad' },
  { id: '178', name: 'Congo' },
  { id: '180', name: 'DR Congo' },
  { id: '226', name: 'Equatorial Guinea' },
  { id: '266', name: 'Gabon' },
  { id: '678', name: 'Sao Tome and Principe' },
  { id: '108', name: 'Burundi' },
  { id: '174', name: 'Comoros' },
  { id: '262', name: 'Djibouti' },
  { id: '232', name: 'Eritrea' },
  { id: '231', name: 'Ethiopia' },
  { id: '404', name: 'Kenya' },
  { id: '450', name: 'Madagascar' },
  { id: '454', name: 'Malawi' },
  { id: '480', name: 'Mauritius' },
  { id: '508', name: 'Mozambique' },
  { id: '646', name: 'Rwanda' },
  { id: '690', name: 'Seychelles' },
  { id: '706', name: 'Somalia' },
  { id: '834', name: 'Tanzania' },
  { id: '800', name: 'Uganda' },
  { id: '894', name: 'Zambia' },
  { id: '716', name: 'Zimbabwe' },
  { id: '024', name: 'Angola' },
  { id: '072', name: 'Botswana' },
  { id: '748', name: 'Eswatini' },
  { id: '426', name: 'Lesotho' },
  { id: '710', name: 'South Africa' },
  { id: '516', name: 'Namibia' },
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
addFromShardedDir('156')
addFromShardedDir('360')
addFromShardedDir('356')
addFromShardedDir('643')
addFromShardedDir('840')

const SHARDED_COUNTRIES = [
  { id: '484', name: 'Mexico' },
  { id: '076', name: 'Brazil' },
  { id: '604', name: 'Peru' },
  { id: '032', name: 'Argentina' },
  { id: '250', name: 'France' },
  { id: '276', name: 'Germany' },
  { id: '380', name: 'Italy' },
  { id: '724', name: 'Spain' },
  { id: '156', name: 'China' },
  { id: '360', name: 'Indonesia' },
  { id: '356', name: 'India' },
  { id: '643', name: 'Russia' },
  { id: '840', name: 'US' },
]

fs.writeFileSync(OUTPUT, JSON.stringify(entries))
const kb = fs.statSync(OUTPUT).size / 1024
const perCountryCounts = [...BOUNDARY_COUNTRIES, ...SHARDED_COUNTRIES].map(
  (c) => `${c.name} ${entries.filter((e) => e.countryId === c.id).length}`,
).join(', ')
console.log(
  `Wrote ${OUTPUT}: ${entries.length} entries across ${BOUNDARY_COUNTRIES.length + SHARDED_COUNTRIES.length} countries (${perCountryCounts}), ${(kb / 1024).toFixed(1)} MB`,
)
