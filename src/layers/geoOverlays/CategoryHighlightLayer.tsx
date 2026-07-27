// v3.3.0 quality-of-life addition: "highlight every entity of one
// classification at once" — e.g. every sovereign state, or every strategic
// region — independent of (and simultaneous with) whatever's currently
// selected. Registered as one ordinary Layer Engine layer per
// classification (seven as of the states/provinces addition — country plus
// all six GeoEntityType values), rather than one layer with an internal
// category picker —
// LayerPanel.tsx already renders whatever's registered generically (see
// CLAUDE.md's Layer Engine section), so this needed zero HUD changes, and
// enabling more than one at once (e.g. "countries" + "strategic regions"
// together) just works, which a single mutually-exclusive picker wouldn't
// have supported for free.
//
// Deliberately additive geometry, not a dim-everything-else treatment: like
// ParentOverlayLayer/ClaimsOverlayLayer, this draws an extra highlighted
// pass on top of whatever Countries.tsx/GeoEntities.tsx already rendered,
// rather than reaching into either of those components to compute a
// per-entity "is this in the highlighted category" flag — the whole reason
// those two Details/GeoEntity dispatch-only rendering components exist as
// they do (see CLAUDE.md's "don't hardcode entity behavior inside Globe
// rendering components" rule).
import { useMemo } from 'react'
import { FrontSide } from 'three'
import type { BufferGeometry } from 'three'
import type { Feature } from 'geojson'
import { registerLayer } from '../layerRegistry'
import { useCountryFeatures } from '../../scene/useCountryFeatures'
import { useGeoEntityFeatures } from '../../scene/useGeoEntityFeatures'
import { useStatesProvincesFeatures } from '../../scene/useStatesProvincesFeatures'
import { buildCountryEntries } from '../../scene/countryEntries'
import { buildGeoEntityEntries } from '../../scene/geoEntityEntries'
import { GLOBE_RADIUS } from '../../scene/constants'
import { HIGHLIGHT_COLORS } from '../../scene/highlightColors'
import { getEntity } from '../../data'
import type { GeoEntityType } from '../../data'

const HIGHLIGHT_COLOR = HIGHLIGHT_COLORS.categoryHighlight.hex
const BORDER_RADIUS = GLOBE_RADIUS * 1.005
const FILL_RADIUS = GLOBE_RADIUS * 1.0
const FILL_SCALE = 1.003
const FILL_OPACITY = 0.16
const BORDER_OPACITY = 0.85

interface HighlightEntry {
  id: string
  borderGeometry: BufferGeometry
  fillGeometry: BufferGeometry | null
}

export function CategoryHighlightGeometry({ entries }: { entries: HighlightEntry[] }) {
  if (entries.length === 0) return null

  return (
    <group>
      {entries.map((entry) => (
        <group key={`category-highlight-${entry.id}`}>
          <lineSegments geometry={entry.borderGeometry}>
            <lineBasicMaterial color={HIGHLIGHT_COLOR} transparent opacity={BORDER_OPACITY} />
          </lineSegments>
          {entry.fillGeometry && (
            <mesh geometry={entry.fillGeometry} scale={FILL_SCALE}>
              <meshBasicMaterial color={HIGHLIGHT_COLOR} transparent opacity={FILL_OPACITY} side={FrontSide} depthWrite={false} />
            </mesh>
          )}
        </group>
      ))}
    </group>
  )
}

// The 'country' category — every UN member state — reuses
// scene/countryEntries.ts, the same "raw feature -> border/fill geometry"
// builder ClaimsOverlayLayer.tsx's related-country rendering already uses.
export function CountryCategoryHighlight() {
  const features = useCountryFeatures()
  const entries = useMemo(() => buildCountryEntries(features, BORDER_RADIUS, FILL_RADIUS), [features])
  return <CategoryHighlightGeometry entries={entries} />
}

// The six GeoEntityType categories all share this one component,
// parameterized by which classification to keep and which geometry source
// to read it from — a factory rather than six near-duplicate components,
// since the only things that differ are the filter predicate and (since
// administrative-division lives in its own geometry file, not entities.json
// — see StatesProvincesLayer.tsx) the features hook. buildGeoEntityEntries()
// returns `entityId`, not `id` — mapped here rather than widening
// HighlightEntry, since every other consumer of that shape (the country
// side above) already has a plain `id`.
function makeGeoEntityCategoryHighlight(category: GeoEntityType, useFeatures: () => Feature[]) {
  return function GeoEntityCategoryHighlight() {
    const features = useFeatures()
    const entries = useMemo<HighlightEntry[]>(
      () =>
        buildGeoEntityEntries(features)
          .filter((entry) => (getEntity(entry.entityId)?.type ?? 'territory') === category)
          .map((entry) => ({
            id: entry.entityId,
            borderGeometry: entry.borderGeometry,
            fillGeometry: entry.fillGeometry,
          })),
      [features]
    )
    return <CategoryHighlightGeometry entries={entries} />
  }
}

registerLayer({
  id: 'highlight-country',
  label: 'SOVEREIGN STATES',
  description: 'Highlights all 193 UN member states at once.',
  category: 'highlight',
  defaultEnabled: false,
  component: CountryCategoryHighlight,
})

registerLayer({
  id: 'highlight-geopolitical-entity',
  label: 'GEOPOLITICAL ENTITIES',
  description: 'Highlights every geopolitical entity at once (Taiwan, Palestine, Kosovo, Western Sahara).',
  category: 'highlight',
  defaultEnabled: false,
  component: makeGeoEntityCategoryHighlight('geopolitical-entity', useGeoEntityFeatures),
})

registerLayer({
  id: 'highlight-territory',
  label: 'TERRITORIES',
  description: 'Highlights every dependency/territory at once (Puerto Rico, Greenland, Hong Kong, ...).',
  category: 'highlight',
  defaultEnabled: false,
  component: makeGeoEntityCategoryHighlight('territory', useGeoEntityFeatures),
})

registerLayer({
  id: 'highlight-strategic-region',
  label: 'STRATEGIC / MILITARY REGIONS',
  description: 'Highlights every strategic region at once (Guantanamo Bay, Akrotiri, Dhekelia, Baikonur, ...).',
  category: 'highlight',
  defaultEnabled: false,
  component: makeGeoEntityCategoryHighlight('strategic-region', useGeoEntityFeatures),
})

registerLayer({
  id: 'highlight-maritime-feature',
  label: 'MARITIME FEATURES',
  description: 'Highlights every disputed maritime feature at once (Spratly Islands, Scarborough Reef, ...).',
  category: 'highlight',
  defaultEnabled: false,
  component: makeGeoEntityCategoryHighlight('maritime-feature', useGeoEntityFeatures),
})

registerLayer({
  id: 'highlight-geographic-region',
  label: 'GEOGRAPHIC REGIONS',
  description: 'Highlights every treaty-governed geographic region at once (currently just Antarctica).',
  category: 'highlight',
  defaultEnabled: false,
  component: makeGeoEntityCategoryHighlight('geographic-region', useGeoEntityFeatures),
})

registerLayer({
  id: 'highlight-administrative-division',
  label: 'ADMINISTRATIVE DIVISIONS',
  description: 'Highlights every state/province at once (currently 9 countries — see StatesProvincesLayer.tsx).',
  category: 'highlight',
  defaultEnabled: false,
  component: makeGeoEntityCategoryHighlight('administrative-division', useStatesProvincesFeatures),
})
