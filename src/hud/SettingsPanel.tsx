import {
  resetCameraSettings,
  setRotateSensitivity,
  setZoomSensitivity,
  useCameraSettings,
} from './settingsStore'
import { useHudPanel } from './hudPanelStore'

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
      <div className="flex items-baseline justify-between text-[10px] md:text-xs mb-1">
        <span className="text-cyan-500/60 tracking-[0.15em]">{label}</span>
        <span className="text-cyan-100 tabular-nums">{value.toFixed(2)}</span>
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
      <span className="shrink-0 rounded border border-cyan-400/30 bg-cyan-950/40 px-1.5 py-0.5 font-mono text-cyan-200 tracking-[0.05em]">
        {keys}
      </span>
      <span className="text-right text-cyan-500/70 tracking-[0.05em]">{label}</span>
    </div>
  )
}

function ShortcutGroup({ title, rows }: { title: string; rows: [string, string][] }) {
  return (
    <div className="space-y-1.5">
      <div className="text-[9px] tracking-[0.25em] text-cyan-500/50">{title}</div>
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
    <div className="pointer-events-auto fixed top-24 left-4 md:top-28 md:left-8 z-30 w-56 md:w-64">
      <div className="max-h-[75vh] overflow-y-auto border border-cyan-400/25 bg-cyan-950/25 backdrop-blur-sm px-4 py-3 font-mono space-y-4">
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <span className="text-amber-400/90 tracking-[0.25em] text-[10px] md:text-xs">
              CAMERA
            </span>
            <button
              type="button"
              onClick={resetCameraSettings}
              className="text-cyan-500/60 hover:text-cyan-200 text-[10px] tracking-[0.1em] transition-colors"
            >
              RESET
            </button>
          </div>
          <Slider label="ROTATE SENS" value={rotateSensitivity} onChange={setRotateSensitivity} />
          <Slider label="ZOOM SENS" value={zoomSensitivity} onChange={setZoomSensitivity} />
        </div>

        <div className="h-px w-full bg-cyan-400/20" />

        <div className="space-y-3">
          <span className="text-amber-400/90 tracking-[0.25em] text-[10px] md:text-xs">
            KEYBOARD SHORTCUTS
          </span>
          <ShortcutGroup title="CAMERA" rows={CAMERA_SHORTCUTS} />
          <ShortcutGroup title="NAVIGATION" rows={NAVIGATION_SHORTCUTS} />
          <ShortcutGroup title="HUD" rows={HUD_SHORTCUTS} />
          <div className="text-[9px] italic leading-relaxed text-cyan-500/40">
            Disabled while typing in a text field.
          </div>
        </div>
      </div>
    </div>
  )
}
