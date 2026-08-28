// Report-only generator: population + GDP for every registered GeoEntity of
// type 'territory' or 'geopolitical-entity' that has a resident population —
// sourced from the World Bank's World Development Indicators (WDI) API,
// the same live source scripts/buildGovCapitalPopGdp.mjs uses for UN member
// states (NY.GDP.MKTP.CD, SP.POP.TOTL), queried the same way: over a
// lookback range rather than a single year, with the actual year used always
// recorded (see resolveWorldBankIndicator below).
//
// Unlike buildGovCapitalPopGdp.mjs, this script does NOT write into any
// source-of-truth file. src/data/registry/geoEntities.ts is a hand-curated
// dataset — every entry there also carries relationship data (parent/
// administeredBy/claimedBy/claims) that no API models, so auto-generating
// entries the way countryEconomics.ts is auto-generated would either
// silently drop that hand-curated context on every re-run or require this
// script to somehow merge into it non-destructively. Simpler and safer:
// this script only produces a report (console + a JSON file); a human reads
// the report and edits geoEntities.ts by hand, the same way every other
// field in that file already is.
//
// Sourcing rule: WDI is the ONLY source this script uses. If WDI has no
// entry for an entity's code, that entity is reported as NO DATA — this
// script does not fall back to a second data source for anything. Taiwan is
// a known, deliberate exception: WDI structurally excludes it (China's WDI
// figures already claim to represent "one China"), so Taiwan's population/
// GDP has to come from the IMF's World Economic Outlook database instead —
// that's separate, manual work, not something this script attempts; see
// SKIP_DEFERRED_SOURCING below.
//
// Usage:
//   node scripts/buildGeoEntityEconomics.mjs --sample=5
//     Dry run: queries the first 5 entities (alphabetically) and prints
//     results, writes no report file.
//   npm run build:geo-entity-economics
//     Full run: queries every in-scope entity, writes
//     scripts/geoEntityEconomicsReport.json.
//
// Run via `tsx`, not plain `node` — imports the live GeoEntityRegistry (via
// src/data/index.ts's side-effect registration of geoEntities.ts) to
// enumerate entities, rather than hardcoding a second, driftable copy of
// their ids/types here.
import fs from 'node:fs'
import { getEntities } from '../src/data/index.ts'

const REPORT_OUTPUT = 'scripts/geoEntityEconomicsReport.json'

const WORLD_BANK_BASE = 'https://api.worldbank.org/v2/country'
const GDP_INDICATOR = 'NY.GDP.MKTP.CD'
const POP_INDICATOR = 'SP.POP.TOTL'
// Same lookback window/reasoning as buildGovCapitalPopGdp.mjs's
// WORLD_BANK_PRIMARY_YEAR/WORLD_BANK_LOOKBACK_START_YEAR — kept identical so
// a figure sourced by this script and one sourced by that script are
// comparable (same "most recent available, explicitly dated" methodology).
const WORLD_BANK_PRIMARY_YEAR = 2024
const WORLD_BANK_LOOKBACK_START_YEAR = 2000

const sampleArg = process.argv.find((a) => a.startsWith('--sample='))
const sampleSize = sampleArg ? Number(sampleArg.split('=')[1]) : null
const isSample = sampleSize != null

// ---------------------------------------------------------------------------
// Entity scope
// ---------------------------------------------------------------------------

// No resident population, ever — a WDI query would trivially return nothing
// meaningful, so these are excluded from the query set entirely rather than
// reported as a WDI gap indistinguishable from "WDI just doesn't track this
// inhabited place." Left untouched in geoEntities.ts.
const SKIP_UNINHABITED = new Set([
  'heard-island-and-mcdonald-islands',
  'us-minor-outlying-islands',
  'south-georgia-and-south-sandwich-islands',
])

