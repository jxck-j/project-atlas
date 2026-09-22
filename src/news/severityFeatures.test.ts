import { describe, expect, it } from 'vitest'
import { SEVERITY_FEATURE_NAMES, severityFeatureVector } from './severityFeatures'

const idx = (name: string) => {
  const i = SEVERITY_FEATURE_NAMES.indexOf(name)
  if (i === -1) throw new Error(`no such feature: ${name}`)
  return i
}

describe('severityFeatureVector', () => {
  it('matches SEVERITY_FEATURE_NAMES in length', () => {
    expect(severityFeatureVector('The weather was pleasant across the region today').length).toBe(SEVERITY_FEATURE_NAMES.length)
  })

  it('is all-zero for text with no signal', () => {
    expect(severityFeatureVector('The weather was pleasant across the region today')).toEqual(new Array(SEVERITY_FEATURE_NAMES.length).fill(0))
  })

  it('log-scales a death count instead of passing it raw', () => {
    const v = severityFeatureVector('Airstrike kills 999 people in Sudan, army says')
    expect(v[idx('log_deaths')]).toBeCloseTo(Math.log1p(999), 5)
    expect(v[idx('tag_conflict-security')]).toBe(1)
  })

  it('sets the embassy-attack and terrorism tag flags for an embassy strike', () => {
    const v = severityFeatureVector('Militants storm embassy in capital, several wounded')
    expect(v[idx('embassyAttack')]).toBe(1)
    expect(v[idx('tag_terrorism-non-state-actors')]).toBe(1)
  })

  it('sets headOfStateDeathClaim but not for a legal follow-up over a past killing', () => {
    const fresh = severityFeatureVector('President assassinated in Niger, state TV says')
    expect(fresh[idx('headOfStateDeathClaim')]).toBe(1)
    const followUp = severityFeatureVector('18 suspects extradited over the 2021 killing of Haiti president')
    expect(followUp[idx('headOfStateDeathClaim')]).toBe(0)
  })

  it('flags an unconfirmed self-claimed strike toll separately from a confirmed one', () => {
    const claimed = severityFeatureVector('Russia says strikes killed 40 Ukrainian soldiers')
    expect(claimed[idx('unconfirmedSelfClaim')]).toBe(1)
  })
})
