// Build-time asset generator: real per-city boundary polygons, for the
// countries city-boundaries-architecture.md's investigation has actually
// verified a real source for so far (Jordan, Kuwait, US, plus the 2026-09-04
// Central America pass: Costa Rica, El Salvador, Guatemala, Honduras,
// Nicaragua, Panama, Belize) — NOT the other 183 UN members yet. See that
// doc's "Fifth pass" section for the original proof-of-concept this
// formalizes, and its migration plan step 2/3 for what's still open after
// this (the plausibility threshold is a real, logged judgment call below,
// not a settled constant).
//
// NOT part of `npm run build:geo` — run by hand via
// `npm run build:geo:city-boundaries` (then
// `npm run build:geo:city-boundaries-index` to refresh the consumer-facing
// index) whenever a new country's source is added or an existing one needs
// re-fetching.
//
// Three different sourcing paths per country:
//   - OSM, directly queried (Jordan's admin_level=6 Qada/Nahia sub-districts;
//     Belize's hand-curated 9-municipality name list, since its OSM tagging
//     splits real towns across admin_level 7 and 8 mixed with unrelated
//     villages — see the Belize block's own comment) — fetched live via
//     Overpass, run through the real per-feature point-in-polygon + area
//     join against this project's own already-shipped GeoNames city index
//     (public/geo/global-cities{-headline,}/*.json — no new city sourcing).
//   - geoBoundaries, a single ADM level's own GeoJSON downloaded directly
//     (Kuwait's ADM2; the Central America six's own confirmed level — see
//     runGeoBoundariesCountry() and city-boundaries-architecture.md for the
//     independent-source citation each was checked against before trusting
//     geoBoundaries' own canonicalName, which is sometimes blank or wrong —
//     Belize's "Constituencies" is the reason this isn't assumed blindly),
//     same per-feature join.
//   - US: NO join at all — buildUsCitiesData.mjs's existing Census Places
//     output (public/geo/us-cities-index.json + us-cities/*.json) is
//     already real, official, city-scale data; this script only reshapes it
//     into the same per-country output format the other sources produce,
//     exactly as city-boundaries-architecture.md's "Second refinement"
//     section calls for ("the right move is to feed that existing output
//     into the unified per-country shard format directly, not re-derive
//     similar data from OSM").
//
// Output: public/geo/city-boundaries/{countryId}.json (a GeoJSON
// FeatureCollection per country, id/geometry/properties.name shape matching
// us-cities/{state}.json's existing convention) + a JSON report
// (scripts/cityBoundariesReport.json) of every unmatched/rejected city, per
// the "report, don't silently drop" discipline buildGeoEntityEconomics.mjs
// and researchCityAdminLevels.mjs already established in this repo.
import fs from 'node:fs'
import { pointInGeometry, geometryAreaSqKm, simplifyGeometry } from './lib/sphericalGeometry.mjs'
import { relationToGeometry } from './lib/osmRelationToGeometry.mjs'

const HEADLINE_INDEX = 'public/geo/global-cities-headline.json'
const DETAIL_SHARD_DIR = 'public/geo/global-cities'
const US_INDEX = 'public/geo/us-cities-index.json'
const US_SHARD_DIR = 'public/geo/us-cities'
const OUTPUT_DIR = 'public/geo/city-boundaries'
const REPORT_OUTPUT = 'scripts/cityBoundariesReport.json'

// overpass-api.de/overpass.kumi.systems are unreachable from this
// environment (connection timeout — see city-boundaries-architecture.md's
// "Fourth pass"); overpass.openstreetmap.fr is reachable but
// whitelist-gated (403). This mirror works with a real User-Agent.
const OVERPASS = 'https://overpass.private.coffee/api/interpreter'
const OVERPASS_USER_AGENT = 'project-atlas-city-boundary-build/1.0 (github.com project-atlas, one-off build script)'

