// Build-time asset generator for the Military category of the Intelligence
// Engine (see Intelligence Docs/intelligence-engine-scoring-design.md, §3.1,
// for the locked spec this script implements — the original Claude Code
// build prompt that kicked this script off has since been retired; every
// sourcing decision/deviation/revision it captured lives on in this file's
// own comments and the design doc). Produces one Military score (0-100)
// per country, plus per-component normalized values, written to
// src/data/militaryScores.ts.
//
// Standalone data-generation script only — does NOT touch GeoEntity/Country
// type definitions, registries, or any rendering/UI code.
//
// ---------------------------------------------------------------------------
// SOURCING DEVIATION FROM THE LOCKED SPEC (flagged for human review, per the
// prompt's explicit "do not substitute a source without flagging it"
// instruction):
//
// Component #5 (Air fleet size / FlightGlobal World Air Forces) is NOT
// implemented here and is NOT part of this script's output. Investigated and
// confirmed genuinely blocked, not a technical scraping problem: the 2026
// World Air Forces directory page (flightglobal.com) is a straight paid
// subscription paywall (no PDF link, no free/email-gated form present on the
// page despite older social-media claims of a "free download") — the same
// licensing wall this project already ruled out IISS/Jane's for (see the
// design doc's Backlogged table). No equivalent free, citable source exists
// at this project's citation bar. Backlogged by explicit decision (see
// BACKLOG.md) rather than substituted with a lower-credibility source
// (Wikipedia, aggregator sites, or a third-party PDF mirror of paywalled
// content).
//
// Component #7 (Arms import TIV / SIPRI Arms Transfers Database) required
// more than the documented API: the URL the public docs point to
// (armstrade.sipri.org/armstrade/html/export_values.php) is decommissioned
// and now redirects to a marketing page. The live portal
// (armstransfers.sipri.org) is a JS single-page app; its real backend was
// found by driving the actual UI and capturing the resulting request
// (see resolveArmsImportTiv below) — POST
// https://atbackend.sipri.org/api/p/trades/import-export-top-csv/, no auth,
// CORS-open, confirmed returning real base64-encoded CSV data. This is a
// legitimate reverse-engineering of an otherwise-undocumented but public,
// unauthenticated endpoint of the same official SIPRI database the design
// doc names — not a different source.
//
// ---------------------------------------------------------------------------
// COVERAGE-FLOOR / CONFIDENCE REVISION #1 (air fleet dropped — see
// BACKLOG.md and the design doc's own "what changed and why" convention for
// how this is recorded there too):
//
// With air fleet dropped, there were only 4 coverage-gap components left
// (expenditure, %GDP, personnel, arms-dependency) instead of the originally
// locked 5, with a floor of >= 3 of 4. Superseded by Revision #2 below —
// arms-dependency is no longer a coverage-gap component either.
//
// ---------------------------------------------------------------------------
// COVERAGE-FLOOR / CONFIDENCE REVISION #2 (2026-08-20, explicit design
// change — arms import/export dependency demoted from scored component to
// non-scoring annotation):
//
// Component #7 (SIPRI TIV) is no longer part of the composite or the
// coverage floor. Reviewing real output exposed a directional problem this
// metric can't actually resolve on its own: the locked design inverted a
// high import volume into a LOWER score, on the theory that heavy
// importing signals vulnerability. In practice that penalized
// alliance-embedded procurement (a NATO member buying US/UK equipment reads
// as "import-dependent" the same way a genuinely exposed country does, when
// it's arguably closer to a resilience signal), and it rewarded countries
// with negligible militaries and nothing to import in the first place —
// "too small to import much" and "genuinely self-sufficient" produce the
// same high inverted score, and TIV alone can't tell them apart without
// supplier-diversity or alliance-context data this project doesn't source.
// Rather than keep a directional score whose direction doesn't reliably
// hold, it moves to the same non-scoring-annotation treatment already used
// for cereal self-sufficiency and willingness-to-fight (design doc §3.1's
// Exclusions & Annotations Log) — still real, sourced, and displayed
// (raw/year/sourceUrl), just not blended into the number. The
// `100 - normalized` inversion is removed entirely, not just skipped — there
// is no scoring math left to invert.
//
// This also supersedes Revision #1 above: coverage-gap components drop from
// 4 to 3 (expenditure, %GDP, personnel). Revised rules:
//   - Coverage floor: >= 2 of 3 present.
//   - confidence = 'measured' when all 3 of 3 are present.
//   - confidence = 'proxy' when exactly 2 of 3 are present (floor met, not
//     full coverage).
//   - confidence = 'unavailable' when fewer than 2 are present.
//   - True-zero components (nuclear, industrial base) are unaffected and
//     never count toward this floor, same as before.
//   - Every scored (measured or proxy) country's output carries
//     coveragePresent/coverageTotal (e.g. 3/3, 2/3) so a future UI can show
//     it always, not just when incomplete.
//
// ---------------------------------------------------------------------------
// WEIGHTING REVISION #3 (2026-08-20, explicit design change — expenditure
// double-weighted, not equal weighting anymore):
//
// Reviewing real output showed countries with extreme %GDP or personnel
// figures relative to their actual resource-pool size (small countries
// under heavy strain, conscription-driven personnel counts) outranking
// countries with far larger absolute military resources. Expenditure is the
// hardest-to-inflate proxy for resource-pool size among the components
// currently sourced, so its normalized value is now counted TWICE in the
// composite average instead of once — see finalizeCountry's own comment for
// exactly where. This is a documented EXCEPTION to design doc Governing
// Principle 6 ("absent a published, citable weighting framework, default to
// equal weighting"), not something that satisfies it: there's no citable
// framework behind the 2x factor, only a judgment call from reviewing real
// generated output, the same basis the arms-import-TIV demotion above used.
//
// Usage:
//   node scripts/buildMilitary.mjs --sample=15
//     Dry run: the 15-country design-phase reference set (US, China, Russia,
//     India, UK, France, Germany, Japan, Israel, Pakistan, North Korea,
//     Brazil, Poland, Luxembourg, Costa Rica). Prints full scores +
//     per-component breakdown, writes nothing.
//   npm run build:military
//     Full run: all 193 countries, writes src/data/militaryScores.ts and
//     appends a generated gap report to BACKLOG.md.
//
// Run via `node`, not `tsx` — unlike buildGovCapitalPopGdp.mjs, this script
// doesn't need to import any existing .ts source file.
import fs from 'node:fs'
import path from 'node:path'
import { feature } from 'topojson-client'
import * as XLSX from 'xlsx'
import { ALPHA3_TO_NUMERIC } from './lib/iso3166.mjs'
import { ISO3_TO_GEC } from './lib/gecCrossReference.mjs'

const COUNTRIES_SOURCE = 'public/geo/countries-un193.json'
const OUTPUT = 'src/data/militaryScores.ts'
const BACKLOG = 'BACKLOG.md'

const MILEX_XLSX = 'scripts/vendor/military/sipri-milex.xlsx'
const MILEX_URL = 'https://www.sipri.org/sites/default/files/SIPRI-Milex-data-1949-2025_v1.2.xlsx'
const TOP100_XLSX = 'scripts/vendor/military/sipri-top100.xlsx'
const TOP100_URL = 'https://www.sipri.org/sites/default/files/SIPRI-Top-100-2002-2024%20%282%29.xlsx'
const TOP100_YEAR = 2024

