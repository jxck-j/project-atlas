// Report-only research script: what administrative level is each country's
// real "city equivalent" — the first concrete step of
// city-boundaries-architecture.md's "Second refinement" section, which
// requires a per-feature, investigate-before-trusting join rather than a
// blanket per-country source pick.
//
// This script does NOT do that per-feature join yet (that needs each
// candidate level's full geojson downloaded and point-in-polygon-matched
// against real GeoNames cities — a much heavier follow-up). It does the
// cheaper, necessary first pass: geoBoundaries' own metadata API
// (https://www.geoboundaries.org/api/current/gbOpen/{ISO3}/ALL/) reports,
// per country, every ADM level it has, each level's boundaryCanonical (the
// local administrative term — "Governorate", "Commune", ...), admUnitCount,
// and mean/min/max area in km2 — enough to flag, per level, whether it's
// even in the right ballpark to contain city-scale features (a level whose
// MINIMUM area is already in the tens of thousands of km2 cannot contain a
// single city-scale polygon; a level with a small minimum might, pending
// the real per-feature check).
//
// Same "report only, never auto-edit curated data" discipline as
// buildGeoEntityEconomics.mjs — this writes a JSON report for a human (or a
// follow-up build script) to read, not a source-of-truth data file. The
// Jordan/Kuwait findings already in city-boundaries-architecture.md were
// hand-derived exactly this way (geoBoundaries metadata + spot checks); this
// script just does that same lookup for all 193 UN members instead of 2.
//
// Usage:
//   node scripts/researchCityAdminLevels.mjs --sample=5
//     Dry run: first 5 countries (alphabetically by name), prints only.
//   npm run research:city-admin-levels
//     Full run: all 193 UN members, writes
//     scripts/cityAdminLevelsReport.json (+ prints a summary table).
import fs from 'node:fs'
import { feature } from 'topojson-client'
import { ALPHA3_TO_NUMERIC } from './lib/iso3166.mjs'

const COUNTRIES_SOURCE = 'public/geo/countries-un193.json'
const REPORT_OUTPUT = 'scripts/cityAdminLevelsReport.json'
const API_BASE = 'https://www.geoboundaries.org/api/current/gbOpen'

// A level whose MINIMUM feature area is at or below this is plausibly
// city-scale for at least one of its features (real cities span a huge
// range — Vatican-sized city-states up through sprawling metros — this is
// deliberately generous; it's a "worth a closer per-feature look" filter,
// not a final accept/reject). Above this, a level is almost certainly a
// district/governorate/province tier even at its smallest member.
const CITY_PLAUSIBLE_MAX_MIN_AREA_SQKM = 500

const sampleArg = process.argv.find((a) => a.startsWith('--sample='))
const sampleSize = sampleArg ? Number(sampleArg.split('=')[1]) : null
const isSample = sampleSize != null

// ALPHA3_TO_NUMERIC is intentionally many-to-one for South Sudan (SSD, the
// real ISO code, and SDS, a Natural-Earth-specific non-standard alias — see
// that file's own comment) — first entry wins so this reversal keeps the
// real ISO code, not whichever alias happens to iterate last. Verified
// (2026-09-04) to be the only duplicate numeric id in the table today; a
// bare "last write wins" reversal silently produced "SDS" for South Sudan,
// which geoBoundaries' API 404s on, and got misreported as "no coverage" —
// a real bug in this script, not a real data gap (South Sudan has real
// ADM0/ADM1/ADM2 geoBoundaries data under its actual code, SSD).
const NUMERIC_TO_ALPHA3 = {}
for (const [a3, num] of Object.entries(ALPHA3_TO_NUMERIC)) {
  if (!NUMERIC_TO_ALPHA3[num]) NUMERIC_TO_ALPHA3[num] = a3
}

const topo = JSON.parse(fs.readFileSync(COUNTRIES_SOURCE, 'utf8'))
const countryFeatures = feature(topo, topo.objects.countries).features
let countries = countryFeatures
  .map((f) => ({ id: String(f.id), name: f.properties.name, alpha3: NUMERIC_TO_ALPHA3[String(f.id)] }))
  .sort((a, b) => a.name.localeCompare(b.name))

if (!countries.every((c) => c.alpha3)) {
  throw new Error('[researchCityAdminLevels] a UN-193 country has no alpha3 mapping — fix iso3166.mjs before running.')
}

if (isSample) countries = countries.slice(0, sampleSize)

