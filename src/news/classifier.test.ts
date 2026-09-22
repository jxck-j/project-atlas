import { describe, expect, it } from 'vitest'
import { buildCountryMatchers } from './countryResolution'
import { createEmbeddingClassifier, RELEVANCE_THRESHOLD, RESCUE_THRESHOLD, TAG_THRESHOLD, type ClassifierWeights } from './embeddingClassifier'
import { EMBEDDING_MODEL, type Embedder, type Vector } from './embeddingClustering'
import { buildEventsWithEmbeddings, type RawArticle } from './eventBuilder'
import { fitStandardizer, predictProba, standardize, trainLogistic } from './linearModel'
import { loadShippedClassifier } from './shippedClassifier'
import archiveBatchFixture from '../../scripts/fixtures/newsClassificationArchiveBatch.json'
import clusterFixture from '../../scripts/fixtures/newsClusteringEval.json'
import labelFixture from '../../scripts/fixtures/newsClassificationLabels.json'
import type { SourceProfile, TopicTag } from './types'

describe('linearModel', () => {
  // Two well-separated blobs along the first feature.
  const blob = (n: number, center: number) => Array.from({ length: n }, (_, i) => [center + Math.sin(i * 1.7) * 0.3, Math.cos(i * 2.3) * 0.3])
  const X = [...blob(30, -1), ...blob(30, 1)]
  const y = [...new Array(30).fill(0), ...new Array(30).fill(1)]

  it('learns a linearly separable problem', () => {
    const st = fitStandardizer(X)
    const XS = X.map((x) => standardize(st, x))
    const m = trainLogistic(XS, y)
    const acc = XS.filter((x, i) => (predictProba(m, x) >= 0.5 ? 1 : 0) === y[i]).length / X.length
    expect(acc).toBeGreaterThanOrEqual(0.95)
  })

  it('is deterministic — the same data always yields the same weights', () => {
    const XS = X.map((x) => standardize(fitStandardizer(X), x))
    expect(trainLogistic(XS, y)).toEqual(trainLogistic(XS, y))
  })

  it('a training set with only one class gives a constant predictor, not a crash', () => {
    const m = trainLogistic([[1, 2], [3, 4]], [0, 0])
    expect(predictProba(m, [5, 6])).toBeLessThan(0.01)
    expect(predictProba(trainLogistic([[1, 2], [3, 4]], [1, 1]), [5, 6])).toBeGreaterThan(0.99)
  })

  it('a constant feature does not divide by zero', () => {
    const st = fitStandardizer([[1, 5], [2, 5], [3, 5]])
    expect(standardize(st, [2, 5]).every(Number.isFinite)).toBe(true)
  })

  it('class balancing lets a rare class be found instead of ignored', () => {
    // 3 positives among 60: unbalanced training would call everything negative.
    const XR = [...blob(57, -1), ...blob(3, 1)]
    const yR = [...new Array(57).fill(0), 1, 1, 1]
    const XS = XR.map((x) => standardize(fitStandardizer(XR), x))
    const balanced = trainLogistic(XS, yR, { balanced: true })
    expect(XS.slice(57).every((x) => predictProba(balanced, x) >= 0.5)).toBe(true)
  })
})

// ---- hand-made weights: relevance = feature 0, conflict tag = feature 1, science tag = feature 2, others off
const DIM = 3
const zero = () => ({ w: new Array<number>(DIM).fill(0), b: -10 })
const head = (j: number) => ({ w: [0, 0, 0].map((_, k) => (k === j ? 10 : 0)), b: -5 })
const weights = (over: Partial<ClassifierWeights> = {}): ClassifierWeights => ({
  model: EMBEDDING_MODEL,
  dim: DIM,
  standardizer: { mean: [0, 0, 0], std: [1, 1, 1] },
  relevance: head(0),
  tags: {
    'conflict-security': head(1),
    'terrorism-non-state-actors': zero(),
    'diplomacy-politics': zero(),
    'economic-trade': zero(),
    energy: zero(),
    'humanitarian-displacement': zero(),
    'crime-trafficking': zero(),
    'science-technology': head(2),
  },
  meta: { trainedOn: 0, trainedAt: '', note: '' },
  ...over,
})

