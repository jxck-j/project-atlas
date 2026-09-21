// Build-time asset generator for the News Engine (see news-engine-design.md
// at the repo root for the full settled design this script implements:
// severity-gated publishing, wire-tier corroboration bypass, retraction).
// Produces real NewsItem records, written to public/data/news.json — RAW
// JSON, not a generated .ts const like militaryScores.ts/economyScores.ts,
// specifically because this script is meant to be re-run on a recurring
// cron cadence (3-4x/day per the design doc) and a static JSON asset can
// refresh without an app rebuild, unlike a build-time-imported .ts module.
//
// Standalone data-generation script only — does NOT touch GeoEntity/Country
// type definitions, registries, or any rendering/UI code. Rendering is
// src/hud/NewsPanel.tsx / src/hud/IntelligencePanel.tsx's job.
//
// ---------------------------------------------------------------------------
// SOURCING — direct outlet RSS feeds, NOT GDELT, and NOT Google News:
//
// The design doc's wire-tier allowlist names Reuters/AP/AFP/Bloomberg, so
// GDELT's DOC 2.0 API (a free, keyless news aggregator with per-article
// country/source-count signal) was the natural first choice for ingestion.
// It was tested and IS reachable in general, but returned a persistent 429
// from this project's development network regardless of request spacing,
// query, or headers — confirmed via the browser directly, not just this
// script's own fetches (see LOGBOOK.md). Google News's own RSS search
// endpoint also works, but its feed explicitly states "made available
// solely for... personal, non-commercial use... any other use is expressly
// prohibited" — not something to build a project's data pipeline on.
//
// What IS reachable and legitimate: outlets' own published RSS feeds — RSS
// exists specifically for this kind of syndicated, programmatic consumption
// (unlike Google News's scraped-search-results feed). FEEDS below (a Tier 1
// "global backbone" + Tier 2 "specialized" list, per direct request) is
// every outlet that was individually verified to return real, current
// <item> content from this project's dev network. Several requested/
// considered outlets did NOT make it in, each for a different confirmed
// reason (not silently dropped):
//   - Reuters: discontinued public RSS years ago (confirmed 404).
//   - AP, CNBC: block this script's self-identifying bot User-Agent with a
//     403. Getting past this would mean impersonating a real browser
//     specifically to defeat a site's own anti-bot measure — deliberately
//     not done here, same as this project declining Google News's ToS-
//     restricted feed above — so these stay unfetched rather than spoofed
//     past.
//   - NHK World: no working English-language feed found; the only reachable
//     NHK RSS is the domestic Japanese-language service, unusable for this
//     script's English-text keyword matching.
//   - Space.com: its RSS endpoint resolves but is genuinely empty upstream
//     (a real, verified `<channel>` with a literal "Latest from null" title
//     and zero `<item>` elements) — a live gap on Space.com's own end, not a
//     fetch or parsing issue here.
// Bloomberg is the one configured outlet that's also on the wire-tier
// allowlist below, so real wire-tier corroboration bypass IS exercised.
// Reuters/AP/AFP stay in WIRE_TIER_OUTLETS so the logic is ready the moment
// a real feed/API for them becomes available.
//
// ---------------------------------------------------------------------------
// COUNTRY RESOLUTION — headline/summary text matched against this app's own
// UN-193 country names (from public/geo/countries-un193.json, the same
// asset useCountryFeatures.ts fetches) plus a hand-curated alias table
// (COUNTRY_NAME_ALIASES below) covering common short forms/demonyms for the
// highest-traffic geopolitical countries — same "deliberately partial,
// covers what's actually needed" precedent as geoEntities.ts's
// ISO_ALPHA3_TO_NUMERIC (see scripts/lib/iso3166.mjs's own header comment
// for that distinction). An article matching no country is dropped and
// logged to the gap report, never guessed. linkedEntityIds uses the exact
// same numeric ISO topology id every other Intelligence Engine category
// (Military/Economy/Technology/Current Status) keys by.
//
// ---------------------------------------------------------------------------
// SEVERITY / CORROBORATION — implements the design doc's tag-scoped
// heuristics and severity-gated publish table, PLUS one addition beyond the
// doc's own text (flagged here and in LOGBOOK.md): a cross-tag trigger-
// keyword override. The doc's per-tag heuristics are checked first; then,
// regardless of which tag(s) actually matched, the full text is checked
// once more against every tag's own high-stakes trigger patterns pooled
// together. If that pooled check matches but the per-tag pass alone
// under-classified the item, severity is bumped up rather than trusting the
// first pass — this exists specifically so a real high-stakes event doesn't
// slip through at a lower publish bar just because its topicTags happened
// to land on a tag whose own heuristic table doesn't check for it (e.g. a
// coup story that isn't cleanly tagged 'diplomacy-politics'). It never
// LOWERS a severity the per-tag pass already got right.
//
// Corroboration's "2+ independent sources" is approximated by cross-outlet
// duplicate-story detection (title-word overlap, same linked country,
// across two DISTINCT outlet names — the two Bloomberg feeds count as one
// outlet, not two) rather than a real syndication-count API, since none of
// BBC/Al Jazeera/Bloomberg's feeds expose one. Logged as a real
// approximation, not presented as a citable count.
//
// PUBLISH TABLE — loosened from the design doc's original "significant
// always needs manual confirmation" reading (direct feedback: that reading
// produced a pending queue far too large to be useful, and this v1 has no
// confirm workflow to actually clear one — see LOGBOOK.md). 'significant'
// now auto-publishes on the SAME corroboration floor as 'routine'
// (osint-corroborated (2+) or wire-confirmed); mandatory manual
// confirmation is reserved for 'high-stakes' only, unchanged from before.
// news-engine-design.md needs a matching update once this is folded into
// CLAUDE.md — see this file's own resolveReviewStatus.
//
// Usage:
//   node scripts/buildNews.mjs
//     Fetches all configured feeds, writes public/data/news.json, and
//     appends a generated gap report to BACKLOG.md.
//
// Run via `node`, not `tsx` — no existing .ts source needs importing (same
// rule buildEconomy.mjs's header states explicitly).
import fs from 'node:fs'
import crypto from 'node:crypto'
import { feature } from 'topojson-client'
import { parseRssItems } from './lib/rss.mjs'

