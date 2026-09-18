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
// Trinidad and Tobago, plus the 2026-09-13 Northern Europe pass: Denmark,
// Estonia, Finland, Iceland, Ireland, Latvia, Lithuania, Norway, Sweden,
// United Kingdom, plus the 2026-09-16 Western Europe pass: Austria, Belgium,
// France, Germany, Liechtenstein, Luxembourg, Monaco, Netherlands,
// Switzerland, plus the 2026-09-17 Southern Europe pass: Albania, Andorra,
// Bosnia and Herzegovina, Croatia, Greece, Italy, Malta, Montenegro, North
// Macedonia, Portugal, San Marino, Serbia, Slovenia, Spain, plus the
// 2026-09-17 Eastern Europe pass: Belarus, Bulgaria, Czechia, Hungary,
// Moldova, Poland, Romania, Slovakia, Ukraine (Russia deliberately excluded —
// see city-boundaries-architecture.md's own note on why it needs its own
// dedicated investigation rather than folding into a routine regional batch),
// plus the 2026-09-18 Middle East pass: Bahrain, Cyprus, Iran, Iraq, Israel,
// Lebanon, Oman, Qatar, Saudi Arabia, Syria, Turkey, United Arab Emirates,
// Yemen, plus the 2026-09-18 Central Asia + Caucasus pass: Armenia,
// Azerbaijan, Georgia, Kazakhstan, Kyrgyzstan, Tajikistan, Turkmenistan,
// Uzbekistan, plus the 2026-09-18 South Asia pass: Afghanistan, Pakistan,
// Nepal, Bhutan, Bangladesh, Sri Lanka, Maldives (India deliberately excluded,
// same reasoning as Russia — see that block's own comment), plus the
// 2026-09-18 East Asia pass: China, Japan, Mongolia, North Korea, South
// Korea — NOT the other 81 UN members yet. See that doc's "Fifth pass" section
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
import { pointInGeometry, geometryAreaSqKm, geometryCentroid, simplifyGeometry, distanceToGeometryKm, geometryBBox, bboxContains } from './lib/sphericalGeometry.mjs'
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
      await new Promise((r) => setTimeout(r, Math.min(5000 * (i + 1), 30_000)))
    }
  }
  throw lastErr
}

// A 180s client-side abort, added for the Western Europe pass (2026-09-16)
// after a Bayern query genuinely hung past its own [timeout:120] Overpass
// directive with no response at all — `fetch()` had no client-side timeout
// of its own, so fetchWithRetry's retry loop never got the rejection it
// needed to move on. This doesn't change what a healthy request looks like
// (every prior country's queries complete well under 180s); it only turns a
// silent hang into a real, retryable failure.
async function fetchOverpass(query, endpoint = OVERPASS) {
  const res = await fetch(endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'User-Agent': OVERPASS_USER_AGENT },
    body: 'data=' + encodeURIComponent(query),
    signal: AbortSignal.timeout(180_000),
  })
  if (!res.ok) throw new Error(`Overpass ${res.status}`)
  return res.json()
}

