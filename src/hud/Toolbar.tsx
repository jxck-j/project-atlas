import { toggleHudPanel, useHudPanel } from './hudPanelStore'
import { resetView } from './selectionStore'

function ToolbarButton({
  icon,
  label,
  active,
  onClick,
}: {
  icon: string
  label: string
  active?: boolean
  onClick: () => void
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={label}
      aria-label={label}
      className={`flex h-8 w-8 items-center justify-center border text-base leading-none transition-colors ${
        active
          ? 'border-cyan-300 bg-cyan-400/20 text-cyan-100'
          : 'border-cyan-400/25 text-cyan-300/70 hover:border-cyan-300 hover:text-cyan-100'
      }`}
    >
      {icon}
    </button>
  )
}

export function Toolbar() {
  const openPanel = useHudPanel()

  return (
    <div className="pointer-events-auto fixed top-4 left-4 md:top-6 md:left-6 z-30">
      <div className="border border-cyan-400/25 bg-cyan-950/25 backdrop-blur-sm px-3 py-2 font-mono">
        <div className="mb-2 text-[10px] tracking-[0.3em] text-amber-400/80">ATLAS</div>
        <div className="flex items-center gap-2">
          <ToolbarButton icon="🌍" label="Reset view" onClick={resetView} />
          <ToolbarButton
            icon="🔍"
            label="Search"
            active={openPanel === 'search'}
            onClick={() => toggleHudPanel('search')}
          />
          <ToolbarButton
            icon="🗂"
            label="Layers"
            active={openPanel === 'layers'}
            onClick={() => toggleHudPanel('layers')}
          />
          <ToolbarButton
            icon="⚙"
            label="Settings"
            active={openPanel === 'settings'}
            onClick={() => toggleHudPanel('settings')}
          />
        </div>
      </div>
    </div>
  )
}
