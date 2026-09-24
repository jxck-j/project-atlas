import { isTickerSafe } from './contentSafety'
import { classifyText } from './classify'
import { RESCUE_THRESHOLD, RELEVANCE_THRESHOLD, type EmbeddingClassifier } from './embeddingClassifier'
import { embeddingText, type Embedder } from './embeddingClustering'
import { BUILD_LANGUAGES, type RawArticle } from './eventBuilder'
import { decodeHtmlEntities } from './htmlEntities'
import { MAX_TICKER_POSTS, TICKER_WINDOW_HOURS, type TickerFile, type TickerPost } from './tickerTypes'
import type { FirstHandProfile, SourceProfile, TopicTag } from './types'

export { MAX_TICKER_POSTS, TICKER_WINDOW_HOURS }
export type { TickerFile, TickerPost }

// The per-tab first-hand text ticker (design §15b, Phase 7 step 4) — "Unverified Field Reports". Pure, like the rest of src/news/.
//
// It is NOT part of the Event pipeline and shares none of its gating: a ticker post is not an Event, is never corroborated, and
// never counts toward anything. It reads first-hand posts straight from the article archive, so it needs no Event to attach to
// (an unattached post is exactly what §15b's ticker is for) and can be rebuilt on its own, hourly, without re-running clustering
// (§15c: "separate, faster build cadence").
//
// What gets in, in order:
//   1. the post's source is an enrolled first-hand channel, and its text is English (BUILD_LANGUAGES — same reason as the build:
//      the topic rules and the classifier are English-only, and an untranslated Ukrainian ticker line helps no reader);
//   2. it is recent (TICKER_WINDOW_HOURS) — a "live feed" that shows yesterday's posts is a stale one;
//   3. it passes Layer 1 of the content-safety filter (contentSafety.ts), tier C only. The output file is served, so this is
//      the gate, not a UI nicety;
//   4. it is on-topic: some topic tag, from the trained classifier when one is supplied, else the keyword rules.
// A post's video and photo are never carried — the ticker is text-only by design, and there is no visual filter.

export interface TickerDropCounts {
  unsupportedLanguage: number
  /** No usable text (a video-only post), or a duplicate of an earlier post's text. */
  noText: number
  /** No timestamp, older than the window, or dated in the future. */
  outOfWindow: number
  /** Failed Layer 1 (contentSafety.ts) at tier A or B. */
  unsafe: number
  /** No topic, or not relevant enough to one. */
  offTopic: number
}

export interface TickerResult {
  file: TickerFile
  dropped: TickerDropCounts
}

/** The most text a ticker line carries. A channel post can run to thousands of characters; the ticker is a headline strip. */
const MAX_TEXT_CHARS = 400

function tickerText(article: RawArticle): string {
  // The archive splits a long first line into title + description (telegramPreview.ts's splitTitle); put it back together.
  const joined = [article.title, article.description ?? ''].map((s) => decodeHtmlEntities(s).trim()).filter(Boolean).join(' ')
  const text = joined.replace(/\s+/g, ' ')
  if (text.length <= MAX_TEXT_CHARS) return text
  const cut = text.lastIndexOf(' ', MAX_TEXT_CHARS)
  return text.slice(0, cut > MAX_TEXT_CHARS / 2 ? cut : MAX_TEXT_CHARS).trimEnd() + '…'
}

/** A repost differs by punctuation and case, not words: the ticker shows one of them. */
const dedupeKey = (text: string): string => text.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim()

interface Candidate {
  article: RawArticle
  profile: FirstHandProfile
  text: string
  time: number
  topicTags: TopicTag[]
  keywordTopic: boolean
}

/**
 * Builds the ticker file from archive articles. `embed` + `classifier` are optional and go together: with them the topic tags and
 * an on-topic gate come from the trained classifier (the same two-regime rule Events use — a mild gate where a keyword agrees, a
 * high bar where none does); without them the keyword rules alone decide, which is weaker (tag macro-F1 0.60 vs 0.80) but needs no
 * model. Never throws on bad input: a post that can't be used is counted and skipped.
 */