const WORLD_BANK_BASE = 'https://api.worldbank.org/v2/country'
const PCT_GDP_INDICATOR = 'MS.MIL.XPND.GD.ZS'
const PERSONNEL_INDICATOR = 'MS.MIL.TOTL.P1'
const WORLD_BANK_PRIMARY_YEAR = 2024
const WORLD_BANK_LOOKBACK_START_YEAR = 2000
// Same lookback floor as the World Bank resolver below, for the same reason
// (buildGovCapitalPopGdp.mjs's WORLD_BANK_LOOKBACK_START_YEAR precedent):
// comfortably covers every real gap observed (Afghanistan's most recent
// SIPRI figure is 2021, North Korea's is 2018, several sanctioned/opaque
// states go back further) without reaching so far into the past that a
// decades-stale figure gets cited as if current.
const MILEX_LOOKBACK_START_YEAR = 2000

const FACTBOOK_SNAPSHOT_DATE = '2026-01'
const FACTBOOK_TREE_URL = 'https://api.github.com/repos/factbook/factbook.json/git/trees/master?recursive=1'
const FACTBOOK_RAW_BASE = 'https://raw.githubusercontent.com/factbook/factbook.json/master'

const SIPRI_TIV_URL = 'https://atbackend.sipri.org/api/p/trades/import-export-top-csv/'
const SIPRI_TIV_YEAR = 2024

// ---------------------------------------------------------------------------
// FAS Nuclear Notebook — transcribed by hand from FAS's "Status of World
// Nuclear Forces" page (fas.org/initiative/status-world-nuclear-forces/),
// the aggregate page FAS itself maintains across all 9 nuclear-armed states
// — used instead of 9 separate per-country Nuclear Notebook articles (a
// minor, flagged deviation from "cite the specific article per country":
// the aggregate page is FAS's own up-to-date summary of those same
// per-country notebooks, still FAS, still dated, still citable). As-of
// beginning of 2026.
const FAS_SOURCE_URL = 'https://fas.org/initiative/status-world-nuclear-forces/'
const FAS_SOURCE_DATE = '2026-01'
const NUCLEAR_WARHEADS = {
  Russia: 5420,
  'United States of America': 5042,
  China: 620,
  France: 370,
  'United Kingdom': 225,
  India: 190,
  Pakistan: 170,
  Israel: 90,
  'North Korea': 60,
}

// No-standing-military override. Originally just the 3 countries the design
// doc itself named ("Costa Rica, Panama, Iceland, and similar — full list
// TBD"). Expanded 2026-08-20 using worldpopulationreview.com's "Countries
// Without a Military" table as a CANDIDATE list only — its own text
// attributes the list to the CIA World Factbook, so per the design doc's
// sourcing requirement ("primary sources... not a Wikipedia-style compiled
// list directly"), every candidate was individually re-verified against the
// actual factbook.json entry before being added, not trusted as-is:
//
//   - 14 confirmed: factbook.json's own "Military and security forces" text
//     explicitly says "no regular military forces" (or equivalent) for each.
//   - San Marino REJECTED: WPR lists it, but factbook.json names a real,
//     currently-serving military — the "San Marino Military Corps"
//     (Fortress Guard Command, Uniformed Company of the Militias, Guard of
//     the Great and General Council, Corps of the Gendarmerie). WPR is wrong
//     here; this is exactly the failure mode the re-verification step exists
//     to catch. Not added, and not just skipped silently — see BACKLOG.md.
//   - 3 deferred, not added (Solomon Islands, Marshall Islands, Kiribati):
//     each has only a police force listed in factbook.json, same as the
//     confirmed 14, but WITHOUT that source's own explicit "no regular
//     military forces" disclaimer phrase — genuinely ambiguous rather than
//     confirmed, needs a human sourcing call (e.g. checking each country's
//     constitution directly) rather than being guessed either way. See
//     BACKLOG.md.
const NO_STANDING_MILITARY = {
  'Costa Rica': {
    sourceUrl: 'https://www.wipo.int/wipolex/en/text/242245',
    sourceDate: '1949-11-07',
    note: 'Constitution of Costa Rica, Article 12: the army as a permanent institution is abolished.',
  },
  Panama: {
    sourceUrl: 'https://www.constituteproject.org/constitution/Panama_2004',
    sourceDate: '1994-10-04',
    note: 'Constitution of Panama, Title XI ("Public Force"): no army; public order and defense are the function of police/security forces only, per the 1994 constitutional reform following the 1989 dissolution of the Panama Defense Forces.',
  },
  Iceland: {
    sourceUrl: 'https://www.cia.gov/the-world-factbook/countries/iceland/',
    sourceDate: FACTBOOK_SNAPSHOT_DATE,
    note: 'CIA World Factbook (factbook.json snapshot): Iceland has no standing military; the Icelandic Coast Guard is the only armed service.',
  },
  Vanuatu: {
    sourceUrl: `${FACTBOOK_RAW_BASE}/australia-oceania/nh.json`,
    sourceDate: FACTBOOK_SNAPSHOT_DATE,
    note: 'CIA World Factbook: "no regular military forces; Vanuatu Police Force (VPF)".',
  },
  Tuvalu: {
    sourceUrl: `${FACTBOOK_RAW_BASE}/australia-oceania/tv.json`,
    sourceDate: FACTBOOK_SNAPSHOT_DATE,
    note: 'CIA World Factbook: "no regular military forces; Tuvalu Police Force".',
  },
  Palau: {
    sourceUrl: `${FACTBOOK_RAW_BASE}/australia-oceania/ps.json`,
    sourceDate: FACTBOOK_SNAPSHOT_DATE,
    note: 'CIA World Factbook: "no regular military forces; the Bureau of Public Safety... has divisions for police functions and maritime security". Defense is the responsibility of the US under the Compact of Free Association.',
  },
  Micronesia: {
    sourceUrl: `${FACTBOOK_RAW_BASE}/australia-oceania/fm.json`,
    sourceDate: FACTBOOK_SNAPSHOT_DATE,
    note: 'CIA World Factbook: "no military forces; Federated States of Micronesia National Police". Defense is the responsibility of the US under the Compact of Free Association.',
  },
  Mauritius: {
    sourceUrl: `${FACTBOOK_RAW_BASE}/africa/mp.json`,
    sourceDate: FACTBOOK_SNAPSHOT_DATE,
    note: 'CIA World Factbook: "no regular military forces; the Mauritius Police Force... includes a paramilitary unit known as the Special Mobile Force".',
  },
  Grenada: {
    sourceUrl: `${FACTBOOK_RAW_BASE}/central-america-n-caribbean/gj.json`,
    sourceDate: FACTBOOK_SNAPSHOT_DATE,
    note: 'CIA World Factbook: "no regular military forces; the Royal Grenada Police Force... includes a Coast Guard and a paramilitary Special Services Unit". Military disbanded 1983; RSS member since 1985.',
  },
  Dominica: {
    sourceUrl: `${FACTBOOK_RAW_BASE}/central-america-n-caribbean/do.json`,
    sourceDate: FACTBOOK_SNAPSHOT_DATE,
    note: 'CIA World Factbook: "no regular military forces; Commonwealth of Dominica Police Force". Military disbanded 1981; RSS member since 1982.',
  },
  'Saint Lucia': {
    sourceUrl: `${FACTBOOK_RAW_BASE}/central-america-n-caribbean/st.json`,
    sourceDate: FACTBOOK_SNAPSHOT_DATE,
    note: 'CIA World Factbook: "no regular military forces; Royal Saint Lucia Police Force". RSS member since 1982.',
  },
  'Saint Vincent and the Grenadines': {
    sourceUrl: `${FACTBOOK_RAW_BASE}/central-america-n-caribbean/vc.json`,
    sourceDate: FACTBOOK_SNAPSHOT_DATE,
    note: 'CIA World Factbook: "no regular military forces; Royal Saint Vincent and the Grenadines Police Force". RSS member since 1982.',
  },
  Samoa: {
    sourceUrl: `${FACTBOOK_RAW_BASE}/australia-oceania/ws.json`,
    sourceDate: FACTBOOK_SNAPSHOT_DATE,
    note: 'CIA World Factbook: "no regular military forces; Samoa Police Service". Informal defense ties with New Zealand under the 1962 Treaty of Friendship.',
  },
  Andorra: {
    sourceUrl: `${FACTBOOK_RAW_BASE}/europe/an.json`,
    sourceDate: FACTBOOK_SNAPSHOT_DATE,
    note: 'CIA World Factbook: "no regular military forces; Police Corps of Andorra". Defense is the responsibility of France and Spain.',
  },
  Monaco: {
    sourceUrl: `${FACTBOOK_RAW_BASE}/europe/mn.json`,
    sourceDate: FACTBOOK_SNAPSHOT_DATE,
    note: 'CIA World Factbook: "no regular military forces; Prince’s Company of Carabiniers... Police Department... Fire and Emergency Service". By treaty, France is responsible for defending Monaco’s independence and sovereignty.',
  },
  Nauru: {
    sourceUrl: `${FACTBOOK_RAW_BASE}/australia-oceania/nr.json`,
    sourceDate: FACTBOOK_SNAPSHOT_DATE,
    note: 'CIA World Factbook: "no regular military forces; Nauru Police Force".',
  },
  Liechtenstein: {
    sourceUrl: `${FACTBOOK_RAW_BASE}/europe/ls.json`,
    sourceDate: FACTBOOK_SNAPSHOT_DATE,
    note: 'CIA World Factbook: "no regular military forces; National Police of the Principality of Liechtenstein". Army abolished 1868.',
  },
}