// Below this, a matched polygon is kept unconditionally.
const SOFT_MAX_SQKM = 2000
// A city with real population gets this looser ceiling instead of
// SOFT_MAX_SQKM — real towns/cities can legitimately sit inside an
// otherwise-large administrative unit (Aqaba, Jordan: a real 95,048-person
// city, lands in a 2,042 km² qada — 42 km² over SOFT_MAX_SQKM). A coarse
// boundary for a real city beats no boundary at all; the same leniency for
// an unpopulated/tiny named place matched to an equally large polygon would
// more often mean "this point just happens to fall inside mostly-empty
// rural land," which is why the looser ceiling isn't applied
// unconditionally. Still finite, not infinite — a polygon this large
// (Qada Al-Jafr, 28,170 km²; Ruwayshid, 21,523 km², both real Jordan
// findings) is a desert sub-district regardless of which city fell inside
// it. This is a real, deliberate judgment call, not a validated constant —
// see city-boundaries-architecture.md's Fifth pass section for the Aqaba
// case this was tuned against.
//
// Deliberately NOT keyed off global-cities-headline.json's own
// HEADLINE_POPULATION_FLOOR (200,000) — that constant answers a different
// question (which cities are worth eager-fetching globally) and is far
// higher than what should grant area leniency here. Using it directly was
// a real bug caught by this file's own motivating test case: Aqaba
// (95,048) still got rejected on the first run because 95,048 < 200,000,
// even though the whole point of this ceiling is to keep cities exactly
// like Aqaba. SUBSTANTIAL_POPULATION_FLOOR is its own, independent, much
// lower bar for this one decision.
const SUBSTANTIAL_POPULATION_FLOOR = 10_000
const LOOSE_MAX_SQKM = 5000

// Applied to every kept feature's geometry before writing output — added
// 2026-09-05 after the Central America pass revealed some countries'
// geoBoundaries downloads are unsimplified full-resolution source
// shapefiles, not pre-simplified data: Panama's raw join produced a 291MB
// single-country file (one corregimiento, "Arco Iris," had 631,536 points
// on its own), Honduras 159MB — nothing like Jordan/Kuwait's much lighter
// geometry. 0.001deg (~111m at the equator) cuts a typical feature from
// ~12,850 points to ~342 with under 0.2% area distortion, and even that
// extreme outlier down to ~9,200 points at under 1% distortion — real
// values checked against sphericalGeometry.mjs's own geometryAreaSqKm
// before picking this constant, not guessed. Jordan/Kuwait's already-modest
// geometry is barely touched by this (their features never had anywhere
// near this vertex density to begin with).
const SIMPLIFY_EPSILON_DEG = 0.001

async function fetchWithRetry(fn, attempts = 6) {
  let lastErr
  for (let i = 0; i < attempts; i++) {
    try {
      return await fn()
    } catch (err) {
      lastErr = err
      console.log(`  [retry ${i + 1}/${attempts}] ${err.message}`)
      await new Promise((r) => setTimeout(r, 5000 * (i + 1)))
    }
  }
  throw lastErr
}

async function fetchOverpass(query) {
  const res = await fetch(OVERPASS, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'User-Agent': OVERPASS_USER_AGENT },
    body: 'data=' + encodeURIComponent(query),
  })
  if (!res.ok) throw new Error(`Overpass ${res.status}`)
  return res.json()
}

function loadCityPoints(countryId) {
  const headline = JSON.parse(fs.readFileSync(HEADLINE_INDEX, 'utf8')).filter((e) => e.parentCountryId === countryId)
  const detailPath = `${DETAIL_SHARD_DIR}/${countryId}.json`
  const detail = fs.existsSync(detailPath) ? JSON.parse(fs.readFileSync(detailPath, 'utf8')) : []
  return [...headline, ...detail]
}

