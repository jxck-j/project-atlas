// Build-time asset generator for the Current Status category of the
// Intelligence Engine (see Intelligence Docs/intelligence-engine-scoring-
// design.md §3.5 for the locked design this script implements). Produces
// TWO independent, categorical fields per country — NOT a 0-100 score —
// written to src/data/currentStatus.ts:
//
//   - conflicts: ConflictEntry[]        (0, 1, or many — every entry is a
//     real, dated, sourced UCDP record, never a fabricated/inferred one)
//   - sanctionTier: 'red'|'orange'|'yellow'|null  (OFAC program tier — see
//     below; null means no active OFAC country program, not "unsourced")
//   - sanctionPrograms?: string[]        (the actual OFAC program name(s))
//
// Standalone data-generation script only — does NOT touch GeoEntity/Country
// type definitions, registries, or any rendering/UI code. Panel rendering
// (a chip row for conflicts, a colored badge for sanctionTier) is wired into
// hud/IntelligencePanel.tsx separately — see that file.
//
// ---------------------------------------------------------------------------
// SOURCING — two UCDP products, combined:
//
// 1. UCDP/PRIO Armed Conflict Dataset (ACD, annual) — authoritative source
//    for `conflictType` (extrasystemic/interstate/internal/
//    internationalized_internal, ACD's own `type_of_conflict` codes 1-4).
//    Direct CSV download, no login: see PRIO_ZIP_URL below. The API
//    (ucdpapi.pcr.uu.se) was investigated first and requires a free but
//    manually-issued access token (email request to UCDP's API maintainer,
//    per ucdp.uu.se/apidocs/ — not a self-service signup and not something
//    this script can obtain on its own); the direct file download needs
//    neither a token nor an account, so this script uses that instead of
//    blocking on a human approval step, same "found a legitimate direct
//    path around a gated API" precedent as buildMilitary.mjs's SIPRI TIV
//    reverse-engineering.
//
// 2. UCDP Candidate Events Dataset (Candidate/GED, monthly, ~1 month lag) —
//    used to catch a conflict that's active in the current calendar year
//    but not yet reflected in any annual ACD release (ACD for year Y is
//    published the following year). A conflict detected only this way gets
//    `conflictType: 'unclassified'` and `source: 'ucdp-candidate'` — no
//    manual override path, per the locked design: unclassified is the
//    honest state until UCDP itself types it. Also direct CSV download, no
//    login.
//
// Countries are matched to conflicts via UCDP's OWN country-code field
// (Gleditsch-Ward numeric codes — `gwno_loc` in the ACD, `country_id` in
// Candidate/GED), never by name-string matching — see
// scripts/lib/gleditschWard.mjs for the code bridge this requires and why.
//
// ---------------------------------------------------------------------------
// WHICH CONFLICTS COUNT AS "CURRENT" (ACD side):
//
// The ACD is one row per conflict per year, going back to 1946. "Current"
// here means: the row for this conflict at MAX_YEAR (the most recent year
// the dataset covers) with `ep_end === '0'` (the conflict's episode had NOT
// ended by that year's end — UCDP's own "still ongoing" signal, distinct
// from a row where the conflict is recorded as having stopped partway
// through the year). In the 26.1 release this is a no-op in practice (every
// MAX_YEAR row happens to have ep_end='0' — UCDP can't yet confirm a
// still-open episode has ended without a subsequent quiet year), but the
// filter is kept for correctness against future releases where that might
// not hold.
//
// ---------------------------------------------------------------------------
// CANDIDATE-VS-ACD MATCHING (the "unclassified" upgrade rule):
//
// Candidate/GED rows are individual violent EVENTS, not conflict-years, and
// cover all three UCDP violence types (state-based, non-state, one-sided).
// Only `type_of_violence === '1'` (state-based armed conflict) rows are
// considered here — ACD's type_of_conflict classification is defined only
// for that category; non-state conflict and one-sided violence are
// different UCDP concepts with their own datasets this script doesn't
// touch.
//
// Each qualifying event carries a `conflict_dset_id` that is EITHER a real
// numeric ACD conflict id, OR one of two "not yet assigned" sentinels
// confirmed by inspecting real 2026 Candidate data: the literal string
// `"XXX<gwcode>"` (UCDP's own placeholder for "no conflict id yet, this
// country"), or an empty string (rarer; falls back to the event's own
// `conflict_new_id`, which lives in a different id space UCDP maintains
// across its non-ACD products and was likewise not found in the ACD set in
// every real case checked).
//
// For each distinct (candidate conflict identifier, country) pair:
//   - If the identifier parses as a plain positive integer AND that integer
//     is a real ACD `conflict_id` (present in ANY year of the full ACD
//     history, not just MAX_YEAR): this conflict already has a real UCDP
//     type. If it was already emitted by the ACD pass above (i.e. it's
//     already active per MAX_YEAR/ep_end), skip it here — don't double-chip
//     the same conflict from both sources. Otherwise, emit it with its real
//     type (from the ACD's own most recent row for that id) but
//     `source: 'ucdp-candidate'`, since its CURRENCY — that it's active
//     again/still, this recently — comes from Candidate, not yet from an
//     annual release.
//   - Otherwise (an "XXX..."/empty sentinel, or a numeric id absent from
//     the entire ACD history): genuinely not yet classified anywhere in
//     UCDP's own annual product. Emit `conflictType: 'unclassified'`,
//     `source: 'ucdp-candidate'`.
//
// Verified against the real July 2026 + Jan-Jun 2026 Candidate files before
// locking this logic: of the state-based conflict identifiers present,
// several (e.g. Iran's Kurdistan/Government conflicts, Syria's Islamic
// State conflict) resolved to real, already-active ACD ids and were
// correctly skipped as duplicates; one (Syria: Suweida, id 16732) resolved
// to a numeric id genuinely absent from the full ACD history and was
// correctly emitted as unclassified; several more (Central African
// Republic, Colombia, Ethiopia, Germany, Haiti, Indonesia, Mexico, Myanmar,
// Nigeria, Pakistan, Turkey, Yemen) came through as literal "XXX<gwcode>"
// placeholders and were likewise emitted as unclassified.
//
// ---------------------------------------------------------------------------
// SANCTIONS — static seed, not a live pipeline (per the locked design), now
// THREE tiers instead of one boolean:
//
//   RED    — comprehensive embargo. Sourced directly from each program's own
//            OFAC regulatory text (Cuba's CACR, Iran's ITSR, and the
//            equivalent North Korea/Syria regulations) — fully verified,
//            per-program, against OFAC's own page for each.
//   ORANGE — sectoral/hybrid. Multiple overlapping sectoral+entity programs
//            requiring general licenses for large activity categories, but
//            not a blanket embargo.
//   YELLOW — list-based only. SDN/Consolidated List screening exposure only
//            — no country-wide sectoral program.
//   null   — no active OFAC country program at all. Hidden in the UI, not
//            rendered as an empty/zero state — same "absence is a real fact"
//            treatment `conflicts: []` already gets.
//
// CONFIDENCE NOTE, per tier: RED is fully verified (see above). ORANGE and
// YELLOW are seeded from secondary-source characterization — cross-
// referenced across several independent sanctions-compliance sites,
// internally consistent with each other, but NOT yet individually checked
// against each country's own OFAC program page the way RED was. Same for
// `sanctionPrograms`' actual program name text at ORANGE/YELLOW: reasonable
// approximations of OFAC's real program naming (most OFAC country programs
// are literally named "<Country>-Related Sanctions" or "<Country>
// Sanctions"), not copied verbatim from each program's own page. **Flagged
// in BACKLOG.md: verify every ORANGE/YELLOW tier assignment and program name
// against its own OFAC program page before this ships as anything more than
// portfolio-demo-confidence data.** This list changes rarely enough that
// hand-updating it beats building a live pull for now — also logged in
// BACKLOG.md as a standing "live OFAC pull" candidate if that stops holding.
//
// Source for all tiers: https://ofac.treasury.gov/sanctions-programs-and-
// country-information (the active program list), plus each country's own
// program page for tier justification.
//
// ---------------------------------------------------------------------------
// Usage:
//   node scripts/buildCurrentStatus.mjs --sample
//     Dry run: the same 15-country reference set buildMilitary.mjs/
//     buildEconomy.mjs use. Prints each country's conflicts/sanctionTier,
//     writes nothing.
//   npm run build:current-status
//     Full run: all 193 countries, writes src/data/currentStatus.ts and
//     appends a generated gap report to BACKLOG.md.
//
// Run via `node`, not `tsx` — same as buildMilitary.mjs/buildEconomy.mjs, no
// existing .ts source needs importing.
import fs from 'node:fs'
import path from 'node:path'
import { feature } from 'topojson-client'
import { parseCsv } from './lib/csv.mjs'
import { readZipEntry } from './lib/zip.mjs'
import { parseGwStatesFile, buildCurrentGwNameMap, GW_NAME_ALIASES } from './lib/gleditschWard.mjs'

