import { describe, expect, it } from 'vitest'
// @ts-expect-error -- scripts/lib is untyped .mjs; this one test covers the <source> field the wire adapter depends on
import { parseRssItems } from '../../scripts/lib/rss.mjs'
import { buildCountryMatchers } from './countryResolution'
import { deriveCorroboration } from './corroboration'
import { buildEvents } from './eventBuilder'
import { SOURCES } from './sourceConfig'
import { googleNewsSearchUrl, normalizeGoogleNewsItems, stripPublisherSuffix, WIRE_ADAPTER_NAMES, type ParsedFeedItem, type WirePublisher } from './wireSources'
import wireSources from './wireSources.json'

type Pub = Pick<WirePublisher, 'sourceId' | 'domains'>
const REUTERS: Pub = { sourceId: 'reuters', domains: ['reuters.com'] }
const AP: Pub = { sourceId: 'ap', domains: ['apnews.com'] }
const AFP: Pub = { sourceId: 'afp', domains: ['afp.com'] }

const item = (over: Partial<ParsedFeedItem> = {}): ParsedFeedItem => ({
  title: "Nor'easter leaves over 100,000 customers without power - Reuters",
  link: 'https://news.google.com/rss/articles/CBMiAAA?oc=5',
  pubDate: 'Sat, 26 Sep 2026 21:25:15 GMT',
  description: '<a href="https://news.google.com/rss/articles/CBMiAAA?oc=5">Nor\'easter</a>&nbsp;&nbsp;<font color="#6f6f6f">Reuters</font>',
  source: { url: 'https://www.reuters.com', name: 'Reuters' },
  ...over,
})

describe('normalizeGoogleNewsItems', () => {
  it("produces a RawArticle tagged with the publisher, headline without Google's suffix, link and ISO time — and no description or image", () => {
    const { articles } = normalizeGoogleNewsItems([item()], REUTERS)
    expect(articles).toEqual([
      { sourceId: 'reuters', title: "Nor'easter leaves over 100,000 customers without power", url: 'https://news.google.com/rss/articles/CBMiAAA?oc=5', publishedAt: '2026-09-26T21:25:15.000Z' },
    ])
  })

  it('omits publishedAt for an unparseable date rather than inventing one', () => {
    const [a] = normalizeGoogleNewsItems([item({ pubDate: 'sometime' })], REUTERS).articles
    expect(a).not.toHaveProperty('publishedAt')
  })

  it('drops an item whose <source> is not the publisher — site: also returns subdomains such as AFP Fact Check', () => {
    const r = normalizeGoogleNewsItems(
      [item({ title: 'Video falsely shared as aftermath of attack - AFP Fact Check', source: { url: 'https://factcheck.afp.com', name: 'AFP Fact Check' } }), item({ source: undefined })],
      AFP,
    )
    expect(r.articles).toEqual([])
    expect(r.dropped['publisher-mismatch']).toBe(2)
  })

  it('accepts the publisher with or without www., and http', () => {
    for (const url of ['https://www.afp.com', 'http://www.afp.com', 'https://afp.com'])
      expect(normalizeGoogleNewsItems([item({ title: 'Putin says Russia is not preparing conflict - afp.com', source: { url, name: 'afp.com' } })], AFP).articles).toHaveLength(1)
  })

  it('drops non-reports seen in live results, and topic stubs', () => {
    const r = normalizeGoogleNewsItems(
      [
        item({ title: "Explainer: What is 'Taiwan independence'? - Reuters", link: 'https://g/1' }),
        item({ title: 'Photos of record-breaking swimmers - Reuters', link: 'https://g/2' }),
        item({ title: 'White House - Reuters', link: 'https://g/3' }),
        item({ title: "Trump says he spoke with Venezuela's Rodriguez - Reuters", link: 'https://g/4' }),
      ],
      REUTERS,
    )
    expect(r.articles.map((a) => a.title)).toEqual(["Trump says he spoke with Venezuela's Rodriguez"])
    expect(r.dropped['not-a-report']).toBe(2)
    expect(r.dropped['title-too-short']).toBe(1)
  })

  it('drops items missing a title or link', () => {
    const r = normalizeGoogleNewsItems([item({ title: undefined }), item({ link: undefined })], REUTERS)
    expect(r.articles).toEqual([])
    expect(r.dropped['no-title-or-link']).toBe(2)
  })

  it('deduplicates by URL and by headline (case/punctuation-insensitive), within and across calls sharing `seen`', () => {
    const seen = new Set<string>()
    const a = normalizeGoogleNewsItems(
      [item(), item(), item({ link: 'https://news.google.com/rss/articles/CBMiBBB', title: "NOR'EASTER leaves over 100,000 customers without power! - Reuters" })],
      REUTERS,
      seen,
    )
    expect(a.articles).toHaveLength(1)
    expect(a.dropped.duplicate).toBe(2)
    expect(normalizeGoogleNewsItems([item()], REUTERS, seen).articles).toHaveLength(0)
  })

  it('does not merge the same headline across two different publishers — that is two sources, not one', () => {
    const seen = new Set<string>()
    const first = normalizeGoogleNewsItems([item()], REUTERS, seen).articles
    const second = normalizeGoogleNewsItems(
      [item({ link: 'https://news.google.com/rss/articles/CBMiCCC', source: { url: 'https://apnews.com', name: 'AP News' }, title: "Nor'easter leaves over 100,000 customers without power - AP News" })],
      AP,
      seen,
    ).articles
    expect(first).toHaveLength(1)
    expect(second).toHaveLength(1)
  })
})

