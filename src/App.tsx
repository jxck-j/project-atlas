import { Scene } from './scene/Scene'
import { HUDFrame } from './hud/HUDFrame'
import { Header } from './hud/Header'
import { Telemetry } from './hud/Telemetry'
import { CommandBar } from './hud/CommandBar'
import { Toolbar } from './hud/Toolbar'
import { SearchBar } from './hud/SearchBar'
import { SettingsPanel } from './hud/SettingsPanel'
import { LayerPanel } from './hud/LayerPanel'
import { LegendPanel } from './hud/LegendPanel'
import { IntelligencePanel } from './hud/IntelligencePanel'
import { InputManager } from './input/InputManager'

function App() {
  return (
    <div className="relative h-svh w-svw overflow-hidden bg-[#04070a]">
      <Scene />
      <HUDFrame />
      <Header />
      {/* Shared bottom-left stack (v3.1) — Telemetry and LegendPanel no
          longer position themselves; letting flexbox stack them means
          neither has to hardcode the other's rendered height. */}
      <div className="pointer-events-none fixed bottom-6 left-6 md:bottom-8 md:left-8 z-20 flex flex-col gap-3">
        <Telemetry />
        <LegendPanel />
      </div>
      <CommandBar />
      <Toolbar />
      <SearchBar />
      <SettingsPanel />
      <LayerPanel />
      <IntelligencePanel />
      {/* v3.2.0 — no visual output, wires up the global keyboard listener. */}
      <InputManager />
    </div>
  )
}

export default App
