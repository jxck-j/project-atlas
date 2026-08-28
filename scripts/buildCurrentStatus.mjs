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
// Countries are matched to conflicts primarily via UCDP's OWN country-code
// field (Gleditsch-Ward numeric codes — `gwno_loc` in the ACD, `country_id`
// in Candidate/GED), never by name-string matching — see scripts/lib/
// gleditschWard.mjs for the code bridge this requires and why. For Candidate/
// GED specifically, `country_id` is where a violent EVENT happened, not who
// fought it — a state whose entire involvement is off its own soil (an
// airstrike campaign, say) never has an event location on its own territory,
// so location-only matching would silently drop it from its own record even
// though UCDP's own side_a/side_b fields name it as a combatant. To catch
// that, loadCandidateConflicts() ALSO resolves every named side_a/side_b
// government against the UN-193 list (name-string matching, the one
// deliberate exception to the rule above — there's no GW-code field for
// "every side of this event," only for "where it happened") and attaches the
// conflict to the union of event-location countries and resolved party
// countries. See that function's own comment for the real case (2025 US/
// Israel strikes on Iran) this was caught against, and LOGBOOK.md for the
// full trail. The ACD (annual) pass doesn't need this: its own `gwno_loc`
// already lists every named side's territory, not just one event's location.
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
// For each distinct candidate conflict identifier (grouped across ALL its
// event rows, regardless of location — see above for why location isn't part
// of the group key):
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
// DEMOGRAPHICS (ethnicGroups/religions). NOT a score — informational only,
// like conflicts/sanctionTier above. ethnicGroups and religions resolve
// their OWN source through TWO DIFFERENT, INDEPENDENT priority chains — this
// was ARDA's own religion coverage being meaningfully better than UNSD's for
// religion specifically, not a reason to touch ethnicity, which keeps its
// original two-tier chain unchanged:
//
//   ethnicGroups: UNSD (tableCode 26) -> CIA Factbook.
//   religions:    ARDA World Religion Database -> UNSD (tableCode 28) ->
//                 CIA Factbook.
//
// A country can still take ethnicity from one source and religion from a
// completely different one — nothing here couples the two fields together.
//
// ---------------------------------------------------------------------------
// ETHNICITY — UN Statistics Division's Demographic Statistics Database
// (data.un.org / UNdata), tableCode 26 ("Population by national and/or
// ethnic group, sex and urban/rural residence") primary, CIA Factbook
// fallback. Census-reported, national-statistics-office-sourced counts, not
// Factbook's own free-text summaries. No documented bulk-CSV API exists, but
// UNdata's own "Export" button hits a real, unauthenticated, CORS-open
// endpoint (UNSD_DOWNLOAD_BASE below, confirmed by driving the actual UNdata
// UI and capturing the resulting request) that returns a zipped CSV — the
// same "found a legitimate direct path around a gated/undocumented UI"
// precedent as buildMilitary.mjs's SIPRI TIV reverse-engineering.
//
// INGESTION: filtered to Area="Total" (excludes Urban/Rural breakdowns) and
// Sex="Both Sexes" (excludes Male/Female breakdowns) rows only — country-
// level total composition. Per country, the most recent Year that has an
// explicit group row literally named "Total" is chosen (a year's row set
// with no such row — several real cases: Argentina 2022 only asked two
// supplementary African-descent/Indigenous yes/no questions, not a full
// ethnic breakdown; Bangladesh 2022 only lists indigenous/tribal groups
// summing to a small fraction of the population; Uruguay's 2011 rows happen
// to sum close to its real population but were never published with an
// explicit Total row — is NOT usable as a percentage denominator and is
// treated the same as "UNSD has nothing for this country," falling through
// to Factbook, rather than inferring a total by summing components, which
// risks silently including overlapping/non-exhaustive categories). Real
// counts, not percentages — pct = groupValue / totalValue × 100 for that
// country/year. A duplicate (country, year, group) row across two Record
// Types (a real case: Fiji 2007 has both a de facto and de jure census;
// Malaysia 2010 has two "de jure" rows with different values, an apparent
// UNSD export inconsistency) is resolved deterministically — de jure
// preferred over de facto over anything else, ties broken by keeping
// whichever was encountered first — and logged as a demographics gap either
// way, since a silent pick among genuinely conflicting source numbers isn't
// something to hide.
//
// "Not Stated"/"Unknown"/"Refused to Respond" (real population that didn't
// answer the census question, not an ethnic/religious group) and a literal
// "Other" category are never excluded from storage here — this script keeps
// every real UNSD row — but hud/demographicsGrouping.ts's
// groupTopFourPlusOther() (the shared, source-agnostic render-time
// transform) excludes them from the top-4 RANKING POOL specifically, always
// folding them into the synthesized "Other" bucket regardless of their own
// size. Same rule for Factbook's own literal "other" entries (previously
// allowed to rank normally by size — e.g. Germany's "other/stateless/
// unspecified" at 8.3% used to occupy a real top-4 slot; a compound label
// like that one is NOT a literal "Other" match and still ranks normally,
// only an exact "Other" is folded).
//
// QUALITY GATE: a UNSD result whose single LARGEST group is one of these
// generic/residual labels, covering most of the country, is rejected here
// (treated the same as "UNSD has nothing for this field," triggering the
// Factbook fallback below) rather than stored — see
// isDominatedByGenericBucket() below for the real cases this was built
// against (Poland, Costa Rica, Colombia, Bolivia, and — before religion
// moved to ARDA below — Germany) and why a same-size Factbook figure is
// strictly more informative every time. Ethnicity-only now (religion no
// longer goes through UNSD first — see below), but left in place unchanged
// since UNSD ethnicity tables can have this exact same quirk.
//
// FALLBACK: for ethnicity UNSD doesn't cover, CIA World Factbook
// (factbook.json) — parseFactbookPctList() extracts every comma-separated
// "<name> <pct>%" clause from Factbook's free text (see that function's own
// comment for the real messy cases it has to handle: HTML entities, nested
// parentheticals, leading-dot decimals). A country with nothing parseable
// from EITHER source gets `undefined`, never a guess.
//
// ---------------------------------------------------------------------------
// RELIGION — ARDA World Religion Database primary, UNSD tableCode 28
// fallback, CIA Factbook final fallback. Changed from UNSD-primary to
// ARDA-primary because ARDA's coverage is close to universal (confirmed
// against the full ~250-nation ARDA list) and its category structure is
// consistently religion-specific — UNSD's own religion table has real gaps
// (Russia has zero rows: religion has never been a census question there)
// and the same generic-bucket problem ethnicity's quality gate above exists
// for (Germany's UNSD religion table codes 51.80% as a literal "Other" row).
//
// PRIMARY: thearda.com/world-religion/national-profiles, the "Religious
// Adherents" table on each country's own profile page (query param
// `u={code}c` — ARDA_NAME_ALIASES below bridges the ~13 real name mismatches
// between ARDA's own country list and this project's UN-193 topology
// names). Sourced from Brill's World Religion Database (an academic
// compilation curated by a named editor, not a national census) — cited as
// "World Religion Database (Brill), via ARDA" in religionsSnapshotDate,
// dated by the WRD EDITION year shown in the page's own table heading
// ("Religious Adherents (World Religion Database, 2025)"), not any
// country-specific census year, since the underlying figures are compiled/
// modeled estimates on the compilation's own timeline.
//
// KNOWN CAVEAT, deliberately worked around: an ARDA profile page ALSO
// carries a separate, State Department IRF-based prose narrative
// ("Religious demographics" section, further down the same page) that has
// been observed to disagree with the page's own WRD table (Sudan's prose
// says "an estimated 70 percent of the population is Muslim," while the WRD
// table's own Muslims row says 91.36%) — only the WRD "Religious Adherents"
// TABLE is ever parsed here; the prose is never read at all, so the two
// can't get crossed.
//
// CATEGORY GRANULARITY — every top-level religion is used as its own single
// candidate EXCEPT Christians, which is expanded into its own indented
// sub-denomination rows (Catholics, Protestants, Orthodox, Independents,
// unaffiliated Christians, ...) instead — each sub-denomination competes
// directly against every other religion's top-level row in the SAME ranking
// pool (parseArdaAdherentsTable()/buildArdaCandidates() below), not nested
// under one combined "Christians" bucket. This is a deliberate,
// per-denomination-competition design (confirmed against a real case,
// Sudan: Catholics 3.22% and Ethnic religionists 2.77% both individually
// outrank a combined "Christians" total would have looked like) — a country
// with a large, denominationally fragmented Christian population can
// plausibly show MULTIPLE Christian sub-groups in its top 4 (e.g. Catholics
// AND Protestants) at once, while a country with a dominant single religion
// may show no Christian sub-group at all if none individually clears the
// top-4 cutoff at render time. A non-Christian top-level religion's own
// sub-rows (Sunnis/Shias under Muslims, Vaishnavites/Shaivites/Saktists
// under Hindus, ...) are never expanded this way — they're read but
// discarded, real constituent detail with no display path in this design.
//
// A top-level row occasionally has no value of its own (rendered "---" on
// the page) while ITS OWN children do — Sudan's "Non-Religious" row is
// blank, but its children "Agnostics" (0.90%) and "Atheists" (0.15%) are
// real, measured values. Confirmed with the user rather than guessed: when
// a non-Christian top-level row is blank, its children are used as
// individual candidates instead (the same per-item competition Christian
// sub-denominations get) rather than silently discarding real, sourced
// data; when the top-level row DOES have a value, its children are ignored
// even if populated (Muslims' 91.36% is used as-is; its Sunni 91.30%/Shia
// 0.07% breakdown is discarded), so this fallback only ever activates on a
// genuinely blank parent, never as a way to double-count.
//
// If Christians' sub-denomination rows don't sum to the parent "Christians"
// total (a real remainder — unlisted minor denominations, not just
// independent per-row rounding), the shortfall becomes its own "Other
// Christian" candidate, competing normally like any other candidate rather
// than being force-added to the render-time "Other" bucket directly —
// CHRISTIAN_REMAINDER_THRESHOLD_PCT (0.5 points) is a deliberate floor
// below which a shortfall is treated as ordinary independent-rounding noise
// (5-6 percentages, each already rounded to 2 decimals, rarely sum back to
// the parent's own rounded figure exactly) and produces no synthetic
// candidate at all — confirmed against Sudan's own real numbers, where the
// 5 Christian sub-rows actually sum to SLIGHTLY MORE than the parent
// (5.04% vs. 4.80%), a real case with no shortfall to route anywhere.
//
// Categories below 1% are sometimes hidden from ARDA's own chart view but
// remain present in the underlying WRD table — this script parses the
// table's raw HTML rows directly, never the chart, so a sub-1% group (most
// of Sudan's own Christian sub-denominations, several of its non-Christian
// top-level rows) is never silently missing.
//
// FALLBACK: for any country ARDA has no profile for, UNSD's own religion
// table (tableCode 28, same ingestion/quality-gate rules as ethnicity
// above) — then CIA Factbook for anything neither covers.
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
import { ALPHA3_TO_NUMERIC } from './lib/iso3166.mjs'
import { ISO3_TO_GEC } from './lib/gecCrossReference.mjs'

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

