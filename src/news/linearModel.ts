// A tiny logistic-regression trainer and predictor, no dependencies. Used to
// classify news items from their sentence embeddings (embeddingClassifier.ts).
// Deliberately minimal: full-batch Adam on standardized features with L2
// regularization and optional class balancing. ~900 samples x 384 features
// trains in well under a second, so there is nothing here to optimize.
//
// Pure, deterministic (no randomness: weights start at zero), and small enough
// that training and inference share one file — the trained weights are plain
// JSON (`LinearModel`) so a build can ship them without shipping this trainer's
// caller.

export interface LinearModel {
  /** One weight per standardized feature. */
  w: number[]
  b: number
}

export interface Standardizer {
  mean: number[]
  std: number[]
}

export function fitStandardizer(X: ArrayLike<number>[]): Standardizer {
  const d = X[0].length
  const mean = new Array<number>(d).fill(0)
  for (const x of X) for (let j = 0; j < d; j++) mean[j] += x[j]
  for (let j = 0; j < d; j++) mean[j] /= X.length
  const std = new Array<number>(d).fill(0)
  for (const x of X) for (let j = 0; j < d; j++) std[j] += (x[j] - mean[j]) ** 2
  // A constant feature would divide by zero; 1 leaves it (already centred to 0) harmless.
  for (let j = 0; j < d; j++) std[j] = Math.sqrt(std[j] / X.length) || 1
  return { mean, std }
}

export function standardize(s: Standardizer, x: ArrayLike<number>): number[] {
  const out = new Array<number>(x.length)
  for (let j = 0; j < x.length; j++) out[j] = (x[j] - s.mean[j]) / s.std[j]
  return out
}

const sigmoid = (z: number) => (z >= 0 ? 1 / (1 + Math.exp(-z)) : Math.exp(z) / (1 + Math.exp(z)))

export interface TrainOptions {
  /** L2 penalty strength on the weights (not the bias). Larger = simpler model. */
  l2?: number
  epochs?: number
  learningRate?: number
  /** Weight each class inversely to its frequency, so a rare class (e.g. Critical) is not simply ignored. */
  balanced?: boolean
}

/** X must already be standardized. y is 0/1. Deterministic. */
export function trainLogistic(X: number[][], y: number[], { l2 = 0.05, epochs = 300, learningRate = 0.02, balanced = true }: TrainOptions = {}): LinearModel {
  const n = X.length
  const d = X[0].length
  const pos = y.reduce((a, v) => a + v, 0)
  const neg = n - pos
  // Degenerate training set (one class only): a constant predictor, not a crash.
  if (pos === 0 || neg === 0) return { w: new Array<number>(d).fill(0), b: pos === 0 ? -8 : 8 }
  const wPos = balanced ? n / (2 * pos) : 1
  const wNeg = balanced ? n / (2 * neg) : 1

  const w = new Array<number>(d).fill(0)
  let b = 0
  const mW = new Array<number>(d).fill(0)
  const vW = new Array<number>(d).fill(0)
  let mB = 0
  let vB = 0
  const [beta1, beta2, eps] = [0.9, 0.999, 1e-8]

  const gW = new Array<number>(d)
  for (let t = 1; t <= epochs; t++) {
    gW.fill(0)
    let gB = 0
    for (let i = 0; i < n; i++) {
      let z = b
      const xi = X[i]
      for (let j = 0; j < d; j++) z += w[j] * xi[j]
      const weight = y[i] === 1 ? wPos : wNeg
      const err = (sigmoid(z) - y[i]) * weight
      for (let j = 0; j < d; j++) gW[j] += err * xi[j]
      gB += err
    }
    const c1 = 1 - beta1 ** t
    const c2 = 1 - beta2 ** t
    for (let j = 0; j < d; j++) {
      const g = gW[j] / n + l2 * w[j]
      mW[j] = beta1 * mW[j] + (1 - beta1) * g
      vW[j] = beta2 * vW[j] + (1 - beta2) * g * g
      w[j] -= (learningRate * (mW[j] / c1)) / (Math.sqrt(vW[j] / c2) + eps)
    }
    const g = gB / n
    mB = beta1 * mB + (1 - beta1) * g
    vB = beta2 * vB + (1 - beta2) * g * g
    b -= (learningRate * (mB / c1)) / (Math.sqrt(vB / c2) + eps)
  }
  return { w, b }
}

/** P(y = 1). x must be standardized the same way as the training features. */
export function predictProba(model: LinearModel, x: ArrayLike<number>): number {
  let z = model.b
  for (let j = 0; j < model.w.length; j++) z += model.w[j] * x[j]
  return sigmoid(z)
}
