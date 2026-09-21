import { describe, expect, it } from 'vitest'
import { clusterArticles } from './clustering'
import { buildCountryMatchers } from './countryResolution'
import { clusterByEmbedding, dot, EMBED_LINK_THRESHOLD, embeddingText, type EmbedArticle, type Embedder, type Vector } from './embeddingClustering'
import { buildEventsWithEmbeddings, type RawArticle } from './eventBuilder'
import fixture from '../../scripts/fixtures/newsClusteringEval.json'
import { SOURCES } from './sourceConfig'
import type { SourceProfile } from './types'

const H = 60 * 60 * 1000
// 2-D unit vector at an angle: the cosine between two of them is cos(difference), so similarities are exact by construction.
const at = (deg: number): Vector => [Math.cos((deg * Math.PI) / 180), Math.sin((deg * Math.PI) / 180)]
const art = (key: string, deg: number, hours = 0, countries: string[] = ['804'], title = key): EmbedArticle => ({ key, title, linkedEntityIds: countries, time: 1_000_000_000_000 + hours * H, vector: at(deg) })
const keysOf = (clusters: EmbedArticle[][]) => clusters.map((c) => c.map((m) => m.key))

describe('clusterByEmbedding', () => {
  it('links at or above the threshold and splits below it', () => {
    // 40 degrees apart -> cos 0.766 (link); 60 degrees -> 0.5 (no link)
    expect(keysOf(clusterByEmbedding([art('a', 0), art('b', 40)]))).toEqual([['a', 'b']])
    expect(keysOf(clusterByEmbedding([art('a', 0), art('b', 60)]))).toEqual([['a'], ['b']])
    expect(dot(at(0), at(45))).toBeGreaterThanOrEqual(EMBED_LINK_THRESHOLD)
  })

  it('joins paraphrases the word-overlap clusterer cannot — the reason this exists', () => {
    const a = 'Flames seen near Riyadh airport as Houthis claim attack on Saudi capital'
    const b = 'Fuel depot ablaze after air raid in Saudi capital'
    // Same meaning -> same vector; almost no shared words.
    const byEmbedding = clusterByEmbedding([art('a', 0, 0, ['682'], a), art('b', 5, 1, ['682'], b)])
    const byWords = clusterArticles([
      { key: 'a', title: a, linkedEntityIds: ['682'], time: 0 },
      { key: 'b', title: b, linkedEntityIds: ['682'], time: H },
    ])
    expect(byEmbedding).toHaveLength(1)
    expect(byWords).toHaveLength(2)
  })

  it('never links across the 36h window, and never joins a cluster whose first report is over 72h back', () => {
    expect(clusterByEmbedding([art('a', 0, 0), art('b', 0, 37)])).toHaveLength(2)
    const chain = [0, 30, 60, 90].map((h, i) => art(`k${i}`, 0, h))
    for (const c of clusterByEmbedding(chain)) expect(c[c.length - 1].time - c[0].time).toBeLessThanOrEqual(72 * H)
  })

  describe('country rule is soft', () => {
    it('refuses a link when both name countries and share none', () => {
      expect(clusterByEmbedding([art('a', 0, 0, ['804']), art('b', 0, 1, ['156'])])).toHaveLength(2)
    })
    it('allows a link when either names no country — silence is not evidence of a different country', () => {
      expect(clusterByEmbedding([art('a', 0, 0, ['804']), art('b', 0, 1, [])])).toHaveLength(1)
      expect(clusterByEmbedding([art('a', 0, 0, []), art('b', 0, 1, [])])).toHaveLength(1)
    })
    it('allows a link when at least one country is shared', () => {
      expect(clusterByEmbedding([art('a', 0, 0, ['804', '643']), art('b', 0, 1, ['643'])])).toHaveLength(1)
    })
  })

  it('does not chain: A~B and B~C never fuse A with C when C links to only one of them', () => {
    // A-B 45deg (0.707), B-C 45deg (0.707), A-C 90deg (0.0)
    const out = clusterByEmbedding([art('a', 0, 0), art('b', 45, 1), art('c', 90, 2)])
    expect(keysOf(out)).toEqual([['a', 'b'], ['c']])
  })

  it('a strict majority is required — 1 of 2 is not enough, 2 of 3 is', () => {
    const two = clusterByEmbedding([art('a', 0, 0), art('b', 10, 1), art('c', 60, 2)])
    expect(keysOf(two)).toEqual([['a', 'b'], ['c']]) // c is ~0.5 to both -> 0 links
    // d links to a and b (0.94) but not... it links to both: joins
    expect(keysOf(clusterByEmbedding([art('a', 0, 0), art('b', 10, 1), art('d', 5, 2)]))).toEqual([['a', 'b', 'd']])
  })

  it('joins the best of several eligible clusters, not the first', () => {
    // Two existing clusters; the new article is a near match to one and only a marginal match to the other.
    const out = clusterByEmbedding([art('x1', 0, 0), art('y1', 100, 0), art('n', 30, 1), art('n2', 70, 1)], 0.5)
    const joined = out.find((c) => c.some((m) => m.key === 'n'))!
    expect(joined.map((m) => m.key)).toContain('x1')
  })

  it('returns clusters in time order, so [0] is the first report', () => {
    const [c] = clusterByEmbedding([art('late', 0, 5), art('early', 0, 0)])
    expect(c.map((m) => m.key)).toEqual(['early', 'late'])
  })
})