describe('createEmbeddingClassifier', () => {
  it('refuses weights trained on a different embedding model — the vectors would be meaningless to them', () => {
    expect(() => createEmbeddingClassifier(weights({ model: 'some/other-model' }))).toThrow(/retrain/)
  })

  it('refuses a vector of the wrong dimension', () => {
    expect(() => createEmbeddingClassifier(weights()).classify([1, 2])).toThrow(/dimensions/)
  })

  it('reads relevance and tags off the vector', () => {
    const c = createEmbeddingClassifier(weights())
    const on = c.classify([1, 1, 0])
    expect(on.relevance).toBeGreaterThan(0.99)
    expect(on.tags).toEqual(['conflict-security'])
    expect(c.classify([0, 0, 0]).relevance).toBeLessThan(0.01)
  })

  it('returns every tag over the threshold', () => {
    expect(createEmbeddingClassifier(weights()).classify([1, 1, 1]).tags).toEqual(['conflict-security', 'science-technology'])
  })

  it('falls back to the single most likely tag when none clears the threshold — an in-scope Event needs one', () => {
    const c = createEmbeddingClassifier(weights())
    // feature 2 is slightly higher than feature 1, both below 0.5 after the -5 bias
    const r = c.classify([1, 0.4, 0.6])
    expect(r.tags).toEqual(['science-technology'])
    expect(TAG_THRESHOLD).toBe(0.5)
  })
})

describe('shipped weights', () => {
  it('load against the current embedding model and classify a vector of the right size', () => {
    const c = loadShippedClassifier()
    const r = c.classify(new Array<number>(384).fill(0.01))
    expect(r.relevance).toBeGreaterThanOrEqual(0)
    expect(r.relevance).toBeLessThanOrEqual(1)
    expect(r.tags.length).toBeGreaterThan(0)
  })
})

