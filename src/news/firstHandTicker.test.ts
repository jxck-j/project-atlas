import { describe, expect, it } from 'vitest'
import { classifyCaptionSafety, isTickerSafe } from './contentSafety'
import { buildFirstHandTicker, MAX_TICKER_POSTS, TICKER_WINDOW_HOURS } from './firstHandTicker'
import type { EmbeddingClassifier } from './embeddingClassifier'
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
