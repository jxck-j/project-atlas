import { useMemo, useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import { Html, Line } from '@react-three/drei'
import { BufferGeometry, Float32BufferAttribute, FrontSide, type Mesh } from 'three'
import { registerLayer } from '../layerRegistry'
import { useGeoEntityFeatures } from '../../scene/useGeoEntityFeatures'
import { useCountryFeatures } from '../../scene/useCountryFeatures'
import { buildGeoEntityEntries, computeLineDistances } from '../../scene/geoEntityEntries'
import { geometryToBorderSegments, geometryToCentroid, geometryToFillMesh } from '../../scene/countryGeometry'
import { GLOBE_RADIUS } from '../../scene/constants'
import { latLngToVector3 } from '../../utils/geo'
import { HIGHLIGHT_COLORS } from '../../scene/highlightColors'
import { useSelection } from '../../hud/selectionStore'
import { getEntities } from '../../data'
import type { GeoEntity } from '../../data'

// v3 "Claims overlay": a future-compatible claims visualization layer, per
// the spec — "when enabled: selected entity = primary highlight, claimed
// territories = secondary outline/hatching style ... do not fill claimed
// territories with the same color as the claimant." Registered through the
// Layer Engine like ParentOverlayLayer. defaultEnabled: true — "when
// enabled" describes the layer's *architecture* (it's a toggle, still
// listed and switchable off in the Layer Panel like any other layer), not a
// requirement that it start off; the spec's own examples (click China, see
// Taiwan/Spratly flagged) are meant to be immediately visible, not
// contingent on first finding the right toggle.
//
// v3.1: "hatching style" is a real dashed outline (LineDashedMaterial),
// replacing v3.0's pulsing-solid-line approximation — see LOGBOOK.md. This
// needs the border geometry's 'lineDistance' attribute, which
// scene/geoEntityEntries.ts's buildGeoEntityEntries() precomputes for every
// entry (see that file's computeLineDistances()), so nothing extra is
// required here beyond picking a material. Fill stays deliberately
// near-zero opacity and a color that's never COLOR_SELECTED — that's what
// actually satisfies "do not fill claimed territories with the same color
// as the claimant," the dash is a legibility choice on top of it.
// Sourced from scene/highlightColors.ts — the same value hud/LegendPanel.tsx
// explains.
const CLAIM_COLOR = HIGHLIGHT_COLORS.claimsOverlay.hex
const CLAIM_FILL_RADIUS_FACTOR = 1.002
const DASH_SIZE = 0.028
const GAP_SIZE = 0.02

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

// ---------------------------------------------------------------------------
// Claimant countries — the other direction of the same relationship.
// Countries.tsx renders on completely different geometry (its own
// useCountryFeatures() fetch, not the GeoEntity topology above), so "Taiwan
// is claimed by China" needs its own small render path here: the GeoEntity
// side (Taiwan) already gets the dashed CLAIM_COLOR treatment above when
// CHINA is selected, but when TAIWAN is selected there was previously
// nothing at all pointing at China — a Country is never itself a GeoEntity
// entry, so useClaimRelatedEntityIds' `ref.type === 'geo-entity'` filter
// silently dropped every country-typed claimant. `Country` has no
// `claimedBy` field of its own (see data/types.ts) — a selected Country can
// therefore never itself have "claimant countries"; this only ever fires
// for a selected GeoEntity.
//
// Deliberately a different color from the claimed side (blue, not magenta)
// plus a prominent fill (0.32, well above the claimed side's near-zero
// 0.1) — meant to visibly cover the claimant country's whole area, not
// just outline it — so "claims" and "is claimed by" read as distinct facts
// at a glance, not the same treatment pointed two directions. Both sides
// share the dashed-border language (still the general "flagged, not
// primary-selected" cue), plus a pulsing labeled marker here specifically
// so "why is this whole country highlighted" never depends on already
// knowing what the blue means.
const CLAIMANT_COLOR = HIGHLIGHT_COLORS.claimant.hex
const CLAIMANT_BORDER_RADIUS = GLOBE_RADIUS * 1.006
const CLAIMANT_FILL_RADIUS = GLOBE_RADIUS * 1.0
const CLAIMANT_FILL_SCALE = 1.004
const CLAIMANT_FILL_OPACITY = 0.32

function useClaimantCountryIds(): Set<string> {
  const { selected } = useSelection()

  return useMemo(() => {
    const ids = new Set<string>()
    if (!selected || selected.entity.kind !== 'geo-entity') return ids
    const geoEntity = selected.entity.data as GeoEntity
    for (const relation of geoEntity.claimedBy) {
      if (relation.ref?.type === 'country') ids.add(relation.ref.id)
    }
    return ids
  }, [selected])
}

interface ClaimantCountryEntry {
  id: string
  name: string
  centroid: { lat: number; lng: number }
  borderGeometry: BufferGeometry
  fillGeometry: BufferGeometry | null
}

function ClaimantMarker({ name, centroid }: { name: string; centroid: { lat: number; lng: number } }) {
  const dotRef = useRef<Mesh>(null)

  useFrame(({ clock }) => {
    if (!dotRef.current) return
    const t = clock.getElapsedTime()
    dotRef.current.scale.setScalar(1 + Math.sin(t * 2.4) * 0.2)
  })

  // Same pointed-callout convention as CapitalMarker/HoverLabel — a marker
  // on the country itself, a leader line out to an explicit text label, so
  // "why is this highlighted" never depends on the viewer already knowing
  // what CLAIMANT_COLOR means (the point of also having hud/LegendPanel.tsx,
  // but a label on the globe itself needs no lookup at all).
  const anchor = latLngToVector3(centroid.lat, centroid.lng, GLOBE_RADIUS * 1.01)
  const calloutPoint = latLngToVector3(centroid.lat - 10, centroid.lng + 10, GLOBE_RADIUS * 1.32)

  return (
    <group>
      <mesh ref={dotRef} position={anchor}>
        <sphereGeometry args={[0.014, 10, 10]} />
        <meshBasicMaterial color={CLAIMANT_COLOR} />
      </mesh>
      <Line points={[anchor, calloutPoint]} color={CLAIMANT_COLOR} lineWidth={1} transparent opacity={0.85} />
      <Html position={calloutPoint} center distanceFactor={8} zIndexRange={[18, 0]} style={{ pointerEvents: 'none' }}>
        <div
          className="whitespace-nowrap font-mono text-[9px] tracking-[0.2em]"
          style={{ color: CLAIMANT_COLOR, textShadow: `0 0 6px ${CLAIMANT_COLOR}` }}
        >
          CLAIMANT — {name.toUpperCase()}
        </div>
      </Html>
    </group>
  )
}

function ClaimantCountriesOverlay({ countryIds }: { countryIds: Set<string> }) {
  const features = useCountryFeatures()

  const claimants = useMemo<ClaimantCountryEntry[]>(() => {
    if (countryIds.size === 0) return []
    return features.flatMap((f) => {
      const id = f.id !== undefined && f.id !== null ? String(f.id) : undefined
      if (!id || !countryIds.has(id)) return []

      const borderGeometry = new BufferGeometry()
      borderGeometry.setAttribute(
        'position',
        new Float32BufferAttribute(geometryToBorderSegments(f.geometry, CLAIMANT_BORDER_RADIUS), 3)
      )
      computeLineDistances(borderGeometry)

      return [
        {
          id,
          name: (f.properties?.name as string) ?? 'Unknown',
          centroid: geometryToCentroid(f.geometry),
          borderGeometry,
          fillGeometry: geometryToFillMesh(f.geometry, CLAIMANT_FILL_RADIUS),
        },
      ]
    })
  }, [features, countryIds])

  if (claimants.length === 0) return null

  return (
    <group>
      {claimants.map((claimant) => (
        <group key={`claimant-${claimant.id}`}>
          <lineSegments geometry={claimant.borderGeometry}>
            <lineDashedMaterial color={CLAIMANT_COLOR} dashSize={DASH_SIZE} gapSize={GAP_SIZE} transparent opacity={0.95} />
          </lineSegments>
          {claimant.fillGeometry && (
            <mesh geometry={claimant.fillGeometry} scale={CLAIMANT_FILL_SCALE}>
              <meshBasicMaterial
                color={CLAIMANT_COLOR}
                transparent
                opacity={CLAIMANT_FILL_OPACITY}
                side={FrontSide}
                depthWrite={false}
              />
            </mesh>
          )}
          <ClaimantMarker name={claimant.name} centroid={claimant.centroid} />
        </group>
      ))}
    </group>
  )
}

function ClaimedGeoEntitiesOverlay({ entityIds }: { entityIds: Set<string> }) {
  const features = useGeoEntityFeatures()
  const entries = useMemo(() => buildGeoEntityEntries(features), [features])

  if (entityIds.size === 0) return null

  const claimed = entries.filter((entry) => entityIds.has(entry.entityId))
  if (claimed.length === 0) return null

  return (
    <group>
      {claimed.map((entry) => (
        <group key={`claims-overlay-${entry.geometryId}`}>
          <lineSegments geometry={entry.borderGeometry}>
            {/* dashSize/gapSize are in world units (GLOBE_RADIUS = 2.4) —
                requires the geometry's 'lineDistance' attribute, which
                geoEntityEntries.ts's computeLineDistances() already set. */}
            <lineDashedMaterial
              color={CLAIM_COLOR}
              dashSize={DASH_SIZE}
              gapSize={GAP_SIZE}
              transparent
              opacity={0.95}
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
              <meshBasicMaterial color={CLAIM_COLOR} transparent opacity={0.1} side={FrontSide} depthWrite={false} />
            </mesh>
          )}
        </group>
      ))}
    </group>
  )
}

// Renders both directions of the same relationship, on two different
// geometry systems: GeoEntity-vs-GeoEntity claims (dashed magenta, on
// GeoEntity geometry) and claimant countries (dashed blue + prominent fill
// + labeled marker, on Country geometry) — see ClaimantCountriesOverlay's
// comment above for why a Country needs an entirely separate render path
// here. Selecting China shows Taiwan/Spratly/Scarborough via the first;
// selecting Taiwan shows China via the second.
export function ClaimsOverlayComponent() {
  const claimRelatedEntityIds = useClaimRelatedEntityIds()
  const claimantCountryIds = useClaimantCountryIds()

  return (
    <group>
      <ClaimedGeoEntitiesOverlay entityIds={claimRelatedEntityIds} />
      <ClaimantCountriesOverlay countryIds={claimantCountryIds} />
    </group>
  )
}

registerLayer({
  id: 'claims-overlay',
  label: 'CLAIMS OVERLAY',
  description:
    'Highlights entities claimed by the current selection (dashed outline) and, when a claimed entity is selected, the country claiming it (solid outline + marker).',
  category: 'geopolitical',
  defaultEnabled: true,
  component: ClaimsOverlayComponent,
})
