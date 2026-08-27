# Geo Data Engine — prototyping notes

This branch's own doc set — separate from the root `README.md`/`CHANGELOG.md`/
`BACKLOG.md`, which describe only `main`'s shipped state (see the root
`CLAUDE.md`'s "Branch context" section). Content here is expected to include
false starts and reworks that wouldn't normally show up in `main`'s history.
When this branch (or specific pieces of it) is promoted, the promoting change
folds the relevant sections below into the root docs and retires this file —
it isn't meant to run in parallel with them indefinitely.

Reset to match `main`'s tip on 2026-07-28 (after the v4.3.1–v4.5.0
promotion), then picked up lakes/rivers overlay layers (already landed,
`e86c1f3`, no write-up here since that predates this file's creation) before
the current round of work below.

## In progress: per-country city boundaries beyond the US

`buildUsCitiesData.mjs`'s US city-boundary approach (sharded-by-region output,
on-demand single-boundary fetch — see that file's own header comment for why
an earlier always-on-merged-layer version was reworked) is being extended to
other countries, one at a time. Scope for this round: **Canada and Mexico**
(North America's two other largest countries) — not the rest of the
continent, whose data quality/availability varies too much to take on in the
same pass. See `LOGBOOK.md`'s entry for the full reasoning behind that scope
call and the branch-vs-main decision.

### Canada — data pipeline AND UI integration both done

`scripts/buildCanadaCitiesData.mjs` + `scripts/vendor/canada/` (see
`scripts/vendor/README.md`) produce `public/geo/canada-cities/` (13
province/territory shards) + `public/geo/canada-cities-index.json` — the
direct Canadian counterpart to `us-cities/`/`us-cities-index.json`.

UI integration mirrors the US city wiring file-for-file, as a deliberately
parallel implementation rather than a shared generalization (see
`useCanadaCitiesIndex.ts`'s header comment for why — generalize once Mexico
is a real third caller, not before): `useCanadaCitiesIndex.ts`,
`useCanadaCityOutline.ts`, `CanadaCityLabels.tsx`,
`CanadaCityOutlineHighlight.tsx`, plus a `caCityOutline`/`flyToCaCity()`
addition to `hud/selectionStore.ts` (parallel to `usCityOutline`/
`flyToUsCity()`, sharing the store's existing generic `flyToTarget`
mechanism rather than needing new camera-flight code), a mount in
`Globe.tsx`, and a `canada-city-boundary` search-entry kind in
`hud/SearchBar.tsx` (including the same cities.json-dedup treatment
`us-city-boundary` gets, extended to check both indexes).

**Verified for real, not just typechecked:** `tsc -b`/`oxlint`/`vitest`/
`npm run build` all pass, AND driven in an actual browser (dev server +
claude-in-chrome) — searched "Toronto"/"Vancouver", confirmed the
`CANADA CITY` tag and no duplicate bare "Vancouver" entry from cities.json,
clicked through, confirmed the camera flight + boundary outline render
correctly positioned (Vancouver's outline sits right at the real peninsula
tip relative to Vancouver Island/the Strait of Georgia), confirmed Escape
clears the outline and reveals the passive population-ranked label instead,
and confirmed no console errors through the whole flow. This is NOT one of
the pre-v3.3.0-pattern "verified only by typecheck, never actually seen
rendered" entries `BACKLOG.md`'s "Not yet verified" section tracks.

**Real decisions made building the data pipeline** (see
`scripts/buildCanadaCitiesData.mjs`'s and `scripts/vendor/README.md`'s own
comments for the full detail, `LOGBOOK.md` for the narrative):

- The raw StatCan shapefile (~300MB unzipped) is **not committed** —
  gitignored, fetched by hand, unlike every other `scripts/vendor/` source.
  Only this script's output ships.
- The source is in a projected CRS (NAD83 / Statistics Canada Lambert), not
  lat/lng like every other geo source this project has used — `proj4`
  (new devDependency) reprojects at build time.
- CSDs typed `'NO'`/`'SNO'` (Statistics Canada's own "Unorganized" statistical
  catch-all, not real settlements) are excluded — both a legitimate "this
  isn't a place" call and the fix for a real problem: three of them in
  Nunavut alone accounted for ~99% of that province's file size before this
  filter existed.
- Per-province topology simplification was necessary (unlike
  `buildUsCitiesData.mjs`, which skips simplification entirely — US Census
  Places are already small/compact per feature). Tuning this surfaced a real
  misunderstanding of `topojson-simplify`'s `quantile()` direction worth
  flagging: **a lower `SIMPLIFY_QUANTILE` is the more aggressive setting**
  (fewer points survive), not a higher one. This is the opposite of what
  `buildCountryTopology.mjs`'s existing comment says ("raise it for more
  aggressive simplification") — that comment appears to describe the
  intended/documented behavior rather than the library's actual behavior;
  0.35 clearly still produces visually-correct country borders in production,
  so this is a doc-accuracy issue there, not a functional bug, and wasn't
  chased further here since it's out of this branch's scope. Flagged in
  `BACKLOG.md` for whoever next touches that constant.

### Mexico — not started

No research done yet this round beyond confirming INEGI's Marco Geoestadístico
doesn't have as direct a download path as StatCan's — its `municipios` layer
is admin-2/county-equivalent, not city-level, and the closer match (urban
localities) needs more portal digging to pin down a stable direct URL. Next
session's starting point.
