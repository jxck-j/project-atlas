// Build-time asset generator: real per-city boundary polygons, for the
// three countries city-boundaries-architecture.md's investigation has
// actually verified a real source for so far (Jordan, Kuwait, US) — NOT the
// other 190 UN members yet. See that doc's "Fifth pass" section for the
// proof-of-concept this formalizes, and its migration plan step 2/3 for
// what's still open after this (the plausibility threshold is a real,
// logged judgment call below, not a settled constant; the consumer side —
// CityLabels.tsx/CityOutlineHighlight.tsx — hasn't been touched).
//
// NOT part of `npm run build:geo` and NOT wired into any component yet —
// run by hand via `npm run build:geo:city-boundaries` for inspection.
//
// Two different sourcing paths per country:
//   - Jordan: OSM admin_level=6 (Qada/Nahia sub-districts), fetched live via
//     Overpass, run through the real per-feature point-in-polygon + area
//     join against this project's own already-shipped GeoNames city index
//     (public/geo/global-cities{-headline,}/*.json — no new city sourcing).
//   - Kuwait: geoBoundaries' own ADM2 GeoJSON, downloaded directly, same
//     per-feature join.
//   - US: NO join at all — buildUsCitiesData.mjs's existing Census Places
//     output (public/geo/us-cities-index.json + us-cities/*.json) is
//     already real, official, city-scale data; this script only reshapes it
//     into the same per-country output format the other two produce,
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
import { pointInGeometry, geometryAreaSqKm } from './lib/sphericalGeometry.mjs'
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

async function fetchWithRetry(fn, attempts = 4) {
  let lastErr
  for (let i = 0; i < attempts; i++) {
    try {
      return await fn()
    } catch (err) {
      lastErr = err
      await new Promise((r) => setTimeout(r, 4000 * (i + 1)))
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
    kept.push({
      type: 'Feature',
      id: city.id,
      geometry: hit.geometry,
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

// --- Kuwait (numeric id 414, alpha3 KWT) ---
console.log('\n=== Kuwait ===')
const kwtMeta = await fetchWithRetry(async () => {
  const res = await fetch('https://www.geoboundaries.org/api/current/gbOpen/KWT/ALL/')
  if (!res.ok) throw new Error(`geoBoundaries ${res.status}`)
  return res.json()
})
const kwtAdm2Meta = kwtMeta.find((l) => l.boundaryType === 'ADM2')
const kuwaitGeo = await fetchWithRetry(async () => {
  const res = await fetch(kwtAdm2Meta.gjDownloadURL)
  if (!res.ok) throw new Error(`geoBoundaries geojson ${res.status}`)
  return res.json()
})
const kuwaitCandidates = kuwaitGeo.features.map((f) => ({ name: f.properties.shapeName, geometry: f.geometry, source: 'geoboundaries-adm2' }))
const kuwaitCities = loadCityPoints('414')
const kuwaitJoin = joinCityPointsToPolygons('Kuwait', kuwaitCities, kuwaitCandidates)
writeCountryOutput('414', kuwaitJoin.kept)
report.kuwait = kuwaitJoin.report

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
console.log(`\nWrote ${REPORT_OUTPUT} (unmatched/rejected detail for Jordan and Kuwait — US has no join to report on).`)
