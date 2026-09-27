// Wire channel adapter: a Google-News-format sitemap the publisher lists in its own robots.txt. Only this one file is fetched — never
// the article pages it points at. See src/news/wireSitemap.ts.
import { fetchTextRetry } from '../fetchFeeds.mjs'
import { fetchTextViaCurl } from './curlFetch.mjs'
import { normalizeSitemapItems, parseNewsSitemap } from '../../../src/news/wireSitemap.ts'

/** @type {import('./index.mjs').WireAdapter} */
export async function fetchNewsSitemap(publisher, channel) {
  const targets = [{ sourceId: publisher.sourceId, url: channel.url }]
  try {
    const items = parseNewsSitemap(await (channel.transport === 'curl' ? fetchTextViaCurl : fetchTextRetry)(channel.url))
    if (items.length === 0) throw new Error('200 OK but no <url> entries parsed')
    return { articles: normalizeSitemapItems(items, publisher, channel).articles, feedFailures: [], failedFeeds: [], targets }
  } catch (err) {
    return { articles: [], feedFailures: [`${publisher.sourceId} (${channel.url}): ${err.message}`], failedFeeds: [{ sourceId: publisher.sourceId, url: channel.url, error: err.message }], targets }
  }
}
