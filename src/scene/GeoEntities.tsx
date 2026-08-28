import { useMemo } from 'react'
import type { Vector3 } from 'three'
import { useGeoEntityFeatures } from './useGeoEntityFeatures'
import { buildGeoEntityEntries, type GeoEntityEntry } from './geoEntityEntries'
import { selectEntity, useSelection } from '../hud/selectionStore'
import { resolveEntity } from '../entities/EntityResolver'
import { getEntityForGeometry } from '../entities/GeometryMap'
import { setHoveredGeoEntityId } from './hoveredGeoEntity'
import { EntityRenderLayer } from './EntityRenderLayer'

// Renders every non-country GeoEntity (all five v3 classifications — see
// data/types.ts's GeoEntityType) with a real rendered shape. Shares its
// rendering — one merged border/fill geometry per entry, hover/select/dim
// color logic, click-vs-drag threshold, HoverLabel — with
// scene/Countries.tsx via scene/EntityRenderLayer.tsx (v4.4, "Phase 4"
// dedup, replacing the two components' previously near-identical copies —
// see CLAUDE.md/LOGBOOK.md). What's kept separate here, because it's a real
// difference and not just duplication: entry-building (buildGeoEntityEntries
// below, vs Countries.tsx's own — a GeoEntity's geometryId and entityId
// aren't always the same string, a country's always are) and click
// resolution (this component no-ops on a resolution miss; Countries.tsx
// additionally falls back to selectCountry()).
//
// Deliberately does ONLY primary selection here — no parent/claims overlay
// logic. Those live in src/layers/geoOverlays/ as their own Layer Engine
// layers, reading this same geometry independently, per CLAUDE.md's "don't
// hardcode entity behavior inside Globe rendering components" rule.
export function GeoEntities() {
  const features = useGeoEntityFeatures()
  const { selected } = useSelection()

  const entities = useMemo<GeoEntityEntry[]>(() => buildGeoEntityEntries(features), [features])

  function handleSelect(entity: GeoEntityEntry, direction: Vector3) {
    // GeometryMap always has this shape's mapping by the time it's
    // clickable (useGeoEntityFeatures.ts registers it as soon as the
    // geometry loads), so getEntityForGeometry should never miss here — the
    // resolveEntity() fallback exists for symmetry with Countries.tsx's
    // handler, not because a real gap is expected.
    const resolved = getEntityForGeometry(entity.geometryId) ?? resolveEntity(entity.entityId)
    if (!resolved) return

    // Normal-selection behavior per the v3 spec: only the clicked entity
    // gets the primary highlight — no automatic selection of claimants,
    // parents, or related entities. Nothing extra to do here; that's
    // already what selectEntity() does.
    selectEntity(resolved, direction)
  }

  // EntityRenderLayer reports hover by geometryId (the id its onPointerOver/
  // onPointerOut handlers actually see); GeoEntityLabels.tsx's exclusion
  // check needs the entityId instead (the two differ for 44 of these 55
  // entities — see geoEntityEntries.ts's GeoEntityEntry doc comment), so
  // this looks the entry up before publishing. Needed since v5.2.7:
  // GeoEntityLabels.tsx's passive label now sits at the exact same centroid
  // EntityRenderLayer.tsx's HoverLabel does (no more leader-line callout
  // keeping them visually apart), so without this a hovered entity would
  // show both labels stacked on top of each other instead of the hover
  // label replacing the passive one.
  function handleHoverChange(geometryId: string | null) {
    const entityId = geometryId ? (entities.find((e) => e.geometryId === geometryId)?.entityId ?? null) : null
    setHoveredGeoEntityId(entityId)
  }

  return (
    <EntityRenderLayer
      entries={entities}
      selectedEntityId={selected?.id}
      onSelect={handleSelect}
      onHoverChange={handleHoverChange}
    />
  )
}
