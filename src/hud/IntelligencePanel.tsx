import { useEffect, useState } from 'react'
import { clearSelection, flyToSelectedCountry, useSelection, type SelectedEntity } from './selectionStore'
import { COUNTRY_PROFILES } from '../data/countryProfiles'
import { PRIMARY_ECONOMIC_YEAR } from '../data/countryEconomics'
import { ALLIANCES } from '../data/allianceMemberships'
import { COUNTRY_NAME_TO_ISO3 } from '../data/countryIso3'
import { MILITARY_SCORES, type MilitaryConfidence, type MilitaryScore } from '../data/militaryScores'
import { AllianceBadge } from './AllianceBadge'
import type { Country, GeoEntity, GeoEntityRelation, GeoEntityType } from '../data'
import { HIGHLIGHT_COLORS } from '../scene/highlightColors'
import { formatArea, formatGdp, formatPopulation } from '../utils/formatScale'
import { intelValueColor } from '../utils/intelValueColor'
import { Icon } from './icons'
import { ICONS } from './iconPaths'
import { PANEL_SECTION_LABEL } from './panelStyles'
import { INTEL_METRICS, type IntelMetricId } from './intelMetrics'

// `.cp-row` — label left, value right-aligned on the same baseline, rather
// than the stacked label-over-value the pre-restyle panel used. The
// reference's overview block reads as a two-column table.
function DataRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between gap-3.5 py-1">
      <span className="pt-px text-[10.5px] font-semibold tracking-[0.1em] text-[#6d82a8]">{label}</span>
      <b className="max-w-[160px] text-right text-xs font-semibold text-[#e6efff]">{value}</b>
    </div>
  )
}

// `.intel-row` — icon / label / 155px track / right-aligned value.
//
// Track is 155px (62px × 2.5 — reported as too short at the original size).
// The fill is a single solid color, not a gradient — `intelValueColor`
// interpolates red(0)→amber(50)→green(100) once per row, from that row's
// own value, and the same computed color is applied to both the fill and
// the value text beside it, so a country's number and its bar always read
// as the same color.
//
// `value` is optional: as of v6.3.1 it's real for MILITARY (see
// militaryIntelValue below, sourced from data/militaryScores.ts) but still
// never passed for ECONOMY/DIPLOMACY/TECHNOLOGY/CURRENT STATUS — nothing in
// data/types.ts carries a 0-100 score for those yet (Country.population and
// .gdpUsd are populated — see data/countryEconomics.ts — but neither is a
// rating), and the Conflict type's own doc comment is explicit that this
// project does not fabricate assessments without an editorial process
// behind them. Those four still render the empty state: flat track,
// em-dash value. `confidence === 'proxy'` tags the label — see
// Intelligence Docs/intelligence-engine-scoring-design.md §6's "UI should
// visually flag this is a proxy metric, not a direct measurement" — so a
// coverage-floor-but-not-full-coverage score never reads with the same
// confidence as a fully measured one. `notApplicable` renders "N/A" instead
// of the usual em-dash — for a confirmed no-standing-military country
// (`MilitaryScore.confirmed`), the composite is genuinely inapplicable, not
// merely unmeasured, so it shouldn't share the "—" a data gap gets.
const INTEL_BAR_WIDTH_PX = 155

