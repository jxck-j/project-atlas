import type { RawArticle } from './eventBuilder'
import { decodeHtmlEntities } from './htmlEntities'
import type { FirstHandProfile } from './types'

// Parses Telegram's public web preview (`https://t.me/s/<channel>`) — Phase 7's keyless first-hand source (LOGBOOK.md,
// 2026-09-23). Pure: no network, no fs. scripts/lib/fetchTelegram.mjs fetches and pages; this only understands one page.
//
// It is one implementation behind "a page of channel posts in, RawArticles out". If the Telegram API (GramJS) replaces it,
// only the fetcher changes — everything downstream (gating, tiering, corroboration) sees the same RawArticle.
//
// WHY A HAND-ROLLED PARSER: same precedent as scripts/lib/rss.mjs — no DOM dependency exists in this project, and the
// preview markup is a fixed, flat class vocabulary (`tgme_widget_message_*`). Like rss.mjs it is deliberately NOT a general
// HTML parser; it reads the handful of fields the pipeline needs and ignores the rest. The preview is not a documented
// API, so if Telegram changes the markup this is the file that breaks — `parseTelegramPreview` returning [] for a page
// that visibly has posts is the symptom, and fetchTelegram.mjs reports an empty first page as a failure for that reason.

export interface PreviewPost {
  /** As Telegram spells it in `data-post` (the case can differ from the roster's `channel`). */
  channel: string
  /** The message number: unique and increasing within a channel, and what `?before=` pages on. */
  id: number
  url: string
  /** ISO 8601, from the post's own `<time datetime>`. */
  publishedAt?: string
  /** Plain text, HTML decoded but NOT yet cleaned (see cleanPostText). Empty for a media-only post. */
  text: string
  hasVideo: boolean
  /** The first photo, or a video's thumbnail — the CDN URL Telegram serves the preview from. */
  mediaUrl?: string
  /** Display name of the channel it was forwarded from, when it was a forward. */
  forwardedFrom?: string
}

// Photos and video thumbnails are both a `background-image:url('…')` on their own element (an album has several photo wraps; the first is enough).
const MEDIA_URL = /class="[^"]*tgme_widget_message_(?:photo_wrap|video_thumb)[^"]*"[^>]*?style="[^"]*?background-image:url\('([^']+)'\)/

const stripTags =(html: string): string => html.replace(/<[^>]*>/g, '')

function htmlToText(inner: string): string {
  // <br> and the end of a quote are the only line structure the preview uses.
  return decodeHtmlEntities(stripTags(inner.replace(/<br\s*\/?>/gi, '\n').replace(/<\/(?:blockquote|pre)>/gi, '\n')))
}

// The post's text container. In an ALBUM the container is nested inside another one with the same class, so the first
// opener would swallow the wrapper's markup — take the LAST opener and read to the first close after it. Telegram's text
// formatting is inline (b/i/a/code/blockquote), never a <div>, so that close is the container's own.
const TEXT_OPEN = /<div class="tgme_widget_message_text js-message_text"[^>]*>/g

