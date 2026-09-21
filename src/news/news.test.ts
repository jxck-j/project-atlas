import { describe, expect, it } from 'vitest'
import { deriveCorroboration, meetsCorroborationFloor } from './corroboration'
import { buildFeed, filterEvents } from './feed'
import { isReaderVisible, resolvePublishDecision } from './publishGate'
import { compareByRecency, compareBySeverityThenRecency, compareWorld, splitFeatured } from './ranking'
import {
  applySeverityCaps,
  capSeverity,
  compareSeverity,
  fallbackSeverity,
  humanitarianSeverity,
  massCasualtySeverity,
  maxSeverity,
} from './severity'
import { getNewsTab, NEWS_TABS } from './tabs'
import { activeThemes, themeLabel } from './themes'
import type { NewsEvent, OutletSourceEntry, SourceEntry, SystemicThemeConfig } from './types'

// Hand-verified cases against news-sourcing-design.md's tables, not snapshots.

let seq = 0
function outlet(sourceId: string, overrides: Partial<OutletSourceEntry> = {}): OutletSourceEntry {
  return {
    id: `e${++seq}`,
    sourceId,
    sourceCategory: 'outlet',
    outlet: sourceId,
    countsTowardCorroboration: true,
    refUrl: `https://example.test/${sourceId}`,
    timestamp: '2026-09-20T09:00:00Z',
    ...overrides,
  }
}
const wire = (sourceId = 'reuters') => outlet(sourceId, { tier: 'wire' })

function event(overrides: Partial<NewsEvent> = {}): NewsEvent {
  return {
    id: `ev${++seq}`,
    title: 'Test event',
    eventTimestamp: '2026-09-20T09:00:00Z',
    linkedEntityIds: ['804'],
    topicTags: ['conflict-security'],
    systemicThemes: [],
    severity: 'significant',
    reviewStatus: 'auto-published',
    sources: [],
    snapshotDate: '2026-09-20',
    ...overrides,
  }
}

