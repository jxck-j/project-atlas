// Build-time asset generator for News Engine v2 (Phase 2 — the Event build
// pipeline). Implements news-sourcing-design.md §6/§8/§17: fetch the vetted
// outlets' RSS feeds, resolve countries, cluster articles into Events, build
// each Event's source dossier, and publish only what clears its severity
// tier's corroboration floor. All the logic lives in src/news/ (pure, tested);
// this file is the fetch/write shell around it.
//
// Since the Phase 4 cutover the pull is not what gets built: every fetched
// article is appended to the archive first, and the build then runs over the
// archive's last FEED_RETENTION_DAYS (src/news/feedWindow.ts). One run
// therefore publishes a rolling two-week feed, not just what broke since the
// previous run.
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
// MODES
//   (default)                same-event grouping by LOCAL sentence embeddings (all-MiniLM-L12-v2 via
//                            transformers.js), plus relevance and topic tags from a small classifier over the
//                            same vectors, trained on hand labels. Free and keyless; the only network use is
//                            a one-time ~33 MB model download into debug/hf-cache, after which it runs
//                            offline. Severity, countries and titles are still keyword rules / outlet
//                            headlines — the classifier did not beat the severity rules. On hand-labeled
//                            samples: 40/47 multi-outlet stories grouped (heuristic: 16/47), relevance
//                            F1 0.86 (keyword rule: 0.73), tag macro-F1 0.74 (keywords: 0.60). See
//                            LOGBOOK.md, scripts/evalNewsClustering.mjs, scripts/evalNewsClassifier.mjs.
//     --no-classifier        keyword tags and no relevance gate (embedding grouping only).
//   --heuristic              Phase 2's keyword classification + word-overlap clustering. No model, no network
//                            beyond the feeds; much weaker grouping (16/47 stories vs 40/47 on the eval).
//   --llm                    Phase 3: LLM classification + same-event grouping (Sonnet 5, J's
//                            2026-09-20 decision). NEVER spends by default: it first measures the
//                            exact input tokens with the free count_tokens endpoint, prints a projected
//                            cost, and stops. Add --yes to actually generate.
//     --yes                  spend: run the classification/grouping calls.
//     --limit N              classify only the N newest candidates — a cents-scale first run, and how
//                            the projection's output-token assumption gets replaced by a measurement.
//     --max-cost USD         refuse to run if the projection exceeds this (default 5).
//   Needs ANTHROPIC_API_KEY (or an `ant auth login` profile). Classifications are cached by
//   URL+text+prompt version+model in debug/news-classification-cache.json, so the twice-daily
//   cadence only pays for articles it hasn't seen.
//
// Since the Phase 4 cutover (2026-09-23) this file's output IS the shipped
// NEWS tab: hud/NewsPanel.tsx and IntelligencePanel.tsx both read
// public/data/news-events.json. v1 (scripts/buildNews.mjs, public/data/news.json,
// the NewsItem model and its registry) was deleted once the cutover was confirmed
// in the browser.
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
import { fetchFeedArticles } from './lib/fetchFeeds.mjs'
import { archiveArticles, readArchive } from './lib/newsArchive.mjs'
import { applyPullMetadata, FEED_RETENTION_DAYS, selectFeedWindow } from '../src/news/feedWindow.ts'
import { buildCountryMatchers, TAIWAN_REF } from '../src/news/countryResolution.ts'
import { buildEvents, buildEventsWithEmbeddings, buildEventsWithLlm } from '../src/news/eventBuilder.ts'
import { createLocalEmbedder } from '../src/news/localEmbedder.ts'
import { loadShippedClassifier } from '../src/news/shippedClassifier.ts'
import { costUsd, createAnthropicCall, createCountingCall, estimateRunCost, NEWS_MODEL, SONNET_5_PRICING } from '../src/news/anthropicCall.ts'

const COUNTRIES_SOURCE = 'public/geo/countries-un193.json'
const SOURCES = 'src/news/sources.json'
const FEEDS = 'src/news/feeds.json'
const OUTPUT = 'public/data/news-events.json'
const PENDING_OUTPUT = 'debug/news-pending-confirmation.json'
const BACKLOG = 'BACKLOG.md'
const CACHE_FILE = 'debug/news-classification-cache.json'
const AUDIT_FILE = 'debug/news-llm-audit.json'

const argv = process.argv.slice(2)
const flag = (name) => argv.includes(name)
const numArg = (name, fallback) => {
  const i = argv.indexOf(name)
  if (i === -1) return fallback
  const v = Number(argv[i + 1])
  if (!Number.isFinite(v) || v <= 0) throw new Error(name + ' needs a positive number')
  return v
}
const USE_LLM = flag('--llm')
const USE_HEURISTIC = flag('--heuristic')
const NO_CLASSIFIER = flag('--no-classifier')
if (USE_LLM && USE_HEURISTIC) throw new Error('--llm and --heuristic are alternatives; pick one')
const SPEND = flag('--yes')
const LIMIT = numArg('--limit', undefined)
const MAX_COST = numArg('--max-cost', 5)
if ((SPEND || LIMIT !== undefined) && !USE_LLM) throw new Error('--yes and --limit only apply with --llm')

