export const GLOBE_RADIUS = 2.4

// Camera / OrbitControls bounds, shared between CameraControls.tsx and the
// flight-to-country animation so they can never disagree with each other.
//
// 1.35 (original value) put the closest zoom at ~2,230km altitude — fine
// for country/GeoEntity-scale viewing. An attempted 1.005 (~32km altitude,
// for resolving individual city polygons) broke badly in practice: at that
// distance the core sphere, country fill meshes (~1.0x), borders
// (~1.004-1.006x), and atmosphere shells are all packed into a shell only
// a few thousandths of GLOBE_RADIUS thick, so grazing/near-tangent camera
// angles end up looking through or past surface geometry instead of at it
// — reported as "cutting through the plane." 1.05 (~335km altitude) is a
// deliberately more conservative middle ground: meaningfully closer than
// the original for general use, without packing the camera into that same
// razor-thin geometry shell. See Scene.tsx's `near` clip plane (which
// moved with this) and CLAUDE.md/LOGBOOK.md.
export const CAMERA_MIN_DISTANCE = GLOBE_RADIUS * 1.05
export const CAMERA_MAX_DISTANCE = GLOBE_RADIUS * 5
export const CAMERA_MIN_POLAR_ANGLE = Math.PI * 0.12
export const CAMERA_MAX_POLAR_ANGLE = Math.PI * 0.88
export const CAMERA_FOCUS_DISTANCE = GLOBE_RADIUS * 2.0
// Closer than CAMERA_FOCUS_DISTANCE (country/GeoEntity-scale selection
// flights) but with real margin above CAMERA_MIN_DISTANCE this time (not
// landing on the hard zoom clamp, which is exactly what broke at 1.01
// alongside the CAMERA_MIN_DISTANCE experiment above). Only used by
// flyToUsCity() (US city search results, hud/SearchBar.tsx).
export const US_CITY_FOCUS_DISTANCE = GLOBE_RADIUS * 1.1
export const CAMERA_IDLE_AUTOROTATE_SPEED = 0.35
// Matches Scene.tsx's initial <Canvas camera={{ position: [0, 0, 6.5] }} /> —
// the "home" view that Home-key / double-click-ocean / the toolbar's globe
// button all return to.
export const CAMERA_DEFAULT_DISTANCE = 6.5
