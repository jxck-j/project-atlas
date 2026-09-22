import { describe, expect, it } from 'vitest'
import { classifyText, resolveTopicTags } from './classify'
import { clusterArticles, LINK_WINDOW_MS, MAX_CLUSTER_SPAN_MS, type ClusterArticle } from './clustering'
import { buildCountryMatchers, resolveCountryIds } from './countryResolution'
import { buildEvents, isCommentaryUrl, stableHash, type RawArticle } from './eventBuilder'
import { deriveCorroboration } from './corroboration'
import { SOURCES } from './sourceConfig'
import type { SourceProfile } from './types'
import feeds from './feeds.json'

const COUNTRIES = [
  { id: '840', name: 'United States of America' },
  { id: '643', name: 'Russia' },
  { id: '804', name: 'Ukraine' },
  { id: '729', name: 'Sudan' },
  { id: '728', name: 'South Sudan' },
  { id: '566', name: 'Nigeria' },
  { id: '562', name: 'Niger' },
  { id: '356', name: 'India' },
  { id: '792', name: 'Turkey' },
  { id: 'taiwan', name: 'Taiwan' },
]
const matchers = buildCountryMatchers(COUNTRIES)

describe('resolveCountryIds', () => {
  it('claims a compound name before the name inside it', () => {
    expect(resolveCountryIds('Fighting spreads across South Sudan', matchers)).toEqual(['728'])
    // ...and masks every occurrence, so a second mention can't expose bare "Sudan".
    expect(resolveCountryIds('South Sudan talks stall as South Sudan army advances', matchers)).toEqual(['728'])
    expect(resolveCountryIds('Sudan and South Sudan agree border deal', matchers).sort()).toEqual(['728', '729'])
  })

  it('does not match a country name inside a longer word', () => {
    expect(resolveCountryIds('Nigeria imposes curfew', matchers)).toEqual(['566'])
    expect(resolveCountryIds('Niger junta expels envoy', matchers)).toEqual(['562'])
    expect(resolveCountryIds('Indiana governor signs bill', matchers)).toEqual([])
  })

  it('is case-sensitive, so the pronoun "us" and the bird "turkey" do not link countries', () => {
    expect(resolveCountryIds('Officials tell us the turkey is ready', matchers)).toEqual([])
    expect(resolveCountryIds('Turkey summons US ambassador', matchers).sort()).toEqual(['792', '840'])
  })

  it('matches punctuated aliases and returns ids in first-mention order', () => {
    expect(resolveCountryIds('Kremlin rejects U.S. proposal on Kyiv', matchers)).toEqual(['643', '840', '804'])
  })

  it('resolves Taiwan, which is not in the UN-193 topology', () => {
    expect(resolveCountryIds('Taiwanese ships spotted near strait', matchers)).toEqual(['taiwan'])
  })
})

