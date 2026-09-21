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
 * description, 47 multi-outlet stories, WITH the merge pass; "Critical reach" = stories of 3+ outlets that land in ONE cluster, since
 * Critical's floor is three outlets): 0.55 merged 5 different stories, 0.60 merged 4, 0.65 merged 2 (one clear — two different companies'
 * Venezuela oil deals — and one same-day boundary case) and reached 18/19, 0.70 merged none and reaches 14/19. 0.70 is the setting J
 * chose (2026-09-21): no false merges over reach. A DIFFERENT MODEL HAS A DIFFERENT SCALE (gte-small scores everything above 0.8), so
 * changing EMBEDDING_MODEL means re-tuning this against the eval.
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

/**
 * Second pass: merge two clusters when a strict MAJORITY of their cross pairs link. The greedy pass is order-dependent — one weak pair
 * early on (the first report and the third are 0.61 apart) can leave a genuine near-clique split in two — so this repairs splits WITHOUT
 * loosening the pair threshold. It is the same rule the greedy pass uses (broad agreement, never one bridging pair), applied between
 * clusters instead of between an article and a cluster. Real case: six outlets reporting one Houthi attack on Riyadh split 3+3, so
 * neither half reached Critical's outlet floor (then four) although 7 of the 9 cross pairs linked.
 *
 * Merges are applied best-first (highest linked fraction) and repeated until none qualify. A merged cluster must still fit in
 * MAX_CLUSTER_SPAN_MS, and only articles within LINK_WINDOW_MS of each other can link, so distant clusters are never compared.
 */
function mergeClusters<T extends EmbedArticle>(clusters: T[][], threshold: number): T[][] {
  const linkCache = new Map<string, number>()
  const link = (a: T, b: T): number => {
    const key = a.key < b.key ? `${a.key}\u0001${b.key}` : `${b.key}\u0001${a.key}`
    let v = linkCache.get(key)
    if (v === undefined) {
      v = isSameOccurrenceByEmbedding(a, b, threshold) ? dot(a.vector, b.vector) : -1
      linkCache.set(key, v)
    }
    return v
  }
  const cs = clusters.map((c) => [...c])
  for (;;) {
    let best: { i: number; j: number; fraction: number } | undefined
    for (let i = 0; i < cs.length; i++) {
      for (let j = i + 1; j < cs.length; j++) {
        const A = cs[i]
        const B = cs[j]
        const first = Math.min(A[0].time, B[0].time)
        const last = Math.max(A[A.length - 1].time, B[B.length - 1].time)
        if (last - first > MAX_CLUSTER_SPAN_MS) continue
        // No cross pair can link if the two windows are more than the link window apart.
        if (A[0].time - B[B.length - 1].time > LINK_WINDOW_MS || B[0].time - A[A.length - 1].time > LINK_WINDOW_MS) continue
        let linked = 0
        for (const a of A) for (const b of B) if (link(a, b) >= 0) linked++
        const pairs = A.length * B.length
        if (linked * 2 <= pairs) continue
        const fraction = linked / pairs
        if (!best || fraction > best.fraction) best = { i, j, fraction }
      }
    }
    if (!best) break
    const merged = [...cs[best.i], ...cs[best.j]].sort((x, y) => x.time - y.time || x.key.localeCompare(y.key))
    cs[best.i] = merged
    cs.splice(best.j, 1)
  }
  return cs
}

/** Each returned cluster is in time order, so [0] is the first report. */
export function clusterByEmbedding<T extends EmbedArticle>(articles: T[], threshold = EMBED_LINK_THRESHOLD, { mergePass = true }: { mergePass?: boolean } = {}): T[][] {
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
  return mergePass ? mergeClusters(clusters, threshold) : clusters
}
