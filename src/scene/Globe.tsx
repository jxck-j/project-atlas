import { useMemo, useRef, useState } from 'react'
import type { RefObject } from 'react'
import { useFrame, useThree } from '@react-three/fiber'
import { Html, Line } from '@react-three/drei'
import { BackSide, FrontSide, Group, type Mesh, type Object3D } from 'three'
import { COUNTRY_PROFILES } from '../data/countryProfiles'
import { WATER_BODIES } from '../data/waterBodies'
import { latLngPathToPoints, latLngToVector3, vector3ToLatLng } from '../utils/geo'
import { AtmosphereMaterial } from './AtmosphereMaterial'
import { Countries } from './Countries'
import { GeoEntities } from './GeoEntities'
import { PointerMarker } from './PointerMarker'
import { UsCityOutlineHighlight } from './UsCityOutlineHighlight'
import { UsCityLabels } from './UsCityLabels'
import { CountryLabels } from './CountryLabels'
import { LayerEngine } from '../layers'
import { GLOBE_RADIUS as RADIUS } from './constants'
import { setGlobeRotationY } from './globeRotation'
import { resetView, useSelection } from '../hud/selectionStore'
import { publishTelemetry } from '../hud/telemetryStore'
import { useCameraSettings } from '../hud/settingsStore'

// Camera distance below which the smaller seas/gulfs/straits reveal
// themselves. Above it (the default overview distance is ~6.5) only the 5
// ocean labels show, so the globe doesn't open with 25+ labels crowding it.
const SEA_LABEL_REVEAL_DISTANCE = 4.5

function GraticuleGrid() {
  // Latitude rings
  const latLines = useMemo(() => {
    const lines: [number, number][][] = []
    for (let lat = -60; lat <= 60; lat += 20) {
      const ring: [number, number][] = []
      for (let lng = -180; lng <= 180; lng += 5) ring.push([lat, lng])
      lines.push(ring)
    }
    return lines
  }, [])

  // Longitude rings
  const lngLines = useMemo(() => {
    const lines: [number, number][][] = []
    for (let lng = -180; lng < 180; lng += 20) {
      const ring: [number, number][] = []
      for (let lat = -90; lat <= 90; lat += 5) ring.push([lat, lng])
      lines.push(ring)
    }
    return lines
  }, [])

  return (
    <group>
      {latLines.map((ring, i) => (
        <Line
          key={`lat-${i}`}
          points={latLngPathToPoints(ring, RADIUS)}
          color="#2E7A93"
          lineWidth={0.6}
          transparent
          opacity={0.25}
        />
      ))}
      {lngLines.map((ring, i) => (
        <Line
          key={`lng-${i}`}
          points={latLngPathToPoints(ring, RADIUS)}
          color="#2E7A93"
          lineWidth={0.6}
          transparent
          opacity={0.25}
        />
      ))}
    </group>
  )
}

const CAPITAL_MARKER_COLOR = '#FF8A3D'

// Marker for the currently selected country's capital — only rendered while
// a country with known profile data is selected (see selectionStore).
// Gated on entity.kind === 'country' specifically (not just "does
// COUNTRY_PROFILES have a key matching selected.name"): COUNTRY_PROFILES
// has entries for a few non-UN-member places name-shared with a registered
// Territory (e.g. "Taiwan"), so a name-only lookup would show that
// country's capital marker for an unrelated Territory selection once
// territories became independently selectable (v2.3.0) — see LOGBOOK.md.
//
// v3.3.0: renders via the shared scene/PointerMarker.tsx rather than its
// own bespoke dot+line+label — this marker (along with
// ClaimsOverlayLayer.tsx's related-country marker) was reported as too
// large and its callout swinging too far out, obscuring the view around
// small countries. See PointerMarker.tsx for the tuned sizing.
function CapitalMarker() {
  const { selected } = useSelection()
  const profile = selected?.entity.kind === 'country' ? COUNTRY_PROFILES[selected.name] : undefined

  if (!profile) return null

  return (
    <PointerMarker
      lat={profile.capitalLat}
      lng={profile.capitalLng}
      color={CAPITAL_MARKER_COLOR}
      label={profile.capital.toUpperCase()}
    />
  )
}

