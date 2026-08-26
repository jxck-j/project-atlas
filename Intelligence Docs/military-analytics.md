# Military — Scoring Methodology

**Status:** implemented, live. **Source of truth for behavior:** `scripts/buildMilitary.mjs` — if this doc
and the script ever disagree, the script is correct and this doc is stale; re-read the script's own comments
before trusting anything below.
**Generates:** `src/data/militaryScores.ts`, consumed by `hud/IntelligencePanel.tsx`'s MILITARY status bar
(with citation drill-down) and `hud/AnalyticsPanel.tsx`'s MILITARY ranked list.
**Locked design / governing principles:** `Intelligence Docs/intelligence-engine-scoring-design.md` §2
(applies to every category) and §3.1 (Military's original spec — this doc documents where the
*implementation* has since diverged from that spec, and why).
**Full change history / real-output reasoning trail:** `LOGBOOK.md` (search "Military") — this doc explains
the *current* logic; LOGBOOK explains *why it changed*, with real numbers.

This is the first of a per-category series — see `economics-analytics.md`, `technology-analytics.md`, and
`current-status-analytics.md` for the same treatment of Economy, Technology, and Current Status. Diplomacy
will get its own `diplomacy-analytics.md` once it's built.

---

## 1. What this measures

One 0–100 composite score per UN member country (193 total — no non-UN entities, unlike Economy's Taiwan
exception), reflecting aggregate military **scale and resourcing**, not readiness, doctrine, morale, alliance
strength, or any single recent event. Per Governing Principle 2 (design doc §2), this is deliberately a
composite of durable, structural inputs rather than anything a headline could move overnight.

## 2. Components at a glance

| # | Component | Source | Coverage | Zero type | Weight |
|---|---|---|---|---|---|
| 1 | Military expenditure ($, current) | SIPRI Military Expenditure Database | ~170 countries | Coverage-gap | **2×** |
| 2 | Defense spending (% of GDP) | World Bank WDI (`MS.MIL.XPND.GD.ZS`) | ~170 countries | Coverage-gap | 1× |
| 3 | Military personnel (active) | World Bank WDI, falls back to CIA Factbook archive text | ~150–170 countries | Coverage-gap | 1× |
| 4 | Nuclear warheads | FAS Nuclear Notebook (hand-transcribed aggregate page) | 9 countries | **True-zero** | 1× |
| 5 | Defense-industrial base revenue | SIPRI Top 100 Arms-Producing Companies (summed by HQ country) | ~25–40 countries | **True-zero** | 1× |
| — | Air fleet size | FlightGlobal World Air Forces | — | **Backlogged** — paid subscription paywall, no free citable equivalent found |
| — | Arms import/export dependency (TIV) | SIPRI Arms Transfers Database | ~150+ countries | **Annotation only** — sourced and shown, not blended into the score |

Two components from the original 7-component locked design (§3.1) are not in the composite: air fleet was
never implemented (a real, confirmed paywall, not a scraping difficulty — see §8), and arms import/export
dependency was implemented then demoted after real output exposed a problem its own math couldn't resolve
(see §9). Everything below describes the 5 that are actually scored, plus why those two aren't.

## 3. Normalization: log-min-max, for every scored component

```
epsilon = 1% of the smallest nonzero raw value in this component's own dataset
lnMin   = ln(min(raw values) + epsilon)
lnMax   = ln(max(raw values) + epsilon)
score   = 100 × (ln(raw + epsilon) − lnMin) / (lnMax − lnMin)
```

Applied per-component, independently, across every country with a real value for that component (`buildNormalizer` in `scripts/buildMilitary.mjs`).