const sampleArg = process.argv.find((a) => a.startsWith('--sample='))
const isSample = sampleArg != null
const SAMPLE_COUNTRIES = [
  'United States of America', 'China', 'Russia', 'India', 'United Kingdom', 'France', 'Germany', 'Japan',
  'Israel', 'Pakistan', 'North Korea', 'Brazil', 'Poland', 'Luxembourg', 'Costa Rica',
]

// ---------------------------------------------------------------------------
// Fetch helpers (same pattern as buildGovCapitalPopGdp.mjs)
// ---------------------------------------------------------------------------

async function fetchJson(url, opts) {
  const res = await fetch(url, opts)
  if (!res.ok) throw new Error(`${res.status} ${res.statusText}: ${url}`)
  return res.json()
}

async function fetchJsonRetry(url, opts, attempts = 2) {
  let lastErr
  for (let i = 0; i < attempts; i++) {
    try {
      return await fetchJson(url, opts)
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

async function downloadIfMissing(localPath, url) {
  if (fs.existsSync(localPath)) return
  fs.mkdirSync(path.dirname(localPath), { recursive: true })
  console.log(`Downloading ${url} -> ${localPath} ...`)
  const res = await fetch(url)
  if (!res.ok) throw new Error(`${res.status} ${res.statusText}: ${url}`)
  const buf = Buffer.from(await res.arrayBuffer())
  fs.writeFileSync(localPath, buf)
}

// ---------------------------------------------------------------------------
// Country list + id bridging (same as buildGovCapitalPopGdp.mjs)
// ---------------------------------------------------------------------------

const topology = JSON.parse(fs.readFileSync(COUNTRIES_SOURCE, 'utf8'))
const allCountries = feature(topology, topology.objects.countries)
  .features.map((f) => ({ id: String(f.id), name: f.properties.name }))
  .sort((a, b) => a.name.localeCompare(b.name))

const countries = isSample ? allCountries.filter((c) => SAMPLE_COUNTRIES.includes(c.name)) : allCountries

const NUMERIC_TO_ALPHA3 = Object.fromEntries(Object.entries(ALPHA3_TO_NUMERIC).map(([a3, num]) => [num, a3]))

// ---------------------------------------------------------------------------
// Name matching — SIPRI/FAS source names vs this project's UN-193 topology
// names are mostly identical (both plain English), but diverge for a
// well-known handful. Normalized (lowercased, diacritics stripped) exact
// match first, then this alias table, so a genuine miss (country absent
// from the source, not a naming mismatch) still surfaces as a real gap
// rather than being silently swallowed either way.
// ---------------------------------------------------------------------------

function normalizeName(name) {
  return name
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .trim()
}

const SOURCE_NAME_ALIASES = {
  'united states': 'United States of America',
  usa: 'United States of America',
  'russian federation': 'Russia',
  'korea, south': 'South Korea',
  'republic of korea': 'South Korea',
  'korea, rep.': 'South Korea',
  'korea, north': 'North Korea',
  "korea, dem. people's rep.": 'North Korea',
  'dprk (north korea)': 'North Korea',
  'iran, islamic rep.': 'Iran',
  'egypt, arab rep.': 'Egypt',
  'czech republic': 'Czechia',
  myanmar: 'Myanmar',
  burma: 'Myanmar',
  'congo, dem. rep.': 'Democratic Republic of the Congo',
  'dr congo': 'Democratic Republic of the Congo',
  'congo, dr': 'Democratic Republic of the Congo',
  'congo, rep.': 'Congo',
  'congo, republic': 'Congo',
  'congo (brazzaville)': 'Congo',
  'congo (kinshasa)': 'Democratic Republic of the Congo',
  macedonia: 'North Macedonia',
  swaziland: 'Eswatini',
  'cape verde': 'Cabo Verde',
  'east timor': 'Timor-Leste',
  'timor leste': 'Timor-Leste',
  'kyrgyz republic': 'Kyrgyzstan',
  turkiye: 'Turkey',
  turkey: 'Turkey',
  "cote d'ivoire": "Côte d'Ivoire",
  "ivory coast": "Côte d'Ivoire",
  'lao pdr': 'Laos',
  'lao p.d.r.': 'Laos',
  'viet nam': 'Vietnam',
  'slovak republic': 'Slovakia',
  'brunei darussalam': 'Brunei',
  'syrian arab republic': 'Syria',
  'venezuela, rb': 'Venezuela',
  'venezuela (bolivarian republic of)': 'Venezuela',
  'yemen, rep.': 'Yemen',
  'bahamas, the': 'Bahamas',
  'the bahamas': 'Bahamas',
  'gambia, the': 'Gambia',
  'the gambia': 'Gambia',
  'micronesia, fed. sts.': 'Micronesia',
  'st. lucia': 'Saint Lucia',
  'st. vincent and the grenadines': 'Saint Vincent and the Grenadines',
  'st. kitts and nevis': 'Saint Kitts and Nevis',
  'united kingdom of great britain and northern ireland': 'United Kingdom',
  'uk': 'United Kingdom',
  'bolivia (plurinational state of)': 'Bolivia',
  'tanzania': 'Tanzania',
  'united republic of tanzania': 'Tanzania',
  'moldova, rep.': 'Moldova',
  'republic of moldova': 'Moldova',
  'uae': 'United Arab Emirates',
  'cabo verde': 'Cabo Verde',
}

const NAME_LOOKUP = new Map(allCountries.map((c) => [normalizeName(c.name), c.name]))
for (const [alias, canonical] of Object.entries(SOURCE_NAME_ALIASES)) {
  if (NAME_LOOKUP.has(normalizeName(canonical))) NAME_LOOKUP.set(normalizeName(alias), canonical)
}

function matchCountryName(sourceName) {
  return NAME_LOOKUP.get(normalizeName(sourceName)) ?? null
}

// ---------------------------------------------------------------------------
// Gap log
// ---------------------------------------------------------------------------
const gaps = []
function logGap(country, field, reason) {
  gaps.push({ country, field, reason })
}
const unmatchedSourceNames = { expenditure: new Set(), industrialBase: new Set(), armsImportTiv: new Set() }

// ---------------------------------------------------------------------------
// Component 1: Military expenditure ($) — SIPRI Milex xlsx, "Current US$"
// sheet. Primary year 2025 with a lookback to 2024/2023 for stragglers,
// same "most recent available, explicitly dated" pattern as
// buildGovCapitalPopGdp.mjs's World Bank resolver.
// ---------------------------------------------------------------------------
function readWorkbook(localPath) {
  return XLSX.read(fs.readFileSync(localPath), { type: 'buffer' })
}

// Scans every year from the most recent (2025) back to
// MILEX_LOOKBACK_START_YEAR (2000) and takes the first real numeric value
// found per country, same "most recent available, explicitly dated — never
// silently backfilled as current" pattern as buildGovCapitalPopGdp.mjs's
// World Bank resolver. A narrower fixed window (originally just
// 2025/2024/2023) missed real, genuinely-reported data for countries whose
// latest figure is older — confirmed for Afghanistan (2021) and North Korea
// (2018) — which is not the same thing as SIPRI having no data for them at
// all.
function loadExpenditureMap() {
  const wb = readWorkbook(MILEX_XLSX)
  const ws = wb.Sheets['Current US$']
  const rows = XLSX.utils.sheet_to_json(ws, { header: 1, raw: true, defval: null })
  const header = rows[5]
  const yearCols = header
    .map((year, idx) => ({ year, idx }))
    .filter(({ year }) => typeof year === 'number' && year <= 2025 && year >= MILEX_LOOKBACK_START_YEAR)
    .sort((a, b) => b.year - a.year) // most recent first

  const map = new Map()
  for (const row of rows.slice(6)) {
    if (!row || row[0] == null) continue
    const isDataRow = yearCols.some(({ idx }) => row[idx] != null)
    if (!isDataRow) continue // region-header row (e.g. "Africa"), not a country
    const canonical = matchCountryName(row[0])
    if (!canonical) {
      unmatchedSourceNames.expenditure.add(row[0])
      continue
    }
    for (const { year, idx } of yearCols) {
      if (typeof row[idx] === 'number') {
        map.set(canonical, { value: row[idx], year })
        break
      }
    }
  }
  return map
}

// ---------------------------------------------------------------------------
// Component 6: Defense-industrial base — SIPRI Top 100 xlsx, most recent
// year sheet. Sum "Arms revenues (<year>)" grouped by "Country" (HQ), not
// company count — locked design decision. True-zero: every country not
// present gets 0, not missing.
// ---------------------------------------------------------------------------
function loadIndustrialBaseMap() {
  const wb = readWorkbook(TOP100_XLSX)
  const ws = wb.Sheets[String(TOP100_YEAR)]
  const rows = XLSX.utils.sheet_to_json(ws, { header: 1, raw: true, defval: null })
  const header = rows[3]
  const countryIdx = header.indexOf('Country (d)')
  const revenueIdx = header.findIndex((h) => typeof h === 'string' && h.startsWith(`Arms revenues (${TOP100_YEAR})`))

  const map = new Map()
  for (const row of rows.slice(4)) {
    if (!row || row[countryIdx] == null) continue
    const revenue = row[revenueIdx]
    if (typeof revenue !== 'number') continue
    const canonical = matchCountryName(row[countryIdx])
    if (!canonical) {
      unmatchedSourceNames.industrialBase.add(row[countryIdx])
      continue
    }
    map.set(canonical, (map.get(canonical) ?? 0) + revenue)
  }
  return map
}

// ---------------------------------------------------------------------------
// Component 7: Arms import dependency (TIV) — SIPRI Arms Transfers
// Database's live backend, reverse-engineered (see header comment). Import
// perspective (not export) per the locked spec: "Extract per-country import
// TIV totals as the dependency figure."
// ---------------------------------------------------------------------------
async function loadArmsImportTivMap() {
  const body = {
    filters: [
      { field: 'Include top', oldField: '', condition: 'contains', value1: 300, value2: '', listData: [] },
      {
        field: 'Year range 1',
        oldField: '',
        condition: 'contains',
        value1: SIPRI_TIV_YEAR,
        value2: SIPRI_TIV_YEAR,
        listData: [],
      },
      { field: 'Status', oldField: '', condition: '', value1: '0', value2: '', listData: [] },
      { field: 'Main Suppliers', oldField: '', condition: '', value1: 0, value2: '', listData: [] },
      { field: 'PercentChange', oldField: '', condition: '', value1: false, value2: '', listData: [] },
      { field: 'MovingAverage', oldField: '', condition: '', value1: false, value2: '', listData: [] },
    ],
    logic: 'AND',
  }
  const json = await fetchJsonRetry(SIPRI_TIV_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  const csv = Buffer.from(json.bytes, 'base64').toString('utf8')
  const lines = csv.split('\n').map((l) => l.trim()).filter(Boolean)

  const map = new Map()
  for (const line of lines) {
    const cols = line.split(',')
    // Data rows look like: ,<rank>,,<Recipient>,<value>,<value2>,<share>,...
    const rank = cols[1]
    const recipient = cols[3]
    const value = Number(cols[4])
    if (!rank || !recipient || Number.isNaN(value)) continue
    if (recipient === 'Others' || recipient === 'Total' || recipient === 'Recipient') continue
    const canonical = matchCountryName(recipient)
    if (!canonical) {
      // Expected for non-state entities SIPRI includes (UN, rebel groups,
      // marked with * / ** in its own data) — not logged as a gap, since
      // there's no real country being missed here.
      unmatchedSourceNames.armsImportTiv.add(recipient)
      continue
    }
    map.set(canonical, { value, year: SIPRI_TIV_YEAR })
  }
  return map
}

// ---------------------------------------------------------------------------
// TAIWAN (added alongside a direct request to also recognize Taiwan across
// the Intelligence Engine's analytics — see CLAUDE.md). Unlike Economy's
// Taiwan one-off, which needed a wholly different source (IMF WEO) because
// WDI structurally excludes it, Military's own primary sources — SIPRI's
// Milex and Top 100 databases — include Taiwan DIRECTLY: verified by
// reading the vendored xlsx files themselves (scripts/vendor/military/) and
// confirming a real "Taiwan" row exists in the "Current US$", "Share of
// GDP", and Top 100 sheets, the exact same files every other country's
// figures already come from. Only personnel needs a different path (WDI's
// MS.MIL.TOTL.P1 has no Taiwan entry, same structural exclusion as
// everywhere else in this project) — CIA Factbook directly, the same
// fallback source (not a different one) every other country already falls
// back to once WDI comes up empty for personnel specifically.
// ---------------------------------------------------------------------------
const TAIWAN_FACTBOOK_PATH = 'east-n-southeast-asia/tw.json'

// Bypasses matchCountryName/NAME_LOOKUP entirely (built only from the
// 193-country topology, which doesn't include Taiwan) — matches the raw
// source row by its literal name instead. Same year-column-scanning logic
// as loadExpenditureMap's per-row loop, generalized to any sheet/name pair
// so it covers both the "Current US$" and "Share of GDP" sheets without
// duplicating the scan logic twice.
function findYearSeriesForLiteralName(xlsxPath, sheetName, literalName) {
  const wb = readWorkbook(xlsxPath)
  const ws = wb.Sheets[sheetName]
  const rows = XLSX.utils.sheet_to_json(ws, { header: 1, raw: true, defval: null })
  const header = rows[5]
  const yearCols = header
    .map((year, idx) => ({ year, idx }))
    .filter(({ year }) => typeof year === 'number' && year <= 2025 && year >= MILEX_LOOKBACK_START_YEAR)
    .sort((a, b) => b.year - a.year)
  const row = rows.slice(6).find((r) => r && r[0] === literalName)
  if (!row) return null
  for (const { year, idx } of yearCols) {
    if (typeof row[idx] === 'number') return { value: row[idx], year }
  }
  return null
}

async function buildTaiwanScore() {
  const expenditure = findYearSeriesForLiteralName(MILEX_XLSX, 'Current US$', 'Taiwan')
  // SIPRI's own "Share of GDP" sheet stores a fraction (0.021 = 2.1%), not
  // already a percentage — verified directly against the USA's own row in
  // the same sheet (0.0329 in 2023, matching WDI's independently-sourced
  // ~3.4% for the USA in a nearby year) before trusting the ×100 conversion.
  const pctGdpRaw = findYearSeriesForLiteralName(MILEX_XLSX, 'Share of GDP', 'Taiwan')
  const pctGdp = pctGdpRaw ? { value: pctGdpRaw.value * 100, year: pctGdpRaw.year } : { value: undefined, year: undefined }

  // Industrial base: NCSIST (Taiwan's state defense R&D institute) appears
  // in SIPRI's own Top 100 (2024, rank 50) — same file, same "Arms revenues
  // (<year>)" column every other country's figure is summed from.
  const wbTop100 = readWorkbook(TOP100_XLSX)
  const wsTop100 = wbTop100.Sheets[String(TOP100_YEAR)]
  const rowsTop100 = XLSX.utils.sheet_to_json(wsTop100, { header: 1, raw: true, defval: null })
  const headerTop100 = rowsTop100[3]
  const countryIdxTop100 = headerTop100.indexOf('Country (d)')
  const revenueIdxTop100 = headerTop100.findIndex((h) => typeof h === 'string' && h.startsWith(`Arms revenues (${TOP100_YEAR})`))
  let industrialBase = 0
  for (const row of rowsTop100.slice(4)) {
    if (row && row[countryIdxTop100] === 'Taiwan' && typeof row[revenueIdxTop100] === 'number') industrialBase += row[revenueIdxTop100]
  }

  // Personnel: CIA World Factbook directly (WDI has no Taiwan entry at all,
  // same structural exclusion as everywhere else) — the same fallback
  // source (not a different one) resolvePersonnel already uses once WDI
  // comes back empty for any other country.
  let personnel = { value: undefined, year: undefined }
  try {
    const doc = await fetchJsonRetry(`${FACTBOOK_RAW_BASE}/${TAIWAN_FACTBOOK_PATH}`)
    const text = doc['Military and Security']?.['Military and security service personnel strengths']?.text
    const value = text ? parsePersonnelFigure(text) : null
    if (value != null) personnel = { value, year: undefined, source: 'CIA Factbook archive', factbookText: text }
    else logGap('Taiwan', 'personnel', `factbook.json personnel text unparseable/absent ("${text}") — left unscored.`)
  } catch (err) {
    logGap('Taiwan', 'personnel', `factbook.json fetch failed (${err.message}) — left unscored.`)
  }

  if (expenditure == null) logGap('Taiwan', 'expenditure', 'Not present in SIPRI Milex xlsx — left unscored.')
  if (pctGdp.value == null) logGap('Taiwan', '%GDP', 'Not present in SIPRI Milex "Share of GDP" sheet — left unscored.')

  return {
    id: 'taiwan',
    name: 'Taiwan',
    alpha3: undefined,
    coveragePresent: [expenditure?.value, pctGdp.value, personnel.value].filter((v) => v != null).length,
    coverageTotal: 3,
    raw: {
      expenditure,
      pctGdp,
      personnel,
      industrialBase,
      // True-zero — Taiwan is not among FAS's 9 nuclear-armed states (same
      // default every other non-nuclear country already gets).
      nuclearWarheads: 0,
    },
    // Arms-import TIV not independently researched for Taiwan — left as a
    // genuine, logged gap rather than guessed; it's a non-scoring
    // annotation only (see COVERAGE-FLOOR / CONFIDENCE REVISION #2 above),
    // so this has no effect on Taiwan's actual composite score.
    annotations: {
      armsImportTiv: { raw: null, year: undefined, sourceUrl: 'https://armstransfers.sipri.org/ArmsTransfer/ImportExportTop' },
    },
  }
}

// ---------------------------------------------------------------------------
// Component 2: Defense spending, % GDP — World Bank WDI, same
// range-query + explicit-year pattern as buildGovCapitalPopGdp.mjs.
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
// Component 3: Military personnel (active) — WDI first (MS.MIL.TOTL.P1 has
// gone largely stale/null for recent years across most countries — expected,
// per the design doc), falling back to the CIA Factbook archive's
// descriptive "Military and security service personnel strengths" text,
// e.g. "estimated 450,000 active Armed Forces (2025)" — extract the first
// number, tagged with the Factbook snapshot date rather than a real WDI
// year. Ambiguous/unparseable text is a logged gap, not a guess.
// ---------------------------------------------------------------------------
function parsePersonnelFigure(text) {
  const m = text.match(/([\d,]{4,})/)
  if (!m) return null
  const n = Number(m[1].replace(/,/g, ''))
  return Number.isFinite(n) && n > 0 ? n : null
}

async function resolvePersonnel(country, alpha3, factbookPathByGec) {
  const wdi = await resolveWorldBankIndicator(alpha3, PERSONNEL_INDICATOR)
  if (wdi.value != null) return { value: wdi.value, year: wdi.year, source: 'World Bank WDI' }

  const gec = alpha3 ? ISO3_TO_GEC[alpha3] : undefined
  const path = gec ? factbookPathByGec[gec.toLowerCase()] : undefined
  if (!path) {
    logGap(country.name, 'personnel', 'No WDI value and no factbook.json path resolved — left unscored.')
    return { value: undefined, year: undefined }
  }
  let doc
  try {
    doc = await fetchJsonRetry(`${FACTBOOK_RAW_BASE}/${path}`)
  } catch (err) {
    logGap(country.name, 'personnel', `factbook.json fetch failed (${err.message}) — left unscored.`)
    return { value: undefined, year: undefined }
  }
  const text = doc['Military and Security']?.['Military and security service personnel strengths']?.text
  if (!text) {
    logGap(country.name, 'personnel', 'No WDI value and no factbook.json personnel-strengths text — left unscored.')
    return { value: undefined, year: undefined }
  }
  const value = parsePersonnelFigure(text)
  if (value == null) {
    logGap(country.name, 'personnel', `factbook.json personnel text unparseable ("${text}") — left unscored.`)
    return { value: undefined, year: undefined }
  }
  return { value, year: undefined, source: 'CIA Factbook archive', factbookText: text }
}

// ---------------------------------------------------------------------------
// Normalization: log-min-max, per component, across countries with a real
// value for that component. epsilon = 1% of the smallest nonzero observed
// value in that component's own dataset.
// ---------------------------------------------------------------------------
function buildNormalizer(values) {
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

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

console.log(`Building Military scores for ${countries.length} ${isSample ? 'sample' : ''} countries...`)

await downloadIfMissing(MILEX_XLSX, MILEX_URL)
await downloadIfMissing(TOP100_XLSX, TOP100_URL)

console.log('Loading SIPRI expenditure + industrial-base xlsx files...')
const expenditureMap = loadExpenditureMap()
const industrialBaseMap = loadIndustrialBaseMap()

console.log('Fetching SIPRI arms-transfer TIV data (live)...')
const armsImportTivMap = await loadArmsImportTivMap()

console.log('Fetching factbook.json file tree (for personnel fallback)...')
const tree = await fetchJsonRetry(FACTBOOK_TREE_URL)
const gecLowerToPath = {}
for (const entry of tree.tree) {
  const m = entry.path.match(/^([a-z0-9-]+)\/([a-z]{2})\.json$/)
  if (m) gecLowerToPath[m[2]] = entry.path
}

// Non-scoring annotation for every country, confirmed no-military or not —
// see COVERAGE-FLOOR / CONFIDENCE REVISION #2 above. Real sourced data, not
// forced to 0 even for a no-standing-military country: the override zeroes
// out SCORED components only, and this isn't one anymore.
function buildArmsImportAnnotation(country) {
  const armsImportTiv = armsImportTivMap.get(country.name)
  return {
    raw: armsImportTiv?.value ?? null,
    year: armsImportTiv?.year,
    sourceUrl: 'https://armstransfers.sipri.org/ArmsTransfer/ImportExportTop',
  }
}

async function buildCountryScore(country) {
  const alpha3 = NUMERIC_TO_ALPHA3[country.id]
  const annotations = { armsImportTiv: buildArmsImportAnnotation(country) }

  if (NO_STANDING_MILITARY[country.name]) {
    const override = NO_STANDING_MILITARY[country.name]
    const zeroComponent = { raw: 0, normalized: 0, sourceUrl: override.sourceUrl, sourceDate: override.sourceDate }
    return {
      id: country.id,
      name: country.name,
      value: 0,
      confidence: 'measured',
      confirmed: true,
      confirmedNote: override.note,
      coveragePresent: 3,
      coverageTotal: 3,
      components: {
        expenditureUsd: zeroComponent,
        pctGdp: zeroComponent,
        personnel: zeroComponent,
        nuclearWarheads: zeroComponent,
        industrialBaseRevenueUsdM: zeroComponent,
      },
      annotations,
    }
  }

  const expenditure = expenditureMap.get(country.name)
  const industrialBase = industrialBaseMap.get(country.name) ?? 0 // true-zero
  const nuclearWarheads = NUCLEAR_WARHEADS[country.name] ?? 0 // true-zero

  let pctGdp = { value: undefined, year: undefined }
  let personnel = { value: undefined, year: undefined }
  if (alpha3) {
    ;[pctGdp, personnel] = await Promise.all([
      resolveWorldBankIndicator(alpha3, PCT_GDP_INDICATOR),
      resolvePersonnel(country, alpha3, gecLowerToPath),
    ])
    if (pctGdp.value == null) logGap(country.name, '%GDP', `World Bank has no ${PCT_GDP_INDICATOR} value for ${alpha3} in range — left unscored.`)
  } else {
    logGap(country.name, '%GDP + personnel', 'No ISO alpha-3 code resolved — left unscored.')
  }
  if (expenditure == null) logGap(country.name, 'expenditure', 'Not present in SIPRI Milex xlsx (name unmatched or genuinely absent) — left unscored.')

  const coverageGapValues = [expenditure?.value, pctGdp.value, personnel.value]
  const coveragePresent = coverageGapValues.filter((v) => v != null).length

  return {
    id: country.id,
    name: country.name,
    alpha3,
    coveragePresent,
    coverageTotal: 3,
    raw: {
      expenditure,
      pctGdp,
      personnel,
      industrialBase,
      nuclearWarheads,
    },
    annotations,
  }
}

const built = await mapWithConcurrency(countries, 8, buildCountryScore)

built.push(await buildTaiwanScore())
console.log('Added Taiwan (SIPRI Milex/Top 100-sourced directly, personnel via CIA Factbook — see TAIWAN header comment).')

// The no-standing-military overrides are already fully resolved; only the
// rest need cross-country normalization before a composite exists.
const pending = built.filter((r) => !r.confirmed)

const normalizeExpenditure = buildNormalizer(pending.map((r) => r.raw.expenditure?.value))
const normalizePctGdp = buildNormalizer(pending.map((r) => r.raw.pctGdp.value))
const normalizePersonnel = buildNormalizer(pending.map((r) => r.raw.personnel.value))
const normalizeNuclear = buildNormalizer(pending.map((r) => r.raw.nuclearWarheads))
const normalizeIndustrialBase = buildNormalizer(pending.map((r) => r.raw.industrialBase))

function finalizeCountry(r) {
  if (r.confirmed) return r

  const expenditureNorm = normalizeExpenditure(r.raw.expenditure?.value ?? null)
  const pctGdpNorm = normalizePctGdp(r.raw.pctGdp.value ?? null)
  const personnelNorm = normalizePersonnel(r.raw.personnel.value ?? null)
  const nuclearNorm = normalizeNuclear(r.raw.nuclearWarheads)
  const industrialBaseNorm = normalizeIndustrialBase(r.raw.industrialBase)

  const components = {
    expenditureUsd: {
      raw: r.raw.expenditure?.value ?? null,
      normalized: expenditureNorm,
      year: r.raw.expenditure?.year,
      sourceUrl: MILEX_URL,
    },
    pctGdp: {
      raw: r.raw.pctGdp.value ?? null,
      normalized: pctGdpNorm,
      year: r.raw.pctGdp.year,
      // Taiwan's %GDP comes from SIPRI's own "Share of GDP" sheet, not
      // World Bank WDI (which has no Taiwan entry at all) — see this
      // script's TAIWAN header comment.
      sourceUrl: r.id === 'taiwan' ? MILEX_URL : `${WORLD_BANK_BASE}/${r.alpha3}/indicator/${PCT_GDP_INDICATOR}`,
    },
    personnel: {
      raw: r.raw.personnel.value ?? null,
      normalized: personnelNorm,
      year: r.raw.personnel.year,
      sourceUrl: r.raw.personnel.source === 'CIA Factbook archive' ? `${FACTBOOK_RAW_BASE}` : `${WORLD_BANK_BASE}/${r.alpha3}/indicator/${PERSONNEL_INDICATOR}`,
    },
    nuclearWarheads: {
      raw: r.raw.nuclearWarheads,
      normalized: nuclearNorm,
      sourceDate: FAS_SOURCE_DATE,
      sourceUrl: FAS_SOURCE_URL,
    },
    industrialBaseRevenueUsdM: {
      raw: r.raw.industrialBase,
      normalized: industrialBaseNorm,
      year: TOP100_YEAR,
      sourceUrl: TOP100_URL,
    },
  }

  // Equal weighting over whichever components have a real value: true-zero
  // components (nuclear, industrial base) always included; coverage-gap
  // components only where present. Arms-import TIV is no longer part of
  // this — see COVERAGE-FLOOR / CONFIDENCE REVISION #2 above.
  //
  // WEIGHTING REVISION #3 (2026-08-20, explicit design change — expenditure
  // double-weighted): expenditureNorm is listed twice below, deliberately —
  // not a bug. Real output showed countries with extreme %GDP or
  // personnel figures relative to their actual resource-pool size
  // (small countries under heavy strain, conscription-driven personnel
  // counts) outranking countries with far larger absolute military
  // resources; expenditure is the hardest-to-inflate proxy for resource-pool
  // size among the components currently sourced, so its normalized value now
  // counts twice in the average instead of once. This is a documented
  // EXCEPTION to Governing Principle 6 (design doc §2: "absent a published,
  // citable weighting framework, default to equal weighting"), not
  // something that satisfies it — there is no citable framework behind the
  // 2x factor, only a judgment call made after reviewing real generated
  // output, the same way the arms-import-TIV demotion above was. See the
  // design doc's §3.1 Weighting section for the full reasoning trail.
  // Applies identically at 'measured' or 'proxy' tier; if expenditure itself
  // is the missing value, both copies are filtered out below — never a
  // partial/half weight.
  const includedNormalized = [expenditureNorm, expenditureNorm, pctGdpNorm, personnelNorm, nuclearNorm, industrialBaseNorm].filter(
    (v) => v != null
  )
  const value = r.coveragePresent >= 2 ? includedNormalized.reduce((a, b) => a + b, 0) / includedNormalized.length : null

  const confidence = r.coveragePresent === 3 ? 'measured' : r.coveragePresent === 2 ? 'proxy' : 'unavailable'

  return {
    id: r.id,
    name: r.name,
    value: value == null ? null : Math.round(value * 10) / 10,
    confidence,
    coveragePresent: r.coveragePresent,
    coverageTotal: 3,
    components,
    annotations: r.annotations,
  }
}

const finalScores = built.map(finalizeCountry)

// ---------------------------------------------------------------------------
// Output
// ---------------------------------------------------------------------------

if (isSample) {
  for (const s of finalScores) console.log(JSON.stringify(s, null, 2))
  console.log(`\nSample run only — wrote nothing.`)
  console.log(`Confidence breakdown: measured=${finalScores.filter((s) => s.confidence === 'measured').length}, proxy=${finalScores.filter((s) => s.confidence === 'proxy').length}, unavailable=${finalScores.filter((s) => s.confidence === 'unavailable').length}`)
  console.log(`${gaps.length} gap(s) logged:`)
  for (const g of gaps) console.log(`  - [${g.country}] ${g.field}: ${g.reason}`)
  for (const [component, names] of Object.entries(unmatchedSourceNames)) {
    if (names.size > 0) console.log(`Unmatched source names for ${component}: ${[...names].join(', ')}`)
  }
  process.exit(0)
}

function tsComponent(c) {
  const fields = [`raw: ${c.raw === null ? 'null' : c.raw}`, `normalized: ${c.normalized === null ? 'null' : c.normalized}`]
  if (c.year != null) fields.push(`year: ${c.year}`)
  if (c.sourceUrl) fields.push(`sourceUrl: ${JSON.stringify(c.sourceUrl)}`)
  if (c.sourceDate) fields.push(`sourceDate: ${JSON.stringify(c.sourceDate)}`)
  return `{ ${fields.join(', ')} }`
}

function tsAnnotation(a) {
  const fields = [`raw: ${a.raw === null ? 'null' : a.raw}`]
  if (a.year != null) fields.push(`year: ${a.year}`)
  if (a.sourceUrl) fields.push(`sourceUrl: ${JSON.stringify(a.sourceUrl)}`)
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
  if (s.confirmed) {
    lines.push(`    confirmed: true,`)
    lines.push(`    confirmedNote: ${JSON.stringify(s.confirmedNote)},`)
  }
  lines.push(`    components: {`)
  for (const [key, c] of Object.entries(s.components)) {
    lines.push(`      ${key}: ${tsComponent(c)},`)
  }
  lines.push(`    },`)
  lines.push(`    annotations: {`)
  for (const [key, a] of Object.entries(s.annotations)) {
    lines.push(`      ${key}: ${tsAnnotation(a)},`)
  }
  lines.push(`    },`)
  lines.push(`  },`)
  return lines.join('\n')
}

const header = `// Military category scores for the Intelligence Engine, generated by
// scripts/buildMilitary.mjs (\`npm run build:military\`) per the locked design
// in Intelligence Docs/intelligence-engine-scoring-design.md §3.1.
//
// 5 of the originally-locked 7 components are SCORED — Air fleet size
// (FlightGlobal) is backlogged (paid subscription paywall, no equivalent
// free citable source found), and arms import/export dependency (SIPRI TIV)
// was demoted 2026-08-20 from a scored component to a non-scoring
// annotation (see this script's own header comment, "REVISION #2" — the
// directional assumption that low import volume signals resilience doesn't
// reliably hold once alliance-embedded procurement and simply-too-small-to-
// import countries are both in the data). TIV is still sourced and shown,
// under \`annotations\`, just not blended into \`value\`.
//
// Coverage floor is >= 2 of 3 coverage-gap components (expenditure, %GDP,
// personnel); confidence is 'measured' at 3/3, 'proxy' at 2/3, 'unavailable'
// below that. True-zero components (nuclear warheads, defense-industrial
// base) never count toward this floor.
//
// Keyed by the SAME numeric ISO topology id scene/useCountryFeatures.ts
// registers Country records under (String(feature.id) from
// countries-un193.json) — same convention as src/data/countryEconomics.ts —
// EXCEPT Taiwan, keyed by its GeoEntity registry id ('taiwan') instead, the
// same exception src/data/economyScores.ts already established. Unlike
// Economy's Taiwan one-off, Military's own primary sources (SIPRI Milex,
// SIPRI Top 100) include Taiwan directly — only personnel needed a
// different path (CIA Factbook, the same fallback every other country
// already uses once WDI comes up empty for personnel specifically). See
// this script's own TAIWAN header comment for the full sourcing.
//
// Re-run the build script (rather than hand-editing this file) to refresh.

export type MilitaryConfidence = 'measured' | 'proxy' | 'unavailable'

export interface MilitaryComponentValue {
  raw: number | null
  /** 0-100 log-min-max normalized value. null iff raw is null. */
  normalized: number | null
  year?: number
  sourceDate?: string
  sourceUrl?: string
}

// A real, sourced value that is displayed but NOT part of the composite —
// see MilitaryScore.annotations.
export interface MilitaryAnnotationValue {
  raw: number | null
  year?: number
  sourceUrl?: string
}

export interface MilitaryScore {
  name: string
  /** 0-100 composite, null iff confidence is 'unavailable'. */
  value: number | null
  confidence: MilitaryConfidence
  /** How many of the 3 coverage-gap components have a real value for this country (0-3). */
  coveragePresent: number
  coverageTotal: number
  /** true only for a confirmed no-standing-military country — see confirmedNote. */
  confirmed?: boolean
  confirmedNote?: string
  components: {
    expenditureUsd: MilitaryComponentValue
    pctGdp: MilitaryComponentValue
    personnel: MilitaryComponentValue
    nuclearWarheads: MilitaryComponentValue
    industrialBaseRevenueUsdM: MilitaryComponentValue
  }
  /** Sourced context that doesn't feed the score — see this file's header comment. */
  annotations: {
    armsImportTiv: MilitaryAnnotationValue
  }
}

// Keyed by numeric ISO topology id (e.g. "840" for the United States).
export const MILITARY_SCORES: Record<string, MilitaryScore> = {
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
// Per-component coverage report — printed always; this becomes the coverage
// numbers cited in the Intelligence Engine's public methodology write-up.
// ---------------------------------------------------------------------------
function countPresent(getter) {
  return finalScores.filter((s) => !s.confirmed && getter(s.components) != null).length
}
console.log('Per-component coverage (scored; real, sourced value; excludes no-standing-military overrides):')
console.log(`  expenditureUsd: ${countPresent((c) => c.expenditureUsd.raw)}`)
console.log(`  pctGdp: ${countPresent((c) => c.pctGdp.raw)}`)
console.log(`  personnel: ${countPresent((c) => c.personnel.raw)}`)
console.log(`  nuclearWarheads (true-zero, always present): ${finalScores.length}`)
console.log(`  industrialBaseRevenueUsdM (true-zero, always present): ${finalScores.length}`)
console.log(
  `Annotations (not scored): armsImportTiv present for ${finalScores.filter((s) => s.annotations.armsImportTiv.raw != null).length} of ${finalScores.length} countries`
)

// ---------------------------------------------------------------------------
// BACKLOG.md — same marker-delimited idempotent append pattern as
// buildGovCapitalPopGdp.mjs.
// ---------------------------------------------------------------------------
function writeBacklogReport() {
  const BEGIN = '<!-- BEGIN buildMilitary.mjs gap report -->'
  const END = '<!-- END buildMilitary.mjs gap report -->'
  const generatedAt = new Date().toISOString().slice(0, 10)

  const lines = []
  lines.push(BEGIN)
  lines.push('')
  lines.push(
    `**Generated by \`npm run build:military\` (\`scripts/buildMilitary.mjs\`), ${generatedAt}.** ` +
      `Military category coverage-gap fields (expenditure/%GDP/personnel) that couldn't be sourced cleanly this ` +
      `run — left unscored, not guessed. Re-running the script regenerates this list.`
  )
  lines.push('')
  lines.push(
    `**Standing deviations from the locked design** (see scripts/buildMilitary.mjs's own header comment for ` +
      `the full reasoning): Air fleet size (component #5, FlightGlobal) is not implemented — the source is a paid ` +
      `subscription paywall with no free/citable equivalent found. Arms import/export dependency (component #7, ` +
      `SIPRI TIV) was demoted 2026-08-20 from a scored component to a non-scoring annotation — the ` +
      `\`100 - normalized\` inversion assumed low import volume signals resilience, but that direction doesn't ` +
      `reliably hold once alliance-embedded procurement (reads as "import-dependent" the same as genuine ` +
      `exposure) and too-small-to-import micro-states (score identically to genuinely self-sufficient ones) are ` +
      `both in the data, and this project doesn't source the supplier-diversity/alliance-context data that would ` +
      `be needed to tell them apart. Still sourced and displayed (see \`annotations.armsImportTiv\` in ` +
      `src/data/militaryScores.ts), just not blended into \`value\`. Coverage floor/confidence tiers were revised ` +
      `to 3 coverage-gap components (>= 2 of 3 present) accordingly.`
  )
  lines.push('')
  lines.push(
    `**No-standing-military override list** (see \`NO_STANDING_MILITARY\` in scripts/buildMilitary.mjs): expanded ` +
      `2026-08-20 from the original 3 (Costa Rica, Panama, Iceland) to 17, using worldpopulationreview.com's ` +
      `"Countries Without a Military" table as a candidate list only — each candidate was individually ` +
      `re-verified against factbook.json before being added, per the design doc's sourcing requirement. Two ` +
      `findings from that verification pass, kept here rather than silently resolved: **San Marino** appears on ` +
      `WPR's list but was REJECTED — factbook.json names a real, currently-serving military (the "San Marino ` +
      `Military Corps"), so WPR is wrong about it. **Solomon Islands, Marshall Islands, and Kiribati** are ` +
      `DEFERRED, not added — factbook.json lists only a police force for each (same shape as the 17 confirmed ` +
      `countries) but without that source's own explicit "no regular military forces" disclaimer phrase, so this ` +
      `is a genuine ambiguity needing a human sourcing call (e.g. checking each country's constitution directly), ` +
      `not a guess in either direction.`
  )
  lines.push('')
  if (gaps.length === 0) {
    lines.push('- None this run — every sourceable field for every country resolved cleanly.')
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
    const heading = '\n## Data sourcing (`buildMilitary.mjs`)\n\n'
    const introEnd = backlog.indexOf('\n## ')
    updated = introEnd === -1 ? backlog + heading + section + '\n' : backlog.slice(0, introEnd) + heading + section + '\n' + backlog.slice(introEnd)
  }
  fs.writeFileSync(BACKLOG, updated)
  console.log(`Updated ${BACKLOG}: ${gaps.length} gap(s) logged.`)
}

writeBacklogReport()
