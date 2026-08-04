import {
  resetCameraSettings,
  setRotateSensitivity,
  setZoomSensitivity,
  useCameraSettings,
} from './settingsStore'
import { useHudPanel } from './hudPanelStore'
import { PANEL_HEAD, PANEL_SECTION_LABEL, PANEL_SURFACE, PANEL_TITLE } from './panelStyles'

function Slider({
  label,
  value,
  onChange,
}: {
  label: string
  value: number
  onChange: (v: number) => void
}) {
  return (
    <label className="block">
      <div className="mb-1 flex items-baseline justify-between text-[10px] md:text-xs">
        <span className="tracking-[0.15em] text-[#6d82a8]">{label}</span>
        <span className="font-mono tabular-nums text-[#e6efff]">{value.toFixed(2)}</span>
      </div>
      <input
        type="range"
        min={0.1}
        max={1.5}
        step={0.05}
        value={value}
        onChange={(e) => onChange(parseFloat(e.target.value))}
        className="w-full accent-cyan-400 cursor-pointer"
      />
    </label>
  )
}

// v3.2.0: a reference, not a rebinding UI — src/input/KeyboardController.ts's
// key maps are the actual source of truth (this list is a hand-written
// mirror of them, since the bindings are a small fixed set, not
// user-configurable data worth wiring through a store). If a binding ever
// changes there, update the two rows below to match.
function ShortcutRow({ keys, label }: { keys: string; label: string }) {
  return (
    <div className="flex items-baseline justify-between gap-2 text-[10px] md:text-xs">
      <span className="shrink-0 rounded border border-[#26385c] bg-[#0e1729] px-1.5 py-0.5 tracking-[0.05em] text-[#c6d6f0]">
        {keys}
      </span>
      <span className="text-right tracking-[0.05em] text-[#6d82a8]">{label}</span>
    </div>
  )
}

function ShortcutGroup({ title, rows }: { title: string; rows: [string, string][] }) {
  return (
    <div className="space-y-1.5">
      <div className="text-[9px] tracking-[0.25em] text-[#51648a]">{title}</div>
      <div className="space-y-1">
        {rows.map(([keys, label]) => (
          <ShortcutRow key={keys} keys={keys} label={label} />
        ))}
      </div>
    </div>
  )
}

const CAMERA_SHORTCUTS: [string, string][] = [
  ['W / S', 'ZOOM IN / OUT'],
  ['A / D', 'ROTATE LEFT / RIGHT'],
  ['Q / E', 'TILT UP / DOWN'],
  ['R', 'RESET VIEW'],
  ['SPACE', 'FOCUS SELECTION'],
  ['T', 'TOGGLE AMBIENT ROTATION'],
]

const NAVIGATION_SHORTCUTS: [string, string][] = [
  ['↑ ↓ ← →', 'SELECT NEAREST N/S/E/W'],
  ['TAB / SHIFT+TAB', 'NEXT / PREV CATEGORY'],
  ['ENTER', 'OPEN INSPECTOR'],
  ['ESC', 'CLOSE INSPECTOR, THEN DESELECT'],
]

const HUD_SHORTCUTS: [string, string][] = [
  ['L', 'TOGGLE LAYERS'],
  ['I', 'TOGGLE INSPECTOR'],
  ['/', 'OPEN SEARCH'],
]

export function SettingsPanel() {
  const isOpen = useHudPanel() === 'settings'
  const { rotateSensitivity, zoomSensitivity } = useCameraSettings()

  if (!isOpen) return null

  return (
    <div className="pointer-events-auto fixed top-[64px] right-4 z-40 w-56 md:w-64">
      <div className={`max-h-[75vh] overflow-y-auto ${PANEL_SURFACE}`}>
        <div className={PANEL_HEAD}>
          <span className={PANEL_TITLE}>SETTINGS</span>
          <button
            type="button"
            onClick={resetCameraSettings}
            className="text-[10px] tracking-[0.1em] text-[#6d82a8] transition-colors hover:text-[#e6efff]"
          >
            RESET
          </button>
        </div>

        <div className="space-y-3 border-b border-[#16233c] px-4 py-3">
          <div className={PANEL_SECTION_LABEL}>CAMERA</div>
          <Slider label="ROTATE SENS" value={rotateSensitivity} onChange={setRotateSensitivity} />
          <Slider label="ZOOM SENS" value={zoomSensitivity} onChange={setZoomSensitivity} />
        </div>

        <div className="space-y-3 px-4 py-3">
          <div className={PANEL_SECTION_LABEL}>KEYBOARD SHORTCUTS</div>
          <ShortcutGroup title="CAMERA" rows={CAMERA_SHORTCUTS} />
          <ShortcutGroup title="NAVIGATION" rows={NAVIGATION_SHORTCUTS} />
          <ShortcutGroup title="HUD" rows={HUD_SHORTCUTS} />
          <div className="text-[9px] leading-relaxed italic text-[#51648a]">
            Disabled while typing in a text field.
          </div>
        </div>
      </div>
    </div>
  )
}
