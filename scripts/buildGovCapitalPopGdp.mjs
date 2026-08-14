// Build-time asset generator: government type, capital (name + coordinates),
// population, and GDP for all 193 UN member states — replaces the
// illustrative/hand-typed data src/data/countryProfiles.ts has shipped with
// since v1 (see that file's own header comment: "A future phase should swap
// this for a real data source"). Unlike this repo's other buildX.mjs
// scripts, which transform a vendored snapshot already sitting in
// scripts/vendor/, this one hits two live sources over the network every run:
//
//   - World Bank API v2 (population, GDP) — no key, REST/JSON. Queried over
//     a range (WORLD_BANK_LOOKBACK_START_YEAR..WORLD_BANK_PRIMARY_YEAR)
//     rather than a single year, and the most recent year with a non-null
//     value in that range is used — but the actual year used is always
//     recorded (see gdpYear/populationYear below) and, whenever it isn't
//     WORLD_BANK_PRIMARY_YEAR, logged as a gap. A country with genuinely no
//     value anywhere in the range is left unscored, not backfilled with a
//     fabricated number.
//   - factbook.json (government type, capital name + coordinates) — a
//     FROZEN snapshot of the CIA World Factbook. The CIA took the site
//     itself offline Feb 4 2026 (see factbook.json's own README), so this
//     data cannot get any more current than its last snapshot. Every
//     government/capital field this script writes is stamped with a
//     `factbookSnapshot: { source, snapshotDate }` annotation for exactly
//     that reason — see CountryProfile's own doc comment in the generated
//     output.
//
// factbook.json indexes country profiles by two-letter GEC (FIPS) code, not
// ISO — scripts/lib/gecCrossReference.mjs bridges that. Which region
// subdirectory a given GEC code's file lives under isn't derivable from the
// code itself (see that file's own header), so this script fetches the
// repo's full file tree once (one GitHub API call) rather than guessing/
// trying every region directory per country.
//
// TWO generated outputs, not one — this is the important structural change
// from this script's first version. Population/GDP are written RAW (no
// scaling/rounding at all) to src/data/countryEconomics.ts, which merges
// into data/types.ts's Country records at runtime (see
// scene/useCountryFeatures.ts) and is formatted only at actual render time
// by src/utils/formatScale.ts. Baking "42.6 Million" directly into
// countryProfiles.ts (this script's original design) meant a correction
// that crossed a unit threshold — a GDP revision moving a country from
// "$900 Million" to "$1.1 Billion" — needed a full data rebuild instead of a
// one-line formatter fix, and put scale/rounding logic in two places instead
// of one. countryProfiles.ts keeps its presentation-formatted shape for
// everything ELSE this script sources (government, governmentNote, capital,
// capitalLat/Lng, factbookSnapshot) — those aren't computed on the way
// population/GDP are meant to be (see data/types.ts's Country doc comment),
// so baking them into a display string at build time isn't the same
// category of mistake.
//
// Usage:
//   node scripts/buildGovCapitalPopGdp.mjs --sample=10
//     Dry run: resolves + fetches the first 10 countries (alphabetically),
//     prints each result to the console, writes nothing. Use this first to
//     confirm the GEC/ISO2 join and both APIs' response shapes still look
//     right before trusting a full run.
//   npm run build:profiles   (tsx scripts/buildGovCapitalPopGdp.mjs)
//     Full run: all 193 countries, overwrites src/data/countryProfiles.ts
//     AND src/data/countryEconomics.ts, and appends a generated gap report
//     to BACKLOG.md (see writeBacklogReport below) for every field that
//     couldn't be sourced cleanly and had to fall back, cite an older year,
//     or be left unscored.
//
// Run via `tsx`, not plain `node` — this script imports the current
// src/data/countryProfiles.ts (as a fallback source for capital
// name/coordinates when factbook.json's own value is ambiguous or missing,
// see resolveCapital below), the same reason generateClaimsDoc.mjs imports
// its two .ts sources via tsx instead of plain node.
import fs from 'node:fs'
import { feature } from 'topojson-client'
import { ALPHA3_TO_NUMERIC } from './lib/iso3166.mjs'
import { ISO3_TO_GEC } from './lib/gecCrossReference.mjs'
import { COUNTRY_PROFILES as OLD_PROFILES } from '../src/data/countryProfiles.ts'

