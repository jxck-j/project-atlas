// Grouped cross-validation helpers shared by evalNewsClassifier.mjs and
// trainNewsClassifier.mjs, so the number the evaluation reports and the
// hyperparameters the trainer picks come from the SAME procedure.
//
// Grouped by STORY: the same event reported by 8 outlets has 8 near-identical
// headlines, and letting those straddle train and test would measure
// memorization, not classification. Unlabeled articles are their own groups.
import { fitStandardizer, predictProba, standardize, trainLogistic } from '../../src/news/linearModel.ts'

export const K = 5
export const L2_GRID = [0.01, 0.05, 0.2, 1, 5]

/** X: embeddings, one per article. groupOf: a group id per article (its story, or its cluster) — near-duplicates share one. */
export function createCv(X, groupOf) {
  const groups = new Map()
  groupOf.forEach((g, i) => groups.set(g, [...(groups.get(g) ?? []), i]))

  // Seeded, deterministic shuffle of the groups, dealt round-robin into K folds.
  let seed = 12345
  const rnd = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 2 ** 32)
  const keys = [...groups.keys()].sort()
  for (let i = keys.length - 1; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1))
    ;[keys[i], keys[j]] = [keys[j], keys[i]]
  }
  const fold = new Array(X.length).fill(0)
  keys.forEach((k, gi) => groups.get(k).forEach((i) => (fold[i] = gi % K)))

  /** Out-of-fold probabilities for a 0/1 target over `idx`; `evalIdx` may add items that are predicted but never trained on. */
  function oof(idx, y, l2, evalIdx = idx) {
    const p = new Map()
    for (let f = 0; f < K; f++) {
      const tr = idx.filter((i) => fold[i] !== f)
      const te = evalIdx.filter((i) => fold[i] === f)
      if (te.length === 0) continue
      const st = fitStandardizer(tr.map((i) => X[i]))
      const m = trainLogistic(
        tr.map((i) => standardize(st, X[i])),
        tr.map((i) => y(i)),
        { l2 },
      )
      for (const i of te) p.set(i, predictProba(m, standardize(st, X[i])))
    }
    return p
  }

  const auc = (idx, y, p) => {
    const pos = idx.filter((i) => y(i) === 1)
    const neg = idx.filter((i) => y(i) === 0)
    let s = 0
    for (const a of pos) for (const b of neg) s += p.get(a) > p.get(b) ? 1 : p.get(a) === p.get(b) ? 0.5 : 0
    return s / (pos.length * neg.length)
  }

  const prf = (idx, y, pred) => {
    let tp = 0, fp = 0, fn = 0
    for (const i of idx) {
      const a = pred(i)
      const t = y(i) === 1
      if (a && t) tp++
      else if (a && !t) fp++
      else if (!a && t) fn++
    }
    const P = tp / (tp + fp || 1)
    const R = tp / (tp + fn || 1)
    return { P, R, F: (2 * P * R) / (P + R || 1), fp, fn }
  }

  /** The L2 strength with the best out-of-fold AUC. */
  const bestL2 = (idx, y) => L2_GRID.map((l2) => ({ l2, a: auc(idx, y, oof(idx, y, l2)) })).sort((a, b) => b.a - a.a)[0]

  return { fold, groupCount: keys.length, oof, auc, prf, bestL2 }
}

export const fmt = (r) => `P ${r.P.toFixed(3)}  R ${r.R.toFixed(3)}  F1 ${r.F.toFixed(3)}  (FP ${r.fp}, FN ${r.fn})`
