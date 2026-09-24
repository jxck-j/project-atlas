// Everything the news pipeline pulls in one call: the RSS feeds in feeds.json PLUS the first-hand Telegram channels in
// sources.json. One entry point so buildNewsEvents.mjs, archiveNews.mjs and newsCycle.mjs can't disagree about what "a fetch"
// covers (the same reason fetchFeeds.mjs is shared).
import { fetchFeedArticles } from './fetchFeeds.mjs'
import { fetchFirstHandArticles, previewUrl } from './fetchTelegram.mjs'

/**
 * @param {{ sourceId: string, url: string, language?: string }[]} feeds
 * @param {import('../../src/news/types.ts').SourceProfile[]} profiles  the whole roster; only its first-hand channels are used
 * @returns `targets` is every thing that was attempted ({ sourceId, url }, feeds then channels) — what a "N of M failed"
 *   count and the cadence runner's per-URL failure streaks are measured against.
 */
export async function fetchAllArticles(feeds, profiles) {
  const channels = profiles.filter((p) => p.sourceType === 'first-hand')
  const [rss, telegram] = await Promise.all([fetchFeedArticles(feeds), fetchFirstHandArticles(channels)])
  return {
    articles: [...rss.articles, ...telegram.articles],
    feedFailures: [...rss.feedFailures, ...telegram.feedFailures],
    failedFeeds: [...rss.failedFeeds, ...telegram.failedFeeds],
    targets: [...feeds.map((f) => ({ sourceId: f.sourceId, url: f.url })), ...channels.map((c) => ({ sourceId: c.id, url: previewUrl(c.channel) }))],
  }
}
