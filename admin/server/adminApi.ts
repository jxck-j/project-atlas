import fs from 'node:fs'
import path from 'node:path'
import type { Connect, Plugin, ViteDevServer } from 'vite'
import { feature } from 'topojson-client'
import { serializeSources, serializeThemes } from '../../src/news/configSerialize'
import { leaningTally, validateSources, validateThemes } from '../../src/news/configValidation'
import { recordDecision, type ConfirmationRecord, type ReviewDecision } from '../../src/news/confirmations'
import type { NewsEvent, SourceProfile, SystemicThemeConfig } from '../../src/news/types'

// The Admin Console's server half (design §14) — Phase 5.
//
// WHY A VITE PLUGIN AND NOT A SERVICE: the console edits the INPUTS to the
// build, not runtime state, so it needs exactly one capability the browser
// doesn't have — writing four files on this machine. A dev-server middleware
// is the smallest thing that provides it: no process to start or stop beside
// the one already running, no port to manage, no deployment story, and no way
// to accidentally ship it (a production build of the console has no server
// behind it, which is why there's no build script for it).
//
// ACCESS CONTROL: none, deliberately, per §14's open question. The server is
// bound to 127.0.0.1 in vite.admin.config.ts, so the only thing that can reach
// it is a process on this machine. Auth would be guarding local files from
// their own owner. If this ever binds to a non-loopback address, that decision
// has to be revisited first — see the host check below, which refuses to serve
// a request that didn't arrive over loopback.

const ROOT = process.cwd()
const SOURCES_FILE = 'src/news/sources.json'
const THEMES_FILE = 'src/news/systemicThemes.json'
const COUNTRIES_FILE = 'public/geo/countries-un193.json'
const PENDING_FILE = 'debug/news-pending-confirmation.json'
const ARCHIVE_DIR = process.env.NEWS_ARCHIVE_DIR ?? 'archive/news'
const CONFIRMATIONS_FILE = path.join(ARCHIVE_DIR, 'confirmations.json')
/** Paths are shown to a human in the console, so display them the way the repo writes them, not the way Windows joins them. */
const display = (file: string) => file.replaceAll('\\', '/')

const read = (file: string): string => fs.readFileSync(path.join(ROOT, file), 'utf8')
const readJson = <T>(file: string, fallback: T): T => {
  try {
    return JSON.parse(read(file)) as T
  } catch {
    return fallback
  }
}
const write = (file: string, body: string) => {
  const target = path.join(ROOT, file)
  fs.mkdirSync(path.dirname(target), { recursive: true })
  fs.writeFileSync(target, body)
}

/** UN-193 topology names plus Taiwan — what a country-native source's `countryName` must resolve against. */
function countryNames(): string[] {
  const topology = readJson<Record<string, never>>(COUNTRIES_FILE, {} as Record<string, never>)
  const objects = (topology as { objects?: Record<string, unknown> }).objects
  if (!objects) return ['Taiwan']
  const collection = feature(topology as never, objects[Object.keys(objects)[0]] as never) as unknown as {
    features: { properties: { name: string } }[]
  }
  return [...collection.features.map((f) => f.properties.name).sort((a, b) => a.localeCompare(b)), 'Taiwan']
}

interface Json {
  status: number
  body: unknown
}

const ok = (body: unknown): Json => ({ status: 200, body })
const bad = (message: string, extra: Record<string, unknown> = {}): Json => ({ status: 400, body: { error: message, ...extra } })

function readBody(req: Connect.IncomingMessage): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = []
    req.on('data', (c: Buffer) => chunks.push(c))
    req.on('end', () => {
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString('utf8')))
      } catch (err) {
        reject(err)
      }
    })
    req.on('error', reject)
  })
}

function putSources(payload: unknown): Json {
  if (!Array.isArray(payload)) return bad('expected an array of source profiles')
  const sources = payload as SourceProfile[]
  // Validate BEFORE writing, never after: a half-written roster would break
  // the build for every run until someone noticed, and the console is the only
  // thing standing between a mistyped field and that file.
  const issues = validateSources(sources, new Set(countryNames()))
  if (issues.length > 0) return bad('refused: the roster would violate a design §7 invariant', { issues })
  write(SOURCES_FILE, serializeSources(sources))
  return ok({ saved: sources.length, tally: leaningTally(sources) })
}

