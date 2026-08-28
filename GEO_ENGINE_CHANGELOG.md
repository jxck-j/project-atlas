# Geo Data Engine — Changelog

This branch's own changelog — see `GEO_ENGINE_README.md` for why it's
separate from the root `CHANGELOG.md`. Entries here describe work on this
branch only; nothing here has shipped to `main` yet.

## Canada city boundaries — data pipeline (2026-08-27)

Added `scripts/buildCanadaCitiesData.mjs`, producing `public/geo/canada-cities/`
(13 province/territory shards, plain GeoJSON `FeatureCollection`s, same shape
as `us-cities/`) + `public/geo/canada-cities-index.json` (4,931 entries) from
a vendored Statistics Canada 2021 Census Subdivision boundary file. Data only
— no rendering/search/LOD wiring yet, see `GEO_ENGINE_README.md`'s "Not yet
done" note.

- New devDependency: `proj4` (2.21.0) — this source ships in a projected CRS
  (NAD83 / Statistics Canada Lambert), the first vendored geo source in this
  project that isn't already lat/lng.
- New `scripts/lib/canadaProvinces.mjs` — PRUID → abbreviation/name table for
  the 13 provinces/territories, mirroring `usStateCapitals.mjs`'s role.
- `.gitignore` gained a `scripts/vendor/canada/` rule — the raw shapefile
  (~300MB unzipped) is the first vendored source in this project too large to
  commit; every other one has stayed under GitHub's 50MB per-file threshold.
  `scripts/vendor/README.md` documents the fetch-by-hand step this requires.
- Excludes CSDTYPE `'NO'`/`'SNO'` ("Unorganized" / "Subdivision of
  Unorganized" — Statistics Canada's own statistical catch-all for land not
  part of a real named municipality, not settlements themselves): 230 of
  5,161 source CSDs. This was found while chasing a real file-size problem
  (three Unorganized CSDs in Nunavut alone were ~99% of that province's
  unsimplified shard weight — a single one, "Qikiqtaaluk, Unorganized",
  serialized to ~49MB on its own) rather than decided up front; once excluded,
  Nunavut's shard dropped from 19.5MB to 183KB.
- Per-province topojson simplification was added (US cities' script skips
  this entirely, safely, since Census Places are already small per feature —
  Canadian CSDs include huge, low-population rural/northern units that
  aren't). Settled on `SIMPLIFY_QUANTILE = 0.05` after finding, empirically,
  that `topojson-simplify`'s `quantile()` runs the opposite direction from
  what `buildCountryTopology.mjs`'s existing comment describes — see that
  finding written up in `GEO_ENGINE_README.md` and flagged in `BACKLOG.md`.
- Population joined from Statistics Canada Table 98-10-0002-01, fetched
  directly via the StatCan WDS API's `getFullTableDownloadCSV` endpoint
  (`scripts/vendor/canada/population-98100002.zip`, committed — small enough,
  unlike the boundary file). Matched 4,672/4,931 kept CSDs by `DGUID`
  (StatCan's own stable join key across its products — no name-matching pass
  needed, unlike the US script's hand-curated state-capital list).

Verified: `tsc -b --noEmit` and `oxlint` both pass clean (no `src/` files
touched this round). Spot-checked Toronto (43.63°N, 79.44°W, pop. 2,794,356)
and Vancouver (49.22°N, 123.18°W, pop. 662,248) in the generated index against
known real values.

## Canada city boundaries — UI integration (2026-08-27)

Wired the data pipeline above into the running app, mirroring
`UsCityLabels.tsx`/`UsCityOutlineHighlight.tsx`/`useUsCitiesIndex.ts`/
`useUsCityOutline.ts`/`hud/SearchBar.tsx`'s US integration file-for-file (see
`GEO_ENGINE_README.md` for the full file list and why this is a parallel
implementation rather than a shared generalization at this point).

- `hud/selectionStore.ts`: added `caCityOutline`/`flyToCaCity()`, parallel to
  `usCityOutline`/`flyToUsCity()`. Reuses the store's existing
  `flyToTarget`/`flyToTargetSeq` fields — `useCameraFlight.ts` needed zero
  changes, since that mechanism was already generic over "a bare direction,"
  not US-specific.
- `scene/constants.ts`'s `US_CITY_FOCUS_DISTANCE` is now shared by both
  flight paths (comment updated) rather than duplicated — both are "fly to a
  single searched city" flights at the same real-world scale.
- `hud/SearchBar.tsx`: new `canada-city-boundary` search-entry kind, tagged
  `CANADA CITY`. The existing cities.json-dedup logic (skip a
  `cities.json` world-city entry that's really the same place as an indexed
  city) now checks both `usCitiesIndex` and `canadaCitiesIndex`.

**Verified in a running browser**, not just typechecked (dev server +
claude-in-chrome): searched "Toronto" and "Vancouver", confirmed each tags as
`CANADA CITY` with no duplicate bare entry from `cities.json`, clicked
through and confirmed the camera flies there and the correct boundary shape
renders in the correct real-world position, confirmed Escape clears the
outline and reveals the passive population-ranked label in its place, and
confirmed zero console errors through the whole flow. `npm run build` also
verified clean. See `GEO_ENGINE_README.md`'s Canada section for the full
verification note.

## City-tier LOD retune — selecting a country no longer hides its cities, and reveal distances widened (2026-08-27)

**Two separate, cross-cutting fixes**, both reported by real testers (a second person testing the app, and directly by the user), both landing here rather than as one-off Canada tweaks since they affect `UsCityLabels.tsx` identically.

1. `UsCityLabels.tsx`/`CanadaCityLabels.tsx` no longer hide on `selected` (a country/province pick) — only while an actual city outline (either country's) is in focus. Previously mirrored `WaterLabels.tsx`'s blanket "hide on any selection" pattern, which read as "the highlight masks everything" once city labels became real content. `WaterLabels.tsx` itself is unchanged.
2. `src/lod/lodLevels.ts`'s city tiers were re-anchored: `metro-areas` now reveals at `CAMERA_FOCUS_DISTANCE` (4.8) instead of 2.85, with `large-cities`/`medium-cities`/`small-cities` spread out underneath (4.0/3.4/2.9) rather than crammed into a 0.3-unit sliver next to `CAMERA_MIN_DISTANCE`. Previously, selecting a country — the single most common "zoom in" interaction — landed at 4.8 and revealed zero cities regardless of that country's size, reported directly as "you have to zoom in too far to see anything." `every-incorporated-city` (2.52) is unchanged. `lodLevels.test.ts`'s hardcoded boundary-value tests were updated alongside (they're deliberately written to fail on a silent threshold change — see that file's own header comment — so this was an expected, not surprising, test update).

Verified: `tsc -b`/`oxlint`/`vitest` (60/60) all pass, and confirmed live — selected Canada via search, zoomed into the resulting screenshot, and found TORONTO/WINNIPEG/CHICAGO/NEW YORK all rendering immediately at the landing distance with no further zoom.
