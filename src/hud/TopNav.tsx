import { toggleHudPanel, useHudPanel } from './hudPanelStore'
import { resetView } from './selectionStore'
import { AtlasLogo, Icon } from './icons'
import { ICONS } from './iconPaths'
import { setTopNavTab, useTopNavTab, type TopNavTab } from './navStore'
import { SearchBar } from './SearchBar'

// Only 'map' has a view behind it. The other four are rendered inactive
// rather than omitted (the layout reads as incomplete without them) and
// rather than as working tabs (that would imply views this app doesn't
// have) — see this session's note on affordances with nothing behind them.
const TABS: { id: TopNavTab; label: string; wired: boolean }[] = [
  { id: 'map', label: 'MAP', wired: true },
  { id: 'intelligence', label: 'INTELLIGENCE', wired: false },
  { id: 'layers', label: 'LAYERS', wired: false },
  { id: 'analytics', label: 'ANALYTICS', wired: false },
  { id: 'database', label: 'DATABASE', wired: false },
]

function IconButton({
  icon,
  label,
  active,
  onClick,
  badge,
}: {
  icon: readonly string[]
  label: string
  active?: boolean
  onClick?: () => void
  badge?: boolean
}) {
  const wired = onClick != null
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={!wired}
      title={wired ? label : `${label} — not available yet`}
      aria-label={label}
      className={`relative grid h-[34px] w-[34px] place-items-center rounded-lg transition-colors ${
        active
          ? 'bg-[rgba(63,139,255,0.2)] text-white'
          : wired
            ? 'text-[#8aa0c6] hover:bg-[rgba(40,70,130,0.25)] hover:text-[#e6efff]'
            : 'text-[#3d5074] cursor-not-allowed'
      }`}
    >
      <Icon paths={icon} />
      {badge && (
        <span className="absolute top-[7px] right-[7px] h-1.5 w-1.5 rounded-full bg-[#ff4a42] shadow-[0_0_6px_#ff4a42]" />
      )}
    </button>
  )
}

export function TopNav() {
  const activeTab = useTopNavTab()
  const openPanel = useHudPanel()

  return (
    <header className="pointer-events-auto fixed inset-x-0 top-0 z-40 flex h-16 items-center gap-7 border-b border-[#14213a] bg-[linear-gradient(180deg,rgba(6,10,19,0.96),rgba(6,10,19,0.82))] px-4 backdrop-blur-[12px]">
      {/* Brand — top left */}
      <button
        type="button"
        onClick={resetView}
        title="Reset view"
        className="flex shrink-0 items-center gap-2.5 text-left"
      >
        <AtlasLogo size={38} />
        <span className="hidden sm:block">
          <span className="block font-display text-[21px] leading-none font-bold tracking-[0.14em] text-[#f2f7ff]">
            PROJECT ATLAS
          </span>
          <span className="mt-[3px] block text-[8.5px] tracking-[0.34em] text-[#5a79ab]">
            GLOBAL COMMAND INTERFACE
          </span>
        </span>
      </button>

      {/* Tabs — top middle */}
      <nav className="hidden h-full items-stretch gap-1.5 lg:flex">
        {TABS.map((tab) => {
          const isActive = activeTab === tab.id
          return (
            <button
              key={tab.id}
              type="button"
              disabled={!tab.wired}
              title={tab.wired ? tab.label : `${tab.label} — not available yet`}
              onClick={() => setTopNavTab(tab.id)}
              className={`border-b-2 px-4 text-[12.5px] font-semibold tracking-[0.13em] transition-colors ${
                isActive
                  ? 'border-[#3f8bff] text-white [text-shadow:0_0_12px_rgba(63,139,255,0.6)]'
                  : tab.wired
                    ? 'border-transparent text-[#7f93b8] hover:text-[#c6d6f0]'
                    : 'border-transparent text-[#3d5074] cursor-not-allowed'
              }`}
            >
              {tab.label}
            </button>
          )
        })}
      </nav>

      {/* Utilities — top right */}
      <div className="ml-auto flex items-center gap-1.5">
        <SearchBar />
        <IconButton icon={ICONS.star} label="Favorites" />
        <IconButton icon={ICONS.bell} label="Notifications" badge />
        <IconButton icon={ICONS.user} label="Account" />
        <IconButton
          icon={ICONS.layers}
          label="Layers"
          active={openPanel === 'layers'}
          onClick={() => toggleHudPanel('layers')}
        />
        <IconButton
          icon={ICONS.settings}
          label="Settings"
          active={openPanel === 'settings'}
          onClick={() => toggleHudPanel('settings')}
        />
      </div>
    </header>
  )
}
