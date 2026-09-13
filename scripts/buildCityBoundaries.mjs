// Build-time asset generator: real per-city boundary polygons, for the
// countries city-boundaries-architecture.md's investigation has actually
// verified a real source for so far (Jordan, Kuwait, US, the 2026-09-04
// Central America pass: Costa Rica, El Salvador, Guatemala, Honduras,
// Nicaragua, Panama, Belize, the 2026-09-05 Canada/Mexico pass, the
// 2026-09-05 South America pass: Argentina, Bolivia, Brazil, Chile,
// Colombia, Ecuador, Guyana, Paraguay, Peru, Suriname, Uruguay, Venezuela,
// plus the 2026-09-12 Caribbean pass: Antigua and Barbuda, Bahamas,
// Barbados, Cuba, Dominica, Dominican Republic, Grenada, Haiti, Jamaica,
// Saint Kitts and Nevis, Saint Lucia, Saint Vincent and the Grenadines,
// Trinidad and Tobago) — NOT the other 156 UN members yet. See that doc's "Fifth pass" section
// for the original proof-of-concept this formalizes, and its migration plan
// step 2/3 for what's still open after this (the plausibility threshold is
// a real, logged judgment call below, not a settled constant).
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
import { pointInGeometry, geometryAreaSqKm, geometryCentroid, simplifyGeometry, distanceToGeometryKm } from './lib/sphericalGeometry.mjs'
import { relationToGeometry } from './lib/osmRelationToGeometry.mjs'

const HEADLINE_INDEX = 'public/geo/global-cities-headline.json'
const DETAIL_SHARD_DIR = 'public/geo/global-cities'
const US_INDEX = 'public/geo/us-cities-index.json'
const US_SHARD_DIR = 'public/geo/us-cities'
const OUTPUT_DIR = 'public/geo/city-boundaries'
const REPORT_OUTPUT = 'scripts/cityBoundariesReport.json'

// overpass.private.coffee (used through the Fourth/Fifth/Eighth/Ninth
// passes) was itself a fallback from overpass-api.de/overpass.kumi.systems,
// logged back then as unreachable from this environment (connection
// timeout) — overpass.openstreetmap.fr is reachable but whitelist-gated
// (403). private.coffee then went flaky in the other direction during the
// Ninth pass (connected-and-never-responded) and again during this South
// America pass (repeated 504s on Jordan's own query — unchanged from every
// prior successful run — not a query regression). Re-checked overpass-api.de
// directly this pass and found it reachable, fast, and able to handle even
// Peru's ~1,900-relation nationwide query (~9s for a full out-geom fetch) —
// switched to it as the one Overpass endpoint this script uses, rather than
// keep alternating mirrors per-country. SKIP_OSM below exists specifically
// to let a re-run skip the OSM-dependent countries (Jordan, Belize, Guyana,
// Peru) without blocking on Overpass at all.
const OVERPASS = 'https://overpass-api.de/api/interpreter'
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

// Applied only to points that failed the normal containment check — see
// distanceToGeometryKm's own comment for the real case this was built
// against (Haiti's Saint-Marc/Cite Soleil/Jeremie/Grand Gosier, all real
// cities whose correct polygon exists within tens of meters, not km, of the
// GeoNames point). 2km is deliberately generous relative to that real
// motivating case, not tight-fit to it — it's still small enough that a
// genuine structural gap (Colombia's Puerto Escondido/Nuqui/Necocli, which
// is_in() confirmed has NO containing boundary in either source at ANY
// admin level, meaning the nearest real candidate is typically many km
// away) won't get incorrectly snapped to a distant, wrong polygon.
const SNAP_MAX_KM = 2

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

