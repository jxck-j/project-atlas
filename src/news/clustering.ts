// Groups articles that report the same real-world occurrence, so one Event
// holds every outlet's copy as dossier entries instead of N near-duplicate
// cards (design §17). This is the load-bearing step for corroboration: an
// Event's floor is computed over how many distinct sources landed in its
// cluster, so OVER-merging inflates corroboration (unsafe — it can lift an
// Event over Critical's four-outlet floor on unrelated stories) while
// over-splitting only starves it (safe — the Event just doesn't publish yet).
// Every choice below leans toward splitting.
//
// The pairwise signal is v1's (shared country + title-word overlap), but v1
// closed it transitively with union-find, which chains: A~B and B~C fuse A
// with C even when A and C are different stories. Verified on real feeds —
// three separate "Trump / meet / New York" headlines (Zelensky, Mamdani, US-
// China trade talks) fused into one Event. Here articles are instead assigned
// one at a time in time order, and only join a cluster they link to a strict
// MAJORITY of the members of; clusters never merge with each other. Plus a
// minimum word count, a time window, and a span cap.
// Phase 3's LLM pass is the real fix for what this can't tell apart.

export interface ClusterArticle {
  /** Unique per article (its URL). */
  key: string
  title: string
  linkedEntityIds: string[]
  /** ms since epoch — the publisher's own publish time. */
  time: number
}

const STOPWORDS = new Set([
  'the', 'a', 'an', 'of', 'in', 'on', 'to', 'for', 'and', 'or', 'is', 'are', 'as', 'at', 'by', 'with',
  'from', 'after', 'over', 'amid', 'says', 'said', 'new', 'its', 'his', 'her', 'their', 'that', 'this',
  'will', 'has', 'have', 'been', 'into', 'about', 'what', 'why', 'how', 'who', 'live', 'updates', 'latest',
])

export function significantWords(title: string): Set<string> {
  return new Set(
    title
      .toLowerCase()
      .replace(/[^\p{L}\p{N}\s]/gu, ' ')
      .split(/\s+/)
      .filter((w) => w.length > 3 && !STOPWORDS.has(w)),
  )
}

/** Shared words as a fraction of the SMALLER set — a short headline fully contained in a longer one is a match. */
export function titleOverlapRatio(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 || b.size === 0) return 0
  let shared = 0
  for (const w of a) if (b.has(w)) shared++
  return shared / Math.min(a.size, b.size)
}

export const OVERLAP_THRESHOLD = 0.6
/** Below this, a headline carries too little signal to judge overlap at all. */
export const MIN_SIGNIFICANT_WORDS = 3
/**
 * Overlap over the UNION, required only when the smaller headline is SHORT. The
 * min-based ratio above lets a short headline be "contained" in a longer,
 * unrelated one: live, "Ukraine's Zelensky to meet Trump in New York" (5
 * words, 3 shared) matched "US, China Meet for Talks in New York Before
 * Trump-Xi Summit" at exactly 0.6, Jaccard 0.33. Long headlines don't have the
 * problem — a genuine Critical Event (Riyadh airport, four outlets) had pairs
 * at Jaccard 0.21 that a blanket floor would have split. Both numbers are
 * TUNED ON ONE LIVE SNAPSHOT, not derived; the real pair is pinned in
 * pipeline.test.ts so a change has to reckon with it. Fail-safe direction:
 * splitting costs recall, never inflates corroboration.
 */
export const MIN_JACCARD = 0.35
export const SHORT_HEADLINE_WORDS = 6
/** Absolute floor on shared words — a ratio alone lets a 3-word headline "match" on 2 words. */
export const MIN_SHARED_WORDS = 3
/** Two articles more than this far apart are never directly linked. */
export const LINK_WINDOW_MS = 36 * 60 * 60 * 1000
/** An article never joins a cluster whose first report is more than this far back. */
export const MAX_CLUSTER_SPAN_MS = 72 * 60 * 60 * 1000

export function isSameOccurrence(a: ClusterArticle, b: ClusterArticle, wordsA: Set<string>, wordsB: Set<string>): boolean {
  if (Math.abs(a.time - b.time) > LINK_WINDOW_MS) return false
  if (wordsA.size < MIN_SIGNIFICANT_WORDS || wordsB.size < MIN_SIGNIFICANT_WORDS) return false
  if (!a.linkedEntityIds.some((id) => b.linkedEntityIds.includes(id))) return false
  let shared = 0
  for (const w of wordsA) if (wordsB.has(w)) shared++
  const jaccard = shared / (wordsA.size + wordsB.size - shared)
  const shortHeadline = Math.min(wordsA.size, wordsB.size) <= SHORT_HEADLINE_WORDS
  return shared >= MIN_SHARED_WORDS && (!shortHeadline || jaccard >= MIN_JACCARD) && titleOverlapRatio(wordsA, wordsB) >= OVERLAP_THRESHOLD
}

/** Each returned cluster is in time order, so [0] is the first report. */
export function clusterArticles<T extends ClusterArticle>(articles: T[]): T[][] {
  const ordered = [...articles].sort((a, b) => a.time - b.time || a.key.localeCompare(b.key))
  const words = new Map(ordered.map((a) => [a, significantWords(a.title)]))
  const clusters: T[][] = []

  for (const article of ordered) {
    let best: T[] | undefined
    let bestLinked = 0
    for (const cluster of clusters) {
      if (article.time - cluster[0].time > MAX_CLUSTER_SPAN_MS) continue
      const linked = cluster.filter((m) => isSameOccurrence(m, article, words.get(m)!, words.get(article)!)).length
      // Strict majority: 1 of 1, 2 of 2, 2 of 3 — never 1 of 2.
      if (linked * 2 > cluster.length && linked > bestLinked) {
        best = cluster
        bestLinked = linked
      }
    }
    if (best) best.push(article)
    else clusters.push([article])
  }
  return clusters
}
