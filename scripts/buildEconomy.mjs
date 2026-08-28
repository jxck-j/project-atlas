// Build-time asset generator for the Economy category of the Intelligence
// Engine (see Intelligence Docs/intelligence-engine-scoring-design.md §3.2,
// and Intelligence Docs/buildEconomy-prompt.md for the full locked spec this
// script implements). Produces one Economy score (0-100) per country, plus
// per-component breakdown, written to src/data/economyScores.ts.
//
// Standalone data-generation script only — does NOT touch GeoEntity/Country
// type definitions, registries, or any rendering/UI code (per the build
// prompt's explicit scope boundary: rendering is a separate task).
//
// ---------------------------------------------------------------------------
// TIE-HANDLING FOR PERCENTILE RANK (confirmed with user before writing this
// script, per the build prompt's explicit "stop and ask before picking a
// tie-breaking convention" instruction): average/fractional rank. Tied raw
// values all receive the MEAN percentile of the ranks they'd jointly occupy
// (e.g. two countries tied for ranks 5-6 both get the rank-5.5 percentile),
// matching Excel's PERCENTRANK / scipy's rankdata(method='average') — never
// arbitrarily favors one tied country over another. See buildPercentileRank
// below for the implementation.
//
// ---------------------------------------------------------------------------
// OUTPUT SHAPE — extends, not just matches, the design doc's Section 6 base
// CategoryScore interface: the doc's illustrative shape is a flat
// `sources: string[]`, but the actual established precedent in this codebase
// (scripts/buildMilitary.mjs's MilitaryScore) is a richer per-component
// breakdown (raw/normalized/year/sourceUrl per field) instead of a flat
// citation-key array — needed for the same citation drill-down the design
// doc's §7 describes for every category, not just Military. Economy follows
// that established precedent rather than the doc's flat illustrative
// example, for consistency across categories. No `confirmed`/`annotations`
// fields — both are explicitly out of scope for Economy v1 per the build
// prompt ("No confirmed field — that's Military-specific"; "none planned for
// Economy v1 — leave undefined, don't stub empty array").
//
// Usage:
//   node scripts/buildEconomy.mjs --sample
//     Dry run: the same 15-country reference set buildMilitary.mjs uses (US,
//     China, Russia, India, UK, France, Germany, Japan, Israel, Pakistan,
//     North Korea, Brazil, Poland, Luxembourg, Costa Rica) — reused as-is
//     rather than picking a new set, since it already spans large/small/
//     sanctioned economies. Prints full scores + per-component breakdown,
//     writes nothing.
//   npm run build:economy
//     Full run: all 193 countries, writes src/data/economyScores.ts and
//     appends a generated gap report to BACKLOG.md. Also writes
//     debug/economy-component-breakdown.json — a diagnostic-only per-entity
//     component/percentile/composite dump, not consumed by the app, for
//     reviewing the ranking ahead of any weighting decision (2026-08-21).
//
// Run via `node`, not `tsx` — same as buildMilitary.mjs, no existing .ts
// source needs importing.
import fs from 'node:fs'
import { feature } from 'topojson-client'
import { ALPHA3_TO_NUMERIC } from './lib/iso3166.mjs'

const COUNTRIES_SOURCE = 'public/geo/countries-un193.json'
const OUTPUT = 'src/data/economyScores.ts'
const BACKLOG = 'BACKLOG.md'

const WORLD_BANK_BASE = 'https://api.worldbank.org/v2/country'
// GDP (size) component: NOMINAL GDP (2026-08-22, direct request — was PPP-
// adjusted, NY.GDP.MKTP.PP.CD, through v6.6.2). GDP per capita stays PPP —
// this only changes the aggregate "how big is this economy" metric, not the
// per-capita one.
const GDP_NOMINAL_INDICATOR = 'NY.GDP.MKTP.CD'
const GDP_PER_CAPITA_PPP_INDICATOR = 'NY.GDP.PCAP.PP.CD'
const GDP_GROWTH_INDICATOR = 'NY.GDP.MKTP.KD.ZG'
const UNEMPLOYMENT_INDICATOR = 'SL.UEM.TOTL.ZS'
const INFLATION_INDICATOR = 'FP.CPI.TOTL.ZG'

// INFLATION SCORING: a TOLERANCE-BAND PLATEAU around a 2% target (2026-08-26
// patch, second version that same day — was a pure gaussian with no
// plateau before this; was a percentile-rank of distance-from-target before
// that; was inverted "lower is always better" before that. See LOGBOOK.md's
// 2026-08-22 and 2026-08-26 entries for the full history.). 2% is the
// explicit longer-run target both the Federal Reserve
// (federalreserve.gov/faqs/economy_14400.htm) and the Bank of England
// (bankofengland.co.uk/monetary-policy/inflation) state outright — not an
// arbitrary choice.
//
//   distance = |inflation - 2.0|
//   score = 100                                              if distance <= band (1.0pp)
//   score = 100 * exp(-((distance - band)^2) / (2 * σ^2))     otherwise
//
// INFLATION_TOLERANCE_BAND_PCT (the plateau width) is the Bank of England's
// own ±1 percentage-point tolerance band — a governor's open letter to the
// Chancellor is required if CPI moves more than 1pp from the 2% target, a
// real, stated policy threshold. Inside that band, the score doesn't
// distinguish "closer to 2%" from "closer to the edge" at all — by the
// central bank's OWN stated standard, anything in that range isn't a
// problem worth a graded penalty, so this doesn't invent one. Beyond the
// band, the SAME gaussian decay the prior (pure-gaussian) version used
// picks back up, using excess distance (how far past the band edge, not
// raw distance from target) as its input — σ (INFLATION_SIGMA_PCT) is kept
// at the same 1.0pp, still deliberately NOT derived from the sample's own
// spread (a data-derived spread would get distorted by hyperinflation
// outliers like Argentina/Zimbabwe-scale entries, flattening everyone
// else's score toward the middle).
const INFLATION_TARGET_PCT = 2.0
const INFLATION_TOLERANCE_BAND_PCT = 1.0
const INFLATION_SIGMA_PCT = 1.0

