import { toggleHudPanel, useHudPanel } from './hudPanelStore'
import { Icon } from './icons'
import { ICONS } from './iconPaths'
import { setSideNavSection, toggleSideRail, useSideNavSection, useSideRailCollapsed } from './navStore'
import { SIDE_NAV_ITEMS } from './sideNavItems'
import { PANEL_SURFACE } from './panelStyles'

// The reference's left rail. Section-to-layer-category mapping lives in
// sideNavItems.ts; this file only renders it.
export function SideRail() {
  const active = useSideNavSection()
  const layersOpen = useHudPanel() === 'layers'
  const collapsed = useSideRailCollapsed()

  return (
    // Outer wrapper is the fixed anchor; `.relative` inside it is what the
    // toggle button's `left-0`/`left-[148px]` position against. The nav and
    // the toggle are siblings, not parent/child, specifically so collapsing
    // the nav (width -> 0) never drags the toggle out of view with it — the
    // toggle just slides from the nav's right edge back to its left edge
    // (see the button's conditional `left` below), always ending up right
    // where the rail's visible edge currently is.
    <div className="pointer-events-none fixed top-[72px] left-4 z-30">
      <div className="relative">
        <nav
          className={`pointer-events-auto overflow-hidden py-1 transition-[width,opacity] duration-200 ease-out ${PANEL_SURFACE} ${
            collapsed ? 'w-0 border-0 opacity-0' : 'w-[148px] opacity-100'
          }`}
        >
          <div className="w-[148px]">
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
                    // Re-clicking the already-active section closes the panel
                    // instead of doing nothing — the same "click to open,
                    // click again to close" toggle every other rail item
                    // gets via isActive below. Clicking a *different* section
                    // while the panel's open just switches to it and leaves
                    // the panel open; only the closed -> open case still
                    // needs the explicit toggleHudPanel call.
                    if (layersOpen && isActive) {
                      toggleHudPanel('layers')
                      return
                    }
                    setSideNavSection(item.id)
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
          </div>
        </nav>

        {/* The collapse toggle. Vertically centered on the rail's own height
            (`top-1/2 -translate-y-1/2` against the `.relative` wrapper above,
            whose height is the nav's — the button itself is absolutely
            positioned so it doesn't contribute to that height). Expanded, it
            drops its own left border/rounding and butts flush against the
            nav's right edge so the two read as one continuous outline rather
            than two stacked panels; collapsed, the nav's border disappears
            entirely (see `border-0` above), so the toggle gets its own full
            border back to stay legible as a standalone control. */}
        <button
          type="button"
          onClick={toggleSideRail}
          title={collapsed ? 'Show sidebar' : 'Hide sidebar'}
          aria-label={collapsed ? 'Show sidebar' : 'Hide sidebar'}
          className={`pointer-events-auto absolute top-1/2 grid h-9 w-5 -translate-y-1/2 place-items-center bg-[rgba(7,11,20,0.92)] text-[#8aa0c6] backdrop-blur-[12px] transition-[left,color] duration-200 ease-out hover:text-white ${
            collapsed
              ? 'left-0 rounded-md border border-[#172440]'
              : 'left-[148px] rounded-r-md border border-l-0 border-[#172440]'
          }`}
        >
          <Icon paths={collapsed ? ICONS.chevronsRight : ICONS.chevronsLeft} size={12} />
        </button>
      </div>
    </div>
  )
}
