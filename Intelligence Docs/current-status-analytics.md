# Current Status — Scoring Methodology

**Status:** implemented, live. **Source of truth for behavior:** `scripts/buildCurrentStatus.mjs` — if this
doc and the script ever disagree, the script is correct and this doc is stale; re-read the script's own
comments before trusting anything below.
**Generates:** `src/data/currentStatus.ts`, consumed by `hud/IntelligencePanel.tsx`'s CURRENT STATUS row (a
`ConflictChip`/`SanctionBadge` treatment, not an `IntelRow` bar) and `hud/AnalyticsPanel.tsx`'s CURRENT STATUS
filtered/sortable list.
**Locked design / governing principles:** `Intelligence Docs/intelligence-engine-scoring-design.md` §2
(applies to every category) and §3.5 (the finalized, implemented design this script follows).
**Full change history / real-output reasoning trail:** `LOGBOOK.md` (search "Current Status") — this doc
explains the *current* logic; LOGBOOK explains *why it changed*, including a real conflict-attribution bug
(a country dropped from its own conflict record when it fought entirely off its own soil) found and fixed
against real UCDP output.

This is a per-category series — see `military-analytics.md`/`economics-analytics.md`/`technology-analytics.md`
for the same treatment of Military/Economy/Technology. Diplomacy will get its own `diplomacy-analytics.md` once
it's built.

---

## 1. What this measures — and why it's not a 0–100 score

Unlike every other Intelligence Engine category, Current Status **never converges to a single composite
number**. It's two independent, categorical facts per country:

- `conflicts: ConflictEntry[]` — 0, 1, or many real, dated, sourced UCDP conflict records.
- `sanctionTier: 'red' | 'orange' | 'yellow' | null` (+ `sanctionPrograms?: string[]`) — an OFAC program
  severity tier.

The original design sketch was a single `CurrentStatus` enum (`'active_conflict' | 'sanctioned' | 'normal' |
'disputed_territory'`) — superseded before any code was written against it, because one enum slot can't
represent a country that's simultaneously sanctioned *and* in an active conflict. Absence is itself a real,
positive fact here, not a missing-data state: every country gets an explicit `conflicts: []`/`sanctionTier:
null` when neither applies, never an omitted field the way an unscored Military/Economy/Technology component
is.

## 2. Conflicts — two UCDP products, combined

| Source | Role | Access |
|---|---|---|
| UCDP/PRIO Armed Conflict Dataset (ACD), annual, v26.1 (1946–2025) | Authoritative `conflictType` (`type_of_conflict` codes 1–4) | Direct CSV/zip download — no login |
| UCDP Candidate Events Dataset (Candidate/GED), monthly, ~1 month lag | Catches a conflict active in the current year but not yet in any annual ACD release | Direct CSV download — no login |

The UCDP API itself (`ucdpapi.pcr.uu.se`) requires a manually-issued access token (an email request to UCDP's
maintainer) — not self-service, so this script uses the direct file downloads instead of blocking on a human
approval step, the same "found a legitimate direct path around a gated API" precedent `buildMilitary.mjs`'s
SIPRI TIV reverse-engineering already set.