const COUNTRIES_SOURCE = 'public/geo/countries-un193.json'
const OUTPUT = 'public/data/news.json'
const BACKLOG = 'BACKLOG.md'

// Outlets whose OWN report satisfies `corroboration: 'wire-confirmed'`
// directly, without needing independent cross-outlet corroboration — see
// news-engine-design.md's "Wire-tier allowlist" section. Reuters/AP/AFP are
// kept here even though no feed for them is actually fetched this run (see
// this file's own header comment) so the allowlist itself doesn't need
// editing the moment a real feed/API for one of them becomes available.
const WIRE_TIER_OUTLETS = new Set(['Reuters', 'Associated Press', 'AFP', 'Bloomberg'])

// Tier 1 (global backbone) + Tier 2 (specialized) per direct request — every
// URL here was individually verified reachable and returning real,
// current-dated <item> content from this project's dev network before being
// added (see this file's own header comment for the ones that were tried
// and did NOT make the cut, and why). None of these newly-added outlets are
// wire services — see WIRE_TIER_OUTLETS below, which is unchanged by this
// list's breadth.
const FEEDS = [
  { url: 'https://feeds.bbci.co.uk/news/world/rss.xml', outlet: 'BBC News' },
  { url: 'https://www.aljazeera.com/xml/rss/all.xml', outlet: 'Al Jazeera' },
  { url: 'https://feeds.bloomberg.com/markets/news.rss', outlet: 'Bloomberg' },
  { url: 'https://feeds.bloomberg.com/politics/news.rss', outlet: 'Bloomberg' },
  { url: 'https://rss.dw.com/xml/rss-en-all', outlet: 'DW' },
  { url: 'https://www.france24.com/en/rss', outlet: 'France 24' },
  { url: 'https://www.euronews.com/rss?level=theme&name=news', outlet: 'Euronews' },
  { url: 'https://www.theguardian.com/world/rss', outlet: 'The Guardian' },
  { url: 'https://www.telegraph.co.uk/rss.xml', outlet: 'The Telegraph' },
  { url: 'https://www.defensenews.com/arc/outboundfeeds/rss/', outlet: 'Defense News' },
  { url: 'https://breakingdefense.com/feed/', outlet: 'Breaking Defense' },
  { url: 'https://www.twz.com/feed', outlet: 'The War Zone' },
  { url: 'https://www.nasa.gov/news-release/feed/', outlet: 'NASA' },
  { url: 'https://feeds.arstechnica.com/arstechnica/index', outlet: 'Ars Technica' },
  { url: 'https://feeds.npr.org/1004/rss.xml', outlet: 'NPR' },
]

// ---------------------------------------------------------------------------
// Fetch with retry/backoff — same shape as buildEconomy.mjs's
// fetchJsonRetry, adapted for text (RSS/XML) instead of JSON.
// ---------------------------------------------------------------------------
async function fetchTextRetry(url, attempts = 3) {
  let lastErr
  for (let i = 0; i < attempts; i++) {
    try {
      const res = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0 (compatible; ProjectAtlasNewsBot/1.0)' } })
      if (!res.ok) throw new Error(`${res.status} ${res.statusText}: ${url}`)
      return await res.text()
    } catch (err) {
      lastErr = err
      if (i < attempts - 1) await new Promise((resolve) => setTimeout(resolve, 2000 * (i + 1)))
    }
  }
  throw lastErr
}

