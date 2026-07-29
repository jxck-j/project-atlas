import { getLayerDefinitions, toggleLayer, useLayerEnabledMap, type LayerDefinition } from '../layers'
import { useHudPanel } from './hudPanelStore'
import { useSideNavSection } from './navStore'
import { SIDE_NAV_ITEMS } from './sideNavItems'
import { PANEL_HEAD, PANEL_SURFACE, PANEL_TITLE } from './panelStyles'

// `.tgl` — the reference's 34x18 pill switch. Purely a different rendering
// of the same boolean the dot indicator showed before; the enabled state
// and the toggleLayer() call behind it are untouched.
function Toggle({ on }: { on: boolean }) {
  return (
    <span
      className={`relative h-[18px] w-[34px] shrink-0 rounded-full border transition-colors ${
        on ? 'border-[#3f8bff] bg-[rgba(63,139,255,0.35)]' : 'border-[#26385c] bg-[#0e1729]'
      }`}
    >
      <span
        className={`absolute top-[2px] h-3 w-3 rounded-full transition-all ${
          on ? 'left-[18px] bg-[#6db0ff] shadow-[0_0_8px_rgba(63,139,255,0.9)]' : 'left-[2px] bg-[#51648a]'
        }`}
      />
    </span>
  )
}

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
  const section = useSideNavSection()
  const allDefinitions = getLayerDefinitions()

  // The sidebar scopes this panel by Layer Engine category (see
  // SideRail.tsx) — it never hides a layer any other way, so an
  // unrecognized or category-less section falls through to the full list
  // rather than showing nothing.
  const activeItem = SIDE_NAV_ITEMS.find((item) => item.id === section)
  const definitions =
    activeItem && activeItem.categories.length > 0
      ? allDefinitions.filter((def) => activeItem.categories.includes(def.category))
      : allDefinitions

  if (!isOpen) return null

  return (
    <div className="pointer-events-auto fixed top-20 left-[168px] z-30 w-56 md:w-64">
      <div className={PANEL_SURFACE}>
        <div className={PANEL_HEAD}>
          <span className={PANEL_TITLE}>LAYER CONTROL</span>
          {activeItem && activeItem.id !== 'overview' && (
            <span className="text-[9px] tracking-[0.18em] text-[#4d95ff]">{activeItem.label}</span>
          )}
        </div>

        <div className="max-h-[60vh] overflow-y-auto py-1">
          {definitions.length === 0 ? (
            <div className="px-3 py-2 text-[10px] italic text-[#51648a]">
              No layers registered under this section yet
            </div>
          ) : (
            groupByCategory(definitions).map(([category, defs]) => (
              <div key={category}>
                <div className="px-3 pt-2 pb-1 text-[9px] tracking-[0.2em] text-[#51648a]">
                  {category.toUpperCase()}
                </div>
                {defs.map((def) => {
                  const enabled = enabledMap[def.id] ?? def.defaultEnabled
                  return (
                    <button
                      key={def.id}
                      type="button"
                      onClick={() => toggleLayer(def.id)}
                      title={def.description}
                      className="flex w-full items-center gap-2.5 px-3 py-2 transition-colors hover:bg-[rgba(35,60,110,0.2)]"
                    >
                      <span
                        className={`flex-1 text-left text-[10.5px] font-semibold tracking-[0.1em] ${
                          enabled ? 'text-[#dce8fb]' : 'text-[#aebfdc]'
                        }`}
                      >
                        {def.label.toUpperCase()}
                      </span>
                      <Toggle on={enabled} />
                    </button>
                  )
                })}
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  )
}
