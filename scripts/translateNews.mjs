// Fills the headline-translation cache (src/news/translation.ts) from the article archive, then EXITS. Deliberately its own
// process, not a step inside the Event build: the translation model (NLLB is ~600 MB) plus the embedder in one process ran the
// machine out of memory, and this way the model is freed the moment the cache is written. The build then applies the cache with
// `--translate es,ru,uk` and never loads a translation model.
//
//   npm run translate:news                     translate up to 200 new headlines, newest first, all configured languages
//   npm run translate:news -- --limit 50       a smaller pass
//   npm run translate:news -- --languages ru   one language (e.g. to try one before another)
//
// Reads the archive; fetches nothing (archive:news / news:watch keep it fed) and never writes it. Resumable: the cache is flushed as
// it grows, so an interrupted run keeps what it finished and the next one continues.
import { readArchive } from './lib/newsArchive.mjs'
import { openTranslationCache } from './lib/newsTranslationCache.mjs'
import { selectFeedWindow } from '../src/news/feedWindow.ts'
import { TRANSLATION_MODELS, translateArticles } from '../src/news/translation.ts'
import { createLocalTranslator } from '../src/news/localTranslator.ts'

const argv = process.argv.slice(2)
const arg = (name) => {
  const i = argv.indexOf(name)
  if (i === -1) return undefined
  const v = argv[i + 1]
  if (!v || v.startsWith('--')) throw new Error(name + ' needs a value')
  return v
}
const limit = arg('--limit') === undefined ? 200 : Number(arg('--limit'))
if (!Number.isFinite(limit) || limit <= 0) throw new Error('--limit needs a positive number')
const languages = new Set((arg('--languages') ?? Object.keys(TRANSLATION_MODELS).join(',')).split(',').map((s) => s.trim()).filter(Boolean))
const unknown = [...languages].filter((l) => !TRANSLATION_MODELS[l])
if (unknown.length > 0) throw new Error('no model configured for ' + unknown.join(', ') + ' (configured: ' + Object.keys(TRANSLATION_MODELS).join(', ') + ')')

const stored = readArchive()
// The same window the build reads, newest first, so a capped pass covers what a reader is most likely to see.
const window = selectFeedWindow(stored, new Date().toISOString())
  .filter((a) => a.language && languages.has(a.language))
  .sort((a, b) => (b.publishedAt ?? '').localeCompare(a.publishedAt ?? ''))
console.log(`Archive: ${stored.length} records; ${window.length} in the feed window in ${[...languages].join(',')}.`)

const cache = openTranslationCache()
const before = cache.size()
let translate
try {
  const { stats } = await translateArticles(window, {
    languages,
    cache,
    maxNew: limit,
    // Lazy: a fully cached pass never loads a model.
    translate: async (text, language) => {
      translate ??= createLocalTranslator({ cacheDir: 'debug/hf-cache' })
      return (await translate)(text, language)
    },
  })
  console.log(`Translated ${stats.translated} new, ${stats.cached} already cached, ${stats.rejected} rejected, ${stats.deferred} left for the next run (cap ${limit}). Cache: ${before} -> ${cache.size()} entries.`)
} finally {
  cache.flush()
}
process.exit(0)
