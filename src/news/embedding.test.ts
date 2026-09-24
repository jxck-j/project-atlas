import { describe, expect, it } from 'vitest'
import { clusterArticles } from './clustering'
import { buildCountryMatchers } from './countryResolution'
import { attachToClusters, clusterByEmbedding, dot, EMBED_LINK_THRESHOLD, embeddingText, type EmbedArticle, type Embedder, type Vector } from './embeddingClustering'
import { buildEventsWithEmbeddings, type RawArticle } from './eventBuilder'
import fixture from '../../scripts/fixtures/newsClusteringEval.json'
import { SOURCES } from './sourceConfig'
import { deriveCorroboration } from './corroboration'
import type { FirstHandProfile, SourceProfile } from './types'

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

  // 'a' names the capital attack as rare (settled call 7, LOGBOOK.md 2026-09-21: a capital attack is Critical only
  // when flagged rare/first-time — Riyadh's real headline said exactly this; a routine capital strike in an
  // already-active war, like Ukraine's drone attacks on Moscow, is Major instead, whatever the wording).
  const riyadh = [
    ['a', 'Flames seen near Riyadh airport as Houthis attack Saudi capital for the first time since the Yemen conflict resumed'],
    ['b', 'Saudi Arabia says it intercepted Yemen rebel drones aimed at Riyadh'],
    ['c', 'Fuel depot ablaze after air raid in Saudi capital'],
    ['d', 'Houthi missile strike on Riyadh prompts Gulf alarm in Saudi Arabia'],
  ] as const

  it('three outlets in varied wording reach Critical when their embeddings agree — what word overlap cannot do', async () => {
    const angles = Object.fromEntries(riyadh.map(([, t], i) => [t, i * 3]))
    const r = await buildEventsWithEmbeddings(riyadh.slice(0, 3).map(([s, t]) => raw(s, t)), ctx, embedderFor(angles))
    expect(r.published).toHaveLength(1)
    expect(r.published[0].severity).toBe('critical')
    expect(r.published[0].sources.map((s) => s.sourceId).sort()).toEqual(['a', 'b', 'c'])
  })

  it('the gate is unchanged: the same outlets, split apart by the embedder, publish nothing', async () => {
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

describe('attachToClusters', () => {
  const art = (key: string, deg: number, minute = 0, ids: string[] = []): EmbedArticle => ({ key, title: key, linkedEntityIds: ids, time: minute * 60_000, vector: at(deg) })

  it('attaches to the cluster it agrees with, and reports what matched nothing', () => {
    const clusters = [[art('a1', 0), art('a2', 4)], [art('b1', 100), art('b2', 104)]]
    const { attached, unattached } = attachToClusters(clusters, [art('near-a', 2, 5), art('near-b', 102, 5), art('far', 220, 5)])
    expect(attached.map((g) => g.map((x) => x.key))).toEqual([['near-a'], ['near-b']])
    expect(unattached.map((x) => x.key)).toEqual(['far'])
  })

  it('needs a strict majority of the cluster, like the greedy pass — one bridging member is not enough', () => {
    const cluster = [art('a1', 0), art('a2', 100)]
    expect(attachToClusters([cluster], [art('x', 2)]).unattached).toHaveLength(1) // links 1 of 2
  })

  it('never mutates the clusters, never joins two of them, and honors the soft country rule', () => {
    const clusters = [[art('a1', 0, 0, ['804'])], [art('b1', 4, 0, ['804'])]]
    const before = JSON.stringify(clusters)
    const { attached } = attachToClusters(clusters, [art('x', 2, 1, ['804'])])
    expect(attached.flat()).toHaveLength(1) // one cluster, not both
    expect(JSON.stringify(clusters)).toBe(before)
    expect(attachToClusters([[art('a1', 0, 0, ['804'])]], [art('y', 1, 1, ['643'])]).unattached).toHaveLength(1)
  })

  it('never forms a cluster of its own from items alone', () => {
    const { attached, unattached } = attachToClusters([], [art('p', 0), art('q', 1)])
    expect(attached).toEqual([])
    expect(unattached).toHaveLength(2)
  })
})

describe('first-hand posts ATTACH to an Event and never create or lift one (J, 2026-09-24)', () => {
  const COUNTRIES = [
    { id: '804', name: 'Ukraine' },
    { id: '643', name: 'Russia' },
  ]
  const outlet = (id: string) => ({ id, name: id.toUpperCase(), sourceType: 'outlet', vetting: 'confirmed' }) as SourceProfile
  const channel = (id: string, over: Partial<FirstHandProfile> = {}): FirstHandProfile => ({
    id,
    name: id,
    sourceType: 'first-hand',
    label: 'First-hand account',
    channel: `${id}_channel`,
    channelTier: 'osint-aggregator',
    vetting: 'confirmed',
    ...over,
  })
  const profiles = [outlet('a'), outlet('b'), outlet('c'), channel('agg'), channel('mapper', { channelTier: 'verification-specialist', specialistVerified: true }), channel('slava', { channelTier: 'combatant-affiliated', affiliationNote: 'Pro-Russian news aggregator' })]
  const now = '2026-09-20T12:00:00.000Z'
  const ctx = { profiles, countryMatchers: buildCountryMatchers(COUNTRIES), now }
  const raw = (sourceId: string, title: string, minutesAgo = 30, extra: Partial<RawArticle> = {}): RawArticle => ({
    sourceId,
    title,
    description: '',
    url: `https://${sourceId}.test/${encodeURIComponent(title)}`,
    publishedAt: new Date(Date.parse(now) - minutesAgo * 60_000).toISOString(),
    ...extra,
  })
  const embedderFor = (angles: Record<string, number>): Embedder => async (texts) => texts.map((t) => at(angles[t.split('. ')[0]] ?? 170))

  const T_A = 'Ukraine army launches offensive as troops advance'
  const T_B = 'Offensive by Ukraine army as troops advance on the front'
  const T_FH = 'Ukraine offensive underway, troops advancing on the front'
  const angles = { [T_A]: 0, [T_B]: 3, [T_FH]: 5 }
  const founders = [raw('a', T_A, 40), raw('b', T_B, 35)]

  it('joins the Event the outlets made — after them, labeled, and not counted', async () => {
    const r = await buildEventsWithEmbeddings([...founders, raw('slava', T_FH, 30)], ctx, embedderFor(angles))
    expect(r.published).toHaveLength(1)
    const sources = r.published[0].sources
    expect(sources.map((x) => x.sourceId)).toEqual(['a', 'b', 'slava'])
    expect(sources[2]).toMatchObject({ sourceCategory: 'first-hand', channel: 'slava_channel', affiliationNote: 'Pro-Russian news aggregator', countsTowardCorroboration: false })
    expect(r.dropped['not-attached']).toHaveLength(0)
  })

  it('changes NOTHING else about the Event — id, title, timestamp, countries, tags, severity, corroboration', async () => {
    const without = await buildEventsWithEmbeddings(founders, ctx, embedderFor(angles))
    const withPost = await buildEventsWithEmbeddings([...founders, raw('agg', T_FH, 60), raw('mapper', T_FH + ' ', 20)], ctx, embedderFor({ ...angles, [T_FH + ' ']: 5 }))
    const { sources: s0, ...rest0 } = without.published[0]
    const { sources: s1, ...rest1 } = withPost.published[0]
    expect(rest1).toEqual(rest0)
    expect(s1.filter((x) => x.sourceCategory !== 'first-hand')).toEqual(s0)
    expect(s1.filter((x) => x.sourceCategory === 'first-hand')).toHaveLength(2)
    expect(deriveCorroboration(s1)).toBe(deriveCorroboration(s0))
  })

  it('an alarming channel post cannot escalate the Event past what its outlets can back', async () => {
    const alarm = 'Massacre in Ukraine: airstrike kills 50 people as troops advance'
    const without = await buildEventsWithEmbeddings(founders, ctx, embedderFor(angles))
    const r = await buildEventsWithEmbeddings([...founders, raw('slava', alarm, 30)], ctx, embedderFor({ ...angles, [alarm]: 5 }))
    expect(r.published).toHaveLength(1)
    expect(r.published[0].severity).toBe(without.published[0].severity)
    expect(r.published[0].sources.some((x) => x.sourceCategory === 'first-hand')).toBe(true)
  })

  it('never creates an Event, whatever the channel — including a specialist-verified tier-1 one', async () => {
    for (const id of ['agg', 'mapper', 'slava']) {
      const r = await buildEventsWithEmbeddings([raw(id, T_A)], ctx, embedderFor(angles))
      expect(r.published, id).toHaveLength(0)
      expect(r.pending, id).toHaveLength(0)
    }
    // Several channels agreeing with each other is still not an Event.
    const r = await buildEventsWithEmbeddings([raw('agg', T_A, 40), raw('mapper', T_B, 35), raw('slava', T_FH, 30)], ctx, embedderFor(angles))
    expect(r.published).toHaveLength(0)
    expect(r.dropped['not-attached']).toHaveLength(3)
  })

  it('cannot lift a below-floor Event past its floor — one outlet plus a specialist-verified post publishes nothing', async () => {
    const r = await buildEventsWithEmbeddings([raw('a', T_A, 40), raw('mapper', T_FH, 30)], ctx, embedderFor(angles))
    expect(r.published).toHaveLength(0)
    expect(r.dropped['below-floor']).toHaveLength(1)
    expect(r.dropped['not-attached']).toHaveLength(1)
  })

  it('a post about something else stays unattached, and the Event is untouched', async () => {
    const other = 'Ukraine drone attack hits refinery overnight'
    const r = await buildEventsWithEmbeddings([...founders, raw('agg', other, 30)], ctx, embedderFor({ ...angles, [other]: 120 }))
    expect(r.published[0].sources).toHaveLength(2)
    expect(r.dropped['not-attached']).toHaveLength(1)
  })

  it('non-English channel text is dropped as unsupported-language before attaching is even considered', async () => {
    const uk = channel('deepstate', { language: 'uk' })
    const r = await buildEventsWithEmbeddings([...founders, raw('deepstate', T_FH, 30, { language: 'uk' })], { ...ctx, profiles: [...profiles, uk] }, embedderFor(angles))
    expect(r.dropped['unsupported-language']).toHaveLength(1)
    expect(r.published[0].sources).toHaveLength(2)
  })

  it('a post with no country and no topic is pre-filtered without being embedded', async () => {
    let embedded = 0
    const embedder: Embedder = async (texts) => {
      embedded += texts.length
      return texts.map(() => at(0))
    }
    const r = await buildEventsWithEmbeddings([raw('agg', 'Lovely weather this afternoon')], ctx, embedder)
    expect(r.dropped['not-attached']).toHaveLength(1)
    expect(embedded).toBe(0)
  })

  it('embeds outlet articles and first-hand posts in SEPARATE calls, so a first-hand post cannot nudge an outlet vector (batch padding + q8 make vectors batch-dependent)', async () => {
    const calls: string[][] = []
    const embedder: Embedder = async (texts) => {
      calls.push(texts)
      return embedderFor(angles)(texts)
    }
    await buildEventsWithEmbeddings([...founders, raw('slava', T_FH, 30), raw('agg', T_FH, 25)], ctx, embedder)
    expect(calls).toHaveLength(2)
    expect(calls[0]).toHaveLength(2) // exactly the two outlet articles, as if no first-hand post existed
    expect(calls[0].every((t) => !t.startsWith(T_FH))).toBe(true)
    expect(calls[1]).toHaveLength(2)
  })

  it('carries a post picture only when first-hand media is deliberately enabled — the served file must not hold a URL by default', async () => {
    const post = raw('slava', T_FH, 30, { mediaUrl: 'https://cdn.example/photo.jpg', hasVideo: true })
    const off = await buildEventsWithEmbeddings([...founders, post], ctx, embedderFor(angles))
    const fhOff = off.published[0].sources.find((x) => x.sourceCategory === 'first-hand')
    expect(fhOff).not.toHaveProperty('mediaUrl')
    expect(fhOff).not.toHaveProperty('imageUrl')
    const on = await buildEventsWithEmbeddings([...founders, post], { ...ctx, firstHandMedia: true }, embedderFor(angles))
    const fhOn = on.published[0].sources.find((x) => x.sourceCategory === 'first-hand')
    expect(fhOn).toMatchObject({ mediaUrl: 'https://cdn.example/photo.jpg' })
    expect(fhOn).not.toHaveProperty('imageUrl')
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
