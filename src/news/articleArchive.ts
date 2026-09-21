import type { RawArticle } from './eventBuilder'

// Pure logic for the append-only article archive (no fs, no network — scripts/lib/newsArchive.mjs is the I/O shell).
//
// WHY THIS EXISTS: the build is stateless and RSS only ever shows the last few days, so every run's feed window is lost
// the moment it rolls off. The archive keeps every article any run has ever seen, so a rolling feed window, a growing
// labeled set for the classifier, and per-conflict dossiers can all be built later from data that can no longer be
// re-fetched. It is NOT regenerable, which is the opposite of debug/ — see archive/ in .gitignore.

export interface ArchivedArticle extends RawArticle {
  /** ISO 8601 build time of the run that first saw this article. The fallback clock when a feed item has no publishedAt. */
  firstSeenAt: string
}

// The tracking parameters that make one article's URL look like two. Deliberately short: anything else in a query string
// may be what selects the article (`?id=123`), and merging two different articles is worse than keeping one twice.
const TRACKING_PARAM = /^(utm_|fbclid$|gclid$)/i

/** Identity of an article: its URL minus the fragment and tracking parameters. The stored `url` stays as first seen. */
export function archiveKey(url: string): string {
  try {
    const u = new URL(url)
    u.hash = ''
    for (const name of [...u.searchParams.keys()]) if (TRACKING_PARAM.test(name)) u.searchParams.delete(name)
    return u.toString()
  } catch {
    return url
  }
}

/**
 * Reads archive text back into records. Tolerant on purpose: a run killed mid-append leaves a truncated last line, and
 * one bad line must not make the rest of the archive unreadable.
 */
export function parseArchive(text: string): ArchivedArticle[] {
  const out: ArchivedArticle[] = []
  for (const line of text.split('\n')) {
    if (!line.trim()) continue
    try {
      const rec = JSON.parse(line) as ArchivedArticle
      if (typeof rec.url === 'string' && typeof rec.sourceId === 'string' && typeof rec.title === 'string') out.push(rec)
    } catch {
      // truncated or corrupt line — skip it
    }
  }
  return out
}

export interface AppendPlan {
  /** Articles not already in the archive, deduped within `incoming` too (first occurrence wins). */
  added: ArchivedArticle[]
  /** Exactly what to append to the file — empty string when nothing is new. */
  payload: string
}

/**
 * Decides what a run adds to the archive. First sighting wins: an article already archived is never rewritten, so a feed
 * later editing a headline can't change history, and the file only ever grows by appending.
 */
export function planAppend(existingText: string, incoming: RawArticle[], now: string): AppendPlan {
  const seen = new Set(parseArchive(existingText).map((a) => archiveKey(a.url)))
  const added: ArchivedArticle[] = []
  for (const article of incoming) {
    const key = archiveKey(article.url)
    if (seen.has(key)) continue
    seen.add(key)
    added.push({ ...article, firstSeenAt: now })
  }
  if (added.length === 0) return { added, payload: '' }
  // A truncated last line has no newline; appending straight onto it would fuse it with our first new record.
  const lead = existingText.length > 0 && !existingText.endsWith('\n') ? '\n' : ''
  return { added, payload: lead + added.map((a) => JSON.stringify(a)).join('\n') + '\n' }
}
