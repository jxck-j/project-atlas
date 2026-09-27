// Wire-service ingestion (Reuters / AP / AFP), split into swappable CHANNELS and pure normalizers. Pure (no DOM/network/React) like the
// rest of src/news/.
//
// Why channels at all: none of the three publishes a reachable public feed (feedGaps.json, 2026-09-23), so each is assembled from
// whatever public, terms-friendly surfaces exist — the publisher's own Bluesky account (headline + its own description + image + a
// real link), a news sitemap it publishes for crawlers (AP: real URLs, full volume — fetched through curl, since Cloudflare 403s Node's client), and Google News RSS search (the breadth
// fallback: opaque links, no image, capped at 100 per query). A publisher lists its channels in wireSources.json; an official/licensed
// feed (Reuters Connect, AP Content API, AFP API) joins or replaces them by adding one adapter file under scripts/lib/wire/ and one
// channel entry — without touching the archive, the Event build, the gate or the client. That works because every channel's whole
// output is RawArticle records, the shape every other feed already produces, and wireCommon.ts's mergeWireArticles folds the
// channels of one publisher into a single record per story.
//
// The adapter contract (scripts/lib/wire/index.mjs registers implementations): `(publisher, channel) => Promise<{ articles:
// RawArticle[], feedFailures: string[], failedFeeds: {sourceId,url,error}[], targets: {sourceId,url}[] }>` — fetchFeeds.mjs's return
// shape plus `targets`. What is specific to Google is below; Bluesky and sitemap normalizers are in wireBluesky.ts / wireSitemap.ts.
import type { RawArticle } from './eventBuilder'
import { archiveKey } from './articleArchive'
import { cleanArticleUrl, hasEnoughWords, hostOf, isNonReportTitle, titleKey } from './wireCommon'

/** Google News RSS search: one request per query. `queries` are full search strings, e.g. `site:reuters.com (war OR strike)`. */
export interface GoogleNewsChannel {
  adapter: 'google-news-rss'
  queries: string[]
  /** Google `when:` window appended to every query. The feed caps at 100 items PER QUERY, which is why several topic queries exist. */
  lookback?: string
}

/** The publisher's own Bluesky account, read through the public unauthenticated AppView (no key). */
export interface BlueskyChannel {
  adapter: 'bluesky'
  handle: string
  /** 100 posts per page. Default 1. Reuters posts ~150/day, so it needs 2 to cover a missed run. */
  pages?: number
  /** Hosts of the publisher's own link shortener (`reut.rs`, AP's `bit.ly`): a card linking one is resolved with a HEAD request to it. */
  shorteners?: string[]
}

/** A Google-News-format sitemap the publisher itself lists in robots.txt (`news:title`, `news:publication_date`). */
export interface NewsSitemapChannel {
  adapter: 'news-sitemap'
  url: string
  /** Keep only URLs whose path starts with one of these (AP's sitemap also lists live blogs, galleries, quizzes, newsletters). */
  pathPrefixes?: string[]
  /**
   * `curl` fetches through the system curl (scripts/lib/wire/curlFetch.mjs) instead of Node's fetch. Only for a host whose CDN 403s Node but
   * not curl and where the publisher has said the fetch is fine (AP, 2026-09-26). Default `fetch`.
   */
  transport?: 'fetch' | 'curl'
}

/** Fields every channel can carry, whatever its adapter. */
export interface WireChannelBase {
  /** Set false to leave a channel configured but not fetched. */
  enabled?: boolean
  /** Why it is off (or anything a reader of the JSON needs); JSON has no comments. */
  note?: string
}

export type WireChannel = (GoogleNewsChannel | BlueskyChannel | NewsSitemapChannel) & WireChannelBase

export const WIRE_ADAPTER_NAMES = ['google-news-rss', 'bluesky', 'news-sitemap'] as const

/** One wire service to ingest. `sourceId` is a sources.json profile id (reuters / ap / afp). */
export interface WirePublisher {
  sourceId: string
  /**
   * Hostnames (no `www.`) the publisher's own articles live on. Every channel's article must resolve to one of these EXACTLY:
   * `site:afp.com` also returns `factcheck.afp.com` (a fact-check product, not a wire report), and Reuters' Bluesky account posts
   * YouTube links.
   */
  domains: string[]
  /** Set false to stop ingesting one publisher without deleting its config (see the AFP note in LOGBOOK.md). */
  enabled?: boolean
  /** In priority order. */
  channels: WireChannel[]
}

