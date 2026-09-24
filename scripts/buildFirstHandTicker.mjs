// Build-time asset generator for the per-tab first-hand ticker (news-sourcing-design.md §15b, Phase 7 step 4).
//
//   npm run build:news:ticker
//
// Reads the article archive (archive/news/articles.jsonl) — it does NOT fetch; `npm run archive:news`, `build:news:events` and
// `news:watch` are what put channel posts there — and writes public/data/news-firsthand.json: the last TICKER_WINDOW_HOURS of English
// first-hand text that passed the Layer 1 content-safety filter and carries a topic. All the rules are in src/news/firstHandTicker.ts
// (pure, tested); this file is the read/write shell, like buildNewsEvents.mjs.
//
// Independent of the Event build on purpose: a ticker post is not an Event and needs no clustering, so this can run on its own,
// much more often (§15c: hourly), without the Event build's model load or its two-hour-old view of the world.
//
// DEFAULT = the shipped embedding classifier supplies topic tags and the on-topic gate (same local model as the Event build; a
// one-time ~33 MB download into debug/hf-cache, offline afterwards). It fails loudly if the model can't load rather than quietly
// switching to keywords, which would change what publishes. `--no-classifier` opts into the keyword rules on purpose.
//
// The output is SERVED, which is why Layer 1 sits in front of it — see contentSafety.ts. It is gitignored: raw third-party channel
// text has no business in the repo's history, and publishing it is the same undecided question as publishing news-events.json.
import fs from 'node:fs'
import { readArchive } from './lib/newsArchive.mjs'
import { buildFirstHandTicker, TICKER_WINDOW_HOURS } from '../src/news/firstHandTicker.ts'
import { createLocalEmbedder } from '../src/news/localEmbedder.ts'
import { loadShippedClassifier } from '../src/news/shippedClassifier.ts'

const OUTPUT = 'public/data/news-firsthand.json'
const NO_CLASSIFIER = process.argv.includes('--no-classifier')

const profiles = JSON.parse(fs.readFileSync('src/news/sources.json', 'utf8'))
const archived = readArchive()
if (archived.length === 0) {
  console.error('The article archive is empty — run `npm run archive:news` first. Nothing was written.')
  process.exit(1)
}

const now = new Date().toISOString()
let options = {}
if (!NO_CLASSIFIER) {
  try {
    options = { embed: await createLocalEmbedder({ cacheDir: 'debug/hf-cache' }), classifier: loadShippedClassifier() }
  } catch (err) {
    console.error(
      'Embedding model unavailable: ' + (err instanceof Error ? err.message : err) +
        '\nThe first run downloads a ~33 MB model from huggingface.co into debug/hf-cache; after that it works offline.' +
        '\nTo build with the keyword rules alone (weaker tags, no relevance gate), pass --no-classifier. Nothing was written.',
    )
    process.exit(1)
  }
}

const { file, dropped } = await buildFirstHandTicker(archived, { profiles, now }, options)

// Write-then-rename, as buildNewsEvents.mjs does: a browser may be reading this file while an hourly run finishes.
fs.mkdirSync('public/data', { recursive: true })
const tmp = OUTPUT + '.tmp'
const text = JSON.stringify(file, null, 1)
fs.writeFileSync(tmp, text)
try {
  fs.renameSync(tmp, OUTPUT)
} catch {
  fs.writeFileSync(OUTPUT, text)
  fs.rmSync(tmp, { force: true })
}

const byChannel = new Map()
for (const p of file.posts) byChannel.set(p.channelName, (byChannel.get(p.channelName) ?? 0) + 1)
console.log(`Wrote ${OUTPUT}: ${file.posts.length} post(s) from the last ${TICKER_WINDOW_HOURS} h (${NO_CLASSIFIER ? 'keyword topics' : 'classifier topics'}).`)
console.log('  by channel — ' + ([...byChannel].map(([name, n]) => `${name}=${n}`).join(', ') || 'none'))
console.log(
  `  dropped — unsupported-language=${dropped.unsupportedLanguage}, no-text/duplicate=${dropped.noText}, out-of-window=${dropped.outOfWindow}, ` +
    `unsafe (Layer 1 tier A/B)=${dropped.unsafe}, off-topic=${dropped.offTopic}`,
)
