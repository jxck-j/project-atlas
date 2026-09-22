// Evaluation of the embedding-based relevance / topic-tag / severity classifier against the keyword rules it would replace.
// Free and keyless.
//
//   npm run eval:news-classifier
//
// Two kinds of evidence, kept apart on purpose:
//  1. Grouped cross-validation over ALL labeled data (main set + held-out set). Grouped by story/cluster so near-duplicate headlines
//     never straddle train and test.
//  2. A genuine HELD-OUT test: train on the main set only, score the later-pull held-out set (labeled before any model saw it).
//     This is the number to trust for "how will it do on tomorrow's news"; the shipped model is trained on both, so it can no
//     longer be scored on the held-out set directly.
// Labels are Claude's, headline-only (see the fixtures' `note`), so both are soft evidence.
import { classifyText, resolveTopicTags } from '../src/news/classify.ts'
import { clusterByEmbedding } from '../src/news/embeddingClustering.ts'
import { createLocalEmbedder } from '../src/news/localEmbedder.ts'
import { fitStandardizer, predictProba, standardize, trainLogistic } from '../src/news/linearModel.ts'
import { severityFeatureVector } from '../src/news/severityFeatures.ts'
import { createCv, fmt } from './lib/classifierCv.mjs'
import { loadClassifierData } from './lib/classifierData.mjs'

