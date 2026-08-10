import { useMemo, useRef, useState } from 'react'
import { invalidate, useFrame, useThree } from '@react-three/fiber'
import { Html } from '@react-three/drei'
import { BackSide, FrontSide, Group, Vector3 } from 'three'
import { COUNTRY_PROFILES } from '../data/countryProfiles'
import { WATER_BODIES, type WaterBody } from '../data/waterBodies'
import { latLngToVector3, vector3ToLatLng } from '../utils/geo'
import { AtmosphereMaterial } from './AtmosphereMaterial'
import { Countries } from './Countries'
import { GeoEntities } from './GeoEntities'
import { PointerMarker } from './PointerMarker'
import { UsCityOutlineHighlight } from './UsCityOutlineHighlight'
import { UsCityLabels } from './UsCityLabels'
import { CountryLabels } from './CountryLabels'
import { LayerEngine } from '../layers'
import { GLOBE_RADIUS as RADIUS } from './constants'
import { coreSphereRef } from './coreSphereRef'
import { getGlobeRotationY, setGlobeRotationY } from './globeRotation'
import { isCandidateVisible } from './labelDeclutter'
import { resetView, useSelection } from '../hud/selectionStore'
import { publishTelemetry } from '../hud/telemetryStore'
import { useCameraSettings } from '../hud/settingsStore'

// Camera distance below which the smaller seas/gulfs/straits reveal
// themselves. Above it (the default overview distance is ~6.5) only the 5
// ocean labels show, so the globe doesn't open with 25+ labels crowding it.
const SEA_LABEL_REVEAL_DISTANCE = 4.5

// Matches Globe.tsx's own core sphere (see below) — same constant every
// other analytic front/back-of-globe check in this codebase (CountryLabels.tsx,
// Lakes.tsx) anchors to.
const WATER_LABEL_OCCLUDER_RADIUS = RADIUS * 0.98
const WATER_LABEL_CHECK_INTERVAL_MS = 100
const Y_AXIS = new Vector3(0, 1, 0)

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

interface WaterLabelEntry {
  body: WaterBody
  localPosition: Vector3
}

