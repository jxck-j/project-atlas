import { describe, expect, it } from 'vitest'
import { classifyCaptionSafety, isTickerSafe } from './contentSafety'
import { buildFirstHandTicker, MAX_TICKER_POSTS, TICKER_WINDOW_HOURS } from './firstHandTicker'
import type { EmbeddingClassifier } from './embeddingClassifier'
import type { Embedder } from './embeddingClustering'
import { FEED_RETENTION_DAYS } from './feedWindow'
import { MAX_PINS_PER_TAB, PIN_RETENTION_DAYS, selectPinnedPosts, type TickerPost } from './tickerTypes'
import type { RawArticle } from './eventBuilder'
import type { FirstHandProfile, SourceProfile } from './types'

describe('contentSafety — Layer 1 caption filter (§15f)', () => {
  it.each([
    ['Explosion reported near the port of Odesa', 'C'],
    ['12 killed in strike on a market in Kharkiv', 'C'], // ordinary casualty reporting is explicitly NOT tier B
    ['Al Gore says the climate summit failed', 'C'],
    ['Iran severed ties with the envoy', 'C'],
    ['Russian forces advance toward Pokrovsk, troops say', 'C'],
  ])('lets ordinary reporting through: %s', (text, tier) => {
    expect(classifyCaptionSafety(text).tier).toBe(tier)
    expect(isTickerSafe(text)).toBe(true)
  })

  it.each([
    'Report: soldiers raped civilians in the occupied town',
    'Militants accused of sexual violence against detainees',
    'Two teenagers sexually assaulted in the camp',
    'Child abuse material found on the seized devices',
    'ISIS video shows the execution of hostages',
    'New hostage confession video released by the group',
  ])('blocks tier A: %s', (text) => {
    expect(classifyCaptionSafety(text).tier).toBe('A')
    expect(isTickerSafe(text)).toBe(false)
  })

  it.each([
    'GRAPHIC: aftermath of the strike',
    'Viewer discretion advised — footage from the front',
    'Video shows the bodies of soldiers near the treeline',
    'Footage of the dead after the shelling',
    'Prisoners were tortured, the ministry says',
    'WARNING: disturbing footage',
    '18+ drone footage',
  ])('blocks tier B, which the text ticker treats as a block (no Layer 2): %s', (text) => {
    expect(classifyCaptionSafety(text).tier).toBe('B')
    expect(isTickerSafe(text)).toBe(false)
  })

  it('tier A wins when both match, and reports the rule', () => {
    expect(classifyCaptionSafety('GRAPHIC: soldiers raped civilians')).toEqual({ tier: 'A', rule: 'A: sexual violence' })
  })
})

const NOW = '2026-09-24T12:00:00.000Z'
const channel = (id: string, over: Partial<FirstHandProfile> = {}): FirstHandProfile => ({
  id,
  name: id.toUpperCase(),
  sourceType: 'first-hand',
  label: 'First-hand account',
  channel: `${id}_channel`,
  channelTier: 'osint-aggregator',
  vetting: 'confirmed',
  ...over,
})
const profiles: SourceProfile[] = [
  channel('agg'),
  channel('slava', { channelTier: 'combatant-affiliated', affiliationNote: 'Pro-Russian news aggregator' }),
  { id: 'outlet', name: 'Outlet', sourceType: 'outlet', vetting: 'confirmed' } as SourceProfile,
]
const post = (sourceId: string, title: string, minutesAgo = 30, extra: Partial<RawArticle> = {}): RawArticle => ({
  sourceId,
  title,
  url: `https://t.me/${sourceId}/${encodeURIComponent(title)}`,
  publishedAt: new Date(Date.parse(NOW) - minutesAgo * 60_000).toISOString(),
  ...extra,
})
const build = (articles: RawArticle[]) => buildFirstHandTicker(articles, { profiles, now: NOW })

