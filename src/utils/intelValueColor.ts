// Shared red(0)->amber(50)->green(100) interpolation for a 0-100
// Intelligence Engine score. Originally private to hud/IntelligencePanel.tsx
// (its IntelRow bar fill + value text); hud/AnalyticsPanel.tsx's ranked-list
// rows need the exact same mapping so a country's color reads identically
// whether it's seen on the status bar or in the ranked list — pulled out
// here rather than duplicated, same reasoning as scene/highlightColors.ts
// being the one place selection/overlay colors live.
const INTEL_RED = { r: 0xef, g: 0x44, b: 0x44 }
const INTEL_AMBER = { r: 0xf5, g: 0x9e, b: 0x0b }
const INTEL_GREEN = { r: 0x22, g: 0xc5, b: 0x5e }

export function intelValueColor(value: number): string {
  const clamped = Math.max(0, Math.min(100, value))
  const [from, to, t] =
    clamped <= 50 ? [INTEL_RED, INTEL_AMBER, clamped / 50] : [INTEL_AMBER, INTEL_GREEN, (clamped - 50) / 50]
  const lerp = (a: number, b: number) => Math.round(a + (b - a) * t)
  return `rgb(${lerp(from.r, to.r)}, ${lerp(from.g, to.g)}, ${lerp(from.b, to.b)})`
}
