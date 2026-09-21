// Cross-validated evaluation of an embedding-based classifier for relevance,
// report-vs-analysis, topic tags and severity, against the keyword rules it
// would replace. Free and keyless.
//
//   npm run eval:news-classifier
//
// Labels: scripts/fixtures/newsClassificationLabels.json (headline-only, by
// Claude, noisy — read its `note`). CV is GROUPED BY STORY: the same event
// reported by 8 outlets has 8 near-identical headlines, and letting those
// straddle train and test would measure memorization, not classification.
import fs from 'node:fs'
import { classifyText, resolveTopicTags } from '../src/news/classify.ts'
import { clusterByEmbedding, EMBED_LINK_THRESHOLD } from '../src/news/embeddingClustering.ts'
import { embeddingText } from '../src/news/embeddingClustering.ts'
import { createLocalEmbedder } from '../src/news/localEmbedder.ts'
import { createCv, fmt } from './lib/classifierCv.mjs'

const cluster = JSON.parse(fs.readFileSync('scripts/fixtures/newsClusteringEval.json', 'utf8'))
const lab = JSON.parse(fs.readFileSync('scripts/fixtures/newsClassificationLabels.json', 'utf8')).labels
const articles = cluster.articles
const N = articles.length
const TAGS = ['conflict-security', 'terrorism-non-state-actors', 'diplomacy-politics', 'economic-trade', 'energy', 'humanitarian-displacement', 'crime-trafficking', 'science-technology']
const SEV = ['routine', 'significant', 'major', 'critical']

const embed = await createLocalEmbedder({ cacheDir: 'debug/hf-cache' })
const X = await embed(articles.map((a) => embeddingText(a.title, a.description)))

// ---- grouped 5-fold cross-validation (shared with the trainer)
const { groupCount, oof, prf, bestL2 } = createCv(X, cluster)
const K = 5

console.log(`labels: ${lab.filter((l) => l.relevance === '1').length} reports, ${lab.filter((l) => l.relevance === 'A').length} analysis, ${lab.filter((l) => l.relevance === '0').length} out of scope, ${lab.filter((l) => l.relevance === '?').length} borderline excluded; ${groupCount} groups, ${K}-fold grouped CV\n`)

// ===== 1. RELEVANCE: in scope (report or analysis) vs not
const ALL = [...Array(N).keys()]
let relP, repP
{
  const idx = [...Array(N).keys()].filter((i) => lab[i].relevance !== '?')
  const y = (i) => (lab[i].relevance === '0' ? 0 : 1)
  const pos = idx.filter((i) => y(i) === 1).length
  console.log(`## RELEVANCE (${idx.length} items, ${pos} in scope = ${(100 * pos / idx.length).toFixed(0)}%)`)
  // keyword baselines = what the pipeline does today
  const hasCountry = (i) => articles[i].countries.length > 0
  const hasTopic = (i) => resolveTopicTags(`${articles[i].title}. ${articles[i].description}`).length > 0
  console.log('  keyword: country AND topic  ', fmt(prf(idx, y, (i) => hasCountry(i) && hasTopic(i))))
  console.log('  keyword: country OR topic   ', fmt(prf(idx, y, (i) => hasCountry(i) || hasTopic(i))), ' <- the wide pre-filter')
  const { l2, a } = bestL2(idx, y)
  const p = oof(idx, y, l2, ALL)
  relP = p
  console.log(`  embeddings + logistic (l2=${l2}, AUC ${a.toFixed(3)})`)
  for (const t of [0.4, 0.5, 0.6, 0.7]) console.log(`     threshold ${t}:`, fmt(prf(idx, y, (i) => p.get(i) >= t)))
}

