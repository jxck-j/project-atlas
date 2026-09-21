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
//  - RELEVANCE gate: F1 0.86 vs the keyword rule's 0.73, at higher recall.
//  - TOPIC TAGS: macro-F1 0.74 vs the keywords' 0.60.
//  - NOT severity: on Critical it was far worse than the regexes (F1 0.11 vs
//    0.48, on 11 examples), so severity stays rule-based.
//  - NOT report-vs-analysis as a corroboration filter: it would have dropped 13
//    of 52 legitimate Events for an AUC of 0.84.

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
 * Cluster-level mean relevance below which an Event is dropped. DELIBERATELY LOW: this is a safe filter, not a sharp one.
 * The classifier separates in-scope from out-of-scope well on average (AUC 0.90) but its scores overlap around 0.4-0.5, where
 * out-of-scope stories (Ed Sheeran on Gaza, a cargo-ship collision) sit beside real ones (a 1.6-million-person typhoon evacuation,
 * an opposition leader's sister arrested). On the labeled sample, of the 59 clusters that would publish (7 out of scope):
 *   >= 0.30  drops 2 out-of-scope, loses 0 real   <- shipped
 *   >= 0.40  drops 3, loses 1
 *   >= 0.50  drops 6, loses 4 of 52 real
 * and the same pattern held on a fresh pull judged by hand (0.50 lost the typhoon evacuation; 0.30 lost nothing). A sharper gate needs
 * more labeled data — or an LLM. Dropping is recoverable next run; wrongly dropping a real Event is the costlier error.
 */
export const RELEVANCE_THRESHOLD = 0.3

/**
 * A cluster with NO keyword topic evidence is published only if the classifier is this sure. The keyword requirement ("some member
 * must match a topic keyword") is a real precision guard — removing it, which the classifier's always-give-a-tag fallback did on
 * the first integration, let in a cargo-ship collision, an ICE shooting and a footballer's Covid certificate. So the classifier
 * RESCUES real stories the keywords missed (a plot to kill a dissident, a LGBT crackdown) without replacing that guard. Labeled
 * sample, 59 publishable clusters: keyword evidence alone ships 4 out-of-scope and loses 3 real ones; adding the rescue at 0.65
 * ships the same 4 and loses 1 (0.60 loses 0 but sits only ~0.07 above the borderline cases). Live: the borderline cargo-ship and
 * school-shooting clusters scored 0.51 and 0.53; the two real rescues scored 0.69 and 0.89.
 */
export const RESCUE_THRESHOLD = 0.65
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