describe('deriveCorroboration', () => {
  it('is unconfirmed for an empty dossier', () => {
    expect(deriveCorroboration([])).toBe('unconfirmed')
  })

  it('is unconfirmed for one non-wire source', () => {
    expect(deriveCorroboration([outlet('guardian')])).toBe('unconfirmed')
  })

  it('is wire-confirmed from a single wire entry alone', () => {
    expect(deriveCorroboration([wire()])).toBe('wire-confirmed')
  })

  it("the doc's own example: a Reuters entry plus a BBC entry is trivially wire-confirmed", () => {
    expect(deriveCorroboration([wire('reuters'), outlet('bbc')])).toBe('wire-confirmed')
  })

  it('is osint-corroborated with two distinct non-wire sources', () => {
    expect(deriveCorroboration([outlet('guardian'), outlet('bbc')])).toBe('osint-corroborated (2+)')
  })

  it('counts two entries from one sourceId as ONE source (two Bloomberg feeds are one outlet)', () => {
    expect(deriveCorroboration([outlet('bloomberg'), outlet('bloomberg')])).toBe('unconfirmed')
  })

  it('is specialist-verified from one ISW-style analysis entry', () => {
    const isw: SourceEntry = {
      id: 'x',
      sourceId: 'isw',
      sourceCategory: 'analysis',
      org: 'ISW',
      label: 'Non-partisan analysis',
      specialistVerified: true,
      countsTowardCorroboration: true,
      refUrl: 'https://example.test/isw',
      timestamp: '2026-09-20T09:00:00Z',
    }
    expect(deriveCorroboration([isw])).toBe('specialist-verified')
  })

  it('does not treat a non-specialist analysis org as specialist-verified', () => {
    const chatham: SourceEntry = {
      id: 'x',
      sourceId: 'chatham-house',
      sourceCategory: 'analysis',
      org: 'Chatham House',
      label: 'Non-partisan analysis',
      countsTowardCorroboration: true,
      refUrl: 'https://example.test/c',
      timestamp: '2026-09-20T09:00:00Z',
    }
    expect(deriveCorroboration([chatham])).toBe('unconfirmed')
  })

  it('wire outranks specialist-verified when both are present', () => {
    const isw: SourceEntry = {
      id: 'x',
      sourceId: 'isw',
      sourceCategory: 'analysis',
      org: 'ISW',
      label: 'Non-partisan analysis',
      specialistVerified: true,
      countsTowardCorroboration: true,
      refUrl: 'u',
      timestamp: '2026-09-20T09:00:00Z',
    }
    expect(deriveCorroboration([isw, wire()])).toBe('wire-confirmed')
  })

  it('is outlet-corroborated with three distinct outlets and no wire (Critical floor: four until 2026-09-21)', () => {
    expect(deriveCorroboration(['guardian', 'bbc', 'npr'].map((id) => outlet(id)))).toBe('outlet-corroborated (3+)')
  })

  it('two distinct outlets is still only osint-corroborated', () => {
    expect(deriveCorroboration(['guardian', 'bbc'].map((id) => outlet(id)))).toBe('osint-corroborated (2+)')
  })

  it('three entries from two sourceIds is two sources, not three', () => {
    expect(deriveCorroboration(['guardian', 'bbc', 'bbc'].map((id) => outlet(id)))).toBe('osint-corroborated (2+)')
  })

  it('analysis orgs and first-hand accounts do not count toward the three — outlets only', () => {
    const analysis = (sourceId: string): SourceEntry => ({
      id: sourceId,
      sourceId,
      sourceCategory: 'analysis',
      org: sourceId,
      label: 'Non-partisan analysis',
      countsTowardCorroboration: true,
      refUrl: 'u',
      timestamp: '2026-09-20T09:00:00Z',
    })
    const mix = [outlet('guardian'), outlet('bbc'), analysis('chatham-house'), analysis('csis')]
    expect(deriveCorroboration(mix)).toBe('osint-corroborated (2+)')
  })

  it('a wire report still wins over three outlets', () => {
    expect(deriveCorroboration([wire(), ...['guardian', 'bbc', 'npr'].map((id) => outlet(id))])).toBe('wire-confirmed')
  })

  it('three outlets outrank a lone specialist-verified entry', () => {
    const isw: SourceEntry = {
      id: 'x',
      sourceId: 'isw',
      sourceCategory: 'analysis',
      org: 'ISW',
      label: 'Non-partisan analysis',
      specialistVerified: true,
      countsTowardCorroboration: true,
      refUrl: 'u',
      timestamp: '2026-09-20T09:00:00Z',
    }
    expect(deriveCorroboration([isw, ...['guardian', 'bbc', 'npr'].map((id) => outlet(id))])).toBe('outlet-corroborated (3+)')
  })

  it('community discussion does not pad the three (two outlets plus a Reddit thread is two)', () => {
    const reddit: SourceEntry = {
      id: 'r1',
      sourceId: 'r-geopolitics',
      sourceCategory: 'community-discussion',
      platform: 'reddit',
      sourceCommunity: 'r/geopolitics',
      countsTowardCorroboration: true,
      refUrl: 'u',
      timestamp: '2026-09-20T09:00:00Z',
    }
    expect(deriveCorroboration([...['guardian', 'bbc'].map((id) => outlet(id)), reddit])).toBe('osint-corroborated (2+)')
  })

  it('state-controlled outlets do not count toward the three — four state media alone is not corroboration', () => {
    const state = ['tass', 'xinhua', 'irna', 'kcna'].map((id) => outlet(id, { pressControl: 'state-controlled' }))
    expect(deriveCorroboration(state)).toBe('osint-corroborated (2+)')
  })

  it('a state-media claim reaches the three only alongside three non-state outlets', () => {
    const state = ['tass', 'xinhua'].map((id) => outlet(id, { pressControl: 'state-controlled' }))
    const nonState = ['guardian', 'bbc'].map((id) => outlet(id))
    expect(deriveCorroboration([...state, ...nonState])).toBe('osint-corroborated (2+)')
    expect(deriveCorroboration([...state, ...nonState, outlet('npr')])).toBe('outlet-corroborated (3+)')
  })

  it('state-run-democratic and unlabeled outlets still count (Focus Taiwan, Al Jazeera are not pressControl: state-controlled)', () => {
    const mix = [
      outlet('focus-taiwan', { pressControl: 'state-run-democratic' }),
      outlet('al-jazeera', { caveat: 'state-funded' }),
      outlet('guardian'),
    ]
    expect(deriveCorroboration(mix)).toBe('outlet-corroborated (3+)')
  })

  it('ignores an entry whose countsTowardCorroboration is false', () => {
    expect(deriveCorroboration([outlet('reuters', { tier: 'wire', countsTowardCorroboration: false })])).toBe('unconfirmed')
  })

  it("community discussion never counts, even mis-stamped countsTowardCorroboration: true (§9b's wall)", () => {
    const reddit: SourceEntry = {
      id: 'r1',
      sourceId: 'r-credibledefense',
      sourceCategory: 'community-discussion',
      platform: 'reddit',
      sourceCommunity: 'r/CredibleDefense',
      countsTowardCorroboration: true,
      refUrl: 'u',
      timestamp: '2026-09-20T09:00:00Z',
    }
    const reddit2: SourceEntry = { ...reddit, id: 'r2', sourceId: 'r-geopolitics', sourceCommunity: 'r/geopolitics' }
    expect(deriveCorroboration([reddit, reddit2])).toBe('unconfirmed')
    // ...and one real source plus community chatter is still just one source.
    expect(deriveCorroboration([outlet('guardian'), reddit])).toBe('unconfirmed')
  })

  it('live video does not count while its status is unresolved (§17c)', () => {
    const live: SourceEntry = {
      id: 'l1',
      sourceId: 'cam',
      sourceCategory: 'live-video',
      countsTowardCorroboration: true,
      refUrl: 'u',
      timestamp: '2026-09-20T09:00:00Z',
    }
    expect(deriveCorroboration([live, outlet('guardian')])).toBe('unconfirmed')
  })
})