const COUNTRIES_SOURCE = 'public/geo/countries-un193.json'
const PROFILES_OUTPUT = 'src/data/countryProfiles.ts'
const ECONOMICS_OUTPUT = 'src/data/countryEconomics.ts'
const BACKLOG = 'BACKLOG.md'

const FACTBOOK_SNAPSHOT_DATE = '2026-01'
const FACTBOOK_TREE_URL = 'https://api.github.com/repos/factbook/factbook.json/git/trees/master?recursive=1'
const FACTBOOK_RAW_BASE = 'https://raw.githubusercontent.com/factbook/factbook.json/master'

const WORLD_BANK_BASE = 'https://api.worldbank.org/v2/country'
const GDP_INDICATOR = 'NY.GDP.MKTP.CD'
const POP_INDICATOR = 'SP.POP.TOTL'
// The year every figure is expected to be for. A country whose most recent
// available figure is for an earlier year gets that year explicitly (never
// silently treated as WORLD_BANK_PRIMARY_YEAR) — see resolveWorldBankIndicator.
const WORLD_BANK_PRIMARY_YEAR = 2024
// How far back to look for a usable figure when the primary year has none.
// 2000 comfortably covers every gap actually observed in this dataset (the
// worst case, South Sudan, last reported in 2015) with a wide margin, in a
// single request (World Bank's default page size covers a 25-year range).
const WORLD_BANK_LOOKBACK_START_YEAR = 2000

// Government type is contested/transitional enough (coup governments,
// ongoing civil conflict, disputed recognition) that whatever factbook.json
// says should carry an explicit "this may already be stale" flag beyond the
// blanket snapshot annotation every country gets — named explicitly in the
// task this script was written for, not derived from any field in the data
// itself.
const CONTESTED_GOVERNMENT_COUNTRIES = new Set([
  'Chad',
  'Gabon',
  'Guinea',
  'Mali',
  'Niger',
  'Burkina Faso',
  'Sudan',
  'Libya',
  'Yemen',
  'Afghanistan',
  'Myanmar',
  'Syria',
])
const CONTESTED_GOVERNMENT_NOTE =
  `Situation is fluid; this reflects factbook.json's ${FACTBOOK_SNAPSHOT_DATE} snapshot and may not ` +
  'reflect developments since then.'

const sampleArg = process.argv.find((a) => a.startsWith('--sample='))
const sampleSize = sampleArg ? Number(sampleArg.split('=')[1]) : null
const isSample = sampleSize != null

// ---------------------------------------------------------------------------
// Fetch helpers
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

// Runs `fn` over `items` with at most `limit` in flight at once — 193
// countries x ~3 requests each (factbook + 2 World Bank indicators) is
// ~580 requests; unbounded concurrency against two public, unauthenticated
// APIs is a good way to start seeing rate-limit/connection-reset errors.
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
// Country list + id bridging (numeric -> alpha-3 -> GEC -> factbook path)
// ---------------------------------------------------------------------------

const topology = JSON.parse(fs.readFileSync(COUNTRIES_SOURCE, 'utf8'))
const allCountries = feature(topology, topology.objects.countries)
  .features.map((f) => ({ id: String(f.id), name: f.properties.name }))
  .sort((a, b) => a.name.localeCompare(b.name))

const countries = isSample ? allCountries.slice(0, sampleSize) : allCountries

const NUMERIC_TO_ALPHA3 = Object.fromEntries(Object.entries(ALPHA3_TO_NUMERIC).map(([a3, num]) => [num, a3]))

