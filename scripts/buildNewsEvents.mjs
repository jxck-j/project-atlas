// Build-time asset generator for News Engine v2 (Phase 2 — the Event build
// pipeline). Implements news-sourcing-design.md §6/§8/§17: fetch the vetted
// outlets' RSS feeds, resolve countries, cluster articles into Events, build
// each Event's source dossier, and publish only what clears its severity
// tier's corroboration floor. All the logic lives in src/news/ (pure, tested);
// this file is the fetch/write shell around it.
//
// Runs via `tsx`, not `node` (unlike v1's buildNews.mjs): it imports the .ts
// modules in src/news/ directly so the build and the client can never
// disagree about corroboration, gating, or ranking. Same precedent as
// generateClaimsDoc.mjs.
//
// Usage:  npm run build:news:events
//   Writes public/data/news-events.json  (reader-visible Events only)
//          debug/news-pending-confirmation.json  (head-of-state death claims
//            awaiting a human — deliberately NOT under public/, see below)
//   Appends a generated gap report to BACKLOG.md.
//
// v1's scripts/buildNews.mjs and public/data/news.json are untouched: the
// shipped NEWS tab keeps reading v1 until the Phase 4 UI cutover.
//
// WHY THE PENDING QUEUE IS A SEPARATE, UNSHIPPED FILE: an Event in
// `pending-confirmation` is, by definition, an unconfirmed claim that a head
// of state/government was killed. `isReaderVisible()` keeps it out of the UI,
// but anything under public/ is served to everyone — a "hidden" rumor in a
// public JSON file is still published. So the public asset carries reader-
// visible Events only. debug/ is gitignored; Phase 5 (Admin Console) decides
// the queue's real home.
//
// SOURCES: src/news/feeds.json maps a feed URL to a sources.json id. Only
// `outlet` profiles are ingested — `analysis` orgs (ISW, Bellingcat, ACLED,
// Crisis Group, ...) have reachable feeds but need their own dossier-entry
// construction (specialist-verified is the point of them); that's BACKLOG.md.
// v1's feeds for outlets NOT in the vetted roster (Euronews, Defense News,
// Breaking Defense, The War Zone, NASA, Ars Technica) are dropped: an outlet
// with no SourceProfile has no leaning/tier/pressControl to attach.
import fs from 'node:fs'
import { feature } from 'topojson-client'
import { parseRssItems } from './lib/rss.mjs'
import { buildCountryMatchers, TAIWAN_REF } from '../src/news/countryResolution.ts'
import { buildEvents } from '../src/news/eventBuilder.ts'

const COUNTRIES_SOURCE = 'public/geo/countries-un193.json'
const SOURCES = 'src/news/sources.json'
const FEEDS = 'src/news/feeds.json'
const OUTPUT = 'public/data/news-events.json'
const PENDING_OUTPUT = 'debug/news-pending-confirmation.json'
const BACKLOG = 'BACKLOG.md'

async function fetchTextRetry(url, attempts = 3) {
  let lastErr
  for (let i = 0; i < attempts; i++) {
    try {
      const res = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0 (compatible; ProjectAtlasNewsBot/1.0)' }, signal: AbortSignal.timeout(20_000) })
      if (!res.ok) throw new Error(`${res.status} ${res.statusText}`)
      return await res.text()
    } catch (err) {
      lastErr = err
      if (i < attempts - 1) await new Promise((resolve) => setTimeout(resolve, 2000 * (i + 1)))
    }
  }
  throw lastErr
}

const stripHtml = (s) => s?.replace(/<[^>]*>/g, ' ').replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ').trim()

const topology = JSON.parse(fs.readFileSync(COUNTRIES_SOURCE, 'utf8'))
const countries = feature(topology, topology.objects[Object.keys(topology.objects)[0]]).features.map((f) => ({
  id: String(f.id),
  name: f.properties.name,
}))
const countryMatchers = buildCountryMatchers([...countries, TAIWAN_REF])
const profiles = JSON.parse(fs.readFileSync(SOURCES, 'utf8'))
const feeds = JSON.parse(fs.readFileSync(FEEDS, 'utf8'))

const feedFailures = []
const articles = []
await Promise.all(
  feeds.map(async ({ sourceId, url }) => {
    let xml
    try {
      xml = await fetchTextRetry(url)
    } catch (err) {
      feedFailures.push(`${sourceId} (${url}): ${err.message}`)
      return
    }
    for (const item of parseRssItems(xml)) {
      if (!item.title || !item.link) continue
      const parsed = item.pubDate ? Date.parse(item.pubDate) : Number.NaN
      articles.push({
        sourceId,
        title: stripHtml(item.title),
        description: stripHtml(item.description),
        url: item.link,
        ...(Number.isNaN(parsed) ? {} : { publishedAt: new Date(parsed).toISOString() }),
      })
    }
  }),
)

