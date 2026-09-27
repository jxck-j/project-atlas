import { describe, expect, it } from 'vitest'
import { buildCountryMatchers } from './countryResolution'
import { buildEvents, type RawArticle } from './eventBuilder'
import { SOURCES } from './sourceConfig'
import { applyResolvedLink, isShortlink, normalizeBlueskyPosts, type BlueskyFeedItem } from './wireBluesky'
import { cleanArticleUrl, mergeWireArticles, stripInvisible, titleKey } from './wireCommon'
import { normalizeSitemapItems, parseNewsSitemap } from './wireSitemap'

const REUTERS = { sourceId: 'reuters', domains: ['reuters.com'] }
const AP = { sourceId: 'ap', domains: ['apnews.com'] }

const post = (over: { uri?: string; title?: string; description?: string; thumb?: string; createdAt?: string } = {}, extra: Partial<BlueskyFeedItem> = {}): BlueskyFeedItem => ({
  post: {
    record: { createdAt: over.createdAt ?? '2026-09-26T23:15:07Z' },
    embed: {
      external: {
        uri: over.uri ?? 'https://reut.rs/4yAWG2F',
        title: over.title ?? 'Iran insists on diplomatic solution after Trump rejects peace plan',
        description: over.description ?? "Despite ⁠Trump's public statements, mediators have not officially relayed a US rejection of the plan.",
        thumb: over.thumb ?? 'https://cdn.bsky.app/img/feed_thumbnail/plain/did:plc:x/abc',
      },
    },
  },
  ...extra,
})

describe('cleanArticleUrl', () => {
  it("strips the tracking parameters a publisher's social tool adds, keeps the ones that select the article", () => {
    expect(cleanArticleUrl('https://www.reuters.com/world/asia-pacific/x-2026-09-26/?link_source=ta_bluesky_link&taid=6ab8&utm_campaign=trueanthem&utm_medium=social&utm_source=bluesky')).toBe(
      'https://www.reuters.com/world/asia-pacific/x-2026-09-26/',
    )
    expect(cleanArticleUrl('https://example.com/story?id=42&utm_source=x#frag')).toBe('https://example.com/story?id=42')
  })

  it("leaves Google's redirect link alone (its query is part of the link)", () => {
    const g = 'https://news.google.com/rss/articles/CBMiAAA?oc=5'
    expect(cleanArticleUrl(g)).toBe(g)
  })
})

describe('stripInvisible', () => {
  it('removes word joiners and zero-width characters without inserting spaces', () => {
    expect(stripInvisible("Despite ⁠Trump's​ public")).toBe("Despite Trump's public")
  })
})

describe('normalizeBlueskyPosts', () => {
  it("turns a link card into a RawArticle with the publisher's own description and image, the short link kept for the adapter to resolve", () => {
    const { articles } = normalizeBlueskyPosts([post()], REUTERS, { shorteners: ['reut.rs'] })
    expect(articles).toEqual([
      {
        sourceId: 'reuters',
        title: 'Iran insists on diplomatic solution after Trump rejects peace plan',
        url: 'https://reut.rs/4yAWG2F',
        description: "Despite Trump's public statements, mediators have not officially relayed a US rejection of the plan.",
        publishedAt: '2026-09-26T23:15:07.000Z',
        imageUrl: 'https://cdn.bsky.app/img/feed_thumbnail/plain/did:plc:x/abc',
      },
    ])
  })

  it("accepts a direct link to the publisher's own site, with tracking parameters cleaned", () => {
    const { articles } = normalizeBlueskyPosts([post({ uri: 'https://www.reuters.com/world/x-2026-09-26/?utm_source=bluesky' })], REUTERS, {})
    expect(articles[0].url).toBe('https://www.reuters.com/world/x-2026-09-26/')
  })

  it('drops reposts, posts without a link card, and links that are not the publisher (YouTube, an unlisted shortener)', () => {
    const r = normalizeBlueskyPosts(
      [
        post({}, { reason: { $type: 'app.bsky.feed.defs#reasonRepost' } }),
        { post: { record: { createdAt: '2026-09-26T20:00:00Z' } } },
        post({ uri: 'https://www.youtube.com/watch?v=abc', title: 'Watch the full briefing live from the White House' }),
        post({ uri: 'https://bit.ly/zzz', title: 'Some other publisher shared this through bit.ly today' }),
      ],
      REUTERS,
      { shorteners: ['reut.rs'] },
    )
    expect(r.articles).toEqual([])
    expect(r.dropped).toMatchObject({ repost: 1, 'no-link-card': 1, 'foreign-link': 2 })
  })

  it('drops non-report titles and stubs, and repeats by URL or headline', () => {
    const r = normalizeBlueskyPosts(
      [
        post({ title: 'Explainer: What is Taiwan independence and why it matters', uri: 'https://reut.rs/a' }),
        post({ title: 'Markets', uri: 'https://reut.rs/b' }),
        post({ uri: 'https://reut.rs/c' }),
        post({ uri: 'https://reut.rs/c' }),
        post({ uri: 'https://reut.rs/d' }), // same headline as c, different link
      ],
      REUTERS,
      { shorteners: ['reut.rs'] },
    )
    expect(r.articles.map((a) => a.url)).toEqual(['https://reut.rs/c'])
    expect(r.dropped).toMatchObject({ 'not-a-report': 1, 'title-too-short': 1, duplicate: 2 })
  })

  it('omits a description that only repeats the headline', () => {
    const { articles } = normalizeBlueskyPosts([post({ description: 'Iran insists on diplomatic solution after Trump rejects peace plan.' })], REUTERS, { shorteners: ['reut.rs'] })
    expect(articles[0]).not.toHaveProperty('description')
  })
})