describe('meetsCorroborationFloor', () => {
  it('orders wire > outlet (3+) > specialist > osint > unconfirmed', () => {
    expect(meetsCorroborationFloor('wire-confirmed', 'outlet-corroborated (3+)')).toBe(true)
    expect(meetsCorroborationFloor('specialist-verified', 'outlet-corroborated (3+)')).toBe(false)
    expect(meetsCorroborationFloor('wire-confirmed', 'specialist-verified')).toBe(true)
    expect(meetsCorroborationFloor('specialist-verified', 'osint-corroborated (2+)')).toBe(true)
    expect(meetsCorroborationFloor('osint-corroborated (2+)', 'specialist-verified')).toBe(false)
    expect(meetsCorroborationFloor('unconfirmed', 'osint-corroborated (2+)')).toBe(false)
  })
})

describe('severity ordering and caps', () => {
  it('compareSeverity sorts most severe first', () => {
    expect((['routine', 'critical', 'significant', 'major'] as const).slice().sort(compareSeverity)).toEqual([
      'critical',
      'major',
      'significant',
      'routine',
    ])
  })

  it('maxSeverity of nothing is routine', () => {
    expect(maxSeverity([])).toBe('routine')
    expect(maxSeverity(['significant', 'major', 'routine'])).toBe('major')
  })

  it('capSeverity lowers but never raises', () => {
    expect(capSeverity('critical', 'significant')).toBe('significant')
    expect(capSeverity('routine', 'significant')).toBe('routine')
  })

  it('massCasualtySeverity: 10+ deaths in one incident is critical, 9 is not decided by count alone', () => {
    expect(massCasualtySeverity(10)).toBe('critical')
    expect(massCasualtySeverity(9)).toBeNull()
  })

  it('humanitarianSeverity: 500+ deaths OR 500,000+ displaced OR PHEIC is critical', () => {
    expect(humanitarianSeverity({ deaths: 500 })).toBe('critical')
    expect(humanitarianSeverity({ displaced: 500_000 })).toBe('critical')
    expect(humanitarianSeverity({ pheic: true })).toBe('critical')
    expect(humanitarianSeverity({ deaths: 499, displaced: 499_999 })).toBe('major')
  })

  it('humanitarianSeverity: 50+ deaths OR 10,000+ displaced is major; below both is undecided', () => {
    expect(humanitarianSeverity({ deaths: 50 })).toBe('major')
    expect(humanitarianSeverity({ displaced: 10_000 })).toBe('major')
    expect(humanitarianSeverity({ deaths: 49, displaced: 9_999 })).toBeNull()
    expect(humanitarianSeverity({})).toBeNull()
  })

  it('an evacuation ORDER ranks one tier below actual displacement: 500,000+ evacuees is major, never critical (J, 2026-09-21)', () => {
    expect(humanitarianSeverity({ evacuationOrdered: 1_600_000 })).toBe('major')
    expect(humanitarianSeverity({ evacuationOrdered: 500_000 })).toBe('major')
    expect(humanitarianSeverity({ evacuationOrdered: 499_999 })).toBeNull()
    // the same number actually DISPLACED is critical — that is the whole distinction
    expect(humanitarianSeverity({ displaced: 1_600_000 })).toBe('critical')
    // an advisory never lifts a tier the real figures already earned, and never pushes past major
    expect(humanitarianSeverity({ deaths: 600, evacuationOrdered: 2_000_000 })).toBe('critical')
    expect(humanitarianSeverity({ evacuationOrdered: 50_000_000 })).toBe('major')
  })

  it('a conflict-scale 10-death disaster is NOT critical — the thresholds are deliberately separate', () => {
    expect(humanitarianSeverity({ deaths: 10 })).toBeNull()
  })

  it('fallbackSeverity: an actor taking a real action is significant, otherwise routine', () => {
    expect(fallbackSeverity(true)).toBe('significant')
    expect(fallbackSeverity(false)).toBe('routine')
  })

  it('caps a domestic incident with no state response at significant regardless of tier', () => {
    expect(applySeverityCaps('critical', { topicTags: ['crime-trafficking'], domesticNoStateResponse: true })).toBe('significant')
    expect(applySeverityCaps('major', { topicTags: ['conflict-security'], domesticNoStateResponse: true })).toBe('significant')
  })

  it('lets a domestic incident reach major once a state response attaches', () => {
    expect(applySeverityCaps('major', { topicTags: ['conflict-security'], domesticNoStateResponse: false })).toBe('major')
  })

  it('caps crime-only and sci-tech-only events at major (no Critical trigger of their own)', () => {
    expect(applySeverityCaps('critical', { topicTags: ['crime-trafficking'] })).toBe('major')
    expect(applySeverityCaps('critical', { topicTags: ['science-technology', 'crime-trafficking'] })).toBe('major')
  })

  it('lets crime co-occurring with another tag reach critical', () => {
    expect(applySeverityCaps('critical', { topicTags: ['crime-trafficking', 'conflict-security'] })).toBe('critical')
  })
})

