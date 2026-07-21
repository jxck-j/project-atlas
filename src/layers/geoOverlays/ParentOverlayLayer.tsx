import { useMemo } from 'react'
import { FrontSide } from 'three'
import { registerLayer } from '../layerRegistry'
import { useGeoEntityFeatures } from '../../scene/useGeoEntityFeatures'
import { buildGeoEntityEntries } from '../../scene/geoEntityEntries'
import { HIGHLIGHT_COLORS } from '../../scene/highlightColors'
import { useSelection } from '../../hud/selectionStore'
import { getEntities } from '../../data'

// v3 "Parent relationship overlay": when a sovereign state is selected,
// show its dependent GeoEntities (Territory-classified, but any classifi-
// cation with a matching parentEntity qualifies) with a secondary highlight
// distinct from the primary selection color. Deliberately a separate Layer
// Engine layer, not logic bolted onto scene/GeoEntities.tsx or
// scene/Countries.tsx — per CLAUDE.md's "don't hardcode entity behavior
// inside Globe rendering components" rule, and because this is exactly the
// kind of pluggable, selection-reactive overlay the Layer Engine exists for
// (see CLAUDE.md's Layer Engine section). Reuses buildGeoEntityEntries (the
// same pure function scene/GeoEntities.tsx uses) so there's one place that
// knows how to turn a raw feature into renderable geometry — this layer
// only adds the "which entries, which color" logic on top.
// Sourced from scene/highlightColors.ts (v3.1) — green, per spec
// ("secondary highlight style like a green highlight") — the same value
// hud/LegendPanel.tsx explains, so the two can never drift apart.
const OVERLAY_COLOR = HIGHLIGHT_COLORS.territoryOverlay.hex
const OVERLAY_RADIUS_FACTOR = 1.0015

export function ParentOverlayComponent() {
  const { selected } = useSelection()
  const features = useGeoEntityFeatures()
  const entries = useMemo(() => buildGeoEntityEntries(features), [features])

  const childEntityIds = useMemo(() => {
    if (!selected || selected.entity.kind !== 'country') return new Set<string>()
    const countryId = selected.id
    return new Set(
      getEntities()
        .filter((e) => e.parentEntity?.ref?.type === 'country' && e.parentEntity.ref.id === countryId)
        .map((e) => e.id)
    )
  }, [selected])

  if (childEntityIds.size === 0) return null

  const children = entries.filter((entry) => childEntityIds.has(entry.entityId))
  if (children.length === 0) return null

  return (
    <group>
      {children.map((entry) => (
        <group key={`parent-overlay-${entry.geometryId}`}>
          <lineSegments geometry={entry.borderGeometry}>
            <lineBasicMaterial color={OVERLAY_COLOR} transparent opacity={0.95} />
          </lineSegments>
          {entry.fillGeometry && (
            <mesh geometry={entry.fillGeometry} scale={OVERLAY_RADIUS_FACTOR}>
              <meshBasicMaterial
                color={OVERLAY_COLOR}
                transparent
                opacity={0.28}
                side={FrontSide}
                depthWrite={false}
              />
            </mesh>
          )}
        </group>
      ))}
    </group>
  )
}

registerLayer({
  id: 'parent-territory-overlay',
  label: 'TERRITORY OVERLAY',
  description:
    'When a sovereign state is selected, highlights its dependent territories/possessions in a secondary color — a visual "these belong to the selection" cue without treating them as equal sovereign selections.',
  category: 'geopolitical',
  defaultEnabled: true,
  component: ParentOverlayComponent,
})
