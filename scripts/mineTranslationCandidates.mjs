// Read-only: mines the translation cache for headlines whose English output looks wrong in a way the glossary (src/news/translation.ts's
// PROTECTED_NAMES / CYRILLIC_TERMS) could fix, so a glossary pass starts from candidates instead of reading 2,600 headlines by eye.
//
//   npm run mine:translation-candidates          (after npm run translate:news has filled the cache; reads it, never translates)
//
// Restricted to headlines the SHIPPED classifier calls in scope (relevance >= 0.3) - a wrong word in a recipe headline costs nothing.
// Four sections, each a heuristic with its own noise; NOTHING here is a verdict, a human reads every row:
//   NAME  (es only) a capitalised, non-initial token missing from the output. NOISY BY DESIGN: Spanish capitalises institutional words
//         that translate fine (Gobierno, Poder Judicial, Naciones Unidas), so most rows are fine - look for a NAME that came out as
//         something else (Lula -> Lure, Netanyahu -> Tunter, Paz -> Peace). Tokens seen >4 times in the corpus are skipped.
//   ODD   letters glued to digits, '#3', '(94)', stray '(x)' - a name replaced by garbage (Noboa -> '(94)', IEEPO -> 'I980').
//   NUM   a 2+ digit number in the source that is not in the output (286 -> 86). Not glossary-fixable; the count is the finding.
//   NEG   a negation word in the source and none in the output - the loss that inverts a headline.
// Add a glossary entry only after seeing the model get a REAL headline wrong AND being certain of the English (see the comments there).
// Writes debug/translation-candidates.json (gitignored) with the in-scope set. Needs the local embedding model (debug/hf-cache).
import fs from 'node:fs'
import { readArchive } from './lib/newsArchive.mjs'
import { openTranslationCache } from './lib/newsTranslationCache.mjs'
import { translateArticles, PROTECTED_NAMES } from '../src/news/translation.ts'
import { createLocalEmbedder } from '../src/news/localEmbedder.ts'
import { embeddingText } from '../src/news/embeddingClustering.ts'
import { loadShippedClassifier } from '../src/news/shippedClassifier.ts'

const all = readArchive().filter((a) => ['es', 'ru', 'uk'].includes(a.language))
const seen = new Set()
const uniq = all.filter((a) => (seen.has(a.title) ? false : (seen.add(a.title), true)))
const { articles, stats } = await translateArticles(uniq, { languages: new Set(['es', 'ru', 'uk']), cache: openTranslationCache() })
console.log('cache-only:', stats)
const tr = articles.filter((a) => a.translatedFrom)

const embed = await createLocalEmbedder({ cacheDir: 'debug/hf-cache' })
const cls = loadShippedClassifier()
const vecs = []
for (let i = 0; i < tr.length; i += 256) vecs.push(...(await embed(tr.slice(i, i + 256).map((a) => embeddingText(a.title, '')))))
tr.forEach((a, i) => (a.rel = cls.classify(vecs[i]).relevance))
const inScope = tr.filter((a) => a.rel >= 0.3)
console.log(`translated ${tr.length}; in scope (relevance>=0.3) ${inScope.length}`)
const byLang = {}
for (const a of inScope) byLang[a.translatedFrom] = (byLang[a.translatedFrom] ?? 0) + 1
console.log(byLang)

const norm = (s) => s.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase()
const clean = (w) => w.replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, '')
const protectedEs = new Set(Object.keys(PROTECTED_NAMES.es).map(norm))
const freq = new Map()
for (const a of tr) for (const w of a.originalTitle.split(/\s+/)) { const t = clean(w); if (/^\p{Lu}/u.test(t)) freq.set(t, (freq.get(t) ?? 0) + 1) }

const sections = { NAME: [], ODD: [], NUM: [], NEG: [] }
const NEG_SRC = { es: /(?<![\p{L}])(no|sin|nunca|ning[uú]n[a]?|nadie|ni)(?![\p{L}])/iu, ru: /(?<![\p{L}])(не|нет|без|ни|нельзя)(?![\p{L}])/iu, uk: /(?<![\p{L}])(не|нема|без|ні|ніколи)(?![\p{L}])/iu }
const NEG_OUT = /\b(no|not|n't|without|never|none|nobody|nothing|neither|nor|cannot|refus|den(y|ies|ied)|reject|lack|fail|unable|zero|free of|ban|halt)/i
for (const a of inScope) {
  const src = a.originalTitle, out = a.title, lang = a.translatedFrom
  const words = src.split(/\s+/)
  if (lang === 'es') {
    words.forEach((w, i) => {
      const t = clean(w)
      if (t.length < 5 || !/^\p{Lu}/u.test(t) || i === 0 || /[:.!?¿¡"“”-]$/.test(words[i - 1]) || protectedEs.has(norm(t))) return
      if ((freq.get(t) ?? 0) > 4) return
      const o = norm(out)
      if (o.includes(norm(t))) return
      if (o.split(/\W+/).some((x) => x.length >= 4 && x.slice(0, 4) === norm(t).slice(0, 4))) return
      sections.NAME.push({ key: t, a })
    })
  }
  if (/[A-Za-z]\d{2,}|\d{2,}[A-Za-z]{2,}|#\d|\(\w{1,2}\)|(.)\1{4,}|\b(\w+)\s+\2\b/i.test(out) && !/\d/.test(src.replace(/\d{4}/g, ''))) sections.ODD.push({ key: 'odd', a })
  else if (/[A-Za-z]\d{2,}|#\d|\(\w{1,2}\)/.test(out) && !/[A-Za-z]\d{2,}/.test(src)) sections.ODD.push({ key: 'odd', a })
  const digits = (s) => (s.match(/\d+/g) ?? []).filter((d) => d.length >= 2)
  const od = new Set(digits(out))
  const miss = digits(src).filter((d) => !od.has(d))
  if (miss.length) sections.NUM.push({ key: miss.join(','), a })
  if (NEG_SRC[lang]?.test(src) && !NEG_OUT.test(out)) sections.NEG.push({ key: 'neg', a })
}
const show = (name, cap) => {
  const rows = sections[name]
  console.log(`\n===== ${name} (${rows.length}) =====`)
  for (const r of rows.slice(0, cap)) console.log(`${r.a.translatedFrom} [${r.key}] ${r.a.originalTitle.slice(0, 110)}\n      > ${r.a.title.slice(0, 120)}`)
}
show('NAME', 90); show('ODD', 40); show('NUM', 50); show('NEG', 60)
fs.writeFileSync('debug/translation-candidates.json', JSON.stringify({ inScope: inScope.map((a) => ({ l: a.translatedFrom, o: a.originalTitle, t: a.title, r: +a.rel.toFixed(2) })) }))
process.exit(0)