export interface WireSourcesConfig {
  publishers: WirePublisher[]
}

/** The fields of a parsed feed item (scripts/lib/rss.mjs) this normalizer reads. */
export interface ParsedFeedItem {
  title?: string
  description?: string
  link?: string
  pubDate?: string
  source?: { url?: string; name?: string }
}

export type WireDropReason = 'no-title-or-link' | 'publisher-mismatch' | 'not-a-report' | 'title-too-short' | 'duplicate'

const stripHtml = (s: string | undefined): string => (s ?? '').replace(/<[^>]*>/g, ' ').replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ').trim()

/** Google appends " - <publisher name>" to every title. Strip it only when it matches what `<source>` says, so a headline's own dash stays. */
export function stripPublisherSuffix(title: string, sourceName: string | undefined): string {
  if (!sourceName) return title
  const suffix = ` - ${sourceName}`
  return title.toLowerCase().endsWith(suffix.toLowerCase()) ? title.slice(0, -suffix.length).trim() : title
}

export interface WireNormalizeResult {
  articles: RawArticle[]
  dropped: Record<WireDropReason, number>
}

/**
 * Turns one publisher's parsed Google News RSS items into RawArticles, tagged with that publisher's `sourceId`.
 * `seen` is shared across the queries of one channel so a URL or headline is kept once.
 *
 * Deliberately NOT carried: `description` (Google's is a link plus the publisher name, never the article's own text — nothing of the
 * article is reproduced, only headline + link) and `imageUrl` (the feed has none; a card falls back to its severity gradient, or gets
 * the image from another channel when mergeWireArticles folds them together).
 * `url` stays Google's redirect link: the real article URL sits inside an encrypted token that only an undocumented Google endpoint
 * can decode, which this does not call. In a browser the link lands on the publisher's article.
 */
export function normalizeGoogleNewsItems(items: ParsedFeedItem[], publisher: Pick<WirePublisher, 'sourceId' | 'domains'>, seen: Set<string> = new Set()): WireNormalizeResult {
  const dropped: Record<WireDropReason, number> = { 'no-title-or-link': 0, 'publisher-mismatch': 0, 'not-a-report': 0, 'title-too-short': 0, duplicate: 0 }
  const articles: RawArticle[] = []
  for (const item of items) {
    if (!item.title || !item.link) {
      dropped['no-title-or-link']++
      continue
    }
    const host = hostOf(item.source?.url)
    if (!host || !publisher.domains.includes(host)) {
      dropped['publisher-mismatch']++
      continue
    }
    const title = stripPublisherSuffix(stripHtml(item.title), item.source?.name)
    if (isNonReportTitle(title)) {
      dropped['not-a-report']++
      continue
    }
    if (!hasEnoughWords(title)) {
      dropped['title-too-short']++
      continue
    }
    const urlKey = `url:${archiveKey(cleanArticleUrl(item.link))}`
    const headlineKey = `title:${publisher.sourceId}:${titleKey(title)}`
    if (seen.has(urlKey) || seen.has(headlineKey)) {
      dropped.duplicate++
      continue
    }
    seen.add(urlKey)
    seen.add(headlineKey)
    const parsed = item.pubDate ? Date.parse(item.pubDate) : Number.NaN
    articles.push({
      sourceId: publisher.sourceId,
      title,
      url: item.link,
      ...(Number.isNaN(parsed) ? {} : { publishedAt: new Date(parsed).toISOString() }),
    })
  }
  return { articles, dropped }
}

/** The Google News RSS search URL for one query. English/US edition: the build is English-only (BUILD_LANGUAGES). */
export function googleNewsSearchUrl(query: string, lookback = '2d'): string {
  const q = encodeURIComponent(`${query} when:${lookback}`)
  return `https://news.google.com/rss/search?q=${q}&hl=en-US&gl=US&ceid=US:en`
}
