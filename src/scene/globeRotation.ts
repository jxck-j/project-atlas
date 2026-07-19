// Plain (non-reactive) publisher for the globe's current ambient Y rotation,
// written every frame in Globe.tsx. Lets code outside the Canvas — the
// search bar — compute a country's current world-space direction from its
// lat/lng without needing a mesh reference to read localToWorld() from.
// Read imperatively at the moment it's needed (search submit), not
// subscribed to for rendering, so a plain module variable is enough.
let rotationY = 0

export function setGlobeRotationY(y: number) {
  rotationY = y
}

export function getGlobeRotationY(): number {
  return rotationY
}
