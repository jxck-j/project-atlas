import { useMemo, useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import { FrontSide, type LineBasicMaterial } from 'three'
import { registerLayer } from '../layerRegistry'
import { useGeoEntityFeatures } from '../../scene/useGeoEntityFeatures'
import { buildGeoEntityEntries } from '../../scene/geoEntityEntries'
import { useSelection } from '../../hud/selectionStore'
import { getEntities } from '../../data'
import type { GeoEntity } from '../../data'

// v3 "Claims overlay": a future-compatible claims visualization layer, per
// the spec — "when enabled: selected entity = primary highlight, claimed
// territories = secondary outline/hatching style ... do not fill claimed
// territories with the same color as the claimant." Registered through the
// Layer Engine like ParentOverlayLayer, and defaultEnabled: false — the
// spec frames this as opt-in ("when enabled"), unlike the territory overlay
// which reads as an always-useful selection-context cue.
//
// Rendering note: this app's borders use plain LineBasicMaterial (native
// WebGL ignores its `linewidth`, and a true diagonal-hatch fill would need
// a custom shader/texture — out of scope here). "Hatching style" is
// approximated instead with a distinct, unused-elsewhere color plus a slow
// pulse, so a claimed entity reads as "flagged" rather than solidly filled
// — and specifically never reuses COLOR_SELECTED, satisfying "do not fill
// claimed territories with the same color as the claimant."
const CLAIM_COLOR = '#FF5CD6'
const CLAIM_FILL_RADIUS_FACTOR = 1.002

function countryIdOf(selectedId: string, kind: 'country' | 'geo-entity') {
  return kind === 'country' ? selectedId : undefined
}

/** Every GeoEntity id in a claim relationship (either direction) with the current selection. */
function useClaimRelatedEntityIds(): Set<string> {
  const { selected } = useSelection()

  return useMemo(() => {
    const ids = new Set<string>()
    if (!selected) return ids

    if (selected.entity.kind === 'country') {
      const countryId = countryIdOf(selected.id, 'country')
      for (const e of getEntities()) {
        const relatesToCountry = [...e.claimedBy, ...e.claims].some(
          (r) => r.ref?.type === 'country' && r.ref.id === countryId
        )
        if (relatesToCountry) ids.add(e.id)
      }
      return ids
    }

    const geoEntity = selected.entity.data as GeoEntity
    for (const relation of [...geoEntity.claimedBy, ...geoEntity.claims]) {
      if (relation.ref?.type === 'geo-entity') ids.add(relation.ref.id)
    }
    return ids
  }, [selected])
}

export function ClaimsOverlayComponent() {
  const claimRelatedIds = useClaimRelatedEntityIds()
  const features = useGeoEntityFeatures()
  const entries = useMemo(() => buildGeoEntityEntries(features), [features])
  const pulseRef = useRef<LineBasicMaterial[]>([])

  useFrame(({ clock }) => {
    const t = clock.getElapsedTime()
    const pulse = 0.55 + Math.sin(t * 2.4) * 0.35
    for (const material of pulseRef.current) {
      material.opacity = pulse
    }
  })

  if (claimRelatedIds.size === 0) return null

  const claimed = entries.filter((entry) => claimRelatedIds.has(entry.entityId))
  if (claimed.length === 0) return null

  pulseRef.current = []

  return (
    <group>
      {claimed.map((entry) => (
        <group key={`claims-overlay-${entry.geometryId}`}>
          <lineSegments geometry={entry.borderGeometry}>
            <lineBasicMaterial
              ref={(m) => {
                if (m) pulseRef.current.push(m)
              }}
              color={CLAIM_COLOR}
              transparent
              opacity={0.9}
            />
          </lineSegments>
          {entry.fillGeometry && (
            <mesh geometry={entry.fillGeometry} scale={CLAIM_FILL_RADIUS_FACTOR}>
              {/* Deliberately near-zero fill — "do not fill claimed
                  territories with the same color as the claimant" is
                  satisfied trivially by using CLAIM_COLOR at all (never
                  COLOR_SELECTED), but keeping the fill itself minimal also
                  avoids visually implying ownership/control, which a solid
                  fill would read as. */}
              <meshBasicMaterial color={CLAIM_COLOR} transparent opacity={0.06} side={FrontSide} depthWrite={false} />
            </mesh>
          )}
        </group>
      ))}
    </group>
  )
}

registerLayer({
  id: 'claims-overlay',
  label: 'CLAIMS OVERLAY',
  description:
    'Highlights entities claimed by (or claiming) the current selection in a distinct pulsing outline — sovereignty disputes made visible without implying resolution.',
  category: 'geopolitical',
  defaultEnabled: false,
  component: ClaimsOverlayComponent,
})
