import { resolveEntity } from './EntityResolver'
import type { ResolvedEntity } from './types'

// Completes the chain a future click handler is meant to follow:
//
//   polygon_id (whatever a rendered shape's own id happens to be)
//     -> entity_id (a Country or Territory registry id)
//     -> EntityResolver (the actual GeopoliticalEntity)
//
// This is the missing middle step. Right now, scene/Countries.tsx skips it
// entirely — a clicked polygon's GeoJSON feature id is used directly as a
// country id (see Countries.tsx's `id` field and handlePointerUp), which
// only works because every currently-rendered polygon *is* a country and
// its geometry id happens to already equal its own registry id. That's an
// assumption baked into the rendering code today, not a rule this module
// enforces — GeometryMap exists so that assumption can stop being true
// without a rewrite: a polygon's geometry id and the entity it represents
// don't have to be the same string, and don't have to be a 1:1 country
// relationship at all (a future carved-out Crimea sub-region, a point
// marker, any shape with an id) can map to whatever entity actually owns
// it. See CLAUDE.md/LOGBOOK.md for why this specifically prepares the
// globe for independent territory selection.
//
// Deliberately dumb storage: a plain `Map<string, string>` from geometry id
// to entity id. It doesn't know or care what *kind* of geometry produced a
// given id (a country polygon today, a hand-authored territory shape or a
// point marker later) — every id is just an opaque string key, which is
// what "allow multiple geometry types to resolve into entities" actually
// means here: there's no branching on geometry type to extend.
const geometryToEntityId = new Map<string, string>()

/**
 * Associates a rendered geometry's id with the entity (country or
 * territory) it represents. Throws if `geometryId` is already mapped, for
 * the same reason CountryRegistry/TerritoryRegistry throw on a duplicate
 * id — two different entities claiming the same polygon is a bug worth
 * surfacing, not silently resolving by last-write-wins.
 */
export function registerGeometryMapping(geometryId: string, entityId: string): void {
  if (geometryToEntityId.has(geometryId)) {
    throw new Error(
      `[GeometryMap] geometry id "${geometryId}" is already mapped to an entity.`
    )
  }
  geometryToEntityId.set(geometryId, entityId)
}

/** Whether a geometry id has a registered mapping, without resolving it — cheap existence check for a caller that just wants to know "is this shape meaningful" before doing more work. */
export function hasGeometryMapping(geometryId: string): boolean {
  return geometryToEntityId.has(geometryId)
}

/**
 * Walks the full chain: looks up the entity id mapped to this geometry id,
 * then resolves it through EntityResolver, and returns the result.
 * Undefined if there's no mapping for this geometry id, or (should it ever
 * happen — a mapping pointing at an id neither registry has) if the mapped
 * entity id doesn't resolve to anything. Either way, "nothing to select"
 * is a value here, not an exception — same reasoning as
 * EntityResolver.resolveEntity().
 */
export function getEntityForGeometry(geometryId: string): ResolvedEntity | undefined {
  const entityId = geometryToEntityId.get(geometryId)
  if (!entityId) return undefined
  return resolveEntity(entityId)
}
