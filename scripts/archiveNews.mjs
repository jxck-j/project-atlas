// Fetch-only capture of the vetted outlets' feeds into the append-only article archive. No embedding model, no classification, no
// Events — cheap enough to run every few hours, which matters because an RSS window that rolls off unrecorded is gone for good.
// `npm run build:news:events` archives too (same dedupe), so this is only for capturing more often than you rebuild.
//
//   npm run archive:news
//
// Where the archive lives and why it isn't in debug/: scripts/lib/newsArchive.mjs.
import fs from 'node:fs'
import { fetchFeedArticles } from './lib/fetchFeeds.mjs'
import { ARCHIVE_FILE, archiveArticles } from './lib/newsArchive.mjs'

const feeds = JSON.parse(fs.readFileSync('src/news/feeds.json', 'utf8'))
const { articles, feedFailures } = await fetchFeedArticles(feeds)
for (const failure of feedFailures) console.warn(`  feed failed: ${failure}`)

// Every feed failing is an outage, not an empty day: say so and exit non-zero so a scheduler notices.
if (articles.length === 0) {
  console.error(`No articles fetched (${feedFailures.length}/${feeds.length} feeds failed). Archive untouched.`)
  process.exit(1)
}

const r = archiveArticles(articles, new Date().toISOString())
console.log(`Fetched ${articles.length} articles from ${feeds.length - feedFailures.length}/${feeds.length} feeds; archived ${r.added} new.`)
console.log(`${ARCHIVE_FILE}: ${r.total} articles, published ${r.oldest?.slice(0, 10) ?? '?'} to ${r.newest?.slice(0, 10) ?? '?'}.`)
