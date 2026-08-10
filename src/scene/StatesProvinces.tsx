import { useMemo } from 'react'
import type { Vector3 } from 'three'
import { useStatesProvincesFeatures } from './useStatesProvincesFeatures'
import { buildGeoEntityEntries, type GeoEntityEntry } from './geoEntityEntries'
import { selectEntity, useSelection } from '../hud/selectionStore'
import { resolveEntity } from '../entities/EntityResolver'
import { getEntityForGeometry } from '../entities/GeometryMap'
import { EntityRenderLayer } from './EntityRenderLayer'
import { StateProvinceLabels } from './StateProvinceLabels'
import { setHoveredStateProvinceId } from './hoveredStateProvince'

// Renders the 'administrative-division' GeoEntityType (states/provinces) as
// a Layer Engine layer — off by default (see StatesProvincesLayer.tsx),
// since 294 more polygons on top of every country by default would clutter
// the view. Shares its rendering with scene/Countries.tsx and
// scene/GeoEntities.tsx via scene/EntityRenderLayer.tsx (v4.4, "Phase 4"
// dedup, extended to this component once GeoEntities.tsx's copy of the same
// pattern was folded in — see CLAUDE.md/LOGBOOK.md) — same reasoning
// GeoEntities.tsx gives for its own click resolution: no selectCountry()-
// style fallback needed here, since every rendered province already has a
// GeometryMap registration by the time it's clickable. Kept its own
// component rather than folding into GeoEntities.tsx itself: provinces are
// conditionally rendered (toggled) in a way the other five GeoEntityType
// classifications aren't.
//
// buildGeoEntityEntries() (scene/geoEntityEntries.ts) already works
// unchanged here — it looks up geometryId in ENTITY_GEOMETRY_IDS and falls
// back to `?? geometryId` when that lookup misses, which is exactly this
// layer's case (every province's geometry id already equals its entity id —
// see useStatesProvincesFeatures.ts), and getEntity() resolves it against
// the same GeoEntityRegistry provinces were registered into. Nothing about
// that function needed to know a sixth classification exists.
//
// StateProvinceLabels.tsx (v5.2.7) adds passive, always-on (once revealed)
// admin-1 name labels alongside the EntityRenderLayer entity rendering
// above — the same entries list feeds both, so there's no second geometry
// walk. Its own file, not inline here, purely because it's a real second
// concern (label sizing/abbreviation/decluttering vs. border/fill/hover
// rendering), the same split CountryLabels.tsx/Globe.tsx already keep for
// countries.
export function StatesProvinces() {
  const features = useStatesProvincesFeatures()
  const { selected } = useSelection()

  const entities = useMemo<GeoEntityEntry[]>(() => buildGeoEntityEntries(features), [features])

  function handleSelect(entity: GeoEntityEntry, direction: Vector3) {
    const resolved = getEntityForGeometry(entity.geometryId) ?? resolveEntity(entity.entityId)
    if (!resolved) return
    selectEntity(resolved, direction)
  }

  // Converts EntityRenderLayer's geometryId to the entityId
  // StateProvinceLabels.tsx's exclusion check needs — see
  // GeoEntities.tsx's handleHoverChange for why this lookup matters even
  // though every province's geometry id already equals its entity id today.
  function handleHoverChange(geometryId: string | null) {
    const entityId = geometryId ? (entities.find((e) => e.geometryId === geometryId)?.entityId ?? null) : null
    setHoveredStateProvinceId(entityId)
  }

  return (
    <>
      <EntityRenderLayer
        entries={entities}
        selectedEntityId={selected?.id}
        onSelect={handleSelect}
        onHoverChange={handleHoverChange}
      />
      <StateProvinceLabels entries={entities} hidden={selected != null} />
    </>
  )
}
