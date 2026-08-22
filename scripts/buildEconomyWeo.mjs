// TRIAL script — Economy category, re-sourced from IMF World Economic
// Outlook (WEO) instead of World Bank WDI. Does NOT touch
// scripts/buildEconomy.mjs or src/data/economyScores.ts (the real,
// WDI-sourced, app-consumed data) — this is a standalone experiment writing
// to debug/ only, so the two sourcings can be diffed side by side before
// deciding whether to keep this. Not wired into any UI. Not run by
// `npm run build:economy`; has its own `npm run build:economy-weo-trial`.
//
// ---------------------------------------------------------------------------
// WHAT STAYS THE SAME (per the patch's explicit instruction) — copied
// unchanged from buildEconomy.mjs, not reinvented: 5yr trailing growth
// average, percentile-rank normalization with average/fractional tie
// handling, GDP (PPP) double-weighted in the composite (2026-08-21 patch),
// the inflation "known limitation" (doesn't distinguish healthy low
// inflation from deflation), and the >= 3-of-5 coverage floor
// (measured/proxy/unavailable). See buildEconomy.mjs's own header/inline
// comments for the reasoning behind each of these — not repeated here.
//
// ---------------------------------------------------------------------------
// INDICATOR CODE VERIFICATION (2026-08-22) — the patch's mapping table was
// checked against the LIVE WEO SDMX API before relying on it, not trusted
// as-is (real risk: IMF revises series codes between April/October
// releases). All 5 confirmed current and working via direct query against
// https://api.imf.org/external/sdmx/3.0/data/dataflow/IMF.RES/WEO/~/{country
// ISO3}.{indicator}.A today:
//   GDP (PPP)              PPPGDP
//   GDP per capita (PPP)   PPPPC
//   Real GDP growth        NGDP_RPCH
//   Unemployment           LUR
//   Inflation (CPI)        PCPIPCH
// Country dimension uses standard ISO 3166-1 alpha-3 codes (same convention
// buildEconomy.mjs/buildMilitary.mjs already use via lib/iso3166.mjs).
//
// ---------------------------------------------------------------------------
// PROJECTION FLAGGING — WEO's official mechanism for this is a real,
// DSD-declared attribute, LATEST_ACTUAL_ANNUAL_DATA ("the latest annual
// period for which official statistics are available from the authorities;
// data following this period are normal staff estimates"), attached per
// (COUNTRY, INDICATOR). Made a genuine effort to extract its actual value
// through the live data API — the documented `?attributes=
// LATEST_ACTUAL_ANNUAL_DATA&detail=serieskeysonly` query pattern, several
// other attribute-request variants, and the `/structure/` endpoint with
// `references=all` to confirm the field's real definition — but it never
// came back populated (`null`) for any series tried, across a real
// migration IMF completed for this API (see the April 2026 WEO Database
// Transition Guide — LATEST_ACTUAL_ANNUAL_DATA is the new name for the
// legacy database's "Estimates Start After" field). Independently
// corroborated as a known pain point, not a mistake on this script's part:
// the `imfweo` R package (a tool purpose-built for WEO access) explicitly
// avoids this SDMX API for exactly this kind of extraction difficulty and
// downloads the classic bulk Excel/CSV file instead — not an option here,
// since imf.org's own site returns 403 to every non-browser fetch attempted
// (Cloudflare-style bot protection), unlike api.imf.org itself.
//
// FALLBACK (used instead, after the above genuinely didn't pan out — see
// LOGBOOK.md's entry on this): every WEO series response DOES reliably
// include a COUNTRY_UPDATE_DATE attribute (confirmed working on every
// query), the date this specific country+indicator series was last
// refreshed by IMF — e.g. "9/30/2025" for a series last touched during the
// October 2025 WEO release. `vintageYear` is that date's calendar year;
// any observation year >= vintageYear is flagged as a projection. This
// deliberately ERRS TOWARD OVER-flagging (a country's near-final estimate
// for the vintage year itself might get flagged as "projection" when IMF
// would call it close to actual) rather than under-flagging (silently
// presenting a real forecast as a reported figure) — the safer failure
// direction given the whole point of this feature. It's also self-updating:
// re-running this script after IMF publishes a newer WEO edition shifts
// every vintageYear forward automatically, with no hardcoded date to bump.
//
// ---------------------------------------------------------------------------
// TAIWAN — added here as a one-off (2026-08-22, direct request after
// checking: no such override existed in buildEconomy.mjs before this — see
// LOGBOOK.md). WDI structurally excludes Taiwan (China's WDI figures
// already claim to represent "one China" — see
// scripts/buildGeoEntityEconomics.mjs's identical reasoning for the
// same country), but WEO covers it directly under standard ISO3 "TWN"
// (confirmed live — real GDP PPP data back to 1980). Taiwan has no numeric
// ISO topology id (it's a GeoEntity in this app's registry, not a Country —
// see data/registry/geoEntities.ts — precisely because it isn't a UN
// member, so it was never in countries-un193.json), so it's keyed here by
// the string "taiwan" (matching its GeoEntity registry id) instead of a
// numeric id, appended to the 193-country loop as a synthetic extra entry.
// This is a debug-only convenience for this trial, not a resolved
// integration path — if WEO sourcing is ever adopted for real, how Taiwan's
// score would actually reach the UI (it's a GeoEntity; Economy scoring is
// currently Country-only, matching Military's "no GeoEntity has a score"
// rule) is a separate, unresolved design question this script does not
// answer.
//
// ---------------------------------------------------------------------------
// COVERAGE DIFF — required before this is adopted, not assumed to be a
// strict improvement. Confirmed live before writing this script: Monaco has
// ZERO WEO coverage at all (not an IMF member — the country code doesn't
// even resolve in the API), while Liechtenstein — which WDI could only
// score 1 of 5 components for — has real WEO data for at least 4 of 5. This
// script writes debug/economy-wdi-vs-weo-coverage-diff.md comparing every
// entity's tier against the already-committed src/data/economyScores.ts,
// imported directly (not re-fetched) so the diff is against the real,
// current WDI output.
//
// Usage:
//   npx tsx scripts/buildEconomyWeo.mjs --sample
//     Dry run: same 15-country reference set buildEconomy.mjs uses, plus
//     Taiwan. Prints full scores, writes nothing.
//   npm run build:economy-weo-trial
//     Full run: all 193 countries + Taiwan, writes
//     debug/economyScoresWeo.json and debug/economy-wdi-vs-weo-coverage-diff.md.
//
// Run via `tsx`, not plain `node` — imports the existing
// src/data/economyScores.ts for the coverage diff, the same reason
// buildGovCapitalPopGdp.mjs uses tsx.
import fs from 'node:fs'
import { feature } from 'topojson-client'
import { ALPHA3_TO_NUMERIC } from './lib/iso3166.mjs'
import { ECONOMY_SCORES as WDI_ECONOMY_SCORES } from '../src/data/economyScores.ts'