describe('buildFirstHandTicker', () => {
  it('carries a channel post with its attribution, newest first', async () => {
    const { file } = await build([
      post('agg', 'Ukraine army launches offensive as troops advance', 90),
      post('slava', 'Russian forces strike a military base in Ukraine', 10, { forwardedFrom: 'Some Channel' }),
    ])
    expect(file.generatedAt).toBe(NOW)
    expect(file.posts.map((p) => p.sourceId)).toEqual(['slava', 'agg'])
    expect(file.posts[0]).toMatchObject({
      channelName: 'SLAVA',
      channel: 'slava_channel',
      channelTier: 'combatant-affiliated',
      affiliationNote: 'Pro-Russian news aggregator',
      forwardedFrom: 'Some Channel',
      topicTags: expect.arrayContaining(['conflict-security']),
    })
    expect(file.posts[1].affiliationNote).toBeUndefined()
  })

  it('ignores outlet articles and carries no media', async () => {
    const { file } = await build([post('outlet', 'Ukraine army launches offensive'), post('agg', 'Ukraine army launches offensive', 5, { hasVideo: true, mediaUrl: 'https://cdn.example/x.jpg' })])
    expect(file.posts.map((p) => p.sourceId)).toEqual(['agg'])
    expect(JSON.stringify(file)).not.toContain('cdn.example')
    expect(file.posts[0]).not.toHaveProperty('mediaUrl')
    expect(file.posts[0]).not.toHaveProperty('hasVideo')
  })

  it('drops non-English text, stale and future posts, video-only posts and reposts — each counted', async () => {
    const { file, dropped } = await build([
      post('agg', 'Ukraine army launches offensive', 10, { language: 'uk' }),
      post('agg', 'Ukraine army advances on the front', TICKER_WINDOW_HOURS * 60 + 5),
      post('agg', 'Ukraine army advances on the front line', -30), // 30 minutes in the future
      post('agg', '', 5, { hasVideo: true }),
      post('agg', 'Ukraine army launches a new offensive', 20),
      post('slava', 'UKRAINE ARMY launches a new offensive!', 15), // same words, later
    ])
    expect(file.posts).toHaveLength(1)
    // The original (earliest) copy is the one kept.
    expect(file.posts[0].sourceId).toBe('agg')
    expect(dropped).toMatchObject({ unsupportedLanguage: 1, outOfWindow: 2, noText: 2 })
  })

  it('applies Layer 1 — a tier A or B caption never reaches the file', async () => {
    const { file, dropped } = await build([
      post('agg', 'Ukraine army launches offensive as troops advance', 10),
      post('agg', 'GRAPHIC: Ukraine army strike aftermath near the front', 9),
      post('agg', 'Soldiers raped civilians in the occupied Ukraine town', 8),
    ])
    expect(file.posts).toHaveLength(1)
    expect(dropped.unsafe).toBe(2)
  })

  it('without a classifier, a post with no topic keyword is off-topic', async () => {
    const { file, dropped } = await build([post('agg', 'Good morning everyone, welcome to the channel', 10)])
    expect(file.posts).toEqual([])
    expect(dropped.offTopic).toBe(1)
  })

  it('caps the file at MAX_TICKER_POSTS, newest kept, and truncates long text', async () => {
    const many = Array.from({ length: MAX_TICKER_POSTS + 20 }, (_, i) => post('agg', `Ukraine army offensive number ${i} as troops advance`, i + 1))
    const { file } = await build([...many, post('agg', 'Ukraine army offensive ' + 'word '.repeat(200), 0.5)])
    expect(file.posts).toHaveLength(MAX_TICKER_POSTS)
    expect(file.posts[0].text.length).toBeLessThanOrEqual(401)
    expect(file.posts[0].text.endsWith('…')).toBe(true)
  })

  describe('with the trained classifier', () => {
    const embed = async (texts: string[]) => texts.map(() => [0])
    const classifierOf = (relevanceByTitle: (title: string) => number): EmbeddingClassifier => {
      let i = 0
      return {
        // `classify` is called in candidate order; recover the title from the order we passed texts in.
        classify: () => ({ relevance: relevanceByTitle(titles[i++]), tags: ['energy'] }),
      }
    }
    let titles: string[] = []

    it('takes its tags from the classifier, and gates by the two-regime rule (keyword: mild, none: strict)', async () => {
      const arts = [
        post('agg', 'Ukraine army launches offensive', 30), // keyword topic, relevance 0.35 -> kept (>= 0.30)
        post('agg', 'Ukraine army advances in the east', 20), // keyword topic, relevance 0.10 -> dropped
        post('agg', 'Big news from the capital today', 10), // no keyword, relevance 0.50 -> dropped (< 0.60)
        post('agg', 'Something happening at the harbour now', 5), // no keyword, relevance 0.70 -> kept
      ]
      const scores: Record<string, number> = {
        'Ukraine army launches offensive': 0.35,
        'Ukraine army advances in the east': 0.1,
        'Big news from the capital today': 0.5,
        'Something happening at the harbour now': 0.7,
      }
      // candidates are walked oldest-first, matching `ordered` in the builder
      titles = ['Ukraine army launches offensive', 'Ukraine army advances in the east', 'Big news from the capital today', 'Something happening at the harbour now']
      const { file, dropped } = await buildFirstHandTicker(arts, { profiles, now: NOW }, { embed, classifier: classifierOf((t) => scores[t]) })
      expect(file.posts.map((p) => p.text)).toEqual(['Something happening at the harbour now', 'Ukraine army launches offensive'])
      expect(file.posts.every((p) => p.topicTags.join() === 'energy')).toBe(true)
      expect(dropped.offTopic).toBe(2)
    })
  })
})

