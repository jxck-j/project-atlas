import { useEffect, useMemo, useState } from 'react'
import { Vector3 } from 'three'
import { useTopNavTab } from './navStore'
import { useCountryFeatures } from '../scene/useCountryFeatures'
import { geometryToCentroid } from '../scene/countryGeometry'
import { latLngToVector3 } from '../utils/geo'
import { GLOBE_RADIUS } from '../scene/constants'
import { getGlobeRotationY } from '../scene/globeRotation'
import { getCountries } from '../data'
import { MILITARY_SCORES, type MilitaryScore } from '../data/militaryScores'
import { ECONOMY_SCORES, type EconomyScore } from '../data/economyScores'
import { TECHNOLOGY_SCORES, type TechnologyScore } from '../data/technologyScores'
import { CURRENT_STATUS, type ConflictEntry, type CurrentStatus } from '../data/currentStatus'
import { CONFLICT_TYPE_STYLE } from '../scene/conflictTypeStyles'
import { SANCTION_TIER_STYLE, withAlpha } from '../scene/sanctionTierColors'
import { resolveEntity } from '../entities/EntityResolver'
import { closeInspector, selectEntity, useSelection } from './selectionStore'
import { Icon } from './icons'
import { ICONS } from './iconPaths'
import { INTEL_METRICS, type IntelMetricId } from './intelMetrics'
import { intelValueColor } from '../utils/intelValueColor'
import { formatGdp, formatGdpPerCapita, formatPopulation } from '../utils/formatScale'
import { PANEL_SECTION_LABEL } from './panelStyles'

const UP_AXIS = new Vector3(0, 1, 0)

// MILITARY (data/militaryScores.ts), ECONOMY (data/economyScores.ts), and
// TECHNOLOGY (data/technologyScores.ts) have real 0-100 composite scores for
// all 193 countries; CURRENT STATUS (data/currentStatus.ts) has real,
// sourced data too but — per design doc §3.5 — never converges to a single
// number, so its view below is a filtered/sortable list, not the
// BaseRankedRow/AnalyticsColumn/RankedListRow machinery Military/Economy/
// Technology share. DIPLOMACY still renders the exact same "Awaiting data
// feed" wording IntelligencePanel.tsx already uses for it, rather than
// fabricating a ranking with nothing behind it. Flip an entry here to `true`
// once a real dataset exists for it.
const METRIC_AVAILABLE: Record<IntelMetricId, boolean> = {
  military: true,
  economy: true,
  diplomacy: false,
  technology: true,
  'current-status': true,
}

type SortDirection = 'asc' | 'desc'
interface SortState {
  key: string
  direction: SortDirection
}

// Shared shape every category's ranked-row type extends — the fields
// SortableHeader/RankedListRow/compareRows care about, independent of which
// category's own per-component breakdown (`components`) a row also carries.
// `scoreSortValue` is the real underlying composite value used ONLY for
// sorting the SCORE column — Military's confirmed-no-standing-military
// countries and Economy's 'unavailable'-confidence countries both fall back
// to -1 here rather than leaving it undefined, so both categories' SCORE
// columns can share one comparator branch with no per-category null case.
interface BaseRankedRow {
  id: string
  name: string
  value?: number
  confidence?: 'measured' | 'proxy' | 'unavailable'
  notApplicable?: boolean
  scoreSortValue: number
}

interface AnalyticsColumn<TRow extends BaseRankedRow> {
  key: string
  label: string
  // null = a genuine coverage gap for this row/column — sorts last
  // regardless of direction (see compareRows).
  getSortValue: (row: TRow) => number | null
  format: (row: TRow) => string
}

// A component's raw value formatted, or "—" for a genuine coverage gap
// (`raw === null`) — the same convention every other missing-data cell in
// this app uses, never a fabricated zero. Shared by every category's column
// definitions.
function formatComponent(raw: number | null, format: (raw: number) => string): string {
  return raw == null ? '—' : format(raw)
}

// Reorders the displayed list only — no row's own value/components ever
// change, whichever column is driving the order. A genuine coverage gap on
// a metric column always sorts last regardless of direction, so flipping
// asc/desc can never make a missing value read as "the best" by landing at
// the top. SCORE goes through its own branch (scoreSortValue, never null —
// see BaseRankedRow) rather than the generic column lookup, since it isn't
// one of `columns` — it's rendered as the bar, not a plain formatted cell.
function compareRows<TRow extends BaseRankedRow>(
  a: TRow,
  b: TRow,
  key: string,
  direction: SortDirection,
  columns: AnalyticsColumn<TRow>[],
): number {
  if (key === 'name') {
    const cmp = a.name.localeCompare(b.name)
    return direction === 'asc' ? cmp : -cmp
  }
  if (key === 'score') {
    const cmp = a.scoreSortValue - b.scoreSortValue
    return (direction === 'asc' ? cmp : -cmp) || a.name.localeCompare(b.name)
  }
  const column = columns.find((col) => col.key === key)
  const av = column ? column.getSortValue(a) : null
  const bv = column ? column.getSortValue(b) : null
  if (av == null && bv == null) return a.name.localeCompare(b.name)
  if (av == null) return 1
  if (bv == null) return -1
  return (direction === 'asc' ? av - bv : bv - av) || a.name.localeCompare(b.name)
}

