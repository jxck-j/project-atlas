// Minimal RSS 2.0 <item> parser — shared by scripts/buildNews.mjs's outlet
// feeds (BBC World, Al Jazeera, Bloomberg). No XML-parsing dependency exists
// in this project yet, and RSS <item> blocks are simple/well-known enough
// (a handful of flat child tags, some CDATA-wrapped) not to need one — same
// "hand-roll it, it's simple enough" precedent as scripts/lib/csv.mjs.
//
// Deliberately not a general XML parser: only extracts the five fields
// buildNews.mjs actually reads (title/description/link/pubDate/guid), each
// via its own tag-scoped regex, tolerant of CDATA wrapping or plain text.
// A feed with attributes on these tags (e.g. BBC's <guid isPermaLink="...">)
// or extra namespaced tags (dc:creator, media:thumbnail, ...) is unaffected
// — those are simply never matched, not misparsed.

function extractTag(itemXml, tag) {
  const re = new RegExp(`<${tag}[^>]*>\\s*(?:<!\\[CDATA\\[([\\s\\S]*?)\\]\\]>|([\\s\\S]*?))\\s*<\\/${tag}>`, 'i')
  const match = itemXml.match(re)
  if (!match) return undefined
  const raw = (match[1] ?? match[2] ?? '').trim()
  return raw.length > 0 ? decodeEntities(raw) : undefined
}

// Self-closing attribute-only tag, e.g. BBC's
// <media:thumbnail width="240" height="135" url="..."/> — no separate close
// tag, no text content, just an attribute to pull out.
function extractAttr(itemXml, tag, attr) {
  const re = new RegExp(`<${tag}\\b[^>]*\\b${attr}="([^"]*)"[^>]*/?>`, 'i')
  const match = itemXml.match(re)
  return match ? decodeEntities(match[1]) : undefined
}

// Named AND numeric character references. The original handled six named forms plus
// the single numeric `&#39;`, which missed most of what real feeds actually send —
// a count over the article archive found `&#039;` ×256, `&#x2019;` ×83, `&#8217;`
// ×49, plus dashes, curly quotes and accented letters, all of which reached the UI
// as raw "&#x2019;" text (reported 2026-09-23).
//
// The canonical decoder is src/news/htmlEntities.ts, which the BUILD applies to
// every article — including the ones already archived with raw entities, which
// this fix can't reach because the archive is append-only. This copy stays a
// small, dependency-free duplicate on purpose: v1's scripts/buildNews.mjs imports
// this file under plain `node`, which cannot import a .ts module. Keep the two in
// step; decoding twice is harmless.
const NAMED_ENTITIES = {
  amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ',
  hellip: '…', mdash: '—', ndash: '–', rsquo: '’', lsquo: '‘', ldquo: '“', rdquo: '”',
}

function decodeEntities(text) {
  return text
    .replace(/&(#[Xx][0-9A-Fa-f]+|#\d+|[A-Za-z][A-Za-z0-9]*);/g, (match, body) => {
      if (body[0] !== '#') return NAMED_ENTITIES[body.toLowerCase()] ?? match
      const code = body[1] === 'x' || body[1] === 'X' ? Number.parseInt(body.slice(2), 16) : Number.parseInt(body.slice(1), 10)
      if (!Number.isFinite(code) || code <= 0 || code > 0x10ffff) return match
      try {
        return String.fromCodePoint(code)
      } catch {
        return match
      }
    })
    .replace(/ /g, ' ')
}

/**
 * Parses every <item> block in an RSS 2.0 feed's raw XML text.
 * Returns { title, description, link, pubDate, guid, imageUrl } per item —
 * any field absent from a given feed's items is simply undefined, not an
 * error. `imageUrl` is read from `<media:thumbnail url="...">` (the only of
 * the three v1 outlets that actually populates it is BBC — see
 * buildNews.mjs's own header comment) with `<enclosure url="..." type="image/...">`
 * and then `<media:content url="...">` as fallbacks for feeds using those
 * conventions instead — added 2026-09-23 for the Phase 4 cutover, when the
 * v2 roster's feeds (not just v1's three outlets) started being read for
 * card thumbnails.
 */
export function parseRssItems(xmlText) {
  const itemBlocks = xmlText.match(/<item\b[^>]*>[\s\S]*?<\/item>/gi) ?? []
  return itemBlocks.map((block) => ({
    title: extractTag(block, 'title'),
    description: extractTag(block, 'description'),
    link: extractTag(block, 'link'),
    pubDate: extractTag(block, 'pubDate'),
    guid: extractTag(block, 'guid'),
    imageUrl:
      extractAttr(block, 'media:thumbnail', 'url') ??
      extractAttr(block, 'enclosure', 'url') ??
      extractAttr(block, 'media:content', 'url'),
  }))
}
