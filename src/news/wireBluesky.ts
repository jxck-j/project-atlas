// Wire channel: a publisher's OWN Bluesky account (reuters.com, apnews.com), read through the public unauthenticated AppView. Pure.
//
// Why this is the best of the wire channels: the publisher writes the post itself, and its link card is exactly the headline, the
// description and the thumbnail the publisher chose to put in a preview — real text where Google gives a link stub. Measured
// 2026-09-26: Reuters ~150 posts/day with 98% carrying a card (title + description + thumb), AP ~33/day with 91%. AFP's accounts post
// text and pictures but almost never a link card (3 of 300 on the English account), so AFP does not use this channel.
//
// A card's link is the publisher's own shortener (`reut.rs/…`, AP's `bit.ly/…`). normalizeBlueskyPosts keeps it as-is; the adapter
// resolves it with a HEAD request to the shortener (never to the article) and applyResolvedLink then checks the destination is the
// publisher's own site. An unresolvable short link is kept rather than dropped: it is still the publisher's official link.
import type { RawArticle } from './eventBuilder'
import { archiveKey } from './articleArchive'
import { cleanArticleUrl, hasEnoughWords, hostOf, isNonReportTitle, stripInvisible, titleKey } from './wireCommon'
import type { BlueskyChannel, WirePublisher } from './wireSources'

/** The fields of `app.bsky.feed.getAuthorFeed`'s `feed[]` entries that are read here. */
export interface BlueskyFeedItem {
  post?: {
    record?: { createdAt?: string }
    embed?: { external?: { uri?: string; title?: string; description?: string; thumb?: string } }
  }
  /** Present on a repost: someone else's post appearing in this account's feed. */
  reason?: unknown
}

export type BlueskyDropReason = 'repost' | 'no-link-card' | 'foreign-link' | 'not-a-report' | 'title-too-short' | 'duplicate'

export interface BlueskyNormalizeResult {
  articles: RawArticle[]
  dropped: Record<BlueskyDropReason, number>
}

export const isShortlink = (url: string, shorteners: string[] = []): boolean => {
  const host = hostOf(url)
  return host !== undefined && shorteners.includes(host)
}

export function normalizeBlueskyPosts(
  feed: BlueskyFeedItem[],
  publisher: Pick<WirePublisher, 'sourceId' | 'domains'>,
  channel: Pick<BlueskyChannel, 'shorteners'> = {},
  seen: Set<string> = new Set(),
): BlueskyNormalizeResult {
  const dropped: Record<BlueskyDropReason, number> = { repost: 0, 'no-link-card': 0, 'foreign-link': 0, 'not-a-report': 0, 'title-too-short': 0, duplicate: 0 }
  const articles: RawArticle[] = []
  for (const item of feed) {
    if (item.reason) {
      dropped.repost++
      continue
    }
    const card = item.post?.embed?.external
    if (!card?.uri || !card.title) {
      dropped['no-link-card']++
      continue
    }
    // Only the publisher's own site or its own shortener: Reuters' account also posts YouTube links, which are not articles.
    const host = hostOf(card.uri)
    const direct = host !== undefined && publisher.domains.includes(host)
    if (!direct && !isShortlink(card.uri, channel.shorteners)) {
      dropped['foreign-link']++
      continue
    }
    const title = stripInvisible(card.title)
    if (isNonReportTitle(title)) {
      dropped['not-a-report']++
      continue
    }
    if (!hasEnoughWords(title)) {
      dropped['title-too-short']++
      continue
    }
    const url = direct ? cleanArticleUrl(card.uri) : card.uri
    const urlKey = `url:${archiveKey(url)}`
    const headlineKey = `title:${publisher.sourceId}:${titleKey(title)}`
    if (seen.has(urlKey) || seen.has(headlineKey)) {
      dropped.duplicate++
      continue
    }
    seen.add(urlKey)
    seen.add(headlineKey)
    const description = card.description ? stripInvisible(card.description) : ''
    const parsed = item.post?.record?.createdAt ? Date.parse(item.post.record.createdAt) : Number.NaN
    articles.push({
      sourceId: publisher.sourceId,
      title,
      url,
      // A description that only repeats the headline adds nothing to the classifier and would look padded on a card.
      ...(description && titleKey(description) !== titleKey(title) ? { description } : {}),
      ...(Number.isNaN(parsed) ? {} : { publishedAt: new Date(parsed).toISOString() }),
      ...(card.thumb ? { imageUrl: card.thumb } : {}),
    })
  }
  return { articles, dropped }
}

/**
 * Applies a resolved short link. `resolved` undefined (the lookup failed) keeps the short link. A destination that is not the
 * publisher's own site drops the article: a shortener can point anywhere, and only the publisher's site is a wire report.
 */
export function applyResolvedLink(article: RawArticle, resolved: string | undefined, publisher: Pick<WirePublisher, 'domains'>): RawArticle | null {
  if (!resolved) return article
  const host = hostOf(resolved)
  if (!host || !publisher.domains.includes(host)) return null
  return { ...article, url: cleanArticleUrl(resolved) }
}
