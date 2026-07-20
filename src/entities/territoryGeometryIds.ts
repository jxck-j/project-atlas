// Single source of truth for "which registered territories have a real,
// standalone polygon in world-atlas's raw 10m source data, and what's its
// id" — the ISO 3166-1 numeric id topojson preserves as `feature.id`
// through the rebuild/simplify pipeline (same convention
// unMembers.ts/buildCountryTopology.mjs already rely on for countries).
//
// Used by both scripts/buildTerritoryTopology.mjs (which raw features to
// keep) and scene/useTerritoryFeatures.ts (mapping a loaded feature's id
// back to the territory it belongs to, for registerGeometryMapping()) — one
// map instead of two so the build-time allowlist and the runtime lookup can
// never drift apart.
//
// Crimea is deliberately absent: it has no standalone polygon anywhere in
// the source data at any resolution (it's geometrically part of Ukraine's
// polygon) — see LOGBOOK.md. It stays selectable via search only until a
// real sub-region shape exists; fabricating one isn't this project's call
// to make casually. See exampleGeometryMappings.ts's synthetic-id note for
// the same limitation from the other direction.
export const TERRITORY_GEOMETRY_IDS: Record<string, string> = {
  '158': 'taiwan',
  '630': 'puerto-rico',
  '732': 'western-sahara',
}