const COUNTRIES_SOURCE = 'public/geo/countries-un193.json'
const OUTPUT = 'src/data/currentStatus.ts'
const BACKLOG = 'BACKLOG.md'

// UCDP/PRIO Armed Conflict Dataset, v26.1 (covers 1946-2025). Direct CSV
// download (zipped) — see the header comment above for why this is used
// instead of the token-gated API. Re-run against a newer release by bumping
// this URL/version and deleting the vendored zip to force a re-download.
const PRIO_VERSION = '26.1'
const PRIO_ZIP_URL = 'https://ucdp.uu.se/downloads/ucdpprio/ucdp-prio-acd-261-csv.zip'
const PRIO_ZIP_LOCAL = 'scripts/vendor/ucdp/ucdp-prio-acd-261-csv.zip'

// UCDP Candidate Events Dataset — the two most recent releases available as
// of 2026-08-23: Jan-Jun 2026 combined, plus the individual July 2026
// release (candidate files are monthly with ~1 month lag, so July is the
// most recent month covered). Together these give year-to-date 2026
// coverage, the gap the annual ACD (which stops at 2025) can't yet fill.
// Re-run against newer releases by adding their URLs/local paths here.
const CANDIDATE_VERSION = '26.0.7 (Jan-Jul 2026)'
const CANDIDATE_SOURCES = [
  {
    url: 'https://ucdp.uu.se/downloads/candidateged/GEDEvent_v26_01_26_06.csv',
    local: 'scripts/vendor/ucdp/GEDEvent_v26_01_26_06.csv',
  },
  {
    url: 'https://ucdp.uu.se/downloads/candidateged/GEDEvent_v26_0_7.csv',
    local: 'scripts/vendor/ucdp/GEDEvent_v26_0_7.csv',
  },
]