// ===== 2. REPORT vs ANALYSIS, among in-scope items
{
  const idx = [...Array(N).keys()].filter((i) => lab[i].relevance === '1' || lab[i].relevance === 'A')
  const y = (i) => (lab[i].relevance === '1' ? 1 : 0)
  const rep = idx.filter((i) => y(i) === 1).length
  console.log(`\n## REPORT vs ANALYSIS among in-scope (${idx.length} items, ${rep} reports)`)
  // baseline: the only signal today is the URL path (not in the fixture) - so the baseline is "everything is a report"
  console.log('  baseline: everything is a report', fmt(prf(idx, y, () => true)))
  const { l2, a } = bestL2(idx, y)
  const p = oof(idx, y, l2, ALL)
  repP = p
  console.log(`  embeddings + logistic (l2=${l2}, AUC ${a.toFixed(3)})`)
  for (const t of [0.5, 0.6, 0.7]) console.log(`     threshold ${t}:`, fmt(prf(idx, y, (i) => p.get(i) >= t)))
}

// ===== 3. TOPIC TAGS, among in-scope items
{
  const idx = [...Array(N).keys()].filter((i) => lab[i].relevance === '1' || lab[i].relevance === 'A')
  console.log(`\n## TOPIC TAGS among in-scope (${idx.length} items) — F1 at 0.5, keyword vs embeddings`)
  let kwSum = 0, emSum = 0, unSum = 0, m = 0
  for (const tag of TAGS) {
    const y = (i) => (lab[i].tags.includes(tag) ? 1 : 0)
    const n = idx.filter((i) => y(i) === 1).length
    if (n < 8) { console.log(`  ${tag.padEnd(28)} only ${n} labeled — skipped`); continue }
    const kw = prf(idx, y, (i) => resolveTopicTags(`${articles[i].title}. ${articles[i].description}`).includes(tag))
    const { l2 } = bestL2(idx, y)
    const p = oof(idx, y, l2)
    const em = prf(idx, y, (i) => p.get(i) >= 0.5)
    const un = prf(idx, y, (i) => p.get(i) >= 0.5 || resolveTopicTags(`${articles[i].title}. ${articles[i].description}`).includes(tag))
    unSum += un.F
    kwSum += kw.F; emSum += em.F; m++
    console.log(`  ${tag.padEnd(28)} n=${String(n).padStart(3)} | keyword F1 ${kw.F.toFixed(3)} (P ${kw.P.toFixed(2)} R ${kw.R.toFixed(2)}) | embeddings F1 ${em.F.toFixed(3)} (P ${em.P.toFixed(2)} R ${em.R.toFixed(2)})`)
  }
  console.log(`  macro-F1 over ${m} tags: keyword ${(kwSum / m).toFixed(3)} | embeddings ${(emSum / m).toFixed(3)} | keyword OR embeddings ${(unSum / m).toFixed(3)}`)
}

// ===== 4. SEVERITY, among in-scope reports (ordinal: P(>=significant), P(>=major), P(>=critical))
{
  const idx = [...Array(N).keys()].filter((i) => lab[i].relevance === '1' && lab[i].severity)
  const tier = (i) => SEV.indexOf(lab[i].severity)
  const dist = SEV.map((s, k) => `${s} ${idx.filter((i) => tier(i) === k).length}`).join(', ')
  console.log(`\n## SEVERITY among in-scope reports (${idx.length} items: ${dist})`)
  const kwTier = (i) => SEV.indexOf(classifyText(`${articles[i].title}. ${articles[i].description}`).severity)
  const acc = (f) => idx.filter((i) => f(i) === tier(i)).length / idx.length
  const within1 = (f) => idx.filter((i) => Math.abs(f(i) - tier(i)) <= 1).length / idx.length
  const majorityAcc = Math.max(...SEV.map((_, k) => idx.filter((i) => tier(i) === k).length)) / idx.length
  console.log(`  always-majority-class accuracy ${majorityAcc.toFixed(3)}`)
  console.log(`  keyword rules   exact ${acc(kwTier).toFixed(3)} | within one tier ${within1(kwTier).toFixed(3)}`)
  const ps = [1, 2, 3].map((th) => oof(idx, (i) => (tier(i) >= th ? 1 : 0), 1))
  const emTier = (i) => ps.filter((p) => p.get(i) >= 0.5).length
  console.log(`  embeddings ord. exact ${acc(emTier).toFixed(3)} | within one tier ${within1(emTier).toFixed(3)}`)
  for (const [name, f] of [['keyword', kwTier], ['embeddings', emTier]]) {
    const crit = prf(idx, (i) => (tier(i) === 3 ? 1 : 0), (i) => f(i) === 3)
    const majorUp = prf(idx, (i) => (tier(i) >= 2 ? 1 : 0), (i) => f(i) >= 2)
    console.log(`  ${name.padEnd(10)} Critical: ${fmt(crit)} | Major-or-above: ${fmt(majorUp)}`)
  }
}