describe('isShortlink / applyResolvedLink', () => {
  const article: RawArticle = { sourceId: 'reuters', title: 'x y z', url: 'https://reut.rs/4yAWG2F' }

  it('recognizes only the configured shorteners', () => {
    expect(isShortlink('https://reut.rs/4yAWG2F', ['reut.rs'])).toBe(true)
    expect(isShortlink('https://www.reuters.com/x', ['reut.rs'])).toBe(false)
    expect(isShortlink('https://reut.rs/x')).toBe(false)
  })

  it("swaps in the resolved article URL, cleaned, when it is the publisher's own site", () => {
    const r = applyResolvedLink(article, 'https://www.reuters.com/world/x-2026-09-26/?link_source=ta_bluesky_link&taid=1&utm_source=bluesky', REUTERS)
    expect(r?.url).toBe('https://www.reuters.com/world/x-2026-09-26/')
  })

  it('keeps the short link when it could not be resolved, and drops an article whose short link points off-site', () => {
    expect(applyResolvedLink(article, undefined, REUTERS)).toBe(article)
    expect(applyResolvedLink(article, 'https://evil.example.com/reuters.com', REUTERS)).toBeNull()
  })
})

describe('sitemap channel', () => {
  const xml = `<?xml version='1.0' encoding='UTF-8'?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:news="http://www.google.com/schemas/sitemap-news/0.9">
  <url><lastmod>2026-09-25T10:35:53-04:00</lastmod><loc>https://apnews.com/article/nba-thunder-presti-8c778dfebccc22f401eeec08b7b12867</loc>
    <news:news><news:publication><news:name>Associated Press</news:name></news:publication>
    <news:publication_date>2026-09-25T06:54:12-04:00</news:publication_date><news:title>Thunder GM Sam Presti expects OKC to be &#x27;exceptional&#x27; team</news:title></news:news></url>
  <url><loc>https://apnews.com/live/trump-xi-china-summit-09-25-2026</loc>
    <news:news><news:publication_date>2026-09-25T06:54:12-04:00</news:publication_date><news:title>Live updates from the Trump Xi summit</news:title></news:news></url>
  <url><loc>https://apnews.com/photo-gallery/milan-fashion-week-abc</loc>
    <news:news><news:publication_date>2026-09-25T06:54:12-04:00</news:publication_date><news:title>Milan Fashion Week in pictures today</news:title></news:news></url>
  <url><loc>https://example.com/article/not-ap</loc>
    <news:news><news:publication_date>2026-09-25T06:54:12-04:00</news:publication_date><news:title>An impostor headline on another host</news:title></news:news></url>
</urlset>`

  it('parses loc, title (entities decoded) and publication date', () => {
    const items = parseNewsSitemap(xml)
    expect(items).toHaveLength(4)
    expect(items[0]).toEqual({
      loc: 'https://apnews.com/article/nba-thunder-presti-8c778dfebccc22f401eeec08b7b12867',
      title: "Thunder GM Sam Presti expects OKC to be 'exceptional' team",
      publishedAt: '2026-09-25T06:54:12-04:00',
    })
  })

  it("keeps only the publisher's own articles in the configured section, with the real URL and an ISO time", () => {
    const r = normalizeSitemapItems(parseNewsSitemap(xml), AP, { pathPrefixes: ['/article/'] })
    expect(r.articles).toEqual([
      {
        sourceId: 'ap',
        title: "Thunder GM Sam Presti expects OKC to be 'exceptional' team",
        url: 'https://apnews.com/article/nba-thunder-presti-8c778dfebccc22f401eeec08b7b12867',
        publishedAt: '2026-09-25T10:54:12.000Z',
      },
    ])
    expect(r.dropped).toMatchObject({ 'wrong-section': 2, 'publisher-mismatch': 1 })
  })
})