// CIA World Factbook (factbook.json) — same source/snapshot family as
// buildMilitary.mjs's personnel fallback; see this file's own DEMOGRAPHICS
// header comment above.
const FACTBOOK_SNAPSHOT_DATE = '2026-01'
const FACTBOOK_TREE_URL = 'https://api.github.com/repos/factbook/factbook.json/git/trees/master?recursive=1'
const FACTBOOK_RAW_BASE = 'https://raw.githubusercontent.com/factbook/factbook.json/master'

// UNSD Demographic Statistics Database — see this file's own DEMOGRAPHICS
// header comment for the endpoint's own real-request provenance. Zipped CSV,
// same "download once, vendor it, re-fetch only if missing" pattern as every
// other external source here.
const UNSD_DOWNLOAD_BASE = 'https://data.un.org/Handlers/DownloadHandler.ashx?DataMartId=POP&Format=csv&DataFilter=tableCode:'
const UNSD_ETHNIC_TABLE_CODE = 26
const UNSD_RELIGION_TABLE_CODE = 28
const UNSD_ETHNIC_ZIP_LOCAL = 'scripts/vendor/unsd/unsd-ethnic-tablecode26.zip'
const UNSD_RELIGION_ZIP_LOCAL = 'scripts/vendor/unsd/unsd-religion-tablecode28.zip'

// UNSD's own "Country or Area" text doesn't match this project's UN-193
// topology names for every country — long-form UN institutional names
// ("Bolivia (Plurinational State of)"), a different Korea/Vietnam/Laos/
// Brunei spelling, etc. Built by diffing UNSD's real, full country list
// against this project's own 193-name list (not guessed) — see LOGBOOK.md.
// Every entry here is a genuine UN member; the ~30 non-matching UNSD names
// NOT in this table are non-UN territories (American Samoa, Bermuda, Guam,
// Puerto Rico, Åland Islands, ...), correctly left unmapped so they're
// never matched to a Country record that isn't theirs.
const UNSD_NAME_ALIASES = {
  'Bolivia (Plurinational State of)': 'Bolivia',
  'Brunei Darussalam': 'Brunei',
  'Iran (Islamic Republic of)': 'Iran',
  "Lao People's Democratic Republic": 'Laos',
  'Micronesia (Federated States of)': 'Micronesia',
  'Republic of Korea': 'South Korea',
  'Republic of Moldova': 'Moldova',
  'Russian Federation': 'Russia',
  'United Kingdom of Great Britain and Northern Ireland': 'United Kingdom',
  'Venezuela (Bolivarian Republic of)': 'Venezuela',
  'Viet Nam': 'Vietnam',
}

// ARDA (thearda.com) World Religion Database — primary source for religion,
// see this file's own DEMOGRAPHICS header comment. The no-query-param
// national-profiles page returns the full ~250-entry country/region <select>
// list (both cheap and stable — confirmed by fetching it with no `u` param
// at all), which is how ARDA_CODE_BY_NAME below gets built; a per-country
// profile page is `${ARDA_PROFILE_URL_BASE}{code}`.
const ARDA_LIST_URL = 'https://www.thearda.com/world-religion/national-profiles'
const ARDA_PROFILE_URL_BASE = 'https://www.thearda.com/world-religion/national-profiles?u='
const ARDA_LIST_CACHE_LOCAL = 'scripts/vendor/arda/_country-list.html'
const ARDA_PROFILE_CACHE_DIR = 'scripts/vendor/arda/profiles'

// A country whose own top-level "Christians" row is expanded into its
// indented sub-denomination rows (see header comment) can have those rows
// sum to slightly more OR less than the parent's own rounded total, purely
// from each figure being independently rounded to 2 decimals — Sudan's real
// 5 sub-rows sum to 5.04% against a parent of 4.80%, an EXCESS, not a
// shortfall. Only a shortfall past this threshold is treated as a real,
// worth-recording remainder (an unlisted minor denomination) rather than
// rounding noise; an excess, or a shortfall below it, produces no synthetic
// candidate at all.
const CHRISTIAN_REMAINDER_THRESHOLD_PCT = 0.5

// ARDA's own country/region names don't match this project's UN-193
// topology names for every country — built by diffing ARDA's real, full
// list (fetched from ARDA_LIST_URL, not guessed) against this project's own
// 193-name list, the same process UNSD_NAME_ALIASES above used. Every entry
// here is a genuine UN member; ARDA's own list also includes ~60 non-UN
// entries (Akrotiri, Antarctica, Puerto Rico, ...) that are correctly left
// unmapped. Diacritics alone ("São Tomé and Príncipe") don't need an entry
// here — normalizeName() already strips those before matching.
const ARDA_NAME_ALIASES = {
  Bahamas: 'Bahamas, The',
  Congo: 'Congo, Republic of the',
  'Democratic Republic of the Congo': 'Congo, Democratic Republic of the',
  Czechia: 'Czech Republic',
  Eswatini: 'Swaziland',
  Gambia: 'Gambia, The',
  Micronesia: 'Micronesia, Federated States of',
  'North Korea': 'Korea, (North) Democratic Republic of',
  'South Korea': 'Korea, (South) Republic of',
  Turkey: 'Turkey/Türkiye',
  'United States of America': 'United States (General)',
  Vietnam: 'Viet Nam',
}

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

// ---------------------------------------------------------------------------
// Country list (same as buildMilitary.mjs/buildEconomy.mjs)
// ---------------------------------------------------------------------------
const topology = JSON.parse(fs.readFileSync(COUNTRIES_SOURCE, 'utf8'))
const allCountries = feature(topology, topology.objects.countries)
  .features.map((f) => ({ id: String(f.id), name: f.properties.name }))
  .sort((a, b) => a.name.localeCompare(b.name))

const countries = sampleArg ? allCountries.filter((c) => SAMPLE_COUNTRIES.includes(c.name)) : allCountries

// alpha3 -> numeric topology id (same source as buildMilitary.mjs), reversed
// so a Country's numeric id can be resolved back to alpha3 -> GEC ->
// factbook.json path for demographics. Taiwan (id 'taiwan', not a numeric
// topology id) is handled as a special case in resolveDemographics below,
// the same way buildMilitary.mjs hand-resolves Taiwan's own factbook path.
const NUMERIC_TO_ALPHA3 = Object.fromEntries(Object.entries(ALPHA3_TO_NUMERIC).map(([a3, num]) => [num, a3]))

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

// Separate from `gaps` above (which is specifically about GW-code
// resolution) — this is its own gap category (demographics sourcing/
// parsing) with its own BACKLOG.md section, per this file's own DEMOGRAPHICS
// header comment.
const demographicGaps = []
function logDemographicGap(context, reason) {
  demographicGaps.push({ context, reason })
}

