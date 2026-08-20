import type { LodLevel, LodLevelId } from './types'

// The ordered zoom ladder, shallowest (least detail) first. Distance
// thresholds for the implemented city tiers are the same values
// UsCityLabels.tsx's old REVEAL_TIERS already tuned by eye across this
// session (Hattiesburg's off-screen-candidate bug, then the Gulfport/
// Biloxi spacing-collision fix) — carried forward rather than re-guessed,
// since they were already validated in the browser. `every-incorporated-
// city`'s 2.52 is a deliberately independent, hand-tuned number, NOT
// derived from CAMERA_MIN_DISTANCE (scene/constants.ts) even though the
// two happen to be close — this level's reveal point is a product/legibility
// decision (when does "show literally everything" start making sense),
// while CAMERA_MIN_DISTANCE is a rendering-safety limit (how close the
// camera can physically get before country/state mesh shells break — see
// that constant's own comment). Tying them together made an unrelated
// camera-safety tweak silently retune this level's product behavior the
// last time CAMERA_MIN_DISTANCE moved; keeping them separate means each
// can change for its own reason without touching the other.
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
    // 2026-08-15: gated behind a real reveal distance, not "always on" like
    // countries/lakes/rivers — this tier grew from 294 features (9 large
    // countries, 1:50m) to 4,539 (nearly every country, 1:10m), and
    // rendering all of them regardless of zoom made every one individually
    // hoverable/clickable at once, tanking FPS (thousands of raycast
    // targets on every pointer move, thousands of draw calls on every
    // camera-drag frame). First pass used 5.0 (shortly before
    // CAMERA_FOCUS_DISTANCE, 4.8 — scene/constants.ts), which is what let
    // this tier still be active over a wide multi-country view (e.g. all of
    // Europe in frame) and reintroduce the same FPS problem despite the
    // per-country/per-entry merge work — see LOGBOOK.md's "States/provinces
    // FPS" entries. 2026-08-17: tightened to 2.5 (== CAMERA_MIN_DISTANCE,
    // scene/constants.ts) after comparing against how much closer Google
    // Maps zooms before revealing admin-1 boundaries — read as too
    // aggressive (past every city tier's own threshold, tightest at 2.52).
    // Eased out to 3.5, then dialed back in to 2.8 the same day — 2.8 sat
    // BETWEEN metro-areas (2.85) and large-cities (2.7), so states unlocked
    // just after the metro-areas city tier rather than before the entire
    // city ladder (3.5/5.0's behavior) or after all of it (2.5's).
    // 2026-08-20: eased again to 2.85, matching metro-areas exactly — direct
    // request that states/provinces become visible at the same zoom level
    // as major cities, not one tier later. (Numeric threshold only controls
    // WHEN a tier activates, not where it sits in resolveActiveLevels()'s
    // returned array — that's fixed by this list's own declaration order, so
    // 'states' always reports right after 'countries' regardless of which
    // number is here.)
    description: 'Admin-1 boundaries — nearly every country, revealed at the same distance as major (metro-area) cities.',
    revealDistance: 2.85,
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
    description: 'US cities scored (by population, capitals floored) at 700,000+.',
    revealDistance: 2.85,
    implemented: true,
  },
  {
    id: 'large-cities',
    label: 'Large Cities',
    description: 'US cities scored at 250,000+.',
    revealDistance: 2.7,
    implemented: true,
  },
  {
    id: 'medium-cities',
    label: 'Medium Cities',
    description: 'US cities scored at 100,000+.',
    revealDistance: 2.6,
    implemented: true,
  },
  {
    id: 'small-cities',
    label: 'Small Cities',
    description: 'US cities scored at 30,000+.',
    revealDistance: 2.55,
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
