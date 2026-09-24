import type { SourceProfile, SystemicThemeConfig } from './types'

// Structural invariants for the two editorial config files (design §7, §4b) —
// Phase 5. sourceConfig.test.ts has asserted these since Phase 1, but a test
// only fires when someone runs the suite; the Admin Console writes these files
// directly, so it needs the same rules as a function it can run BEFORE a save
// and refuse on. Pure, so the console's server and its browser UI share one
// answer and the UI can red-flag a field as it's typed.
//
// SCOPE: structure and internal consistency only — never roster CONTENT.
// "Every leaning has a citation" is an invariant; "the Telegraph is Center" is
// an editorial judgment this file has no opinion about, because editing those
// judgments is the console's whole purpose.

const LEANINGS = ['left', 'lean-left', 'center', 'lean-right', 'right']
const LEANING_CONFIDENCES = ['high', 'medium', 'low/initial']
const TIERS = ['wire', 'broadsheet', 'broadcast', 'regional-specialist', 'country-native']
const PRESS_CONTROLS = ['state-controlled', 'state-run-democratic', 'independent', 'exile']
const VETTINGS = ['confirmed', 'provisional']
const CHANNEL_TIERS = ['verification-specialist', 'osint-aggregator', 'regional-curator', 'combatant-affiliated']
/** Telegram's own username rule: 5-32 characters of letters, digits and underscores. */
const CHANNEL_HANDLE = /^[A-Za-z0-9_]{5,32}$/

/** Matches the citation format sourceConfig.test.ts enforces for country-native sources. */
const RSF_CITATION = /^RSF World Press Freedom Index \d{4}: \d+\/180/

export interface ValidationIssue {
  /** The offending source/theme id, or '' for a whole-file problem like a duplicate scan. */
  id: string
  field?: string
  message: string
}

const isBlank = (v: unknown): boolean => typeof v !== 'string' || v.trim() === ''

function duplicateIds(records: { id: string }[]): ValidationIssue[] {
  const seen = new Set<string>()
  const issues: ValidationIssue[] = []
  for (const r of records) {
    if (seen.has(r.id)) issues.push({ id: r.id, field: 'id', message: `duplicate id "${r.id}"` })
    seen.add(r.id)
  }
  return issues
}

/**
 * `countryNames` is the UN-193 topology's own name list plus 'Taiwan' — passed
 * in rather than imported, because this module stays free of the 4 MB topology
 * asset. Omit it to skip that one check (the rest still run).
 */
