import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react'
import { Vector3 } from 'three'
import { useTopNavTab } from './navStore'
import { useCountryFeatures } from '../scene/useCountryFeatures'
import { useGeoEntityFeatures } from '../scene/useGeoEntityFeatures'
import { geometryToCentroid } from '../scene/countryGeometry'
import { ENTITY_GEOMETRY_IDS } from '../entities/entityGeometryIds'
import { latLngToVector3 } from '../utils/geo'
import { GLOBE_RADIUS } from '../scene/constants'
import { getGlobeRotationY } from '../scene/globeRotation'
import { getCountries, getEntity } from '../data'
import { MILITARY_SCORES, type MilitaryScore } from '../data/militaryScores'
import { ECONOMY_SCORES, type EconomyScore } from '../data/economyScores'
import { TECHNOLOGY_SCORES, type TechnologyScore } from '../data/technologyScores'
import { CURRENT_STATUS, type ConflictEntry, type CurrentStatus, type DemographicGroup } from '../data/currentStatus'
import { groupTopFourPlusOther, type DemographicDisplaySegment } from './demographicsGrouping'
import { CONFLICT_TYPE_STYLE } from '../scene/conflictTypeStyles'
import { SANCTION_TIER_STYLE, withAlpha } from '../scene/sanctionTierColors'
import { resolveEntity } from '../entities/EntityResolver'
import { closeInspector, selectEntity, useSelection } from './selectionStore'
import { setAnalyticsStepHandler } from './analyticsStepStore'
import { Icon } from './icons'
import { ICONS } from './iconPaths'
import { INTEL_METRICS, type IntelMetricId } from './intelMetrics'
import { intelValueColor } from '../utils/intelValueColor'
import { formatGdp, formatGdpPerCapita, formatPopulation } from '../utils/formatScale'
import { PANEL_SECTION_LABEL } from './panelStyles'

const UP_AXIS = new Vector3(0, 1, 0)

// MILITARY (data/militaryScores.ts), ECONOMY (data/economyScores.ts), and
// TECHNOLOGY (data/technologyScores.ts) have real 0-100 composite scores for
// all 194 countries; CURRENT STATUS (data/currentStatus.ts) has real,
// sourced data too but — per design doc §3.5 — never converges to a single
// number, so its view below is a filtered/sortable list, not the
// BaseRankedRow/AnalyticsColumn/RankedListRow machinery Military/Economy/
// Technology share. All 4 are real/available as of Diplomacy's removal
// (2026-08-26 — see intelMetrics.ts's own comment) — this record stays in
// place, not deleted, as the extensibility point for a possible FUTURE 5th
// category: `MetricThumbnail`'s "Awaiting data feed" placeholder path below
// still renders correctly for any entry flipped back to `false`, so a new
// category slots in the same way Technology/Current Status originally did,
// without reintroducing this mechanism from scratch.
const METRIC_AVAILABLE: Record<IntelMetricId, boolean> = {
  military: true,
  economy: true,
  technology: true,
  'current-status': true,
}

