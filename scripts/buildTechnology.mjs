// Build-time asset generator for the Technology category of the
// Intelligence Engine (see Intelligence Docs/intelligence-engine-scoring-
// design.md §3.3 for the locked, finalized spec this script implements —
// finalized 2026-08-25 at 4 components after a 5th/6th-component
// investigation found real coverage gaps in every candidate; see that
// section's "Investigated and not included" subsection). Produces one
// Technology score (0-100) per country, plus per-component breakdown,
// written to src/data/technologyScores.ts.
//
// 4 locked components, all coverage-gap-only (no true-zero component, unlike
// Military's nuclear/industrial-base):
//   1. R&D expenditure, % GDP            — World Bank WDI (GB.XPD.RSDV.GD.ZS)
//   2. Patent applications by residents,
//      per million population            — World Bank WDI (IP.PAT.RESD),
//                                           WIPO-sourced (see note below)
//   3. High-tech exports, % of
//      manufactured exports              — World Bank WDI (TX.VAL.TECH.MF.ZS)
//   4. ICT Development Index             — ITU, 2024 edition (relaunched 2023
//                                           methodology, 2022 reference data),
//                                           hand-transcribed (see IDI note)
//
// NOTE on component 2 ("WIPO IP Statistics, direct, not via GII" per the
// design doc): World Bank's IP.PAT.RESD indicator IS WIPO's own patent
// filing data, re-hosted through the WDI API — "direct" in the design doc's
// phrasing contrasts with routing patent counts through GII's own bundled
// composite (see §3.3's "Superseded design" — GII's Knowledge and
// technology outputs pillar already includes PCT filings, which is exactly
// the double-count problem that ruled GII out as a backbone). Fetching WIPO
// data via the World Bank's mirror of it, the same way this project already
// fetches SIPRI/FAS-sourced figures via other scripts' own direct API calls,
// is not the same as scoring it through GII. Verified working 2026-08-25 —
// see this script's own commit for the live-fetch confirmation.
//
// NOTE on component 4 (ICT Development Index): ITU has no public bulk-data
// REST API for this (datahub.itu.int returns 403 to an unauthenticated
// fetch; the "available upon request" pattern several rejected AI-index
// candidates hit in §3.3's investigation applies here too). The IDI_2024
// table below is hand-transcribed from ITU's own published 2024 edition
// (itu.int/itu-d/reports/statistics/IDI2024/) via its structured, sourced,
// alphabetically-sorted-by-ISO3 wikitable on Wikipedia
// (https://en.wikipedia.org/wiki/ICT_Development_Index) — extracted with a
// deterministic regex parse of the raw wikitext (not summarized through a
// lossy model pass), not eyeballed by hand, to avoid transcription error
// across 172 rows. This is the SAME "hand-maintained, cited, real published
// values" precedent as buildMilitary.mjs's NUCLEAR_WARHEADS table (FAS
// Nuclear Notebook, no API either) and currentStatus.ts's sanctionTier seed
// — not a live pull, and re-running this script does NOT refresh IDI values;
// update IDI_2024 by hand against ITU's next published edition when one
// ships. 172 economies covered (of 193 UN members, minus non-UN-member
// entries like Hong Kong/Macao/Palestine that appear in ITU's table but
// aren't in this app's Country registry) — close to the design doc's "~165
// economies" estimate.
//
// Standalone data-generation script only — does NOT touch GeoEntity/Country
// type definitions, registries, or any rendering/UI code (same scope
// boundary as buildEconomy.mjs).
//
// Usage:
//   node scripts/buildTechnology.mjs --sample
//     Dry run: the same 15-country reference set buildMilitary.mjs/
//     buildEconomy.mjs use. Prints full scores + per-component breakdown,
//     writes nothing.
//   npm run build:technology
//     Full run: all 193 countries, writes src/data/technologyScores.ts and
//     appends a generated gap report to BACKLOG.md. Also writes
//     debug/technology-component-breakdown.json — a diagnostic-only
//     per-entity component/percentile/composite dump, not consumed by the
//     app.
//
// Run via `node`, not `tsx` — same as buildMilitary.mjs/buildEconomy.mjs, no
// existing .ts source needs importing.
import fs from 'node:fs'
import { feature } from 'topojson-client'
import { ALPHA3_TO_NUMERIC } from './lib/iso3166.mjs'

