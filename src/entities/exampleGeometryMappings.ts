// Illustrative placeholder geometry mappings — NOT imported by index.ts,
// App.tsx, Globe.tsx, or anything else the running app loads. Same role as
// data/registry/exampleTerritories.ts: proves the API against real,
// non-trivial cases and gives a concrete worked example, without wiring
// anything into the live rendering pipeline (v2.2.0 explicitly does not
// modify rendering behavior).
//
// Imports exampleTerritories so the 'taiwan'/'crimea'/'western-sahara'
// entity ids these mappings point at actually resolve to something when
// exercised — chaining two still-disconnected example modules together for
// a coherent demonstration, not connecting either to the app.
import '../data/registry/exampleTerritories'
import { registerGeometryMapping } from './GeometryMap'

// Taiwan and Western Sahara both exist as their own distinct features in
// world-atlas's raw 10m source data (Natural Earth), with their own
// ISO 3166-1 numeric ids — 158 and 732 respectively — even though neither
// is currently part of the rendered UN-193 country set (see
// data/unMembers.ts; both are excluded because neither is a UN member).
// Using those real ids here, rather than inventing new ones, is what a
// geometry id for either would actually be *if* the rendering pipeline
// were ever extended to include them — this file doesn't do that
// extension, it just anticipates the id it would need to map.
registerGeometryMapping('158', 'taiwan')
registerGeometryMapping('732', 'western-sahara')

// Crimea has no equivalent: it is not a standalone feature anywhere in the
// Natural Earth source data at any resolution this project has looked at
// (see LOGBOOK.md) — it's geometrically part of Ukraine's polygon, not a
// separately-clickable shape. There is no real geometry id to reference
// yet. This mapping uses a synthetic placeholder id to demonstrate that
// GeometryMap doesn't care where an id comes from, but it's explicitly a
// stand-in for a real solution (most likely: authoring a Crimea sub-region
// polygon and clipping it out of Ukraine's, a rendering-layer decision
// this version deliberately doesn't make).
registerGeometryMapping('placeholder-crimea-subregion', 'crimea')
