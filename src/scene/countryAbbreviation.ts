// Derives a short label for a country name — no new data file (an ISO
// alpha-2/alpha-3 lookup table for all 193 UN members), since this app's
// topology data carries only numeric ISO ids (see CLAUDE.md's "Data
// pipeline" section) and every existing name string already lives in
// countries-un193.json. Multi-word names take initials of their significant
// words ("United Kingdom" -> "UK", "Democratic Republic of the Congo" ->
// "DRC", stop words dropped) — this happens to reproduce a lot of real
// common/ISO abbreviations for free, since that's exactly how most of them
// were coined. Single-word names (Ukraine, Luxembourg, ...) fall back to
// their first few letters. Not guaranteed collision-free (South Africa and
// Saudi Arabia both reduce to "SA") — acceptable for a zoomed-out hint text
// that always has the full name available on hover/click/zoom-in, the same
// tradeoff real-world atlas abbreviations make.
const STOP_WORDS = new Set(['of', 'the', 'and'])
const MAX_INITIALS = 5
const SINGLE_WORD_LENGTH = 3

export function abbreviateCountryName(name: string): string {
  const words = name.split(/[\s-]+/).filter((word) => word.length > 0)
  const significant = words.filter((word) => !STOP_WORDS.has(word.toLowerCase()))

  if (significant.length >= 2) {
    return significant
      .map((word) => word[0])
      .join('')
      .toUpperCase()
      .slice(0, MAX_INITIALS)
  }

  const [only] = words
  return (only ?? name).slice(0, SINGLE_WORD_LENGTH).toUpperCase()
}