const COUNTRIES_SOURCE = 'public/geo/countries-un193.json'
const OUTPUT = 'src/data/technologyScores.ts'
const BACKLOG = 'BACKLOG.md'

const WORLD_BANK_BASE = 'https://api.worldbank.org/v2/country'
const RD_EXPENDITURE_INDICATOR = 'GB.XPD.RSDV.GD.ZS'
const PATENT_APPLICATIONS_RESIDENT_INDICATOR = 'IP.PAT.RESD'
const POPULATION_INDICATOR = 'SP.POP.TOTL'
const HIGH_TECH_EXPORTS_INDICATOR = 'TX.VAL.TECH.MF.ZS'

const WORLD_BANK_PRIMARY_YEAR = 2024
const WORLD_BANK_LOOKBACK_START_YEAR = 2000

const sampleArg = process.argv.includes('--sample')
const isSample = sampleArg
const SAMPLE_COUNTRIES = [
  'United States of America', 'China', 'Russia', 'India', 'United Kingdom', 'France', 'Germany', 'Japan',
  'Israel', 'Pakistan', 'North Korea', 'Brazil', 'Poland', 'Luxembourg', 'Costa Rica',
]

// ---------------------------------------------------------------------------
// ICT Development Index — ITU, 2024 edition (2022 reference data), relaunched
// 2023 methodology. See this file's header NOTE on component 4 for sourcing/
// extraction method. Keyed by ISO 3166-1 alpha-3. Values are ITU's own
// published 0-100 aggregate IDI score, unmodified.
// Source: https://en.wikipedia.org/wiki/ICT_Development_Index (citing
// https://www.itu.int/itu-d/reports/statistics/IDI2024/), retrieved 2026-08-25.
// ---------------------------------------------------------------------------
const IDI_2024 = {
  AFG: 33.1, AGO: 49.9, ALB: 84.7, AND: 88.8, ARE: 97.5, ARG: 83.4, ARM: 86.4, ATG: 79.7, AUS: 95.1, AUT: 94.3,
  AZE: 80.4, BDI: 24.4, BEL: 89.3, BEN: 45.4, BFA: 30.1, BGD: 62.0, BGR: 88.7, BHR: 97.5, BHS: 89.3, BIH: 78.6,
  BLR: 88.5, BOL: 69.4, BRA: 82.0, BRB: 77.5, BRN: 95.7, BTN: 85.9, BWA: 78.7, CAN: 88.6, CHE: 92.4, CHL: 91.7,
  CHN: 85.8, CIV: 65.3, CMR: 44.2, COD: 31.0, COG: 30.7, COL: 73.2, COM: 46.5, CPV: 69.1, CRI: 84.8, CUB: 55.3,
  CYP: 88.6, CZE: 88.0, DEU: 87.8, DJI: 61.6, DMA: 78.4, DNK: 97.1, DOM: 75.4, DZA: 80.9, ECU: 70.0, EGY: 76.8,
  ESP: 92.5, EST: 97.9, ETH: 39.8, FJI: 73.2, FIN: 98.1, FRA: 89.8, GAB: 74.7, GBR: 93.6, GEO: 87.8, GHA: 66.2,
  GNB: 36.9, GNQ: 44.8, GRC: 86.5, GRD: 78.6, GTM: 51.7, HKG: 97.4, HND: 60.9, HRV: 89.6, HUN: 87.4, IDN: 82.8,
  IRL: 90.7, IRN: 82.2, IRQ: 73.9, ISL: 95.9, ISR: 92.5, ITA: 87.7, JAM: 76.9, JOR: 84.9, JPN: 93.2, KAZ: 90.1,
  KEN: 58.5, KGZ: 88.3, KHM: 72.6, KIR: 52.1, KNA: 84.9, KOR: 94.4, KWT: 100.0, LAO: 65.3, LBR: 37.1, LBY: 88.1,
  LCA: 73.9, LIE: 92.3, LKA: 71.3, LSO: 48.8, LTU: 94.2, LUX: 92.6, LVA: 94.3, MAC: 94.1, MAR: 86.8, MCO: 92.6,
  MDA: 78.3, MDG: 29.9, MDV: 81.5, MEX: 80.7, MKD: 82.0, MLI: 40.4, MLT: 93.5, MMR: 63.8, MNE: 87.9, MNG: 87.0,
  MOZ: 32.0, MRT: 55.5, MUS: 84.2, MWI: 33.1, MYS: 95.0, NAM: 68.8, NGA: 46.9, NIC: 61.6, NLD: 92.5, NOR: 93.4,
  NZL: 90.3, OMN: 91.7, PAK: 55.6, PAN: 77.6, PER: 76.4, PHL: 74.4, POL: 95.8, PRT: 87.4, PRY: 74.1, QAT: 97.8,
  ROU: 87.6, RUS: 90.6, RWA: 46.8, SAU: 95.7, SEN: 69.3, SGP: 97.8, SLE: 34.3, SLV: 66.1, SMR: 92.7, SOM: 28.7,
  SRB: 87.7, STP: 55.9, SUR: 82.5, SVK: 87.1, SVN: 90.8, SWE: 95.3, SWZ: 70.4, SYC: 84.7, SYR: 59.6, TCD: 21.3,
  TGO: 46.2, THA: 91.0, TLS: 39.2, TON: 58.2, TTO: 78.8, TUN: 77.2, TUR: 87.5, TZA: 43.1, UGA: 40.4, UKR: 81.0,
  URY: 89.9, USA: 96.7, UZB: 84.9, VCT: 70.7, VEN: 67.7, VNM: 85.0, VUT: 70.2, WSM: 67.8, YEM: 43.5, ZAF: 83.6,
  ZMB: 55.6, ZWE: 47.7,
}
const IDI_SOURCE_URL = 'https://www.itu.int/itu-d/reports/statistics/IDI2024/'