describe('mergeWireArticles', () => {
  const google: RawArticle = { sourceId: 'reuters', title: 'Iran insists on diplomatic solution after Trump rejects peace plan', url: 'https://news.google.com/rss/articles/CBMiAAA?oc=5', publishedAt: '2026-09-26T21:00:00.000Z' }
  const bsky: RawArticle = {
    sourceId: 'reuters',
    title: 'Iran insists on diplomatic solution after Trump rejects peace plan',
    url: 'https://www.reuters.com/world/asia-pacific/iran-2026-09-26/',
    description: 'Mediators have not relayed a rejection.',
    imageUrl: 'https://cdn.bsky.app/img/x',
    publishedAt: '2026-09-26T23:15:07.000Z',
  }

  it("folds Google's opaque-link copy and Bluesky's real-link copy into one record, whichever comes first", () => {
    for (const input of [[google, bsky], [bsky, google]]) {
      const merged = mergeWireArticles(input)
      expect(merged).toHaveLength(1)
      expect(merged[0]).toMatchObject({ url: bsky.url, description: bsky.description, imageUrl: bsky.imageUrl, publishedAt: google.publishedAt })
    }
  })

  it('matches on the real URL too, so a sitemap and a Bluesky post for AP merge even if the headlines differ', () => {
    const sitemap: RawArticle = { sourceId: 'ap', title: "Thousands march in Madrid over eviction", url: 'https://apnews.com/article/spain-1', publishedAt: '2026-09-26T10:00:00.000Z' }
    const social: RawArticle = { sourceId: 'ap', title: "Thousands march in Madrid to protest Spain's housing crisis", url: 'https://apnews.com/article/spain-1?utm_source=Bluesky&link_source=ta_bluesky_link', description: 'A protest.', imageUrl: 'https://cdn.bsky.app/img/y' }
    const merged = mergeWireArticles([sitemap, social])
    expect(merged).toHaveLength(1)
    expect(merged[0]).toMatchObject({ title: sitemap.title, description: 'A protest.', imageUrl: 'https://cdn.bsky.app/img/y' })
  })

  it('never merges across publishers, and keeps genuinely different stories apart', () => {
    const ap: RawArticle = { ...bsky, sourceId: 'ap' }
    const other: RawArticle = { sourceId: 'reuters', title: 'Oil prices jump as Hormuz talks stall', url: 'https://www.reuters.com/markets/oil-1/' }
    expect(mergeWireArticles([bsky, ap, other])).toHaveLength(3)
  })

  it('does not mutate its input', () => {
    const input = [{ ...google }, { ...bsky }]
    mergeWireArticles(input)
    expect(input[0].url).toBe(google.url)
  })

  it('keys headlines the way the channels do (case and punctuation ignored)', () => {
    expect(titleKey("Trump’s  state dinner: for Xi!")).toBe(titleKey("trump s state dinner for xi"))
  })
})