// Raw pull, kept (gitignored) so clustering/classification can be tuned against real headlines offline.
fs.mkdirSync('debug', { recursive: true })
fs.writeFileSync('debug/news-articles.json', JSON.stringify(articles, null, 1))

const now = new Date().toISOString()
const result = buildEvents(articles, { profiles, countryMatchers, now })

fs.mkdirSync('public/data', { recursive: true })
fs.writeFileSync(OUTPUT, JSON.stringify(result.published, null, 2))
fs.mkdirSync('debug', { recursive: true })
fs.writeFileSync(PENDING_OUTPUT, JSON.stringify(result.pending, null, 2))

const bySeverity = (s) => result.published.filter((e) => e.severity === s).length
console.log(`Fetched ${articles.length} articles from ${feeds.length - feedFailures.length}/${feeds.length} feeds.`)
for (const failure of feedFailures) console.warn(`  feed failed: ${failure}`)
console.log(`Wrote ${OUTPUT}: ${result.published.length} Events (${result.clusters} clusters from ${result.articlesIn} articles).`)
console.log(`  severity — critical=${bySeverity('critical')}, major=${bySeverity('major')}, significant=${bySeverity('significant')}, routine=${bySeverity('routine')}`)
console.log(`  pending-confirmation (not shipped): ${result.pending.length} -> ${PENDING_OUTPUT}`)
console.log(
  `  dropped articles — not-a-report=${result.dropped['not-a-report'].length}, no-country=${result.dropped['no-country'].length}, no-topic=${result.dropped['no-topic'].length}, ` +
    `below-floor=${result.dropped['below-floor'].length}, unknown-source=${result.dropped['unknown-source'].length}, duplicate-urls=${result.duplicateUrls}`,
)

// ---------------------------------------------------------------------------
// BACKLOG.md — marker-delimited idempotent section, same pattern as v1's
// buildNews.mjs (its own markers, so the two reports don't overwrite each other).
// ---------------------------------------------------------------------------
function writeBacklogReport() {
  const BEGIN = '<!-- BEGIN buildNewsEvents.mjs gap report -->'
  const END = '<!-- END buildNewsEvents.mjs gap report -->'
  const lines = [
    BEGIN,
    '',
    `**Generated by \`npm run build:news:events\` (\`scripts/buildNewsEvents.mjs\`), ${now.slice(0, 10)}.** Re-running regenerates this list — don't hand-edit it.`,
    '',
    `- ${result.published.length} Event(s) published from ${result.articlesIn} article(s) across ${feeds.length - feedFailures.length}/${feeds.length} feeds; ${result.pending.length} pending confirmation.`,
    `- ${result.dropped['below-floor'].length} article(s) sat in an Event below its corroboration floor (a lone report never publishes — every tier needs 2+ distinct sources) and were not emitted.`,
  ]
  if (feedFailures.length > 0) {
    lines.push(`- ${feedFailures.length} feed(s) failed to fetch this run:`)
    for (const f of feedFailures) lines.push(`  - ${f}`)
  }
  const noCountry = result.dropped['no-country']
  lines.push(`- ${noCountry.length} article(s) dropped for no resolvable country link (person names like "Trump"/"Merz" and orgs like the ICC don't resolve — see the standing item above)` + (noCountry.length ? ' (first 25):' : '.'))
  for (const d of noCountry.slice(0, 25)) lines.push(`  - "${d.title}" (${d.sourceId})`)
  lines.push('', END)
  const section = lines.join('\n')

  const backlog = fs.readFileSync(BACKLOG, 'utf8')
  const beginIdx = backlog.indexOf(BEGIN)
  const endIdx = backlog.indexOf(END)
  let updated
  if (beginIdx !== -1 && endIdx !== -1) {
    updated = backlog.slice(0, beginIdx) + section + backlog.slice(endIdx + END.length)
  } else {
    const heading = '\n## Data sourcing (`buildNewsEvents.mjs`)\n\n'
    const introEnd = backlog.indexOf('\n## ')
    updated = introEnd === -1 ? backlog + heading + section + '\n' : backlog.slice(0, introEnd) + heading + section + '\n' + backlog.slice(introEnd)
  }
  fs.writeFileSync(BACKLOG, updated)
  console.log(`Updated ${BACKLOG}.`)
}

writeBacklogReport()
