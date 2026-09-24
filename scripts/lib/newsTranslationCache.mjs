// File-backed cache for src/news/translation.ts. Lives under debug/ (gitignored): it is regenerable, but not cheaply — NLLB is
// several seconds per headline on CPU — so it is flushed as it grows rather than only at the end, and an interrupted first run
// keeps what it finished. Never pruned by this module: a headline that ages out of the feed window is simply never looked up again.
import fs from 'node:fs'

export const TRANSLATION_CACHE_FILE = 'debug/news-translation-cache.json'
const FLUSH_EVERY = 20

export function openTranslationCache(file = TRANSLATION_CACHE_FILE) {
  let store
  try {
    store = new Map(Object.entries(JSON.parse(fs.readFileSync(file, 'utf8'))))
  } catch {
    store = new Map()
  }
  let unsaved = 0
  const flush = () => {
    fs.mkdirSync('debug', { recursive: true })
    const tmp = file + '.tmp'
    fs.writeFileSync(tmp, JSON.stringify(Object.fromEntries(store)))
    fs.renameSync(tmp, file)
    unsaved = 0
  }
  return {
    get: (key) => store.get(key),
    set: (key, value) => {
      store.set(key, value)
      if (++unsaved >= FLUSH_EVERY) flush()
    },
    flush: () => {
      if (unsaved > 0) flush()
    },
    size: () => store.size,
  }
}