// The real per-feature join: for every GeoNames point, find the containing
// candidate polygon and decide whether to keep it, per the threshold policy
// above. Returns { kept: Feature[], report: {...} }.
function joinCityPointsToPolygons(countryName, cities, candidates) {
  const withArea = candidates.map((c) => ({ ...c, areaSqKm: geometryAreaSqKm(c.geometry) }))
  const kept = []
  const unmatched = []
  const rejected = []

  for (const city of cities) {
    const point = [city.lng, city.lat]
    const hit = withArea.find((c) => {
      try {
        return pointInGeometry(point, c.geometry)
      } catch {
        return false
      }
    })
    if (!hit) {
      unmatched.push({ name: city.name, population: city.population, lat: city.lat, lng: city.lng })
      continue
    }
    const isSubstantial = city.isCapital || city.population >= SUBSTANTIAL_POPULATION_FLOOR
    const ceiling = isSubstantial ? LOOSE_MAX_SQKM : SOFT_MAX_SQKM
    if (hit.areaSqKm > ceiling) {
      rejected.push({ name: city.name, population: city.population, matchedTo: hit.name, areaSqKm: Math.round(hit.areaSqKm * 10) / 10, isSubstantial })
      continue
    }
    // Memoized per candidate polygon (not per matched city) — more than one
    // city can land in the same administrative unit, and Douglas-Peucker
    // over a 600K-point ring isn't free enough to redo per match.
    if (!hit.simplifiedGeometry) hit.simplifiedGeometry = simplifyGeometry(hit.geometry, SIMPLIFY_EPSILON_DEG)
    kept.push({
      type: 'Feature',
      id: city.id,
      geometry: hit.simplifiedGeometry,
      properties: { name: city.name, population: city.population, isCapital: Boolean(city.isCapital), areaSqKm: Math.round(hit.areaSqKm * 10) / 10, source: hit.source, matchedAdminUnit: hit.name },
    })
  }

  console.log(`  ${countryName}: ${cities.length} points -> ${kept.length} kept, ${rejected.length} rejected (too large), ${unmatched.length} unmatched (no containing polygon)`)
  return { kept, report: { unmatched, rejected } }
}

function writeCountryOutput(countryId, features) {
  fs.mkdirSync(OUTPUT_DIR, { recursive: true })
  const output = `${OUTPUT_DIR}/${countryId}.json`
  fs.writeFileSync(output, JSON.stringify({ type: 'FeatureCollection', features }))
  const kb = fs.statSync(output).size / 1024
  console.log(`  wrote ${output}: ${features.length} features, ${kb.toFixed(0)} KB`)
}

const report = {}

// --- Jordan (numeric id 400, alpha3 JOR) ---
console.log('\n=== Jordan ===')
const jordanRaw = await fetchWithRetry(() =>
  fetchOverpass(`[out:json][timeout:180];
area["ISO3166-1"="JO"][admin_level=2];
relation(area)["boundary"="administrative"]["admin_level"="6"];
out geom;`),
)
let unclosedCount = 0
const jordanCandidates = jordanRaw.elements.map((rel) => {
  const { geometry, closed } = relationToGeometry(rel)
  if (!closed) unclosedCount++
  return { name: rel.tags?.name ?? `relation/${rel.id}`, geometry, source: 'osm-admin6' }
})
if (unclosedCount > 0) console.log(`  [warn] ${unclosedCount} Jordan relations had an unclosed ring — kept anyway, area may be inaccurate for those`)
const jordanCities = loadCityPoints('400')
const jordanJoin = joinCityPointsToPolygons('Jordan', jordanCities, jordanCandidates)
writeCountryOutput('400', jordanJoin.kept)
report.jordan = jordanJoin.report

// Real per-feature join against a single geoBoundaries ADM level's own
// GeoJSON — the pattern Kuwait's Fifth/Sixth pass established. Reused for
// every country below whose recon (researchCityAdminLevels.mjs) AND a real
// independent-source cross-check (not just the geoBoundaries metadata's own
// canonicalName, which is sometimes blank/wrong — see city-boundaries-
// architecture.md's Belize finding) confirmed the level is a genuine
// settlement-scale hierarchy (municipio/distrito/corregimiento), not
// something that looks small on paper but isn't (Jordan's mislabeled Liwa,
// Belize's electoral constituencies).
async function runGeoBoundariesCountry({ name, numericId, alpha3, admLevel }) {
  console.log(`\n=== ${name} ===`)
  const meta = await fetchWithRetry(async () => {
    const res = await fetch(`https://www.geoboundaries.org/api/current/gbOpen/${alpha3}/ALL/`)
    if (!res.ok) throw new Error(`geoBoundaries ${res.status}`)
    return res.json()
  })
  const admMeta = meta.find((l) => l.boundaryType === admLevel)
  if (!admMeta) throw new Error(`${name}: geoBoundaries has no ${admLevel} for ${alpha3}`)
  const geo = await fetchWithRetry(async () => {
    const res = await fetch(admMeta.gjDownloadURL)
    if (!res.ok) throw new Error(`geoBoundaries geojson ${res.status}`)
    return res.json()
  })
  const candidates = geo.features.map((f) => ({
    name: f.properties.shapeName,
    geometry: f.geometry,
    source: `geoboundaries-${admLevel.toLowerCase()}`,
  }))
  const cities = loadCityPoints(numericId)
  const join = joinCityPointsToPolygons(name, cities, candidates)
  writeCountryOutput(numericId, join.kept)
  return join.report
}

