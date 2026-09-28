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
 *
 * **Scaling (2026-09-27):** a naive version of this rescanned every still-alive cluster pair's fraction from scratch on every merge
 * iteration — O(iterations × clusters²) — which was fine at the article volumes this was tuned on but, once wire services (Reuters/AP/
 * AFP) and the first-hand Telegram channels pushed the 14-day feed window past 17,000 articles, made the underlying article-pair
 * `linkCache` grow past V8's ~16.7M-entry Map size limit and throw mid-build. Only pairs touching the cluster a merge just created
 * actually change; every other pair's fraction is unaffected by definition of what a merge does. `fractionByClusterId` memoizes exactly
 * that per surviving cluster pair (keyed by a stable id, since array positions shift under `splice`), and a lazily-invalidated max-heap
 * (`bestCandidates`) finds the next merge in O(log n) instead of an O(n²) rescan — a stale entry (either side already merged away) is
 * just discarded on pop, never acted on. `linkCache` itself is still capped defensively (`MAX_LINK_CACHE_ENTRIES`): clearing it early
 * never changes a result, an evicted pair is simply recomputed, so this is pure headroom against further growth, not a correctness bound.
 */
function mergeClusters<T extends EmbedArticle>(clusters: T[][], threshold: number): T[][] {
  const linkCache = new Map<string, number>()
  const MAX_LINK_CACHE_ENTRIES = 8_000_000
  const link = (a: T, b: T): number => {
    const key = a.key < b.key ? `${a.key}\u0001${b.key}` : `${b.key}\u0001${a.key}`
    let v = linkCache.get(key)
    if (v === undefined) {
      v = isSameOccurrenceByEmbedding(a, b, threshold) ? dot(a.vector, b.vector) : -1
      if (linkCache.size >= MAX_LINK_CACHE_ENTRIES) linkCache.clear()
      linkCache.set(key, v)
    }
    return v
  }

  interface Cluster {
    id: number
    articles: T[]
  }
  let nextId = 0
  const alive = new Map<number, Cluster>()
  for (const c of clusters) {
    const cluster: Cluster = { id: nextId++, articles: c }
    alive.set(cluster.id, cluster)
  }

  // The linked fraction between two clusters, or -1 if their time windows rule them out or fewer than a strict majority of cross pairs link.
  const fraction = (A: Cluster, B: Cluster): number => {
    const aArts = A.articles, bArts = B.articles
    const first = Math.min(aArts[0].time, bArts[0].time)
    const last = Math.max(aArts[aArts.length - 1].time, bArts[bArts.length - 1].time)
    if (last - first > MAX_CLUSTER_SPAN_MS) return -1
    if (aArts[0].time - bArts[bArts.length - 1].time > LINK_WINDOW_MS || bArts[0].time - aArts[aArts.length - 1].time > LINK_WINDOW_MS) return -1
    let linked = 0
    for (const a of aArts) for (const b of bArts) if (link(a, b) >= 0) linked++
    const pairs = aArts.length * bArts.length
    if (linked * 2 <= pairs) return -1
    return linked / pairs
  }

  // Max-heap over { idA, idB, fraction, seq }, ordered by fraction desc then seq asc (so ties resolve to whichever pair was queued
  // first, matching the ascending-index scan order the pre-2026-09-27 version used). Popped entries are checked against `alive` —
  // an entry naming an id that's since been merged away is simply dropped, never merged.
  interface Candidate { idA: number; idB: number; fraction: number; seq: number }
  const heap: Candidate[] = []
  let seq = 0
  const better = (x: Candidate, y: Candidate) => x.fraction > y.fraction || (x.fraction === y.fraction && x.seq < y.seq)
  const heapPush = (c: Candidate) => {
    heap.push(c)
    let i = heap.length - 1
    while (i > 0) {
      const parent = (i - 1) >> 1
      if (!better(heap[i], heap[parent])) break
      ;[heap[i], heap[parent]] = [heap[parent], heap[i]]
      i = parent
    }
  }
  const heapPop = (): Candidate | undefined => {
    const top = heap[0]
    const last = heap.pop()
    if (heap.length && last) {
      heap[0] = last
      let i = 0
      for (;;) {
        const l = i * 2 + 1
        const r = i * 2 + 2
        let pick = i
        if (l < heap.length && better(heap[l], heap[pick])) pick = l
        if (r < heap.length && better(heap[r], heap[pick])) pick = r
        if (pick === i) break
        ;[heap[i], heap[pick]] = [heap[pick], heap[i]]
        i = pick
      }
    }
    return top
  }
  const queueAgainst = (target: Cluster, others: Iterable<Cluster>) => {
    for (const other of others) {
      const f = fraction(target, other)
      if (f >= 0) heapPush({ idA: target.id, idB: other.id, fraction: f, seq: seq++ })
    }
  }

  const initial = [...alive.values()]
  for (let i = 0; i < initial.length; i++) queueAgainst(initial[i], initial.slice(i + 1))

  for (;;) {
    let top: Candidate | undefined
    for (;;) {
      top = heapPop()
      if (!top) break
      if (alive.has(top.idA) && alive.has(top.idB)) break
    }
    if (!top) break
    const A = alive.get(top.idA)!
    const B = alive.get(top.idB)!
    alive.delete(A.id)
    alive.delete(B.id)
    const merged: Cluster = { id: nextId++, articles: [...A.articles, ...B.articles].sort((x, y) => x.time - y.time || x.key.localeCompare(y.key)) }
    queueAgainst(merged, alive.values())
    alive.set(merged.id, merged)
  }

  return [...alive.values()].map((c) => c.articles)
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

/**
 * Attaches items to clusters that ALREADY exist, never forming or changing one — how first-hand posts join an Event (J,
 * 2026-09-24: "attach but not create"). Same link rule as the greedy pass — cosine at or above the threshold, inside the link
 * window, countries soft-compatible, and a strict MAJORITY of the cluster's members must link — and, like the greedy pass, the best
 * mean similarity wins when several clusters qualify. Unlike it, an item never extends a cluster's span and is never compared with
 * another item, so nothing here can fuse two clusters or make one out of nothing.
 *
 * Pure and non-mutating: `attached[i]` is what joins `clusters[i]`, each list in time order; whatever matched nothing comes back
 * in `unattached`.
 */
export function attachToClusters<C extends EmbedArticle, A extends EmbedArticle>(
  clusters: C[][],
  items: A[],
  threshold = EMBED_LINK_THRESHOLD,
): { attached: A[][]; unattached: A[] } {
  const attached: A[][] = clusters.map(() => [])
  const unattached: A[] = []
  for (const item of [...items].sort((a, b) => a.time - b.time || a.key.localeCompare(b.key))) {
    let best = -1
    let bestMean = -1
    clusters.forEach((cluster, i) => {
      const sims: number[] = []
      for (const member of cluster) if (isSameOccurrenceByEmbedding(member, item, threshold)) sims.push(dot(member.vector, item.vector))
      if (sims.length * 2 <= cluster.length) return
      const mean = sims.reduce((x, y) => x + y, 0) / sims.length
      if (mean > bestMean) {
        bestMean = mean
        best = i
      }
    })
    if (best >= 0) attached[best].push(item)
    else unattached.push(item)
  }
  return { attached, unattached }
}