const COUNTRIES_SOURCE = 'public/geo/countries-un193.json'
// Under public/, not debug/, specifically so the running dev server can
// fetch it at runtime (see hud/useEconomyScoresWeo.ts) — Vite serves
// public/ from the site root regardless of git-ignore status. Still
// gitignored (see .gitignore's public/debug/ entry) — this is trial data,
// not meant to ship, just to be reviewable in a locally-running app.
const DEBUG_OUTPUT = 'public/debug/economyScoresWeo.json'
// The diff report is pure human review, never fetched by the app — stays
// in the repo-root debug/ dir alongside the component-breakdown dump.
const DIFF_OUTPUT = 'debug/economy-wdi-vs-weo-coverage-diff.md'

const WEO_BASE = 'https://api.imf.org/external/sdmx/3.0/data/dataflow/IMF.RES/WEO/~'
const WEO_GDP_PPP_INDICATOR = 'PPPGDP'
const WEO_GDP_PER_CAPITA_PPP_INDICATOR = 'PPPPC'
const WEO_GDP_GROWTH_INDICATOR = 'NGDP_RPCH'
const WEO_UNEMPLOYMENT_INDICATOR = 'LUR'
const WEO_INFLATION_INDICATOR = 'PCPIPCH'

const WEO_LOOKBACK_START_YEAR = 2000
// WEO publishes ~5 years of forward projections alongside actuals — request
// a wide-enough window to comfortably include them (and the 5yr-trailing
// growth window) regardless of which vintage is live when this runs.
const WEO_LOOKAHEAD_END_YEAR = 2032
const GROWTH_YEARS_TARGET = 5

