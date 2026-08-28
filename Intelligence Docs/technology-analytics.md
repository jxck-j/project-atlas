# Technology — Scoring Methodology

**Status:** implemented, live. **Source of truth for behavior:** `scripts/buildTechnology.mjs` — if this doc
and the script ever disagree, the script is correct and this doc is stale; re-read the script's own comments
before trusting anything below.
**Generates:** `src/data/technologyScores.ts`, consumed by `hud/IntelligencePanel.tsx`'s TECHNOLOGY status bar
(with citation drill-down) and `hud/AnalyticsPanel.tsx`'s TECHNOLOGY ranked list.
**Locked design / governing principles:** `Intelligence Docs/intelligence-engine-scoring-design.md` §2
(applies to every category) and §3.3 (finalized 2026-08-25 at 4 components, after a 5th/6th-component
investigation — see that section's "Investigated and not included" subsection for the nine candidates checked
and rejected).
**Full change history / real-output reasoning trail:** `LOGBOOK.md` (search "Technology") — this doc explains
the *current* logic; LOGBOOK explains *why it changed*, including the ICT Development Index sourcing trail and
a real screenshot-timing false alarm hit while verifying the (separate) AnalyticsPanel ranking-lookup feature.

This is a per-category series — see `military-analytics.md`/`economics-analytics.md` for the same treatment of
Military/Economy. Diplomacy will get its own `diplomacy-analytics.md` once it's built.

---

## 1. What this measures

One 0–100 composite score for 193 UN member countries, reflecting **research investment, invention output,
export sophistication, and digital infrastructure maturity** together — not a single "how advanced is this
country" headline number, but four independently-sourced structural inputs averaged together. Unlike Economy
(no non-UN exception here): Technology draws no non-WDI fallback for any country, so — unlike Economy's
Taiwan, sourced from IMF WEO specifically because WDI excludes it — Taiwan is simply absent from this dataset,
the same way it's absent from Military.

## 2. Components at a glance

| # | Component | Source (indicator code) | Real coverage (2026-08-25 run) |
|---|---|---|---|
| 1 | R&D expenditure, % GDP | World Bank WDI (`GB.XPD.RSDV.GD.ZS`) | 145 of 193 |
| 2 | Patent applications by residents, per million population | World Bank WDI (`IP.PAT.RESD` ÷ `SP.POP.TOTL`) | 148 of 193 |
| 3 | High-tech exports, % of manufactured exports | World Bank WDI (`TX.VAL.TECH.MF.ZS`) | 175 of 193 |
| 4 | ICT Development Index | ITU, 2024 edition (hand-transcribed — see §3) | 170 of 193 |

All 4 are coverage-gap-only — no true-zero component the way Military has nuclear warheads/industrial-base
revenue (every country genuinely has *some* R&D spend, patent activity, export mix, and ICT infrastructure
level; a missing value here always means "not sourced," never "genuinely zero"). Real coverage came in lower
than the design doc's original pre-build estimates for the two indicators it had guessed at most casually
(~190 assumed for both R&D and patents) — the live numbers above are the authoritative ones now.

## 3. Sourcing notes worth knowing before touching this script

**Component 2 ("WIPO IP Statistics, direct, not via GII" per the design doc):** World Bank's `IP.PAT.RESD`
indicator IS WIPO's own patent filing data, re-hosted through the WDI API. "Direct" in the design doc's
phrasing contrasts with routing patent counts through GII's own bundled composite (§3.3's "Superseded design"
— GII's Knowledge and technology outputs pillar already includes PCT filings, the exact double-count problem
that ruled GII out as a Technology backbone in the first place) — fetching WIPO data via World Bank's mirror of
it is not the same as scoring it through GII, the same way this project already fetches SIPRI/FAS-sourced
figures via other scripts' own direct API calls. Verified working live before being trusted in the script.

**Component 4 (ICT Development Index) has no live API to pull from.** `datahub.itu.int` returns a 403 to an
unauthenticated fetch, the same "available upon request" pattern that ruled out the IMF AI Preparedness Index
as a Technology candidate during the design investigation. `IDI_2024` in `buildTechnology.mjs` is a
hand-transcribed snapshot of ITU's own published 2024 edition (2022 reference-year data, the same
relaunched-2023 methodology the design doc calls for) — 172 economies, extracted with a **deterministic regex
parse of the raw sourced wikitext** at en.wikipedia.org/wiki/ICT_Development_Index (itself citing
itu.int/itu-d/reports/statistics/IDI2024/), not eyeballed by hand or summarized through a lossy model pass, to
avoid transcription error across 172 rows — the same "hand-maintained, cited, real published values, not a
live pull" precedent `buildMilitary.mjs`'s FAS-sourced `NUCLEAR_WARHEADS` table and `currentStatus.ts`'s
`sanctionTier` seed already established. Re-running the build script refreshes the 3 WDI-sourced components
but does **not** refresh `IDI_2024` — that needs a by-hand update against ITU's next published edition.