console.log(`Fetching factbook.json's file tree (one request) to resolve GEC code -> region path...`)
const tree = await fetchJsonRetry(FACTBOOK_TREE_URL)
const gecLowerToPath = {}
for (const entry of tree.tree) {
  const m = entry.path.match(/^([a-z0-9-]+)\/([a-z]{2})\.json$/)
  if (m) gecLowerToPath[m[2]] = entry.path
}
console.log(`Resolved ${Object.keys(gecLowerToPath).length} GEC code -> path entries.`)

// ---------------------------------------------------------------------------
// Gap log — every field that couldn't be sourced cleanly, with why. Printed
// to the console always; folded into BACKLOG.md only on a real (non-sample)
// run, see writeBacklogReport below.
// ---------------------------------------------------------------------------
const gaps = []
function logGap(country, field, reason) {
  gaps.push({ country, field, reason })
}

// ---------------------------------------------------------------------------
// Parsing helpers
// ---------------------------------------------------------------------------

// "35 16 S, 149 08 E" / "38 53 15 N, 77 02 12 W" (deg min[, sec] per axis) ->
// decimal degrees. Returns null if the text doesn't match this shape at all
// (factbook.json's "geographic coordinates" field is otherwise unstructured
// prose in a small number of entries).
function parseGeoCoordinates(text) {
  const m = text.match(/(\d+)\s+(\d+)(?:\s+(\d+))?\s*([NS]),\s*(\d+)\s+(\d+)(?:\s+(\d+))?\s*([EW])/)
  if (!m) return null
  const [, latD, latM, latS, latDir, lngD, lngM, lngS, lngDir] = m
  let lat = Number(latD) + Number(latM) / 60 + Number(latS ?? 0) / 3600
  let lng = Number(lngD) + Number(lngM) / 60 + Number(lngS ?? 0) / 3600
  if (latDir === 'S') lat = -lat
  if (lngDir === 'W') lng = -lng
  return { lat: Math.round(lat * 100) / 100, lng: Math.round(lng * 100) / 100 }
}

