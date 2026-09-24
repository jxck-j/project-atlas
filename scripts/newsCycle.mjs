// Phase 6 (cadence): the unattended runner for the News Engine. One entry point, three modes, all meant to be started by a
// scheduler (scripts/schedule/newsTasks.ps1 registers them with Windows Task Scheduler) and all safe to run by hand.
//
//   npm run news:build    Scheduled build (10AM / 10PM). Runs the full default build — local embeddings, no LLM — and publishes
//                         public/data/news-events.json.
//   npm run news:watch    Every 3 hours (newsTasks.ps1). Fetches + archives (cheap, no model), then asks whether anything Critical-looking has
//                         arrived since the last good build. If so, and the cooldown/daily cap allow, runs the same build early.
//   npm run news:ticker   Every hour (newsTasks.ps1). Phase 7 step 5: fetches ONLY the first-hand channels, archives them, and rebuilds
//                         public/data/news-firsthand.json (the per-tab ticker, §15b) — no Event build, no event trigger. If every channel
//                         fails it does NOT rebuild: a rebuild would stamp the file "generated now" over data that is hours old.
//   npm run news:status   Read-only: last build, failure counts, chronically failing feeds, whether the published file is stale.
//
// WHY THIS RUNS LOCALLY, NOT ON A CI RUNNER: the article archive (archive/news/, gitignored, NOT regenerable) lives on this
// machine, and a fresh CI checkout would start with none of it. The runner only WRITES public/data/news-events.json; that file
// is tracked, and nothing here commits or pushes it. Publishing a scheduled run's result is a separate decision (BACKLOG.md).
//
// WHAT THE EVENT TRIGGER IS AND ISN'T: it decides WHEN to build, nothing else. The build it starts is byte-for-byte the
// scheduled one, so a Critical-looking headline that turns out to be a single-outlet rumor still fails the corroboration gate
// and publishes nothing. The decision logic is src/news/cadence.ts (pure, tested); this file is only the I/O around it.
//
// A single lock (archive/news/cycle.lock) keeps two runs from appending to the archive at once — both read the file, then
// append, so a race would write the same articles twice. A run that finds the lock held exits 0 and says so: skipping a tick
// is normal, not an error. A manual `npm run build:news:events` does NOT take this lock; don't start one while a run is going.
import fs from 'node:fs'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { fetchAllArticles } from './lib/fetchSources.mjs'
import { fetchFirstHandArticles, previewUrl } from './lib/fetchTelegram.mjs'
import { ARCHIVE_FILE, archiveArticles, readArchive } from './lib/newsArchive.mjs'
import {
  chronicallyFailingFeeds,
  decideBreakingBuild,
  findBreakingCandidates,
  lockIsStale,
  parseCycleState,
  recordBreakingAttempt,
  recordBuildResult,
  updateFeedStreaks,
} from '../src/news/cadence.ts'

const DIR = path.dirname(ARCHIVE_FILE)
const LOCK_FILE = path.join(DIR, 'cycle.lock')
const STATE_FILE = path.join(DIR, 'cycle-state.json')
const LOG_FILE = path.join(DIR, 'cycle.log')
const LAST_RUN_FILE = 'debug/news-last-run.json'
const OUTPUT = 'public/data/news-events.json'
const TICKER_OUTPUT = 'public/data/news-firsthand.json'
/** How far back an hourly tick reads each channel. Two hours would do; three leaves a whole missed tick's worth of slack for a sleeping laptop. */
const TICKER_LOOKBACK_HOURS = 3
/** Matches STALE_AFTER_MS in hud/FirstHandTicker.tsx — the point where the reader is told the feed has stopped. Informational here: it doesn't change status's exit code. */
const TICKER_STALE_AFTER_MS = 3 * 60 * 60 * 1000
const MAX_LOG_BYTES = 512 * 1024
/** The published file is called stale once this much older than the last scheduled slot could explain: two 12-hour slots plus slack. */
const STALE_AFTER_MS = 26 * 60 * 60 * 1000

