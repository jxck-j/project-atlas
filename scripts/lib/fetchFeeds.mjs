// Fetches every feed in src/news/feeds.json into RawArticle records. Shared by buildNewsEvents.mjs and archiveNews.mjs so the
// two can never disagree about what a feed item becomes.
import { parseRssItems } from './rss.mjs'

// res.text() always decodes UTF-8, but several roster feeds (Reforma, Folha) declare ISO-8859-1 — decoded as UTF-8 every
// accented character becomes U+FFFD ("M�xico"). Honour the declared charset: the HTTP header first, then the XML
// declaration, then UTF-8.
function decodeFeed(bytes, contentType) {
  const head = new TextDecoder('latin1').decode(bytes.subarray(0, 200))
  const label = contentType?.match(/charset=["']?([\w-]+)/i)?.[1] ?? head.match(/<\?xml[^>]*encoding=["']([\w-]+)["']/i)?.[1] ?? 'utf-8'
  try {
    return new TextDecoder(label).decode(bytes)
  } catch {
    return new TextDecoder('utf-8').decode(bytes)
  }
}

async function fetchTextRetry(url, attempts = 3) {
  let lastErr
  for (let i = 0; i < attempts; i++) {
    try {
      const res = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0 (compatible; ProjectAtlasNewsBot/1.0)' }, signal: AbortSignal.timeout(20_000) })
      if (!res.ok) throw new Error(`${res.status} ${res.statusText}`)
      return decodeFeed(new Uint8Array(await res.arrayBuffer()), res.headers.get('content-type'))
    } catch (err) {
      lastErr = err
      if (i < attempts - 1) await new Promise((resolve) => setTimeout(resolve, 2000 * (i + 1)))
    }
  }
  throw lastErr
}

const stripHtml = (s) => s?.replace(/<[^>]*>/g, ' ').replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ').trim()

/** @param {{ sourceId: string, url: string, language?: string }[]} feeds */
export async function fetchFeedArticles(feeds) {
  const feedFailures = []
  // Same failures, structured: the cadence runner (scripts/newsCycle.mjs) tracks consecutive failures per feed URL.
  const failedFeeds = []
  const articles = []
  await Promise.all(
    feeds.map(async ({ sourceId, url, language }) => {
      let xml
      try {
        xml = await fetchTextRetry(url)
      } catch (err) {
        feedFailures.push(`${sourceId} (${url}): ${err.message}`)
        failedFeeds.push({ sourceId, url, error: err.message })
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
          // Carried through to the Event's source entry so a card can render a real thumbnail
          // (Phase 4). Coverage is partial by nature — many feeds ship no image at all.
          ...(item.imageUrl ? { imageUrl: item.imageUrl } : {}),
          // Absent means English (RawArticle.language) — stamped only for the feeds that say otherwise, so the archive's
          // existing English records and new ones look the same.
          ...(language && language !== 'en' ? { language } : {}),
        })
      }
    }),
  )
  return { articles, feedFailures, failedFeeds }
}
