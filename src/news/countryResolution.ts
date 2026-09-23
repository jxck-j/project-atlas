// Headline/summary text → country ids. Ported from v1's buildNews.mjs (deleted
// at the Phase 4 cutover), with
// three fixes to bugs that were real in v1 (see LOGBOOK.md, Phase 2 entry):
//  - matching is case-SENSITIVE — v1's case-insensitive "US" alias matched the
//    pronoun in "tell us", and "Turkey" matched the bird;
//  - names end on a word boundary — v1's "Niger" matched "Nigeria", "India"
//    matched "Indian"/"Indiana" (demonyms are listed explicitly instead);
//  - longest names match first and MASK what they consumed, so "South Sudan"
//    is claimed before "Sudan" can match inside it (v1 sorted longest-first
//    but never masked, so it linked both).
//
// Still deliberately partial: aliases cover the highest-traffic countries
// only. A country not listed still matches on its canonical name; a genuine
// miss is logged by the caller, never guessed. Ambiguous names (Georgia the
// US state, Jordan the person) can false-positive — the LLM pass in Phase 3
// is where that gets fixed properly.

export interface CountryRef {
  id: string
  name: string
}

export const COUNTRY_NAME_ALIASES: Record<string, string[]> = {
  'United States of America': ['United States', 'U.S.', 'US', 'American', 'Americans'],
  'United Kingdom': ['UK', 'U.K.', 'Britain', 'British'],
  Russia: ['Russian', 'Moscow', 'Kremlin'],
  China: ['Chinese', 'Beijing'],
  Ukraine: ['Ukrainian', 'Kyiv', 'Kiev'],
  France: ['French'],
  Germany: ['German'],
  Turkey: ['Turkish', 'Türkiye', 'Turkiye'],
  Poland: ['Polish'],
  Spain: ['Spanish'],
  Netherlands: ['Dutch', 'Holland'],
  Iran: ['Iranian', 'Tehran'],
  Iraq: ['Iraqi'],
  Israel: ['Israeli'],
  Syria: ['Syrian'],
  Egypt: ['Egyptian'],
  'Saudi Arabia': ['Saudi'],
  India: ['Indian'],
  Pakistan: ['Pakistani'],
  Afghanistan: ['Afghan'],
  'North Korea': ['North Korean', 'Pyongyang'],
  'South Korea': ['South Korean', 'Seoul'],
  Japan: ['Japanese'],
  Venezuela: ['Venezuelan'],
  Brazil: ['Brazilian'],
  Mexico: ['Mexican'],
  Canada: ['Canadian'],
  Australia: ['Australian'],
  Nigeria: ['Nigerian'],
  Ethiopia: ['Ethiopian'],
  Kenya: ['Kenyan'],
  Sudan: ['Sudanese'],
  'South Sudan': ['South Sudanese'],
  Somalia: ['Somali'],
  Libya: ['Libyan'],
  Lebanon: ['Lebanese'],
  Yemen: ['Yemeni'],
  Myanmar: ['Burma', 'Burmese'],
  Taiwan: ['Taiwanese', 'Taipei'],
  'Democratic Republic of the Congo': ['DR Congo', 'DRC', 'Congolese'],
  "Côte d'Ivoire": ['Ivory Coast'],
}

// Every UN member plus Taiwan (a GeoEntity, but recognized as a country
// across the Intelligence Engine — see CLAUDE.md). Callers append it.
export const TAIWAN_REF: CountryRef = { id: 'taiwan', name: 'Taiwan' }

export interface CountryMatcher {
  id: string
  name: string
  patterns: RegExp[]
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

// Lookarounds rather than \b: aliases like "U.S." end in punctuation, where
// \b never matches.
function namePattern(name: string): RegExp {
  return new RegExp(`(?<![\\p{L}\\p{N}])${escapeRegExp(name)}(?![\\p{L}\\p{N}])`, 'gu')
}

/** Longest name first, so a compound name is claimed before a name inside it. */
export function buildCountryMatchers(countries: CountryRef[], aliases: Record<string, string[]> = COUNTRY_NAME_ALIASES): CountryMatcher[] {
  return countries
    .map((c) => ({ id: c.id, name: c.name, names: [c.name, ...(aliases[c.name] ?? [])] }))
    .flatMap((c) => c.names.map((n) => ({ id: c.id, name: n })))
    .sort((a, b) => b.name.length - a.name.length)
    .map((n) => ({ id: n.id, name: n.name, patterns: [namePattern(n.name)] }))
}

/** Ids in first-mention order — the first is usually the story's principal country. */
export function resolveCountryIds(text: string, matchers: CountryMatcher[]): string[] {
  let remaining = text
  const found: { id: string; index: number }[] = []
  for (const matcher of matchers) {
    for (const re of matcher.patterns) {
      const first = [...remaining.matchAll(re)][0]
      if (!first) continue
      found.push({ id: matcher.id, index: first.index })
      // Mask EVERY occurrence (same length, so later indexes stay comparable)
      // — see header. A second "South Sudan" must not expose a bare "Sudan".
      remaining = remaining.replace(re, (m) => ' '.repeat(m.length))
    }
  }
  const seen = new Set<string>()
  return found
    .sort((a, b) => a.index - b.index)
    .filter((f) => (seen.has(f.id) ? false : (seen.add(f.id), true)))
    .map((f) => f.id)
}