// Header cell for a sortable column — click toggles asc/desc when it's
// already the active sort, or switches to it (descending for a metric,
// ascending for COUNTRY, matching how each reads most usefully on a first
// click) otherwise. Deliberately carries no display/width utility of its
// own in its base classes — every caller is a direct child of the header
// row's flex container and supplies its own sizing/visibility className,
// the same classes RankedListRow's matching cell uses, so header and data
// columns can never drift out of alignment independently.
function SortableHeader({
  label,
  sortKey,
  activeSort,
  onSort,
  align = 'right',
  className = '',
}: {
  label: string
  sortKey: string
  activeSort: SortState
  onSort: (key: string) => void
  align?: 'left' | 'right'
  className?: string
}) {
  const isActive = activeSort.key === sortKey
  return (
    <button
      type="button"
      onClick={() => onSort(sortKey)}
      className={`${className} text-[10px] font-bold tracking-[0.2em] transition-colors ${
        align === 'right' ? 'text-right' : 'text-left'
      } ${isActive ? 'text-[#8aa0c6]' : 'text-[#5a79ab] hover:text-[#8aa0c6]'}`}
    >
      {label}
      {isActive && <span className="ml-1 text-[#4d95ff]">{activeSort.direction === 'asc' ? '▲' : '▼'}</span>}
    </button>
  )
}

function MetricThumbnail({
  metric,
  countryCount,
  onSelect,
}: {
  metric: (typeof INTEL_METRICS)[number]
  countryCount: number
  onSelect: () => void
}) {
  const available = METRIC_AVAILABLE[metric.id]
  // CURRENT STATUS has no composite score to rank by (design doc §3.5) — its
  // thumbnail reads "tracked"/"VIEW STATUS" rather than "ranked"/"VIEW
  // RANKING" so it doesn't imply an ordering that doesn't exist.
  const isCurrentStatus = metric.id === 'current-status'
  return (
    <button
      type="button"
      disabled={!available}
      onClick={onSelect}
      title={
        available
          ? `View the full ${metric.label.toLowerCase()} ${isCurrentStatus ? 'status list' : 'ranking'}`
          : `${metric.label} — no assessment data currently sourced`
      }
      className={`flex flex-col items-start gap-3 rounded-lg border p-5 text-left transition-colors ${
        available
          ? 'border-[#172440] bg-[rgba(7,11,20,0.92)] hover:border-[#3f8bff] hover:bg-[rgba(20,35,65,0.55)]'
          : 'cursor-not-allowed border-[#14213a] bg-[rgba(7,11,20,0.55)] opacity-60'
      }`}
    >
      <span className={`grid h-9 w-9 place-items-center rounded-full border ${available ? 'border-[#3f8bff] text-[#4d95ff]' : 'border-[#26385c] text-[#3d5074]'}`}>
        <Icon paths={metric.icon} size={18} />
      </span>
      <span className="text-[12px] font-bold tracking-[0.14em] text-[#dce8fb]">{metric.label}</span>
      <span className="text-[10px] leading-snug text-[#51648a]">
        {available
          ? `${countryCount} countries ${isCurrentStatus ? 'tracked' : 'ranked'}`
          : 'Awaiting data feed — no assessment data currently sourced.'}
      </span>
      {available && (
        <span className="mt-auto self-end text-[10px] font-bold tracking-[0.1em] text-[#4d95ff]">
          {isCurrentStatus ? 'VIEW STATUS ››' : 'VIEW RANKING ››'}
        </span>
      )}
    </button>
  )
}

const METRIC_COLUMN_CLASS = 'hidden shrink-0 text-right text-[11px] text-[#aebfdc] xl:block xl:w-[92px]'

// Column header row — every cell is clickable and re-sorts the list by that
// column (toggling asc/desc on repeat clicks); same widths/gaps as
// RankedListRow below it, including the same xl-only visibility on the
// metric columns, so headers and data always line up. Shared by every
// category — only the `columns` passed in differ.
function ColumnHeaderRow<TRow extends BaseRankedRow>({
  columns,
  sort,
  onSort,
}: {
  columns: AnalyticsColumn<TRow>[]
  sort: SortState
  onSort: (key: string) => void
}) {
  return (
    <div className="mb-1 flex items-center gap-3 px-3">
      <span className="w-8 shrink-0" />
      <SortableHeader label="COUNTRY" sortKey="name" activeSort={sort} onSort={onSort} align="left" className="min-w-0 flex-1" />
      {columns.map((col) => (
        <SortableHeader
          key={col.key}
          label={col.label}
          sortKey={col.key}
          activeSort={sort}
          onSort={onSort}
          className="hidden shrink-0 xl:block xl:w-[92px]"
        />
      ))}
      <span className="hidden w-[155px] shrink-0 sm:block" />
      <SortableHeader label="SCORE" sortKey="score" activeSort={sort} onSort={onSort} className="w-12 shrink-0" />
    </div>
  )
}