function inflationToleranceBandScore(raw) {
  if (raw == null) return null
  const distance = Math.abs(raw - INFLATION_TARGET_PCT)
  if (distance <= INFLATION_TOLERANCE_BAND_PCT) return 100
  const excess = distance - INFLATION_TOLERANCE_BAND_PCT
  return 100 * Math.exp(-(excess ** 2) / (2 * INFLATION_SIGMA_PCT ** 2))
}

// Same primary/lookback years as buildMilitary.mjs/buildGovCapitalPopGdp.mjs
// — 2000 comfortably covers every real gap already observed in this
// codebase's other World Bank ingestion scripts.
const WORLD_BANK_PRIMARY_YEAR = 2024
const WORLD_BANK_LOOKBACK_START_YEAR = 2000
// How many of the most recent available years feed the growth component's
// average — see resolveGrowthAverage. Not necessarily 5 CONSECUTIVE
// calendar years: a country with a gap (e.g. no 2022 figure) still averages
// its 5 most recent real data points, with exactly which years used stored
// alongside the average (components.gdpGrowth.years) rather than silently
// implied.
const GROWTH_YEARS_TARGET = 5

const sampleArg = process.argv.includes('--sample')
const isSample = sampleArg
const SAMPLE_COUNTRIES = [
  'United States of America', 'China', 'Russia', 'India', 'United Kingdom', 'France', 'Germany', 'Japan',
  'Israel', 'Pakistan', 'North Korea', 'Brazil', 'Poland', 'Luxembourg', 'Costa Rica',
]

// ---------------------------------------------------------------------------
// Fetch helpers (same pattern as buildMilitary.mjs / buildGovCapitalPopGdp.mjs)
// ---------------------------------------------------------------------------

