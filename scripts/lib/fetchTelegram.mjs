// Fetches the first-hand Telegram channels in src/news/sources.json (sourceType 'first-hand') into RawArticle records, through
// Telegram's public web preview (t.me/s/<channel>) — Phase 7's keyless source. Returns the SAME shape as fetchFeedArticles
// ({ articles, feedFailures, failedFeeds }) so every caller treats a channel like a feed, and so a GramJS implementation
// (BACKLOG.md: "Revisit the Telegram API") can replace this file without touching the tiering/gating code.
//
// Parsing lives in src/news/telegramPreview.ts (pure, tested); this is only the network shell plus paging.
import { parseTelegramPreview, postToRawArticle } from '../../src/news/telegramPreview.ts'
import { fetchTextRetry } from './fetchFeeds.mjs'

/** The URL a channel's newest page is at, and what a failure is reported under (the cadence runner keys streaks by it). */
export const previewUrl = (channel, before) => `https://t.me/s/${channel}${before ? `?before=${before}` : ''}`

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

/**
 * A preview page holds ~20 posts, and a busy channel (ClashReport: ~14 an hour) outruns one page well within a 3-hour watch
 * interval — so page backwards with `?before=<oldest id>` until a page reaches past the lookback, and cap the pages so a
 * runaway channel can't turn one tick into hundreds of requests. The archive dedupes by URL, so re-reading posts a previous
 * tick already stored costs nothing but the request.
 *
 * @param {import('../../src/news/types.ts').FirstHandProfile[]} profiles
 * @param {{ lookbackHours?: number, maxPages?: number, pauseMs?: number, now?: number }} [options]
 */
export async function fetchFirstHandArticles(profiles, { lookbackHours = 6, maxPages = 5, pauseMs = 400, now = Date.now() } = {}) {
  const cutoff = now - lookbackHours * 3_600_000
  const feedFailures = []
  const failedFeeds = []
  const articles = []

  // Channels in parallel; one channel's pages in sequence (each page's `before` depends on the last), with a pause between so
  // a run is not a burst against t.me.
  await Promise.all(
    profiles.map(async (profile) => {
      const url = previewUrl(profile.channel)
      try {
        const posts = []
        let before
        for (let page = 0; page < maxPages; page++) {
          const batch = parseTelegramPreview(await fetchTextRetry(previewUrl(profile.channel, before)))
          // An empty FIRST page is a failure, not a quiet channel: a disabled preview, a renamed handle and a changed markup all
          // look like this, and treating them as "no posts" would hide a dead channel forever.
          if (page === 0 && batch.length === 0) throw new Error('no posts in the web preview (preview disabled, handle renamed, or markup changed)')
          if (batch.length === 0) break
          // t.me follows a renamed handle to the new owner — never file another channel's posts under this profile.
          if (batch.some((p) => p.channel.toLowerCase() !== profile.channel.toLowerCase())) throw new Error(`the preview served a different channel (${batch[0].channel})`)
          posts.push(...batch)
          const oldest = batch.reduce((a, b) => (b.id < a.id ? b : a))
          const oldestTime = oldest.publishedAt ? Date.parse(oldest.publishedAt) : Number.NaN
          if (oldest.id <= 1 || (!Number.isNaN(oldestTime) && oldestTime < cutoff) || oldest.id === before) break
          before = oldest.id
          await sleep(pauseMs)
        }
        for (const post of posts) {
          const article = postToRawArticle(post, profile)
          if (article) articles.push(article)
        }
      } catch (err) {
        feedFailures.push(`${profile.id} (${url}): ${err.message}`)
        failedFeeds.push({ sourceId: profile.id, url, error: err.message })
      }
    }),
  )
  return { articles, feedFailures, failedFeeds }
}