export async function buildFirstHandTicker(
  articles: RawArticle[],
  { profiles, now }: { profiles: SourceProfile[]; now: string },
  options: { embed?: Embedder; classifier?: EmbeddingClassifier | null } = {},
): Promise<TickerResult> {
  const dropped: TickerDropCounts = { unsupportedLanguage: 0, noText: 0, outOfWindow: 0, unsafe: 0, offTopic: 0 }
  const channels = new Map(profiles.filter((p): p is FirstHandProfile => p.sourceType === 'first-hand').map((p) => [p.id, p]))
  const nowMs = Date.parse(now)
  const earliest = nowMs - TICKER_WINDOW_HOURS * 3_600_000

  const candidates: Candidate[] = []
  const seenText = new Set<string>()
  const seenUrl = new Set<string>()
  // Walked oldest-first so a repost keeps the ORIGINAL copy; the final sort flips the result newest-first.
  const ordered = [...articles].sort((a, b) => (Date.parse(a.publishedAt ?? '') || 0) - (Date.parse(b.publishedAt ?? '') || 0))
  for (const article of ordered) {
    // The archive holds every outlet's articles too; only an enrolled first-hand channel's post is a candidate, and the rest
    // aren't "dropped" in any sense worth counting.
    const profile = channels.get(article.sourceId)
    if (!profile) continue
    if (seenUrl.has(article.url)) continue
    seenUrl.add(article.url)
    if (!BUILD_LANGUAGES.has(article.language ?? 'en')) {
      dropped.unsupportedLanguage++
      continue
    }
    const time = Date.parse(article.publishedAt ?? '')
    if (Number.isNaN(time) || time < earliest || time > nowMs) {
      dropped.outOfWindow++
      continue
    }
    const text = tickerText(article)
    const key = dedupeKey(text)
    if (key === '' || seenText.has(key)) {
      dropped.noText++
      continue
    }
    if (!isTickerSafe(text)) {
      dropped.unsafe++
      continue
    }
    seenText.add(key)
    const keyword = classifyText(`${article.title}. ${article.description ?? ''}`)
    candidates.push({ article, profile, text, time, topicTags: keyword.topicTags, keywordTopic: keyword.topicTags.length > 0 })
  }

  let kept = candidates
  if (options.embed && options.classifier && candidates.length > 0) {
    const classifier = options.classifier
    const vectors = await options.embed(candidates.map((c) => embeddingText(c.article.title, c.article.description)))
    kept = []
    candidates.forEach((c, i) => {
      const pred = classifier.classify(vectors[i])
      // The Event gate's two regimes, per post: a keyword topic makes the classifier a mild gate; none means it must be very sure.
      if (pred.relevance < (c.keywordTopic ? RELEVANCE_THRESHOLD : RESCUE_THRESHOLD)) {
        dropped.offTopic++
        return
      }
      kept.push({ ...c, topicTags: pred.tags })
    })
  } else {
    kept = candidates.filter((c) => {
      if (c.topicTags.length > 0) return true
      dropped.offTopic++
      return false
    })
  }

  const posts: TickerPost[] = kept
    .sort((a, b) => b.time - a.time)
    .slice(0, MAX_TICKER_POSTS)
    .map(({ article, profile, text, time, topicTags }) => ({
      id: article.url,
      sourceId: profile.id,
      channelName: profile.name,
      channel: profile.channel,
      channelTier: profile.channelTier,
      ...(profile.affiliationNote ? { affiliationNote: profile.affiliationNote } : {}),
      text,
      url: article.url,
      publishedAt: new Date(time).toISOString(),
      topicTags,
      ...(article.forwardedFrom ? { forwardedFrom: article.forwardedFrom } : {}),
    }))
  return { file: { generatedAt: now, posts }, dropped }
}
