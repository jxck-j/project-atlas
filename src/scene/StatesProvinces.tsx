import { useCallback, useMemo } from 'react'
import { BufferGeometry, Float32BufferAttribute, type Vector3 } from 'three'
import { useStatesProvincesBoundary, useStatesProvincesFeatures } from './useStatesProvincesFeatures'
import type { GeoEntityEntry } from './geoEntityEntries'
import { geometryToLineSegments } from './countryGeometry'
import { GLOBE_RADIUS } from './constants'
import { HIGHLIGHT_COLORS } from './highlightColors'
import { selectEntity, useSelection } from '../hud/selectionStore'
import { resolveEntity } from '../entities/EntityResolver'
import { getEntityForGeometry } from '../entities/GeometryMap'
import { ProvinceFillLayer } from './ProvinceFillLayer'
import { StateProvinceLabels } from './StateProvinceLabels'
import { setHoveredStateProvinceId } from './hoveredStateProvince'
import { useIsLodLevelActive } from '../lod'
import { useFrontFacingEntries } from './useFrontFacingEntries'
import { useChunkedGeoEntityEntries } from './useChunkedGeoEntityEntries'

// v6.2.5: one deduplicated line for every province boundary this layer has
// (interior admin-1 lines AND coastline), instead of relying on each
// province's own EntityRenderLayer border ring for the default/dimmed look
// — see useStatesProvincesFeatures.ts's `boundary` field and
// EntityRenderLayer.tsx's `hideDefaultBorders` doc comment for why:
// rendering the same shared edge from both adjacent provinces' own rings
// doubled every interior boundary, which — back when both were dashed (see
// below) — reliably looked solid wherever the two independently-phased
// dash patterns happened to mostly cover each other's gaps (reported for a
// Brazilian state pair). Now that both this mesh and EntityRenderLayer's
// per-entry border render solid, that specific artifact can't recur, but
// the double-draw would still visibly double the line's opacity at every
// shared edge — hideDefaultBorders below still earns its keep.
//
// 2026-08-16: switched from a dashed to a solid line (dropped
// LineDashedMaterial/DASH_SIZE/GAP_SIZE/the lineDistance attribute
// entirely) — reported directly as a preference once the 1:10m upgrade's
// far denser province count made the dash pattern (even after the
// per-ring normalization fix, see countryGeometry.ts's 2026-08-15 comment)
// read as visual noise across thousands of small boundaries. Kept the
// muted opacity (0.22 vs. EntityRenderLayer's 0.55 default/0.95
// hovered-or-selected) from that same pass — muting the always-on default
// line and leaving EntityRenderLayer's live per-entry border as the only
// full-opacity treatment still means the busy "nothing selected" case
// reads quietly while hovering/selecting one province pops against it.
const BOUNDARY_RADIUS = GLOBE_RADIUS * 1.004
const BOUNDARY_COLOR = HIGHLIGHT_COLORS.default.hex
const BOUNDARY_OPACITY = 0.22

function BoundaryMesh() {
  const boundary = useStatesProvincesBoundary()

  const geometry = useMemo(() => {
    if (!boundary) return null
    const positions = geometryToLineSegments(boundary, BOUNDARY_RADIUS)
    const geo = new BufferGeometry()
    geo.setAttribute('position', new Float32BufferAttribute(positions, 3))
    return geo
  }, [boundary])

  if (!geometry) return null

  return (
    <lineSegments geometry={geometry}>
      <lineBasicMaterial color={BOUNDARY_COLOR} transparent opacity={BOUNDARY_OPACITY} />
    </lineSegments>
  )
}

