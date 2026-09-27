// Wire channel adapter: Google News RSS search, one request per query in the channel (`site:reuters.com`, then topic splits). See
// src/news/wireSources.ts for why several queries: the feed caps at 100 items per query and ranks by relevance, so one query only
// samples a busy publisher. Fetch + parse only; every decision about what an item becomes is the pure normalizeGoogleNewsItems.
import { fetchTextRetry } from '../fetchFeeds.mjs'
import { parseRssItems } from '../rss.mjs'
import { googleNewsSearchUrl, normalizeGoogleNewsItems } from '../../../src/news/wireSources.ts'

const GAP_MS = 1000 // sequential and spaced: a burst of searches is what gets a client throttled

/** @type {import('./index.mjs').WireAdapter} */
export async function fetchGoogleNewsRss(publisher, channel) {
  const feedFailures = []
  const failedFeeds = []
  const articles = []
  const seen = new Set() // shared across this channel's queries, so the same URL or headline is kept once
  const targets = channel.queries.map((q) => ({ sourceId: publisher.sourceId, url: googleNewsSearchUrl(q, channel.lookback) }))
  for (const [i, { url }] of targets.entries()) {
    if (i > 0) await new Promise((resolve) => setTimeout(resolve, GAP_MS))
    try {
      const items = parseRssItems(await fetchTextRetry(url))
      // A 200 with no <item> on the BASE query is Google changing its markup or serving a consent page, not a quiet news day (a
      // 2-day site: window holds ~100). Report it so news:status / the failure streaks notice. A narrow topic query can legitimately
      // return nothing, so only the base query (first) is held to this.
      if (items.length === 0 && i === 0) throw new Error('200 OK but no <item>s parsed')
      articles.push(...normalizeGoogleNewsItems(items, publisher, seen).articles)
    } catch (err) {
      feedFailures.push(`${publisher.sourceId} (${url}): ${err.message}`)
      failedFeeds.push({ sourceId: publisher.sourceId, url, error: err.message })
    }
  }
  return { articles, feedFailures, failedFeeds, targets }
}
