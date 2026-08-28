import type { LodLevel, LodLevelId } from './types'

// The ordered zoom ladder, shallowest (least detail) first.
//
// 2026-08-27 retune: the city tiers (metro-areas through small-cities) used
// to be crammed into 2.85-2.55 — a sliver right next to CAMERA_MIN_DISTANCE
// (2.5) with no city content anywhere above it. CAMERA_FOCUS_DISTANCE
// (scene/constants.ts, 4.8 = GLOBE_RADIUS * 2.0 — where the camera lands
// when a country/GeoEntity is SELECTED, not just hovered) was nowhere near
// any of them, so the single most common "zoom in" action in the app —
// clicking a country — revealed zero cities regardless of that country's
// size. Reported directly by an outside tester as "you have to zoom in too
// far to see anything." Re-anchored so `metro-areas` reveals AT
// CAMERA_FOCUS_DISTANCE exactly — selecting a country now always shows its
// biggest cities immediately — with the rest of the ladder spread out
// underneath it rather than bunched at the bottom. `every-incorporated-
// city`'s 2.52 is unchanged: showing literally every place, however small,
// is still deliberately gated to the closest zoom, independent of
// CAMERA_MIN_DISTANCE (2.5) for the same reason as before — that's a
// rendering-safety limit, not a product decision about this tier, and
// tying them together would let an unrelated camera-safety tweak silently
// retune this level's behavior.
export const LOD_LEVELS: LodLevel[] = [
  {
    id: 'earth',
    label: 'Earth',
    description: 'Default overview — the wireframe globe with no place-level detail.',
    revealDistance: null,
    implemented: true,
  },
  {
    id: 'countries',
    label: 'Countries',
    description: '193 UN member states — always rendered, not progressively revealed (cheap enough at this feature count).',
    revealDistance: null,
    implemented: true,
  },
  {
    id: 'states',
    label: 'States / Provinces',
    description: 'Admin-1 boundaries for 9 large countries — same "always on" reasoning as countries.',
    revealDistance: null,
    implemented: true,
  },
  {
    id: 'lakes',
    label: 'Lakes',
    description: 'Major lakes (Natural Earth 1:50m, 412 features) — same "always on" reasoning as countries/states.',
    revealDistance: null,
    implemented: true,
  },
  {
    id: 'rivers',
    label: 'Rivers',
    description: 'Major rivers (Natural Earth 1:50m, scalerank <= 3, 116 features) — same "always on" reasoning as countries/states.',
    revealDistance: null,
    implemented: true,
  },
  {
    id: 'metro-areas',
    label: 'Major Metropolitan Areas',
    description: 'Cities scored (by population, capitals floored) at 700,000+ — revealed at CAMERA_FOCUS_DISTANCE, so selecting a country always shows its biggest cities immediately.',
    revealDistance: 4.8,
    implemented: true,
  },
  {
    id: 'large-cities',
    label: 'Large Cities',
    description: 'Cities scored at 250,000+.',
    revealDistance: 4.0,
    implemented: true,
  },
  {
    id: 'medium-cities',
    label: 'Medium Cities',
    description: 'Cities scored at 100,000+.',
    revealDistance: 3.4,
    implemented: true,
  },
  {
    id: 'small-cities',
    label: 'Small Cities',
    description: 'Cities scored at 30,000+.',
    revealDistance: 2.9,
    implemented: true,
  },
  {
    id: 'every-incorporated-city',
    label: 'Every Incorporated City',
    description: 'Every US place with a real (Census-estimated, i.e. incorporated) population.',
    revealDistance: 2.52,
    implemented: true,
  },
  // Reserved — see types.ts's LodLevelId comment. No revealDistance yet
  // because no camera-limit or rendering work has been done to support
  // them; `implemented: false` keeps them out of every resolver below
  // regardless of distance until that work happens.
  { id: 'roads', label: 'Roads', description: 'Not yet implemented.', revealDistance: null, implemented: false },
  { id: 'rail', label: 'Rail', description: 'Not yet implemented.', revealDistance: null, implemented: false },
  { id: 'airports', label: 'Airports', description: 'Not yet implemented.', revealDistance: null, implemented: false },
  { id: 'ports', label: 'Ports', description: 'Not yet implemented.', revealDistance: null, implemented: false },
  {
    id: 'military-bases',
    label: 'Military Bases',
    description: 'Not yet implemented.',
    revealDistance: null,
    implemented: false,
  },
  {
    id: 'infrastructure',
    label: 'Infrastructure',
    description: 'Not yet implemented.',
    revealDistance: null,
    implemented: false,
  },
]

// Every implemented level whose reveal condition the given distance
// satisfies, in ladder order (shallowest first). Independent per-level
// checks, not "first match wins" — this is what makes the ladder
// cumulative (zooming in to unlock Small Cities doesn't hide Metro Areas)
// without needing a separate upper-bound guard the way the old
// NO_CITIES_ABOVE_DISTANCE constant did.
export function resolveActiveLevels(distance: number): LodLevel[] {
  return LOD_LEVELS.filter((level) => level.implemented && (level.revealDistance === null || distance <= level.revealDistance))
}

// The single most-detailed active level — what a HUD readout or debug
// tool means by "current zoom level."
export function resolveDeepestLevel(distance: number): LodLevel {
  const active = resolveActiveLevels(distance)
  return active[active.length - 1] ?? LOD_LEVELS[0]
}

export function isLodLevelActive(id: LodLevelId, distance: number): boolean {
  const level = LOD_LEVELS.find((candidate) => candidate.id === id)
  if (!level || !level.implemented) return false
  return level.revealDistance === null || distance <= level.revealDistance
}
