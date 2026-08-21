import { useEffect, useMemo, useState } from 'react'
import { Vector3 } from 'three'
import { useTopNavTab } from './navStore'
import { useCountryFeatures } from '../scene/useCountryFeatures'
import { geometryToCentroid } from '../scene/countryGeometry'
import { latLngToVector3 } from '../utils/geo'
import { GLOBE_RADIUS } from '../scene/constants'
import { getGlobeRotationY } from '../scene/globeRotation'
import { getCountries } from '../data'
import { MILITARY_SCORES, type MilitaryConfidence, type MilitaryScore } from '../data/militaryScores'
import { resolveEntity } from '../entities/EntityResolver'
import { closeInspector, selectEntity, useSelection } from './selectionStore'
import { Icon } from './icons'
import { INTEL_METRICS, type IntelMetricId } from './intelMetrics'
import { intelValueColor } from '../utils/intelValueColor'
import { formatGdp, formatPopulation } from '../utils/formatScale'
import { PANEL_SECTION_LABEL } from './panelStyles'

const UP_AXIS = new Vector3(0, 1, 0)

// Only MILITARY has a real 0-100 composite score today (data/militaryScores.ts,
// all 193 countries, SIPRI/World Bank/FAS-sourced) — the other four thumbnails
// render the exact same "Awaiting data feed" wording IntelligencePanel.tsx
// already uses for them, rather than fabricating a ranking with nothing
// behind it. Flip an entry here to `true` once a real dataset exists for it,
// and give buildRanking (or an equivalent) a case for that metric — same
// two-step INTEL_METRICS already establishes for the per-entity status bars.
const METRIC_AVAILABLE: Record<IntelMetricId, boolean> = {
  military: true,
  economy: false,
  diplomacy: false,
  technology: false,
  'current-status': false,
}

interface RankedRow {
  id: string
  name: string
  rank: number
  value?: number
  confidence?: MilitaryConfidence
  notApplicable?: boolean
  components?: MilitaryScore['components']
}

// Sorts by the score's real underlying value (descending), not the
// display value — a confirmed no-standing-military country has a real,
// sourced 0 (see IntelligencePanel.tsx's militaryBarValue comment) and
// ranks accordingly, last among *measured* countries but still above an
// 'unavailable'-confidence country, which has no value at all (`?? -1`
// sorts those to the very bottom). Ties broken alphabetically for a stable,
// predictable order.
function buildMilitaryRanking(): RankedRow[] {
  const rows = getCountries().map((country) => {
    const score = MILITARY_SCORES[country.id]
    const notApplicable = score?.confirmed === true
    return {
      id: country.id,
      name: country.name,
      value: notApplicable ? undefined : (score?.value ?? undefined),
      confidence: score?.confidence,
      notApplicable,
      components: score?.components,
      sortValue: score?.value ?? -1,
    }
  })
  rows.sort((a, b) => b.sortValue - a.sortValue || a.name.localeCompare(b.name))
  return rows.map((row, index) => ({ ...row, rank: index + 1 }))
}

// Reported directly: the ranked list should show each of the 5 scored
// components (data/militaryScores.ts — the exact same values
// IntelligencePanel.tsx's MilitaryDrilldown cites per-country), not just the
// composite bar. `raw` is `null` for a genuine coverage gap — rendered as
// "—", the same convention every other missing-data cell in this app uses,
// never a fabricated zero.
function formatComponent(raw: number | null, format: (raw: number) => string): string {
  return raw == null ? '—' : format(raw)
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
  return (
    <button
      type="button"
      disabled={!available}
      onClick={onSelect}
      title={available ? `View the full ${metric.label.toLowerCase()} ranking` : `${metric.label} — no assessment data currently sourced`}
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
        {available ? `${countryCount} countries ranked` : 'Awaiting data feed — no assessment data currently sourced.'}
      </span>
      {available && <span className="mt-auto self-end text-[10px] font-bold tracking-[0.1em] text-[#4d95ff]">VIEW RANKING ››</span>}
    </button>
  )
}

