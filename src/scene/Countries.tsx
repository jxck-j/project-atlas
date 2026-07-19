import { useEffect, useMemo, useRef, useState } from 'react'
import { useThree, type ThreeEvent } from '@react-three/fiber'
import { Html, Line } from '@react-three/drei'
import { BufferGeometry, Float32BufferAttribute, FrontSide, type Mesh } from 'three'
import { useCountryFeatures } from './useCountryFeatures'
import {
  geometryToAngularExtent,
  geometryToBorderSegments,
  geometryToCentroid,
  geometryToFillMesh,
} from './countryGeometry'
import { latLngToVector3 } from '../utils/geo'
import { GLOBE_RADIUS } from './constants'
import { selectCountry, useSelection } from '../hud/selectionStore'

const BORDER_RADIUS = GLOBE_RADIUS * 1.004
// Well clear of the core sphere (0.98*RADIUS in Globe.tsx) to leave room
// against z-fighting now that there's much denser 193-country geometry.
const FILL_RADIUS = GLOBE_RADIUS * 1.0

const COLOR_DEFAULT = '#7FE9FF'
const COLOR_HOVER = '#FFD24C' // golden yellow
const COLOR_SELECTED = '#FF4D4D' // red

// How far (in screen pixels) the pointer may move between down/up and still
// count as a "click" rather than a drag-to-rotate gesture.
const CLICK_MOVE_THRESHOLD = 6

// Angular bounding-box extent (degrees) above which a country gets an inline
// hover label instead of a leader-line callout. The median country is ~6.4°
// (e.g. Ghana); the smallest are sub-2° (Qatar, Luxembourg) — 7° comfortably
// separates "big enough to label in place" from "needs a pointer".
const LARGE_COUNTRY_THRESHOLD_DEG = 7

interface CountryEntry {
  id: string
  name: string
  centroid: { lat: number; lng: number }
  angularExtent: number
  // One merged geometry per country (not one per ring/polygon) — see
  // countryGeometry.ts's geometryToBorderSegments/geometryToFillMesh for
  // why: 193 countries times several islands/holes each turns into
  // thousands of draw calls if each ring or polygon gets its own mesh/line.
  borderGeometry: BufferGeometry
  fillGeometry: BufferGeometry | null
}

// Hover label: large countries get an inline name at their centroid; small
// countries get a leader-line callout (a radial line out to the label),
// matching atlas annotation conventions for tiny nations.
function HoverLabel({ country }: { country: CountryEntry }) {
  const isLarge = country.angularExtent >= LARGE_COUNTRY_THRESHOLD_DEG

  const anchor = useMemo(
    () => latLngToVector3(country.centroid.lat, country.centroid.lng, GLOBE_RADIUS * 1.006),
    [country.centroid]
  )
  const calloutPoint = useMemo(
    () => latLngToVector3(country.centroid.lat, country.centroid.lng, GLOBE_RADIUS * 1.35),
    [country.centroid]
  )

  if (isLarge) {
    return (
      <Html position={anchor} center distanceFactor={8} zIndexRange={[20, 0]} style={{ pointerEvents: 'none' }}>
        <div
          className="whitespace-nowrap font-mono text-xs tracking-[0.2em] text-amber-200"
          style={{ textShadow: '0 0 8px rgba(255,210,76,0.85)' }}
        >
          {country.name.toUpperCase()}
        </div>
      </Html>
    )
  }

  return (
    <group>
      <Line points={[anchor, calloutPoint]} color="#FFD24C" lineWidth={1} transparent opacity={0.85} />
      <mesh position={anchor}>
        <sphereGeometry args={[0.01, 8, 8]} />
        <meshBasicMaterial color="#FFD24C" />
      </mesh>
      <Html
        position={calloutPoint}
        center
        distanceFactor={8}
        zIndexRange={[20, 0]}
        style={{ pointerEvents: 'none' }}
      >
        <div
          className="whitespace-nowrap font-mono text-xs tracking-[0.2em] text-amber-200"
          style={{ textShadow: '0 0 8px rgba(255,210,76,0.85)' }}
        >
          {country.name.toUpperCase()}
        </div>
      </Html>
    </group>
  )
}