describe('classifyText', () => {
  it('drops wide-net false positives v1 kept: "war" inside "software"', () => {
    expect(resolveTopicTags('New software update released in India')).toEqual([])
  })

  it('a conflict incident with 10+ deaths is Critical; 9 is Major', () => {
    expect(classifyText('Airstrike kills 12 people in Sudan, army says').severity).toBe('critical')
    expect(classifyText('Airstrike kills 9 people in Sudan, army says').severity).toBe('major')
  })

  it('mass-casualty is conflict-scoped: a 12-death flood is not Critical', () => {
    const c = classifyText('Flood kills 12 people in Nigeria')
    expect(c.topicTags).toContain('humanitarian-displacement')
    expect(c.severity).not.toBe('critical')
  })

  it('evacuation advisories parse and rank as MAJOR at most, on the real typhoon headlines (J, 2026-09-21)', () => {
    expect(classifyText('Over 1.6 million in Japan urged to evacuate as Typhoon Dujuan nears Tokyo').severity).toBe('major')
    expect(classifyText('Millions urged to evacuate as powerful Typhoon Dujuan hits Japan').severity).toBe('major')
    expect(classifyText('Evacuation order for 600,000 residents as wildfire spreads in Australia').severity).toBe('major')
    // below the line it stays at the humanitarian baseline, and an advisory is never Critical however large
    expect(classifyText('20,000 residents urged to evacuate as river floods Turkey').severity).not.toBe('critical')
    expect(classifyText('Over 30 million urged to evacuate as typhoon nears China').severity).toBe('major')
    // but people actually DISPLACED at that scale are still critical
    expect(classifyText('Floods displaced 800,000 people in India, refugee agency says').severity).toBe('critical')
  })

  it('humanitarian thresholds are separate: 500 deaths or 500k displaced is Critical, 50 is Major', () => {
    expect(classifyText('Earthquake kills 600 in Turkey').severity).toBe('critical')
    expect(classifyText('Earthquake kills 60 in Turkey').severity).toBe('major')
    expect(classifyText('Fighting displaced 800,000 people in Sudan, refugee agency says').severity).toBe('critical')
    expect(classifyText('Floods displaced 20,000 people in India').severity).toBe('major')
  })

  it('diplomacy triggers: coup is Critical; rhetoric is Routine; a concrete step is Significant', () => {
    expect(classifyText('Military stages coup in Niger, president ousted').severity).toBe('critical')
    expect(classifyText('Russian president warns of consequences over talks').severity).toBe('routine')
    expect(classifyText('Russian president signs decree on parliament election').severity).toBe('significant')
  })

  it('flags head-of-state DEATH claims only — not "president says 10 dead" or a deposal', () => {
    expect(classifyText('President assassinated in Niger, state TV says').headOfStateDeathClaim).toBe(true)
    expect(classifyText('Prime Minister Modi dies, officials confirm').headOfStateDeathClaim).toBe(true)
    expect(classifyText('Nigerian president says 10 dead in attack').headOfStateDeathClaim).toBe(false)
    expect(classifyText('President deposed in overnight takeover').headOfStateDeathClaim).toBe(false)
  })

  it('a head-of-state death claim is Critical whatever the tags', () => {
    expect(classifyText('Turkey president killed, reports say').severity).toBe('critical')
  })

  it('crime/sci-tech alone caps at Major', () => {
    expect(classifyText('Ransomware hits hospital network in India, cyberattack on infrastructure').severity).toBe('major')
  })

  // Settled calls from the 2026-09-21 severity review (LOGBOOK.md) — real headlines the keyword rules got wrong.
  it('an attack on an EMBASSY is Critical with no casualties (inherently rare); on infrastructure it is Major (settled call 2)', () => {
    expect(classifyText('Gunmen storm the embassy compound in the capital, no casualties reported yet').severity).toBe('critical')
    expect(classifyText('Saudi pipeline shut after drone attacks').severity).toBe('major')
  })

  it('a capital attack is Critical only if it is a first-time/rare strike; a routine capital strike in an active war is Major regardless of casualty count (settled call 7)', () => {
    // Riyadh's real headline: rare (this is the first attack on this capital since the conflict resumed) -> Critical.
    expect(classifyText('Houthis targeted Saudi capital for the first time since the Yemen conflict resumed').severity).toBe('critical')
    // Moscow's real headlines: routine/recurring in an active war, no rarity phrase, 2 deaths -> Major, never Critical.
    expect(classifyText("Ukraine pummels Moscow with drones, mayor calls it the biggest ever drone attack on the Russian capital; two killed").severity).toBe('major')
    expect(classifyText('Kyiv launches massive strikes on the Russian capital as Russians vote').severity).toBe('major')
  })

  it('a contained strike is Major only at 5+ deaths or a clear escalation, not any casualty count (settled call 5)', () => {
    expect(classifyText('Israeli airstrike kills three people in Gaza, medics say').severity).toBe('significant')
    expect(classifyText('Russian airstrike kills 5 in Ukrainian city, officials say').severity).toBe('major')
    expect(classifyText('Russia launches first-ever strike with new hypersonic missile on Kyiv, one wounded').severity).toBe('major')
  })

  it("a striking state's own unconfirmed toll claim stays Significant regardless of count (settled call 1)", () => {
    expect(classifyText('Pakistan says 28 killed in airstrikes on three targets in Afghanistan').severity).toBe('significant')
    expect(classifyText('Pakistan says it killed 28 militants in airstrikes').severity).toBe('significant')
    // Independently confirmed: the ordinary threshold applies again.
    expect(classifyText('Pakistan says 28 killed in airstrikes, independently confirmed by hospital officials').severity).toBe('critical')
  })

  it('a legal follow-up on a PAST head-of-state killing is not a fresh death claim (settled call 4)', () => {
    const extradited = classifyText("18 suspects accused in the 2021 killing of Haiti's president being extradited to U.S.")
    expect(extradited.headOfStateDeathClaim).toBe(false)
    expect(extradited.severity).toBe('significant')
    expect(classifyText('Kosovo ex-president Thaci sentenced to 25 years for war crimes').severity).toBe('major')
  })

  it('severing diplomatic relations is Major; expelling an ambassador stays Significant (settled call 6)', () => {
    expect(classifyText('Algiers cuts diplomatic relations with Abu Dhabi').severity).toBe('major')
    const expelled = classifyText('Algeria expels Emirati ambassador over remarks')
    expect(expelled.topicTags).toContain('diplomacy-politics')
    expect(expelled.severity).toBe('significant')
  })
})

