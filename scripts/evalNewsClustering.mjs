// Scores same-event grouping methods against the hand-labeled fixture.
//
//   npm run eval:news-clustering              heuristic vs the embedding clusterer across thresholds
//   npm run eval:news-clustering -- --detail  also print contaminated clusters and stories not recovered
//
// Reads scripts/fixtures/newsClusteringEval.json (see its `note` before trusting a
// number: one pull, labels by Claude, a small bias toward embedding methods). Free
// and keyless; the first run downloads the ~33 MB embedding model into debug/hf-cache.
// Re-run it after changing EMBEDDING_MODEL, EMBED_LINK_THRESHOLD, or the clustering
// constants — the threshold is a tuned number, and this is what it was tuned against.
import { clusterArticles } from '../src/news/clustering.ts'
import { clusterByEmbedding, embeddingText, EMBED_LINK_THRESHOLD, EMBEDDING_MODEL } from '../src/news/embeddingClustering.ts'
import { createLocalEmbedder } from '../src/news/localEmbedder.ts'
import { formatScore, loadFixture, scoreClusters } from './lib/clusterEval.mjs'

const fx = loadFixture()
const detail = process.argv.includes('--detail')
const time = fx.articles.map((a) => Date.parse(a.publishedAt))
const short = (i) => `[${i}] ${(fx.story[i] ?? '(unlabeled)').padEnd(26)} ${fx.articles[i].sourceId.padEnd(14)} ${fx.articles[i].title.slice(0, 70)}`

console.log(`fixture: ${fx.articles.length} articles, ${fx.byStory.size} labeled stories (${fx.multiSource.length} with >=2 outlets), ${fx.positives.length} same-story pairs, ${fx.ambiguous.size} ambiguous excluded\n`)

const heuristic = clusterArticles(fx.articles.map((a, i) => ({ key: String(i), title: a.title, linkedEntityIds: a.countries, time: time[i] }))).map((c) => c.map((m) => Number(m.key)))
console.log(formatScore('heuristic (title-word overlap)', scoreClusters(fx, heuristic)))

const embed = await createLocalEmbedder({ cacheDir: 'debug/hf-cache' })
const vectors = await embed(fx.articles.map((a) => embeddingText(a.title, a.description)))
const items = fx.articles.map((a, i) => ({ key: String(i), title: a.title, linkedEntityIds: a.countries, time: time[i], vector: vectors[i] }))
console.log(`\nembeddings: ${EMBEDDING_MODEL}, title + description, majority-link, soft country rule`)
for (const T of [0.55, 0.6, 0.65, 0.7, 0.75]) {
  const clusters = clusterByEmbedding(items, T).map((c) => c.map((m) => Number(m.key)))
  console.log(formatScore(`  threshold ${T.toFixed(2)}${T === EMBED_LINK_THRESHOLD ? '  <- shipped' : ''}`, scoreClusters(fx, clusters)))
  if (detail && T === EMBED_LINK_THRESHOLD) {
    const r = scoreClusters(fx, clusters)
    console.log('\n  contaminated clusters (>=2 different labeled stories in one cluster):')
    for (const c of r.contaminatedClusters) {
      console.log('   ---')
      for (const i of c) console.log('   ' + short(i))
    }
    console.log('\n  multi-outlet stories NOT recovered at >=2 outlets:', r.missed2.join(', ') || '(none)')
    console.log()
  }
}
