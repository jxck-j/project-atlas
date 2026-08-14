import { describe, expect, it } from 'vitest'
import { formatGdp, formatPopulation } from './formatScale'

// Hand-verified cases, not snapshots — every expected value is derived by
// hand from the raw input (divide by 1e6, apply 3 significant figures, pick
// the tier) rather than "whatever the function currently returns."

describe('formatPopulation', () => {
  it('passes undefined through unchanged (no sourced figure)', () => {
    expect(formatPopulation(undefined)).toBeUndefined()
  })

  it('stays in Million for a mid-size country', () => {
    // 335,489,204 / 1e6 = 335.489204 -> 3 sig figs -> 335
    expect(formatPopulation(335_489_204)).toBe('335 Million')
  })

  it('drops to Thousand for a sub-1-Million population instead of an awkward decimal', () => {
    // San Marino-scale: 33,660 / 1000 = 33.66 -> 3 sig figs -> 33.7
    expect(formatPopulation(33_660)).toBe('33.7 Thousand')
  })

  it('stays in Thousand just below the Million threshold', () => {
    expect(formatPopulation(999_000)).toBe('999 Thousand')
  })

  it('promotes to Million at exactly 1000 Thousand (the stated threshold)', () => {
    expect(formatPopulation(1_000_000)).toBe('1 Million')
  })

  it('formats a real Thousand-scale population to 3 sig figs', () => {
    // Tuvalu-scale: 11,204 / 1000 = 11.204 -> 3 sig figs -> 11.2
    expect(formatPopulation(11_204)).toBe('11.2 Thousand')
  })

  it('promotes to Billion at exactly 1000 Million (the stated threshold)', () => {
    expect(formatPopulation(1_000_000_000)).toBe('1 Billion')
  })

  it('stays in Million just below the Billion threshold', () => {
    expect(formatPopulation(999_000_000)).toBe('999 Million')
  })

  it('formats a real Billion-scale population to 3 sig figs', () => {
    // China-scale: 1,410,000,000 / 1e6 = 1410 -> /1000 = 1.41
    expect(formatPopulation(1_410_000_000)).toBe('1.41 Billion')
  })
})

describe('formatGdp', () => {
  it('passes undefined through unchanged (no sourced figure — e.g. a genuine World Bank gap)', () => {
    expect(formatGdp(undefined)).toBeUndefined()
  })

  it('renders a small economy in Million rather than a sub-1 Billion decimal', () => {
    // Tuvalu-scale: 65,000,000 / 1e6 = 65
    expect(formatGdp(65_000_000)).toBe('$65 Million')
  })

  it('promotes to Billion at exactly 1000 Million', () => {
    expect(formatGdp(1_000_000_000)).toBe('$1 Billion')
  })

  it('formats a mid-size economy in Billion to 3 sig figs', () => {
    // 17,798,888,000 / 1e6 = 17798.888 -> /1000 = 17.798888 -> 17.8
    expect(formatGdp(17_798_888_000)).toBe('$17.8 Billion')
  })

  it('promotes to Trillion at exactly 1,000,000 Million', () => {
    expect(formatGdp(1_000_000_000_000)).toBe('$1 Trillion')
  })

  it('stays in Billion just below the Trillion threshold', () => {
    expect(formatGdp(999_000_000_000)).toBe('$999 Billion')
  })

  it('formats a real Trillion-scale GDP to 3 sig figs', () => {
    // US-scale: 29,298,013,000,000 / 1e6 = 29298013 -> /1e6 = 29.298013 -> 29.3
    expect(formatGdp(29_298_013_000_000)).toBe('$29.3 Trillion')
  })
})
