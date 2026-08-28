import { useMemo } from 'react'
import type { DemographicGroup } from '../data/currentStatus'
import { groupTopFourPlusOther, type DemographicDisplaySegment } from './demographicsGrouping'
import { DEMOGRAPHIC_SEGMENT_COLORS, DEMOGRAPHIC_UNKNOWN_COLOR } from './demographicColors'

// A single-row 100% stacked segmented bar + legend, for an ethnicity or
// religion breakdown (IntelligencePanel.tsx's Demographics sub-section).
// Grouping into top-4-plus-"Other"-plus-"Unknown" happens here (via
// demographicsGrouping.ts), not in the caller — SegmentedBar owns the whole
// "raw list in, bar+legend out" transform so a caller never has to know that
// convention exists. Two independent instances (ethnicity, religion) each
// get their own color assignment by segment INDEX, not by group name —
// "sharing the component but independent color assignment per section" is
// what falls out naturally from that, with no shared state between
// instances required. "Unknown" is the one segment that's never indexed
// into that per-instance palette — see segmentColor below.
function segmentColor(segment: DemographicDisplaySegment, index: number): string {
  if (segment.name === 'Unknown') return DEMOGRAPHIC_UNKNOWN_COLOR
  return DEMOGRAPHIC_SEGMENT_COLORS[index % DEMOGRAPHIC_SEGMENT_COLORS.length]
}

// "Other" gets a real tooltip (its actual constituent groups); "Unknown" —
// a synthesized remainder, no breakdown to list — gets a short fixed
// explanation instead, so hovering it doesn't read as unlabeled/broken.
function segmentTooltip(segment: DemographicDisplaySegment): string | undefined {
  if (segment.breakdown) {
    const lines = segment.breakdown.map((g) => `${g.name} — ${g.pct.toFixed(1)}%`)
    return [`Other (${segment.pct.toFixed(1)}%):`, ...lines].join('\n')
  }
  if (segment.name === 'Unknown') {
    return `Unknown (${segment.pct.toFixed(1)}%): not reported by the source data`
  }
  return undefined
}

export function SegmentedBar({ groups }: { groups: DemographicGroup[] }) {
  const segments = useMemo(() => groupTopFourPlusOther(groups), [groups])
  if (segments.length === 0) return null

  // A source's raw percentages can genuinely sum past 100% — ARDA's
  // "double affiliation" religion data for several countries (South Korea's
  // real Buddhist/Confucianist/folk-religion overlap, several Pacific
  // nations' syncretic Christian denominations) sums to 110-145%, a real,
  // verified characteristic of the source, not a parsing bug. Rendered
  // WIDTHS are scaled down proportionally so segments can never overflow
  // this bar's fixed 100%-wide track (every `shrink-0` child would
  // otherwise get silently clipped by `overflow-hidden` past the
  // container's edge) — the LABEL/tooltip text below still shows each
  // segment's true, unscaled percentage, since scaling that would
  // misrepresent the real reported figure. A normal (<=100%) total scales
  // by exactly 1, so this changes nothing for the overwhelmingly common
  // case.
  const totalPct = segments.reduce((sum, segment) => sum + segment.pct, 0)
  const widthScale = totalPct > 100 ? 100 / totalPct : 1

  return (
    <div>
      <div className="flex h-[7px] w-full overflow-hidden rounded-full bg-[#0b1220]">
        {segments.map((segment, i) => {
          const color = segmentColor(segment, i)
          const tooltip = segmentTooltip(segment)
          const width = `${segment.pct * widthScale}%`
          return tooltip ? (
            <button
              key={segment.name}
              type="button"
              title={tooltip}
              style={{ width, backgroundColor: color }}
              className="h-full shrink-0"
            />
          ) : (
            <div key={segment.name} style={{ width, backgroundColor: color }} className="h-full shrink-0" />
          )
        })}
      </div>
      <div className="mt-1.5 flex flex-wrap gap-x-3 gap-y-1">
        {segments.map((segment, i) => {
          const color = segmentColor(segment, i)
          return (
            <span
              key={segment.name}
              title={segmentTooltip(segment)}
              className="flex items-center gap-1 text-[9.5px] text-[#aebfdc]"
            >
              <span className="h-[7px] w-[7px] shrink-0 rounded-full" style={{ backgroundColor: color }} />
              {segment.name} <span className="text-[#51648a]">{segment.pct.toFixed(1)}%</span>
            </span>
          )
        })}
      </div>
    </div>
  )
}
