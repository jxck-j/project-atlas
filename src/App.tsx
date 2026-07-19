import { Scene } from './scene/Scene'
import { HUDFrame } from './hud/HUDFrame'
import { Header } from './hud/Header'
import { Telemetry } from './hud/Telemetry'
import { CommandBar } from './hud/CommandBar'
import { Toolbar } from './hud/Toolbar'
import { SearchBar } from './hud/SearchBar'
import { SettingsPanel } from './hud/SettingsPanel'
import { IntelligencePanel } from './hud/IntelligencePanel'

function App() {
  return (
    <div className="relative h-svh w-svw overflow-hidden bg-[#04070a]">
      <Scene />
      <HUDFrame />
      <Header />
      <Telemetry />
      <CommandBar />
      <Toolbar />
      <SearchBar />
      <SettingsPanel />
      <IntelligencePanel />
    </div>
  )
}

export default App