// ---------------------------------------------------------------------------
// Demographics (ethnicity + religion) — CIA World Factbook. See this file's
// own DEMOGRAPHICS header comment for the full sourcing/parsing rationale.
// ---------------------------------------------------------------------------

// factbook.json's free-text fields carry real HTML entities (Brazil's
// religion text has "Candombl&eacute;", "Esp&iacute;rita"; Chad/Kenya/
// Jamaica's ethnic/religion text has stray "&nbsp;"; China's religion text
// has "Hindu &lt; 0.1%"), left un-decoded — decoding them BEFORE parsing
// matters, not just for display: an un-decoded "&lt;" isn't whitespace or a
// real "<" character, so it doesn't get cleaned up as either. The standard
// HTML4/Latin-1 named-entity set (the same ~96-entry table every browser
// ships) plus numeric entities (&#NNN;/&#xHH;) covers every real case found
// across a full 194-country run — see this function's own caller.
const NAMED_HTML_ENTITIES = {
  amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ',
  iexcl: '¡', cent: '¢', pound: '£', curren: '¤', yen: '¥', brvbar: '¦', sect: '§', uml: '¨',
  copy: '©', ordf: 'ª', laquo: '«', not: '¬', shy: '­', reg: '®', macr: '¯', deg: '°',
  plusmn: '±', sup2: '²', sup3: '³', acute: '´', micro: 'µ', para: '¶', middot: '·', cedil: '¸',
  sup1: '¹', ordm: 'º', raquo: '»', frac14: '¼', frac12: '½', frac34: '¾', iquest: '¿',
  Agrave: 'À', Aacute: 'Á', Acirc: 'Â', Atilde: 'Ã', Auml: 'Ä', Aring: 'Å', AElig: 'Æ', Ccedil: 'Ç',
  Egrave: 'È', Eacute: 'É', Ecirc: 'Ê', Euml: 'Ë', Igrave: 'Ì', Iacute: 'Í', Icirc: 'Î', Iuml: 'Ï',
  ETH: 'Ð', Ntilde: 'Ñ', Ograve: 'Ò', Oacute: 'Ó', Ocirc: 'Ô', Otilde: 'Õ', Ouml: 'Ö', times: '×',
  Oslash: 'Ø', Ugrave: 'Ù', Uacute: 'Ú', Ucirc: 'Û', Uuml: 'Ü', Yacute: 'Ý', THORN: 'Þ', szlig: 'ß',
  agrave: 'à', aacute: 'á', acirc: 'â', atilde: 'ã', auml: 'ä', aring: 'å', aelig: 'æ', ccedil: 'ç',
  egrave: 'è', eacute: 'é', ecirc: 'ê', euml: 'ë', igrave: 'ì', iacute: 'í', icirc: 'î', iuml: 'ï',
  eth: 'ð', ntilde: 'ñ', ograve: 'ò', oacute: 'ó', ocirc: 'ô', otilde: 'õ', ouml: 'ö', divide: '÷',
  oslash: 'ø', ugrave: 'ù', uacute: 'ú', ucirc: 'û', uuml: 'ü', yacute: 'ý', thorn: 'þ', yuml: 'ÿ',
}

function decodeHtmlEntities(text) {
  return text.replace(/&(#\d+|#x[0-9a-fA-F]+|[a-zA-Z]+);/g, (match, entity) => {
    if (entity[0] === '#') {
      const codePoint = entity[1].toLowerCase() === 'x' ? parseInt(entity.slice(2), 16) : parseInt(entity.slice(1), 10)
      return Number.isFinite(codePoint) ? String.fromCodePoint(codePoint) : match
    }
    return NAMED_HTML_ENTITIES[entity] ?? match
  })
}

// A real Factbook data-quality quirk, distinct from an HTML ENTITY
// (decodeHtmlEntities above) — an actual literal tag character sequence
// sitting in the .text field itself, not just referenced by name. Sweden's
// ethnicity text is wrapped in a stray "<p>...</p>"; Eswatini's is too (that
// one has no percentages either way, so the tag was never the reason it was
// unparseable, but it's the same underlying data quirk). Requires a real
// closing "\>" to match, so it can never touch a lone "<" that's actually a
// decoded "&lt;" sitting next to a number (China's "Hindu < 0.1%" has no
// ">" anywhere near it).
function stripHtmlTags(text) {
  return text.replace(/<\/?[a-zA-Z][^<>]*>/g, ' ')
}

// Splits on commas AND semicolons at paren-depth 0 only, so a clause like
// "other 1.2% (includes Filipino, Brazilian, ...)" stays one segment instead
// of shattering on its own inner commas. Semicolons are a second, real
// top-level separator Factbook's own text uses interchangeably with commas
// — sometimes between two parallel list items (treated identically to a
// comma there), sometimes introducing an entirely different descriptive
// clause (Portugal's ethnicity text: "Portuguese 95%; citizens from
// Portugal's former colonies in Africa, Asia...") — either way, splitting on
// it the same way a comma already is lets the "<name> <pct>%" matcher below
// find Portugal's clean "Portuguese 95%" instead of the semicolon swallowing
// it into one long, doomed-to-fail segment.
function splitTopLevelSeparators(text) {
  const segments = []
  let depth = 0
  let current = ''
  for (const ch of text) {
    if (ch === '(') depth++
    else if (ch === ')') depth = Math.max(0, depth - 1)
    if ((ch === ',' || ch === ';') && depth === 0) {
      segments.push(current)
      current = ''
    } else {
      current += ch
    }
  }
  if (current.trim()) segments.push(current)
  return segments
}

// Removes every parenthesized span from a segment entirely (not just
// balance-tracked for splitting, like splitTopLevelSeparators above — the
// content is discarded). Needed because a real segment can bury its OWN
// unrelated percentage inside a parenthetical aside BEFORE its real,
// top-level one — Taiwan's factbook.json ethnicity text is the real case
// that caught this: "Han Chinese (including Holo, who compose approximately
// 70% of Taiwan's population, Hakka, ...) more than 95%" — without
// stripping, SEGMENT_NAME_PCT_RE's first-match-wins scan finds the
// parenthetical's "70%" and misattributes it to "Han Chinese" instead of the
// real, top-level "95%" that follows the closing paren. Losing a
// parenthetical annotation that happens to sit BEFORE a segment's own real
// percentage (e.g. "Igbo (Ibo) 15.2%" -> name "Igbo", dropping "(Ibo)") is
// an accepted, minor tradeoff for getting the number right.
function stripParentheticals(text) {
  let result = ''
  let depth = 0
  for (const ch of text) {
    if (ch === '(') depth++
    else if (ch === ')') depth = Math.max(0, depth - 1)
    else if (depth === 0) result += ch
  }
  return result
}

// Matches "<name> <low>-<high>%" at the START of a (parenthetical-stripped)
// segment — a real, common Factbook pattern for an uncertain share ("Greek
// Orthodox 81-90%", "Turkish 70-75%"), tried BEFORE the single-value regex
// below since a plain "\d+%" pattern never matches a range at all (the
// first number is followed by "-", not "%" or whitespace-then-%) — real
// bug this project shipped and then caught: Greece's religion list and
// Turkey's ethnicity list were both missing their single LARGEST group
// entirely (Greek Orthodox, Turkish) because every other real group in
// each country's text happened to have a single-value share and only the
// majority group was expressed as a range, so the whole segment silently
// failed to match and got dropped — nothing in either country's output
// looked obviously wrong (no error, just a materially incomplete bar) until
// visually spotted. The midpoint of the range is stored as the point
// estimate — the simplest defensible single number to represent an
// uncertain span, and Factbook itself doesn't offer anything more precise.
const SEGMENT_NAME_PCT_RANGE_RE = /^(.+?)\s+(\d+(?:\.\d+)?)\s*-\s*(\d+(?:\.\d+)?)\s*%/

// Matches "<name> <pct>%" at the START of a (parenthetical-stripped)
// segment, non-greedy, so a trailing aside/qualifier text past the number is
// ignored. The pct alternation's second branch (`\.\d+`) is for a real case
// with no leading zero — Brazil's "Indigenous religions .06%".
const SEGMENT_NAME_PCT_RE = /^(.+?)\s+(\d+(?:\.\d+)?|\.\d+)\s*%/

// Last-resort fallback, tried only when NEITHER regex above matches anything
// at all: a real Factbook typo — Andorra's religion text has "Christian
// (predominantly Roman Catholic) 89.5, other 8.8%, unaffiliated 1.7%" — the
// FIRST entry is missing its own "%" entirely (every other entry in the same
// field has one), so it silently failed to match and Andorra's dominant
// ~90% group was dropped. Requires the stripped segment to be JUST "<name>
// <number>" with nothing else at all (see the "consumes to end" check
// below, which already rejects a bare number buried in unrelated trailing
// prose) — a bare trailing number in a field that's otherwise entirely
// percentage-shaped is a safe, narrow inference, not a guess about what
// number it might be.
const SEGMENT_NAME_BARE_NUMBER_RE = /^(.+?)\s+(\d+(?:\.\d+)?)$/