// `onClick` (v6.3.2) makes the row a `<button>` instead of a `<div>` — see
// the design doc's §7 "status bars are clickable" citation drill-down.
// Passed only for a metric that actually has per-component source data to
// show (currently just MILITARY, and only while a MilitaryScore record
// exists for the selection); the other four metrics have no sources to
// drill into yet, so they stay plain, inert rows.
function IntelRow({
  label,
  icon,
  value,
  confidence,
  notApplicable,
  onClick,
  expanded,
}: {
  label: string
  icon: readonly string[]
  value?: number
  confidence?: MilitaryConfidence
  notApplicable?: boolean
  onClick?: () => void
  expanded?: boolean
}) {
  const isProxy = confidence === 'proxy'
  const color = value !== undefined ? intelValueColor(value) : '#51648a'
  const content = (
    <>
      <span className="grid w-[17px] place-items-center text-[#4d95ff]">
        <Icon paths={icon} />
      </span>
      <span className="flex-1 text-[9.5px] font-bold tracking-[0.1em] text-[#aebfdc]">
        {label}
        {isProxy && <span className="ml-1.5 text-[#e0a340]">PROXY</span>}
      </span>
      <span className="h-1 overflow-hidden rounded-sm bg-[#14213a]" style={{ width: `${INTEL_BAR_WIDTH_PX}px` }}>
        <span
          className="block h-full rounded-sm shadow-[0_0_6px_rgba(255,255,255,0.25)]"
          style={{ width: `${value ?? 0}%`, backgroundColor: color }}
        />
      </span>
      <span className="w-12 text-right text-[11.5px] font-bold" style={{ color }}>
        {value === undefined ? (notApplicable ? 'N/A' : '—') : value.toFixed(1)}
      </span>
    </>
  )

  if (!onClick) {
    return <div className="flex items-center gap-2 py-[5px]">{content}</div>
  }

  return (
    <button
      type="button"
      onClick={onClick}
      className={`flex w-full items-center gap-2 rounded py-[5px] text-left transition-colors hover:bg-[rgba(255,255,255,0.05)] ${
        expanded ? 'bg-[rgba(255,255,255,0.05)]' : ''
      }`}
    >
      {content}
    </button>
  )
}

// Friendly citation labels for data/militaryScores.ts's `sourceUrl`s — the
// raw URLs are what's actually stored (so a real link can be followed), but
// a domain isn't a citation a reader recognizes at a glance.
function militarySourceLabel(url: string | undefined): string {
  if (!url) return 'Source unavailable'
  if (url.includes('sipri.org/sites/default/files/SIPRI-Milex')) return 'SIPRI Military Expenditure Database'
  if (url.includes('sipri.org/sites/default/files/SIPRI-Top-100')) return 'SIPRI Top 100 Arms-Producing Companies'
  if (url.includes('armstransfers.sipri.org')) return 'SIPRI Arms Transfers Database'
  if (url.includes('worldbank.org')) return 'World Bank (WDI)'
  if (url.includes('fas.org')) return 'FAS Nuclear Notebook'
  if (url.includes('factbook.json')) return 'CIA World Factbook'
  try {
    return new URL(url).hostname
  } catch {
    return 'Source'
  }
}

interface MilitaryDrilldownRow {
  label: string
  raw: number | null
  format: (raw: number) => string
  sourceUrl?: string
  dateLabel?: string
}