async function fetchJson(url) {
  const res = await fetch(url)
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

// 193 countries x 5 indicators = ~965 requests; unbounded concurrency
// against a public, unauthenticated API risks rate-limit/connection-reset
// errors — same limit buildGovCapitalPopGdp.mjs/buildMilitary.mjs use.
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
// Country list + id bridging (same as buildMilitary.mjs)
// ---------------------------------------------------------------------------

const topology = JSON.parse(fs.readFileSync(COUNTRIES_SOURCE, 'utf8'))
const allCountries = feature(topology, topology.objects.countries)
  .features.map((f) => ({ id: String(f.id), name: f.properties.name }))
  .sort((a, b) => a.name.localeCompare(b.name))

const countries = isSample ? allCountries.filter((c) => SAMPLE_COUNTRIES.includes(c.name)) : allCountries

const NUMERIC_TO_ALPHA3 = Object.fromEntries(Object.entries(ALPHA3_TO_NUMERIC).map(([a3, num]) => [num, a3]))

// ---------------------------------------------------------------------------
// Gap log
// ---------------------------------------------------------------------------
const gaps = []
function logGap(country, field, reason) {
  gaps.push({ country, field, reason })
}

// ---------------------------------------------------------------------------
// Components 1, 2, 4, 5: single most-recent-value World Bank indicators —
// same range-query + explicit-year pattern as buildMilitary.mjs's
// resolveWorldBankIndicator.
// ---------------------------------------------------------------------------
async function resolveWorldBankIndicator(alpha3, indicatorCode) {
  const url = `${WORLD_BANK_BASE}/${alpha3}/indicator/${indicatorCode}?format=json&date=${WORLD_BANK_LOOKBACK_START_YEAR}:${WORLD_BANK_PRIMARY_YEAR}&per_page=100`
  const json = await fetchJsonRetry(url)
  const rows = (json?.[1] ?? []).filter((r) => r.value != null)
  if (rows.length === 0) return { value: undefined, year: undefined }
  rows.sort((a, b) => Number(b.date) - Number(a.date))
  const best = rows[0]
  return { value: best.value, year: Number(best.date) }
}

// ---------------------------------------------------------------------------
// Component 3: real GDP growth, 5yr trailing average. One range query (not 5
// single-year requests), then average the GROWTH_YEARS_TARGET most recent
// real (non-null) values — which may span more than 5 calendar years if the
// country has gaps, or fewer than 5 data points total if it has thin
// coverage. `years` records exactly which calendar years were actually
// averaged, per the build prompt's requirement to preserve this for a
// future citation drill-down.
// ---------------------------------------------------------------------------
async function resolveGrowthAverage(alpha3) {
  const url = `${WORLD_BANK_BASE}/${alpha3}/indicator/${GDP_GROWTH_INDICATOR}?format=json&date=${WORLD_BANK_LOOKBACK_START_YEAR}:${WORLD_BANK_PRIMARY_YEAR}&per_page=100`
  const json = await fetchJsonRetry(url)
  const rows = (json?.[1] ?? []).filter((r) => r.value != null)
  if (rows.length === 0) return { value: undefined, years: [] }
  rows.sort((a, b) => Number(b.date) - Number(a.date))
  const used = rows.slice(0, GROWTH_YEARS_TARGET)
  const mean = used.reduce((sum, r) => sum + r.value, 0) / used.length
  return { value: mean, years: used.map((r) => Number(r.date)).sort((a, b) => a - b) }
}

// ---------------------------------------------------------------------------
// TAIWAN (2026-08-22, direct request): World Bank/WDI structurally excludes
// Taiwan (China's WDI figures already claim to represent "one China" — see
// scripts/buildGeoEntityEconomics.mjs's identical reasoning for the same
// country), so the 193-country WDI loop above never touches it. Sourced
// from the IMF World Economic Outlook (WEO) instead — the ONLY IMF/WEO
// dependency this script keeps; every other component for every other
// country is still 100% World Bank WDI (an earlier, now-removed standalone
// trial, scripts/buildEconomyWeo.mjs, re-sourced the ENTIRE category from
// IMF WEO instead of WDI — that trial was not adopted; this is a narrow,
// permanent, Taiwan-only exception layered on top of the real WDI-sourced
// dataset, not a revival of that trial).
//
// Taiwan is not a Country in this app's registry (data/registry/
// geoEntities.ts) — it's a GeoEntity, so it's keyed here by its GeoEntity
// registry id ('taiwan') rather than a numeric ISO topology id, the one
// exception to this file's "keyed by numeric id" convention (see the
// ECONOMY_SCORES type comment below).
//
// Resolved to the same STANDARD every WDI component already meets, even
// though the mechanism has to differ: most recent ACTUAL year only. A WEO
// series extends years into the future as IMF staff projections — WDI has
// none at all, so the rest of this script never had to think about this —
// so those are explicitly excluded here rather than silently included.
// vintageYear (from IMF's COUNTRY_UPDATE_DATE attribute) is what separates
// actual from projected; see the now-removed buildEconomyWeo.mjs's
// LOGBOOK.md entries (2026-08-22) for the fuller research trail this
// technique came from — kept minimal here since Taiwan is the only
// consumer, not a whole second build pipeline.
// ---------------------------------------------------------------------------
const IMF_WEO_BASE = 'https://api.imf.org/external/sdmx/3.0/data/dataflow/IMF.RES/WEO/~'
const IMF_WEO_LOOKAHEAD_END_YEAR = 2032
const TAIWAN_ALPHA3 = 'TWN'
// Nominal GDP, current prices, US dollars — despite being commonly
// documented as reported in billions, the live API's raw observation values
// are already in whole current US$ (verified directly: Taiwan's 2024 value
// is 801495464000, i.e. $801.5B, not 801.5) — same raw units as
// GDP_NOMINAL_INDICATOR's WDI values, so no unit conversion is applied.
const IMF_GDP_NOMINAL_INDICATOR = 'NGDPD'
const IMF_GDP_PER_CAPITA_PPP_INDICATOR = 'PPPPC'
const IMF_GDP_GROWTH_INDICATOR = 'NGDP_RPCH'
const IMF_UNEMPLOYMENT_INDICATOR = 'LUR'
const IMF_INFLATION_INDICATOR = 'PCPIPCH'

function imfWeoUrl(indicatorCode) {
  return `${IMF_WEO_BASE}/${TAIWAN_ALPHA3}.${indicatorCode}.A`
}

async function fetchImfWeoSeries(indicatorCode) {
  const url = `${imfWeoUrl(indicatorCode)}?startPeriod=${WORLD_BANK_LOOKBACK_START_YEAR}&endPeriod=${IMF_WEO_LOOKAHEAD_END_YEAR}`
  const json = await fetchJsonRetry(url)
  const dataSet = json?.data?.dataSets?.[0]
  const seriesKey = dataSet?.series ? Object.keys(dataSet.series)[0] : undefined
  if (!seriesKey) return { rows: [], vintageYear: undefined }

  const series = dataSet.series[seriesKey]
  const timeValues = json.data.structures[0].dimensions.observation[0].values.map((v) => Number(v.value))
  const attrDefs = json.data.structures[0].attributes?.series
  const updateDateIdx = (attrDefs ?? []).findIndex((a) => a.id === 'COUNTRY_UPDATE_DATE')
  const countryUpdateDate = updateDateIdx !== -1 ? series.attributes?.[updateDateIdx] : undefined
  const vintageYear = countryUpdateDate ? new Date(countryUpdateDate).getFullYear() : undefined

  const rows = Object.entries(series.observations ?? {})
    .map(([idx, obs]) => ({ year: timeValues[Number(idx)], value: obs[0] == null ? null : Number(obs[0]) }))
    .filter((r) => r.value != null)
  rows.sort((a, b) => b.year - a.year)
  return { rows, vintageYear }
}

// Single most-recent-ACTUAL-value indicators — mirrors resolveWorldBankIndicator's
// "most recent, explicitly dated" intent, but with projected years filtered
// out first (see this section's header comment for why WDI never needed this).
async function resolveImfMostRecentActual(indicatorCode) {
  const { rows, vintageYear } = await fetchImfWeoSeries(indicatorCode)
  const actualRows = vintageYear != null ? rows.filter((r) => r.year < vintageYear) : rows
  const best = actualRows[0]
  if (!best) return { value: undefined, year: undefined }
  return { value: best.value, year: best.year }
}

// Growth: same 5yr-trailing-average shape as resolveGrowthAverage above,
// but built only from actual (non-projected) years — see this section's
// header comment.
async function resolveImfGrowthAverage() {
  const { rows, vintageYear } = await fetchImfWeoSeries(IMF_GDP_GROWTH_INDICATOR)
  const actualRows = vintageYear != null ? rows.filter((r) => r.year < vintageYear) : rows
  if (actualRows.length === 0) return { value: undefined, years: [] }
  const used = actualRows.slice(0, GROWTH_YEARS_TARGET)
  const mean = used.reduce((sum, r) => sum + r.value, 0) / used.length
  return { value: mean, years: used.map((r) => r.year).sort((a, b) => a - b) }
}

async function buildTaiwanScore() {
  const [gdpNominalRaw, gdpPerCapitaPpp, gdpGrowth, unemploymentRate, inflationCpi] = await Promise.all([
    resolveImfMostRecentActual(IMF_GDP_NOMINAL_INDICATOR),
    resolveImfMostRecentActual(IMF_GDP_PER_CAPITA_PPP_INDICATOR),
    resolveImfGrowthAverage(),
    resolveImfMostRecentActual(IMF_UNEMPLOYMENT_INDICATOR),
    resolveImfMostRecentActual(IMF_INFLATION_INDICATOR),
  ])

  const gdpNominal = {
    value: gdpNominalRaw.value,
    year: gdpNominalRaw.year,
    sourceUrl: imfWeoUrl(IMF_GDP_NOMINAL_INDICATOR),
  }
  const gdpPerCapitaPppWithSource = { ...gdpPerCapitaPpp, sourceUrl: imfWeoUrl(IMF_GDP_PER_CAPITA_PPP_INDICATOR) }
  const gdpGrowthWithSource = { ...gdpGrowth, sourceUrl: imfWeoUrl(IMF_GDP_GROWTH_INDICATOR) }
  const unemploymentRateWithSource = { ...unemploymentRate, sourceUrl: imfWeoUrl(IMF_UNEMPLOYMENT_INDICATOR) }
  const inflationCpiWithSource = { ...inflationCpi, sourceUrl: imfWeoUrl(IMF_INFLATION_INDICATOR) }

  if (gdpNominal.value == null) logGap('Taiwan', 'GDP (nominal)', `IMF WEO has no ${IMF_GDP_NOMINAL_INDICATOR} actual value for TWN in range — left unscored.`)
  if (gdpPerCapitaPppWithSource.value == null) {
    logGap('Taiwan', 'GDP per capita PPP', `IMF WEO has no ${IMF_GDP_PER_CAPITA_PPP_INDICATOR} actual value for TWN in range — left unscored.`)
  }
  if (gdpGrowthWithSource.value == null) {
    logGap('Taiwan', 'GDP growth (5yr avg)', `IMF WEO has no ${IMF_GDP_GROWTH_INDICATOR} actual values for TWN in range — left unscored.`)
  }
  if (unemploymentRateWithSource.value == null) {
    logGap('Taiwan', 'unemployment rate', `IMF WEO has no ${IMF_UNEMPLOYMENT_INDICATOR} actual value for TWN in range — left unscored.`)
  }
  if (inflationCpiWithSource.value == null) {
    logGap('Taiwan', 'inflation (CPI)', `IMF WEO has no ${IMF_INFLATION_INDICATOR} actual value for TWN in range — left unscored.`)
  }

  return {
    id: 'taiwan',
    name: 'Taiwan',
    alpha3: TAIWAN_ALPHA3,
    raw: {
      gdpNominal,
      gdpPerCapitaPpp: gdpPerCapitaPppWithSource,
      gdpGrowth: gdpGrowthWithSource,
      unemploymentRate: unemploymentRateWithSource,
      inflationCpi: inflationCpiWithSource,
    },
  }
}

// ---------------------------------------------------------------------------
// Normalization: percentile rank — used for GDP per capita, growth, and
// unemployment. NOT used for GDP (size) as of 2026-08-26 (see
// buildLogMinMaxNormalizer below) — GDP's outlier skew was the original
// reason this category adopted percentile rank project-wide (see this
// file's header comment), but percentile rank only encodes ORDER, not
// magnitude: doubling GDP's composite weight barely moved the US ahead of
// China, because both sat near the top percentile regardless of the real
// ~$10.6T gap between them. Per-capita GDP stays on percentile rank
// deliberately — log-min-max only makes sense where raw magnitude carries
// real weight (aggregate economic size/power), not for a per-capita
// prosperity ranking, where two countries with similar living standards
// should score similarly regardless of population size.
//
// Computed across all countries with a real value for that specific
// component. rank is 1-indexed, low-to-high; percentile = (rank-1)/(n-1) x
// 100, so the lowest value in the dataset gets 0 and the highest gets 100.
// Ties use average/fractional rank — see this file's header comment for why
// that convention was chosen over competition ranking.
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
    // sorted[i..j-1] are tied; as 1-indexed ranks they occupy i+1..j, so the
    // average/fractional rank for the whole tied group is the midpoint.
    rankByValue.set(sorted[i], (i + 1 + j) / 2)
    i = j
  }

  return (v) => {
    if (v == null) return null
    // n === 1: no comparison exists (denom would be 0) — the sole real
    // value is trivially both the min and max, so it gets the max score.
    if (n === 1) return 100
    const rank = rankByValue.get(v)
    return ((rank - 1) / (n - 1)) * 100
  }
}