async function fetchLevels(alpha3) {
  const res = await fetch(`${API_BASE}/${alpha3}/ALL/`)
  if (!res.ok) return { ok: false, status: res.status }
  const body = await res.json()
  // geoBoundaries returns a message object (not an array) for a country
  // it has zero gbOpen coverage for at all, e.g. {"message": "..."}.
  if (!Array.isArray(body)) return { ok: false, status: 'no-coverage' }
  return { ok: true, levels: body }
}

async function withRetry(fn, attempts = 3) {
  let lastErr
  for (let i = 0; i < attempts; i++) {
    try {
      return await fn()
    } catch (err) {
      lastErr = err
      await new Promise((r) => setTimeout(r, 300 * (i + 1)))
    }
  }
  throw lastErr
}

// Small bounded concurrency, not full sequential (193 requests at ~0.4s each
// sequential is ~80s; not worth the complexity of a large pool either) and
// not unbounded (polite to a free public API).
const CONCURRENCY = 8
async function mapWithConcurrency(items, limit, fn) {
  const results = new Array(items.length)
  let next = 0
  async function worker() {
    while (next < items.length) {
      const i = next++
      results[i] = await fn(items[i], i)
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker))
  return results
}

const report = []
const noCoverage = []
const errors = []

await mapWithConcurrency(countries, CONCURRENCY, async (country) => {
  let result
  try {
    result = await withRetry(() => fetchLevels(country.alpha3))
  } catch (err) {
    errors.push({ ...country, error: String(err) })
    return
  }
  if (!result.ok) {
    noCoverage.push({ ...country, status: result.status })
    return
  }

  const levels = result.levels
    .filter((l) => l.boundaryType !== 'ADM0')
    .map((l) => ({
      level: l.boundaryType,
      canonicalName: l.boundaryCanonical && l.boundaryCanonical !== 'nan' ? l.boundaryCanonical : null,
      admUnitCount: Number(l.admUnitCount),
      meanAreaSqKm: Number(l.meanAreaSqKM),
      minAreaSqKm: Number(l.minAreaSqKM),
      maxAreaSqKm: Number(l.maxAreaSqKM),
    }))
    .sort((a, b) => a.level.localeCompare(b.level))

  const finest = levels.at(-1) ?? null
  // "Plausible" = does ANY level (not necessarily the finest) have a small
  // enough minimum area to be worth a real per-feature check later. Reported
  // per-level below regardless; this is just the headline flag.
  const plausibleLevel = [...levels].reverse().find((l) => l.minAreaSqKm <= CITY_PLAUSIBLE_MAX_MIN_AREA_SQKM) ?? null

  report.push({
    id: country.id,
    name: country.name,
    alpha3: country.alpha3,
    levels,
    finestLevel: finest?.level ?? null,
    finestLevelUnitCount: finest?.admUnitCount ?? null,
    cityPlausibleLevel: plausibleLevel?.level ?? null,
    cityPlausibleLevelMinAreaSqKm: plausibleLevel?.minAreaSqKm ?? null,
  })
})

report.sort((a, b) => a.name.localeCompare(b.name))

console.log(`Queried ${countries.length} countries.`)
console.log(`  ${report.length} returned real ADM-level data.`)
console.log(`  ${noCoverage.length} have no gbOpen coverage at all: ${noCoverage.map((c) => c.name).join(', ') || '(none)'}`)
if (errors.length > 0) console.log(`  ${errors.length} errored after retries: ${errors.map((c) => `${c.name} (${c.error})`).join(', ')}`)

const noPlausibleLevel = report.filter((c) => c.cityPlausibleLevel === null)
console.log(`\n${noPlausibleLevel.length} countries have NO level with min area <= ${CITY_PLAUSIBLE_MAX_MIN_AREA_SQKM} km2 (geoBoundaries alone won't reach city-scale for these — need a real per-country OSM/other check, same as the Jordan finding):`)
for (const c of noPlausibleLevel) {
  const finest = c.levels.at(-1)
  console.log(`  ${c.name} (${c.alpha3}): finest=${finest?.level ?? 'none'} "${finest?.canonicalName ?? '?'}" min=${finest?.minAreaSqKm?.toFixed(0) ?? '?'}km2 n=${finest?.admUnitCount ?? '?'}`)
}

if (!isSample) {
  fs.writeFileSync(
    REPORT_OUTPUT,
    JSON.stringify({ generatedAt: new Date().toISOString(), cityPlausibleMaxMinAreaSqKm: CITY_PLAUSIBLE_MAX_MIN_AREA_SQKM, countries: report, noCoverage, errors }, null, 2),
  )
  console.log(`\nWrote ${REPORT_OUTPUT} (${report.length} countries).`)
} else {
  console.log('\n--sample run: no report file written.')
}