// Static labels for oceans, seas, gulfs, straits, and bays — hidden once a
// country is selected so they don't clutter the focused view. `occlude`
// against just the core sphere (not the whole scene) hides a label when
// it's on the far side of the globe — occluding against the whole scene
// would also catch the atmosphere glow shells, which sit in front of every
// label regardless of which hemisphere it's on and would hide all of them,
// always.
//
// Only the 5 oceans show at the default overview distance — the smaller
// seas/gulfs/straits stay hidden until the camera zooms in past
// SEA_LABEL_REVEAL_DISTANCE, so the globe doesn't open with 27 labels
// competing for attention.
function WaterLabels({ occluder }: { occluder: RefObject<Mesh | null> }) {
  const { selected } = useSelection()
  const { camera } = useThree()
  const [showSeas, setShowSeas] = useState(false)

  useFrame(() => {
    const close = camera.position.length() < SEA_LABEL_REVEAL_DISTANCE
    if (close !== showSeas) setShowSeas(close)
  })

  if (selected) return null

  const bodies = showSeas ? WATER_BODIES : WATER_BODIES.filter((b) => b.kind === 'ocean')

  return (
    <group>
      {bodies.map((body) => (
        <Html
          key={body.name}
          position={latLngToVector3(body.lat, body.lng, RADIUS * 1.002)}
          center
          occlude={[occluder as RefObject<Object3D>]}
          distanceFactor={8}
          zIndexRange={[1, 0]}
          style={{ pointerEvents: 'none' }}
        >
          <div
            className={`whitespace-nowrap font-mono italic text-cyan-300/35 ${
              body.kind === 'ocean' ? 'text-[8px] tracking-[0.2em]' : 'text-[6px] tracking-[0.1em]'
            }`}
          >
            {body.name}
          </div>
        </Html>
      ))}
    </group>
  )
}

export function Globe() {
  const groupRef = useRef<Group>(null)
  const coreSphereRef = useRef<Mesh>(null)
  const { selected } = useSelection()
  const { ambientRotationEnabled } = useCameraSettings()

  // Slow ambient self-rotation of the data layers (independent of camera
  // orbit — see scene/CameraControls.tsx's separate OrbitControls.autoRotate,
  // which orbits the *camera* rather than spinning this group). Gated on
  // the persistent ambientRotationEnabled setting (T key, settingsStore.ts)
  // rather than always-on; still frozen while a country/entity is selected
  // so the focused thing doesn't drift out from under the camera even with
  // the setting on.
  useFrame((_, delta) => {
    if (!groupRef.current) return
    if (ambientRotationEnabled && !selected) {
      groupRef.current.rotation.y += delta * 0.03
    }
    setGlobeRotationY(groupRef.current.rotation.y)
  })

  return (
    <group ref={groupRef}>
      {/* Core sphere: slightly translucent "holographic" shell while idle,
          fully solid as soon as a country is selected. Also the "empty
          ocean" double-click target — country meshes sit in front of it and
          stop the event from reaching here, so this only fires where there's
          no country underneath the cursor. */}
      <mesh
        ref={coreSphereRef}
        onDoubleClick={(e) => {
          e.stopPropagation()
          resetView()
        }}
        onPointerMove={(e) => {
          const local = e.object.worldToLocal(e.point.clone())
          const { lat, lng } = vector3ToLatLng(local, RADIUS * 0.98)
          publishTelemetry({ hoverLat: lat, hoverLng: lng })
        }}
        onPointerOut={() => publishTelemetry({ hoverLat: null, hoverLng: null })}
      >
        <sphereGeometry args={[RADIUS * 0.98, 64, 64]} />
        <meshBasicMaterial
          color="#04141C"
          transparent={!selected}
          opacity={selected ? 1 : 0.35}
          side={FrontSide}
          // Country fill sits only ~0.02*RADIUS above this — polygonOffset
          // pushes this sphere's depth back a hair so it doesn't z-fight
          // with the fill layer at grazing camera angles.
          polygonOffset
          polygonOffsetFactor={1}
          polygonOffsetUnits={1}
        />
      </mesh>

      <GraticuleGrid />
      <Countries />
      <GeoEntities />
      <CapitalMarker />
      <CountryLabels />
      <UsCityOutlineHighlight />
      <UsCityLabels />
      <WaterLabels occluder={coreSphereRef} />
      <LayerEngine />

      {/* Inner glow */}
      <mesh>
        <sphereGeometry args={[RADIUS * 1.005, 64, 64]} />
        <AtmosphereMaterial color="#4CE0FF" intensity={0.18} power={7} side={FrontSide} />
      </mesh>

      {/* Outer atmosphere rim */}
      <mesh>
        <sphereGeometry args={[RADIUS * 1.02, 64, 64]} />
        <AtmosphereMaterial color="#4CE0FF" intensity={0.28} power={6} side={BackSide} />
      </mesh>
    </group>
  )
}

export { RADIUS }
