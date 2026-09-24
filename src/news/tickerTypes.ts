import type { FirstHandTier, TopicTag } from './types'

// The ticker file's shape and constants, on their own so the CLIENT can import them without pulling the build's rule modules
// (classify.ts's regexes, the classifier, the event builder) into the browser bundle. Types and two numbers only.

/** How far back the ticker reaches. */
export const TICKER_WINDOW_HOURS = 24
/** The file's size cap: the newest posts win. The client filters this down again per tab. */
export const MAX_TICKER_POSTS = 300

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
  /** Display name of the channel it was forwarded from, when it was a forward. */
  forwardedFrom?: string
}

export interface TickerFile {
  /** When the ticker was built. The client shows "updated Xm ago" from this — the file's whole point is being fresh. */
  generatedAt: string
  posts: TickerPost[]
}
