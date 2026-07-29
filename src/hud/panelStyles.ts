// Single source of truth for the HUD's glass-panel chrome — the exact
// values the design reference defines once as `.panel` / `.panel-head` /
// `.ph-title` and every panel in that mockup reuses. Same reasoning as
// scene/highlightColors.ts: the alternative is six files each carrying
// their own copy of the same blur/border/shadow triple, which is exactly
// how two panels end up a pixel apart the first time one gets tweaked.
//
// Deliberately plain class-name strings, not a component — panels differ
// in layout, positioning, and content, and only agree on their chrome.
// Wrapping them in a shared <Panel> would force a component boundary
// through code that has no other reason to share one.

// `.panel` — rgba(7,11,20,0.92) fill, 1px #172440 border, 8px radius,
// 12px backdrop blur, and the drop + inset top-highlight shadow pair that
// gives the panel its lit-glass edge.
export const PANEL_SURFACE =
  'rounded-lg border border-[#172440] bg-[rgba(7,11,20,0.92)] backdrop-blur-[12px] ' +
  'shadow-[0_10px_34px_rgba(0,0,0,0.55),inset_0_1px_0_rgba(120,160,230,0.06)]'

// `.panel-head` — 10px/12px padding with a hairline rule under it.
export const PANEL_HEAD =
  'flex items-center justify-between border-b border-[#16233c] px-3 py-2.5'

// `.ph-title` — 11.5px/700/1.4px-tracking, the reference's panel-title voice.
export const PANEL_TITLE =
  'text-[11.5px] font-bold tracking-[0.12em] text-[#dce8fb]'

// `.cp-label` — the section label inside a panel body (10px/700/2px
// tracking, dimmer than a panel title so section headers read as
// subordinate to the panel's own heading).
export const PANEL_SECTION_LABEL =
  'text-[10px] font-bold tracking-[0.2em] text-[#5a79ab]'
