import { useEffect, useRef, useState, type CSSProperties } from 'react'
import { useFirstHandTickerGeneratedAt, useFirstHandTickerPosts } from '../data/useFirstHandTicker'
import { TICKER_WINDOW_HOURS, type TickerPost } from '../news/tickerTypes'
import type { FirstHandTier, TopicTag } from '../news/types'

// The per-tab first-hand text ticker (design §15b) — "Unverified Field Reports". A continuous crawl above the feed: the newest posts
// travel steadily along one line, right to left, so they read left to right as they pass; hovering stops it. ALL opens the full list
// inline (page scroll, never a nested scrollbar). Text only, by design: no photo, no video thumbnail, no link preview. Everything it
// shows was already gated when the file was built (English, recent, Layer 1 content-safety, on-topic — src/news/firstHandTicker.ts);
// this only scopes it to the tab and labels it.
//
// The labeling is the point, not decoration (§15a/§15b): the strip says UNVERIFIED, every item names its channel and kind, and a
// combatant-affiliated channel's affiliation is printed beside its name in amber — inside the crawl itself, not only in the full list.

/** Most posts in the full list; the file itself holds more. */
const MAX_LINES = 40
/** Posts in the crawl. One lap has to stay a few minutes long or the newest posts would be minutes away from ever coming round again. */
const CRAWL_POSTS = 12
/** A crawl item's text is cut to this; the full text is in the ALL list and in the hover title. */
const CRAWL_TEXT_CHARS = 160
/** Crawl speed. Slow enough to read on the move, and hovering stops it for the rest. */
const CRAWL_PX_PER_SECOND = 55
/** The ticker file is rebuilt hourly (§15c); past this it is called stale rather than presented as live. */
const STALE_AFTER_MS = 3 * 3_600_000

const TIER_LABEL: Record<FirstHandTier, string> = {
  'verification-specialist': 'VERIFICATION SPECIALIST',
  'osint-aggregator': 'OSINT AGGREGATOR',
  'regional-curator': 'REGIONAL CURATOR',
  'combatant-affiliated': 'COMBATANT-AFFILIATED',
}

function formatAge(ms: number): string {
  const minutes = Math.max(0, Math.round(ms / 60_000))
  if (minutes < 1) return 'now'
  if (minutes < 60) return `${minutes}m`
  const hours = Math.floor(minutes / 60)
  return hours < 24 ? `${hours}h` : `${Math.floor(hours / 24)}d`
}

function clip(text: string, max: number): string {
  if (text.length <= max) return text
  const cut = text.lastIndexOf(' ', max)
  return text.slice(0, cut > max / 2 ? cut : max).trimEnd() + '…'
}

const STRIP = 'flex items-center gap-3 rounded border border-[#16233c] bg-[rgba(10,16,28,0.6)] px-3 py-2'
const UNVERIFIED_TAG = 'shrink-0 rounded-sm border border-[#ff9a3c]/50 px-1.5 py-0.5 text-[8.5px] font-bold tracking-[0.1em] text-[#ff9a3c]'
const NAV_BUTTON =
  'shrink-0 rounded border border-[#1c2c4b] px-2 py-1 text-[9.5px] font-bold tracking-[0.06em] text-[#7f93b8] transition-colors hover:border-[#3f8bff] hover:text-white'

function PostByline({ post, now }: { post: TickerPost; now: number }) {
  return (
    <>
      <span className="font-bold tracking-[0.04em] text-[#a9c6ff]">{post.channelName}</span>
      <span className="tracking-[0.06em] text-[#51648a]">{TIER_LABEL[post.channelTier]}</span>
      {post.affiliationNote && <span className="text-[#ff9a3c]">{post.affiliationNote}</span>}
      <span className="text-[#51648a]">{formatAge(now - Date.parse(post.publishedAt))}</span>
    </>
  )
}

/** One post as it passes: channel, affiliation (before kind and age, matching the list), then its text, all on one line. */
function CrawlItem({ post, now }: { post: TickerPost; now: number }) {
  return (
    <a
      href={post.url}
      target="_blank"
      rel="noopener noreferrer"
      title={post.text}
      className="flex shrink-0 items-baseline gap-2 whitespace-nowrap text-[12px] text-[#c4d3ee] transition-colors hover:text-white"
    >
      <span className="text-[10px] font-bold tracking-[0.04em] text-[#a9c6ff]">{post.channelName}</span>
      {post.affiliationNote && <span className="text-[10px] text-[#ff9a3c]">{post.affiliationNote}</span>}
      <span className="text-[9px] tracking-[0.06em] text-[#51648a]">
        {TIER_LABEL[post.channelTier]} · {formatAge(now - Date.parse(post.publishedAt))}
      </span>
      <span>{clip(post.text, CRAWL_TEXT_CHARS)}</span>
    </a>
  )
}

/**
 * The crawl itself. One "set" is every item once, followed by a separator; the track holds enough copies of the set to be wider than the
 * window, and slides left by exactly one set's width per lap, so the join is invisible. The set width (and so the lap time, at a
 * constant speed) is measured, because it depends on the text and the font.
 */