**Why log-min-max, not percentile rank:** every Military component is a magnitude — dollars, personnel
counts, warhead counts, revenue — where the raw size of the gap between two countries is itself meaningful
information. The US's ~$1T defense budget isn't just "ranked above" a $10B budget, it's two orders of
magnitude larger, and a scoring method should be able to say so. Percentile rank (used elsewhere in this
codebase — see `economics-analytics.md` §3.1) only ever encodes *order*: the largest value in a 190-country
dataset scores 100 whether it's 10% or 10,000% bigger than the next one down. Military's raw values span
genuinely enormous ranges (a handful of countries with negligible militaries up through the US/China), so
log-min-max is what lets the *sizes* of those gaps still show up in the 0–100 score, while the log transform
keeps a handful of extreme outliers from squashing everyone else into the bottom few points of the scale.

**Epsilon exists for one reason:** the log of 0 is undefined (`-Infinity`), and a country can genuinely have
a raw value of 0 for a true-zero component (see §5). Deriving epsilon from the dataset itself (1% of the
smallest *nonzero* value observed) rather than a fixed constant keeps it proportionate to whatever scale that
particular component's real values happen to live at — a fixed epsilon that works for warhead counts (single
digits to low thousands) would be meaningless for expenditure (billions).

## 4. Weighting

**Default: equal weight**, per Governing Principle 6 (design doc §2) — "absent a published, citable
weighting framework, default to equal weighting." No component gets extra influence just because it feels
more important; an unequal weight is a claim that needs the same sourcing discipline real data does.

**Exception, on the record: expenditure is double-weighted.** Reviewing real generated output showed
countries with extreme %GDP or personnel figures — relative to their actual resource-pool size, often driven
by conscription or genuine economic strain, not real capability — outranking countries with far larger
absolute military resources. Expenditure is the hardest of the 5 scored components to inflate artificially,
so its log-min-max score is counted **twice** in the composite average instead of once. This is a
**documented exception** to Governing Principle 6, not something that satisfies it — there's no citable
external framework behind the 2× factor, only a judgment call made after looking at real output, on the same
basis the arms-import-TIV demotion in §9 used. If expenditure itself is the country's missing value, both
copies are dropped from the average — never a partial or half-weight.

## 5. Zero classification: true-zero vs. coverage-gap

The central question for any missing value: **does the absence mean the country genuinely has none of this
thing, or that nobody measured it?** Getting this wrong in either direction distorts both the coverage floor
and the composite:

- **True-zero** (nuclear warheads, defense-industrial base revenue): most countries genuinely have zero of
  these — no nuclear arsenal, no company in SIPRI's Top 100. A missing entry here is set to a real `0` and
  always participates in normalization and the composite; it is not treated as a data gap, because it isn't
  one.