describe('buildEventsWithEmbeddings with a classifier', () => {
  const COUNTRIES = [
    { id: '804', name: 'Ukraine' },
    { id: '840', name: 'United States of America' },
  ]
  const profile = (id: string) => ({ id, name: id.toUpperCase(), sourceType: 'outlet', vetting: 'confirmed' }) as SourceProfile
  const profiles = ['a', 'b', 'c', 'd'].map(profile)
  const ctx = { profiles, countryMatchers: buildCountryMatchers(COUNTRIES), now: '2026-09-20T12:00:00.000Z' }
  const raw = (sourceId: string, title: string, minutesAgo = 30): RawArticle => ({
    sourceId,
    title,
    description: '',
    url: `https://${sourceId}.test/news/${encodeURIComponent(title)}`,
    publishedAt: new Date(Date.parse(ctx.now) - minutesAgo * 60_000).toISOString(),
  })
  // 3-D vectors: [relevance, conflict-ish, science-ish]; identical vectors always cluster together.
  const embedderFor = (vectors: Record<string, Vector>): Embedder => async (texts) => texts.map((t) => vectors[t.split('. ')[0]] ?? [0, 0, 0])
  const classifier = createEmbeddingClassifier(weights())
  const two = (a: string, b: string, va: Vector, vb: Vector) => ({ arts: [raw('a', a), raw('b', b)], emb: embedderFor({ [a]: va, [b]: vb }) })

  it('drops a cluster the classifier judges out of scope, and keeps an in-scope one', async () => {
    const inA = 'Ukraine army launches offensive as troops advance'
    const inB = 'Troops advance as Ukraine army launches an offensive'
    const outA = 'Ukraine army footballer scores winner in cup final match'
    const outB = 'Cup final won by army footballer from Ukraine with late goal'
    const emb = embedderFor({ [inA]: [1, 1, 0], [inB]: [1, 1, 0], [outA]: [-1, 0, 0.001], [outB]: [-1, 0, 0.001] })
    const r = await buildEventsWithEmbeddings([raw('a', inA), raw('b', inB), raw('c', outA), raw('d', outB)], ctx, emb, { classifier })
    expect(r.published.map((e) => e.title)).toEqual([inA])
    expect(r.dropped['not-relevant']).toHaveLength(2)
  })

  it('a cluster with NO keyword topic is dropped unless the classifier is very sure, and rescued when it is', async () => {
    expect(RESCUE_THRESHOLD).toBeGreaterThan(RELEVANCE_THRESHOLD)
    const a = 'Ukraine plot foiled as prosecutors charge suspects'
    const b = 'Suspects charged in foiled Ukraine plot, prosecutors say'
    // relevance = sigmoid(10*x0-5): x0=0.5 -> 0.50 (below the rescue line), x0=1 -> 0.99
    const unsure = await buildEventsWithEmbeddings([raw('a', a), raw('b', b)], ctx, embedderFor({ [a]: [0.5, 1, 0], [b]: [0.5, 1, 0] }), { classifier })
    expect(unsure.published).toHaveLength(0)
    expect(unsure.dropped['no-topic']).toHaveLength(2)
    const sure = await buildEventsWithEmbeddings([raw('a', a), raw('b', b)], ctx, embedderFor({ [a]: [1, 1, 0], [b]: [1, 1, 0] }), { classifier })
    expect(sure.published).toHaveLength(1)
    expect(sure.published[0].topicTags).toEqual(['conflict-security']) // tags come from the classifier
  })

  it('without a classifier there is no relevance gate — the out-of-scope cluster would publish', async () => {
    const outA = 'Ukraine footballer scores winner in cup final army match'
    const outB = 'Cup final army match won by Ukraine footballer with late goal'
    const emb = embedderFor({ [outA]: [-1, 0, 0], [outB]: [-1, 0, 0] })
    const r = await buildEventsWithEmbeddings([raw('a', outA), raw('b', outB)], ctx, emb)
    expect(r.published).toHaveLength(1)
  })

  it('relevance is judged on the cluster MEAN: one low-scoring member does not sink an Event', async () => {
    const t = ['Ukraine army offensive advances near the front line', 'Front line advance as Ukraine army mounts an offensive', 'Offensive by the Ukraine army advances along front line']
    // two clearly in-scope members and one just under the line: mean stays above 0.5
    const emb = embedderFor({ [t[0]]: [1, 1, 0], [t[1]]: [1, 1, 0], [t[2]]: [0.4, 1, 0] })
    const r = await buildEventsWithEmbeddings(t.map((x, i) => raw(['a', 'b', 'c'][i], x)), ctx, emb, { classifier, threshold: 0.5 })
    expect(r.published).toHaveLength(1)
    expect(r.published[0].sources).toHaveLength(3)
  })

  it('takes topic tags from the classifier, not the keyword rules', async () => {
    const a = 'Ukraine army launches offensive as troops advance'
    const b = 'Troops advance as Ukraine army launches an offensive'
    const { arts } = two(a, b, [1, 0, 1], [1, 0, 1]) // classifier: science-technology only, though the headline is all conflict keywords
    const r = await buildEventsWithEmbeddings(arts, ctx, embedderFor({ [a]: [1, 0, 1], [b]: [1, 0, 1] }), { classifier })
    expect(r.published[0].topicTags).toEqual(['science-technology'])
  })

  it('re-applies the tag-dependent severity cap to the classifier tags (crime/sci-tech alone cannot exceed Major)', async () => {
    // Keyword rules see "ballistic ... capital attack" and tier it Critical; the classifier says science-technology only -> capped to Major.
    const a = 'Ukraine capital attack: missile strike on the capital city'
    const b = 'Missile strike on Ukraine capital city in capital attack'
    const r = await buildEventsWithEmbeddings([raw('a', a), raw('b', b)], ctx, embedderFor({ [a]: [1, 0, 1], [b]: [1, 0, 1] }), { classifier })
    // 2 outlets: below Critical's floor either way, so the cap is what makes it publishable — as Major.
    expect(r.published).toHaveLength(1)
    expect(r.published[0].severity).toBe('major')
  })

  it('the gate is deliberately conservative: it never drops a cluster the classifier scores near the middle', async () => {
    // A mean of ~0.45 is exactly where in-scope and out-of-scope scores overlap; the gate must not act there.
    expect(RELEVANCE_THRESHOLD).toBeLessThan(0.4)
    const t = ['Ukraine army offensive advances near the front line', 'Front line advance as Ukraine army mounts an offensive']
    const emb = embedderFor({ [t[0]]: [0.9, 1, 0], [t[1]]: [0.9, 1, 0] }) // relevance = sigmoid(10*0.9-5) ~ 0.98; shift with a lower x0 below
    const mid = embedderFor({ [t[0]]: [0.45, 1, 0], [t[1]]: [0.45, 1, 0] }) // sigmoid(10*0.45-5) = 0.38
    expect((await buildEventsWithEmbeddings(t.map((x, i) => raw(['a', 'b'][i], x)), ctx, emb, { classifier })).published).toHaveLength(1)
    expect((await buildEventsWithEmbeddings(t.map((x, i) => raw(['a', 'b'][i], x)), ctx, mid, { classifier })).published).toHaveLength(1)
  })
})