describe('resolvePublishDecision', () => {
  it('holds a critical event with only 2-3 sources below the floor', () => {
    const decision = resolvePublishDecision(event({ severity: 'critical', sources: [outlet('guardian'), outlet('bbc')] }))
    expect(decision).toEqual({ outcome: 'below-floor', reviewStatus: null })
  })

  it('holds a critical event even with specialist-verified status — no exceptions to wire-only', () => {
    const isw: SourceEntry = {
      id: 'x',
      sourceId: 'isw',
      sourceCategory: 'analysis',
      org: 'ISW',
      label: 'Non-partisan analysis',
      specialistVerified: true,
      countsTowardCorroboration: true,
      refUrl: 'u',
      timestamp: '2026-09-20T09:00:00Z',
    }
    expect(resolvePublishDecision(event({ severity: 'critical', sources: [isw] })).outcome).toBe('below-floor')
  })

  it('auto-publishes a critical event on three distinct outlets with no wire (the 2026-09-20 amendment, lowered from four on 2026-09-21)', () => {
    const sources = ['guardian', 'bbc', 'npr'].map((id) => outlet(id))
    expect(resolvePublishDecision(event({ severity: 'critical', sources }))).toEqual({ outcome: 'publish', reviewStatus: 'auto-published' })
  })

  it('holds a critical event at two outlets', () => {
    const sources = ['guardian', 'bbc'].map((id) => outlet(id))
    expect(resolvePublishDecision(event({ severity: 'critical', sources })).outcome).toBe('below-floor')
  })

  it('auto-publishes a critical event once wire-confirmed', () => {
    expect(resolvePublishDecision(event({ severity: 'critical', sources: [wire()] }))).toEqual({
      outcome: 'publish',
      reviewStatus: 'auto-published',
    })
  })

  it('auto-publishes a major event on 2+ OSINT sources, holds it on one', () => {
    expect(resolvePublishDecision(event({ severity: 'major', sources: [outlet('guardian'), outlet('bbc')] })).outcome).toBe('publish')
    expect(resolvePublishDecision(event({ severity: 'major', sources: [outlet('guardian')] })).outcome).toBe('below-floor')
  })

  it('lets a wire report clear every lower tier (wire bypass)', () => {
    for (const severity of ['major', 'significant', 'routine'] as const) {
      expect(resolvePublishDecision(event({ severity, sources: [wire()] })).outcome).toBe('publish')
    }
  })

  it('never publishes an unconfirmed event at any tier', () => {
    for (const severity of ['critical', 'major', 'significant', 'routine'] as const) {
      expect(resolvePublishDecision(event({ severity, sources: [outlet('guardian')] })).outcome).toBe('below-floor')
    }
  })

  it('routes a wire-confirmed head-of-state death claim to the manual queue, not auto-publish', () => {
    expect(resolvePublishDecision(event({ severity: 'critical', headOfStateDeathClaim: true, sources: [wire()] }))).toEqual({
      outcome: 'pending-confirmation',
      reviewStatus: 'pending-confirmation',
    })
  })

  it('publishes a head-of-state death claim as manual-only once a human confirms', () => {
    expect(
      resolvePublishDecision(event({ severity: 'critical', headOfStateDeathClaim: true, manuallyConfirmed: true, sources: [wire()] })),
    ).toEqual({ outcome: 'publish', reviewStatus: 'manual-only' })
  })

  it('a head-of-state death claim on three outlets still goes to the manual queue, not auto-publish', () => {
    const sources = ['guardian', 'bbc', 'npr'].map((id) => outlet(id))
    expect(resolvePublishDecision(event({ severity: 'critical', headOfStateDeathClaim: true, sources })).outcome).toBe('pending-confirmation')
  })

  it('a head-of-state death claim is still below-floor without a wire report or three outlets, even if a heuristic tiered it lower', () => {
    expect(
      resolvePublishDecision(event({ severity: 'significant', headOfStateDeathClaim: true, manuallyConfirmed: true, sources: [outlet('guardian'), outlet('bbc')] })).outcome,
    ).toBe('below-floor')
  })

  it('does not let manual confirmation bypass the wire floor for a non-death event (the flag only matters with the claim)', () => {
    expect(resolvePublishDecision(event({ severity: 'critical', manuallyConfirmed: true, sources: [outlet('guardian')] })).outcome).toBe('below-floor')
  })
})

