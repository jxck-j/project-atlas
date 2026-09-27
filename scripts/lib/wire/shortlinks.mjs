// Resolves a publisher's own link-shortener URLs (reut.rs/…, AP's bit.ly/…) to the article URL they redirect to. ONE HEAD request per
// short link, sent to the SHORTENER — never to the publisher's site — reading the Location header without following it. Successes are
// cached in debug/ (gitignored, regenerable): the same post shows up in every run for days, and a 100-post page would otherwise cost
// 100 requests each time. A failure is NOT cached (the next run retries) and yields undefined, which the caller treats as "keep the short link".
import fs from 'node:fs'

export const SHORTLINK_CACHE_FILE = 'debug/wire-shortlink-cache.json'
const MAX_HOPS = 3 // a shortener may chain through another one

async function resolveOne(url, isShortener) {
  let current = url
  for (let hop = 0; hop < MAX_HOPS; hop++) {
    const res = await fetch(current, { method: 'HEAD', redirect: 'manual', headers: { 'User-Agent': 'Mozilla/5.0 (compatible; ProjectAtlasNewsBot/1.0)' }, signal: AbortSignal.timeout(10_000) })
    const location = res.headers.get('location')
    if (res.status < 300 || res.status >= 400 || !location) return undefined
    current = new URL(location, current).toString()
    if (!isShortener(current)) return current
  }
  return undefined
}

/**
 * @param {string[]} urls short links
 * @param {{ isShortener: (url: string) => boolean, cacheFile?: string, concurrency?: number }} opts
 * @returns {Promise<Map<string, string | undefined>>} short link -> resolved URL (undefined = could not resolve)
 */
export async function resolveShortlinks(urls, { isShortener, cacheFile = SHORTLINK_CACHE_FILE, concurrency = 6 }) {
  let cache = {}
  try {
    cache = JSON.parse(fs.readFileSync(cacheFile, 'utf8'))
  } catch {
    // no cache yet, or unreadable: rebuild it
  }
  const out = new Map()
  const todo = []
  for (const u of new Set(urls)) {
    if (cache[u]) out.set(u, cache[u])
    else todo.push(u)
  }
  let next = 0
  await Promise.all(
    Array.from({ length: Math.min(concurrency, todo.length) }, async () => {
      while (next < todo.length) {
        const u = todo[next++]
        try {
          const resolved = await resolveOne(u, isShortener)
          out.set(u, resolved)
          if (resolved) cache[u] = resolved
        } catch {
          out.set(u, undefined)
        }
      }
    }),
  )
  if (todo.length > 0) {
    fs.mkdirSync('debug', { recursive: true })
    const tmp = cacheFile + '.tmp'
    fs.writeFileSync(tmp, JSON.stringify(cache))
    fs.renameSync(tmp, cacheFile)
  }
  return out
}
