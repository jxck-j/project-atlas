# News Engine — Design

Design session 2026-09-17 (chat only). **No code yet** — this is the scope/schema/pipeline decision only,
same "design doc precedes implementation" pattern as `infrastructure-layers.md`. This doc is what a future
News Engine build prompt is expected to implement against; update it (don't just discard it) once real code
lands, and fold anything still relevant into `CLAUDE.md` at that point, the same way any other engine's
design ends up documented there once shipped.

Scope: a News tab (`hud/navStore.ts`'s reserved `'news'` `TopNavTab`, currently `wired: false` in
`TopNav.tsx`) plus per-country news surfacing on `IntelligencePanel.tsx`.

**Terrorist/criminal org panels are explicitly deferred to `BACKLOG.md`** — a non-state actor doesn't map
cleanly onto the existing 193-country `GeoEntity` schema (no fixed geography, cross-border presence, would
need a separate ID space). Folding that in now would block the whole feature on a much harder problem.
`news.linkedEntityIds` points only at existing country IDs for v1 — see the topic taxonomy below for how a
non-state-actor event still gets tagged/geo-linked without needing that entity model.

## No scoring metric

Deliberately outside the "sourced or unscored" Intelligence Engine scoring system (Military/Economy/
Technology/Current Status — see `CLAUDE.md`'s Intelligence Engine scoring data section). News items carry no
score contribution; ranking uses severity tier + recency instead of any numeric weight — consistent with
this project's existing refusal to invent unsourced constants, just applied to a non-scored feature.

## Source schema — outlet vs. first-hand, no shared "leaning" field

- `sourceType: "outlet"` — carries `outlet`, `leaning` (left / center-left / center / center-right / right),
  and `leaningSource`. The leaning label itself must trace to a citable framework (AllSides/Ad Fontes), not
  a subjective call — matches this project's existing "the label itself must be defensible" standard.
- `sourceType: "first-hand"` (e.g. Telegram) — gets **no** leaning field. Fixed `label: "First-hand
  account"`, plus `channel`, and an optional factual `affiliationNote` (e.g. "posted by soldier of X unit")
  that describes who's speaking without editorializing.
- Rationale: a leaning badge implies editorial slant; slapping one on raw testimony misrepresents what it
  is. Reflected in UI too — first-hand accounts get a visually distinct badge/section, never interleaved
  with the outlet grid, so first-hand and editorial content are never visually confused.

## Severity-gated publishing — the core integrity mechanism

Not a flat corroboration threshold. Every item gets a `severity` tag (`routine` / `significant` /
`high-stakes`) assigned at ingestion via tag-scoped keyword/entity heuristics (below), confirmed or
overridden manually — same automation+manual-confirm pattern this project already uses for source vetting
elsewhere. The corroboration bar required to publish scales with severity:

- **routine** — `osint-corroborated (2+)` or better auto-publishes; `unconfirmed` stays in a private pending
  queue, never public.
- **significant** — same floor, but flagged for manual confirmation even at `osint-corroborated` before
  going live.
- **high-stakes** (head-of-state death, WMD use, mass-casualty, regime change) — `wire-confirmed` is the
  ONLY publishable state, no override, even with 2+ independent OSINT corroborations. Motivating example: an
  unconfirmed presidential assassination must never publish regardless of how many Telegram sources repeat
  it.

This is a **hard pipeline rule, enforced structurally**, not a per-item judgment call — relying on catching
it manually every time is exactly the failure mode this guards against.

## Wire-tier allowlist — trusted-source bypass on corroboration

A small, fixed allowlist of wire-tier outlets (Reuters, AP, AFP, Bloomberg) — marked via `source.tier: "wire"`
on a `sourceType: "outlet"` item — has its own report set `corroboration: "wire-confirmed"` directly, without
needing the 2+ independent-source accumulation `osint-corroborated` requires. Every other outlet still needs
corroboration count; only an allowlisted wire tier gets its own reporting counted as confirmation on its own.

- Rationale: wire-tier accuracy on high-stakes claims is high enough that requiring independent corroboration
  on top of it would just delay publishing something already reliable.
- The allowlist itself is a source-trust judgment call, same as the leaning-framework requirement above — it
  needs to stay a short, deliberately curated list, not "any outlet that seems reputable," and any addition
  to it should be a deliberate edit to this doc, not an ingestion-time heuristic.
- This narrows, but doesn't eliminate, the failure mode the severity gate exists to guard against — a hacked
  wire-service account or a single-sourced wire error later walked back both bypass the corroboration
  requirement entirely by construction. See `retracted` (below) for how that residual risk is handled after
  publish, since the allowlist can't prevent it before publish.

## Retraction — a fifth `reviewStatus`

`reviewStatus` gains `"retracted"`, alongside the existing three. Applies to any already-published item
(wire-tier-bypassed or not) that the source itself walks back — not just the wire-tier bypass case above, but
that's the main scenario motivating it, since wire-tier bypass is the one path that can publish high-stakes
content with no human in the loop at all before it goes live. A retracted item stays in the dataset
(`snapshotDate`/`url` etc. intact, for audit purposes) but drops out of both ranked lists (panel top-3, News
tab) the same way an unpublished item would — flagged, not deleted.

## Two ranking logics, same underlying rule, different scope/layout

Both panel and tab rank by severity tier first, recency second — one ranking rule, not two separate systems.

- **Intelligence panel**: top 3 for the selected country only, STACKED, with a "more" link out to the News
  tab pre-filtered to that country.
- **News tab**: top 3 for whatever the active filter is (region preset, topic preset, or global default),
  SIDE BY SIDE, YouTube-style layout — a deliberate departure from traditional news-site layout,
  discovery/browsing-oriented rather than a scored readout.
- Below the featured 3 on the News tab: pure recency, no severity weighting.
- **Global default** (no preset selected): ranked by `linkedEntityIds.length` first (trending across the
  most countries simultaneously), then severity/recency within that — chosen over "most severe worldwide"
  specifically to avoid the default view being dominated by whatever's most volatile that day regardless of
  breadth.

## Presets — filters over existing fields, not a new content type

- **Region presets** (e.g. "Middle East") are saved bundles of country IDs — implies a `region` tag needs to
  exist on countries (add if not already present) so presets can be defined by region rather than
  hand-listed IDs.
- **Topic presets** (e.g. "Conflict & Security," "Economic & Trade") use the `topicTags` field on
  `NewsItem`, defined below at schema time rather than retrofitted onto already-ingested items later.
- All filtering is client-side over static JSON — no new backend, consistent with this project's
  zero-runtime-network-calls architecture (see `CLAUDE.md`'s Data pipeline section for the existing
  build-time-asset precedent this follows).

## Topic taxonomy — seven tags

`topicTags` describes what kind of event a news item is, deliberately orthogonal to the existing
Military/Economy/Technology/Current Status scoring dimensions rather than mirroring them. Kept to seven
rather than a longer list — group by category, don't pad past what's needed. Items can carry multiple tags
(e.g. a cartel attack: Crime & Trafficking + Conflict & Security).

1. Conflict & Security
2. Terrorism & Non-State Actors — exists as a tag even though org *panels* remain deferred to backlog; an
   item can be tagged and geo-linked to whichever country it occurred in without needing the separate
   non-state-actor entity model.
3. Diplomacy & Politics
4. Economic & Trade
5. Humanitarian & Displacement — flagged to cross-reference `linkedEntityIds`/`originId`/`destinationId`
   conventions against the already-planned `DisplacementFlow` model once both exist, to avoid two
   incompatible geo-linking schemes for related data.
6. Crime & Trafficking
7. Science & Technology

## Severity heuristics — scoped per-tag, not one flat keyword list

"High-stakes" means something different depending on topic:

- **Conflict & Security / Terrorism & Non-State Actors**: head-of-state/government casualty language, the
  mass-casualty threshold (below), WMD/chemical/nuclear terms, capital-city/embassy attack mentions.
- **Diplomacy & Politics**: regime-change language (coup, overthrow, forced resignation of a head of state),
  war-declaration language, withdrawal from major security pacts (NATO, nuclear treaties).
- **Economic & Trade**: sovereign default, currency-collapse language, major sanctions-regime changes —
  genuinely rare for this tag to reach high-stakes; caps out at `significant` in most cases.
- **Humanitarian & Displacement**: mass-casualty disaster thresholds, PHEIC-equivalent outbreak-declaration
  language.
- **Crime & Trafficking / Science & Technology**: not high-stakes on their own; only reach it by
  co-occurring with another tag's trigger (e.g. a cyberattack on critical infrastructure crossing into
  Conflict & Security).
- **Fallback** for anything not matching a trigger: `significant` if it names a country leader, government
  body, or military unit; `routine` otherwise.

Deliberately coarse — the manual confirmation step catches misclassification, so the heuristic doesn't need
to be precise on its own; same automation+confirm pattern used for source vetting elsewhere in this project.

## Single-event death threshold — separate from UCDP, not claimed as citable

UCDP's 25+ battle-related-deaths/*year* threshold (already used for Current Status conflict inclusion — see
`CLAUDE.md`'s Current Status section) measures a different thing than a single incident: a slow-burn
conflict crossing 25/year is not the same signal as one attack killing 25 in a day. **10+ deaths in a single
reported incident** is the news-level high-stakes trigger for Conflict & Security / Terrorism & Non-State
Actors, independent of whether the underlying conflict has crossed the UCDP annual threshold.

**Explicitly logged as an internally-set judgment call, not a borrowed/citable figure the way UCDP's number
is** — if this project's "sourced or unscored" defensibility standard is ever applied to non-scored features
too, this threshold is the one that would need its own justification on record, not an existing citation to
point to.

## Build cadence

3-4x/day, via a scheduled `buildNews.mjs` re-run — same static-pipeline pattern as every other `buildX.mjs`
script in this project, just cron-triggered on a recurring schedule instead of run once/as-needed. **This
does not violate the zero-runtime-calls architecture** (the app still only ever fetches static JSON at
runtime) — it's this project's first *recurring* build rather than a one-off, worth folding into `CLAUDE.md`'s
Commands section once implemented.

## Draft `NewsItem` schema (fields settled, not yet implemented)

```
NewsItem {
  id, headline, summary, linkedEntityIds, topicTags,
  severity,       // "routine" | "significant" | "high-stakes"
  sourceType,     // "outlet" | "first-hand"
  source: { outlet?, leaning?, leaningSource?, tier?, channel?, affiliationNote? },
  corroboration,  // "wire-confirmed" | "osint-corroborated (2+)" | "unconfirmed"
  reviewStatus,   // "auto-published" | "pending-confirmation" | "manual-only" | "retracted"
  snapshotDate, url
}
```

`source.tier` (on `sourceType: "outlet"` items) is `"wire"` for an allowlisted wire-tier outlet
(Reuters/AP/AFP/Bloomberg — see the wire-tier allowlist section above) and unset otherwise; it's what lets
`corroboration` be set to `"wire-confirmed"` from that single report rather than requiring independent
corroboration count.

## Pending-confirmation queue — internal ops view only (decided 2026-09-17)

Resolves the "visible queue?" question below in favor of a queue, but scoped narrowly: it's a curation tool
for whoever operates this pipeline, never reader-facing. Surfacing unconfirmed high-stakes claims to News tab
readers — even labeled "developing/unconfirmed" — would undercut the entire reason the severity gate exists;
the value here is giving a human a punch list of `reviewStatus === "pending-confirmation"` items to actively
chase down (call sources, watch wires), not giving readers unverified claims.

Implementation: a filtered render over the same static JSON, gated behind `import.meta.env.DEV` and eliminated
from production builds — the same internal-tooling pattern `hud/selectionStore.ts`'s
`window.__debugSelectEntity` console helper already establishes elsewhere in this project, not a new backend
or a second data path.

## Open before this becomes a build prompt

- None currently open.
