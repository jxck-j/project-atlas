// Public barrel for the LOD Engine. Consumers (current: UsCityLabels.tsx;
// future: any Roads/Rail/Rivers/Airports/Ports/Military Bases/
// Infrastructure layer) should import from here rather than reaching into
// individual files — mirrors layers/index.ts's role for the Layer Engine.
export { LOD_LEVELS, resolveActiveLevels, resolveDeepestLevel, isLodLevelActive } from './lodLevels'
export { publishLodDistance, getLodDistance, getCurrentLodLevel, useLodLevel } from './lodStore'
export type { LodLevel, LodLevelId } from './types'