describe('clusterArticles', () => {
  const H = 60 * 60 * 1000
  const a = (key: string, title: string, time: number, ids = ['804']): ClusterArticle => ({ key, title, linkedEntityIds: ids, time })

  it('merges same-country, high-overlap headlines within the window', () => {
    const out = clusterArticles([
      a('1', 'Russian missile strike hits Kyiv apartment block', 0),
      a('2', 'Missile strike hits apartment block in Kyiv, officials say', 2 * H),
      a('3', 'Central bank raises interest rates again', 3 * H, ['643']),
    ])
    expect(out.map((c) => c.length).sort()).toEqual([1, 2])
  })

  it('does not merge across countries, or across the link window', () => {
    expect(clusterArticles([a('1', 'Missile strike hits Kyiv apartment block', 0), a('2', 'Missile strike hits Kyiv apartment block', 1, ['643'])])).toHaveLength(2)
    expect(clusterArticles([a('1', 'Missile strike hits Kyiv apartment block', 0), a('2', 'Missile strike hits Kyiv apartment block', LINK_WINDOW_MS + 1)])).toHaveLength(2)
  })

  it('a headline with too few significant words never links', () => {
    expect(clusterArticles([a('1', 'Kyiv strike', 0), a('2', 'Kyiv strike', H)])).toHaveLength(2)
  })

  it('does not chain: A~B and B~C never fuse A with C when C only links to one of A/B', () => {
    // Real shape from live feeds: three "Trump / meet / New York" stories.
    const zelensky1 = a('1', 'Zelenskyy says Trump agrees to meet him in New York', 0, ['804', '840'])
    const zelensky2 = a('2', 'Zelensky and Trump have agreed to meet in New York, Ukrainian president says', H, ['804', '840'])
    const mamdani = a('3', 'Trump and Mamdani plan to meet in New York during US president UN visit', 2 * H, ['840'])
    const out = clusterArticles([zelensky1, zelensky2, mamdani])
    const clusterOf = (key: string) => out.find((c) => c.some((m) => m.key === key))!
    expect(clusterOf('3')).not.toBe(clusterOf('1'))
  })

  it('does not link on a short headline "contained" in an unrelated longer one (real live pair)', () => {
    const out = clusterArticles([
      a('1', 'US, China Meet for Talks in New York Before Trump-Xi Summit', 0, ['840', '156']),
      a('2', 'Ukraine’s Zelensky to meet Trump in New York', H, ['804', '840']),
    ])
    expect(out).toHaveLength(2)
  })

  it('requires a strict majority of a cluster to link — 1 of 2 is not enough', () => {
    const A = a('1', 'Ukraine drones hit refinery Kyiv region', 0)
    const B = a('2', 'Drones refinery Kyiv region fire spreads', H) // links to A (4 shared words)
    const C = a('3', 'Kyiv region fire spreads officials evacuate', 2 * H) // links to B (4 shared) but not A (2 shared)
    const out = clusterArticles([A, B, C])
    expect(out.map((c) => c.map((m) => m.key))).toEqual([['1', '2'], ['3']])
  })

  it('splits a transitively-chained cluster that spans more than the cap', () => {
    // Each neighbor is inside the link window, but the chain runs 96h end to end.
    const step = 30 * H
    const chain = [0, 1, 2, 3].map((i) => a(`k${i}`, 'Missile strike hits Kyiv apartment block overnight', i * step))
    const out = clusterArticles(chain)
    expect(out.length).toBeGreaterThan(1)
    for (const c of out) expect(c[c.length - 1].time - c[0].time).toBeLessThanOrEqual(MAX_CLUSTER_SPAN_MS)
  })
})