const mode = process.argv[2]
const feeds = JSON.parse(fs.readFileSync('src/news/feeds.json', 'utf8'))
const profiles = JSON.parse(fs.readFileSync('src/news/sources.json', 'utf8'))
// Every URL a run attempts: the RSS feeds and the first-hand channels' preview pages. Streaks are tracked per URL.
const targetUrls = [...feeds.map((f) => f.url), ...profiles.filter((p) => p.sourceType === 'first-hand').map((p) => previewUrl(p.channel))]

const stamp = () => new Date().toISOString()
function log(line) {
  const text = `${stamp()} [${mode}] ${line}`
  console.log(text)
  try {
    fs.mkdirSync(DIR, { recursive: true })
    fs.appendFileSync(LOG_FILE, text + '\n')
  } catch {
    // Logging must never be the thing that fails a run.
  }
}

/** Keeps the log to its recent tail, so an unattended machine can't fill a disk with it. Cut on a line boundary. */
function trimLog() {
  try {
    if (fs.statSync(LOG_FILE).size <= MAX_LOG_BYTES) return
    const text = fs.readFileSync(LOG_FILE, 'utf8')
    const tail = text.slice(-MAX_LOG_BYTES / 2)
    fs.writeFileSync(LOG_FILE, tail.slice(tail.indexOf('\n') + 1))
  } catch {
    // no log yet
  }
}

const readState = () => parseCycleState(fs.existsSync(STATE_FILE) ? fs.readFileSync(STATE_FILE, 'utf8') : undefined)
function writeState(state) {
  fs.mkdirSync(DIR, { recursive: true })
  fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 1))
}

function pidAlive(pid) {
  try {
    process.kill(pid, 0)
    return true
  } catch (err) {
    return err.code === 'EPERM' // exists, just not ours
  }
}

/** Returns true if this process now holds the lock. */
function acquireLock() {
  fs.mkdirSync(DIR, { recursive: true })
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      fs.writeFileSync(LOCK_FILE, JSON.stringify({ pid: process.pid, at: stamp(), mode }), { flag: 'wx' })
      return true
    } catch (err) {
      if (err.code !== 'EEXIST') throw err
      let info
      try {
        info = JSON.parse(fs.readFileSync(LOCK_FILE, 'utf8'))
      } catch {
        info = undefined
      }
      if (!lockIsStale(info, Date.now(), info ? pidAlive(info.pid) : false)) {
        log(`skipped: a ${info.mode} run (pid ${info.pid}) has been running since ${info.at}`)
        return false
      }
      log(`breaking a stale lock (${info ? `pid ${info.pid}, ${info.at}` : 'unreadable'})`)
      fs.rmSync(LOCK_FILE, { force: true })
    }
  }
  return false
}
const releaseLock = () => fs.rmSync(LOCK_FILE, { force: true })

/** Runs one of the build scripts as a child process and reports whether it succeeded. Its output goes to the log. */
function runScript(script, args, { label, output, timeoutMs }) {
  const started = Date.now()
  const tsxCli = path.join('node_modules', 'tsx', 'dist', 'cli.mjs')
  const child = spawnSync(process.execPath, [tsxCli, script, ...args], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, timeout: timeoutMs })
  const out = `${child.stdout ?? ''}${child.stderr ?? ''}`.trim()
  for (const line of out.split('\n')) if (line.trim()) log('  | ' + line)
  const seconds = Math.round((Date.now() - started) / 1000)
  if (child.status === 0) {
    log(`${label} ok in ${seconds}s`)
    return { ok: true }
  }
  const why = child.error ? child.error.message : `exit ${child.status}${child.signal ? ` (${child.signal})` : ''}`
  log(`${label} FAILED after ${seconds}s: ${why}. ${output} was left as it was.`)
  return { ok: false, error: why }
}

/** The shipped default Event build. The embedding model download is the only thing that can legitimately take long; an hour is far past any real build. */
function runBuild(reason) {
  log(`build starting (${reason})`)
  return runScript('scripts/buildNewsEvents.mjs', ['--no-backlog-report'], { label: 'build', output: OUTPUT, timeoutMs: 60 * 60 * 1000 })
}