describe('auto-pinning (J, 2026-09-24): the Events severity wording rules decide, and a pin outlives the 24 h window', () => {
  const DAY = 24 * 60
  const MAJOR = 'Large-scale Russian ballistic missile attack on Kyiv.'
  const CRITICAL = 'Russian ballistic missile attack on Kyiv kills 12 civilians as troops advance'
  const ROUTINE = 'Ukraine army advances on the front'

  it('pins a Major/Critical post, records each post severity, and keeps a pin for PIN_RETENTION_DAYS', async () => {
    const { file } = await build([post('agg', MAJOR, 3 * DAY), post('agg', CRITICAL, 5 * DAY), post('agg', ROUTINE, 10)])
    const byText = Object.fromEntries(file.posts.map((p) => [p.text, p]))
    expect(byText[MAJOR]).toMatchObject({ severity: 'major', pinned: true })
    expect(byText[CRITICAL]).toMatchObject({ severity: 'critical', pinned: true })
    expect(byText[ROUTINE]).toMatchObject({ severity: 'significant' })
    expect(byText[ROUTINE].pinned).toBeUndefined()
  })

  it('drops an old post that is not pin-worthy, and anything past the pin retention', async () => {
    const { file, dropped } = await build([post('agg', ROUTINE, 3 * DAY), post('agg', MAJOR, (PIN_RETENTION_DAYS + 1) * DAY)])
    expect(file.posts).toEqual([])
    expect(dropped.outOfWindow).toBe(2)
  })

  it('a live post can be pinned too, and pins are not cut by the ordinary-post cap', async () => {
    const many = Array.from({ length: MAX_TICKER_POSTS + 5 }, (_, i) => post('agg', `Ukraine army offensive number ${i} as troops advance`, i + 1))
    const { file } = await build([...many, post('agg', MAJOR, 3 * DAY)])
    expect(file.posts.filter((p) => !p.pinned)).toHaveLength(MAX_TICKER_POSTS)
    expect(file.posts.filter((p) => p.pinned).map((p) => p.text)).toEqual([MAJOR])
  })

  it('never carries a head-of-state death claim — the Events hold those for a human and the ticker has no review', async () => {
    const { file, dropped } = await build([post('agg', 'President of Iran killed in helicopter crash', 10), post('agg', ROUTINE, 20)])
    expect(file.posts.map((p) => p.text)).toEqual([ROUTINE])
    expect(dropped.unconfirmedClaim).toBe(1)
  })

  describe('with embeddings, one story is one pin', () => {
    const embed: Embedder = async (texts) => texts.map((t) => (t.includes('Tehran') ? [0, 1] : [1, 0]))
    const classifier: EmbeddingClassifier = { classify: () => ({ relevance: 1, tags: ['conflict-security'] }) }
    const run = (articles: RawArticle[]) => buildFirstHandTicker(articles, { profiles, now: NOW }, { embed, classifier })

    it('folds near-duplicates into the most severe (then latest) of them and drops the others once they are past 24 h', async () => {
      const tehran = 'Large-scale Russian ballistic missile attack on Tehran.'
      const { file } = await run([post('agg', MAJOR, 4 * DAY), post('slava', CRITICAL, 4 * DAY + 60), post('agg', tehran, 3 * DAY)])
      expect(file.posts.map((p) => [p.text, p.pinned])).toEqual([
        [tehran, true],
        [CRITICAL, true],
      ])
    })

    it('folds at the looser pin threshold: two takes on one attack at cosine 0.6 are one pin, though the Events would not link them', async () => {
      const takes: Embedder = async (texts) => texts.map((t) => (t.includes('Tehran') ? [0.6, 0.8] : [1, 0]))
      const { file } = await buildFirstHandTicker([post('agg', MAJOR, 4 * DAY), post('slava', 'Large-scale Russian ballistic missile attack on Tehran.', 4 * DAY + 60)], { profiles, now: NOW }, { embed: takes, classifier })
      expect(file.posts).toHaveLength(1)
      // Equal severity, so the latest wins.
      expect(file.posts[0].text).toContain('Kyiv')
    })

    it('a folded duplicate that is still live stays in the ticker, unpinned', async () => {
      const { file } = await run([post('agg', MAJOR, 60), post('slava', CRITICAL, 30)])
      expect(file.posts.map((p) => [p.text, p.pinned ?? false])).toEqual([
        [CRITICAL, true],
        [MAJOR, false],
      ])
    })
  })
})

