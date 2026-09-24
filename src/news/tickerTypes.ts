import { SEVERITY_RANK } from './severity'
import type { FirstHandTier, Severity, TopicTag } from './types'

// The ticker file's shape and constants, on their own so the CLIENT can import them without pulling the build's rule modules
// (classify.ts's regexes, the classifier, the event builder) into the browser bundle. Types, constants and the one pure helper the UI needs.

/** How far back the ticker reaches. */
export const TICKER_WINDOW_HOURS = 24
/** The file's size cap on ordinary (24 h) posts: the newest win. The client filters this down again per tab. Pins are not counted against it. */
export const MAX_TICKER_POSTS = 300

// AUTO-PINNING (J, 2026-09-24: "pin should be automatic based on our phrasing logic built for the news events"). A post is pinned when
// the SAME keyword severity rules the Events use (classify.ts) rate its wording Major or Critical, and it then outlives the 24 h window.
// Note what that means: it is a judgement about the WORDING of an unverified post, not about whether the thing happened.
/** Lowest severity that pins. */
export const PIN_MIN_SEVERITY: Severity = 'major'
/** How long a pin stays. Matches feedWindow.ts's FEED_RETENTION_DAYS (a test holds the two together) — a pin lives as long as an Event would. */
export const PIN_RETENTION_DAYS = 14
/** Pins the file carries at most (most severe, then newest). */
export const MAX_PINNED_POSTS = 60
/** Pins one tab shows. A pin is a headline, and a tab of ten would stop being one. */
export const MAX_PINS_PER_TAB = 3

export const qualifiesForPin = (severity: Severity): boolean => SEVERITY_RANK[severity] >= SEVERITY_RANK[PIN_MIN_SEVERITY]

export interface TickerPost {
  /** Stable id: the post's URL is unique per channel message. */
  id: string
  sourceId: string
  /** Display name of the channel ("Clash Report"). */
  channelName: string
  /** Telegram handle without "@". */
  channel: string
  channelTier: FirstHandTier
  /** Factual; shown beside the channel name (§15a: whose voice this is stays visible). */
  affiliationNote?: string
  text: string
  url: string
  publishedAt: string
  topicTags: TopicTag[]
  /** What the Events' keyword severity rules make of this post's wording, with the same tag-based caps. NOT a verification of anything. */
  severity: Severity
  /** Set on the ONE post per story that the pin rule picked (near-duplicates are folded into it), whatever its age up to PIN_RETENTION_DAYS. */
  pinned?: true
  /** Display name of the channel it was forwarded from, when it was a forward. */
  forwardedFrom?: string
}

export interface TickerFile {
  /** When the ticker was built. The client shows "updated Xm ago" from this — the file's whole point is being fresh. */
  generatedAt: string
  posts: TickerPost[]
}

/**
 * The pins to show on a tab: pinned posts carrying its tag, still inside PIN_RETENTION_DAYS on the READER's clock (a file that stopped
 * being rebuilt must not keep a pin alive forever), most severe first, then newest, at most MAX_PINS_PER_TAB.
 */
export function selectPinnedPosts(posts: TickerPost[], topicTag: TopicTag, now: number): TickerPost[] {
  const earliest = now - PIN_RETENTION_DAYS * 86_400_000
  return posts
    .filter((p) => p.pinned && p.topicTags.includes(topicTag) && Date.parse(p.publishedAt) >= earliest && Date.parse(p.publishedAt) <= now)
    .sort((a, b) => SEVERITY_RANK[b.severity] - SEVERITY_RANK[a.severity] || Date.parse(b.publishedAt) - Date.parse(a.publishedAt))
    .slice(0, MAX_PINS_PER_TAB)
}