function readLastRun() {
  try {
    return JSON.parse(fs.readFileSync(LAST_RUN_FILE, 'utf8'))
  } catch {
    return undefined
  }
}

/** Folds one run's feed results into the streak map and logs anything that has crossed into "chronically down". */
function noteFeeds(state, failedUrls) {
  const before = new Set(chronicallyFailingFeeds(state.feedFailureStreaks))
  const feedFailureStreaks = updateFeedStreaks(state.feedFailureStreaks, targetUrls, failedUrls)
  const chronic = chronicallyFailingFeeds(feedFailureStreaks)
  for (const url of chronic) if (!before.has(url)) log(`feed has now failed ${feedFailureStreaks[url]} runs in a row: ${url}`)
  for (const url of before) if (!chronic.includes(url)) log(`feed recovered: ${url}`)
  return { ...state, feedFailureStreaks }
}

// ---------------------------------------------------------------------------
async function main() {
  if (mode === 'status') return status()
  if (mode !== 'build' && mode !== 'watch' && mode !== 'ticker') {
    console.error('Usage: newsCycle.mjs build | watch | ticker | status')
    return 2
  }
  trimLog()
  if (!acquireLock()) return 0
  try {
    return mode === 'build' ? await scheduledBuild() : mode === 'watch' ? await watch() : await tickerTick()
  } finally {
    releaseLock()
  }
}

async function scheduledBuild() {
  let state = readState()
  const result = runBuild('scheduled')
  state = recordBuildResult(state, result.ok, stamp(), result.error)
  if (result.ok) {
    const last = readLastRun()
    if (last) state = noteFeeds(state, last.failedFeeds.map((f) => f.url))
  }
  writeState(state)
  if (state.consecutiveBuildFailures >= 2) log(`WARNING: ${state.consecutiveBuildFailures} builds in a row have failed`)
  return result.ok ? 0 : 1
}

async function watch() {
  let state = readState()
  const { articles, failedFeeds, targets } = await fetchAllArticles(feeds, profiles)
  // Every feed failing is an outage, not a quiet hour: say so and exit non-zero so the scheduler's Last Result shows it.
  if (articles.length === 0) {
    log(`no articles fetched (${failedFeeds.length}/${targets.length} feeds and channels failed). Archive untouched.`)
    return 1
  }
  const archived = archiveArticles(articles, stamp())
  state = noteFeeds(state, failedFeeds.map((f) => f.url))
  log(`fetched ${articles.length} from ${targets.length - failedFeeds.length}/${targets.length} feeds and channels; archived ${archived.added} new (${archived.total} total)`)

  // Candidates come from the ARCHIVE (everything first seen since the last good build), not just this tick's additions: a
  // Critical-looking article that arrived while the cooldown was holding must still count when the cooldown lifts.
  const sinceMs = state.lastBuildAt ? Date.parse(state.lastBuildAt) : 0
  const unbuilt = readArchive().filter((a) => !a.firstSeenAt || Date.parse(a.firstSeenAt) > sinceMs)
  // First-hand channels are archived but do not trigger an early build (yet): a channel's "BREAKING" is far noisier than an
  // outlet headline, and the daily cap on event-triggered builds is finite — letting rumors spend it would starve real triggers.
  const outletIds = new Set(profiles.filter((p) => p.sourceType !== 'first-hand').map((p) => p.id))
  const candidates = findBreakingCandidates(unbuilt, outletIds, Date.now())
  const decision = decideBreakingBuild(candidates, state, Date.now())
  log(`trigger: ${decision.run ? 'BUILD' : 'no build'} — ${decision.reason}`)
  if (decision.run) for (const c of candidates.slice(0, 5)) log(`  candidate (${c.reason}): [${c.article.sourceId}] ${c.article.title}`)

  if (!decision.run) {
    writeState(state)
    return 0
  }
  state = recordBreakingAttempt(state, Date.now())
  // Persisted BEFORE the build: a run killed mid-build (logoff, shutdown, the task's time limit) would otherwise lose the
  // attempt, and the next tick would retry with no cooldown.
  writeState(state)
  const result = runBuild('event-triggered')
  state = recordBuildResult(state, result.ok, stamp(), result.error)
  writeState(state)
  return result.ok ? 0 : 1
}