export function validateSources(sources: SourceProfile[], countryNames?: Set<string>): ValidationIssue[] {
  const issues: ValidationIssue[] = [...duplicateIds(sources)]
  const add = (id: string, field: string, message: string) => issues.push({ id, field, message })
  // Telegram handles are case-insensitive, so two profiles can't share one.
  const channels = new Set<string>()

  for (const s of sources) {
    // Read once: the fixed-label checks below narrow `s` to never on their true branch, taking `s.id` with it.
    const id = s.id
    if (isBlank(s.id)) add(s.id ?? '', 'id', 'id is required')
    if (isBlank(s.name)) add(s.id, 'name', 'name is required')
    if (!VETTINGS.includes(s.vetting)) add(s.id, 'vetting', `vetting must be one of ${VETTINGS.join(', ')}`)

    if (s.sourceType === 'analysis') {
      if (s.label !== 'Non-partisan analysis') add(id, 'label', 'analysis orgs carry the fixed label "Non-partisan analysis"')
      // A leaning on an analysis org isn't a typo, it's a category error (§7):
      // the whole point of the type is that it never carries one.
      if ('leaning' in s) add(id, 'leaning', 'analysis orgs never carry a leaning')
      continue
    }
    if (s.sourceType === 'first-hand') {
      if (s.label !== 'First-hand account') add(id, 'label', 'first-hand accounts carry the fixed label "First-hand account"')
      if ('leaning' in s) add(id, 'leaning', 'first-hand accounts never carry a leaning')
      if (!CHANNEL_HANDLE.test(s.channel ?? '')) add(s.id, 'channel', 'channel must be a Telegram handle without the "@" (5-32 letters, digits or underscores)')
      else if (channels.has(s.channel.toLowerCase())) add(s.id, 'channel', `channel "${s.channel}" is already enrolled under another profile`)
      else channels.add(s.channel.toLowerCase())
      if (!CHANNEL_TIERS.includes(s.channelTier)) add(s.id, 'channelTier', `channelTier must be one of ${CHANNEL_TIERS.join(', ')}`)
      // §15a: tier 1 IS the specialist-verified standing, so the two can't disagree in either direction.
      if (s.channelTier === 'verification-specialist' && !s.specialistVerified) add(s.id, 'specialistVerified', 'a verification-specialist channel is specialist-verified (§15a tier 1)')
      if (s.channelTier !== 'verification-specialist' && s.specialistVerified) add(s.id, 'specialistVerified', 'only a verification-specialist channel can be specialist-verified (§15a tier 1)')
      if (s.channelTier === 'combatant-affiliated' && isBlank(s.affiliationNote)) add(s.id, 'affiliationNote', 'a combatant-affiliated channel needs a specific affiliation note (§15a)')
      if (s.language !== undefined && (!/^[a-z]{2}$/.test(s.language) || s.language === 'en')) add(s.id, 'language', 'language is a two-letter code, and only set when the channel is not English')
      continue
    }
    if (s.sourceType !== 'outlet') {
      add((s as SourceProfile).id, 'sourceType', 'sourceType must be "outlet", "analysis" or "first-hand"')
      continue
    }

    if (s.leaning && !LEANINGS.includes(s.leaning)) add(s.id, 'leaning', `leaning must be one of ${LEANINGS.join(', ')}`)
    if (s.leaning && isBlank(s.leaningSource)) add(s.id, 'leaningSource', 'a leaning needs a citation (AllSides first; Ad Fontes/MBFC only as fallback)')
    if (!s.leaning && (s.leaningSource || s.leaningConfidence || s.contested)) {
      add(s.id, 'leaning', 'leaningSource / leaningConfidence / contested are only meaningful alongside a leaning')
    }
    if (s.leaningConfidence && !LEANING_CONFIDENCES.includes(s.leaningConfidence)) {
      add(s.id, 'leaningConfidence', `leaningConfidence must be one of ${LEANING_CONFIDENCES.join(', ')}`)
    }
    if (s.tier && !TIERS.includes(s.tier)) add(s.id, 'tier', `tier must be one of ${TIERS.join(', ')}`)
    if (s.pressControl && !PRESS_CONTROLS.includes(s.pressControl)) add(s.id, 'pressControl', `pressControl must be one of ${PRESS_CONTROLS.join(', ')}`)
    // AllSides' left/right scale is about US-style partisan spread and simply
    // doesn't apply to a state-controlled or exile outlet — the two labels are
    // alternatives, not complements.
    if (s.pressControl && s.leaning) add(s.id, 'leaning', "a source with pressControl carries no leaning — AllSides' left/right doesn't apply")

    if (s.tier === 'country-native') {
      if (isBlank(s.countryName)) add(s.id, 'countryName', 'country-native sources must name their country')
      else if (countryNames && !countryNames.has(s.countryName!)) add(s.id, 'countryName', `"${s.countryName}" is not a UN-193 topology name (or "Taiwan")`)
      if (!RSF_CITATION.test(s.pressFreedomContext ?? '')) {
        add(s.id, 'pressFreedomContext', 'country-native sources need an RSF citation ("RSF World Press Freedom Index YYYY: N/180 ...")')
      }
    } else {
      if (s.pressControl) add(s.id, 'pressControl', 'pressControl only applies to country-native sources')
      if (s.countryName) add(s.id, 'countryName', 'countryName only applies to country-native sources')
    }
  }
  return issues
}

export function validateThemes(themes: SystemicThemeConfig[]): ValidationIssue[] {
  const issues: ValidationIssue[] = [...duplicateIds(themes)]
  for (const t of themes) {
    if (isBlank(t.id)) issues.push({ id: t.id ?? '', field: 'id', message: 'id is required' })
    if (isBlank(t.label)) issues.push({ id: t.id, field: 'label', message: 'label is required' })
    if (t.status !== 'active' && t.status !== 'archived') issues.push({ id: t.id, field: 'status', message: 'status must be "active" or "archived"' })
    if (t.statusChangedAt !== undefined && Number.isNaN(Date.parse(t.statusChangedAt))) {
      issues.push({ id: t.id, field: 'statusChangedAt', message: 'statusChangedAt must be an ISO 8601 date' })
    }
  }
  return issues
}

export interface LeaningTally {
  left: number
  center: number
  right: number
}

/**
 * §7's left/center/right spread over rated general outlets — the number
 * sourceConfig.test.ts hard-asserts (9/10/3 as shipped). Recomputed and shown
 * in the console because editing a leaning is exactly what this tool is for,
 * and that test is the tripwire it would otherwise silently trip.
 */
export function leaningTally(sources: SourceProfile[]): LeaningTally {
  const rated = sources.filter((s) => s.sourceType === 'outlet' && s.leaning && s.tier !== 'country-native')
  const count = (...of: string[]) => rated.filter((s) => s.sourceType === 'outlet' && of.includes(s.leaning!)).length
  return { left: count('left', 'lean-left'), center: count('center'), right: count('lean-right', 'right') }
}
