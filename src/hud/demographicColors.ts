import { HIGHLIGHT_COLORS } from '../scene/highlightColors'

// 5 slots for SegmentedBar.tsx's ethnicity/religion bars (top 4 groups +
// "Other" — see demographicsGrouping.ts). Reuses 5 of scene/
// highlightColors.ts's existing, already dark-mode/CVD-validated hex values
// directly, rather than inventing a new ad hoc palette — this app has no
// other pre-existing multi-slot categorical color set to draw from. NOT
// added as an 8th slot to HIGHLIGHT_COLORS itself: that file is a closed set
// of exactly 7 ROYGBIV hues for a different, unrelated concept (globe
// selection/relationship highlighting) — same reasoning
// scene/sanctionTierColors.ts / scene/conflictTypeStyles.ts already give for
// living outside it. This palette carries no semantic meaning of its own
// (unlike those two) — a segment's color only ever means "this is the Nth
// group in this bar," independently assigned per SegmentedBar instance.
export const DEMOGRAPHIC_SEGMENT_COLORS: readonly string[] = [
  HIGHLIGHT_COLORS.default.hex,
  HIGHLIGHT_COLORS.hovered.hex,
  HIGHLIGHT_COLORS.territoryOverlay.hex,
  HIGHLIGHT_COLORS.relatedCountry.hex,
  HIGHLIGHT_COLORS.categoryHighlight.hex,
]

// A synthesized "Unknown" segment (demographicsGrouping.ts's
// groupTopFourPlusOther — the source's own figures simply don't add up to
// 100%) is deliberately NOT one of the 5 named-group colors above: cycling
// it in by index would risk landing on the exact same hue as a real,
// specific named group elsewhere in the same bar, reading as "this is
// ANOTHER real category" instead of "this is a data gap." Reuses this app's
// own existing muted "no data" convention (`text-[#51648a]`, the same tone
// IntelRow/AnalyticsPanel already use for an em-dash coverage gap) rather
// than inventing a new gray from scratch.
export const DEMOGRAPHIC_UNKNOWN_COLOR = '#51648a'
