import { useMemo, useRef, useState } from 'react'
import { useFrame, useThree } from '@react-three/fiber'
import { Html } from '@react-three/drei'
import { Vector3 } from 'three'
import { useCanadaCitiesIndex, type CanadaCityIndexEntry } from './useCanadaCitiesIndex'
import { useSelection } from '../hud/selectionStore'
import { latLngToVector3 } from '../utils/geo'
import { getGlobeRotationY } from './globeRotation'
import { declutterLabels, isCandidateVisible, type DeclutterCandidate } from './labelDeclutter'
import { GLOBE_RADIUS } from './constants'
import { resolveDeepestLevel, type LodLevelId } from '../lod'

// Canadian counterpart to UsCityLabels.tsx — same Google-Maps-style
// progressive reveal, same LOD Engine ladder (shared, not a Canada-specific
// distance table — the LOD Engine's whole point is that its levels aren't
// tied to any one dataset), same declutter machinery. Population floors are
// reused as-is from the US tiers rather than re-tuned for Canada's smaller
// population scale: both countries share the same camera-distance ladder,
// and Canada's largest cities (Toronto ~2.8M, Montreal ~1.8M, Calgary
// ~1.3M) clear the existing tiers comfortably enough that a separate table
// wasn't judged worth the duplication yet — revisit if that reads wrong
// once actually seen in a browser (see BACKLOG.md).
const CITY_POPULATION_FLOOR: Partial<Record<LodLevelId, number>> = {
  'metro-areas': 700_000,
  'large-cities': 250_000,
  'medium-cities': 100_000,
  'small-cities': 30_000,
  'every-incorporated-city': 1,
}

function minScoreForDistance(distance: number): number {
  const level = resolveDeepestLevel(distance)
  return CITY_POPULATION_FLOOR[level.id] ?? Infinity
}

const LABEL_STYLE_TIERS: [minScore: number, className: string][] = [
  [700_000, 'text-[11px] font-semibold tracking-[0.05em] text-cyan-100/90'],
  [250_000, 'text-[9px] font-medium tracking-[0.04em] text-cyan-200/75'],
  [100_000, 'text-[8px] tracking-[0.03em] text-cyan-300/60'],
  [30_000, 'text-[7px] tracking-[0.02em] text-cyan-400/45'],
  [0, 'text-[6px] tracking-[0.02em] text-cyan-500/35'],
]

function labelClassName(population: number): string {
  for (const [minScore, className] of LABEL_STYLE_TIERS) {
    if (population >= minScore) return className
  }
  return LABEL_STYLE_TIERS[LABEL_STYLE_TIERS.length - 1][1]
}

const SPACING_RADIUS_TIERS: [minScore: number, radiusPx: number][] = [
  [700_000, 45],
  [250_000, 35],
  [100_000, 28],
  [30_000, 20],
  [0, 14],
]

function spacingRadiusForScore(population: number): number {
  for (const [minScore, radiusPx] of SPACING_RADIUS_TIERS) {
    if (population >= minScore) return radiusPx
  }
  return SPACING_RADIUS_TIERS[SPACING_RADIUS_TIERS.length - 1][1]
}

const Y_AXIS = new Vector3(0, 1, 0)
const OCCLUDER_RADIUS = GLOBE_RADIUS * 0.98
const MIN_LABEL_SPACING_PX = 70
const MAX_VISIBLE_LABELS = 120
const CANDIDATE_POOL_SIZE = 500
const DECLUTTER_INTERVAL_MS = 150

interface CityCandidate extends DeclutterCandidate {
  city: CanadaCityIndexEntry
  localPosition: Vector3
}

export function CanadaCityLabels() {
  const allCities = useCanadaCitiesIndex()
  // See UsCityLabels.tsx's matching comment — deliberately does NOT hide on
  // `selected`, only while an actual city outline (either country's) is in
  // focus.
  const { usCityOutline, caCityOutline } = useSelection()
  const { camera, size } = useThree()
  const [visible, setVisible] = useState<CityCandidate[]>([])
  const lastRun = useRef(0)

  const ranked = useMemo(() => [...allCities].sort((a, b) => b.population - a.population), [allCities])

  useFrame((state) => {
    const now = state.clock.elapsedTime * 1000
    if (now - lastRun.current < DECLUTTER_INTERVAL_MS) return
    lastRun.current = now

    if (usCityOutline || caCityOutline) {
      if (visible.length > 0) setVisible([])
      return
    }

    const cameraDistance = camera.position.length()
    const minScore = minScoreForDistance(cameraDistance)
    const rotationY = getGlobeRotationY()
    const candidates: CityCandidate[] = []
    for (const city of ranked) {
      if (city.population < minScore) break
      const localPosition = latLngToVector3(city.lat, city.lng, GLOBE_RADIUS * 1.002)
      const worldPosition = localPosition.clone().applyAxisAngle(Y_AXIS, rotationY)
      if (!isCandidateVisible(worldPosition, camera, size.width, size.height, OCCLUDER_RADIUS)) continue
      candidates.push({ id: city.id, worldPosition, localPosition, city, spacingRadiusPx: spacingRadiusForScore(city.population) })
      if (candidates.length >= CANDIDATE_POOL_SIZE) break
    }

    const next = declutterLabels(candidates, camera, size.width, size.height, OCCLUDER_RADIUS, MIN_LABEL_SPACING_PX, MAX_VISIBLE_LABELS)
    setVisible(next)
  })

  return (
    <group>
      {visible.map(({ city, localPosition }) => (
        <Html
          key={city.id}
          position={localPosition}
          center
          zIndexRange={[1, 0]}
          style={{ pointerEvents: 'none' }}
        >
          <div className={`whitespace-nowrap ${labelClassName(city.population)}`}>
            {city.name.toUpperCase()}
          </div>
        </Html>
      ))}
    </group>
  )
}
