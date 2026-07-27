import { useMemo, useRef, useState } from 'react'
import { useFrame, useThree } from '@react-three/fiber'
import { Html } from '@react-three/drei'
import { Vector3 } from 'three'
import { useUsCitiesIndex, type UsCityIndexEntry } from './useUsCitiesIndex'
import { useSelection } from '../hud/selectionStore'
import { latLngToVector3 } from '../utils/geo'
import { getGlobeRotationY } from './globeRotation'
import { declutterLabels, isCandidateVisible, type DeclutterCandidate } from './labelDeclutter'
import { GLOBE_RADIUS } from './constants'
import { resolveDeepestLevel, type LodLevelId } from '../lod'

// Google-Maps-style progressive label reveal for the 32,608 US cities/places
// this branch already has boundary data for (see UsCityOutlineHighlight.tsx)
// — names only, positioned at each city's centroid, no polygon (the
// polygon-on-search behavior is unchanged and unrelated to this). Ranked by
// real 2023 city-proper population (scripts/buildUsCitiesData.mjs, joined
// from a separate Census population-estimates product — see that script's
// comments for why land area and Natural Earth's populated-places dataset
// were both tried and rejected as ranking signals first).
//
// State capitals get a synthetic population floor (STATE_CAPITAL_FLOOR)
// rather than a separate parallel filter, so a single sort-by-score handles
// both "big city" and "notable small capital" (Montpelier, VT; Pierre, SD)
// in one pass — see usStateCapitals.mjs for why population data can't
// identify these on its own.
const STATE_CAPITAL_FLOOR = 350_000

function scoreOf(city: UsCityIndexEntry): number {
  return city.isStateCapital ? Math.max(city.population, STATE_CAPITAL_FLOOR) : city.population
}

// Population floor to show at each city-relevant LOD level once the LOD
// Engine (src/lod/) says that level is active — the population-scored,
// priority-ranked, decluttered part of "which cities show" is still this
// file's job, same as it always was, just keyed off a shared level id
// instead of a distance table only this file knew about (the old
// REVEAL_TIERS/NO_CITIES_ABOVE_DISTANCE, now superseded by
// src/lod/lodLevels.ts, which every future zoom-gated dataset shares
// instead of inventing its own). A distance that doesn't resolve to any of
// these keys (zoomed out past 'metro-areas', i.e. still at
// 'states'/'countries'/'earth') falls through to the Infinity default
// below — no city shows "from space," same guarantee
// NO_CITIES_ABOVE_DISTANCE used to provide, now a natural consequence of
// the lookup instead of a separately-maintained cutoff.
const CITY_POPULATION_FLOOR: Partial<Record<LodLevelId, number>> = {
  'metro-areas': 700_000,
  'large-cities': 250_000,
  'medium-cities': 100_000,
  'small-cities': 30_000,
  // Strictly greater than 0, not "no floor at all" — this level is "every
  // INCORPORATED city," and population 0 in this dataset means an
  // unincorporated Census-Designated Place this Census program doesn't
  // estimate (see buildUsCitiesData.mjs), not a real incorporated city
  // with zero residents.
  'every-incorporated-city': 1,
}

function minScoreForDistance(distance: number): number {
  const level = resolveDeepestLevel(distance)
  return CITY_POPULATION_FLOOR[level.id] ?? Infinity
}

// Google Maps-style hierarchy: label size/weight/brightness scales with the
// same score CITY_POPULATION_FLOOR uses for eligibility. Smaller/dimmer
// tiers also get tighter tracking — this app's usual tracked-out HUD label style (see
// WaterLabels/PointerMarker, ~0.1-0.2em) reads as illegible squeezed onto
// an 7px line.
//
// Fixed absolute px sizes ONLY work because the Html below omits
// distanceFactor — labels stay a constant screen size regardless of zoom,
// same as real Google Maps text does; see that prop's comment.
const LABEL_STYLE_TIERS: [minScore: number, className: string][] = [
  [700_000, 'text-[11px] font-semibold tracking-[0.05em] text-cyan-100/90'],
  [250_000, 'text-[9px] font-medium tracking-[0.04em] text-cyan-200/75'],
  [100_000, 'text-[8px] tracking-[0.03em] text-cyan-300/60'],
  [30_000, 'text-[7px] tracking-[0.02em] text-cyan-400/45'],
  [0, 'text-[6px] tracking-[0.02em] text-cyan-500/35'],
]

function labelClassName(score: number): string {
  for (const [minScore, className] of LABEL_STYLE_TIERS) {
    if (score >= minScore) return className
  }
  return LABEL_STYLE_TIERS[LABEL_STYLE_TIERS.length - 1][1]
}

// Same tier boundaries as LABEL_STYLE_TIERS, but for declutter spacing
// instead of font styling — the two are related (a bigger/bolder label
// really does need more screen clearance) but not the same lookup, since
// nothing here cares about Tailwind classes. Replaces a single flat
// MIN_LABEL_SPACING_PX: two adjacent big-metro labels genuinely need ~70px
// apart to stay legible, but applying that same 70px to two tiny 6-7px
// town labels (Gulfport/Biloxi, MS: ~20km apart, ~68px onscreen at this
// app's closest zoom) meant the smaller of any two nearby small towns
// always lost, even though neither label is anywhere near 70px wide.
const SPACING_RADIUS_TIERS: [minScore: number, radiusPx: number][] = [
  [700_000, 45],
  [250_000, 35],
  [100_000, 28],
  [30_000, 20],
  [0, 14],
]