// ---------------------------------------------------------------------------
// Normalization: log-min-max — GDP (size) only, as of 2026-08-26 (direct
// request). IDENTICAL implementation to buildMilitary.mjs's buildNormalizer
// (epsilon = 1% of the smallest nonzero observed value in this component's
// own dataset, min/max taken AFTER the log transform) — copied, not
// imported, since these are two standalone scripts by design (see this
// file's header comment on why buildEconomyWeo.mjs was also never merged
// into buildMilitary.mjs). Preserves relative magnitude (unlike percentile
// rank, which only preserves order) while still compressing GDP's outlier
// skew via the log transform — the whole reason Military adopted this
// method for its own magnitude-driven components.
// ---------------------------------------------------------------------------
function buildLogMinMaxNormalizer(values) {
  const nonNull = values.filter((v) => v != null)
  if (nonNull.length === 0) return () => null
  const min = Math.min(...nonNull)
  const max = Math.max(...nonNull)
  const smallestNonzero = Math.min(...nonNull.filter((v) => v > 0))
  const epsilon = Number.isFinite(smallestNonzero) ? smallestNonzero * 0.01 : 0.01
  const lnMin = Math.log(min + epsilon)
  const lnMax = Math.log(max + epsilon)
  const denom = lnMax - lnMin
  return (v) => {
    if (v == null) return null
    if (denom === 0) return 100 // every country has the same value
    return ((Math.log(v + epsilon) - lnMin) / denom) * 100
  }
}

function wbUrl(alpha3, indicatorCode) {
  return alpha3 ? `${WORLD_BANK_BASE}/${alpha3}/indicator/${indicatorCode}` : undefined
}

// ---------------------------------------------------------------------------
// Per-country pipeline
// ---------------------------------------------------------------------------