function extractText(block: string): string {
  // A reply quotes the message it answers in its own anchor; that snippet is not this post's text.
  const withoutReply = block.replace(/<a class="tgme_widget_message_reply[\s\S]*?<\/a>/g, '')
  let last = -1
  let end = -1
  for (const m of withoutReply.matchAll(TEXT_OPEN)) {
    last = m.index!
    end = m.index! + m[0].length
  }
  if (last === -1) return ''
  const close = withoutReply.indexOf('</div>', end)
  return htmlToText(withoutReply.slice(end, close === -1 ? undefined : close))
}

/**
 * Posts on ONE preview page, in the order Telegram lists them (oldest first). Album members and service messages that carry
 * neither text nor video still come back, with empty text — the caller decides what to keep.
 */
export function parseTelegramPreview(html: string): PreviewPost[] {
  const posts: PreviewPost[] = []
  for (const block of html.split('<div class="tgme_widget_message_wrap').slice(1)) {
    const ref = block.match(/data-post="([A-Za-z0-9_]+)\/(\d+)"/)
    if (!ref) continue
    const parsed = Date.parse(block.match(/<time[^>]*datetime="([^"]+)"/)?.[1] ?? '')
    const forwarded = block.match(/tgme_widget_message_forwarded_from_(?:name|author)[^>]*>([\s\S]*?)<\/(?:a|span)>/)?.[1]
    const forwardedFrom = forwarded ? decodeHtmlEntities(stripTags(forwarded)).trim() : ''
    const media = block.match(MEDIA_URL)?.[1]
    posts.push({
      channel: ref[1],
      id: Number(ref[2]),
      url: `https://t.me/${ref[1]}/${ref[2]}`,
      ...(Number.isNaN(parsed) ? {} : { publishedAt: new Date(parsed).toISOString() }),
      text: extractText(block),
      // Round videos and GIFs render as <video> too; a GIF of combat footage is still combat footage, so all count.
      hasVideo: /tgme_widget_message_(?:round)?video_player|<video\b/.test(block),
      ...(media ? { mediaUrl: decodeHtmlEntities(media) } : {}),
      ...(forwardedFrom ? { forwardedFrom } : {}),
    })
  }
  return posts
}

// ---------------------------------------------------------------------------
// Cleaning (design §15c's "automated noise filter")

const TME_LINK = /https?:\/\/(?:www\.)?t\.me\/\S+/gi
// Emoji, flags (regional indicators), and the joiners/variation selectors that glue them. Stripped, not kept: a headline
// that starts "🇷🇺❌🇺🇦 —" hands the classifier and the embedder noise, and the words carry the story.
const EMOJI = /[\p{Extended_Pictographic}\u{1F1E6}-\u{1F1FF}]|\u{FE0F}|\u{200D}|\u{20E3}/gu
// A channel signs its posts with its own handle ("… – Yonhap @Middle_East_Spectator"). Only a TRAILING mention is a signature;
// an inline one is usually a person being quoted.
const TRAILING_HANDLE = /\s*@[A-Za-z0-9_]{5,32}\s*$/
const LEADING_RESIDUE = /^[\s\-–—|:•·/]+/
const PROMO_LINE = /^(?:subscribe|follow us|join us|join our)\b.{0,60}$/i

/**
 * Conservative on purpose — this is applied to text that may be perfectly good news, so it names specific solicitations
 * rather than words like "donate", which would drop "Musk to donate $1bn". A post that IS an ad is removed whole.
 */
const PROMOTIONAL = /\b(?:buymeacoffee|patreon\.com|promo code|use code|sponsored (?:post|content)|paid promotion|for (?:ads|advertising|paid promotions?) (?:contact|dm))\b/i

export function isPromotional(text: string): boolean {
  return PROMOTIONAL.test(text)
}

export function cleanPostText(text: string): string {
  const lines = text
    .replace(TME_LINK, '')
    .replace(EMOJI, '')
    .split('\n')
    .map((line) => line.replace(TRAILING_HANDLE, '').replace(LEADING_RESIDUE, '').replace(/[ \t]+/g, ' ').trim())
    .filter((line) => line !== '' && !PROMO_LINE.test(line))
  return lines.join('\n')
}

// ---------------------------------------------------------------------------

/** Longest first line kept as a title. A channel's "headline" is often the whole post; the rest goes to the description. */
const MAX_TITLE_CHARS = 300

function splitTitle(cleaned: string): { title: string; description?: string } {
  const [first, ...rest] = cleaned.split('\n')
  let title = first
  let overflow = ''
  if (title.length > MAX_TITLE_CHARS) {
    const cut = title.lastIndexOf(' ', MAX_TITLE_CHARS)
    const at = cut > MAX_TITLE_CHARS / 2 ? cut : MAX_TITLE_CHARS
    overflow = title.slice(at).trim()
    title = title.slice(0, at).trimEnd() + '…'
  }
  const description = [overflow, ...rest].filter(Boolean).join(' ')
  return description ? { title, description } : { title }
}

/**
 * A preview post as the archive's record. Null when there is nothing to keep: no text and no video (a bare photo or a service
 * message), or an advertisement.
 *
 * A video-only post IS kept, with an empty title — that is the "keep video" half of J's 2026-09-23 language decision:
 * footage isn't language-bound, and it is what the deferred Frontlines surface (§15e) will read. The build drops an
 * empty-title article (eventBuilder.ts), and nothing displays `hasVideo` until the NSFW filter exists.
 *
 * Never sets `imageUrl` — see RawArticle.hasVideo. The picture goes in `mediaUrl` instead, which nothing renders.
 */
export function postToRawArticle(post: PreviewPost, profile: FirstHandProfile): RawArticle | null {
  const cleaned = cleanPostText(post.text)
  if (isPromotional(post.text)) return null
  if (cleaned === '' && !post.hasVideo) return null
  const { title, description } = cleaned === '' ? { title: '', description: undefined } : splitTitle(cleaned)
  return {
    sourceId: profile.id,
    title,
    ...(description ? { description } : {}),
    url: post.url,
    ...(post.publishedAt ? { publishedAt: post.publishedAt } : {}),
    // The channel's configured language, like a feed's (feeds.json) — not detected per post. Absent = English.
    ...(profile.language ? { language: profile.language } : {}),
    ...(post.hasVideo ? { hasVideo: true as const } : {}),
    ...(post.mediaUrl ? { mediaUrl: post.mediaUrl } : {}),
    ...(post.forwardedFrom ? { forwardedFrom: post.forwardedFrom } : {}),
  }
}
