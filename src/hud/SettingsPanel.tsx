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

export function SettingsPanel() {
  const isOpen = useHudPanel() === 'settings'
  const { rotateSensitivity, zoomSensitivity } = useCameraSettings()

  if (!isOpen) return null

  return (
    <div className="pointer-events-auto fixed top-24 left-4 md:top-28 md:left-8 z-30 w-40 md:w-48">
      <div className="border border-cyan-400/25 bg-cyan-950/25 backdrop-blur-sm px-4 py-3 font-mono space-y-3">
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
    </div>
  )
}