async function buildCountryScore(country) {
  const alpha3 = NUMERIC_TO_ALPHA3[country.id]
  if (!alpha3) {
    logGap(
      country.name,
      'GDP (nominal) + GDP per capita PPP + GDP growth + unemployment + inflation',
      'No ISO alpha-3 code resolved — left unscored.'
    )
    return {
      id: country.id,
      name: country.name,
      alpha3: undefined,
      raw: {
        gdpNominal: { value: undefined, year: undefined },
        gdpPerCapitaPpp: { value: undefined, year: undefined },
        gdpGrowth: { value: undefined, years: [] },
        unemploymentRate: { value: undefined, year: undefined },
        inflationCpi: { value: undefined, year: undefined },
      },
    }
  }

  const [gdpNominal, gdpPerCapitaPpp, gdpGrowth, unemploymentRate, inflationCpi] = await Promise.all([
    resolveWorldBankIndicator(alpha3, GDP_NOMINAL_INDICATOR),
    resolveWorldBankIndicator(alpha3, GDP_PER_CAPITA_PPP_INDICATOR),
    resolveGrowthAverage(alpha3),
    resolveWorldBankIndicator(alpha3, UNEMPLOYMENT_INDICATOR),
    resolveWorldBankIndicator(alpha3, INFLATION_INDICATOR),
  ])

  if (gdpNominal.value == null) {
    logGap(country.name, 'GDP (nominal)', `World Bank has no ${GDP_NOMINAL_INDICATOR} value for ${alpha3} in range — left unscored.`)
  }
  if (gdpPerCapitaPpp.value == null) {
    logGap(
      country.name,
      'GDP per capita PPP',
      `World Bank has no ${GDP_PER_CAPITA_PPP_INDICATOR} value for ${alpha3} in range — left unscored.`
    )
  }
  if (gdpGrowth.value == null) {
    logGap(
      country.name,
      'GDP growth (5yr avg)',
      `World Bank has no ${GDP_GROWTH_INDICATOR} values for ${alpha3} in range — left unscored.`
    )
  }
  if (unemploymentRate.value == null) {
    logGap(
      country.name,
      'unemployment rate',
      `World Bank has no ${UNEMPLOYMENT_INDICATOR} value for ${alpha3} in range — left unscored.`
    )
  }
  if (inflationCpi.value == null) {
    logGap(country.name, 'inflation (CPI)', `World Bank has no ${INFLATION_INDICATOR} value for ${alpha3} in range — left unscored.`)
  }

  return { id: country.id, name: country.name, alpha3, raw: { gdpNominal, gdpPerCapitaPpp, gdpGrowth, unemploymentRate, inflationCpi } }
}

console.log(`Building Economy scores for ${countries.length} ${isSample ? 'sample' : ''} countries...`)
const built = await mapWithConcurrency(countries, 8, buildCountryScore)

built.push(await buildTaiwanScore())
console.log('Added Taiwan (IMF WEO-sourced — see TAIWAN header comment).')

// GDP (size): log-min-max as of 2026-08-26 — see buildLogMinMaxNormalizer's
// own comment. GDP per capita, growth, and unemployment stay on percentile
// rank.
const rankGdpNominal = buildLogMinMaxNormalizer(built.map((r) => r.raw.gdpNominal.value))
const rankGdpPerCapitaPpp = buildPercentileRanker(built.map((r) => r.raw.gdpPerCapitaPpp.value))
const rankGdpGrowth = buildPercentileRanker(built.map((r) => r.raw.gdpGrowth.value))
const rankUnemployment = buildPercentileRanker(built.map((r) => r.raw.unemploymentRate.value))
// Inflation has no ranker of its own as of 2026-08-26 — it's a fixed
// tolerance-band formula (inflationToleranceBandScore, defined near
// INFLATION_TARGET_PCT above), not relative to this dataset at all, so
// there's nothing here to build ahead of time the way every other
// component's normalizer is.

