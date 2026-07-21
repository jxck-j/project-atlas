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
// v3.1.5: also renders a GeoEntity's *administering parent*, not just its
// claimants — reported as a real gap (Curaçao selected, Netherlands not
// highlighted) after this file only ever looked at `claimedBy`. Kept in
// this same file/layer rather than split into ParentOverlayLayer.tsx: from
// a viewer's perspective "which country is connected to what I selected"
// is one mechanism (fetch Country geometry, dashed border + fill +
// marker), reused for two relationship kinds — see the RELATED_COUNTRY_*
// section below and LOGBOOK.md's v3.1.5 entry.
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
// Related countries — the other direction of the same relationships.
// Countries.tsx renders on completely different geometry (its own
// useCountryFeatures() fetch, not the GeoEntity topology above), so "Taiwan
// is claimed by China" (and, v3.1.5, "Curaçao's parent is the Netherlands")
// need their own small render path here: the GeoEntity side already gets
// the dashed CLAIM_COLOR treatment above when a claimant COUNTRY is
// selected, but when the GeoEntity itself is selected there was previously
// nothing at all pointing at the connected country — a Country is never
// itself a GeoEntity entry, so useClaimRelatedEntityIds' `ref.type ===
// 'geo-entity'` filter silently drops every country-typed relation.
// `Country` has no `claimedBy`/`parentEntity` field of its own (see
// data/types.ts) — a selected Country can therefore never itself have a
// "related country"; this only ever fires for a selected GeoEntity.
//
// v3.1.0 built this for `claimedBy` only ("claimant countries"); v3.1.5
// widened it to also cover `parentEntity` after a real gap report: Curaçao
// selected, Netherlands not highlighted, because a parent relationship
// isn't a claim and the layer only ever looked at `claimedBy`. Both roles
// share one color/one mechanism — from the viewer's perspective "which
// country is connected to what I selected" is one question, whether the
// answer is "administers it" or "claims it" — and the marker's label text
// (PARENT vs. CLAIMANT, or both if a future entry somehow has both) is what
// actually distinguishes them, not a second color to memorize. See
// data/types.ts's GeoEntity doc comment for why `parentEntity` and
// `claimedBy` are separate fields in the first place (an uncontroversial
// dependency isn't "disputed," so modeling it via the claim fields would
// misrepresent it) — that distinction stays intact in the data; it just
// doesn't need a second render color on top of it.
//
// Deliberately a different color from the claimed side (blue, not magenta)
// plus a prominent fill (0.32, well above the claimed side's near-zero
// 0.1) — meant to visibly cover the related country's whole area, not
// just outline it — so "claims/is administered by" and "is claimed by"
// read as distinct facts at a glance, not the same treatment pointed two
// directions. Both sides share the dashed-border language (still the
// general "flagged, not primary-selected" cue), plus a pulsing labeled
// marker here specifically so "why is this whole country highlighted"
// never depends on already knowing what the blue means.
const RELATED_COUNTRY_COLOR = HIGHLIGHT_COLORS.relatedCountry.hex
const RELATED_COUNTRY_BORDER_RADIUS = GLOBE_RADIUS * 1.006
const RELATED_COUNTRY_FILL_RADIUS = GLOBE_RADIUS * 1.0
const RELATED_COUNTRY_FILL_SCALE = 1.004
const RELATED_COUNTRY_FILL_OPACITY = 0.32

type RelatedCountryRole = 'parent' | 'claimant'

/** Every country connected to the selected GeoEntity, and how (parent, claimant, or — rare, but possible — both). */
function useRelatedCountryRoles(): Map<string, Set<RelatedCountryRole>> {
  const { selected } = useSelection()

  return useMemo(() => {
    const roles = new Map<string, Set<RelatedCountryRole>>()
    if (!selected || selected.entity.kind !== 'geo-entity') return roles

    function addRole(countryId: string, role: RelatedCountryRole) {
      const existing = roles.get(countryId) ?? new Set<RelatedCountryRole>()
      existing.add(role)
      roles.set(countryId, existing)
    }

    const geoEntity = selected.entity.data as GeoEntity
    if (geoEntity.parentEntity?.ref?.type === 'country') {
      addRole(geoEntity.parentEntity.ref.id, 'parent')
    }
    for (const relation of geoEntity.claimedBy) {
      if (relation.ref?.type === 'country') addRole(relation.ref.id, 'claimant')
    }
    return roles
  }, [selected])
}

interface RelatedCountryEntry {
  id: string
  name: string
  roles: Set<RelatedCountryRole>
  centroid: { lat: number; lng: number }
  borderGeometry: BufferGeometry
  fillGeometry: BufferGeometry | null
}

const ROLE_LABEL: Record<RelatedCountryRole, string> = {
  parent: 'PARENT',
  claimant: 'CLAIMANT',
}