const sampleArg = process.argv.includes('--sample')
const isSample = sampleArg
const SAMPLE_COUNTRIES = [
  'United States of America', 'China', 'Russia', 'India', 'United Kingdom', 'France', 'Germany', 'Japan',
  'Israel', 'Pakistan', 'North Korea', 'Brazil', 'Poland', 'Luxembourg', 'Costa Rica',
]

// ---------------------------------------------------------------------------
// Fetch helpers (same pattern as buildEconomy.mjs)
// ---------------------------------------------------------------------------

async function fetchJson(url) {
  const res = await fetch(url, { headers: { Accept: 'application/json' } })
  if (!res.ok) throw new Error(`${res.status} ${res.statusText}: ${url}`)
  return res.json()
}

async function fetchJsonRetry(url, attempts = 2) {
  let lastErr
  for (let i = 0; i < attempts; i++) {
    try {
      return await fetchJson(url)
    } catch (err) {
      lastErr = err
    }
  }
  throw lastErr
}

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

// ---------------------------------------------------------------------------
// Country list + id bridging (same as buildEconomy.mjs), plus Taiwan
// appended as a one-off — see this file's own header comment.
// ---------------------------------------------------------------------------

const topology = JSON.parse(fs.readFileSync(COUNTRIES_SOURCE, 'utf8'))
const allCountries = feature(topology, topology.objects.countries)
  .features.map((f) => ({ id: String(f.id), name: f.properties.name }))
  .sort((a, b) => a.name.localeCompare(b.name))

const countries = isSample ? allCountries.filter((c) => SAMPLE_COUNTRIES.includes(c.name)) : allCountries
// Taiwan: no numeric topology id, keyed by its GeoEntity registry id
// instead — see header comment. Included in every run, sample or full,
// since it's the whole point of the source-swap trial for this entity.
countries.push({ id: 'taiwan', name: 'Taiwan', alpha3Override: 'TWN' })

const NUMERIC_TO_ALPHA3 = Object.fromEntries(Object.entries(ALPHA3_TO_NUMERIC).map(([a3, num]) => [num, a3]))

// ---------------------------------------------------------------------------
// Gap log
// ---------------------------------------------------------------------------
const gaps = []
function logGap(country, field, reason) {
  gaps.push({ country, field, reason })
}

// ---------------------------------------------------------------------------
// WEO series fetch — one request per (country, indicator), full range.
// Returns the sorted (most-recent-first) list of real (non-null)
// {year, value} rows plus vintageYear (see header comment's PROJECTION
// FLAGGING section for what this is and why it's used instead of the
// LATEST_ACTUAL_ANNUAL_DATA attribute this script tried and failed to
// extract).
// ---------------------------------------------------------------------------
function findSeriesAttributeIndex(attributeDefs, id) {
  const idx = (attributeDefs ?? []).findIndex((a) => a.id === id)
  return idx === -1 ? null : idx
}

async function fetchWeoSeries(alpha3, indicatorCode) {
  const url = `${WEO_BASE}/${alpha3}.${indicatorCode}.A?startPeriod=${WEO_LOOKBACK_START_YEAR}&endPeriod=${WEO_LOOKAHEAD_END_YEAR}`
  const json = await fetchJsonRetry(url)
  const dataSet = json?.data?.dataSets?.[0]
  const seriesKey = dataSet?.series ? Object.keys(dataSet.series)[0] : undefined
  if (!seriesKey) return { rows: [], vintageYear: undefined }

  const series = dataSet.series[seriesKey]
  const timeValues = json.data.structures[0].dimensions.observation[0].values.map((v) => Number(v.value))
  const attrDefs = json.data.structures[0].attributes?.series
  const updateDateIdx = findSeriesAttributeIndex(attrDefs, 'COUNTRY_UPDATE_DATE')
  const countryUpdateDate = updateDateIdx != null ? series.attributes?.[updateDateIdx] : undefined
  const vintageYear = countryUpdateDate ? new Date(countryUpdateDate).getFullYear() : undefined

  const rows = Object.entries(series.observations ?? {})
    .map(([idx, obs]) => ({ year: timeValues[Number(idx)], value: obs[0] == null ? null : Number(obs[0]) }))
    .filter((r) => r.value != null)
  rows.sort((a, b) => b.year - a.year)
  return { rows, vintageYear }
}

