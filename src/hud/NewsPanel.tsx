import { useEffect, useRef, useState } from 'react'
import { useTopNavTab } from './navStore'
import { useNewsEvents, useNewsEventsLoaded } from '../data/useNewsEvents'
import { consumePendingNewsCountryId } from './newsFilterStore'
import { getCountries, getCountry } from '../data'
import {
  DEFAULT_NEWS_RECENCY,
  NEWS_RECENCY_WINDOWS,
  getNewsRecencyWindow,
  isWithinRecency,
  type NewsRecencyId,
} from '../data/newsRecency'
import type { CountryRegion } from '../data/countryRegions'
import { buildFeed, filterEvents } from '../news/feed'
import { NEWS_TABS } from '../news/tabs'
import { deriveCorroboration } from '../news/corroboration'
import { assignEventImages, distinctSources, sourceDisplayName } from '../news/eventPresentation'
import type { NewsEvent, NewsTabId } from '../news/types'
import { CORROBORATION_STYLE, NEWS_SEVERITY_STYLE, TOPIC_TAG_LABEL, isEventBreaking, withAlpha } from './newsEventStyles'
import { PANEL_SECTION_LABEL } from './panelStyles'
import { Icon } from './icons'
import { ICONS } from './iconPaths'

// The News Engine v2 tab (Phase 4). Every ranking/filtering decision here is
// delegated to src/news/ — `buildFeed` (§10 ranking + the featured split),
// `filterEvents` (§11 client-side filtering), `NEWS_TABS` (§9a), and
// `deriveCorroboration` (§8) — so the tab renders exactly what the build
// gated on, rather than re-deciding any of it in the UI. What lives here is
// presentation plus the two filters that are purely a reader's convenience:
// the recency window and the text search.

// How many additional tiles a scroll-to-bottom reveals — the same
// IntersectionObserver-driven "rolling" list v1 shipped, kept because the
// archive-backed feed is no smaller than v1's was.
const PAGE_SIZE = 24

// World Bank's own 7-region breakdown — see src/data/countryRegions.ts. A
// literal list, not a data-derived one: a region-hub button row is a fixed,
// ordered UI concern (same call v1's panel made).
const REGIONS: CountryRegion[] = [
  'East Asia & Pacific',
  'Europe & Central Asia',
  'Latin America & Caribbean',
  'Middle East, North Africa, Afghanistan & Pakistan',
  'North America',
  'South Asia',
  'Sub-Saharan Africa',
]

// One filter dimension at a time (country or region), carried over from v1 —
// the topic tabs are now the topic dimension, so this never needs to combine
// with them beyond the AND that `filterEvents` already does.
type ActiveFilter = { kind: 'country'; id: string; name: string } | { kind: 'region'; region: CountryRegion }

function countryNames(event: NewsEvent): string[] {
  return event.linkedEntityIds.map((id) => getCountry(id)?.name).filter((name): name is string => name != null)
}

function regionCountryIds(region: CountryRegion): string[] {
  return getCountries()
    .filter((country) => country.region === region)
    .map((country) => country.id)
}

// Searches the Event's title and its linked country names — not outlet,
// severity or tag, each of which already has its own badge, tab or filter.
function matchesQuery(event: NewsEvent, query: string): boolean {
  const q = query.toLowerCase()
  if (event.title.toLowerCase().includes(q)) return true
  return countryNames(event).some((name) => name.toLowerCase().includes(q))
}

function JustInBadge() {
  return (
    <span className="animate-pulse rounded-full border border-[#ff4a42] bg-[rgba(255,74,66,0.16)] px-2 py-0.5 text-[9px] font-bold tracking-[0.08em] text-[#ff4a42]">
      JUST IN
    </span>
  )
}

function Pill({ color, children, small = false }: { color: string; children: React.ReactNode; small?: boolean }) {
  return (
    <span
      className={`rounded-full border font-bold tracking-[0.08em] ${small ? 'px-1.5 py-0.5 text-[8px]' : 'px-2 py-0.5 text-[9px]'}`}
      style={{ borderColor: color, backgroundColor: withAlpha(color, 0.14), color }}
    >
      {children}
    </span>
  )
}