describe('buildEvents', () => {
  const profile = (id: string, extra: Partial<SourceProfile> = {}) =>
    ({ id, name: id.toUpperCase(), sourceType: 'outlet', vetting: 'confirmed', ...extra }) as SourceProfile
  const profiles = [
    profile('a'),
    profile('b'),
    profile('c'),
    profile('d'),
    profile('e'),
    profile('wire', { tier: 'wire' }),
    profile('tass', { pressControl: 'state-controlled' }),
  ]
  const now = '2026-09-20T12:00:00.000Z'
  const ctx = { profiles, countryMatchers: matchers, now }
  const art = (sourceId: string, title: string, minutes = 0, extra: Partial<RawArticle> = {}): RawArticle => ({
    sourceId,
    title,
    url: `https://example.test/${sourceId}/${stableHash(title)}`,
    publishedAt: new Date(Date.parse(now) - (60 - minutes) * 60_000).toISOString(),
    ...extra,
  })

  it('a lone report never publishes (every tier needs 2+ distinct sources)', () => {
    const r = buildEvents([art('a', 'Russian army launches offensive near Kyiv')], ctx)
    expect(r.published).toHaveLength(0)
    expect(r.dropped['below-floor']).toHaveLength(1)
  })

  it('two outlets on one story publish one Event with both dossier entries and derived corroboration', () => {
    const r = buildEvents(
      [art('a', 'Russian army launches offensive near Kyiv, troops advance'), art('b', 'Russian troops advance in offensive near Kyiv', 5)],
      ctx,
    )
    expect(r.published).toHaveLength(1)
    const [event] = r.published
    expect(event.sources.map((s) => s.sourceId).sort()).toEqual(['a', 'b'])
    expect(event.linkedEntityIds).toEqual(expect.arrayContaining(['643', '804']))
    expect(event.eventTimestamp).toBe(event.sources[0].timestamp)
    expect(deriveCorroboration(event.sources)).toBe('osint-corroborated (2+)')
    expect(event).not.toHaveProperty('corroboration')
    expect(event.reviewStatus).toBe('auto-published')
  })

  it('the same URL arriving through two feeds is one source, not two', () => {
    const one = art('a', 'Russian army launches offensive near Kyiv, troops advance')
    const r = buildEvents([one, { ...one }], ctx)
    expect(r.duplicateUrls).toBe(1)
    expect(r.published).toHaveLength(0)
  })

  it('Critical needs a wire report or three distinct non-state outlets', () => {
    const story = 'Airstrike kills 15 people in Kyiv, troops say army struck apartment block'
    const two = ['a', 'b'].map((s, i) => art(s, `${story} report ${s}`, i))
    expect(buildEvents(two, ctx).published).toHaveLength(0)

    const three = [...two, art('c', `${story} report c`, 4)]
    const r3 = buildEvents(three, ctx)
    expect(r3.published).toHaveLength(1)
    expect(r3.published[0].severity).toBe('critical')

    // A state outlet is in the dossier but does not count toward the three.
    const twoPlusState = [...two, art('tass', `${story} report tass`, 4)]
    const rs = buildEvents(twoPlusState, ctx)
    expect(rs.published).toHaveLength(0)

    // A wire report clears Critical alone (plus one more source for the story to exist as an Event).
    const wire = buildEvents([art('wire', `${story} report wire`, 0)], ctx)
    expect(wire.published).toHaveLength(1)
  })

  it('a head-of-state death claim that clears the floor goes to pending, never to published', () => {
    const story = 'President assassinated in Niger, state television says, reports of army takeover'
    const r = buildEvents(['a', 'b', 'c', 'd'].map((s, i) => art(s, `${story} ${s}`, i)), ctx)
    expect(r.published).toHaveLength(0)
    expect(r.pending).toHaveLength(1)
    expect(r.pending[0].reviewStatus).toBe('pending-confirmation')
  })

  it('drops unknown sources, country-less and topic-less articles, with reasons', () => {
    const r = buildEvents(
      [
        art('nobody', 'Russian army launches offensive near Kyiv'),
        art('a', 'Army launches offensive near the border'),
        art('a', 'Russia celebrates local festival of lights'),
      ],
      ctx,
    )
    expect(r.dropped['unknown-source']).toHaveLength(1)
    expect(r.dropped['no-country']).toHaveLength(1)
    expect(r.dropped['no-topic']).toHaveLength(1)
  })

  it('event ids are stable across a later report joining the cluster', () => {
    const first = art('a', 'Russian army launches offensive near Kyiv, troops advance', 0)
    const second = art('b', 'Russian troops advance in offensive near Kyiv', 5)
    const late = art('c', 'Offensive near Kyiv sees Russian troops advance', 20)
    const before = buildEvents([first, second], ctx).published[0]
    const after = buildEvents([first, second, late], ctx).published[0]
    expect(after.id).toBe(before.id)
    expect(after.sources).toHaveLength(3)
  })

  it('copies rating metadata from the profile onto the dossier entry', () => {
    const rated = [
      profile('a', { leaning: 'lean-left', leaningSource: 'AllSides', leaningConfidence: 'medium', caveat: 'state-funded' }),
      profile('b'),
    ]
    const r = buildEvents(
      [art('a', 'Russian army launches offensive near Kyiv, troops advance'), art('b', 'Russian troops advance in offensive near Kyiv', 5)],
      { ...ctx, profiles: rated },
    )
    const entry = r.published[0].sources.find((s) => s.sourceId === 'a')
    expect(entry).toMatchObject({ leaning: 'lean-left', leaningSource: 'AllSides', leaningConfidence: 'medium', caveat: 'state-funded' })
  })
})