export function Countries() {
  const features = useCountryFeatures()
  const { gl } = useThree()
  const { selected } = useSelection()
  const [hoveredId, setHoveredId] = useState<string | null>(null)
  const dragStart = useRef<{ x: number; y: number } | null>(null)

  // Track where a pointer-down started (in screen space) so a drag-to-rotate
  // gesture over a country doesn't get misread as a click-to-select.
  useEffect(() => {
    const onDown = (e: PointerEvent) => {
      dragStart.current = { x: e.clientX, y: e.clientY }
    }
    window.addEventListener('pointerdown', onDown)
    return () => window.removeEventListener('pointerdown', onDown)
  }, [])

  // Reflect hover state as a cursor change on the canvas itself.
  useEffect(() => {
    gl.domElement.style.cursor = hoveredId ? 'pointer' : 'auto'
  }, [gl, hoveredId])

  const countries = useMemo<CountryEntry[]>(() => {
    return features.map((f, index) => {
      const borderGeometry = new BufferGeometry()
      borderGeometry.setAttribute(
        'position',
        new Float32BufferAttribute(geometryToBorderSegments(f.geometry, BORDER_RADIUS), 3)
      )

      return {
        // A handful of disputed territories (Kosovo, N. Cyprus, Somaliland)
        // have no numeric feature id in this topology, so `f.id` is
        // undefined for all of them — falling back to just String(f.id)
        // would give them all the same id "undefined" and make them select
        // and highlight as one. The array index is always unique.
        id: f.id !== undefined && f.id !== null ? String(f.id) : `feature-${index}`,
        name: (f.properties?.name as string) ?? 'Unknown',
        centroid: geometryToCentroid(f.geometry),
        angularExtent: geometryToAngularExtent(f.geometry),
        borderGeometry,
        fillGeometry: geometryToFillMesh(f.geometry, FILL_RADIUS),
      }
    })
  }, [features])

  const hoveredCountry = hoveredId ? countries.find((c) => c.id === hoveredId) : undefined
  const selectedCountry = selected ? countries.find((c) => c.id === selected.id) : undefined

  function handlePointerUp(country: CountryEntry, e: ThreeEvent<PointerEvent>) {
    e.stopPropagation()
    const start = dragStart.current
    if (start) {
      const dx = e.nativeEvent.clientX - start.x
      const dy = e.nativeEvent.clientY - start.y
      if (Math.hypot(dx, dy) > CLICK_MOVE_THRESHOLD) return // was a drag, not a click
    }

    // Use the clicked mesh's CURRENT world matrix so the direction is
    // correct even while the globe is mid-rotation at the moment of click.
    const localCentroid = latLngToVector3(country.centroid.lat, country.centroid.lng, FILL_RADIUS)
    const worldPoint = (e.object as Mesh).localToWorld(localCentroid.clone())
    const direction = worldPoint.normalize()

    selectCountry({ id: country.id, name: country.name, direction })
    // Temporary console visibility during development.
    console.log(country.name)
  }

  return (
    <group>
      {countries.map((country) => {
        const isSelected = selected?.id === country.id
        const isHovered = hoveredId === country.id
        const isDimmed = selected != null && !isSelected

        const color = isSelected ? COLOR_SELECTED : isHovered ? COLOR_HOVER : COLOR_DEFAULT
        // A faint always-on land tint (distinct from the hover/select fill)
        // so landmasses read against open ocean even at rest.
        const fillOpacity = isSelected ? 0.24 : isHovered ? 0.16 : isDimmed ? 0.02 : 0.05
        const lineOpacity = isDimmed ? 0.12 : isSelected || isHovered ? 0.95 : 0.55

        return (
          <group key={country.id}>
            {/* Native LineBasicMaterial ignores `linewidth` on effectively
                every platform (WebGL caps it to 1px) — the hover/select
                emphasis that used to come from a thicker line now relies on
                color + opacity alone. The tradeoff for going from one fat
                <Line> per ring to one thin lineSegments per country: ~3600
                draw calls became 193. */}
            <lineSegments geometry={country.borderGeometry}>
              <lineBasicMaterial color={color} transparent opacity={lineOpacity} />
            </lineSegments>
            {country.fillGeometry && (
              <mesh
                geometry={country.fillGeometry}
                onPointerOver={(e) => {
                  e.stopPropagation()
                  setHoveredId(country.id)
                }}
                onPointerOut={(e) => {
                  e.stopPropagation()
                  setHoveredId((current) => (current === country.id ? null : current))
                }}
                onPointerUp={(e) => handlePointerUp(country, e)}
                // Stops a double-click on a country from falling through to
                // the core sphere's "reset to global view" handler — that
                // should only fire on empty ocean, not on a country.
                onDoubleClick={(e) => e.stopPropagation()}
              >
                <meshBasicMaterial
                  color={color}
                  transparent
                  opacity={fillOpacity}
                  // FrontSide (not DoubleSide) so a pointer ray can't pass
                  // through a gap on the near hemisphere and hit a country's
                  // back-facing triangles on the far side of the globe.
                  side={FrontSide}
                  depthWrite={false}
                  // Nudges this layer's depth forward of the core sphere
                  // sitting right underneath it, to avoid z-fighting flicker.
                  polygonOffset
                  polygonOffsetFactor={-1}
                  polygonOffsetUnits={-1}
                />
              </mesh>
            )}
          </group>
        )
      })}
      {selectedCountry && <HoverLabel key={`selected-${selectedCountry.id}`} country={selectedCountry} />}
      {hoveredCountry && hoveredCountry.id !== selectedCountry?.id && (
        <HoverLabel key={`hovered-${hoveredCountry.id}`} country={hoveredCountry} />
      )}
    </group>
  )
}