const GW_IISYSTEM_URL = 'http://ksgleditsch.com/data/iisystem.dat'
const GW_IISYSTEM_LOCAL = 'scripts/vendor/gleditsch-ward/iisystem.dat'
const GW_MICROSTATES_URL = 'http://ksgleditsch.com/data/microstatessystem.dat'
const GW_MICROSTATES_LOCAL = 'scripts/vendor/gleditsch-ward/microstatessystem.dat'

// Three OFAC sanction tiers — see this file's header comment for the tier
// definitions, per-tier confidence, and the BACKLOG.md verification flag on
// ORANGE/YELLOW. Source: https://ofac.treasury.gov/sanctions-programs-and-
// country-information, checked 2026-08-24. Hand-maintained: see the header
// comment for why a live pull isn't built yet.
const SANCTION_TIERS = {
  red: {
    // Fully verified against each program's own OFAC regulatory text.
    Cuba: 'Cuba Sanctions',
    Iran: 'Iran Sanctions',
    'North Korea': 'North Korea Sanctions',
    Syria: 'Syria Sanctions',
  },
  orange: {
    // Secondary-source characterization — see header comment.
    Russia: 'Russian Harmful Foreign Activities Sanctions',
    Belarus: 'Belarus Sanctions',
    Venezuela: 'Venezuela-Related Sanctions',
    Myanmar: 'Burma-Related Sanctions',
    Sudan: 'Sudan-Related Sanctions',
    Nicaragua: 'Nicaragua-Related Sanctions',
  },
  yellow: {
    // Secondary-source characterization — see header comment.
    Afghanistan: 'Afghanistan-Related Sanctions',
    'Central African Republic': 'Central African Republic Sanctions',
    'Democratic Republic of the Congo': 'Democratic Republic of the Congo-Related Sanctions',
    Ethiopia: 'Ethiopia-Related Sanctions',
    Iraq: 'Iraq Stabilization and Insurgency Sanctions',
    Lebanon: 'Lebanon-Related Sanctions',
    Libya: 'Libya Sanctions',
    Mali: 'Mali-Related Sanctions',
    Somalia: 'Somalia Sanctions',
    'South Sudan': 'South Sudan-Related Sanctions',
    Yemen: 'Yemen-Related Sanctions',
  },
}