// A name captured right up against a qualifier word/symbol that itself
// precedes the percentage ("Han Chinese ... more than 95%" -> name capture
// ends in "more than"; a decoded "Hindu &lt; 0.1%" -> name capture ends in
// "Hindu <") reads oddly left in — trimmed off the end of the captured name
// only (never mid-name), the percentage value itself is unaffected either
// way.
const TRAILING_QUALIFIER_RE = /\s*(?:more than|approximately|about|over|nearly|up to|[<>~])\s*$/i

// A real Factbook data typo — DR Congo's religion text has "Christian
// 93/1%", almost certainly a "." rendered as "/" (confirmed: the same
// clause's own parenthetical breakdown, "Roman Catholic 29.9%, Protestant
// 26.7%, other Christian 36.5%," sums to exactly 93.1). Narrowly scoped to
// digits-slash-digits immediately before a "%" so it can never touch a real
// "/"-separated compound name like Nigeria's "Kanuri/Beriberi 2.4%" (letters
// on at least one side of that slash, not digits on both).
function normalizeSlashDecimals(text) {
  return text.replace(/(\d)\/(\d+)(?=\s*%)/g, '$1.$2')
}

// Repeatedly matches "<name> <pct>%" from the START of `text`, consuming
// each match and continuing on whatever's left — a real, confirmed Factbook
// typo is a MISSING COMMA between two otherwise-clean list items (Cameroon's
// religion text has "...Protestant 27.1% other Christian 6.1%..." with no
// comma at all between "27.1%" and "other"; Iceland's has the same pattern).
// A single non-looped match would either drop the second item silently (the
// original behavior) or, combined with the introduced "must consume to the
// end" check, wrongly reject BOTH items just because leftover text remained
// after the first match — looping recovers every real item in a run rather
// than either extreme. Returns `{ groups, remainder }`; the caller decides
// whether a non-trivial remainder invalidates the whole segment (DR Congo's
// narrative-sentence case, where the "leftover" is unrelated prose, not a
// dropped-comma continuation).
function matchRepeatedPctClauses(text) {
  const groups = []
  let remaining = text
  while (true) {
    const rangeMatch = remaining.match(SEGMENT_NAME_PCT_RANGE_RE)
    const m = rangeMatch ?? remaining.match(SEGMENT_NAME_PCT_RE)
    if (!m) break
    const pct = rangeMatch ? (Number(m[2]) + Number(m[3])) / 2 : Number(m[2])
    if (!Number.isFinite(pct)) break
    const name = m[1].replace(TRAILING_QUALIFIER_RE, '').replace(/\s+/g, ' ').trim()
    if (name) groups.push({ name, pct })
    remaining = remaining.slice(m[0].length).trim()
    if (remaining === '') break
  }
  return { groups, remainder: remaining }
}

function parseFactbookPctList(text) {
  if (!text) return []
  // Strip a trailing "(YYYY[-YY] [est.])"-shaped snapshot-year annotation
  // off the WHOLE string first, so it's never mistaken for its own segment.
  const withoutYear = stripHtmlTags(normalizeSlashDecimals(text)).replace(
    /\s*\([^()]*\b(?:19|20)\d{2}\b[^()]*\)\s*$/,
    ''
  )
  const groups = []
  for (const rawSegment of splitTopLevelSeparators(withoutYear)) {
    const segment = rawSegment.trim().replace(/^and\s+/i, '')
    const stripped = stripParentheticals(segment)

    const { groups: matched, remainder } = matchRepeatedPctClauses(stripped)
    // Reject the WHOLE segment (even any real matches found before hitting
    // unparseable text) if what's left over isn't trivial — the signal that
    // caught DR Congo's ethnicity text ("more than 200 African ethnic
    // groups...the four largest groups - Mongo, Luba, Kongo (all Bantu),
    // and the Mangbetu-Azande (Hamitic) - make up about 45% of the
    // population"): the loop still finds a "45%" and captures "the
    // Mangbetu-Azande - make up about" as if it were that group's own name,
    // but a real list of clauses never has substantial prose left over
    // after its own last percentage — only whitespace and, at most, a
    // trailing period do. A missing-comma continuation (Cameroon, Iceland)
    // never trips this: the loop just keeps matching until nothing's left.
    if (matched.length > 0) {
      if (/^[\s.]*$/.test(remainder)) groups.push(...matched)
      continue
    }

    // Loop found nothing at all (no "%" anywhere in this segment) — last
    // resort: a bare "<name> <number>" with NOTHING else, a real Factbook
    // typo (Andorra's religion text has "Christian (predominantly Roman
    // Catholic) 89.5," — missing its own "%" entirely, the only entry in
    // that field without one). Never looped — a field this malformed isn't
    // trusted to chain further matches.
    const bare = stripped.match(SEGMENT_NAME_BARE_NUMBER_RE)
    if (!bare) continue
    const pct = Number(bare[2])
    if (!Number.isFinite(pct)) continue
    const name = bare[1].replace(TRAILING_QUALIFIER_RE, '').replace(/\s+/g, ' ').trim()
    if (!name) continue
    groups.push({ name, pct })
  }
  return groups.sort((a, b) => b.pct - a.pct)
}

// Taiwan (id 'taiwan') has no numeric topology id/ALPHA3_TO_NUMERIC entry —
// resolved directly to its known ISO alpha-3 ('TWN'), the same one-off
// buildMilitary.mjs/buildEconomy.mjs/buildTechnology.mjs each already do for
// Taiwan's own real sourcing. Taiwan is also never in UNSD (a UN body — see
// resolveDemographics below), so this is a Factbook-only path for it either
// way.
//
// `needs` ({needsEthnic, needsReligion}) tells this function which field(s)
// the caller actually still needs — since now ARDA/UNSD often resolve
// religion while ethnicity still needs Factbook (or vice versa), calling
// this unconditionally for whichever field triggered the fetch and logging
// a gap for BOTH fields regardless would misreport an already-resolved
// field as unsourced (a real case this was caught against: with ARDA
// covering ~194/194 countries for religion, every one of the ~81 countries
// whose ETHNICITY needs Factbook would otherwise also log a spurious
// "Religions ... left unsourced" gap even though religion is fully ARDA-
// sourced for all of them). Only the needed field(s) are parsed/logged;
// the other is always returned as `undefined`, same as before.
async function resolveFactbookDemographics(country, factbookPathByGec, needs) {
  const { needsEthnic, needsReligion } = needs
  const alpha3 = country.id === 'taiwan' ? 'TWN' : NUMERIC_TO_ALPHA3[country.id]
  const gec = alpha3 ? ISO3_TO_GEC[alpha3] : undefined
  const factbookPath = gec ? factbookPathByGec[gec.toLowerCase()] : undefined
  if (!factbookPath) {
    if (needsEthnic) logDemographicGap(`${country.name} (Factbook fallback)`, 'No factbook.json path resolved for this country — left unsourced.')
    if (needsReligion) logDemographicGap(`${country.name} (Factbook fallback)`, 'No factbook.json path resolved for this country — left unsourced.')
    return { ethnicGroups: undefined, religions: undefined }
  }

  let doc
  try {
    doc = await fetchJsonRetry(`${FACTBOOK_RAW_BASE}/${factbookPath}`)
  } catch (err) {
    if (needsEthnic) logDemographicGap(`${country.name} (Factbook fallback)`, `factbook.json fetch failed (${err.message}) — left unsourced.`)
    if (needsReligion) logDemographicGap(`${country.name} (Factbook fallback)`, `factbook.json fetch failed (${err.message}) — left unsourced.`)
    return { ethnicGroups: undefined, religions: undefined }
  }

  const peopleAndSociety = doc['People and Society'] ?? {}
  // Decoded BEFORE parsing, not just before display — an un-decoded "&lt;"
  // or "&nbsp;" isn't whitespace or punctuation to parseFactbookPctList, so
  // it wouldn't get cleaned up as either if left encoded.
  let ethnicGroups = []
  if (needsEthnic) {
    const rawEthnicText = peopleAndSociety['Ethnic groups']?.text
    const ethnicText = rawEthnicText ? decodeHtmlEntities(rawEthnicText) : rawEthnicText
    ethnicGroups = parseFactbookPctList(ethnicText)
    if (!ethnicText) logDemographicGap(`${country.name} (Factbook fallback)`, 'No "Ethnic groups" field in factbook.json — left unsourced.')
    else if (ethnicGroups.length === 0)
      logDemographicGap(`${country.name} (Factbook fallback)`, `"Ethnic groups" text has no parseable percentages ("${ethnicText}") — left unsourced.`)
  }
  let religions = []
  if (needsReligion) {
    const rawReligionText = peopleAndSociety['Religions']?.text
    const religionText = rawReligionText ? decodeHtmlEntities(rawReligionText) : rawReligionText
    religions = parseFactbookPctList(religionText)
    if (!religionText) logDemographicGap(`${country.name} (Factbook fallback)`, 'No "Religions" field in factbook.json — left unsourced.')
    else if (religions.length === 0)
      logDemographicGap(`${country.name} (Factbook fallback)`, `"Religions" text has no parseable percentages ("${religionText}") — left unsourced.`)
  }

  return {
    ethnicGroups: ethnicGroups.length > 0 ? ethnicGroups : undefined,
    religions: religions.length > 0 ? religions : undefined,
  }
}

