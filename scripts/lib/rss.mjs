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
  // `(?:\\s[^>]*)?` rather than `[^>]*`: the latter lets `<link` match SABA's `<linkShortURL>` and swallow two tags.
  const re = new RegExp(`<${tag}(?:\\s[^>]*)?>\\s*(?:<!\\[CDATA\\[([\\s\\S]*?)\\]\\]>|([\\s\\S]*?))\\s*<\\/${tag}>`, 'i')
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
  if (itemBlocks.length === 0) return parseAtomEntries(xmlText)
  return itemBlocks.map((block) => ({
    title: extractTag(block, 'title'),
    description: extractTag(block, 'description'),
    link: extractTag(block, 'link'),
    // RSS 1.0/RDF feeds (AllAfrica) date items with Dublin Core instead of pubDate.
    pubDate: extractTag(block, 'pubDate') ?? extractTag(block, 'dc:date'),
    guid: extractTag(block, 'guid'),
    imageUrl:
      extractAttr(block, 'media:thumbnail', 'url') ??
      extractAttr(block, 'enclosure', 'url') ??
      extractAttr(block, 'media:content', 'url'),
  }))
}

// Atom 1.0 (<entry>) — Business Insider and Maritime Executive ship Atom rather than RSS, returned in the same shape so
// fetchFeeds.mjs never has to know which format a feed uses. An entry's link is an attribute, not text; prefer the
// rel="alternate" one (the article), falling back to the first <link href>.
function parseAtomEntries(xmlText) {
  const entryBlocks = xmlText.match(/<entry\b[^>]*>[\s\S]*?<\/entry>/gi) ?? []
  return entryBlocks.map((block) => {
    const links = [...block.matchAll(/<link\b[^>]*>/gi)].map((m) => m[0])
    const article = links.find((l) => /rel=["']alternate["']/i.test(l)) ?? links.find((l) => !/rel=/i.test(l)) ?? links[0]
    const href = article?.match(/href=["']([^"']+)["']/i)?.[1]
    return {
      title: extractTag(block, 'title'),
      description: extractTag(block, 'summary') ?? extractTag(block, 'content'),
      link: href ? decodeEntities(href) : undefined,
      pubDate: extractTag(block, 'published') ?? extractTag(block, 'updated'),
      guid: extractTag(block, 'id'),
      imageUrl: extractAttr(block, 'media:thumbnail', 'url') ?? extractAttr(block, 'media:content', 'url'),
    }
  })
}