// ---------------------------------------------------------------------------
// Country resolution
// ---------------------------------------------------------------------------
const topology = JSON.parse(fs.readFileSync(COUNTRIES_SOURCE, 'utf8'))
const countryFeatures = feature(topology, topology.objects[Object.keys(topology.objects)[0]]).features
const countries = countryFeatures.map((f) => ({ id: String(f.id), name: f.properties.name }))

// Deliberately partial — common short forms/demonyms for the highest-
// traffic geopolitical countries only, not all 193. A country not listed
// here still matches via its own canonical name (which does appear in real
// headline text); a genuine miss is logged to the gap report, not guessed.
// See this file's own header comment.
//
// Taiwan is NOT resolvable at all in v1: it's a GeoEntity, not one of the
// 193 UN-member Country records this topology carries, and this script only
// builds COUNTRY_MATCHERS from that topology — a Taiwan-mentioning article
// is dropped and logged like any other unresolved-country gap, same as
// every other GeoEntity. Extending country resolution to GeoEntities is
// real future work (see BACKLOG.md), not attempted this pass.
const COUNTRY_NAME_ALIASES = {
  'United States of America': ['United States', 'U.S.', 'US', 'American'],
  'United Kingdom': ['UK', 'U.K.', 'Britain', 'British'],
  Russia: ['Russian'],
  China: ['Chinese'],
  Ukraine: ['Ukrainian'],
  France: ['French'],
  Germany: ['German'],
  Turkey: ['Turkish'],
  Poland: ['Polish'],
  Spain: ['Spanish'],
  Netherlands: ['Dutch', 'Holland'],
  Iran: ['Iranian'],
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
  Somalia: ['Somali'],
  Libya: ['Libyan'],
  Lebanon: ['Lebanese'],
  Yemen: ['Yemeni'],
  Myanmar: ['Burma', 'Burmese'],
  'Democratic Republic of the Congo': ['DR Congo', 'DRC', 'Congolese'],
  "Côte d'Ivoire": ['Ivory Coast'],
}

// Sorted longest-name-first so "South Korea" is tried before a shorter
// unrelated substring could coincidentally match, and so a country's own
// multi-word alias (e.g. "North Korean") is checked before any shorter one.
const COUNTRY_MATCHERS = countries
  .map((c) => {
    const names = [c.name, ...(COUNTRY_NAME_ALIASES[c.name] ?? [])]
    return { id: c.id, name: c.name, patterns: names.map((n) => new RegExp(`\\b${escapeRegExp(n)}`, 'i')) }
  })
  .sort((a, b) => b.name.length - a.name.length)

