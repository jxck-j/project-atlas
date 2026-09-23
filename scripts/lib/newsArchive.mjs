// The archive's file I/O. All decisions (dedupe, what to append, tolerating a truncated line) live in src/news/articleArchive.ts,
// pure and tested; this only reads the file, asks it what to add, and appends.
//
// NOT regenerable, unlike everything under debug/: an old RSS window can't be re-fetched. Lives in archive/ (gitignored, so it
// exists only on this machine — back it up if it matters). NEWS_ARCHIVE_DIR overrides the location, e.g. to keep it outside a
// git worktree that may be deleted.
import fs from 'node:fs'
import path from 'node:path'
import { parseArchive, planAppend } from '../../src/news/articleArchive.ts'

const DIR = process.env.NEWS_ARCHIVE_DIR ?? 'archive/news'
export const ARCHIVE_FILE = path.join(DIR, 'articles.jsonl')

/** Every archived record, oldest-appended first. Empty when the archive doesn't exist yet (a fresh clone builds from the live pull alone). */
export function readArchive() {
  return fs.existsSync(ARCHIVE_FILE) ? parseArchive(fs.readFileSync(ARCHIVE_FILE, 'utf8')) : []
}

/** Appends whatever isn't archived yet. Returns { added, total, oldest, newest } for the caller to report. */
export function archiveArticles(articles, now) {
  fs.mkdirSync(DIR, { recursive: true })
  const existing = fs.existsSync(ARCHIVE_FILE) ? fs.readFileSync(ARCHIVE_FILE, 'utf8') : ''
  const { added, payload } = planAppend(existing, articles, now)
  if (payload) fs.appendFileSync(ARCHIVE_FILE, payload)
  const all = payload ? [...parseArchive(existing), ...added] : parseArchive(existing)
  const times = all.map((a) => a.publishedAt).filter(Boolean).sort()
  return { added: added.length, total: all.length, oldest: times[0], newest: times[times.length - 1] }
}