// ---------------------------------------------------------------------------
// UNSD Demographic Statistics Database (primary source) — see this file's
// own DEMOGRAPHICS header comment for the endpoint/ingestion rationale.
// ---------------------------------------------------------------------------

// Reverse of UNSD_NAME_ALIASES (that table is keyed by UNSD's own name, for
// readability against real UNSD output when it was built — see LOGBOOK.md);
// resolution needs the other direction, app Country -> UNSD's name.
const APP_NAME_TO_UNSD_NAME = Object.fromEntries(Object.entries(UNSD_NAME_ALIASES).map(([unsdName, appName]) => [appName, unsdName]))

function resolveUnsdCountryName(country) {
  return APP_NAME_TO_UNSD_NAME[country.name] ?? country.name
}

// Downloads/unzips/parses one UNSD table into plain row objects. Both tables
// (26, 28) share an identical column ORDER (only the 5th column's NAME
// differs — "National and/or ethnic group" vs "Religion" — its VALUES are
// read positionally either way, so one loader serves both). The export
// bundles a second "footnoteSeqID,Footnote" glossary table after the real
// data, in the SAME file — sliced off before it's ever read as a data row
// (confirmed by inspecting the raw export: real data ends and a literal
// "footnoteSeqID","Footnote" header starts partway through the file).
async function loadUnsdTable(zipLocal, tableCode) {
  await downloadIfMissing(zipLocal, `${UNSD_DOWNLOAD_BASE}${tableCode}`)
  const csvBuffer = readZipEntry(fs.readFileSync(zipLocal), '.csv')
  const rows = parseCsv(csvBuffer.toString('utf8'))
  const footnoteIdx = rows.findIndex((r) => r[0] === 'footnoteSeqID')
  const data = rows.slice(1, footnoteIdx === -1 ? undefined : footnoteIdx)
  return data.map((r) => ({
    country: r[0],
    year: r[1],
    area: r[2],
    sex: r[3],
    group: r[4],
    recordType: r[5],
    value: r[8],
  }))
}

// de jure (legal/usual residence — the standard census definition) preferred
// over de facto (present-on-census-night) over anything else (a sample
// survey, say), for the real case of a country reporting both for the same
// year (Fiji 2007). Ties within the SAME record type but different values
// (Malaysia 2010 — an apparent UNSD export inconsistency, not something this
// script can resolve authoritatively) keep whichever row was encountered
// first; either way, a real conflict is logged, never silently picked.
const UNSD_RECORD_TYPE_PRIORITY = {
  'Census - de jure - complete tabulation': 0,
  'Census - de facto - complete tabulation': 1,
}
function unsdRecordTypeRank(recordType) {
  return UNSD_RECORD_TYPE_PRIORITY[recordType] ?? 2
}

// A UNSD table's own residual/non-response labels — the exact literal
// values found across both table 26 (ethnic) and table 28 (religion), not a
// guess. Exact-match only (case-insensitive), same discipline
// hud/demographicsGrouping.ts's NON_RANKABLE_NAMES already uses — "Other
// Asian"/"Other Christians"/etc. are real, specific groups and must not
// match. Kept as its own (slightly larger) list rather than importing that
// one: this is a build-time SOURCE-SELECTION decision (which dataset to
// trust for a field), not the render-time GROUPING decision that module
// makes, and a plain Node script can't cheaply import a Vite-bundled .ts
// module — keep the two lists in sync by hand if either grows.
const GENERIC_BUCKET_NAMES = new Set([
  'other', 'not stated', 'not specified', 'not applicable', 'not asked', 'not declared',
  'unknown', 'refused to respond', 'refused to answer',
])

// Real cases this was built against, all verified by hand against the raw
// UNSD export AND factbook.json before shipping: Poland's ethnic table 26
// (2021 census) codes 98.19% of the population as a literal "Other" row —
// the census schedule only enumerates named minority nationalities, so the
// (implicitly Polish) majority has no row of its own in UNSD's export at
// all — while Factbook plainly states "Polish 96.9%". Same shape for Costa
// Rica (94.10% "Other"), Colombia (87.58% "Other"), Bolivia (58.25%
// "Unknown"), and Germany's religion table (51.80% "Other", vs. Factbook's
// explicit "none 43.8%, other 5.1%"). In every one of these, a UNSD result
// that's technically present and adds to ~100% is still LESS informative
// than what Factbook already has, because the single largest slice has no
// real name. 50% is a deliberate, documented threshold, not a derived one —
// low enough to catch every real case found (the lowest was Germany's
// 51.80%), high enough that an ordinary, modestly-sized "other" bucket (a
// genuinely diverse country where minor groups collectively aren't the
// majority) is left alone.
const GENERIC_BUCKET_DOMINANCE_THRESHOLD_PCT = 50

function isDominatedByGenericBucket(groups) {
  const top = groups[0]
  return top != null && GENERIC_BUCKET_NAMES.has(top.name.trim().toLowerCase()) && top.pct >= GENERIC_BUCKET_DOMINANCE_THRESHOLD_PCT
}

// Resolves one country's ethnicGroups OR religions from one already-loaded
// UNSD table. Returns null (never a guessed/partial result) when this table
// has nothing USABLE for this country — either no rows at all (not
// covered), rows exist but no year has an explicit "Total" group row to use
// as a percentage denominator (see this file's own DEMOGRAPHICS header
// comment for the real cases — Argentina/Bangladesh/Uruguay all have real
// rows with no Total row among them), or a resolvable result whose largest
// group is a dominant generic/residual bucket (isDominatedByGenericBucket()
// above) — a real result, but one Factbook can do better on for this
// specific country. Every one of these is treated identically by the
// caller: whichever field comes back null here falls through to Factbook.
function resolveUnsdGroups(rows, unsdCountryName, fieldLabel, country) {
  const filtered = rows.filter((r) => r.country === unsdCountryName && r.area === 'Total' && r.sex === 'Both Sexes')
  if (filtered.length === 0) return null

  const byYear = new Map()
  for (const r of filtered) {
    if (!byYear.has(r.year)) byYear.set(r.year, [])
    byYear.get(r.year).push(r)
  }
  const yearsWithTotal = [...byYear.keys()].filter((y) => byYear.get(y).some((r) => r.group === 'Total'))
  if (yearsWithTotal.length === 0) return null
  const chosenYear = yearsWithTotal.sort((a, b) => Number(b) - Number(a))[0]

  const byGroup = new Map()
  for (const r of byYear.get(chosenYear)) {
    const value = Number(r.value)
    if (!Number.isFinite(value)) continue
    const rank = unsdRecordTypeRank(r.recordType)
    const existing = byGroup.get(r.group)
    if (!existing) {
      byGroup.set(r.group, { value, rank, recordType: r.recordType })
      continue
    }
    if (existing.value !== value) {
      logDemographicGap(
        `${country.name} (${fieldLabel}, UNSD)`,
        `${chosenYear}: duplicate "${r.group}" rows across record types with different values ` +
          `(${existing.recordType}: ${existing.value} vs ${r.recordType}: ${value}) — kept the ` +
          `${rank < existing.rank ? r.recordType : existing.recordType} figure.`
      )
    }
    if (rank < existing.rank) byGroup.set(r.group, { value, rank, recordType: r.recordType })
  }

  const total = byGroup.get('Total')
  if (!total || total.value <= 0) return null

  const groups = []
  for (const [name, { value }] of byGroup) {
    if (name === 'Total') continue
    groups.push({ name, pct: (value / total.value) * 100 })
  }
  if (groups.length === 0) return null

  const sorted = groups.sort((a, b) => b.pct - a.pct)
  if (isDominatedByGenericBucket(sorted)) {
    logDemographicGap(
      `${country.name} (${fieldLabel}, UNSD)`,
      `${chosenYear}: largest group is "${sorted[0].name}" at ${sorted[0].pct.toFixed(2)}% — a generic/` +
        `residual bucket dominating the result, not a real named group. Deferred to the Factbook fallback ` +
        `instead of storing this (see isDominatedByGenericBucket()'s own comment for the reasoning).`
    )
    return null
  }

  return { groups: sorted, snapshotDate: `UNSD ${chosenYear}` }
}

// ---------------------------------------------------------------------------
// ARDA World Religion Database — religion's primary source. See this file's
// own DEMOGRAPHICS header comment for the full sourcing/design rationale.
// ---------------------------------------------------------------------------

