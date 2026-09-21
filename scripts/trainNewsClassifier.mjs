// Trains the relevance and topic-tag classifier heads on the hand-labeled
// fixture and writes src/news/embeddingClassifierWeights.json.
//
//   npm run train:news-classifier
//
// Re-run after changing EMBEDDING_MODEL, the embedded text, or the labels. The
// reported accuracy comes from `npm run eval:news-clustering`'s sibling,
// `npm run eval:news-classifier` (grouped cross-validation) — NOT from here:
// a model scored on its own training data always looks perfect. This picks each
// head's L2 strength by that same cross-validation, then fits on everything.
import fs from 'node:fs'
import { EMBEDDING_MODEL } from '../src/news/embeddingClustering.ts'
import { fitStandardizer, standardize, trainLogistic } from '../src/news/linearModel.ts'
import { createLocalEmbedder } from '../src/news/localEmbedder.ts'
import { createCv } from './lib/classifierCv.mjs'
import { loadClassifierData } from './lib/classifierData.mjs'

const OUT = 'src/news/embeddingClassifierWeights.json'
const TAGS = ['conflict-security', 'terrorism-non-state-actors', 'diplomacy-politics', 'economic-trade', 'energy', 'humanitarian-displacement', 'crime-trafficking', 'science-technology']

const embed = await createLocalEmbedder({ cacheDir: 'debug/hf-cache' })
// Trains on the UNION of the main labels and the held-out set. (The held-out set stops being held out for THIS model; the honest
// "train on main only, test on held-out" number is still reported by `npm run eval:news-classifier`.)
const { labels: lab, X, groupOf } = await loadClassifierData(embed)
const N = X.length
const { bestL2 } = createCv(X, groupOf)

// Five significant digits is far below the noise in 900 hand labels, and keeps the shipped file small.
const round = (v) => Number(v.toPrecision(5))
const st = fitStandardizer(X)
const XS = X.map((x) => standardize(st, x))
const pack = (m) => ({ w: m.w.map(round), b: round(m.b) })

function fitHead(name, idx, y) {
  const { l2, a } = bestL2(idx, y)
  const model = trainLogistic(idx.map((i) => XS[i]), idx.map((i) => y(i)), { l2 })
  console.log(`  ${name.padEnd(28)} n=${String(idx.length).padStart(3)}  CV AUC ${a.toFixed(3)}  l2=${l2}`)
  return pack(model)
}

const all = [...Array(N).keys()]
const decided = all.filter((i) => lab[i].relevance !== '?')
console.log('training heads (l2 chosen by grouped cross-validation):')
const relevance = fitHead('relevance', decided, (i) => (lab[i].relevance === '0' ? 0 : 1))
const inScope = all.filter((i) => lab[i].relevance === '1' || lab[i].relevance === 'A')
const tags = {}
for (const tag of TAGS) tags[tag] = fitHead(tag, inScope, (i) => (lab[i].tags.includes(tag) ? 1 : 0))

const weights = {
  model: EMBEDDING_MODEL,
  dim: X[0].length,
  standardizer: { mean: st.mean.map(round), std: st.std.map(round) },
  relevance,
  tags,
  meta: {
    trainedOn: decided.length,
    trainedAt: new Date().toISOString().slice(0, 10),
    note: 'Trained on scripts/fixtures/newsClassificationLabels.json + newsClassificationHoldout.json (headline-only labels by Claude, two pulls). See LOGBOOK.md.',
  },
}
fs.writeFileSync(OUT, JSON.stringify(weights))
console.log(`wrote ${OUT} (${(fs.statSync(OUT).size / 1024).toFixed(0)} KB, ${decided.length} labeled articles)`)
