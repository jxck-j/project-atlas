import type { Mesh } from 'three'

// Plain (non-reactive) module-level ref to Globe.tsx's core sphere mesh —
// same "a plain value crosses the scene/HUD-ish boundary, nothing reactive
// has to" pattern globeRotation.ts already established, applied here so a
// Layer Engine-mounted component (which isn't a direct child of Globe.tsx
// the way WaterLabels is, so it can't just receive a ref via props) can
// still occlude its own Html labels against the core sphere the same way
// WaterLabels does. See scene/Lakes.tsx.
//
// A ref object IS already just a mutable `{ current }` box — no store
// needed, just a shared instance of that box. Globe.tsx assigns its core
// sphere mesh's `ref` prop directly to this export instead of its own local
// `useRef`, so both call sites end up pointing at the exact same mesh
// instance.
export const coreSphereRef: { current: Mesh | null } = { current: null }