// The design doc's §7: "drops down the list of metrics/sources that fed
// that bar's score — source name, value used, snapshot date." Lists all 5
// scored components (whether or not each one actually has a value for this
// country — a missing one is shown as "—", not omitted, so a coverage gap
// is visible here too) plus, last and visually subordinate, the sourced but
// NOT-scored arms-import annotation (see militaryScores.ts's header comment
// for why it's excluded from `value`) when this country has one.
function MilitaryDrilldown({ score }: { score: MilitaryScore }) {
  const rows: MilitaryDrilldownRow[] = [
    {
      label: 'Military Expenditure',
      raw: score.components.expenditureUsd.raw,
      format: (raw) => formatGdp(raw * 1e6) ?? '—',
      sourceUrl: score.components.expenditureUsd.sourceUrl,
      dateLabel: score.components.expenditureUsd.sourceDate ?? score.components.expenditureUsd.year?.toString(),
    },
    {
      label: '% of GDP',
      raw: score.components.pctGdp.raw,
      format: (raw) => `${raw.toFixed(2)}%`,
      sourceUrl: score.components.pctGdp.sourceUrl,
      dateLabel: score.components.pctGdp.sourceDate ?? score.components.pctGdp.year?.toString(),
    },
    {
      label: 'Active Personnel',
      raw: score.components.personnel.raw,
      format: (raw) => formatPopulation(raw) ?? '—',
      sourceUrl: score.components.personnel.sourceUrl,
      dateLabel: score.components.personnel.sourceDate ?? score.components.personnel.year?.toString(),
    },
    {
      label: 'Nuclear Warheads',
      raw: score.components.nuclearWarheads.raw,
      format: (raw) => raw.toLocaleString('en-US'),
      sourceUrl: score.components.nuclearWarheads.sourceUrl,
      dateLabel: score.components.nuclearWarheads.sourceDate ?? score.components.nuclearWarheads.year?.toString(),
    },
    {
      label: 'Defense-Industrial Base Revenue',
      raw: score.components.industrialBaseRevenueUsdM.raw,
      format: (raw) => formatGdp(raw * 1e6) ?? '—',
      sourceUrl: score.components.industrialBaseRevenueUsdM.sourceUrl,
      dateLabel: score.components.industrialBaseRevenueUsdM.sourceDate ?? score.components.industrialBaseRevenueUsdM.year?.toString(),
    },
  ]

  const tiv = score.annotations.armsImportTiv

  return (
    <div className="pt-1">
      {rows.map((row) => (
        <div
          key={row.label}
          className="flex items-start justify-between gap-3 border-b border-[rgba(22,35,60,0.6)] py-2 last:border-b-0"
        >
          <div className="min-w-0">
            <div className="text-[11px] font-semibold text-[#e6efff]">{row.label}</div>
            {row.sourceUrl ? (
              <a
                href={row.sourceUrl}
                target="_blank"
                rel="noreferrer"
                className="text-[10px] text-[#4d95ff] hover:underline"
              >
                {militarySourceLabel(row.sourceUrl)}
              </a>
            ) : (
              <div className="text-[10px] text-[#51648a]">No source</div>
            )}
          </div>
          <div className="shrink-0 text-right">
            <div className="text-[11px] font-semibold text-[#e6efff]">{row.raw == null ? '—' : row.format(row.raw)}</div>
            <div className="text-[10px] text-[#6d82a8]">{row.dateLabel ?? '—'}</div>
          </div>
        </div>
      ))}
      {tiv.raw != null && (
        <div className="flex items-start justify-between gap-3 py-2 opacity-70">
          <div className="min-w-0">
            <div className="text-[11px] font-semibold italic text-[#aebfdc]">Arms Import (TIV) — not scored</div>
            <a href={tiv.sourceUrl} target="_blank" rel="noreferrer" className="text-[10px] text-[#4d95ff] hover:underline">
              {militarySourceLabel(tiv.sourceUrl)}
            </a>
          </div>
          <div className="shrink-0 text-right">
            <div className="text-[11px] font-semibold text-[#aebfdc]">{tiv.raw.toLocaleString('en-US')}</div>
            <div className="text-[10px] text-[#6d82a8]">{tiv.year ?? '—'}</div>
          </div>
        </div>
      )}
    </div>
  )
}

// Country-only: MILITARY_SCORES is keyed by the numeric ISO topology id
// (see that file's header comment), the same id Country records are
// registered under — see scene/useCountryFeatures.ts. No GeoEntity has a
// military score; a GeoEntity selection falls through to the same
// undefined-value empty state every other metric already renders.
function militaryIntelValue(selected: SelectedEntity | null) {
  if (selected?.entity.kind !== 'country') return undefined
  return MILITARY_SCORES[selected.entity.data.id]
}

// `.feed-row` — left rail (marker + ringed glyph), then category / primary
// / secondary lines. The reference fills these with news headlines; this
// app has no news/event dataset at all, so they carry the relationship
// data that genuinely exists on a GeoEntity instead (see buildRelationFeed
// below). Same markup, real data.
function FeedRow({
  category,
  color,
  icon,
  primary,
  secondary,
  marker,
}: {
  category: string
  color: string
  icon: readonly string[]
  primary: string
  secondary?: string
  marker?: string
}) {
  return (
    <div className="flex gap-2.5 border-b border-[rgba(22,35,60,0.6)] py-2.5 last:border-b-0">
      <div className="flex w-[34px] flex-col items-center gap-1.5">
        <div className="text-[9.5px] font-semibold text-[#51648a]">{marker ?? '—'}</div>
        <div
          className="grid h-[30px] w-[30px] place-items-center rounded-full border opacity-90"
          style={{ borderColor: color, color }}
        >
          <Icon paths={icon} size={16} />
        </div>
      </div>
      <div className="min-w-0 flex-1">
        <div className="text-[9px] font-bold tracking-[0.16em]" style={{ color }}>
          {category}
        </div>
        <div className="mt-0.5 text-[12.5px] leading-snug font-semibold text-[#e6efff]">{primary}</div>
        {secondary && <div className="text-[11px] leading-snug text-[#6d82a8]">{secondary}</div>}
      </div>
    </div>
  )
}