function resolveSanctionTier(countryName) {
  for (const tier of ['red', 'orange', 'yellow']) {
    const program = SANCTION_TIERS[tier][countryName]
    if (program) return { sanctionTier: tier, sanctionPrograms: [program] }
  }
  return { sanctionTier: null, sanctionPrograms: undefined }
}

const CONFLICT_TYPE_BY_CODE = {
  1: 'extrasystemic',
  2: 'interstate',
  3: 'internal',
  4: 'internationalized_internal',
}

const sampleArg = process.argv.includes('--sample')
const SAMPLE_COUNTRIES = [
  'United States of America', 'China', 'Russia', 'India', 'United Kingdom', 'France', 'Germany', 'Japan',
  'Israel', 'Pakistan', 'North Korea', 'Brazil', 'Poland', 'Luxembourg', 'Costa Rica',
]

// ---------------------------------------------------------------------------
// Fetch helpers (same pattern as buildMilitary.mjs)
// ---------------------------------------------------------------------------
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
// Country list (same as buildMilitary.mjs/buildEconomy.mjs)
// ---------------------------------------------------------------------------
const topology = JSON.parse(fs.readFileSync(COUNTRIES_SOURCE, 'utf8'))
const allCountries = feature(topology, topology.objects.countries)
  .features.map((f) => ({ id: String(f.id), name: f.properties.name }))
  .sort((a, b) => a.name.localeCompare(b.name))

const countries = sampleArg ? allCountries.filter((c) => SAMPLE_COUNTRIES.includes(c.name)) : allCountries

function normalizeName(name) {
  return name
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .trim()
}

const CANONICAL_NAME_LOOKUP = new Map(allCountries.map((c) => [normalizeName(c.name), c]))

// ---------------------------------------------------------------------------
// Gap log
// ---------------------------------------------------------------------------
const gaps = []
function logGap(context, reason) {
  gaps.push({ context, reason })
}

// ---------------------------------------------------------------------------
// Gleditsch-Ward code -> Country resolution (see scripts/lib/gleditschWard.mjs)
// ---------------------------------------------------------------------------
async function loadGwNameMap() {
  await downloadIfMissing(GW_IISYSTEM_LOCAL, GW_IISYSTEM_URL)
  await downloadIfMissing(GW_MICROSTATES_LOCAL, GW_MICROSTATES_URL)
  const entries = [
    ...parseGwStatesFile(fs.readFileSync(GW_IISYSTEM_LOCAL)),
    ...parseGwStatesFile(fs.readFileSync(GW_MICROSTATES_LOCAL)),
  ]
  return buildCurrentGwNameMap(entries)
}