describe('mergeWireArticles: retitled stories (Google-link copy vs real-URL copy)', () => {
  const g = (over: Partial<RawArticle> = {}): RawArticle => ({
    sourceId: 'ap',
    title: 'Brazil’s President Lula bans online betting ahead of presidential election',
    url: 'https://news.google.com/rss/articles/CBMiXXX?oc=5',
    publishedAt: '2026-09-26T12:00:00.000Z',
    ...over,
  })
  const real = (over: Partial<RawArticle> = {}): RawArticle => ({
    sourceId: 'ap',
    title: "Brazil's Lula bans fixed-odds betting ahead of presidential election",
    url: 'https://apnews.com/article/brazil-lula-betting-1',
    publishedAt: '2026-09-26T11:00:00.000Z',
    description: 'A ban.',
    imageUrl: 'https://cdn.bsky.app/img/b',
    ...over,
  })

  it('folds a Google copy whose headline was revised into the real-URL copy, keeping the real one', () => {
    for (const input of [[g(), real()], [real(), g()]]) {
      const merged = mergeWireArticles(input)
      expect(merged).toHaveLength(1)
      expect(merged[0]).toMatchObject({ url: 'https://apnews.com/article/brazil-lula-betting-1', title: real().title, imageUrl: 'https://cdn.bsky.app/img/b' })
    }
  })

  it('lets the real record take the earlier time from the folded copy', () => {
    const [m] = mergeWireArticles([real({ publishedAt: '2026-09-26T13:00:00.000Z' }), g({ publishedAt: '2026-09-26T12:00:00.000Z' })])
    expect(m.publishedAt).toBe('2026-09-26T12:00:00.000Z')
  })

  it('does not fold across sources, across a long time gap, or when the wording differs', () => {
    expect(mergeWireArticles([g({ sourceId: 'reuters' }), real()])).toHaveLength(2)
    expect(mergeWireArticles([g({ publishedAt: '2026-09-20T12:00:00.000Z' }), real()])).toHaveLength(2)
    expect(mergeWireArticles([g({ title: 'Oil prices jump as Hormuz talks stall again' }), real()])).toHaveLength(2)
  })

  it('never folds two real-URL records, and needs both times to fold at all', () => {
    expect(mergeWireArticles([real(), real({ url: 'https://apnews.com/article/brazil-lula-betting-2', title: "Brazil's Lula bans fixed-odds betting ahead of election vote" })])).toHaveLength(2)
    const { publishedAt: _drop, ...noTime } = g()
    expect(mergeWireArticles([noTime, real()])).toHaveLength(2)
  })
})

describe('the build folds one wire story archived under two URLs', () => {
  const matchers = buildCountryMatchers([
    { id: '364', name: 'Iran' },
    { id: '376', name: 'Israel' },
  ])
  const title = 'Iran fires missiles at Israel, at least 40 killed in Tel Aviv'
  const opts = { profiles: SOURCES, countryMatchers: matchers, now: '2026-09-26T23:00:00.000Z' }

  it('produces one Reuters entry carrying the image from the copy that had one', () => {
    const { published } = buildEvents(
      [
        { sourceId: 'reuters', title, url: 'https://news.google.com/rss/articles/CBMiAAA?oc=5', publishedAt: '2026-09-26T21:00:00Z' },
        { sourceId: 'reuters', title, url: 'https://www.reuters.com/world/mideast/x-2026-09-26/', imageUrl: 'https://cdn.bsky.app/img/z', description: 'A strike.', publishedAt: '2026-09-26T22:00:00Z' },
      ],
      opts,
    )
    expect(published).toHaveLength(1)
    const reuters = published[0].sources.filter((s) => s.sourceId === 'reuters')
    expect(reuters).toHaveLength(1)
    expect(reuters[0].refUrl).toBe('https://www.reuters.com/world/mideast/x-2026-09-26/')
    expect(reuters[0]).toMatchObject({ imageUrl: 'https://cdn.bsky.app/img/z' })
  })

  it('leaves non-wire sources alone: the same headline at two URLs from an ordinary outlet is not folded here', () => {
    const { articlesIn, duplicateUrls } = buildEvents(
      [
        { sourceId: 'bbc', title, url: 'https://www.bbc.com/news/a', publishedAt: '2026-09-26T21:00:00Z' },
        { sourceId: 'bbc', title, url: 'https://www.bbc.com/news/b', publishedAt: '2026-09-26T22:00:00Z' },
      ],
      opts,
    )
    expect(articlesIn).toBe(2)
    expect(duplicateUrls).toBe(0)
  })
})