interface RelationFeedItem {
  key: string
  category: string
  color: string
  icon: readonly string[]
  primary: string
  secondary?: string
  marker?: string
}

// Every field read here already exists on GeoEntity and already rendered in
// this panel before the restyle — `displayName`, `extent` (administeredBy
// only, per its doc comment), and `since` (ISO 8601). `since`'s year is
// what fills the reference's timestamp column; nothing is synthesized when
// it's absent. Colors come from scene/highlightColors.ts so a relationship
// listed here matches the color that same relationship renders in on the
// globe and in LegendPanel.
function buildRelationFeed(entity: GeoEntity): RelationFeedItem[] {
  const yearOf = (relation: GeoEntityRelation) => relation.since?.slice(0, 4)

  const items: RelationFeedItem[] = []

  if (entity.parentEntity) {
    items.push({
      key: `parent-${entity.parentEntity.displayName}`,
      category: 'SOVEREIGN STATE',
      color: HIGHLIGHT_COLORS.relatedCountry.hex,
      icon: ICONS.pin,
      primary: entity.parentEntity.displayName,
      marker: yearOf(entity.parentEntity),
    })
  }

  for (const relation of entity.administeredBy) {
    items.push({
      key: `administered-${relation.displayName}`,
      category: 'ADMINISTERING POWER',
      color: HIGHLIGHT_COLORS.territoryOverlay.hex,
      icon: ICONS.shield,
      primary: relation.displayName,
      secondary: relation.extent,
      marker: yearOf(relation),
    })
  }

  // Singular "CLAIMANT" for one claiming entity, plural "CLAIMANTS" when
  // listing more than one — every row for this entity's claimedBy list
  // shares the same category label since they're one set being listed.
  const claimantLabel = entity.claimedBy.length > 1 ? 'CLAIMANTS' : 'CLAIMANT'
  for (const relation of entity.claimedBy) {
    items.push({
      key: `claimed-by-${relation.displayName}`,
      category: claimantLabel,
      color: HIGHLIGHT_COLORS.claimsOverlay.hex,
      icon: ICONS.target,
      primary: relation.displayName,
      marker: yearOf(relation),
    })
  }

  for (const relation of entity.claims) {
    items.push({
      key: `claims-${relation.displayName}`,
      category: 'TERRITORIAL CLAIMS',
      color: HIGHLIGHT_COLORS.claimsOverlay.hex,
      icon: ICONS.bookmark,
      primary: relation.displayName,
      marker: yearOf(relation),
    })
  }

  return items
}

