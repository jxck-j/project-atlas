export const GLOBE_RADIUS = 2.4

// Camera / OrbitControls bounds, shared between CameraControls.tsx and the
// flight-to-country animation so they can never disagree with each other.
export const CAMERA_MIN_DISTANCE = GLOBE_RADIUS * 1.35
export const CAMERA_MAX_DISTANCE = GLOBE_RADIUS * 5
export const CAMERA_MIN_POLAR_ANGLE = Math.PI * 0.12
export const CAMERA_MAX_POLAR_ANGLE = Math.PI * 0.88
export const CAMERA_FOCUS_DISTANCE = GLOBE_RADIUS * 2.0
export const CAMERA_IDLE_AUTOROTATE_SPEED = 0.35
// Matches Scene.tsx's initial <Canvas camera={{ position: [0, 0, 6.5] }} /> —
// the "home" view that Home-key / double-click-ocean / the toolbar's globe
// button all return to.
export const CAMERA_DEFAULT_DISTANCE = 6.5