// --- Kuwait (numeric id 414, alpha3 KWT) ---
report.kuwait = await runGeoBoundariesCountry({ name: 'Kuwait', numericId: '414', alpha3: 'KWT', admLevel: 'ADM2' })

// --- Central America pass (2026-09-04) ---
// Six of the seven Central American UN members have a real, independently-
// confirmed settlement-scale geoBoundaries level (see
// city-boundaries-architecture.md's Central America section for the
// citations each was checked against): Costa Rica's Distritos (ADM3),
// El Salvador/Guatemala/Honduras's Municipios (ADM2), Nicaragua's Municipios
// (ADM2), Panama's Corregimientos (ADM3). Belize is the seventh and is
// handled separately below — its geoBoundaries ADM2 is electoral
// constituencies, not settlements, so it needs a real OSM source instead.
report.costaRica = await runGeoBoundariesCountry({ name: 'Costa Rica', numericId: '188', alpha3: 'CRI', admLevel: 'ADM3' })
report.elSalvador = await runGeoBoundariesCountry({ name: 'El Salvador', numericId: '222', alpha3: 'SLV', admLevel: 'ADM2' })
report.guatemala = await runGeoBoundariesCountry({ name: 'Guatemala', numericId: '320', alpha3: 'GTM', admLevel: 'ADM2' })
report.honduras = await runGeoBoundariesCountry({ name: 'Honduras', numericId: '340', alpha3: 'HND', admLevel: 'ADM2' })
report.nicaragua = await runGeoBoundariesCountry({ name: 'Nicaragua', numericId: '558', alpha3: 'NIC', admLevel: 'ADM2' })
report.panama = await runGeoBoundariesCountry({ name: 'Panama', numericId: '591', alpha3: 'PAN', admLevel: 'ADM3' })

// --- Belize (numeric id 084, alpha3 BLZ) ---
// geoBoundaries' only sub-national level for Belize is electoral
// constituencies (cross-cutting political geography, not nested
// settlements — confirmed against Belize's Local Government History wiki
// and the 2021 municipal elections article). Belize's real 9 municipalities
// (2 cities, 7 towns, each with its own elected council) DO exist in OSM,
// but inconsistently tagged across two admin_levels — Belize City/Belmopan/
// the combined "San Ignacio & Santa Elena" twin-town council sit at
// admin_level=7, while the other 6 towns sit at admin_level=8 mixed in
// with unrelated unincorporated villages (Spanish Lookout, Ladyville, ...)
// tagged at that same level — the same "admin_level isn't consistent
// enough to hardcode" lesson Kuwait already taught. With only 9 real
// municipalities to find, a hand-curated name list (verified against the
// real query results, not assumed) is simpler and more correct than trying
// to infer "real municipality vs. informal village" from tags alone.
console.log('\n=== Belize ===')
const BELIZE_MUNICIPALITY_NAMES = new Set([
  'Belize City',
  'Belmopan',
  'San Ignacio & Santa Elena',
  'Orange Walk Town',
  'Corozal Town',
  'Dangriga Town',
  'San Pedro Town',
  'Benque Viejo del Carmen',
  'Punta Gorda Town',
])
const belizeRaw = await fetchWithRetry(() =>
  fetchOverpass(`[out:json][timeout:180];
area["ISO3166-1"="BZ"][admin_level=2];
relation(area)["boundary"="administrative"]["admin_level"~"^(7|8)$"];
out geom;`),
)
const belizeCandidates = belizeRaw.elements
  .filter((rel) => BELIZE_MUNICIPALITY_NAMES.has(rel.tags?.name))
  .map((rel) => {
    const { geometry } = relationToGeometry(rel)
    return { name: rel.tags.name, geometry, source: 'osm-municipality' }
  })