describe('isReaderVisible', () => {
  it('shows auto-published and manual-only; hides pending and retracted', () => {
    expect(isReaderVisible('auto-published')).toBe(true)
    expect(isReaderVisible('manual-only')).toBe(true)
    expect(isReaderVisible('pending-confirmation')).toBe(false)
    expect(isReaderVisible('retracted')).toBe(false)
  })
})

describe('ranking', () => {
  const older = event({ id: 'a', eventTimestamp: '2026-09-20T06:00:00Z' })
  const newer = event({ id: 'b', eventTimestamp: '2026-09-20T09:00:00Z' })

  it('compareByRecency puts the later eventTimestamp first', () => {
    expect([older, newer].sort(compareByRecency).map((e) => e.id)).toEqual(['b', 'a'])
  })

  it('breaks recency ties by id for a deterministic order', () => {
    const x = event({ id: 'x', eventTimestamp: '2026-09-20T09:00:00Z' })
    const y = event({ id: 'y', eventTimestamp: '2026-09-20T09:00:00Z' })
    expect([y, x].sort(compareByRecency).map((e) => e.id)).toEqual(['x', 'y'])
  })

  it('severity outranks recency', () => {
    const oldCritical = event({ id: 'c', severity: 'critical', eventTimestamp: '2026-09-19T00:00:00Z' })
    const newRoutine = event({ id: 'r', severity: 'routine', eventTimestamp: '2026-09-20T10:00:00Z' })
    expect([newRoutine, oldCritical].sort(compareBySeverityThenRecency).map((e) => e.id)).toEqual(['c', 'r'])
  })

  it('World ranks by number of linked countries before severity', () => {
    const broadRoutine = event({ id: 'broad', severity: 'routine', linkedEntityIds: ['1', '2', '3'] })
    const narrowCritical = event({ id: 'narrow', severity: 'critical', linkedEntityIds: ['1'] })
    expect([narrowCritical, broadRoutine].sort(compareWorld).map((e) => e.id)).toEqual(['broad', 'narrow'])
  })

  it('World falls back to severity, then recency, at equal breadth', () => {
    const a = event({ id: 'a', severity: 'major', linkedEntityIds: ['1', '2'] })
    const b = event({ id: 'b', severity: 'critical', linkedEntityIds: ['3', '4'] })
    expect([a, b].sort(compareWorld).map((e) => e.id)).toEqual(['b', 'a'])
  })

  it('splitFeatured takes the top 3 by the given rank and orders the rest by pure recency', () => {
    const events = [
      event({ id: 'crit', severity: 'critical', eventTimestamp: '2026-09-20T01:00:00Z' }),
      event({ id: 'maj', severity: 'major', eventTimestamp: '2026-09-20T02:00:00Z' }),
      event({ id: 'sig', severity: 'significant', eventTimestamp: '2026-09-20T03:00:00Z' }),
      // Below the featured 3: a routine-but-newer item must lead a significant-but-older one (no severity weighting).
      event({ id: 'sigOld', severity: 'significant', eventTimestamp: '2026-09-20T04:00:00Z' }),
      event({ id: 'routNew', severity: 'routine', eventTimestamp: '2026-09-20T08:00:00Z' }),
    ]
    const { featured, rest } = splitFeatured(events, compareBySeverityThenRecency)
    expect(featured.map((e) => e.id)).toEqual(['crit', 'maj', 'sigOld'])
    expect(rest.map((e) => e.id)).toEqual(['routNew', 'sig'])
  })

  it('splitFeatured with fewer than 3 events leaves rest empty', () => {
    const { featured, rest } = splitFeatured([event({ id: 'only' })], compareBySeverityThenRecency)
    expect(featured).toHaveLength(1)
    expect(rest).toEqual([])
  })
})

