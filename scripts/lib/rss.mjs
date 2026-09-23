// Minimal RSS 2.0 <item> parser — feeds the article archive and the Event
// build through scripts/lib/fetchFeeds.mjs. No XML-parsing dependency exists in
// this project, and RSS <item> blocks are simple/well-known enough (a handful of
// flat child tags, some CDATA-wrapped) not to need one — same "hand-roll it, it's
// simple enough" precedent as scripts/lib/csv.mjs.
//
// Deliberately not a general XML parser: only extracts the fields the pipeline
// actually reads (title/description/link/pubDate/guid/imageUrl), each via its own
// tag-scoped regex, tolerant of CDATA wrapping or plain text. A feed with
// attributes on these tags (e.g. BBC's <guid isPermaLink="...">) or extra
// namespaced tags (dc:creator, ...) is unaffected — those are simply never
// matched, not misparsed.
import { decodeHtmlEntities as decodeEntities } from '../../src/news/htmlEntities.ts'

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

/**
 * Parses every <item> block in an RSS 2.0 feed's raw XML text.
 * Returns { title, description, link, pubDate, guid, imageUrl } per item —
 * any field absent from a given feed's items is simply undefined, not an
 * error. `imageUrl` is read from `<media:thumbnail url="...">`, then
 * `<enclosure url="..." type="image/...">`, then `<media:content url="...">` —
 * three conventions because the vetted roster's feeds use all three, and 14 of
 * 24 ship an image at all (measured for the Phase 4 cutover, when cards became
 * thumbnail-forward).
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