function RankedListRow<TRow extends BaseRankedRow>({
  row,
  rank,
  columns,
  isSelected,
  onSelect,
}: {
  row: TRow
  rank: number
  columns: AnalyticsColumn<TRow>[]
  isSelected: boolean
  onSelect: () => void
}) {
  const color = row.value !== undefined ? intelValueColor(row.value) : '#51648a'
  return (
    <button
      type="button"
      onClick={onSelect}
      className={`flex w-full items-center gap-3 rounded px-3 py-2 text-left transition-colors hover:bg-[rgba(255,255,255,0.05)] ${
        isSelected ? 'bg-[rgba(63,139,255,0.12)]' : ''
      }`}
    >
      <span className="w-8 shrink-0 text-right text-[11px] font-bold text-[#51648a]">{rank}</span>
      <span className="min-w-0 flex-1 truncate text-[12px] font-semibold text-[#dce8fb]">
        {row.name}
        {row.confidence === 'proxy' && <span className="ml-1.5 text-[10px] font-bold text-[#e0a340]">PROXY</span>}
      </span>
      {columns.map((col) => (
        <span key={col.key} className={METRIC_COLUMN_CLASS}>
          {col.format(row)}
        </span>
      ))}
      <span className="hidden h-1 w-[155px] shrink-0 overflow-hidden rounded-sm bg-[#14213a] sm:block">
        <span
          className="block h-full rounded-sm shadow-[0_0_6px_rgba(255,255,255,0.25)]"
          style={{ width: `${row.value ?? 0}%`, backgroundColor: color }}
        />
      </span>
      <span className="w-12 shrink-0 text-right text-[12px] font-bold" style={{ color }}>
        {row.value === undefined ? (row.notApplicable ? 'N/A' : '—') : row.value.toFixed(1)}
      </span>
    </button>
  )
}

// ---------------------------------------------------------------------------
// MILITARY — data/militaryScores.ts
// ---------------------------------------------------------------------------

interface MilitaryRankedRow extends BaseRankedRow {
  components?: MilitaryScore['components']
}

function buildMilitaryRows(): MilitaryRankedRow[] {
  return getCountries().map((country) => {
    const score = MILITARY_SCORES[country.id]
    const notApplicable = score?.confirmed === true
    return {
      id: country.id,
      name: country.name,
      value: notApplicable ? undefined : (score?.value ?? undefined),
      confidence: score?.confidence,
      notApplicable,
      components: score?.components,
      scoreSortValue: score?.value ?? -1,
    }
  })
}

const MILITARY_COLUMNS: AnalyticsColumn<MilitaryRankedRow>[] = [
  {
    key: 'expenditure',
    label: 'EXPENDITURE',
    getSortValue: (row) => row.components?.expenditureUsd.raw ?? null,
    format: (row) => (row.components ? formatComponent(row.components.expenditureUsd.raw, (raw) => formatGdp(raw * 1e6) ?? '—') : '—'),
  },
  {
    key: 'pctGdp',
    label: '% GDP',
    getSortValue: (row) => row.components?.pctGdp.raw ?? null,
    format: (row) => (row.components ? formatComponent(row.components.pctGdp.raw, (raw) => `${raw.toFixed(2)}%`) : '—'),
  },
  {
    key: 'personnel',
    label: 'PERSONNEL',
    getSortValue: (row) => row.components?.personnel.raw ?? null,
    format: (row) => (row.components ? formatComponent(row.components.personnel.raw, (raw) => formatPopulation(raw) ?? '—') : '—'),
  },
  {
    key: 'nuclear',
    label: 'NUCLEAR',
    getSortValue: (row) => row.components?.nuclearWarheads.raw ?? null,
    format: (row) => (row.components ? formatComponent(row.components.nuclearWarheads.raw, (raw) => raw.toLocaleString('en-US')) : '—'),
  },
  {
    key: 'industrialRev',
    label: 'DEF. INDUSTRY',
    getSortValue: (row) => row.components?.industrialBaseRevenueUsdM.raw ?? null,
    format: (row) =>
      row.components ? formatComponent(row.components.industrialBaseRevenueUsdM.raw, (raw) => formatGdp(raw * 1e6) ?? '—') : '—',
  },
]

// ---------------------------------------------------------------------------
// ECONOMY — data/economyScores.ts
// ---------------------------------------------------------------------------

interface EconomyRankedRow extends BaseRankedRow {
  components?: EconomyScore['components']
}

function buildEconomyRows(): EconomyRankedRow[] {
  return getCountries().map((country) => {
    const score = ECONOMY_SCORES[country.id]
    return {
      id: country.id,
      name: country.name,
      value: score?.value ?? undefined,
      confidence: score?.confidence,
      components: score?.components,
      // Same -1 fallback Military uses for its unscored countries — see
      // BaseRankedRow's doc comment.
      scoreSortValue: score?.value ?? -1,
    }
  })
}