if (belizeCandidates.length !== BELIZE_MUNICIPALITY_NAMES.size) {
  console.log(
    `  [warn] expected ${BELIZE_MUNICIPALITY_NAMES.size} Belize municipalities, found ${belizeCandidates.length} — OSM tagging may have changed since this list was curated (2026-09-04)`,
  )
}
const belizeCities = loadCityPoints('084')
const belizeJoin = joinCityPointsToPolygons('Belize', belizeCities, belizeCandidates)
writeCountryOutput('084', belizeJoin.kept)
report.belize = belizeJoin.report

// --- US (numeric id 840) — reuse buildUsCitiesData.mjs's existing Census
// Places output directly. No join, no area threshold: Census Places are
// already real, official city-scale boundaries by construction.
//
// Deliberately kept SHARDED BY STATE (public/geo/city-boundaries/840/{state}.json),
// NOT merged into one public/geo/city-boundaries/840.json the way Jordan/
// Kuwait's much smaller datasets are. A first version of this script did
// merge it - 32,608 features into one 49 MB file - which silently
// reintroduced exactly the "huge flat file, eager-fetched in full" problem
// city-boundaries-architecture.md's two-tier GeoNames index (headline +
// per-country detail shards) was built specifically to avoid, just one
// layer down (per-country instead of global). us-cities/{state}.json's
// existing per-state sharding already solves this correctly for the one
// country large enough to need it; collapsing it back down was a
// regression, not a simplification, caught by checking the actual output
// file size rather than assuming "reuse the existing data" meant "reuse it
// as a single file."
console.log('\n=== United States (reused from existing Census pipeline, kept sharded by state) ===')
const usIndex = JSON.parse(fs.readFileSync(US_INDEX, 'utf8'))
const usIndexById = new Map(usIndex.map((e) => [e.id, e]))
const usOutputDir = `${OUTPUT_DIR}/840`
fs.mkdirSync(usOutputDir, { recursive: true })
let usFeatureTotal = 0
let usTotalKB = 0
for (const stateFile of fs.readdirSync(US_SHARD_DIR)) {
  const fc = JSON.parse(fs.readFileSync(`${US_SHARD_DIR}/${stateFile}`, 'utf8'))
  const features = fc.features.map((feature) => {
    const indexEntry = usIndexById.get(feature.id)
    return {
      type: 'Feature',
      id: feature.id,
      geometry: feature.geometry,
      properties: {
        name: feature.properties.name,
        population: indexEntry?.population ?? null,
        isCapital: Boolean(indexEntry?.isStateCapital),
        areaSqKm: null, // not computed for US - Census Places are trusted as-is, no plausibility filter applied
        source: 'census-places',
        matchedAdminUnit: null,
      },
    }
  })
  const outputPath = `${usOutputDir}/${stateFile}`
  fs.writeFileSync(outputPath, JSON.stringify({ type: 'FeatureCollection', features }))
  usFeatureTotal += features.length
  usTotalKB += fs.statSync(outputPath).size / 1024
}
console.log(`  ${usFeatureTotal} Census Places carried over unchanged across ${fs.readdirSync(US_SHARD_DIR).length} per-state files in ${usOutputDir}/ (${(usTotalKB / 1024).toFixed(1)} MB combined, avg ${(usTotalKB / fs.readdirSync(US_SHARD_DIR).length).toFixed(0)} KB/state)`)

fs.writeFileSync(REPORT_OUTPUT, JSON.stringify(report, null, 2))
console.log(`\nWrote ${REPORT_OUTPUT} (unmatched/rejected detail for every joined country — US has no join to report on).`)