// ---------------------------------------------------------------------------
// Fetch helpers (same pattern as buildMilitary.mjs / buildEconomy.mjs)
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

// 193 countries x 3 WDI indicators = ~579 requests; unbounded concurrency
// against a public, unauthenticated API risks rate-limit/connection-reset
// errors — same limit buildEconomy.mjs/buildMilitary.mjs use.
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
// Country list + id bridging (same as buildEconomy.mjs)
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
// Single most-recent-value World Bank indicators — same range-query +
// explicit-year pattern as buildEconomy.mjs's resolveWorldBankIndicator.
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

function wbUrl(alpha3, indicatorCode) {
  return alpha3 ? `${WORLD_BANK_BASE}/${alpha3}/indicator/${indicatorCode}` : undefined
}

// ---------------------------------------------------------------------------
// Normalization: percentile rank — used for all 4 components, the same
// average/fractional-rank-for-ties convention buildEconomy.mjs uses
// (confirmed with the user before that script was written; reused here
// unchanged rather than re-asking, since it's already this project's
// established tie-breaking convention for this normalization method). No
// component here has GDP-scale outlier skew the way Economy's own GDP
// component did (which is why THAT component alone switched to
// log-min-max) — R&D%/high-tech-exports%/patents-per-million/IDI are all
// already rate- or index-shaped, so percentile rank suits all 4 uniformly.
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

// ---------------------------------------------------------------------------
// Per-country pipeline
// ---------------------------------------------------------------------------

