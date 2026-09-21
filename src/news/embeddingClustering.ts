import { LINK_WINDOW_MS, MAX_CLUSTER_SPAN_MS, type ClusterArticle } from './clustering'

// Same-event grouping by local sentence embeddings — the no-API-key alternative
// to Phase 3's LLM grouping (LOGBOOK.md, 2026-09-20). Where clustering.ts asks
// "do these headlines share words?", this asks "do they MEAN the same thing?",
// which is what fixes paraphrase: "Houthis claim attack on Saudi capital" and
// "Fuel depot ablaze after air raid in Saudi capital" share almost no words.
//
// The structure is deliberately the one clustering.ts already earned: articles
// are assigned one at a time in time order and only join a cluster they link to
// a strict MAJORITY of the members of, clusters never merge with each other,
// and every choice leans toward SPLITTING (over-merging fabricates
// corroboration; over-splitting merely delays it). Only the link signal
// changes — cosine similarity instead of title-word overlap.
//
// The numbers below were tuned against a hand-labeled sample of one live pull
// (scripts/evalNewsClustering.mjs + scripts/fixtures/newsClusteringEval.json),
// not derived. The plateau was broad (every threshold from 0.55 to 0.70 found
// 40+ of 47 multi-outlet stories); contamination was the sensitive axis, so
// the conservative end was taken.

/** An embedding model's output for one article. Vectors must be L2-normalised (cosine == dot product). */
export type Vector = ArrayLike<number>

export interface EmbedArticle extends ClusterArticle {
  vector: Vector
}

/** Embeds texts in order. Injected, so the clustering and its tests never load a model. */
export type Embedder = (texts: string[]) => Promise<Vector[]>

/**
 * Cosine similarity at or above which two articles count as linked. From `npm run eval:news-clustering` (all-MiniLM-L12-v2, title +
 * description, 47 multi-outlet stories): 0.55 merged 5 different stories, 0.60 merged 4, 0.65 merged 2 (one clear — two different
 * companies' Venezuela oil deals — and one same-day boundary case), 0.70 merged none. 0.70 is the setting J chose (2026-09-21): no
 * false merges over reach, at the price of recovering 8/13 of the stories Critical's four-outlet floor needs (0.65: 11/13). A
 * DIFFERENT MODEL HAS A DIFFERENT SCALE (gte-small scores everything above 0.8), so changing EMBEDDING_MODEL means re-tuning this
 * against the eval.
 */
export const EMBED_LINK_THRESHOLD = 0.70

/** The model the threshold was tuned for. ~33 MB quantised; runs in Node with no key and no network after the first download. */
export const EMBEDDING_MODEL = 'Xenova/all-MiniLM-L12-v2'

/** Description characters that go into the embedded text. More was not better in the eval; headline wording carries the event. */
export const EMBED_DESCRIPTION_CHARS = 220

export function dot(a: Vector, b: Vector): number {
  let s = 0
  for (let i = 0; i < a.length; i++) s += a[i] * b[i]
  return s
}

// RSS text arrives with HTML entities the feed parser only partly decodes; left in, "&#8217;" becomes tokens that shift the vector.
function cleanForEmbedding(s: string): string {
  return s.replace(/&#x?[0-9a-f]+;/gi, "'").replace(/&[a-z]+;/gi, ' ').replace(/\s+/g, ' ').trim()
}

/** The text that gets embedded: headline, then the start of the dek. */
export function embeddingText(title: string, description = ''): string {
  const head = cleanForEmbedding(title)
  const dek = cleanForEmbedding(description).slice(0, EMBED_DESCRIPTION_CHARS)
  return dek ? `${head}. ${dek}` : head
}

/**
 * Country rule is SOFT: a link is refused only when BOTH articles name countries and none are shared. An article naming no country
 * ("10-year Treasury yield tops 5%") is not evidence of a different one — the strict rule, which required a shared country, blocked
 * exactly those pairs (38/47 stories recovered vs 41/47 soft) — while two articles about different named countries stay apart.
 */
function countriesCompatible(a: ClusterArticle, b: ClusterArticle): boolean {
  if (a.linkedEntityIds.length === 0 || b.linkedEntityIds.length === 0) return true
  return a.linkedEntityIds.some((id) => b.linkedEntityIds.includes(id))
}

export function isSameOccurrenceByEmbedding(a: EmbedArticle, b: EmbedArticle, threshold = EMBED_LINK_THRESHOLD): boolean {
  if (Math.abs(a.time - b.time) > LINK_WINDOW_MS) return false
  if (!countriesCompatible(a, b)) return false
  return dot(a.vector, b.vector) >= threshold
}

/** Each returned cluster is in time order, so [0] is the first report. */
export function clusterByEmbedding<T extends EmbedArticle>(articles: T[], threshold = EMBED_LINK_THRESHOLD): T[][] {
  const ordered = [...articles].sort((a, b) => a.time - b.time || a.key.localeCompare(b.key))
  const clusters: T[][] = []
  for (const article of ordered) {
    let best: T[] | undefined
    let bestMean = -1
    for (const cluster of clusters) {
      if (article.time - cluster[0].time > MAX_CLUSTER_SPAN_MS) continue
      const sims: number[] = []
      for (const member of cluster) if (isSameOccurrenceByEmbedding(member, article, threshold)) sims.push(dot(member.vector, article.vector))
      // Strict majority: 1 of 1, 2 of 2, 2 of 3 — never 1 of 2. This is what stops one bridging article fusing two stories.
      if (sims.length * 2 <= cluster.length) continue
      const mean = sims.reduce((x, y) => x + y, 0) / sims.length
      if (mean > bestMean) {
        bestMean = mean
        best = cluster
      }
    }
    if (best) best.push(article)
    else clusters.push([article])
  }
  return clusters
}
