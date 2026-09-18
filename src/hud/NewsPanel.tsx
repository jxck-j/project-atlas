import { useEffect, useRef, useState } from 'react'
import { useTopNavTab } from './navStore'
import { usePublishedNewsItems, usePendingNewsItems } from '../data/useNewsFeatures'
import { consumePendingNewsCountryId } from './newsFilterStore'
import { getCountry, type NewsItem } from '../data'
import { NEWS_SEVERITY_STYLE, withAlpha } from './newsSeverityStyles'
import { PANEL_SECTION_LABEL } from './panelStyles'
import { Icon } from './icons'
import { ICONS } from './iconPaths'

const SEVERITY_RANK: Record<NewsItem['severity'], number> = { routine: 0, significant: 1, 'high-stakes': 2 }

// How many additional tiles a scroll-to-bottom reveals — see the
// IntersectionObserver-driven pagination in NewsPanel below (direct
// request: a "rolling"/infinite-scroll list rather than rendering all ~380
// published items in one shot).
const PAGE_SIZE = 24

function bySnapshotDateDesc(a: NewsItem, b: NewsItem) {
  return new Date(b.snapshotDate).getTime() - new Date(a.snapshotDate).getTime()
}

// Global-default ranking (no preset/filter active): trending across the
// most countries first, then severity, then recency — chosen over "most
// severe worldwide" specifically to avoid the default view being dominated
// by whatever's most volatile that day regardless of breadth. See
// news-engine-design.md's "Two ranking logics" section.
function byGlobalDefault(a: NewsItem, b: NewsItem) {
  return (
    b.linkedEntityIds.length - a.linkedEntityIds.length ||
    SEVERITY_RANK[b.severity] - SEVERITY_RANK[a.severity] ||
    bySnapshotDateDesc(a, b)
  )
}

// Country-filtered ranking: severity first, recency second — same rule
// IntelligencePanel's own top-3 uses, just applied at News-tab scope/layout
// (side by side) rather than the panel's stacked layout. One ranking rule,
// not two separate systems, per the design doc.
function bySeverityThenRecency(a: NewsItem, b: NewsItem) {
  return SEVERITY_RANK[b.severity] - SEVERITY_RANK[a.severity] || bySnapshotDateDesc(a, b)
}

function linkedCountryNames(item: NewsItem): string[] {
  return item.linkedEntityIds.map((id) => getCountry(id)?.name).filter((name): name is string => name != null)
}

// Direct request: search headline/summary text and linked country name —
// not outlet or topic tag/severity, which weren't asked for and already
// have their own visible badges/filters (a wire badge, the severity pill,
// the country-filter banner from IntelligencePanel's "MORE" link).
function matchesQuery(item: NewsItem, query: string): boolean {
  const q = query.toLowerCase()
  if (item.headline.toLowerCase().includes(q)) return true
  if (item.summary.toLowerCase().includes(q)) return true
  return linkedCountryNames(item).some((name) => name.toLowerCase().includes(q))
}

function SeverityBadge({ severity }: { severity: NewsItem['severity'] }) {
  const style = NEWS_SEVERITY_STYLE[severity]
  return (
    <span
      className="rounded-full border px-2 py-0.5 text-[9px] font-bold tracking-[0.08em]"
      style={{ borderColor: style.color, backgroundColor: withAlpha(style.color, 0.14), color: style.color }}
    >
      {style.label.toUpperCase()}
    </span>
  )
}

function SourceBadges({ item }: { item: NewsItem }) {
  if (item.sourceType === 'first-hand') {
    // Visually distinct from an outlet's badge grid — never interleaved
    // with it, per the design doc's source-schema section. No first-hand
    // data ships in v1 (see buildNews.mjs), but the branch is real so the
    // UI doesn't need a second pass once it does.
    return (
      <span className="rounded-full border border-[#8a6df0] bg-[rgba(138,109,240,0.14)] px-2 py-0.5 text-[9px] font-bold tracking-[0.08em] text-[#8a6df0]">
        FIRST-HAND ACCOUNT
      </span>
    )
  }
  return (
    <>
      <span className="text-[10px] font-semibold tracking-[0.04em] text-[#8aa0c6]">{item.source.outlet}</span>
      {item.source.tier === 'wire' && (
        <span className="rounded-full border border-[#3f8bff] bg-[rgba(63,139,255,0.14)] px-2 py-0.5 text-[9px] font-bold tracking-[0.08em] text-[#3f8bff]">
          WIRE
        </span>
      )}
      {item.source.leaning && (
        <span className="text-[9px] tracking-[0.04em] text-[#51648a]">{item.source.leaning}</span>
      )}
    </>
  )
}

// No fabricated stock photo when a source feed has no thumbnail (only BBC's
// of the 3 v1 outlets actually populates one — see buildNews.mjs's own
// header comment) — a plain severity-tinted gradient block instead, so a
// missing image reads as "no image," not a broken one.
function Thumbnail({ item, aspect }: { item: NewsItem; aspect: string }) {
  const style = NEWS_SEVERITY_STYLE[item.severity]
  return item.imageUrl ? (
    <img src={item.imageUrl} alt="" className={`w-full ${aspect} rounded object-cover`} loading="lazy" />
  ) : (
    <div
      className={`w-full ${aspect} rounded`}
      style={{ background: `linear-gradient(135deg, ${withAlpha(style.color, 0.22)}, rgba(10,16,28,0.9))` }}
    />
  )
}

