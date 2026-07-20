import type { ReactNode } from 'react'
import { useCountryFeatures, useCountryFeaturesLoaded } from '../scene/useCountryFeatures'
import { useTerritoryFeatures } from '../scene/useTerritoryFeatures'
import { useTelemetry } from './telemetryStore'

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
  // Territory geometry is a much smaller fetch than the country topology
  // and has no separate "loaded" indicator surfaced here — READY/LOADING
  // above still tracks countries only, since that's the dataset the rest of
  // the globe's readiness has always been judged by.
  const territoryFeatures = useTerritoryFeatures()
  const { fps, hoverLat, hoverLng } = useTelemetry()

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
          <span className="text-cyan-500/60">TERRITORIES</span>
          <span className="text-cyan-100 tabular-nums">{territoryFeatures.length}</span>
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