describe('classification label fixture (scripts/fixtures/newsClassificationLabels.json)', () => {
  const labels = labelFixture.labels as { relevance: string; tags?: string[]; severity?: string | null }[]
  const TAGS: TopicTag[] = ['conflict-security', 'terrorism-non-state-actors', 'diplomacy-politics', 'economic-trade', 'energy', 'humanitarian-displacement', 'crime-trafficking', 'science-technology']

  it('is aligned one-to-one with the clustering fixture', () => {
    expect(labels).toHaveLength(clusterFixture.articles.length)
  })

  it('every label is well-formed', () => {
    for (const [i, l] of labels.entries()) {
      expect(['1', 'A', '0', '?'], `label ${i}`).toContain(l.relevance)
      if (l.relevance === '1' || l.relevance === 'A') {
        expect(l.tags!.length, `label ${i} has no tags`).toBeGreaterThan(0)
        for (const t of l.tags!) expect(TAGS, `label ${i}`).toContain(t)
      }
      if (l.relevance === '1') expect(['routine', 'significant', 'major', 'critical'], `label ${i}`).toContain(l.severity)
    }
  })
})

describe('archive-batch label fixture (scripts/fixtures/newsClassificationArchiveBatch.json)', () => {
  const labels = archiveBatchFixture.labels as { relevance: string; tags?: string[]; severity?: string | null }[]
  const TAGS: TopicTag[] = ['conflict-security', 'terrorism-non-state-actors', 'diplomacy-politics', 'economic-trade', 'energy', 'humanitarian-displacement', 'crime-trafficking', 'science-technology']

  it('is aligned one-to-one with its own articles array', () => {
    expect(labels).toHaveLength(archiveBatchFixture.articles.length)
  })

  it('every label is well-formed', () => {
    for (const [i, l] of labels.entries()) {
      expect(['1', 'A', '0', '?'], `label ${i}`).toContain(l.relevance)
      if (l.relevance === '1' || l.relevance === 'A') {
        expect(l.tags!.length, `label ${i} has no tags`).toBeGreaterThan(0)
        for (const t of l.tags!) expect(TAGS, `label ${i}`).toContain(t)
      }
      if (l.relevance === '1') expect(['routine', 'significant', 'major', 'critical'], `label ${i}`).toContain(l.severity)
    }
  })
})