// The News tab's top-3 — thumbnail-forward, "YouTube style" per direct
// request: image first, headline/summary below it, badges below that —
// rather than the old text-first card layout.
function FeaturedCard({ item }: { item: NewsItem }) {
  return (
    <a
      href={item.url}
      target="_blank"
      rel="noopener noreferrer"
      className="block overflow-hidden rounded border border-[#16233c] bg-[rgba(10,16,28,0.6)] transition-colors hover:border-[#3f8bff]"
    >
      <Thumbnail item={item} aspect="aspect-video" />
      <div className="p-3">
        <div className="mb-2 flex flex-wrap items-center gap-2">
          <SeverityBadge severity={item.severity} />
          <SourceBadges item={item} />
        </div>
        <div className="mb-1 text-[14px] leading-snug font-semibold text-[#e6efff]">{item.headline}</div>
        {item.summary && <div className="mb-2 line-clamp-2 text-[11px] leading-relaxed text-[#8aa0c6]">{item.summary}</div>}
        <div className="flex items-center justify-between text-[9.5px] text-[#51648a]">
          <span>{linkedCountryNames(item).join(', ')}</span>
          <span>{new Date(item.snapshotDate).toLocaleString()}</span>
        </div>
      </div>
    </a>
  )
}

// Everything below the top-3 (or every search-match, when actively
// searching — see NewsPanel below) — a 4-column tile grid (direct
// request), smaller thumbnail-forward cards rather than the old
// single-column list.
function TileCard({ item }: { item: NewsItem }) {
  return (
    <a
      href={item.url}
      target="_blank"
      rel="noopener noreferrer"
      className="block overflow-hidden rounded border border-[#16233c] bg-[rgba(10,16,28,0.6)] transition-colors hover:border-[#3f8bff]"
    >
      <Thumbnail item={item} aspect="aspect-video" />
      <div className="p-2">
        <div className="mb-1.5 flex flex-wrap items-center gap-1.5">
          <SeverityBadge severity={item.severity} />
          {item.source.tier === 'wire' && (
            <span className="rounded-full border border-[#3f8bff] bg-[rgba(63,139,255,0.14)] px-1.5 py-0.5 text-[8px] font-bold tracking-[0.06em] text-[#3f8bff]">
              WIRE
            </span>
          )}
        </div>
        <div className="mb-1 line-clamp-2 text-[11.5px] leading-snug font-semibold text-[#e6efff]">{item.headline}</div>
        <div className="text-[9px] text-[#51648a]">
          {item.sourceType === 'first-hand' ? 'First-hand account' : item.source.outlet} ·{' '}
          {new Date(item.snapshotDate).toLocaleDateString()}
        </div>
      </div>
    </a>
  )
}

// Bottom-of-list sentinel — an IntersectionObserver on this div is what
// actually drives the "rolling"/infinite-scroll reveal (see NewsPanel
// below), rather than a scroll-position listener on the panel's own
// overflow container.
function LoadMoreSentinel({ onVisible }: { onVisible: () => void }) {
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const el = ref.current
    if (!el) return
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0]?.isIntersecting) onVisible()
      },
      { rootMargin: '400px' }
    )
    observer.observe(el)
    return () => observer.disconnect()
  }, [onVisible])
  return <div ref={ref} className="h-1" />
}