**"Current" (ACD side)** means: the row for a conflict at the dataset's most recent covered year with
`ep_end === '0'` (UCDP's own "still ongoing" signal). **A Candidate/GED-only conflict** gets `conflictType:
'unclassified'` and `source: 'ucdp-candidate'` — no manual override path; unclassified is the honest state
until UCDP itself types it, not a gap this project fills in with a guess.

**Country matching is primarily by UCDP's own Gleditsch-Ward numeric country codes**, never name-string
matching — with one deliberate, documented exception. The ACD's own `gwno_loc` already lists every named
side's territory. Candidate/GED's `country_id` is only the event's *location*, not who fought it — a state
whose entire involvement happened off its own soil (an airstrike campaign, say) would otherwise be silently
dropped from its own conflict record. To catch that, the Candidate pass **also** resolves every named
`side_a`/`side_b` government by name against the UN-193 list and attaches the conflict to the union of
event-location countries and resolved participant countries. This was a real bug, caught and fixed against
real output: the US was originally missing from its own "Iran vs. Israel, United States of America" Candidate
detection, since no 2025 event in that dataset was geolocated on US soil despite the US being named `side_b`
on every row.

**A resolved Candidate conflict identifier can also point to an already-classified ACD conflict** — when it
does, this script emits the real ACD `conflictType` but `source: 'ucdp-candidate'` (since its *currency* —
that it's active again/still, this recently — comes from Candidate, not yet from an annual release), and skips
re-emitting it if the ACD pass already produced the same conflict, so a country never gets duplicate chips for
one conflict.

## 3. Sanctions — a hand-maintained seed, not a live pipeline

Three OFAC severity tiers, not a boolean — a deliberate 2026-08-24 revision from the original single
`sanctioned: boolean`:

| Tier | Meaning | Verification | Countries |
|---|---|---|---|
| **RED** | Comprehensive embargo | Fully verified against each program's own OFAC regulatory text | Cuba, Iran, North Korea, Syria |
| **ORANGE** | Sectoral/hybrid — overlapping programs requiring general licenses, not a blanket embargo | Secondary-source characterization, cross-referenced across independent compliance sites — **not yet individually verified against OFAC's own page** | Russia, Belarus, Venezuela, Myanmar, Sudan, Nicaragua |
| **YELLOW** | List-based only — SDN/Consolidated List screening exposure, no country-wide sectoral program | Same secondary-source caveat as ORANGE | Afghanistan, Central African Republic, DR Congo, Ethiopia, Iraq, Lebanon, Libya, Mali, Somalia, South Sudan, Yemen |
| **null** | No active OFAC country program | — (hidden in the UI, not rendered as an empty/zero state) | every other country |

**Flagged directly in `BACKLOG.md`: every ORANGE/YELLOW tier assignment and program name needs verification
against its own OFAC program page before this ships as more than portfolio-demo-confidence data** — only RED
is fully verified today. Source for the active program list itself:
ofac.treasury.gov/sanctions-programs-and-country-information. Not a live pull by design — this list changes
rarely enough that hand-updating it beats building a live pipeline for now, also logged in `BACKLOG.md` as a
standing "live OFAC pull" candidate if that stops holding.

## 4. Rendering — deliberately not `IntelRow`'s bar treatment

Neither field is a magnitude, so neither gets the shared 0–100 bar every other Intelligence Engine metric
uses:

- **`ConflictChip`** (`IntelligencePanel.tsx`) — one pill per entry, colored/labeled by `conflictType` via
  `scene/conflictTypeStyles.ts` (shared with `AnalyticsPanel.tsx` so a color can never drift between the two
  surfaces), collapsed behind a headline ("AT WAR (n)" / "NO ACTIVE CONFLICTS") until clicked. Clicking a chip
  highlights its resolved parties on the globe.
- **`SanctionBadge`** — a compact colored "S" mark, hidden entirely when `sanctionTier` is `null`, clickable to
  open a global `SanctionTierMenu` browsing all three tiers across all 193 countries.
- **`AnalyticsPanel.tsx`'s list view** — filter tabs (ALL / ACTIVE CONFLICT / SANCTIONED) instead of a ranked
  bar, since there's no single number to rank by; sortable by COUNTRY, CONFLICTS (a real, sortable count), or
  SANCTION (tier severity — RED > ORANGE > YELLOW > none, a real ordering of *how much OFAC restricts a
  country*, not a magnitude comparison).

## 5. What's intentionally excluded

- No live OFAC pull (see §3) — a deliberate, documented tradeoff, not an oversight.
- No manual conflict-type override for an `unclassified` entry — per Governing Principle 5 (design doc §2),
  UCDP's own classification is authoritative; this project doesn't guess ahead of it.
- No severity/casualty-count scoring of any kind — conflicts are typed and counted, never ranked against each
  other by how "bad" they are; UCDP itself doesn't rank conflict types against one another, so neither does
  this.

## 6. Change history

Not duplicated here — see `LOGBOOK.md` (search "Current Status") for the full real-output reasoning trail: the
three-tier sanctions revision, the Candidate-vs-ACD matching rules verified against real 2026 data, and the
2026-08-26 conflict-attribution fix (the US/Israel-off-own-soil case) with its real, verified before/after
deltas.
