import { toggleHudPanel, useHudPanel } from './hudPanelStore'
import { Icon } from './icons'
import { setSideNavSection, useSideNavSection } from './navStore'
import { SIDE_NAV_ITEMS } from './sideNavItems'
import { PANEL_SURFACE } from './panelStyles'

// The reference's left rail. Section-to-layer-category mapping lives in
// sideNavItems.ts; this file only renders it.
export function SideRail() {
  const active = useSideNavSection()
  const layersOpen = useHudPanel() === 'layers'

  return (
    <nav className={`pointer-events-auto fixed top-20 left-4 z-30 w-[148px] overflow-hidden py-1 ${PANEL_SURFACE}`}>
      {SIDE_NAV_ITEMS.map((item) => {
        const isActive = active === item.id
        // OVERVIEW always works (it's the "no filter" state); every other
        // item needs at least one registered category behind it.
        const wired = item.id === 'overview' || item.categories.length > 0

        return (
          <button
            key={item.id}
            type="button"
            disabled={!wired}
            title={wired ? `Show ${item.label.toLowerCase()} layers` : `${item.label} — no layers registered yet`}
            onClick={() => {
              setSideNavSection(item.id)
              // Selecting a section is only meaningful if the panel it
              // scopes is actually on screen, so open it if it isn't.
              if (!layersOpen) toggleHudPanel('layers')
            }}
            className={`flex w-full items-center gap-2.5 border-l-2 px-3.5 py-3 text-[10.5px] font-semibold tracking-[0.12em] transition-colors ${
              isActive
                ? 'border-[#3f8bff] bg-[linear-gradient(90deg,rgba(63,139,255,0.18),transparent)] text-white'
                : wired
                  ? 'border-transparent text-[#7f93b8] hover:bg-[rgba(35,60,110,0.2)] hover:text-[#d5e2f7]'
                  : 'border-transparent text-[#3d5074] cursor-not-allowed'
            }`}
          >
            <span className={isActive ? 'text-[#5da3ff] drop-shadow-[0_0_4px_rgba(63,139,255,0.7)]' : ''}>
              <Icon paths={item.icon} size={17} />
            </span>
            <span className="truncate">{item.label}</span>
          </button>
        )
      })}
    </nav>
  )
}
