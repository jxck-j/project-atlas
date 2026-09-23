import { describe, expect, it } from 'vitest'
import { findConfirmation, recordDecision, resolveReviewState, type ConfirmationRecord } from './confirmations'
import { leaningTally, validateSources, validateThemes } from './configValidation'
import { serializeSources, serializeThemes } from './configSerialize'
import { SOURCES, SYSTEMIC_THEMES } from './sourceConfig'
import type { NewsEvent, OutletProfile, SourceEntry, SourceProfile } from './types'

// Phase 5 (Admin Console) — the pure half. The console's server and UI are the
// only untested parts by design; everything that decides whether a write is
// legal, how a file is written, and whether a confirmation survives a rebuild
// lives here.

const outlet = (over: Partial<OutletProfile> = {}): OutletProfile => ({
  id: 'x',
  name: 'X',
  sourceType: 'outlet',
  vetting: 'confirmed',
  ...over,
})

const messagesFor = (issues: { id: string; field?: string }[], field: string) => issues.filter((i) => i.field === field)

describe('validateSources', () => {
  it('passes the shipped roster', () => {
    expect(validateSources(SOURCES)).toEqual([])
  })

  it('rejects a leaning with no citation, and rating metadata with no leaning', () => {
    expect(messagesFor(validateSources([outlet({ leaning: 'center' })]), 'leaningSource')).toHaveLength(1)
    expect(messagesFor(validateSources([outlet({ contested: true })]), 'leaning')).toHaveLength(1)
  })

  it("rejects pressControl alongside a leaning — AllSides' scale doesn't apply to a state-controlled outlet", () => {
    const s = outlet({ tier: 'country-native', countryName: 'Iran', pressControl: 'state-controlled', leaning: 'center', leaningSource: 'AllSides', pressFreedomContext: 'RSF World Press Freedom Index 2026: 177/180.' })
    expect(messagesFor(validateSources([s]), 'leaning')).toHaveLength(1)
  })

  it('requires a country-native source to name a real country and cite RSF', () => {
    const missing = validateSources([outlet({ tier: 'country-native' })])
    expect(messagesFor(missing, 'countryName')).toHaveLength(1)
    expect(messagesFor(missing, 'pressFreedomContext')).toHaveLength(1)

    const unknown = validateSources([outlet({ tier: 'country-native', countryName: 'Atlantis', pressFreedomContext: 'RSF World Press Freedom Index 2026: 1/180.' })], new Set(['Iran', 'Taiwan']))
    expect(messagesFor(unknown, 'countryName')).toHaveLength(1)
  })

  it('keeps pressControl and countryName off non-country-native sources', () => {
    const issues = validateSources([outlet({ tier: 'broadsheet', pressControl: 'independent', countryName: 'Iran' })])
    expect(messagesFor(issues, 'pressControl')).toHaveLength(1)
    expect(messagesFor(issues, 'countryName')).toHaveLength(1)
  })

  it('refuses a leaning on an analysis org, and a wrong fixed label', () => {
    const bad = { id: 'a', name: 'A', sourceType: 'analysis', label: 'Balanced', vetting: 'confirmed', leaning: 'center' } as unknown as SourceProfile
    const issues = validateSources([bad])
    expect(messagesFor(issues, 'label')).toHaveLength(1)
    expect(messagesFor(issues, 'leaning')).toHaveLength(1)
  })

  it('catches duplicate ids', () => {
    expect(messagesFor(validateSources([outlet({ id: 'dup' }), outlet({ id: 'dup' })]), 'id')).toHaveLength(1)
  })

  it("reports the tally sourceConfig.test.ts asserts, so an edit that moves it is visible in the console", () => {
    expect(leaningTally(SOURCES)).toEqual({ left: 9, center: 10, right: 3 })
  })
})

describe('validateThemes', () => {
  it('passes the shipped themes and rejects a bad status or duplicate id', () => {
    expect(validateThemes(SYSTEMIC_THEMES)).toEqual([])
    expect(validateThemes([{ id: 't', label: 'T', status: 'retired' as 'active' }])).toHaveLength(1)
    expect(validateThemes([{ id: 't', label: 'T', status: 'active' }, { id: 't', label: 'T2', status: 'active' }])).toHaveLength(1)
  })
})

