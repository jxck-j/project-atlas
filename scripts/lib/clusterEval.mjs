// Scoring for same-event grouping against scripts/fixtures/newsClusteringEval.json.
// Method-agnostic: it takes clusters as arrays of fixture article indexes, so the
// heuristic, the embedding clusterer and (later) the LLM grouping are all scored by
// the same code on the same labels. See the fixture's own `note` for how the labels
// were made and what bias they carry.
import fs from 'node:fs'

export function loadFixture(path = 'scripts/fixtures/newsClusteringEval.json') {
  const f = JSON.parse(fs.readFileSync(path, 'utf8'))
  const story = new Array(f.articles.length).fill(null)
  for (const [name, idxs] of Object.entries(f.stories)) for (const i of idxs) story[i] = name
  const ambiguous = new Set(f.ambiguous.filter((i) => story[i] === null))
  const byStory = new Map()
  story.forEach((s, i) => s && byStory.set(s, [...(byStory.get(s) ?? []), i]))
  const positives = []
  for (const idxs of byStory.values()) for (let a = 0; a < idxs.length; a++) for (let b = a + 1; b < idxs.length; b++) positives.push([idxs[a], idxs[b]])
  const multiSource = [...byStory.entries()].filter(([, idxs]) => new Set(idxs.map((i) => f.articles[i].sourceId)).size >= 2)
  return { ...f, story, ambiguous, byStory, positives, multiSource }
}

/**
 * The numbers that matter for corroboration, not just pair accuracy:
 *  - contaminated: a cluster holding two DIFFERENT labeled stories. The dangerous error — it fabricates corroboration.
 *  - stories2/stories4: multi-outlet stories whose outlets land together (>=2 / >=4 in one cluster). >=4 is what Critical's floor needs.
 *  - recall: fraction of same-story article pairs placed together (dominated by big stories, so read it beside the story counts).
 */
export function scoreClusters(fx, clusters) {
  const cid = new Array(fx.articles.length).fill(-1)
  clusters.forEach((c, k) => c.forEach((i) => (cid[i] = k)))
  let tp = 0
  for (const [a, b] of fx.positives) if (cid[a] === cid[b] && cid[a] !== -1) tp++
  const contaminated = []
  let mergedWithUnlabeled = 0
  for (const c of clusters) {
    const stories = new Set(c.map((i) => fx.story[i]).filter(Boolean))
    if (stories.size >= 2) contaminated.push(c)
    else if (stories.size === 1 && c.some((i) => fx.story[i] === null && !fx.ambiguous.has(i))) mergedWithUnlabeled++
  }
  let det2 = 0, det4 = 0, cand4 = 0
  const missed2 = []
  for (const [name, idxs] of fx.multiSource) {
    const by = new Map()
    for (const i of idxs) if (cid[i] !== -1) by.set(cid[i], (by.get(cid[i]) ?? new Set()).add(fx.articles[i].sourceId))
    const best = Math.max(0, ...[...by.values()].map((s) => s.size))
    const total = new Set(idxs.map((i) => fx.articles[i].sourceId)).size
    if (best >= 2) det2++
    else missed2.push(name)
    if (total >= 4) {
      cand4++
      if (best >= 4) det4++
    }
  }
  return {
    recall: tp / fx.positives.length,
    contaminated: contaminated.length,
    contaminatedClusters: contaminated,
    mergedWithUnlabeled,
    stories2: `${det2}/${fx.multiSource.length}`,
    stories4: `${det4}/${cand4}`,
    missed2,
    biggest: Math.max(...clusters.map((c) => c.length)),
  }
}

export const formatScore = (label, r) =>
  `${label.padEnd(34)} recall ${r.recall.toFixed(3)} | contaminated ${String(r.contaminated).padStart(2)} | +unlabeled ${String(r.mergedWithUnlabeled).padStart(2)} | >=2 outlets ${r.stories2.padStart(5)} | >=4 outlets ${r.stories4.padStart(5)} | biggest ${r.biggest}`
