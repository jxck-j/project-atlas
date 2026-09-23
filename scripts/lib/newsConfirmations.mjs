// File I/O for the head-of-state-death review store. Every decision about
// matching, upserting and precedence lives in src/news/confirmations.ts, pure
// and tested; this only reads and writes the file.
//
// WHY archive/ AND NOT debug/ OR src/: the three candidate homes each say
// something different, and this store needs all three properties at once.
//   - debug/ is regenerable diagnostic output. A human's decision is not
//     regenerable — a rebuild would wipe it, which is the exact bug this
//     store exists to fix.
//   - src/news/*.json is committed. These records carry the headline of an
//     unconfirmed claim that a head of state was killed, including the ones a
//     human REJECTED as false. Committing a rejected rumor's text is the same
//     mistake as serving it from public/, just slower.
//   - archive/ is already defined as "data, not source: not regenerable, not
//     committed, this machine only" — which is precisely this file.
// NEWS_ARCHIVE_DIR relocates it, the same as the article archive.
import fs from 'node:fs'
import path from 'node:path'

const DIR = process.env.NEWS_ARCHIVE_DIR ?? 'archive/news'
export const CONFIRMATIONS_FILE = path.join(DIR, 'confirmations.json')

/** Every recorded decision. Empty when the file doesn't exist yet — no decision has been made on this machine. */
export function readConfirmations() {
  if (!fs.existsSync(CONFIRMATIONS_FILE)) return []
  try {
    const parsed = JSON.parse(fs.readFileSync(CONFIRMATIONS_FILE, 'utf8'))
    return Array.isArray(parsed) ? parsed : []
  } catch {
    // A corrupt store must not silently publish an unconfirmed death claim, so
    // fail loudly rather than returning [] (which reads as "nothing decided"
    // and is indistinguishable from the legitimate empty case).
    throw new Error(`${CONFIRMATIONS_FILE} is not valid JSON — fix or remove it; a rebuild would otherwise lose every recorded decision.`)
  }
}

export function writeConfirmations(records) {
  fs.mkdirSync(DIR, { recursive: true })
  fs.writeFileSync(CONFIRMATIONS_FILE, JSON.stringify(records, null, 2) + '\n')
}