/**
 * Phase 7 step 5 — the hourly first-hand refresh (§15c: "separate, faster build cadence"). Fetch the channels only, archive, rebuild the
 * ticker file. Deliberately does NOT touch cycle-state.json: feed-failure streaks are per URL across ALL feeds, and a channels-only run
 * would count every RSS feed as "succeeded" and reset their streaks; `news:watch` (which fetches everything) keeps owning the streaks.
 */
async function tickerTick() {
  const channels = profiles.filter((p) => p.sourceType === 'first-hand')
  const { articles, failedFeeds } = await fetchFirstHandArticles(channels, { lookbackHours: TICKER_LOOKBACK_HOURS })
  for (const f of failedFeeds) log(`  channel failed: ${f.sourceId} (${f.url}): ${f.error}`)
  // Every channel failing is an outage. Rebuilding anyway would refresh the file's "generated" stamp over posts that are hours old,
  // and the ticker's UPDATED/STALE label — the only thing telling a reader the feed has stopped — would lie. Leave the file to age.
  if (articles.length === 0) {
    log(`no posts fetched (${failedFeeds.length}/${channels.length} channels failed). Archive and ${TICKER_OUTPUT} untouched.`)
    return 1
  }
  const archived = archiveArticles(articles, stamp())
  log(`fetched ${articles.length} post(s) from ${channels.length - failedFeeds.length}/${channels.length} channels; archived ${archived.added} new (${archived.total} total)`)
  return runScript('scripts/buildFirstHandTicker.mjs', [], { label: 'ticker build', output: TICKER_OUTPUT, timeoutMs: 15 * 60 * 1000 }).ok ? 0 : 1
}

function status() {
  const state = readState()
  const hours = (iso) => ((Date.now() - Date.parse(iso)) / 3_600_000).toFixed(1)
  console.log(`Last good build: ${state.lastBuildAt ? `${state.lastBuildAt} (${hours(state.lastBuildAt)}h ago)` : 'none recorded'}`)
  if (state.lastBuildOk === false) console.log(`Last build FAILED (${state.consecutiveBuildFailures} in a row): ${state.lastBuildError}`)
  const chronic = chronicallyFailingFeeds(state.feedFailureStreaks)
  console.log(chronic.length ? `Chronically failing feeds (${chronic.length}):\n` + chronic.map((u) => `  ${state.feedFailureStreaks[u]}x  ${u}`).join('\n') : 'No chronically failing feeds.')
  console.log(`Event-triggered attempts in the last 24h: ${state.breakingAttempts.length}`)
  const last = readLastRun()
  if (last) console.log(`Last build summary: ${last.published} Events published (${JSON.stringify(last.severity)}), ${last.pending} pending confirmation, ${last.failedFeeds.length}/${last.feedsTotal} feeds failed.`)
  if (fs.existsSync(TICKER_OUTPUT)) {
    const tickerAge = Date.now() - fs.statSync(TICKER_OUTPUT).mtimeMs
    console.log(`${TICKER_OUTPUT}: ${(tickerAge / 3_600_000).toFixed(1)}h old${tickerAge > TICKER_STALE_AFTER_MS ? '  <-- STALE: the ticker calls itself stale past 3h; is the ticker task running?' : ''}`)
  } else {
    console.log(`${TICKER_OUTPUT}: missing (npm run news:ticker builds it)`)
  }
  if (fs.existsSync(OUTPUT)) {
    const age = Date.now() - fs.statSync(OUTPUT).mtimeMs
    console.log(`${OUTPUT}: ${(age / 3_600_000).toFixed(1)}h old${age > STALE_AFTER_MS ? '  <-- STALE: no successful build in over a day' : ''}`)
    return age > STALE_AFTER_MS ? 1 : 0
  }
  console.log(`${OUTPUT}: missing`)
  return 1
}

process.exitCode = await main()
