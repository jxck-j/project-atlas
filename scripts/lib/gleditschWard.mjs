// Gleditsch-Ward (GW) state-system numeric country codes -> this project's
// UN-193 topology names. UCDP's own datasets (both the annual UCDP/PRIO
// Armed Conflict Dataset and the UCDP Candidate/GED Events Dataset) key
// every country reference — `gwno_loc`/`gwno_a`/`gwno_b` in the ACD,
// `country_id` in GED/Candidate — to this system, not to ISO codes, so
// scripts/buildCurrentStatus.mjs needs this bridge the same way
// buildGovCapitalPopGdp.mjs/buildMilitary.mjs need scripts/lib/iso3166.mjs
// and scripts/lib/gecCrossReference.mjs for their own external code
// systems.
//
// Source: Kristian Skrede Gleditsch's own site (the "GW" in Gleditsch-Ward
// — this is the originating academic maintainer, not a third-party mirror),
// http://ksgleditsch.com/data/iisystem.dat (states) and
// http://ksgleditsch.com/data/microstatessystem.dat (microstates, listed
// separately in the source). Tab-delimited: gwcode, 3-letter GW code,
// country_name, start_date, end_date (both dd:mm:yyyy). Fetched 2026-08-23.
//
// A gwcode can appear more than once (e.g. Myanmar has a pre-1886 and a
// post-1948 row) when the same code was reused across non-contiguous
// periods of statehood — this module keeps only the entry with the latest
// end_date per code, i.e. today's actual referent for that code, since
// nothing in current UCDP conflict data can reference a defunct
// pre-independence period.
//
// Encoding: the source files are Windows-1252, not ISO-8859-1/UTF-8, despite
// looking like plain ASCII/Latin-1 otherwise — confirmed by byte
// inspection (Côte d'Ivoire's apostrophe is 0x92, cp1252's curly
// right-single-quote, undefined in true Latin-1). Node has no built-in
// cp1252 decoder; since the only cp1252-specific byte actually present in
// this data is 0x92, it's remapped to a plain ASCII apostrophe before
// decoding the rest as latin1 (which is otherwise correct for this file's
// remaining accented characters, e.g. Württemberg's ü).
export function parseGwStatesFile(buffer) {
  const fixed = Buffer.from(buffer)
  for (let i = 0; i < fixed.length; i++) {
    if (fixed[i] === 0x92) fixed[i] = 0x27
  }
  const text = fixed.toString('latin1')

  return text
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean)
    .map((line) => {
      const [gwcode, gwc, name, start, end] = line.split('\t')
      return { gwcode: Number(gwcode), gwc, name, start, end: parseDMY(end) }
    })
}

function parseDMY(d) {
  const [dd, mm, yyyy] = d.split(':').map(Number)
  return yyyy * 10000 + mm * 100 + dd
}

// Collapses parseGwStatesFile's raw rows (possibly several periods per
// code) down to one name per gwcode — whichever period ends latest.
export function buildCurrentGwNameMap(entries) {
  const byCode = new Map()
  for (const e of entries) {
    const current = byCode.get(e.gwcode)
    if (!current || e.end > current.end) byCode.set(e.gwcode, e)
  }
  return new Map([...byCode].map(([code, e]) => [code, e.name]))
}

// GW's own country_name spelling vs this project's UN-193 topology name,
// normalized-lowercase source name -> canonical topology name. Built by
// resolving every gwcode actually referenced in a real UCDP/PRIO ACD
// active-conflict pull plus a real UCDP Candidate pull (see LOGBOOK.md's
// Current Status entry) — not a guess at every GW entry in the source file,
// most of which are long-defunct pre-1945 European statelets that no
// current conflict data will ever reference. A gwcode this table doesn't
// cover, and that isn't a plain normalized-name match either, is a genuine
// unmatched case (either a truly new alias this table hasn't seen yet, or a
// non-UN-member entity like Kosovo/Abkhazia/South Ossetia, which have no
// Country registry entry to attach to) — logged as a gap, not guessed.
export const GW_NAME_ALIASES = {
  'german federal republic': 'Germany',
  'czech republic': 'Czechia',
  'cape verde': 'Cabo Verde',
  swaziland: 'Eswatini',
  'kyrgyz republic': 'Kyrgyzstan',
  'korea, republic of': 'South Korea',
  "korea, people's republic of": 'North Korea',
  'vietnam, democratic republic of': 'Vietnam',
  'yemen (arab republic of yemen)': 'Yemen',
  'yemen (north yemen)': 'Yemen',
  'east timor': 'Timor-Leste',
  'federated states of micronesia': 'Micronesia',
  'samoa/western samoa': 'Samoa',
  'bosnia-herzegovina': 'Bosnia and Herzegovina',
  'macedonia (former yugoslav republic of)': 'North Macedonia',
  'congo, democratic republic of (zaire)': 'Democratic Republic of the Congo',
  'zimbabwe (rhodesia)': 'Zimbabwe',
  'iran (persia)': 'Iran',
  'turkey (ottoman empire)': 'Turkey',
  'myanmar (burma)': 'Myanmar',
  'sri lanka (ceylon)': 'Sri Lanka',
  'cambodia (kampuchea)': 'Cambodia',
  'antigua & barbuda': 'Antigua and Barbuda',
  "cote d'ivoire": "Côte d'Ivoire",
  'russia (soviet union)': 'Russia',
  'burkina faso (upper volta)': 'Burkina Faso',
}
