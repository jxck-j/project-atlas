// Everything the news pipeline pulls in one call: the RSS feeds in feeds.json, the wire services (Reuters/AP/AFP, through the adapter
// named in wireSources.json) PLUS the first-hand Telegram channels in sources.json.
// One entry point so buildNewsEvents.mjs, archiveNews.mjs and newsCycle.mjs can't disagree about what "a fetch" covers (the same reason
// fetchFeeds.mjs is shared).
import { fetchFeedArticles } from './fetchFeeds.mjs'
import { fetchFirstHandArticles, previewUrl } from './fetchTelegram.mjs'
import { fetchWireArticles } from './wire/index.mjs'

/**
 * @param {{ sourceId: string, url: string, language?: string }[]} feeds
 * @param {import('../../src/news/types.ts').SourceProfile[]} profiles  the whole roster; only its first-hand channels are used
 * @returns `targets` is every thing that was attempted ({ sourceId, url }: feeds, wire, then channels) — what a "N of M failed"
 *   count and the cadence runner's per-URL failure streaks are measured against.
 */
export async function fetchAllArticles(feeds, profiles) {
  const channels = profiles.filter((p) => p.sourceType === 'first-hand')
  const [rss, wire, telegram] = await Promise.all([fetchFeedArticles(feeds), fetchWireArticles(), fetchFirstHandArticles(channels)])
  return {
    articles: [...rss.articles, ...wire.articles, ...telegram.articles],
    feedFailures: [...rss.feedFailures, ...wire.feedFailures, ...telegram.feedFailures],
    failedFeeds: [...rss.failedFeeds, ...wire.failedFeeds, ...telegram.failedFeeds],
    targets: [...feeds.map((f) => ({ sourceId: f.sourceId, url: f.url })), ...wire.targets, ...channels.map((c) => ({ sourceId: c.id, url: previewUrl(c.channel) }))],
  }
}