describe('cluster merge pass', () => {
  // Angles chosen so the greedy pass splits a near-clique 3+3 (the real Riyadh case): A and C are 50 degrees apart (cos 0.64, no link),
  // so C cannot join {A,B} (1 of 2 is not a majority) and starts its own cluster; D follows C; E joins {A,B}; F joins {C,D}.
  const clique = () => [art('A', 0, 0), art('B', 25, 1), art('C', 50, 2), art('D', 60, 3), art('E', 15, 4), art('F', 45, 5)]

  it('repairs an order-dependent split: two halves of a near-clique merge when a strict majority of cross pairs link', () => {
    expect(keysOf(clusterByEmbedding(clique(), undefined, { mergePass: false })).map((c) => c.length).sort()).toEqual([3, 3])
    const merged = clusterByEmbedding(clique())
    expect(merged).toHaveLength(1)
    expect(merged[0].map((m) => m.key)).toEqual(['A', 'B', 'C', 'D', 'E', 'F']) // time order
  })

  it('one bridging article does not fuse two stories: the cross pairs must link broadly, not once', () => {
    // Two tight groups 50 degrees apart, plus a middle article that links to the first only.
    const out = clusterByEmbedding([art('x1', 0, 0), art('x2', 2, 1), art('x3', 4, 2), art('bridge', 27, 3), art('y1', 50, 4), art('y2', 52, 5), art('y3', 54, 6)])
    const clusterOf = (k: string) => out.find((c) => c.some((m) => m.key === k))!
    expect(clusterOf('x1')).not.toBe(clusterOf('y1'))
  })

  it('never merges into a cluster that would span more than 72 hours', () => {
    const early = clusterByEmbedding([art('a', 0, 0), art('b', 25, 1), art('c', 50, 2), art('d', 60, 3), art('e', 15, 4), art('f', 45, 5)], undefined, { mergePass: false })
    expect(early).toHaveLength(2)
    // stretch the second half far away in time: still within the link window of each other, but the union exceeds the span cap
    const stretched = [art('A', 0, 0), art('B', 25, 1), art('C', 50, 35), art('D', 60, 36), art('E', 15, 37), art('F', 45, 38)]
    for (const c of clusterByEmbedding(stretched)) expect(c[c.length - 1].time - c[0].time).toBeLessThanOrEqual(72 * H)
  })

  it('can be turned off', () => {
    expect(clusterByEmbedding(clique(), undefined, { mergePass: false }).length).toBeGreaterThan(1)
  })
})

describe('embeddingText', () => {
  it('cleans leftover HTML entities that would shift the vector', () => {
    expect(embeddingText('Serbia&#8217;s Vucic &amp; the EU', 'It&#039;s   a test')).toBe("Serbia's Vucic the EU. It's a test")
  })
  it('appends only the start of the description, and omits the separator when there is none', () => {
    expect(embeddingText('Headline', 'x'.repeat(500))).toBe(`Headline. ${'x'.repeat(220)}`)
    expect(embeddingText('Headline')).toBe('Headline')
  })
})