async function fetchOverpass(query, endpoint = OVERPASS) {
  const res = await fetch(endpoint, {
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

// Diacritic/case/whitespace-insensitive compare, for the snap fallback's
// name-preference tie-break below — GeoNames and geoBoundaries/OSM
// routinely spell the same real place differently (Cité Soleil vs. Cite
// Soleil, Jérémie vs. Jeremie, Port-à-Piment vs. Port a Piment), so an
// exact-string compare would miss every real match.
function normalizeName(name) {
  return name
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .replace(/[^a-z0-9]/gi, '')
    .toLowerCase()
}

// The real per-feature join: for every GeoNames point, find the containing
// candidate polygon and decide whether to keep it, per the threshold policy
// above. Returns { kept: Feature[], report: {...} }.
function joinCityPointsToPolygons(countryName, cities, candidates) {
  const withArea = candidates.map((c) => ({ ...c, areaSqKm: geometryAreaSqKm(c.geometry) }))
  const kept = []
  const unmatched = []
  const rejected = []
  const snapped = []

  for (const city of cities) {
    const point = [city.lng, city.lat]
    // Smallest containing polygon wins, not just the first one found — a
    // no-op for every single-admin-level source (Jordan's admin_level=6,
    // Peru's =8, every geoBoundaries ADM level: a clean partition, so at
    // most one candidate ever contains a given point), but load-bearing for
    // Argentina's admin_level 7|8 mix below, where a real city's own
    // admin_level=7 polygon can sit inside or overlap a much larger
    // encompassing admin_level=8 relation — picking whichever the Overpass
    // response happened to list first would be arbitrary.
    let hit
    for (const c of withArea) {
      try {
        if (pointInGeometry(point, c.geometry) && (!hit || c.areaSqKm < hit.areaSqKm)) hit = c
      } catch {
        // ignore malformed candidate geometry
      }
    }
    let snapDistanceKm
    if (!hit) {
      // Containment failed outright — before giving up, check whether a
      // candidate's boundary edge sits within SNAP_MAX_KM of the point (see
      // that constant's own comment). Real per-city inspection (Haiti's
      // Grand Gosier, this pass) found globally-nearest-wins can pick the
      // WRONG neighboring polygon when two real communes' boundaries both
      // pass close to the same point (here, geoBoundaries' own Thiotte
      // edge sat 0.198km away vs. the correctly-named Grand Gosier
      // commune's own 0.314km — both genuinely within snap range, but only
      // one is the place the point is actually named after) — confirmed via
      // OSM's own is_in() at the exact coordinate, which resolves to
      // "Commune de Grand Gosier," not Thiotte. So: prefer a
      // same-named candidate within range over a closer differently-named
      // one, and only fall back to pure nearest-wins when no candidate
      // within range shares the city's name.
      let bestDistance = Infinity
      let bestNamedDistance = Infinity
      let namedHit
      const cityKey = normalizeName(city.name)
      for (const c of withArea) {
        let d
        try {
          d = distanceToGeometryKm(point, c.geometry)
        } catch {
          continue
        }
        if (d < bestDistance) {
          bestDistance = d
          hit = c
        }
        if (normalizeName(c.name) === cityKey && d < bestNamedDistance) {
          bestNamedDistance = d
          namedHit = c
        }
      }
      if (namedHit && bestNamedDistance <= SNAP_MAX_KM) {
        hit = namedHit
        bestDistance = bestNamedDistance
      }
      if (!hit || bestDistance > SNAP_MAX_KM) {
        hit = undefined
        unmatched.push({ name: city.name, population: city.population, lat: city.lat, lng: city.lng })
        continue
      }
      snapDistanceKm = bestDistance
    }
    const isSubstantial = city.isCapital || city.population >= SUBSTANTIAL_POPULATION_FLOOR
    const ceiling = isSubstantial ? LOOSE_MAX_SQKM : SOFT_MAX_SQKM
    if (hit.areaSqKm > ceiling) {
      rejected.push({ name: city.name, population: city.population, matchedTo: hit.name, areaSqKm: Math.round(hit.areaSqKm * 10) / 10, isSubstantial })
      continue
    }
    if (snapDistanceKm !== undefined) {
      snapped.push({ name: city.name, population: city.population, matchedTo: hit.name, snapDistanceKm: Math.round(snapDistanceKm * 1000) / 1000 })
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

  console.log(`  ${countryName}: ${cities.length} points -> ${kept.length} kept${snapped.length > 0 ? ` (${snapped.length} snapped)` : ''}, ${rejected.length} rejected (too large), ${unmatched.length} unmatched (no containing polygon)`)
  return { kept, report: { unmatched, rejected, snapped } }
}

function writeCountryOutput(countryId, features) {
  fs.mkdirSync(OUTPUT_DIR, { recursive: true })
  const output = `${OUTPUT_DIR}/${countryId}.json`
  fs.writeFileSync(output, JSON.stringify({ type: 'FeatureCollection', features }))
  const kb = fs.statSync(output).size / 1024
  console.log(`  wrote ${output}: ${features.length} features, ${kb.toFixed(0)} KB`)
}

// Seeded from any existing report rather than starting empty — a scoped
// ONLY= run only ever populates the countries it actually re-ran, and
// writing that partial object straight to REPORT_OUTPUT would silently wipe
// every other country's already-good report data (a real bug: the Argentina
// ONLY=032 re-run during the Tenth pass did exactly this before it was
// caught). A full, unscoped run still overwrites everything, which is
// correct — every country really did just get re-verified.
const report = fs.existsSync(REPORT_OUTPUT) ? JSON.parse(fs.readFileSync(REPORT_OUTPUT, 'utf8')) : {}

// ONLY=032,218 restricts a run to just those numeric country ids — added
// after the South America pass needed a real re-fetch for Argentina alone
// (a source swap, not a first build) and the script's default behavior
// (always processing all 19 countries top to bottom) would otherwise have
// re-downloaded Mexico/Canada/Brazil/etc.'s already-good, already-committed
// output for no reason. Every country block below checks this before doing
// any network work; omit ONLY entirely for a full run (the original,
// unchanged default).
const ONLY = process.env.ONLY ? new Set(process.env.ONLY.split(',')) : null
function shouldRun(numericId) {
  return !ONLY || ONLY.has(numericId)
}

// SKIP_OSM=1 skips every Overpass-dependent country — the OSM-only sources
// (Jordan, Belize, Guyana, Peru, Argentina, Uruguay, Kuwait, Costa Rica) and,
// as of the Twelfth pass, the geoBoundaries+OSM combined ones too (Panama,
// Canada, Venezuela, via runGeoBoundariesCountry's extraOsm option) — useful
// for re-running just the pure-geoBoundaries countries when the Overpass
// endpoint this script depends on (see its own comment above) is temporarily
// unreachable, without touching their already-committed output.
if (!process.env.SKIP_OSM && shouldRun('400')) {
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
}

// Real per-feature join against a single geoBoundaries ADM level's own
// GeoJSON — the pattern Kuwait's Fifth/Sixth pass established. Reused for
// every country below whose recon (researchCityAdminLevels.mjs) AND a real
// independent-source cross-check (not just the geoBoundaries metadata's own
// canonicalName, which is sometimes blank/wrong — see city-boundaries-
// architecture.md's Belize finding) confirmed the level is a genuine
// settlement-scale hierarchy (municipio/distrito/corregimiento), not
// something that looks small on paper but isn't (Jordan's mislabeled Liwa,
// Belize's electoral constituencies).
// extraOsm ({ query, sourceLabel }), added 2026-09-12 (Twelfth pass): lets a
// geoBoundaries-sourced country ALSO pull in a supplemental OSM admin-level
// layer as additional join candidates, rather than picking exactly one
// source per country the way every earlier pass did. Panama and Canada are
// the motivating cases — each has real geoBoundaries coverage that's good
// but not complete (Panama's ADM3 corregimientos miss real Guna Yala/Darién
// communities that OSM's own admin_level=8 layer separately has; Canada's
// CSD file misses Montreal boroughs and some northern-Quebec/Newfoundland
// settlements that OSM's admin_level 8/10 layers separately cover) — a full
// source swap (Jordan/Guyana/Peru/Uruguay's approach) would have thrown away
// geoBoundaries' otherwise-good coverage for no reason. The join's existing
// "smallest containing polygon wins" rule (see joinCityPointsToPolygons's own
// comment) makes this safe to add unconditionally: a supplemental OSM
// candidate only ever gets picked where it's smaller than whatever
// geoBoundaries candidate also contains the point, or where geoBoundaries has
// no containing candidate at all.
async function runGeoBoundariesCountry({ name, numericId, alpha3, admLevel, onOutput, extraOsm }) {
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
  let candidates = geo.features.map((f) => ({
    name: f.properties.shapeName,
    geometry: f.geometry,
    source: `geoboundaries-${admLevel.toLowerCase()}`,
  }))
  if (extraOsm) {
    const raw = await fetchWithRetry(() => fetchOverpass(extraOsm.query))
    let unclosedCount = 0
    const osmCandidates = raw.elements.map((rel) => {
      const { geometry, closed } = relationToGeometry(rel)
      if (!closed) unclosedCount++
      return { name: rel.tags?.name ?? `relation/${rel.id}`, geometry, source: extraOsm.sourceLabel }
    })
    if (unclosedCount > 0) console.log(`  [warn] ${unclosedCount} ${name} supplemental OSM relations had an unclosed ring — kept anyway, area may be inaccurate for those`)
    console.log(`  +${osmCandidates.length} supplemental OSM candidates (${extraOsm.sourceLabel})`)
    candidates = [...candidates, ...osmCandidates]
  }
  const cities = loadCityPoints(numericId)
  const join = joinCityPointsToPolygons(name, cities, candidates)
  if (onOutput) onOutput(join.kept)
  else writeCountryOutput(numericId, join.kept)
  return join.report
}

// Shards a country's kept features by first-level admin unit (state/province)
// instead of one flat file — the same fix the US's own output already needed
// (see that block's own comment) for the same reason: a country large enough
// to need this join can also be large enough that ONE country file is itself
// the "huge eager-shaped file" problem the two-tier GeoNames index and the US
// sharding were both built to avoid. Reuses the existing Natural Earth admin-1
// vendor file (scripts/vendor/ne_10m_admin_1_states_provinces.geojson, already
// used by buildStatesProvincesTopology.mjs) rather than a new source — a
// real per-feature point-in-polygon match against each state's own geometry,
// not a name/code guess. Falls back to nearest-state-by-centroid only for a
// feature whose centroid lands outside every state polygon (island/coastline
// simplification artifacts) — logged, not silent.
function shardByState(countryId, features, { adm0A3, abbrevField }) {
  const ne = JSON.parse(fs.readFileSync('scripts/vendor/ne_10m_admin_1_states_provinces.geojson', 'utf8'))
  const states = ne.features
    .filter((f) => f.properties.adm0_a3 === adm0A3 && f.properties[abbrevField])
    .map((f) => ({ abbrev: f.properties[abbrevField], geometry: f.geometry, centroid: geometryCentroid(f.geometry) }))

  const byState = new Map()
  let fallbackCount = 0
  for (const feature of features) {
    const { lat, lng } = geometryCentroid(feature.geometry)
    let match = states.find((s) => {
      try {
        return pointInGeometry([lng, lat], s.geometry)
      } catch {
        return false
      }
    })
    if (!match) {
      fallbackCount++
      match = states.reduce((closest, s) => {
        const d = (s.centroid.lat - lat) ** 2 + (s.centroid.lng - lng) ** 2
        const closestD = (closest.centroid.lat - lat) ** 2 + (closest.centroid.lng - lng) ** 2
        return d < closestD ? s : closest
      })
    }
    if (!byState.has(match.abbrev)) byState.set(match.abbrev, [])
    byState.get(match.abbrev).push(feature)
  }
  if (fallbackCount > 0) console.log(`  [warn] ${fallbackCount} features matched no state polygon directly — assigned to nearest state by centroid`)

  const outputDir = `${OUTPUT_DIR}/${countryId}`
  fs.mkdirSync(outputDir, { recursive: true })
  let totalKB = 0
  for (const [abbrev, feats] of byState) {
    const outputPath = `${outputDir}/${abbrev.toLowerCase()}.json`
    fs.writeFileSync(outputPath, JSON.stringify({ type: 'FeatureCollection', features: feats }))
    totalKB += fs.statSync(outputPath).size / 1024
  }
  console.log(`  sharded into ${byState.size} state files in ${outputDir}/ (${(totalKB / 1024).toFixed(1)} MB combined, avg ${(totalKB / byState.size).toFixed(0)} KB/state)`)
}

// --- Kuwait (numeric id 414, alpha3 KWT) ---
// Switched from geoBoundaries' ADM2 (137 features) to OSM's own admin_level=6
// neighborhood layer (192 features, sourced from Kuwait's own municipal
// authority, baladia.gov.kw) after the per-city fallback investigation below
// found real, correctly-named OSM boundaries for 2 of geoBoundaries' 3
// unmatched towns (Al Mahbūlah, Al Fințās) — geoBoundaries' ADM2 has real,
// literal gaps between its polygons; OSM's own layer doesn't. Re-running the
// full join against this source: 27/28 kept, 0 rejected, 1 unmatched (down
// from 25/28 kept, 0 rejected, 3 unmatched). The one remaining case, Al
// Funayţīs, has a real, correctly-named, correctly-closed OSM polygon
// (relation 17935319) too — it's a coordinate-precision mismatch, not a
// missing-data problem: the neighborhood is only ~3 km², and GeoNames' point
// for it lands just outside that polygon's edge. See city-boundaries-architecture.md's
// "Eleventh pass" for the full investigation.
if (!process.env.SKIP_OSM && shouldRun('414')) {
  console.log('\n=== Kuwait ===')
  const kuwaitRaw = await fetchWithRetry(() =>
    fetchOverpass(`[out:json][timeout:180];
area["ISO3166-1"="KW"][admin_level=2];
relation(area)["boundary"="administrative"]["admin_level"="6"];
out geom;`),
  )
  let kuwaitUnclosedCount = 0
  const kuwaitCandidates = kuwaitRaw.elements.map((rel) => {
    const { geometry, closed } = relationToGeometry(rel)
    if (!closed) kuwaitUnclosedCount++
    return { name: rel.tags?.name ?? `relation/${rel.id}`, geometry, source: 'osm-admin6' }
  })
  if (kuwaitUnclosedCount > 0) console.log(`  [warn] ${kuwaitUnclosedCount} Kuwait relations had an unclosed ring — kept anyway, area may be inaccurate for those`)
  const kuwaitCities = loadCityPoints('414')
  const kuwaitJoin = joinCityPointsToPolygons('Kuwait', kuwaitCities, kuwaitCandidates)
  writeCountryOutput('414', kuwaitJoin.kept)
  report.kuwait = kuwaitJoin.report
}

// --- Central America pass (2026-09-04) ---
// Six of the seven Central American UN members have a real, independently-
// confirmed settlement-scale geoBoundaries level (see
// city-boundaries-architecture.md's Central America section for the
// citations each was checked against): Costa Rica's Distritos (ADM3),
// El Salvador/Guatemala/Honduras's Municipios (ADM2), Nicaragua's Municipios
// (ADM2), Panama's Corregimientos (ADM3). Belize is the seventh and is
// handled separately below — its geoBoundaries ADM2 is electoral
// constituencies, not settlements, so it needs a real OSM source instead.
//
// Costa Rica switched off geoBoundaries entirely in the Twelfth pass
// (2026-09-12) — its own ADM3 Distritos left 6 real towns unmatched
// (Canoas, San Vito, San Rafael, San Felipe, Sabalito, Parrita), and a
// direct area-contained Overpass query found OSM has a real, comprehensive
// nationwide admin_level=8 layer for the same Distrito tier (495 relations,
// real names spot-checked against Wikipedia — Isla del Coco, Cóbano,
// Aguacaliente, Dulce Nombre, ...) that resolves all but one of them: 136/137
// kept, 0 rejected, 1 unmatched. The one residual (Canoas, a real Costa
// Rican border town) is a GeoNames coordinate-precision issue, not a source
// gap — its point resolves to Panama's own Chiriquí province, across the
// border, in both sources; see the Twelfth pass's own notes in
// city-boundaries-architecture.md.
if (!process.env.SKIP_OSM && shouldRun('188')) {
  console.log('\n=== Costa Rica ===')
  const costaRicaRaw = await fetchWithRetry(() =>
    fetchOverpass(`[out:json][timeout:180];
area["ISO3166-1"="CR"][admin_level=2];
relation(area)["boundary"="administrative"]["admin_level"="8"];
out geom;`),
  )
  let costaRicaUnclosedCount = 0
  const costaRicaCandidates = costaRicaRaw.elements.map((rel) => {
    const { geometry, closed } = relationToGeometry(rel)
    if (!closed) costaRicaUnclosedCount++
    return { name: rel.tags?.name ?? `relation/${rel.id}`, geometry, source: 'osm-admin8' }
  })
  if (costaRicaUnclosedCount > 0) console.log(`  [warn] ${costaRicaUnclosedCount} Costa Rica relations had an unclosed ring — kept anyway, area may be inaccurate for those`)
  const costaRicaCities = loadCityPoints('188')
  const costaRicaJoin = joinCityPointsToPolygons('Costa Rica', costaRicaCities, costaRicaCandidates)
  writeCountryOutput('188', costaRicaJoin.kept)
  report.costaRica = costaRicaJoin.report
}
if (shouldRun('222')) report.elSalvador = await runGeoBoundariesCountry({ name: 'El Salvador', numericId: '222', alpha3: 'SLV', admLevel: 'ADM2' })
if (shouldRun('320')) report.guatemala = await runGeoBoundariesCountry({ name: 'Guatemala', numericId: '320', alpha3: 'GTM', admLevel: 'ADM2' })
// Honduras: re-checked in the Twelfth pass (2026-09-12) — a direct OSM
// admin_level=6 (Municipio) query reproduces geoBoundaries' own numbers
// almost exactly (487 kept, 47 rejected, 10 unmatched vs. 487/46/11), which
// makes sense since both ultimately derive from the same real Honduran
// municipio boundaries. No source change made; confirms the existing
// geoBoundaries source is already correct and complete, not under-verified.
// Of the 11 residual unmatched towns, one (Magdalena) is a genuine GeoNames
// country-tag error — its coordinate resolves to El Salvador's San Miguel
// department, not Honduras — and the rest are real Caribbean coastal/island
// towns (Islas de la Bahía, Gracias a Dios) that fall in real gaps between
// municipio polygons in both sources alike. See BACKLOG.md.
if (shouldRun('340')) report.honduras = await runGeoBoundariesCountry({ name: 'Honduras', numericId: '340', alpha3: 'HND', admLevel: 'ADM2' })
if (shouldRun('558')) report.nicaragua = await runGeoBoundariesCountry({ name: 'Nicaragua', numericId: '558', alpha3: 'NIC', admLevel: 'ADM2' })
// Panama: geoBoundaries' ADM3 corregimientos (632 units) is real and mostly
// complete (783/801 kept on its own), but a direct is_in() check on the
// Twelfth pass's 17 residual unmatched towns found real, correctly-named OSM
// admin_level=8 relations for most of them (Tubualá, Narganá, Mulatupo,
// Ailigandí, Achutupo, Puerto Piña, Gonzalo Vásquez, ... — genuine Guna
// Yala/Darién community boundaries geoBoundaries' download doesn't have) —
// added as a supplemental candidate source rather than a full swap, since
// geoBoundaries' own coverage is otherwise good: 795/801 kept, 1 rejected, 5
// unmatched (down from 17). The remaining 5 (Tubualá's second/Colón-area
// point, Palenque, a second Narganá-area point, Mulatupo, Cauchero) have no
// containing boundary in either source at all — a real, structural coverage
// gap (remote Guna Yala/Bocas del Toro coastal communities), not a technique
// problem. See city-boundaries-architecture.md's Twelfth pass.
if (!process.env.SKIP_OSM && shouldRun('591'))
  report.panama = await runGeoBoundariesCountry({
    name: 'Panama',
    numericId: '591',
    alpha3: 'PAN',
    admLevel: 'ADM3',
    extraOsm: {
      sourceLabel: 'osm-admin8',
      query: `[out:json][timeout:180];
area["ISO3166-1"="PA"][admin_level=2];
relation(area)["boundary"="administrative"]["admin_level"="8"];
out geom;`,
    },
  })

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
if (!process.env.SKIP_OSM && shouldRun('084')) {
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
}

// --- Canada / Mexico pass (2026-09-05) ---
// Both independently verified against the live geoBoundaries API + real
// per-feature names + an outside source (Wikipedia), not just the recon
// script's own canonicalName — see city-boundaries-architecture.md's Ninth
// pass for the full trail:
//   - Canada ADM3 (5,162 units) is, per geoBoundaries' own boundarySourceURL,
//     literally Statistics Canada's Census Subdivision (CSD) file (2016
//     vintage) — Wikipedia confirms CSD is Canada's real municipality-
//     equivalent tier (also covering reserves/unorganized territories, which
//     is why its area spread runs from 0.0003 km² to over 1,000,000 km²,
//     the same "tiny + huge in one tier" shape the area-plausibility filter
//     already exists to handle). A newer (2021) StatCan CSD shapefile sits
//     vendored at scripts/vendor/canada/ with an almost-identical unit count
//     (5,161) and no richer fields — no real data advantage over
//     geoBoundaries' copy, so this uses the general geoBoundaries path
//     rather than writing a bespoke shapefile parser for marginally fresher
//     data. maxVertices there is 210,014 (comparable to Panama's "Arco Iris"
//     outlier) — handled by the same SIMPLIFY_EPSILON_DEG pass every other
//     country already goes through, no special-casing needed.
//   - Mexico ADM2 (2,457 units) is genuinely municipios (Wikipedia: 2,462
//     today, same count-drifts-by-vintage pattern as Costa Rica/Panama) —
//     real per-feature names confirmed (e.g. "Jesús María" in Aguascalientes).
//     One real, logged-not-fixed finding: Mexico City's 16 alcaldías are
//     included in this ADM2 set, and some of their names collide with
//     unrelated municipios elsewhere in the country (e.g. "Cuauhtémoc" and
//     "Benito Juárez" each appear multiple times) — harmless here since the
//     join is point-in-polygon against real geometry, never name-based, but
//     worth knowing before any future name-keyed lookup against this file.
// Canada: geoBoundaries' ADM3 (Census Subdivisions, 5,162 units) is real and
// mostly complete (3,036/3,296 kept on its own), but the Twelfth pass's
// is_in() check on the 28 residual unmatched towns found real gaps a
// supplemental OSM layer fills, two different shapes at once — Montreal's
// boroughs (Ahuntsic-Cartierville, Vieux-Montréal, ...) are their own real
// admin_level=10 relations one tier below the single CSD-level "Montréal"
// polygon, and some northern-Quebec/BC settlements (Akulivik, Belcarra, ...)
// have a real admin_level=8 relation CSD's own download is simply missing.
// Querying OSM admin_level 8|10 together and adding both as supplemental
// candidates (same "smallest containing polygon wins" join logic, no source
// swap) resolved both shapes at once: 3,194/3,296 kept (up from 3,036), 89
// rejected (down from 232 — many of these are also finer OSM boundaries
// replacing a huge "Unorganized"-tier CSD match), 13 unmatched (down from
// 28). The residual 13 are almost all small Newfoundland outport towns
// (Twillingate, Burgeo, Port au Choix, ...) with no boundary in either
// source — a real, sparse-OSM-mapping gap in rural Newfoundland, not a
// technique problem. See city-boundaries-architecture.md's Twelfth pass.
if (!process.env.SKIP_OSM && shouldRun('124'))
  report.canada = await runGeoBoundariesCountry({
    name: 'Canada',
    numericId: '124',
    alpha3: 'CAN',
    admLevel: 'ADM3',
    extraOsm: {
      sourceLabel: 'osm-admin8-10',
      query: `[out:json][timeout:180];
area["ISO3166-1"="CA"][admin_level=2];
relation(area)["boundary"="administrative"]["admin_level"~"^(8|10)$"];
out geom;`,
    },
  })
if (shouldRun('484'))
// Mexico's real per-feature join produces 14,545 kept features — checking
// the actual output file size (this project's own established discipline;
// see the Sixth/Eighth pass's US-mega-file and Panama/Honduras vertex-density
// bugs) found a single flat file lands at ~70MB, bigger than the exact
// merged-US-file mistake already caught and fixed once. Sharded by state
// instead — see shardByState()'s own comment.
report.mexico = await runGeoBoundariesCountry({
  name: 'Mexico',
  numericId: '484',
  alpha3: 'MEX',
  admLevel: 'ADM2',
  onOutput: (kept) => shardByState('484', kept, { adm0A3: 'MEX', abbrevField: 'postal' }),
})

// --- South America pass (2026-09-05) ---
// Independently verified the same way as every prior pass (geoBoundaries'
// own canonicalName cross-checked against Wikipedia/an outside source, real
// per-feature names spot-checked, not just metadata trusted) — see
// city-boundaries-architecture.md's Tenth pass section for the full trail.
//
// Six of twelve confirmed as genuine municipality/commune-level divisions,
// with counts matching (within the usual vintage drift) their real,
// independently-sourced totals: Bolivia's Municipios (ADM3, 339 — exact
// match), Brazil's Municipios (ADM2, 5,570 — exact match), Chile's Comunas
// (ADM3, 345 vs 346), Colombia's Municipios (ADM2, 1,122 — exact match),
// Paraguay's Distritos (ADM2, 247 vs 267 — geoBoundaries' own metadata
// mislabels the source as "barrios y localidades," but the actual feature
// names returned — Aregua, Atyra, Asuncion, ... — are real Paraguayan
// distrito names, confirmed by spot-checking the live download, not the
// metadata label), and Venezuela's Municipios (ADM2, 335 — exact match).
// Uruguay's Municipios (ADM2, 124 vs. 125) also confirmed clean on the
// first check but was REPLACED below after a real, reported gap — see that
// block's own comment.
if (shouldRun('068')) report.bolivia = await runGeoBoundariesCountry({ name: 'Bolivia', numericId: '068', alpha3: 'BOL', admLevel: 'ADM3' })
if (shouldRun('152')) report.chile = await runGeoBoundariesCountry({ name: 'Chile', numericId: '152', alpha3: 'CHL', admLevel: 'ADM3' })
// Colombia: re-checked in the Twelfth pass (2026-09-12) — its 3 residual
// unmatched towns (Puerto Escondido, Nuquí, Necoclí, all real Chocó/Urabá
// coastal towns) resolve to NO administrative boundary at all in OSM, at any
// level (an is_in() query at each exact coordinate returns only "Colombia"
// itself) — a genuine coverage gap in this stretch of coastline's OSM
// mapping, not a wrong-admin-level problem a different source or level would
// fix. No source change made. See BACKLOG.md.
if (shouldRun('170')) report.colombia = await runGeoBoundariesCountry({ name: 'Colombia', numericId: '170', alpha3: 'COL', admLevel: 'ADM2' })
if (shouldRun('600')) report.paraguay = await runGeoBoundariesCountry({ name: 'Paraguay', numericId: '600', alpha3: 'PRY', admLevel: 'ADM2' })
// Venezuela: geoBoundaries' ADM2 Municipios (335 units) is real but coarse —
// the Twelfth pass's is_in() check on its 11 residual unmatched towns
// surfaced a real, comprehensive finer tier OSM already has: admin_level=7
// Parroquia (parish), Venezuela's actual sub-municipio local-government
// layer (1,215 relations, real names spot-checked — "Parroquia Tumeremo",
// "Parroquia La Guaira", "Parroquia San Rafael", ...). Added as a
// supplemental candidate source (not a full swap, since Municipio still
// resolves everything Parroquia doesn't, e.g. the Federal Dependencies'
// islands) — the combination improves every bucket at once: 387/414 kept (up
// from 320), 25 rejected (down from 83 — Parroquia's smaller polygons keep
// many real cities that Municipio's larger ones pushed over the ceiling), 2
// unmatched (down from 11). The 2 residual (Los Roques, an island
// dependency; La Aguada) have no containing boundary in either source. See
// city-boundaries-architecture.md's Twelfth pass.
if (!process.env.SKIP_OSM && shouldRun('862'))
  report.venezuela = await runGeoBoundariesCountry({
    name: 'Venezuela',
    numericId: '862',
    alpha3: 'VEN',
    admLevel: 'ADM2',
    extraOsm: {
      sourceLabel: 'osm-admin7',
      query: `[out:json][timeout:180];
area["ISO3166-1"="VE"][admin_level=2];
relation(area)["boundary"="administrative"]["admin_level"="7"];
out geom;`,
    },
  })
// Suriname's Ressorten (real Dutch term for its actual sub-district local-
// government tier — 62 vs. Wikipedia's 63, the usual vintage-count drift).
if (shouldRun('740')) report.suriname = await runGeoBoundariesCountry({ name: 'Suriname', numericId: '740', alpha3: 'SUR', admLevel: 'ADM2' })

// Brazil: same identity confirmation as the six above (Municipios, ADM2,
// exact 5,570-unit match), but pre-emptively sharded by state from the
// start rather than checked-then-fixed — Brazil has more municipios than
// Mexico (5,570 vs 2,457), the country whose single flat output file
// already hit 70MB and needed the same shardByState() fix (see the Ninth
// pass). Running it flat first here would just reproduce a bug this
// project has already found and fixed twice.
if (shouldRun('076'))
  report.brazil = await runGeoBoundariesCountry({
    name: 'Brazil',
    numericId: '076',
    alpha3: 'BRA',
    admLevel: 'ADM2',
    onOutput: (kept) => shardByState('076', kept, { adm0A3: 'BRA', abbrevField: 'postal' }),
  })

// Ecuador: Cantones (ADM2, 224 vs 221-222) — coarser than the ten confirmed
// above, but not mislabeled the way Jordan's Liwa was: geoBoundaries has no
// finer level for Ecuador (confirmed directly against the live API), and a
// cantón is genuinely the base local-government unit there (every one has
// its own elected mayor). Same accepted fidelity trade as the Jordan qadas/
// Panama corregimientos — a real city can still land inside an oversized
// rural cantón (Amazon/Galápagos cantones spanning multiple islands or vast
// rainforest) and get rejected by the area filter — 441/542 (81%) kept,
// spot-checked: every rejection is a genuine small town/village in a large
// cantón (Puerto Francisco de Orellana pop. 48,144 in a 7,078 km² cantón,
// Puyo pop. 24,881 in a 19,924 km² one), not a systematic failure.
if (shouldRun('218')) report.ecuador = await runGeoBoundariesCountry({ name: 'Ecuador', numericId: '218', alpha3: 'ECU', admLevel: 'ADM2' })

// Argentina: geoBoundaries' Departamentos/Partidos (ADM2, 526 units, a real,
// correctly-identified tier — 378 departamentos + 135 partidos + 15 CABA
// comunas, matching the real ~528 total) turned out NOT to be the same kind
// of "coarser but workable" trade Ecuador's cantones are — a real first run
// (South America pass, 2026-09-05) rejected 762/1204 points (63%), and
// unlike every other coarse-tier rejection logged in this file, the
// rejected list is dominated by genuine provincial-capital cities, not
// villages in empty rural land: Paraná (pop. 247,139), Neuquén (231,198),
// Formosa (222,226), San Luis (169,947), Comodoro Rivadavia (140,850), San
// Rafael, Río Gallegos, Bariloche — every one of these departamentos is
// simply larger than even LOOSE_MAX_SQKM (5,000) in real, populated
// (non-desert) Argentine provinces, because Argentina's real population
// density outside Buenos Aires is low enough that a departamento built
// around one substantial city can still span several thousand km². Raising
// the ceiling to fit Río Gallegos's 33,525 km² departamento would also
// admit Jordan's actual empty deserts (Qada Al-Jafr 28,170 km², Ruwayshid
// 21,523 km²) as "kept," defeating the point of the ceiling — this needed a
// different source, not a different threshold.
//
// Confirmed a real, comprehensive OSM admin_level=8 locality tier instead:
// a direct query returned 2,025 relations nationwide with genuine city/town
// names (Buenos Aires, Resistencia, and real surrounding towns like Fontana/
// Puerto Vilelas/Barranqueras), and specifically confirmed the four
// wrongly-rejected capitals above (Paraná, Neuquén, Formosa, San Luis) each
// have their own real, city-scale admin_level=8 relation distinct from
// their much larger same-named departamento/province. Same technique as
// Peru/Guyana above — this is now the third country in this file where
// geoBoundaries' offering was real but a live per-feature Overpass check
// found something meaningfully better underneath it.
//
// admin_level=8 alone still left 417/1204 points unmatched on the first
// real run — spot-checked the largest one (San Miguel de Tucumán, pop.
// 548,866, Argentina's 5th-largest city) directly against Overpass and
// found it tagged admin_level=7, not 8 — the same "admin_level isn't
// consistent enough to hardcode, even within one country" lesson
// Kuwait/Belize already taught, recurring a third time. Broadened to 7|8
// (Belize's own precedent for exactly this), which is what motivated
// joinCityPointsToPolygons() above to pick the smallest containing
// candidate rather than the first one found — a real city's admin_level=7
// polygon and a larger enclosing admin_level=8 relation can both contain
// the same point once two levels are queried together.
// Twelfth pass (2026-09-12): the 134 towns still unmatched after the 7|8
// broadening above turned out to cluster almost entirely in Buenos Aires and
// San Juan provinces, and a direct is_in() check found why — Buenos Aires
// Province's partidos (its real municipal-equivalent tier; the province has
// no further sub-partido local government at all) are tagged admin_level=5,
// not 7 or 8 ("Partido de Zárate", "Partido de Luján", ...), a third level
// entirely from the two this file already broadened to. Adding admin_level=5
// nationwide (which resolves to "Departamento" in most other provinces —
// coarser than 7|8 there, but only ever picked when nothing finer contains a
// point, per the smallest-wins join rule) eliminated every unmatched town:
// 1,106/1,204 kept (up from 1,038), 98 rejected (up from 32 — genuinely
// large departamentos/partidos that a real city still doesn't fit inside
// even at this coarser fallback level), 0 unmatched (down from 134). See
// city-boundaries-architecture.md's Twelfth pass.
if (!process.env.SKIP_OSM && shouldRun('032')) {
  console.log('\n=== Argentina ===')
  const argentinaRaw = await fetchWithRetry(() =>
    fetchOverpass(`[out:json][timeout:400];
area["ISO3166-1"="AR"][admin_level=2];
relation(area)["boundary"="administrative"]["admin_level"~"^(5|7|8)$"];
out geom;`),
  )
  let argentinaUnclosedCount = 0
  const argentinaCandidates = argentinaRaw.elements.map((rel) => {
    const { geometry, closed } = relationToGeometry(rel)
    if (!closed) argentinaUnclosedCount++
    return { name: rel.tags?.name ?? `relation/${rel.id}`, geometry, source: 'osm-admin5-7-8' }
  })
  if (argentinaUnclosedCount > 0) console.log(`  [warn] ${argentinaUnclosedCount} Argentina relations had an unclosed ring — kept anyway, area may be inaccurate for those`)
  const argentinaCities = loadCityPoints('032')
  const argentinaJoin = joinCityPointsToPolygons('Argentina', argentinaCities, argentinaCandidates)
  shardByState('032', argentinaJoin.kept, { adm0A3: 'ARG', abbrevField: 'postal' })
  report.argentina = argentinaJoin.report
}

// Guyana: geoBoundaries' own ADM2 ("Neighbourhood Councils," 27 units) turned
// out to be a false lead on inspection — its real feature names
// ("III-1 Essequibo Islands", "X-1 Right Bank Essequibo", ...) are
// electoral sub-region codes, not Guyana's actual 70 Neighbourhood
// Democratic Councils + 10 municipalities (80 real local-government areas
// per the Department of Public Information/Wikipedia) — the same
// "geoBoundaries' own canonicalName/metadata can be wrong, verify the real
// feature names" lesson Belize's electoral-constituency finding already
// taught. A direct area-contained Overpass query (same technique as every
// prior OSM check) found the real thing instead: admin_level=6 resolves to
// 115 relations with genuine local names — "City of Georgetown",
// "New Amsterdam", and real NDC-style combined-village names ("Aberdeen -
// Zorg-en-Vlygt", "Good Hope - Pomona", ...) matching Guyana's real NDC
// naming convention of joining the villages a single council covers.
// 115 vs. 80 official LAAs is the same "count doesn't match exactly, but
// the names are real and the join threshold sorts out plausibility per
// feature" shape every geoBoundaries-sourced country above already has.
if (!process.env.SKIP_OSM && shouldRun('328')) {
  console.log('\n=== Guyana ===')
  const guyanaRaw = await fetchWithRetry(() =>
    fetchOverpass(`[out:json][timeout:180];
area["ISO3166-1"="GY"][admin_level=2];
relation(area)["boundary"="administrative"]["admin_level"="6"];
out geom;`),
  )
  let guyanaUnclosedCount = 0
  const guyanaCandidates = guyanaRaw.elements.map((rel) => {
    const { geometry, closed } = relationToGeometry(rel)
    if (!closed) guyanaUnclosedCount++
    return { name: rel.tags?.name ?? `relation/${rel.id}`, geometry, source: 'osm-admin6' }
  })
  if (guyanaUnclosedCount > 0) console.log(`  [warn] ${guyanaUnclosedCount} Guyana relations had an unclosed ring — kept anyway, area may be inaccurate for those`)
  const guyanaCities = loadCityPoints('328')
  const guyanaJoin = joinCityPointsToPolygons('Guyana', guyanaCities, guyanaCandidates)
  writeCountryOutput('328', guyanaJoin.kept)
  report.guyana = guyanaJoin.report
}

// Uruguay: geoBoundaries' Municipios (ADM2, 124 units) is a real,
// correctly-identified tier — but a direct user report (2026-09-05: "the
// Flores region... there are no cities, not even the capital, Trinidad")
// confirmed the structural gap this file already logged in BACKLOG.md is
// worse in practice than "18 departmental capitals missing" reads in the
// abstract: Flores department has essentially no other town, so losing
// just its own capital means the ENTIRE department shows zero cities.
// Uruguay's municipio law leaves departmental capitals under direct
// departmental (Intendencia) governance rather than requiring them to form
// their own municipio, so there is no fix available within that source —
// this needed a different one, the same conclusion Argentina/Guyana/Peru's
// OSM fixes above already reached for their own reasons.
//
// A direct area-contained Overpass query for admin_level=8 found real,
// comprehensive coverage instead: 628 relations nationwide, tagged
// place=city/town/village (not administrative subdivisions at all — a
// populated-place layer, not a local-government one), including every
// departmental capital (Trinidad, Salto, Rivera, Fray Bentos, Colonia del
// Sacramento, Melo, Tacuarembó, ...) alongside hundreds of smaller towns
// and beach resorts. This is a different kind of source than every other
// country in this file (a real settlement footprint, not an administrative
// unit), but the same per-feature join/threshold logic applies unchanged —
// see the real kept/rejected/unmatched counts this produces before trusting
// it blindly the way every other country here was checked.
if (!process.env.SKIP_OSM && shouldRun('858')) {
  console.log('\n=== Uruguay ===')
  const uruguayRaw = await fetchWithRetry(() =>
    fetchOverpass(`[out:json][timeout:180];
area["ISO3166-1"="UY"][admin_level=2];
relation(area)["boundary"="administrative"]["admin_level"="8"];
out geom;`),
  )
  let uruguayUnclosedCount = 0
  const uruguayCandidates = uruguayRaw.elements.map((rel) => {
    const { geometry, closed } = relationToGeometry(rel)
    if (!closed) uruguayUnclosedCount++
    return { name: rel.tags?.name ?? `relation/${rel.id}`, geometry, source: 'osm-admin8' }
  })
  if (uruguayUnclosedCount > 0) console.log(`  [warn] ${uruguayUnclosedCount} Uruguay relations had an unclosed ring — kept anyway, area may be inaccurate for those`)
  const uruguayCities = loadCityPoints('858')
  const uruguayJoin = joinCityPointsToPolygons('Uruguay', uruguayCities, uruguayCandidates)
  writeCountryOutput('858', uruguayJoin.kept)
  report.uruguay = uruguayJoin.report
}

// Peru: geoBoundaries' finest level (Provincias, ADM2, 196 units, mean area
// 6,565 km²) is real but far too coarse — Peru's actual municipal-equivalent
// tier is the Distrito (1,873 of them, per Wikipedia), one level deeper than
// anything geoBoundaries exposes for this country. Confirmed directly, not
// assumed: a live area-contained Overpass query for admin_level=8 returned
// 1,891 relations with genuine distrito names (Alto de la Alianza, Cairani,
// Calana, Candarave, Coronel Gregorio Albarracín Lanchipa, ...) — matching
// Peru's real district count almost exactly, the same identity-confirmation
// bar as every other country above.
//
// This query is ~21x the size of Jordan's (89 relations) — the original
// motivation for switching this script's one OVERPASS endpoint to
// overpass-api.de (see that constant's own comment): the previous mirror
// reliably 504-timed-out on this query, even a tags-only version with no
// geometry, while overpass-api.de resolved the full out-geom fetch in ~9s.
//
// Sharded by region from the start, same reasoning as Brazil above: 1,891
// kept features nationwide is comfortably past the scale that already
// forced Mexico/Brazil into shardByState().
if (!process.env.SKIP_OSM && shouldRun('604')) {
  console.log('\n=== Peru ===')
  const peruRaw = await fetchWithRetry(() =>
    fetchOverpass(`[out:json][timeout:300];
area["ISO3166-1"="PE"][admin_level=2];
relation(area)["boundary"="administrative"]["admin_level"="8"];
out geom;`),
  )
  let peruUnclosedCount = 0
  const peruCandidates = peruRaw.elements.map((rel) => {
    const { geometry, closed } = relationToGeometry(rel)
    if (!closed) peruUnclosedCount++
    return { name: rel.tags?.name ?? `relation/${rel.id}`, geometry, source: 'osm-admin8' }
  })
  if (peruUnclosedCount > 0) console.log(`  [warn] ${peruUnclosedCount} Peru relations had an unclosed ring — kept anyway, area may be inaccurate for those`)
  const peruCities = loadCityPoints('604')
  const peruJoin = joinCityPointsToPolygons('Peru', peruCities, peruCandidates)
  shardByState('604', peruJoin.kept, { adm0A3: 'PER', abbrevField: 'postal' })
  report.peru = peruJoin.report
}

// --- Caribbean pass (Thirteenth pass, 2026-09-12): all 13 UN Caribbean
// members. Same investigate-before-trust discipline as every prior batch —
// geoBoundaries' own canonicalName cross-checked against a real independent
// count (Wikipedia/well-established parish structures) AND the live
// download's own feature names actually inspected, not just metadata
// trusted (the Belize/Guyana lesson). Most of these islands are small
// enough that their real *only* local-government tier is the parish/
// district (no separate municipio/distrito layer exists the way it does on
// the mainland) — confirmed via a direct OSM admin_level survey for all 13
// before picking a source per country, not assumed from area alone: an
// OSM relation count matching geoBoundaries' own unit count at the
// corresponding admin_level is what confirms "this is the real, complete
// tier," the same bar Bolivia/Brazil/Colombia/Venezuela's exact-count
// matches met in the Tenth pass.
//
// Nine straightforward parish/district confirmations (OSM's own
// admin_level count matches geoBoundaries' unit count exactly): Antigua and
// Barbuda's Parish and Dependency (ADM1, 8 — 6 parishes + Barbuda + Redonda,
// OSM admin_level=6 also 8), Barbados's Parish (ADM1, 11, OSM
// admin_level=6 also 11), Dominica's Parish (ADM1, 10, OSM admin_level=4
// also 10), Grenada's Parish (ADM1, 7, OSM admin_level=6 also 7), Saint
// Kitts and Nevis's Parish (ADM1, 14, OSM admin_level=6 also 14), Saint
// Vincent and the Grenadines's Parishes (ADM1, 6, OSM admin_level=6 also
// 6), Bahamas's Second/Third Schedule Districts (ADM2, 33-34 — real feature
// names are island/island-region names: Green Turtle Cay, South Andros,
// San Salvador, Ragged Island, matching Bahamas' real ~31 local-government
// districts), Cuba's Municipios (ADM2, 168 — OSM's own admin_level=6
// count, 117 tagged place=municipality plus 50 untagged, sums to the same
// 167-168; real feature names Niquero/Bayamo/Marianao/Cárdenas confirmed
// against Cuba's actual municipio list, including Marianao as one of
// Havana's own municipios), and Dominican Republic's Municipalities (ADM2,
// 155 vs. OSM admin_level=6's 156; real names Azua de Compostela/Neyba/
// Tamayo confirmed real DR municipios). All nine kept on geoBoundaries via
// runGeoBoundariesCountry() below, same as every clean South America
// confirmation in the Tenth pass.
//
// Two coarser-than-parish "communities" layers, inspected directly rather
// than trusted from the canonicalName alone (the Belize/Paraguay
// precedent): Jamaica's ADM2 "community" (827 units, min 0.10 km²) and
// Saint Lucia's ADM2 "Communities" (547 units, min 0.01 km²) both have real
// named-settlement feature names on direct inspection (Jamaica: Irish
// Town, Norbrook, Mavis Bank, Kingston itself; Saint Lucia: Jacmel, Vanard,
// Roseau Valley) — genuine fine-grained community/village polygons, not an
// electoral or code-based mislabeling the way Belize's "Constituencies" or
// Guyana's original ADM2 attempt were. No OSM survey confirmed a matching
// finer tier for either (Jamaica's own OSM admin_level=6 stops at its 14
// parishes; Saint Lucia's stops at its 10 districts), but the download's
// own real names are confirmation enough on their own, the same bar
// Paraguay's Distritos met when its own canonicalName ("barrios y
// localidades") was wrong but the real feature names were right.
//
// Haiti's Communes (ADM3, 140, OSM admin_level=8 confirms 143) is a real,
// correctly-identified municipal tier — Port au Prince, Delmas, Carrefour,
// Petionville all present and correctly named, matching Haiti's actual
// commune list.
//
// Trinidad and Tobago is the one country in this pass that needed OSM
// instead of geoBoundaries, not just a confirmation of it: geoBoundaries'
// ADM1 (14 units) is missing Arima — a real, incorporated borough
// (population ~33,000) — entirely from its download, leaving only 13 of
// Trinidad's real 14 divisions (2 cities + 5 boroughs + 7 regions,
// confirmed against Wikipedia) plus Tobago as a 14th combined feature. A
// direct OSM admin_level=4 query has the real, complete set instead — all
// 14 Trinidad divisions including Arima, plus Tobago itself (also tagged
// admin_level=4, in addition to place=island) as a 15th feature — matching
// Trinidad and Tobago's real total of 15 administrative divisions exactly
// where geoBoundaries' own download falls one short.
if (shouldRun('028')) report.antiguaAndBarbuda = await runGeoBoundariesCountry({ name: 'Antigua and Barbuda', numericId: '028', alpha3: 'ATG', admLevel: 'ADM1' })
if (shouldRun('044')) report.bahamas = await runGeoBoundariesCountry({ name: 'Bahamas', numericId: '044', alpha3: 'BHS', admLevel: 'ADM2' })
if (shouldRun('052')) report.barbados = await runGeoBoundariesCountry({ name: 'Barbados', numericId: '052', alpha3: 'BRB', admLevel: 'ADM1' })
if (shouldRun('192')) report.cuba = await runGeoBoundariesCountry({ name: 'Cuba', numericId: '192', alpha3: 'CUB', admLevel: 'ADM2' })
if (shouldRun('212')) report.dominica = await runGeoBoundariesCountry({ name: 'Dominica', numericId: '212', alpha3: 'DMA', admLevel: 'ADM1' })
if (shouldRun('214')) report.dominicanRepublic = await runGeoBoundariesCountry({ name: 'Dominican Republic', numericId: '214', alpha3: 'DOM', admLevel: 'ADM2' })
if (shouldRun('308')) report.grenada = await runGeoBoundariesCountry({ name: 'Grenada', numericId: '308', alpha3: 'GRD', admLevel: 'ADM1' })
if (shouldRun('332')) report.haiti = await runGeoBoundariesCountry({ name: 'Haiti', numericId: '332', alpha3: 'HTI', admLevel: 'ADM3' })
if (shouldRun('388')) report.jamaica = await runGeoBoundariesCountry({ name: 'Jamaica', numericId: '388', alpha3: 'JAM', admLevel: 'ADM2' })
if (shouldRun('659')) report.saintKittsAndNevis = await runGeoBoundariesCountry({ name: 'Saint Kitts and Nevis', numericId: '659', alpha3: 'KNA', admLevel: 'ADM1' })
if (shouldRun('662')) report.saintLucia = await runGeoBoundariesCountry({ name: 'Saint Lucia', numericId: '662', alpha3: 'LCA', admLevel: 'ADM2' })
if (shouldRun('670')) report.saintVincentAndTheGrenadines = await runGeoBoundariesCountry({ name: 'Saint Vincent and the Grenadines', numericId: '670', alpha3: 'VCT', admLevel: 'ADM1' })
if (!process.env.SKIP_OSM && shouldRun('780')) {
  console.log('\n=== Trinidad and Tobago ===')
  const trinidadRaw = await fetchWithRetry(() =>
    fetchOverpass(`[out:json][timeout:180];
area["ISO3166-1"="TT"][admin_level=2];
relation(area)["boundary"="administrative"]["admin_level"="4"];
out geom;`),
  )
  let trinidadUnclosedCount = 0
  const trinidadCandidates = trinidadRaw.elements.map((rel) => {
    const { geometry, closed } = relationToGeometry(rel)
    if (!closed) trinidadUnclosedCount++
    return { name: rel.tags?.name ?? `relation/${rel.id}`, geometry, source: 'osm-admin4' }
  })
  if (trinidadUnclosedCount > 0) console.log(`  [warn] ${trinidadUnclosedCount} Trinidad and Tobago relations had an unclosed ring — kept anyway, area may be inaccurate for those`)
  const trinidadCities = loadCityPoints('780')
  const trinidadJoin = joinCityPointsToPolygons('Trinidad and Tobago', trinidadCities, trinidadCandidates)
  writeCountryOutput('780', trinidadJoin.kept)
  report.trinidadAndTobago = trinidadJoin.report
}

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
if (shouldRun('840')) {
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
}

fs.writeFileSync(REPORT_OUTPUT, JSON.stringify(report, null, 2))
console.log(`\nWrote ${REPORT_OUTPUT} (unmatched/rejected detail for every joined country — US has no join to report on).`)