// ===== 5. PRODUCT-LEVEL: of the clusters that would PUBLISH (>=2 distinct outlets), how many are irrelevant?
{
  const time = articles.map((a) => Date.parse(a.publishedAt))
  const vecs = X
  const items = articles.map((a, i) => ({ key: String(i), title: a.title, linkedEntityIds: a.countries, time: time[i], vector: vecs[i] }))
  const clusters = clusterByEmbedding(items, EMBED_LINK_THRESHOLD).map((c) => c.map((m) => Number(m.key)))
  const known = (i) => lab[i].relevance !== '?'
  const truth = (c) => { const k = c.filter(known); if (k.length === 0) return null; return k.filter((i) => lab[i].relevance !== '0').length * 2 > k.length }
  const distinct = (c) => new Set(c.map((i) => articles[i].sourceId)).size
  const publishable = clusters.filter((c) => distinct(c) >= 2 && truth(c) !== null)
  const trulyRelevant = publishable.filter((c) => truth(c))
  console.log('\n## PRODUCT-LEVEL: clusters that would publish (>=2 distinct outlets), at the shipped clustering threshold ' + EMBED_LINK_THRESHOLD)
  console.log('  ' + publishable.length + ' would publish; ' + trulyRelevant.length + ' are truly in scope, ' + (publishable.length - trulyRelevant.length) + ' are NOT (irrelevant Events that would ship)')
  const kwGate = (c) => c.some((i) => articles[i].countries.length > 0 && resolveTopicTags(articles[i].title + '. ' + articles[i].description).length > 0)
  const report = (name, gate) => {
    const kept = publishable.filter(gate)
    const fp = kept.filter((c) => !truth(c)).length
    const lost = trulyRelevant.filter((c) => !gate(c)).length
    console.log('  ' + name.padEnd(46) + 'keeps ' + String(kept.length).padStart(3) + ' | irrelevant shipped ' + String(fp).padStart(2) + ' | relevant lost ' + String(lost).padStart(2))
  }
  report('no gate (current --embed: country OR topic)', () => true)
  report('keyword: some member has country AND topic', kwGate)
  // COMBINED (what the pipeline does): a cluster with keyword topic evidence needs only a low mean relevance (a mild gate);
  // one WITHOUT it is published only if the classifier is very sure (a rescue). Keeps the old keyword safeguard.
  const hasKwTopic = (c) => c.some((i) => resolveTopicTags(articles[i].title + '. ' + articles[i].description).length > 0)
  const mean = (c) => c.reduce((a, i) => a + relP.get(i), 0) / c.length
  // the publishable set for THIS comparison must include clusters the keyword rule alone would have dropped (no topic keywords)
  for (const rescue of [0.6, 0.65, 0.7, 0.75, 0.8]) report('COMBINED: keyword topic & mean>=0.3, else rescue>=' + rescue, (c) => (hasKwTopic(c) ? mean(c) >= 0.3 : mean(c) >= rescue))
  report('  (reference: keyword topic evidence only, no classifier)', hasKwTopic)
  for (const t of [0.25, 0.3, 0.35, 0.4, 0.5]) report('classifier: mean relevance >= ' + t, (c) => c.reduce((a, i) => a + relP.get(i), 0) / c.length >= t)
  // corroboration should count REPORTS only: how many published clusters lose their 2nd outlet if analysis pieces are excluded?
  for (const t of [0.5, 0.6]) {
    const reportsOnly = (c) => distinct(c.filter((i) => repP.get(i) >= t)) >= 2
    const kept = trulyRelevant.filter(reportsOnly)
    console.log('  in-scope Events still >=2 outlets when only predicted REPORTS count (t=' + t + '): ' + kept.length + '/' + trulyRelevant.length)
  }
}