// World Bank's GDP indicators (unlike SIPRI's Top-100 arms revenue) are
// already in whole current-international dollars, not millions — no *1e6
// multiplication before formatGdp, unlike Military's expenditure/
// industrial-base columns above.
const ECONOMY_COLUMNS: AnalyticsColumn<EconomyRankedRow>[] = [
  {
    key: 'gdpNominal',
    label: 'GDP',
    getSortValue: (row) => row.components?.gdpNominal.raw ?? null,
    format: (row) => (row.components ? formatComponent(row.components.gdpNominal.raw, (raw) => formatGdp(raw) ?? '—') : '—'),
  },
  {
    key: 'gdpPerCapitaPpp',
    label: 'GDP/CAPITA',
    getSortValue: (row) => row.components?.gdpPerCapitaPpp.raw ?? null,
    format: (row) =>
      row.components ? formatComponent(row.components.gdpPerCapitaPpp.raw, (raw) => formatGdpPerCapita(raw) ?? '—') : '—',
  },
  {
    key: 'gdpGrowth',
    label: 'GDP GROWTH',
    getSortValue: (row) => row.components?.gdpGrowth.raw ?? null,
    format: (row) => (row.components ? formatComponent(row.components.gdpGrowth.raw, (raw) => `${raw.toFixed(2)}%`) : '—'),
  },
  {
    key: 'unemploymentRate',
    label: 'UNEMPLOYMENT',
    getSortValue: (row) => row.components?.unemploymentRate.raw ?? null,
    format: (row) => (row.components ? formatComponent(row.components.unemploymentRate.raw, (raw) => `${raw.toFixed(2)}%`) : '—'),
  },
  {
    key: 'inflationCpi',
    label: 'INFLATION',
    getSortValue: (row) => row.components?.inflationCpi.raw ?? null,
    format: (row) => (row.components ? formatComponent(row.components.inflationCpi.raw, (raw) => `${raw.toFixed(2)}%`) : '—'),
  },
]

// ---------------------------------------------------------------------------
// TECHNOLOGY — data/technologyScores.ts
// ---------------------------------------------------------------------------

interface TechnologyRankedRow extends BaseRankedRow {
  components?: TechnologyScore['components']
}

function buildTechnologyRows(): TechnologyRankedRow[] {
  return getCountries().map((country) => {
    const score = TECHNOLOGY_SCORES[country.id]
    return {
      id: country.id,
      name: country.name,
      value: score?.value ?? undefined,
      confidence: score?.confidence,
      components: score?.components,
      // Same -1 fallback Military/Economy use for their unscored countries —
      // see BaseRankedRow's doc comment.
      scoreSortValue: score?.value ?? -1,
    }
  })
}

const TECHNOLOGY_COLUMNS: AnalyticsColumn<TechnologyRankedRow>[] = [
  {
    key: 'rdExpenditure',
    label: 'R&D % GDP',
    getSortValue: (row) => row.components?.rdExpenditurePctGdp.raw ?? null,
    format: (row) => (row.components ? formatComponent(row.components.rdExpenditurePctGdp.raw, (raw) => `${raw.toFixed(2)}%`) : '—'),
  },
  {
    key: 'patentsPerMillion',
    label: 'PATENTS/1M',
    getSortValue: (row) => row.components?.patentsPerMillion.raw ?? null,
    format: (row) => (row.components ? formatComponent(row.components.patentsPerMillion.raw, (raw) => raw.toFixed(1)) : '—'),
  },
  {
    key: 'highTechExports',
    label: 'HIGH-TECH EXP.',
    getSortValue: (row) => row.components?.highTechExportsPct.raw ?? null,
    format: (row) => (row.components ? formatComponent(row.components.highTechExportsPct.raw, (raw) => `${raw.toFixed(2)}%`) : '—'),
  },
  {
    key: 'idi',
    label: 'ICT IDI',
    getSortValue: (row) => row.components?.ictDevelopmentIndex.raw ?? null,
    format: (row) => (row.components ? formatComponent(row.components.ictDevelopmentIndex.raw, (raw) => raw.toFixed(1)) : '—'),
  },
]

// ---------------------------------------------------------------------------
// CURRENT STATUS — data/currentStatus.ts. Two independent categorical facts
// (conflicts, sanctionTier), never a 0-100 composite (design doc §3.5) — so
// this gets its own filtered/sortable list rather than reusing
// BaseRankedRow/AnalyticsColumn/RankedListRow, which are built around a
// single scored `value` and its bar. See CLAUDE.md's Intelligence Engine
// section and BACKLOG.md's "Intelligence Engine" entry for why this was left
// as an open follow-on until now.
// ---------------------------------------------------------------------------

type CurrentStatusFilter = 'all' | 'conflict' | 'sanctioned'

interface CurrentStatusRankedRow {
  id: string
  name: string
  conflicts: ConflictEntry[]
  sanctionTier: CurrentStatus['sanctionTier']
}