function escapeRegExp(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function resolveCountryIds(text) {
  const ids = new Set()
  for (const matcher of COUNTRY_MATCHERS) {
    if (matcher.patterns.some((re) => re.test(text))) ids.add(matcher.id)
  }
  return Array.from(ids)
}

// ---------------------------------------------------------------------------
// Entity tagging — organizations, people, military assets. Fills the gap
// news-engine-design.md explicitly deferred ("a non-state actor doesn't map
// cleanly onto the existing 193-country GeoEntity schema") — see
// data/newsTypes.ts's NewsMentionedEntity doc comment for the scope this is
// deliberately kept to (an inline tag, not a GeoEntity-style record).
//
// All three lists below are HAND-CURATED SEEDS THAT WILL GO STALE — there is
// no open API for "which non-state actors/leaders/military assets are
// newsworthy right now," so this is the same "hand-maintained seed, flagged
// for verification" treatment buildCurrentStatus.mjs's ORANGE/YELLOW
// sanction tiers already get, not presented as complete or authoritative.
// PEOPLE (current heads-of-state/major leaders) is the one most likely to
// need periodic refreshing as governments change — see BACKLOG.md.
// ---------------------------------------------------------------------------
const ORGANIZATIONS = [
  'Hamas', 'Hezbollah', 'Houthis', 'Islamic State', 'ISIS', 'ISIL', 'Al-Qaeda', 'Taliban',
  'Wagner Group', 'IDF', 'NATO', 'Al-Shabaab', 'Boko Haram', 'PKK', 'FARC', 'Islamic Jihad',
  'Popular Mobilization Forces', 'Houthi', 'Revolutionary Guard', 'IRGC', 'Muslim Brotherhood',
  'Lashkar-e-Taiba', 'Kurdish YPG',
]

const PEOPLE = [
  'Trump', 'Putin', 'Xi Jinping', 'Zelensky', 'Zelenskyy', 'Netanyahu', 'Khamenei',
  'Pezeshkian', 'Kim Jong Un', 'Modi', 'Erdogan', 'Macron', 'Starmer', 'Scholz', 'Merz',
  'Meloni', 'Lula', 'Milei', 'MBS', 'Mohammed bin Salman', 'Sisi', 'Abbas', 'Lavrov',
  'Rubio', 'Guterres',
]

const ASSETS = [
  'F-35', 'F-16', 'F-22', 'B-2 bomber', 'B-52', 'Reaper drone', 'Predator drone',
  'Iron Dome', 'Patriot missile', 'THAAD', 'S-400', 'S-300', 'Aegis destroyer',
  'aircraft carrier', 'Abrams tank', 'HIMARS', 'Javelin missile', 'Tomahawk missile',
  'ballistic missile', 'hypersonic missile', 'Shahed drone',
]

function buildEntityMatchers(names, type) {
  return names.map((name) => ({ type, name, pattern: new RegExp(`\\b${escapeRegExp(name)}`, 'i') }))
}
const ENTITY_MATCHERS = [
  ...buildEntityMatchers(ORGANIZATIONS, 'organization'),
  ...buildEntityMatchers(PEOPLE, 'person'),
  ...buildEntityMatchers(ASSETS, 'asset'),
]

function resolveMentionedEntities(text) {
  const seen = new Set()
  const results = []
  for (const matcher of ENTITY_MATCHERS) {
    if (matcher.pattern.test(text) && !seen.has(matcher.name)) {
      seen.add(matcher.name)
      results.push({ type: matcher.type, name: matcher.name })
    }
  }
  return results
}

// ---------------------------------------------------------------------------
// Topic tags — deliberately coarse keyword sets, per the design doc's own
// "deliberately coarse — the manual confirmation step catches
// misclassification" allowance.
// ---------------------------------------------------------------------------
const TOPIC_TAG_KEYWORDS = {
  'conflict-security': [
    'war', 'military', 'troops', 'airstrike', 'air strike', 'offensive', 'invasion', 'combat',
    'ceasefire', 'front line', 'missile', 'drone strike', 'army', 'battle', 'shelling',
    'clash', 'fighting', 'gunmen', 'gunfire',
  ],
  'terrorism-non-state-actors': [
    'terrorist', 'terrorism', 'militant', 'extremist', 'bombing', 'insurgent', 'rebel group',
    'isis', 'al-qaeda', 'hamas', 'hezbollah', 'non-state armed group',
  ],
  'diplomacy-politics': [
    'summit', 'treaty', 'election', 'president', 'prime minister', 'resign', 'coup', 'parliament',
    'diplomatic', 'embassy', 'security council', 'nato',
  ],
  'economic-trade': [
    'tariff', 'trade deal', 'gdp', 'inflation', 'currency', 'default', 'stock market',
    'central bank', 'export', 'import', 'recession', 'interest rate',
  ],
  'humanitarian-displacement': [
    'refugee', 'displaced', 'famine', 'drought', 'earthquake', 'flood', 'humanitarian',
    'aid group', 'disaster', 'outbreak', 'epidemic',
  ],
  'crime-trafficking': [
    'drug trafficking', 'cartel', 'smuggling', 'human trafficking', 'organized crime',
    'money laundering',
  ],
  'science-technology': [
    'artificial intelligence', ' ai ', 'semiconductor', 'chip', 'space launch', 'satellite',
    'quantum computing', 'cyberattack', 'cyber attack',
  ],
}

function resolveTopicTags(text) {
  const lower = text.toLowerCase()
  const tags = []
  for (const [tag, keywords] of Object.entries(TOPIC_TAG_KEYWORDS)) {
    if (keywords.some((kw) => lower.includes(kw))) tags.push(tag)
  }
  return tags
}

// ---------------------------------------------------------------------------
// Severity heuristics — per news-engine-design.md's tag-scoped table, plus
// the cross-tag override described in this file's own header comment.
// ---------------------------------------------------------------------------
const MASS_CASUALTY_RE = /\b(\d{1,4})\+?\s*(?:people\s+)?(?:killed|dead|casualties|fatalities)\b/i
const HEAD_OF_STATE_CASUALTY_RE =
  /\b(president|prime minister|king|queen|head of state|premier)\b[^.]{0,60}\b(killed|assassinated|dies|dead|deposed)\b|\b(killed|assassinated)\b[^.]{0,60}\b(president|prime minister|king|queen|head of state|premier)\b/i
const WMD_RE = /\b(nuclear (weapon|strike|attack|warhead)|chemical weapon|biological weapon|radiological (weapon|attack))\b/i
const CAPITAL_EMBASSY_ATTACK_RE = /\b(embassy|capital city)\b[^.]{0,40}\b(attack|attacked|bombed|strike|struck)\b/i
const REGIME_CHANGE_RE = /\b(coup|overthrown|ousted|deposed|forced resignation)\b/i
const WAR_DECLARATION_RE = /\bdeclares? war\b/i
const PACT_WITHDRAWAL_RE = /\bwithdraw(?:s|al)? from\b[^.]{0,30}\b(nato|nuclear treaty|non-proliferation treaty)\b/i
const SOVEREIGN_DEFAULT_RE = /\b(sovereign default|debt default|currency collapse|hyperinflation)\b/i
const PHEIC_RE = /\b(pandemic declared|public health emergency|outbreak declared|pheic)\b/i
const LEADER_OR_MILITARY_RE = /\b(president|prime minister|parliament|government|military|army|minister|senate|congress)\b/i

function massCasualtyMeetsThreshold(text) {
  const match = text.match(MASS_CASUALTY_RE)
  if (!match) return false
  return Number.parseInt(match[1], 10) >= 10
}

// Every trigger pattern that can independently justify 'high-stakes',
// pooled together for the cross-tag override pass (see header comment).
const HIGH_STAKES_TRIGGERS = [
  HEAD_OF_STATE_CASUALTY_RE,
  WMD_RE,
  CAPITAL_EMBASSY_ATTACK_RE,
  REGIME_CHANGE_RE,
  WAR_DECLARATION_RE,
  PACT_WITHDRAWAL_RE,
  PHEIC_RE,
]

function matchesAnyHighStakesTrigger(text) {
  return HIGH_STAKES_TRIGGERS.some((re) => re.test(text)) || massCasualtyMeetsThreshold(text)
}

function resolveSeverity(text, topicTags) {
  let severity = 'routine'

  const hasConflictTag = topicTags.includes('conflict-security') || topicTags.includes('terrorism-non-state-actors')
  const hasDiplomacyTag = topicTags.includes('diplomacy-politics')
  const hasEconomyTag = topicTags.includes('economic-trade')
  const hasHumanitarianTag = topicTags.includes('humanitarian-displacement')

  if (hasConflictTag) {
    if (
      HEAD_OF_STATE_CASUALTY_RE.test(text) ||
      massCasualtyMeetsThreshold(text) ||
      WMD_RE.test(text) ||
      CAPITAL_EMBASSY_ATTACK_RE.test(text)
    ) {
      severity = 'high-stakes'
    } else {
      severity = 'significant'
    }
  }

  if (severity !== 'high-stakes' && hasDiplomacyTag) {
    if (REGIME_CHANGE_RE.test(text) || WAR_DECLARATION_RE.test(text) || PACT_WITHDRAWAL_RE.test(text)) {
      severity = 'high-stakes'
    } else if (severity === 'routine') {
      severity = 'significant'
    }
  }

  if (severity === 'routine' && hasEconomyTag) {
    // Economic & Trade caps at 'significant' on its own — "genuinely rare
    // for this tag to reach high-stakes" per the design doc; only the
    // cross-tag override below can push it further.
    severity = SOVEREIGN_DEFAULT_RE.test(text) ? 'significant' : 'routine'
  }

  if (severity !== 'high-stakes' && hasHumanitarianTag) {
    if (massCasualtyMeetsThreshold(text) || PHEIC_RE.test(text)) {
      severity = 'high-stakes'
    } else if (severity === 'routine') {
      severity = 'significant'
    }
  }

  // Fallback for anything not matched by a tag-specific rule above.
  if (severity === 'routine' && topicTags.length === 0) {
    severity = LEADER_OR_MILITARY_RE.test(text) ? 'significant' : 'routine'
  }

  // Cross-tag override (this file's own addition beyond the design doc's
  // text — see header comment): never LOWERS severity, only raises it when
  // the per-tag pass missed a real high-stakes signal.
  if (severity !== 'high-stakes' && matchesAnyHighStakesTrigger(text)) {
    severity = 'high-stakes'
  }

  return severity
}

// ---------------------------------------------------------------------------
// Corroboration — wire-tier bypass, else approximate cross-outlet
// duplicate-story detection (see header comment).
// ---------------------------------------------------------------------------
const STOPWORDS = new Set([
  'the', 'a', 'an', 'of', 'in', 'on', 'to', 'for', 'and', 'or', 'is', 'are', 'as', 'at', 'by',
  'with', 'from', 'after', 'over', 'amid', 'says', 'said', 'new', 'its', 'his', 'her', 'their',
])

function significantWords(title) {
  return new Set(
    title
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, ' ')
      .split(/\s+/)
      .filter((w) => w.length > 3 && !STOPWORDS.has(w))
  )
}

