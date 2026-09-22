// Mines archive/news/articles.jsonl for new label candidates — step 3 of the 2026-09-21 severity plan
// (LOGBOOK.md): "grow the labeled set from the archive... since random sampling yields ~2% critical."
// Read-only: prints candidates, writes nothing. A human (or Claude, spot-checked by J, same convention
// as every existing fixture) reviews the printed list and hand-adds real labels to a fixture.
//
//   node --experimental-strip-types scripts/mineNewsLabelCandidates.mjs   (or: npx tsx scripts/mineNewsLabelCandidates.mjs)
//
// Two candidate pools, since random sampling of ordinary news undersamples exactly what the severity
// labels are short on:
//   1. RARE-SIGNAL: articles where a Critical/Major-tier trigger fires (extractSeverityFacts) —
//      head-of-state death, WMD, embassy/capital attack, regime change, war declaration, pact
//      withdrawal, sovereign default, chokepoint closure, PHEIC, or a large deaths/displaced/
//      evacuation figure. These are rare BY DESIGN (that's why Critical/Major are rare tiers), so
//      mining directly for the trigger is the only way to grow that part of the label set faster
//      than one new example per few hundred random articles.
//   2. DISAGREEMENT: articles where the shipped relevance/tag classifier and the keyword pre-filter
//      disagree confidently — the same technique the 2026-09-21 label-QA pass already used on the
//      existing fixtures (their own `note` field), applied here to genuinely NEW archive articles.
// Both pools exclude anything already in the two existing fixtures (matched by title, since that's
// the only stable identity the fixtures kept — they don't carry the archive's URLs).
import fs from 'node:fs'
import { feature } from 'topojson-client'
import { buildCountryMatchers, resolveCountryIds, TAIWAN_REF } from '../src/news/countryResolution.ts'
import { classifyText, extractSeverityFacts, resolveTopicTags } from '../src/news/classify.ts'
import { createLocalEmbedder } from '../src/news/localEmbedder.ts'
import { loadShippedClassifier } from '../src/news/shippedClassifier.ts'
import { parseArchive } from '../src/news/articleArchive.ts'

const ARCHIVE = 'archive/news/articles.jsonl'
const COUNTRIES_SOURCE = 'public/geo/countries-un193.json'
const RARE_LIMIT = 60
const DISAGREE_LIMIT = 40

const clean = (s) => (s ?? '').replace(/&#x?[0-9a-f]+;/gi, "'")
const normTitle = (t) => clean(t).toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()

const existing = new Set()
for (const f of ['scripts/fixtures/newsClusteringEval.json', 'scripts/fixtures/newsClassificationHoldout.json']) {
  const d = JSON.parse(fs.readFileSync(f, 'utf8'))
  for (const a of d.articles) existing.add(normTitle(a.title))
}

const archive = parseArchive(fs.readFileSync(ARCHIVE, 'utf8'))
console.log(`archive: ${archive.length} articles, ${existing.size} already labeled (by title)`)

const topology = JSON.parse(fs.readFileSync(COUNTRIES_SOURCE, 'utf8'))
const countries = feature(topology, topology.objects[Object.keys(topology.objects)[0]]).features.map((f) => ({ id: String(f.id), name: f.properties.name }))
const countryMatchers = buildCountryMatchers([...countries, TAIWAN_REF])

// Dedupe the archive itself by title too — the same story often appears from >1 outlet.
const seenInArchive = new Set()
const pool = []
for (const a of archive) {
  const key = normTitle(a.title)
  if (!key || existing.has(key) || seenInArchive.has(key)) continue
  seenInArchive.add(key)
  const text = `${a.title}. ${a.description ?? ''}`
  const countryIds = resolveCountryIds(text, countryMatchers)
  const topicTags = resolveTopicTags(text)
  pool.push({ a, text, countryIds, topicTags, cls: classifyText(text), facts: extractSeverityFacts(text) })
}
console.log(`${pool.length} new, deduped candidate articles`)

// ---- Pool 1: rare severity triggers -----------------------------------------------------------
const RARE_DEATHS = 5
const RARE_DISPLACED = 10_000
const RARE_EVAC = 100_000
const rareReason = (f) => {
  const hits = []
  if (f.headOfStateDeathClaim) hits.push('headOfStateDeathClaim')
  if (f.wmd) hits.push('wmd')
  if (f.pheic) hits.push('pheic')
  if (f.embassyAttack) hits.push('embassyAttack')
  if (f.capitalAttack) hits.push('capitalAttack' + (f.capitalAttackRare ? '+rare' : ''))
  if (f.regimeChange) hits.push('regimeChange')
  if (f.warDeclaration) hits.push('warDeclaration')
  if (f.pactWithdrawal) hits.push('pactWithdrawal')
  if (f.sovereignDefault) hits.push('sovereignDefault')
  if (f.chokepointClosure) hits.push('chokepointClosure')
  if (f.deaths >= RARE_DEATHS) hits.push(`deaths=${f.deaths}`)
  if (f.displaced >= RARE_DISPLACED) hits.push(`displaced=${f.displaced}`)
  if (f.evacuationOrdered >= RARE_EVAC) hits.push(`evac=${f.evacuationOrdered}`)
  return hits
}
const rare = pool.map((p) => ({ ...p, hits: rareReason(p.facts) })).filter((p) => p.hits.length > 0)
rare.sort((x, y) => y.hits.length - x.hits.length)
console.log(`\n## POOL 1 — rare-signal candidates: ${rare.length} (showing up to ${RARE_LIMIT})`)
for (const p of rare.slice(0, RARE_LIMIT)) {
  console.log(`  [${p.cls.severity.padEnd(11)}] ${p.hits.join(',').padEnd(28)} ${clean(p.a.title)}`)
}

// ---- Pool 2: relevance disagreement (shipped classifier vs the keyword pre-filter) ------------
const embed = await createLocalEmbedder({ cacheDir: 'debug/hf-cache' })
const classifier = loadShippedClassifier()
const inScopeCandidates = pool.filter((p) => p.countryIds.length > 0 || p.topicTags.length > 0)
const vectors = await embed(inScopeCandidates.map((p) => p.text))
const scored = inScopeCandidates.map((p, i) => ({ ...p, clf: classifier.classify(vectors[i]) }))
const kwInScope = (p) => p.countryIds.length > 0 && p.topicTags.length > 0
const disagree = scored
  .map((p) => ({ ...p, gap: Math.abs(p.clf.relevance - (kwInScope(p) ? 1 : 0)) }))
  .filter((p) => (kwInScope(p) && p.clf.relevance <= 0.25) || (!kwInScope(p) && p.clf.relevance >= 0.75))
disagree.sort((x, y) => y.gap - x.gap)
console.log(`\n## POOL 2 — relevance disagreement: ${disagree.length} (showing up to ${DISAGREE_LIMIT})`)
for (const p of disagree.slice(0, DISAGREE_LIMIT)) {
  console.log(`  kw=${kwInScope(p) ? 'IN ' : 'OUT'} clf=${p.clf.relevance.toFixed(2)} tags=${p.clf.tags.join('+').padEnd(24)} ${clean(p.a.title)}`)
}