describe('stripPublisherSuffix', () => {
  it("strips only the exact trailing publisher, so a headline's own dash survives", () => {
    expect(stripPublisherSuffix('Strike hits Kyiv - officials say - Reuters', 'Reuters')).toBe('Strike hits Kyiv - officials say')
    expect(stripPublisherSuffix('Strike hits Kyiv - officials say', 'Reuters')).toBe('Strike hits Kyiv - officials say')
    expect(stripPublisherSuffix('Strike hits Kyiv - AP NEWS', 'AP News')).toBe('Strike hits Kyiv')
    expect(stripPublisherSuffix('Strike hits Kyiv - Reuters', undefined)).toBe('Strike hits Kyiv - Reuters')
  })
})

describe('googleNewsSearchUrl', () => {
  it('builds an English/US search with the lookback window', () => {
    const url = new URL(googleNewsSearchUrl('site:reuters.com', '2d'))
    expect(url.origin + url.pathname).toBe('https://news.google.com/rss/search')
    expect(url.searchParams.get('q')).toBe('site:reuters.com when:2d')
    expect(url.searchParams.get('ceid')).toBe('US:en')
  })
})

describe('parseRssItems: <source>', () => {
  it("reads the publisher's name and url from a Google News item, and leaves it undefined for an ordinary feed", () => {
    const xml =
      '<rss><channel><item><title>A story - Reuters</title><link>https://g/1</link><source url="https://www.reuters.com">Reuters</source></item>' +
      '<item><title>B</title><link>https://x/2</link></item></channel></rss>'
    const [a, b] = parseRssItems(xml)
    expect(a.source).toEqual({ url: 'https://www.reuters.com', name: 'Reuters' })
    expect(b.source).toBeUndefined()
  })
})

describe('wireSources.json', () => {
  it('names only wire-tier roster profiles, once each, every one with at least one channel of a registered adapter', () => {
    const wireIds = new Set(SOURCES.filter((s) => s.sourceType === 'outlet' && s.tier === 'wire').map((s) => s.id))
    const ids = wireSources.publishers.map((p) => p.sourceId)
    expect(new Set(ids).size).toBe(ids.length)
    for (const p of wireSources.publishers) {
      expect(wireIds.has(p.sourceId), `${p.sourceId} is not a wire-tier profile`).toBe(true)
      expect(p.domains.length, p.sourceId).toBeGreaterThan(0)
      for (const d of p.domains) expect(d, p.sourceId).not.toMatch(/^www\.|\//)
      expect(p.channels.length, p.sourceId).toBeGreaterThan(0)
      for (const c of p.channels) expect(WIRE_ADAPTER_NAMES as readonly string[], `${p.sourceId}: ${c.adapter}`).toContain(c.adapter)
    }
  })

  it("gives each channel what its adapter needs, scoped to the publisher's own domain", () => {
    for (const p of wireSources.publishers) {
      for (const c of p.channels as { adapter: string; queries?: string[]; handle?: string; pages?: number; shorteners?: string[]; url?: string; pathPrefixes?: string[] }[]) {
        if (c.adapter === 'google-news-rss') {
          expect(c.queries?.length, p.sourceId).toBeGreaterThan(0)
          // Every query must be site:-scoped, or Google returns other publishers and the <source> check has to throw them away.
          for (const q of c.queries ?? []) expect(p.domains.some((d) => q.includes(`site:${d}`)), `${p.sourceId}: ${q}`).toBe(true)
        } else if (c.adapter === 'bluesky') {
          expect(c.handle, p.sourceId).toBeTruthy()
          expect(c.pages ?? 1, p.sourceId).toBeGreaterThanOrEqual(1)
          expect(c.pages ?? 1, p.sourceId).toBeLessThanOrEqual(5)
        } else if (c.adapter === 'news-sitemap') {
          const host = new URL(c.url ?? '').hostname.replace(/^www\./, '')
          expect(p.domains, p.sourceId).toContain(host)
        }
      }
    }
  })

  it('does not ingest Reuters through a direct-fetch channel — its robots.txt disallows every automated fetch', () => {
    const reuters = wireSources.publishers.find((p) => p.sourceId === 'reuters')
    for (const c of (reuters?.channels ?? []) as { adapter: string; url?: string }[]) expect(c.adapter === 'news-sitemap' || c.url?.includes('reuters.com'), 'reuters direct fetch').toBeFalsy()
  })
})

describe('what a wire article means downstream', () => {
  // Pinned on purpose: a Google-sourced Reuters/AP/AFP article is a wire-tier entry, so ONE of them clears the corroboration gate.
  // That is the point of ingesting them — and the reason the adapter verifies `<source>` rather than trusting the query.
  it('one Reuters headline is wire-confirmed, so it can publish on its own', () => {
    const { articles } = normalizeGoogleNewsItems([item({ title: 'Iran fires missiles at Israel, at least 40 killed in Tel Aviv - Reuters' })], REUTERS)
    const { published } = buildEvents(articles, { profiles: SOURCES, countryMatchers: buildCountryMatchers([
        { id: '364', name: 'Iran' },
        { id: '376', name: 'Israel' },
      ]), now: '2026-09-26T23:00:00.000Z' })
    expect(published).toHaveLength(1)
    expect(deriveCorroboration(published[0].sources)).toBe('wire-confirmed')
  })
})