function resolveGwCode(code, gwNameMap, context) {
  const rawName = gwNameMap.get(code)
  if (rawName == null) {
    logGap(context, `Gleditsch-Ward code ${code} has no entry in the source state list at all.`)
    return null
  }
  const normalized = normalizeName(rawName)
  const aliasTarget = GW_NAME_ALIASES[normalized]
  const country = CANONICAL_NAME_LOOKUP.get(normalizeName(aliasTarget ?? rawName))
  if (!country) {
    // Expected for non-UN-member entities UCDP still codes (Kosovo,
    // Abkhazia, South Ossetia, ...) — these have no Country registry entry
    // to attach a conflict to, not a resolution bug.
    logGap(context, `GW code ${code} ("${rawName}") has no UN-193 Country match — likely a non-UN entity.`)
    return null
  }
  return country
}

// ---------------------------------------------------------------------------
// UCDP/PRIO Armed Conflict Dataset (annual)
// ---------------------------------------------------------------------------
async function loadPrioConflicts(gwNameMap) {
  await downloadIfMissing(PRIO_ZIP_LOCAL, PRIO_ZIP_URL)
  const csvBuffer = readZipEntry(fs.readFileSync(PRIO_ZIP_LOCAL), '.csv')
  const rows = parseCsv(csvBuffer.toString('utf8'))
  const header = rows[0]
  const idx = Object.fromEntries(header.map((h, i) => [h, i]))
  const data = rows.slice(1)

  const maxYear = Math.max(...data.map((r) => Number(r[idx.year])))
  console.log(`UCDP/PRIO ACD v${PRIO_VERSION}: ${data.length} conflict-year rows, most recent year ${maxYear}.`)

  // Every conflict_id ever recorded, with its most recent row (used both to
  // look up a conflict's real type when upgrading a Candidate detection, and
  // to know which ids are "known" at all).
  const knownConflicts = new Map()
  for (const r of data) {
    const id = Number(r[idx.conflict_id])
    const year = Number(r[idx.year])
    const existing = knownConflicts.get(id)
    if (!existing || year > existing.year) {
      knownConflicts.set(id, { conflictType: CONFLICT_TYPE_BY_CODE[r[idx.type_of_conflict]], year })
    }
  }

  const activeRows = data.filter((r) => Number(r[idx.year]) === maxYear && r[idx.ep_end] === '0')
  console.log(`  ${activeRows.length} active (ep_end=0) in ${maxYear}.`)

  const entriesByCountryId = new Map()
  const activeConflictIds = new Set()

  for (const r of activeRows) {
    const conflictId = Number(r[idx.conflict_id])
    activeConflictIds.add(conflictId)
    const conflictType = CONFLICT_TYPE_BY_CODE[r[idx.type_of_conflict]]
    const conflictName = `${r[idx.side_a]} vs. ${r[idx.side_b]}`
    const locationCodes = r[idx.gwno_loc]
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean)
      .map(Number)

    for (const code of locationCodes) {
      const country = resolveGwCode(code, gwNameMap, `PRIO conflict_id ${conflictId} (${conflictName})`)
      if (!country) continue
      const list = entriesByCountryId.get(country.id) ?? []
      list.push({
        conflictType,
        conflictName,
        snapshotDate: `UCDP/PRIO ACD v${PRIO_VERSION}`,
        source: 'ucdp-prio-annual',
      })
      entriesByCountryId.set(country.id, list)
    }
  }

  return { entriesByCountryId, knownConflicts, activeConflictIds }
}

