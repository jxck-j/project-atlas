// Wire channel: a Google-News-format sitemap the publisher itself advertises in robots.txt. Pure.
//
// AP's (`apnews.com/news-sitemap-content.xml`, allowed by its robots.txt) lists ~550 articles over ~2 days with the REAL URL, the
// headline and the publication time — complete where Google's search feed is capped, and honest about the link. It carries no
// description and no image; those come from the publisher's Bluesky account through mergeWireArticles. Only the sitemap file is read:
// the article pages are not fetched (AP's terms restrict automated collection, and the card metadata is available elsewhere).
// Reuters' equivalent exists but its robots.txt disallows every automated fetch, so it is deliberately not a channel.
import type { RawArticle } from './eventBuilder'
import { archiveKey } from './articleArchive'
import { decodeHtmlEntities } from './htmlEntities'
import { cleanArticleUrl, hasEnoughWords, hostOf, isNonReportTitle, stripInvisible, titleKey } from './wireCommon'
import type { NewsSitemapChannel, WirePublisher } from './wireSources'

export interface SitemapItem {
  loc?: string
  title?: string
  publishedAt?: string
}

export type SitemapDropReason = 'no-title-or-link' | 'publisher-mismatch' | 'wrong-section' | 'not-a-report' | 'title-too-short' | 'duplicate'

export interface SitemapNormalizeResult {
  articles: RawArticle[]
  dropped: Record<SitemapDropReason, number>
}

function tag(block: string, name: string): string | undefined {
  const re = new RegExp(`<${name}(?:\\s[^>]*)?>\\s*(?:<!\\[CDATA\\[([\\s\\S]*?)\\]\\]>|([\\s\\S]*?))\\s*<\\/${name}>`, 'i')
  const m = block.match(re)
  const raw = (m?.[1] ?? m?.[2] ?? '').trim()
  return raw ? decodeHtmlEntities(raw) : undefined
}

/** Every `<url>` block's `<loc>`, `<news:title>` and `<news:publication_date>`. Not a general sitemap parser. */
export function parseNewsSitemap(xml: string): SitemapItem[] {
  return (xml.match(/<url\b[^>]*>[\s\S]*?<\/url>/gi) ?? []).map((block) => ({
    loc: tag(block, 'loc'),
    title: tag(block, 'news:title'),
    publishedAt: tag(block, 'news:publication_date'),
  }))
}

export function normalizeSitemapItems(
  items: SitemapItem[],
  publisher: Pick<WirePublisher, 'sourceId' | 'domains'>,
  channel: Pick<NewsSitemapChannel, 'pathPrefixes'> = {},
  seen: Set<string> = new Set(),
): SitemapNormalizeResult {
  const dropped: Record<SitemapDropReason, number> = { 'no-title-or-link': 0, 'publisher-mismatch': 0, 'wrong-section': 0, 'not-a-report': 0, 'title-too-short': 0, duplicate: 0 }
  const articles: RawArticle[] = []
  for (const item of items) {
    if (!item.loc || !item.title) {
      dropped['no-title-or-link']++
      continue
    }
    const host = hostOf(item.loc)
    if (!host || !publisher.domains.includes(host)) {
      dropped['publisher-mismatch']++
      continue
    }
    let path = ''
    try {
      path = new URL(item.loc).pathname
    } catch {
      dropped['no-title-or-link']++
      continue
    }
    if (channel.pathPrefixes && !channel.pathPrefixes.some((p) => path.startsWith(p))) {
      dropped['wrong-section']++
      continue
    }
    const title = stripInvisible(item.title)
    if (isNonReportTitle(title)) {
      dropped['not-a-report']++
      continue
    }
    if (!hasEnoughWords(title)) {
      dropped['title-too-short']++
      continue
    }
    const url = cleanArticleUrl(item.loc)
    const urlKey = `url:${archiveKey(url)}`
    const headlineKey = `title:${publisher.sourceId}:${titleKey(title)}`
    if (seen.has(urlKey) || seen.has(headlineKey)) {
      dropped.duplicate++
      continue
    }
    seen.add(urlKey)
    seen.add(headlineKey)
    const parsed = item.publishedAt ? Date.parse(item.publishedAt) : Number.NaN
    articles.push({ sourceId: publisher.sourceId, title, url, ...(Number.isNaN(parsed) ? {} : { publishedAt: new Date(parsed).toISOString() }) })
  }
  return { articles, dropped }
}