describe('feeds.json', () => {
  it('every feed points at a real outlet profile, with a unique url', () => {
    const outletIds = new Set(SOURCES.filter((s) => s.sourceType === 'outlet').map((s) => s.id))
    for (const f of feeds) expect(outletIds.has(f.sourceId), `${f.url} -> unknown outlet ${f.sourceId}`).toBe(true)
    expect(new Set(feeds.map((f) => f.url)).size).toBe(feeds.length)
  })

  it('never points a wire-tier id at a feed it cannot actually serve (Reuters/AP/AFP have no reachable feed)', () => {
    for (const f of feeds) expect(['reuters', 'ap', 'afp']).not.toContain(f.sourceId)
  })
})

describe('isCommentaryUrl', () => {
  it('rejects opinion/explainer-programme paths, keeps news paths', () => {
    expect(isCommentaryUrl('https://www.wsj.com/opinion/what-is-saudi-arabias-plan-fff7e604')).toBe(true)
    expect(isCommentaryUrl('https://www.aljazeera.com/video/inside-story/2026/9/20/how-will-saudi-arabia-deal')).toBe(true)
    expect(isCommentaryUrl('https://www.theguardian.com/commentisfree/2026/sep/20/x')).toBe(false)
    expect(isCommentaryUrl('https://www.aljazeera.com/news/2026/9/20/meloni-promises-to-ban-burqas')).toBe(false)
    expect(isCommentaryUrl('not a url')).toBe(false)
  })

  it('a story whose only extra "outlets" are columns does not reach a floor it would not otherwise', () => {
    const profile = (id: string) => ({ id, name: id, sourceType: 'outlet', vetting: 'confirmed' }) as SourceProfile
    const r = buildEvents(
      [
        { sourceId: 'a', title: 'Russian army launches offensive near Kyiv, troops advance', url: 'https://x.test/news/1', publishedAt: '2026-09-20T10:00:00Z' },
        { sourceId: 'b', title: 'Russian troops advance in offensive near Kyiv, army says', url: 'https://x.test/opinion/2', publishedAt: '2026-09-20T10:05:00Z' },
      ],
      { profiles: [profile('a'), profile('b')], countryMatchers: matchers, now: '2026-09-20T12:00:00.000Z' },
    )
    expect(r.published).toHaveLength(0)
    expect(r.dropped['not-a-report']).toHaveLength(1)
  })
})

describe('topic tagging', () => {
  it('"disaster" as political metaphor is not a humanitarian tag', () => {
    expect(resolveTopicTags("Merz vows to stay in office after CDU 'disaster' in state elections")).not.toContain('humanitarian-displacement')
    expect(resolveTopicTags('Natural disaster strikes coastal region')).toContain('humanitarian-displacement')
  })
})