// GOVERNMENT/CAPITAL still come from the name-keyed, presentation-formatted
// COUNTRY_PROFILES (unchanged since v2.2.2). POPULATION/GDP/AREA come from
// the raw Country record itself (`country.population`/`.gdpUsd`/`.areaKm2`,
// populated by scene/useCountryFeatures.ts from data/countryEconomics.ts)
// and are formatted here, at render time, via utils/formatScale.ts — see
// that file's and countryEconomics.ts's header comments for why the split: a
// figure correcting across a unit threshold (millions -> billions) used to
// need a full data rebuild when the formatted string was baked in at build
// time. Each row is omitted, not fabricated, when its source has a gap
// (see scripts/buildGovCapitalPopGdp.mjs's known-gaps handling) — and shows
// its sourced year in parens whenever that year isn't
// PRIMARY_ECONOMIC_YEAR, so a stale World Bank figure never reads as
// current (e.g. South Sudan's GDP, last reported by the World Bank in
// 2015). governmentNote/factbookSnapshot are the same caveat lines as
// before, so a real, dated data source doesn't read as a live feed. Kept as
// its own component (rather than inlined) so the kind dispatch below reads
// as "one component per entity kind," the pattern a future kind follows too.
function CountryDetails({ country }: { country: Country }) {
  const profile = COUNTRY_PROFILES[country.name]
  const population = formatPopulation(country.population)
  const gdp = formatGdp(country.gdpUsd)
  const area = formatArea(country.areaKm2)

  if (!profile) {
    return (
      <div className="text-xs italic text-[#51648a]">
        No profile data available for this territory.
      </div>
    )
  }

  return (
    <>
      <DataRow label="GOVERNMENT" value={profile.government} />
      <DataRow label="CAPITAL" value={profile.capital} />
      {population && (
        <DataRow
          label="POPULATION"
          value={
            country.populationYear && country.populationYear !== PRIMARY_ECONOMIC_YEAR
              ? `${population} (${country.populationYear})`
              : population
          }
        />
      )}
      {gdp && (
        <DataRow
          label="GDP"
          value={country.gdpYear && country.gdpYear !== PRIMARY_ECONOMIC_YEAR ? `${gdp} (${country.gdpYear})` : gdp}
        />
      )}
      {area && (
        <DataRow
          label="AREA"
          value={country.areaYear && country.areaYear !== PRIMARY_ECONOMIC_YEAR ? `${area} (${country.areaYear})` : area}
        />
      )}
      {profile.governmentNote && (
        <div className="pt-1 text-[10.5px] italic leading-snug text-[#51648a]">{profile.governmentNote}</div>
      )}
      {profile.factbookSnapshot && (
        <div className="pt-1 text-[10.5px] italic leading-snug text-[#51648a]">
          Government/capital: factbook.json snapshot ({profile.factbookSnapshot.snapshotDate}), not a live feed.
        </div>
      )}
    </>
  )
}

const GEO_ENTITY_TYPE_LABEL: Record<GeoEntityType, string> = {
  'geopolitical-entity': 'Geopolitical Entity',
  territory: 'Territory',
  'strategic-region': 'Strategic Region',
  'maritime-feature': 'Maritime Feature',
  'geographic-region': 'Geographic Region',
  'administrative-division': 'Administrative Division',
  city: 'City',
}

// v3: one component covers all five non-sovereign classifications
// (GeoEntityType) — see data/types.ts's GeoEntity doc comment for why one
// shape instead of one interface (and one Details component) per
// classification: parentEntity/administeredBy/claimedBy/claims apply
// uniformly, and `type` is only ever read for display here (the ENTITY TYPE
// row) and by search's type tag.
//
// The four relationship fields moved out of this overview block and into
// the RELATIONSHIPS feed section below — same fields, same values, rendered
// as feed rows instead of semicolon-joined strings. What stays here is the
// entity's own attributes.
// POPULATION/GDP follow the exact same source-year-in-parens treatment as
// CountryDetails above — see that component's doc comment. Unlike Country's
// population/gdpUsd (auto-merged for every UN member by
// scene/useCountryFeatures.ts), a GeoEntity only has these fields when a
// human has hand-verified a source for it in
// src/data/registry/geoEntities.ts (see that file's wdiProvenance() calls
// and scripts/buildGeoEntityEconomics.mjs) — most entities still have
// neither, and both rows are simply omitted for those, the same as a
// Country with a genuine World Bank gap.
function GeoEntityDetails({ entity }: { entity: GeoEntity }) {
  const population = formatPopulation(entity.population)
  const gdp = formatGdp(entity.gdpUsd)

  return (
    <>
      <DataRow label="ENTITY TYPE" value={GEO_ENTITY_TYPE_LABEL[entity.type]} />
      {population && (
        <DataRow
          label="POPULATION"
          value={
            entity.populationYear && entity.populationYear !== PRIMARY_ECONOMIC_YEAR
              ? `${population} (${entity.populationYear})`
              : population
          }
        />
      )}
      {gdp && (
        <DataRow
          label="GDP"
          value={entity.gdpYear && entity.gdpYear !== PRIMARY_ECONOMIC_YEAR ? `${gdp} (${entity.gdpYear})` : gdp}
        />
      )}
      {entity.metadata?.strategicSignificance && (
        <DataRow label="STRATEGIC SIGNIFICANCE" value={entity.metadata.strategicSignificance} />
      )}
      {entity.metadata?.treatyFramework && <DataRow label="TREATY FRAMEWORK" value={entity.metadata.treatyFramework} />}
    </>
  )
}