// Each needs a deliberate, individual sourcing decision instead of a batch
// WDI fill. All 3 stay in this skip set regardless of resolution status —
// this script is WDI-only and has no ENTITY_ID_TO_WDI_CODE mapping for any
// of them (removing one without also adding a real WDI code would make the
// "in scope but no WDI code mapping" check below throw) — but taiwan's own
// status changed underneath it:
//   - western-sahara: contested administration (Morocco / Polisario Front)
//     means "population of Western Sahara" isn't a single unambiguous WDI
//     query the way a normal dependency's is — needs a human call on
//     whether/how to represent that, not a silent WDI number. STILL
//     UNRESOLVED.
//   - crimea: contested annexation (Russia since 2014, unrecognized by most
//     of the world) means the same problem as Western Sahara — which
//     country's WDI reporting (if either) should stand in for "Crimea" is a
//     judgment call, not a lookup. STILL UNRESOLVED.
//   - taiwan: WDI structurally excludes it (see header comment), so this
//     script still can't source it directly — but the IMF World Economic
//     Outlook sourcing this comment used to point at as "not done here" IS
//     now done, by hand, directly in geoEntities.ts's own Taiwan entry
//     (alongside real Military/Economy/Technology sourcing for Taiwan — see
//     CLAUDE.md's Intelligence Engine section). RESOLVED 2026-08-26 — kept
//     in this set only because this script has no WDI code for it, not
//     because it's still an open gap; see writeBacklogReport's own comment
//     for why its report line reflects that.
const SKIP_DEFERRED_SOURCING = new Set(['taiwan', 'western-sahara', 'crimea'])

// GeoEntity id -> World Bank/WDI 3-letter code. Not derivable from the id
// itself (same reason geoEntities.ts's own ISO_ALPHA3_TO_NUMERIC map has to
// be hand-written) — most match the entity's ISO 3166-1 alpha-3 code where
// one exists, but WDI's own code is what actually matters for the API call,
// and a few (Kosovo, Palestine) don't have a standard ISO alpha-3 code at
// all. Whether WDI actually HAS data under a given code is exactly what this
// script determines empirically — a code being listed here is not a claim
// that WDI has data for it.
const ENTITY_ID_TO_WDI_CODE = {
  'puerto-rico': 'PRI',
  greenland: 'GRL',
  'hong-kong': 'HKG',
  macao: 'MAC',
  'new-caledonia': 'NCL',
  curacao: 'CUW',
  aruba: 'ABW',
  'turks-and-caicos-islands': 'TCA',
  'saint-martin': 'MAF',
  'sint-maarten': 'SXM',
  'saint-pierre-and-miquelon': 'SPM',
  'pitcairn-islands': 'PCN',
  'french-polynesia': 'PYF',
  'french-southern-and-antarctic-lands': 'ATF',
  montserrat: 'MSR',
  'us-virgin-islands': 'VIR',
  'saint-barthelemy': 'BLM',
  anguilla: 'AIA',
  'british-virgin-islands': 'VGB',
  'cayman-islands': 'CYM',
  bermuda: 'BMU',
  'saint-helena': 'SHN',
  jersey: 'JEY',
  guernsey: 'GGY',
  'isle-of-man': 'IMN',
  aland: 'ALA',
  'faroe-islands': 'FRO',
  'british-indian-ocean-territory': 'IOT',
  'norfolk-island': 'NFK',
  'cook-islands': 'COK',
  'wallis-and-futuna': 'WLF',
  'falkland-islands': 'FLK',
  niue: 'NIU',
  'american-samoa': 'ASM',
  guam: 'GUM',
  'northern-mariana-islands': 'MNP',
  gibraltar: 'GIB',
  // World Bank's own entity name is "West Bank and Gaza" — matches this
  // dataset's 'palestine' entity (same territory, different name).
  palestine: 'PSE',
  // World Bank's own code for Kosovo; no ISO 3166-1 alpha-3 exists.
  kosovo: 'XKX',
}

const allEntities = getEntities()
const inScope = allEntities
  .filter((e) => e.type === 'territory' || e.type === 'geopolitical-entity')
  .filter((e) => !SKIP_UNINHABITED.has(e.id) && !SKIP_DEFERRED_SOURCING.has(e.id))
  .sort((a, b) => a.name.localeCompare(b.name))

for (const e of inScope) {
  if (!ENTITY_ID_TO_WDI_CODE[e.id]) {
    throw new Error(
      `[buildGeoEntityEconomics] "${e.id}" (${e.name}) is in scope (type=${e.type}, not skipped) but has no ` +
        `ENTITY_ID_TO_WDI_CODE mapping — add one before running.`
    )
  }
}

