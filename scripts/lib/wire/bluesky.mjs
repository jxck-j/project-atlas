// Wire channel adapter: a publisher's own Bluesky account. Fetch + resolve only; every decision about what a post becomes is the pure
// normalizeBlueskyPosts / applyResolvedLink in src/news/wireBluesky.ts.
import { fetchTextRetry } from '../fetchFeeds.mjs'
import { resolveShortlinks } from './shortlinks.mjs'
import { applyResolvedLink, isShortlink, normalizeBlueskyPosts } from '../../../src/news/wireBluesky.ts'

const feedUrl = (handle, cursor) =>
  `https://public.api.bsky.app/xrpc/app.bsky.feed.getAuthorFeed?actor=${encodeURIComponent(handle)}&limit=100&filter=posts_no_replies${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`

/** @type {import('./index.mjs').WireAdapter} */
export async function fetchBluesky(publisher, channel) {
  const url = feedUrl(channel.handle)
  const targets = [{ sourceId: publisher.sourceId, url }]
  const fail = (err) => ({ articles: [], feedFailures: [`${publisher.sourceId} (${url}): ${err.message}`], failedFeeds: [{ sourceId: publisher.sourceId, url, error: err.message }], targets })
  const feed = []
  let cursor
  for (let page = 0; page < (channel.pages ?? 1); page++) {
    try {
      const json = JSON.parse(await fetchTextRetry(feedUrl(channel.handle, cursor)))
      // An account with no posts at all is the API changing or the handle going away, not a quiet day: report it.
      if (page === 0 && !(json.feed?.length > 0)) throw new Error('200 OK but the feed is empty')
      feed.push(...(json.feed ?? []))
      cursor = json.cursor
    } catch (err) {
      if (page === 0) return fail(err)
      break // a later page failing keeps what the earlier pages gave
    }
    if (!cursor) break
  }
  const { articles } = normalizeBlueskyPosts(feed, publisher, channel)
  const isShortener = (u) => isShortlink(u, channel.shorteners)
  const resolved = await resolveShortlinks(articles.map((a) => a.url).filter(isShortener), { isShortener })
  const finished = []
  for (const a of articles) {
    const r = isShortener(a.url) ? applyResolvedLink(a, resolved.get(a.url), publisher) : a
    if (r) finished.push(r)
  }
  return { articles: finished, feedFailures: [], failedFeeds: [], targets }
}