async function buildCountryScore(country) {
  const alpha3 = NUMERIC_TO_ALPHA3[country.id]
  if (!alpha3) {
    logGap(
      country.name,
      'R&D expenditure + patents per capita + high-tech exports + ICT Development Index',
      'No ISO alpha-3 code resolved — left unscored.'
    )
    return {
      id: country.id,
      name: country.name,
      alpha3: undefined,
      raw: {
        rdExpenditurePctGdp: { value: undefined, year: undefined },
        patentApplicationsResident: { value: undefined, year: undefined },
        population: { value: undefined, year: undefined },
        highTechExportsPct: { value: undefined, year: undefined },
      },
    }
  }

  const [rdExpenditurePctGdp, patentApplicationsResident, population, highTechExportsPct] = await Promise.all([
    resolveWorldBankIndicator(alpha3, RD_EXPENDITURE_INDICATOR),
    resolveWorldBankIndicator(alpha3, PATENT_APPLICATIONS_RESIDENT_INDICATOR),
    resolveWorldBankIndicator(alpha3, POPULATION_INDICATOR),
    resolveWorldBankIndicator(alpha3, HIGH_TECH_EXPORTS_INDICATOR),
  ])

  if (rdExpenditurePctGdp.value == null) {
    logGap(country.name, 'R&D expenditure (% GDP)', `World Bank has no ${RD_EXPENDITURE_INDICATOR} value for ${alpha3} in range — left unscored.`)
  }
  if (patentApplicationsResident.value == null) {
    logGap(
      country.name,
      'Patent applications, residents',
      `World Bank has no ${PATENT_APPLICATIONS_RESIDENT_INDICATOR} value for ${alpha3} in range — left unscored.`
    )
  } else if (population.value == null) {
    logGap(
      country.name,
      'Patents per capita (population denominator)',
      `Patent count is present but World Bank has no ${POPULATION_INDICATOR} value for ${alpha3} in range — per-capita figure left unscored.`
    )
  }
  if (highTechExportsPct.value == null) {
    logGap(
      country.name,
      'High-tech exports (% of manufactured exports)',
      `World Bank has no ${HIGH_TECH_EXPORTS_INDICATOR} value for ${alpha3} in range — left unscored.`
    )
  }
  if (IDI_2024[alpha3] == null) {
    logGap(country.name, 'ICT Development Index', `No ITU IDI 2024 entry for ${alpha3} — not published/not an ITU member — left unscored.`)
  }

  return {
    id: country.id,
    name: country.name,
    alpha3,
    raw: { rdExpenditurePctGdp, patentApplicationsResident, population, highTechExportsPct },
  }
}

console.log(`Building Technology scores for ${countries.length} ${isSample ? 'sample' : ''} countries...`)
const built = await mapWithConcurrency(countries, 8, buildCountryScore)

// Patents per million population — computed here (not per-country in
// buildCountryScore) so it can be normalized with the same
// buildPercentileRanker helper as the other 3 components. Deliberately
// tolerates the patent count and the population figure coming from
// different WDI vintage years (each resolved independently to its own most-
// recent value) rather than forcing a matched-year lookup — the same
// "each component's own most-recent value" tolerance every other multi-
// component category in this codebase already has for its own components
// individually; this is the one component here that's a RATIO of two
// independently-fetched figures, so the tolerance applies twice, which is
// still a small effect given population changes slowly year to year.
function patentsPerMillion(r) {
  const patents = r.raw.patentApplicationsResident.value
  const pop = r.raw.population.value
  if (patents == null || pop == null || pop === 0) return null
  return (patents / pop) * 1_000_000
}

const rankRd = buildPercentileRanker(built.map((r) => r.raw.rdExpenditurePctGdp.value ?? null))
const rankPatentsPerMillion = buildPercentileRanker(built.map((r) => patentsPerMillion(r)))
const rankHighTechExports = buildPercentileRanker(built.map((r) => r.raw.highTechExportsPct.value ?? null))
const rankIdi = buildPercentileRanker(built.map((r) => (r.alpha3 ? (IDI_2024[r.alpha3] ?? null) : null)))

