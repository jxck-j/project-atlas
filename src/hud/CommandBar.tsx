import type { ReactNode } from 'react'
import { useCountryFeatures, useCountryFeaturesLoaded } from '../scene/useCountryFeatures'
import { useGeoEntityFeatures } from '../scene/useGeoEntityFeatures'
import { useTelemetry } from './telemetryStore'
import { useSelection } from './selectionStore'

function formatCoord(lat: number | null, lng: number | null) {
  if (lat === null || lng === null) return '—'
  const latStr = `${Math.abs(lat).toFixed(2)}°${lat >= 0 ? 'N' : 'S'}`
  const lngStr = `${Math.abs(lng).toFixed(2)}°${lng >= 0 ? 'E' : 'W'}`
  return `${latStr} ${lngStr}`
}

function Segment({ children }: { children: ReactNode }) {
  return (
    <div className="flex items-center gap-1.5 border-r border-cyan-400/15 px-3 last:border-r-0">
      {children}
    </div>
  )
}

export function CommandBar() {
  const loaded = useCountryFeaturesLoaded()
  const features = useCountryFeatures()
  // Entity geometry is a much smaller fetch than the country topology and
  // has no separate "loaded" indicator surfaced here — READY/LOADING above
  // still tracks countries only, since that's the dataset the rest of the
  // globe's readiness has always been judged by.
  const entityFeatures = useGeoEntityFeatures()
  const { fps, hoverLat, hoverLng } = useTelemetry()
  // v3.2.0: keeps the status bar in sync with the current selection
  // regardless of how it was made — mouse click, search, or keyboard
  // navigation all write through the same selectionStore, so this needed
  // no new wiring beyond reading the existing store.
  const { selected } = useSelection()

  return (
    <div className="pointer-events-none fixed inset-x-0 bottom-0 z-20 flex justify-center">
      <div className="pointer-events-auto flex items-stretch border-x border-t border-cyan-400/25 bg-cyan-950/25 backdrop-blur-sm px-1 py-1.5 font-mono text-[10px] tracking-[0.15em]">
        <Segment>
          <span
            className={`h-1.5 w-1.5 rounded-full ${
              loaded
                ? 'animate-pulse bg-emerald-400 shadow-[0_0_6px_2px_rgba(52,211,153,0.6)]'
                : 'bg-amber-400 shadow-[0_0_6px_2px_rgba(251,191,36,0.6)]'
            }`}
          />
          <span className={loaded ? 'text-emerald-300' : 'text-amber-300'}>
            {loaded ? 'READY' : 'LOADING'}
          </span>
        </Segment>
        <Segment>
          <span className="text-cyan-500/60">LINK</span>
          <span className="text-cyan-100">CONNECTED</span>
        </Segment>
        <Segment>
          <span className="text-cyan-500/60">COUNTRIES</span>
          <span className="text-cyan-100 tabular-nums">{features.length}</span>
        </Segment>
        <Segment>
          <span className="text-cyan-500/60">ENTITIES</span>
          <span className="text-cyan-100 tabular-nums">{entityFeatures.length}</span>
        </Segment>
        <Segment>
          <span className="text-cyan-500/60">SELECTED</span>
          <span className="max-w-[140px] truncate text-cyan-100">{selected?.name.toUpperCase() ?? '—'}</span>
        </Segment>
        <Segment>
          <span className="text-cyan-500/60">FPS</span>
          <span className="text-cyan-100 tabular-nums">{fps}</span>
        </Segment>
        <Segment>
          <span className="text-cyan-500/60">COORD</span>
          <span className="text-cyan-100 tabular-nums">{formatCoord(hoverLat, hoverLng)}</span>
        </Segment>
      </div>
    </div>
  )
}
