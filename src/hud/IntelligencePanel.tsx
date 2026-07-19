import { clearSelection, flyToSelectedCountry, useSelection } from './selectionStore'
import { COUNTRY_PROFILES } from '../data/countryProfiles'

function Divider() {
  return <div className="h-px w-full bg-cyan-400/30" />
}

function DataRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="space-y-0.5">
      <div className="text-[10px] tracking-[0.25em] text-cyan-500/60">{label}</div>
      <div className="text-sm text-cyan-50">{value}</div>
    </div>
  )
}

function PendingSection({ label }: { label: string }) {
  return (
    <div className="space-y-0.5">
      <div className="text-[10px] tracking-[0.25em] text-amber-400/80">{label}</div>
      <div className="text-xs text-cyan-500/40 italic">Awaiting data feed</div>
    </div>
  )
}

export function IntelligencePanel() {
  const { selected } = useSelection()
  const isOpen = selected != null
  const profile = selected ? COUNTRY_PROFILES[selected.name] : undefined

  return (
    <div
      className={`fixed inset-y-0 right-0 z-30 w-full sm:w-[380px] transition-transform duration-500 ease-out ${
        isOpen ? 'translate-x-0' : 'translate-x-full'
      }`}
    >
      <div className="pointer-events-auto h-full border-l border-cyan-400/25 bg-[#050b10]/90 backdrop-blur-md px-6 py-8 overflow-y-auto font-mono">
        {selected && (
          <div className="space-y-5">
            <Divider />

            <div className="flex items-start justify-between">
              <h2 className="flex-1 text-center text-xl md:text-2xl tracking-[0.15em] text-cyan-50 font-display [text-shadow:0_0_16px_rgba(76,224,255,0.5)]">
                {selected.name.toUpperCase()}
              </h2>
              <button
                type="button"
                onClick={clearSelection}
                aria-label="Close panel"
                className="ml-2 text-cyan-500/60 hover:text-cyan-200 transition-colors text-sm leading-none"
              >
                ✕
              </button>
            </div>

            <Divider />

            <button
              type="button"
              onClick={flyToSelectedCountry}
              className="w-full border border-cyan-400/40 py-2 text-[10px] tracking-[0.25em] text-cyan-300 transition-colors hover:border-cyan-300 hover:text-cyan-100 hover:bg-cyan-400/10"
            >
              FOCUS CAMERA
            </button>

            <Divider />

            {profile ? (
              <>
                <DataRow label="GOVERNMENT" value={profile.government} />
                <DataRow label="CAPITAL" value={profile.capital} />
                <DataRow label="POPULATION" value={profile.population} />
                <DataRow label="GDP" value={profile.gdp} />
              </>
            ) : (
              <div className="text-xs text-cyan-500/50 italic">
                No profile data available for this territory.
              </div>
            )}

            <Divider />

            <PendingSection label="MILITARY" />
            <PendingSection label="ECONOMY" />
            <PendingSection label="DIPLOMACY" />
            <PendingSection label="TECHNOLOGY" />
            <PendingSection label="CURRENT STATUS" />

            <Divider />
          </div>
        )}
      </div>
    </div>
  )
}
