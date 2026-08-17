import { BufferAttribute, BufferGeometry, Float32BufferAttribute } from 'three'
import type { GeoEntityEntry } from './geoEntityEntries'

// Merges many entries' individual fill geometries into one BufferGeometry,
// plus a faceIndex -> entries-array-index lookup so a single mesh's
// raycast intersection can still be resolved back to which entry it hit.
// Built (2026-08-16) for scene/ProvinceFillLayer.tsx: ~4,500 provinces each
// getting their own individually-raycast/redrawn mesh (EntityRenderLayer's
// usual one-mesh-per-entry model, fine at country/GeoEntity scale) was the
// direct cause of a reported FPS regression once the states/provinces
// layer's 1:10m upgrade landed. This does the same "one merged geometry"
// consolidation countryGeometry.ts already does per-country (many rings ->
// one mesh), one level up: many entries -> one mesh, with hit-testing
// precision unchanged (same triangles, just concatenated into one buffer)
// since a real per-triangle raycast still runs, just against one object
// instead of hundreds.
export interface MergedProvinceFill {
  geometry: BufferGeometry
  // Same length as the merged geometry's triangle (face) count — index i
  // holds the position, in the `entries` array this was built from, of
  // whichever entry contributed that triangle.
  faceToEntryIndex: Uint32Array
}

export function buildMergedProvinceFill(entries: GeoEntityEntry[]): MergedProvinceFill | null {
  let totalVertices = 0
  let totalIndices = 0
  for (const entry of entries) {
    if (!entry.fillGeometry?.index) continue
    totalVertices += entry.fillGeometry.attributes.position.count
    totalIndices += entry.fillGeometry.index.count
  }
  if (totalIndices === 0) return null

  const positions = new Float32Array(totalVertices * 3)
  const indices = new Uint32Array(totalIndices)
  const faceToEntryIndex = new Uint32Array(totalIndices / 3)

  let vertexOffset = 0
  let indexOffset = 0
  let faceOffset = 0
  entries.forEach((entry, entryIndex) => {
    const fill = entry.fillGeometry
    if (!fill?.index) return

    const positionAttr = fill.attributes.position
    positions.set(positionAttr.array as Float32Array, vertexOffset * 3)

    const sourceIndices = fill.index.array
    for (let i = 0; i < sourceIndices.length; i++) {
      indices[indexOffset + i] = sourceIndices[i] + vertexOffset
    }

    const faceCount = sourceIndices.length / 3
    faceToEntryIndex.fill(entryIndex, faceOffset, faceOffset + faceCount)

    vertexOffset += positionAttr.count
    indexOffset += sourceIndices.length
    faceOffset += faceCount
  })

  const geometry = new BufferGeometry()
  geometry.setAttribute('position', new Float32BufferAttribute(positions, 3))
  geometry.setIndex(new BufferAttribute(indices, 1))
  return { geometry, faceToEntryIndex }
}