describe('buildEventsWithEmbeddings — end to end on a fake embedder', () => {
  const COUNTRIES = [
    { id: '682', name: 'Saudi Arabia' },
    { id: '887', name: 'Yemen' },
    { id: '804', name: 'Ukraine' },
    { id: '643', name: 'Russia' },
  ]
  const profile = (id: string) => ({ id, name: id.toUpperCase(), sourceType: 'outlet', vetting: 'confirmed' }) as SourceProfile
  const profiles = ['a', 'b', 'c', 'd', 'e'].map(profile)
  const countryMatchers = buildCountryMatchers(COUNTRIES)
  const now = '2026-09-20T12:00:00.000Z'
  const raw = (sourceId: string, title: string, minutesAgo = 30): RawArticle => ({
    sourceId,
    title,
    description: '',
    url: `https://${sourceId}.test/news/${encodeURIComponent(title)}`,
    publishedAt: new Date(Date.parse(now) - minutesAgo * 60_000).toISOString(),
  })
  const ctx = { profiles, countryMatchers, now }
  // The embedder is looked up by headline, so a test decides which articles "mean" the same thing.
  const embedderFor = (angles: Record<string, number>): Embedder => async (texts) => texts.map((t) => at(angles[t.split('. ')[0]] ?? 170))

  const riyadh = [
    ['a', 'Flames seen near Riyadh airport as Houthis claim attack on Saudi capital'],
    ['b', 'Saudi Arabia says it intercepted Yemen rebel drones aimed at Riyadh'],
    ['c', 'Fuel depot ablaze after air raid in Saudi capital'],
    ['d', 'Houthi missile strike on Riyadh prompts Gulf alarm in Saudi Arabia'],
  ] as const

  it('four outlets in varied wording reach Critical when their embeddings agree — what word overlap cannot do', async () => {
    const angles = Object.fromEntries(riyadh.map(([, t], i) => [t, i * 3]))
    const r = await buildEventsWithEmbeddings(riyadh.map(([s, t]) => raw(s, t)), ctx, embedderFor(angles))
    expect(r.published).toHaveLength(1)
    expect(r.published[0].severity).toBe('critical')
    expect(r.published[0].sources.map((s) => s.sourceId).sort()).toEqual(['a', 'b', 'c', 'd'])
  })

  it('the gate is unchanged: the same four outlets that the embedder splits apart publish nothing', async () => {
    const angles = Object.fromEntries(riyadh.map(([, t], i) => [t, i * 90]))
    const r = await buildEventsWithEmbeddings(riyadh.map(([s, t]) => raw(s, t)), ctx, embedderFor(angles))
    expect(r.published).toHaveLength(0)
  })

  it('an article naming no country joins a cluster whose other members do, and the Event takes the union', async () => {
    const withCountry = 'Ukraine army launches offensive as troops advance'
    const noCountry = 'Offensive launched as troops advance on the front line'
    const r = await buildEventsWithEmbeddings([raw('a', withCountry), raw('b', noCountry)], ctx, embedderFor({ [withCountry]: 0, [noCountry]: 4 }))
    expect(r.published).toHaveLength(1)
    expect(r.published[0].linkedEntityIds).toEqual(['804'])
    expect(r.published[0].sources).toHaveLength(2)
  })

  it('a cluster in which NO member names a country is dropped as no-country, never published without one', async () => {
    const t1 = 'Army launches offensive as troops advance'
    const t2 = 'Troops advance as army launches an offensive'
    const r = await buildEventsWithEmbeddings([raw('a', t1), raw('b', t2)], ctx, embedderFor({ [t1]: 0, [t2]: 3 }))
    expect(r.published).toHaveLength(0)
    expect(r.dropped['no-country']).toHaveLength(2)
  })

  it('pre-filters articles with neither a country nor a topic keyword before embedding them', async () => {
    let embedded = 0
    const embedder: Embedder = async (texts) => {
      embedded += texts.length
      return texts.map(() => at(0))
    }
    const r = await buildEventsWithEmbeddings([raw('a', 'Local bakery wins prize for sourdough')], ctx, embedder)
    expect(r.dropped.prefiltered).toHaveLength(1)
    expect(embedded).toBe(0)
  })

  it('a head-of-state death claim still goes to the pending queue, not published', async () => {
    const titles = ['a', 'b', 'c', 'd'].map((s, i) => [s, `President assassinated in Russia, state TV reports ${i}`] as const)
    const angles = Object.fromEntries(titles.map(([, t], i) => [t, i]))
    const r = await buildEventsWithEmbeddings(titles.map(([s, t]) => raw(s, t)), ctx, embedderFor(angles))
    expect(r.published).toHaveLength(0)
    expect(r.pending).toHaveLength(1)
  })
})

describe('clustering eval fixture (scripts/fixtures/newsClusteringEval.json)', () => {
  const fx = fixture as { articles: { sourceId: string; title: string; publishedAt: string; countries: string[] }[]; stories: Record<string, number[]>; ambiguous: number[] }

  it('is internally consistent: indexes in range, no article in two stories, none both in a story and ambiguous', () => {
    const n = fx.articles.length
    const seen = new Set<number>()
    for (const [name, idxs] of Object.entries(fx.stories)) {
      for (const i of idxs) {
        expect(i, `${name}: index ${i} out of range`).toBeGreaterThanOrEqual(0)
        expect(i, `${name}: index ${i} out of range`).toBeLessThan(n)
        expect(seen.has(i), `article ${i} is in two stories (${name})`).toBe(false)
        seen.add(i)
      }
    }
    for (const i of fx.ambiguous) {
      expect(i).toBeGreaterThanOrEqual(0)
      expect(i).toBeLessThan(n)
      expect(seen.has(i), `article ${i} is both in a story and ambiguous`).toBe(false)
    }
  })

  it('every article has a valid time and a known outlet id', () => {
    const outletIds = new Set(SOURCES.filter((s) => s.sourceType === 'outlet').map((s) => s.id))
    for (const a of fx.articles) {
      expect(Number.isNaN(Date.parse(a.publishedAt)), a.title).toBe(false)
      expect(outletIds.has(a.sourceId), `${a.sourceId} is not a roster outlet`).toBe(true)
    }
  })
})
