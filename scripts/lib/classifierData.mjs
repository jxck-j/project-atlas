// Loads and embeds the labeled data for the relevance/tag classifier: the main set (aligned to the clustering fixture, so its stories
// are known), the archive batch (mined 2026-09-21 via `npm run mine:news-candidates` — see its own fixture's `note`: a DELIBERATELY
// BIASED sample selected for classifier/keyword disagreement, training-pool data only), and the held-out set (a later pull, labeled
// before any model saw it). Shared by the trainer and the evaluator.
//
// Cross-validation must not let near-duplicate headlines straddle train and test, so every article gets a GROUP: its story for the
// main set, a hand-identified duplicate-headline group (or its own solo group) for the archive batch, and for the held-out set the
// cluster the embedding clusterer puts it in (those articles have no hand-labeled stories).
import fs from 'node:fs'
import { clusterByEmbedding, embeddingText } from '../../src/news/embeddingClustering.ts'

// Near-duplicate headlines of the SAME real event within the archive batch, by index into its own articles array — kept here rather
// than in the fixture itself since it's a cross-validation grouping concern, not a label. See the fixture's own `note`.
const ARCHIVE_BATCH_STORIES = { rwanda: [23, 24, 35, 45], 'china-generals': [28, 29], mamdani: [9, 37, 41] }

// `embed` produces the classifier's features. `clusterEmbed` (defaults to `embed`) produces the vectors used only for grouping/clustering,
// whose threshold is tuned to the shipped model's similarity scale — so a candidate classifier model can be tried without disturbing it.
export async function loadClassifierData(embed, clusterEmbed = embed) {
  const cluster = JSON.parse(fs.readFileSync('scripts/fixtures/newsClusteringEval.json', 'utf8'))
  const mainLabels = JSON.parse(fs.readFileSync('scripts/fixtures/newsClassificationLabels.json', 'utf8')).labels
  const extra = JSON.parse(fs.readFileSync('scripts/fixtures/newsClassificationArchiveBatch.json', 'utf8'))
  const hold = JSON.parse(fs.readFileSync('scripts/fixtures/newsClassificationHoldout.json', 'utf8'))
  if (mainLabels.length !== cluster.articles.length) throw new Error('main labels are not aligned with the clustering fixture')
  if (extra.articles.length !== extra.labels.length) throw new Error('archive-batch labels are not aligned with its own articles')

  const articles = [...cluster.articles, ...extra.articles, ...hold.articles]
  const labels = [...mainLabels, ...extra.labels, ...hold.labels]
  const nMain = cluster.articles.length
  // Everything from here on is the PRISTINE held-out pool — never the archive batch, which was selected FOR
  // disagreement and would corrupt a generalization test the way a random later pull does not.
  const holdStart = articles.length - hold.articles.length
  const texts = articles.map((a) => embeddingText(a.title, a.description))
  const X = await embed(texts)
  const XC = clusterEmbed === embed ? X : await clusterEmbed(texts)

  const groupOf = new Array(articles.length)
  const storyOf = new Array(nMain).fill(null)
  for (const [name, idxs] of Object.entries(cluster.stories)) for (const i of idxs) storyOf[i] = name
  for (let i = 0; i < nMain; i++) groupOf[i] = storyOf[i] ?? `solo-${i}`
  const archiveStoryOf = new Array(extra.articles.length).fill(null)
  for (const [name, idxs] of Object.entries(ARCHIVE_BATCH_STORIES)) for (const i of idxs) archiveStoryOf[i] = name
  for (let i = 0; i < extra.articles.length; i++) groupOf[nMain + i] = archiveStoryOf[i] ? `archive-${archiveStoryOf[i]}` : `archive-solo-${i}`
  const holdClusters = clusterByEmbedding(
    hold.articles.map((a, i) => ({ key: String(i), title: a.title, linkedEntityIds: a.countries, time: Date.parse(a.publishedAt), vector: XC[holdStart + i] })),
  )
  holdClusters.forEach((c, k) => c.forEach((m) => (groupOf[holdStart + Number(m.key)] = `hold-${k}`)))

  return { articles, labels, X, XC, groupOf, nMain, holdStart, cluster, extra, hold }
}
