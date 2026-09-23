// HTML entity decoding for feed text (2026-09-23, reported on the live tab:
// "What Is Saudi Arabia&#x2019;s East-West Pipeline…").
//
// RSS items arrive HTML-escaped, and outlets use the full range of character
// references — not just the handful of named ones. A real count over the
// archive: `&#039;` ×256, `&#x2019;` ×83, `&#8217;` ×49, plus em/en dashes,
// curly quotes and accented letters. Decimal, hex, and named forms all appear,
// sometimes in one feed.
//
// This runs in the BUILD, not the client, and on every path (see
// `eventBuilder`'s `prepare`) — which matters because the article archive is
// append-only: the ~256 records already stored with raw entities can never be
// rewritten, so decoding has to happen when they are read, not when they were
// fetched. `scripts/lib/rss.mjs` decodes too, at parse time, so text entering
// the archive from here on is already clean; decoding twice is harmless since
// the second pass finds nothing left to decode.

const NAMED: Record<string, string> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: ' ',
  hellip: '…',
  mdash: '—',
  ndash: '–',
  rsquo: '’',
  lsquo: '‘',
  ldquo: '“',
  rdquo: '”',
}

/**
 * Decodes named and numeric (decimal or hex) character references in one pass.
 *
 * One pass, deliberately: a second would turn the literal text "&amp;#39;" —
 * which is how a page legitimately writes out an entity it wants a reader to
 * SEE — into an apostrophe. No double-encoded text was found in the archive,
 * so there is nothing to gain against that risk.
 *
 * An unrecognized or malformed reference is left exactly as it was rather than
 * dropped: showing `&#xZZ;` is a visible bug someone can report, while silently
 * deleting it is a wrong headline nobody can see.
 */
export function decodeHtmlEntities(text: string): string {
  return text
    .replace(/&(#[Xx][0-9A-Fa-f]+|#\d+|[A-Za-z][A-Za-z0-9]*);/g, (match, body: string) => {
      if (body[0] !== '#') return NAMED[body.toLowerCase()] ?? match
      const code = body[1] === 'x' || body[1] === 'X' ? Number.parseInt(body.slice(2), 16) : Number.parseInt(body.slice(1), 10)
      if (!Number.isFinite(code) || code <= 0 || code > 0x10ffff) return match
      try {
        return String.fromCodePoint(code)
      } catch {
        // Lone surrogates and other unpaired code points throw — keep the source text.
        return match
      }
    })
    // A decoded &nbsp;/&#xa0; is invisible but not a normal space, and it reaches
    // both the reader and every whitespace-sensitive regex in classify.ts.
    .replace(/ /g, ' ')
}