export function IntelligencePanel() {
  const { selected, inspectorOpen } = useSelection()
  // v3.2.0: selection and "is the panel actually showing" are now two
  // separate facts — see selectionStore.ts's SelectEntityOptions doc
  // comment. Every pre-v3.2 way of selecting something (map click, search)
  // still opens this unconditionally, so `isOpen` reduces to exactly
  // `selected != null` for all of them; only keyboard arrow-key navigation
  // can select without opening it.
  const isOpen = selected != null && inspectorOpen

  const relationFeed =
    selected?.entity.kind === 'geo-entity' ? buildRelationFeed(selected.entity.data) : []
  // Alliance membership is a Country-only concept (no GeoEntity is itself a
  // NATO/OECD/BRICS/... member) — see allianceMemberships.ts. Derived by
  // filtering ALLIANCES' memberCountryCodes at render time against the
  // selected country's ISO3 code, not a duplicated per-country list.
  const countryIso3 = selected?.entity.kind === 'country' ? COUNTRY_NAME_TO_ISO3[selected.entity.data.name] : undefined
  const memberAlliances = countryIso3
    ? ALLIANCES.filter((alliance) => alliance.memberCountryCodes.includes(countryIso3))
    : []

  // v6.3.1: the first real Intelligence Engine data wired into this panel —
  // see data/militaryScores.ts's header comment and
  // Intelligence Docs/intelligence-engine-scoring-design.md. A confirmed
  // no-standing-military country (`.confirmed`) renders N/A instead of a
  // bar — see IntelRow's `notApplicable` doc comment — so `militaryBarValue`
  // deliberately excludes it even though `.value` is a real, sourced 0
  // there. An 'unavailable'-confidence country's `.value` is already null,
  // same empty-bar treatment IntelRow gives every other still-unsourced
  // metric.
  const militaryScore = militaryIntelValue(selected)
  const militaryIsNoMilitary = militaryScore?.confirmed === true
  const militaryBarValue = militaryScore && !militaryIsNoMilitary ? (militaryScore.value ?? undefined) : undefined
  const hasMilitaryBar = militaryBarValue != null

  // v6.3.2: citation drill-down (design doc §7) — clicking the MILITARY bar
  // collapses the other four rows and drops down its component sources.
  // Only MILITARY is ever clickable: it's the only metric with a
  // MilitaryScore record to drill into (every one of the 5 components is
  // real per-country source data, even for a country whose composite itself
  // is N/A or unavailable — see MilitaryDrilldown). Resets whenever the
  // selection changes so a drill-down never carries over onto a newly
  // selected entity.
  const [expandedMetric, setExpandedMetric] = useState<IntelMetricId | null>(null)
  useEffect(() => {
    setExpandedMetric(null)
  }, [selected?.id])

  return (
    <div
      className={`fixed top-14 bottom-0 right-0 z-30 w-full sm:w-[380px] transition-transform duration-500 ease-out ${
        isOpen ? 'translate-x-0' : 'translate-x-full'
      }`}
    >
      <div className="pointer-events-auto h-full overflow-y-auto border-l border-[#172440] bg-[rgba(7,11,20,0.92)] backdrop-blur-[12px]">
        {selected && (
          <div>
            {/* `.cp-hero` — gradient masthead carrying the eyebrow, the
                oversized entity name, and the close affordance. */}
            <div className="relative border-b border-[#16233c] bg-[linear-gradient(160deg,rgba(23,40,75,0.75),rgba(9,14,26,0.4))] px-4 pt-3.5 pb-4">
              <div className="text-[10px] font-bold tracking-[0.2em] text-[#6d9bde]">SELECTED</div>
              <button
                type="button"
                onClick={clearSelection}
                aria-label="Close panel"
                className="absolute top-2.5 right-2.5 text-sm leading-none text-[#8aa0c6] transition-colors hover:text-white"
              >
                ✕
              </button>
              <h2 className="mt-1.5 font-display text-[34px] leading-none font-bold tracking-[0.09em] text-white [text-shadow:0_0_24px_rgba(63,139,255,0.45)]">
                {selected.name.toUpperCase()}
              </h2>
            </div>

            <div className="border-b border-[#16233c] px-4 py-3">
              <div className={`${PANEL_SECTION_LABEL} mb-2`}>OVERVIEW</div>
              {selected.entity.kind === 'country' ? (
                <CountryDetails country={selected.entity.data} />
              ) : (
                <GeoEntityDetails entity={selected.entity.data} />
              )}
            </div>

            {memberAlliances.length > 0 && (
              <div className="border-b border-[#16233c] px-4 py-3">
                <div className={`${PANEL_SECTION_LABEL} mb-2`}>ALLIANCES</div>
                <div className="flex flex-wrap gap-1.5">
                  {memberAlliances.map((alliance) => (
                    <AllianceBadge key={alliance.id} alliance={alliance} />
                  ))}
                </div>
              </div>
            )}

            <div className="border-b border-[#16233c] px-4 py-3">
              <div className={`${PANEL_SECTION_LABEL} mb-2`}>INTELLIGENCE SUMMARY</div>
              {INTEL_METRICS.filter((metric) => expandedMetric === null || metric.id === expandedMetric).map((metric) =>
                metric.id === 'military' ? (
                  <IntelRow
                    key={metric.id}
                    label={metric.label}
                    icon={metric.icon}
                    value={militaryBarValue}
                    confidence={militaryScore?.confidence}
                    notApplicable={militaryIsNoMilitary}
                    expanded={expandedMetric === 'military'}
                    onClick={
                      militaryScore
                        ? () => setExpandedMetric((current) => (current === 'military' ? null : 'military'))
                        : undefined
                    }
                  />
                ) : (
                  <IntelRow key={metric.id} label={metric.label} icon={metric.icon} />
                ),
              )}
              {expandedMetric === 'military' && militaryScore ? (
                <MilitaryDrilldown score={militaryScore} />
              ) : (
                <>
                  {hasMilitaryBar ? (
                    <div className="mt-2 text-[10px] leading-relaxed italic text-[#51648a]">
                      Military: sourced (SIPRI/World Bank/FAS
                      {militaryScore!.confidence === 'proxy'
                        ? `, ${militaryScore!.coveragePresent}/${militaryScore!.coverageTotal} components`
                        : ''}
                      ). Economy/Diplomacy/Technology/Current Status — no assessment data currently sourced.
                    </div>
                  ) : militaryIsNoMilitary ? null : (
                    <div className="mt-2 text-[10px] leading-relaxed italic text-[#51648a]">
                      Awaiting data feed — no assessment data is currently sourced.
                    </div>
                  )}
                  {militaryIsNoMilitary && militaryScore?.confirmedNote && (
                    <div className="mt-1 text-[10px] leading-relaxed italic text-[#51648a]">
                      {militaryScore.confirmedNote}
                    </div>
                  )}
                </>
              )}
            </div>

            {relationFeed.length > 0 && (
              <div className="border-b border-[#16233c] px-4 py-3">
                <div className={`${PANEL_SECTION_LABEL} mb-1`}>RELATIONSHIPS</div>
                {relationFeed.map((item) => (
                  <FeedRow
                    key={item.key}
                    category={item.category}
                    color={item.color}
                    icon={item.icon}
                    primary={item.primary}
                    secondary={item.secondary}
                    marker={item.marker}
                  />
                ))}
              </div>
            )}

            {/* `.more-btn` — a full-bleed footer action, not a boxed button. */}
            <button
              type="button"
              onClick={flyToSelectedCountry}
              className="flex w-full items-center gap-2.5 px-4 py-3 text-[10.5px] font-bold tracking-[0.16em] text-[#9fb3d6] transition-colors hover:text-white"
            >
              FOCUS CAMERA
              <span className="ml-auto text-[#4d95ff]">››</span>
            </button>
          </div>
        )}
      </div>
    </div>
  )
}
