import { useTelemetry } from './telemetryStore'

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between gap-6">
      <span className="text-cyan-500/60 tracking-[0.15em]">{label}</span>
      <span className="text-cyan-100 tabular-nums">{value}</span>
    </div>
  )
}

// No longer its own `fixed`-positioned element (v3.1) \u2014 App.tsx renders this
// inside a shared bottom-left flex column alongside LegendPanel, so the two
// stack without either hardcoding the other's height. See LegendPanel.tsx
// for why bottom-left (not bottom-right/top-right) is where anything needs
// to live if it should stay visible while IntelligencePanel is open.
export function Telemetry() {
  const { azimuthDeg, polarDeg, distance } = useTelemetry()

  return (
    <div className="border border-cyan-400/25 bg-cyan-950/20 backdrop-blur-sm px-4 py-3 font-mono text-[10px] md:text-xs space-y-1.5 min-w-[190px]">
      <div className="text-amber-400/90 tracking-[0.25em] mb-2">
        ORBIT TELEMETRY
      </div>
      <Row label="AZ" value={`${azimuthDeg.toFixed(1)}\u00B0`} />
      <Row label="EL" value={`${(90 - polarDeg).toFixed(1)}\u00B0`} />
      <Row label="RANGE" value={`${distance.toFixed(2)} AU`} />
    </div>
  )
}