// NEWS_CLASSIFIER_MODEL=Xenova/all-mpnet-base-v2 scores a candidate model as the classifier's feature extractor. Clustering (the
// held-out groups and the product-level gate tables) still uses the shipped model, whose threshold is tuned to its own similarity scale.
const candidate = process.env.NEWS_CLASSIFIER_MODEL
const clusterEmbed = await createLocalEmbedder({ cacheDir: 'debug/hf-cache' })
const embed = candidate ? await createLocalEmbedder({ cacheDir: 'debug/hf-cache', model: candidate }) : clusterEmbed
if (candidate) console.log(`classifier features: ${candidate} (clustering stays on the shipped model)`)
const { articles, labels: lab, X, XC, groupOf, nMain } = await loadClassifierData(embed, clusterEmbed)
const N = X.length
const TAGS = ['conflict-security', 'terrorism-non-state-actors', 'diplomacy-politics', 'economic-trade', 'energy', 'humanitarian-displacement', 'crime-trafficking', 'science-technology']
const SEV = ['routine', 'significant', 'major', 'critical']
const K = 5
const clean = (s) => s.replace(/&#x?[0-9a-f]+;/gi, "'")
const textOf = (i) => `${articles[i].title}. ${articles[i].description}`

const { groupCount, oof, prf, bestL2 } = createCv(X, groupOf)
const count = (k) => lab.filter((l) => l.relevance === k).length
console.log(`labels (main ${nMain} + held-out ${N - nMain}): ${count('1')} reports, ${count('A')} analysis, ${count('0')} out of scope, ${count('?')} borderline excluded; ${groupCount} groups, ${K}-fold grouped CV\n`)

// ===== 1. RELEVANCE: in scope (report or analysis) vs not
const ALL = [...Array(N).keys()]
let relP, repP
{
  const idx = ALL.filter((i) => lab[i].relevance !== '?')
  const y = (i) => (lab[i].relevance === '0' ? 0 : 1)
  const pos = idx.filter((i) => y(i) === 1).length
  console.log(`## RELEVANCE (${idx.length} items, ${pos} in scope = ${(100 * pos / idx.length).toFixed(0)}%)`)
  const hasCountry = (i) => articles[i].countries.length > 0
  const hasTopic = (i) => resolveTopicTags(textOf(i)).length > 0
  console.log('  keyword: country AND topic  ', fmt(prf(idx, y, (i) => hasCountry(i) && hasTopic(i))))
  console.log('  keyword: country OR topic   ', fmt(prf(idx, y, (i) => hasCountry(i) || hasTopic(i))), ' <- the wide pre-filter')
  const { l2, a } = bestL2(idx, y)
  const p = oof(idx, y, l2, ALL)
  relP = p
  console.log(`  embeddings + logistic (l2=${l2}, AUC ${a.toFixed(3)})`)
  for (const t of [0.3, 0.4, 0.5, 0.6]) console.log(`     threshold ${t}:`, fmt(prf(idx, y, (i) => p.get(i) >= t)))
}

// ===== 2. REPORT vs ANALYSIS, among in-scope items
{
  const idx = ALL.filter((i) => lab[i].relevance === '1' || lab[i].relevance === 'A')
  const y = (i) => (lab[i].relevance === '1' ? 1 : 0)
  console.log(`\n## REPORT vs ANALYSIS among in-scope (${idx.length} items, ${idx.filter((i) => y(i) === 1).length} reports)`)
  console.log('  baseline: everything is a report', fmt(prf(idx, y, () => true)))
  const { l2, a } = bestL2(idx, y)
  const p = oof(idx, y, l2, ALL)
  repP = p
  console.log(`  embeddings + logistic (l2=${l2}, AUC ${a.toFixed(3)})`)
  for (const t of [0.5, 0.6, 0.7]) console.log(`     threshold ${t}:`, fmt(prf(idx, y, (i) => p.get(i) >= t)))
}

// ===== 3. TOPIC TAGS, among in-scope items
{
  const idx = ALL.filter((i) => lab[i].relevance === '1' || lab[i].relevance === 'A')
  console.log(`\n## TOPIC TAGS among in-scope (${idx.length} items) — F1 at 0.5, keyword vs embeddings`)
  let kwSum = 0, emSum = 0, m = 0
  for (const tag of TAGS) {
    const y = (i) => (lab[i].tags.includes(tag) ? 1 : 0)
    const n = idx.filter((i) => y(i) === 1).length
    if (n < 8) { console.log(`  ${tag.padEnd(28)} only ${n} labeled — skipped`); continue }
    const kw = prf(idx, y, (i) => resolveTopicTags(textOf(i)).includes(tag))
    const { l2 } = bestL2(idx, y)
    const p = oof(idx, y, l2)
    const em = prf(idx, y, (i) => p.get(i) >= 0.5)
    kwSum += kw.F; emSum += em.F; m++
    console.log(`  ${tag.padEnd(28)} n=${String(n).padStart(3)} | keyword F1 ${kw.F.toFixed(3)} (P ${kw.P.toFixed(2)} R ${kw.R.toFixed(2)}) | embeddings F1 ${em.F.toFixed(3)} (P ${em.P.toFixed(2)} R ${em.R.toFixed(2)})`)
  }
  console.log(`  macro-F1 over ${m} tags: keyword ${(kwSum / m).toFixed(3)} | embeddings ${(emSum / m).toFixed(3)}`)
}

// ===== 4. SEVERITY, among in-scope reports (ordinal: P(>=significant), P(>=major), P(>=critical))
// Four candidates: keyword rules (shipped), raw sentence embeddings (tried first, lost on Critical —
// see embeddingClassifier.ts's header), the extracted-facts feature vector (severityFeatures.ts — the
// "keyless severity model" from LOGBOOK.md's 2026-09-21 plan), and facts+embeddings concatenated.
{
  const idx = ALL.filter((i) => lab[i].relevance === '1' && lab[i].severity)
  const tier = (i) => SEV.indexOf(lab[i].severity)
  const dist = SEV.map((s, k) => `${s} ${idx.filter((i) => tier(i) === k).length}`).join(', ')
  console.log(`\n## SEVERITY among in-scope reports (${idx.length} items: ${dist})`)
  const kwTier = (i) => SEV.indexOf(classifyText(textOf(i)).severity)
  const acc = (f) => idx.filter((i) => f(i) === tier(i)).length / idx.length
  const within1 = (f) => idx.filter((i) => Math.abs(f(i) - tier(i)) <= 1).length / idx.length
  const majorityAcc = Math.max(...SEV.map((_, k) => idx.filter((i) => tier(i) === k).length)) / idx.length
  console.log(`  always-majority-class accuracy ${majorityAcc.toFixed(3)}`)
  console.log(`  keyword rules   exact ${acc(kwTier).toFixed(3)} | within one tier ${within1(kwTier).toFixed(3)}`)
  const ps = [1, 2, 3].map((th) => oof(idx, (i) => (tier(i) >= th ? 1 : 0), 1))
  const emTier = (i) => ps.filter((p) => p.get(i) >= 0.5).length
  console.log(`  embeddings ord. exact ${acc(emTier).toFixed(3)} | within one tier ${within1(emTier).toFixed(3)}`)

  const Xf = articles.map((_, i) => severityFeatureVector(textOf(i)))
  const cvF = createCv(Xf, groupOf)
  const psF = [1, 2, 3].map((th) => {
    const y = (i) => (tier(i) >= th ? 1 : 0)
    return cvF.oof(idx, y, cvF.bestL2(idx, y).l2)
  })
  const factsTier = (i) => psF.filter((p) => p.get(i) >= 0.5).length
  console.log(`  facts ord.      exact ${acc(factsTier).toFixed(3)} | within one tier ${within1(factsTier).toFixed(3)}`)

  const Xc = Xf.map((f, i) => [...f, ...X[i]])
  const cvC = createCv(Xc, groupOf)
  const psC = [1, 2, 3].map((th) => {
    const y = (i) => (tier(i) >= th ? 1 : 0)
    return cvC.oof(idx, y, cvC.bestL2(idx, y).l2)
  })
  const combinedTier = (i) => psC.filter((p) => p.get(i) >= 0.5).length
  console.log(`  combined ord.   exact ${acc(combinedTier).toFixed(3)} | within one tier ${within1(combinedTier).toFixed(3)}`)

  const candidates = [['keyword', kwTier], ['embeddings', emTier], ['facts', factsTier], ['combined', combinedTier]]
  for (const [name, f] of candidates) {
    const crit = prf(idx, (i) => (tier(i) === 3 ? 1 : 0), (i) => f(i) === 3)
    const majorUp = prf(idx, (i) => (tier(i) >= 2 ? 1 : 0), (i) => f(i) >= 2)
    console.log(`  ${name.padEnd(10)} Critical: ${fmt(crit)} | Major-or-above: ${fmt(majorUp)}`)
  }

  // ---- Event-level (max-over-story): what eventBuilder.ts actually publishes (`maxSeverity` over the
  // cluster), not what any one article scores alone. Per-article scoring understates a trigger that's
  // true for the whole event but textually present in only one of several duplicate headlines (the
  // Riyadh capital-attack case — see BACKLOG.md/LOGBOOK.md's 2026-09-21 entries).
  const groups = new Map()
  for (const i of idx) groups.set(groupOf[i], [...(groups.get(groupOf[i]) ?? []), i])
  const groupIds = [...groups.keys()]
  const groupTruth = (g) => Math.max(...groups.get(g).map(tier))
  console.log(`\n  -- event-level (max-over-story, ${groupIds.length} groups) --`)
  for (const [name, f] of candidates) {
    const groupPred = (g) => Math.max(...groups.get(g).map(f))
    const exact = groupIds.filter((g) => groupPred(g) === groupTruth(g)).length / groupIds.length
    const critTruth = groupIds.filter((g) => groupTruth(g) === 3)
    const critPred = groupIds.filter((g) => groupPred(g) === 3)
    const tp = critTruth.filter((g) => groupPred(g) === 3).length
    const P = tp / (critPred.length || 1)
    const R = tp / (critTruth.length || 1)
    console.log(`  ${name.padEnd(10)} exact ${exact.toFixed(3)} | Critical P ${P.toFixed(2)} R ${R.toFixed(2)} (n=${critTruth.length} true, ${critPred.length} predicted)`)
  }
}

// ---- shared by sections 5 and 6: the Event gates the pipeline chooses between
const inScope = (l) => (l.relevance === '0' ? 0 : 1)
function gateTable(title, idxs, relOf) {
  // idxs: indices of the articles in this pool; relOf(i): out-of-fold / held-out relevance probability
  const items = idxs.map((i) => ({ key: String(i), title: articles[i].title, linkedEntityIds: articles[i].countries, time: Date.parse(articles[i].publishedAt), vector: XC[i] }))
  const clusters = clusterByEmbedding(items).map((c) => c.map((m) => Number(m.key)))
  const distinct = (c) => new Set(c.map((i) => articles[i].sourceId)).size
  const truth = (c) => { const k = c.filter((i) => lab[i].relevance !== '?'); return k.length === 0 ? null : k.filter((i) => lab[i].relevance !== '0').length * 2 > k.length }
  const publishable = clusters.filter((c) => distinct(c) >= 2 && c.some((i) => articles[i].countries.length > 0) && truth(c) !== null)
  const real = publishable.filter(truth)
  const kwTopic = (c) => c.some((i) => resolveTopicTags(textOf(i)).length > 0)
  const mean = (c) => c.reduce((a, i) => a + relOf(i), 0) / c.length
  console.log(`\n## ${title}: ${publishable.length} clusters would publish (>=2 outlets, some country); ${real.length} in scope, ${publishable.length - real.length} out of scope`)
  const row = (name, gate) => {
    const kept = publishable.filter(gate)
    console.log('  ' + name.padEnd(52) + 'keeps ' + String(kept.length).padStart(3) + ' | out-of-scope shipped ' + String(kept.filter((c) => !truth(c)).length).padStart(2) + ' | in-scope lost ' + String(real.filter((c) => !gate(c)).length).padStart(2))
  }
  row('no gate', () => true)
  row('keyword topic evidence only (the old guard)', kwTopic)
  row('COMBINED shipped: kw & mean>=0.30, else >=0.60', (c) => (kwTopic(c) ? mean(c) >= 0.3 : mean(c) >= 0.6))
  for (const t of [0.3, 0.4, 0.5]) row('classifier only: mean>=' + t, (c) => mean(c) >= t)
  for (const g of [0.1, 0.15, 0.2, 0.25]) row('COMBINED: kw & mean>=' + g.toFixed(2) + ', else >=0.60', (c) => (kwTopic(c) ? mean(c) >= g : mean(c) >= 0.6))
  return { publishable, truth, mean, kwTopic, distinct }
}

// ===== 5. PRODUCT-LEVEL, cross-validated: main-set clusters that would publish
{
  const main = [...Array(nMain).keys()]
  const { publishable, truth, distinct, mean, kwTopic } = gateTable('PRODUCT-LEVEL (cross-validated, main set)', main, (i) => relP.get(i))
  const real = publishable.filter(truth)
  const shippedRule = (c) => (kwTopic(c) ? mean(c) >= 0.3 : mean(c) >= 0.6)
  console.log('  clusters the shipped rule gets wrong (cross-validated):')
  for (const c of publishable.filter((c) => shippedRule(c) !== truth(c))) {
    console.log(`    ${shippedRule(c) ? 'KEPT   ' : 'DROPPED'} truth=${truth(c) ? 'IN ' : 'OUT'} mean=${mean(c).toFixed(2)} kw=${kwTopic(c) ? 'y' : 'n'} ${c.length}art/${distinct(c)}out | ${c.slice(0, 2).map((i) => clean(articles[i].title).slice(0, 48)).join(' || ')}`)
  }
  for (const rescue of [0.5, 0.55, 0.6, 0.65]) {
    const g = (c) => (kwTopic(c) ? mean(c) >= 0.3 : mean(c) >= rescue)
    console.log(`  rescue>=${rescue}: out-of-scope shipped ${publishable.filter(g).filter((c) => !truth(c)).length}, in-scope lost ${real.filter((c) => !g(c)).length}`)
  }
  for (const t of [0.5, 0.6]) {
    const kept = real.filter((c) => distinct(c.filter((i) => repP.get(i) >= t)) >= 2)
    console.log('  in-scope Events still >=2 outlets when only predicted REPORTS count (t=' + t + '): ' + kept.length + '/' + real.length)
  }
}

// ===== 6. HELD-OUT: train on the main set ONLY, score the later-pull held-out set
{
  const mainIdx = [...Array(nMain).keys()].filter((i) => lab[i].relevance !== '?')
  const holdAll = [...Array(N - nMain).keys()].map((k) => nMain + k)
  const holdIdx = holdAll.filter((i) => lab[i].relevance !== '?')
  const st = fitStandardizer(mainIdx.map((i) => X[i]))
  const y = (i) => inScope(lab[i])
  const model = trainLogistic(mainIdx.map((i) => standardize(st, X[i])), mainIdx.map(y), { l2: 1 })
  const relH = new Map(holdAll.map((i) => [i, predictProba(model, standardize(st, X[i]))]))
  const pos = holdIdx.filter((i) => y(i) === 1).length
  console.log(`\n## HELD-OUT (train on the ${mainIdx.length} main labels, score ${holdIdx.length} later-pull articles: ${pos} in scope)`)
  const P = holdIdx.filter((i) => y(i) === 1)
  const Q = holdIdx.filter((i) => y(i) === 0)
  let s = 0
  for (const a of P) for (const b of Q) s += relH.get(a) > relH.get(b) ? 1 : relH.get(a) === relH.get(b) ? 0.5 : 0
  console.log(`  relevance AUC ${(s / (P.length * Q.length)).toFixed(3)}`)
  console.log('  keyword: country AND topic  ', fmt(prf(holdIdx, y, (i) => articles[i].countries.length > 0 && resolveTopicTags(textOf(i)).length > 0)))
  for (const t of [0.3, 0.4, 0.5]) console.log(`  classifier threshold ${t}:    `, fmt(prf(holdIdx, y, (i) => relH.get(i) >= t)))
  const { publishable, truth, mean, kwTopic } = gateTable('HELD-OUT CLUSTER LEVEL', holdAll, (i) => relH.get(i))
  const shipped = (c) => (kwTopic(c) ? mean(c) >= 0.3 : mean(c) >= 0.6)
  const named = /typhoon|evacuat|\bICE\b|asylum|school shoot/i
  console.log('  clusters the shipped rule gets wrong, plus the stories J named (typhoon, ICE shooting, asylum, school shooting):')
  for (const c of publishable.filter((c) => shipped(c) !== truth(c) || c.some((i) => named.test(articles[i].title)))) {
    console.log(`    ${shipped(c) ? 'KEPT   ' : 'DROPPED'} truth=${truth(c) ? 'IN ' : 'OUT'} mean=${mean(c).toFixed(2)} kw=${kwTopic(c) ? 'y' : 'n'} | ${c.slice(0, 2).map((i) => clean(articles[i].title).slice(0, 50)).join(' || ')}`)
  }
}