// Single most-recent-value indicators (GDP PPP, GDP per capita PPP,
// unemployment, inflation) — same "most recent available, explicitly
// dated" INTENT as buildEconomy.mjs's resolveWorldBankIndicator, but NOT
// the same "just take rows[0]" implementation: unlike WDI (no forward
// projections at all), WEO rows genuinely extend 5-7 years into the future,
// so naively taking the single most-recent row grabs a speculative
// far-future projection almost every time instead of a real reported
// figure — caught by inspecting actual sample output (Taiwan's GDP PPP came
// back dated 2031, the outermost lookahead year, before this fix). Prefers
// the most recent ACTUAL (year < vintageYear); falls back to the most
// recent row overall (a projection, correctly flagged via isProjection)
// only when no actual exists in the lookback window at all.
async function resolveWeoIndicator(alpha3, indicatorCode) {
  const { rows, vintageYear } = await fetchWeoSeries(alpha3, indicatorCode)
  if (rows.length === 0) return { value: undefined, year: undefined, isProjection: false, vintageYear }
  const actualRows = vintageYear != null ? rows.filter((r) => r.year < vintageYear) : rows
  const best = actualRows.length > 0 ? actualRows[0] : rows[0]
  const isProjection = vintageYear != null && best.year >= vintageYear
  return { value: best.value, year: best.year, isProjection, vintageYear }
}

// Growth: 5yr trailing average, same target window as buildEconomy.mjs's
// resolveGrowthAverage — but, per the same reasoning as
// resolveWeoIndicator above, built from the most recent ACTUAL years first
// (not just the 5 most recent rows overall, which would mean 5 years of
// pure IMF projection for any country with a long actual history). Only
// backfills with projected years — nearest-term first, not furthest-out —
// when fewer than 5 actuals exist in the lookback window.
async function resolveWeoGrowthAverage(alpha3) {
  const { rows, vintageYear } = await fetchWeoSeries(alpha3, WEO_GDP_GROWTH_INDICATOR)
  if (rows.length === 0) return { value: undefined, years: [], projectedYears: [], vintageYear }
  const actualRows = vintageYear != null ? rows.filter((r) => r.year < vintageYear) : rows // desc: most-recent-actual first
  const projectedRowsNearestFirst =
    vintageYear != null ? rows.filter((r) => r.year >= vintageYear).sort((a, b) => a.year - b.year) : []
  const used = [...actualRows.slice(0, GROWTH_YEARS_TARGET), ...projectedRowsNearestFirst].slice(0, GROWTH_YEARS_TARGET)
  const mean = used.reduce((sum, r) => sum + r.value, 0) / used.length
  const years = used.map((r) => r.year).sort((a, b) => a - b)
  const projectedYears = vintageYear != null ? years.filter((y) => y >= vintageYear) : []
  return { value: mean, years, projectedYears, vintageYear }
}

// ---------------------------------------------------------------------------
// Normalization — IDENTICAL to buildEconomy.mjs's buildPercentileRanker.
// Copied, not imported, since these are two standalone scripts by design
// (this one doesn't touch buildEconomy.mjs) — see this file's own header.
// ---------------------------------------------------------------------------
function buildPercentileRanker(values) {
  const nonNull = values.filter((v) => v != null)
  if (nonNull.length === 0) return () => null

  const sorted = [...nonNull].sort((a, b) => a - b)
  const n = sorted.length
  const rankByValue = new Map()
  let i = 0
  while (i < n) {
    let j = i
    while (j < n && sorted[j] === sorted[i]) j++
    rankByValue.set(sorted[i], (i + 1 + j) / 2)
    i = j
  }

  return (v) => {
    if (v == null) return null
    if (n === 1) return 100
    const rank = rankByValue.get(v)
    return ((rank - 1) / (n - 1)) * 100
  }
}

function weoUrl(alpha3, indicatorCode) {
  return alpha3 ? `${WEO_BASE}/${alpha3}.${indicatorCode}.A` : undefined
}

// ---------------------------------------------------------------------------
// Per-country pipeline
// ---------------------------------------------------------------------------

