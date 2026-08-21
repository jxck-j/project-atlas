import { Scene } from './scene/Scene'
import { TopNav } from './hud/TopNav'
import { SideRail } from './hud/SideRail'
import { CommandBar } from './hud/CommandBar'
import { SettingsPanel } from './hud/SettingsPanel'
import { LayerPanel } from './hud/LayerPanel'
import { AlliancesPanel } from './hud/AlliancesPanel'
import { LegendPanel } from './hud/LegendPanel'
import { IntelligencePanel } from './hud/IntelligencePanel'
import { AnalyticsPanel } from './hud/AnalyticsPanel'
import { InputManager } from './input/InputManager'

function App() {
  return (
    <div className="relative h-svh w-svw overflow-hidden bg-[#04070a]">
      <Scene />
      {/* Chrome: brand top-left, tabs top-middle, utilities (search,
          favorites, notifications, account, layers, settings) top-right.
          SearchBar renders inside TopNav's utility cluster rather than
          positioning itself. */}
      <TopNav />
      <SideRail />
      {/* Bottom-left stack (v3.1) — Telemetry (AZ/EL/RANGE orbit readout)
          removed from here for now, not deleted; hud/Telemetry.tsx and
          telemetryStore.ts are untouched, so it's a one-line re-add. Kept as
          a flex column (not just LegendPanel directly) so Telemetry can drop
          back in without either component needing to hardcode the other's
          rendered height. */}
      <div className="pointer-events-none fixed bottom-16 left-6 z-20 flex flex-col gap-3">
        <LegendPanel />
      </div>
      <CommandBar />
      <AnalyticsPanel />
      <SettingsPanel />
      <LayerPanel />
      <AlliancesPanel />
      <IntelligencePanel />
      {/* v3.2.0 — no visual output, wires up the global keyboard listener. */}
      <InputManager />
    </div>
  )
}

export default App