describe('selectPinnedPosts (the tab pins, on the reader clock)', () => {
  const nowMs = Date.parse(NOW)
  const pin = (id: string, over: Partial<TickerPost> = {}): TickerPost => ({
    id,
    sourceId: 'agg',
    channelName: 'AGG',
    channel: 'agg_channel',
    channelTier: 'osint-aggregator',
    text: id,
    url: `https://t.me/agg/${id}`,
    publishedAt: new Date(nowMs - 60 * 60_000).toISOString(),
    topicTags: ['conflict-security'],
    severity: 'major',
    pinned: true,
    ...over,
  })
  const hoursAgo = (h: number) => new Date(nowMs - h * 3_600_000).toISOString()

  it('scopes to the tab, needs the pinned flag, and orders by severity then recency', () => {
    const posts = [
      pin('old-major', { publishedAt: hoursAgo(5) }),
      pin('new-major', { publishedAt: hoursAgo(1) }),
      pin('critical', { severity: 'critical', publishedAt: hoursAgo(9) }),
      pin('other-tab', { topicTags: ['energy'] }),
      { ...pin('not-pinned'), pinned: undefined },
    ]
    expect(selectPinnedPosts(posts, 'conflict-security', nowMs).map((p) => p.id)).toEqual(['critical', 'new-major', 'old-major'])
  })

  it('expires a pin on the READER clock even if the file still carries it', () => {
    const stale = pin('stale', { publishedAt: hoursAgo((PIN_RETENTION_DAYS + 1) * 24) })
    expect(selectPinnedPosts([stale, pin('fresh')], 'conflict-security', nowMs).map((p) => p.id)).toEqual(['fresh'])
  })

  it('shows at most MAX_PINS_PER_TAB', () => {
    const posts = Array.from({ length: MAX_PINS_PER_TAB + 4 }, (_, i) => pin(`p${i}`, { publishedAt: hoursAgo(i + 1) }))
    expect(selectPinnedPosts(posts, 'conflict-security', nowMs)).toHaveLength(MAX_PINS_PER_TAB)
  })

  it('a pin lives as long as an Event does', () => {
    expect(PIN_RETENTION_DAYS).toBe(FEED_RETENTION_DAYS)
  })
})