**India is a real, confirmed gap in ITU's own table**, not a parsing bug — its row is simply absent (the
sequence jumps straight from Indonesia to Ireland), confirmed by inspecting the raw wikitext directly. Logged
to `BACKLOG.md` like any other sourcing gap rather than guessed at.

## 4. Normalization: percentile rank, for all 4 components uniformly

```
sort all real values low → high
rank = 1-indexed position (ties get the AVERAGE/fractional rank of the positions they jointly occupy)
percentile = (rank − 1) / (n − 1) × 100
```

The same average/fractional tie convention `economics-analytics.md` §3.1 documents, reused here rather than
re-derived. **Deliberately uniform across all 4 components** — unlike Economy, which needed three different
normalization methods because its components are genuinely different *kinds* of quantity, none of Technology's
4 components has the GDP-scale outlier skew that made Economy's GDP component alone switch to log-min-max:
R&D%/high-tech-exports% are already bounded rates, patents-per-million is already population-normalized (so it
doesn't carry the raw-magnitude skew a bare patent count would), and the ICT Development Index is already
ITU's own bounded 0–100 composite. Percentile rank suits all 4 the same way, so there was no reason for any one
of them to diverge.

## 5. Weighting

**Equal weight across all 4 components**, per Governing Principle 6 (design doc §2/§3.3) — no citable
framework was found to justify an unequal scheme, and (per §3.3's own note) two illustrative weighted proposals
were drafted and rejected during design for the same reason. No double-weighting exception here, unlike
Military's expenditure or Economy's GDP — nothing in real Technology output surfaced the kind of structural
distortion that motivated either of those exceptions.

## 6. Coverage floor & confidence tiers

A country needs at least 3 of the 4 components present to receive a Technology score at all — the same
"you need a floor" idea Economy's own coverage-floor patch established, scaled down from 5 components to 4:

- `coveragePresent = 4 of 4` → **`measured`**
- `coveragePresent = 3 of 4` → **`proxy`**
- `coveragePresent ≤ 2 of 4` → **`unavailable`** — `value` is `null`, not computed from 1–2 components and
  then withheld.

Real breakdown across all 193 countries (2026-08-25 run): 124 `measured`, 27 `proxy`, 42 `unavailable`.

## 7. What's intentionally excluded

- The design doc's own §3.3 "Investigated and not included" subsection lists nine 5th-component candidates
  checked and rejected — GII/PCT (double-count), four Stanford AI Index metrics (concentration/scale bias),
  IMF AIPI (closed data + composite opacity), Oxford Insights Government AI Readiness (wrong construct —
  policy readiness, not capability), Stanford Global AI Vibrancy (36-country ceiling), MSCI tech-sector
  weighting (salience bias + paywalled + 47-country ceiling), IMD World Digital Competitiveness (69 countries +
  survey data + paywalled), and World Bank "Labor force with advanced education" (not STEM-specific — a flat
  STEM-share multiplier was considered and rejected as mathematically inert). UNESCO's STEM-graduate-share
  series was the closest candidate (real, STEM-specific data) but is flagged for future research rather than
  adopted — ~120-country coverage and, critically, no China entry at all.
- Advanced Industry (semiconductor/aerospace/robotics/biotech capability) is backlogged separately, not
  scored or annotated — no single citable dataset covers that sub-sector combination (see `BACKLOG.md`).
- Per Governing Principle 5 (design doc §2): no interpolated, estimated, or default-to-something value ever
  stands in for a genuinely missing component — see §6's coverage floor.

## 8. Change history

Not duplicated here — see `LOGBOOK.md` (search "Technology") for the full real-output reasoning trail: the
5th/6th-component investigation, the live-fetch verification of all 3 WDI indicators before trusting them, the
ICT Development Index sourcing/extraction trail (including catching an unreliable LLM-summarized first attempt
at the same table before switching to a deterministic raw-wikitext parse), and the India gap confirmation.
