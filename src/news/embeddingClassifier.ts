import { EMBEDDING_MODEL, type Vector } from './embeddingClustering'
import { predictProba, standardize, type LinearModel, type Standardizer } from './linearModel'
import type { TopicTag } from './types'

// Relevance and topic-tag classification from the SAME sentence embeddings the
// clustering already computes — the no-API-key answer to the keyword rules'
// weaknesses, trained on hand labels (scripts/fixtures/newsClassificationLabels.json).
// Nine tiny logistic-regression heads over a 384-d vector: no extra model, no
// extra network, microseconds per article.
//
// What it is used for, and what it deliberately is NOT used for, both come from
// the cross-validated evaluation (`npm run eval:news-classifier`, LOGBOOK.md):
//  - RELEVANCE: AUC 0.95, F1 0.90-0.93 vs the keyword rule's 0.75-0.79 — used as
//    a deliberately MILD Event gate plus a rescuer (see the thresholds below).
//  - TOPIC TAGS: macro-F1 0.80 vs the keywords' 0.60.
//  - NOT severity: on Critical it was far worse than the regexes (F1 0.00-0.11
//    vs 0.37-0.48, on ~12 examples), so severity stays rule-based.
//  - NOT report-vs-analysis as a corroboration filter: it would have dropped
//    ~14 of 52 legitimate Events for an AUC of 0.87.

export interface ClassifierWeights {
  /** The embedding model the weights were trained on. Weights are meaningless on another model's vectors. */
  model: string
  dim: number
  /** Fit on all embeddings (unsupervised), shared by every head. */
  standardizer: Standardizer
  relevance: LinearModel
  tags: Record<TopicTag, LinearModel>
  meta: { trainedOn: number; trainedAt: string; note: string }
}

/**
 * Cluster-level mean relevance below which an Event that HAS keyword topic evidence is dropped: a mild gate. Two thresholds, both
 * measured by `npm run eval:news-classifier` on cross-validated main-set clusters (56 would publish, 4 out of scope) and on a genuinely
 * held-out later-pull set (20 clusters, 3 out of scope):
 *   >= 0.30  main: 0 out-of-scope shipped, 1 real lost | held-out: 0 shipped, 0 lost      <- shipped
 *   >= 0.20  main: 3 shipped, 0 lost                   | held-out: 0 shipped, 0 lost
 * The one real Event 0.30 loses is the UK asylum-camp village story (scores ~0.21 out-of-fold: too few examples of that type), which
 * J wants; 0.20 keeps it but lets Ed Sheeran-class stories through. That is a real tradeoff, not a free lunch; J chose fewer wrong
 * items. Dropping is recoverable next run (a story gathers outlets and its mean rises).
 */
export const RELEVANCE_THRESHOLD = 0.3

/**
 * A cluster with NO keyword topic evidence is published only if the classifier is this sure. The keyword requirement ("some member
 * must match a topic keyword") is a real precision guard — removing it, which the classifier's always-give-a-tag fallback did on
 * the first integration, let in a cargo-ship collision, an ICE shooting and a footballer's Covid certificate. So the classifier
 * RESCUES real stories the keywords missed (a plot to kill a dissident, a domestic ICE shooting, a Turkish LGBT crackdown) without
 * replacing that guard. 0.60 vs 0.65 made no difference on the held-out set and recovered the ICE shooting in cross-validation,
 * where it scores ~0.65.
 */
export const RESCUE_THRESHOLD = 0.6
export const TAG_THRESHOLD = 0.5

export interface EmbeddingClassification {
  /** P(in scope), per article. */
  relevance: number
  /** Tags at or above TAG_THRESHOLD; if none reach it, the single most likely tag — an in-scope Event needs at least one. */
  tags: TopicTag[]
}

export interface EmbeddingClassifier {
  classify(vector: Vector): EmbeddingClassification
}

const TAG_ORDER: TopicTag[] = ['conflict-security', 'terrorism-non-state-actors', 'diplomacy-politics', 'economic-trade', 'energy', 'humanitarian-displacement', 'crime-trafficking', 'science-technology']

export function createEmbeddingClassifier(weights: ClassifierWeights): EmbeddingClassifier {
  if (weights.model !== EMBEDDING_MODEL) {
    throw new Error(`classifier weights were trained on "${weights.model}" but the embedder is "${EMBEDDING_MODEL}" — retrain with \`npm run train:news-classifier\``)
  }
  return {
    classify(vector) {
      if (vector.length !== weights.dim) throw new Error(`embedding has ${vector.length} dimensions, classifier expects ${weights.dim}`)
      const x = standardize(weights.standardizer, vector)
      const probs = TAG_ORDER.map((tag) => ({ tag, p: predictProba(weights.tags[tag], x) }))
      const chosen = probs.filter((t) => t.p >= TAG_THRESHOLD).map((t) => t.tag)
      const tags = chosen.length > 0 ? chosen : [probs.reduce((best, t) => (t.p > best.p ? t : best)).tag]
      return { relevance: predictProba(weights.relevance, x), tags }
    },
  }
}