const entities = isSample ? inScope.slice(0, sampleSize) : inScope

console.log(
  `${inScope.length} entities in scope (territory/geopolitical-entity, resident population, not deferred). ` +
    `Skipped: ${SKIP_UNINHABITED.size} uninhabited, ${SKIP_DEFERRED_SOURCING.size} deferred-sourcing.`
)

// ---------------------------------------------------------------------------
// Fetch helpers — same shape as buildGovCapitalPopGdp.mjs's.
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

// Same "most recent value in the lookback range, always cite the actual
// year, only NO DATA if truly nothing exists" logic as
// buildGovCapitalPopGdp.mjs's resolveWorldBankIndicator — except the result
// here is NEVER silently omitted (there's no BACKLOG.md gap log to fall
// back on; a NO DATA field IS this script's normal, expected output for a
// WDI entity that doesn't track this indicator, e.g. Jersey or Wallis and
// Futuna, not just an error case).
async function resolveWorldBankIndicator(wdiCode, indicatorCode) {
  const url = `${WORLD_BANK_BASE}/${wdiCode}/indicator/${indicatorCode}?format=json&date=${WORLD_BANK_LOOKBACK_START_YEAR}:${WORLD_BANK_PRIMARY_YEAR}&per_page=100`
  const json = await fetchJsonRetry(url)
  const rows = (json?.[1] ?? []).filter((r) => r.value != null)
  if (rows.length === 0) {
    return { status: 'no-data', value: null, year: null }
  }
  rows.sort((a, b) => Number(b.date) - Number(a.date))
  const best = rows[0]
  return { status: 'ok', value: Math.round(best.value), year: Number(best.date) }
}

async function buildReportEntry(entity) {
  const wdiCode = ENTITY_ID_TO_WDI_CODE[entity.id]
  const [population, gdp] = await Promise.all([
    resolveWorldBankIndicator(wdiCode, POP_INDICATOR),
    resolveWorldBankIndicator(wdiCode, GDP_INDICATOR),
  ])
  return {
    id: entity.id,
    name: entity.name,
    wdiCode,
    populationStatus: population.status,
    population: population.value,
    populationYear: population.year,
    gdpStatus: gdp.status,
    gdpUsd: gdp.value,
    gdpYear: gdp.year,
  }
}

console.log(`Querying WDI for ${entities.length}${isSample ? ' (sample)' : ''} entities...`)
const report = await mapWithConcurrency(entities, 8, buildReportEntry)

// ---------------------------------------------------------------------------
// Output
// ---------------------------------------------------------------------------

function formatEntry(r) {
  const pop = r.populationStatus === 'ok' ? `${r.population.toLocaleString()} (${r.populationYear})` : 'NO DATA'
  const gdp = r.gdpStatus === 'ok' ? `$${r.gdpUsd.toLocaleString()} (${r.gdpYear})` : 'NO DATA'
  return `  [${r.id}] (${r.wdiCode}) population: ${pop} | gdp: ${gdp}`
}

for (const r of report) console.log(formatEntry(r))

const noDataCount = report.filter((r) => r.populationStatus === 'no-data' && r.gdpStatus === 'no-data').length
console.log(
  `\n${report.length} entities queried. ${noDataCount} have NO DATA for both population and GDP (WDI doesn't track them at all).`
)

if (isSample) {
  console.log('\nSample run only — wrote no report file.')
  process.exit(0)
}

const output = {
  generatedAt: new Date().toISOString().slice(0, 10),
  source: 'World Bank World Development Indicators (WDI) API — NY.GDP.MKTP.CD, SP.POP.TOTL',
  lookbackRange: `${WORLD_BANK_LOOKBACK_START_YEAR}-${WORLD_BANK_PRIMARY_YEAR}`,
  skipped: {
    uninhabited: [...SKIP_UNINHABITED],
    deferredSourcing: [...SKIP_DEFERRED_SOURCING],
  },
  entities: report,
}
fs.writeFileSync(REPORT_OUTPUT, JSON.stringify(output, null, 2) + '\n')
console.log(`\nWrote ${REPORT_OUTPUT}: ${report.length} entities.`)
console.log('This file is a REPORT only — geoEntities.ts is hand-curated and must be edited manually using it.')

