// Fetches every feed in src/news/feeds.json into RawArticle records. Shared by buildNewsEvents.mjs and archiveNews.mjs so the
// two can never disagree about what a feed item becomes.
import { parseRssItems } from './rss.mjs'

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

/** @param {{ sourceId: string, url: string }[]} feeds */
export async function fetchFeedArticles(feeds) {
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
  return { articles, feedFailures }
}
