// Single source of truth for population/GDP unit-scale formatting
// ("335489204" -> "335 Million", "27400000000000" -> "$27.4 Trillion").
//
// Population/GDP are stored RAW on data/types.ts's Country (populated by
// scripts/buildGovCapitalPopGdp.mjs into data/countryEconomics.ts, merged in
// by scene/useCountryFeatures.ts) specifically so this is the only place
// scale/rounding logic lives — a correction that crosses a unit threshold
// (e.g. a GDP revision that moves a country from "$900 Million" to "$1.1
// Billion") used to require a full data rebuild when countryProfiles.ts
// stored pre-formatted strings; now it's a one-line fix here, or nothing at
// all if only the underlying number changes. hud/IntelligencePanel.tsx is
// the only caller today.

const SIG_FIGS = 3

// 3 significant figures, no trailing zeros (335.489 -> "335", 1.409 -> "1.41", 0.0341 -> "0.0341").
function toSigFigs(n: number): string {
  if (n === 0) return '0'
  return String(Number(n.toPrecision(SIG_FIGS)))
}

interface ScaleTier {
  /** Value, in millions, at which this tier becomes the largest applicable one. */
  thresholdMillions: number
  suffix: string
}

// Picks the largest tier whose threshold `millions` clears, then expresses
// `millions` in that tier's unit. Shared by formatPopulation/formatGdp below
// so their two tier tables are the only thing that differs between them —
// the promotion logic itself (and any future bug in it) lives in one place.
function formatScaled(raw: number, tiers: ScaleTier[]): string {
  const millions = raw / 1e6
  let tier = tiers[0]
  for (const t of tiers) {
    if (millions >= t.thresholdMillions) tier = t
  }
  return `${toSigFigs(millions / tier.thresholdMillions)} ${tier.suffix}`
}

// Population never realistically reaches a trillion for a single country.
const POPULATION_TIERS: ScaleTier[] = [
  { thresholdMillions: 1, suffix: 'Million' },
  { thresholdMillions: 1000, suffix: 'Billion' },
]

// GDP spans all three tiers across the 193 UN members (Tuvalu's is tens of
// millions of USD; the US's is tens of trillions).
const GDP_TIERS: ScaleTier[] = [
  { thresholdMillions: 1, suffix: 'Million' },
  { thresholdMillions: 1000, suffix: 'Billion' },
  { thresholdMillions: 1_000_000, suffix: 'Trillion' },
]

/** Raw headcount -> "42.6 Million" / "1.41 Billion". `undefined` in, `undefined` out — a country with no sourced figure renders no POPULATION row rather than a fabricated one (see IntelligencePanel.tsx). */
export function formatPopulation(raw: number | undefined): string | undefined {
  if (raw == null) return undefined
  return formatScaled(raw, POPULATION_TIERS)
}

/** Raw current-USD -> "$17.8 Billion" / "$2.19 Trillion". `undefined` in, `undefined` out — see formatPopulation. */
export function formatGdp(raw: number | undefined): string | undefined {
  if (raw == null) return undefined
  return `$${formatScaled(raw, GDP_TIERS)}`
}