function putThemes(payload: unknown): Json {
  if (!Array.isArray(payload)) return bad('expected an array of themes')
  const themes = payload as SystemicThemeConfig[]
  const issues = validateThemes(themes)
  if (issues.length > 0) return bad('refused: invalid theme config', { issues })
  write(THEMES_FILE, serializeThemes(themes))
  return ok({ saved: themes.length })
}

function postDecision(payload: unknown): Json {
  const { eventId, decision, note } = (payload ?? {}) as { eventId?: string; decision?: ReviewDecision; note?: string }
  if (!eventId) return bad('eventId is required')
  if (decision !== 'confirmed' && decision !== 'rejected') return bad('decision must be "confirmed" or "rejected"')

  // The decision is recorded against the Event as the QUEUE currently holds
  // it, so the stored URL set is the real dossier rather than whatever the
  // browser posted back — the console can't widen or narrow what a decision
  // covers, only make it.
  const pending = readJson<NewsEvent[]>(PENDING_FILE, [])
  const event = pending.find((e) => e.id === eventId)
  if (!event) return bad(`no queued Event with id "${eventId}" — the queue may have been rebuilt since this page loaded`)

  const records = recordDecision(readJson<ConfirmationRecord[]>(CONFIRMATIONS_FILE, []), event, decision, new Date().toISOString(), note?.trim() || undefined)
  write(CONFIRMATIONS_FILE, JSON.stringify(records, null, 2) + '\n')
  return ok({ records, file: display(CONFIRMATIONS_FILE) })
}

async function route(req: Connect.IncomingMessage, url: string): Promise<Json | undefined> {
  const method = req.method ?? 'GET'
  if (method === 'GET' && url === '/api/config') {
    const sources = readJson<SourceProfile[]>(SOURCES_FILE, [])
    return ok({
      sources,
      themes: readJson<SystemicThemeConfig[]>(THEMES_FILE, []),
      countryNames: countryNames(),
      tally: leaningTally(sources),
      files: { sources: SOURCES_FILE, themes: THEMES_FILE },
    })
  }
  if (method === 'GET' && url === '/api/review') {
    const pendingExists = fs.existsSync(path.join(ROOT, PENDING_FILE))
    return ok({
      pending: readJson<NewsEvent[]>(PENDING_FILE, []),
      confirmations: readJson<ConfirmationRecord[]>(CONFIRMATIONS_FILE, []),
      // The queue is regenerable, so "empty" and "never built" look identical
      // in the data and must not in the UI — a console that silently shows an
      // empty queue because no build has run yet is worse than no console.
      queueBuilt: pendingExists,
      files: { pending: display(PENDING_FILE), confirmations: display(CONFIRMATIONS_FILE) },
    })
  }
  if (method === 'PUT' && url === '/api/sources') return putSources(await readBody(req))
  if (method === 'PUT' && url === '/api/themes') return putThemes(await readBody(req))
  if (method === 'POST' && url === '/api/review/decision') return postDecision(await readBody(req))
  return undefined
}

export function adminApi(): Plugin {
  return {
    name: 'atlas-admin-api',
    configureServer(server: ViteDevServer) {
      server.middlewares.use(async (req, res, next) => {
        const url = (req.url ?? '').split('?')[0]
        if (!url.startsWith('/api/')) return next()

        // Loopback-only, enforced here rather than trusted from the bind
        // address alone — this middleware writes to the working tree, so it
        // should refuse a remote caller even if the server is ever started
        // with --host by accident.
        const remote = req.socket.remoteAddress ?? ''
        if (!['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(remote)) {
          res.statusCode = 403
          res.end(JSON.stringify({ error: 'the Admin Console API serves loopback requests only' }))
          return
        }

        try {
          const result = await route(req, url)
          if (!result) return next()
          res.statusCode = result.status
          res.setHeader('Content-Type', 'application/json')
          res.end(JSON.stringify(result.body))
        } catch (err) {
          res.statusCode = 500
          res.setHeader('Content-Type', 'application/json')
          res.end(JSON.stringify({ error: err instanceof Error ? err.message : String(err) }))
        }
      })
    },
  }
}