function PendingQueue() {
  const pending = usePendingNewsItems()
  const [open, setOpen] = useState(false)
  if (pending.length === 0) return null
  return (
    <div className="mt-8 rounded border border-dashed border-[#4a3a1f] bg-[rgba(60,45,10,0.15)] p-4">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center justify-between text-left text-[11px] font-bold tracking-[0.1em] text-[#f2cb4e]"
      >
        <span>DEV — PENDING CONFIRMATION QUEUE ({pending.length})</span>
        <span>{open ? '▲' : '▼'}</span>
      </button>
      {open && (
        <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
          {[...pending].sort(bySnapshotDateDesc).map((item) => (
            <TileCard key={item.id} item={item} />
          ))}
        </div>
      )}
    </div>
  )
}

export function NewsPanel() {
  const isOpen = useTopNavTab() === 'news'
  const [filterCountryId, setFilterCountryId] = useState<string | null>(null)
  const [query, setQuery] = useState('')
  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE)

  // Consume the cross-tab filter exactly once per transition into this tab
  // — see newsFilterStore.ts's own comment for why this isn't a persistent
  // filter setting.
  useEffect(() => {
    if (isOpen) {
      const pending = consumePendingNewsCountryId()
      if (pending) setFilterCountryId(pending)
    }
  }, [isOpen])

  const published = usePublishedNewsItems()

  // Plain per-render derivations, not memoized — same "cheap enough to just
  // redo on every render" precedent AnalyticsPanel's own sorted-row
  // construction already establishes for a comparable list size.
  const filterCountryName = filterCountryId ? getCountry(filterCountryId)?.name : undefined
  const scoped = filterCountryId ? published.filter((item) => item.linkedEntityIds.includes(filterCountryId)) : published
  const sorted = filterCountryId ? [...scoped].sort(bySeverityThenRecency) : [...scoped].sort(byGlobalDefault)

  const trimmedQuery = query.trim()
  const searchActive = trimmedQuery.length > 0
  const searchResults = searchActive ? sorted.filter((item) => matchesQuery(item, trimmedQuery)) : []

  // A new search or a new country filter starts pagination over from the
  // top — otherwise switching context could leave the "rolled" position
  // pointing well past the end of a much shorter new list.
  useEffect(() => {
    setVisibleCount(PAGE_SIZE)
  }, [trimmedQuery, filterCountryId])

  if (!isOpen) return null

  // Featured top-3 only make sense for the un-searched, ranked view — an
  // active text search flattens straight to one paginated match grid
  // instead (a "trending" spotlight doesn't mean anything once the user's
  // told the page exactly what they're looking for).
  const featured = searchActive ? [] : sorted.slice(0, 3)
  // Severity first, recency second — direct feedback that pure recency here
  // (the design doc's original "no severity weighting below the fold" rule)
  // let a just-in routine item outrank an older significant one.
  const rest = searchActive ? searchResults : [...sorted.slice(3)].sort(bySeverityThenRecency)
  const visibleRest = rest.slice(0, visibleCount)
  const hasMore = visibleCount < rest.length

  return (
    <div className="pointer-events-auto fixed inset-x-0 top-14 bottom-0 z-20 overflow-y-auto bg-[#04070a]">
      <div className="mx-auto w-full max-w-6xl px-6 py-8">
        <div className={`${PANEL_SECTION_LABEL} mb-1`}>NEWS ENGINE</div>
        <div className="mb-4 flex items-center gap-3">
          <h1 className="font-display text-[26px] font-bold tracking-[0.09em] text-white [text-shadow:0_0_24px_rgba(63,139,255,0.35)]">
            NEWS
          </h1>
          {filterCountryName && (
            <div className="flex items-center gap-2 text-[11px] text-[#8aa0c6]">
              <span>
                Showing news for <span className="font-bold text-white">{filterCountryName}</span>
              </span>
              <button
                type="button"
                onClick={() => setFilterCountryId(null)}
                className="rounded border border-[#1c2c4b] px-2 py-0.5 font-bold tracking-[0.06em] transition-colors hover:border-[#3f8bff] hover:text-white"
              >
                × CLEAR FILTER
              </button>
            </div>
          )}
        </div>

        {/* Sticky search bar — "rolling": pinned to the top of this tab's
            own scroll area as you scroll down through articles, per direct
            request. Searches headline/summary text and linked country name
            (not outlet or topic/severity, which already have their own
            badges/filters) and live-filters the grid below rather than just
            jumping to a match, since there's no fixed "ranking" here the
            way AnalyticsPanel's RankingLookupBar jumps within. */}
        <div className="sticky top-0 z-10 -mx-6 mb-6 border-b border-[#16233c] bg-[#04070a] px-6 py-3">
          <div className="relative">
            <span className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-[#5a729a]">
              <Icon paths={ICONS.search} size={14} />
            </span>
            <input
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search headlines, summaries, or a country..."
              className="w-full rounded border border-[#1c2c4b] bg-[rgba(10,16,28,0.8)] py-2 pr-3 pl-9 text-[12px] text-[#e6efff] placeholder:text-[#51648a] focus:border-[#3f8bff] focus:outline-none"
            />
            {query && (
              <button
                type="button"
                onClick={() => setQuery('')}
                aria-label="Clear search"
                className="absolute top-1/2 right-3 -translate-y-1/2 text-[#5a729a] transition-colors hover:text-white"
              >
                ×
              </button>
            )}
          </div>
        </div>

        {sorted.length === 0 ? (
          <div className="text-[12px] text-[#51648a]">No published news items yet.</div>
        ) : searchActive && searchResults.length === 0 ? (
          <div className="text-[12px] text-[#51648a]">No articles match "{trimmedQuery}".</div>
        ) : (
          <>
            {featured.length > 0 && (
              <div className="mb-8 grid grid-cols-1 gap-4 md:grid-cols-3">
                {featured.map((item) => (
                  <FeaturedCard key={item.id} item={item} />
                ))}
              </div>
            )}
            {visibleRest.length > 0 && (
              <div>
                {!searchActive && <div className={`${PANEL_SECTION_LABEL} mb-2`}>MORE</div>}
                <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
                  {visibleRest.map((item) => (
                    <TileCard key={item.id} item={item} />
                  ))}
                </div>
                {hasMore && <LoadMoreSentinel onVisible={() => setVisibleCount((v) => v + PAGE_SIZE)} />}
              </div>
            )}
          </>
        )}

        {import.meta.env.DEV && <PendingQueue />}
      </div>
    </div>
  )
}
