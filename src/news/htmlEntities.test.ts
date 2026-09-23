import { describe, expect, it } from 'vitest'
import { decodeHtmlEntities } from './htmlEntities'

describe('decodeHtmlEntities', () => {
  it('decodes the forms real feeds actually send (counted over the archive)', () => {
    // The reported headline, verbatim from WSJ's feed.
    expect(decodeHtmlEntities('What Is Saudi Arabia&#x2019;s East-West Pipeline and Why Is It Rocking Oil Markets?')).toBe(
      'What Is Saudi Arabia’s East-West Pipeline and Why Is It Rocking Oil Markets?',
    )
    expect(decodeHtmlEntities('UK&#039;s Burnham heads to US')).toBe("UK's Burnham heads to US")
    expect(decodeHtmlEntities('Pakistan says strikes killed &#8216;28 terrorists&#8217;')).toBe('Pakistan says strikes killed ‘28 terrorists’')
    expect(decodeHtmlEntities('Trump announces &#34;permanent control&#34;')).toBe('Trump announces "permanent control"')
    expect(decodeHtmlEntities('Caf&#xe9; talks &#x2014; day two')).toBe('Café talks — day two')
    expect(decodeHtmlEntities('Mali &amp; Niger sign &lt;deal&gt;')).toBe('Mali & Niger sign <deal>')
  })

  it('turns a decoded non-breaking space into a real space', () => {
    expect(decodeHtmlEntities('Riyadh&#xa0;airport hit')).toBe('Riyadh airport hit')
    expect(decodeHtmlEntities('Riyadh&nbsp;airport hit')).toBe('Riyadh airport hit')
  })

  it('leaves anything it does not recognize exactly as it found it', () => {
    expect(decodeHtmlEntities('Q3 profits up 5% & rising')).toBe('Q3 profits up 5% & rising')
    expect(decodeHtmlEntities('AT&T raises guidance')).toBe('AT&T raises guidance')
    expect(decodeHtmlEntities('a &#xZZ; b &notareal; c &#0; d')).toBe('a &#xZZ; b &notareal; c &#0; d')
  })

  it('decodes once, so text that deliberately shows an entity survives', () => {
    expect(decodeHtmlEntities('Write &amp;#39; to escape an apostrophe')).toBe("Write &#39; to escape an apostrophe")
  })
})
