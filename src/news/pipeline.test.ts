import { describe, expect, it } from 'vitest'
import { classifyText, extractSeverityFacts, resolveTopicTags } from './classify'
import { clusterArticles, LINK_WINDOW_MS, MAX_CLUSTER_SPAN_MS, type ClusterArticle } from './clustering'
import { buildCountryMatchers, resolveCountryIds } from './countryResolution'
import { buildEvents, isCommentaryUrl, stableHash, type RawArticle } from './eventBuilder'
import { deriveCorroboration } from './corroboration'
import { recordDecision } from './confirmations'
import { SOURCES } from './sourceConfig'
import type { SourceProfile } from './types'
import feeds from './feeds.json'
import feedGaps from './feedGaps.json'

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

  it('a death toll accumulated across a recurring campaign caps at Major, not the single-incident mass-casualty Critical (J, 2026-09-21)', () => {
    // The real headline this was found from.
    expect(classifyText('US strikes on alleged drug boats may constitute crimes against humanity, UN expert says. Dozens of US attacks on boats in the Pacific and Caribbean have killed more than 230 people since September 2025.').severity).toBe('major')
    expect(classifyText('Militant attacks in the region have killed over 500 people since the start of the year.').severity).not.toBe('critical')
    // A genuine single-incident toll of the same magnitude is unaffected.
    expect(classifyText('Airstrike kills 230 people in single strike on market').severity).toBe('critical')
  })

  it('a bare "m"/"k" unit only scales a number when it is actually an abbreviation, not the start of the next word', () => {
    // Found 2026-09-21 mining the archive for label candidates: "28 militants" was reading as
    // "28 million" because the unit suffix had no word boundary, matching the 'm' of "militants".
    expect(extractSeverityFacts('Pakistan says it killed 28 militants, Afghan Taliban and UN report three civilian deaths').deaths).toBe(28)
    expect(extractSeverityFacts('5 killed in market bombing in Baghdad').deaths).toBe(5)
    // real abbreviations still work
    expect(extractSeverityFacts('28m displaced by flooding in Pakistan').displaced).toBe(28_000_000)
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

  it('a regime-change mention needs a head-of-state/government term nearby, and a dated coup reference is historical, not fresh (found in the severity relabel, phase 2)', () => {
    // Real bug: "ousted" fired Critical for military officers expelled from a party, not a government overthrown.
    expect(classifyText('China expels two former top generals from the Party, accusing them of disloyalty').severity).not.toBe('critical')
    // A coup dated in the past ("the 2021 coup") is a historical reference, not a live regime-change claim.
    expect(classifyText("Myanmar accuses UN representative of illegal acts after pledging loyalty to the opposition following the 2021 coup").severity).not.toBe('critical')
    // A live coup is still Critical.
    expect(classifyText('Military stages coup in Niger, president ousted').severity).toBe('critical')
  })

  it('a mass-casualty attack tagged only by a bare "bomb"/"blast" still reaches the conflict tag and the death threshold', () => {
    expect(classifyText('At least 31 killed in car bomb at mosque near police compound in Pakistan').severity).toBe('critical')
  })

  it('"early elections" is a snap-election-equivalent Major trigger', () => {
    expect(classifyText("Serbia's Vucic calls early parliamentary elections for October 25").severity).toBe('major')
  })

  it('a legal follow-up on a PAST head-of-state killing is not a fresh death claim (settled call 4)', () => {
    const extradited = classifyText("18 suspects accused in the 2021 killing of Haiti's president being extradited to U.S.")
    expect(extradited.headOfStateDeathClaim).toBe(false)
    expect(extradited.severity).toBe('significant')
    expect(classifyText('Kosovo ex-president Thaci sentenced to 25 years for war crimes').severity).toBe('major')
  })

  it('a judicial follow-up does not inherit the PAST attack death toll quoted in its own coverage (settled call 4, generalized 2026-09-23)', () => {
    // The live bug: the headline alone was Significant, but the description carrying the 2019 attack's 270 deaths
    // pushed the verdict to Critical. Both halves are asserted so a regression can't hide in either one.
    expect(classifyText('Sri Lanka court convicts 15 over 2019 Easter bombings, 9 acquitted').severity).toBe('significant')
    expect(
      classifyText(
        'Sri Lanka court convicts 15 over 2019 Easter bombings, 9 acquitted. The 2019 attacks on churches and hotels killed 270 people and wounded hundreds more.',
      ).severity,
    ).toBe('significant')
  })

  it('same-day arrests at a FRESH mass-casualty attack do not downgrade it — only judicial language implies a past event', () => {
    expect(classifyText('Suicide bombing kills 150 at shrine in the capital').severity).toBe('critical')
    expect(classifyText('Suicide bombing kills 150 at shrine today; police arrested two suspects at the scene').severity).toBe('critical')
  })

  it('a judicial follow-up floors at Significant even when its coverage reads as rhetoric ("8 accused")', () => {
    // Without the floor this lands Routine: "accused" trips rhetoricOnly, and the casualty guard above has already
    // closed the Critical route. Note the phrasing needs a topic tag to reach this branch at all — the same sentence
    // written "2015 Paris attacks" (no "terror") tags nothing and falls to the untagged fallback instead.
    expect(classifyText('Court opens trial of 8 accused over 2015 Paris terror attacks that killed 130 people').severity).toBe('significant')
  })

  it('bare "terror" carries the terrorism tag, so its death count reaches the tag-scoped mass-casualty check', () => {
    expect(resolveTopicTags('Terror attack on commuter train kills 130 people and wounds 200')).toContain('terrorism-non-state-actors')
    expect(classifyText('Terror attack on commuter train kills 130 people and wounds 200').severity).toBe('critical')
    // Whole-word + optional plural: "terrified" must not tag.
    expect(resolveTopicTags('Residents terrified as storm approaches coast')).not.toContain('terrorism-non-state-actors')
  })

  it('bare "attack" tags only when a casualty word co-occurs, so rhetoric stays untagged', () => {
    // The case the 'terror' fix left open: the same Paris sentence with no other violence keyword.
    expect(resolveTopicTags('Court opens trial of 8 accused over the 2015 Paris attacks that killed 130 people')).toContain('conflict-security')
    expect(classifyText('Court opens trial of 8 accused over the 2015 Paris attacks that killed 130 people').severity).toBe('significant')
    // Attack without casualties, and casualties without an attack, both stay out.
    expect(resolveTopicTags('Senator attacks critics of the new farm policy')).not.toContain('conflict-security')
    expect(resolveTopicTags('Candidate launches attack ad against rival')).not.toContain('conflict-security')
    expect(resolveTopicTags('Factory fire leaves 3 dead in Dhaka')).not.toContain('conflict-security')
  })

  it('the medical and animal senses of "attack" never tag, but do not mask a real attack in the same text', () => {
    expect(resolveTopicTags('Man dies of a heart attack at a stadium; two others injured in the crush')).not.toContain('conflict-security')
    // A real archive false positive the rule was tightened against.
    expect(resolveTopicTags('Fatal dog attacks trigger safety fears in Hong Kong after a cyclist was killed')).not.toContain('conflict-security')
    expect(resolveTopicTags('Attacker with a history of panic attacks kills 4 at a market')).toContain('conflict-security')
  })

  it('capturing a SUSPECT is an arrest, not a territorial gain', () => {
    // Archive case: the attack rule newly tagged this, and "captured" then made a school shooting Major.
    const text = 'Eleven injured in shooting outside Turkish school. Officials say the attacker has been captured.'
    expect(resolveTopicTags(text)).toContain('conflict-security')
    expect(extractSeverityFacts(text).territorial).toBe(false)
    expect(classifyText(text).severity).toBe('significant')
    // A real territorial claim is untouched.
    expect(extractSeverityFacts('Russian troops captured the eastern town after weeks of fighting').territorial).toBe(true)
    expect(classifyText('Russian troops captured the eastern town after weeks of fighting').severity).toBe('major')
  })

  it('the attack rule is a gap-filler: text already tagged conflict/terrorism gets no extra tag', () => {
    expect(resolveTopicTags('Airstrike attack kills 12 in Sudan')).toEqual(['conflict-security'])
    expect(resolveTopicTags('Militant attack kills 12 at a market')).toEqual(['terrorism-non-state-actors'])
  })

  it('"for the first time" is only an escalation next to a fighting word (Phase 4 live report)', () => {
    // The reported bug: a first diplomatic MEETING tiered Major, because the text also mentioned military support
    // somewhere else, and conflictish + escalation is Major on its own.
    const text =
      "Britain's Burnham to meet Trump and make UN debut after offering UK military support for Saudis. Burnham is set to meet U.S. President Donald Trump for the first time."
    expect(resolveTopicTags(text)).toContain('conflict-security')
    expect(extractSeverityFacts(text).escalation).toBe(false)
    expect(classifyText(text).severity).toBe('significant')
    // Same clause as a fighting word: still an escalation (both of these are labeled Major in the fixture).
    expect(extractSeverityFacts('This is the first time since the May 2025 military clashes that tension has erupted').escalation).toBe(true)
    expect(extractSeverityFacts('USMC Used Its Playbook In Combat For First Time During Epic Fury').escalation).toBe(true)
    // Bare "war" is not a fighting word here — it is background in economic coverage.
    expect(extractSeverityFacts('US diesel topped $6.50 a gallon for the first time, extending a war-driven rally').escalation).toBe(false)
  })

  it('an explicit escalation word still stands alone, but de-escalation is not escalation', () => {
    expect(extractSeverityFacts('Houthis hit Saudi Arabia, threatening further escalation').escalation).toBe(true)
    expect(extractSeverityFacts('Mediators urge de-escalation after border clashes').escalation).toBe(false)
    expect(extractSeverityFacts('Both sides agree to deescalate tensions along the frontier').escalation).toBe(false)
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

  // Phase 5: the Admin Console's decisions have to survive the next rebuild,
  // because the build is stateless and re-runs the gate from scratch.
  describe('with recorded review decisions (Admin Console)', () => {
    const deathStory = 'President assassinated in Niger, state television says, reports of army takeover'
    const articles = ['a', 'b', 'c', 'd'].map((s, i) => art(s, `${deathStory} ${s}`, i))
    const queued = buildEvents(articles, ctx).pending[0]

    it('publishes a confirmed claim as manual-only on the next build', () => {
      const confirmations = recordDecision([], queued, 'confirmed', now)
      const r = buildEvents(articles, { ...ctx, confirmations })
      expect(r.pending).toHaveLength(0)
      expect(r.published).toHaveLength(1)
      expect(r.published[0].reviewStatus).toBe('manual-only')
    })

    it('drops a rejected claim entirely — not published, and not re-queued', () => {
      const r = buildEvents(articles, { ...ctx, confirmations: recordDecision([], queued, 'rejected', now) })
      expect(r.published).toHaveLength(0)
      expect(r.pending).toHaveLength(0)
      expect(r.dropped['review-rejected']).toHaveLength(articles.length)
    })

    it('re-attaches the decision after the Event id moves, via a shared article URL', () => {
      // An EARLIER report arriving re-keys the cluster's id (the id is the
      // first member's URL hash), which is exactly what the URL match is for.
      const earlier = art('e', `${deathStory} e`, -30)
      const confirmations = recordDecision([], queued, 'confirmed', now)
      const r = buildEvents([earlier, ...articles], { ...ctx, confirmations })
      expect(r.published).toHaveLength(1)
      expect(r.published[0].id).not.toBe(queued.id)
      expect(r.published[0].reviewStatus).toBe('manual-only')
    })

    it('never lets a stale decision lift an ordinary Event — the gate reads it for death claims only', () => {
      const ordinary = [art('a', 'Russian army launches offensive near Kyiv, troops advance'), art('b', 'Russian troops advance in offensive near Kyiv', 5)]
      // A confirmation whose URL set covers these articles, which a normal
      // Event must ignore entirely rather than treat as pre-approval.
      const confirmations = recordDecision([], { id: 'x', title: 'unrelated', sources: queued.sources }, 'confirmed', now)
      const lone = buildEvents([ordinary[0]], { ...ctx, confirmations })
      expect(lone.published).toHaveLength(0) // still below its floor
      const pair = buildEvents(ordinary, { ...ctx, confirmations })
      expect(pair.published[0].reviewStatus).toBe('auto-published')
      expect(pair.published[0]).not.toHaveProperty('manuallyConfirmed')
    })
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

  describe('per source type', () => {
    const analysis = (id: string, extra: Partial<SourceProfile> = {}) =>
      ({ id, name: id.toUpperCase(), sourceType: 'analysis', label: 'Non-partisan analysis', vetting: 'confirmed', ...extra }) as SourceProfile
    const roster = [...profiles, analysis('thinktank'), analysis('isw', { specialistVerified: true })]
    const story = 'Russian army launches offensive near Kyiv, troops advance'

    it('an analysis org enters the dossier as an analysis entry, not an outlet', () => {
      const r = buildEvents([art('a', story), art('thinktank', 'Russian troops advance in offensive near Kyiv', 5)], { ...ctx, profiles: roster })
      expect(r.dropped['unknown-source']).toHaveLength(0)
      const entry = r.published[0].sources.find((s) => s.sourceId === 'thinktank')
      expect(entry).toMatchObject({ sourceCategory: 'analysis', org: 'THINKTANK', label: 'Non-partisan analysis', countsTowardCorroboration: true })
      expect(entry).not.toHaveProperty('leaning')
    })

    it('a specialist-verified org alone makes an Event specialist-verified, but never counts toward Critical', () => {
      // §8: Major-and-below accept specialist-verified in place of 2+ sources, so one ISW/Bellingcat report publishes.
      const lone = buildEvents([art('isw', story)], { ...ctx, profiles: roster })
      expect(lone.published).toHaveLength(1)
      expect(deriveCorroboration(lone.published[0].sources)).toBe('specialist-verified')
      // A non-specialist analysis org is one ordinary source.
      expect(buildEvents([art('thinktank', story)], { ...ctx, profiles: roster }).published).toHaveLength(0)
      // Two outlets plus an analysis org is not three outlets.
      const critical = 'Airstrike kills 15 people in Kyiv, troops say army struck apartment block'
      const withAnalysis = [art('a', `${critical} a`), art('b', `${critical} b`, 1), art('isw', `${critical} isw`, 2)]
      expect(buildEvents(withAnalysis, { ...ctx, profiles: roster }).published).toHaveLength(0)
    })

    it('a non-English feed is dropped before classification, whatever it says', () => {
      const r = buildEvents(
        [art('a', story), art('b', 'Russian troops advance in offensive near Kyiv', 5, { language: 'es' })],
        ctx,
      )
      expect(r.dropped['unsupported-language']).toHaveLength(1)
      expect(r.published).toHaveLength(0)
    })

    it('a country-native source links to its home country only when the text names none', () => {
      const native = [profile('tt', { tier: 'country-native', countryName: 'Taiwan' }), profile('tt2', { tier: 'country-native', countryName: 'Taiwan' })]
      const domestic = buildEvents(
        [art('tt', 'Army launches offensive drills as troops advance on the coast'), art('tt2', 'Troops advance in army offensive drills on the coast', 5)],
        { ...ctx, profiles: native },
      )
      expect(domestic.dropped['no-country']).toHaveLength(0)
      expect(domestic.published[0]?.linkedEntityIds).toEqual(['taiwan'])

      const foreign = buildEvents([art('tt', story), art('tt2', 'Russian troops advance in offensive near Kyiv', 5)], { ...ctx, profiles: native })
      expect(foreign.published[0].linkedEntityIds).not.toContain('taiwan')
    })
  })
})

describe('feeds.json', () => {
  it('every feed points at a real roster profile, with a unique url', () => {
    const ids = new Set(SOURCES.map((s) => s.id))
    for (const f of feeds) expect(ids.has(f.sourceId), `${f.url} -> unknown source ${f.sourceId}`).toBe(true)
    expect(new Set(feeds.map((f) => f.url)).size).toBe(feeds.length)
  })

  it('never points a wire-tier id at a feed it cannot actually serve (Reuters/AP/AFP have no reachable feed)', () => {
    for (const f of feeds) expect(['reuters', 'ap', 'afp']).not.toContain(f.sourceId)
  })

  it('declares a language only when it is not English, as a two-letter code', () => {
    for (const f of feeds as { sourceId: string; language?: string }[]) {
      if (f.language !== undefined) expect(f.language, f.sourceId).toMatch(/^[a-z]{2}$/)
      expect(f.language, f.sourceId).not.toBe('en')
    }
  })

  // Every vetted profile is either fetched or explicitly accounted for — so a roster addition (the Admin Console can
  // add one) fails here until someone finds its feed or records why there isn't one, instead of silently never ingesting.
  it('together with feedGaps.json, covers every sources.json profile exactly once', () => {
    const fed = new Set(feeds.map((f) => f.sourceId))
    const gapIds = feedGaps.map((g) => g.sourceId)
    expect(new Set(gapIds).size, 'duplicate gap').toBe(gapIds.length)
    for (const id of gapIds) expect(fed.has(id), `${id} is both fed and listed as a gap`).toBe(false)
    for (const s of SOURCES) expect(fed.has(s.id) || gapIds.includes(s.id), `${s.id} has no feed and no feedGaps.json entry`).toBe(true)
    for (const g of feedGaps) {
      expect(SOURCES.some((s) => s.id === g.sourceId), `gap for unknown source ${g.sourceId}`).toBe(true)
      expect(g.reason.length, g.sourceId).toBeGreaterThan(10)
      expect(g.checked, g.sourceId).toMatch(/^\d{4}-\d{2}-\d{2}$/)
    }
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

  it('strategic tech (chips, reusable rockets, telecom infrastructure) tags science-technology and lands Significant', () => {
    const lithography = classifyText("China unveils prototype lithography machine from its own chipmaker, an ASML-esque leap for its chip industry")
    expect(lithography.topicTags).toContain('science-technology')
    expect(lithography.severity).toBe('significant')

    const rocket = classifyText('SpaceX flies its reusable rocket for a record ninth time')
    expect(rocket.topicTags).toContain('science-technology')
    expect(rocket.severity).toBe('significant')

    const cable = classifyText('Taiwan investigates suspected sabotage of undersea cable near its coast')
    expect(cable.topicTags).toContain('science-technology')
  })

  it('a routine consumer-product story stays out of scope', () => {
    expect(resolveTopicTags('Apple unveils new iPhone with faster chip and better camera')).not.toContain('science-technology')
    expect(classifyText('Apple unveils new iPhone with faster chip and better camera').severity).toBe('routine')
  })
})
