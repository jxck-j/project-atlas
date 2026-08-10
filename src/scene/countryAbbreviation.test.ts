import { describe, expect, it } from 'vitest'
import { abbreviateCountryName } from './countryAbbreviation'

describe('abbreviateCountryName', () => {
  it('takes initials of a two-word name', () => {
    expect(abbreviateCountryName('United Kingdom')).toBe('UK')
  })

  it('drops stop words before taking initials', () => {
    expect(abbreviateCountryName('United States of America')).toBe('USA')
    expect(abbreviateCountryName('Democratic Republic of the Congo')).toBe('DRC')
  })

  it('splits on hyphens as well as spaces', () => {
    expect(abbreviateCountryName('Guinea-Bissau')).toBe('GB')
    expect(abbreviateCountryName('Timor-Leste')).toBe('TL')
  })

  it('caps initials at 5 characters for names with many significant words', () => {
    expect(abbreviateCountryName('Saint Vincent and the Grenadines').length).toBeLessThanOrEqual(5)
  })

  it('falls back to the first 3 letters for a single-word name', () => {
    expect(abbreviateCountryName('Ukraine')).toBe('UKR')
    expect(abbreviateCountryName('Luxembourg')).toBe('LUX')
  })

  it('always returns an uppercase string', () => {
    expect(abbreviateCountryName('france')).toBe(abbreviateCountryName('france').toUpperCase())
  })
})