// Renders the 'administrative-division' GeoEntityType (states/provinces) as
// a Layer Engine layer — off by default (see StatesProvincesLayer.tsx), and
// (as of 2026-08-15, see below) further gated behind LOD zoom so thousands
// of province polygons never clutter the default global view even once the
// layer's toggled on. Kept its own component rather than folding into
// GeoEntities.tsx itself: provinces are conditionally rendered (toggled) in
// a way the other five GeoEntityType classifications aren't, and (as of
// 2026-08-16, see below) render through a states/provinces-specific fill
// layer rather than the shared EntityRenderLayer Countries.tsx/
// GeoEntities.tsx still use.
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
// admin-1 name labels alongside the fill layer below — the same entries
// list feeds both, so there's no second geometry walk. Its own file, not
// inline here, purely because it's a real second concern (label sizing/
// abbreviation/decluttering vs. border/fill/hover rendering), the same
// split CountryLabels.tsx/Globe.tsx already keep for countries.
//
// v6.2.4 rendered province borders dashed to read as visually distinct
// from country borders — later dropped (2026-08-16, see BoundaryMesh's own
// comment above) once denser 1:10m coverage made the dash pattern read as
// noise; this is a plain solid border now, same as Countries.tsx/
// GeoEntities.tsx render.
//
// v6.2.5 added the deduplicated <BoundaryMesh/> above as the source of the
// default (unselected) border — rendering every province's OWN full border
// ring drew every interior admin-1 boundary twice (once per adjacent
// province); only a live border for whichever single province is actually
// hovered/selected renders separately (see ProvinceFillLayer.tsx), which is
// safe since a single line has nothing left to double-draw against.
//
// 2026-08-15: gated behind the LOD Engine's 'states' tier (isLodLevelActive,
// via useIsLodLevelActive — this component has no per-frame camera access
// of its own, so it reads the lodStore rather than computing distance
// directly, same as the LOD Engine's own doc comment recommends). Added
// once the 1:10m upgrade's 4,539 provinces (up from 294) made rendering
// every one of them regardless of zoom — the pre-existing behavior —
// measurably tank FPS: each was its own individually-hoverable/clickable
// mesh, raycast on every pointer move and redrawn on every camera-drag
// frame, all the time, even at the fully zoomed-out default view where
// none of them are usefully distinguishable anyway. features/entities are
// still fetched/built unconditionally below (a one-time cost once the
// layer's toggled on, not a per-frame one) — only the actual scene objects
// are skipped while zoomed out too far for this tier to be active.
//
// 2026-08-16, two more fixes layered on top of the LOD gate — neither
// alone was enough (see LOGBOOK.md's "States/provinces FPS" parts 1-4 for
// the full trail, including one that turned out insufficient once actually
// checked in the browser): (1) useFrontFacingEntries() (same analytic
// horizon/frustum/screen-bounds check useFrontOfGlobeVisible.ts already
// uses for a single point, generalized to filter a whole list) excludes
// provinces that are back-facing or off-screen — always invisible anyway
// (FrontSide culling + the opaque core sphere already hid them), so this
// changes nothing about what's rendered, only what gets considered at all;
// (2) ProvinceFillLayer.tsx replaces EntityRenderLayer's one-mesh-per-entry
// fill rendering with one merged mesh PER COUNTRY (raycast resolved via
// triangle faceIndex, cached once per country — see
// useMergedFillsByCountry.ts) plus small overlays for whichever entry is
// hovered/selected. Needed because (1) alone doesn't help when many
// provinces are simultaneously front-facing and on-screen together
// (confirmed directly for Europe: ~2,750 active provinces at a normal
// zoom vs. Brazil's ~866 at a comparable one) — and a first attempt at
// (2) that merged into one single GLOBAL mesh made things *worse* in
// exactly that case, since a lone merged mesh has no per-object bounding-
// sphere pre-check for R3F's raycaster to reject with; per-country merging
// keeps that rejection (a country-sized bounding sphere) while still
// cutting mesh count ~19x vs. one-per-province. `ProvinceFillLayer` needs
// both the FULL entries list (`entities`, to build/cache each country's
// merged geometry once, never rebuilt on camera movement) and the
// front-facing subset (`frontFacingEntities`, to decide which countries'
// already-built meshes are actually mounted right now).
export function StatesProvinces() {
  const features = useStatesProvincesFeatures()
  const { selected } = useSelection()
  const isActive = useIsLodLevelActive('states')

  // Chunked (2026-08-17), not a plain useMemo(() => buildGeoEntityEntries(features)):
  // earcut triangulation for all 4,539 provinces at once blocked the main
  // thread for 1.3-1.7 seconds on every layer mount — see
  // useChunkedGeoEntityEntries.ts's own doc comment and LOGBOOK.md's
  // "States/provinces FPS" part 8. `entities` now grows progressively
  // over a few hundred-ms chunks instead of arriving all at once; every
  // consumer below already treats it as just an array that's fine to grow.
  const entities = useChunkedGeoEntityEntries(features)
  const frontFacingEntities = useFrontFacingEntries(entities)

  // O(1) lookup instead of entities.find() — with 4,539 provinces, an
  // Array.find() re-scan on every single hover-change event (potentially
  // dozens per second while the pointer sweeps across many small,
  // densely-packed provinces — Europe, specifically) is a real, avoidable
  // cost. See LOGBOOK.md's "States/provinces FPS" part 7.
  const entityByGeometryId = useMemo(() => new Map(entities.map((entity) => [entity.geometryId, entity])), [entities])

  const handleSelect = useCallback((entity: GeoEntityEntry, direction: Vector3) => {
    const resolved = getEntityForGeometry(entity.geometryId) ?? resolveEntity(entity.entityId)
    if (!resolved) return
    selectEntity(resolved, direction)
  }, [])

  // Converts EntityRenderLayer's geometryId to the entityId
  // StateProvinceLabels.tsx's exclusion check needs — see
  // GeoEntities.tsx's handleHoverChange for why this lookup matters even
  // though every province's geometry id already equals its entity id today.
  // Both callbacks are wrapped in useCallback (stable references) so
  // ProvinceFillLayer.tsx's own React.memo-wrapped country meshes don't
  // all re-render just because StatesProvinces itself re-rendered.
  const handleHoverChange = useCallback(
    (geometryId: string | null) => {
      const entityId = geometryId ? (entityByGeometryId.get(geometryId)?.entityId ?? null) : null
      setHoveredStateProvinceId(entityId)
    },
    [entityByGeometryId]
  )

  if (!isActive) return null

  return (
    <>
      <BoundaryMesh />
      <ProvinceFillLayer
        allEntries={entities}
        visibleEntries={frontFacingEntities}
        selectedEntityId={selected?.id}
        onSelect={handleSelect}
        onHoverChange={handleHoverChange}
      />
      <StateProvinceLabels entries={frontFacingEntities} hidden={selected != null} />
    </>
  )
}