// ARDA's country/region <select> list, fetched once (no `u` param at all
// still returns the full list — confirmed by driving the real page) and
// cached like every other vendored source here. Keyed by normalizeName() of
// ARDA's own raw option text so a lookup doesn't need to match casing or
// diacritics exactly.
async function loadArdaCodeByName() {
  await downloadIfMissing(ARDA_LIST_CACHE_LOCAL, ARDA_LIST_URL)
  const html = fs.readFileSync(ARDA_LIST_CACHE_LOCAL, 'utf8')
  const codeByName = new Map()
  const optionRe = /<option value="(\d+c)">([^<]*)<\/option>/gi
  let m
  while ((m = optionRe.exec(html))) {
    codeByName.set(normalizeName(decodeHtmlEntities(m[2])), m[1])
  }
  return codeByName
}

function resolveArdaCode(country, ardaCodeByName) {
  const ardaName = ARDA_NAME_ALIASES[country.name] ?? country.name
  return ardaCodeByName.get(normalizeName(ardaName)) ?? null
}

// Extracts the WRD edition year from the table's own heading — "Religious
// Adherents (World Religion Database, 2025)" — rather than hardcoding it, so
// a future ARDA edition bump is picked up automatically without a code
// change; see this file's own DEMOGRAPHICS header comment for why this
// (not a country-specific census year) is what religionsSnapshotDate cites.
function extractArdaEditionYear(html) {
  const match = html.match(/Religious Adherents \(World Religion Database,\s*(\d{4})\)/)
  return match ? match[1] : 'edition year unknown'
}

// Parses the "Religious Adherents" table (id="ADHWCD") into a flat, ordered
// row list — {name, value, bold}, one per <tr> — WITHOUT yet applying the
// parent/child/Christian-expansion rules (buildArdaCandidates() below does
// that). `bold` is the real signal ARDA's own HTML uses to distinguish a
// top-level religion row from an indented sub-row (wrapped in <b>...</b> vs.
// plain text prefixed "--" — see this file's own DEMOGRAPHICS header
// comment). A single-country profile request (this script never batches
// multiple `u=` codes) always has exactly one data column right after the
// name column, so the SECOND <td> in each row is always this country's own
// value, never a neighboring region/world column. Returns null if the table
// itself isn't present on the page at all (a profile with no religion data,
// e.g. an uninhabited ARDA entry).
function extractArdaTableRows(html) {
  const tableStart = html.indexOf('<table id="ADHWCD"')
  if (tableStart === -1) return null
  const tableEnd = html.indexOf('</table>', tableStart)
  if (tableEnd === -1) return null
  const tableHtml = html.slice(tableStart, tableEnd)

  const rows = []
  const rowRe = /<tr>([\s\S]*?)<\/tr>/g
  let rowMatch
  while ((rowMatch = rowRe.exec(tableHtml))) {
    const cellRe = /<td[^>]*>([\s\S]*?)<\/td>/g
    const cells = []
    let cellMatch
    while (cells.length < 2 && (cellMatch = cellRe.exec(rowMatch[1]))) {
      cells.push(cellMatch[1])
    }
    if (cells.length < 2) continue // a <th> header row, not a data row
    const [nameCellHtml, valueCellHtml] = cells

    const bold = /<b>/.test(nameCellHtml)
    const nameText = decodeHtmlEntities(stripHtmlTags(nameCellHtml)).trim()
    const name = nameText.replace(/^--\s*/, '').trim()
    if (!name) continue

    const valueText = decodeHtmlEntities(stripHtmlTags(valueCellHtml)).trim()
    const valueMatch = valueText.match(/(-?\d+(?:\.\d+)?)\s*%/)
    const value = valueMatch ? Number(valueMatch[1]) : null

    rows.push({ name, value, bold })
  }
  return rows
}

// Applies the CATEGORY GRANULARITY rules from this file's own DEMOGRAPHICS
// header comment to a flat row list, producing the actual candidate pool
// {name, pct}[] that competes for top-4 slots at render time
// (hud/demographicsGrouping.ts). Every top-level (bold) row starts a new
// group with whatever non-bold rows immediately follow it as its children:
//   - "Christians": always expanded into its own children as individual
//     candidates, regardless of whether the parent itself has a value; a
//     real shortfall between the children's sum and the parent's own total
//     (past CHRISTIAN_REMAINDER_THRESHOLD_PCT, to ignore ordinary
//     independent-rounding noise) becomes its own "Other Christian"
//     candidate.
//   - every other top-level row: used AS-IS if it has a real value > 0
//     (children discarded, even if populated — Muslims' own Sunni/Shia
//     breakdown never becomes individual candidates); if it has NO value at
//     all, its children are used as individual candidates instead (Sudan's
//     blank "Non-Religious" parent with real "Agnostics"/"Atheists"
//     children is the real case this was built against — confirmed with
//     the user rather than assumed, since it isn't literally what the
//     original spec's own example list described).
// A 0.00% value (a true, sourced zero) and "---" (not applicable/no data,
// parsed as `value: null`) are both excluded from the candidate pool either
// way — neither contributes anything to a ranked, non-zero display.
function buildArdaCandidates(rows) {
  const candidates = []
  let i = 0
  while (i < rows.length) {
    const row = rows[i]
    if (!row.bold) {
      i++ // a child row with no preceding top-level parent — shouldn't happen; skip defensively
      continue
    }
    let j = i + 1
    const children = []
    while (j < rows.length && !rows[j].bold) {
      children.push(rows[j])
      j++
    }

    if (row.name === 'Christians') {
      let childSum = 0
      for (const child of children) {
        if (child.value != null && child.value > 0) {
          candidates.push({ name: child.name, pct: child.value })
          childSum += child.value
        }
      }
      if (row.value != null) {
        const remainder = row.value - childSum
        if (remainder > CHRISTIAN_REMAINDER_THRESHOLD_PCT) {
          candidates.push({ name: 'Other Christian', pct: remainder })
        }
      }
    } else if (row.value != null && row.value > 0) {
      candidates.push({ name: row.name, pct: row.value })
    } else {
      for (const child of children) {
        if (child.value != null && child.value > 0) {
          candidates.push({ name: child.name, pct: child.value })
        }
      }
    }

    i = j
  }
  return candidates.sort((a, b) => b.pct - a.pct)
}

async function resolveArdaReligion(country, ardaCodeByName) {
  const code = resolveArdaCode(country, ardaCodeByName)
  if (!code) {
    logDemographicGap(`${country.name} (religion, ARDA)`, 'No matching ARDA country/region code — falling through to UNSD/Factbook.')
    return null
  }

  const localPath = `${ARDA_PROFILE_CACHE_DIR}/${code}.html`
  let html
  try {
    await downloadIfMissing(localPath, `${ARDA_PROFILE_URL_BASE}${code}`)
    html = fs.readFileSync(localPath, 'utf8')
  } catch (err) {
    logDemographicGap(`${country.name} (religion, ARDA)`, `Profile page fetch failed (${err.message}) — falling through to UNSD/Factbook.`)
    return null
  }

  const rows = extractArdaTableRows(html)
  if (!rows || rows.length === 0) {
    logDemographicGap(`${country.name} (religion, ARDA)`, 'No "Religious Adherents" table on this profile page — falling through to UNSD/Factbook.')
    return null
  }

  const candidates = buildArdaCandidates(rows)
  if (candidates.length === 0) {
    logDemographicGap(
      `${country.name} (religion, ARDA)`,
      'Religious Adherents table parsed but produced no usable (non-zero) candidate groups — falling through to UNSD/Factbook.'
    )
    return null
  }

  return { groups: candidates, snapshotDate: `World Religion Database (Brill), via ARDA ${extractArdaEditionYear(html)}` }
}