// ---------------------------------------------------------------------------
// BACKLOG.md — same idempotent marker-section pattern as
// buildGovCapitalPopGdp.mjs's writeBacklogReport (see that script), so open
// items from this pass don't just live in a JSON file nobody reads twice:
// every entity WDI genuinely has nothing for, plus the three entities
// deliberately skipped this run, get logged as an explicit open item rather
// than silently disappearing once the console output scrolls away.
// ---------------------------------------------------------------------------
const BACKLOG = 'BACKLOG.md'
function writeBacklogReport() {
  const BEGIN = '<!-- BEGIN buildGeoEntityEconomics.mjs gap report -->'
  const END = '<!-- END buildGeoEntityEconomics.mjs gap report -->'
  const generatedAt = new Date().toISOString().slice(0, 10)

  const noWdiData = report.filter((r) => r.populationStatus === 'no-data' && r.gdpStatus === 'no-data')
  const partial = report.filter(
    (r) => (r.populationStatus === 'no-data') !== (r.gdpStatus === 'no-data')
  )

  const lines = []
  lines.push(BEGIN)
  lines.push('')
  lines.push(
    `**Generated by \`npm run build:geo-entity-economics\` (\`scripts/buildGeoEntityEconomics.mjs\`), ${generatedAt}.** ` +
      `This script only ever writes a report (scripts/geoEntityEconomicsReport.json) and never edits ` +
      `src/data/registry/geoEntities.ts directly — the items below are what a human still needs to act on, or ` +
      `accept as a permanent gap. Re-running the script regenerates this list — don't hand-edit it.`
  )
  lines.push('')

  lines.push(`- **Resolved outside this script, still WDI-skipped (no WDI code exists for either):**`)
  lines.push(
    `  - **[taiwan]:** World Bank WDI structurally excludes Taiwan (China's WDI figures already claim to represent "one China"). RESOLVED 2026-08-26 — population/gdpUsd are now sourced directly, by hand, from IMF World Economic Outlook in geoEntities.ts's own Taiwan entry (see CLAUDE.md's Intelligence Engine section), not by this script.`
  )
  lines.push('')
  lines.push(`- **Deliberately deferred this pass, needs its own sourcing decision:**`)
  lines.push(
    `  - **[western-sahara]:** Administration is contested (Morocco west of the berm, the Polisario Front/SADR east of it) — no single WDI query is an uncontroversial answer to "population of Western Sahara."`
  )
  lines.push(
    `  - **[crimea]:** Administration is contested (Russian de facto control since 2014, not internationally recognized) — same problem as Western Sahara, no single source's figure is uncontroversial.`
  )
  lines.push('')

  if (partial.length > 0) {
    lines.push(`- **WDI has one figure but not the other (population OR gdp, not both):**`)
    for (const r of partial.sort((a, b) => a.id.localeCompare(b.id))) {
      const missing = r.populationStatus === 'no-data' ? 'population' : 'gdp'
      lines.push(
        `  - **[${r.id}] ${missing}:** No WDI ${missing === 'population' ? 'SP.POP.TOTL' : 'NY.GDP.MKTP.CD'} data for ${r.wdiCode} in ${WORLD_BANK_LOOKBACK_START_YEAR}-${WORLD_BANK_PRIMARY_YEAR} — left unscored.`
      )
    }
    lines.push('')
  }

  lines.push(`- **No WDI data at all (population AND gdp), ${noWdiData.length} entities — genuinely not tracked by WDI, not just "not reported yet":**`)
  for (const r of noWdiData.sort((a, b) => a.id.localeCompare(b.id))) {
    lines.push(`  - [${r.id}] (${r.wdiCode})`)
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
    const heading = '\n## Data sourcing (`buildGeoEntityEconomics.mjs`)\n\n'
    const introEnd = backlog.indexOf('\n## ')
    updated = introEnd === -1
      ? backlog + heading + section + '\n'
      : backlog.slice(0, introEnd) + heading + section + '\n' + backlog.slice(introEnd)
  }
  fs.writeFileSync(BACKLOG, updated)
  console.log(`Updated ${BACKLOG}: ${noWdiData.length} no-data + ${partial.length} partial + 3 deferred entities logged.`)
}

writeBacklogReport()
