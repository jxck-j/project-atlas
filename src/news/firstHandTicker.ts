import { isTickerSafe } from './contentSafety'
import { classifyText } from './classify'
import { clusterByEmbedding, embeddingText, type Embedder, type Vector } from './embeddingClustering'
import { RESCUE_THRESHOLD, RELEVANCE_THRESHOLD, type EmbeddingClassifier } from './embeddingClassifier'
import { BUILD_LANGUAGES, type RawArticle } from './eventBuilder'
import { decodeHtmlEntities } from './htmlEntities'
import { applySeverityCaps, SEVERITY_RANK } from './severity'
import {
  MAX_PINNED_POSTS,
  MAX_TICKER_POSTS,
  PIN_MIN_SEVERITY,
  PIN_RETENTION_DAYS,
  qualifiesForPin,
  TICKER_WINDOW_HOURS,
  type TickerFile,
  type TickerPost,
} from './tickerTypes'
import type { FirstHandProfile, Severity, SourceProfile, TopicTag } from './types'

export { MAX_TICKER_POSTS, TICKER_WINDOW_HOURS, PIN_RETENTION_DAYS, PIN_MIN_SEVERITY }
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
//   2. it is recent — TICKER_WINDOW_HOURS, or PIN_RETENTION_DAYS if it earns a pin (below);
//   3. it passes Layer 1 of the content-safety filter (contentSafety.ts), tier C only. The output file is served, so this is
//      the gate, not a UI nicety;
//   4. it is NOT a head-of-state death claim. The Event pipeline holds those for a human (publishGate.ts) precisely because a
//      rumor that a leader is dead is the costliest thing this engine could publish wrongly, and the ticker is served text with no
//      review queue — so it does not carry them at all;
//   5. it is on-topic: some topic tag, from the trained classifier when one is supplied, else the keyword rules.
// A post's video and photo are never carried — the ticker is text-only by design, and there is no visual filter.
//
// AUTO-PINNING (J, 2026-09-24): a post whose WORDING the Events' keyword severity rules (classify.ts, with the same tag-based caps)
// rate Major or Critical is pinned, and a pin stays for PIN_RETENTION_DAYS instead of 24 hours. That is a statement about the words
// of an unverified post — the rules cannot tell a report from a claim — so the UI says "unverified" beside every pin. Near-duplicates
// (one strike posted six times) are folded into ONE pin when embeddings are available, the same clusterer the Events use.

export interface TickerDropCounts {
  unsupportedLanguage: number
  /** No usable text (a video-only post), or a repost of earlier text. */
  noText: number
  /** No timestamp, dated in the future, or too old for what it is: past 24 h and not pinned, or past the pin retention. */
  outOfWindow: number
  /** Failed Layer 1 (contentSafety.ts) at tier A or B. */
  unsafe: number
  /** A head-of-state death claim: the Events hold these for a human, and the ticker has no such review, so it carries none. */
  unconfirmedClaim: number
  /** No topic, or not relevant enough to one. */
  offTopic: number
}

export interface TickerResult {
  file: TickerFile
  dropped: TickerDropCounts
}

/**
 * Cosine at or above which two pin candidates count as one story. LOOSER than the Events' link threshold (EMBED_LINK_THRESHOLD, 0.70)
 * on purpose. That one is strict because over-merging there FABRICATES corroboration; here the worst case is a sibling headline hidden
 * behind the one shown, so the cost runs the other way. Chosen from ONE real sample, not a tuned eval: eleven pin candidates from the
 * live archive held four separate AMK Mapping posts about the same overnight attack on Kyiv at 0.50-0.65 to each other, none of which
 * folded at 0.70 and most of which do at 0.55. Same model, same scale — change EMBEDDING_MODEL and this needs re-checking too.
 */
export const PIN_FOLD_THRESHOLD = 0.55

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
  /** Within TICKER_WINDOW_HOURS (otherwise it is here only as a possible pin). */
  live: boolean
  topicTags: TopicTag[]
  keywordTopic: boolean
  /** The keyword rules' severity BEFORE tag caps; the final severity re-applies them to whichever tags win. */
  keywordSeverity: Severity
  /** Present only when an embedder ran. */
  vector?: Vector
}

/**
 * Builds the ticker file from archive articles. `embed` + `classifier` are optional and go together: with them the topic tags, an
 * on-topic gate and pin de-duplication come from the trained classifier and embeddings (the same two-regime rule Events use — a mild
 * gate where a keyword agrees, a high bar where none does); without them the keyword rules alone decide, which is weaker (tag
 * macro-F1 0.60 vs 0.80) and cannot fold duplicate pins, but needs no model. Never throws on bad input: a post that can't be used is
 * counted and skipped.
 */
