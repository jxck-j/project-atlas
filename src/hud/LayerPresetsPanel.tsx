import { useState } from 'react'
import {
  applyLayerPreset,
  deleteLayerPreset,
  getLayerDefinitions,
  saveLayerPreset,
  useLayerEnabledMap,
  useLayerPresets,
} from '../layers'
import { closeHudPanel, useHudPanel } from './hudPanelStore'
import { PANEL_HEAD, PANEL_SURFACE, PANEL_TITLE, PANEL_SECTION_LABEL } from './panelStyles'
import { Icon } from './icons'
import { ICONS } from './iconPaths'

// Opened from TopNav.tsx's Layers icon button (v6.5.0 — previously toggled
// hud/LayerPanel.tsx's per-layer toggle list directly). That toggle list is
// still reachable from every SideRail category row, unchanged, so this
// panel doesn't duplicate it: it only snapshots/restores the WHOLE
// enabled-state map at once, so a user who's already arranged a layer
// combination they like doesn't have to re-toggle each one by hand next
// time — direct request. Same fixed-position slot every other HudPanel
// docks at (see AlliancesPanel.tsx's own comment on why).
export function LayerPresetsPanel() {
  const isOpen = useHudPanel() === 'layerPresets'
  const presets = useLayerPresets()
  const enabledMap = useLayerEnabledMap()
  const [name, setName] = useState('')

  if (!isOpen) return null

  const definitions = getLayerDefinitions()
  const enabledCount = definitions.filter((def) => enabledMap[def.id] ?? def.defaultEnabled).length

  function handleSave() {
    saveLayerPreset(name)
    setName('')
  }

  return (
    <div className="pointer-events-auto fixed top-[72px] left-[168px] z-30 w-64 md:w-72">
      <div className={PANEL_SURFACE}>
        <div className={PANEL_HEAD}>
          <span className={PANEL_TITLE}>LAYER PRESETS</span>
          <button
            type="button"
            onClick={closeHudPanel}
            aria-label="Close layer presets"
            title="Close"
            className="text-sm leading-none text-[#8aa0c6] transition-colors hover:text-white"
          >
            ✕
          </button>
        </div>

        <div className="border-b border-[#16233c] px-3 py-2.5">
          <div className={`${PANEL_SECTION_LABEL} mb-1.5`}>SAVE CURRENT CONFIG</div>
          <div className="mb-1.5 text-[10px] text-[#6d82a8]">
            {enabledCount} of {definitions.length} layers currently on
          </div>
          <div className="flex gap-1.5">
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') handleSave()
              }}
              placeholder="Preset name..."
              aria-label="Preset name"
              className="min-w-0 flex-1 rounded border border-[#26385c] bg-[#0e1729] px-2 py-1.5 text-[11px] text-[#dce8fb] outline-none placeholder:text-[#51648a] focus:border-[#3f8bff]"
            />
            <button
              type="button"
              onClick={handleSave}
              title="Save the current layer configuration"
              className="shrink-0 rounded border border-[#3f8bff] px-2.5 text-[10px] font-bold tracking-[0.1em] text-[#4d95ff] transition-colors hover:bg-[rgba(63,139,255,0.14)]"
            >
              SAVE
            </button>
          </div>
        </div>

        <div className="max-h-[45vh] overflow-y-auto px-1 py-1.5">
          {presets.length === 0 ? (
            <div className="px-2 py-2 text-[10px] italic leading-relaxed text-[#51648a]">
              No saved presets yet. Toggle layers from the sidebar, then save this configuration above.
            </div>
          ) : (
            presets.map((preset) => (
              <div
                key={preset.id}
                className="flex items-center gap-1.5 rounded px-2 py-1.5 transition-colors hover:bg-[rgba(35,60,110,0.2)]"
              >
                <button
                  type="button"
                  onClick={() => applyLayerPreset(preset.id)}
                  title={`Apply "${preset.name}"`}
                  className="flex min-w-0 flex-1 items-center gap-2 text-left"
                >
                  <span className="text-[#4d95ff]">
                    <Icon paths={ICONS.layers} size={14} />
                  </span>
                  <span className="min-w-0 flex-1 truncate text-[10.5px] font-semibold text-[#dce8fb]">
                    {preset.name}
                  </span>
                </button>
                <button
                  type="button"
                  onClick={() => deleteLayerPreset(preset.id)}
                  title={`Delete "${preset.name}"`}
                  aria-label={`Delete ${preset.name}`}
                  className="shrink-0 text-xs text-[#51648a] transition-colors hover:text-[#ff4a42]"
                >
                  ✕
                </button>
              </div>
            ))
          )}
        </div>

        <div className="border-t border-[#16233c] px-3 py-2 text-[9.5px] leading-snug text-[#51648a]">
          Click a preset to apply it. Presets are saved on this device.
        </div>
      </div>
    </div>
  )
}