function RelatedCountryMarker({
  name,
  roles,
  centroid,
}: {
  name: string
  roles: Set<RelatedCountryRole>
  centroid: { lat: number; lng: number }
}) {
  const dotRef = useRef<Mesh>(null)

  useFrame(({ clock }) => {
    if (!dotRef.current) return
    const t = clock.getElapsedTime()
    dotRef.current.scale.setScalar(1 + Math.sin(t * 2.4) * 0.2)
  })

  // Same pointed-callout convention as CapitalMarker/HoverLabel — a marker
  // on the country itself, a leader line out to an explicit text label, so
  // "why is this highlighted" never depends on the viewer already knowing
  // what RELATED_COUNTRY_COLOR means (the point of also having
  // hud/LegendPanel.tsx, but a label on the globe itself needs no lookup at
  // all) — and the role(s) in the label are what distinguish "administers
  // this" from "claims this," since the color alone doesn't.
  const anchor = latLngToVector3(centroid.lat, centroid.lng, GLOBE_RADIUS * 1.01)
  const calloutPoint = latLngToVector3(centroid.lat - 10, centroid.lng + 10, GLOBE_RADIUS * 1.32)
  const roleLabel = Array.from(roles)
    .map((role) => ROLE_LABEL[role])
    .join(' & ')

  return (
    <group>
      <mesh ref={dotRef} position={anchor}>
        <sphereGeometry args={[0.014, 10, 10]} />
        <meshBasicMaterial color={RELATED_COUNTRY_COLOR} />
      </mesh>
      <Line points={[anchor, calloutPoint]} color={RELATED_COUNTRY_COLOR} lineWidth={1} transparent opacity={0.85} />
      <Html position={calloutPoint} center distanceFactor={8} zIndexRange={[18, 0]} style={{ pointerEvents: 'none' }}>
        <div
          className="whitespace-nowrap font-mono text-[9px] tracking-[0.2em]"
          style={{ color: RELATED_COUNTRY_COLOR, textShadow: `0 0 6px ${RELATED_COUNTRY_COLOR}` }}
        >
          {roleLabel} — {name.toUpperCase()}
        </div>
      </Html>
    </group>
  )
}

function RelatedCountriesOverlay({ countryRoles }: { countryRoles: Map<string, Set<RelatedCountryRole>> }) {
  const features = useCountryFeatures()

  const related = useMemo<RelatedCountryEntry[]>(() => {
    if (countryRoles.size === 0) return []
    return features.flatMap((f) => {
      const id = f.id !== undefined && f.id !== null ? String(f.id) : undefined
      const roles = id ? countryRoles.get(id) : undefined
      if (!id || !roles) return []

      const borderGeometry = new BufferGeometry()
      borderGeometry.setAttribute(
        'position',
        new Float32BufferAttribute(geometryToBorderSegments(f.geometry, RELATED_COUNTRY_BORDER_RADIUS), 3)
      )
      computeLineDistances(borderGeometry)

      return [
        {
          id,
          name: (f.properties?.name as string) ?? 'Unknown',
          roles,
          centroid: geometryToCentroid(f.geometry),
          borderGeometry,
          fillGeometry: geometryToFillMesh(f.geometry, RELATED_COUNTRY_FILL_RADIUS),
        },
      ]
    })
  }, [features, countryRoles])

  if (related.length === 0) return null

  return (
    <group>
      {related.map((country) => (
        <group key={`related-country-${country.id}`}>
          <lineSegments geometry={country.borderGeometry}>
            <lineDashedMaterial
              color={RELATED_COUNTRY_COLOR}
              dashSize={DASH_SIZE}
              gapSize={GAP_SIZE}
              transparent
              opacity={0.95}
            />
          </lineSegments>
          {country.fillGeometry && (
            <mesh geometry={country.fillGeometry} scale={RELATED_COUNTRY_FILL_SCALE}>
              <meshBasicMaterial
                color={RELATED_COUNTRY_COLOR}
                transparent
                opacity={RELATED_COUNTRY_FILL_OPACITY}
                side={FrontSide}
                depthWrite={false}
              />
            </mesh>
          )}
          <RelatedCountryMarker name={country.name} roles={country.roles} centroid={country.centroid} />
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

// Renders both directions of these relationships, on two different geometry
// systems: GeoEntity-vs-GeoEntity claims (dashed magenta, on GeoEntity
// geometry) and related countries — parents and claimants alike (dashed
// blue + prominent fill + labeled marker, on Country geometry) — see
// RelatedCountriesOverlay's comment above for why a Country needs an
// entirely separate render path here. Selecting China shows
// Taiwan/Spratly/Scarborough via the first; selecting Taiwan or Curaçao
// shows China or the Netherlands, respectively, via the second.
export function ClaimsOverlayComponent() {
  const claimRelatedEntityIds = useClaimRelatedEntityIds()
  const relatedCountryRoles = useRelatedCountryRoles()

  return (
    <group>
      <ClaimedGeoEntitiesOverlay entityIds={claimRelatedEntityIds} />
      <RelatedCountriesOverlay countryRoles={relatedCountryRoles} />
    </group>
  )
}

registerLayer({
  id: 'claims-overlay',
  label: 'RELATIONSHIPS OVERLAY',
  description:
    'Highlights entities claimed by the current selection (dashed outline) and, when a GeoEntity is selected, the country administering or claiming it (dashed outline + fill + marker).',
  category: 'geopolitical',
  defaultEnabled: true,
  component: ClaimsOverlayComponent,
})