const topology = JSON.parse(fs.readFileSync(COUNTRIES_SOURCE, 'utf8'))
const countries = feature(topology, topology.objects[Object.keys(topology.objects)[0]]).features.map((f) => ({
  id: String(f.id),
  name: f.properties.name,
}))
const countryMatchers = buildCountryMatchers([...countries, TAIWAN_REF])
const profiles = JSON.parse(fs.readFileSync(SOURCES, 'utf8'))
const feeds = JSON.parse(fs.readFileSync(FEEDS, 'utf8'))

const { articles: pulled, feedFailures } = await fetchFeedArticles(feeds)

// Raw pull, kept (gitignored) so clustering/classification can be tuned against real headlines offline.
fs.mkdirSync('debug', { recursive: true })
fs.writeFileSync('debug/news-articles.json', JSON.stringify(pulled, null, 1))

// Append-only archive of everything any run has seen (see scripts/lib/newsArchive.mjs). Done before anything that can fail or exit
// early (model load, LLM dry run), so a run that publishes nothing still keeps its feed window.
const archived = archiveArticles(pulled, new Date().toISOString())
console.log(`Archive: +${archived.added} new, ${archived.total} total.`)

// THE BUILD READS THE ARCHIVE, NOT THE PULL (Phase 4, J's call). RSS only exposes the last day or two, so building from
// one pull publishes only what happened since the last run — v1 worked around that by carrying its own previous output
// forward and re-ingesting it. Here the archive (just updated with this pull, above) already holds every article any run
// has seen, so the feed window is a filter over it: see src/news/feedWindow.ts. Fresh clone with no archive yet: fall
// back to the pull, so the build still works rather than publishing nothing.
const stored = readArchive()
const articles = stored.length > 0 ? applyPullMetadata(selectFeedWindow(stored, new Date().toISOString()), pulled) : pulled
const windowStart = articles[0]?.publishedAt
console.log(
  `Feed window: ${articles.length} article(s) within ${FEED_RETENTION_DAYS} days` +
    (windowStart ? ` (oldest ${windowStart.slice(0, 10)})` : '') +
    (stored.length > 0 ? ` of ${stored.length} archived.` : ' — no archive yet, using this pull only.'),
)

// ---------------------------------------------------------------------------
// LLM mode
// ---------------------------------------------------------------------------
function loadCache() {
  try {
    return new Map(Object.entries(JSON.parse(fs.readFileSync(CACHE_FILE, 'utf8'))))
  } catch {
    return new Map()
  }
}

// Tracks which entries this run touched so the file is pruned to the current
// feed window instead of growing forever.
function trackedCache(store) {
  const touched = new Set()
  return {
    touched,
    get: (k) => {
      const v = store.get(k)
      if (v) touched.add(k)
      return v
    },
    set: (k, v) => {
      store.set(k, v)
      touched.add(k)
    },
  }
}