// ---------------------------------------------------------------------------
// UCDP Candidate Events Dataset — see header comment for the full matching
// rule this implements.
// ---------------------------------------------------------------------------
async function loadCandidateConflicts(gwNameMap, knownConflicts, activeConflictIds) {
  const allRows = []
  let header = null
  for (const { url, local } of CANDIDATE_SOURCES) {
    await downloadIfMissing(local, url)
    const rows = parseCsv(fs.readFileSync(local, 'utf8'))
    if (!header) header = rows[0]
    allRows.push(...rows.slice(1))
  }
  const idx = Object.fromEntries(header.map((h, i) => [h, i]))

  const stateBased = allRows.filter((r) => r[idx.type_of_violence] === '1')
  console.log(`UCDP Candidate v${CANDIDATE_VERSION}: ${allRows.length} events, ${stateBased.length} state-based.`)

  // Group by (candidate conflict identifier, country) so multiple event rows
  // for the same ongoing conflict produce one chip, not one per event.
  const groups = new Map()
  for (const r of stateBased) {
    const dsetId = r[idx.conflict_dset_id]
    const key = `${dsetId !== '' ? dsetId : `new:${r[idx.conflict_new_id]}`}::${r[idx.country_id]}`
    if (!groups.has(key)) groups.set(key, r)
  }

  const entriesByCountryId = new Map()
  let upgraded = 0
  let unclassified = 0
  let skippedAsDuplicate = 0

  for (const row of groups.values()) {
    const countryCode = Number(row[idx.country_id])
    const country = resolveGwCode(countryCode, gwNameMap, `Candidate conflict "${row[idx.conflict_name]}"`)
    if (!country) continue

    // UCDP's own conflict_name is literally the "XXX<gwcode>" placeholder
    // (see header comment) when no real name has been assigned yet either —
    // that's not a human-readable name, so it's dropped rather than shown.
    const conflictName = /^XXX\d+$/.test(row[idx.conflict_name]) ? undefined : row[idx.conflict_name]

    const dsetId = row[idx.conflict_dset_id]
    const newId = row[idx.conflict_new_id]
    const candidateId = /^\d+$/.test(dsetId) ? Number(dsetId) : /^\d+$/.test(newId) ? Number(newId) : null
    const known = candidateId != null ? knownConflicts.get(candidateId) : undefined

    if (known) {
      if (activeConflictIds.has(candidateId)) {
        skippedAsDuplicate++
        continue // already emitted by the ACD pass — don't double-chip it
      }
      upgraded++
      const list = entriesByCountryId.get(country.id) ?? []
      list.push({
        conflictType: known.conflictType,
        conflictName,
        snapshotDate: `UCDP Candidate v${CANDIDATE_VERSION}`,
        source: 'ucdp-candidate',
      })
      entriesByCountryId.set(country.id, list)
    } else {
      unclassified++
      const list = entriesByCountryId.get(country.id) ?? []
      list.push({
        conflictType: 'unclassified',
        conflictName,
        snapshotDate: `UCDP Candidate v${CANDIDATE_VERSION}`,
        source: 'ucdp-candidate',
      })
      entriesByCountryId.set(country.id, list)
    }
  }

  console.log(
    `  ${groups.size} distinct candidate conflicts: ${upgraded} upgraded (known type, not yet in an active ACD row), ` +
      `${unclassified} unclassified, ${skippedAsDuplicate} skipped as already-active-ACD duplicates.`
  )

  return entriesByCountryId
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------
console.log(`Building Current Status for ${countries.length} ${sampleArg ? 'sample' : ''} countries...`)

const gwNameMap = await loadGwNameMap()
const { entriesByCountryId: prioEntries, knownConflicts, activeConflictIds } = await loadPrioConflicts(gwNameMap)
const candidateEntries = await loadCandidateConflicts(gwNameMap, knownConflicts, activeConflictIds)

function buildCountryStatus(country) {
  const conflicts = [...(prioEntries.get(country.id) ?? []), ...(candidateEntries.get(country.id) ?? [])]
  const { sanctionTier, sanctionPrograms } = resolveSanctionTier(country.name)
  return {
    id: country.id,
    name: country.name,
    conflicts,
    sanctionTier,
    sanctionPrograms,
  }
}

const results = countries.map(buildCountryStatus)

// ---------------------------------------------------------------------------
// Output
// ---------------------------------------------------------------------------
if (sampleArg) {
  for (const r of results) {
    if (r.conflicts.length > 0 || r.sanctionTier != null) console.log(JSON.stringify(r, null, 2))
  }
  console.log(`\nSample run only — wrote nothing.`)
  console.log(`${gaps.length} gap(s) logged.`)
  process.exit(0)
}

function conflictEntryToTs(e) {
  const fields = [
    `conflictType: ${JSON.stringify(e.conflictType)}`,
    e.conflictName != null ? `conflictName: ${JSON.stringify(e.conflictName)}` : null,
    `snapshotDate: ${JSON.stringify(e.snapshotDate)}`,
    `source: ${JSON.stringify(e.source)}`,
  ].filter(Boolean)
  return `{ ${fields.join(', ')} }`
}

function countryToTs(r) {
  const lines = []
  lines.push(`  ${JSON.stringify(r.id)}: {`)
  lines.push(`    name: ${JSON.stringify(r.name)},`)
  if (r.conflicts.length === 0) {
    lines.push(`    conflicts: [],`)
  } else {
    lines.push(`    conflicts: [`)
    for (const e of r.conflicts) lines.push(`      ${conflictEntryToTs(e)},`)
    lines.push(`    ],`)
  }
  lines.push(`    sanctionTier: ${r.sanctionTier === null ? 'null' : JSON.stringify(r.sanctionTier)},`)
  if (r.sanctionPrograms) lines.push(`    sanctionPrograms: ${JSON.stringify(r.sanctionPrograms)},`)
  lines.push(`  },`)
  return lines.join('\n')
}

const header = `// Current Status category data for the Intelligence Engine, generated by
// scripts/buildCurrentStatus.mjs (\`npm run build:current-status\`) per the
// locked design in Intelligence Docs/intelligence-engine-scoring-design.md
// §3.5 — see that script's own header comment for the full UCDP sourcing
// and matching logic.
//
// NOT a 0-100 score, unlike Military/Economy — two independent, categorical
// fields per country. Absence (no conflict, no active OFAC program) is a
// real, positive fact and is always serialized explicitly (conflicts: [],
// sanctionTier: null), never omitted.
//
// Keyed by the SAME numeric ISO topology id scene/useCountryFeatures.ts
// registers Country records under (String(feature.id) from
// countries-un193.json) — same convention as src/data/militaryScores.ts /
// src/data/economyScores.ts.
//
// Re-run the build script (rather than hand-editing this file) to refresh.

export type ConflictType =
  | 'interstate'
  | 'internal'
  | 'internationalized_internal'
  | 'extrasystemic'
  | 'unclassified'

export interface ConflictEntry {
  conflictType: ConflictType
  conflictName?: string
  /** Which UCDP source release this reflects (a version identifier, not a calendar date). */
  snapshotDate: string
  source: 'ucdp-candidate' | 'ucdp-prio-annual'
}

// See this script's own header comment for the tier definitions and the
// BACKLOG.md flag on ORANGE/YELLOW confidence.
export type SanctionTier = 'red' | 'orange' | 'yellow' | null

export interface CurrentStatus {
  name: string
  /** 0, 1, or many — every entry renders as its own chip. */
  conflicts: ConflictEntry[]
  /** null = no active OFAC country program — badge hidden, not a data gap. */
  sanctionTier: SanctionTier
  /** The actual OFAC program name(s), e.g. ['Cuba Sanctions']. Present iff sanctionTier isn't null. */
  sanctionPrograms?: string[]
}

// Keyed by numeric ISO topology id (e.g. "840" for the United States).
export const CURRENT_STATUS: Record<string, CurrentStatus> = {
`

const footer = `}
`

const body = results.map(countryToTs).join('\n')
fs.writeFileSync(OUTPUT, header + body + '\n' + footer)
console.log(`Wrote ${OUTPUT}: ${results.length} countries.`)
console.log(`  With conflicts: ${results.filter((r) => r.conflicts.length > 0).length}`)
console.log(
  `  Sanctioned: ${results.filter((r) => r.sanctionTier != null).length} ` +
    `(red=${results.filter((r) => r.sanctionTier === 'red').length}, ` +
    `orange=${results.filter((r) => r.sanctionTier === 'orange').length}, ` +
    `yellow=${results.filter((r) => r.sanctionTier === 'yellow').length})`
)
console.log(`${gaps.length} gap(s) logged.`)

// ---------------------------------------------------------------------------
// BACKLOG.md — same marker-delimited idempotent append pattern as
// buildMilitary.mjs/buildEconomy.mjs.
// ---------------------------------------------------------------------------
function writeBacklogReport() {
  const BEGIN = '<!-- BEGIN buildCurrentStatus.mjs gap report -->'
  const END = '<!-- END buildCurrentStatus.mjs gap report -->'
  const generatedAt = new Date().toISOString().slice(0, 10)

  const lines = []
  lines.push(BEGIN)
  lines.push('')
  lines.push(
    `**Generated by \`npm run build:current-status\` (\`scripts/buildCurrentStatus.mjs\`), ${generatedAt}.** ` +
      `Gleditsch-Ward country codes referenced by UCDP conflict data that couldn't be resolved to a UN-193 ` +
      `Country this run. Re-running the script regenerates this list.`
  )
  lines.push('')
  lines.push(
    `**Standing deviations/limitations** (see scripts/buildCurrentStatus.mjs's own header comment for the full ` +
      `reasoning): \`sanctionTier\`/\`sanctionPrograms\` are a hand-maintained static seed (three OFAC tiers — ` +
      `RED/ORANGE/YELLOW — as of ${generatedAt}), not a live pull. **RED tier is fully verified** against each ` +
      `program's own OFAC regulatory text (Cuba, Iran, North Korea, Syria). **ORANGE tier** (Russia, Belarus, ` +
      `Venezuela, Myanmar, Sudan, Nicaragua) **and YELLOW tier** (Afghanistan, Central African Republic, ` +
      `Democratic Republic of the Congo, Ethiopia, Iraq, Lebanon, Libya, Mali, Somalia, South Sudan, Yemen) are ` +
      `seeded from secondary-source characterization only — cross-referenced across several independent ` +
      `sanctions-compliance sites, internally consistent, but NOT yet individually checked against each ` +
      `country's own OFAC program page the way RED was, and the \`sanctionPrograms\` name text for those two ` +
      `tiers is a reasonable approximation of OFAC's naming convention, not copied verbatim from each program's ` +
      `own page either. **TODO before this ships as anything more than portfolio-demo-confidence data: verify ` +
      `every ORANGE/YELLOW tier assignment and program name against https://ofac.treasury.gov/sanctions-` +
      `programs-and-country-information and each country's own program page.** Separately: this whole dataset ` +
      `is a static seed, not a live pull — **candidate for a live OFAC pull** if this project ever needs ` +
      `sanction-status freshness tighter than "update by hand when it changes." And unrelated to sanctions: the ` +
      `UCDP API (as opposed to the direct CSV downloads this script uses) requires a free but manually-issued ` +
      `access token — not something this script can obtain on its own; if a future need arises for API-only ` +
      `UCDP data (e.g. finer-grained event queries), that token would need to be requested by a human from ` +
      `UCDP's API maintainer first.`
  )
  lines.push('')
  if (gaps.length === 0) {
    lines.push('- None this run — every referenced Gleditsch-Ward code resolved to a UN-193 Country.')
  } else {
    const sortedGaps = gaps.slice().sort((a, b) => a.context.localeCompare(b.context))
    for (const g of sortedGaps) lines.push(`- **[${g.context}]:** ${g.reason}`)
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
    const heading = '\n## Data sourcing (`buildCurrentStatus.mjs`)\n\n'
    const introEnd = backlog.indexOf('\n## ')
    updated = introEnd === -1 ? backlog + heading + section + '\n' : backlog.slice(0, introEnd) + heading + section + '\n' + backlog.slice(introEnd)
  }
  fs.writeFileSync(BACKLOG, updated)
  console.log(`Updated ${BACKLOG}: ${gaps.length} gap(s) logged.`)
}

writeBacklogReport()