function SeverityBadge({ event, small = false }: { event: NewsEvent; small?: boolean }) {
  const style = NEWS_SEVERITY_STYLE[event.severity]
  return (
    <Pill color={style.color} small={small}>
      {style.label.toUpperCase()}
    </Pill>
  )
}

// Derived from the dossier at render time by the SAME function the build
// gated with — never a stored field (§17a), so what a reader sees and what
// the publish gate counted can't disagree.
function CorroborationBadge({ event, small = false }: { event: NewsEvent; small?: boolean }) {
  const style = CORROBORATION_STYLE[deriveCorroboration(event.sources)]
  return (
    <Pill color={style.color} small={small}>
      {style.label}
    </Pill>
  )
}

// An Event is reported by several publishers, so the card is NOT one big link
// the way v1's single-article card was: the headline opens the earliest
// report, and this row opens any of the others. Collapsed to a count until
// clicked — the dossier is the point of the Event model, but it isn't what a
// reader scanning a feed needs first.
function SourceDossier({ event }: { event: NewsEvent }) {
  const [open, setOpen] = useState(false)
  const sources = distinctSources(event)
  return (
    <div className="mt-2 border-t border-[#16233c] pt-2">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center justify-between text-left text-[9.5px] font-bold tracking-[0.06em] text-[#7f93b8] transition-colors hover:text-white"
      >
        <span>
          {sources.length} {sources.length === 1 ? 'SOURCE' : 'SOURCES'} · {sources.map(sourceDisplayName).join(', ')}
        </span>
        <span className="ml-2 shrink-0">{open ? '▲' : '▼'}</span>
      </button>
      {open && (
        <ul className="mt-1.5 space-y-1">
          {sources.map((entry) => (
            <li key={entry.id} className="flex items-baseline justify-between gap-2">
              <a
                href={entry.refUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="text-[10px] text-[#8aa0c6] transition-colors hover:text-white"
              >
                {sourceDisplayName(entry)}
                {entry.sourceCategory === 'outlet' && entry.tier === 'wire' && <span className="ml-1 text-[#3f8bff]">· wire</span>}
                {entry.sourceCategory === 'outlet' && entry.pressControl === 'state-controlled' && (
                  <span className="ml-1 text-[#ff9a3c]">· state-controlled</span>
                )}
                {entry.sourceCategory === 'outlet' && entry.leaning && <span className="ml-1 text-[#51648a]">· {entry.leaning}</span>}
              </a>
              <span className="shrink-0 text-[9px] text-[#51648a]">{new Date(entry.timestamp).toLocaleDateString()}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

// No fabricated stock photo when no report in the dossier carried an image —
// a severity-tinted gradient block instead, so a missing image reads as "no
// image", not a broken one. (v1 made the same call for the same reason.) The
// same gradient is also what a card falls back to when every image in its own
// dossier is already on the page — see `assignEventImages`.
function Thumbnail({ event, src, aspect }: { event: NewsEvent; src?: string; aspect: string }) {
  const style = NEWS_SEVERITY_STYLE[event.severity]
  return src ? (
    <img src={src} alt="" className={`w-full ${aspect} rounded object-cover`} loading="lazy" />
  ) : (
    <div
      className={`w-full ${aspect} rounded`}
      style={{ background: `linear-gradient(135deg, ${withAlpha(style.color, 0.22)}, rgba(10,16,28,0.9))` }}
    />
  )
}

function primaryUrl(event: NewsEvent): string {
  return event.sources[0]?.refUrl ?? '#'
}

// The featured 3 — thumbnail-forward, side by side (§10's "YouTube-style"
// layout for the featured row).
function FeaturedCard({ event, imageUrl }: { event: NewsEvent; imageUrl?: string }) {
  return (
    <div className="overflow-hidden rounded border border-[#16233c] bg-[rgba(10,16,28,0.6)] transition-colors hover:border-[#3f8bff]">
      <a href={primaryUrl(event)} target="_blank" rel="noopener noreferrer" className="block">
        <Thumbnail event={event} src={imageUrl} aspect="aspect-video" />
      </a>
      <div className="p-3">
        <div className="mb-2 flex flex-wrap items-center gap-2">
          {isEventBreaking(event) && <JustInBadge />}
          <SeverityBadge event={event} />
          <CorroborationBadge event={event} />
        </div>
        <a
          href={primaryUrl(event)}
          target="_blank"
          rel="noopener noreferrer"
          className="mb-1 block text-[14px] leading-snug font-semibold text-[#e6efff] transition-colors hover:text-white"
        >
          {event.title}
        </a>
        <div className="flex items-center justify-between text-[9.5px] text-[#51648a]">
          <span>{countryNames(event).join(', ')}</span>
          <span>{new Date(event.eventTimestamp).toLocaleString()}</span>
        </div>
        <div className="mt-1.5 flex flex-wrap gap-1">
          {event.topicTags.map((tag) => (
            <span
              key={tag}
              className="rounded border border-[#243456] bg-[rgba(20,30,52,0.7)] px-1.5 py-0.5 text-[8.5px] font-semibold tracking-[0.02em] text-[#8aa0c6]"
            >
              {TOPIC_TAG_LABEL[tag]}
            </span>
          ))}
        </div>
        <SourceDossier event={event} />
      </div>
    </div>
  )
}

/** Everything below the featured 3 (and every search match) — a denser tile. */
function TileCard({ event, imageUrl }: { event: NewsEvent; imageUrl?: string }) {
  return (
    <div className="overflow-hidden rounded border border-[#16233c] bg-[rgba(10,16,28,0.6)] transition-colors hover:border-[#3f8bff]">
      <a href={primaryUrl(event)} target="_blank" rel="noopener noreferrer" className="block">
        <Thumbnail event={event} src={imageUrl} aspect="aspect-video" />
      </a>
      <div className="p-2">
        <div className="mb-1.5 flex flex-wrap items-center gap-1.5">
          {isEventBreaking(event) && <JustInBadge />}
          <SeverityBadge event={event} small />
          <CorroborationBadge event={event} small />
        </div>
        <a
          href={primaryUrl(event)}
          target="_blank"
          rel="noopener noreferrer"
          className="mb-1 line-clamp-3 block text-[11.5px] leading-snug font-semibold text-[#e6efff] transition-colors hover:text-white"
        >
          {event.title}
        </a>
        <div className="text-[9px] text-[#51648a]">
          {countryNames(event).slice(0, 3).join(', ')} · {new Date(event.eventTimestamp).toLocaleDateString()}
        </div>
        <SourceDossier event={event} />
      </div>
    </div>
  )
}

// Bottom-of-list sentinel driving the rolling reveal — an IntersectionObserver
// rather than a scroll-position listener on the panel's own overflow container.
function LoadMoreSentinel({ onVisible }: { onVisible: () => void }) {
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const el = ref.current
    if (!el) return
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0]?.isIntersecting) onVisible()
      },
      { rootMargin: '400px' },
    )
    observer.observe(el)
    return () => observer.disconnect()
  }, [onVisible])
  return <div ref={ref} className="h-1" />
}

export function NewsPanel() {
  const isOpen = useTopNavTab() === 'news'
  const [tab, setTab] = useState<NewsTabId>('world')
  const [activeFilter, setActiveFilter] = useState<ActiveFilter | null>(null)
  const [query, setQuery] = useState('')
  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE)
  const [recency, setRecency] = useState<NewsRecencyId>(DEFAULT_NEWS_RECENCY)
  // "Now" for the recency window, held in state (not read during render) and refreshed each time the tab opens, so a
  // long-open session doesn't measure the window from when the app loaded.
  const [now, setNow] = useState(() => Date.now())

  // Consume the cross-tab country filter exactly once per transition into this
  // tab — see newsFilterStore.ts for why it isn't a persistent setting.
  useEffect(() => {
    if (isOpen) {
      setNow(Date.now())
      const pendingId = consumePendingNewsCountryId()
      if (pendingId) {
        const name = getCountry(pendingId)?.name
        if (name) setActiveFilter({ kind: 'country', id: pendingId, name })
      }
    }
  }, [isOpen])

  const allEvents = useNewsEvents()
  const loaded = useNewsEventsLoaded()

  // Plain per-render derivations, not memoized — the same "cheap enough to
  // redo every render" call AnalyticsPanel and v1's NewsPanel both make at a
  // comparable list size.
  const trimmedQuery = query.trim()
  const searchActive = trimmedQuery.length > 0
  // The reader's own two filters run first, so tab counts below reflect what
  // the reader would actually see if they switched to that tab.
  const inWindow = allEvents.filter((event) => isWithinRecency(event.eventTimestamp, recency, now))
  const scoped = searchActive ? inWindow.filter((event) => matchesQuery(event, trimmedQuery)) : inWindow

  const countryIds =
    activeFilter?.kind === 'country' ? [activeFilter.id] : activeFilter?.kind === 'region' ? regionCountryIds(activeFilter.region) : undefined

  const { featured, rest } = buildFeed(scoped, { tab, countryIds })
  // A search flattens to one match grid: a "trending" spotlight means nothing
  // once the reader has said exactly what they're looking for.
  const featuredRow = searchActive ? [] : featured
  const tiles = searchActive ? [...featured, ...rest] : rest
  // Assigned over the WHOLE ordered feed, not just the visible slice, so a
  // card's picture can't change under the reader as more tiles load in.
  const images = assignEventImages([...featuredRow, ...tiles])
  const visibleTiles = tiles.slice(0, visibleCount)
  const total = featuredRow.length + tiles.length

  // A new tab, search, filter or window starts pagination over — otherwise the
  // rolled position could point well past the end of a much shorter new list.
  useEffect(() => {
    setVisibleCount(PAGE_SIZE)
  }, [tab, trimmedQuery, activeFilter, recency])

  if (!isOpen) return null

  function selectRegionFilter(region: CountryRegion) {
    setActiveFilter((current) => (current?.kind === 'region' && current.region === region ? null : { kind: 'region', region }))
  }

  return (
    <div className="pointer-events-auto fixed inset-x-0 top-14 bottom-0 z-20 overflow-y-auto bg-[#04070a]">
      <div className="mx-auto w-full max-w-6xl px-6 py-8">
        <div className={`${PANEL_SECTION_LABEL} mb-1`}>NEWS ENGINE</div>
        <div className="mb-4 flex items-center gap-3">
          <h1 className="font-display text-[26px] font-bold tracking-[0.09em] text-white [text-shadow:0_0_24px_rgba(63,139,255,0.35)]">
            NEWS
          </h1>
          {activeFilter && (
            <div className="flex items-center gap-2 text-[11px] text-[#8aa0c6]">
              <span>
                Showing news for{' '}
                <span className="font-bold text-white">
                  {activeFilter.kind === 'country' ? activeFilter.name : activeFilter.region}
                </span>
              </span>
              <button
                type="button"
                onClick={() => setActiveFilter(null)}
                className="rounded border border-[#1c2c4b] px-2 py-0.5 font-bold tracking-[0.06em] transition-colors hover:border-[#3f8bff] hover:text-white"
              >
                × CLEAR FILTER
              </button>
            </div>
          )}
        </div>

        {/* Topic tabs (§9a) — World plus one per topicTag. An Event carrying
            several tags appears in every matching tab: these are an
            overlapping filter, not a partition. Counts are live against the
            reader's current window/search/filter. */}
        <div className="mb-4 flex flex-wrap gap-1.5 border-b border-[#16233c] pb-3">
          {NEWS_TABS.map((def) => {
            const active = tab === def.id
            const count = filterEvents(scoped, { tab: def.id, countryIds }).length
            return (
              <button
                key={def.id}
                type="button"
                aria-pressed={active}
                onClick={() => setTab(def.id)}
                className={`rounded border px-3 py-1.5 text-[10px] font-bold tracking-[0.08em] transition-colors ${
                  active
                    ? 'border-[#3f8bff] bg-[rgba(63,139,255,0.2)] text-white'
                    : 'border-[#1c2c4b] text-[#7f93b8] hover:border-[#3f8bff] hover:text-white'
                }`}
              >
                {def.label.toUpperCase()}
                <span className={`ml-1.5 ${active ? 'text-[#a9c6ff]' : 'text-[#51648a]'}`}>{count}</span>
              </button>
            )
          })}
        </div>

        {/* Recency window — applies before everything else, so the tab counts
            above and the feed below always agree. */}
        <div className="mb-3 flex flex-wrap items-center gap-2">
          <span className="text-[9.5px] font-bold tracking-[0.1em] text-[#51648a]">SHOW LAST</span>
          <div role="group" aria-label="News recency" className="flex gap-1.5">
            {NEWS_RECENCY_WINDOWS.map((w) => {
              const active = recency === w.id
              return (
                <button
                  key={w.id}
                  type="button"
                  aria-pressed={active}
                  onClick={() => setRecency(w.id)}
                  className={`rounded border px-2.5 py-1 text-[9.5px] font-bold tracking-[0.06em] transition-colors ${
                    active
                      ? 'border-[#3f8bff] bg-[rgba(63,139,255,0.2)] text-white'
                      : 'border-[#1c2c4b] text-[#7f93b8] hover:border-[#3f8bff] hover:text-white'
                  }`}
                >
                  {w.label}
                </button>
              )
            })}
          </div>
        </div>

        {/* Region hubs — a region preset is just a bundle of country ids (§11),
            resolved here and handed to `filterEvents` as one. */}
        <div className="mb-4 flex flex-wrap gap-1.5">
          {REGIONS.map((region) => {
            const active = activeFilter?.kind === 'region' && activeFilter.region === region
            return (
              <button
                key={region}
                type="button"
                onClick={() => selectRegionFilter(region)}
                className={`rounded-full border px-2.5 py-1 text-[9.5px] font-bold tracking-[0.04em] transition-colors ${
                  active
                    ? 'border-[#3f8bff] bg-[rgba(63,139,255,0.2)] text-white'
                    : 'border-[#1c2c4b] text-[#7f93b8] hover:border-[#3f8bff] hover:text-white'
                }`}
              >
                {region}
              </button>
            )
          })}
        </div>

        {/* Sticky search bar, pinned to this tab's own scroll area. */}
        <div className="sticky top-0 z-10 -mx-6 mb-6 border-b border-[#16233c] bg-[#04070a] px-6 py-3">
          <div className="relative">
            <span className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-[#5a729a]">
              <Icon paths={ICONS.search} size={14} />
            </span>
            <input
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search events or a country..."
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

        {total === 0 ? (
          <div className="text-[12px] text-[#51648a]">
            {!loaded
              ? 'Loading news…'
              : allEvents.length === 0
                ? 'No published events yet.'
                : searchActive
                  ? `No events match "${trimmedQuery}".`
                  : `No events in the last ${getNewsRecencyWindow(recency).phrase} for this view. Try a wider window or another tab.`}
          </div>
        ) : (
          <>
            {featuredRow.length > 0 && (
              <div className="mb-8 grid grid-cols-1 gap-4 md:grid-cols-3">
                {featuredRow.map((event) => (
                  <FeaturedCard key={event.id} event={event} imageUrl={images.get(event.id)} />
                ))}
              </div>
            )}
            {visibleTiles.length > 0 && (
              <div>
                {!searchActive && <div className={`${PANEL_SECTION_LABEL} mb-2`}>MORE</div>}
                <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
                  {visibleTiles.map((event) => (
                    <TileCard key={event.id} event={event} imageUrl={images.get(event.id)} />
                  ))}
                </div>
                {visibleCount < tiles.length && <LoadMoreSentinel onVisible={() => setVisibleCount((v) => v + PAGE_SIZE)} />}
              </div>
            )}
          </>
        )}
      </div>
    </div>
  )
}
