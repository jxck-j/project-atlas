// Clamps a value between 0 and 1.
export function clamp01(v: number): number {
  return Math.min(1, Math.max(0, v))
}

export function easeOutCubic(t: number): number {
  const c = clamp01(t)
  return 1 - Math.pow(1 - c, 3)
}

export function easeInOutCubic(t: number): number {
  const c = clamp01(t)
  return c < 0.5 ? 4 * c * c * c : 1 - Math.pow(-2 * c + 2, 3) / 2
}

// Returns the shortest angular delta from `from` to `to` (radians), so an
// azimuth interpolation always takes the short way around instead of
// potentially spinning the long way past ±π.
export function shortestAngleDelta(from: number, to: number): number {
  const twoPi = Math.PI * 2
  let delta = (to - from) % twoPi
  if (delta > Math.PI) delta -= twoPi
  if (delta < -Math.PI) delta += twoPi
  return delta
}
