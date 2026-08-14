import { clearSelection, flyToSelectedCountry, useSelection } from './selectionStore'
import { COUNTRY_PROFILES } from '../data/countryProfiles'
import { PRIMARY_ECONOMIC_YEAR } from '../data/countryEconomics'
import type { Country, GeoEntity, GeoEntityRelation, GeoEntityType } from '../data'
import { HIGHLIGHT_COLORS } from '../scene/highlightColors'
import { formatGdp, formatPopulation } from '../utils/formatScale'
import { Icon } from './icons'
import { ICONS } from './iconPaths'
import { PANEL_SECTION_LABEL } from './panelStyles'

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

// `.intel-row` — icon / label / 62px track / right-aligned value.
//
// `value` is optional AND CURRENTLY NEVER PASSED: nothing in data/types.ts
// carries a 0-100 score for any of these metrics (Country.population and
// .gdpUsd are populated now — see data/countryEconomics.ts — but neither is
// a rating; src/data/countries/countries.json remains the unrelated, still-
// empty scaffold data/types.ts's own comment describes), and the Conflict
// type's own doc comment is
// explicit that this project does not fabricate assessments like these
// without an editorial process behind them. So the row renders its empty
// state: flat track, em-dash value. The prop exists so an eventual
// Intelligence Engine only has to pass a number here — the bar chrome,
// gradient, and glow are already correct and match the reference exactly.
function IntelRow({ label, icon, value }: { label: string; icon: readonly string[]; value?: number }) {
  return (
    <div className="flex items-center gap-2 py-[5px]">
      <span className="grid w-[17px] place-items-center text-[#4d95ff]">
        <Icon paths={icon} />
      </span>
      <span className="flex-1 text-[9.5px] font-bold tracking-[0.1em] text-[#aebfdc]">{label}</span>
      <span className="h-1 w-[62px] overflow-hidden rounded-sm bg-[#14213a]">
        <span
          className="block h-full rounded-sm bg-[linear-gradient(90deg,#2d6fd8,#6db0ff)] shadow-[0_0_6px_rgba(63,139,255,0.8)]"
          style={{ width: `${value ?? 0}%` }}
        />
      </span>
      <span
        className={`w-8 text-right text-[11.5px] font-bold ${
          value === undefined ? 'text-[#51648a]' : 'text-[#e6efff]'
        }`}
      >
        {value === undefined ? '—' : `${value}%`}
      </span>
    </div>
  )
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
      category: 'PARENT ENTITY',
      color: HIGHLIGHT_COLORS.relatedCountry.hex,
      icon: ICONS.pin,
      primary: entity.parentEntity.displayName,
      marker: yearOf(entity.parentEntity),
    })
  }

  for (const relation of entity.administeredBy) {
    items.push({
      key: `administered-${relation.displayName}`,
      category: 'ADMINISTERED BY',
      color: HIGHLIGHT_COLORS.territoryOverlay.hex,
      icon: ICONS.shield,
      primary: relation.displayName,
      secondary: relation.extent,
      marker: yearOf(relation),
    })
  }

  for (const relation of entity.claimedBy) {
    items.push({
      key: `claimed-by-${relation.displayName}`,
      category: 'CLAIMED BY',
      color: HIGHLIGHT_COLORS.claimsOverlay.hex,
      icon: ICONS.target,
      primary: relation.displayName,
      marker: yearOf(relation),
    })
  }

  for (const relation of entity.claims) {
    items.push({
      key: `claims-${relation.displayName}`,
      category: 'CLAIMS',
      color: HIGHLIGHT_COLORS.claimsOverlay.hex,
      icon: ICONS.bookmark,
      primary: relation.displayName,
      marker: yearOf(relation),
    })
  }

  return items
}

// GOVERNMENT/CAPITAL still come from the name-keyed, presentation-formatted
// COUNTRY_PROFILES (unchanged since v2.2.2). POPULATION/GDP come from the
// raw Country record itself (`country.population`/`.gdpUsd`, populated by
// scene/useCountryFeatures.ts from data/countryEconomics.ts) and are
// formatted here, at render time, via utils/formatScale.ts — see that
// file's and countryEconomics.ts's header comments for why the split: a
// figure correcting across a unit threshold (millions -> billions) used to
// need a full data rebuild when the formatted string was baked in at build
// time. Either row is omitted, not fabricated, when its source has a gap
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

const INTEL_METRICS: { label: string; icon: readonly string[] }[] = [
  { label: 'MILITARY', icon: ICONS.military },
  { label: 'ECONOMY', icon: ICONS.economy },
  { label: 'DIPLOMACY', icon: ICONS.diplomacy },
  { label: 'TECHNOLOGY', icon: ICONS.technology },
  { label: 'CURRENT STATUS', icon: ICONS.shield },
]

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

            <div className="border-b border-[#16233c] px-4 py-3">
              <div className={`${PANEL_SECTION_LABEL} mb-2`}>INTELLIGENCE SUMMARY</div>
              {INTEL_METRICS.map((metric) => (
                <IntelRow key={metric.label} label={metric.label} icon={metric.icon} />
              ))}
              <div className="mt-2 text-[10px] leading-relaxed italic text-[#51648a]">
                Awaiting data feed — no assessment data is currently sourced.
              </div>
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