async function buildCountryScore(country) {
  const alpha3 = country.alpha3Override ?? NUMERIC_TO_ALPHA3[country.id]
  if (!alpha3) {
    logGap(
      country.name,
      'GDP PPP + GDP per capita PPP + GDP growth + unemployment + inflation',
      'No ISO alpha-3 code resolved — left unscored.'
    )
    return {
      id: country.id,
      name: country.name,
      alpha3: undefined,
      raw: {
        gdpPpp: { value: undefined, year: undefined, isProjection: false },
        gdpPerCapitaPpp: { value: undefined, year: undefined, isProjection: false },
        gdpGrowth: { value: undefined, years: [], projectedYears: [] },
        unemploymentRate: { value: undefined, year: undefined, isProjection: false },
        inflationCpi: { value: undefined, year: undefined, isProjection: false },
      },
    }
  }

  const [gdpPpp, gdpPerCapitaPpp, gdpGrowth, unemploymentRate, inflationCpi] = await Promise.all([
    resolveWeoIndicator(alpha3, WEO_GDP_PPP_INDICATOR),
    resolveWeoIndicator(alpha3, WEO_GDP_PER_CAPITA_PPP_INDICATOR),
    resolveWeoGrowthAverage(alpha3),
    resolveWeoIndicator(alpha3, WEO_UNEMPLOYMENT_INDICATOR),
    resolveWeoIndicator(alpha3, WEO_INFLATION_INDICATOR),
  ])

  if (gdpPpp.value == null) logGap(country.name, 'GDP PPP', `WEO has no ${WEO_GDP_PPP_INDICATOR} value for ${alpha3} in range — left unscored.`)
  if (gdpPerCapitaPpp.value == null) {
    logGap(country.name, 'GDP per capita PPP', `WEO has no ${WEO_GDP_PER_CAPITA_PPP_INDICATOR} value for ${alpha3} in range — left unscored.`)
  }
  if (gdpGrowth.value == null) {
    logGap(country.name, 'GDP growth (5yr avg)', `WEO has no ${WEO_GDP_GROWTH_INDICATOR} values for ${alpha3} in range — left unscored.`)
  }
  if (unemploymentRate.value == null) {
    logGap(country.name, 'unemployment rate', `WEO has no ${WEO_UNEMPLOYMENT_INDICATOR} value for ${alpha3} in range — left unscored.`)
  }
  if (inflationCpi.value == null) {
    logGap(country.name, 'inflation (CPI)', `WEO has no ${WEO_INFLATION_INDICATOR} value for ${alpha3} in range — left unscored.`)
  }

  return { id: country.id, name: country.name, alpha3, raw: { gdpPpp, gdpPerCapitaPpp, gdpGrowth, unemploymentRate, inflationCpi } }
}

console.log(`Building WEO-trial Economy scores for ${countries.length} ${isSample ? 'sample' : ''} countries (incl. Taiwan)...`)
const built = await mapWithConcurrency(countries, 8, buildCountryScore)

const rankGdpPpp = buildPercentileRanker(built.map((r) => r.raw.gdpPpp.value))
const rankGdpPerCapitaPpp = buildPercentileRanker(built.map((r) => r.raw.gdpPerCapitaPpp.value))
const rankGdpGrowth = buildPercentileRanker(built.map((r) => r.raw.gdpGrowth.value))
const rankUnemployment = buildPercentileRanker(built.map((r) => r.raw.unemploymentRate.value))
const rankInflation = buildPercentileRanker(built.map((r) => r.raw.inflationCpi.value))

