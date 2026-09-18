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

function decodeEntities(text) {
  return text
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&apos;/g, "'")
}

/**
 * Parses every <item> block in an RSS 2.0 feed's raw XML text.
 * Returns { title, description, link, pubDate, guid, imageUrl } per item —
 * any field absent from a given feed's items is simply undefined, not an
 * error. `imageUrl` is read from `<media:thumbnail url="...">` (the only of
 * the three v1 outlets that actually populates it is BBC — see
 * buildNews.mjs's own header comment) with `<enclosure url="..." type="image/...">`
 * as a fallback for a feed that uses that convention instead.
 */
export function parseRssItems(xmlText) {
  const itemBlocks = xmlText.match(/<item\b[^>]*>[\s\S]*?<\/item>/gi) ?? []
  return itemBlocks.map((block) => ({
    title: extractTag(block, 'title'),
    description: extractTag(block, 'description'),
    link: extractTag(block, 'link'),
    pubDate: extractTag(block, 'pubDate'),
    guid: extractTag(block, 'guid'),
    imageUrl: extractAttr(block, 'media:thumbnail', 'url') ?? extractAttr(block, 'enclosure', 'url'),
  }))
}
