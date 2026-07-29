import { useTelemetry } from './telemetryStore'
import { PANEL_SECTION_LABEL, PANEL_SURFACE } from './panelStyles'

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between gap-6">
      <span className="tracking-[0.15em] text-[#6d82a8]">{label}</span>
      <span className="tabular-nums text-[#e6efff]">{value}</span>
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
    <div className={`${PANEL_SURFACE} min-w-[190px] space-y-1.5 px-4 py-3 font-mono text-[10px] md:text-xs`}>
      <div className={`${PANEL_SECTION_LABEL} mb-2`}>ORBIT TELEMETRY</div>
      <Row label="AZ" value={`${azimuthDeg.toFixed(1)}\u00B0`} />
      <Row label="EL" value={`${(90 - polarDeg).toFixed(1)}\u00B0`} />
      <Row label="RANGE" value={`${distance.toFixed(2)} AU`} />
    </div>
  )
}