// ETHNICITY/RELIGION (src/data/currentStatus.ts's ethnicGroups/religions,
// CIA World Factbook-sourced) are two more thumbnails alongside the 4
// Intelligence Engine ones above, but deliberately NOT added to
// IntelMetricId/INTEL_METRICS (intelMetrics.ts) — that type is shared with
// IntelligencePanel.tsx's INTELLIGENCE SUMMARY status-bar loop, and neither
// field is a scored bar there (they get their own separate DEMOGRAPHICS
// section instead — see IntelligencePanel.tsx). Adding them to INTEL_METRICS
// would force IntelligencePanel to grow two new placeholder bar rows it
// doesn't want. `AnalyticsMetricId`/`ALL_METRICS` extend the concept
// locally, scoped to this file only.
type DemographicMetricId = 'ethnicity' | 'religion'
type AnalyticsMetricId = IntelMetricId | DemographicMetricId
interface MetricDef {
  id: AnalyticsMetricId
  label: string
  icon: readonly string[]
}
const DEMOGRAPHIC_METRICS: MetricDef[] = [
  { id: 'ethnicity', label: 'ETHNICITY', icon: ICONS.user },
  { id: 'religion', label: 'RELIGION', icon: ICONS.star },
]
const ALL_METRICS: MetricDef[] = [...INTEL_METRICS, ...DEMOGRAPHIC_METRICS]

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
  metric: MetricDef
  countryCount: number
  onSelect: () => void
}) {
  // ETHNICITY/RELIGION are always available (real Factbook data exists for
  // most of the registry) — they aren't keyed in METRIC_AVAILABLE at all
  // (see that Record's IntelMetricId key type), so check for them first.
  const available = metric.id === 'ethnicity' || metric.id === 'religion' ? true : METRIC_AVAILABLE[metric.id]
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
  isHighlighted,
  onSelect,
  rowRef,
}: {
  row: TRow
  rank: number
  columns: AnalyticsColumn<TRow>[]
  isSelected: boolean
  // Lookup-jump target flash — see RankingLookupBar's own comment. Distinct
  // from `isSelected` (which never changes from a lookup jump, only from an
  // actual row click/map selection) and rendered as an outer glow rather
  // than a background tint so it stays visible even when it also happens to
  // land on the already-selected row.
  isHighlighted?: boolean
  onSelect: () => void
  // Registers this row's DOM node so a lookup jump can scrollIntoView() it —
  // see AnalyticsPanel's `rowRefs` map. Optional only because TypeScript
  // requires it (every real caller passes one); there's no case where
  // omitting it is intentional.
  rowRef?: (el: HTMLButtonElement | null) => void
}) {
  const color = row.value !== undefined ? intelValueColor(row.value) : '#51648a'
  return (
    <button
      ref={rowRef}
      type="button"
      onClick={onSelect}
      className={`flex w-full items-center gap-3 rounded px-3 py-2 text-left transition-colors hover:bg-[rgba(255,255,255,0.05)] ${
        isSelected ? 'bg-[rgba(63,139,255,0.12)]' : ''
      } ${isHighlighted ? 'shadow-[0_0_0_2px_rgba(77,149,255,0.9),0_0_20px_rgba(77,149,255,0.5)]' : ''}`}
    >
      <span className="w-8 shrink-0 text-right text-[11px] font-bold text-[#51648a]">{rank}</span>
      <span className="min-w-0 flex-1 truncate text-[12px] font-semibold text-[#dce8fb]">
        {row.name}
        {row.confidence === 'proxy' && <span className="ml-1.5 text-[10px] font-bold text-[#e0a340]">PROXY</span>}
        {row.confidence === 'unavailable' && !row.notApplicable && (
          <span className="ml-1.5 text-[10px] font-bold text-[#ef4444]">UNMEASURED</span>
        )}
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

// Taiwan participates in every Intelligence Engine ranking below (Military/
// Economy/Technology/Current Status), the same as any UN-member country,
// even though it isn't one — direct request ("Taiwan should be recognized
// as a country... I need Taiwan in all of these analytics"). All 4 builders
// below only ever read `.id`/`.name` off a "country" entry, which
// `getEntity('taiwan')`'s GeoEntity record already has — reusing that
// directly (rather than hardcoding a second copy of Taiwan's name here)
// keeps this in sync with the GeoEntity registry's own record if it's ever
// renamed. Falls back to just `getCountries()` if 'taiwan' somehow isn't
// registered, which should never happen (data/registry/geoEntities.ts
// registers it unconditionally at module load).
function getRankableCountries(): { id: string; name: string }[] {
  const taiwan = getEntity('taiwan')
  return taiwan ? [...getCountries(), taiwan] : getCountries()
}

// `nuclearWarheads`/`industrialBaseRevenueUsdM` are "true-zero" components
// (see buildMilitary.mjs's own header comment) — every country NOT on FAS's
// 9-nation nuclear list or SIPRI's Top-100 arms manufacturers list gets a
// raw value of exactly 0 by default, not because that specific country was
// individually confirmed to have none, just because it isn't on either
// list. For a country with an overall 'measured'/'proxy' military score,
// that default 0 is fine to rank normally alongside everyone else's real
// numbers (it's one knowable fact among many others that ARE well-sourced
// for that country). But for an 'unavailable'-confidence country — one that
// doesn't have enough OTHER data to produce a real score at all (Bahamas:
// 1 of 3 core components present) — that same default 0 is the only reason
// it would appear in a nuclear/industrial-base ranking, and it isn't a
// specific fact about that country's nuclear program the way a real
// FAS-sourced entry is. Real bug this fixes: sorting by NUCLEAR put the
// Bahamas (raw 0, confidence 'unavailable') at rank ~21, ahead of most
// actually-measured countries, purely by alphabetical tiebreak among a pile
// of default zeros. Sinks to the bottom (via compareRows' null handling)
// instead, unless the raw value is genuinely nonzero (a real FAS/SIPRI
// entry, which never coincides with 'unavailable' confidence in practice).
function trueZeroSortValue(raw: number | null, confidence: BaseRankedRow['confidence']): number | null {
  if (raw == null) return null
  if (raw === 0 && confidence === 'unavailable') return null
  return raw
}

function buildMilitaryRows(): MilitaryRankedRow[] {
  return getRankableCountries().map((country) => {
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
    getSortValue: (row) => trueZeroSortValue(row.components?.nuclearWarheads.raw ?? null, row.confidence),
    format: (row) => (row.components ? formatComponent(row.components.nuclearWarheads.raw, (raw) => raw.toLocaleString('en-US')) : '—'),
  },
  {
    key: 'industrialRev',
    label: 'DEF. INDUSTRY',
    getSortValue: (row) => trueZeroSortValue(row.components?.industrialBaseRevenueUsdM.raw ?? null, row.confidence),
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
  return getRankableCountries().map((country) => {
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
  return getRankableCountries().map((country) => {
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
  return getRankableCountries().map((country) => {
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
  isHighlighted,
  onSelect,
  rowRef,
}: {
  row: CurrentStatusRankedRow
  rank: number
  isSelected: boolean
  isHighlighted?: boolean
  onSelect: () => void
  rowRef?: (el: HTMLDivElement | null) => void
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
        ref={rowRef}
        role="button"
        tabIndex={0}
        onClick={onSelect}
        onKeyDown={handleRowKeyDown}
        className={`flex w-full cursor-pointer items-center gap-3 rounded px-3 py-2 text-left transition-colors hover:bg-[rgba(255,255,255,0.05)] ${
          isSelected ? 'bg-[rgba(63,139,255,0.12)]' : ''
        } ${isHighlighted ? 'shadow-[0_0_0_2px_rgba(77,149,255,0.9),0_0_20px_rgba(77,149,255,0.5)]' : ''}`}
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

// ---------------------------------------------------------------------------
// ETHNICITY / RELIGION — src/data/currentStatus.ts's ethnicGroups/religions.
// No 0-100 composite (same reason CURRENT STATUS above has none) AND no
// single natural "biggest number wins" column the way Military/Economy's
// SCORE is either — each country's largest group has a different NAME, so
// there's nothing to rank by default. Default sort is alphabetical by
// country (direct request), with each of the 5 display-position columns
// (GROUP 1-4, OTHER — see demographicsGrouping.ts's top-4-plus-other
// transform, the same one SegmentedBar.tsx uses) independently sortable by
// that position's percentage. Gets its own header/row (not
// BaseRankedRow/AnalyticsColumn/RankedListRow) for the same reason CURRENT
// STATUS does: no SCORE bar to anchor that machinery's shape.
// ---------------------------------------------------------------------------

interface DemographicRankedRow {
  id: string
  name: string
  segments: DemographicDisplaySegment[]
}

function buildDemographicRows(pickGroups: (status: CurrentStatus | undefined) => DemographicGroup[] | undefined): DemographicRankedRow[] {
  return getRankableCountries().map((country) => ({
    id: country.id,
    name: country.name,
    segments: groupTopFourPlusOther(pickGroups(CURRENT_STATUS[country.id]) ?? []),
  }))
}

const buildEthnicityRows = () => buildDemographicRows((status) => status?.ethnicGroups)
const buildReligionRows = () => buildDemographicRows((status) => status?.religions)

// One sort key per display position, GROUP 1 (index 0) through UNKNOWN
// (index 5) — mirrors demographicsGrouping.ts's groupTopFourPlusOther,
// which can emit up to 4 named groups + "Other" + a synthesized "Unknown"
// remainder (the source's own figures not summing to 100%). A country with
// fewer than 6 segments simply has no value at the missing positions (sorts
// last, same convention as every other coverage gap in this file).
const GROUP_POSITION_KEYS = ['group0', 'group1', 'group2', 'group3', 'group4', 'group5'] as const
const GROUP_POSITION_LABELS = ['GROUP 1', 'GROUP 2', 'GROUP 3', 'GROUP 4', 'OTHER', 'UNKNOWN']

function compareDemographicRows(a: DemographicRankedRow, b: DemographicRankedRow, sort: SortState): number {
  if (sort.key === 'name') {
    const cmp = a.name.localeCompare(b.name)
    return sort.direction === 'asc' ? cmp : -cmp
  }
  const index = GROUP_POSITION_KEYS.indexOf(sort.key as (typeof GROUP_POSITION_KEYS)[number])
  const av = index === -1 ? null : (a.segments[index]?.pct ?? null)
  const bv = index === -1 ? null : (b.segments[index]?.pct ?? null)
  if (av == null && bv == null) return a.name.localeCompare(b.name)
  if (av == null) return 1
  if (bv == null) return -1
  return (sort.direction === 'asc' ? av - bv : bv - av) || a.name.localeCompare(b.name)
}

// Mirrors ColumnHeaderRow's widths/gaps but with no SCORE column and 5
// (rather than up to 5 metric) columns wide enough to hold a "Name — NN.N%"
// cell instead of ColumnHeaderRow's own narrower METRIC_COLUMN_CLASS.
function DemographicHeaderRow({ sort, onSort }: { sort: SortState; onSort: (key: string) => void }) {
  return (
    <div className="mb-1 flex items-center gap-3 px-3">
      <span className="w-8 shrink-0" />
      <SortableHeader label="COUNTRY" sortKey="name" activeSort={sort} onSort={onSort} align="left" className="min-w-0 flex-1" />
      {GROUP_POSITION_KEYS.map((key, i) => (
        <SortableHeader
          key={key}
          label={GROUP_POSITION_LABELS[i]}
          sortKey={key}
          activeSort={sort}
          onSort={onSort}
          className="hidden shrink-0 lg:block lg:w-[150px]"
        />
      ))}
    </div>
  )
}

function DemographicListRow({
  row,
  rank,
  isSelected,
  isHighlighted,
  onSelect,
  rowRef,
}: {
  row: DemographicRankedRow
  rank: number
  isSelected: boolean
  isHighlighted?: boolean
  onSelect: () => void
  rowRef?: (el: HTMLButtonElement | null) => void
}) {
  return (
    <button
      ref={rowRef}
      type="button"
      onClick={onSelect}
      className={`flex w-full items-center gap-3 rounded px-3 py-2 text-left transition-colors hover:bg-[rgba(255,255,255,0.05)] ${
        isSelected ? 'bg-[rgba(63,139,255,0.12)]' : ''
      } ${isHighlighted ? 'shadow-[0_0_0_2px_rgba(77,149,255,0.9),0_0_20px_rgba(77,149,255,0.5)]' : ''}`}
    >
      <span className="w-8 shrink-0 text-right text-[11px] font-bold text-[#51648a]">{rank}</span>
      <span className="min-w-0 flex-1 truncate text-[12px] font-semibold text-[#dce8fb]">{row.name}</span>
      {[0, 1, 2, 3, 4, 5].map((i) => {
        const segment = row.segments[i]
        return (
          <span key={i} className="hidden shrink-0 truncate text-right text-[11px] text-[#aebfdc] lg:block lg:w-[150px]">
            {segment ? `${segment.name} — ${segment.pct.toFixed(1)}%` : '—'}
          </span>
        )
      })}
    </button>
  )
}

// ---------------------------------------------------------------------------
// Ranking lookup — jump to a country's row within whichever list is
// currently open, without selecting it. Deliberately NOT SearchBar.tsx's
// selectEntry() — that calls selectEntity(), which opens IntelligencePanel
// on top of this full-screen view; direct request was for the opposite:
// stay on this ranking and just scroll to the row. Scoped to whichever rows
// are actually ON SCREEN for the active metric (AnalyticsPanel passes in
// the current, filter-aware row list — see `activeLookupRows`) rather than
// the full 193-country registry, so e.g. searching a non-sanctioned country
// while CURRENT STATUS's SANCTIONED filter is active correctly reports
// "not in this list" instead of jumping to a row that isn't rendered.
// ---------------------------------------------------------------------------
const LOOKUP_MAX_RESULTS = 8
// How long a jumped-to row's glow stays visible before self-clearing.
const LOOKUP_HIGHLIGHT_MS = 2200

interface LookupRow {
  id: string
  name: string
}

// Same three-tier ranking (exact, then starts-with, then contains) as
// SearchBar.tsx's `matches` — kept as a separate, smaller copy rather than
// a shared helper, since SearchBar's version ranks a `SearchEntry` union
// (country/GeoEntity/city/...) and this only ever ranks the plain
// {id, name} pairs a ranked list already has.
function rankLookupMatches(rows: LookupRow[], query: string): LookupRow[] {
  const q = query.trim().toLowerCase()
  if (!q) return []
  const exact: LookupRow[] = []
  const starts: LookupRow[] = []
  const includes: LookupRow[] = []
  for (const row of rows) {
    const name = row.name.toLowerCase()
    if (name === q) exact.push(row)
    else if (name.startsWith(q)) starts.push(row)
    else if (name.includes(q)) includes.push(row)
  }
  return [...exact, ...starts, ...includes].slice(0, LOOKUP_MAX_RESULTS)
}

// Self-contained, like SearchBar.tsx — owns its own `query` state rather
// than lifting it to AnalyticsPanel, since nothing outside this component
// needs to read it. AnalyticsPanel remounts this (via a `key={activeMetric.id}`
// on the call site) whenever the active metric changes, so a query typed
// while looking at one ranking never silently carries over into the next.
function RankingLookupBar({
  rows,
  onJumpTo,
  onStep,
}: {
  rows: LookupRow[]
  onJumpTo: (id: string) => void
  // ArrowUp/ArrowDown while focused here step to the previous/next row in
  // the ranking's current order — the keyboard counterpart to the up/down
  // buttons AnalyticsPanel renders next to this bar. Not scoped to `matches`
  // (unlike a typical autocomplete's arrow-through-suggestions) — it steps
  // the WHOLE visible ranking regardless of what's typed, since the point is
  // browsing without needing a query at all.
  onStep: (direction: 1 | -1) => void
}) {
  const [query, setQuery] = useState('')
  const matches = useMemo(() => rankLookupMatches(rows, query), [rows, query])
  const notFound = query.trim().length > 0 && matches.length === 0

  function jump(row: LookupRow) {
    onJumpTo(row.id)
    setQuery('')
  }

  function handleSubmit(e: FormEvent) {
    e.preventDefault()
    const top = matches[0]
    if (top) jump(top)
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      onStep(1)
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      onStep(-1)
    }
  }

  return (
    <div className="relative w-[170px] shrink-0 sm:w-[210px]">
      <div className="flex h-8 items-center gap-2 rounded-full border border-[#1c2c4b] bg-[rgba(15,23,40,0.9)] px-3">
        <span className="shrink-0 text-[#5a729a]">
          <Icon paths={ICONS.search} size={12} />
        </span>
        <form onSubmit={handleSubmit} className="min-w-0 flex-1">
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Jump to country..."
            aria-label="Jump to country in this ranking"
            className="w-full bg-transparent text-[11.5px] text-[#dce8fb] outline-none placeholder:text-[#51648a]"
          />
        </form>
      </div>

      {matches.length > 0 && (
        <ul className="absolute top-full right-0 z-50 mt-2 max-h-72 w-[240px] overflow-y-auto rounded-lg border border-[#172440] bg-[rgba(7,11,20,0.97)] shadow-[0_10px_34px_rgba(0,0,0,0.55)] backdrop-blur-[12px]">
          {matches.map((row) => (
            <li key={row.id}>
              <button
                type="button"
                onClick={() => jump(row)}
                className="block w-full truncate px-3 py-2 text-left text-[11.5px] text-[#dce8fb] hover:bg-[rgba(63,139,255,0.14)]"
              >
                {row.name}
              </button>
            </li>
          ))}
        </ul>
      )}
      {notFound && (
        <div className="absolute top-full right-0 z-50 mt-2 w-[240px] rounded-lg border border-[#172440] bg-[rgba(7,11,20,0.97)] px-3 py-2 text-[10px] tracking-[0.1em] text-[#ff4a42] backdrop-blur-[12px]">
          NOT IN THIS LIST
        </div>
      )}
    </div>
  )
}

const DEFAULT_SORT: SortState = { key: 'score', direction: 'desc' }
const CURRENT_STATUS_DEFAULT_SORT: SortState = { key: 'conflicts', direction: 'desc' }
// Direct request: default/main sort for ETHNICITY/RELIGION is alphabetical
// by country, not by any group's percentage — unlike every other category
// here, there's no single column that reads as "the" default ranking axis.
const DEMOGRAPHIC_DEFAULT_SORT: SortState = { key: 'name', direction: 'asc' }

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
  const geoEntityFeatures = useGeoEntityFeatures()
  const [metric, setMetric] = useState<AnalyticsMetricId | null>(null)
  const [sort, setSort] = useState(DEFAULT_SORT)
  const [currentStatusFilter, setCurrentStatusFilter] = useState<CurrentStatusFilter>('all')

  // Ranking lookup — see RankingLookupBar's own comment. `rowRefs` maps a
  // country id to its currently-rendered row DOM node so a jump can
  // scrollIntoView() it; populated/cleared by each row's own `rowRef`
  // callback as it mounts/unmounts (switching metrics or CURRENT STATUS
  // filters naturally clears out whichever ids are no longer rendered).
  // `lookupHighlightId` drives the brief glow flash and self-clears after
  // LOOKUP_HIGHLIGHT_MS so it reads as "found it," not a permanent marker.
  const rowRefs = useRef(new Map<string, HTMLElement>())
  const [lookupHighlightId, setLookupHighlightId] = useState<string | null>(null)
  const highlightTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  // Publishes `jumpToOffset` (defined below, after the `!isOpen` early
  // return, so it can't be referenced directly from a hook up here — see
  // KeyboardController.ts's identical `onCommandRef` pattern for the same
  // "ref updated during render, hook registers a stable wrapper once"
  // shape) to analyticsStepStore.ts, so InputManager.tsx can route
  // ArrowUp/ArrowDown here while the ANALYTICS tab is active instead of to
  // the map's own arrow-key navigation — direct report: arrows stayed
  // "locked to the map" even while looking at Analytics, since that global
  // handler never knew which tab was actually showing. Registered once
  // (AnalyticsPanel is always mounted, per App.tsx) rather than tied to
  // `isOpen`/`activeMetric` — the wrapper always delegates to whatever
  // `jumpToOffset` most recently was, which already no-ops correctly when
  // no ranking is open (see that function's own `ids.length === 0` guard).
  const jumpToOffsetRef = useRef<((direction: 1 | -1) => void) | null>(null)
  useEffect(() => {
    setAnalyticsStepHandler((direction) => jumpToOffsetRef.current?.(direction))
    return () => setAnalyticsStepHandler(null)
  }, [])

  function jumpToRow(id: string) {
    const el = rowRefs.current.get(id)
    if (!el) return
    // Instant, not smooth — a jump can cross the full 193-row list in one
    // call (rank 1 to rank 190+), and animating that distance is both slow
    // and, worse, gave the in-progress scroll a window to visibly desync
    // from the highlight-flash state update firing the same tick. Landing
    // immediately plus the glow flash below reads as "found it" just as
    // clearly without either problem.
    el.scrollIntoView({ behavior: 'auto', block: 'center' })
    setLookupHighlightId(id)
    if (highlightTimeoutRef.current) clearTimeout(highlightTimeoutRef.current)
    highlightTimeoutRef.current = setTimeout(() => setLookupHighlightId(null), LOOKUP_HIGHLIGHT_MS)
  }

  // Resets whenever the active metric changes — including back to the
  // thumbnail grid (`metric` -> null) and into a newly opened ranking — so a
  // sort (or, for CURRENT STATUS, a filter tab) chosen while looking at one
  // metric never silently carries over and surprises the next one.
  // CURRENT STATUS defaults to sorting by CONFLICTS, not SCORE — it has no
  // score column at all (see the CURRENT STATUS section above). Also drops
  // any in-flight lookup highlight/timeout — a flash from the previous
  // ranking has no row to land on in the new one.
  useEffect(() => {
    setSort(
      metric === 'current-status'
        ? CURRENT_STATUS_DEFAULT_SORT
        : metric === 'ethnicity' || metric === 'religion'
          ? DEMOGRAPHIC_DEFAULT_SORT
          : DEFAULT_SORT
    )
    setCurrentStatusFilter('all')
    setLookupHighlightId(null)
    return () => {
      if (highlightTimeoutRef.current) clearTimeout(highlightTimeoutRef.current)
    }
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
    // Taiwan — a GeoEntity, not a Country, so it has no entry in `features`
    // above — needs its centroid derived from its own rendered geometry the
    // same way input/SelectionController.ts's candidate list already does:
    // find the GeoEntity feature whose geometry id maps to entity id
    // 'taiwan' (ENTITY_GEOMETRY_IDS['158'] === 'taiwan' — see
    // entities/entityGeometryIds.ts) and key its centroid by 'taiwan'
    // directly, so selectCountryRow('taiwan') below resolves it.
    for (const f of geoEntityFeatures) {
      const geometryId = f.id !== undefined && f.id !== null ? String(f.id) : undefined
      if (geometryId && ENTITY_GEOMETRY_IDS[geometryId] === 'taiwan') {
        map.set('taiwan', geometryToCentroid(f.geometry))
        break
      }
    }
    return map
  }, [features, geoEntityFeatures])

  if (!isOpen) return null

  // Not memoized: getCountries() reads an external registry
  // (scene/useCountryFeatures.ts populates it as a side effect of the same
  // `features` fetch, not as a function of the `features` value itself), so
  // there's no dependency array that would honestly capture when this needs
  // to recompute. A 193-row map+sort is cheap enough to just redo on every
  // render of this panel — it's already gated on `isOpen` above, so it never
  // runs at all while Analytics isn't the active tab.
  const militaryRows = buildMilitaryRows()
  const economyRows = buildEconomyRows()
  const technologyRows = buildTechnologyRows()
  const currentStatusRows = buildCurrentStatusRows()
  const ethnicityRows = buildEthnicityRows()
  const religionRows = buildReligionRows()
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

  const activeMetric = ALL_METRICS.find((m) => m.id === metric)

  // Sorted (and, for CURRENT STATUS, filtered) once here rather than inline
  // in each render branch below — needed in two places now that arrow-step
  // navigation exists: the render itself, AND `activeLookupRows`/
  // `jumpToOffset` below, which both need the exact ON-SCREEN order to make
  // "next/previous row" mean anything. Computing it twice (once for
  // rendering, once for stepping) would risk the two silently drifting
  // apart if a sort/filter rule ever changed in only one place.
  const sortedMilitaryRows = [...militaryRows].sort((a, b) => compareRows(a, b, sort.key, sort.direction, MILITARY_COLUMNS))
  const sortedEconomyRows = [...economyRows].sort((a, b) => compareRows(a, b, sort.key, sort.direction, ECONOMY_COLUMNS))
  const sortedTechnologyRows = [...technologyRows].sort((a, b) => compareRows(a, b, sort.key, sort.direction, TECHNOLOGY_COLUMNS))
  const sortedCurrentStatusRows = [...currentStatusRows]
    .filter((row) => matchesCurrentStatusFilter(row, currentStatusFilter))
    .sort((a, b) => compareCurrentStatusRows(a, b, sort))
  const sortedEthnicityRows = [...ethnicityRows].sort((a, b) => compareDemographicRows(a, b, sort))
  const sortedReligionRows = [...religionRows].sort((a, b) => compareDemographicRows(a, b, sort))

  // What RankingLookupBar searches, jumpToRow can land on, and jumpToOffset
  // steps through — the same rows actually rendered below for the active
  // metric, in the same order, not the full 194-country registry (see
  // RankingLookupBar's own comment for why: CURRENT STATUS's filter tabs
  // mean a filtered-out country genuinely has no row on screen to jump to).
  // Mirrors the render ternary's own branching below, military as the
  // fallback for any `activeMetric.id` that isn't one of the other explicit
  // branches (there's no such id reachable today — every ALL_METRICS value
  // has its own explicit branch — but the fallback stays rather than adding
  // a redundant final `=== 'military'` check that would just duplicate it).
  const activeLookupRows: LookupRow[] = !activeMetric
    ? []
    : activeMetric.id === 'economy'
      ? sortedEconomyRows
      : activeMetric.id === 'technology'
        ? sortedTechnologyRows
        : activeMetric.id === 'current-status'
          ? sortedCurrentStatusRows
          : activeMetric.id === 'ethnicity'
            ? sortedEthnicityRows
            : activeMetric.id === 'religion'
              ? sortedReligionRows
              : sortedMilitaryRows

  // Steps the highlight/scroll target to the next (+1) or previous (-1) row
  // in `activeLookupRows`' current on-screen order — "switch between
  // countries" without retyping a search each time, direct request
  // alongside the sticky lookup bar. Wraps around at either end. Starting
  // point when nothing's highlighted yet: +1 lands on the first row (top of
  // whatever's currently sorted first), -1 on the last — either direction
  // always lands somewhere real rather than silently no-op-ing on a fresh
  // ranking view.
  //
  // Reference point is `lookupHighlightId` (a prior search jump) FIRST, but
  // falls back to `selected?.id` — direct follow-up: stepping used to only
  // pick up from a search jump, so arrowing after simply clicking a row did
  // nothing (`lookupHighlightId` stays null on a plain row click). Now a
  // click seeds the starting point too.
  //
  // Always closes IntelligencePanel (`closeInspector()`, a harmless no-op if
  // it wasn't open) rather than following along with a `selectCountryRow`
  // call — direct correction of an earlier version of this feature that DID
  // keep an open panel in sync as you stepped: reported directly that
  // arrow/step navigation should close the panel instead, and the panel
  // should only ever open from an explicit row click. `selected` itself
  // (and therefore which row still reads as the blue "selected" tint, and
  // which country the globe/status-bar summary shows) is deliberately left
  // untouched here — only the panel's open/closed state changes, the same
  // "closeInspector doesn't clear the selection" split `dismiss`'s Escape
  // handling already relies on elsewhere (see selectionStore.ts).
  function jumpToOffset(direction: 1 | -1) {
    const ids = activeLookupRows.map((row) => row.id)
    if (ids.length === 0) return
    const referenceId = lookupHighlightId ?? selected?.id ?? null
    const currentIndex = referenceId ? ids.indexOf(referenceId) : -1
    const nextIndex = currentIndex === -1 ? (direction === 1 ? 0 : ids.length - 1) : (currentIndex + direction + ids.length) % ids.length
    const nextId = ids[nextIndex]
    jumpToRow(nextId)
    closeInspector()
  }
  // Keeps analyticsStepStore's registered wrapper pointed at THIS render's
  // jumpToOffset (fresh `sort`/`currentStatusFilter`/`lookupHighlightId`/
  // `selected`) — a plain ref mutation during render, not inside an effect,
  // matching KeyboardController.ts's own `onCommandRef.current = onCommand`
  // for the identical reason (see this file's earlier registration effect).
  jumpToOffsetRef.current = jumpToOffset

  return (
    <div className="pointer-events-auto fixed inset-x-0 top-14 bottom-0 z-20 overflow-y-auto bg-[#04070a]">
      {!activeMetric ? (
        <div className="mx-auto w-full max-w-5xl px-6 py-8">
          <div className={`${PANEL_SECTION_LABEL} mb-1`}>INTELLIGENCE ENGINE</div>
          <h1 className="mb-6 font-display text-[26px] font-bold tracking-[0.09em] text-white [text-shadow:0_0_24px_rgba(63,139,255,0.35)]">
            ANALYTICS
          </h1>
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-6">
            {ALL_METRICS.map((m) => (
              <MetricThumbnail key={m.id} metric={m} countryCount={militaryRows.length} onSelect={() => setMetric(m.id)} />
            ))}
          </div>
        </div>
      ) : (
        <div className="mx-auto w-full max-w-6xl px-6 py-8">
          {/* `sticky top-0` (direct request — the lookup bar used to
              scroll away with the list, forcing a scroll back to the top
              just to search again) needs its own opaque background, since
              rows now scroll UNDER it rather than past it; `z-10` keeps it
              above those rows (which have no z-index of their own) without
              needing to touch anything else's stacking. */}
          <div className="sticky top-0 z-10 mb-4 flex items-center gap-3 border-b border-[#16233c] bg-[#04070a] pb-4">
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
            <div className="ml-auto flex items-center gap-2">
              <RankingLookupBar key={activeMetric.id} rows={activeLookupRows} onJumpTo={jumpToRow} onStep={jumpToOffset} />
              {/* Up/down step buttons — "switch between countries" without
                  retyping a search each time, alongside the lookup bar's
                  own ArrowUp/ArrowDown handling (same jumpToOffset call
                  either way; these exist for anyone who'd rather click than
                  use the keyboard). */}
              <div className="flex flex-col overflow-hidden rounded border border-[#1c2c4b]">
                <button
                  type="button"
                  onClick={() => jumpToOffset(-1)}
                  aria-label="Previous country in this ranking"
                  title="Previous country in this ranking"
                  className="grid h-4 w-6 place-items-center text-[#5a729a] transition-colors hover:bg-[rgba(63,139,255,0.14)] hover:text-[#8aa0c6]"
                >
                  <span className="rotate-180">
                    <Icon paths={ICONS.chevronDown} size={9} />
                  </span>
                </button>
                <button
                  type="button"
                  onClick={() => jumpToOffset(1)}
                  aria-label="Next country in this ranking"
                  title="Next country in this ranking"
                  className="grid h-4 w-6 place-items-center border-t border-[#1c2c4b] text-[#5a729a] transition-colors hover:bg-[rgba(63,139,255,0.14)] hover:text-[#8aa0c6]"
                >
                  <Icon paths={ICONS.chevronDown} size={9} />
                </button>
              </div>
              <span className="hidden text-[9.5px] tracking-[0.16em] text-[#51648a] md:inline">
                {/* Dynamic, not hardcoded "193" — activeLookupRows already
                    includes Taiwan (see getRankableCountries), so this
                    honestly reads 194 rather than silently undercounting
                    once the ranked list itself has more rows than the
                    caption claims. */}
                {activeLookupRows.length} COUNTRIES ·{' '}
                {activeMetric.id === 'economy'
                  ? 'WORLD BANK WDI SOURCED'
                  : activeMetric.id === 'technology'
                    ? 'WORLD BANK WDI / ITU SOURCED'
                    : activeMetric.id === 'current-status'
                      ? 'UCDP / OFAC SOURCED'
                      : activeMetric.id === 'ethnicity' || activeMetric.id === 'religion'
                        ? 'CIA WORLD FACTBOOK SOURCED'
                        : 'SIPRI / WORLD BANK / FAS SOURCED'}
              </span>
            </div>
          </div>
          {activeMetric.id === 'economy' ? (
            <>
              <ColumnHeaderRow columns={ECONOMY_COLUMNS} sort={sort} onSort={(key) => setSort((current) => nextSort(current, key))} />
              <div className="rounded-lg border border-[#172440] bg-[rgba(7,11,20,0.6)] px-2 py-2">
                {sortedEconomyRows.map((row, index) => (
                    <RankedListRow
                      key={row.id}
                      row={row}
                      rank={index + 1}
                      columns={ECONOMY_COLUMNS}
                      isSelected={selected?.id === row.id}
                      isHighlighted={lookupHighlightId === row.id}
                      onSelect={() => selectCountryRow(row.id)}
                      rowRef={(el) => {
                        if (el) rowRefs.current.set(row.id, el)
                        else rowRefs.current.delete(row.id)
                      }}
                    />
                  ))}
              </div>
            </>
          ) : activeMetric.id === 'technology' ? (
            <>
              <ColumnHeaderRow columns={TECHNOLOGY_COLUMNS} sort={sort} onSort={(key) => setSort((current) => nextSort(current, key))} />
              <div className="rounded-lg border border-[#172440] bg-[rgba(7,11,20,0.6)] px-2 py-2">
                {sortedTechnologyRows.map((row, index) => (
                    <RankedListRow
                      key={row.id}
                      row={row}
                      rank={index + 1}
                      columns={TECHNOLOGY_COLUMNS}
                      isSelected={selected?.id === row.id}
                      isHighlighted={lookupHighlightId === row.id}
                      onSelect={() => selectCountryRow(row.id)}
                      rowRef={(el) => {
                        if (el) rowRefs.current.set(row.id, el)
                        else rowRefs.current.delete(row.id)
                      }}
                    />
                  ))}
              </div>
            </>
          ) : activeMetric.id === 'current-status' ? (
            <>
              <CurrentStatusFilterTabs filter={currentStatusFilter} counts={currentStatusCounts} onChange={setCurrentStatusFilter} />
              <CurrentStatusHeaderRow sort={sort} onSort={(key) => setSort((current) => nextSort(current, key))} />
              <div className="rounded-lg border border-[#172440] bg-[rgba(7,11,20,0.6)] px-2 py-2">
                {sortedCurrentStatusRows.map((row, index) => (
                    <CurrentStatusListRow
                      key={row.id}
                      row={row}
                      rank={index + 1}
                      isSelected={selected?.id === row.id}
                      isHighlighted={lookupHighlightId === row.id}
                      onSelect={() => selectCountryRow(row.id)}
                      rowRef={(el) => {
                        if (el) rowRefs.current.set(row.id, el)
                        else rowRefs.current.delete(row.id)
                      }}
                    />
                  ))}
              </div>
            </>
          ) : activeMetric.id === 'ethnicity' || activeMetric.id === 'religion' ? (
            <>
              <DemographicHeaderRow sort={sort} onSort={(key) => setSort((current) => nextSort(current, key))} />
              <div className="rounded-lg border border-[#172440] bg-[rgba(7,11,20,0.6)] px-2 py-2">
                {(activeMetric.id === 'ethnicity' ? sortedEthnicityRows : sortedReligionRows).map((row, index) => (
                    <DemographicListRow
                      key={row.id}
                      row={row}
                      rank={index + 1}
                      isSelected={selected?.id === row.id}
                      isHighlighted={lookupHighlightId === row.id}
                      onSelect={() => selectCountryRow(row.id)}
                      rowRef={(el) => {
                        if (el) rowRefs.current.set(row.id, el)
                        else rowRefs.current.delete(row.id)
                      }}
                    />
                  ))}
              </div>
            </>
          ) : (
            <>
              <ColumnHeaderRow columns={MILITARY_COLUMNS} sort={sort} onSort={(key) => setSort((current) => nextSort(current, key))} />
              <div className="rounded-lg border border-[#172440] bg-[rgba(7,11,20,0.6)] px-2 py-2">
                {sortedMilitaryRows.map((row, index) => (
                    <RankedListRow
                      key={row.id}
                      row={row}
                      rank={index + 1}
                      columns={MILITARY_COLUMNS}
                      isSelected={selected?.id === row.id}
                      isHighlighted={lookupHighlightId === row.id}
                      onSelect={() => selectCountryRow(row.id)}
                      rowRef={(el) => {
                        if (el) rowRefs.current.set(row.id, el)
                        else rowRefs.current.delete(row.id)
                      }}
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
