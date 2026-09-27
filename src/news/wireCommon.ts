// Helpers shared by every wire-service channel (Google News RSS, Bluesky, news sitemaps) and by the build's same-source merge. Pure.
// See wireSources.ts for what a channel is and why the wire services are fetched through swappable adapters at all.
import { archiveKey } from './articleArchive'
import type { RawArticle } from './eventBuilder'

// Title shapes, seen in live Reuters/AP results, that are not reports. isCommentaryUrl (eventBuilder.ts) does the equivalent job for
// every other feed by reading the URL path — but a Google redirect link has no path to read, and a social-post card is only as good as
// its title, so the title is checked here too. Add an entry only after seeing a real headline (same discipline as the translation
// glossaries).
const NOT_A_REPORT_TITLE = /^(explainer:|photos? of\b)/i

export const MIN_TITLE_WORDS = 3 // "White House - afp.com" came back as an item: a topic stub, not a headline

export const isNonReportTitle = (title: string): boolean => NOT_A_REPORT_TITLE.test(title)
export const hasEnoughWords = (title: string): boolean => title.split(/\s+/).filter(Boolean).length >= MIN_TITLE_WORDS

/**
 * Publishers' own metadata carries zero-width/word-joiner characters (Reuters' card descriptions do: "Despite ⁠Trump's"), which would
 * survive into a headline and break exact matching. Removed, never replaced with a space.
 */
export const stripInvisible = (s: string): string => s.replace(/[​-‍⁠﻿]/g, '').replace(/\s+/g, ' ').trim()

/** Two headlines that differ only in case/punctuation/spacing are the same story: feeds repeat items verbatim. */
export const titleKey = (title: string): string => title.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim()

export const hostOf = (url: string | undefined): string | undefined => {
  if (!url) return undefined
  try {
    return new URL(url).hostname.toLowerCase().replace(/^www\./, '')
  } catch {
    return undefined
  }
}

export const isGoogleNewsUrl = (url: string): boolean => hostOf(url) === 'news.google.com'

// Added by a publisher's social-sharing tool when a link goes out on Bluesky (`?link_source=ta_bluesky_link&taid=…&utm_…`). Removing
// them makes the same article one URL whether it came from a post, a sitemap or a later run. `archiveKey` strips only utm_/fbclid/gclid
// on purpose (anything else may be what selects the article), so the two extra names live here, where the source of them is known.
const TRACKING_PARAM = /^(utm_|fbclid$|gclid$|link_source$|taid$)/i

/** The article's URL without tracking parameters or fragment. A Google redirect link is returned unchanged (its query is part of the link). */
export function cleanArticleUrl(url: string): string {
  if (isGoogleNewsUrl(url)) return url
  try {
    const u = new URL(url)
    u.hash = ''
    for (const name of [...u.searchParams.keys()]) if (TRACKING_PARAM.test(name)) u.searchParams.delete(name)
    return u.toString()
  } catch {
    return url
  }
}

function enrich(target: RawArticle, extra: RawArticle): void {
  // The real article link beats Google's opaque redirect.
  if (isGoogleNewsUrl(target.url) && !isGoogleNewsUrl(extra.url)) target.url = extra.url
  if (!target.description && extra.description) target.description = extra.description
  if (!target.imageUrl && extra.imageUrl) target.imageUrl = extra.imageUrl
  // Earliest report wins: a social post about an article is always later than the article.
  if (extra.publishedAt && (!target.publishedAt || Date.parse(extra.publishedAt) < Date.parse(target.publishedAt))) target.publishedAt = extra.publishedAt
}

// AP re-titles stories, and Google indexes a different revision than the sitemap/Bluesky hold ("Lula bans online betting" vs "Lula bans
// fixed-odds betting"), so the exact-headline match misses them and the publisher would be listed twice in an Event. 21 of 114
// Google-only AP items in the first live pull had such a counterpart. This only ever folds a GOOGLE-link record into a real-URL record
// of the same source that is close in time and similar in wording — never real into real, never across sources — so the worst a
// wrong fold does is drop a second headline from a source that is already counted once (corroboration counts distinct sources).
// 0.6 was read off examples (0.64, 0.64, 0.78, 0.86, 1.00 were all true pairs); it has NOT been calibrated against false positives.
export const NEAR_DUPLICATE_OVERLAP = 0.6
const NEAR_DUPLICATE_WINDOW_MS = 48 * 3_600_000
const DAY_MS = 86_400_000

const wordSet = (title: string): Set<string> => new Set(titleKey(title).split(' ').filter((w) => w.length > 3))

function overlap(a: Set<string>, b: Set<string>): number {
  let shared = 0
  for (const w of a) if (b.has(w)) shared++
  return shared / (a.size + b.size - shared || 1)
}

/** Drops each unmatched Google-link record that has a near-duplicate real-URL record, letting the real one take its earlier time. */
function foldGoogleNearDuplicates(records: RawArticle[]): RawArticle[] {
  const time = (a: RawArticle) => (a.publishedAt ? Date.parse(a.publishedAt) : Number.NaN)
  // Real-URL records bucketed by source and day, so each Google record only meets candidates within a couple of days.
  const buckets = new Map<string, { record: RawArticle; words: Set<string> }[]>()
  for (const r of records) {
    if (isGoogleNewsUrl(r.url) || Number.isNaN(time(r))) continue
    const key = `${r.sourceId}|${Math.floor(time(r) / DAY_MS)}`
    buckets.set(key, [...(buckets.get(key) ?? []), { record: r, words: wordSet(r.title) }])
  }
  return records.filter((g) => {
    if (!isGoogleNewsUrl(g.url) || Number.isNaN(time(g))) return true
    const day = Math.floor(time(g) / DAY_MS)
    const words = wordSet(g.title)
    for (let d = day - 2; d <= day + 2; d++) {
      for (const c of buckets.get(`${g.sourceId}|${d}`) ?? []) {
        if (Math.abs(time(c.record) - time(g)) <= NEAR_DUPLICATE_WINDOW_MS && overlap(words, c.words) >= NEAR_DUPLICATE_OVERLAP) {
          enrich(c.record, g)
          return false
        }
      }
    }
    return true
  })
}

/**
 * Collapses one publisher's articles from several channels into one record per story. Two articles are the same story when they share
 * a source and EITHER a cleaned URL (a sitemap and a Bluesky post both give AP's real URL) OR a normalized headline (Google gives
 * Reuters an opaque link, Bluesky the real one — only the headline matches). The first keeps its fields; a later duplicate only
 * fills what the first lacks (real URL, description, image) and can move the time earlier. Input order is channel priority but the
 * result does not depend on it beyond which headline wording survives. Returns copies; the input is not mutated.
 *
 * Why it matters beyond tidiness: corroboration counts DISTINCT sources, so a duplicate would not inflate it — but a dossier listing
 * "Reuters" twice, and a card with no image when another channel had one, would be wrong.
 */
export function mergeWireArticles(articles: RawArticle[]): RawArticle[] {
  const out: RawArticle[] = []
  const byKey = new Map<string, RawArticle>()
  const keysOf = (a: RawArticle) => [`${a.sourceId}|u|${archiveKey(cleanArticleUrl(a.url))}`, `${a.sourceId}|t|${titleKey(a.title)}`]
  for (const a of articles) {
    const hit = keysOf(a).map((k) => byKey.get(k)).find((r) => r !== undefined)
    if (hit) enrich(hit, a)
    const record = hit ?? { ...a }
    if (!hit) out.push(record)
    for (const k of [...keysOf(record), ...keysOf(a)]) byKey.set(k, record)
  }
  return foldGoogleNearDuplicates(out)
}