const METRIC_COLUMN_CLASS = 'hidden shrink-0 text-right text-[11px] text-[#aebfdc] xl:block xl:w-[92px]'

function RankedListRow({ row, isSelected, onSelect }: { row: RankedRow; isSelected: boolean; onSelect: () => void }) {
  const color = row.value !== undefined ? intelValueColor(row.value) : '#51648a'
  const components = row.components
  return (
    <button
      type="button"
      onClick={onSelect}
      className={`flex w-full items-center gap-3 rounded px-3 py-2 text-left transition-colors hover:bg-[rgba(255,255,255,0.05)] ${
        isSelected ? 'bg-[rgba(63,139,255,0.12)]' : ''
      }`}
    >
      <span className="w-8 shrink-0 text-right text-[11px] font-bold text-[#51648a]">{row.rank}</span>
      <span className="min-w-0 flex-1 truncate text-[12px] font-semibold text-[#dce8fb]">
        {row.name}
        {row.confidence === 'proxy' && <span className="ml-1.5 text-[10px] font-bold text-[#e0a340]">PROXY</span>}
      </span>
      <span className={METRIC_COLUMN_CLASS}>
        {components ? formatComponent(components.expenditureUsd.raw, (raw) => formatGdp(raw * 1e6) ?? '—') : '—'}
      </span>
      <span className={METRIC_COLUMN_CLASS}>
        {components ? formatComponent(components.pctGdp.raw, (raw) => `${raw.toFixed(2)}%`) : '—'}
      </span>
      <span className={METRIC_COLUMN_CLASS}>
        {components ? formatComponent(components.personnel.raw, (raw) => formatPopulation(raw) ?? '—') : '—'}
      </span>
      <span className={METRIC_COLUMN_CLASS}>
        {components ? formatComponent(components.nuclearWarheads.raw, (raw) => raw.toLocaleString('en-US')) : '—'}
      </span>
      <span className={METRIC_COLUMN_CLASS}>
        {components
          ? formatComponent(components.industrialBaseRevenueUsdM.raw, (raw) => formatGdp(raw * 1e6) ?? '—')
          : '—'}
      </span>
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
  const militaryRanking = buildMilitaryRanking()

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
              <MetricThumbnail key={m.id} metric={m} countryCount={militaryRanking.length} onSelect={() => setMetric(m.id)} />
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
              {militaryRanking.length} COUNTRIES · SIPRI / WORLD BANK / FAS SOURCED
            </span>
          </div>
          {/* Column header row — same widths/gaps as RankedListRow below it,
              including the same xl-only visibility on the 5 component
              columns, so headers and data always line up. */}
          <div className="mb-1 hidden items-center gap-3 px-3 xl:flex">
            <span className="w-8 shrink-0" />
            <span className="min-w-0 flex-1" />
            <span className={`${PANEL_SECTION_LABEL} w-[92px] shrink-0 text-right`}>EXPENDITURE</span>
            <span className={`${PANEL_SECTION_LABEL} w-[92px] shrink-0 text-right`}>% GDP</span>
            <span className={`${PANEL_SECTION_LABEL} w-[92px] shrink-0 text-right`}>PERSONNEL</span>
            <span className={`${PANEL_SECTION_LABEL} w-[92px] shrink-0 text-right`}>NUCLEAR</span>
            <span className={`${PANEL_SECTION_LABEL} w-[92px] shrink-0 text-right`}>DEF. INDUSTRY</span>
            <span className="hidden w-[155px] shrink-0 sm:block" />
            <span className={`${PANEL_SECTION_LABEL} w-12 shrink-0 text-right`}>SCORE</span>
          </div>
          <div className="rounded-lg border border-[#172440] bg-[rgba(7,11,20,0.6)] px-2 py-2">
            {militaryRanking.map((row) => (
              <RankedListRow key={row.id} row={row} isSelected={selected?.id === row.id} onSelect={() => selectCountryRow(row.id)} />
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