// factbook.json's text fields are HTML-entity-encoded (accented Latin
// letters especially — "Bras&iacute;lia", "Asunci&oacute;n"). Every named
// HTML entity terminates in ';', which without decoding first is
// indistinguishable from the ';' this script otherwise treats as a
// multiple-capitals delimiter (see resolveCapital) — decode BEFORE any
// semicolon-based logic runs, not after, or "Brasília" reads as ambiguous.
const HTML_NAMED_ENTITIES = {
  amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ',
  mdash: '—', ndash: '–', hellip: '…',
  lsquo: '‘', rsquo: '’', ldquo: '“', rdquo: '”',
  Agrave: 'À', Aacute: 'Á', Acirc: 'Â', Atilde: 'Ã', Auml: 'Ä', Aring: 'Å', AElig: 'Æ', Ccedil: 'Ç',
  Egrave: 'È', Eacute: 'É', Ecirc: 'Ê', Euml: 'Ë', Igrave: 'Ì', Iacute: 'Í', Icirc: 'Î', Iuml: 'Ï',
  Ntilde: 'Ñ', Ograve: 'Ò', Oacute: 'Ó', Ocirc: 'Ô', Otilde: 'Õ', Ouml: 'Ö', Oslash: 'Ø',
  Ugrave: 'Ù', Uacute: 'Ú', Ucirc: 'Û', Uuml: 'Ü', Yacute: 'Ý', THORN: 'Þ',
  agrave: 'à', aacute: 'á', acirc: 'â', atilde: 'ã', auml: 'ä', aring: 'å', aelig: 'æ', ccedil: 'ç',
  egrave: 'è', eacute: 'é', ecirc: 'ê', euml: 'ë', igrave: 'ì', iacute: 'í', icirc: 'î', iuml: 'ï',
  eth: 'ð', ntilde: 'ñ', ograve: 'ò', oacute: 'ó', ocirc: 'ô', otilde: 'õ', ouml: 'ö', oslash: 'ø',
  ugrave: 'ù', uacute: 'ú', ucirc: 'û', uuml: 'ü', yacute: 'ý', thorn: 'þ', yuml: 'ÿ',
}
function decodeHtmlEntities(text) {
  return text
    .replace(/&#x([0-9a-fA-F]+);/g, (_, hex) => String.fromCodePoint(parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, dec) => String.fromCodePoint(Number(dec)))
    .replace(/&(\w+);/g, (m, name) => HTML_NAMED_ENTITIES[name] ?? m)
}

const TITLE_CASE_LOWERCASE_WORDS = new Set(['a', 'an', 'and', 'at', 'does', 'for', 'in', 'not', 'of', 'on', 'the', 'to'])
function titleCase(text) {
  return text
    .split(' ')
    .map((word, i) => {
      const lower = word.toLowerCase()
      if (i > 0 && TITLE_CASE_LOWERCASE_WORDS.has(lower)) return lower
      return lower.charAt(0).toUpperCase() + lower.slice(1)
    })
    .join(' ')
}

// ---------------------------------------------------------------------------
// Per-source resolvers
// ---------------------------------------------------------------------------

// factbook.json's Capital.name.text sometimes names more than one capital
// ("Pretoria (administrative capital); Cape Town (legislative capital);
// Bloemfontein (judicial capital)", or Nauru's "no official capital;
// government offices in the Yaren District") — factbook.json only ever
// gives ONE geographic-coordinates pair regardless, so there's no reliable
// way to tell which of several named capitals it actually corresponds to
// (the illustrative dataset's own picks don't follow one consistent rule
// either — compare Sri Lanka, which kept the legislative capital, against
// South Africa/Eswatini/Bolivia, which all kept the administrative one).
// Rather than guess, this is treated as a gap: keep whatever the prior
// illustrative entry already had and flag it for a human call.
function resolveCapital(country, factbookCapital) {
  const oldProfile = OLD_PROFILES[country.name]
  const nameText = factbookCapital?.name?.text ? decodeHtmlEntities(factbookCapital.name.text) : undefined
  const isAmbiguous = !nameText || nameText.includes(';')

  if (isAmbiguous) {
    logGap(
      country.name,
      'capital',
      nameText
        ? `factbook.json lists multiple/non-standard capitals ("${nameText}") with only one coordinate pair — kept prior capital "${oldProfile?.capital}"; needs a human call on which is the capital of record.`
        : `factbook.json had no Capital.name at all — kept prior capital "${oldProfile?.capital}".`
    )
    return { capital: oldProfile?.capital, capitalLat: oldProfile?.capitalLat, capitalLng: oldProfile?.capitalLng }
  }

  const coordsText = factbookCapital?.['geographic coordinates']?.text
  const coords = coordsText ? parseGeoCoordinates(coordsText) : null
  if (!coords) {
    logGap(
      country.name,
      'capital coordinates',
      `factbook.json had no parseable "geographic coordinates" for ${nameText} (raw: ${JSON.stringify(coordsText) ?? 'missing'}) — kept prior coordinates.`
    )
    return { capital: nameText, capitalLat: oldProfile?.capitalLat, capitalLng: oldProfile?.capitalLng }
  }

  return { capital: nameText, capitalLat: coords.lat, capitalLng: coords.lng }
}

// factbook.json's "Government type" is full descriptive prose, not the
// short category label (e.g. "Parliamentary Constitutional Monarchy") the
// illustrative dataset used — some entries run to a full sentence with
// asides ("...; note - constitutional changes adopted in December 2015
// transformed the government to a parliamentary system"). DataRow renders
// this value right-aligned in a 160px column, so the full sentence doesn't
// fit and doesn't read as a label. Keeping only the text up to the first
// semicolon recovers something close to the illustrative dataset's own
// style for the large majority of countries (whose entry is a semicolon-free
// short phrase to begin with, or whose first clause alone is already the
// complete type). The trimmed remainder isn't a "gap" — it's real data, just
// discarded for a fixed-width UI column — so it isn't logged to BACKLOG.md,
// except for the contested-government countries below, where it's folded
// into governmentNote instead of thrown away.
function resolveGovernment(country, factbookGovType) {
  const oldProfile = OLD_PROFILES[country.name]
  const text = factbookGovType?.text ? decodeHtmlEntities(factbookGovType.text) : undefined
  if (!text) {
    logGap(country.name, 'government', `factbook.json had no "Government type" entry — kept prior value "${oldProfile?.government}".`)
    return { government: oldProfile?.government }
  }
  const [core, ...rest] = text.split(';').map((s) => s.trim())
  const government = titleCase(core)
  let governmentNote
  if (CONTESTED_GOVERNMENT_COUNTRIES.has(country.name)) {
    governmentNote = rest.length > 0 ? `${CONTESTED_GOVERNMENT_NOTE} Full factbook.json entry: "${text}"` : CONTESTED_GOVERNMENT_NOTE
  }
  return { government, governmentNote }
}

// Queried as a RANGE, not a single year — the primary year is preferred, but
// a country the World Bank hasn't reported a WORLD_BANK_PRIMARY_YEAR figure
// for yet often still has an older one (San Marino: 2023 exists, 2024
// doesn't; South Sudan: nothing since 2015). Silently treating a stale
// figure as current would misrepresent it; silently leaving it unscored
// when a real, dated figure exists would throw away real data. Instead:
// use the most recent available year and ALWAYS report which year that
// was, logging a gap whenever it isn't the primary year so it's never
// mistaken for current. Only a country with nothing anywhere in the lookback
// window (Eritrea, North Korea — genuine voids, not just "not reported yet")
// comes back unscored.
async function resolveWorldBankIndicator(country, alpha3, indicatorCode, fieldLabel) {
  const url = `${WORLD_BANK_BASE}/${alpha3}/indicator/${indicatorCode}?format=json&date=${WORLD_BANK_LOOKBACK_START_YEAR}:${WORLD_BANK_PRIMARY_YEAR}&per_page=100`
  const json = await fetchJsonRetry(url)
  const rows = (json?.[1] ?? []).filter((r) => r.value != null)
  if (rows.length === 0) {
    logGap(
      country.name,
      fieldLabel,
      `World Bank has no ${indicatorCode} value for ${alpha3} in any year from ${WORLD_BANK_LOOKBACK_START_YEAR} to ${WORLD_BANK_PRIMARY_YEAR} — genuinely no data in range, left unscored.`
    )
    return { value: undefined, year: undefined }
  }
  rows.sort((a, b) => Number(b.date) - Number(a.date))
  const best = rows[0]
  const year = Number(best.date)
  if (year !== WORLD_BANK_PRIMARY_YEAR) {
    logGap(
      country.name,
      fieldLabel,
      `World Bank's most recent ${indicatorCode} figure for ${alpha3} is ${year} (no ${WORLD_BANK_PRIMARY_YEAR} figure reported yet) — cited explicitly as ${year} rather than backfilled as current.`
    )
  }
  return { value: best.value, year }
}

// ---------------------------------------------------------------------------
// Per-country pipeline
// ---------------------------------------------------------------------------

async function buildProfile(country) {
  const alpha3 = NUMERIC_TO_ALPHA3[country.id]
  const gec = alpha3 ? ISO3_TO_GEC[alpha3] : undefined
  const path = gec ? gecLowerToPath[gec.toLowerCase()] : undefined

  let factbookGov, factbookCapital
  if (!path) {
    logGap(country.name, 'government + capital', `No factbook.json path resolved (alpha3=${alpha3 ?? '?'}, gec=${gec ?? '?'}) — kept prior values.`)
  } else {
    const doc = await fetchJsonRetry(`${FACTBOOK_RAW_BASE}/${path}`)
    factbookGov = doc.Government?.['Government type']
    factbookCapital = doc.Government?.Capital
  }

  const oldProfile = OLD_PROFILES[country.name]
  const { government, governmentNote } = factbookGov !== undefined || path
    ? resolveGovernment(country, factbookGov)
    : { government: oldProfile?.government, governmentNote: undefined }
  const { capital, capitalLat, capitalLng } = path
    ? resolveCapital(country, factbookCapital)
    : { capital: oldProfile?.capital, capitalLat: oldProfile?.capitalLat, capitalLng: oldProfile?.capitalLng }

  const [gdp, population] = alpha3
    ? await Promise.all([
        resolveWorldBankIndicator(country, alpha3, GDP_INDICATOR, 'gdp'),
        resolveWorldBankIndicator(country, alpha3, POP_INDICATOR, 'population'),
      ])
    : (logGap(country.name, 'population + gdp', 'No ISO alpha-3 code resolved — left unscored.'),
       [{ value: undefined, year: undefined }, { value: undefined, year: undefined }])

  return {
    id: country.id,
    name: country.name,
    government,
    governmentNote,
    capital,
    capitalLat,
    capitalLng,
    populationRaw: population.value == null ? undefined : Math.round(population.value),
    populationYear: population.year,
    gdpRaw: gdp.value == null ? undefined : Math.round(gdp.value),
    gdpYear: gdp.year,
    factbookSnapshot: path ? { source: 'factbook.json', snapshotDate: FACTBOOK_SNAPSHOT_DATE } : undefined,
  }
}

console.log(`Building profiles for ${countries.length} ${isSample ? 'sample' : ''} countries...`)
const profiles = await mapWithConcurrency(countries, 8, buildProfile)

// ---------------------------------------------------------------------------
// Output
// ---------------------------------------------------------------------------

if (isSample) {
  for (const p of profiles) console.log(JSON.stringify(p, null, 2))
  console.log(`\nSample run only — wrote nothing. ${gaps.length} gap(s) logged (see above/console, not BACKLOG.md in sample mode):`)
  for (const g of gaps) console.log(`  - [${g.country}] ${g.field}: ${g.reason}`)
  process.exit(0)
}

function profileToTs(p) {
  const lines = []
  lines.push(`  ${/^[A-Za-z][A-Za-z0-9]*$/.test(p.name) ? p.name : JSON.stringify(p.name)}: {`)
  lines.push(`    government: ${JSON.stringify(p.government)},`)
  if (p.governmentNote) lines.push(`    governmentNote: ${JSON.stringify(p.governmentNote)},`)
  lines.push(`    capital: ${JSON.stringify(p.capital)},`)
  lines.push(`    capitalLat: ${p.capitalLat},`)
  lines.push(`    capitalLng: ${p.capitalLng},`)
  if (p.factbookSnapshot) {
    lines.push(
      `    factbookSnapshot: { source: 'factbook.json', snapshotDate: ${JSON.stringify(p.factbookSnapshot.snapshotDate)} },`
    )
  }
  lines.push(`  },`)
  return lines.join('\n')
}

const profilesHeader = `// Sourced from two live feeds by scripts/buildGovCapitalPopGdp.mjs
// (\`npm run build:profiles\`) — replaces the illustrative/hand-typed data
// this file shipped with through v5.2.9. Government type and capital (name +
// coordinates) come from factbook.json, a FROZEN snapshot of the CIA World
// Factbook (the CIA itself took the site offline Feb 4 2026) — every record
// sourced from it carries a \`factbookSnapshot\` field for exactly that
// reason; treat it as dated, not live. A handful of fields couldn't be
// sourced cleanly this run (ambiguous multi-capital entries, countries
// missing from factbook.json entirely) and fell back to this file's prior
// value instead of guessing — see BACKLOG.md's "Data sourcing" section,
// regenerated alongside this file, for the full list.
//
// Population and GDP are NOT here — see src/data/countryEconomics.ts. They
// used to be baked into this file as pre-formatted strings ("2.14 Billion"),
// computed at build time; that meant a correction crossing a unit threshold
// (millions -> billions) needed a full rebuild instead of a formatter fix,
// and put scale/rounding logic in two places instead of one. They're now
// stored raw on data/types.ts's Country (merged in by
// scene/useCountryFeatures.ts) and formatted only at render time by
// src/utils/formatScale.ts.
//
// Re-run the build script (rather than hand-editing this file) to refresh.

export interface CountryProfile {
  government: string
  // Set only for a country whose government is contested/transitional as of
  // this data's factbook.json snapshot — see CONTESTED_GOVERNMENT_COUNTRIES
  // in the build script.
  governmentNote?: string
  capital: string
  // Capital city coordinates, used to place the capital marker on the globe
  // when this country is selected.
  capitalLat: number
  capitalLng: number
  // Present whenever government/capital came from factbook.json this run —
  // see this file's own header comment above.
  factbookSnapshot?: { source: 'factbook.json'; snapshotDate: string }
}

export const COUNTRY_PROFILES: Record<string, CountryProfile> = {
`

const profilesFooter = `}
`

const profilesBody = profiles.map(profileToTs).join('\n')
fs.writeFileSync(PROFILES_OUTPUT, profilesHeader + profilesBody + '\n' + profilesFooter)
console.log(`Wrote ${PROFILES_OUTPUT}: ${profiles.length} countries.`)

// ---------------------------------------------------------------------------
// countryEconomics.ts — raw population/GDP, keyed by the SAME numeric ISO
// topology id scene/useCountryFeatures.ts registers Country records under
// (String(feature.id) from countries-un193.json), NOT the ISO alpha-3
// convention data/types.ts's Country.id doc comment describes — that
// mismatch between the documented convention and useCountryFeatures.ts's
// actual runtime registration predates this script (see LOGBOOK.md's v3.0.1
// entry on the alpha-3-vs-numeric id-mismatch bug class) and isn't this
// script's to fix; this file exists to be merged into those records by id
// at registration time, so it has to use the id they're actually keyed by.
// ---------------------------------------------------------------------------

function economicsEntryToTs(p) {
  const fields = []
  if (p.populationRaw != null) fields.push(`population: ${p.populationRaw}`)
  if (p.populationYear != null) fields.push(`populationYear: ${p.populationYear}`)
  if (p.gdpRaw != null) fields.push(`gdpUsd: ${p.gdpRaw}`)
  if (p.gdpYear != null) fields.push(`gdpYear: ${p.gdpYear}`)
  if (fields.length === 0) return null
  return `  ${JSON.stringify(p.id)}: { ${fields.join(', ')} },`
}

const economicsHeader = `// Raw population/GDP, generated by scripts/buildGovCapitalPopGdp.mjs
// (\`npm run build:profiles\`) alongside countryProfiles.ts — kept as a
// SEPARATE file (not baked into CountryProfile) specifically so
// scaling/rounding logic lives in exactly one place: src/utils/formatScale.ts,
// called at render time by hud/IntelligencePanel.tsx. See countryProfiles.ts's
// own header comment for the incident that prompted the split.
//
// Keyed by the SAME numeric ISO topology id scene/useCountryFeatures.ts
// registers Country records under — see this file's own comment further
// down (right above COUNTRY_ECONOMICS) for why that's the numeric id and
// not the ISO alpha-3 data/types.ts's Country.id doc comment describes.
//
// \`population\`/\`gdpUsd\` are the raw figures for \`populationYear\`/\`gdpYear\`
// respectively — PRIMARY_ECONOMIC_YEAR whenever the World Bank had reported
// that year at build time, an earlier year (explicitly recorded, never
// silently backfilled as current) otherwise. A country entirely missing
// from this map, or missing one of the two fields, had no World Bank figure
// at all within the build script's lookback window — see BACKLOG.md's "Data
// sourcing" section for the specific reason.
//
// Re-run the build script (rather than hand-editing this file) to refresh.

/** The year every population/gdpUsd figure below is FOR, unless populationYear/gdpYear says otherwise for that one entry. */
export const PRIMARY_ECONOMIC_YEAR = ${WORLD_BANK_PRIMARY_YEAR}

export interface CountryEconomics {
  population?: number
  /** Year the \`population\` figure is actually for — omitted only alongside a missing \`population\`. */
  populationYear?: number
  gdpUsd?: number
  /** Year the \`gdpUsd\` figure is actually for — omitted only alongside a missing \`gdpUsd\`. May differ from \`populationYear\`. */
  gdpYear?: number
}

// Keyed by numeric ISO topology id (e.g. "840" for the United States) — see
// this file's own header comment above for why.
export const COUNTRY_ECONOMICS: Record<string, CountryEconomics> = {
`

const economicsFooter = `}
`

const economicsBody = profiles
  .map(economicsEntryToTs)
  .filter((line) => line !== null)
  .join('\n')
fs.writeFileSync(ECONOMICS_OUTPUT, economicsHeader + economicsBody + '\n' + economicsFooter)
console.log(`Wrote ${ECONOMICS_OUTPUT}: ${profiles.filter((p) => p.populationRaw != null || p.gdpRaw != null).length} countries with at least one figure.`)

// ---------------------------------------------------------------------------
// BACKLOG.md — append/replace a generated "Data sourcing" section rather
// than leaving skipped fields unrecorded. Idempotent: a marker comment lets
// a future run replace this section instead of duplicating it.
// ---------------------------------------------------------------------------
function writeBacklogReport() {
  const BEGIN = '<!-- BEGIN buildGovCapitalPopGdp.mjs gap report -->'
  const END = '<!-- END buildGovCapitalPopGdp.mjs gap report -->'
  const generatedAt = new Date().toISOString().slice(0, 10)

  const lines = []
  lines.push(BEGIN)
  lines.push('')
  lines.push(
    `**Generated by \`npm run build:profiles\` (\`scripts/buildGovCapitalPopGdp.mjs\`), ${generatedAt}.** ` +
      `Every field below couldn't be sourced cleanly from World Bank/factbook.json this run: either it fell back ` +
      `to countryProfiles.ts's prior value (capital/government), cited an older year than ` +
      `${WORLD_BANK_PRIMARY_YEAR} explicitly (population/GDP — see countryEconomics.ts's populationYear/gdpYear), ` +
      `or was left unscored entirely (a genuine gap in the source, no figure at any year in the lookback window). ` +
      `Re-running the script regenerates this list — don't hand-edit it.`
  )
  lines.push('')
  if (gaps.length === 0) {
    lines.push('- None this run — every field for every country resolved cleanly.')
  } else {
    // Sorted by country then field — `gaps` fills in whatever order
    // mapWithConcurrency's per-country async work happens to resolve in,
    // which varies run to run (network timing, not anything meaningful).
    // Without a stable sort here, re-running this script against identical
    // upstream data would still rewrite BACKLOG.md with the same gaps in a
    // different order every time.
    const sortedGaps = gaps
      .slice()
      .sort((a, b) => a.country.localeCompare(b.country) || a.field.localeCompare(b.field))
    for (const g of sortedGaps) {
      lines.push(`- **[${g.country}] ${g.field}:** ${g.reason}`)
    }
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
    const heading = '\n## Data sourcing (`buildGovCapitalPopGdp.mjs`)\n\n'
    const introEnd = backlog.indexOf('\n## ')
    updated = introEnd === -1
      ? backlog + heading + section + '\n'
      : backlog.slice(0, introEnd) + heading + section + '\n' + backlog.slice(introEnd)
  }
  fs.writeFileSync(BACKLOG, updated)
  console.log(`Updated ${BACKLOG}: ${gaps.length} gap(s) logged.`)
}

writeBacklogReport()