- **Coverage-gap** (expenditure, %GDP, personnel): every country is assumed to have *some* real nonzero
  value for these — every functioning military spends something — so a missing entry means the data wasn't
  found, not that the true value is zero. It's excluded from both the coverage floor count and the composite
  average entirely, rather than being treated as a 0 (which would falsely tank that country's score) or
  interpolated (which this project's Governing Principle 5 rules out outright: "missing data ships as
  missing").

## 6. Coverage floor & confidence tiers

Only the 3 coverage-gap components count toward this floor (true-zero components always have a real value,
so they can't be "missing" in the sense this floor cares about):

- `coveragePresent = 3 of 3` → **`measured`**
- `coveragePresent = 2 of 3` → **`proxy`** — floor met, not full coverage; `IntelRow` tags this with a
  `PROXY` label in the UI so it never reads with the same confidence as a fully-measured score.
- `coveragePresent < 2` → **`unavailable`** — `value` is `null`, the status bar stays empty. No partial
  composite is computed and then hidden behind the tag.

## 7. No-standing-military override

A small set of countries genuinely have no standing military at all — a confirmed fact, not a data gap that
happens to read as zero. These bypass normal scoring entirely: every component is set to a verified `0`, the
composite is exactly `0.0`, and the record carries `confirmed: true` plus a `confirmedNote` citing the
specific source — visually and structurally distinguishable in the data from "coverage floor not met."

**Sourcing requirement:** primary sources only (national constitutions, direct CIA World Factbook entries) —
never a Wikipedia-style compiled list taken as-is, even one that claims to cite the Factbook itself. This
requirement caught a real error: a public "Countries Without a Military" table was used only to generate
*candidates*, and each one was individually re-verified against the actual Factbook entry before being added.
**San Marino was rejected** despite appearing on that candidate list — the Factbook names a real,
currently-serving military (the "San Marino Military Corps"), so the candidate source was simply wrong about
it. **Solomon Islands, Marshall Islands, and Kiribati were deferred, not added** — each has only a police
force listed, the same shape as the 17 confirmed countries, but without that source's own explicit "no
regular military forces" disclaimer phrase, making it a genuine ambiguity rather than a confirmed fact (see
`BACKLOG.md`).

**Current list (17):** Costa Rica, Panama, Iceland, Andorra, Dominica, Grenada, Liechtenstein, Mauritius,
Micronesia, Monaco, Nauru, Palau, Saint Lucia, Saint Vincent and the Grenadines, Samoa, Tuvalu, Vanuatu.

## 8. Air fleet size — backlogged, not skipped

Part of the original 7-component locked design, never implemented. Investigated directly and confirmed
genuinely blocked, not a scraping-difficulty problem: FlightGlobal's World Air Forces directory is a straight
paid subscription paywall — no PDF link, no free or email-gated form actually present on the page, despite
older claims of a free download elsewhere. This is the same kind of licensing wall the design doc already
ruled out IISS/Jane's for. No equivalent free, citable source was found at this project's citation bar
(Governing Principle 1: "sourced or unscored"), so this stays an open backlog item (`BACKLOG.md`) rather than
being filled with a lower-credibility substitute — Wikipedia, an aggregator site, or a third-party mirror of
paywalled content.

## 9. Arms import/export dependency — an annotation, not a score

Implemented, sourced, and displayed (`annotations.armsImportTiv` in `militaryScores.ts`, shown in the
citation drill-down as "not scored") — but deliberately **not** part of the composite, demoted after
reviewing real generated output exposed a directional problem the metric can't resolve on its own.

The locked design inverted a high import volume into a *lower* score, on the theory that heavy importing
signals vulnerability. In practice this collapsed two very different situations into the same number: a NATO
member buying US/UK equipment reads as "import-dependent" identically to a genuinely exposed country with no
allies — arguably the *opposite* signal, since allied-supply procurement reflects resilience, not weakness —
and a country with a negligible military and nothing to import in the first place scores the same high
inverted value as one that's genuinely self-sufficient. Telling these apart would need supplier-diversity or
alliance-context data this project doesn't source. Rather than keep a directional score whose direction
doesn't reliably hold, it moved to the same non-scoring-annotation treatment already established for other
real-but-not-directly-scoreable context in this project — still real, cited, and shown, just not blended into
`value`.

Its own source is worth noting separately: the publicly documented SIPRI API endpoint is decommissioned and
now redirects to a marketing page. The live figure comes from SIPRI's actual portal backend, found by driving
the real UI and capturing the resulting request — a legitimate reverse-engineering of an otherwise
undocumented but public, unauthenticated, CORS-open endpoint of the same official SIPRI database the design
doc names, not a substituted source.

## 10. What's intentionally excluded

Per the design doc's Governing Principles (§2), applying to Military same as every other category:

- No claim that traces to a single recent event rather than a durable, structural dataset (Principle 2).
- No score component that's really a referendum on a sitting leader or administration (Principle 3).
- No national-character framing of any kind (Principle 4).
- No interpolated, estimated, or default-to-something value standing in for genuinely missing data
  (Principle 5).

## 11. Change history

Not duplicated here — see `LOGBOOK.md` (search "Military") for the full real-output reasoning trail behind
every revision mentioned above (the coverage-floor/confidence revisions, the expenditure double-weight, the
arms-import-TIV demotion, the no-standing-military list expansion), and
`Intelligence Docs/intelligence-engine-scoring-design.md` §3.1 for the original locked design this
implementation started from.
