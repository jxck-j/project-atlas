import { getLayerDefinitions, toggleLayer, useLayerEnabledMap, type LayerDefinition } from '../layers'
import { useHudPanel } from './hudPanelStore'

function groupByCategory(definitions: LayerDefinition[]): [string, LayerDefinition[]][] {
  const groups = new Map<string, LayerDefinition[]>()
  for (const def of definitions) {
    const list = groups.get(def.category) ?? []
    list.push(def)
    groups.set(def.category, list)
  }
  return Array.from(groups.entries())
}

export function LayerPanel() {
  const isOpen = useHudPanel() === 'layers'
  const enabledMap = useLayerEnabledMap()
  const definitions = getLayerDefinitions()

  if (!isOpen) return null

  return (
    <div className="pointer-events-auto fixed top-24 left-4 md:top-28 md:left-8 z-30 w-48 md:w-56">
      <div className="border border-cyan-400/25 bg-cyan-950/25 backdrop-blur-sm px-4 py-3 font-mono space-y-3">
        <div className="text-amber-400/90 tracking-[0.25em] text-[10px] md:text-xs">LAYERS</div>

        {definitions.length === 0 ? (
          <div className="text-cyan-500/50 text-[10px] italic">No layers registered</div>
        ) : (
          groupByCategory(definitions).map(([category, defs]) => (
            <div key={category} className="space-y-1.5">
              <div className="text-[9px] tracking-[0.2em] text-cyan-500/50">{category.toUpperCase()}</div>
              {defs.map((def) => {
                const enabled = enabledMap[def.id] ?? def.defaultEnabled
                return (
                  <button
                    key={def.id}
                    type="button"
                    onClick={() => toggleLayer(def.id)}
                    title={def.description}
                    className="flex w-full items-center justify-between gap-2 text-[11px] tracking-[0.05em] transition-colors"
                  >
                    <span className={enabled ? 'text-cyan-100' : 'text-cyan-500/60'}>{def.label}</span>
                    <span
                      className={`h-1.5 w-1.5 shrink-0 rounded-full ${
                        enabled
                          ? 'bg-cyan-300 shadow-[0_0_6px_2px_rgba(76,224,255,0.6)]'
                          : 'bg-cyan-800'
                      }`}
                    />
                  </button>
                )
              })}
            </div>
          ))
        )}
      </div>
    </div>
  )
}