// Equal weight across all 4 components, per Governing Principle 6 (design
// doc §3.3's finalized "Weighting: equal across the 4 locked components" —
// no citable framework was found to justify an unequal scheme). Average
// across whichever of the 4 components have real data for this country; a
// component with no data contributes nothing to the average rather than
// counting as a 0 — same convention as Military/Economy.
function finalizeCountry(r) {
  const idiRaw = r.alpha3 ? (IDI_2024[r.alpha3] ?? null) : null
  const patentsPerM = patentsPerMillion(r)

  const rdPct = rankRd(r.raw.rdExpenditurePctGdp.value ?? null)
  const patentsPct = rankPatentsPerMillion(patentsPerM)
  const highTechPct = rankHighTechExports(r.raw.highTechExportsPct.value ?? null)
  const idiPct = rankIdi(idiRaw)

  const components = {
    rdExpenditurePctGdp: {
      raw: r.raw.rdExpenditurePctGdp.value ?? null,
      normalized: rdPct,
      year: r.raw.rdExpenditurePctGdp.year,
      sourceUrl: wbUrl(r.alpha3, RD_EXPENDITURE_INDICATOR),
    },
    patentsPerMillion: {
      raw: patentsPerM,
      normalized: patentsPct,
      year: r.raw.patentApplicationsResident.year,
      sourceUrl: wbUrl(r.alpha3, PATENT_APPLICATIONS_RESIDENT_INDICATOR),
    },
    highTechExportsPct: {
      raw: r.raw.highTechExportsPct.value ?? null,
      normalized: highTechPct,
      year: r.raw.highTechExportsPct.year,
      sourceUrl: wbUrl(r.alpha3, HIGH_TECH_EXPORTS_INDICATOR),
    },
    ictDevelopmentIndex: {
      raw: idiRaw,
      normalized: idiPct,
      year: 2022, // ITU IDI 2024 edition reflects 2022 reference-year data — see IDI_2024's own comment.
      sourceUrl: idiRaw != null ? IDI_SOURCE_URL : undefined,
    },
  }

  const presentNormalized = [rdPct, patentsPct, highTechPct, idiPct].filter((v) => v != null)
  const coveragePresent = presentNormalized.length

  // COVERAGE FLOOR — same "you need a floor" idea buildEconomy.mjs's
  // coverage-floor patch established (see that script's own comment), scaled
  // to 4 components instead of 5: a country needs at least 3 of 4 present to
  // receive a Technology score at all. Below the floor, `value` is left null
  // rather than computed from 1-2 components and then withheld.
  //   coveragePresent === 4  -> 'measured'
  //   coveragePresent === 3  -> 'proxy'
  //   coveragePresent <= 2   -> 'unavailable'
  const confidence = coveragePresent === 4 ? 'measured' : coveragePresent === 3 ? 'proxy' : 'unavailable'
  const value = coveragePresent >= 3 ? presentNormalized.reduce((a, b) => a + b, 0) / presentNormalized.length : null

  return {
    id: r.id,
    name: r.name,
    value: value == null ? null : Math.round(value * 10) / 10,
    confidence,
    coveragePresent,
    coverageTotal: 4,
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

const header = `// Technology category scores for the Intelligence Engine, generated by
// scripts/buildTechnology.mjs (\`npm run build:technology\`) per the locked
// design in Intelligence Docs/intelligence-engine-scoring-design.md §3.3
// (finalized 2026-08-25 at 4 components).
//
// 4 components, all coverage-gap-only (no true-zero components, unlike
// Military's nuclear/industrial-base): R&D expenditure (% GDP, World Bank
// WDI), patent applications by residents (per million population — World
// Bank's WIPO-sourced IP.PAT.RESD divided by SP.POP.TOTL, see
// patentsPerMillion's own comment in this script for why the two are
// fetched independently rather than year-matched), high-tech exports (% of
// manufactured exports, World Bank WDI), and the ITU ICT Development Index
// (2024 edition / 2022 reference data — HAND-TRANSCRIBED from ITU's own
// published table, not a live pull; see this script's IDI_2024 comment for
// the full sourcing/extraction trail and why no live ITU API exists to pull
// from instead). All 4 normalized via PERCENTILE RANK (average/fractional
// rank for ties, the same convention buildEconomy.mjs's GDP-per-capita/
// growth/unemployment components use) — no component here has GDP-style
// outlier skew, so unlike Economy's GDP (size) component, nothing here
// needed log-min-max. Equal-weighted across all 4, per Governing Principle 6
// (no citable framework was found to justify an unequal scheme — two
// illustrative weighted proposals were drafted and rejected for the same
// reason during design, see the design doc's §3.3 "Weighting" note).
//
// Confidence uses a coverage floor scaled from Economy's own precedent to 4
// components instead of 5: a country needs at least 3 of 4 components
// present to get a score at all (4/4 'measured', 3/4 'proxy', <=2/4
// 'unavailable' — \`value\` is null below the floor, not computed from 1-2
// components and then withheld).
//
// Keyed by the SAME numeric ISO topology id scene/useCountryFeatures.ts
// registers Country records under — same convention as
// src/data/militaryScores.ts / src/data/economyScores.ts. No GeoEntity
// (including Taiwan, unlike Economy) has a Technology score — Technology
// draws no IMF WEO fallback the way Economy does for Taiwan specifically;
// this category is 100% World Bank WDI + hand-transcribed ITU IDI, and
// neither source covers Taiwan, so it's simply absent here like every other
// WDI-only dataset in this codebase (e.g. Military).
//
// Re-run the build script to refresh the 3 WDI-sourced components (does NOT
// refresh IDI_2024 — that's a hand-maintained snapshot, update it by hand
// against ITU's next published edition).

export type TechnologyConfidence = 'measured' | 'proxy' | 'unavailable'

export interface TechnologyComponentValue {
  raw: number | null
  /**
   * 0-100 percentile-rank score (average/fractional rank for ties) across
   * every country with a real value for that component — see
   * scripts/buildTechnology.mjs's buildPercentileRanker. Higher normalized
   * always means "more favorable" for that component. null iff raw is null.
   */
  normalized: number | null
  year?: number
  sourceUrl?: string
}

export interface TechnologyScore {
  name: string
  /** 0-100 composite — equal-weighted average of whichever of the 4 components have real data, null iff confidence is 'unavailable'. */
  value: number | null
  confidence: TechnologyConfidence
  /** How many of the 4 components have a real value for this country (0-4). */
  coveragePresent: number
  coverageTotal: number
  components: {
    rdExpenditurePctGdp: TechnologyComponentValue
    patentsPerMillion: TechnologyComponentValue
    highTechExportsPct: TechnologyComponentValue
    ictDevelopmentIndex: TechnologyComponentValue
  }
}

// Keyed by numeric ISO topology id (e.g. "840" for the United States).
export const TECHNOLOGY_SCORES: Record<string, TechnologyScore> = {
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
// buildEconomy.mjs's equivalent.
// ---------------------------------------------------------------------------
function countPresent(getter) {
  return finalScores.filter((s) => getter(s.components) != null).length
}
console.log('Per-component coverage (real, sourced value present):')
console.log(`  rdExpenditurePctGdp: ${countPresent((c) => c.rdExpenditurePctGdp.raw)}`)
console.log(`  patentsPerMillion: ${countPresent((c) => c.patentsPerMillion.raw)}`)
console.log(`  highTechExportsPct: ${countPresent((c) => c.highTechExportsPct.raw)}`)
console.log(`  ictDevelopmentIndex: ${countPresent((c) => c.ictDevelopmentIndex.raw)}`)

// ---------------------------------------------------------------------------
// DIAGNOSTIC ONLY — debug/technology-component-breakdown.json. Same purpose
// as buildEconomy.mjs's equivalent — not consumed by the app.
// ---------------------------------------------------------------------------
function writeComponentBreakdownDebugFile() {
  const DEBUG_OUTPUT = 'debug/technology-component-breakdown.json'
  const breakdown = finalScores
    .filter((s) => s.confidence !== 'unavailable')
    .map((s) => ({
      entity: s.name,
      components: {
        rdExpenditurePctGdp: { raw: s.components.rdExpenditurePctGdp.raw, percentile: s.components.rdExpenditurePctGdp.normalized },
        patentsPerMillion: { raw: s.components.patentsPerMillion.raw, percentile: s.components.patentsPerMillion.normalized },
        highTechExportsPct: { raw: s.components.highTechExportsPct.raw, percentile: s.components.highTechExportsPct.normalized },
        ictDevelopmentIndex: { raw: s.components.ictDevelopmentIndex.raw, percentile: s.components.ictDevelopmentIndex.normalized },
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
// buildEconomy.mjs / buildMilitary.mjs.
// ---------------------------------------------------------------------------
function writeBacklogReport() {
  const BEGIN = '<!-- BEGIN buildTechnology.mjs gap report -->'
  const END = '<!-- END buildTechnology.mjs gap report -->'
  const generatedAt = new Date().toISOString().slice(0, 10)

  const lines = []
  lines.push(BEGIN)
  lines.push('')
  lines.push(
    `**Generated by \`npm run build:technology\` (\`scripts/buildTechnology.mjs\`), ${generatedAt}.** ` +
      `Technology category component fields that couldn't be sourced cleanly this run — left unscored, not guessed. ` +
      `Re-running the script regenerates the 3 WDI-sourced components' gaps; the ICT Development Index gap list ` +
      `only changes if IDI_2024 is hand-updated (see scripts/buildTechnology.mjs's own header comment).`
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
    const heading = '\n## Data sourcing (`buildTechnology.mjs`)\n\n'
    const introEnd = backlog.indexOf('\n## ')
    updated = introEnd === -1 ? backlog + heading + section + '\n' : backlog.slice(0, introEnd) + heading + section + '\n' + backlog.slice(introEnd)
  }
  fs.writeFileSync(BACKLOG, updated)
  console.log(`Updated ${BACKLOG}: ${gaps.length} gap(s) logged.`)
}

writeBacklogReport()
