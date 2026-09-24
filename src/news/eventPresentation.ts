import { FIRST_HAND_MEDIA_ENABLED } from './firstHandMedia'
import type { FirstHandSourceEntry, NewsEvent, SourceEntry } from './types'

// Derivations the News tab and the Intelligence Panel both need from an Event.
// Pure and here rather than in hud/, for the same reason corroboration is:
// two surfaces render the same dossier, and a second implementation of
// "which outlets is this" would be free to drift from the first.

/**
 * The Event's card image: the first report in its dossier that carried one.
 *
 * Deliberately not stored on the Event — an image belongs to one publisher's
 * story, not to the occurrence (see `SourceEntryBase.imageUrl`). "First that
 * has one" follows dossier order, which is time-ordered, so a card shows the
 * earliest report's picture. Many Events have none at all; a caller must
 * render a real "no image" treatment rather than substituting a stock photo.
 *
 * For one Event on its own. A FEED renders through `assignEventImages` below
 * instead, which additionally keeps two Events from showing the same picture.
 */
export function eventImageUrl(event: NewsEvent, { firstHandMedia = FIRST_HAND_MEDIA_ENABLED } = {}): string | undefined {
  const own = event.sources.find((s) => s.imageUrl)?.imageUrl
  if (own || !firstHandMedia) return own
  return firstHandEntries(event).find((s) => s.mediaUrl)?.mediaUrl
}

/**
 * The attached first-hand posts, in dossier order. A first-hand entry's `mediaUrl` (never its `imageUrl` — it has none) is only
 * ever used as a FALLBACK picture for an Event that no outlet supplied one for (J, 2026-09-24), and only while
 * FIRST_HAND_MEDIA_ENABLED: see firstHandMedia.ts for why that is off. With it off the build never writes `mediaUrl` at all.
 */
function firstHandEntries(event: NewsEvent): FirstHandSourceEntry[] {
  return event.sources.filter((s): s is FirstHandSourceEntry => s.sourceCategory === 'first-hand')
}

/**
 * One image per Event across a whole feed, chosen so no two Events show the
 * same picture (J, 2026-09-23 — two adjacent Events led with the same Semafor
 * photo, reused by that outlet across a run of related Middle East stories).
 *
 * Greedy in feed order, so an Event's image never changes as more tiles load
 * below it. Per Event it takes the first report in the dossier whose image is:
 *
 *  1. an unused URL from an outlet that hasn't supplied an image yet — the
 *     rule that actually fixes the reported case, since the duplicate was one
 *     outlet reusing a file photo under two different asset URLs, which no
 *     amount of URL comparison can catch;
 *  2. failing that, any unused URL;
 *  3. failing that, nothing — the card falls back to its gradient rather than
 *     repeat a picture already on the page.
 *
 * Honest about its limits: rule 1 only bites while some image-bearing outlet
 * is still unused, i.e. near the top of the feed, which is where a repeat is
 * most visible. Deeper down, two different photos from one outlet are
 * indistinguishable from the same photo twice without actually fetching the
 * images, which a static build doesn't do.
 */
export function assignEventImages(events: NewsEvent[], { firstHandMedia = FIRST_HAND_MEDIA_ENABLED } = {}): Map<string, string> {
  const usedUrls = new Set<string>()
  const usedSources = new Set<string>()
  const assigned = new Map<string, string>()
  for (const event of events) {
    const withImages = event.sources.filter((entry) => entry.imageUrl != null)
    const pick =
      withImages.find((entry) => !usedUrls.has(entry.imageUrl!) && !usedSources.has(entry.sourceId)) ??
      withImages.find((entry) => !usedUrls.has(entry.imageUrl!))
    if (!pick?.imageUrl) {
      // Only an Event with NO outlet image borrows a first-hand picture — not one whose outlet images were merely already on the page.
      const borrowed = firstHandMedia && withImages.length === 0 ? firstHandEntries(event).find((e) => e.mediaUrl && !usedUrls.has(e.mediaUrl))?.mediaUrl : undefined
      if (borrowed) {
        usedUrls.add(borrowed)
        assigned.set(event.id, borrowed)
      }
      continue
    }
    usedUrls.add(pick.imageUrl)
    usedSources.add(pick.sourceId)
    assigned.set(event.id, pick.imageUrl)
  }
  return assigned
}

/** A report's publisher as a reader sees it, whatever category the entry is. */
export function sourceDisplayName(entry: SourceEntry): string {
  switch (entry.sourceCategory) {
    case 'outlet':
      return entry.outlet
    case 'analysis':
      return entry.org
    case 'first-hand':
      return entry.channel
    case 'official-statement':
      return entry.issuingBody
    case 'community-discussion':
      return entry.sourceCommunity
    case 'live-video':
      return 'Live video'
  }
}

/**
 * One entry per distinct publisher, earliest first — what a card means by
 * "reported by N outlets". Distinctness is by `sourceId`, matching
 * `deriveCorroboration`: two feeds from one publisher are one source, and a
 * card must never imply more independent corroboration than the gate counted.
 *
 * First-hand posts are NOT in this list: they attach to an Event without counting toward it (J, 2026-09-24), so including
 * them would make "3 SOURCES" mean two publishers and a channel. They are listed separately by `firstHandSources`.
 */
export function distinctSources(event: NewsEvent): SourceEntry[] {
  const seen = new Set<string>()
  return event.sources.filter((entry) => entry.sourceCategory !== 'first-hand' && (seen.has(entry.sourceId) ? false : (seen.add(entry.sourceId), true)))
}

/** The attached first-hand channels, one entry per channel (its earliest post), for a dossier's separate "first-hand" list. */
export function firstHandSources(event: NewsEvent): FirstHandSourceEntry[] {
  const seen = new Set<string>()
  return firstHandEntries(event).filter((entry) => (seen.has(entry.sourceId) ? false : (seen.add(entry.sourceId), true)))
}