function spacingRadiusForScore(score: number): number {
  for (const [minScore, radiusPx] of SPACING_RADIUS_TIERS) {
    if (score >= minScore) return radiusPx
  }
  return SPACING_RADIUS_TIERS[SPACING_RADIUS_TIERS.length - 1][1]
}

const Y_AXIS = new Vector3(0, 1, 0)
const OCCLUDER_RADIUS = GLOBE_RADIUS * 0.98 // matches Globe.tsx's core sphere
// Only a fallback now (declutterLabels uses candidate.spacingRadiusPx,
// which every candidate below sets via spacingRadiusForScore) — kept as
// the function-signature default for parity with CountryLabels.tsx, which
// doesn't set per-candidate radii and still relies on this being halved.
const MIN_LABEL_SPACING_PX = 70
const MAX_VISIBLE_LABELS = 120
// Bounds the O(n²) declutter pass — but candidates are filtered to
// in-view (front-hemisphere) cities BEFORE this cap is applied, not after.
// An earlier version capped `ranked` (sorted by NATIONAL population score)
// directly to this many BEFORE checking geography at all — meaning a real
// city (Hattiesburg, MS, population 48,414) ranked #841 nationally among
// score-qualifying cities could never appear no matter how far you zoomed
// into Mississippi specifically, because 400 bigger cities elsewhere in the
// country (invisible from that view) were still consuming every candidate
// slot first. Reported as "zoomed in to find it and it wouldn't pop up."
const CANDIDATE_POOL_SIZE = 500
const DECLUTTER_INTERVAL_MS = 150 // throttled recompute — every frame would be needless React churn for a screen-space layout that only meaningfully changes as the camera actually moves

// `worldPosition` (rotation-adjusted, for the declutter math below — see
// labelDeclutter.ts) and `localPosition` (raw, pre-rotation) are DIFFERENT
// on purpose: this component renders as a child of Globe.tsx's own
// rotating <group ref={groupRef}>, so the <Html> below must be positioned
// in that group's LOCAL space (the group's own transform applies the
// rotation once, naturally) — passing the already-rotated worldPosition
// there would double-apply it.
interface CityCandidate extends DeclutterCandidate {
  city: UsCityIndexEntry
  localPosition: Vector3
}

export function UsCityLabels() {
  const allCities = useUsCitiesIndex()
  const { selected, usCityOutline } = useSelection()
  const { camera, size } = useThree()
  const [visible, setVisible] = useState<CityCandidate[]>([])
  const lastRun = useRef(0)

  const ranked = useMemo(() => [...allCities].sort((a, b) => scoreOf(b) - scoreOf(a)), [allCities])

  useFrame((state) => {
    const now = state.clock.elapsedTime * 1000
    if (now - lastRun.current < DECLUTTER_INTERVAL_MS) return
    lastRun.current = now

    if (selected || usCityOutline) {
      if (visible.length > 0) setVisible([])
      return
    }

    const cameraDistance = camera.position.length()
    const minScore = minScoreForDistance(cameraDistance)
    const rotationY = getGlobeRotationY()
    // Same real on-screen test declutterLabels does internally (see
    // labelDeclutter.ts's isCandidateVisible), applied here too and
    // deliberately BEFORE the CANDIDATE_POOL_SIZE cap below, not just as
    // part of the final greedy pass — so a globally-unremarkable-but-
    // locally-in-view city doesn't get crowded out of the pool by bigger
    // cities elsewhere that are merely facing the camera (the sphere-
    // horizon test alone) but aren't actually inside the camera's framed
    // view right now.
    const candidates: CityCandidate[] = []
    for (const city of ranked) {
      if (scoreOf(city) < minScore) break // ranked is sorted descending, so nothing after this qualifies either
      const localPosition = latLngToVector3(city.lat, city.lng, GLOBE_RADIUS * 1.002)
      const worldPosition = localPosition.clone().applyAxisAngle(Y_AXIS, rotationY)
      if (!isCandidateVisible(worldPosition, camera, size.width, size.height, OCCLUDER_RADIUS)) continue // not currently on screen — don't spend a candidate slot on it
      candidates.push({ id: city.id, worldPosition, localPosition, city, spacingRadiusPx: spacingRadiusForScore(scoreOf(city)) })
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
          // No occlude prop — declutterLabels' analytic front/back-of-globe
          // test (labelDeclutter.ts) already excluded anything on the far
          // side before this ever got here, so there's nothing left for
          // Html's own raycast-based occlusion to do.
          //
          // Deliberately NO distanceFactor, unlike every other Html label in
          // this app (WaterLabels/CapitalMarker/UsCityOutlineHighlight all
          // use one) — those never operate this close to their own anchor
          // point, so the perspective growth distanceFactor introduces stays
          // unnoticed. This label set is shown down to this app's closest
          // zoom tier, where that same growth becomes unbounded. Omitting it
          // makes Html fall back to scale=1 (see drei's Html.js) — a plain
          // constant-screen-size 2D overlay.
          zIndexRange={[1, 0]}
          style={{ pointerEvents: 'none' }}
        >
          <div className={`whitespace-nowrap font-mono ${labelClassName(scoreOf(city))}`}>
            {city.name.toUpperCase()}
          </div>
        </Html>
      ))}
    </group>
  )
}