// Composite calculation — IDENTICAL logic to buildEconomy.mjs's
// finalizeCountry (double-weighted GDP PPP, coverage floor, confidence
// tiers). Only the raw-value sourcing above differs; this section is
// copied, not modified, per "what stays the same."
function finalizeCountry(r) {
  const gdpPppPct = rankGdpPpp(r.raw.gdpPpp.value ?? null)
  const gdpPerCapitaPppPct = rankGdpPerCapitaPpp(r.raw.gdpPerCapitaPpp.value ?? null)
  const gdpGrowthPct = rankGdpGrowth(r.raw.gdpGrowth.value ?? null)
  const unemploymentPctRaw = rankUnemployment(r.raw.unemploymentRate.value ?? null)
  const unemploymentPct = unemploymentPctRaw == null ? null : 100 - unemploymentPctRaw
  const inflationPctRaw = rankInflation(r.raw.inflationCpi.value ?? null)
  const inflationPct = inflationPctRaw == null ? null : 100 - inflationPctRaw

  const projectionNote = (isProjection, vintageYear) =>
    isProjection ? `IMF WEO projection (vintage year ${vintageYear}), not a finalized actual.` : undefined

  const components = {
    gdpPpp: {
      raw: r.raw.gdpPpp.value ?? null,
      normalized: gdpPppPct,
      year: r.raw.gdpPpp.year,
      sourceUrl: weoUrl(r.alpha3, WEO_GDP_PPP_INDICATOR),
      projectionNote: projectionNote(r.raw.gdpPpp.isProjection, r.raw.gdpPpp.vintageYear),
    },
    gdpPerCapitaPpp: {
      raw: r.raw.gdpPerCapitaPpp.value ?? null,
      normalized: gdpPerCapitaPppPct,
      year: r.raw.gdpPerCapitaPpp.year,
      sourceUrl: weoUrl(r.alpha3, WEO_GDP_PER_CAPITA_PPP_INDICATOR),
      projectionNote: projectionNote(r.raw.gdpPerCapitaPpp.isProjection, r.raw.gdpPerCapitaPpp.vintageYear),
    },
    gdpGrowth: {
      raw: r.raw.gdpGrowth.value ?? null,
      normalized: gdpGrowthPct,
      years: r.raw.gdpGrowth.years.length > 0 ? r.raw.gdpGrowth.years : undefined,
      sourceUrl: weoUrl(r.alpha3, WEO_GDP_GROWTH_INDICATOR),
      projectionNote:
        r.raw.gdpGrowth.projectedYears && r.raw.gdpGrowth.projectedYears.length > 0
          ? `Includes ${r.raw.gdpGrowth.projectedYears.length} projected year(s) (${r.raw.gdpGrowth.projectedYears.join(', ')}) in the 5yr average — IMF WEO projection, not a finalized actual for those years.`
          : undefined,
    },
    unemploymentRate: {
      raw: r.raw.unemploymentRate.value ?? null,
      normalized: unemploymentPct,
      year: r.raw.unemploymentRate.year,
      sourceUrl: weoUrl(r.alpha3, WEO_UNEMPLOYMENT_INDICATOR),
      projectionNote: projectionNote(r.raw.unemploymentRate.isProjection, r.raw.unemploymentRate.vintageYear),
    },
    inflationCpi: {
      raw: r.raw.inflationCpi.value ?? null,
      normalized: inflationPct,
      year: r.raw.inflationCpi.year,
      sourceUrl: weoUrl(r.alpha3, WEO_INFLATION_INDICATOR),
      projectionNote: projectionNote(r.raw.inflationCpi.isProjection, r.raw.inflationCpi.vintageYear),
    },
  }

  const presentNormalized = [gdpPppPct, gdpPerCapitaPppPct, gdpGrowthPct, unemploymentPct, inflationPct].filter((v) => v != null)
  const coveragePresent = presentNormalized.length
  const confidence = coveragePresent >= 4 ? 'measured' : coveragePresent === 3 ? 'proxy' : 'unavailable'

  // GDP (PPP) double-weighted — see buildEconomy.mjs's WEIGHTING PATCH
  // comment for the full reasoning; identical here, unmodified.
  const weightedNormalized = [gdpPppPct, gdpPppPct, gdpPerCapitaPppPct, gdpGrowthPct, unemploymentPct, inflationPct].filter(
    (v) => v != null
  )
  const value = coveragePresent >= 3 ? weightedNormalized.reduce((a, b) => a + b, 0) / weightedNormalized.length : null

  return {
    id: r.id,
    name: r.name,
    value: value == null ? null : Math.round(value * 10) / 10,
    confidence,
    coveragePresent,
    coverageTotal: 5,
    components,
  }
}

const finalScores = built.map(finalizeCountry)

// ---------------------------------------------------------------------------
// Output
// ---------------------------------------------------------------------------

if (isSample) {
  for (const s of finalScores) console.log(JSON.stringify(s, null, 2))
  console.log(`\nSample run only — wrote nothing.`)
  console.log(
    `Confidence breakdown: measured=${finalScores.filter((s) => s.confidence === 'measured').length}, ` +
      `proxy=${finalScores.filter((s) => s.confidence === 'proxy').length}, ` +
      `unavailable=${finalScores.filter((s) => s.confidence === 'unavailable').length}`
  )
  console.log(`${gaps.length} gap(s) logged:`)
  for (const g of gaps) console.log(`  - [${g.country}] ${g.field}: ${g.reason}`)
  process.exit(0)
}

