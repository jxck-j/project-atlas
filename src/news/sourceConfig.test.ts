import { feature } from 'topojson-client'
import { describe, expect, it } from 'vitest'
import topologyRaw from '../../public/geo/countries-un193.json?raw'
import { getSourceProfile, SOURCES, SYSTEMIC_THEMES } from './sourceConfig'
import type { OutletProfile } from './types'

// The config files are edited by hand (and, later, by the Admin Console), so
// this is the guard that keeps a typo from reaching the build. It validates
// invariants from news-sourcing-design.md §7, not the roster's exact contents.

const outlets = SOURCES.filter((s): s is OutletProfile => s.sourceType === 'outlet')

// Same asset the build script resolves country names against. 'Taiwan' is a
// GeoEntity, not a UN-193 member, so it's the one allowed non-topology name.
const topology = JSON.parse(topologyRaw)
const topologyNames = new Set<string>(
  (feature(topology, topology.objects[Object.keys(topology.objects)[0]]) as unknown as { features: { properties: { name: string } }[] }).features.map(
    (f) => f.properties.name,
  ),
)

describe('sources.json', () => {
  it('has unique ids', () => {
    const ids = SOURCES.map((s) => s.id)
    expect(new Set(ids).size).toBe(ids.length)
  })

  it('every leaning carries a citation, and no confidence/contested flag appears without a leaning', () => {
    for (const s of outlets) {
      if (s.leaning) expect(s.leaningSource, `${s.id} leaning without leaningSource`).toBeTruthy()
      if (s.leaningSource || s.leaningConfidence || s.contested) expect(s.leaning, `${s.id} rating metadata without leaning`).toBeDefined()
    }
  })

  it("a press-controlled country-native source has no leaning — AllSides' left/right doesn't apply", () => {
    for (const s of outlets.filter((o) => o.pressControl)) {
      expect(s.leaning, `${s.id} has both pressControl and leaning`).toBeUndefined()
    }
  })

  it('every country-native source names a country that resolves against the UN-193 topology (or Taiwan)', () => {
    for (const s of outlets.filter((o) => o.tier === 'country-native')) {
      expect(s.countryName, `${s.id} is country-native without countryName`).toBeTruthy()
      expect(topologyNames.has(s.countryName!) || s.countryName === 'Taiwan', `${s.id}: "${s.countryName}" not in topology`).toBe(true)
    }
  })

  it('pressControl and countryName only appear on country-native sources', () => {
    for (const s of outlets.filter((o) => o.tier !== 'country-native')) {
      expect(s.pressControl, `${s.id} has pressControl but is not country-native`).toBeUndefined()
      expect(s.countryName, `${s.id} has countryName but is not country-native`).toBeUndefined()
    }
  })

  it('wire tier is exactly Reuters, AP, and AFP — Bloomberg is financial/macro, not wire, in the v2 design', () => {
    expect(outlets.filter((o) => o.tier === 'wire').map((o) => o.id).sort()).toEqual(['afp', 'ap', 'reuters'])
  })

  it('analysis orgs carry the fixed label and no leaning fields', () => {
    for (const s of SOURCES.filter((x) => x.sourceType === 'analysis')) {
      expect(s).toMatchObject({ label: 'Non-partisan analysis' })
      expect(s).not.toHaveProperty('leaning')
    }
  })

  it('flags exactly ISW, Bellingcat, and ACLED as specialist-verified', () => {
    const specialists = SOURCES.filter((s) => s.sourceType === 'analysis' && s.specialistVerified).map((s) => s.id)
    expect(specialists.sort()).toEqual(['acled', 'bellingcat', 'isw'])
  })

  it('keeps the doc-mandated disambiguations: two Daily Stars, two DAWNs, two SABAs', () => {
    expect(getSourceProfile('daily-star-bangladesh')?.name).toContain('(Bangladesh)')
    expect(getSourceProfile('daily-star-lebanon')?.name).toContain('(Lebanon)')
    expect(getSourceProfile('dawn-pakistan')?.name).not.toBe(getSourceProfile('dawn-arab-world-now')?.name)
    expect(outlets.find((o) => o.id === 'saba-houthi')?.affiliationNote).toBeTruthy()
    expect(outlets.find((o) => o.id === 'saba-recognized-government')?.affiliationNote).toBeTruthy()
  })

  it('every country-native source carries an RSF press-freedom citation, so pressControl meets the same defensibility bar as leaning', () => {
    for (const s of outlets.filter((o) => o.tier === 'country-native')) {
      expect(s.pressFreedomContext, `${s.id} has no pressFreedomContext`).toMatch(/^RSF World Press Freedom Index 2026: \d+\/180/)
    }
  })

  it("Libya's split agency is two distinct state-controlled entries, one per authority", () => {
    const tripoli = outlets.find((o) => o.id === 'lana-tripoli')
    const benghazi = outlets.find((o) => o.id === 'lana-benghazi')
    expect(tripoli?.pressControl).toBe('state-controlled')
    expect(benghazi?.pressControl).toBe('state-controlled')
    expect(tripoli?.affiliationNote).not.toBe(benghazi?.affiliationNote)
  })

  it('Interfax is deliberately not labeled state-controlled (privately owned)', () => {
    expect(outlets.find((o) => o.id === 'interfax')?.pressControl).toBeUndefined()
  })

  it('excludes the outlets the design explicitly removed or refused to guess at', () => {
    const ids = SOURCES.map((s) => s.id)
    for (const removed of ['new-york-post', 'middle-east-eye', 'military-news', 'fox-news']) expect(ids).not.toContain(removed)
  })

  it('reproduces the design doc\'s left/center/right tally of 9/10/3 over rated general-spread outlets', () => {
    // §7's tally excludes Middle East Eye and counts only outlets with an actual AllSides determination.
    const general = outlets.filter((o) => o.leaning && o.tier !== 'country-native')
    const left = general.filter((o) => o.leaning === 'left' || o.leaning === 'lean-left').length
    const center = general.filter((o) => o.leaning === 'center').length
    const right = general.filter((o) => o.leaning === 'lean-right' || o.leaning === 'right').length
    expect({ left, center, right }).toEqual({ left: 9, center: 10, right: 3 })
  })
})

describe('systemicThemes.json', () => {
  it('has unique ids and a valid status on every theme', () => {
    expect(new Set(SYSTEMIC_THEMES.map((t) => t.id)).size).toBe(SYSTEMIC_THEMES.length)
    for (const t of SYSTEMIC_THEMES) expect(['active', 'archived']).toContain(t.status)
  })

  it("starts with the design doc's ten themes, all active", () => {
    expect(SYSTEMIC_THEMES).toHaveLength(10)
    expect(SYSTEMIC_THEMES.every((t) => t.status === 'active')).toBe(true)
  })
})
