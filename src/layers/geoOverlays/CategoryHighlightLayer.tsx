// v3.3.0 quality-of-life addition: "highlight every entity of one
// classification at once" — e.g. every sovereign state, or every strategic
// region — independent of (and simultaneous with) whatever's currently
// selected. Registered as one ordinary Layer Engine layer per
// classification (six — country plus five of the six GeoEntityType values;
// administrative-division/states-provinces deliberately has no "highlight
// all at once" layer, see below), rather than one layer with an internal
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
import { BufferAttribute, BufferGeometry, Float32BufferAttribute, FrontSide } from 'three'
import { registerLayer } from '../layerRegistry'
import { useCountryFeatures } from '../../scene/useCountryFeatures'
import { useGeoEntityFeatures } from '../../scene/useGeoEntityFeatures'
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

// Merges every entry's border positions into one Float32Array/BufferGeometry
// rather than rendering one <lineSegments> per entry. Toggling
// 'highlight-country' on used to mount 193 separate lineSegments + 193
// separate meshes (386 draw calls) in one go — the same per-entity draw-call
// scaling problem CLAUDE.md's "One merged geometry per country" note already
// solved once for Countries.tsx itself, recurring here because this overlay
// pre-dates that lesson being applied above the per-country level. This
// layer never raycasts per entry (it's a decorative pass, not clickable), so
// there's no faceIndex/entry lookup to preserve the way
// scene/mergedProvinceFill.ts needs one for ProvinceFillLayer.tsx.
function mergeBorderGeometries(entries: HighlightEntry[]): BufferGeometry | null {
  let totalVertices = 0
  for (const entry of entries) totalVertices += entry.borderGeometry.attributes.position.count
  if (totalVertices === 0) return null

  const positions = new Float32Array(totalVertices * 3)
  let vertexOffset = 0
  for (const entry of entries) {
    const attr = entry.borderGeometry.attributes.position
    positions.set(attr.array as Float32Array, vertexOffset * 3)
    vertexOffset += attr.count
  }

  const geometry = new BufferGeometry()
  geometry.setAttribute('position', new Float32BufferAttribute(positions, 3))
  return geometry
}

function mergeFillGeometries(entries: HighlightEntry[]): BufferGeometry | null {
  let totalVertices = 0
  let totalIndices = 0
  for (const entry of entries) {
    if (!entry.fillGeometry?.index) continue
    totalVertices += entry.fillGeometry.attributes.position.count
    totalIndices += entry.fillGeometry.index.count
  }
  if (totalIndices === 0) return null

  const positions = new Float32Array(totalVertices * 3)
  const indices = new Uint32Array(totalIndices)
  let vertexOffset = 0
  let indexOffset = 0
  for (const entry of entries) {
    const fill = entry.fillGeometry
    if (!fill?.index) continue

    const positionAttr = fill.attributes.position
    positions.set(positionAttr.array as Float32Array, vertexOffset * 3)

    const sourceIndices = fill.index.array
    for (let i = 0; i < sourceIndices.length; i++) {
      indices[indexOffset + i] = sourceIndices[i] + vertexOffset
    }

    vertexOffset += positionAttr.count
    indexOffset += sourceIndices.length
  }

  const geometry = new BufferGeometry()
  geometry.setAttribute('position', new Float32BufferAttribute(positions, 3))
  geometry.setIndex(new BufferAttribute(indices, 1))
  return geometry
}

// `color` defaults to the shared category-highlight violet every existing
// caller already expects — layers/geoOverlays/SanctionHighlightLayer.tsx is
// the first caller to override it (one of three OFAC-tier colors instead),
// since "every country in the highlighted sanction tier" is the same
// "extra highlighted pass on top of Countries.tsx" idea as a category
// highlight, just needing its own color per tier rather than one shared
// color the way every category/alliance highlight already does.
export function CategoryHighlightGeometry({ entries, color = HIGHLIGHT_COLOR }: { entries: HighlightEntry[]; color?: string }) {
  const borderGeometry = useMemo(() => mergeBorderGeometries(entries), [entries])
  const fillGeometry = useMemo(() => mergeFillGeometries(entries), [entries])

  if (!borderGeometry) return null

  return (
    <group>
      <lineSegments geometry={borderGeometry}>
        <lineBasicMaterial color={color} transparent opacity={BORDER_OPACITY} />
      </lineSegments>
      {fillGeometry && (
        <mesh geometry={fillGeometry} scale={FILL_SCALE}>
          <meshBasicMaterial color={color} transparent opacity={FILL_OPACITY} side={FrontSide} depthWrite={false} />
        </mesh>
      )}
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

// Five of the six GeoEntityType categories share this one component,
// parameterized by which classification to keep — a factory rather than
// five near-duplicate components, since the only thing that differs between
// them is the filter predicate. (The sixth, administrative-division/states-
// provinces, deliberately has no "highlight all at once" layer — see below.)
// buildGeoEntityEntries() returns `entityId`, not `id` — mapped here rather
// than widening HighlightEntry, since every other consumer of that shape
// (the country side above) already has a plain `id`.
function makeGeoEntityCategoryHighlight(category: GeoEntityType) {
  return function GeoEntityCategoryHighlight() {
    const features = useGeoEntityFeatures()
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
  component: makeGeoEntityCategoryHighlight('geopolitical-entity'),
})

registerLayer({
  id: 'highlight-territory',
  label: 'TERRITORIES',
  description: 'Highlights every dependency/territory at once (Puerto Rico, Greenland, Hong Kong, ...).',
  category: 'highlight',
  defaultEnabled: false,
  component: makeGeoEntityCategoryHighlight('territory'),
})

registerLayer({
  id: 'highlight-strategic-region',
  label: 'STRATEGIC / MILITARY REGIONS',
  description: 'Highlights every strategic region at once (Guantanamo Bay, Akrotiri, Dhekelia, Baikonur, ...).',
  category: 'highlight',
  defaultEnabled: false,
  component: makeGeoEntityCategoryHighlight('strategic-region'),
})

registerLayer({
  id: 'highlight-maritime-feature',
  label: 'MARITIME FEATURES',
  description: 'Highlights every disputed maritime feature at once (Spratly Islands, Scarborough Reef, ...).',
  category: 'highlight',
  defaultEnabled: false,
  component: makeGeoEntityCategoryHighlight('maritime-feature'),
})

registerLayer({
  id: 'highlight-geographic-region',
  label: 'GEOGRAPHIC REGIONS',
  description: 'Highlights every treaty-governed geographic region at once (currently just Antarctica).',
  category: 'highlight',
  defaultEnabled: false,
  component: makeGeoEntityCategoryHighlight('geographic-region'),
})