async function runLlm() {
  const { default: Anthropic } = await import('@anthropic-ai/sdk')
  const themes = JSON.parse(fs.readFileSync('src/news/systemicThemes.json', 'utf8'))
  const llmCountries = [...countries, TAIWAN_REF]
  const client = new Anthropic()
  const store = loadCache()
  const base = { profiles, countryMatchers, now, model: NEWS_MODEL, countries: llmCountries, themes, limit: LIMIT }

  try {
    // Pass 1 — free: exact input tokens, nothing generated, nothing cached.
    const readOnly = { get: (k) => store.get(k), set: () => {} }
    const counted = await buildEventsWithLlm(articles, { ...base, call: createCountingCall(client), cache: readOnly })
    const { usage, candidates, cacheHits } = counted.llm
    if (counted.llm.failed > 0) {
      // A failed count is not a zero-cost run. Stop rather than print a projection built from nothing.
      console.error('count_tokens failed for ' + counted.llm.failed + ' article(s): ' + counted.llm.failureReasons.join(' | ') + '. Nothing was spent or written.')
      process.exit(1)
    }
    const toClassify = candidates - cacheHits
    const projection = estimateRunCost(usage.inputTokens, toClassify)
    const a = projection.assumptions
    console.log('LLM dry run (count_tokens, no generation):')
    console.log('  ' + candidates + ' candidates after the wide pre-filter' + (LIMIT ? ' (--limit ' + LIMIT + ')' : '') + '; ' + cacheHits + ' already cached; ' + toClassify + ' to classify in ' + usage.calls + ' request(s).')
    console.log('  exact classification input: ' + usage.inputTokens.toLocaleString() + ' tokens (before prompt-cache discounts)')
    console.log('  projected cost ~ $' + projection.usd.toFixed(2) + ' at Sonnet 5 list price ($' + SONNET_5_PRICING.inputPerMTok + '/$' + SONNET_5_PRICING.outputPerMTok + ' per MTok)')
    console.log('    ASSUMED, not measured: ' + a.outputPerArticle + ' output tokens/article incl. thinking, ' + Math.round(a.acceptRate * 100) + '% of candidates accepted, grouping ' + a.groupInputPerArticle + ' in / ' + a.groupOutputPerArticle + ' out tokens per accepted article. A --limit run measures the real figure.')
    if (projection.usd > MAX_COST) {
      console.error('Refusing: projection $' + projection.usd.toFixed(2) + ' exceeds --max-cost $' + MAX_COST + '. Nothing was spent or written.')
      process.exit(1)
    }
    if (!SPEND) {
      console.log('Not generating: pass --yes to spend. Nothing was written.')
      return undefined
    }

    // Pass 2 — real calls.
    const cache = trackedCache(store)
    const live = await buildEventsWithLlm(articles, { ...base, call: createAnthropicCall(client), cache })
    const l = live.llm
    if (l.failed > 0) console.warn('  ' + l.failed + ' classification(s) failed and were dropped: ' + l.failureReasons.join(' | '))
    if (l.candidates > 0 && l.failed / l.candidates > 0.5) {
      // Fail closed WITHOUT overwriting: an API outage must not replace a good published file with an empty one.
      console.error('Aborting: ' + l.failed + '/' + l.candidates + ' classifications failed. public/data/news-events.json was left untouched.')
      process.exit(1)
    }
    const spent = costUsd(l.usage)
    console.log('LLM run: ' + l.usage.calls + ' call(s), ' + l.usage.inputTokens.toLocaleString() + ' in / ' + l.usage.outputTokens.toLocaleString() + ' out (+' + l.usage.cacheReadTokens.toLocaleString() + ' cache-read, ' + l.usage.cacheWriteTokens.toLocaleString() + ' cache-write) ~ $' + spent.toFixed(3) + ' actual.')
    const fresh = l.classified - l.cacheHits
    if (fresh > 0) console.log('  measured: ' + (l.usage.outputTokens / fresh).toFixed(0) + ' output tokens per newly-classified article (the projection assumed ' + a.outputPerArticle + ').')
    const g = l.grouping
    console.log('  grouping: ' + g.windows + ' window(s); model omitted ' + g.missing + ', repeated ' + g.duplicated + ', invented ' + g.unknown + ' id(s); ' + g.splitByGuard + ' group(s) split by a code guard; ' + g.oversized + ' oversized; heuristic fallback: ' + g.fellBackToHeuristic)

    fs.mkdirSync('debug', { recursive: true })
    fs.writeFileSync(CACHE_FILE, JSON.stringify(Object.fromEntries([...store].filter(([k]) => cache.touched.has(k)))))
    fs.writeFileSync(AUDIT_FILE, JSON.stringify(l.audit, null, 1))
    console.log('  cache: ' + cache.touched.size + ' entries -> ' + CACHE_FILE + '; per-article audit -> ' + AUDIT_FILE)
    return live
  } catch (err) {
    console.error('LLM run failed: ' + (err instanceof Error ? err.message : err) + '\nNothing was written.')
    process.exit(1)
  }
}

const now = new Date().toISOString()
const buildCtx = { profiles, countryMatchers, now }

// Default: local embeddings. Fails LOUDLY rather than silently degrading to the heuristic — a build that quietly
// switched grouping methods would change what gets published without anyone deciding it should.
async function runEmbed() {
  try {
    return await buildEventsWithEmbeddings(articles, buildCtx, await createLocalEmbedder({ cacheDir: 'debug/hf-cache' }), {
      classifier: NO_CLASSIFIER ? null : loadShippedClassifier(),
    })
  } catch (err) {
    console.error(
      'Embedding model unavailable: ' + (err instanceof Error ? err.message : err) +
        '\nThe first run downloads a ~33 MB model from huggingface.co into debug/hf-cache; after that it works offline.' +
        '\nTo build without it (word-overlap clustering, much weaker), pass --heuristic. Nothing was written.',
    )
    process.exit(1)
  }
}

const result = USE_LLM ? await runLlm() : USE_HEURISTIC ? buildEvents(articles, buildCtx) : await runEmbed()
if (!result) process.exit(0) // LLM dry run: nothing to write

fs.mkdirSync('public/data', { recursive: true })
fs.writeFileSync(OUTPUT, JSON.stringify(result.published, null, 2))
fs.mkdirSync('debug', { recursive: true })
fs.writeFileSync(PENDING_OUTPUT, JSON.stringify(result.pending, null, 2))

const bySeverity = (s) => result.published.filter((e) => e.severity === s).length
console.log(`Fetched ${pulled.length} articles from ${feeds.length - feedFailures.length}/${feeds.length} feeds; built from ${articles.length} in the feed window.`)
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
// v1's buildNews.mjs used (its own markers, kept so an older v1 report block in
// BACKLOG.md is never clobbered by this one).
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
