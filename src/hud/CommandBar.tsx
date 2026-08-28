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
    <div className="flex items-center gap-1.5 border-r border-[#16233c] px-3 last:border-r-0">
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
      <div className="pointer-events-auto flex items-stretch rounded-t-lg border-x border-t border-[#172440] bg-[rgba(7,11,20,0.92)] px-1 py-1.5 text-[10px] tracking-[0.15em] backdrop-blur-[12px] shadow-[0_10px_34px_rgba(0,0,0,0.55),inset_0_1px_0_rgba(120,160,230,0.06)]">
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
          <span className="text-[#6d82a8]">LINK</span>
          <span className="text-[#e6efff]">CONNECTED</span>
        </Segment>
        <Segment>
          <span className="text-[#6d82a8]">COUNTRIES</span>
          {/* features.length is the literal 193-country topology count —
              +1 for Taiwan, which is recognized as a country across the
              Intelligence Engine (see CLAUDE.md) even though it still
              renders via the GeoEntity topology below, not this one. */}
          <span className="font-mono tabular-nums text-[#e6efff]">{features.length + 1}</span>
        </Segment>
        <Segment>
          <span className="text-[#6d82a8]">TERRITORIES</span>
          <span className="font-mono tabular-nums text-[#e6efff]">{entityFeatures.length}</span>
        </Segment>
        <Segment>
          <span className="text-[#6d82a8]">SELECTED</span>
          <span className="max-w-[140px] truncate text-[#e6efff]">{selected?.name.toUpperCase() ?? '—'}</span>
        </Segment>
        <Segment>
          <span className="text-[#6d82a8]">FPS</span>
          <span className="font-mono tabular-nums text-[#e6efff]">{fps}</span>
        </Segment>
        <Segment>
          <span className="text-[#6d82a8]">COORD</span>
          <span className="font-mono tabular-nums text-[#e6efff]">{formatCoord(hoverLat, hoverLng)}</span>
        </Segment>
      </div>
    </div>
  )
}