function buildCurrentStatusRows(): CurrentStatusRankedRow[] {
  return getCountries().map((country) => {
    const status = CURRENT_STATUS[country.id]
    return {
      id: country.id,
      name: country.name,
      conflicts: status?.conflicts ?? [],
      sanctionTier: status?.sanctionTier ?? null,
    }
  })
}

function matchesCurrentStatusFilter(row: CurrentStatusRankedRow, filter: CurrentStatusFilter): boolean {
  if (filter === 'conflict') return row.conflicts.length > 0
  if (filter === 'sanctioned') return row.sanctionTier != null
  return true
}

// red > orange > yellow > none — the only ordering OFAC tiers admit (breadth
// of restriction), used only to sort the SANCTION column. Doesn't imply a
// magnitude the way Military/Economy's SCORE column does.
const SANCTION_TIER_WEIGHT: Record<'red' | 'orange' | 'yellow', number> = { red: 3, orange: 2, yellow: 1 }

function compareCurrentStatusRows(a: CurrentStatusRankedRow, b: CurrentStatusRankedRow, sort: SortState): number {
  if (sort.key === 'name') {
    const cmp = a.name.localeCompare(b.name)
    return sort.direction === 'asc' ? cmp : -cmp
  }
  const value = (row: CurrentStatusRankedRow) =>
    sort.key === 'sanction' ? (row.sanctionTier ? SANCTION_TIER_WEIGHT[row.sanctionTier] : 0) : row.conflicts.length
  const av = value(a)
  const bv = value(b)
  return (sort.direction === 'asc' ? av - bv : bv - av) || a.name.localeCompare(b.name)
}

const CURRENT_STATUS_FILTERS: { id: CurrentStatusFilter; label: string }[] = [
  { id: 'all', label: 'ALL' },
  { id: 'conflict', label: 'ACTIVE CONFLICT' },
  { id: 'sanctioned', label: 'SANCTIONED' },
]

function CurrentStatusFilterTabs({
  filter,
  counts,
  onChange,
}: {
  filter: CurrentStatusFilter
  counts: Record<CurrentStatusFilter, number>
  onChange: (filter: CurrentStatusFilter) => void
}) {
  return (
    <div className="mb-3 flex gap-2">
      {CURRENT_STATUS_FILTERS.map((f) => {
        const active = filter === f.id
        return (
          <button
            key={f.id}
            type="button"
            onClick={() => onChange(f.id)}
            className={`rounded-full border px-3 py-1 text-[10px] font-bold tracking-[0.1em] transition-colors ${
              active
                ? 'border-[#3f8bff] bg-[rgba(63,139,255,0.15)] text-[#8fc0ff]'
                : 'border-[#172440] text-[#5a79ab] hover:text-[#8aa0c6]'
            }`}
          >
            {f.label} ({counts[f.id]})
          </button>
        )
      })}
    </div>
  )
}

// Header cells reuse SortableHeader (it's already generic over sortKey/
// activeSort/onSort, not tied to BaseRankedRow) — widths/gaps match
// CurrentStatusListRow's own cells below so the two never drift apart, same
// discipline ColumnHeaderRow/RankedListRow already follow for Military/
// Economy.
function CurrentStatusHeaderRow({ sort, onSort }: { sort: SortState; onSort: (key: string) => void }) {
  return (
    <div className="mb-1 flex items-center gap-3 px-3">
      <span className="w-8 shrink-0" />
      <SortableHeader label="COUNTRY" sortKey="name" activeSort={sort} onSort={onSort} align="left" className="min-w-0 flex-1" />
      <SortableHeader
        label="CONFLICTS"
        sortKey="conflicts"
        activeSort={sort}
        onSort={onSort}
        className="hidden w-[120px] shrink-0 sm:block"
      />
      <SortableHeader label="SANCTION" sortKey="sanction" activeSort={sort} onSort={onSort} className="w-[70px] shrink-0" />
    </div>
  )
}

// One dot per distinct conflict type present (colored via the shared
// CONFLICT_TYPE_STYLE, so it can never read a different color than the same
// type's chip in IntelligencePanel.tsx) plus the total count — the collapsed
// state of CurrentStatusListRow's CONFLICTS cell; clicking it (see below)
// expands the individual entries in place. Kept deliberately lighter than
// IntelligencePanel.tsx's ConflictChip even when expanded — no per-entry
// click-to-highlight (the globe isn't visible behind this full-screen view)
// and no country-name-aware short label — packed into a 193-row list, the
// summary is what needs to read at a glance; the full name is still there
// on hover/expand.
function ConflictSummaryCell({ conflicts }: { conflicts: ConflictEntry[] }) {
  if (conflicts.length === 0) return <span className="text-[11px] text-[#3d5074]">—</span>
  const types = [...new Set(conflicts.map((c) => c.conflictType))]
  return (
    <span className="flex items-center justify-end gap-1">
      {types.map((type) => (
        <span
          key={type}
          title={CONFLICT_TYPE_STYLE[type].label}
          className="h-1.5 w-1.5 shrink-0 rounded-full"
          style={{ backgroundColor: CONFLICT_TYPE_STYLE[type].color }}
        />
      ))}
      <span className="ml-0.5 text-[11px] font-bold text-[#dce8fb]">{conflicts.length}</span>
    </span>
  )
}