function Crawl({ posts, now, held }: { posts: TickerPost[]; now: number; held: boolean }) {
  const windowRef = useRef<HTMLDivElement>(null)
  const setRef = useRef<HTMLDivElement>(null)
  const [size, setSize] = useState({ window: 0, set: 0 })

  useEffect(() => {
    const win = windowRef.current
    const set = setRef.current
    if (!win || !set) return
    const measure = () => setSize((prev) => (prev.window === win.clientWidth && prev.set === set.offsetWidth ? prev : { window: win.clientWidth, set: set.offsetWidth }))
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(win)
    observer.observe(set)
    return () => observer.disconnect()
  }, [posts])

  // Enough copies that the visible window is always covered, plus the one sliding in behind it.
  const copies = size.set > 0 ? Math.max(2, Math.ceil(size.window / size.set) + 1) : 2
  const style = {
    '--marquee-shift': `${-size.set}px`,
    '--marquee-duration': `${size.set > 0 ? size.set / CRAWL_PX_PER_SECOND : 120}s`,
  } as CSSProperties

  return (
    <div ref={windowRef} className="ticker-window group relative min-w-0 flex-1 overflow-hidden">
      <div
        style={style}
        className={`ticker-marquee flex w-max ${held ? '[animation-play-state:paused]' : 'group-hover:[animation-play-state:paused] group-focus-within:[animation-play-state:paused]'}`}
      >
        {Array.from({ length: copies }, (_, copy) => (
          <div key={copy} ref={copy === 0 ? setRef : undefined} aria-hidden={copy > 0 ? true : undefined} inert={copy > 0} className={`flex shrink-0 items-baseline ${copy > 0 ? 'ticker-dup' : ''}`}>
            {posts.map((post) => (
              <div key={post.id} className="flex items-baseline">
                <CrawlItem post={post} now={now} />
                <span aria-hidden="true" className="mx-5 text-[8px] text-[#ff9a3c]/60">
                  ◆
                </span>
              </div>
            ))}
          </div>
        ))}
      </div>
    </div>
  )
}

export function FirstHandTicker({ topicTag, now }: { topicTag: TopicTag; now: number }) {
  const all = useFirstHandTickerPosts()
  const generatedAt = useFirstHandTickerGeneratedAt()
  const [expanded, setExpanded] = useState(false)

  const earliest = now - TICKER_WINDOW_HOURS * 3_600_000
  // Re-checked against the reader's clock: a file that stopped being rebuilt must not keep presenting old posts as live.
  const lines = all.filter((post) => post.topicTags.includes(topicTag) && Date.parse(post.publishedAt) >= earliest).slice(0, MAX_LINES)
  const builtAgo = generatedAt ? now - Date.parse(generatedAt) : null
  const stale = builtAgo != null && builtAgo > STALE_AFTER_MS
  const count = lines.length

  const status =
    builtAgo == null ? null : (
      <span className={`shrink-0 text-[9px] ${stale ? 'font-bold text-[#ff9a3c]' : 'text-[#51648a]'}`}>
        {stale ? `STALE · ${formatAge(builtAgo)}` : `UPDATED ${formatAge(builtAgo)} AGO`}
      </span>
    )

  if (count === 0) {
    return (
      <aside aria-label="Unverified field reports" className={`${STRIP} mb-4`}>
        <span className={UNVERIFIED_TAG}>UNVERIFIED FIELD REPORTS</span>
        <span className="min-w-0 flex-1 truncate text-[11px] text-[#51648a]">
          {generatedAt == null ? 'Field-report feed unavailable.' : `No field reports on this topic in the last ${TICKER_WINDOW_HOURS} hours.`}
        </span>
        {status}
      </aside>
    )
  }

  return (
    <aside aria-label="Unverified field reports" className="mb-4">
      <div className={STRIP}>
        <span className={UNVERIFIED_TAG}>UNVERIFIED FIELD REPORTS</span>
        <Crawl posts={lines.slice(0, CRAWL_POSTS)} now={now} held={expanded} />
        {status}
        <button type="button" aria-expanded={expanded} onClick={() => setExpanded((v) => !v)} className={NAV_BUTTON}>
          {expanded ? 'HIDE' : `ALL ${count}`}
        </button>
      </div>

      {expanded && (
        <div className="mt-2 rounded border border-[#16233c] bg-[rgba(10,16,28,0.6)] p-3">
          <p className="mb-3 text-[9.5px] leading-snug text-[#51648a]">
            Raw posts from public channels, newest first. Atlas has not verified them and they do not count toward any event&rsquo;s sourcing.
          </p>
          <ul className="grid grid-cols-1 gap-x-6 gap-y-3 md:grid-cols-2 xl:grid-cols-3">
            {lines.map((post) => (
              <li key={post.id} className="min-w-0 border-t border-[#16233c] pt-2">
                <div className="flex flex-wrap items-baseline gap-x-2 text-[9px]">
                  <PostByline post={post} now={now} />
                </div>
                <a
                  href={post.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="mt-1 block text-[11px] leading-snug text-[#c4d3ee] transition-colors hover:text-white"
                >
                  {post.text}
                </a>
                {post.forwardedFrom && <div className="mt-0.5 text-[9px] text-[#51648a]">Forwarded from {post.forwardedFrom}</div>}
              </li>
            ))}
          </ul>
        </div>
      )}
    </aside>
  )
}