function titleOverlapRatio(a, b) {
  if (a.size === 0 || b.size === 0) return 0
  let shared = 0
  for (const w of a) if (b.has(w)) shared++
  return shared / Math.min(a.size, b.size)
}

// ---------------------------------------------------------------------------
// reviewStatus — the severity-gated publish table (see header comment for
// the exact reading of the design doc this implements).
// ---------------------------------------------------------------------------
function resolveReviewStatus(severity, corroboration) {
  if (corroboration === 'unconfirmed') return 'pending-confirmation'
  if (severity === 'high-stakes') return corroboration === 'wire-confirmed' ? 'auto-published' : 'pending-confirmation'
  // 'significant' now auto-publishes on the same corroboration floor as
  // 'routine' (osint-corroborated (2+) or wire-confirmed) — loosened from
  // the original "always needs a human" reading per direct feedback that
  // the initial, stricter reading produced far too large a pending queue to
  // be useful, and no confirm workflow exists yet to actually clear one.
  // Mandatory manual confirmation is now reserved for 'high-stakes' only.
  return 'auto-published'
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------
const unresolvedCountryGaps = []
const candidates = []
const seenLinks = new Set()
let agedOut = 0

// Rolling retention window (direct request: the News tab offers 24 hrs / 3 / 7 / 14 days, so the file has to actually hold 14 days).
// A feed only ever shows its own last few items — a busy outlet's window can be a day or less — so without carrying the previous
// output forward, a 7- or 14-day view would be dominated by whichever outlets publish slowly. Keep in step with the longest window in
// src/data/newsRecency.ts (that file is TS and this script runs under plain node, so the number is duplicated, not imported).
const RETENTION_DAYS = 14
const retentionCutoffMs = Date.now() - RETENTION_DAYS * 24 * 60 * 60 * 1000

function ingest(rssItem, outlet, { carried }) {
  if (!rssItem.title || !rssItem.link) return
  // Fresh items are ingested first, so a carried copy of the same URL is the one dropped.
  if (seenLinks.has(rssItem.link)) return

  const snapshotDate = rssItem.pubDate && !Number.isNaN(Date.parse(rssItem.pubDate))
    ? new Date(rssItem.pubDate).toISOString()
    : new Date().toISOString()
  if (Date.parse(snapshotDate) < retentionCutoffMs) {
    agedOut++
    return
  }

  const text = `${rssItem.title} ${rssItem.description ?? ''}`
  const linkedEntityIds = resolveCountryIds(text)
  if (linkedEntityIds.length === 0) {
    if (!carried) unresolvedCountryGaps.push(rssItem.title)
    return
  }
  seenLinks.add(rssItem.link)

  const topicTags = resolveTopicTags(text)
  const mentionedEntities = resolveMentionedEntities(text)
  const severity = resolveSeverity(text, topicTags)
  const isWireTier = WIRE_TIER_OUTLETS.has(outlet)

  candidates.push({
    id: `news-${crypto.createHash('sha1').update(rssItem.link).digest('hex').slice(0, 16)}`,
    headline: rssItem.title,
    summary: rssItem.description ?? '',
    linkedEntityIds,
    mentionedEntities,
    topicTags,
    severity,
    sourceType: 'outlet',
    source: {
      sourceType: 'outlet',
      outlet,
      ...(isWireTier ? { tier: 'wire' } : {}),
    },
    isWireTier,
    titleWords: significantWords(rssItem.title),
    snapshotDate,
    url: rssItem.link,
    imageUrl: rssItem.imageUrl,
  })
}

for (const feedConfig of FEEDS) {
  let xml
  try {
    xml = await fetchTextRetry(feedConfig.url)
  } catch (err) {
    console.warn(`Failed to fetch ${feedConfig.url}: ${err.message}`)
    continue
  }
  for (const rssItem of parseRssItems(xml)) ingest(rssItem, feedConfig.outlet, { carried: false })
}
const freshCount = candidates.length

// Carry the previous output forward through the SAME path as a fresh item (country/tag/severity resolution, then dedup below) rather
// than splicing old records in afterwards: a carried item then dedups against a new cross-outlet report of the same story, and a
// rule improvement re-applies to it. headline/summary/url/date/image round-trip exactly, so nothing is lost by re-ingesting.
let previous = []
try {
  previous = JSON.parse(fs.readFileSync(OUTPUT, 'utf8'))
} catch {
  // First run, or an unreadable file: nothing to carry, the feed just starts its window from here.
}
for (const item of previous) {
  if (item.sourceType !== 'outlet' || !item.source?.outlet) continue
  ingest({ title: item.headline, description: item.summary, link: item.url, pubDate: item.snapshotDate, imageUrl: item.imageUrl }, item.source.outlet, { carried: true })
}
const carriedCount = candidates.length - freshCount

// Corroboration — every configured outlet is trusted for its own report
// directly (osint-corroborated(2+), capped below wire-confirmed), not just
// the 5 originally-scoped specialized ones. Direct feedback/reasoning: every
// outlet in FEEDS is hand-picked and editorially vetted — there is no
// open-web/UGC/first-hand ingestion in v1 at all — so cross-outlet
// duplicate-story matching had nothing real to verify against; it was
// rejecting perfectly legitimate single-outlet reporting from BBC/Al
// Jazeera/DW/etc. just as often as it was from the specialized outlets.
// `'unconfirmed'` is consequently unreachable in v1 — an honest fact of
// "every current source is trusted," not a bug to hide — and becomes real
// again the moment a genuinely unvetted source (Telegram/OSINT first-hand)
// is added, at which point THAT source's claims are what cross-checking
// against these trusted outlets is actually for. High-stakes still requires
// literal wire-confirmed either way — see resolveReviewStatus above.
for (const a of candidates) {
  a.corroboration = a.isWireTier ? 'wire-confirmed' : 'osint-corroborated (2+)'
}

// Deduplication — direct feedback: once every outlet is trusted on its own,
// the same real-world story reported by several outlets (common — a major
// story is often independently covered by 4-5 of these 15 feeds) would
// otherwise publish as that many separate, near-identical News items.
// Reuses the same title-word-overlap signal the old corroboration check
// used, at a stricter threshold (this is now "is this actually the same
// article," not "is this loosely related enough to count as a second
// opinion"). Clustered via union-find (a dedup relation is transitive by
// construction here — same country + high title overlap), one survivor per
// cluster rather than a pairwise "drop the second one" pass, so a 3-outlet
// duplicate cluster doesn't survive as 2 items depending on iteration order.
const DEDUP_TITLE_OVERLAP_THRESHOLD = 0.6
const parent = candidates.map((_, i) => i)
function find(i) {
  while (parent[i] !== i) {
    parent[i] = parent[parent[i]]
    i = parent[i]
  }
  return i
}
function union(i, j) {
  const ri = find(i)
  const rj = find(j)
  if (ri !== rj) parent[ri] = rj
}
for (let i = 0; i < candidates.length; i++) {
  for (let j = i + 1; j < candidates.length; j++) {
    const a = candidates[i]
    const b = candidates[j]
    const sharesCountry = a.linkedEntityIds.some((id) => b.linkedEntityIds.includes(id))
    if (sharesCountry && titleOverlapRatio(a.titleWords, b.titleWords) >= DEDUP_TITLE_OVERLAP_THRESHOLD) {
      union(i, j)
    }
  }
}
const clusters = new Map()
for (let i = 0; i < candidates.length; i++) {
  const root = find(i)
  if (!clusters.has(root)) clusters.set(root, [])
  clusters.get(root).push(candidates[i])
}
// Survivor per cluster: wire-tier first (most authoritative), then whichever
// reported it earliest (the original break), then whichever has a
// thumbnail image (a strictly better card to show).
let duplicatesDropped = 0
const deduped = []
for (const cluster of clusters.values()) {
  duplicatesDropped += cluster.length - 1
  cluster.sort((a, b) => {
    if (a.isWireTier !== b.isWireTier) return a.isWireTier ? -1 : 1
    const dateDiff = new Date(a.snapshotDate).getTime() - new Date(b.snapshotDate).getTime()
    if (dateDiff !== 0) return dateDiff
    return (b.imageUrl ? 1 : 0) - (a.imageUrl ? 1 : 0)
  })
  deduped.push(cluster[0])
}

const results = deduped.map((c) => ({
  id: c.id,
  headline: c.headline,
  summary: c.summary,
  linkedEntityIds: c.linkedEntityIds,
  mentionedEntities: c.mentionedEntities,
  topicTags: c.topicTags,
  severity: c.severity,
  sourceType: c.sourceType,
  source: c.source,
  corroboration: c.corroboration,
  reviewStatus: resolveReviewStatus(c.severity, c.corroboration),
  snapshotDate: c.snapshotDate,
  url: c.url,
  ...(c.imageUrl ? { imageUrl: c.imageUrl } : {}),
}))

fs.mkdirSync('public/data', { recursive: true })
fs.writeFileSync(OUTPUT, JSON.stringify(results, null, 2))
console.log(`Wrote ${OUTPUT}: ${results.length} items.`)
console.log(
  `  auto-published=${results.filter((r) => r.reviewStatus === 'auto-published').length}, ` +
    `pending-confirmation=${results.filter((r) => r.reviewStatus === 'pending-confirmation').length}`
)
console.log(
  `  severity — routine=${results.filter((r) => r.severity === 'routine').length}, ` +
    `significant=${results.filter((r) => r.severity === 'significant').length}, ` +
    `high-stakes=${results.filter((r) => r.severity === 'high-stakes').length}`
)
console.log(`  ${unresolvedCountryGaps.length} article(s) dropped for no resolvable country link.`)
console.log(`  ${freshCount} candidate(s) from the feeds + ${carriedCount} carried from the previous output (${RETENTION_DAYS}-day window; ${agedOut} older than that dropped).`)
console.log(`  ${duplicatesDropped} article(s) merged as cross-outlet duplicates of another item.`)
console.log(`  ${results.filter((r) => r.mentionedEntities.length > 0).length} article(s) with at least one tagged organization/person/asset.`)

// ---------------------------------------------------------------------------
// BACKLOG.md — same marker-delimited idempotent append pattern as every
// other buildX.mjs (no shared helper exists to reuse — see CLAUDE.md).
// ---------------------------------------------------------------------------
function writeBacklogReport() {
  const BEGIN = '<!-- BEGIN buildNews.mjs gap report -->'
  const END = '<!-- END buildNews.mjs gap report -->'
  const generatedAt = new Date().toISOString().slice(0, 10)

  const lines = []
  lines.push(BEGIN)
  lines.push('')
  lines.push(
    `**Generated by \`npm run build:news\` (\`scripts/buildNews.mjs\`), ${generatedAt}.** ` +
      `Re-running the script regenerates this list — don't hand-edit it.`
  )
  lines.push('')
  lines.push(
    '**Standing deviations/limitations** (see scripts/buildNews.mjs\'s own header comment for the full ' +
      `reasoning): sourced from ${FEEDS.length} RSS feeds across ${new Set(FEEDS.map((f) => f.outlet)).size} ` +
      'distinct outlets (BBC, Al Jazeera, Bloomberg, DW, France 24, Euronews, The Guardian, The Telegraph, ' +
      'Defense News, Breaking Defense, The War Zone, NASA, Ars Technica, NPR), not GDELT (persistent 429 from ' +
      'this project\'s dev network, confirmed via browser too) or Reuters/AP/AFP directly. Reuters has no public ' +
      'RSS anymore (discontinued); AP and CNBC 403 this script\'s self-identifying bot User-Agent and are ' +
      'deliberately not fetched with a spoofed browser UA; NHK World has no working English-language feed (only ' +
      'a stale, Japanese-language domestic NHK feed was found); Space.com\'s RSS endpoint is genuinely empty ' +
      'upstream, not a fetch/parsing issue here. Reuters/AP/AFP remain in the wire-tier allowlist for when a ' +
      'real feed/API becomes available. `leaning`/`leaningSource` are unset for every item — no AllSides/Ad ' +
      'Fontes dataset is integrated yet. No `sourceType: \'first-hand\'` items ship — no Telegram/OSINT ' +
      'first-hand ingestion exists yet, so every configured outlet is trusted directly for ' +
      '`osint-corroborated (2+)` (capped below `wire-confirmed`) rather than needing real cross-outlet ' +
      'corroboration — a deliberate v1 call, not a bug: `unconfirmed` is currently unreachable, since ' +
      'cross-checking has nothing untrusted to check against yet. It becomes meaningful again the moment a ' +
      'first-hand/OSINT source is added. Duplicate stories reported by more than one outlet ARE still merged ' +
      '(title-overlap clustering, one survivor per cluster — see buildNews.mjs\'s own comment) so this isn\'t ' +
      'the same as publishing every outlet\'s copy of the same story separately. The dev-only pending-' +
      'confirmation queue is read-only in v1 — there is no built workflow yet for a human to actually confirm a ' +
      'pending item and flip it to `manual-only`. `mentionedEntities` (organizations/people/military assets) is ' +
      'matched against three hand-curated keyword lists (ORGANIZATIONS/PEOPLE/ASSETS in buildNews.mjs) — a ' +
      'seed, not an authoritative or complete roster; PEOPLE (current heads-of-state/major leaders) is the ' +
      'most likely of the three to go stale as governments change and should be reviewed periodically, not ' +
      'treated as a one-time build.'
  )
  lines.push('')
  if (unresolvedCountryGaps.length === 0) {
    lines.push('- No unresolved-country articles this run.')
  } else {
    lines.push(`- ${unresolvedCountryGaps.length} article(s) dropped this run for no resolvable country link:`)
    for (const title of unresolvedCountryGaps.slice(0, 25)) {
      lines.push(`  - "${title}"`)
    }
    if (unresolvedCountryGaps.length > 25) {
      lines.push(`  - ...and ${unresolvedCountryGaps.length - 25} more.`)
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
    const heading = '\n## Data sourcing (`buildNews.mjs`)\n\n'
    const introEnd = backlog.indexOf('\n## ')
    updated =
      introEnd === -1
        ? backlog + heading + section + '\n'
        : backlog.slice(0, introEnd) + heading + section + '\n' + backlog.slice(introEnd)
  }
  fs.writeFileSync(BACKLOG, updated)
  console.log(`Updated ${BACKLOG}: ${unresolvedCountryGaps.length} gap(s) logged.`)
}

writeBacklogReport()