// Same badge shape as IntelligencePanel.tsx's SanctionBadge, minus the
// click-to-open-menu behavior — a row here already selects the country on
// click, so a second, different click meaning on the same badge would be
// ambiguous (same reasoning v6.5.3's CLAUDE.md entry gives for Military's
// metric columns not being their own click target).
function CurrentStatusSanctionCell({ tier }: { tier: CurrentStatus['sanctionTier'] }) {
  if (!tier) return <span className="flex justify-end text-[11px] text-[#3d5074]">—</span>
  const style = SANCTION_TIER_STYLE[tier]
  return (
    <span className="flex justify-end">
      <span
        title={style.label}
        className="grid h-[15px] w-[15px] shrink-0 place-items-center rounded-full border text-[9px] leading-none font-extrabold"
        style={{ borderColor: style.color, backgroundColor: withAlpha(style.color, 0.2), color: style.color }}
      >
        S
      </span>
    </span>
  )
}

// The CONFLICTS cell is a click target in its own right — direct request:
// clicking the conflict counter should reveal the conflicts themselves, not
// select the country the way clicking anywhere else on the row does. That
// makes the row itself no longer a single `<button>` (a `<button>` can't
// contain another interactive `<button>`) — it's a `<div role="button">`
// with the same click/keyboard semantics instead, with the CONFLICTS cell's
// real nested `<button>` stopping propagation so its click never also fires
// `onSelect`. Expand state is local to this row (keyed by `row.id` in the
// list below, so re-sorting can't detach it from the wrong country) and
// independent per row — no accordion-style "only one open at a time."
function CurrentStatusListRow({
  row,
  rank,
  isSelected,
  onSelect,
}: {
  row: CurrentStatusRankedRow
  rank: number
  isSelected: boolean
  onSelect: () => void
}) {
  const [isExpanded, setIsExpanded] = useState(false)
  const hasConflicts = row.conflicts.length > 0

  function handleRowKeyDown(e: React.KeyboardEvent) {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault()
      onSelect()
    }
  }

  function handleConflictsClick(e: React.MouseEvent) {
    e.stopPropagation()
    setIsExpanded((expanded) => !expanded)
  }

  return (
    <div>
      <div
        role="button"
        tabIndex={0}
        onClick={onSelect}
        onKeyDown={handleRowKeyDown}
        className={`flex w-full cursor-pointer items-center gap-3 rounded px-3 py-2 text-left transition-colors hover:bg-[rgba(255,255,255,0.05)] ${
          isSelected ? 'bg-[rgba(63,139,255,0.12)]' : ''
        }`}
      >
        <span className="w-8 shrink-0 text-right text-[11px] font-bold text-[#51648a]">{rank}</span>
        <span className="min-w-0 flex-1 truncate text-[12px] font-semibold text-[#dce8fb]">{row.name}</span>
        <span className="hidden w-[120px] shrink-0 sm:block">
          {hasConflicts ? (
            <button
              type="button"
              onClick={handleConflictsClick}
              title={isExpanded ? 'Hide conflicts' : 'Show conflicts'}
              className="flex w-full items-center justify-end gap-0.5 rounded transition-opacity hover:opacity-75"
            >
              <ConflictSummaryCell conflicts={row.conflicts} />
              <span className={`text-[#51648a] transition-transform ${isExpanded ? 'rotate-180' : ''}`}>
                <Icon paths={ICONS.chevronDown} size={9} />
              </span>
            </button>
          ) : (
            <ConflictSummaryCell conflicts={row.conflicts} />
          )}
        </span>
        <span className="w-[70px] shrink-0">
          <CurrentStatusSanctionCell tier={row.sanctionTier} />
        </span>
      </div>
      {isExpanded && hasConflicts && (
        <div className="mb-1 flex flex-wrap gap-1.5 py-1 pr-3 pl-11">
          {row.conflicts.map((entry, i) => {
            const style = CONFLICT_TYPE_STYLE[entry.conflictType]
            return (
              <span
                key={i}
                title={entry.conflictName}
                className="rounded-full border px-2 py-0.5 text-[9.5px] font-bold tracking-[0.06em]"
                style={{ borderColor: style.color, backgroundColor: style.background, color: style.color }}
              >
                {style.label}
                {entry.conflictName && <span className="ml-1 font-semibold opacity-80">— {entry.conflictName}</span>}
              </span>
            )
          })}
        </div>
      )}
    </div>
  )
}

const DEFAULT_SORT: SortState = { key: 'score', direction: 'desc' }
const CURRENT_STATUS_DEFAULT_SORT: SortState = { key: 'conflicts', direction: 'desc' }