// Orchestrator. ethnicGroups: UNSD, then Factbook. religions: ARDA, then
// UNSD, then Factbook — see this file's own DEMOGRAPHICS header comment for
// why religion's chain is longer and independent of ethnicity's. Taiwan
// skips UNSD entirely (never a UN member, confirmed absent from both
// tables' full country lists) rather than wasting a lookup that can never
// match; it's still tried against ARDA like any other country/region.
async function resolveDemographics(country, unsdEthnicRows, unsdReligionRows, factbookPathByGec, ardaCodeByName) {
  const unsdCountryName = country.id === 'taiwan' ? undefined : resolveUnsdCountryName(country)
  const unsdEthnic = unsdCountryName ? resolveUnsdGroups(unsdEthnicRows, unsdCountryName, 'ethnicity', country) : null

  const ardaReligion = await resolveArdaReligion(country, ardaCodeByName)
  const unsdReligion =
    !ardaReligion && unsdCountryName ? resolveUnsdGroups(unsdReligionRows, unsdCountryName, 'religion', country) : null

  const needsEthnic = !unsdEthnic
  const needsReligion = !ardaReligion && !unsdReligion
  const factbook =
    needsEthnic || needsReligion
      ? await resolveFactbookDemographics(country, factbookPathByGec, { needsEthnic, needsReligion })
      : { ethnicGroups: undefined, religions: undefined }

  return {
    ethnicGroups: unsdEthnic ? unsdEthnic.groups : factbook.ethnicGroups,
    ethnicGroupsSnapshotDate: unsdEthnic
      ? unsdEthnic.snapshotDate
      : factbook.ethnicGroups
        ? `CIA Factbook ${FACTBOOK_SNAPSHOT_DATE}`
        : undefined,
    religions: ardaReligion ? ardaReligion.groups : unsdReligion ? unsdReligion.groups : factbook.religions,
    religionsSnapshotDate: ardaReligion
      ? ardaReligion.snapshotDate
      : unsdReligion
        ? unsdReligion.snapshotDate
        : factbook.religions
          ? `CIA Factbook ${FACTBOOK_SNAPSHOT_DATE}`
          : undefined,
  }
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

// Splits a Candidate/GED side_a or side_b cell ("Government of Israel,
// Government of United States of America") into its individual named
// parties, and resolves each to a UN-193 Country where possible — used by
// loadCandidateConflicts below to attach a conflict to every state actually
// fighting it, not just the country where a given violent event happened to
// occur (see that function's own comment for why country_id/gwno_loc alone
// under-attributes a conflict like an airstrike campaign to the state
// actually conducting it). A non-state side (a rebel group name) never
// resolves and is silently skipped — correct, it isn't a country. Mirrors
// hud/IntelligencePanel.tsx's resolvePartyCountryIds(), which does the same
// parsing at render time for click-to-highlight — duplicated rather than
// imported, since this is a plain Node build script and that's a React/TS
// module, but kept deliberately in lockstep: the country a user can
// highlight by clicking a chip should be the same country this script
// attached the underlying data to.
function resolvePartyCountryName(rawName) {
  const stripped = rawName.startsWith('Government of ') ? rawName.slice('Government of '.length) : rawName
  const direct = CANONICAL_NAME_LOOKUP.get(normalizeName(stripped))
  if (direct) return direct
  // Historical/Gleditsch-Ward-style government names UCDP's own side_a/
  // side_b text uses ("Yemen (North Yemen)", "Myanmar (Burma)", "Russia
  // (Soviet Union)") aren't literal matches for this project's canonical
  // UN-193 name, but always start with it.
  for (const c of allCountries) {
    if (stripped.startsWith(`${c.name} (`)) return c
  }
  return null
}

function resolvePartyCountries(sideText) {
  if (!sideText) return []
  return sideText
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
    .map(resolvePartyCountryName)
    .filter((c) => c != null)
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

  // Group by candidate conflict identifier ALONE (not identifier+country —
  // see below for why), collecting every distinct event LOCATION seen for
  // that conflict plus one representative row (side_a/side_b/conflict_name
  // are consistent across a conflict's own event rows, so any one row is
  // enough for those fields).
  const conflictGroups = new Map()
  for (const r of stateBased) {
    const dsetId = r[idx.conflict_dset_id]
    const identifier = dsetId !== '' ? dsetId : `new:${r[idx.conflict_new_id]}`
    let group = conflictGroups.get(identifier)
    if (!group) {
      group = { representativeRow: r, locationCodes: new Set() }
      conflictGroups.set(identifier, group)
    }
    group.locationCodes.add(Number(r[idx.country_id]))
  }

  const entriesByCountryId = new Map()
  let upgraded = 0
  let unclassified = 0
  let skippedAsDuplicate = 0
  let attributedByParty = 0

  for (const [identifier, { representativeRow: row, locationCodes }] of conflictGroups) {
    const dsetId = row[idx.conflict_dset_id]
    const newId = row[idx.conflict_new_id]
    const candidateId = /^\d+$/.test(dsetId) ? Number(dsetId) : /^\d+$/.test(newId) ? Number(newId) : null
    const known = candidateId != null ? knownConflicts.get(candidateId) : undefined

    if (known && activeConflictIds.has(candidateId)) {
      skippedAsDuplicate++
      continue // already emitted by the ACD pass — don't double-chip it
    }

    // Attach to every country genuinely involved: each event LOCATION (the
    // country_id/gwno_loc UCDP itself records), UNION every named side_a/
    // side_b government that resolves to a real Country — not location
    // alone. UCDP's Candidate/GED `country_id` is where a violent event
    // physically happened, not who's fighting it: a state conducting an
    // entirely off-its-own-soil campaign (e.g. the 2025 US/Israel strikes
    // on Iranian targets, identifier "new:16905" below) never appears as
    // any event's location, so location-only matching silently dropped it
    // from that state's own record even though UCDP's own side_b field
    // names it as a combatant — see LOGBOOK.md's entry on this for the real
    // case (Iran vs. Israel+US) this was caught against. The ACD (annual)
    // pass above doesn't have this gap — its own `gwno_loc` field already
    // lists every named side's territory, not just one event's location
    // (confirmed against conflict_id 16099, the UK/US vs. Yemen row: gwno_
    // loc = "2, 200, 678", i.e. USA+UK+Yemen — all three, not just Yemen).
    const targets = new Map()
    for (const code of locationCodes) {
      const country = resolveGwCode(code, gwNameMap, `Candidate conflict "${row[idx.conflict_name]}"`)
      if (country) targets.set(country.id, country)
    }
    const locationOnlyCount = targets.size
    for (const country of [...resolvePartyCountries(row[idx.side_a]), ...resolvePartyCountries(row[idx.side_b])]) {
      targets.set(country.id, country)
    }
    if (targets.size > locationOnlyCount) attributedByParty++
    if (targets.size === 0) {
      logGap(
        `Candidate conflict "${row[idx.conflict_name]}" (${identifier})`,
        'Neither the event location(s) nor any named side_a/side_b party resolved to a UN-193 Country.'
      )
      continue
    }

    // UCDP's own conflict_name is literally the "XXX<gwcode>" placeholder
    // (see header comment) when no real name has been assigned yet either —
    // that's not a human-readable name, so it's dropped rather than shown.
    const conflictName = /^XXX\d+$/.test(row[idx.conflict_name]) ? undefined : row[idx.conflict_name]
    const entry = {
      conflictType: known ? known.conflictType : 'unclassified',
      conflictName,
      snapshotDate: `UCDP Candidate v${CANDIDATE_VERSION}`,
      source: 'ucdp-candidate',
    }
    if (known) upgraded++
    else unclassified++

    // Same entry object shared across every target country — fine, this
    // only ever gets read back out and re-stringified per country
    // (countryToTs below), never mutated.
    for (const country of targets.values()) {
      const list = entriesByCountryId.get(country.id) ?? []
      list.push(entry)
      entriesByCountryId.set(country.id, list)
    }
  }

  console.log(
    `  ${conflictGroups.size} distinct candidate conflicts: ${upgraded} upgraded (known type, not yet in an active ` +
      `ACD row), ${unclassified} unclassified, ${skippedAsDuplicate} skipped as already-active-ACD duplicates, ` +
      `${attributedByParty} attached to at least one country via a named side_a/side_b party beyond its event ` +
      `location(s).`
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

console.log('Fetching UNSD demographics tables (ethnicity tableCode 26, religion tableCode 28)...')
const unsdEthnicRows = await loadUnsdTable(UNSD_ETHNIC_ZIP_LOCAL, UNSD_ETHNIC_TABLE_CODE)
const unsdReligionRows = await loadUnsdTable(UNSD_RELIGION_ZIP_LOCAL, UNSD_RELIGION_TABLE_CODE)
console.log(
  `  ${unsdEthnicRows.length} ethnic-group rows across ${new Set(unsdEthnicRows.map((r) => r.country)).size} countries/territories.`
)
console.log(
  `  ${unsdReligionRows.length} religion rows across ${new Set(unsdReligionRows.map((r) => r.country)).size} countries/territories.`
)

console.log('Fetching factbook.json file tree (for the demographics fallback)...')
const factbookTree = await fetchJsonRetry(FACTBOOK_TREE_URL)
const gecLowerToPath = {}
for (const entry of factbookTree.tree) {
  const m = entry.path.match(/^([a-z0-9-]+)\/([a-z]{2})\.json$/)
  if (m) gecLowerToPath[m[2]] = entry.path
}

console.log('Fetching ARDA World Religion Database country/region list (religion primary source)...')
const ardaCodeByName = await loadArdaCodeByName()
console.log(`  ${ardaCodeByName.size} ARDA country/region entries.`)

console.log(`Resolving demographics (ethnicity/religion) for ${countries.length} countries...`)
const demographicsById = new Map()
await mapWithConcurrency(countries, 8, async (country) => {
  demographicsById.set(
    country.id,
    await resolveDemographics(country, unsdEthnicRows, unsdReligionRows, gecLowerToPath, ardaCodeByName)
  )
})
const taiwanDemographics = await resolveDemographics(
  { id: 'taiwan', name: 'Taiwan' },
  unsdEthnicRows,
  unsdReligionRows,
  gecLowerToPath,
  ardaCodeByName
)
const allDemographics = [...demographicsById.values()]
console.log(
  `  Ethnicity sourced: ${allDemographics.filter((d) => d.ethnicGroups).length}/${countries.length} ` +
    `(UNSD: ${allDemographics.filter((d) => d.ethnicGroupsSnapshotDate?.startsWith('UNSD')).length}, ` +
    `Factbook: ${allDemographics.filter((d) => d.ethnicGroupsSnapshotDate?.startsWith('CIA')).length}).`
)
console.log(
  `  Religion sourced: ${allDemographics.filter((d) => d.religions).length}/${countries.length} ` +
    `(ARDA: ${allDemographics.filter((d) => d.religionsSnapshotDate?.startsWith('World Religion Database')).length}, ` +
    `UNSD: ${allDemographics.filter((d) => d.religionsSnapshotDate?.startsWith('UNSD')).length}, ` +
    `Factbook: ${allDemographics.filter((d) => d.religionsSnapshotDate?.startsWith('CIA')).length}).`
)

function buildCountryStatus(country) {
  const conflicts = [...(prioEntries.get(country.id) ?? []), ...(candidateEntries.get(country.id) ?? [])]
  const { sanctionTier, sanctionPrograms } = resolveSanctionTier(country.name)
  const demographics = demographicsById.get(country.id) ?? {}
  return {
    id: country.id,
    name: country.name,
    conflicts,
    sanctionTier,
    sanctionPrograms,
    ethnicGroups: demographics.ethnicGroups,
    ethnicGroupsSnapshotDate: demographics.ethnicGroupsSnapshotDate,
    religions: demographics.religions,
    religionsSnapshotDate: demographics.religionsSnapshotDate,
  }
}

const results = countries.map(buildCountryStatus)

// TAIWAN (added alongside a direct request to also recognize Taiwan across
// the Intelligence Engine's analytics — see CLAUDE.md). Unlike
// Military/Technology, no alternate source was needed here — this
// category's own UCDP/OFAC sourcing already covers Taiwan on its own terms:
// UCDP's armed-conflict threshold (25+ battle-related deaths/year) hasn't
// been crossed by the current China-Taiwan tension (a real, positive
// "no active conflict" fact, not a coverage gap the way it would be for a
// WDI-excluded economic indicator), and Taiwan carries no active OFAC
// country program. Not derived from `prioEntries`/`candidateEntries`
// (those are keyed by this app's 193-country topology ids, which Taiwan
// isn't part of) — both fields are explicit, honest empties, the same
// "absence is a real, positive fact" convention every other country's
// non-conflict/non-sanctioned record already uses.
results.push({
  id: 'taiwan',
  name: 'Taiwan',
  conflicts: [],
  sanctionTier: null,
  sanctionPrograms: undefined,
  ethnicGroups: taiwanDemographics.ethnicGroups,
  ethnicGroupsSnapshotDate: taiwanDemographics.ethnicGroupsSnapshotDate,
  religions: taiwanDemographics.religions,
  religionsSnapshotDate: taiwanDemographics.religionsSnapshotDate,
})

// ---------------------------------------------------------------------------
// Output
// ---------------------------------------------------------------------------
if (sampleArg) {
  for (const r of results) {
    if (r.conflicts.length > 0 || r.sanctionTier != null || r.ethnicGroups || r.religions) console.log(JSON.stringify(r, null, 2))
  }
  console.log(`\nSample run only — wrote nothing.`)
  console.log(`${gaps.length} GW-code gap(s), ${demographicGaps.length} demographics gap(s) logged.`)
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

function demographicGroupToTs(g) {
  return `{ name: ${JSON.stringify(g.name)}, pct: ${g.pct} }`
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
  if (r.ethnicGroups) {
    lines.push(`    ethnicGroups: [${r.ethnicGroups.map(demographicGroupToTs).join(', ')}],`)
    lines.push(`    ethnicGroupsSnapshotDate: ${JSON.stringify(r.ethnicGroupsSnapshotDate)},`)
  }
  if (r.religions) {
    lines.push(`    religions: [${r.religions.map(demographicGroupToTs).join(', ')}],`)
    lines.push(`    religionsSnapshotDate: ${JSON.stringify(r.religionsSnapshotDate)},`)
  }
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
// src/data/economyScores.ts — EXCEPT Taiwan, keyed by its GeoEntity
// registry id ('taiwan') instead, the same exception those two already
// established. Taiwan's own conflicts/sanctionTier are both real, honest
// empties (no UCDP-recorded armed conflict, no active OFAC program) rather
// than sourcing gaps — see this script's own TAIWAN comment.
//
// ethnicGroups/religions (UNSD primary, CIA Factbook fallback — see this
// script's own DEMOGRAPHICS header comment) are the full, real, pct-
// descending list the resolved source reports — undefined (never an empty
// array) when NEITHER source has anything usable for that field, the same
// "omit, don't fabricate" convention as every other sourcing gap in this
// file. Grouping into "top 4 + Other" for display is a render-time concern
// (hud/demographicsGrouping.ts), not done here. Each field's own
// ethnicGroupsSnapshotDate/religionsSnapshotDate records which source AND
// which year/snapshot resolved it ("UNSD 2011" or "CIA Factbook 2026-01") —
// ethnicity and religion can come from different sources for the same
// country, so this is per-field, not one shared date.
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

// One entry per ethnicGroups/religions item, as the resolved source (UNSD or
// Factbook — see ethnicGroupsSnapshotDate/religionsSnapshotDate below)
// reports it — no "Other" bucket here (that's synthesized at render time,
// see hud/demographicsGrouping.ts's groupTopFourPlusOther, which is also
// where a synthesized "Other" bucket's own breakdown field gets attached,
// and where a literal "Other"/UNSD's "Not Stated"/"Unknown"/"Refused to
// Respond" are excluded from the top-4 ranking pool regardless of size).
export interface DemographicGroup {
  name: string
  pct: number
}

export interface CurrentStatus {
  name: string
  /** 0, 1, or many — every entry renders as its own chip. */
  conflicts: ConflictEntry[]
  /** null = no active OFAC country program — badge hidden, not a data gap. */
  sanctionTier: SanctionTier
  /** The actual OFAC program name(s), e.g. ['Cuba Sanctions']. Present iff sanctionTier isn't null. */
  sanctionPrograms?: string[]
  /** Sorted pct descending. Undefined (never []) when neither UNSD nor Factbook has anything usable. */
  ethnicGroups?: DemographicGroup[]
  /** e.g. "UNSD 2011" or "CIA Factbook 2026-01" — which source AND snapshot resolved ethnicGroups. Present iff ethnicGroups is. */
  ethnicGroupsSnapshotDate?: string
  /** Sorted pct descending. Undefined (never []) when neither UNSD nor Factbook has anything usable. */
  religions?: DemographicGroup[]
  /** e.g. "UNSD 2010" or "CIA Factbook 2026-01" — which source AND snapshot resolved religions. Present iff religions is. */
  religionsSnapshotDate?: string
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
console.log(
  `  Ethnicity sourced: ${results.filter((r) => r.ethnicGroups).length}/${results.length}. ` +
    `Religion sourced: ${results.filter((r) => r.religions).length}/${results.length}.`
)
console.log(`${gaps.length} GW-code gap(s), ${demographicGaps.length} demographics gap(s) logged.`)

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

// Separate marker-delimited section from the GW-code gap report above — a
// different gap category (demographics sourcing/parsing), see
// logDemographicGap's own comment.
function writeDemographicsBacklogReport() {
  const BEGIN = '<!-- BEGIN buildCurrentStatus.mjs demographics gap report -->'
  const END = '<!-- END buildCurrentStatus.mjs demographics gap report -->'
  const generatedAt = new Date().toISOString().slice(0, 10)

  const lines = []
  lines.push(BEGIN)
  lines.push('')
  lines.push(
    `**Generated by \`npm run build:current-status\` (\`scripts/buildCurrentStatus.mjs\`), ${generatedAt}.** ` +
      `Countries where the CIA World Factbook's "Ethnic groups"/"Religions" text either had no field at all, or ` +
      `had one but it contained no parseable "<name> <pct>%" clause (see this script's own DEMOGRAPHICS header ` +
      `comment for real examples — free text with no percentages at all, or percentages nested inside a ` +
      `parenthetical aside rather than a top-level clause). Left \`undefined\`, never fabricated. Re-running the ` +
      `script regenerates this list.`
  )
  lines.push('')
  if (demographicGaps.length === 0) {
    lines.push('- None this run — every country resolved at least one of ethnicGroups/religions.')
  } else {
    const sorted = demographicGaps.slice().sort((a, b) => a.context.localeCompare(b.context))
    for (const g of sorted) lines.push(`- **[${g.context}]:** ${g.reason}`)
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
    // Appended right after the GW-code gap report's own section — same
    // `## Data sourcing (buildCurrentStatus.mjs)` heading, not a second one.
    updated = backlog.replace(
      '<!-- END buildCurrentStatus.mjs gap report -->',
      `<!-- END buildCurrentStatus.mjs gap report -->\n\n${section}`
    )
  }
  fs.writeFileSync(BACKLOG, updated)
  console.log(`Updated ${BACKLOG}: ${demographicGaps.length} demographics gap(s) logged.`)
}

writeBacklogReport()
writeDemographicsBacklogReport()
