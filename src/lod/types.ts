// The full intended zoom progression for this atlas, per CLAUDE.md's
// "geo-data-engine" roadmap: Earth -> Countries -> States/Provinces ->
// Metro Areas -> Large/Medium/Small Cities -> Every Incorporated City ->
// (future) Roads/Rail/Rivers/Airports/Ports/Military Bases/Infrastructure.
// The seven "future" ids exist in this union NOW, before any of them has
// real geometry or a store behind it, specifically so a future dataset's
// only required change is: give it a real `revealDistance` in
// lodLevels.ts and flip `implemented` to true (see that file) — never a
// second camera/LOD redesign, never a new locally-duplicated distance
// table the way UsCityLabels.tsx's old REVEAL_TIERS was before this.
export type LodLevelId =
  | 'earth'
  | 'countries'
  | 'states'
  | 'metro-areas'
  | 'large-cities'
  | 'medium-cities'
  | 'small-cities'
  | 'every-incorporated-city'
  | 'roads'
  | 'rail'
  | 'rivers'
  | 'airports'
  | 'ports'
  | 'military-bases'
  | 'infrastructure'

export interface LodLevel {
  id: LodLevelId
  // HUD/debug display name, e.g. "Major Metropolitan Areas".
  label: string
  description: string
  // Camera distance at or below which this level is considered active —
  // smaller means "requires more zoom." `null` means "always active
  // regardless of distance": today that's Earth/Countries/States, which
  // aren't progressively revealed (they're cheap enough, at 193/56/294
  // features, to just always render — see CLAUDE.md's Data pipeline
  // section) — not a gap in this system, a deliberate choice not to gate
  // something that doesn't need gating. A future dataset that DOES need
  // distance-gating gives itself a real number here instead.
  revealDistance: number | null
  // False for every reserved-but-not-yet-built id (roads, rail, rivers,
  // airports, ports, military-bases, infrastructure). Kept out of
  // resolveActiveLevels/isLodLevelActive results unconditionally — a
  // reserved id existing in this list is what makes it queryable/typo-safe
  // for future code to reference ahead of time, not a claim that it does
  // anything yet.
  implemented: boolean
}
