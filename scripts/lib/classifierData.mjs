// Loads and embeds the labeled data for the relevance/tag classifier: the main set (aligned to the clustering fixture, so its stories
// are known) plus the held-out set (a later pull, labeled before any model saw it). Shared by the trainer and the evaluator.
//
// Cross-validation must not let near-duplicate headlines straddle train and test, so every article gets a GROUP: its story for the
// main set, and for the held-out set the cluster the embedding clusterer puts it in (those articles have no hand-labeled stories).
import fs from 'node:fs'
import { clusterByEmbedding, embeddingText } from '../../src/news/embeddingClustering.ts'

export async function loadClassifierData(embed) {
  const cluster = JSON.parse(fs.readFileSync('scripts/fixtures/newsClusteringEval.json', 'utf8'))
  const mainLabels = JSON.parse(fs.readFileSync('scripts/fixtures/newsClassificationLabels.json', 'utf8')).labels
  const hold = JSON.parse(fs.readFileSync('scripts/fixtures/newsClassificationHoldout.json', 'utf8'))
  if (mainLabels.length !== cluster.articles.length) throw new Error('main labels are not aligned with the clustering fixture')

  const articles = [...cluster.articles, ...hold.articles]
  const labels = [...mainLabels, ...hold.labels]
  const nMain = cluster.articles.length
  const X = await embed(articles.map((a) => embeddingText(a.title, a.description)))

  const groupOf = new Array(articles.length)
  const storyOf = new Array(nMain).fill(null)
  for (const [name, idxs] of Object.entries(cluster.stories)) for (const i of idxs) storyOf[i] = name
  for (let i = 0; i < nMain; i++) groupOf[i] = storyOf[i] ?? `solo-${i}`
  const holdClusters = clusterByEmbedding(
    hold.articles.map((a, i) => ({ key: String(i), title: a.title, linkedEntityIds: a.countries, time: Date.parse(a.publishedAt), vector: X[nMain + i] })),
  )
  holdClusters.forEach((c, k) => c.forEach((m) => (groupOf[nMain + Number(m.key)] = `hold-${k}`)))

  return { articles, labels, X, groupOf, nMain, cluster, hold }
}
