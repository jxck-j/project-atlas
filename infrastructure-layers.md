# Infrastructure Layers — Scope

Confirmed 2026-08-27. This is the scope decision only — which infrastructure
domains Project Atlas will visualize. Data source selection for each layer is
a separate, later pass and follows the same "sourced or unscored" discipline
as the Intelligence Engine: a layer doesn't render until a named, public,
citable dataset backs it.

These layers sit under the Layer Engine (`src/layers/`, added in v2.0), which
already has an `infrastructure` placeholder category registered. This doc is
what that placeholder gets filled in with, category by category, when each
layer is actually scheduled for implementation.

## Transport

1. Rail networks (lines/routes)
2. Major train stations (point markers)
3. Seaports (major commercial ports)
4. Airports (major international hubs)
5. Road networks (highways/major arteries)
6. Border crossings (land ports of entry)

## Energy

7. Oil/gas pipelines
8. Power plants (nuclear specifically, given the intel/defense framing)
9. Electrical grid interconnections

## Communications

10. Submarine internet cables
11. Satellite ground stations

## Military-adjacent

12. Military bases (foreign-deployed, e.g. US overseas bases) — spot-checked
    2026-09-03 against 7 named Jordan/Kuwait installations; real
    base-perimeter polygons exist in OSM, not just points. See Rendering
    mechanism below for the reveal treatment and a real tag-scheme gap this
    check surfaced.
13. Naval chokepoints (straits, canals — Hormuz, Malacca, Suez, Panama)

## Strategic resources

14. Critical mineral extraction sites (rare earths, lithium, etc.)

## Medical/Humanitarian

15. Hospitals — scope confirmed as **all hospitals**, not major/trauma-center
    only. This is a much larger dataset than every other layer on this list
    (hundreds of thousands of facilities vs. hundreds/low-thousands for
    ports, bases, cables, etc.) — worth revisiting if that scale becomes a
    performance or clutter problem once implemented. Likely source is
    OpenStreetMap's Healthsites.io (global, facility-level) rather than WHO's
    Global Health Observatory (more authoritative but far less complete
    coverage) — not yet locked, and Healthsites.io being crowd-sourced rather
    than a single authoritative body is a real tension against this
    project's "sourced or unscored" bar, to be resolved when this layer is
    actually scheduled.

## Rendering mechanism

- **Lines/routes:** rail, pipelines, roads, submarine cables, electrical grid
  interconnections (may end up point-to-point route geometry rather than a
  literal grid mesh — undecided).
- **Points:** train stations, seaports, airports, border crossings, power
  plants, satellite ground stations, mineral extraction sites, hospitals.
  Point layers render as a colored dot at rest; an icon glyph appears only
  on hover/select (mirroring the existing `Cities.tsx` point-marker
  pattern) rather than baking a distinct icon shape into every dot at rest,
  to avoid visual clutter when multiple point layers are on at once. Icon
  style (simple monoline glyph vs. other treatments) not yet decided.
- **Points → polygon-on-zoom (military bases, moved out of the flat Points
  list above):** confirmed as a real exception, not a nice-to-have — spot-
  checked 2026-09-03 via Overpass/Nominatim against 7 named installations
  (Muwaffaq Salti/Azraq and Prince Hassan and King Faisal air bases in
  Jordan; Ali Al Salem and Ahmed Al Jaber air bases, Camp Arifjan, Camp
  Buehring in Kuwait). All 7 resolved as real OSM `way`/`relation` polygon
  geometry (actual base-perimeter shapes), not bare points — Jordan alone
  has 99+ separately-mapped military features in a single bounded query,
  Kuwait 200+. Renders as a colored dot at distance like every other
  Points-category item, but reveals the real perimeter polygon at a
  city-scale zoom threshold — the same `PointerMarker`-dot /
  `EntityRenderLayer`-or-`ProvinceFillLayer`-style-merged-mesh reveal
  pattern already proven elsewhere in this app (see `CLAUDE.md`'s
  "StatesProvinces.tsx grew its own rendering path" for why merged-mesh
  hit-testing, not one-mesh-per-entity, is the right template once feature
  count gets large), not a new mechanism to invent.

  **Real gap this check surfaced: a `military=*`/`landuse=military` tag
  filter alone silently misses real bases.** Ali Al Salem and Muwaffaq
  Salti are both tagged as ordinary `aeroway=aerodrome` with no military key
  at all; Camp Arifjan is tagged `boundary=administrative`. A tag-only
  sweep would miss all three. The real extraction needs to union
  `landuse=military`, `military=*`, `aeroway=aerodrome`, and
  `boundary=administrative`, then cross-reference against a curated list of
  known military/joint-use installation names — "is this airfield
  military" isn't reliably recoverable from OSM's own tags alone in every
  case, so this layer can't be a pure attribute filter the way, say, a
  `landuse=military`-only query would naively suggest.
- **Regions:** naval chokepoints (small ocean areas, not points or lines) —
  rendering approach not yet decided.

## Layer toggling

Each of the 15 infrastructure types gets its **own** Layer Panel toggle —
confirmed. This has an open reconciliation item against existing
architecture: the LOD Engine's zoom ladder (`lod/types.ts`) already has a
reserved `Infrastructure` level bundling Roads/Rail/Airports/Ports/Military
Bases together as one zoom-gated reveal, which conflicts with "each type is
independently toggleable" as designed here. Needs resolving when this is
scheduled — likely candidates are splitting that LOD bundle apart per type,
or having LOD gate *visibility at a distance* while the Layer Panel toggle
gates *whether the layer is on at all* (both systems active, different
axes) — not decided.

## Color palette (by domain group)

Grouped by domain rather than 14–15 independent hues, mirroring how sanction
tiers and conflict types already get their own small closed palettes kept
separate from the app's core 7-hue ROYGBIV selection-state set
(`scene/highlightColors.ts`). Within a domain, line vs. point layers are
differentiated by shape/marker, not by a different hue.

| Domain | Base hue | Items |
|---|---|---|
| Transport | Steel gray / silver | rail, train stations, roads, border crossings, airports |
| Energy | Rust / burnt amber | pipelines, power plants, grid interconnections |
| Communications | Pink → magenta family | submarine cables (pink), satellite ground stations (deeper magenta) |
| Military-adjacent | Maroon / dark crimson | military bases, naval chokepoints |
| Strategic resources | Gold / bronze | mineral extraction sites |
| Medical/Humanitarian | Mint / medical teal | hospitals |

Exact hex values not yet locked — to be validated with the dataviz skill's
palette checker (CVD separation + normal-vision distinctness) against the
app's actual near-black surface before implementation, the same process
used for the v5.1.0 ROYGBIV retune.

## Status

- **Scope:** locked — 15 layers total (original 14 + hospitals, added
  2026-08-27).
- **Data sourcing:** not started for any layer except the informal notes
  above for hospitals and military bases (item 12 — real spot-check, not
  just a candidate-source guess, but still not a formal sourcing pass with
  rejected alternatives). Each layer needs its own source-investigation
  pass before implementation, the same way Military/Economy/Technology each
  had a documented sourcing search (including rejected candidates) before
  their build scripts were written.
- **Sequencing:** not decided. No layer here is prioritized over another yet.