// Originally equal weight, no exceptions, per the build prompt (a
// deliberate contrast drawn against Military's expenditure double-weight at
// the time — see WEIGHTING PATCH below for why that no longer holds).
// Average across whichever of the 5 components have real data for this
// country; a component with no data contributes nothing to the average
// rather than counting as a 0.
function finalizeCountry(r) {
  const gdpNominalPct = rankGdpNominal(r.raw.gdpNominal.value ?? null)
  const gdpPerCapitaPppPct = rankGdpPerCapitaPpp(r.raw.gdpPerCapitaPpp.value ?? null)
  const gdpGrowthPct = rankGdpGrowth(r.raw.gdpGrowth.value ?? null)
  // Inverted (100 - percentile): lower unemployment should score higher —
  // per the build prompt's explicit direction for component #4.
  const unemploymentPctRaw = rankUnemployment(r.raw.unemploymentRate.value ?? null)
  const unemploymentPct = unemploymentPctRaw == null ? null : 100 - unemploymentPctRaw

  // INFLATION SCORING (2026-08-26) — tolerance-band plateau around the 2%
  // target, see inflationToleranceBandScore's own comment (near
  // INFLATION_TARGET_PCT above) for the formula and citations. Used
  // directly — no percentile step, no ranker built ahead of time, since the
  // formula's output already IS the 0-100 score. A null raw value produces
  // a null score straight out of inflationToleranceBandScore's own null
  // check — same "no data, don't substitute a value" behavior every other
  // component has for the coverage floor.
  const inflationPct = inflationToleranceBandScore(r.raw.inflationCpi.value ?? null)

  // sourceUrl: `r.raw.X.sourceUrl` is only ever set for Taiwan's IMF-sourced
  // components (see buildTaiwanScore's own TAIWAN comment below) — every
  // WDI-sourced country's raw component has no sourceUrl of its own, so
  // this falls through to the ordinary wbUrl() construction unchanged.
  const components = {
    gdpNominal: {
      raw: r.raw.gdpNominal.value ?? null,
      normalized: gdpNominalPct,
      year: r.raw.gdpNominal.year,
      sourceUrl: r.raw.gdpNominal.sourceUrl ?? wbUrl(r.alpha3, GDP_NOMINAL_INDICATOR),
    },
    gdpPerCapitaPpp: {
      raw: r.raw.gdpPerCapitaPpp.value ?? null,
      normalized: gdpPerCapitaPppPct,
      year: r.raw.gdpPerCapitaPpp.year,
      sourceUrl: r.raw.gdpPerCapitaPpp.sourceUrl ?? wbUrl(r.alpha3, GDP_PER_CAPITA_PPP_INDICATOR),
    },
    gdpGrowth: {
      raw: r.raw.gdpGrowth.value ?? null,
      normalized: gdpGrowthPct,
      years: r.raw.gdpGrowth.years.length > 0 ? r.raw.gdpGrowth.years : undefined,
      sourceUrl: r.raw.gdpGrowth.sourceUrl ?? wbUrl(r.alpha3, GDP_GROWTH_INDICATOR),
    },
    unemploymentRate: {
      raw: r.raw.unemploymentRate.value ?? null,
      normalized: unemploymentPct,
      year: r.raw.unemploymentRate.year,
      sourceUrl: r.raw.unemploymentRate.sourceUrl ?? wbUrl(r.alpha3, UNEMPLOYMENT_INDICATOR),
    },
    inflationCpi: {
      raw: r.raw.inflationCpi.value ?? null,
      normalized: inflationPct,
      year: r.raw.inflationCpi.year,
      sourceUrl: r.raw.inflationCpi.sourceUrl ?? wbUrl(r.alpha3, INFLATION_INDICATOR),
    },
  }

  const presentNormalized = [gdpNominalPct, gdpPerCapitaPppPct, gdpGrowthPct, unemploymentPct, inflationPct].filter((v) => v != null)
  const coveragePresent = presentNormalized.length

  // COVERAGE FLOOR PATCH (2026-08-21): a country needs at least 3 of the 5
  // components present to receive an Economy score at all. Fixes real
  // output — Monaco and Liechtenstein, each with only 1 of 5 components
  // present, were outranking fully-measured economies because a single
  // component's percentile had nothing to average against. Below the
  // floor, `value` is left null rather than computed and then withheld —
  // there's no partial composite sitting behind an 'unavailable' tag.
  //
  // sourceCoverage = 0.2 x components present (design doc §5's general
  // weighted model — still not Military's coverage-floor MECHANISM, which
  // also changes true-zero/coverage-gap handling this category doesn't
  // have; this patch only borrows the "you need a floor" idea, applied to
  // Economy's own shape):
  //   sourceCoverage >= 0.8  -> 'measured'    (4 or 5 of 5 present)
  //   sourceCoverage == 0.6  -> 'proxy'       (exactly 3 of 5 present)
  //   sourceCoverage <  0.6  -> 'unavailable' (0, 1, or 2 of 5 present)
  // Derived from the integer coveragePresent count rather than comparing
  // the literal sourceCoverage float to 0.6 — `3 * 0.2 === 0.6` is FALSE
  // in JS (0.2 has no exact binary floating-point representation; 3 * 0.2
  // === 0.6000000000000001), so that comparison would have silently made
  // the 'proxy' tier unreachable. coveragePresent >= 4 / === 3 / <= 2 are
  // exactly equivalent to the sourceCoverage thresholds above, computed
  // safely on integers instead.
  const confidence = coveragePresent >= 4 ? 'measured' : coveragePresent === 3 ? 'proxy' : 'unavailable'

  // WEIGHTING PATCH (2026-08-21): GDP (size) double-weighted — mirrors
  // Military expenditure's double-weight in buildMilitary.mjs. Real output
  // showed large, mature economies (the US in particular) landing well
  // below smaller, faster-growing ones despite GDP and GDP per capita being
  // near-maxed. Not a data bug — a structural one: real GDP growth for a
  // multi-trillion-dollar economy is mechanically constrained, since the
  // same absolute dollar increase is a much smaller percentage of a $29T
  // base than of a $50B one, so equal-weighting "size" against "growth
  // rate" structurally penalizes size itself. GDP is this category's
  // "overall economic size" metric (nominal, as of 2026-08-22 — was PPP-
  // adjusted through v6.6.2, see GDP_NOMINAL_INDICATOR's own comment; the
  // double-weight itself is unaffected by which GDP measure backs it), so
  // counting its percentile twice in the average gives absolute economic
  // weight more influence than momentum/stability metrics. Uses its own
  // doubled-and-filtered list, NOT presentNormalized/coveragePresent above
  // — the coverage floor still gates on the real count of distinct
  // components present, unaffected by this. If gdpNominal itself is the
  // missing component for a country, BOTH copies are filtered out below —
  // never a partial/half-weight, same "neither copy counts" behavior
  // Military's expenditure double-weight already established.
  const weightedNormalized = [
    gdpNominalPct,
    gdpNominalPct,
    gdpPerCapitaPppPct,
    gdpGrowthPct,
    unemploymentPct,
    inflationPct,
  ].filter((v) => v != null)
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

function tsComponent(c) {
  const fields = [`raw: ${c.raw === null ? 'null' : c.raw}`, `normalized: ${c.normalized === null ? 'null' : c.normalized}`]
  if (c.year != null) fields.push(`year: ${c.year}`)
  if (c.years) fields.push(`years: [${c.years.join(', ')}]`)
  if (c.sourceUrl) fields.push(`sourceUrl: ${JSON.stringify(c.sourceUrl)}`)
  return `{ ${fields.join(', ')} }`
}

function scoreToTs(s) {
  const lines = []
  lines.push(`  ${JSON.stringify(s.id)}: {`)
  lines.push(`    name: ${JSON.stringify(s.name)},`)
  lines.push(`    value: ${s.value === null ? 'null' : s.value},`)
  lines.push(`    confidence: ${JSON.stringify(s.confidence)},`)
  lines.push(`    coveragePresent: ${s.coveragePresent},`)
  lines.push(`    coverageTotal: ${s.coverageTotal},`)
  lines.push(`    components: {`)
  for (const [key, c] of Object.entries(s.components)) {
    lines.push(`      ${key}: ${tsComponent(c)},`)
  }
  lines.push(`    },`)
  lines.push(`  },`)
  return lines.join('\n')
}

const header = `// Economy category scores for the Intelligence Engine, generated by
// scripts/buildEconomy.mjs (\`npm run build:economy\`) per the locked design
// in Intelligence Docs/intelligence-engine-scoring-design.md §3.2 and
// Intelligence Docs/buildEconomy-prompt.md.
//
// 5 World Bank WDI components, all coverage-gap-only (no true-zero
// components, unlike Military's nuclear/industrial-base): GDP (nominal —
// was PPP-adjusted through v6.6.2, see GDP_NOMINAL_INDICATOR's own comment
// in this script; LOG-MIN-MAX normalized as of 2026-08-26, was percentile
// rank through that same day — see buildLogMinMaxNormalizer's own comment),
// GDP per capita (PPP, percentile rank, unaffected by either GDP change),
// real GDP growth (5yr trailing average, percentile rank — see
// components.gdpGrowth.years for exactly which calendar years were
// averaged), unemployment rate (percentile rank, inverted — 100 -
// percentile, since lower is better), and inflation (CPI) — scored by a
// TOLERANCE-BAND PLATEAU around a 2% target as of 2026-08-26 (no percentile
// step at all; was a pure gaussian with no plateau earlier that same day,
// was a percentile-rank of distance-from-target before that, was inverted
// "lower is always better" before that — see INFLATION_TARGET_PCT's own
// comment for the Fed/BoE/BoE-tolerance-band citations and
// inflationToleranceBandScore for the formula). Trade
// volume/balance was explicitly dropped from the original v1 draft, not
// scored or annotated. Originally equal-weighted (0.2 each); GDP is
// double-weighted as of 2026-08-21 — see finalizeCountry's own WEIGHTING
// PATCH comment for why (large, mature economies were structurally
// penalized against smaller, faster-growing ones by treating "size" and
// "growth rate" as equally important).
//
// TAIWAN (2026-08-22) is the one entity in this dataset NOT sourced from
// World Bank WDI — WDI structurally excludes it. Sourced from IMF WEO
// instead, all 5 components, and keyed by its GeoEntity registry id
// ('taiwan') rather than a numeric ISO topology id — see buildTaiwanScore's
// own TAIWAN comment in this script for the full reasoning. Every other
// entity in this file is WDI-sourced and numeric-id-keyed as described
// below.
//
// Normalized via PERCENTILE RANK for 3 of 5 components (GDP per capita,
// growth, unemployment) — a deliberate divergence from Military's
// log-min-max for those, since order (not magnitude) is what matters for a
// per-capita/rate-based comparison. GDP (size) itself switched TO
// log-min-max as of 2026-08-26 (see buildLogMinMaxNormalizer's own
// comment) — magnitude carries real weight for aggregate economic size,
// the same reason Military uses it. Inflation uses neither — a fixed
// tolerance-band formula, not relative to this dataset at all (see
// inflationToleranceBandScore). Percentile ties use average/fractional rank
// (confirmed with the user before this script was written, per the build
// prompt's explicit "stop and ask" instruction — see this script's own
// header comment for the convention).
//
// Confidence uses the design doc's general weighted-sourceCoverage model
// (sourceCoverage = 0.2 x components present), with a coverage floor added
// 2026-08-21: a country needs at least 3 of 5 components present to get a
// score at all (>=0.8 'measured', ==0.6 'proxy', <0.6 'unavailable' —
// \`value\` is null below the floor, not computed from 1-2 components and
// then withheld). Originally had no floor at all (a single present
// component still produced a low-confidence value); real output showed
// Monaco/Liechtenstein (1 of 5 present each) outranking fully-measured
// economies, since one component's percentile had nothing to average
// against. See finalizeCountry's own comment for why the tiers are
// computed from the integer coveragePresent count, not the literal
// sourceCoverage float.
//
// Keyed by the SAME numeric ISO topology id scene/useCountryFeatures.ts
// registers Country records under — same convention as
// src/data/militaryScores.ts / src/data/countryEconomics.ts.
//
// Re-run the build script (rather than hand-editing this file) to refresh.

export type EconomyConfidence = 'measured' | 'proxy' | 'unavailable'

export interface EconomyComponentValue {
  raw: number | null
  /**
   * 0-100 score, meaning varies by component — see EconomyScore's own
   * comment and scripts/buildEconomy.mjs for the full reasoning behind
   * each:
   * - gdpPerCapitaPpp / gdpGrowth: percentile rank (average/fractional rank
   *   for ties) across every country with a real value.
   * - unemploymentRate: percentile rank, inverted (100 - percentile) —
   *   lower raw value is better.
   * - gdpNominal (2026-08-26): LOG-MIN-MAX, not percentile rank — preserves
   *   relative magnitude (unlike percentile rank, which only preserves
   *   order), the same method Military uses for its own magnitude-driven
   *   components.
   * - inflationCpi (2026-08-26): a TOLERANCE-BAND PLATEAU around a 2%
   *   target, not relative to this dataset at all — a full 100 for any raw
   *   value within 1.0pp of 2% (the Bank of England's own tolerance band),
   *   gaussian decay beyond that.
   * Every case still means higher normalized = "more favorable" for that
   * component uniformly. null iff raw is null.
   */
  normalized: number | null
  year?: number
  /** gdpGrowth only: every individual calendar year actually averaged into \`raw\` (fewer than 5 if the country has gaps in the lookback window). */
  years?: number[]
  sourceUrl?: string
}

export interface EconomyScore {
  name: string
  /** 0-100 composite — average of whichever of the 5 components have real data, with GDP counted twice (see the file header comment above), null iff confidence is 'unavailable'. */
  value: number | null
  confidence: EconomyConfidence
  /** How many of the 5 components have a real value for this country (0-5). */
  coveragePresent: number
  coverageTotal: number
  components: {
    gdpNominal: EconomyComponentValue
    gdpPerCapitaPpp: EconomyComponentValue
    gdpGrowth: EconomyComponentValue
    unemploymentRate: EconomyComponentValue
    inflationCpi: EconomyComponentValue
  }
}

// Keyed by numeric ISO topology id (e.g. "840" for the United States) —
// except Taiwan, keyed by its GeoEntity registry id ('taiwan'). See the
// TAIWAN paragraph in the header comment above.
export const ECONOMY_SCORES: Record<string, EconomyScore> = {
`

const footer = `}
`

const body = finalScores.map(scoreToTs).join('\n')
fs.writeFileSync(OUTPUT, header + body + '\n' + footer)
console.log(`Wrote ${OUTPUT}: ${finalScores.length} countries.`)
console.log(
  `Confidence breakdown: measured=${finalScores.filter((s) => s.confidence === 'measured').length}, ` +
    `proxy=${finalScores.filter((s) => s.confidence === 'proxy').length}, ` +
    `unavailable=${finalScores.filter((s) => s.confidence === 'unavailable').length}`
)

// ---------------------------------------------------------------------------
// Per-component coverage report — printed always, same purpose as
// buildMilitary.mjs's equivalent.
// ---------------------------------------------------------------------------
function countPresent(getter) {
  return finalScores.filter((s) => getter(s.components) != null).length
}
console.log('Per-component coverage (real, sourced value present):')
console.log(`  gdpNominal: ${countPresent((c) => c.gdpNominal.raw)}`)
console.log(`  gdpPerCapitaPpp: ${countPresent((c) => c.gdpPerCapitaPpp.raw)}`)
console.log(`  gdpGrowth: ${countPresent((c) => c.gdpGrowth.raw)}`)
console.log(`  unemploymentRate: ${countPresent((c) => c.unemploymentRate.raw)}`)
console.log(`  inflationCpi: ${countPresent((c) => c.inflationCpi.raw)}`)

// ---------------------------------------------------------------------------
// DIAGNOSTIC ONLY — debug/economy-component-breakdown.json. Read-only
// instrumentation for reviewing the ranking (ahead of any decision about
// whether a weighting change is needed) — every field here is read straight
// off `finalScores`, already fully computed above; this does not affect
// scoring, normalization, or weighting, and is not consumed by the app
// itself (src/data/economyScores.ts, written above, is unaffected). Skips
// 'unavailable'-confidence entities — there's no composite/percentile set
// to show for those. `percentile` is each component's post-inversion,
// pre-average normalized value (`components.X.normalized` — already
// inverted for unemployment/inflation, exactly what fed the composite
// average), not a value recomputed here.
// ---------------------------------------------------------------------------
function writeComponentBreakdownDebugFile() {
  const DEBUG_OUTPUT = 'debug/economy-component-breakdown.json'
  const breakdown = finalScores
    .filter((s) => s.confidence !== 'unavailable')
    .map((s) => ({
      entity: s.name,
      components: {
        gdpNominal: { raw: s.components.gdpNominal.raw, percentile: s.components.gdpNominal.normalized },
        gdpPerCapPpp: { raw: s.components.gdpPerCapitaPpp.raw, percentile: s.components.gdpPerCapitaPpp.normalized },
        growth5yrAvg: { raw: s.components.gdpGrowth.raw, percentile: s.components.gdpGrowth.normalized },
        unemployment: { raw: s.components.unemploymentRate.raw, percentile: s.components.unemploymentRate.normalized },
        inflation: { raw: s.components.inflationCpi.raw, percentile: s.components.inflationCpi.normalized },
      },
      compositeScore: s.value,
    }))
  fs.mkdirSync('debug', { recursive: true })
  fs.writeFileSync(DEBUG_OUTPUT, JSON.stringify(breakdown, null, 2))
  console.log(`Wrote ${DEBUG_OUTPUT}: ${breakdown.length} entities (measured/proxy only; unavailable skipped).`)
}

writeComponentBreakdownDebugFile()

// ---------------------------------------------------------------------------
// BACKLOG.md — same marker-delimited idempotent append pattern as
// buildMilitary.mjs / buildGovCapitalPopGdp.mjs.
// ---------------------------------------------------------------------------
function writeBacklogReport() {
  const BEGIN = '<!-- BEGIN buildEconomy.mjs gap report -->'
  const END = '<!-- END buildEconomy.mjs gap report -->'
  const generatedAt = new Date().toISOString().slice(0, 10)

  const lines = []
  lines.push(BEGIN)
  lines.push('')
  lines.push(
    `**Generated by \`npm run build:economy\` (\`scripts/buildEconomy.mjs\`), ${generatedAt}.** ` +
      `Economy category component fields that couldn't be sourced cleanly this run — left unscored, not guessed. ` +
      `Re-running the script regenerates this list.`
  )
  lines.push('')
  lines.push(
    `**Tie-handling convention** (see scripts/buildEconomy.mjs's own header comment): percentile rank uses ` +
      `average/fractional rank for ties, confirmed with the user before this script was written, per ` +
      `Intelligence Docs/buildEconomy-prompt.md's explicit "stop and ask before picking a tie-breaking ` +
      `convention" instruction.`
  )
  lines.push('')
  if (gaps.length === 0) {
    lines.push('- None this run — every component for every country resolved cleanly.')
  } else {
    const sortedGaps = gaps.slice().sort((a, b) => a.country.localeCompare(b.country) || a.field.localeCompare(b.field))
    for (const g of sortedGaps) lines.push(`- **[${g.country}] ${g.field}:** ${g.reason}`)
  }
  lines.push('')
  lines.push(END)
  const section = lines.join('\n')

  const backlog = fs.readFileSync(BACKLOG, 'utf8')
  const beginIdx = backlog.indexOf(BEGIN)
  const endIdx = backlog.indexOf(END)
  let updated
  if (beginIdx !== -1 && endIdx !== -1) {
    updated = backlog.slice(0, beginIdx) + section + backlog.slice(endIdx + END.length)
  } else {
    const heading = '\n## Data sourcing (`buildEconomy.mjs`)\n\n'
    const introEnd = backlog.indexOf('\n## ')
    updated = introEnd === -1 ? backlog + heading + section + '\n' : backlog.slice(0, introEnd) + heading + section + '\n' + backlog.slice(introEnd)
  }
  fs.writeFileSync(BACKLOG, updated)
  console.log(`Updated ${BACKLOG}: ${gaps.length} gap(s) logged.`)
}

writeBacklogReport()
