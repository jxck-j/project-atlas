import { useMemo } from 'react'
import { BufferGeometry, Float32BufferAttribute, type Vector3 } from 'three'
import { useStatesProvincesBoundary, useStatesProvincesFeatures } from './useStatesProvincesFeatures'
import { buildGeoEntityEntries, DASH_SIZE, GAP_SIZE, type GeoEntityEntry } from './geoEntityEntries'
import { geometryToLineSegmentsWithDistances } from './countryGeometry'
import { GLOBE_RADIUS } from './constants'
import { HIGHLIGHT_COLORS } from './highlightColors'
import { selectEntity, useSelection } from '../hud/selectionStore'
import { resolveEntity } from '../entities/EntityResolver'
import { getEntityForGeometry } from '../entities/GeometryMap'
import { EntityRenderLayer } from './EntityRenderLayer'
import { StateProvinceLabels } from './StateProvinceLabels'
import { setHoveredStateProvinceId } from './hoveredStateProvince'

// v6.2.5: one deduplicated dashed line for every province boundary this
// layer has (interior admin-1 lines AND coastline), instead of relying on
// each province's own EntityRenderLayer border ring for the default/dimmed
// look — see useStatesProvincesFeatures.ts's `boundary` field and
// EntityRenderLayer.tsx's `hideDefaultBorders` doc comment for why:
// rendering the same shared edge from both adjacent provinces' own rings
// doubled every interior boundary with two uncorrelated dash phases, which
// reliably looked solid instead of dashed wherever those phases happened to
// mostly cover each other's gaps (reported for Pará/Mato Grosso). Matches
// EntityRenderLayer's own default (unselected/undimmed) border treatment —
// same radius, same dash scale, same default color/opacity — so swapping
// between "nothing selected" and "hovering/selecting a province" doesn't
// have a visible seam between this mesh and the one live per-entry border
// EntityRenderLayer still draws for whichever entry is actually focused.
const BOUNDARY_RADIUS = GLOBE_RADIUS * 1.004
const BOUNDARY_COLOR = HIGHLIGHT_COLORS.default.hex
const BOUNDARY_OPACITY = 0.55

function BoundaryMesh() {
  const boundary = useStatesProvincesBoundary()

  const geometry = useMemo(() => {
    if (!boundary) return null
    const { positions, distances } = geometryToLineSegmentsWithDistances(boundary, BOUNDARY_RADIUS)
    const geo = new BufferGeometry()
    geo.setAttribute('position', new Float32BufferAttribute(positions, 3))
    geo.setAttribute('lineDistance', new Float32BufferAttribute(distances, 1))
    return geo
  }, [boundary])

  if (!geometry) return null

  return (
    <lineSegments geometry={geometry}>
      <lineDashedMaterial color={BOUNDARY_COLOR} dashSize={DASH_SIZE} gapSize={GAP_SIZE} transparent opacity={BOUNDARY_OPACITY} />
    </lineSegments>
  )
}

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
//
// v6.2.4: passes dashedBorders to EntityRenderLayer — reported directly
// that province borders needed to read as visually distinct from country
// borders once this layer is on, not just an extra 294 polygons in the same
// solid-line style. Reuses the exact dash mechanism ClaimsOverlayLayer.tsx's
// "hatching style" claim outlines already established (see
// scene/geoEntityEntries.ts's DASH_SIZE/GAP_SIZE) rather than inventing a
// second one.
//
// v6.2.5: also passes hideDefaultBorders, and mounts <BoundaryMesh /> above
// as the actual source of the default (unselected) dashed look — v6.2.4's
// per-entry dashed borders alone doubled every interior admin-1 boundary
// (drawn once per adjacent province) with uncorrelated dash phases, which
// looked solid wherever those phases happened to mostly fill in each
// other's gaps. EntityRenderLayer still draws one live per-entry border,
// dashed, for whichever single province is actually hovered/selected — see
// its own hideDefaultBorders doc comment for why that one case is safe.
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
      <BoundaryMesh />
      <EntityRenderLayer
        entries={entities}
        selectedEntityId={selected?.id}
        onSelect={handleSelect}
        onHoverChange={handleHoverChange}
        dashedBorders
        hideDefaultBorders
      />
      <StateProvinceLabels entries={entities} hidden={selected != null} />
    </>
  )
}