// Static labels for oceans, seas, gulfs, straits, and bays — hidden once a
// country is selected so they don't clutter the focused view.
//
// 2026-08-09: previously hid far-side labels via Html's raycast-based
// `occlude` prop against the core sphere ref — reported as never actually
// hiding anything in practice (a far-side ocean name stayed visible "through"
// the globe at every zoom level and camera angle, not just near the
// terminator). Replaced with the same analytic dot-product front/back-of-
// globe test CountryLabels.tsx and Lakes.tsx already use
// (labelDeclutter.ts's `isCandidateVisible`) instead of chasing why the
// raycast approach was unreliable — this app had already solved "is this
// point on the near or far hemisphere" once, correctly, and WaterLabels was
// the one holdout still using a different (and broken) mechanism for it.
// Requires the same rotationY compensation CountryLabels.tsx applies: these
// labels live inside Globe.tsx's ambient-rotation group, so a label's
// current *world* position (what the camera-relative math needs) is its
// static local position rotated by the globe's current spin, not the local
// position itself.
//
// Only the 5 oceans show at the default overview distance — the smaller
// seas/gulfs/straits stay hidden until the camera zooms in past
// SEA_LABEL_REVEAL_DISTANCE, so the globe doesn't open with 27 labels
// competing for attention.
function WaterLabels() {
  const { selected } = useSelection()
  const { camera, size } = useThree()
  const [showSeas, setShowSeas] = useState(false)
  const [visibleNames, setVisibleNames] = useState<Set<string>>(new Set())
  const hasRun = useRef(false)
  const lastRun = useRef(0)

  const entries = useMemo<WaterLabelEntry[]>(
    () => WATER_BODIES.map((body) => ({ body, localPosition: latLngToVector3(body.lat, body.lng, RADIUS * 1.002) })),
    []
  )

  useFrame((state) => {
    const close = camera.position.length() < SEA_LABEL_REVEAL_DISTANCE
    if (close !== showSeas) setShowSeas(close)

    const now = state.clock.elapsedTime * 1000
    // `hasRun` (not just comparing `now` to the interval) guarantees the very
    // first frame after mount always runs this check regardless of what
    // elapsedTime happens to already be — otherwise a mount that lands after
    // elapsedTime has already passed WATER_LABEL_CHECK_INTERVAL_MS would
    // never get a first check at all under frameloop="demand" unless
    // something else keeps invalidating.
    if (hasRun.current && now - lastRun.current < WATER_LABEL_CHECK_INTERVAL_MS) return
    hasRun.current = true
    lastRun.current = now

    if (selected) {
      if (visibleNames.size > 0) setVisibleNames(new Set())
      return
    }

    const rotationY = getGlobeRotationY()
    const next = new Set<string>()
    for (const { body, localPosition } of entries) {
      if (body.kind !== 'ocean' && !close) continue
      const worldPosition = localPosition.clone().applyAxisAngle(Y_AXIS, rotationY)
      if (isCandidateVisible(worldPosition, camera, size.width, size.height, WATER_LABEL_OCCLUDER_RADIUS)) {
        next.add(body.name)
      }
    }

    const changed =
      next.size !== visibleNames.size || [...next].some((name) => !visibleNames.has(name))
    if (changed) setVisibleNames(next)
  })

  if (selected) return null

  return (
    <group>
      {entries
        .filter(({ body }) => visibleNames.has(body.name))
        .map(({ body, localPosition }) => (
          <Html
            key={body.name}
            position={localPosition}
            center
            distanceFactor={8}
            zIndexRange={[1, 0]}
            style={{ pointerEvents: 'none' }}
          >
            <div
              className={`whitespace-nowrap italic text-cyan-300/35 ${
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
  // Not a local useRef — see coreSphereRef.ts. Layer Engine-mounted
  // components (scene/Lakes.tsx, scene/Rivers.tsx) aren't direct children of
  // Globe.tsx, so they can't receive this via props; importing the same
  // shared ref object is what lets them occlude their own Html labels
  // against the core sphere.
  const { selected } = useSelection()
  const { ambientRotationEnabled } = useCameraSettings()

  // Slow ambient self-rotation of the data layers (independent of camera
  // orbit — see scene/CameraControls.tsx's separate OrbitControls.autoRotate,
  // which orbits the *camera* rather than spinning this group). Gated on
  // the persistent ambientRotationEnabled setting (T key, settingsStore.ts)
  // rather than always-on; still frozen while a country/entity is selected
  // so the focused thing doesn't drift out from under the camera even with
  // the setting on.
  //
  // Phase 2 (Plan.md): this mutates `groupRef.current.rotation` directly
  // rather than through a JSX prop, so R3F's demand-mode reconciler never
  // sees it change and never auto-invalidates — unlike Countries.tsx's
  // color/opacity props, which DO flow through JSX and get this for free.
  // Calling invalidate() ourselves, only in the branch that actually
  // rotated, is what keeps this a self-sustaining loop (each rendered frame
  // requests the next one) instead of freezing after a single tick.
  useFrame((_, delta) => {
    if (!groupRef.current) return
    if (ambientRotationEnabled && !selected) {
      groupRef.current.rotation.y += delta * 0.03
      invalidate()
    }
    setGlobeRotationY(groupRef.current.rotation.y)
  })

  return (
    <group ref={groupRef}>
      {/* Core sphere: always fully opaque, pitch black — represents the
          ocean/every non-land patch of the globe. Also the "empty ocean"
          double-click target — country meshes sit in front of it and stop
          the event from reaching here, so this only fires where there's no
          country underneath the cursor. */}
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
          color="#000000"
          side={FrontSide}
          // Country fill sits only ~0.02*RADIUS above this — polygonOffset
          // pushes this sphere's depth back a hair so it doesn't z-fight
          // with the fill layer at grazing camera angles.
          polygonOffset
          polygonOffsetFactor={1}
          polygonOffsetUnits={1}
        />
      </mesh>

      <Countries />
      <GeoEntities />
      <CapitalMarker />
      <CountryLabels />
      <UsCityOutlineHighlight />
      <UsCityLabels />
      <WaterLabels />
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