export async function buildFirstHandTicker(
  articles: RawArticle[],
  { profiles, now }: { profiles: SourceProfile[]; now: string },
  options: { embed?: Embedder; classifier?: EmbeddingClassifier | null } = {},
): Promise<TickerResult> {
  const dropped: TickerDropCounts = { unsupportedLanguage: 0, noText: 0, outOfWindow: 0, unsafe: 0, unconfirmedClaim: 0, offTopic: 0 }
  const channels = new Map(profiles.filter((p): p is FirstHandProfile => p.sourceType === 'first-hand').map((p) => [p.id, p]))
  const nowMs = Date.parse(now)
  const liveFrom = nowMs - TICKER_WINDOW_HOURS * 3_600_000
  const pinFrom = nowMs - PIN_RETENTION_DAYS * 86_400_000

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
    if (Number.isNaN(time) || time < pinFrom || time > nowMs) {
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
    const keyword = classifyText(`${article.title}. ${article.description ?? ''}`)
    if (keyword.headOfStateDeathClaim) {
      dropped.unconfirmedClaim++
      continue
    }
    const live = time >= liveFrom
    // A post past 24 h is only here as a possible pin, and the keyword severity is a superset of the final one (tag caps only lower
    // it) — so anything below the pin line can be dropped now, which keeps the embedder off two weeks of ordinary posts every hour.
    if (!live && !qualifiesForPin(keyword.severity)) {
      dropped.outOfWindow++
      continue
    }
    seenText.add(key)
    candidates.push({ article, profile, text, time, live, topicTags: keyword.topicTags, keywordTopic: keyword.topicTags.length > 0, keywordSeverity: keyword.severity })
  }

  let kept: Candidate[]
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
      kept.push({ ...c, topicTags: pred.tags, vector: vectors[i] })
    })
  } else {
    kept = candidates.filter((c) => {
      if (c.topicTags.length > 0) return true
      dropped.offTopic++
      return false
    })
  }

  // Final severity: the same tag-based caps the Event path applies to whichever tags won (crime / sci-tech alone cap at Major).
  const severityOf = new Map(kept.map((c) => [c.article.url, applySeverityCaps(c.keywordSeverity, { topicTags: c.topicTags })]))
  const pinnable = kept.filter((c) => qualifiesForPin(severityOf.get(c.article.url)!))

  // One pin per story. With vectors, fold near-duplicates (the Events' own clusterer; countries are not resolved here, and an empty list is
  // compatible with anything) and keep the most severe, then latest, of each cluster. Without vectors every pinnable post pins.
  let pinned: Candidate[] = pinnable
  if (pinnable.length > 0 && pinnable.every((c) => c.vector)) {
    const clusters = clusterByEmbedding(
      pinnable.map((c) => ({ key: c.article.url, title: c.text, linkedEntityIds: [] as string[], time: c.time, vector: c.vector!, candidate: c })),
      PIN_FOLD_THRESHOLD,
    )
    pinned = clusters.map((members) =>
      members.reduce((best, m) => {
        const dSeverity = SEVERITY_RANK[severityOf.get(m.candidate.article.url)!] - SEVERITY_RANK[severityOf.get(best.candidate.article.url)!]
        return dSeverity > 0 || (dSeverity === 0 && m.time > best.time) ? m : best
      }),
    ).map((m) => m.candidate)
  }
  // A folded duplicate is dropped from the ticker only if it has nothing else to be there for: past 24 h, it existed solely as a pin candidate.
  const pinnedUrls = new Set(
    pinned
      .sort((a, b) => SEVERITY_RANK[severityOf.get(b.article.url)!] - SEVERITY_RANK[severityOf.get(a.article.url)!] || b.time - a.time)
      .slice(0, MAX_PINNED_POSTS)
      .map((c) => c.article.url),
  )

  // Newest first. Pins are never cut by the size cap on ordinary posts; a post past 24 h that did not become a pin is not in the file.
  const posts: TickerPost[] = []
  let ordinary = 0
  for (const c of kept.sort((a, b) => b.time - a.time)) {
    const isPin = pinnedUrls.has(c.article.url)
    if (!isPin && !c.live) {
      dropped.outOfWindow++
      continue
    }
    if (!isPin) {
      if (ordinary >= MAX_TICKER_POSTS) continue
      ordinary++
    }
    posts.push({
      id: c.article.url,
      sourceId: c.profile.id,
      channelName: c.profile.name,
      channel: c.profile.channel,
      channelTier: c.profile.channelTier,
      ...(c.profile.affiliationNote ? { affiliationNote: c.profile.affiliationNote } : {}),
      text: c.text,
      url: c.article.url,
      publishedAt: new Date(c.time).toISOString(),
      topicTags: c.topicTags,
      severity: severityOf.get(c.article.url)!,
      ...(isPin ? { pinned: true as const } : {}),
      ...(c.article.forwardedFrom ? { forwardedFrom: c.article.forwardedFrom } : {}),
    })
  }
  return { file: { generatedAt: now, posts }, dropped }
}