describe('config serialization', () => {
  it('writes one record per line — a one-field edit must stay a one-line diff', () => {
    const lines = serializeSources(SOURCES).trim().split('\n')
    expect(lines).toHaveLength(SOURCES.length + 2) // '[' + one per source + ']'
    expect(serializeThemes(SYSTEMIC_THEMES).trim().split('\n')).toHaveLength(SYSTEMIC_THEMES.length + 2)
  })

  it('round-trips the shipped files unchanged in content and stably in bytes', () => {
    const once = serializeSources(SOURCES)
    expect(JSON.parse(once)).toEqual(JSON.parse(JSON.stringify(SOURCES)))
    expect(serializeSources(JSON.parse(once))).toBe(once)

    const themesOnce = serializeThemes(SYSTEMIC_THEMES)
    expect(JSON.parse(themesOnce)).toEqual(JSON.parse(JSON.stringify(SYSTEMIC_THEMES)))
    expect(serializeThemes(JSON.parse(themesOnce))).toBe(themesOnce)
  })

  it('drops a field a form blanked rather than writing an empty string', () => {
    const written = JSON.parse(serializeSources([outlet({ id: 'a', notes: '', caveat: undefined })]))
    expect(written[0]).not.toHaveProperty('notes')
    expect(written[0]).not.toHaveProperty('caveat')
  })
})

// ---------------------------------------------------------------------------

const entry = (url: string): SourceEntry => ({
  id: url,
  sourceId: 'reuters',
  sourceCategory: 'outlet',
  outlet: 'Reuters',
  countsTowardCorroboration: true,
  refUrl: url,
  timestamp: '2026-09-23T00:00:00.000Z',
})

const event = (id: string, urls: string[]): Pick<NewsEvent, 'id' | 'title' | 'sources'> => ({
  id,
  title: 'Reports of a head of state killed',
  sources: urls.map(entry),
})

describe('confirmations', () => {
  it('re-attaches a decision after the Event id changes, via a shared article URL', () => {
    // The real case this exists for: an EARLIER report arrives on a later run,
    // so the cluster re-keys off a different first article and the id moves.
    const records = recordDecision([], event('evt-1', ['https://a', 'https://b']), 'confirmed', '2026-09-23T10:00:00.000Z')
    expect(resolveReviewState(records, event('evt-999', ['https://z', 'https://b']))).toBe('confirmed')
  })

  it('leaves an unrelated Event undecided', () => {
    const records = recordDecision([], event('evt-1', ['https://a']), 'confirmed', '2026-09-23T10:00:00.000Z')
    expect(resolveReviewState(records, event('evt-2', ['https://q']))).toBe('undecided')
  })

  it('replaces every record the Event matches, so a re-decision leaves nothing stale behind', () => {
    let records = recordDecision([], event('evt-1', ['https://a']), 'rejected', '2026-09-23T10:00:00.000Z')
    records = recordDecision(records, event('evt-2', ['https://b']), 'rejected', '2026-09-23T11:00:00.000Z')
    // A later run merges both clusters into one Event and a human confirms it.
    records = recordDecision(records, event('evt-3', ['https://a', 'https://b']), 'confirmed', '2026-09-23T12:00:00.000Z')
    expect(records).toHaveLength(1)
    expect(resolveReviewState(records, event('evt-3', ['https://a']))).toBe('confirmed')
  })

  it('takes the most recent decision when two records overlap', () => {
    const older: ConfirmationRecord = { eventId: 'evt-1', decision: 'rejected', title: 't', articleUrls: ['https://a'], decidedAt: '2026-09-22T00:00:00.000Z' }
    const newer: ConfirmationRecord = { eventId: 'evt-2', decision: 'confirmed', title: 't', articleUrls: ['https://a'], decidedAt: '2026-09-23T00:00:00.000Z' }
    expect(findConfirmation([older, newer], event('evt-1', ['https://a']))?.decision).toBe('confirmed')
    expect(findConfirmation([newer, older], event('evt-1', ['https://a']))?.decision).toBe('confirmed')
  })

  it('stores a note and the title, so the file reads as a review trail', () => {
    const [record] = recordDecision([], event('evt-1', ['https://a']), 'confirmed', '2026-09-23T10:00:00.000Z', 'Confirmed by AFP + state broadcaster.')
    expect(record).toMatchObject({ title: 'Reports of a head of state killed', note: 'Confirmed by AFP + state broadcaster.', decision: 'confirmed' })
  })
})
