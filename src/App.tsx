import { Scene } from './scene/Scene'
import { TopNav } from './hud/TopNav'
import { SideRail } from './hud/SideRail'
import { Telemetry } from './hud/Telemetry'
import { CommandBar } from './hud/CommandBar'
import { SettingsPanel } from './hud/SettingsPanel'
import { LayerPanel } from './hud/LayerPanel'
import { LegendPanel } from './hud/LegendPanel'
import { IntelligencePanel } from './hud/IntelligencePanel'
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
      {/* Shared bottom-left stack (v3.1) — Telemetry and LegendPanel no
          longer position themselves; letting flexbox stack them means
          neither has to hardcode the other's rendered height. */}
      <div className="pointer-events-none fixed bottom-16 left-6 z-20 flex flex-col gap-3">
        <Telemetry />
        <LegendPanel />
      </div>
      <CommandBar />
      <SettingsPanel />
      <LayerPanel />
      <IntelligencePanel />
      {/* v3.2.0 — no visual output, wires up the global keyboard listener. */}
      <InputManager />
    </div>
  )
}

export default App