describe('tabs', () => {
  it('has World plus eight topic tabs, World with no topic tag, no pulse, no ticker', () => {
    expect(NEWS_TABS).toHaveLength(9)
    expect(getNewsTab('world')).toMatchObject({ topicTag: null, communityPulse: false, firstHandTicker: false })
  })

  it('every topic tab maps to a distinct tag, so the eight tags each own exactly one tab', () => {
    const tags = NEWS_TABS.filter((t) => t.id !== 'world').map((t) => t.topicTag)
    expect(new Set(tags).size).toBe(8)
  })
})

describe('filterEvents / buildFeed', () => {
  const conflictOnly = event({ id: 'c', topicTags: ['conflict-security'], linkedEntityIds: ['804'] })
  const both = event({ id: 'both', topicTags: ['conflict-security', 'terrorism-non-state-actors'], linkedEntityIds: ['887', '682'] })
  const energy = event({ id: 'en', topicTags: ['energy'], linkedEntityIds: ['643'], systemicThemes: ['energy-security-crisis'] })
  const pending = event({ id: 'p', topicTags: ['conflict-security'], reviewStatus: 'pending-confirmation' })
  const retracted = event({ id: 'r', topicTags: ['conflict-security'], reviewStatus: 'retracted' })
  const all = [conflictOnly, both, energy, pending, retracted]
  const ids = (events: NewsEvent[]) => events.map((e) => e.id).sort()

  it('drops pending and retracted events from every view', () => {
    expect(ids(filterEvents(all))).toEqual(['both', 'c', 'en'])
  })

  it('multi-tag placement: an event carrying two tags appears in both tabs', () => {
    expect(ids(filterEvents(all, { tab: 'conflict' }))).toEqual(['both', 'c'])
    expect(ids(filterEvents(all, { tab: 'terrorism' }))).toEqual(['both'])
  })

  it('World applies no topic filter', () => {
    expect(ids(filterEvents(all, { tab: 'world' }))).toEqual(['both', 'c', 'en'])
  })

  it('country filter is any-of, so a region preset is just a bundle of ids', () => {
    expect(ids(filterEvents(all, { countryIds: ['887', '643'] }))).toEqual(['both', 'en'])
  })

  it('an empty country list means no country filter', () => {
    expect(ids(filterEvents(all, { countryIds: [] }))).toEqual(['both', 'c', 'en'])
  })

  it('filters compose (tab AND theme)', () => {
    expect(ids(filterEvents(all, { tab: 'energy', themeId: 'energy-security-crisis' }))).toEqual(['en'])
    expect(ids(filterEvents(all, { tab: 'conflict', themeId: 'energy-security-crisis' }))).toEqual([])
  })

  it('buildFeed ranks World by breadth, but a topic tab by severity', () => {
    const broad = event({ id: 'broad', severity: 'routine', topicTags: ['conflict-security'], linkedEntityIds: ['1', '2', '3'] })
    const sharp = event({ id: 'sharp', severity: 'critical', topicTags: ['conflict-security'], linkedEntityIds: ['1'] })
    expect(buildFeed([sharp, broad], { tab: 'world' }).featured.map((e) => e.id)).toEqual(['broad', 'sharp'])
    expect(buildFeed([broad, sharp], { tab: 'conflict' }).featured.map((e) => e.id)).toEqual(['sharp', 'broad'])
  })
})

describe('systemic themes', () => {
  const themes: SystemicThemeConfig[] = [
    { id: 'a', label: 'Active One', status: 'active' },
    { id: 'b', label: 'Retired One', status: 'archived', statusChangedAt: '2026-06-30' },
  ]

  it('offers only active themes as live filter choices', () => {
    expect(activeThemes(themes).map((t) => t.id)).toEqual(['a'])
  })

  it('still resolves an archived theme label for historical events (archival, not deletion)', () => {
    expect(themeLabel(themes, 'b')).toBe('Retired One')
  })

  it('falls back to the raw id for an unknown theme', () => {
    expect(themeLabel(themes, 'nope')).toBe('nope')
  })
})
