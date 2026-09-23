import { describe, expect, it } from 'vitest'
import { archiveKey, parseArchive, planAppend } from './articleArchive'
import { applyPullMetadata, selectFeedWindow } from './feedWindow'
import type { RawArticle } from './eventBuilder'

const NOW = '2026-09-21T12:00:00.000Z'
const art = (url: string, extra: Partial<RawArticle> = {}): RawArticle => ({ sourceId: 'bbc', title: 'T ' + url, url, ...extra })

describe('archiveKey', () => {
  it('ignores the fragment and tracking parameters', () => {
    expect(archiveKey('https://x.com/a/b?utm_source=rss&utm_medium=feed#top')).toBe('https://x.com/a/b')
    expect(archiveKey('https://x.com/a/b?fbclid=abc')).toBe('https://x.com/a/b')
    expect(archiveKey('https://x.com/a/b?gclid=abc&id=7')).toBe('https://x.com/a/b?id=7')
  })
  it('keeps a query parameter that selects the article', () => {
    expect(archiveKey('https://x.com/story?id=1')).not.toBe(archiveKey('https://x.com/story?id=2'))
  })
  it('falls back to the raw string for a non-URL', () => {
    expect(archiveKey('not a url')).toBe('not a url')
  })
})

describe('planAppend', () => {
  it('archives everything on an empty archive and stamps firstSeenAt', () => {
    const { added, payload } = planAppend('', [art('https://x.com/1'), art('https://x.com/2')], NOW)
    expect(added).toHaveLength(2)
    expect(added.every((a) => a.firstSeenAt === NOW)).toBe(true)
    expect(payload.split('\n').filter(Boolean)).toHaveLength(2)
    expect(payload.endsWith('\n')).toBe(true)
  })

  it('adds only what is new, and never rewrites an archived article', () => {
    const first = planAppend('', [art('https://x.com/1', { title: 'original' })], '2026-09-20T00:00:00.000Z')
    const second = planAppend(first.payload, [art('https://x.com/1', { title: 'edited headline' }), art('https://x.com/2')], NOW)
    expect(second.added.map((a) => a.url)).toEqual(['https://x.com/2'])
    expect(parseArchive(first.payload + second.payload).find((a) => a.url === 'https://x.com/1')?.title).toBe('original')
  })

  it('treats a tracking-parameter variant as the same article', () => {
    const first = planAppend('', [art('https://x.com/1')], NOW)
    expect(planAppend(first.payload, [art('https://x.com/1?utm_source=rss')], NOW).added).toEqual([])
  })

  it('dedupes within one run, first occurrence winning (same URL through two feeds)', () => {
    const { added } = planAppend('', [art('https://x.com/1', { sourceId: 'bloomberg-markets' }), art('https://x.com/1', { sourceId: 'bloomberg-politics' })], NOW)
    expect(added).toHaveLength(1)
    expect(added[0].sourceId).toBe('bloomberg-markets')
  })

  it('writes nothing when nothing is new', () => {
    const first = planAppend('', [art('https://x.com/1')], NOW)
    expect(planAppend(first.payload, [art('https://x.com/1')], NOW)).toEqual({ added: [], payload: '' })
  })

  it('does not fuse a new record onto a truncated last line', () => {
    const good = planAppend('', [art('https://x.com/1')], NOW).payload
    const crashed = good + '{"sourceId":"bbc","title":"cut off mid-wri'
    const { payload } = planAppend(crashed, [art('https://x.com/2')], NOW)
    const recovered = parseArchive(crashed + payload)
    expect(recovered.map((a) => a.url)).toEqual(['https://x.com/1', 'https://x.com/2'])
  })
})

describe('parseArchive', () => {
  it('skips blank, corrupt and structurally wrong lines without losing the rest', () => {
    const text = [JSON.stringify({ ...art('https://x.com/1'), firstSeenAt: NOW }), '', 'garbage', '{"nope":1}', JSON.stringify({ ...art('https://x.com/2'), firstSeenAt: NOW })].join('\n')
    expect(parseArchive(text).map((a) => a.url)).toEqual(['https://x.com/1', 'https://x.com/2'])
  })
})

describe('selectFeedWindow', () => {
  const NOW_W = '2026-09-23T12:00:00.000Z'
  const rec = (url: string, publishedAt?: string, firstSeenAt = NOW_W) => ({ ...art(url), ...(publishedAt ? { publishedAt } : {}), firstSeenAt })

  it('keeps only the retention window and returns it oldest-first', () => {
    const window = selectFeedWindow(
      [
        rec('https://x.com/old', '2026-08-01T00:00:00.000Z'),
        rec('https://x.com/new', '2026-09-23T06:00:00.000Z'),
        rec('https://x.com/mid', '2026-09-15T00:00:00.000Z'),
        // A feed that carries a year-old item (several real ones do) must not drag the window open.
        rec('https://x.com/ancient', '2025-12-22T00:00:00.000Z'),
      ],
      NOW_W,
    )
    expect(window.map((a) => a.url)).toEqual(['https://x.com/mid', 'https://x.com/new'])
  })

  it('dates a feed item with no pubDate by first sighting, not build time', () => {
    const [article] = selectFeedWindow([rec('https://x.com/1', undefined, '2026-09-20T09:00:00.000Z')], NOW_W)
    expect(article.publishedAt).toBe('2026-09-20T09:00:00.000Z')
    expect('firstSeenAt' in article).toBe(false)
  })

  it('keeps an article dated slightly in the future (feed clock skew)', () => {
    expect(selectFeedWindow([rec('https://x.com/1', '2026-09-23T18:00:00.000Z')], NOW_W)).toHaveLength(1)
  })
})

describe('applyPullMetadata', () => {
  const NOW_P = '2026-09-23T12:00:00.000Z'
  it('fills an image the archived copy predates, matching on the archive key', () => {
    const stored = [art('https://x.com/1'), art('https://x.com/2')]
    const pulled = [art('https://x.com/1?utm_source=rss', { imageUrl: 'https://img/1.jpg' })]
    expect(applyPullMetadata(stored, pulled).map((a) => a.imageUrl)).toEqual(['https://img/1.jpg', undefined])
    expect(NOW_P).toBeTruthy()
  })
  it('never overwrites what was first seen', () => {
    const stored = [art('https://x.com/1', { imageUrl: 'https://img/original.jpg' })]
    const pulled = [art('https://x.com/1', { imageUrl: 'https://img/changed.jpg' })]
    expect(applyPullMetadata(stored, pulled)[0].imageUrl).toBe('https://img/original.jpg')
  })
})