fs.mkdirSync('public/debug', { recursive: true })
fs.mkdirSync('debug', { recursive: true })
fs.writeFileSync(DEBUG_OUTPUT, JSON.stringify(finalScores, null, 2))
console.log(`Wrote ${DEBUG_OUTPUT}: ${finalScores.length} entities (193 countries + Taiwan).`)
console.log(
  `Confidence breakdown: measured=${finalScores.filter((s) => s.confidence === 'measured').length}, ` +
    `proxy=${finalScores.filter((s) => s.confidence === 'proxy').length}, ` +
    `unavailable=${finalScores.filter((s) => s.confidence === 'unavailable').length}`
)
if (gaps.length > 0) {
  console.log(`${gaps.length} gap(s) (see per-entity detail in the coverage diff / re-run with --sample to inspect).`)
}

// ---------------------------------------------------------------------------
// Coverage diff vs the real, committed WDI output — required before this
// source is adopted, per this file's own header comment. WDI_ECONOMY_SCORES
// has no Taiwan entry at all (WDI never scored it), so Taiwan always shows
// as a new entity, not a tier change.
// ---------------------------------------------------------------------------
function categorize(wdi, weo) {
  if (!wdi) return 'new entity (no WDI baseline)'
  const w = wdi.confidence
  const e = weo.confidence
  if (w === e) return w === 'unavailable' ? 'unchanged (both unavailable)' : 'unchanged (same tier)'
  if (w === 'unavailable') return 'gained coverage'
  if (e === 'unavailable') return 'lost coverage'
  if (w === 'proxy' && e === 'measured') return 'tier improved (proxy -> measured)'
  if (w === 'measured' && e === 'proxy') return 'tier worsened (measured -> proxy)'
  return 'changed'
}

const diffRows = finalScores
  .map((weo) => {
    const wdi = WDI_ECONOMY_SCORES[weo.id]
    return {
      id: weo.id,
      name: weo.name,
      wdiTier: wdi?.confidence ?? '(none)',
      wdiCoverage: wdi ? `${wdi.coveragePresent}/${wdi.coverageTotal}` : '—',
      weoTier: weo.confidence,
      weoCoverage: `${weo.coveragePresent}/${weo.coverageTotal}`,
      category: categorize(wdi, weo),
    }
  })
  .sort((a, b) => a.category.localeCompare(b.category) || a.name.localeCompare(b.name))

const summary = {}
for (const row of diffRows) summary[row.category] = (summary[row.category] ?? 0) + 1

const diffLines = []
diffLines.push('# Economy: WDI vs. WEO coverage diff')
diffLines.push('')
diffLines.push(
  `Generated by \`npx tsx scripts/buildEconomyWeo.mjs\`, ${new Date().toISOString().slice(0, 10)}. Compares this ` +
    `run's WEO-sourced trial output against the currently-committed, WDI-sourced \`src/data/economyScores.ts\`. ` +
    `Not assumed to be a strict improvement — see the summary below before deciding whether to adopt WEO.`
)
diffLines.push('')
diffLines.push('## Summary')
diffLines.push('')
for (const [category, count] of Object.entries(summary).sort((a, b) => b[1] - a[1])) {
  diffLines.push(`- **${category}:** ${count}`)
}
diffLines.push('')
diffLines.push('## Per-entity detail')
diffLines.push('')
diffLines.push('| Entity | WDI tier | WDI coverage | WEO tier | WEO coverage | Category |')
diffLines.push('|---|---|---|---|---|---|')
for (const row of diffRows) {
  diffLines.push(`| ${row.name} | ${row.wdiTier} | ${row.wdiCoverage} | ${row.weoTier} | ${row.weoCoverage} | ${row.category} |`)
}
diffLines.push('')

fs.writeFileSync(DIFF_OUTPUT, diffLines.join('\n'))
console.log(`Wrote ${DIFF_OUTPUT}: ${diffRows.length} entities compared.`)
console.log('Coverage diff summary:', JSON.stringify(summary, null, 2))