// Every prior pass's OSM queries fetched `relation[boundary=administrative]`
// only, so `relationToGeometry` (imported above) was the only geometry
// converter this script ever needed. The Maldives block (Twentieth pass,
// 2026-09-18) is the first to source candidates from `way`-tagged features
// (`place=island`/`place=islet` — real per-island landmass outlines are
// almost always mapped as a single closed way, not a multi-segment
// relation) — Overpass's `out geom;` gives a `way` element a flat
// `.geometry` array of `{lat,lon}` points directly, already closed (first
// point equals last — verified directly against a real Maldives island
// way), unlike a relation's member-segments-needing-stitching shape.
function wayToGeometry(way) {
  return { type: 'Polygon', coordinates: [way.geometry.map((p) => [p.lon, p.lat])] }
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
// exact-string compare would miss every real match. `name` can be a real
// JSON `null` (not just Turkmenistan's already-tolerated blank ""), found
// for 24 of Japan's 1,742 ADM2 features (East Asia pass, 2026-09-18) — the
// `?? ''` guard is what actually makes a nameless candidate harmless, not
// just the fact that its own name never reaches final output.
function normalizeName(name) {
  return (name ?? '')
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .replace(/[^a-z0-9]/gi, '')
    .toLowerCase()
}

// The real per-feature join: for every GeoNames point, find the containing
// candidate polygon and decide whether to keep it, per the threshold policy
// above. Returns { kept: Feature[], report: {...} }.
function joinCityPointsToPolygons(countryName, cities, candidates) {
  const withArea = candidates.map((c) => ({ ...c, areaSqKm: geometryAreaSqKm(c.geometry), bbox: geometryBBox(c.geometry) }))
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
      if (!bboxContains(c.bbox, point)) continue
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
    const raw = await fetchWithRetry(() => fetchOverpass(extraOsm.query, extraOsm.endpoint ?? OVERPASS))
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
// abbrevOf, added for the Western Europe pass (2026-09-16): Germany's own
// Natural Earth admin-1 rows have a real data bug — Brandenburg's `postal`
// field is "BE", the same value Berlin's real postal code already uses
// (should be "BB"; found by inspecting the raw vendor file directly, not
// assumed) — so the default `postal`-keyed lookup would silently merge
// Brandenburg's cities into Berlin's own shard. `iso_3166_2` (e.g. "DE-BB"
// vs. "DE-BE") doesn't have this collision and is used instead for Germany;
// France's own admin-1 rows are department-level with `postal` blank for
// 99 of 101 entries (an unrelated shape from Mexico/Brazil/Peru/Argentina's
// province-level rows), so it uses `iso_3166_2` (e.g. "FR-59") too. Pass
// abbrevOf to derive the shard key some other way than a flat field lookup;
// abbrevField stays the default path for every other already-shipped country.
function shardByState(countryId, features, { adm0A3, abbrevField, abbrevOf }) {
  const ne = JSON.parse(fs.readFileSync('scripts/vendor/ne_10m_admin_1_states_provinces.geojson', 'utf8'))
  const deriveAbbrev = abbrevOf ?? ((props) => props[abbrevField])
  const states = ne.features
    .filter((f) => f.properties.adm0_a3 === adm0A3 && deriveAbbrev(f.properties))
    .map((f) => ({ abbrev: deriveAbbrev(f.properties), geometry: f.geometry, centroid: geometryCentroid(f.geometry) }))

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

// Fourteenth pass (2026-09-13): Northern Europe, the first batch of the
// Europe region — the next continent after the Americas (see
// city-boundaries-architecture.md). Candidate levels below come from the
// Third pass's geoBoundaries recon (scripts/cityAdminLevelsReport.json);
// each was actually run through the real per-feature join against this
// project's own GeoNames city index before being trusted, per this file's
// own discipline — several of these levels report a blank/"Unknown"
// geoBoundaries canonicalName, the same missing-label shape Belize's
// "Constituencies" and Jordan's mislabeled Liwa both had, so a blank label
// here is a reason for extra scrutiny of the actual join output (matched
// unit names, rejected-count shape), not by itself a reason to reject the
// level — see city-boundaries-architecture.md's Fourteenth pass section for
// what each country's real output showed.
if (shouldRun('208')) report.denmark = await runGeoBoundariesCountry({ name: 'Denmark', numericId: '208', alpha3: 'DNK', admLevel: 'ADM2' })
if (shouldRun('233')) report.estonia = await runGeoBoundariesCountry({ name: 'Estonia', numericId: '233', alpha3: 'EST', admLevel: 'ADM2' })
if (shouldRun('246')) report.finland = await runGeoBoundariesCountry({ name: 'Finland', numericId: '246', alpha3: 'FIN', admLevel: 'ADM3' })
if (shouldRun('352')) report.iceland = await runGeoBoundariesCountry({ name: 'Iceland', numericId: '352', alpha3: 'ISL', admLevel: 'ADM2' })
// Ireland: geoBoundaries' only sub-national level (ADM2, "Local Electoral
// Areas," 166 units) turned out NOT to be a coarser-but-real city tier the
// way Ecuador's cantones are — a real first attempt matched Dublin to
// "PEMBROKE LEA-5" (9.4 km²) and Cork to "CORK CITY SOUTH CENTRAL LEA-6"
// (16.8 km²): real LEA sub-ward fragments of those cities, not the cities
// themselves — LEAs are electoral subdivisions WITHIN a city/county, not a
// city-scale administrative unit on their own, the same "looks small enough
// to be plausible, isn't the right kind of unit" trap as Jordan's mislabeled
// Liwa and Belize's Constituencies. Ireland's real local-government tier
// (31 city/county councils) isn't in geoBoundaries at all. OSM's own
// admin_level=6 alone only carries the 26 traditional counties (Dublin's 4
// modern authorities and Tipperary's 2 collapse back into one "County
// Dublin"/"County Tipperary" each) — real and correctly named, but coarse
// enough to outright reject Cork (population 224,004, Ireland's
// second-largest city) and Galway, since County Cork/County Galway exceed
// even LOOSE_MAX_SQKM. admin_level=7 separately carries the real modern
// city/county authorities the 2014 local-government reform created (Cork,
// Dublin, Fingal, South Dublin, Dún Laoghaire-Rathdown, "Cathair na
// Gaillimhe"/Galway City, Limerick, Waterford) mixed in with redundant
// re-tagged county polygons for counties that were never split — the same
// "combine two admin_levels, smallest containing polygon wins" mixed-
// granularity shape Argentina's admin_level 7|8 query already established
// a precedent for in this file. Querying 6|7 together, rather than either
// level alone, lets a real city like Cork resolve to its own level-7
// authority while a never-split county like Clare or Kerry falls back to
// its level-6 boundary automatically. overpass-api.de (this file's usual
// endpoint) timed out repeatedly on Ireland specifically while working fine
// for every other country in this pass; overpass.private.coffee answered
// the identical shape of query, so this one query uses that endpoint
// instead.
if (!process.env.SKIP_OSM && shouldRun('372')) {
  console.log('\n=== Ireland ===')
  const irelandRaw = await fetchWithRetry(() =>
    fetchOverpass(
      `[out:json][timeout:180];
area["ISO3166-1"="IE"][admin_level=2]->.a;
relation(area.a)["boundary"="administrative"]["admin_level"~"^(6|7)$"];
out geom;`,
      'https://overpass.private.coffee/api/interpreter',
    ),
  )
  let irelandUnclosedCount = 0
  const irelandCandidates = irelandRaw.elements.map((rel) => {
    const { geometry, closed } = relationToGeometry(rel)
    if (!closed) irelandUnclosedCount++
    return { name: rel.tags?.name ?? `relation/${rel.id}`, geometry, source: 'osm-admin6' }
  })
  if (irelandUnclosedCount > 0) console.log(`  [warn] ${irelandUnclosedCount} Ireland relations had an unclosed ring — kept anyway, area may be inaccurate for those`)
  const irelandCities = loadCityPoints('372')
  const irelandJoin = joinCityPointsToPolygons('Ireland', irelandCities, irelandCandidates)
  writeCountryOutput('372', irelandJoin.kept)
  report.ireland = irelandJoin.report
}
if (shouldRun('428')) report.latvia = await runGeoBoundariesCountry({ name: 'Latvia', numericId: '428', alpha3: 'LVA', admLevel: 'ADM2' })
if (shouldRun('440')) report.lithuania = await runGeoBoundariesCountry({ name: 'Lithuania', numericId: '440', alpha3: 'LTU', admLevel: 'ADM2' })
if (shouldRun('578')) report.norway = await runGeoBoundariesCountry({ name: 'Norway', numericId: '578', alpha3: 'NOR', admLevel: 'ADM2' })
if (shouldRun('752')) report.sweden = await runGeoBoundariesCountry({ name: 'Sweden', numericId: '752', alpha3: 'SWE', admLevel: 'ADM2' })
// United Kingdom: geoBoundaries' own ADM2/ADM3 are the same 216-unit
// "Counties and Unitary Authorities" layer duplicated at both levels (no
// finer geoBoundaries tier exists) — real and correctly named, but coarse
// enough that a first run rejected 2,839/5,918 points (48%, dwarfing every
// other country in this pass), including real cities like Manchester and
// Birmingham sitting inside a much larger encompassing authority. OSM's own
// admin_level=8 has a real, finer 232-unit layer (metropolitan/London
// boroughs, unitary authorities, and non-metropolitan districts) that
// includes exactly the individual cities geoBoundaries' 216-unit tier
// merges away — added as a supplemental layer (smallest-containing-polygon-
// wins, same as Panama/Canada/Venezuela's extraOsm) rather than a full
// source swap, since geoBoundaries' own tier is still real and worth
// keeping as the fallback wherever OSM's admin_level=8 doesn't reach
// city-scale either. overpass-api.de repeatedly 504'd on this specific
// query (tags/geometry for 232 UK relations, apparently too heavy for it
// right now) while private.coffee's mirror answered it, so this one query
// is pinned to that endpoint via extraOsm's per-call endpoint override.
if (shouldRun('826'))
  report.unitedKingdom = await runGeoBoundariesCountry({
    name: 'United Kingdom',
    numericId: '826',
    alpha3: 'GBR',
    admLevel: 'ADM3',
    extraOsm: {
      query: `[out:json][timeout:180];
area["ISO3166-1"="GB"][admin_level=2]->.a;
relation(area.a)["boundary"="administrative"]["admin_level"="8"];
out geom;`,
      sourceLabel: 'osm-admin8',
      endpoint: 'https://overpass.private.coffee/api/interpreter',
    },
  })

// Fifteenth pass (2026-09-16): Western Europe (Austria, Belgium, France,
// Germany, Liechtenstein, Luxembourg, Monaco, Netherlands, Switzerland) —
// the second Europe batch. Same investigate-before-trust discipline: every
// candidate level's real per-feature names checked directly (via geoBoundaries
// downloads and targeted OSM is_in() containment queries at real city
// centers), not trusted from recon or canonicalName alone.
//
// Five straightforward confirmations, each verified by a real is_in() (or
// direct-download) check at that country's capital/largest city landing on a
// single, correctly-sized feature at the stated level: Liechtenstein's
// Gemeinde (ADM1, 11 — Vaduz confirmed), Netherlands' Municipality (ADM2,
// 344 — Amsterdam confirmed as its own 918,117-population level-8 relation,
// already correctly labeled by geoBoundaries), Switzerland's Municipality
// (ADM3, 2286 — Zurich confirmed as its own level-8 relation, already
// correctly labeled), Luxembourg's communes (ADM3, 102 — direct download
// inspection confirms "Luxembourg" city appears as one whole feature, not
// fragmented), and Belgium's communes (ADM4, 589, canonicalName blank in
// recon — direct download inspection confirms "Bruxelles | Brussel" appears
// as one whole feature, population-bearing, not split into its 19
// constituent municipalities or any smaller ward).
//
// Austria's own recon-reported "finest" level (ADM4, 7850 units) is the
// familiar "finest on paper, wrong kind of unit" trap this file has hit
// repeatedly (Lithuania/Sweden/Ireland) — a real is_in() check at Vienna's
// center resolves ADM4-equivalent OSM admin_level=10 to "Katastralgemeinde
// Innere Stadt," a cadastral survey unit *within* one of Vienna's own
// districts, not a Gemeinde. ADM3 (2097 units) is Austria's real Gemeinde
// tier instead (matching the real ~2,093 count) — and, checked directly
// against the actual download rather than assumed from the OSM quirk that
// Vienna's Land and Gemeinde boundaries coincide (so Vienna has no separate
// OSM admin_level=8 relation of its own), geoBoundaries' own ADM3 file
// includes "Wien" as one real, whole feature anyway — it isn't sourced by
// blindly mirroring OSM's own admin_level=8 tag, so this particular OSM
// quirk doesn't propagate into it.
if (shouldRun('438')) report.liechtenstein = await runGeoBoundariesCountry({ name: 'Liechtenstein', numericId: '438', alpha3: 'LIE', admLevel: 'ADM1' })
if (shouldRun('528')) report.netherlands = await runGeoBoundariesCountry({ name: 'Netherlands', numericId: '528', alpha3: 'NLD', admLevel: 'ADM2' })
if (shouldRun('756')) report.switzerland = await runGeoBoundariesCountry({ name: 'Switzerland', numericId: '756', alpha3: 'CHE', admLevel: 'ADM3' })
if (shouldRun('442')) report.luxembourg = await runGeoBoundariesCountry({ name: 'Luxembourg', numericId: '442', alpha3: 'LUX', admLevel: 'ADM3' })
if (shouldRun('056')) report.belgium = await runGeoBoundariesCountry({ name: 'Belgium', numericId: '056', alpha3: 'BEL', admLevel: 'ADM4' })
if (shouldRun('040')) report.austria = await runGeoBoundariesCountry({ name: 'Austria', numericId: '040', alpha3: 'AUT', admLevel: 'ADM3' })

// Monaco: a real hybrid case, found by actually testing where each of
// Monaco's 10 GeoNames points lands, not assumed from either level alone.
// geoBoundaries' ADM2 (9 quartiers — Fontvieille, Monaco-Ville, La
// Condamine, La Rousse, Larvotto, Monte-Carlo, Jardin Exotique, Les
// Monegetti, Sainte-Dévote) resolves 9 of Monaco's 10 real named places
// correctly — Monte-Carlo lands in "Monte-Carlo," La Condamine in "La
// Condamine," etc., real per-feature accuracy this micro-state's other
// quartier-named points deserve, not the same flattened whole-country shape
// every other candidate level in this file would give them. But the 10th
// point — "Monaco" itself, the PPLC/capital entry, population 32,965, what
// a search or the label-reveal layer actually surfaces most often — lands
// in "Sainte-Dévote," one specific small quartier with no special claim to
// representing the whole city. That's the same sub-city-fragment trap as
// every other country in this pass, just affecting exactly one of ten
// points instead of the whole level, so neither "use ADM2 for everyone" nor
// "use ADM1 (the single whole-country polygon) for everyone" is fully
// correct on its own — this special-cases the one point that needs it.
if (!process.env.SKIP_OSM && shouldRun('492')) {
  console.log('\n=== Monaco ===')
  const monacoMeta = await fetchWithRetry(async () => {
    const res = await fetch('https://www.geoboundaries.org/api/current/gbOpen/MCO/ALL/')
    if (!res.ok) throw new Error(`geoBoundaries ${res.status}`)
    return res.json()
  })
  const fetchLevel = async (admLevel) => {
    const meta = monacoMeta.find((l) => l.boundaryType === admLevel)
    const res = await fetchWithRetry(async () => {
      const r = await fetch(meta.gjDownloadURL)
      if (!r.ok) throw new Error(`geoBoundaries geojson ${r.status}`)
      return r.json()
    })
    return res.features.map((f) => ({ name: f.properties.shapeName, geometry: f.geometry, source: `geoboundaries-${admLevel.toLowerCase()}` }))
  }
  const monacoQuartiers = await fetchLevel('ADM2')
  const monacoWhole = await fetchLevel('ADM1')
  const monacoCities = loadCityPoints('492')
  const monacoCapital = monacoCities.filter((c) => c.isCapital)
  const monacoOthers = monacoCities.filter((c) => !c.isCapital)
  const capitalJoin = joinCityPointsToPolygons('Monaco (capital point, whole-country level)', monacoCapital, monacoWhole)
  const othersJoin = joinCityPointsToPolygons('Monaco (quartiers, everyone else)', monacoOthers, monacoQuartiers)
  writeCountryOutput('492', [...capitalJoin.kept, ...othersJoin.kept])
  report.monaco = {
    unmatched: [...capitalJoin.report.unmatched, ...othersJoin.report.unmatched],
    rejected: [...capitalJoin.report.rejected, ...othersJoin.report.rejected],
    snapped: [...capitalJoin.report.snapped, ...othersJoin.report.snapped],
  }
}

// France: geoBoundaries' ADM5 (35,010 features, canonicalName itself a
// blended "Arrondissement municipal, Commune simple, Préfecture, ..." list)
// turned out to have a real, unfilterable defect on direct download
// inspection, not just a messy label — Paris, Lyon, and Marseille (France's
// only three communes legally subdivided into their own arrondissements
// municipaux) have NO whole-city feature in this file at all, only their
// 20/9/16 arrondissement fragments (confirmed: searching the download for
// "Paris" surfaces "Paris 4e Arrondissement" etc., never bare "Paris"). A
// real per-feature join against ADM5 as-is would land each city's GeoNames
// point inside whichever single arrondissement it happens to fall in — the
// same sub-city-fragment trap as Lithuania/Sweden/Ireland, except this time
// affecting only 3 of ~35,000 features rather than the whole level, so a
// full source swap to OSM nationwide (Peru/Uruguay/Argentina's approach)
// would be real overkill. A live is_in() check at Notre-Dame confirmed OSM's
// own admin_level=8 DOES carry a real, whole "Paris" relation (population
// 2,133,111, correct) distinct from its own admin_level=9 arrondissements —
// so the fix is: drop ADM5's 45 Paris/Lyon/Marseille arrondissement
// fragments (identified by an exact `"<City> <N>(er|e) Arrondissement"` name
// match — real communes with "Paris"/"Lyon"/"Marseille" as a SUBSTRING, like
// "Villeparisis" or "Chazelles-sur-Lyon," don't match this exact pattern and
// are correctly left alone) and add back 3 targeted, cheap OSM queries (one
// relation each, not a nationwide fetch) for the real whole-city polygons.
// Sharded by department via Natural Earth's own `iso_3166_2` field
// ("FR-59," ...) rather than `postal` — this file's France rows are
// department-level (101 of them) with `postal` blank for 99/101, an
// unrelated shape from Mexico/Brazil/Peru/Argentina's own province-level
// rows — see shardByState's own comment.
if (!process.env.SKIP_OSM && shouldRun('250')) {
  console.log('\n=== France ===')
  const franceMeta = await fetchWithRetry(async () => {
    const res = await fetch('https://www.geoboundaries.org/api/current/gbOpen/FRA/ALL/')
    if (!res.ok) throw new Error(`geoBoundaries ${res.status}`)
    return res.json()
  })
  const franceAdmMeta = franceMeta.find((l) => l.boundaryType === 'ADM5')
  const franceGeo = await fetchWithRetry(async () => {
    const res = await fetch(franceAdmMeta.gjDownloadURL)
    if (!res.ok) throw new Error(`geoBoundaries geojson ${res.status}`)
    return res.json()
  })
  const isArrondissementMunicipal = /^(Paris|Lyon|Marseille) \d+(er|e) Arrondissement$/
  const droppedFragments = franceGeo.features.filter((f) => isArrondissementMunicipal.test(f.properties.shapeName)).length
  console.log(`  dropping ${droppedFragments} Paris/Lyon/Marseille arrondissement-municipal fragments (real communes, wrong kind of unit for this join — see this block's own comment)`)
  const franceCandidates = franceGeo.features
    .filter((f) => !isArrondissementMunicipal.test(f.properties.shapeName))
    .map((f) => ({ name: f.properties.shapeName, geometry: f.geometry, source: 'geoboundaries-adm5' }))
  const franceCitiesRaw = await fetchWithRetry(() =>
    fetchOverpass(`[out:json][timeout:60];
area["ISO3166-1"="FR"][admin_level=2]->.fr;
(relation(area.fr)["boundary"="administrative"]["admin_level"="8"]["name"="Paris"];
relation(area.fr)["boundary"="administrative"]["admin_level"="8"]["name"="Lyon"];
relation(area.fr)["boundary"="administrative"]["admin_level"="8"]["name"="Marseille"];);
out geom;`),
  )
  console.log(`  +${franceCitiesRaw.elements.length} supplemental whole-city OSM candidates (expected 3: Paris/Lyon/Marseille)`)
  const franceSupplemental = franceCitiesRaw.elements.map((rel) => {
    const { geometry } = relationToGeometry(rel)
    return { name: rel.tags.name, geometry, source: 'osm-admin8' }
  })
  const franceCities = loadCityPoints('250')
  const franceJoin = joinCityPointsToPolygons('France', franceCities, [...franceCandidates, ...franceSupplemental])
  shardByState('250', franceJoin.kept, { adm0A3: 'FRA', abbrevOf: (props) => props.iso_3166_2?.replace(/^FR-/, '') })
  report.france = franceJoin.report
}

// Germany: geoBoundaries' finest level (ADM3, 428 units — kreisfreie Städte
// + Landkreise, i.e. Germany's county-equivalent tier) is real but only
// city-scale for the ~107 independent cities; every other town sits inside
// a whole Landkreis (mean area 836 km² per the recon report) instead of its
// own boundary. A direct is_in() check confirmed a real, comprehensive
// finer tier exists in OSM: admin_level=8 (Gemeinde) resolves even a
// non-independent town (Dachau, inside Landkreis Dachau) to its own real
// municipal polygon, distinct from its enclosing Landkreis — the same
// "geoBoundaries' offering is real but coarser than OSM's own next tier
// down" shape as Peru's Provincias/Distritos. A nationwide admin_level=8
// query for Germany (~10,795 real Gemeinden, per Destatis) timed out
// repeatedly against this file's usual Overpass endpoint even for a bare
// `out count` — confirmed genuinely too heavy in one shot, not a query
// error — so this queries per-Bundesland instead (a real, fast, ~10s query
// for Saarland's 52 Gemeinden confirmed the chunked approach works). Berlin,
// Hamburg, and Bremen are German city-states whose Land IS their Gemeinde —
// they have no separate admin_level=8 relation of their own (confirmed via
// is_in() at both Vienna, in Austria, and Berlin: both resolve straight from
// their level-2 country to their own level-4 Land/city boundary, skipping
// municipality level entirely) — so each is fetched directly by name at
// admin_level=4 instead of relying on the per-state admin_level=8 loop to
// ever find them. Sharded by state via `iso_3166_2` (e.g. "DE-BB"), not
// `postal` — Natural Earth's own `postal` field for Brandenburg is a real,
// confirmed data bug (wrongly set to "BE," the same value Berlin's real
// postal code uses) that would otherwise silently merge Brandenburg's
// cities into Berlin's shard; see shardByState's own comment.
//
// A real bug caught only by checking the actual unmatched list, not assumed
// fixed once the fetch itself succeeded: the first full run's per-area query
// filtered to admin_level=8 only, which silently excluded every one of
// Germany's ~107 kreisfreie Städte (independent cities) — Munich, Cologne,
// Stuttgart, Nuremberg, Leipzig, and nearly every other major German city
// are tagged admin_level=6 in OSM (the same level a normal Landkreis sits
// at), not 8, confirmed by this file's own earlier is_in() check on Munich.
// 263 of 11,914 points came back unmatched on that first run, dominated by
// exactly these flagship cities — not a long tail of small towns the way
// every other country's residual unmatched list in this file reads.
// Widened the query to `admin_level~"^(6|8)$"` (the same mixed-level,
// smallest-containing-polygon-wins pattern Argentina's 5|7|8 and Ireland's
// 6|7 queries already established): a kreisfreie Stadt has no admin_level=8
// child of its own, so it's the only, correctly-sized candidate for its own
// area; an ordinary Landkreis's real admin_level=8 Gemeinden still win over
// their own enclosing Landkreis wherever both contain the same point.
if (!process.env.SKIP_OSM && shouldRun('276')) {
  console.log('\n=== Germany ===')
  const GERMAN_STATES = [
    'Baden-Württemberg',
    'Brandenburg',
    'Hessen',
    'Mecklenburg-Vorpommern',
    'Niedersachsen',
    'Nordrhein-Westfalen',
    'Rheinland-Pfalz',
    'Saarland',
    'Sachsen',
    'Sachsen-Anhalt',
    'Schleswig-Holstein',
    'Thüringen',
  ]
  // Bayern queried as its own 7 Regierungsbezirke (admin_level=5) instead of
  // one admin_level=4 query for the whole state — its ~2,200 Gemeinden made
  // it the one query in this loop that repeatedly hung (past both a 120s
  // server-side Overpass timeout AND, before fetchOverpass grew its own
  // 180s client-side abort above, past that too, with no response ever
  // coming back for fetchWithRetry to retry against). Splitting into seven
  // smaller requests is the same "break the query into chunks Overpass can
  // actually finish" fix Germany's own per-state (rather than nationwide)
  // structure already applies at the state level, just one level deeper for
  // the one state large enough to still need it.
  const BAVARIAN_REGIERUNGSBEZIRKE = ['Oberbayern', 'Niederbayern', 'Oberpfalz', 'Oberfranken', 'Mittelfranken', 'Unterfranken', 'Schwaben']
  // overpass-api.de (this file's usual endpoint) went fully unreachable
  // partway through this pass's first attempt — a real connect-timeout to
  // both of its known IPs, not a query problem (9 of 13 states had already
  // fetched successfully against it right before this). overpass.private.coffee
  // confirmed healthy at the time, so Germany's queries are pinned there
  // instead, the same per-country endpoint override Ireland/UK already
  // needed for the identical reason.
  const GERMANY_ENDPOINT = 'https://overpass.private.coffee/api/interpreter'
  const germanyCandidates = []
  // failedAreas + the try/catch below, added after the shared public Overpass
  // mirror this pass depends on hit sustained congestion severe enough that
  // Mecklenburg-Vorpommern's query failed 6 attempts in a row (a mix of 504s
  // and this file's own 180s client-side abort) — a single-state failure
  // used to crash the whole Germany block via fetchWithRetry's throw,
  // discarding every other state already fetched in the same run (this
  // happened twice; the first time cost all 9 states fetched before it).
  // Report-don't-crash instead: log the area as a real gap and move on, the
  // same discipline every other unmatched/rejected report in this file
  // already follows, so a re-run only needs to target the actually-missing
  // area (ONLY=276 reruns the whole country, but a real fix could re-fetch
  // just the failed area's own Gemeinden and merge them in by hand). Attempts
  // raised from the default 6 to 10 for Germany specifically, given how
  // aggressively the shared server was rate-limiting/timing out this pass.
  const failedAreas = []
  // MIN_PLAUSIBLE_GEMEINDEN: a real, deliberately low floor (Saarland's own
  // real 52 Gemeinden is the smallest of any area this loop queries) that
  // exists purely to catch the OTHER real Overpass failure mode this project
  // already logged once (BACKLOG.md's Fourteenth-pass entry: an HTTP 200,
  // valid-JSON, silently-truncated `elements` array — no error for
  // fetchWithRetry to catch at all). Hit for real during this pass:
  // Brandenburg's first fetch came back as a "successful" 0-element response
  // — confirmed a truncation, not real data, since Brandenburg genuinely has
  // ~409-417 Gemeinden. Throwing here folds this failure mode into the same
  // fetchWithRetry path every other error already goes through, rather than
  // silently shipping a real German state with zero city coverage.
  const MIN_PLAUSIBLE_GEMEINDEN = 10
  const fetchGemeinden = async (areaName, areaAdminLevel) => {
    try {
      const raw = await fetchWithRetry(
        async () => {
          const result = await fetchOverpass(
            `[out:json][timeout:120];
area["name"="${areaName}"]["admin_level"="${areaAdminLevel}"]->.s;
relation(area.s)["boundary"="administrative"]["admin_level"~"^(6|8)$"];
out geom;`,
            GERMANY_ENDPOINT,
          )
          if (result.elements.length < MIN_PLAUSIBLE_GEMEINDEN) {
            throw new Error(`implausibly few elements (${result.elements.length}) — likely a silently-truncated response, not real data`)
          }
          return result
        },
        10,
      )
      console.log(`  ${areaName}: ${raw.elements.length} Gemeinden/kreisfreie Städte/Kreise`)
      for (const rel of raw.elements) {
        const { geometry } = relationToGeometry(rel)
        germanyCandidates.push({ name: rel.tags?.name ?? `relation/${rel.id}`, geometry, source: 'osm-admin6-8' })
      }
    } catch (err) {
      console.log(`  [FAILED, all retries exhausted] ${areaName}: ${err.message} — real gap, logged not silently dropped`)
      failedAreas.push(areaName)
    }
  }
  for (const stateName of GERMAN_STATES) await fetchGemeinden(stateName, '4')
  for (const bezirk of BAVARIAN_REGIERUNGSBEZIRKE) await fetchGemeinden(bezirk, '5')
  try {
    const cityStateRaw = await fetchWithRetry(
      async () => {
        const result = await fetchOverpass(
          `[out:json][timeout:60];
area["ISO3166-1"="DE"][admin_level=2]->.de;
(relation(area.de)["boundary"="administrative"]["admin_level"="4"]["name"="Berlin"];
relation(area.de)["boundary"="administrative"]["admin_level"="4"]["name"="Hamburg"];
relation(area.de)["boundary"="administrative"]["admin_level"="4"]["name"="Bremen"];);
out geom;`,
          GERMANY_ENDPOINT,
        )
        // Exactly 3 expected (Berlin/Hamburg/Bremen) — same silent-truncation
        // guard as fetchGemeinden's own MIN_PLAUSIBLE_GEMEINDEN, just with an
        // exact rather than a floor check since this query's real answer is a
        // fixed, known count.
        if (result.elements.length !== 3) {
          throw new Error(`expected exactly 3 city-state relations, got ${result.elements.length} — likely a silently-truncated response`)
        }
        return result
      },
      10,
    )
    console.log(`  +${cityStateRaw.elements.length} city-state candidates (expected 3: Berlin/Hamburg/Bremen)`)
    for (const rel of cityStateRaw.elements) {
      const { geometry } = relationToGeometry(rel)
      germanyCandidates.push({ name: rel.tags.name, geometry, source: 'osm-admin4' })
    }
  } catch (err) {
    console.log(`  [FAILED, all retries exhausted] city-states (Berlin/Hamburg/Bremen): ${err.message} — real gap, logged not silently dropped`)
    failedAreas.push('city-states (Berlin/Hamburg/Bremen)')
  }
  const germanyCities = loadCityPoints('276')
  const germanyJoin = joinCityPointsToPolygons('Germany', germanyCities, germanyCandidates)
  shardByState('276', germanyJoin.kept, { adm0A3: 'DEU', abbrevOf: (props) => props.iso_3166_2?.replace(/^DE-/, '') })
  report.germany = { ...germanyJoin.report, failedAreas }
  if (failedAreas.length > 0) console.log(`  [warn] ${failedAreas.length} area(s) failed all retries and are MISSING from Germany's output: ${failedAreas.join(', ')} — see scripts/cityBoundariesReport.json`)
}

// --- Sixteenth pass (2026-09-17): Southern Europe (Albania, Andorra, Bosnia
// and Herzegovina, Croatia, Greece, Italy, Malta, Montenegro, North
// Macedonia, Portugal, San Marino, Serbia, Slovenia, Spain) — the third
// Europe batch. Same discipline as every prior pass: every candidate level's
// real per-feature names checked directly against a live geoBoundaries
// download, not trusted from recon or canonicalName alone — several of these
// had a blank/garbage canonicalName in scripts/cityAdminLevelsReport.json
// (Bosnia's literally read "gbOpen") but resolved to real, correctly-scaled
// municipality names on inspection anyway. Twelve straightforward
// confirmations, all a plain single-source geoBoundaries join with no OSM
// supplement needed: Albania's pre-2015 communes (ADM3, 373 — finer than the
// current 61 post-reform bashki, which is the right direction for
// city-scale matching, the same reasoning Portugal's freguesia-over-
// municipality choice below already established), Andorra's parishes (ADM1,
// 7 — Sant Julia de Loria/Canillo/Ordino/... all 7 real names present),
// Bosnia and Herzegovina's opštine/Brčko District (ADM3, 142 — Mostar,
// Goražde, Brcko District all real and correctly named despite the garbage
// canonicalName), Croatia's općine/gradovi (ADM2, 560 — "Općina Kapela" etc,
// includes small island units like "Otok Ilovik"), Greece's dimoi (ADM3,
// 326 post-Kallikratis municipalities), Malta's local councils (ADM1, 68),
// Montenegro's municipalities (ADM1, 23), North Macedonia's opštini (ADM2,
// 84), San Marino's castelli (ADM1, 9 — all 9 real names present), Serbia's
// opštine/gradovi (ADM2, 145, Kosovo correctly excluded since this dataset
// only covers Serbia-proper), and Slovenia's municipalities (ADM2, 213).
//
// Portugal is the one name-collision trap worth flagging explicitly: its
// ADM3 freguesias (2905) include many real, differently-located parishes
// sharing the same name (multiple "Pinheiro"s were the first red flag on
// inspection) — harmless here specifically because joinCityPointsToPolygons
// matches by real point-in-polygon containment, never by name (name is only
// ever a tie-break for the >2km snap fallback), so duplicate parish names
// across different municipalities can't cross-match each other.
//
// Italy (ADM4 comuni, 7901 — matches the real ~7900 comuni count) and Spain
// (ADM3 municipios, 8205 — matches the real ~8131 count, source vintage
// accounts for the small drift) both needed shardByState() rather than a
// flat file, the same "check the actual output file size" discipline as
// Mexico/Brazil/France/Germany before them: Italy joins ~11,855 GeoNames
// points and Spain ~7,400. Italy shards cleanly on Natural Earth's own
// `postal` field (110 provinces, no blanks, no collisions). Spain's own
// `postal` field collides the same way Germany's did (Ceuta and Melilla
// both read "CE"; every mainland province's `postal` is actually its
// autonomous-community code, e.g. every Basque province reads "PV", not a
// per-province code) — `iso_3166_2` has zero collisions across all 52
// Spanish provinces and is used instead, the same fix France/Germany's own
// blocks already needed for an unrelated reason.
if (shouldRun('008')) report.albania = await runGeoBoundariesCountry({ name: 'Albania', numericId: '008', alpha3: 'ALB', admLevel: 'ADM3' })
if (shouldRun('020')) report.andorra = await runGeoBoundariesCountry({ name: 'Andorra', numericId: '020', alpha3: 'AND', admLevel: 'ADM1' })
if (shouldRun('070')) report.bosniaAndHerzegovina = await runGeoBoundariesCountry({ name: 'Bosnia and Herzegovina', numericId: '070', alpha3: 'BIH', admLevel: 'ADM3' })
if (shouldRun('191')) report.croatia = await runGeoBoundariesCountry({ name: 'Croatia', numericId: '191', alpha3: 'HRV', admLevel: 'ADM2' })
if (shouldRun('300')) report.greece = await runGeoBoundariesCountry({ name: 'Greece', numericId: '300', alpha3: 'GRC', admLevel: 'ADM3' })
if (shouldRun('470')) report.malta = await runGeoBoundariesCountry({ name: 'Malta', numericId: '470', alpha3: 'MLT', admLevel: 'ADM1' })
if (shouldRun('499')) report.montenegro = await runGeoBoundariesCountry({ name: 'Montenegro', numericId: '499', alpha3: 'MNE', admLevel: 'ADM1' })
if (shouldRun('807')) report.northMacedonia = await runGeoBoundariesCountry({ name: 'North Macedonia', numericId: '807', alpha3: 'MKD', admLevel: 'ADM2' })
if (shouldRun('674')) report.sanMarino = await runGeoBoundariesCountry({ name: 'San Marino', numericId: '674', alpha3: 'SMR', admLevel: 'ADM1' })
// Serbia's first run (geoBoundaries ADM2 alone) rejected 44/492 points, all
// matched to the single "Belgrade" polygon (3235.7 km² — the City of
// Belgrade's own ADM2 unit spans the whole metro region including rural
// exurbs like Mladenovac and Barajevo, not just the built-up city). Every
// rejected name (Vračar, Zvezdara, Palilula, Savski Venac, Stari Grad,
// Čukarica, Voždovac, Rakovica, Grocka, Barajevo, Sopot, Mladenovac, ...) is
// a real Belgrade inner borough or outer settlement — confirmed directly via
// a live Overpass query scoped to Belgrade's own admin_level=7 area, which
// returned a real, correctly-named admin_level=9 settlement/borough layer
// (166 features, e.g. the inner boroughs tagged "Београд (Врачар)" etc.) that
// resolves the whole rejected list. Added as a supplemental smallest-
// containing-polygon-wins source, same pattern as Panama/Canada/Venezuela/UK's
// own extraOsm above, scoped to just Belgrade's own area rather than a
// nationwide admin_level=9 fetch (thousands of naselja Serbia-wide) since
// every other Serbian city's own ADM2 "City"/"Municipality" unit already
// joined cleanly with 0 rejections. Pinned to the private.coffee mirror —
// overpass-api.de returned a real "server busy" timeout on this query during
// recon, unrelated to the query itself (retried and got a clean response
// from private.coffee).
if (shouldRun('688'))
  report.serbia = await runGeoBoundariesCountry({
    name: 'Serbia',
    numericId: '688',
    alpha3: 'SRB',
    admLevel: 'ADM2',
    extraOsm: {
      query: `[out:json][timeout:180];
area["boundary"="administrative"]["admin_level"="7"]["name"="Град Београд"]->.a;
relation(area.a)["boundary"="administrative"]["admin_level"="9"];
out geom;`,
      sourceLabel: 'osm-admin9-belgrade',
      endpoint: 'https://overpass.private.coffee/api/interpreter',
    },
  })
if (shouldRun('705')) report.slovenia = await runGeoBoundariesCountry({ name: 'Slovenia', numericId: '705', alpha3: 'SVN', admLevel: 'ADM2' })
if (shouldRun('620')) report.portugal = await runGeoBoundariesCountry({ name: 'Portugal', numericId: '620', alpha3: 'PRT', admLevel: 'ADM3' })
if (shouldRun('380'))
  report.italy = await runGeoBoundariesCountry({
    name: 'Italy',
    numericId: '380',
    alpha3: 'ITA',
    admLevel: 'ADM4',
    onOutput: (kept) => shardByState('380', kept, { adm0A3: 'ITA', abbrevField: 'postal' }),
  })
if (shouldRun('724'))
  report.spain = await runGeoBoundariesCountry({
    name: 'Spain',
    numericId: '724',
    alpha3: 'ESP',
    admLevel: 'ADM3',
    onOutput: (kept) => shardByState('724', kept, { adm0A3: 'ESP', abbrevOf: (props) => props.iso_3166_2?.replace(/^ES-/, '') }),
  })

// --- Seventeenth pass (2026-09-17): Eastern Europe (Belarus, Bulgaria,
// Czechia, Hungary, Moldova, Poland, Romania, Slovakia, Ukraine) — the
// fourth and last Europe batch this file's own "next logical scope" note
// called for, minus Russia (deliberately excluded — its transcontinental
// scale warrants its own dedicated investigation, not folding into a
// routine regional batch; see city-boundaries-architecture.md). Same
// discipline as every prior pass: every candidate level's real per-feature
// names checked directly against a live geoBoundaries download, not
// trusted from recon metadata alone.
//
// Five straightforward confirmations, real per-feature names matching each
// country's genuine municipality-equivalent tier and admUnitCount matching
// (within the usual vintage drift) an independently known real count:
// Bulgaria's obshtini (ADM2, 265 — exact match), Poland's gminy (ADM3, 2480
// vs. a real ~2477), Czechia's obce (ADM3, 6257 vs. a real ~6254-6258),
// Slovakia's obce (ADM3, 2941 vs. a real ~2890), and Hungary's települések
// (ADM3, 3357 vs. a real ~3178) — the last three all sit one level below a
// coarser district/county tier that was checked and correctly rejected as
// too coarse (Czechia's ADM2 "District" is only 77 units; Hungary's ADM2 is
// really Hungary's 198 járás/districts, each named after its seat town in a
// way that could be mistaken for a settlement list at a glance — confirmed
// coarse by cross-checking the real count, 198, against Hungary's actual
// number of districts, not settlements).
//
// **Czechia, Hungary, and Slovakia's own ADM3 downloads have real, garbled
// diacritics in their raw shapeName values** (e.g. Czechia: "Kri63nky",
// "Uhr6nov"; Hungary: "Szí© zhalombatta"; Slovakia: "Doln  Srnie") — verified
// as a genuine upstream data bug, not a terminal/encoding artifact on this
// project's end (checked the raw response bytes directly: the literal ASCII
// digits/symbols are baked into geoBoundaries' own file, not a decode
// error). Harmless here specifically because `joinCityPointsToPolygons`
// never uses a candidate's own name for the final output — `properties.name`
// on every kept feature is always the GeoNames point's own (correctly
// spelled) name; a candidate's name is only ever used for `matchedAdminUnit`
// (a diagnostic field) and the >2km snap fallback's name tie-break, so the
// corruption can't reach anything a user actually sees. Also confirmed each
// level's finer ADM4 sibling (Czechia and Slovakia both have one) is a
// sub-municipal cadastral-territory tier, not a finer settlement tier — real
// per-feature names there repeat the same municipality split into several
// numbered/disambiguated pieces (Czechia: "Loucky u Turnova"-style "X u Y"
// disambiguation is itself the standard Czech naming convention for
// cadastral units, not settlements; Slovakia: "Male Ko eckn Podhradie" /
// "Velk  Koeeck  Podhradie" are two halves of one real village) — using
// ADM4 would have split real single cities across several candidate
// polygons for no benefit, so ADM3 is correctly the finer of the two
// genuinely-checked options, not merely the first one that looked plausible.
if (shouldRun('100')) report.bulgaria = await runGeoBoundariesCountry({ name: 'Bulgaria', numericId: '100', alpha3: 'BGR', admLevel: 'ADM2' })
if (shouldRun('203')) report.czechia = await runGeoBoundariesCountry({ name: 'Czechia', numericId: '203', alpha3: 'CZE', admLevel: 'ADM3' })
if (shouldRun('348')) report.hungary = await runGeoBoundariesCountry({ name: 'Hungary', numericId: '348', alpha3: 'HUN', admLevel: 'ADM3' })
if (shouldRun('616')) report.poland = await runGeoBoundariesCountry({ name: 'Poland', numericId: '616', alpha3: 'POL', admLevel: 'ADM3' })
if (shouldRun('703')) report.slovakia = await runGeoBoundariesCountry({ name: 'Slovakia', numericId: '703', alpha3: 'SVK', admLevel: 'ADM3' })

// Romania: geoBoundaries' only sub-national level below its 42 counties is
// ADM2 (3235 units), mislabeled "municipalities" in geoBoundaries' own
// metadata but confirmed by real per-feature inspection to actually be
// Romania's full LAU2 tier (comune + orașe + municipii combined — real
// count ~3181, matching within the usual vintage drift) — the same
// "trust the real feature names/count over a wrong metadata label" call
// already made for Paraguay's mislabeled "barrios y localidades" and
// Bosnia's blank canonicalName. Real per-feature names are ALL CAPS with
// genuine duplicates across different counties (e.g. "BUJORU", "ISLAZ",
// "CIUPERCENI" each appear twice) — harmless for the same reason Portugal's
// freguesia name collisions were harmless: the join is real point-in-polygon
// containment, never name-based, except for the >2km snap fallback's name
// tie-break, which only ever compares within whatever set of candidates a
// single unmatched point is actually near.
if (shouldRun('642')) report.romania = await runGeoBoundariesCountry({ name: 'Romania', numericId: '642', alpha3: 'ROU', admLevel: 'ADM2' })

// Ukraine: geoBoundaries' finest level, ADM3 (10375 units, canonicalName
// "Village Councils"), is real per-feature-checked as genuine — names are
// the standard Ukrainian adjectival council-name form (e.g. "Tinystivska",
// "Pushkinska"). This is the pre-2020-reform silski/miski rady tier
// (matching ADM2's own 495-unit "Raions" count to the old, pre-reform raion
// structure too, not the post-2020 amalgamated hromada system) — the same
// "accept the vintage the source actually has" call already made for every
// other country in this file with a real but dated administrative
// snapshot (Panama's corregimientos, Costa Rica's distritos). No finer
// level exists in geoBoundaries for Ukraine, so this is simply the finest
// real option, the same as Ecuador's cantones/Jordan's qadas.
if (shouldRun('804')) report.ukraine = await runGeoBoundariesCountry({ name: 'Ukraine', numericId: '804', alpha3: 'UKR', admLevel: 'ADM3' })

// Belarus: geoBoundaries' only sub-national level, ADM2 ("Raion", 118
// units), is real but coarse — it mixes ordinary rural raions with the 10
// oblast-significance cities (Brest, Gomel, Grodno, Mogilev, Vitebsk,
// Babruysk, Pinsk, Baranavichy, Zhodzina, Navapolatsk — all independent of
// any raion, correctly sized as their own city-scale polygons) at the same
// tier, confirmed directly via a live OSM admin_level=4-6 query (the same
// mixed tier this file's own Serbia/Argentina/Ireland blocks already
// established isn't safe to assume uniform). A supplemental OSM
// admin_level=8 layer (1287 real village/settlement councils — сельсаветы —
// e.g. "Орша", "Ліда", "Глыбокае", real Belarusian names, not garbled) fills
// in the rural raions the same way Panama/Canada/Venezuela/Serbia's own
// extraOsm supplements already do: smallest-containing-polygon-wins, so a
// сельсавет only ever displaces its own enclosing raion where it's actually
// smaller, and the raion/city tier still backstops anywhere the councils
// layer doesn't reach.
if (!process.env.SKIP_OSM && shouldRun('112'))
  report.belarus = await runGeoBoundariesCountry({
    name: 'Belarus',
    numericId: '112',
    alpha3: 'BLR',
    admLevel: 'ADM2',
    extraOsm: {
      sourceLabel: 'osm-admin8',
      query: `[out:json][timeout:180];
area["ISO3166-1"="BY"][admin_level=2];
relation(area)["boundary"="administrative"]["admin_level"="8"];
out geom;`,
    },
  })

// Moldova: geoBoundaries has only ADM1 (37 real raion-equivalent districts,
// min area 38 km2) — far too coarse for city-scale matching, the same
// "geoBoundaries alone won't get there" shape as Jordan's original finding,
// so this switches off geoBoundaries entirely (like Costa Rica/Kuwait
// before it) in favor of a direct OSM query. Confirmed via live Overpass
// recon: Moldova's real base local-government tier (comună/oraș) is tagged
// admin_level=8 in OSM, not the =6 the general Eastern-European convention
// might suggest (a direct =6 query returned zero results) — 982 relations,
// real Romanian and (for Transnistria's own settlements) Cyrillic names
// (Hîrbovăț, Copceac, Кременчуг, ...), covering both rural comune and towns
// alike.
if (!process.env.SKIP_OSM && shouldRun('498')) {
  console.log('\n=== Moldova ===')
  const moldovaRaw = await fetchWithRetry(() =>
    fetchOverpass(`[out:json][timeout:180];
area["ISO3166-1"="MD"][admin_level=2];
relation(area)["boundary"="administrative"]["admin_level"="8"];
out geom;`),
  )
  let moldovaUnclosedCount = 0
  const moldovaCandidates = moldovaRaw.elements.map((rel) => {
    const { geometry, closed } = relationToGeometry(rel)
    if (!closed) moldovaUnclosedCount++
    return { name: rel.tags?.name ?? `relation/${rel.id}`, geometry, source: 'osm-admin8' }
  })
  if (moldovaUnclosedCount > 0) console.log(`  [warn] ${moldovaUnclosedCount} Moldova relations had an unclosed ring — kept anyway, area may be inaccurate for those`)
  const moldovaCities = loadCityPoints('498')
  const moldovaJoin = joinCityPointsToPolygons('Moldova', moldovaCities, moldovaCandidates)
  writeCountryOutput('498', moldovaJoin.kept)
  report.moldova = moldovaJoin.report
}

// --- Eighteenth pass (2026-09-18): Middle East (Bahrain, Cyprus, Iran, Iraq,
// Israel, Lebanon, Oman, Qatar, Saudi Arabia, Syria, Turkey, United Arab
// Emirates, Yemen) — Jordan and Kuwait (already done, above) are
// geographically part of this same region but were this file's very first
// proof-of-concept, long before "pick the next contiguous region" became the
// standing discipline.
//
// Nine straightforward-or-accepted geoBoundaries confirmations: Cyprus's
// communities (ADM2, 610, real names like "Morfou"/"Kato Pyrgos" — matches a
// real ~600 community count), Syria's sub-districts (ADM3, 272, matching the
// real ~270 nawahi), Turkey's districts/ilçe (ADM2, 973, matching the real
// count almost exactly), and six real but genuinely coarse district-level
// tiers accepted as this file's usual "finest real option, not a technique
// failure" call (Ecuador's cantones/Jordan's own qadas precedent): Bahrain's
// 4 governorates (ADM1 — no finer level exists in geoBoundaries OR OSM,
// confirmed by direct Overpass query; harmless here specifically because
// Bahrain's entire land area is small enough that even a whole governorate
// sits under `SOFT_MAX_SQKM`), Iraq's 101 districts (ADM2, matching the real
// ~120 qada count within vintage drift), Oman's 61 wilayat (ADM2, an exact
// count match — wilayat is genuinely Oman's base local-government unit, not
// a coarser tier sitting above one), Qatar's 79 zones (ADM2 — ADM1's 8
// matches Qatar's real 8 municipalities exactly, but ADM2's own real
// per-feature names are bare cadastral zone numbers like `"76"`/`"97"`, not
// named localities; harmless for the same reason Czechia/Hungary/Slovakia's
// garbled names were harmless in the Seventeenth pass — the final output
// always uses GeoNames' own name, never a candidate's — and finer-grained
// zone polygons are if anything a better fit for Doha's dense urban core
// than one flat municipality polygon would be), Saudi Arabia's 147
// governorates (ADM2 — a real mix of true governorates and, for many smaller
// entries, the town the governorate is centered on, at the same tier), and
// Yemen's 335 districts (ADM2, matching the real ~333 count).
if (shouldRun('196')) report.cyprus = await runGeoBoundariesCountry({ name: 'Cyprus', numericId: '196', alpha3: 'CYP', admLevel: 'ADM2' })
if (shouldRun('760')) report.syria = await runGeoBoundariesCountry({ name: 'Syria', numericId: '760', alpha3: 'SYR', admLevel: 'ADM3' })
if (shouldRun('792')) report.turkey = await runGeoBoundariesCountry({ name: 'Turkey', numericId: '792', alpha3: 'TUR', admLevel: 'ADM2' })
if (shouldRun('048')) report.bahrain = await runGeoBoundariesCountry({ name: 'Bahrain', numericId: '048', alpha3: 'BHR', admLevel: 'ADM1' })
// Iraq: geoBoundaries' ADM2 (101 districts/qada) rejected 59 of 173 points on
// its own, dominated by real substantial cities (Najaf 482,576 in a 39,024.9
// km² district; Ramadi 223,500; Samarra 158,508) — the same "a district
// built around one city can still be huge" shape as Saudi Arabia above. A
// live OSM check found a real finer tier: admin_level=7 (401 relations,
// Iraq's actual nahiya/sub-district layer, one level below qada) —
// added as a supplemental smallest-wins source rather than a full swap,
// since qada already resolves every point OSM's own finer layer doesn't
// reach.
if (shouldRun('368'))
  report.iraq = await runGeoBoundariesCountry({
    name: 'Iraq',
    numericId: '368',
    alpha3: 'IRQ',
    admLevel: 'ADM2',
    extraOsm: {
      sourceLabel: 'osm-admin7',
      query: `[out:json][timeout:180];
area["ISO3166-1"="IQ"][admin_level=2];
relation(area)["boundary"="administrative"]["admin_level"="7"];
out geom;`,
    },
  })
if (shouldRun('512')) report.oman = await runGeoBoundariesCountry({ name: 'Oman', numericId: '512', alpha3: 'OMN', admLevel: 'ADM2' })
if (shouldRun('634')) report.qatar = await runGeoBoundariesCountry({ name: 'Qatar', numericId: '634', alpha3: 'QAT', admLevel: 'ADM2' })
if (shouldRun('887')) report.yemen = await runGeoBoundariesCountry({ name: 'Yemen', numericId: '887', alpha3: 'YEM', admLevel: 'ADM2' })

// Saudi Arabia: geoBoundaries' ADM2 (147 governorates) is real but far too
// coarse for a country this size and this sparsely populated outside its
// major cities — the first run rejected 98 of 160 points, including the
// capital (Riyadh, 4.2M, 8532.8 km² governorate), Jeddah-area and half a
// dozen other genuine million-plus cities, all for the same reason: a
// governorate built around one substantial city can still span thousands of
// km² of surrounding desert. Checked directly whether OSM has anything
// finer nationwide (it doesn't — its own admin_level=6 governorate layer,
// 149 units, is the same coarse tier under a different admin_level number)
// and whether individual major cities have their own hand-drawn boundary
// the way Riyadh's real "مدينة الرياض"/Madinat Al Riyad relation turned out
// to (admin_level=8) — confirmed genuinely one-off, not a systematic
// per-city layer: a nationwide search for similarly-named "مدينة "-prefixed
// relations found Riyadh's and otherwise only small planned communities and
// UAE cities that happen to fall in the same bounding box, not Jeddah,
// Dammam, Mecca, Medina, Ta'if, Tabuk, Hail, Buraydah, or Khamis Mushait.
// **This is a real, structural data gap, not a technique failure — logged
// in BACKLOG.md rather than chased further.** The OSM admin_level=6
// governorate layer IS added as a supplemental source anyway (smallest-wins,
// so it can only help, never hurt) since its 149 units vs. geoBoundaries'
// own 147 hinted at a real coverage difference — confirmed: it resolves
// both of Dammam/Dhahran's original unmatched status (a real "Dammam
// Governorate" relation exists in OSM but not in geoBoundaries' download).
if (shouldRun('682'))
  report.saudiArabia = await runGeoBoundariesCountry({
    name: 'Saudi Arabia',
    numericId: '682',
    alpha3: 'SAU',
    admLevel: 'ADM2',
    extraOsm: {
      sourceLabel: 'osm-admin6',
      query: `[out:json][timeout:180];
area["ISO3166-1"="SA"][admin_level=2];
relation(area)["boundary"="administrative"]["admin_level"="6"];
out geom;`,
    },
  })

// Iran: geoBoundaries' finest level, ADM4 ("Dehestan", 2772 units), is a real
// mix of rural sub-district (dehestan) entries and actual named cities
// (shahr) at the same tier — e.g. "Tehran", "Lordegan", "Shahr-e Kord",
// "Bojnord", "Kazerun" all appear as their own features alongside the
// Persian-labeled rural dehestani. **A real, confirmed upstream data bug**:
// many of ADM4's own `shapeName` values are literal ASCII `?` characters
// (verified via the raw response bytes, the same way the Seventeenth pass
// verified Czechia/Hungary/Slovakia's garbled names — not a terminal/decode
// artifact), presumably wherever geoBoundaries' own pipeline failed to
// transliterate a Persian name. Harmless for the same reason every prior
// garbled-name finding was: the join is real point-in-polygon containment
// against real geometry, and the final output's `properties.name` always
// comes from GeoNames, never from a candidate's own (possibly-garbled)
// name.
if (shouldRun('364')) report.iran = await runGeoBoundariesCountry({ name: 'Iran', numericId: '364', alpha3: 'IRN', admLevel: 'ADM4' })

// Israel: geoBoundaries' finest level, ADM2 ("Subdistrict", 15 units, e.g.
// "Tel Aviv"/"HaSharon"/"Haifa"), is far too coarse — each subdistrict spans
// many separate real cities and towns (a subdistrict is closer to a US
// county than a municipality). Switched off geoBoundaries entirely in favor
// of OSM: a live Overpass query found Israel's real local-authority tier
// (city/local council/regional council, ~255 real units) is tagged
// `admin_level=8` (237 relations, real names — Rehovot, Ashqelon, Dimona,
// Arad, Yeruham, Omer, plus regional councils like "מועצה אזורית רמת נגב") —
// with a small `admin_level=9` supplement (11 more, likely finer
// subdivisions of one or two larger local authorities). Queried together
// since smallest-containing-polygon-wins makes this safe regardless of
// whether the two levels ever actually overlap for the same point.
if (!process.env.SKIP_OSM && shouldRun('376')) {
  console.log('\n=== Israel ===')
  const israelRaw = await fetchWithRetry(() =>
    fetchOverpass(`[out:json][timeout:180];
area["ISO3166-1"="IL"][admin_level=2];
relation(area)["boundary"="administrative"]["admin_level"~"^(8|9)$"];
out geom;`),
  )
  let israelUnclosedCount = 0
  const israelCandidates = israelRaw.elements.map((rel) => {
    const { geometry, closed } = relationToGeometry(rel)
    if (!closed) israelUnclosedCount++
    return { name: rel.tags?.name ?? `relation/${rel.id}`, geometry, source: 'osm-admin8-9' }
  })
  if (israelUnclosedCount > 0) console.log(`  [warn] ${israelUnclosedCount} Israel relations had an unclosed ring — kept anyway, area may be inaccurate for those`)
  const israelCities = loadCityPoints('376')
  const israelJoin = joinCityPointsToPolygons('Israel', israelCities, israelCandidates)
  writeCountryOutput('376', israelJoin.kept)
  report.israel = israelJoin.report
}

// Lebanon: geoBoundaries' finest level, ADM2 (26 aqdya/districts), matches
// the real caza count exactly but is still far coarser than Lebanon's real
// municipality tier. A live Overpass query found Lebanon's real
// municipality/quarter tier is tagged `admin_level=7` (1031 relations, real
// names — Beirut's own inner quarters like "الأشرفية"/Achrafieh,
// "باشورة"/Bachoura, "رأس بيروت"/Ras Beirut, mixed with ordinary
// municipalities elsewhere like "بعلبك"/Baalbek and "طرابلس"/Tripoli), with a
// smaller `admin_level=8` supplement (65 more). **A first run using only the
// OSM layer left 2 points unmatched, including Zahlé (78,145, a real
// district capital)** — a real, if small, OSM coverage gap for that specific
// municipality boundary, the same shape as Argentina/Colombia/Panama's own
// residual gaps elsewhere in this file. Rather than switch off geoBoundaries
// entirely (as first tried, the same "the general regional convention
// doesn't automatically apply, check directly" lesson as Moldova's own
// admin_level=8 finding in the Seventeenth pass), geoBoundaries' own ADM2
// (26 aqdya) is kept as a coarser backstop candidate set alongside OSM's
// municipality layer — smallest-containing-polygon-wins means the OSM layer
// still wins everywhere it actually has a boundary, and the caza-level
// polygon only ever gets used where OSM has a real gap.
if (!process.env.SKIP_OSM && shouldRun('422')) {
  console.log('\n=== Lebanon ===')
  const lebanonRaw = await fetchWithRetry(() =>
    fetchOverpass(`[out:json][timeout:180];
area["ISO3166-1"="LB"][admin_level=2];
relation(area)["boundary"="administrative"]["admin_level"~"^(7|8)$"];
out geom;`),
  )
  let lebanonUnclosedCount = 0
  const lebanonCandidates = lebanonRaw.elements.map((rel) => {
    const { geometry, closed } = relationToGeometry(rel)
    if (!closed) lebanonUnclosedCount++
    return { name: rel.tags?.name ?? `relation/${rel.id}`, geometry, source: 'osm-admin7-8' }
  })
  if (lebanonUnclosedCount > 0) console.log(`  [warn] ${lebanonUnclosedCount} Lebanon relations had an unclosed ring — kept anyway, area may be inaccurate for those`)
  const lebanonGbMeta = await fetchWithRetry(async () => {
    const res = await fetch('https://www.geoboundaries.org/api/current/gbOpen/LBN/ALL/')
    if (!res.ok) throw new Error(`geoBoundaries ${res.status}`)
    return res.json()
  })
  const lebanonAdm2Meta = lebanonGbMeta.find((l) => l.boundaryType === 'ADM2')
  const lebanonGb = await fetchWithRetry(async () => {
    const res = await fetch(lebanonAdm2Meta.gjDownloadURL)
    if (!res.ok) throw new Error(`geoBoundaries geojson ${res.status}`)
    return res.json()
  })
  for (const f of lebanonGb.features) lebanonCandidates.push({ name: f.properties.shapeName, geometry: f.geometry, source: 'geoboundaries-adm2' })
  const lebanonCities = loadCityPoints('422')
  const lebanonJoin = joinCityPointsToPolygons('Lebanon', lebanonCities, lebanonCandidates)
  writeCountryOutput('422', lebanonJoin.kept)
  report.lebanon = lebanonJoin.report
}

// United Arab Emirates: geoBoundaries has only ADM1 (the 7 emirates) — far
// too coarse (Abu Dhabi emirate alone contains Abu Dhabi city, Al Ain, and
// vast empty desert). Switched off geoBoundaries entirely in favor of OSM: a
// live Overpass query found a real, if inconsistent, mixed-level hierarchy —
// admin_level 4 (7, the emirates themselves, same as geoBoundaries' ADM1),
// 5 (1, an Abu Dhabi-specific sub-layer), 6 (3), 7 (15), and 8 (374, the
// large majority — real named areas/districts like "Kalba"/"خورفكان"
// (Khor Fakkan)/"السيف"/"النخيل") — the same "don't assume a single tier is
// uniform" lesson this file has already learned for Belize/Kuwait/Argentina/
// Belarus. **A first run with just 4-8 still rejected 57 of 107 points, most
// of them real Dubai districts (Deira, Jebel Ali, Umm Suqeim, Jumeirah, ...)
// falling back to the whole 7214.8 km² Dubai emirate polygon** — a real,
// verified gap: not every Dubai district has an admin_level 6-8 boundary,
// but several do exist one or two levels deeper (e.g. "مدينة دبي للغولف"/
// Dubai Golf City and "مدينة العمال"/Madinat Al Ummal at admin_level=10) that
// the 4-8 query simply couldn't see. Widened to 4-10; smallest-containing-
// polygon-wins makes this safe regardless of how deep a real boundary for
// any given district happens to sit, and the emirate level (4) still
// backstops anywhere none of the finer levels reach.
if (!process.env.SKIP_OSM && shouldRun('784')) {
  console.log('\n=== United Arab Emirates ===')
  const uaeRaw = await fetchWithRetry(() =>
    fetchOverpass(`[out:json][timeout:180];
area["ISO3166-1"="AE"][admin_level=2];
relation(area)["boundary"="administrative"]["admin_level"~"^(4|5|6|7|8|9|10)$"];
out geom;`),
  )
  let uaeUnclosedCount = 0
  const uaeCandidates = uaeRaw.elements.map((rel) => {
    const { geometry, closed } = relationToGeometry(rel)
    if (!closed) uaeUnclosedCount++
    return { name: rel.tags?.name ?? `relation/${rel.id}`, geometry, source: 'osm-admin4-8' }
  })
  if (uaeUnclosedCount > 0) console.log(`  [warn] ${uaeUnclosedCount} UAE relations had an unclosed ring — kept anyway, area may be inaccurate for those`)
  const uaeCities = loadCityPoints('784')
  const uaeJoin = joinCityPointsToPolygons('United Arab Emirates', uaeCities, uaeCandidates)
  writeCountryOutput('784', uaeJoin.kept)
  report.unitedArabEmirates = uaeJoin.report
}

// --- Nineteenth pass (2026-09-18): Central Asia + Caucasus (Armenia,
// Azerbaijan, Georgia, Kazakhstan, Kyrgyzstan, Tajikistan, Turkmenistan,
// Uzbekistan) — the westernmost slice of a west-to-east walk across the rest
// of Asia (Western Asia/Middle East already done above). Armenia/Azerbaijan/
// Georgia are geographically the Caucasus, not Central Asia proper, but
// folded into this same pass rather than given their own tiny 3-country
// batch.
//
// A recurring shape across this whole region: several capitals are
// administratively independent "cities of republican/state significance,"
// not part of any ADM2 district — the same structure Armenia's Yerevan/
// Georgia's Tbilisi/Uzbekistan's Tashkent already have correctly, confirmed
// by direct inspection to also appear as their own ADM2 feature (so no
// special-casing needed for those three), but Kazakhstan's Astana and
// Tajikistan's Dushanbe do NOT appear at ADM2 (only at ADM1, as their own
// unit) and needed a real backstop (see their own blocks below). Kyrgyzstan
// (Bishkek, Osh) and Turkmenistan (Ashgabat) went a step further: their
// capitals don't appear in geoBoundaries at ANY level, and a direct
// name-search Overpass query found zero OSM administrative boundary
// relations for any of the three either — a genuine, structural "no
// candidate polygon exists in any checked source" gap, the same conclusion
// as Saudi Arabia's major cities and Israel's West Bank settlements in the
// Eighteenth pass, not a technique failure.
//
// Four straightforward confirmations, each ADM2 already covering its own
// capital directly: Armenia's municipal communities (39, "Municipal
// Communities" — real names like "Stepanavan"/"Hrazdan"/"Gavar", Yerevan
// included), Azerbaijan's districts/cities (79 — real names carry their own
// "District"/"City" suffix, e.g. "Baku City"/"Ganja City"/"Sumqayit City"),
// Georgia's municipalities (68 — Tbilisi included, real names like
// "Zugdidi"/"Gudauta" even for Abkhazia, which Georgia doesn't actually
// control but geoBoundaries' download still carries), and Uzbekistan's
// tumans (199, an exact match to the real count — Tashkent included, many
// entries carry their own "city" suffix like "Bukhara city"/"Kagan city").
if (shouldRun('051')) report.armenia = await runGeoBoundariesCountry({ name: 'Armenia', numericId: '051', alpha3: 'ARM', admLevel: 'ADM2' })
if (shouldRun('031')) report.azerbaijan = await runGeoBoundariesCountry({ name: 'Azerbaijan', numericId: '031', alpha3: 'AZE', admLevel: 'ADM2' })
if (shouldRun('268')) report.georgia = await runGeoBoundariesCountry({ name: 'Georgia', numericId: '268', alpha3: 'GEO', admLevel: 'ADM2' })
// Uzbekistan: geoBoundaries' ADM2 (199 tumans) already includes Tashkent
// directly, but still rejected 49 of 221 points (10 substantial — real
// cities inside oversized rural tumans). A live OSM check found a much
// richer real hierarchy nationwide (viloyat/level 4, tuman/level 6 — closely
// matching geoBoundaries' own 199 — plus real finer layers at levels 8 and
// 10, including Tashkent's own internal city districts like "Yashnobod
// Tumani"). Added as a supplemental smallest-wins source alongside
// geoBoundaries' ADM2 rather than a full swap, since ADM2 already resolves
// the large majority cleanly.
if (shouldRun('860'))
  report.uzbekistan = await runGeoBoundariesCountry({
    name: 'Uzbekistan',
    numericId: '860',
    alpha3: 'UZB',
    admLevel: 'ADM2',
    extraOsm: {
      sourceLabel: 'osm-admin6-10',
      query: `[out:json][timeout:180];
area["ISO3166-1"="UZ"][admin_level=2];
relation(area)["boundary"="administrative"]["admin_level"~"^(6|7|8|9|10)$"];
out geom;`,
    },
  })

// Kyrgyzstan: geoBoundaries' ADM2 (41 raions) doesn't include Bishkek or
// Osh — both cities of republican significance, administratively
// independent of any raion — and, checked further, doesn't include most of
// Kyrgyzstan's other real cities either (Talas, Naryn, Karakol, Tokmok,
// Kyzyl-Kyya, ... all missing from the ADM2 download entirely). **A first
// Overpass search for "Bishkek"/"Osh" by name came back with zero results —
// a real bug in that search, not a real data gap**: both cities' primary
// OSM `name` tag is Cyrillic ("Бишкек шаары"/"Ош шаары"), and the search
// only matched the Latin `name` tag directly rather than `name:en`. A
// broader area-scoped query (not filtered by name) found both cities
// clearly, at `admin_level=4` — the same tier as Kyrgyzstan's 7 oblasts —
// alongside a real, comprehensive city/district layer at `admin_level=6`
// (raions AND real cities like "Талас шаары"/Talas City, "Каракол
// шаары"/Karakol City, sharing the tier the way Azerbaijan's own
// District/City-suffixed ADM2 already does). Switched off geoBoundaries
// entirely in favor of this — levels 4|6|8|9 together (8/9 are Bishkek's own
// internal city-district subdivisions, a handful of relations).
if (!process.env.SKIP_OSM && shouldRun('417')) {
  console.log('\n=== Kyrgyzstan ===')
  const kgzRaw = await fetchWithRetry(() =>
    fetchOverpass(`[out:json][timeout:180];
area["ISO3166-1"="KG"][admin_level=2];
relation(area)["boundary"="administrative"]["admin_level"~"^(4|6|8|9)$"];
out geom;`),
  )
  let kgzUnclosedCount = 0
  const kgzCandidates = kgzRaw.elements.map((rel) => {
    const { geometry, closed } = relationToGeometry(rel)
    if (!closed) kgzUnclosedCount++
    return { name: rel.tags?.['name:en'] ?? rel.tags?.name ?? `relation/${rel.id}`, geometry, source: 'osm-admin4-6-8-9' }
  })
  if (kgzUnclosedCount > 0) console.log(`  [warn] ${kgzUnclosedCount} Kyrgyzstan relations had an unclosed ring — kept anyway, area may be inaccurate for those`)
  const kgzCities = loadCityPoints('417')
  const kgzJoin = joinCityPointsToPolygons('Kyrgyzstan', kgzCities, kgzCandidates)
  writeCountryOutput('417', kgzJoin.kept)
  report.kyrgyzstan = kgzJoin.report
}

// Turkmenistan: geoBoundaries' ADM2 (59 units) has real data-quality issues
// (12 of 59 features have a genuinely blank `shapeName` — harmless for this
// project's join, since a candidate's own name never reaches the final
// output — and a few real names repeat across separate features) on top of
// missing Ashgabat entirely, at any geoBoundaries level. **A first Overpass
// name search for "Ashgabat"/"Asgabat" came back with zero results — the
// same Latin-vs-native-script search bug as Kyrgyzstan above**: Ashgabat's
// real OSM name is "Aşgabat" (with a Turkmen-alphabet ş), which a plain
// ASCII regex never matches. A broader area-scoped query found it clearly,
// at `admin_level=5` (its own tier, one level below the 5 welayat), plus
// real city-level boundaries at `admin_level=6` carrying their own "şäheri"
// (city) suffix — "Türkmenbaşy şäheri"/Turkmenbashy, "Türkmenabat
// şäheri"/Turkmenabat, "Baýramaly şäheri"/Bayramaly. Switched off
// geoBoundaries entirely in favor of OSM levels 5|6|7|8 together (5 catches
// Ashgabat specifically; 6 is the real district/city-mixed tier; 7/8 are
// smaller supplemental layers).
if (!process.env.SKIP_OSM && shouldRun('795')) {
  console.log('\n=== Turkmenistan ===')
  const tkmRaw = await fetchWithRetry(() =>
    fetchOverpass(`[out:json][timeout:180];
area["ISO3166-1"="TM"][admin_level=2];
relation(area)["boundary"="administrative"]["admin_level"~"^(5|6|7|8)$"];
out geom;`),
  )
  let tkmUnclosedCount = 0
  const tkmCandidates = tkmRaw.elements.map((rel) => {
    const { geometry, closed } = relationToGeometry(rel)
    if (!closed) tkmUnclosedCount++
    return { name: rel.tags?.['name:en'] ?? rel.tags?.name ?? `relation/${rel.id}`, geometry, source: 'osm-admin5-8' }
  })
  if (tkmUnclosedCount > 0) console.log(`  [warn] ${tkmUnclosedCount} Turkmenistan relations had an unclosed ring — kept anyway, area may be inaccurate for those`)
  const tkmCities = loadCityPoints('795')
  const tkmJoin = joinCityPointsToPolygons('Turkmenistan', tkmCities, tkmCandidates)
  writeCountryOutput('795', tkmJoin.kept)
  report.turkmenistan = tkmJoin.report
}

// Kazakhstan: geoBoundaries' ADM2 (174 districts) already includes several
// major cities as their own feature (confirmed directly: "Almaty
// (Alma-Ata)" and "Shymkent" both present) but NOT Astana, the actual
// capital (~1.2M) — administratively independent of any district, the same
// shape as every other capital in this pass. Astana DOES have a real
// polygon one level up: geoBoundaries' own ADM1 carries it as its own unit
// (Kazakhstan's 16 ADM1 units are a mix of oblasts and 3 independent
// cities) — added as a single supplemental candidate, the same "capital
// point against a coarser official polygon, everything else against the
// finer tier" shape as Monaco's ADM1/ADM2 hybrid. **This still left 324 of
// 352 points rejected, 92 of them substantial — real major regional cities
// (Karagandy 497,777; Pavlodar 329,002; Oral 330,000; Semey 292,780;
// Ust-Kamenogorsk 319,067; Atyrau 290,700; ...) lost to districts spanning
// thousands to tens of thousands of km², the largest a genuinely enormous
// 128,664 km².** A live OSM check found a much finer real tier: raions
// (`admin_level=6`, 226, closely matching geoBoundaries' own 174) plus a
// real, comprehensive sub-district layer at `admin_level=8` (907 relations)
// — Kazakhstan's own "ауыл округі" (rural-district/village-council) tier,
// fine enough that real cities inside a huge raion get their own much
// smaller polygon separate from the surrounding rural area. Added as a
// supplemental smallest-wins source (levels 6|8|9|10 together) rather than
// a full swap, since geoBoundaries' ADM2 already correctly includes Almaty/
// Shymkent as their own feature.
if (shouldRun('398')) {
  console.log('\n=== Kazakhstan ===')
  const kazMeta = await fetchWithRetry(async () => {
    const res = await fetch('https://www.geoboundaries.org/api/current/gbOpen/KAZ/ALL/')
    if (!res.ok) throw new Error(`geoBoundaries ${res.status}`)
    return res.json()
  })
  const kazAdm2Meta = kazMeta.find((l) => l.boundaryType === 'ADM2')
  const kazAdm2 = await fetchWithRetry(async () => {
    const res = await fetch(kazAdm2Meta.gjDownloadURL)
    if (!res.ok) throw new Error(`geoBoundaries geojson ${res.status}`)
    return res.json()
  })
  const kazAdm1Meta = kazMeta.find((l) => l.boundaryType === 'ADM1')
  const kazAdm1 = await fetchWithRetry(async () => {
    const res = await fetch(kazAdm1Meta.gjDownloadURL)
    if (!res.ok) throw new Error(`geoBoundaries geojson ${res.status}`)
    return res.json()
  })
  const kazCandidates = kazAdm2.features.map((f) => ({ name: f.properties.shapeName, geometry: f.geometry, source: 'geoboundaries-adm2' }))
  const astana = kazAdm1.features.find((f) => f.properties.shapeName === 'Astana')
  if (astana) kazCandidates.push({ name: astana.properties.shapeName, geometry: astana.geometry, source: 'geoboundaries-adm1' })
  else console.log('  [warn] "Astana" not found in Kazakhstan ADM1 — capital city may be unmatched')
  const kazOsmRaw = await fetchWithRetry(() =>
    fetchOverpass(`[out:json][timeout:180];
area["ISO3166-1"="KZ"][admin_level=2];
relation(area)["boundary"="administrative"]["admin_level"~"^(6|8|9|10)$"];
out geom;`),
  )
  let kazOsmUnclosedCount = 0
  for (const rel of kazOsmRaw.elements) {
    const { geometry, closed } = relationToGeometry(rel)
    if (!closed) kazOsmUnclosedCount++
    kazCandidates.push({ name: rel.tags?.['name:en'] ?? rel.tags?.name ?? `relation/${rel.id}`, geometry, source: 'osm-admin6-10' })
  }
  if (kazOsmUnclosedCount > 0) console.log(`  [warn] ${kazOsmUnclosedCount} Kazakhstan OSM relations had an unclosed ring — kept anyway, area may be inaccurate for those`)
  console.log(`  +${kazOsmRaw.elements.length} supplemental OSM candidates (osm-admin6-10)`)
  const kazCities = loadCityPoints('398')
  const kazJoin = joinCityPointsToPolygons('Kazakhstan', kazCities, kazCandidates)
  writeCountryOutput('398', kazJoin.kept)
  report.kazakhstan = kazJoin.report
}

// Tajikistan: geoBoundaries' ADM2 (58 districts) doesn't include Dushanbe,
// the capital — the same administratively-independent-city shape as every
// other capital in this pass. Confirmed it DOES have a real polygon at
// ADM1 (Tajikistan's 5 ADM1 units are a mix of regions and Dushanbe itself)
// — added as a single supplemental candidate, the same Kazakhstan/Monaco
// pattern immediately above. A live OSM check found a real, if smaller,
// finer layer too (`admin_level` 6|7|8|10, 121 relations total) — added as
// a further supplement, though this pass's rejection count for Tajikistan
// was already small (2 substantial) before this fix.
if (shouldRun('762')) {
  console.log('\n=== Tajikistan ===')
  const tjkMeta = await fetchWithRetry(async () => {
    const res = await fetch('https://www.geoboundaries.org/api/current/gbOpen/TJK/ALL/')
    if (!res.ok) throw new Error(`geoBoundaries ${res.status}`)
    return res.json()
  })
  const tjkAdm2Meta = tjkMeta.find((l) => l.boundaryType === 'ADM2')
  const tjkAdm2 = await fetchWithRetry(async () => {
    const res = await fetch(tjkAdm2Meta.gjDownloadURL)
    if (!res.ok) throw new Error(`geoBoundaries geojson ${res.status}`)
    return res.json()
  })
  const tjkAdm1Meta = tjkMeta.find((l) => l.boundaryType === 'ADM1')
  const tjkAdm1 = await fetchWithRetry(async () => {
    const res = await fetch(tjkAdm1Meta.gjDownloadURL)
    if (!res.ok) throw new Error(`geoBoundaries geojson ${res.status}`)
    return res.json()
  })
  const tjkCandidates = tjkAdm2.features.map((f) => ({ name: f.properties.shapeName, geometry: f.geometry, source: 'geoboundaries-adm2' }))
  const dushanbe = tjkAdm1.features.find((f) => f.properties.shapeName === 'Dushanbe')
  if (dushanbe) tjkCandidates.push({ name: dushanbe.properties.shapeName, geometry: dushanbe.geometry, source: 'geoboundaries-adm1' })
  else console.log('  [warn] "Dushanbe" not found in Tajikistan ADM1 — capital city may be unmatched')
  const tjkOsmRaw = await fetchWithRetry(() =>
    fetchOverpass(`[out:json][timeout:180];
area["ISO3166-1"="TJ"][admin_level=2];
relation(area)["boundary"="administrative"]["admin_level"~"^(6|7|8|10)$"];
out geom;`),
  )
  let tjkOsmUnclosedCount = 0
  for (const rel of tjkOsmRaw.elements) {
    const { geometry, closed } = relationToGeometry(rel)
    if (!closed) tjkOsmUnclosedCount++
    tjkCandidates.push({ name: rel.tags?.['name:en'] ?? rel.tags?.name ?? `relation/${rel.id}`, geometry, source: 'osm-admin6-8-10' })
  }
  if (tjkOsmUnclosedCount > 0) console.log(`  [warn] ${tjkOsmUnclosedCount} Tajikistan OSM relations had an unclosed ring — kept anyway, area may be inaccurate for those`)
  console.log(`  +${tjkOsmRaw.elements.length} supplemental OSM candidates (osm-admin6-8-10)`)
  const tjkCities = loadCityPoints('762')
  const tjkJoin = joinCityPointsToPolygons('Tajikistan', tjkCities, tjkCandidates)
  writeCountryOutput('762', tjkJoin.kept)
  report.tajikistan = tjkJoin.report
}

// --- Twentieth pass (2026-09-18): South Asia minus India (Afghanistan,
// Pakistan, Nepal, Bhutan, Bangladesh, Sri Lanka, Maldives) — continuing the
// west-to-east walk across Asia the Nineteenth pass (Central Asia +
// Caucasus) started. India deliberately excluded and held for its own
// dedicated investigation, the same reasoning Russia is excluded from every
// routine regional batch — its recon-reported finest level (ADM5, 649,771
// units, min area 0.0004 km²) is village-scale, not remotely city-scale, and
// picking a real level for a country this size needs its own pass, not a
// blind adoption into a 7-country batch built around much smaller countries.
//
// Two real "don't trust canonicalName" catches, the same discipline this
// file has followed since Belize/Lithuania/Sweden: Bangladesh's recon-
// reported finest level (ADM4, canonicalName "Union Councils / Municipal
// Corporations / City Corporations", 5,160 units) sounds like exactly the
// city-scale level this join needs, but a direct point-in-polygon check
// against Dhaka/Chattogram/Rajshahi/Sylhet's real coordinates landed each
// one in an individual city WARD (0.4-0.9 km², e.g. Dhaka -> "Ward No-73")
// — sub-city, not city-scale, the same shape as Sri Lanka's Grama Niladhari
// problem below. ADM3 ("subdistricts"/Upazila, 544 units) landed the same
// four cities in Kotwali/Boalia/Sylhet Sadar/Chittagong Port — real
// city-scale units (0.8-318 km²) — and is used instead. Sri Lanka's own
// recon-reported finest level (ADM4, "Grama Niladhari Divisions", 14,044
// units) has the identical problem — Colombo/Kandy/Jaffna all land in a
// sub-1 km² GN division, not a city boundary — while ADM3 ("Divisional
// Secretariat", 330 units) puts Colombo in its own 22 km² DS division
// directly. Afghanistan/Pakistan/Nepal all confirmed clean on their
// recon-reported finest level (ADM2/ADM3/ADM3 respectively — Kabul,
// Kandahar, Mazari Sharif; Karachi, Lahore, Islamabad, Faisalabad,
// Rawalpindi; Kathmandu, Pokhara, Biratnagar, Lalitpur, Bharatpur all
// confirmed present as their own named unit), no override needed.
if (shouldRun('004')) report.afghanistan = await runGeoBoundariesCountry({ name: 'Afghanistan', numericId: '004', alpha3: 'AFG', admLevel: 'ADM2' })
if (shouldRun('586')) report.pakistan = await runGeoBoundariesCountry({ name: 'Pakistan', numericId: '586', alpha3: 'PAK', admLevel: 'ADM3' })
if (shouldRun('524')) report.nepal = await runGeoBoundariesCountry({ name: 'Nepal', numericId: '524', alpha3: 'NPL', admLevel: 'ADM3' })
if (shouldRun('050')) report.bangladesh = await runGeoBoundariesCountry({ name: 'Bangladesh', numericId: '050', alpha3: 'BGD', admLevel: 'ADM3' })
if (shouldRun('144')) report.sriLanka = await runGeoBoundariesCountry({ name: 'Sri Lanka', numericId: '144', alpha3: 'LKA', admLevel: 'ADM3' })

// Bhutan: geoBoundaries' ADM2 (205 Gewogs, real rural blocks) already
// covers Phuentsholing (note the real spelling) as its own 133.8 km² unit,
// confirmed by direct point-in-polygon check — but not the capital: Thimphu
// lands inside the surrounding rural "Chang" Gewog (157 km²) instead, since
// Thimphu Thromde (city) is administratively independent of any Gewog, the
// same shape as every other capital in this pass. A live OSM check found
// exactly one real Thromde boundary in the whole country — Thimphu itself,
// admin_level=5 (the same tier as Bhutan's 20 Dzongkhags) — added as a
// single supplemental candidate, the Kazakhstan/Tajikistan/Monaco "capital
// point against its own coarser-tier polygon" pattern.
if (shouldRun('064')) {
  console.log('\n=== Bhutan ===')
  const btnMeta = await fetchWithRetry(async () => {
    const res = await fetch('https://www.geoboundaries.org/api/current/gbOpen/BTN/ALL/')
    if (!res.ok) throw new Error(`geoBoundaries ${res.status}`)
    return res.json()
  })
  const btnAdm2Meta = btnMeta.find((l) => l.boundaryType === 'ADM2')
  const btnAdm2 = await fetchWithRetry(async () => {
    const res = await fetch(btnAdm2Meta.gjDownloadURL)
    if (!res.ok) throw new Error(`geoBoundaries geojson ${res.status}`)
    return res.json()
  })
  const btnCandidates = btnAdm2.features.map((f) => ({ name: f.properties.shapeName, geometry: f.geometry, source: 'geoboundaries-adm2' }))
  const btnOsmRaw = await fetchWithRetry(() =>
    fetchOverpass(`[out:json][timeout:60];
area["ISO3166-1"="BT"][admin_level=2];
relation(area)["boundary"="administrative"]["admin_level"="5"];
out geom;`),
  )
  let btnOsmUnclosedCount = 0
  for (const rel of btnOsmRaw.elements) {
    const { geometry, closed } = relationToGeometry(rel)
    if (!closed) btnOsmUnclosedCount++
    btnCandidates.push({ name: rel.tags?.['name:en'] ?? rel.tags?.name ?? `relation/${rel.id}`, geometry, source: 'osm-admin5' })
  }
  if (btnOsmUnclosedCount > 0) console.log(`  [warn] ${btnOsmUnclosedCount} Bhutan supplemental OSM relations had an unclosed ring — kept anyway, area may be inaccurate for those`)
  console.log(`  +${btnOsmRaw.elements.length} supplemental OSM candidates (osm-admin5, Thimphu Thromde)`)
  const btnCities = loadCityPoints('064')
  const btnJoin = joinCityPointsToPolygons('Bhutan', btnCities, btnCandidates)
  writeCountryOutput('064', btnJoin.kept)
  report.bhutan = btnJoin.report
}

// Maldives: geoBoundaries' finest level (ADM2, "Administrative Atolls", 21
// units) is the SAME 21-atoll partition as its own ADM1 — a whole atoll
// (lagoon included, up to ~2,300 km²) is nowhere near city scale, and every
// city in it would join to the same huge polygon regardless of which real
// island it's actually on. Switched off geoBoundaries entirely. OSM has
// real, comprehensive per-island landmass coverage instead: 894
// `place=island`/`place=islet` features across the country (almost all
// mapped as a single closed `way`, not a `relation` — see `wayToGeometry`'s
// own comment above for why this pass needed a real new geometry
// converter), confirmed directly against real inhabited islands
// (Fuvahmulah, Kulhudhuffushi, Hithadhoo all present by name). Malé itself —
// the capital, fully urbanized, ~2 km² total — has no single `place=island`
// polygon of its own; its administrative area is covered instead by 6 real
// admin_level 8/9 relations (Hulhumalé/Vilimalé at 8, the four wards
// Galolhu/Henveiru/Maafannu/Machchangolhi at 9), added as further
// supplemental candidates. A GeoNames point for a resort/uninhabited islet
// with no matching OSM island polygon still has the 2km snap fallback to
// fall back on before counting as a real unmatched gap.
if (!process.env.SKIP_OSM && shouldRun('462')) {
  console.log('\n=== Maldives ===')
  const mdvIslandsRaw = await fetchWithRetry(() =>
    fetchOverpass(`[out:json][timeout:180];
area["ISO3166-1"="MV"][admin_level=2]->.mv;
(
  way["place"~"^(island|islet)$"](area.mv);
  relation["place"~"^(island|islet)$"](area.mv);
);
out geom;`),
  )
  const mdvCandidates = []
  let mdvUnclosedCount = 0
  for (const el of mdvIslandsRaw.elements) {
    if (el.type === 'way') {
      mdvCandidates.push({ name: el.tags?.['name:en'] ?? el.tags?.name ?? `way/${el.id}`, geometry: wayToGeometry(el), source: 'osm-place-island' })
    } else if (el.type === 'relation') {
      const { geometry, closed } = relationToGeometry(el)
      if (!closed) mdvUnclosedCount++
      mdvCandidates.push({ name: el.tags?.['name:en'] ?? el.tags?.name ?? `relation/${el.id}`, geometry, source: 'osm-place-island' })
    }
  }
  console.log(`  +${mdvCandidates.length} island candidates (osm-place-island)`)
  const mdvMaleRaw = await fetchWithRetry(() =>
    fetchOverpass(`[out:json][timeout:60];
area["ISO3166-1"="MV"][admin_level=2];
relation(area)["boundary"="administrative"]["admin_level"~"^(8|9)$"];
out geom;`),
  )
  for (const rel of mdvMaleRaw.elements) {
    const { geometry, closed } = relationToGeometry(rel)
    if (!closed) mdvUnclosedCount++
    mdvCandidates.push({ name: rel.tags?.['name:en'] ?? rel.tags?.name ?? `relation/${rel.id}`, geometry, source: 'osm-admin8-9' })
  }
  if (mdvUnclosedCount > 0) console.log(`  [warn] ${mdvUnclosedCount} Maldives OSM elements had an unclosed ring — kept anyway, area may be inaccurate for those`)
  console.log(`  +${mdvMaleRaw.elements.length} Malé-area supplemental candidates (osm-admin8-9)`)
  const mdvCities = loadCityPoints('462')
  const mdvJoin = joinCityPointsToPolygons('Maldives', mdvCities, mdvCandidates)
  writeCountryOutput('462', mdvJoin.kept)
  report.maldives = mdvJoin.report
}

// --- Twenty-first pass (2026-09-18): East Asia (China, Japan, Mongolia,
// North Korea, South Korea) — continuing the west-to-east walk across Asia
// the Nineteenth/Twentieth passes started. Every level below was confirmed
// by a direct point-in-polygon check against real coordinates (Beijing/
// Shanghai/Guangzhou/Shenzhen/Chengdu/Wuhan/Hong Kong; Tokyo's own Shinjuku/
// Shibuya wards plus Osaka/Yokohama/Sapporo/Naha/Kyoto; Ulaanbaatar/Erdenet/
// Darkhan; Pyongyang/Hamhung/Chongjin/Nampo; Seoul's Gangnam-gu/Busan/
// Incheon/Daegu), not just trusted from recon's own canonicalName field.
//
// Japan's recon-reported finest level (ADM2, canonicalName "Subprefectures",
// 1,742 units) is another "canonicalName looks wrong but the level is
// right" case — a real Japanese subprefecture (振興局) is a coarser regional
// tier that exists only in Hokkaido, not something that could produce 1,742
// units nationwide. The actual content is Japan's real municipality
// layer (shi/machi/mura, city wards for the largest cities) — confirmed
// directly: Tokyo's Shinjuku/Shibuya each resolve to their own real ward
// (15-18 km²), and Osaka/Yokohama/Sapporo/Naha/Kyoto each resolve to their
// own real city polygon. Used as-is via runGeoBoundariesCountry.
//
// South Korea needed the same override this file has now hit repeatedly
// (Bangladesh/Sri Lanka's ADM4, Belize's Constituencies): recon's reported
// finest level (ADM3, "submunicipalities", 3,504 units) sounds plausible but
// a direct check lands Seoul's Gangnam/Busan/Incheon/Daegu each in an
// individual dong (0.7-1.8 km²) — neighborhood scale, not a city boundary.
// ADM2 ("Si, Kun districts and city districts", 228 units) puts the same
// four cities in their own real gu/gun (16.7-104.6 km²) instead, and is
// used.
//
// Mongolia (ADM2, "soum, düüregs", 339 units) and North Korea (ADM2,
// "county, city, special city", 179 units, the finest level geoBoundaries
// has for PRK — no ADM3) both confirmed clean on their recon-reported
// finest level with no override needed: Ulaanbaatar/Erdenet/Darkhan each
// land in their own real düüreg/soum, and Pyongyang/Hamhung/Chongjin/Nampo
// each land in their own named city unit. North Korea's own special cities
// (Pyongyang 1,166 km², Chongjin City 1,892 km²) have no finer internal
// district split available in this source, unlike China/Japan/South
// Korea's largest cities — accepted as the finest real unit obtainable,
// same shape as every other capital-with-no-finer-tier case this file has
// already accepted (Serbia before its Belgrade fix, every North Korea-style
// "no OSM alternative either" case). A live OSM check for North Korea found
// essentially no usable `boundary=administrative` coverage below country
// level (single digits of relations nationwide, nowhere near a real
// supplemental tier) — not surprising for the least-mapped OSM country in
// the region, and not chased further; ADM2 alone already resolves every
// substantial NK town in this app's GeoNames index cleanly (see the report
// below).
//
// China needed real sharding, not just a bigger file: ADM3 ("County, City",
// 2,864 units) is the correct city-plausible level (confirmed directly —
// Beijing/Shanghai/Guangzhou/Shenzhen/Chengdu/Wuhan/Hong Kong each resolve
// to their own real district, e.g. Beijing -> Dongcheng District 41.75 km²,
// not the whole 4,834 km² Beijingshi that ADM2 alone would give), but this
// app's own GeoNames index carries 16,055 China points — more than any
// country in this file except the US — so the same "one flat country file
// becomes the huge-eager-fetch problem" shape Mexico/Brazil/Italy/Germany/
// France/Spain already hit applies here too, at a larger scale than any of
// them. Sharded via shardByState() using `iso_3166_2` (not `postal` — see
// below) against the 32 CHN entries in the vendored Natural Earth admin-1
// file (missing Hong Kong/Macau, which are their own separate `adm0_a3` in
// that source and irrelevant here since neither is a UN member; also
// missing the uninhabited, cityless Paracel Islands entry, whose blank
// `postal`/present-but-non-standard `iso_3166_2` value shardByState's own
// falsy-abbrev filter already drops from the candidate list).
//
// **A real, chained Natural Earth `postal`-field bug, distinct from every
// prior one this file has found** (Germany's Brandenburg/Berlin collision,
// France's blank values, Spain's autonomous-community-not-province values):
// here the 32 CHN `postal` values ARE all mutually unique (so shardByState
// wouldn't have thrown or silently merged two provinces), but four of them
// are simply WRONG — a rotated mislabeling, not a collision. Hebei's own
// `postal` is "HB" (Hubei's real abbreviation), Henan's is "HE" (Hebei's),
// Hubei's is "HU" (not a real abbreviation for anything), and Hainan's is
// "HA" (Henan's real abbreviation) — checked against the standard GB/T
// 2260 two-letter provincial codes (HE=Hebei, HA=Henan, HB=Hubei, HI=
// Hainan). `iso_3166_2` does NOT have this bug (CN-HE/CN-HA/CN-HB/CN-HI
// resolve correctly) and is used instead, the same "don't trust postal
// blindly, check it against a real independent reference" discipline
// Germany/France/Spain already established — caught here only because this
// pass happened to spot-check the raw vendor properties directly rather
// than assuming a unique `postal` value is automatically also a correct
// one. Functionally this would have been harmless either way (shardByState
// only uses the field as an output-filename key, never to do the actual
// point-in-polygon match), but a shard file named `ha.json` actually
// holding Henan's cities while `hi.json` doesn't exist at all would have
// been a confusing trap for anyone debugging this data later.
//
// Real, accepted residuals, both logged to BACKLOG.md: China (487 of 16,055
// rejected, dominated by Xinjiang/Tibet/Qinghai/Inner Mongolia's genuinely
// enormous desert/plateau counties — Golmud alone is >100,000 km², larger
// than many countries in this file — no finer OSM tier exists at
// comprehensive nationwide coverage, the same "real geography, not a
// technique failure" shape as Kazakhstan/Afghanistan/Pakistan's own
// oversized-district residuals) and North Korea (a handful of small towns
// near the Chinese/Russian border with no containing unit within
// SNAP_MAX_KM, real remote geography rather than a join bug).
if (shouldRun('156')) {
  report.china = await runGeoBoundariesCountry({
    name: 'China',
    numericId: '156',
    alpha3: 'CHN',
    admLevel: 'ADM3',
    // "Paracel Islands" is itself a real candidate polygon in the vendored
    // NE admin-1 file (a cartographic placeholder, not a real ADM1 unit —
    // its own `iso_3166_2`, "CN-X01~", isn't a real province code) that
    // would otherwise directly contain Sansha (population 1,443, the real
    // prefecture-level city administratively covering the Paracel/Spratly
    // Islands) and shard it into its own nonsense "x01~.json" file instead
    // of the real province, Hainan, Sansha is actually part of — excluded
    // here so Sansha falls through to shardByState's own nearest-real-
    // province-by-centroid fallback instead (confirmed to land in Hainan).
    onOutput: (kept) =>
      shardByState('156', kept, {
        adm0A3: 'CHN',
        abbrevOf: (props) => (props.name === 'Paracel Islands' ? undefined : props.iso_3166_2?.replace(/^CN-/, '')),
      }),
  })
}
if (shouldRun('392')) report.japan = await runGeoBoundariesCountry({ name: 'Japan', numericId: '392', alpha3: 'JPN', admLevel: 'ADM2' })
if (shouldRun('496')) report.mongolia = await runGeoBoundariesCountry({ name: 'Mongolia', numericId: '496', alpha3: 'MNG', admLevel: 'ADM2' })
if (shouldRun('408')) report.northKorea = await runGeoBoundariesCountry({ name: 'North Korea', numericId: '408', alpha3: 'PRK', admLevel: 'ADM2' })
// South Korea's ADM2 rejected 10 of 311 points as unmatched, all clustered
// around one place: Yeonggwang County (population 51,688) and 9 of its own
// constituent townships (Baeksu, Hongnong, Yeomsan, ...) — geoBoundaries'
// KOR ADM2 download is simply missing this one county entirely (confirmed
// directly: zero features anywhere in the file with "Yeonggwang" in the
// name), not a plausibility rejection or a real geographic gap the way
// Mongolia's residual below is. A live OSM check found it cleanly at the
// same admin_level=6 every other South Korean county in this dataset sits
// at — Latin-script name search came back empty (`name:en` IS "Yeonggwang"
// here, unlike Kyrgyzstan/Turkmenistan's non-Latin-only case, so this looks
// like an unrelated Overpass query quirk rather than the same root cause),
// but an exact Korean-name search ("영광군") found the one missing relation
// directly. Added as a single supplemental candidate, the same Bhutan/
// Kazakhstan/Tajikistan "one specific missing unit, not a whole missing
// tier" pattern.
if (shouldRun('410'))
  report.southKorea = await runGeoBoundariesCountry({
    name: 'South Korea',
    numericId: '410',
    alpha3: 'KOR',
    admLevel: 'ADM2',
    extraOsm: {
      sourceLabel: 'osm-yeonggwang',
      query: `[out:json][timeout:60];
area["ISO3166-1"="KR"][admin_level=2];
relation(area)["boundary"="administrative"]["name"="영광군"];
out geom;`,
    },
  })

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
