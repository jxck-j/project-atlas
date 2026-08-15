import { ALLIANCES, type AllianceType } from '../data/allianceMemberships'
import { AllianceBadge } from './AllianceBadge'
import { useHudPanel } from './hudPanelStore'
import { PANEL_HEAD, PANEL_SURFACE, PANEL_TITLE, PANEL_SECTION_LABEL } from './panelStyles'

// Opened from SideRail.tsx's ALLIANCES tab (see sideNavItems.ts's `panel:
// 'alliances'`) — deliberately a dedicated panel, not another LayerPanel
// category, because "show me every alliance at once as clickable pills" and
// "toggle a globe layer on/off" are different interactions; LayerPanel's
// row-per-toggle layout doesn't fit a browse-and-click-a-pill UI. Same
// fixed-position slot LayerPanel uses (immediately right of SideRail) since
// the two are mutually exclusive — only one HudPanel is ever open at a time.
const TYPE_LABEL: Record<AllianceType, string> = {
  security: 'SECURITY',
  economic: 'ECONOMIC',
  'political-forum': 'POLITICAL FORUM',
  trade: 'TRADE',
}

function groupByType(alliances: typeof ALLIANCES): [AllianceType, typeof ALLIANCES][] {
  const groups = new Map<AllianceType, typeof ALLIANCES>()
  for (const alliance of alliances) {
    const list = groups.get(alliance.type) ?? []
    list.push(alliance)
    groups.set(alliance.type, list)
  }
  return Array.from(groups.entries())
}

export function AlliancesPanel() {
  const isOpen = useHudPanel() === 'alliances'
  if (!isOpen) return null

  return (
    <div className="pointer-events-auto fixed top-[72px] left-[168px] z-30 w-64 md:w-72">
      <div className={PANEL_SURFACE}>
        <div className={PANEL_HEAD}>
          <span className={PANEL_TITLE}>ALLIANCES</span>
          <span className="text-[9px] tracking-[0.18em] text-[#4d95ff]">{ALLIANCES.length}</span>
        </div>

        <div className="max-h-[60vh] overflow-y-auto px-3 py-2">
          {groupByType(ALLIANCES).map(([type, alliances]) => (
            <div key={type} className="py-1.5">
              <div className={`${PANEL_SECTION_LABEL} mb-1.5`}>{TYPE_LABEL[type]}</div>
              <div className="flex flex-wrap gap-1.5">
                {alliances.map((alliance) => (
                  <AllianceBadge key={alliance.id} alliance={alliance} />
                ))}
              </div>
            </div>
          ))}
        </div>

        <div className="border-t border-[#16233c] px-3 py-2 text-[9.5px] leading-snug text-[#51648a]">
          Click a badge to highlight its member countries on the globe. Click again to clear.
        </div>
      </div>
    </div>
  )
}