function nextSort(current: SortState, key: string): SortState {
  return current.key === key
    ? { key, direction: current.direction === 'asc' ? 'desc' : 'asc' }
    : { key, direction: key === 'name' ? 'asc' : 'desc' }
}

// Opened from TopNav.tsx's ANALYTICS tab (see navStore.ts's TopNavTab) —
// deliberately a full-screen dashboard, not a docked panel like
// LayerPanel/AlliancesPanel: a clickable thumbnail per Intelligence Engine
// metric, drilling into a ranked list of all 193 countries has room to
// breathe that a 264px-wide rail panel doesn't. Clicking a country row
// selects it (opens IntelligencePanel alongside, on top of this view) but
// deliberately does NOT fly the camera there or close this view — the globe
// is hidden behind this overlay while it's open, so a flight nobody can see
// would be pointless, and "FOCUS CAMERA" already exists in IntelligencePanel
// for once the user switches back to the MAP tab.
export function AnalyticsPanel() {
  const isOpen = useTopNavTab() === 'analytics'
  const { selected } = useSelection()
  const features = useCountryFeatures()
  const [metric, setMetric] = useState<IntelMetricId | null>(null)
  const [sort, setSort] = useState(DEFAULT_SORT)
  const [currentStatusFilter, setCurrentStatusFilter] = useState<CurrentStatusFilter>('all')

  // Resets whenever the active metric changes — including back to the
  // thumbnail grid (`metric` -> null) and into a newly opened ranking — so a
  // sort (or, for CURRENT STATUS, a filter tab) chosen while looking at one
  // metric never silently carries over and surprises the next one.
  // CURRENT STATUS defaults to sorting by CONFLICTS, not SCORE — it has no
  // score column at all (see the CURRENT STATUS section above).
  useEffect(() => {
    setSort(metric === 'current-status' ? CURRENT_STATUS_DEFAULT_SORT : DEFAULT_SORT)
    setCurrentStatusFilter('all')
  }, [metric])

  // On the transition INTO this tab (not on every render while it stays
  // open — that would also fire right after a ranked-list row click reopens
  // the inspector), close whatever IntelligencePanel a prior map/search
  // selection left open. Reported directly: entering Analytics should show
  // every thumbnail unobstructed, not have an already-open inspector
  // covering the CURRENT STATUS one. `closeInspector()` only hides the
  // panel — it doesn't clear `selected` — so a row click further down still
  // has a real entity to reopen it onto, and switching back to MAP doesn't
  // lose the selection either.
  useEffect(() => {
    if (!isOpen) {
      setMetric(null)
      return
    }
    closeInspector()
  }, [isOpen])

  // Same "id -> world-space direction" derivation as hud/SearchBar.tsx's
  // selectEntry — needed so a row-clicked country's `selected.direction` is
  // real (not just needed right now, but for whenever the user later hits
  // IntelligencePanel's FOCUS CAMERA button after switching back to MAP).
  const centroidById = useMemo(() => {
    const map = new Map<string, { lat: number; lng: number }>()
    for (const f of features) {
      const id = f.id !== undefined && f.id !== null ? String(f.id) : undefined
      if (id) map.set(id, geometryToCentroid(f.geometry))
    }
    return map
  }, [features])

  if (!isOpen) return null

  // Not memoized: getCountries() reads an external registry
  // (scene/useCountryFeatures.ts populates it as a side effect of the same
  // `features` fetch, not as a function of the `features` value itself), so
  // there's no dependency array that would honestly capture when this needs
  // to recompute. A 193-row map+sort is cheap enough to just redo on every
  // render of this panel — it's already gated on `isOpen` above, so it never
  // runs at all while Analytics isn't the active tab.
  const militaryRows = buildMilitaryRows()
  const currentStatusRows = buildCurrentStatusRows()
  const currentStatusCounts: Record<CurrentStatusFilter, number> = {
    all: currentStatusRows.length,
    conflict: currentStatusRows.filter((row) => row.conflicts.length > 0).length,
    sanctioned: currentStatusRows.filter((row) => row.sanctionTier != null).length,
  }

  function selectCountryRow(id: string) {
    const centroid = centroidById.get(id)
    const resolved = resolveEntity(id)
    if (!centroid || !resolved) return
    const local = latLngToVector3(centroid.lat, centroid.lng, GLOBE_RADIUS)
    const direction = local.applyAxisAngle(UP_AXIS, getGlobeRotationY()).normalize()
    selectEntity(resolved, direction)
  }

  const activeMetric = INTEL_METRICS.find((m) => m.id === metric)

  return (
    <div className="pointer-events-auto fixed inset-x-0 top-14 bottom-0 z-20 overflow-y-auto bg-[#04070a]">
      {!activeMetric ? (
        <div className="mx-auto w-full max-w-5xl px-6 py-8">
          <div className={`${PANEL_SECTION_LABEL} mb-1`}>INTELLIGENCE ENGINE</div>
          <h1 className="mb-6 font-display text-[26px] font-bold tracking-[0.09em] text-white [text-shadow:0_0_24px_rgba(63,139,255,0.35)]">
            ANALYTICS
          </h1>
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-5">
            {INTEL_METRICS.map((m) => (
              <MetricThumbnail key={m.id} metric={m} countryCount={militaryRows.length} onSelect={() => setMetric(m.id)} />
            ))}
          </div>
        </div>
      ) : (
        <div className="mx-auto w-full max-w-6xl px-6 py-8">
          <div className="mb-4 flex items-center gap-3 border-b border-[#16233c] pb-4">
            <button
              type="button"
              onClick={() => setMetric(null)}
              className="text-[11px] font-bold tracking-[0.14em] text-[#8aa0c6] transition-colors hover:text-white"
            >
              ‹‹ ANALYTICS
            </button>
            <span className="text-[#3d5074]">/</span>
            <span className="flex items-center gap-2 text-[13px] font-bold tracking-[0.14em] text-white">
              <Icon paths={activeMetric.icon} size={16} />
              {activeMetric.label}
            </span>
            <span className="ml-auto text-[9.5px] tracking-[0.16em] text-[#51648a]">
              193 COUNTRIES ·{' '}
              {activeMetric.id === 'economy'
                ? 'WORLD BANK WDI SOURCED'
                : activeMetric.id === 'technology'
                  ? 'WORLD BANK WDI / ITU SOURCED'
                  : activeMetric.id === 'current-status'
                    ? 'UCDP / OFAC SOURCED'
                    : 'SIPRI / WORLD BANK / FAS SOURCED'}
            </span>
          </div>
          {activeMetric.id === 'economy' ? (
            <>
              <ColumnHeaderRow columns={ECONOMY_COLUMNS} sort={sort} onSort={(key) => setSort((current) => nextSort(current, key))} />
              <div className="rounded-lg border border-[#172440] bg-[rgba(7,11,20,0.6)] px-2 py-2">
                {[...buildEconomyRows()]
                  .sort((a, b) => compareRows(a, b, sort.key, sort.direction, ECONOMY_COLUMNS))
                  .map((row, index) => (
                    <RankedListRow
                      key={row.id}
                      row={row}
                      rank={index + 1}
                      columns={ECONOMY_COLUMNS}
                      isSelected={selected?.id === row.id}
                      onSelect={() => selectCountryRow(row.id)}
                    />
                  ))}
              </div>
            </>
          ) : activeMetric.id === 'technology' ? (
            <>
              <ColumnHeaderRow columns={TECHNOLOGY_COLUMNS} sort={sort} onSort={(key) => setSort((current) => nextSort(current, key))} />
              <div className="rounded-lg border border-[#172440] bg-[rgba(7,11,20,0.6)] px-2 py-2">
                {[...buildTechnologyRows()]
                  .sort((a, b) => compareRows(a, b, sort.key, sort.direction, TECHNOLOGY_COLUMNS))
                  .map((row, index) => (
                    <RankedListRow
                      key={row.id}
                      row={row}
                      rank={index + 1}
                      columns={TECHNOLOGY_COLUMNS}
                      isSelected={selected?.id === row.id}
                      onSelect={() => selectCountryRow(row.id)}
                    />
                  ))}
              </div>
            </>
          ) : activeMetric.id === 'current-status' ? (
            <>
              <CurrentStatusFilterTabs filter={currentStatusFilter} counts={currentStatusCounts} onChange={setCurrentStatusFilter} />
              <CurrentStatusHeaderRow sort={sort} onSort={(key) => setSort((current) => nextSort(current, key))} />
              <div className="rounded-lg border border-[#172440] bg-[rgba(7,11,20,0.6)] px-2 py-2">
                {[...currentStatusRows]
                  .filter((row) => matchesCurrentStatusFilter(row, currentStatusFilter))
                  .sort((a, b) => compareCurrentStatusRows(a, b, sort))
                  .map((row, index) => (
                    <CurrentStatusListRow
                      key={row.id}
                      row={row}
                      rank={index + 1}
                      isSelected={selected?.id === row.id}
                      onSelect={() => selectCountryRow(row.id)}
                    />
                  ))}
              </div>
            </>
          ) : (
            <>
              <ColumnHeaderRow columns={MILITARY_COLUMNS} sort={sort} onSort={(key) => setSort((current) => nextSort(current, key))} />
              <div className="rounded-lg border border-[#172440] bg-[rgba(7,11,20,0.6)] px-2 py-2">
                {[...militaryRows]
                  .sort((a, b) => compareRows(a, b, sort.key, sort.direction, MILITARY_COLUMNS))
                  .map((row, index) => (
                    <RankedListRow
                      key={row.id}
                      row={row}
                      rank={index + 1}
                      columns={MILITARY_COLUMNS}
                      isSelected={selected?.id === row.id}
                      onSelect={() => selectCountryRow(row.id)}
                    />
                  ))}
              </div>
            </>
          )}
        </div>
      )}
    </div>
  )
}
