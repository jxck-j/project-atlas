# Logbook

A running record of meaningful discoveries, non-obvious bugs, and changes of
approach — the *why* behind decisions in the code, for whenever "wait, why did
we do it this way?" comes up later. Not a changelog (see `CHANGELOG.md` for
user-facing *what changed*); this is the debugging/reasoning trail.

## 2026-08-25/26 — Technology wired in: build script, live-data research, and full UI treatment

Follow-on to the same-day design-doc finalization (4 locked components — see the earlier 2026-08-25 entries).
"Wire technology in" meant three things: source real data for the 4 locked components, generate
`src/data/technologyScores.ts` the same way Military/Economy do, and wire both `IntelligencePanel.tsx` and
`AnalyticsPanel.tsx` — the full Economy playbook, not just the data layer.

**Verified all 3 World Bank WDI indicators live before writing any script code**, rather than trusting
remembered indicator mnemonics: `GB.XPD.RSDV.GD.ZS` (R&D % GDP), `IP.PAT.RESD` (patent applications,
residents — WIPO-sourced, re-hosted through WDI), `TX.VAL.TECH.MF.ZS` (high-tech exports %), and
`SP.POP.TOTL` (population, for the per-capita denominator) all fetched real, current data for a spot-check
country before being trusted in the build script.

**ICT Development Index was the hard part — no live ITU API exists.** `datahub.itu.int` returns a 403 to an
unauthenticated fetch; ITU's own DataHub "about" page describes query/download tooling but nothing that looks
like an open bulk REST endpoint, the same "available upon request" pattern that already ruled out the IMF AI
Preparedness Index as a Technology candidate earlier the same day. Two options: backlog the component (but
it's one of only 4 locked components, and the design doc explicitly names it — dropping it would contradict
work finished hours earlier) or hand-transcribe it from a real, cited, published source the same way
`buildMilitary.mjs`'s FAS Nuclear Notebook warhead counts and `currentStatus.ts`'s OFAC sanction-tier seed
already do. Went with transcription, but specifically avoided the failure mode that makes hand-transcription
risky at scale (silently wrong numbers across a large table): a first pass through `WebFetch` against
`en.wikipedia.org/wiki/ICT_Development_Index` came back as an LLM-summarized table that was visibly
untrustworthy — same-page IDI values NOT in a coherent order (Finland's 98.1 listed after several countries
with lower scores), which is exactly the kind of transposition risk a summarization pass over a ~170-row
table can introduce silently. Switched to fetching the RAW WIKITEXT directly (`action=raw` via `curl`, not
WebFetch) and parsing it with a deterministic regex against MediaWiki's own `{{val|N|fmt=gaps}}` template
syntax — 172 of 173 data rows matched cleanly on the first pass (the one miss was Palestine's row, which uses
a different template shape for its country-code cell — not a GeoEntity concern here since Technology is
country-only, so it was left out rather than special-cased). This is the same standard `buildMilitary.mjs`
already set for hand-transcribed data (cited, extracted carefully, not eyeballed) applied to a case where the
extraction step itself needed to be deterministic rather than routed through a second model pass.

**India is absent from the source table entirely — confirmed as a real gap, not a parsing bug**, by grepping
the raw wikitext for every matched country code in alphabetical order and finding the sequence jump straight
from Indonesia (IDN) to Ireland (IRL) with no `IND` row anywhere in between. Logged to `BACKLOG.md` like any
other coverage gap rather than guessed at or silently back-filled.

**Real, measured live-fetch coverage across all 193 countries came in noticeably lower than the design doc's
original per-component estimates** for the two indicators the doc had guessed at most casually: R&D
expenditure 145 (doc estimated ~190), patents per million 148 (doc used the same ~190 estimate as its
patent-count-only version), high-tech exports 175 (doc estimated ~150 — this one came in HIGHER), ICT
Development Index 170 (doc estimated ~165 — close). Confidence breakdown: 124 measured / 27 proxy / 42
unavailable. Treated the doc's numbers as a pre-build guess, not a target to hit — the real fetch is the
authoritative number now, recorded in `CLAUDE.md` rather than silently left mismatched against the design
doc's own table.

**Confidence coverage floor scaled from Economy's own 5-component precedent (≥3 of 5) down to Technology's 4
components (≥3 of 4)** — same "you need a floor, not just any single component" reasoning Economy's
Monaco/Liechtenstein case established, applied proportionally rather than re-derived from scratch.
Normalization: percentile rank for all 4 components uniformly (reusing Economy's already-user-confirmed
average/fractional tie convention rather than re-asking) — none of Technology's 4 components have the
GDP-scale outlier skew that made Economy's GDP component alone switch to log-min-max, so there was no reason
for any component here to diverge from the simpler method.

**UI wiring was a direct mirror of Economy's, not a new pattern:** `technologyIntelValue()`/
`TechnologyDrilldown` in `IntelligencePanel.tsx`, `TECHNOLOGY_COLUMNS`/`buildTechnologyRows()` in
`AnalyticsPanel.tsx`, `sourceLabel()` gained one more branch (`itu.int`), `METRIC_AVAILABLE.technology`
flipped to `true`. Verified live in the browser (not just typecheck/lint/vitest): Germany's TECHNOLOGY bar
renders 84.2 with a working 4-row citation drill-down, and the Analytics TECHNOLOGY ranking correctly surfaces
South Korea/Singapore/United States at the top — a plausible real ranking, not a smoke-test artifact. No
Taiwan score, unlike Economy — Technology has no IMF WEO (or any non-WDI) fallback, so Taiwan is simply absent
here the same way it's absent from Military.

## 2026-08-26 — AnalyticsPanel: conflict counter gets its own click, discussed before implementing

Direct request: clicking a country's conflict count in the CURRENT STATUS list should reveal the conflicts,
not select the country — clicking anywhere else on the row should still select the country as usual. Talked
through the destination before writing any code (the request said "pull up the conflicts, not the country,"
which is ambiguous between two real designs):

1. **Expand inline, in the list itself, with no country selection at all.** Keeps the user's place in a
   193-row ranked list.
2. **Select the country and open `IntelligencePanel` with its CURRENT STATUS row pre-expanded**, instead of
   its default collapsed headline. Reuses existing UI, but navigates away from the list — which seemed to
   contradict "not the country" in the request.

User picked option 1. Implemented as: `CurrentStatusListRow`'s outer element changed from a single `<button>`
(the whole row) to a `<div role="button" tabIndex={0} onClick={onSelect} onKeyDown={...}>`, since a `<button>`
can't contain another interactive `<button>` and the CONFLICTS cell needed to become one — Enter/Space on the
row still selects the country, matching what the removed real `<button>` did. The CONFLICTS cell's nested
`<button>` calls `e.stopPropagation()` so its click never bubbles into the row's `onSelect`. Expanding renders
each `ConflictEntry` as a small pill (type label + name, `CONFLICT_TYPE_STYLE`-colored) — deliberately not
`IntelligencePanel.tsx`'s full `ConflictChip`: no click-to-highlight (the globe isn't visible behind this
full-screen view) and no `shortenConflictName()` treatment (that function stays where it is — one caller
doesn't justify promoting it to a shared module, especially since the reason it exists — trimming a name for a
chip that also does globe highlighting — doesn't apply here). Expand state is local `useState` per row rather
than lifted into `AnalyticsPanel`, so re-sorting the list can't detach an expanded row from the wrong country
(rows are keyed by `row.id`) and multiple rows can be expanded independently — nothing in the request asked
for accordion-style exclusivity, so this didn't add it.

## 2026-08-26 — Current Status: a country fighting off its own soil was silently dropped from its own conflict list

Direct user report while reviewing the freshly-wired `AnalyticsPanel.tsx` CURRENT STATUS view: the US was
missing a chip for its own reported role in the 2025 Iran strikes, and asked why the India-Pakistan entry
looked "outdated" when the underlying data clearly existed. Two different questions, two different answers —
one was a real bug, the other wasn't.

**India-Pakistan: not a bug, an inherent lag in the source, working as designed.** Inspected the vendored
UCDP/PRIO ACD v26.1 zip directly: conflict_id 218 (`Government of India vs. Government of Pakistan`) has a
2025 row with `ep_end='0'` — UCDP's own "not confirmed ended" signal — and the dataset's `MAX_YEAR` is 2025 (an
annual product for year Y publishes the following year; 2026's edition doesn't exist yet). The Jan-Jul 2026
Candidate/GED files show no new India-Pakistan state-based event in that window, which is a real (if
informal) signal of 2026 de-escalation — but UCDP's own methodology only marks an episode formally ended after
a confirmed full quiet YEAR in a subsequent annual release, and this script has "no manual override path, per
the locked design: unclassified is the honest state until UCDP itself types it" (see the design doc §3.5 and
this script's own header comment) — the same discipline extends to NOT manually flipping `ep_end` early
either. The entry is accurate to UCDP's most recent official classification; it just can't be fresher than
that classification is.

**USA-Iran: a real bug, now fixed.** Verified directly against the vendored Candidate/GED CSVs (via the
project's own `parseCsv`, not an ad hoc parser — see below for why that distinction mattered): the "Iran -
Israel, United States of America" conflict (`conflict_new_id` 16905) has `side_b = "Government of Israel,
Government of United States of America"` on every one of its 23 rows — the US is explicitly named as a
combatant — but `country_id` (Iran, Iraq, Jordan, Kuwait, Israel, Bahrain, Lebanon, Oman, Saudi Arabia, Syria,
UAE across the various rows) never once resolves to the US, because UCDP's Candidate/GED `country_id` is where
a violent EVENT happened, not who's fighting it — no event in this dataset was geolocated on US soil. The
build script only ever matched candidates by that location code, so the US's own `CURRENT_STATUS` record never
got this entry, even though UCDP's own data names it as a party. (The ACD/annual side doesn't have this gap —
confirmed against conflict_id 16099, `Government of United Kingdom, Government of United States of America vs.
Government of Yemen (North Yemen)`: `gwno_loc = "2, 200, 678"`, i.e. USA+UK+Yemen all three, not just Yemen —
the annual product's location field already encodes every named side's territory.)

**Fix:** `buildCurrentStatus.mjs`'s Candidate/GED pass now also resolves each row's `side_a`/`side_b` text
against the UN-193 country list (`resolvePartyCountryName`/`resolvePartyCountries` — the same "Government of
X" stripping and "`X (OldName)`" historical-alias prefix match `hud/IntelligencePanel.tsx`'s
`resolvePartyCountryIds()` already does at render time for click-to-highlight, duplicated rather than shared
since one's a React/TS module and the other's a plain Node script) and attaches the conflict to the union of
event-location countries and resolved participant countries, not location alone. A non-state side (a rebel
group name) never resolves and is silently skipped — same "no geometry, no highlight" correctness the render-
time version already relies on.

**Had to restructure the grouping to avoid a duplication bug of my own making.** The original candidate-row
grouping keyed by `(conflict identifier, country)` — deliberately, so the same conflict active in multiple
locations produced one chip per location. But this identifier ("Iran vs. Israel+US") already had ~10 separate
per-location groups (Iran, Iraq, Jordan, Kuwait, Israel, Bahrain, Lebanon, Oman, Saudi Arabia, Syria, UAE all
independently keyed) sharing one `side_a`/`side_b` pair — naively adding participant-resolution inside that
per-location loop would have attached ~10 near-identical duplicate entries to the US (one per location group),
turning "AT WAR" into "AT WAR (10)" for a single real conflict. Fixed by regrouping candidate rows by
CONFLICT IDENTIFIER ALONE first (collecting the full *set* of locations seen, plus one representative row for
side_a/side_b/conflict_name — verified those are consistent across a conflict's own rows before relying on
that, e.g. this exact identifier: one distinct `[side_a, side_b]` pair across all 23 rows in both files), then
emitting exactly one entry per conflict, attached once to the union of every resolved location + participant
country. Verified against a `--sample` dry run before running the full build: 5 of 121 distinct candidate
conflicts in the 15-country sample gained at least one country via participant-parsing beyond their event
location(s) — a small, plausible number, not an explosion.

**Real, verified deltas in the regenerated `src/data/currentStatus.ts`** (full diff reviewed by hand, not just
trusted): United States of America gained the Iran/Israel/US entry (the reported case); Israel gained
"Israel: Islamic State" (`side_a = "Government of Israel"` on a row geolocated in Turkey — Israel's own
government is a named party in a conflict that, before this fix, never appeared on Israel's own record at
all); Rwanda gained "DR Congo (Zaire) - Rwanda" (`side_b = "Government of Rwanda"` on a row located in DR
Congo); Myanmar gained "Bangladesh - Myanmar (Burma)" similarly. No country's list shrank — this is strictly
additive (a set union can only grow), and re-running the diff confirmed no other country's entries changed
content, only array order in a few cases (an artifact of the regrouping's different iteration order — chips
aren't order-sensitive, so this is cosmetic).

**One real mistake caught mid-investigation, worth logging so it isn't repeated:** my first pass at inspecting
the raw CSVs used a quick hand-rolled comma-split parser instead of the project's own `scripts/lib/csv.mjs`
`parseCsv` — it mishandled a quoted field earlier in one row, shifting every subsequent column left by one,
which made the "Israel: Islamic State" row's `country_id` look blank when it's actually `"640"` (Turkey) once
parsed correctly. Nearly filed that as a second bug (attribution via a blank/unresolvable location) before
re-checking with the real parser. Lesson: verify against the project's own parsing code, not a scratch
reimplementation, before drawing conclusions from raw vendor data — a subtly wrong ad hoc parser produces
plausible-looking but wrong answers, which is worse than an obvious failure.

## 2026-08-26 — Current Status: plain-language conflict labels, collapsed-by-default, and click-to-highlight parties

Fourth same-day pass (see the entries below). Direct feedback that the conflict chip wording — UCDP's own
technical vocabulary, `internationalized_internal`, `extrasystemic`, etc. — read as confusing jargon to
anyone outside conflict studies, and that a full row of chips for a heavily-conflicted country (Myanmar: 6)
was overwhelming at a glance. Three changes, worked through together rather than shipped as separate passes,
because the third only makes sense once the first two exist:

**1. Plain-language labels, technical values unchanged.** `CONFLICT_TYPE_STYLE`'s `label` strings changed
(interstate → "INTERNATIONAL WAR", internal → "CIVIL WAR", internationalized_internal → "FOREIGN-BACKED CIVIL
WAR", extrasystemic → "COLONIAL CONFLICT", unclassified → "RECENTLY DETECTED") — but the underlying
`ConflictType` values in `data/currentStatus.ts` are untouched. This is deliberately a display-only change:
the raw UCDP terms are what a citation/source needs to stay accurate to, and what a future
"technical detail" surface could still show; only the thing a general user reads at a glance needed
translating.

**2. Collapsed by default, expand on click — reusing an existing pattern instead of inventing one.** The
explicit design goal (direct quote): "we want the user to access as much info as possible without being
overwhelmed." Military and Economy already solve exactly this shape of problem — a single glance-able summary
that expands into full detail only on demand (design doc §7's citation drill-down) — so Current Status now
follows the same shape: a plain headline ("AT WAR (6)" / "NO ACTIVE CONFLICTS") replaces the always-visible
chip wall, and clicking it reveals the chips. **Deliberately NOT wired into `expandedMetric`, the state
Military/Economy's drilldowns share** — that mechanism hides every other status bar because a citation
drilldown replaces the whole section with a full breakdown table; Current Status's expand is much lighter
(a few extra rows in place), so it got its own local `isExpanded` state that coexists with Military/Economy
being visible. "AT WAR" is used as the one headline for every non-empty case — deliberately not picking a
harsher word for interstate vs. a softer one for "recently detected" — because CONFLICT_TYPE_STYLE's own
existing comment already established that UCDP doesn't rank these types against each other, and inventing a
severity-based headline would contradict that. The count suffix carries the "how much" nuance instead.

**3. Same-type-chip differentiation, and click-to-highlight-parties — both solved by finally displaying
`conflictName`, not by adding a new field.** Myanmar's 5 "CIVIL WAR" chips were indistinguishable — the
data to tell them apart (`conflictName`, e.g. "Government of Myanmar (Burma) vs. KNU") already existed, it
just wasn't shown, only tooltipped. `shortenConflictName()` extracts the OTHER side (strips this country's
own "Government of X" from a PRIO-shaped name, or the leading "Country: " from a Candidate-shaped one) so a
chip reads "CIVIL WAR — KNU" instead of repeating this country's own name back. Direct follow-up request
(mid-implementation): clicking a chip should highlight the actual party/parties on the globe. This reuses the
exact same parsing idea one level further — `resolvePartyCountryIds()` splits a PRIO-shaped name on
' vs. '/', ' and resolves each piece (after stripping "Government of ") against the real country list,
skipping anything that doesn't resolve (a rebel group like "KNU" has no country geometry to highlight, which
is correct, not a bug) and falling back to the viewed country's own id whenever nothing else resolves (a pure
civil war, or a Candidate-shaped name with no side_a/side_b structure at all) — so a click never silently
does nothing. New pieces mirror existing precedent exactly: `hud/conflictPartiesHighlightStore.ts` is
`sanctionHighlightStore.ts`'s shape with an ad hoc id list instead of a fixed tier; `layers/geoOverlays/
ConflictPartiesHighlightLayer.tsx` is `SanctionHighlightLayer.tsx`'s shape; the highlight is colored the same
as the clicked chip itself, so it visually traces back to what caused it. Verified live: Myanmar's "CIVIL WAR
— KNU" chip highlights only Myanmar (correct — KNU isn't a country); the UK's "INTERNATIONAL WAR — Government
of Yemen (North Yemen)" chip highlights the UK AND the US AND Yemen simultaneously (the real conflict
`side_a` is "Government of United Kingdom, Government of United States of America" — a 3-state conflict, not
a 2-state one, correctly resolved from the comma-joined side).

**Known limitation, not fixed here:** `resolvePartyCountryIds`/`shortenConflictName` are string-matching
heuristics against UCDP's own free-text `side_a`/`side_b`, not a structured party list — they're only as
correct as UCDP's naming conventions are consistent, and a genuinely novel phrasing this project hasn't seen
yet could fail to resolve a real state party (falling back to just this country, not crashing, but under-
highlighting). Acceptable for now since every real case checked resolved correctly; worth revisiting if the
data ever adds a country whose government name doesn't fit either shape.

## 2026-08-26 — Current Status: sanction badge is now clickable, opening a global tier browser + globe highlight

Third same-day pass on Current Status (see the two entries directly below). Direct request: make the
sanction badge clickable and let it highlight sanctioned countries — with an explicit open design question
attached ("I could have it highlight sanctions in the same tier, but what if someone wants to see all
sanctions"). Resolved as: the badge opens a popover (`hud/SanctionTierMenu.tsx`) that's global across all 193
countries, not scoped to the selected country's own tier — answering "what if someone wants to see all
sanctions" by just always showing all three tiers, rather than picking one behavior over the other. Each
tier's own small "S" icon inside the popover is what actually drives the globe highlight (one tier at a time),
and every listed country is its own clickable chip that selects + flies the camera there.

**New pieces, mirroring existing precedent rather than inventing new patterns:** `hud/sanctionHighlightStore.ts`
is `hud/allianceHighlightStore.ts` with `SanctionTier` swapped in for alliance id — same single-value (not a
Set) store, same toggle-clears-itself idiom. `layers/geoOverlays/SanctionHighlightLayer.tsx` is
`AllianceHighlightLayer.tsx`'s structure, but simpler: `data/currentStatus.ts` is already keyed by the same
numeric ISO topology id `buildCountryEntries()` returns, so there's no name→ISO3 join step to carry over.
The one genuine wrinkle: every existing `CategoryHighlightLayer.tsx` consumer (six category layers +
alliance highlight) shares one fixed violet color, but a sanction tier needs three *different* colors, so
`CategoryHighlightGeometry` gained an optional `color` prop (defaulting to the existing shared violet — every
prior caller is unchanged) rather than duplicating its border/fill merge logic a second time for one
different color.

**Color/label consolidation:** `IntelligencePanel.tsx`'s `SanctionBadge` already had its own local
`SANCTION_TIER_STYLE` (color + background + label) from the earlier pass. Rather than let the menu and the
globe layer each invent a second copy of the same three colors, they were pulled out into
`scene/sanctionTierColors.ts` — a single source of truth for tier color + label, explicitly kept separate from
`scene/highlightColors.ts`'s closed 7-hue ROYGBIV set (that file is explicit about being exactly 7 slots for
selection/relationship state, not an extensible palette) — the same "small categorical palette living outside
the closed set" precedent `IntelligencePanel.tsx`'s own `CONFLICT_TYPE_STYLE` already established. A tier's
translucent chip/badge background is now derived from its one stored color via a small `withAlpha(hex, alpha)`
helper rather than hand-typed as a second rgba string per tier that could drift from the border/text color if
either one were ever tweaked alone.

**Click-outside-to-close, without racing the trigger's own click:** the badge and its popover share one
wrapping `ref`; the outside-click listener checks `containerRef.current.contains(event.target)` and only
closes on a genuine miss. Without that check, clicking the badge to close an already-open menu would race
against itself — a `pointerdown`-based outside-click handler fires before the button's own `click` handler,
so treating the badge as "outside" would close the menu on pointerdown and then immediately reopen it on the
subsequent click, which reads as the badge doing nothing at all when clicked closed.

**Legend consistency:** `hud/LegendPanel.tsx` gained a fourth conditional entry, built fresh per the currently
highlighted tier's own color (mirroring the panel's existing "build a HIGHLIGHT_COLORS-shaped object" pattern
for its category-highlight and claims-overlay rows) rather than reused from the fixed set — since, unlike
every other overlay this legend already explains, a sanction highlight's color genuinely varies by which tier
is active, not a fixed swatch a fixed row could point at.

## 2026-08-26 — Current Status: wired into IntelligencePanel.tsx, then sanctions split into three OFAC tiers

Two follow-up passes on the entry directly below this one, same day.

**Pass 1 — panel wiring.** `hud/IntelligencePanel.tsx` now reads `data/currentStatus.ts` for real: a
`ConflictChip` per `ConflictEntry` (pill styling copied from `AllianceBadge`'s own precedent — "categorical
membership, not a metric, doesn't reuse `IntelRow`'s scored-bar treatment" — colored/labeled by
`conflictType`, full citation as a native tooltip rather than a click-to-drilldown, since there's no
per-component breakdown here to justify that heavier design-doc-§7 mechanism), plus a standalone sanctioned
indicator next to the CURRENT STATUS row label. A GeoEntity selection (no `CurrentStatus` record exists for
those) falls back to the plain unsourced `IntelRow`, same convention Military/Economy already use. Verified
live for a sanctioned+conflicted country (Syria), a sanctioned-only country (Cuba, North Korea), a clean
country (Albania — "No active conflicts sourced.", counted as *sourced* in the footer summary, not lumped in
with Diplomacy/Technology's real gap), and a GeoEntity (Taiwan — correct fallback).

**Pass 2 — sanctions: boolean → three tiers.** Direct request: `sanctioned: boolean` +
`sanctionSource?: 'OFAC-comprehensive'` replaced with `sanctionTier: 'red' | 'orange' | 'yellow' | null` +
`sanctionPrograms?: string[]`, because a single "under comprehensive embargo or not" boolean was silently
treating Russia/Belarus/Venezuela/Myanmar/Sudan/Nicaragua (extensive but non-comprehensive sanctions
programs) and Afghanistan/CAR/DR Congo/Ethiopia/Iraq/Lebanon/Libya/Mali/Somalia/South Sudan/Yemen (SDN-list-only
exposure) identically to a genuinely unsanctioned country — real, meaningfully different OFAC posture that a
boolean has no room to express. `scripts/buildCurrentStatus.mjs`'s `SANCTION_TIERS` seed keeps RED
(comprehensive embargo — Cuba/Iran/North Korea/Syria) at the same fully-verified-per-program confidence the
old boolean had, but ORANGE and YELLOW are a *different, lower* confidence tier — secondary-source
characterization, internally cross-referenced but not individually checked against each country's own OFAC
program page — and that gap is called out explicitly in three places (this script's header comment, the
generated `BACKLOG.md` gap report, and the design doc) rather than silently presented at RED's confidence
level. `IntelligencePanel.tsx`'s sanctioned icon+"SANCTIONED" text became `SanctionBadge`, a compact "S" mark
recolored per tier (red/orange/yellow) with the tier's plain-English description + real OFAC program name(s)
in its tooltip — the previous `ICONS.sanctioned` no-entry glyph became dead code once the badge stopped being
icon-based, and was deleted rather than left unreferenced. `Intelligence Docs/current-status/README.md` was
updated to describe swapping onto a real logo from this S-badge baseline rather than from the icon-glyph
baseline it originally described. Verified live: Russia (orange), Cuba (red), Yemen (yellow) each render a
visually distinct badge color, correctly separate from the conflict-chip color palette below them.

## 2026-08-26 — Current Status: a third Intelligence Engine category, but categorical, not a score

`scripts/buildCurrentStatus.mjs` (`npm run build:current-status`) implements design doc §3.5, producing
`src/data/currentStatus.ts`. Data-generation only — no UI wiring (see `BACKLOG.md`'s "Intelligence Engine"
entry for that as an explicit follow-on).

**The data model is not a 0-100 bar, and was never trending toward one.** Military and Economy both reduce a
handful of sourced components down to a single composite number via normalization + weighting; Current Status
doesn't, because neither of its two facts is a magnitude. `sanctioned` is a boolean — a country either is or
isn't under an OFAC comprehensive embargo, there's no "70% sanctioned." `conflicts` is an array of real,
individually-dated, individually-sourced records, not an aggregate — collapsing "Myanmar has 4 separate active
internal conflicts against 4 different rebel groups" into one number would destroy exactly the information a
user of this panel would want (which conflicts, since when, how classified), for no benefit. The design doc's
very first draft of this section did once sketch a single `CurrentStatus` enum
(`'active_conflict' | 'sanctioned' | 'normal' | 'disputed_territory'`) — that draft couldn't even represent a
sanctioned country with an active conflict (two true facts, one enum slot), which is part of why it was
replaced with two independent fields before any code was written against it.

**Why `sanctioned` is a hand-maintained static seed, not a live OFAC pull.** OFAC's comprehensive-embargo
program list (Cuba, Iran, North Korea, Syria) changes on the order of "once every few years, as a geopolitical
event," not a cadence that benefits from automation the way UCDP's monthly conflict releases do. Building a
live pull would mean scraping or reverse-engineering OFAC's Sanctions List Search / SDN infrastructure (no
public no-auth API for program-level classification was found in a first check) for a dataset with 4 entries
that essentially never change — the SIPRI-TIV-style reverse-engineering effort `buildMilitary.mjs` put into
its own gated source only pays off because that source updates constantly and the composite depends on
catching every update. Logged in `BACKLOG.md` as a live-pull candidate specifically *if* this project's
sanction-status freshness bar ever gets tighter than "someone notices OFAC added a country and updates four
lines," not before.

**The UCDP-Candidate-vs-PRIO-annual split behind `unclassified`.** The annual UCDP/PRIO Armed Conflict Dataset
(ACD) is the only UCDP product that actually classifies a conflict's `type_of_conflict`
(interstate/internal/internationalized_internal/extrasystemic) — but it's annual, and the current release
(v26.1) only covers through 2025. UCDP's Candidate Events Dataset fills exactly that gap: a monthly,
~1-month-lag release of individual violent events, which by 2026-08 already covers Jan-Jul 2026 — months the
annual dataset hasn't reached yet. Real 2026 Candidate data turned up a UCDP convention that wasn't obvious
from the codebook alone: a not-yet-officially-numbered conflict's `conflict_dset_id` field is literally the
string `"XXX<gwcode>"` (e.g. `"XXX482"` for an unnamed, unclassified conflict located via Gleditsch-Ward code
482, Central African Republic) rather than a real number — UCDP's own placeholder for "this doesn't have a
conflict id yet," found by inspecting actual rows rather than assumed. That, or a genuinely novel numeric id
absent from the entire ACD history (found once in the real pull: Syria's "Suweida" conflict, id 16732), is
what earns `conflictType: 'unclassified'` — there's no manual override path, matching the locked design's "the
honest state until UCDP itself types it."

The matching logic had to guard against a subtler failure mode than "is this id new": Candidate events cover
all three UCDP violence types (state-based armed conflict, non-state conflict, one-sided violence against
civilians), but ACD's `type_of_conflict` is only defined for the first — an early version of this check, before
filtering to `type_of_violence === '1'`, treated Afghanistan's "Government of Afghanistan - Civilians"
one-sided-violence record as an unclassified *armed conflict*, which it isn't a member of at all; it belongs to
a different UCDP dataset this script doesn't touch. Separately, several Candidate-detected conflicts turned out
to already be well-known, already-typed ACD conflicts just not yet flagged active in the v26.1 release (Iran's
Kurdistan conflict, Syria's Islamic State conflict) — these get the real type looked up from ACD history and
`source: 'ucdp-candidate'` (since their *current* activity is what Candidate is vouching for, not the annual
release), but are skipped entirely if the ACD pass already emitted them as active, so a country never gets the
same conflict as two separate chips.

## 2026-08-26 — Economy: GDP → log-min-max, inflation → gaussian (superseding the 2026-08-22 distance-percentile patch)

Two independent patches to `scripts/buildEconomy.mjs`, requested together. Growth and unemployment unaffected
by either — both stay percentile rank as before.

**GDP (size): percentile rank → log-min-max.** Same method `buildMilitary.mjs` already uses for its own
magnitude-driven components (`buildNormalizer`) — copied here as `buildLogMinMaxNormalizer`, identical
epsilon/min/max derivation (epsilon = 1% of the smallest nonzero value in the dataset, min/max taken after
the log transform). GDP per capita stays on percentile rank, deliberately — the rationale given was that
log-min-max only makes sense where raw magnitude itself carries weight (aggregate size/power), not for a
per-capita prosperity comparison where two similarly-prosperous countries of very different population sizes
should score similarly. Real motivation, confirmed against actual output before this patch: China's GDP
(nominal) percentile was 100.00 against the US's 99.47 — a 0.53-point gap that barely registered even with
GDP double-weighted, despite the real ~$10.6T dollar difference between them. Percentile rank only ever
encodes ORDER; it has no way to represent "these two are close in rank but far apart in magnitude" or vice
versa. Post-patch: US 100.00, China 96.60 on the same component — still not a huge gap (log compression is
deliberate, not accidental), but real and directionally correct. GDP stays double-weighted in the composite,
unchanged from the 2026-08-21 patch — this only changed which normalization feeds that already-doubled slot.

**Inflation: percentile-of-distance → gaussian, no percentile step at all.**
`score = 100 * exp(-((inflation - 2.0)^2) / (2 * 1.0^2))`, used directly — this is the SECOND inflation-
scoring change in less than a week (see the 2026-08-22 entry below for the first: inverted percentile →
percentile-of-distance-from-target). Explicit instruction this time: do NOT derive σ (the gaussian's spread)
from the sample data — a data-derived spread would get distorted by hyperinflation outliers (a handful of
countries with -50%+ or +200%+ inflation would blow out a computed standard deviation and flatten everyone
else's score toward the middle, defeating the point of a target-centered score). σ = 1.0 percentage point
instead, from a real, stated policy threshold: the Bank of England's own tolerance band — a governor's open
letter to the Chancellor is required if CPI moves more than 1pp from the 2% target. Verified the formula by
hand against real sample output before trusting the full rebuild: Taiwan's 2.180626% inflation →
`100 * exp(-(0.180626² / 2))` = 98.38, matched the script's own output exactly; the US's 2.94953% →
`100 * exp(-(0.94953² / 2))` = 63.71, also matched exactly.

**Removed the 2026-08-22 patch's diff-preservation scaffolding** (`rankInflationOld`, `inflationPctOld`, the
`_diffOnly` field on `finalizeCountry`'s return value, and `writeInflationScoringDiff()` /
`debug/economy-inflation-scoring-diff.md`) — that machinery existed specifically to diff THAT patch's
before/after (inverted-percentile vs. distance-percentile), a comparison this patch makes moot by replacing
the distance-percentile method itself. Kept it up through verifying this patch's own diff, then removed it
rather than leaving dead, no-longer-meaningful diff code sitting alongside the real scoring path. This
patch's own before/after review used `git diff` against the actually-committed `economyScores.ts` instead
(HEAD still had last week's PPP-based, percentile-only, no-Taiwan version, since nothing from this week's
Economy work had been committed yet) — no new permanent diff tooling was added to the script for it.

**Real before/after, US vs. China specifically** (the case the GDP rationale was built around): under the
last COMMITTED version (PPP GDP, percentile rank, distance-percentile inflation) the US scored 77.6 and China
83.6 — China ranked ahead despite the size argument. Under this patch (nominal GDP log-min-max + gaussian
inflation, still uncommitted at time of writing): US 79.5, China 69.7 — the US now clearly leads, driven by
both changes together (GDP log-min-max modestly widens the US's size edge; separately, China's near-zero
0.22% inflation now scores 20.4 under the gaussian, versus 63.7 for the US's 2.95%, which is itself close to
target). Across the full 194-entity dataset: average composite delta -1.24, 78 entities moved up more than
0.5 points, 95 moved down more than 0.5 — the biggest single movers were Sri Lanka (-19.2), Afghanistan
(-17.6), and Thailand (-17.5), all countries whose inflation sits well outside the gaussian's effective range
around 2%. Confidence tiers unaffected (still 187 measured / 3 proxy / 4 unavailable) — both changes are
normalization-only, not coverage-only.

## 2026-08-25 — Technology category: component list locked, GII-backbone design superseded

Same process Military went through: draft, find the real problems in it by actually reading the source
structure, redesign around directly-sourced single-purpose indicators instead of a bundled index.

**Why the original GII-backbone design didn't hold up.** The draft in `Intelligence Docs/intelligence-engine-
scoring-design.md` §3.3 used WIPO's Global Innovation Index as the backbone metric, plus PCT patent filings
and a general "AI Index" reference as separate inputs. Reading GII's own indicator list surfaced two real
problems, not stylistic ones: PCT patent filings are already one of GII's own 78 indicators (Knowledge and
technology outputs pillar, Knowledge Creation sub-pillar) — scoring GII and PCT filings as separate components
double-counts the same underlying signal. And GII's Input sub-index includes an Institutions pillar (political
stability, regulatory quality, business environment) — real content, but governance context, not technology
capacity; using GII as-is would smuggle non-technology signal into a category that's supposed to measure
technology specifically. Both problems trace back to the same root cause: GII is a bundled composite designed
for its own purpose (overall innovation ranking), and borrowing it as a backbone inherits its internal
structure whether or not that structure matches this project's category boundaries.

**Resolution: drop GII as the backbone, build from 6 directly-sourced components instead** — R&D expenditure
(% GDP, World Bank WDI), patent applications by residents per capita (WIPO IP Statistics, sourced directly,
not via GII), high-tech exports (% of manufactured exports, World Bank WDI), the ITU ICT Development Index
(relaunched 2023 methodology), researchers per million (UNESCO Institute for Statistics), and AI researchers/
developers per capita (Stanford AI Index, 2026 edition). Two components needed their own rejected-alternative
notes: total R&D expenditure in dollars (not %GDP) was considered and dropped for component #1, since it's
%GDP × GDP and would double-count economic scale as technology capability; and for the AI Index component,
notable-AI-models-produced (too concentrated, ~6 countries, needs its own true-zero call), publications/
citations volume, and private AI investment ($) were all considered and rejected as scale-correlated with GDP/
population — the same size-vs-intensity artifact as the R&D-dollars rejection — before landing on researchers/
developers per capita as the one that actually measures capacity rather than scale or attention.

**Weighting: equal by default, per Governing Principle 6 — not a default taken lightly.** Two illustrative
weighted schemes were hand-drafted and reviewed before falling back to equal weighting; neither had citable
backing, and — worth noting as the actual reason this wasn't a close call — they didn't even agree with each
other on the split. Without a citable framework and without so much as informal convergence between two
independent attempts, Principle 6's default (equal weighting) is the honest answer, not a placeholder pending
a better one.

**Advanced Industry (semiconductor/aerospace/robotics/biotech capability) backlogged, not scored or excluded
on principle.** No single named public dataset covers this sub-sector combination as one composite; a first
pass suggests most candidates are subscription-gated or methodology-opaque, the same shape of blocker
Military's naval/ground-equipment and air-fleet backlog items (§3.1) already hit. Not investigated
source-by-source yet — that's the actual next step, logged in `BACKLOG.md`'s new "Intelligence Engine —
Technology sourcing" section rather than guessed at now.

**What's still open, deferred to Section 9/10 rather than decided here:** normalization method (log-min-max vs.
percentile-rank) and whether Technology adopts Military's coverage-floor/true-zero confidence mechanism —
neither resolved by locking the component list and weighting default. Diplomacy's weighting is now the only
still-fully-open weighting question in Section 9; Technology's is resolved.

## 2026-08-25 (cont.) — Technology finalized at 4 locked components

Technology finalized at 4 locked components (R&D%GDP, WIPO patents/capita, high-tech exports%, ITU ICT
Development Index), equal-weighted. Nine candidate 5th components investigated and documented in the design
doc rather than silently dropped: GII/PCT (double-count), four AI Index metrics (concentration/scale bias),
AIPI (closed data + composite opacity), Oxford Insights (wrong construct), Global AI Vibrancy (36-country
ceiling), MSCI tech-sector weighting (salience bias + 47-country ceiling + paywalled), IMD WDCR (69 countries
+ survey data + paywalled), labor force with advanced education (not STEM-specific, flat-percentage fix
rejected as mathematically inert), and UNESCO STEM-graduate share (closest fit — ~120 countries, missing
China — flagged for future research rather than closed).

## 2026-08-22 — Economy: inflation scored as distance from a 2% target, not "lower is always better"

Direct patch request. `scripts/buildEconomy.mjs`'s inflation component previously used the same inverted
percentile every other "lower is better" component (unemployment) uses: rank the raw inflation rate, then
`100 - percentile`, so the country with the lowest raw inflation always scored highest. That's wrong for
inflation specifically — 2% is the explicit longer-run target both the Federal Reserve
(federalreserve.gov/faqs/economy_14400.htm) and the Bank of England (bankofengland.co.uk/monetary-policy/
inflation) state outright, and the old method scored inflation near 0% (or negative — deflation) as
excellent, which misrepresents deflation risk: deflation is its own economic hazard (falling prices delay
spending, raise the real burden of debt, and correlate with recession), not "very good low inflation."

New formula, exactly as specified:
```
distance = Math.abs(inflation - 2.0)
percentile = invertedPercentile(distance)   // smallest distance to 2% scores highest
```
Implemented as a second percentile ranker (`rankInflationDistance`, built from each country's `|raw - 2.0|`)
alongside the existing `buildPercentileRanker` — no new normalization primitive needed, distance is just
another value to rank. A missing raw inflation value maps to `distance = null`, not `distance = 2.0` (which
would have falsely claimed "this country's inflation is exactly on target" for a country with no data at
all) — `buildPercentileRanker`'s existing null-handling (`if (v == null) return null`) already does the right
thing once the input is properly null, so this needed no special-casing beyond computing the distance
correctly in the first place.

**Kept the old inverted-percentile method in the code, specifically to diff against** (per the patch's own
instruction) — `rankInflationOld` (built the old way, on raw inflation directly) and, inside
`finalizeCountry`, `inflationPctOld` computed alongside the new `inflationPct`, plus a full parallel
composite (`valueOld`, the same weighted-average formula with `inflationPctOld` substituted for the real
`inflationPct`) — attached to each entity's return value as a `_diffOnly` field that `scoreToTs` never reads
(it only serializes the fields it explicitly names), so none of this reaches `economyScores.ts`. A new
`writeInflationScoringDiff()` writes `debug/economy-inflation-scoring-diff.md` (gitignored, same as the
existing component-breakdown dump) — full per-entity old/new inflation percentile and composite score, sorted
by `|composite delta|` descending — plus prints a summary and top-10 movers straight to the console, so the
before/after is visible immediately on a full run without needing to open the file.

**Real output confirms the fix does what it's supposed to, not just what the formula says it should:**
France (1.999% — essentially exactly 2%) moved from 85.7 to a perfect 100 on the inflation component (old
method never gave anything but the single lowest-inflation country 100). The entities with the single biggest
composite swings are dominated by deflation/near-zero cases exactly as expected: Afghanistan (-6.60% —
deflation) dropped 14.6 composite points (its inflation percentile fell from a old-method 100 to 12.6 new),
Nauru (-0.12%) dropped 11.7, Costa Rica (-0.41%) dropped 10.7, China (0.22%) dropped 9.1. Countries actually
near the 2% target (France, Peru at 2.01%, Djibouti at 2.11%) gained instead. Average composite delta across
all 184 scored entities: ~0.0 (the redistribution is relative, not a systematic up- or down-shift of the whole
category) — 124 entities moved up, 34 moved down, the rest changed by less than the 0.05 threshold used for
that count. Confidence tiers unaffected (still 187 measured / 3 proxy / 4 unavailable) — this only changes how
the composite is computed for entities that already had inflation data, never coverage.

## 2026-08-22 — Economy: removed the IMF WEO trial entirely, switched GDP to nominal, kept Taiwan on IMF

Direct request, after the user "figured out the issue" with the whole WEO-trial direction below: remove all
IMF/WEO data and app wiring, go back to World Bank WDI like the original v6.6.0 Economy build, replace the
"GDP size" component with nominal GDP instead of PPP-adjusted, and — the one thing to keep from the otherwise-
fully-reverted trial — Taiwan's coverage, since that's the actual, narrow reason IMF sourcing was ever needed
(WDI structurally excludes Taiwan). In hindsight the whole standalone trial — re-sourcing all 5 components
for all 193+1 entities from IMF WEO, plus the WDI/IMF WEO toggle UI in both `AnalyticsPanel.tsx` and
`IntelligencePanel.tsx` — was solving a much bigger problem than the one that actually existed: the real gap
was always just "Taiwan has no WDI data," not "WDI as a whole needs reconsidering."

**Removal, verified clean via `git diff` before committing anything:** `scripts/buildEconomyWeo.mjs` and
`hud/useEconomyScoresWeo.ts` deleted outright. `AnalyticsPanel.tsx` and `IntelligencePanel.tsx` restored from
commit `c8cdce9` (the last commit before the trial's wiring work) rather than hand-reverting the toggle UI —
the earlier diff against that commit was confirmed purely additive (the trial's own commits never touched any
pre-existing line in either file), so restoring the whole file was safe and exact, not an approximation.
`package.json`'s `build:economy-weo-trial` script and `.gitignore`'s `public/debug/` entry (added only for
the trial's runtime-fetchable output) removed. Regenerated local trial artifacts (`public/debug/`,
`debug/economy-wdi-vs-weo-coverage-diff.md`) deleted from disk.

**GDP (size) component: PPP-adjusted → nominal.** `GDP_NOMINAL_INDICATOR` is now World Bank's `NY.GDP.MKTP.CD`
(was `NY.GDP.MKTP.PP.CD`). Renamed the field `gdpPpp` → `gdpNominal` everywhere — the build script, the
generated `economyScores.ts` type/data, and both UI consumers' column/row labels (`AnalyticsPanel.tsx`'s
`ECONOMY_COLUMNS`, `IntelligencePanel.tsx`'s `EconomyDrilldown`) — rather than keeping the old field name for
a different underlying metric, which would have silently misled anyone reading the type later. GDP per capita
stays PPP-adjusted, untouched — this was specifically about the aggregate size metric. The v6.6.2
double-weighting (real GDP growth structurally penalizes large economies — see that entry below) carried over
unchanged, just re-pointed at the renamed field; verified the ranking still made sense post-swap (nominal GDP
being smaller than PPP GDP for most economies shifts everyone's raw number down, but percentile RANK — what
actually feeds the composite — only cares about relative ordering, which nominal vs. PPP doesn't necessarily
preserve identically, so this was worth an eyeball check, not an assumption).

**Taiwan, kept on IMF WEO as a narrow, permanent exception** — not a revival of the removed trial, a single
`buildTaiwanScore()` function appended to `buildEconomy.mjs` (~120 lines, self-contained: its own indicator
constants, its own SDMX fetch/parse helpers, its own actual-vs-projection filtering) whose result gets pushed
into the same `built` array the 193 WDI countries populate, BEFORE percentile ranking runs — meaning Taiwan's
real values compete in the same ranking pool as every WDI country, not a segregated one. Resolved to the same
"most recent ACTUAL year, projections excluded" standard the WDI-sourced components already meet by
construction (WDI has no projections at all to worry about; WEO does, so this needed the same
`COUNTRY_UPDATE_DATE`-derived vintage-year filtering technique the now-deleted trial script pioneered — see
that work's own entries below for the original research trail, not repeated here since this is a much smaller
reuse of it, not a new investigation).

**A real bug, caught before it shipped by inspecting sample output rather than trusting the code:** IMF's
`NGDPD` indicator ("GDP, current prices, US dollars") is commonly documented — and was assumed here at
first — to report values in billions, so the first implementation multiplied by `1e9` to convert to raw
dollars matching WDI's units. Taiwan's `--sample` output came back with a nominal GDP of
`801495464000000000000` ($801 sextillion) instead of a plausible ~$800 billion. Checked the raw API response
directly via `curl`: Taiwan's actual 2024 `NGDPD` value is `801495464000` — already in whole current US$, not
billions, despite the indicator's common documentation. Removed the `× 1e9` conversion entirely; re-verified
against the raw series before trusting the fix. Worth remembering if `NGDPD` (or any other WEO indicator
whose documented "billions" unit doesn't match live behavior) comes up again — the live API's actual values,
not the indicator's documented unit, are the ground truth.

Full rebuild: 194 entities (193 WDI + Taiwan), confidence breakdown 187 measured / 3 proxy / 4 unavailable.
Taiwan itself: `measured`, 5/5 coverage, composite 87.1. Verified `tsc -b --noEmit`, `oxlint`, and
`vitest run` (96/96) all clean after every file touched by this change.

## 2026-08-22 — Economy WEO trial: GDP (PPP) now targets the current calendar year, not the most recent actual

Follow-up patch: "rerun it with most recent gdp(2026) only, no average," later clarified to mean plain GDP
(PPP), not GDP growth (the request's parenthetical "(2026)" — today's year — was the key signal once
clarified, not an instruction to average anything; GDP (PPP) was never averaged to begin with).

First implementation attempt applied this to the wrong component (GDP growth) before the clarification —
reverted cleanly, no residue: growth is back to its original, unmodified 5yr trailing average, and the
IntelligencePanel/useEconomyScoresWeo changes made for that attempt (a `years`-vs-`year` fallback in
`EconomyDrilldown`) were reverted too, since once growth stopped diverging from the WDI script's shape, the
fallback was complexity with nothing left to guard against — `git diff` after finishing confirmed only
`scripts/buildEconomyWeo.mjs` actually changed.

**A real bug surfaced building the correct version:** the first cut of the new resolver (`resolveWeoLatest`)
took `rows[0]` — the single most-recent row in the fetched series — assuming that meant "the current year."
It doesn't: `WEO_LOOKAHEAD_END_YEAR` requests data through 2032 so the (unrelated) growth average always has
enough room, and WEO's real projections extend that far, so `rows[0]` was actually the FURTHEST year
available (2031), not the nearest one. Caught the same way this file's other WEO bugs have been caught —
inspecting actual sample output, not trusting the code because it ran without error — every sample country's
GDP (PPP) came back dated 2031, not 2026. Fixed by resolving to the row matching
`new Date().getFullYear()` exactly (falling back to the nearest available year only if that exact year is
somehow missing), which is also self-updating the same way `vintageYear` already is — no hardcoded "2026" to
go stale next year.

Verified against Brazil's raw `PPPGDP` series before trusting the fix: 2024 (the newest actual) is $4.74T,
2026 (now correctly selected) is $5.23T, both real published figures, not interpolated. Full rerun: same
190 measured / 0 proxy / 4 unavailable confidence breakdown as before (this only changes which year's value
gets used, not whether one exists), and the coverage diff summary is byte-identical. Reflected live in the
already-wired UI without any app-code changes: Saudi Arabia's GDP (PPP) column moved from $2.54T to $2.89T,
China's composite score shifted from 83.5 to a re-ranked position with GDP (PPP) now showing $44.3T dated
2026 in the drill-down, sourced and flagged as an IMF WEO projection via the existing `projectionNote`
mechanism.

**Known gap, not fixed here (out of scope for this patch):** `IntelligencePanel.tsx` never actually renders
`projectionNote` anywhere in the UI — the field is computed, stored, and correctly flagges internally, but a
user looking at the drill-down has no visual cue that a value is a projection vs. a finalized actual, for
either GDP (PPP) now or growth's pre-existing projection-flagging. Worth a follow-up if the WEO trial is ever
taken further.

## 2026-08-22 — Economy: wired the IMF WEO trial into the running app for review

Follow-up to the trial below, once "diff before deciding" needed to become "actually look at it live" — the
markdown coverage diff and sample JSON answer "is this a strict improvement" in aggregate, but not "what does
this look like for a specific country I care about."

Two moving pieces: (1) `scripts/buildEconomyWeo.mjs`'s output moved from `debug/economyScoresWeo.json` to
`public/debug/economyScoresWeo.json` — the dev server only serves `public/`, and this data has to actually be
fetchable at runtime, not just readable off disk. Both paths stay gitignored (added `public/debug/` as its
own `.gitignore` entry, right under the existing `debug/` one, with a comment distinguishing "servable" from
"not"). (2) a new hook, `hud/useEconomyScoresWeo.ts`, copying `scene/useCountryFeatures.ts`'s singleton
fetch-once-share-result pattern rather than inventing a new one — the one deliberate difference is that a
failed fetch here sets `scores: null` silently, no console warning, since "this machine never ran the trial
build script" is the expected common case, not an error condition the way a missing *real* data file would be.

Two independent toggle points, not one shared "economy source" store — considered a global store first, but
the two views want different scope. `AnalyticsPanel.tsx`'s Economy ranked list toggle swaps the *entire
table* (rows/columns/sort all rebuild from `buildEconomyRowsFromWeo()`), because a ranked list only makes
sense body-and-headline from one consistent source at a time — a mixed list would rank some rows by a WDI
composite and others by a WEO one. `IntelligencePanel.tsx`'s toggle only swaps the *expanded drill-down*
breakdown; the ECONOMY status-bar headline number stays WDI always, matching what already covers "which
source is the real one" for every other status bar. Getting this right mattered because the alternative
(status bar also flipping) would make WDI vs. WEO look like two equally-authoritative app-wide modes rather
than "one real number, one reviewable trial."

**A real, if minor, gap surfaced by wiring this in rather than just eyeballing JSON:** Taiwan is WEO-only (no
WDI Economy score exists for it at all — WDI structurally excludes it), so it needed to actually render and
be clickable in `AnalyticsPanel.tsx`'s WEO-mode ranked list. Its centroid wasn't available the way every other
row's was — `AnalyticsPanel.tsx`'s pre-existing `centroidById` map was built only from `useCountryFeatures()`,
and Taiwan is a GeoEntity, not a Country. Extended it with a second pass over `useGeoEntityFeatures()`,
bridged through the existing `entities/entityGeometryIds.ts` id maps (the same geometryId/entityId split
`GeoEntities.tsx` already has to account for — see CLAUDE.md's "GeoEntity geometry" section) rather than
special-casing Taiwan by name. Verified live: clicking Taiwan's row opens the same selection panel a country
click does, correctly labeled "Geopolitical Entity," with the existing (pre-existing, not a new gap) "—" for
every status bar including Economy, since none of those are GeoEntity-aware yet.

Verified all three toggle states live in the browser (WDI list → WEO list → China's drill-down WDI → WEO,
values changing and source-URL labels changing from "World Bank (WDI)" to "api.imf.org" as expected) before
calling this done — this file's own recurring lesson (typecheck/lint/tests passing isn't proof a UI feature
actually renders and behaves correctly) applied once more here.

## 2026-08-22 — Economy: IMF WEO source trial — verified the API for real, caught a real bug, found a real coverage regression

Built `scripts/buildEconomyWeo.mjs`, a standalone trial re-sourcing Economy's 5 components from IMF World
Economic Outlook (WEO) instead of World Bank WDI, per the patch's explicit "keep the WDI-based output around,
diff before deciding" instruction. Does not touch `buildEconomy.mjs` or `src/data/economyScores.ts` — writes
to `debug/` only (gitignored), not wired into the app.

**Two things needed resolving with the user before writing any code, both via `AskUserQuestion`:**

1. **The patch's Taiwan premise didn't match the codebase.** It described Taiwan as having "a documented IMF
   WEO override because WDI doesn't cover it" that would become "redundant" once WEO was the default. Checked
   first: no such override exists anywhere in `buildEconomy.mjs` or the Economy-scoring path — Taiwan was
   never even in this script's 193-country loop (it's a GeoEntity in this app's registry, not a Country,
   precisely because it isn't a UN member, so `countries-un193.json` never included it). The only real
   Taiwan+WEO reference anywhere in the codebase is an *unimplemented* backlog note in
   `buildGeoEntityEconomics.mjs` (a different dataset — GeoEntity population/gdpUsd, not Economy category
   scores). Flagged this rather than either fabricating a "retirement" of an override that never existed, or
   silently expanding scope by adding Taiwan without asking. User chose to add Taiwan now — implemented as a
   one-off synthetic entry (`{id: 'taiwan', alpha3Override: 'TWN'}`) appended to the country loop, keyed by
   its GeoEntity registry id since it has no numeric topology id. Confirmed live that WEO covers Taiwan
   directly under standard ISO3 "TWN" (real GDP PPP data back to 1980) — no special "Taiwan Province of
   China" code needed.
2. **The official actual-vs-projection field wasn't reliably extractable.** WEO's data model really does
   have a `LATEST_ACTUAL_ANNUAL_DATA` attribute (confirmed via the SDMX `/structure/` endpoint with its full
   definition: "the latest annual period for which official statistics are available... data following this
   period are normal staff estimates") — but it came back `null`/absent across every query variant tried
   against the live `/data/` endpoint (the documented `?attributes=LATEST_ACTUAL_ANNUAL_DATA&detail=
   serieskeysonly` pattern, several other attribute-request shapes, with and without `detail=serieskeysonly`).
   Independently corroborated as a known pain point rather than a mistake on this session's part: the
   `imfweo` R package — a tool purpose-built for WEO access — explicitly documents avoiding the SDMX API for
   exactly this kind of extraction difficulty and downloads the classic bulk Excel/CSV file instead. That
   fallback wasn't available here either — `imf.org`'s own site (where the bulk file lives) returns 403 to
   every non-browser fetch attempted, unlike `api.imf.org` itself. User's preference was "keep trying the
   official field first," which is what happened before falling back — not a shortcut taken instead of
   trying.

**Fallback actually used, and why it's the safer failure direction:** every WEO series response reliably
includes a `COUNTRY_UPDATE_DATE` attribute (confirmed working on every query — the date that specific
country+indicator series was last refreshed). `vintageYear` = that date's year; any observation year
`>= vintageYear` is flagged as a projection. This deliberately over-flags rather than under-flags (a
near-final estimate for the vintage year itself might get called "projection" when IMF would treat it as
close to actual) — the safer direction, since the whole point of the feature is never presenting a forecast
as an equivalent-confidence reported figure. It's also self-updating: re-running after IMF publishes a newer
WEO edition shifts every vintageYear forward automatically, no hardcoded date to bump.

**A real bug, caught by reading actual sample output rather than trusting the code because it ran without
error:** the first version's "most recent value" resolver did what `buildEconomy.mjs`'s WDI resolver
correctly does — sort observations descending, take the newest — which is right for WDI (no forward
projections at all) but wrong for WEO, which genuinely publishes 5-7 years of real forward projections
alongside history. Taiwan's sample output came back with every component dated **2031**, the single furthest
lookahead year requested, instead of any real reported figure. Fixed by preferring the most recent row with
`year < vintageYear` (a genuine actual), falling back to the nearest available row overall only when no
actual exists in the lookback window at all; the 5yr growth average got the equivalent fix (fill from actuals
first, backfill with the *nearest* — not furthest — projected years only if fewer than 5 actuals exist).
Re-verified Taiwan after the fix: 2024 actuals across all 5 components, 2020-2024 for the growth window, zero
projection flags — and confirmed the fix held across the full 194-entity run too: **zero component values in
the entire dataset ended up flagged as projections**, meaning WEO's real historical depth made the fallback
path unnecessary in practice for every entity this run actually covered, not just Taiwan.

**Coverage diff (`debug/economy-wdi-vs-weo-coverage-diff.md`, generated against the real, committed
`src/data/economyScores.ts` — imported via `tsx`, not re-fetched) confirmed the "not a strict improvement"
warning was well-founded, in both directions:**
- **Liechtenstein**: WDI 1/5 (unavailable) → WEO 5/5 (measured) — a real, large gain, exactly matching what a
  pre-implementation live API check had already predicted.
- **Monaco**: WDI 1/5 (unavailable) → WEO 0/5 (unavailable) — Monaco isn't an IMF member; the country code
  doesn't resolve in WEO at all. Same confidence *label* both ways, but a real regression in raw coverage
  (1 real component down to zero) that a tier-only diff would have hidden — the per-entity table reports both
  the tier and the raw coverage count for exactly this reason.
- **Unemployment coverage regressed broadly**: WEO is missing `LUR` for 82 of 194 entities, versus WDI
  missing its unemployment indicator for only 16 of 193 — by far the largest per-component gap between the
  two sources (the other 4 components are each missing for only ~4 entities under WEO, comparable to or
  better than WDI). This is the actual driver behind the widespread "measured 5/5 → measured 4/5" pattern
  visible across the diff table (still above the 3-of-5 floor, so no tier changes resulted, but a real
  completeness loss worth knowing about before adopting WEO wholesale).
- Net tier-level summary: 2 gained/improved tier (Liechtenstein, Andorra, Marshall Islands), 186 unchanged
  tier (many with a lower raw coverage count per the unemployment finding above), 4 unchanged-both-unavailable
  (Monaco, North Korea, Cuba, South Sudan), 1 new entity (Taiwan). Not adopted — this is exactly the
  before-deciding diff the patch asked for, not a recommendation either way.

## 2026-08-21 — Economy: GDP (PPP) double-weighted after real output showed size structurally penalized against growth rate

Requested patch: double-weight GDP (PPP) in the Economy composite, mirroring `buildMilitary.mjs`'s existing
expenditure double-weight. Rationale given: large, mature economies (the US specifically) were landing well
below smaller, faster-growing ones despite GDP/GDP-per-capita being near-maxed — a structural artifact, not a
data bug, since real GDP growth for a multi-trillion-dollar economy is mechanically constrained (the same
absolute dollar increase is a much smaller percentage of a $29T base than a $50B one), so equal-weighting
"size" against "growth rate" always penalizes size.

Implementation mirrored Military's exact pattern rather than reinventing it: a separate `weightedNormalized`
array (`[gdpPppPct, gdpPppPct, ...the rest]`, filtered for non-null) feeds the composite average, while
`coveragePresent` — used for the v6.6.1 coverage floor and confidence tiering — stays computed from the
original, undoubled `presentNormalized` list. This was the one detail worth being careful about: if the
doubled value had also fed `coveragePresent`, a country missing 3 of 5 real components but with GDP PPP
present would have counted as having 4 "components" (since GDP PPP's double-entry would inflate the count),
crossing the `>= 3` floor on a technicality rather than genuine coverage. Kept the two lists — and their two
different jobs — deliberately separate. Also updated the "Equal weight, no exceptions... a deliberate
contrast with Military's expenditure double-weight" comment above `finalizeCountry`, which the original
build prompt wrote as a permanent design decision — it described something that was true when written, not a
constraint that couldn't be revisited once real output said otherwise (the same "don't silently re-litigate,
but do record when a locked call gets reopened" discipline the design doc's own Governing Principle 6
documents for Military's identical override).

Verified by hand before trusting the full rebuild: recomputed the US's stored composite from its 5 stored
percentiles in `debug/economy-component-breakdown.json` with GDP PPP counted twice (77.6, matching the actual
`compositeScore` exactly) rather than assuming the code was correct because it ran without error. Full rerun:
China 80.4 → 83.6 (now #1), US 73.2 → 77.6 (moved from outside the top 10 into #7) — confirmed live in the
Analytics ECONOMY ranking, not just in the debug file. Confidence breakdown (186 measured / 2 proxy / 5
unavailable) unchanged, as expected — this patch only touches how the composite is averaged, not coverage.

## 2026-08-21 — Economy component-breakdown debug dump: read-only, gitignored, not a CHANGELOG-worthy change

Added `writeComponentBreakdownDebugFile()` to `scripts/buildEconomy.mjs` (full runs only, not `--sample`,
matching the existing "sample mode writes nothing" convention) — one JSON entry per measured/proxy-tier
country with each of the 5 components' raw value and post-inversion percentile alongside the composite,
written to `debug/economy-component-breakdown.json`. Every field is read straight off the already-computed
`finalScores` array; nothing about scoring, normalization, or weighting changed, and confirmed
`src/data/economyScores.ts` (the file the app actually consumes) came out byte-identical to before this
change. Spot-checked the US entry by hand: averaging its 5 stored percentiles reproduces `compositeScore`
exactly (73.238 → 73.2), confirming the dump reflects real computed values rather than a parallel
recalculation that could drift from the actual scoring path.

Added `debug/` to `.gitignore` — this is explicitly a one-off review aid ("before deciding whether a
weighting change is needed"), not a permanent data artifact the way `economyScores.ts`/`militaryScores.ts`
are, so it shouldn't accumulate as tracked, regenerable clutter. No CHANGELOG entry or version bump for this
one — nothing about the running app changed, only a local dev-tool output.

## 2026-08-21 — Economy coverage floor patch: a specified floating-point comparison would have silently broken the fix it was part of

Requested patch: `scripts/buildEconomy.mjs`'s confidence tiering needed a coverage floor — a country needs at
least 3 of 5 components present to get a score at all, rather than the original "even 1 of 5 produces a
low-confidence value" behavior. Real output caught this: Monaco and Liechtenstein, each with only their GDP
growth rate present (1 of 5), were outranking fully-measured economies because a single percentile had
nothing to average against and was standing in for the whole composite.

The patch spec described the tiers as float comparisons against the literal `sourceCoverage` value:
`sourceCoverage >= 0.8` → measured, `sourceCoverage == 0.6` → proxy, `sourceCoverage < 0.6` → unavailable,
where `sourceCoverage = 0.2 × componentsPresent`. Checked this in Node before implementing it literally:
`3 * 0.2 === 0.6` evaluates to `false` in JavaScript (`3 * 0.2` is actually `0.6000000000000001` — 0.2 has no
exact binary floating-point representation, the same class of bug as the canonical `0.1 + 0.2 !==
0.3` example). Implementing the `== 0.6` check exactly as specified would have made the `'proxy'` tier
unreachable — every country with exactly 3 of 5 components present would have silently fallen through to
`'unavailable'` instead, a second real bug nested inside the fix for the first one, and one that would not
have been obvious from reading the code (the comparison *looks* correct arithmetically). Implemented the
identical tiering logic against the integer `coveragePresent` count instead (`>= 4` / `=== 3` / `<= 2` —
exact, no floating-point risk) rather than the literal float comparison, and documented why directly in
`finalizeCountry`'s comment so a future reader doesn't "simplify" it back to the float form.

Re-ran the full 193-country build after the fix: confidence breakdown moved from 6 `proxy`/1 `unavailable` to
2 `proxy`/5 `unavailable` (4 countries dropped below the new floor), and confirmed directly in the browser
that Monaco/Liechtenstein no longer sit at the top of the Analytics ECONOMY ranking. Normalization and
weighting untouched, per the patch's own explicit scope.

## 2026-08-21 — Wiring Economy into the UI: generalizing AnalyticsPanel's ranked-list rather than pasting a second copy

Following up on the Economy build script (see the entry below): wired `data/economyScores.ts` into
`hud/IntelligencePanel.tsx`'s ECONOMY status bar + citation drill-down and `hud/AnalyticsPanel.tsx`'s ECONOMY
thumbnail + sortable ranked list, mirroring exactly what Military already had.

The one real decision here: `AnalyticsPanel.tsx`'s Military ranked-list machinery
(`RankedRow`/`METRIC_COLUMNS`/`compareMilitaryRows`/`SortableHeader`/`RankedListRow`, built across v6.4.0/
v6.5.3/v6.5.4) was written before a second category existed to prove out against. Two options: paste a
near-identical copy for Economy (`EconomyRankedRow`/`ECONOMY_METRIC_COLUMNS`/`compareEconomyRows`/...), or
generalize the shared machinery now that a real second consumer exists. Went with generalizing —
`BaseRankedRow`/`AnalyticsColumn<TRow>`/`compareRows<TRow>`/`SortableHeader`/`ColumnHeaderRow`/
`RankedListRow<TRow>` are now generic over any category's row shape via a TypeScript generic parameter, and
`MILITARY_COLUMNS`/`ECONOMY_COLUMNS` (plus each category's own `buildXRows`) are the only genuinely
category-specific pieces left. This is the "second real consumer justifies the extraction" moment this
codebase generally waits for before generalizing (same reasoning `scene/EntityRenderLayer.tsx`'s extraction
out of `Countries.tsx`/`GeoEntities.tsx` followed, per `CLAUDE.md`) — not a departure from that discipline,
an instance of it. Verified the generic sort/comparator logic against BOTH categories in the browser (Military
sorted by NUCLEAR/name/etc., Economy sorted by GDP PPP/name/etc.) rather than assuming the generalization was
correct just because it type-checked, since a generic comparator silently sorting by the wrong field would be
exactly the kind of bug that type-checks fine and only shows up as visibly wrong country ordering.

Smaller generalizations that fell out of the same pass: `IntelligencePanel.tsx`'s `militarySourceLabel()`
renamed to `sourceLabel()` (it already had a `worldbank.org` branch returning "World Bank (WDI)" — Economy is
entirely World Bank-sourced, so this needed zero new logic, just a name that doesn't lie about what it's for
now); `IntelRow`'s `confidence` prop widened from the Military-only `MilitaryConfidence` type to a local
`ScoreConfidence` union, since `MilitaryConfidence`/`EconomyConfidence` are independently-declared but
identical 3-value unions (confirmed neither codebase's `data/types.ts` nor anywhere else actually factors this
into one shared exported type — both categories independently reinvented the design doc's illustrative
`ScoreConfidence`, so the widened local alias in `IntelligencePanel.tsx` is a pragmatic fix at the *usage*
site, not a claim that the underlying duplication was resolved). The footer caption under INTELLIGENCE SUMMARY
needed the most rework: it was a single hardcoded "Military: sourced (...). Economy/Diplomacy/Technology/
Current Status — no assessment data currently sourced." string; now composes from however many of
Military/Economy are actually resolved for the current selection (`sourcedParts`/`unsourcedLabels`, built by
filtering `INTEL_METRICS`), since a real selection can now have either, both, or neither wired category
present independently — the old string assumed Military was always the only possible "yes."

`formatGdpPerCapita` was the one genuinely new piece of shared infrastructure needed: `formatGdp` assumes an
aggregate country-level figure (its smallest tier is Million) and a per-capita dollar figure (tens of
thousands) doesn't clear that floor — confirmed by checking what `formatGdp` would actually produce for a
per-capita input (an ugly "0.086 Million") before writing the new formatter, rather than assuming the mismatch
existed from the tier-table comment alone.

## 2026-08-20 — Economy scoring: percentile rank + weighted-sourceCoverage, a deliberate divergence from Military, not an inconsistency to reconcile

Built `scripts/buildEconomy.mjs` per the locked spec in `Intelligence Docs/buildEconomy-prompt.md` (itself
implementing `Intelligence Docs/intelligence-engine-scoring-design.md` §3.2) — 5 equal-weighted World Bank WDI
components (GDP PPP, GDP per capita PPP, 5yr-trailing real GDP growth, unemployment, inflation), percentile-rank
normalized, unemployment/inflation inverted since lower is better for both. All 193 countries scored: 186
`measured`, 6 `proxy`, 1 `unavailable` (South Sudan — already known in this codebase as the worst-case World
Bank data gap, see `countryEconomics.ts`'s header comment).

**Recorded per the build prompt's own "After completion" instruction, so this isn't mistaken for an
inconsistency to fix later:** Economy intentionally uses percentile-rank normalization and the design doc's
original weighted-sourceCoverage confidence model (`sourceCoverage = 0.2 × components present`; `>=0.8`
measured, `>0` proxy, `==0` unavailable — no hard floor, so even a single present component still produces a
`proxy`-tier value), diverging from Military's log-min-max normalization and coverage-floor mechanism. Both
divergences are deliberate per the design doc's own reasoning (§3.2, §4, §5): GDP's outlier skew is exactly the
problem percentile rank was originally adopted project-wide to solve, and Military's floor/true-zero machinery
grew out of Military's own multi-source, true-zero-component shape (nuclear warheads, industrial base) that
Economy's 5 coverage-gap-only components don't have an equivalent of.

**Tie-handling: stopped and asked before writing the normalizer, per the build prompt's explicit instruction**
("If percentile rank produces a tie-handling ambiguity... stop and ask before picking a tie-breaking convention
— don't silently pick one"). Confirmed: average/fractional rank (tied countries share the mean percentile of
the ranks they'd jointly occupy — matches Excel's PERCENTRANK / scipy's `rankdata(method='average')`), over
competition ranking (shared rank, next value skips ahead). Asked before running the full 193-country pipeline
rather than after discovering a real tie in the output, since the general percentile-rank formula itself
(`(rank-1)/(n-1)×100`) needed deciding either way and re-running a ~965-request build to fix a tie-handling
choice after the fact would have been wasteful.

**Output shape extends, rather than strictly matches, the build prompt's illustrative `CategoryScore`:** the
prompt's own example shows a flat `sources: string[]` of citation keys, but `EconomyScore` instead carries a
per-component `raw`/`normalized`/`year`/`sourceUrl` breakdown, mirroring `MilitaryScore`'s actual shape. This
isn't a deviation from the prompt so much as following its *other* instruction ("read buildMilitary.mjs first
for the established patterns this script should follow") over its own flat illustrative sketch — `MilitaryScore`
already set the real codebase precedent of extending the design doc's abstract Section 6 interface with
category-specific per-component detail, needed for the same citation drill-down (design doc §7) every category
is meant to eventually support, not just Military. Still respects the prompt's explicit exclusions: no
`confirmed`/`confirmedNote` (Military-specific), no stubbed empty `annotations` (none planned for Economy v1).

**Scope respected as written:** did not touch `scripts/buildMilitary.mjs`, `GeoEntity`/`Country` schema fields,
or any UI component — `hud/IntelligencePanel.tsx` and `hud/AnalyticsPanel.tsx` are untouched by this script, per
the prompt's explicit "rendering is a separate task." Wiring Economy into those is a natural next step but a
separate decision, not assumed here.

## 2026-08-20 — Analytics military ranking: sortable column headers, and a Tailwind `hidden`+`flex` conflict caught before it shipped

Requested: clicking a metric column header in the Analytics MILITARY ranking should re-sort the list by that
column (toggle ascending/descending, plus alphabetical for the country name), without changing any row's own
score.

Two things worth recording:

**Caught while writing `SortableHeader`, not after:** the first draft gave every header button an unconditional
base class list including `flex items-center gap-1 ...`, then had the 5 metric-column headers pass
`hidden xl:block xl:w-[92px]` as an additional wrapper className to hide them below the `xl` breakpoint (matching
`METRIC_COLUMN_CLASS`'s existing pattern on the data cells). That combination is broken: `hidden` (`display:
none`) and the base `flex` (`display: flex`) are both *unconditional* utility classes at the same
specificity/layer — which one wins is down to source order in Tailwind's generated stylesheet, not something
the component's own code controls, so the column could easily have rendered visible-but-broken instead of
actually hidden below `xl`, in a way that would only show up by resizing the browser, not by reading the JSX.
Fixed by not giving `SortableHeader`'s base classes any `display` utility at all — buttons are direct children
of the header row's `flex` container, so CSS auto-blockifies them as flex items regardless of their own
`display` value, and the *only* class controlling visibility/layout width is the one the caller passes in
(`hidden xl:block xl:w-[92px]` for a metric column, `w-12 shrink-0` for SCORE, `min-w-0 flex-1` for COUNTRY).
Same "hidden + a responsive display utility, nothing unconditional fighting it" idiom the rest of this file
already uses (`METRIC_COLUMN_CLASS`, the score bar's `hidden ... sm:block`) — the bug was specifically in
mixing an unconditional `flex` into a class list that also carried `hidden`.

**Null handling is asymmetric between SCORE and the other columns, on purpose.** Every metric column
(EXPENDITURE, % GDP, ...) has a real, `null`-able coverage gap — sorting by it treats `null` as "always last,
regardless of direction," so toggling ascending never turns a data gap into a top-of-list "best" value.
`scoreSortValue` (the composite) is different: it's never `null` — an `'unavailable'`-confidence country
already collapses to `-1` (a decision from the original v6.4.0 ranking, kept unchanged here) — so the SCORE
column just sorts as an ordinary number and doesn't need the null-handling branch at all. Worth remembering if
a future metric column is added: check whether its underlying value can genuinely be absent, versus already
having a sentinel fallback baked in upstream, before copying the null-handling pattern wholesale.

## 2026-08-20 — Analytics military ranking: columns instead of a per-row accordion, because the row was already a click target

Requested: the MILITARY ranked list in `hud/AnalyticsPanel.tsx` should show the underlying metrics
(expenditure, % GDP, personnel, nuclear warheads, defense-industrial base revenue), not just the composite
0-100 bar.

The obvious template to copy was already in the codebase: `IntelligencePanel.tsx`'s `MilitaryDrilldown`
component (v6.3.2) shows exactly these 5 fields, but as a click-to-expand accordion under the status bar —
clicking the MILITARY row collapses everything else and drops the components down inline. Considered doing
the same thing here (click a ranked-list row to expand its components inline, collapsing the rest of the
list). Rejected: a ranked-list row already has a real click meaning — `selectCountryRow`, which opens
`IntelligencePanel` for that country. Reusing the same click for "expand this row's metrics" would either
silently drop the select behavior or require a second, separate click target crammed into an already-dense
row, and either way a user would have to guess which action a click on the row name actually did. Columns
sidestep the ambiguity entirely: every row's 5 components are simply always visible, no interaction needed,
and the existing row-click → select behavior is untouched.

The tradeoff is horizontal space — 5 more columns plus rank/name/bar/score doesn't fit a narrow view. Gated
the metric columns behind `xl:` (matching a header row placed directly above the list, built with identical
column widths so header and data can't drift out of alignment independently) rather than trying to
responsively reflow them into multiple lines per row, which would have made the "one row = one country"
scan-ability the whole ranked-list format exists for much worse. Below `xl`, the view degrades to exactly
what shipped before this change (rank/name/bar/score) rather than something half-broken.

## 2026-08-20 — Layer Presets: reassigned an existing button rather than adding a new one, and reached for localStorage for the first time

Requested: let a user store a layer configuration so they don't have to keep re-toggling the same layers on
and off. The request specifically named "the layer's button beside the settings wheel" — TopNav's Layers icon
— as the thing whose function should change, not a request for a brand-new button somewhere.

Two decisions worth recording:

1. **Reassign vs. add a third icon.** TopNav's Layers button and every SideRail category row both opened the
   same `'layers'` `HudPanel` (the toggle list) before this change. Reassigning the TopNav button specifically
   to a new `'layerPresets'` panel, while leaving every SideRail row pointed at `'layers'` unchanged, keeps
   both interactions reachable without adding a third icon to an already-full utility cluster: SideRail is
   still where you build a configuration (toggle individual layers), TopNav's button is now where you
   save/restore one. Matches the request's own framing ("change the function of the layer's button") rather
   than reading it as "add a presets feature somewhere."
2. **Persistence: localStorage, the first use of it in this codebase.** Every existing piece of UI state —
   camera sensitivity (`hud/settingsStore.ts`), the live layer enabled map (`layers/layerStore.ts`) itself —
   resets to defaults on reload; nothing in this app persists across a session before this. Considered keeping
   presets in-memory only, matching that existing convention, but rejected it: the request said "store," and
   a preset that vanishes on refresh doesn't satisfy "so they don't have to go back and turn certain layers on
   and off" as directly as one that survives a reload/new session does. `layers/layerPresetsStore.ts` wraps
   every `localStorage` read/write in try/catch (private browsing, storage disabled, or corrupt JSON all
   degrade to "start empty" or "this session works, next reload doesn't persist" rather than a thrown error
   during module init) since this is the first module in the codebase relying on a browser API that isn't
   guaranteed available.

Mechanically straightforward otherwise: `layerStore.ts` already exported `setLayerEnabled(id, value)`
alongside the existing `toggleLayer`, so applying a saved preset needed zero changes to that store — a preset
is just a captured `{layerId: enabled}` map replayed through the existing setter. The one thing worth being
careful about was *which* ids to replay: a preset saved before a layer existed shouldn't be able to force that
layer off when applied later (it was never asked about it), and a preset that mentions a layer since removed
from the app has nothing left to act on — `applyLayerPreset` intersects the saved snapshot against
`getLayerDefinitions()`'s current ids rather than blindly replaying every saved key.

## 2026-08-20 — Analytics tab: full-screen dashboard, not a rail panel; only Military got a real ranking

Requested: unlock the inert ANALYTICS top-nav tab with a clickable thumbnail per status-bar metric
(Military/Economy/Technology/...), each drilling into the full ranked list of countries.

Three judgment calls made explicit before writing any code, since each one had a real alternative:

1. **Economy has no 0-100 composite score — only raw GDP/population.** Could have ranked Economy by nominal
   GDP (real, World Bank-sourced data already on `Country`) instead of leaving it disabled. Decided against:
   `IntelligencePanel.tsx`'s own comment is explicit that this project doesn't fabricate assessment scores
   without an editorial process behind them, and a GDP-sorted list sitting under an "ECONOMY" thumbnail next
   to a genuine 0-100 composite score (Military) would read as more comparable to Military than it actually
   is — same units problem, different kind of number. Economy/Diplomacy/Technology/Current Status all render
   the identical disabled state, matching `IntelligencePanel.tsx` exactly.
2. **Full-screen overlay vs. a docked rail panel matching `LayerPanel.tsx`/`AlliancesPanel.tsx`'s existing
   264px-wide chrome.** The existing panel slot exists and reusing it would've been less code. Rejected once
   the actual content was considered: a 193-row ranked list with a value bar per row needs real width to be
   legible, and cramming that into a 264px rail panel would've meant either truncating names or dropping the
   bar entirely. Full-screen, gated on `navStore.ts`'s `TopNavTab` (already had a reserved `'analytics'`
   value and an inert `TABS` entry — this only had to flip `wired: true`) rather than `hudPanelStore.ts`'s
   `HudPanel`, since it's a different *kind* of thing (a view replacing the globe, not a toolbar dropdown
   floating over it) and the two are orthogonal anyway (`IntelligencePanel` still opens on its own `HudPanel`
   independent of which `TopNavTab` is active).
3. **Does clicking a ranked-list row fly the camera there, the way a `SearchBar.tsx` result does?** Decided
   no. The globe is hidden behind this full-screen overlay while it's open, so a camera flight nobody can see
   would be pure wasted motion; `direction` is still computed correctly (same centroid + current-rotation
   technique `SearchBar.tsx` uses) so `IntelligencePanel`'s existing FOCUS CAMERA button still works once the
   user switches back to MAP. Also decided the ranked list should stay open across a row click rather than
   snapping back to the map — the point of the view is browsing/comparing, and forcing a re-navigation back
   into ANALYTICS after every single click would undermine that.

Mechanically, this surfaced one bit of pre-existing duplication worth fixing on the way: `intelValueColor`
(the red→amber→green interpolation) and the five-metric id/label/icon list were both private to
`IntelligencePanel.tsx`. The new ranked list needed the exact same color mapping and the exact same metric
identity — copying them would have created the two-independent-copies drift risk this codebase already avoids
elsewhere (`scene/highlightColors.ts`, `hud/panelStyles.ts`), so both got pulled into their own modules
(`utils/intelValueColor.ts`, `hud/intelMetrics.ts`) that `IntelligencePanel.tsx` now imports from too, rather
than duplicated.

## 2026-08-20 — State/province label sizing: first attempt looked like "no change" because it only touched half the rendering path

Requested: state/province name labels should read bigger once zoomed in on a region, bounded within their own
polygon. First attempt raised `PassiveEntityLabels.tsx`'s font-size ceiling/ratio only for
`StateProvinceLabels.tsx`'s passive label layer. Reported back as "doesn't seem different," with a concrete
example (Hessen, Germany) and a specific target: 1.67x bigger, for all states.

The "no change" report made sense once traced through: `StatesProvinces.tsx` doesn't render province
hover/select state through `EntityRenderLayer.tsx` at all (see that file's own comment on why —
`ProvinceFillLayer.tsx` replaced it once province count made the shared component's one-mesh-per-entry model
an FPS bottleneck), but `ProvinceFillLayer.tsx` still reuses `EntityRenderLayer.tsx`'s `HoverLabel` component
for the actual hover callout. `HoverLabel` calls `useApparentFontSize()` with no config — the original,
unmodified constants. Hovering a state (the natural way to go look at one specific state's label up close) was
showing `HoverLabel`, not the passive label the first attempt had actually changed — so the fix was invisible
exactly where it was being checked.

Fix: made the font-size formula (`useApparentFontSize.ts`) accept an optional config end-to-end — both the
reactive hook `HoverLabel` uses and the pure function `PassiveEntityLabels.tsx`'s per-candidate loop uses —
then created one shared config (`scene/stateLabelFontConfig.ts`, its own plain `.ts` module for the same
oxlint react-refresh reason `geoEntityEntries.ts` already documents) passed into *both* call sites. Sized as an
exact 1.67x scale of the original floor/ceiling/ratio (6→10px, 11→18px, 0.12→0.2) rather than picking new
numbers by feel, per the reported target, and rather than only raising the ceiling — scaling all three
preserves the same growth shape, just uniformly bigger at every zoom level instead of only at the top of the
range. Lesson: when two components are documented as "meant to read as the same size" (see v5.2.8's `HoverLabel`
fix below), a sizing change has to land in both, and the natural way a user checks a label ("hover over it to
look closely") is likely to hit the one that's easy to miss.

## 2026-08-20 — States/provinces reveal distance eased to match metro-areas: small change, but reopens a previously-closed FPS caveat

`lod/lodLevels.ts`'s `'states'` tier moved from `revealDistance: 2.8` to `2.85` — direct request that
states/provinces become visible at the same zoom level as major cities, i.e. exactly matching
`'metro-areas'`'s own 2.85 rather than trailing it by one tier. Mechanically trivial (one number, plus the
matching `IntelRow`-style doc-comment/test updates in `lodLevels.ts`/`lodLevels.test.ts`), but worth a note
because of what it touches: `2.8` was not an arbitrary starting point — it was landed on specifically to
close the "choppy over Europe" wide-multi-country-view FPS case (see `BACKLOG.md`'s states/provinces FPS
entry and this file's earlier "States/provinces FPS" parts), by making the camera too close for a
comparably-wide view to be in frame at all once states are active. Loosening the threshold at all moves back
toward that case in principle. Judged safe without re-profiling because 2.85 vs. 2.8 is a tiny fraction of
the 5.0/3.5 → 2.8 jump that actually caused and then fixed the original regression — but "judged safe" isn't
"confirmed," so `BACKLOG.md`'s entry now flags this explicitly rather than silently assuming the old fix's
margin covers it. Re-profile the same way if choppiness over a wide region gets reported again.

## 2026-08-20 — IntelligencePanel MILITARY wiring: bar-color design went through three rounds before landing, drill-down scoped to what has real data

`data/militaryScores.ts` (v6.3.0) sat unread by `hud/IntelligencePanel.tsx` for one version specifically so
the UI work could be its own pass — see that version's own reasoning. Worth recording how the bar itself
ended up looking, since none of the three iterations were the first guess:

1. First pass: a fixed blue two-stop `linear-gradient` (matching the pre-existing placeholder chrome's
   look) sized to each row's own (narrower) fill width — meaning the gradient content itself re-scaled per
   value, which is wrong for a value-encodes-severity bar (a 20%-wide fill would show the SAME red-to-green
   proportion as a 90%-wide one, just compressed, so a low score's fill tip would already read green).
2. Corrected to a red→amber→green gradient sized to the FULL track width via a fixed-px `backgroundSize`
   with the narrower fill clipping it — this fixed the re-scaling problem (a value's color now reflected its
   true position on the 0-100 scale) but was still visually a gradient smear across each filled bar.
3. **Reported directly**: the red/green language was describing what the color SHOULD represent at each
   value, not asking for a gradient rendered across the bar — the bar should be ONE solid color per row,
   computed from that row's own value. Landed on `intelValueColor()`: a single RGB lerp,
   red(0)→amber(50)→green(100), computed once and applied to both the fill's `backgroundColor` and the value
   text's `color` — so the number and its bar always match exactly, which a spatial gradient can't guarantee
   (the gradient's visible edge color only approximates the value; a solid computed color IS the value).

**Confirmed no-standing-military countries were reported as reading wrong**: `MilitaryScore.confirmed`
countries (Andorra, etc.) have a real `value: 0`, which rendered as an ordinary red 0.0 bar — visually
indistinguishable from "the worst possible score" rather than "there's nothing to score." Added
`IntelRow`'s `notApplicable` prop specifically for this state (renders `N/A`, no fill) rather than reusing
the existing em-dash "no data at all" treatment, since factbook-confirmed absence of a military is a
different fact than an unmeasured gap.

**Citation drill-down (design doc §7) scoped to MILITARY only, and to whenever a `MilitaryScore` record
exists at all — not gated on the composite actually being scoreable.** Considered restricting drill-down to
only `hasMilitaryBar` (measured/proxy) countries, but even a `confirmed`/`unavailable` country's individual
components are real, independently sourced facts (Andorra's personnel=0 and nuclear=0 are both cited factbook/
FAS figures, not fabricated) — the design doc's own "make the sourcing fully inspectable per category" reads
as covering that case too, so the drill-down shows whichever of the 5 components has data and marks the rest
"—", regardless of whether the composite itself rendered a bar or N/A. The sourced-but-not-scored arms-import
annotation is included too (visually subordinate, labeled "not scored") since `militaryScores.ts`'s own header
comment already says it's "shown, just not blended into value" — this drill-down is the first place anything
actually shows it.

## 2026-08-20 — Military scoring (`scripts/buildMilitary.mjs`): sourcing reconnaissance, two real bugs, two mid-flight design reversals

First real data behind the Intelligence Engine's status bars — see `CHANGELOG.md`'s v6.3.0 entry for the
user-facing summary and `Intelligence Docs/intelligence-engine-scoring-design.md` for the locked scoring
design. This entry is the debugging/reasoning trail behind getting there.

**SIPRI's Arms Transfers Database has no working public API — the documented one is decommissioned.** The
URL SIPRI's own docs point to (`armstrade.sipri.org/armstrade/html/export_values.php`) just redirects to a
marketing page now. The live portal (`armstransfers.sipri.org`) is a Svelte SPA with no visible API surface
from the page source alone. Found the real backend by driving the actual UI (Claude-in-Chrome) and
monkey-patching `window.fetch` to capture the outgoing request: `POST
https://atbackend.sipri.org/api/p/trades/import-export-top-csv/`, a JSON filter-object body, response is
`{bytes: <base64 CSV>}`. No auth, CORS-open, confirmed callable from plain `node --eval` (not just the
browser). Toggling "Imported weapons" vs. "Exported weapons" in the UI turned out to add/remove an
`orderbyseller` filter entry rather than changing any obvious "direction" field — would not have guessed
that from the request shape alone.

**Two real bugs found by comparing generated output against expectations, not caught by typechecking:**

1. `NUCLEAR_WARHEADS` (a hand-transcribed 9-country table) keyed the US as `'United States'`, but this
   project's topology names it `'United States of America'` — a plain object-key miss that silently fell
   back to the true-zero default (`?? 0`) instead of erroring. The US's nuclear component read as 0 in
   every generated output until reported directly ("you missed the nuclear count for the united states").
   Every other nuclear-armed country's name happened to match the topology exactly, which is why this
   surfaced as a single-country bug rather than something a broader sanity check would have caught faster.
2. The SIPRI expenditure lookback only checked 2025/2024/2023 — too narrow. Confirmed via direct xlsx
   inspection: Afghanistan's most recent real SIPRI figure is 2021, North Korea's is 2018 (both genuinely
   reported, just not recently — SIPRI doesn't estimate either country's spending in most recent years).
   Widened to a full 2000–2025 scan matching `buildGovCapitalPopGdp.mjs`'s existing
   `WORLD_BANK_LOOKBACK_START_YEAR` precedent; recovered 13 more countries project-wide, not just the two
   reported.

Both were found by generating a full sortable/filterable data table as an Artifact and eyeballing it against
known real-world facts, not by any automated check — worth remembering next time a build script's output
"looks plausible" but hasn't actually been read.

**No-standing-military list: verify candidates against a primary source, don't trust a compiled list.**
worldpopulationreview.com's list itself attributes its claims to the CIA World Factbook, but re-checking
each of its 18 UN-member candidates against the actual `factbook.json` text (not trusting WPR's table
as-is) caught a real error: San Marino is on WPR's list but factbook.json names an actual, currently-serving
military (the "San Marino Military Corps," with named units). Also surfaced a genuine ambiguity WPR doesn't
distinguish: Solomon Islands/Marshall Islands/Kiribati list only a police force in factbook.json (same shape
as the 14 added), but without that source's own explicit "no regular military forces" disclaimer phrase the
other 14 all have — left those three deferred rather than guessed either way.

**Two design decisions reversed after reviewing real generated output, not before shipping:** arms-import
TIV was originally scored with a `100 − normalized` inversion (low import volume = resilience signal), then
demoted to a non-scoring annotation once real output showed the direction doesn't reliably hold — NATO
members buying allied equipment were penalized the same way genuinely exposed importers were, and
too-small-to-import micro-states scored identically to genuinely self-sufficient ones. Separately,
expenditure was double-weighted after real output showed extreme %GDP/personnel ratios (small strained
countries, conscription-driven personnel counts) outranking countries with far larger absolute military
resources. Both are recorded as explicit, on-the-record exceptions to the design doc's own principles (§2
Governing Principle 6 specifically, for the weighting change) rather than quietly reconciled — see the
design doc's Exclusions & Annotations Log and its Governing Principle 6 footnote for the full trail. The
general lesson carried forward: a formula that passes a reference simulation before launch can still have a
wrong real-world direction that only shows up once you look at what it actually produces at scale.

## 2026-08-17 — States/provinces FPS, part 10: tightening the 'states' LOD reveal distance, then easing it back out

A different angle on the still-open "choppy over Europe" bug (see part 9 and
earlier): rather than another rendering-side fix, tightened *when* the
`'states'` LOD tier reveals at all. The user compared this app's behavior
against Google Maps and observed Maps waits until roughly half this app's
zoom distance before showing admin-1 boundaries. First pass set
`lod/lodLevels.ts`'s `'states'` `revealDistance` to 2.5 (== `CAMERA_MIN_DISTANCE`)
— tight enough that the tier became active *after* every city tier
(tightest at 2.52) instead of before, meaning states would now only ever
render at the absolute closest zoom the camera allows. `lodLevels.test.ts`
was rewritten to match that reordering (states as the LAST tier to unlock,
not the first).

**Immediately eased back out to 3.5** (same session) — 2.5 pushed the
reveal point past the point of usefulness (flush against the camera's hard
minimum, city-tier-scale tightness) rather than just "closer than before."
3.5 keeps the same relative ordering the original 5.0 had (states unlocks
before the city ladder, not after), just tighter — still a meaningful cut
from 5.0, still well clear of `CAMERA_MIN_DISTANCE`. `lodLevels.test.ts`
went back to essentially its pre-2.5 shape, with 3.5 swapped in for 5.0.

**Dialed in again to 2.8, same session** — now sitting BETWEEN metro-areas'
2.85 and large-cities' 2.7, so states unlocks just after the metro-areas
city tier rather than before the entire city ladder (3.5/5.0's behavior) or
after all of it (2.5's). Caught a real test-writing mistake while updating
`lodLevels.test.ts` for this value: `resolveActiveLevels()` filters
`LOD_LEVELS` in that array's own DECLARATION order, not sorted by
`revealDistance` — so 'states' always reports right after 'countries' and
before 'lakes'/'rivers' in the returned list whenever it's active,
regardless of how its numeric threshold compares to tiers declared later.
The first draft of the 2.8 test update wrongly assumed the returned array
would reorder itself to put 'states' after 'metro-areas' since 2.8 < 2.85 —
caught by actually running the suite (2 failures), not just written and
assumed correct. Fixed by keeping 'states' in its fixed declaration
position in every expected array and only changing which distances make it
present at all.

**Not yet eye-tuned in the browser at any step** — 2.5, 3.5, and 2.8 are
all reasoned numbers (a Google Maps comparison, then two successive "that
wasn't quite right" corrections), not numbers confirmed against this app's
own camera feel or measured against the actual Europe-wide-view FPS
problem. Worth checking in the browser whether 2.8 both feels right AND
actually keeps states out of frame for a wide multi-country view —
tightening the reveal distance narrows *when* provinces can appear at all,
which is a different lever from every rendering-side fix in parts 1-9, and
hasn't been confirmed to resolve the specific Europe case those parts left
open.

## 2026-08-17 — Sovereign-states category highlight toggle lag; dropped the administrative-divisions highlight

Reported directly: toggling the "SOVEREIGN STATES" (`highlight-country`)
category highlight was laggy. This was the exact risk `BACKLOG.md`'s
"Category Highlighting (v3.3.0)" section already flagged and left
unverified at the time — `layers/geoOverlays/CategoryHighlightLayer.tsx`'s
`CategoryHighlightGeometry` was rendering one `<lineSegments>` + one
`<mesh>` (its own `<group>` wrapper too) per entry, so enabling the country
category mounted 193×2 = 386 draw calls in one React commit. Same shape of
bug as the pre-v2 "7,234→386" per-ring-mesh fix `CLAUDE.md`'s
`countryGeometry.ts` section documents — that fix consolidated many
rings/polygons into one mesh per *country*; this overlay never got the
equivalent consolidation one level up, across countries.

**Fix:** merge every entry's border positions into one concatenated
`Float32Array`/`BufferGeometry`, and every entry's fill geometry into one
indexed `BufferGeometry` (`mergeBorderGeometries`/`mergeFillGeometries`),
so the whole category renders as exactly one `<lineSegments>` + one
`<mesh>` regardless of entry count. No `faceIndex → entry` lookup needed
the way `scene/mergedProvinceFill.ts` needed one for
`ProvinceFillLayer.tsx` — that layer merges meshes it still has to
per-entry raycast (hover/click), while `CategoryHighlightGeometry` has
never been interactive; it's a pure decorative pass on top of whatever
`Countries.tsx`/`GeoEntities.tsx` already render and handle clicks for.
`AllianceHighlightLayer.tsx` reuses the same `CategoryHighlightGeometry`
component for alliance membership highlighting, so it gets the same fix
for free without its own change.

**Separately, in the same request: removed the
`'highlight-administrative-division'` layer outright** (reported as not
needed) rather than fixing it alongside the draw-call issue — it was the
one category-highlight layer that could scale to *thousands* of entries
post-1:10m-upgrade (4,539 provinces), making it the most likely of the six
to reintroduce this exact lag even after the merge fix, and nothing had
asked for a "highlight every province on Earth at once" view. Removing it
also let `makeGeoEntityCategoryHighlight`'s factory drop its now-pointless
second parameter (`useFeatures`) — every remaining category uses
`useGeoEntityFeatures()`, so the parameterization existed only for the one
case that's now gone. The underlying states/provinces rendering
(`StatesProvinces.tsx`, the always-available `'states-provinces'` layer)
is untouched — only the separate "highlight all at once" overlay is gone.
`LegendPanel.tsx`'s hardcoded `CATEGORY_HIGHLIGHT_LAYER_IDS` list dropped
the same id, same reasoning as any other layer removal in this codebase
(nothing should describe a layer that no longer exists).

Not yet re-verified in a running browser (typecheck/lint/Vitest all pass,
but this project's convention is a real dev-server check before calling a
perf fix done — see `BACKLOG.md`).

## 2026-08-17 — States/provinces FPS, part 9: chunking the 1.3-1.7s freeze, measured before and after with a real longtask observer

**Fixed part 8's synchronous-freeze finding by chunking
`buildGeoEntityEntries` across event-loop turns instead of running it all
at once.** New `scene/useChunkedGeoEntityEntries.ts` slices the raw
features array into batches of 400 (sized so each chunk costs roughly
100-150ms, based on the measured ~0.3-0.4ms/feature average), processes
one batch per `requestIdleCallback` (falling back to `setTimeout(fn, 0)`
for Safari, which lacks it — the property that actually matters, yielding
to the event loop between chunks, works either way), and accumulates
results into React state that every downstream consumer
(`useFrontFacingEntries`, `ProvinceFillLayer`, `StateProvinceLabels`)
already treated as just an array that's fine to grow. `StatesProvinces.tsx`
swapped its `useMemo(() => buildGeoEntityEntries(features), [features])`
for this hook — a one-line call-site change once the hook existed.

**Verified with a `PerformanceObserver({entryTypes: ['longtask']})`
installed before toggling the layer on, not just eyeballed.** Before this
fix (part 8): a single 1,320-1,683ms task. After: five ~102ms tasks
instead of one giant one — a real, measured elimination of the freeze,
not an assumption that chunking would obviously work. (An unrelated
2,396ms task also showed up in the same capture, from page bootstrap way
earlier in the session's timeline — not something this fix touches or
needs to; the user's report was specifically about toggling the layer on,
not initial page load.)

**Deliberately did NOT tackle part 8's other finding (mesh count scaling
~30x between a single-country view and "most of Europe") in the same
pass** — asked directly, and held off per the answer. Two real options
remain on the table for that one (cap/cluster active mesh count for wide
views, or a BVH-accelerated single mesh), neither attempted; see
`BACKLOG.md`.

**One more open thread inherited from part 8, not yet revisited:**
`useFrontFacingEntries.ts`'s initial state still defaults to the full
unfiltered list, so the very first render after mount briefly requests
ALL 235 countries before the throttled filter narrows it down — now
somewhat mitigated by chunking (entries arrive progressively, so "all
235" isn't actually available to request until every chunk lands
anyway), but the underlying design tension (default to "everything" vs.
"nothing" on first render) is still there and still worth revisiting
alongside whichever wide-view fix gets picked.

## 2026-08-17 — States/provinces FPS, part 8: two more real findings — active-mesh-count still scales with "how many countries are in frame," and a 1.3-1.7s synchronous freeze on layer mount that was there all along

**Confirmed part 7's fix genuinely helped: smooth when zoomed on a single
country, still choppy when most of Europe is in frame — so measured
`activeCountryIds`/triangle counts at both zoom levels directly instead of
guessing a fifth explanation.** Deep single-country zoom: 4 active
countries, 13 visible provinces, 4,694 total triangles. The "most of
Europe" zoom (what `flyToSelectedCountry()`'s `CAMERA_FOCUS_DISTANCE`
actually lands on for a country Germany's size, not a tight single-country
view — worth noting for anyone re-testing this by search+FOCUS CAMERA
alone): 119 active countries, 2,799 visible provinces, 290,612 total
triangles. ~30x more active meshes. Every one of those meshes still gets
redrawn every frame during continuous camera rotation/pan (`frameloop=
"demand"` renders on every `invalidate()` a drag produces), and none of
part 6/7's fixes reduced mesh COUNT for a wide view — they reduced
per-mesh raycasting cost and eliminated unnecessary re-renders, which is a
different axis. **Not yet fixed — this needs either capping/clustering
active mesh count for wide views, or a properly spatially-accelerated
(BVH) single mesh instead of per-country granularity, both real design
decisions bigger than anything applied so far. Logged, not implemented.**

**Separately, the user reported a lag specifically on toggling the layer
on — instrumented three candidate causes with `performance.now()` timers
rather than guessing which one, since three real candidates existed at
once (the fetch, the topology conversion, the per-country merge).** Fetch
+ JSON parse of the 3.75MB `states-provinces.json`: 368ms (one-time, real,
but not obviously "laggy" on its own). `feature()`/`mesh()` topology
conversion: 268ms. `useMergedFillsByCountry`'s build: 29-48ms (already
suspected and already ruled out as the main cause). **The actual answer:
`buildGeoEntityEntries(features)` — the earcut triangulation for every one
of 4,539 provinces, run synchronously inside a `useMemo` in
`StatesProvinces.tsx` — took 1,320-1,683ms.** Over a second and a half of
main-thread blocking on every layer mount, unrelated to and much bigger
than anything else measured today. This isn't a regression from any of
today's changes — it's an original cost of the 1:10m upgrade itself that
was simply never separately measured before now (masked by "features/
entities are still fetched/built unconditionally... a one-time cost,"
written without actually timing what that one-time cost was). **Not yet
fixed — real options are lazy-deferring the build until the LOD tier is
actually active (moves the freeze to first zoom-in instead of eliminating
it), chunking the 4,539 triangulations across multiple frames/idle
callbacks (progressive, no freeze, more complexity), or moving the work to
a Web Worker (biggest lift, cleanest result). Logged, not implemented.**

**Also discovered, incidentally, while instrumenting:** `useFrontFacingEntries`'s
initial state defaults to the FULL unfiltered entries list (a 2026-08-16
decision, "avoid a flash of emptiness before the first computation") —
meaning the very first render after the layer mounts briefly shows ALL
235 countries / 4,539 provinces / 445,720 triangles before the first
throttled filter pass narrows it down. That was the right call when this
hook fed a single global merged mesh (skip a flash-of-nothing), but now
that mounting many countries has its own real cost (see above), defaulting
to "everything" instead of "nothing" during that first render window
works against the fix, not for it — worth revisiting alongside whichever
active-mesh-count fix gets picked.

**Diagnostic instrumentation (three `performance.now()` timers, one
`console.log` of active-mesh counts) was added temporarily across
`ProvinceFillLayer.tsx`, `useMergedFillsByCountry.ts`,
`StatesProvinces.tsx`, and `useStatesProvincesFeatures.ts`, all gated
behind `import.meta.env.DEV`, and removed once each did its job — same
pattern as part 6's temporary diagnostic.** None of it should be
reintroduced permanently; re-add ad hoc if this needs re-profiling again.

## 2026-08-17 — States/provinces FPS, part 7 (measured before AND after this time): React re-render cost was compounding the raycasting cost

**Part 6's per-country merge measurably cut mesh count and worst-case
triangle count, but reported as still laggy — so before guessing a fourth
time, measured the actual per-pointermove cost directly** by dispatching
real `PointerEvent('pointermove')`s at the canvas in a 15x4 grid sweep and
timing each dispatch with `performance.now()` (synchronous DOM event
dispatch means the full React + R3F + raycasting + state-update chain runs
inside that timed call). Before this pass: Brazil averaged ~11ms/event
(max 26ms), Germany ~25ms/event (max 40ms) — worse than the triangle-count
ratio (2.7x) alone would predict, meaning triangle count wasn't the whole
story.

**Root cause: every pointermove that actually changes the hovered
province — which is most of them over small, densely-packed provinces,
rarely over Brazil's large ones — triggered a full React re-render with
two compounding costs.** (1) `selectedEntry`/`hoveredEntry` were resolved
via `Array.find()`/`.some()` over `visibleEntries`, up to ~2,700 elements
for Europe, re-scanned from scratch on every hover change. (2) Every one
of the ~100+ active `<CountryFillMesh>` components re-rendered on every
hover change, even though at most one country's visuals were ever affected
by it (via the separate overlay mesh) — because their callback props
(`onHover`, `onSelectEntry` (parent's `onSelect`), `wasDragGesture`) were
fresh closures every render, defeating any attempt at `React.memo` before
one was even added. This explains the region gap better than triangle
count alone: Europe's smaller provinces mean the hovered id changes on
nearly every synthetic event, paying both costs almost every time; Brazil
often lands on the same already-hovered province between steps and skips
both.

**Fix, three pieces working together:** `useClickDragGuard.ts`'s returned
function is now `useCallback`-wrapped (was a fresh closure per call);
`StatesProvinces.tsx`'s `handleSelect`/`handleHoverChange` are now
`useCallback`-wrapped too (and `handleHoverChange`'s own `entities.find()`
became an O(1) Map lookup — same class of bug, smaller scale, same fix);
`ProvinceFillLayer.tsx` builds one `geometryId`-keyed `Map` per
`visibleEntries` change for O(1) `selectedEntry`/`hoveredEntry` lookups,
and `CountryFillMesh` is now wrapped in `React.memo` — which only actually
helps once its callback props are stable, hence the two `useCallback`
fixes above being prerequisites, not independent changes.

**Re-measured the identical sweep after the fix:** Brazil ~5.75ms/event
(max 18.3ms, down from ~11ms/26ms), Germany ~7.9ms/event (max 14.7ms, down
from ~25ms/40ms) — both regions improved, and critically the gap between
them nearly closed (7.9ms vs. 5.75ms, vs. 25ms vs. 11ms before). This is
the second fix in this saga measured both before AND after, not just
theorized about or measured once and assumed sufficient — see part 6's
closing note about reaching for real numbers earlier next time; this
entry is that lesson applied a second time in the same saga, which is
itself worth noticing.

**Still not user-confirmed as smooth.** A synthetic pointermove sweep
measures the exact code path a real mousemove triggers, but isn't
identical to a human dragging a trackpad — report back if it's better but
not yet good enough, since there's still a documented next step
(rebuilding the drag-frame-counting harness properly, or profiling via
Chrome DevTools' actual Performance panel instead of ad-hoc scripts) if
so.

## 2026-08-17 — States/provinces FPS, part 6 (measured, not guessed): a single merged mesh traded one bottleneck for a denser one

**Part 5's single global merged mesh reportedly still "struggled
massively" over Europe specifically, while the Americas were fine —
instrumented with a temporary console diagnostic instead of guessing at a
fourth fix.** Numbers, at a comparable "focused on one country" zoom via
each country's own FOCUS CAMERA flight: Brazil (Americas) had 866 active
provinces / 83,887 triangles / 251,661 vertices; Germany (Europe) had
2,750 active provinces / 227,116 triangles / 681,348 vertices — roughly
2.7x denser. That ratio is the whole story: Europe simply packs far more
small countries, each with its own set of small provinces, into the same
screen area than the Americas do at an equivalent zoom.

**Why a single merged mesh makes density hurt more, not less: it has no
internal spatial structure, so R3F's raycaster (which runs on every native
pointermove event, not throttled) does one bounding-sphere check for the
WHOLE mesh, then a flat linear scan of every triangle inside it if that
passes.** With everything concentrated into one object, raycasting cost is
directly proportional to total visible triangle count — worse than the
original one-mesh-per-province design in exactly this respect, because
that design's many small objects each got a cheap, individual bounding-
sphere pre-check, and only the one or two actually near the cursor ever
reached real per-triangle work. The merge fixed per-object/React
overhead but accidentally threw that per-object rejection away.

**Fix: merge per COUNTRY instead of globally** (`scene/
useMergedFillsByCountry.ts`, `scene/provinceCountryGroups.ts`) — coarse
enough to cut mesh count drastically (119 active country meshes measured
over the same Europe view, vs. one mesh of 227k triangles before), fine
enough that each country-sized mesh keeps a meaningful bounding-sphere
pre-check (most countries, on any given pointer move, aren't anywhere
near the cursor, and that's cheap to determine again). Re-measured after
the change: same Europe view, 119 active countries, largest single
country mesh 39,609 triangles — worst case dropped by ~83% just from
regrouping the exact same geometry differently. Each country's merged
buffer is also now cached (`useMemo` keyed on the full, unfiltered entries
list, stable once the fetch completes) rather than rebuilt every time the
front-facing filter's throttle ticks, so panning/rotating no longer
re-copies and re-uploads a multi-megabyte buffer every ~150ms either —
that cost is now paid once per country, the first time it's needed, not
repeatedly.

**Process note: this is the first fix in this saga backed by an actual
measurement instead of a plausible-sounding theory.** Parts 1-5 were each
reasoned through carefully but verified only after the fact (twice
insufficient once actually checked). Worth remembering next time
"still slow" comes back a third time: reach for real numbers before the
next structural change, not after it doesn't work either.

## 2026-08-16 — States/provinces FPS, part 5 (implemented, NOT yet confirmed): the merged-mesh rewrite

**Implemented the deeper fix part 4 (below) confirmed was needed:
`scene/ProvinceFillLayer.tsx` replaces `EntityRenderLayer`'s one-mesh-per-
entry fill rendering for `StatesProvinces.tsx` specifically, merging every
visible province's fill geometry into one `BufferGeometry`
(`scene/mergedProvinceFill.ts`) with a per-triangle `faceIndex -> entry`
lookup array.** Hit-testing (hover, click) now runs against one mesh
instead of hundreds — R3F only raycasts registered objects, so this is a
direct reduction in per-pointer-move work, and a direct reduction in
per-camera-drag-frame draw calls. Precision is unchanged: the merged
geometry is the exact same triangles, just concatenated into one buffer,
so a real per-triangle raycast still resolves exactly which province was
hit. Visual result is unchanged too — up to two small, unraycastable
overlay meshes/borders (`raycast={() => null}`, so pointer events pass
through to the merged mesh underneath) render the selected/hovered
entry's own highlight color on top of the merged mesh's uniform default
tint, reusing each entry's already-built `fillGeometry`/`borderGeometry`
rather than rebuilding anything per-frame.

**Extracted two things out of `EntityRenderLayer.tsx` to avoid duplicating
them:** `HoverLabel` (now exported — was already self-contained) and the
click-vs-drag pointerdown/threshold tracking, pulled into its own
`scene/useClickDragGuard.ts` (a hook can't be exported alongside
components from the same `.tsx` file without tripping oxlint's
react-refresh rule — the same constraint `geoEntityEntries.ts` already
exists to satisfy for `buildGeoEntityEntries`). Since `StatesProvinces.tsx`
no longer calls `EntityRenderLayer` at all after this change, its
`dashedBorders`/`hideDefaultBorders` props — both added specifically for
that one caller — became fully dead (zero remaining callers) and were
removed rather than left in place; `EntityRenderLayer` is back to being
exactly what it was originally: shared by `Countries.tsx`/`GeoEntities.tsx`
only.

**Deliberately not calling this "done" yet, and deliberately not giving it
a version number — see the versioning-discipline note above.** It
typechecks, lints, and the existing test suite passes, but none of that
verifies the actual FPS claim; it needs to be checked running, over
Europe specifically, before treating the states/provinces performance
saga as closed.

## 2026-08-16 — States/provinces FPS, part 4: front-facing filter helped, Europe still lags

**Confirmed in the browser: FPS is better, but movement is still choppy
when looking at a province-dense region (Europe) — exactly the gap part 3
(below) predicted before it was even tested.** The front-facing filter
only excludes provinces that are back-facing or off-screen; a region where
many small countries are all simultaneously visible together gets no
reduction in active mesh count from it at all. Confirms the deeper fix —
merging each country's provinces into far fewer meshes with face-index-
based hit-testing — is the next real step, not a hypothetical fallback.
Not yet implemented.

**Also corrected course on process, not just code:** the previous three
LOGBOOK entries in this sequence were each originally written alongside
their own `CHANGELOG.md` version bump (v6.2.6/v6.2.7/v6.2.8) and a
matching `package.json` version increment, as if each incremental attempt
was its own shippable, working state. Reported directly as wrong: none of
them actually finished the job, so treating each as a versioned release
overstated how done this work was. Consolidated `CHANGELOG.md` back into
one entry (the 1:10m data upgrade, which did land cleanly, plus an
explicit "rendering performance not yet resolved" note) and rolled
`package.json` back to match — a version number should mean "this is in a
real, working state," not "an attempt was made." The LOGBOOK entries below
keep their per-attempt structure regardless, since capturing what was
tried and why it fell short is exactly what this file is for — that's
different from implying each attempt shipped.

## 2026-08-16 — States/provinces FPS, part 3: LOD-gating answers "when," not "how many" — a province still invisible behind the globe was mounting anyway (see part 4 above for the follow-up)

**Confirmed directly, once actually checked in the browser: the
choppiness wasn't gone, just delayed until you actually zoomed in far
enough to see provinces at all.** The LOD gate (part 1, above) is a
binary, distance-only switch — once camera distance crosses the 'states'
tier's threshold, `StatesProvinces.tsx` mounts its FULL entry list, every
province on the entire globe, not just whatever fraction is actually
facing the camera and inside the current viewport. At any zoom close
enough for the tier to be useful, that's still thousands of individually-
raycast/redrawn meshes — the exact problem the LOD gate fixed for the
"fully zoomed out" case was still fully present for the "zoomed in, which
is the whole point of this feature" case.

**The fix cost nothing extra to build because the exact check already
existed, just scoped to one point at a time.** `useFrontOfGlobeVisible.ts`
(v5.2.2) already does the real work — an analytic horizon-dot-product +
NDC-frustum + screen-bounds check, throttled via `useFrame` — for `Html`
labels that need it (a `Html` overlay has no WebGL depth buffer, so
nothing hides it automatically the way a real mesh's depth test already
would). `EntityRenderLayer`'s province meshes are real meshes, so they
were never incorrectly VISIBLE when back-facing — `FrontSide` culling and
the opaque core sphere's depth test already handled that correctly. What
they weren't was cheap to have mounted: React reconciling ~4,500
`<group>`s, each registering pointer-event listeners R3F raycasts on every
pointer move, is real fixed cost per object regardless of whether that
object ever draws a visible pixel. `useFrontFacingEntries.ts` generalizes
the same point-check into a list filter, so the invisible-anyway majority
of provinces (at any given camera angle, roughly half the globe plus
whatever's outside the current framing) never gets a mesh built for them
in the first place. Net effect on what's drawn: zero — this is a pure
"stop doing invisible work" change, not a visual change.

**Deliberately the lighter of the two options on the table, not the
complete fix.** A province-dense region viewed all at once (Europe, say —
dozens of small countries, hundreds of provinces, ALL simultaneously
front-facing and on-screen at a normal "looking at Europe" zoom) gets no
benefit from this filter, since none of them get excluded by it. The
deeper fix — merging each country's provinces into far fewer meshes with
face-index-based hit-testing instead of one mesh per province — is still
the answer for that case if it turns out to matter in practice; deferred
per the user's own call to try the lighter mitigation first and only
reach for the bigger rewrite if needed. Logged as an open, likely-needed
follow-up in `BACKLOG.md` rather than assumed solved.

## 2026-08-16 — States/provinces FPS, part 2: normalizing the dash math was the right fix for the wrong complaint

**v6.2.6 (below) fixed dashed province borders rendering solid on small
provinces — a real, correctly-diagnosed bug. It didn't fix the actual
complaint once seen running: with 4,539 provinces on screen instead of
294, a technically-correct dash pattern on every one of them just reads as
noise.** More boundaries showing a consistent dash count each is still a
lot of dashing in aggregate — the per-ring normalization fix made every
individual dash pattern *correct*, not *sparse*. Reported directly as a
preference once checked in the browser, which the LOD-gate and dash-math
fixes in the same session hadn't been (see `BACKLOG.md`'s open items on
both from the same pass). Resolution: drop dashing for this layer
entirely rather than continuing to tune dash density — `BoundaryMesh` and
`EntityRenderLayer`'s per-entry border both switched to plain
`LineBasicMaterial`, same as `Countries.tsx`/`GeoEntities.tsx` always
rendered. The muted-opacity idea from v6.2.6 survived unchanged (it was
never actually about dashing — it was about the default line reading
quietly against the one focused, full-opacity border), which is a useful
signal in hindsight: the opacity change addressed the "too busy" complaint
directly, while the dash-math fix addressed a different, real but
lower-priority bug that happened to be reported in the same sentence.

**Left `EntityRenderLayer`'s `dashedBorders` prop in place, unused, rather
than deleting it now that its only caller stopped passing `true`.** Small,
self-contained, already covered by the existing dash-normalization fix
whenever a future caller does turn it on — deleting and potentially
re-adding it if a different layer wants a dashed treatment later would be
pure churn. `hideDefaultBorders` (the other v6.2.5 prop) stays load-bearing
regardless of dashed vs. solid: two overlapping lines at a shared
province edge double that edge's opacity either way, dashed or not.

## 2026-08-15 — States/provinces FPS, part 1: a reserved-but-unused LOD tier was the fix, once 15x more features made "always on" actually cost something

**Reported directly as "destroying fps" once the states/provinces layer's
1:10m upgrade (below) landed — the same draw-call/raycast scaling problem
this codebase already solved once for country geometry (merge-per-entity),
just past the feature count where that fix alone still held.** At 294
features, every province being its own individually-hoverable `<mesh>` in
`scene/EntityRenderLayer.tsx` was tolerable; at 4,539 it wasn't — R3F
raycasts every registered mesh on pointer move regardless of the
`frameloop="demand"` render-on-invalidate setup, and every camera-drag
frame redraws all of them. The fix wasn't a new mechanism: `src/lod/
lodLevels.ts`'s `'states'` tier had existed since v4.3 as a *reserved*
"always on" entry (`revealDistance: null`) — never actually wired to gate
anything, just documented as conceptually belonging to the ladder. Giving
it a real `revealDistance` (5.0, chosen to land just outside
`CAMERA_FOCUS_DISTANCE` so admin-1 boundaries are already visible by the
time a country-focus camera flight completes) and gating
`scene/StatesProvinces.tsx`'s render output behind it was the entire fix —
the LOD Engine's whole reason for existing (per its own `CLAUDE.md`
section) is being "the plug-in point for future zoom-gated datasets," and
this is the first dataset since the city tiers to actually plug into it.

**Needed a new `useIsLodLevelActive(id)` selector hook** (`lod/lodStore.ts`)
because `StatesProvinces.tsx` isn't a per-frame `useFrame` consumer the way
`UsCityLabels.tsx` (the LOD Engine's only other real consumer) is — it has
no camera distance of its own to hand `isLodLevelActive()` directly, so it
needs the store. Selecting a derived boolean (`isLodLevelActive(id,
state.distance)`) rather than exposing raw `state.distance` matters here
for the same reason `useLodLevel()` already selects only `state.level`:
zustand's default equality check skips a re-render when the selected value
is unchanged, so this only re-renders on an actual reveal/hide flip, not on
every frame's distance publish.

**Same session also fixed dashed borders reading as solid on small
provinces — a second symptom of the same "more small features than the
1:50m pilot ever had" root cause.** `DASH_SIZE`/`GAP_SIZE`
(`scene/geoEntityEntries.ts`) were fixed absolute world-space lengths; a
province whose entire perimeter was shorter than one dash+gap cycle
rendered as one unbroken line. Fix: `countryGeometry.ts`'s
`geometryToBorderSegmentsWithDistances`/`geometryToLineSegmentsWithDistances`
now normalize each ring/line's own distances to `[0, 1]` (divided by that
ring's own total length) instead of leaving them as absolute world
distance — every ring now shows the same NUMBER of dashes regardless of
its actual size. This is shared code (`ClaimsOverlayLayer.tsx`'s dashed
claim outlines use the same functions/constants), so country-scale claim
borders get slightly different — more size-consistent — dash density as an
unplanned but welcome side effect, not a regression, since they had the
exact same underlying bug at a scale where it was less visible. Layered a
second mitigation on top rather than treating the math fix as sufficient
on its own: `StatesProvinces.tsx`'s always-on default boundary line dropped
from 0.55 to 0.22 opacity, so even a technically-correct dash pattern on a
tiny province reads quietly rather than busily against the many other
unselected boundaries on screen at once — the one live per-entry border
`EntityRenderLayer` still draws for whichever province is actually
hovered/selected stays at full opacity, so the focused case still pops
against the now-quieter default.

## 2026-08-15 — States/provinces upgraded to 1:10m: two schema defects the pilot's 9-country scope never exposed

**Swapped the vendored source from Natural Earth's 1:50m admin-1 layer (294
features, 9 countries) to its 1:10m layer (4,596 raw features, 251
`adm0_a3` values) — the exact upgrade path v4.0's own header comment and
`BACKLOG.md` had documented since the pilot shipped.** The pipeline itself
(`topologyPipeline.mjs`) needed zero changes — same "plain GeoJSON
`FeatureCollection` in, simplified topology out" shape v4.0 already
generalized it for. `buildStatesProvincesTopology.mjs`'s own filtering did
need two real fixes, both invisible at 9-country scale and both found by
just running the build against the new file rather than by inspection.

**Fix 1 — non-sovereign `adm0_a3` values now hard-fail instead of being
silently absent.** At 1:50m, all 9 vendored countries were real UN
members, so `ALPHA3_TO_NUMERIC` (the complete, canonical ISO 3166-1 table)
resolved every row and the script's "throw if unresolved" behavior never
fired. At 1:10m, Natural Earth's admin-1 layer also carries provinces for
Kosovo, Western Sahara, Guantanamo Bay, the two Cyprus Sovereign Base
Areas, and other classifications this codebase already models as
`GeoEntity` records rather than `Country` rows — genuinely no numeric
country id to resolve to, not a table gap. Changed the throw to a skip
(logged to the console and `BACKLOG.md`, 57 features across 17 `adm0_a3`
values) rather than either crashing the whole build or guessing at routing
these into `GeometryMap`/`GeoEntityRegistry` — the latter is real, worthwhile
follow-up work, but touches `GeoEntity`-adjacent code well outside a
data-pipeline upgrade's scope. One of the 17, `SDS`, was a real bug rather
than a non-country row: Natural Earth's admin-1 layer tags South Sudan's
provinces with `SDS` instead of the canonical `SSD` already in
`iso3166.mjs` — without aliasing it, South Sudan would have been the one
actual UN member silently dropped by the same skip logic that correctly
drops Kosovo. Aliased rather than special-cased in the build script, so any
future consumer of `ALPHA3_TO_NUMERIC` gets the same fix for free.

**Fix 2 — the province id needed a different source field entirely.**
v4.0 stamped each province's id from its own `iso_3166_2` code
(`"AU-WA"` → `"au-wa"`), which was safe at 9-country scale by coincidence,
not by verification. At 1:10m, 60 groups of genuinely distinct provinces —
all 9 Bosnian cantons, Sudan's Southern and Eastern Darfur, Malawi's
Chitipa district listed twice — share one `iso_3166_2` code apiece, which
is a real Natural Earth data defect at this resolution, not a merge-worthy
multi-polygon split the way an archipelago province's rings would be.
Switched the id source to `adm1_code` (Natural Earth's own internal key,
e.g. `"BIH-2228"`), verified unique and present across all 4,596 raw
features before switching — less human-legible than an ISO 3166-2 code,
but this id is purely an internal `GeometryMap`/registry key, never
rendered.

**Result: all 193 UN members now have admin-1 coverage** (up from 9), plus
42 more ISO-coded non-UN territories (Taiwan, Hong Kong, Puerto Rico,
Antarctica, ...) whose provinces resolve a `parentCountryId` with no
matching `CountryRegistry` entry — logged in `BACKLOG.md` as a fact worth
knowing, not a bug, since nothing today reads `parentCountryId` expecting
it to always resolve against `CountryRegistry`. 4,539 features shipped (57
skipped), output grew from 262 KB to 3.75 MB — reported and accepted, not
treated as a "balloons past reasonable" case the way a multi-hundred-MB
output would have been.

## 2026-08-15 — v6.2.5: the dashed-border fix that fixed a real bug but wasn't the actual bug

First diagnosis (v6.2.4, below) was real but incomplete: for a shape with
more than one ring (an island, a hole), `computeLineDistances` summed
distance across the ENTIRE flat vertex buffer as one continuous path, with
no idea where one ring ended and the next began. `geometryToBorderSegments`
never draws a segment BETWEEN rings (each ring's vertex count is always
even, so GL_LINES pairs land exactly on ring boundaries), but the distance
computation still added the real-world gap between two unrelated rings —
say, an island and the mainland — into its running cumulative total. Every
vertex in the next ring inherited that inflated, essentially arbitrary
phase offset, which could put an entire ring's own (short) length inside a
single dash-period, rendering it solid. Fixed with
`geometryToBorderSegmentsWithDistances`, reset per ring. Real bug, real
fix — but reported back as still broken, specifically for Pará/Mato Grosso,
Brazil, neither of which has islands or holes. The ring-transition fix
literally could not have touched that case.

Actual cause, found on the second pass: `scene/StatesProvinces.tsx` (like
`Countries.tsx`/`GeoEntities.tsx`) renders one border ring PER STATE, each
built independently from that state's own polygon. A boundary INTERNAL to
the dataset — shared by exactly two adjacent states — is therefore drawn
TWICE: once as part of each neighbor's own ring. Each copy starts its
cumulative dash distance at wherever ITS OWN ring happens to begin walking,
which is essentially arbitrary relative to the other copy — the two dash
patterns overlay the same physical curve with an uncorrelated relative
phase. For two ~58%-duty-cycle dash patterns (`DASH_SIZE=0.028`,
`GAP_SIZE=0.02`) with random relative phase, the statistical *union*
coverage is closer to 80%+ — visually solid, or close enough that it reads
as solid, especially once the individual dash length is only a few screen
pixels. This explains "for SOME states" precisely: coastline (unshared)
edges were never affected at all — the double-draw only exists on internal
admin-1 lines — and exactly how solid any given shared edge looks is pure
luck of that specific pair's relative ring-start phase, which is why it
wasn't uniform across every shared boundary either.

The only structurally sound fix is to stop drawing the shared edge twice at
all, not to try to make two independent draws agree on phase (which would
require reconstructing which arc is "the same arc" from two already-
flattened, independently-simplified polygon rings — recoverable in
principle from the TopoJSON topology's own arc-sharing structure, but not
from the GeoJSON `feature()` output this app had been working from,
which duplicates every shared arc into both adjacent polygons by design).
`topojson-client`'s `mesh(topology, object)` does exactly this — walks
every arc used by an object exactly once, deduplicated, regardless of how
many polygons reference it — so `useStatesProvincesFeatures.ts` now also
computes and exposes that mesh alongside the existing per-feature list.
That mesh became the actual default (unselected) boundary rendering;
`EntityRenderLayer.tsx`'s per-entry border ring only still renders for
whichever ONE province is hovered/selected at a time — at most one extra
copy overlapping the mesh, and a bolder/more-solid-looking highlight where
it does is the intended effect for "this one is focused," not the bug the
always-on per-entry rendering had.

Lesson, worth stating plainly since it cost a full round-trip: "some
states, not others" was the tell that the bug was topology-relational
(depends on which OTHER shapes a border is adjacent to), not a property of
any single shape's own geometry — the first fix looked in the right
neighborhood (dash-distance computation) but at the wrong scope (one
shape's own rings, not shapes' interaction with each other). Should have
asked "what do all the affected borders have in common with each other,
not just with themselves" before shipping the first fix as complete.

## 2026-08-15 — v6.2.4: hatched province borders, and scoping the sovereign-state highlight fix to administrative-division only

Two separate reports, fixed together since both are states/provinces-specific:

**Dashed borders**, reusing `ClaimsOverlayLayer.tsx`'s existing "hatching
style" dashed-outline mechanism (that file's own v3.1 entry already used
the word "hatching" for a dashed `LineDashedMaterial` outline — confirmed
this was the right interpretation before building anything, see the
AskUserQuestion in this session). `EntityRenderLayer.tsx` gained a
`dashedBorders` prop; `DASH_SIZE`/`GAP_SIZE` hoisted out of
`ClaimsOverlayLayer.tsx` into `geoEntityEntries.ts` so the two dashed-line
consumers can't drift apart on scale.

**Sovereign-state highlight removed for province selection.** Root cause:
`useStatesProvincesFeatures.ts` registers every province with
`parentEntity`/`administeredBy` pointing at its own sovereign country (by
construction — provinces have no other kind of relationship to record).
`ClaimsOverlayLayer.tsx`'s `useRelatedCountryRoles()` reads
`parentEntity.ref.type === 'country'` to decide whether to highlight the
connected country — true for every single province, so selecting ANY of
the 294 lit up its country with the "related country" treatment
(previously "PARENT —", renamed "SOVEREIGN —" in v6.2.2) every time. Scoped
the fix to skip entirely when `selected.entity.data.type ===
'administrative-division'`, rather than a blanket change — every other
`GeoEntityType` (dependencies like Puerto Rico, disputed claims) keeps the
exact behavior this mechanism exists for; a province being part of its own
country isn't the same kind of fact as an uncontested dependency or a
disputed claim, so it doesn't get the same visual flag.

## 2026-08-15 — v6.2.3: arrow-key navigation reaching entities that aren't on the globe

Root cause: `useEntityNavigation()`'s candidate list was built from
`useCountryFeatures()`/`useGeoEntityFeatures()`/`useStatesProvincesFeatures()`/
`useCitiesFeatures()` — four data-fetch hooks with no notion of Layer Engine
state — treated as equivalent, when only the first two are actually
unconditional (`Globe.tsx` mounts `<Countries />`/`<GeoEntities />` directly).
States/provinces and cities are ordinary layers, off by default, mounted only
through `LayerManager.tsx`'s `enabledMap` check — `findNearestInDirection`'s
own doc comment already documented the intended invariant ("nothing reaches
this function that isn't currently on the globe"), the candidate-building
code just didn't actually enforce it for either of the two Layer-Engine-gated
sources.

First fix pass gated both states/provinces and cities on their own layer's
enabled state (`useLayerEnabledMap()`), which would have made cities
selectable via arrow keys whenever the cities layer happened to be on. A
follow-up report narrowed this further: cities shouldn't be reachable via
arrow-key/Tab navigation at all, layer state aside — no reason given, taken
as-is rather than guessed at. Cities were dropped from the candidate list
unconditionally instead of gated — `'city'` removed from `CATEGORY_ORDER`
too, so Tab-cycling doesn't land on an empty category. States/provinces
keeps the layer-gate, since that complaint was specifically about the
*hidden* case, not states/provinces navigation itself. Cities remain
selectable by click or search — only keyboard navigation excludes them.

## 2026-08-15 — v6.2.2: relationship label rename, and a pre-existing doc-drift spot found (not fixed) along the way

Requested as display-text-only — `parentEntity`/`administeredBy`/
`claimedBy`/`claims` stay as the field names in `data/types.ts`/
`geoEntities.ts`; only what renders changed. Touched three real render
sites (`IntelligencePanel.tsx`'s `buildRelationFeed`, `ClaimsOverlayLayer.tsx`'s
`ROLE_LABEL`, `scripts/generateClaimsDoc.mjs`) plus their doc comments
(`highlightColors.ts`, `CLAUDE.md`) — CHANGELOG.md/LOGBOOK.md's own
*historical* entries describing pre-rename releases were deliberately left
alone; they're a dated record of what shipped at the time, not living docs,
so rewriting old entries to use the new labels would misrepresent history
(making v3.0.0 look like it shipped "Sovereign State" when it shipped
"Parent Entity"). A new CHANGELOG entry documents the rename instead.

Singular/plural for the renamed "Claimed By" -> "Claimant"/"Claimants": both
call sites (`buildRelationFeed`, `generateClaimsDoc.mjs`) compute it off
`claimedBy.length > 1` once per entity, applied uniformly to every row for
that entity's claimant list — not per-row, since a set of rows under the
same relationship should read as one grouped fact, not independently pick
their own singular/plural.

**Found, not fixed:** `CLAUDE.md`'s `IntelligencePanel.tsx` bullet still
described `PARENT ENTITY`/`ADMINISTERED BY`/`CLAIMED BY`/`CLAIMS` as
`GeoEntityDetails`'s own `DataRow` fields — stale independent of this
rename; those four fields moved out of the overview block and into the
RELATIONSHIPS feed section (`buildRelationFeed`/`FeedRow`) at some earlier,
undated point, and CLAUDE.md was never updated to describe the feed at all.
Fixed the label names in that bullet (in scope for this change) but did not
attempt the larger rewrite describing the feed refactor itself — that's a
separate, pre-existing drift issue outside a label-rename task's scope.
Worth a dedicated pass later.

## 2026-08-15 — v6.2.1: equator line added deliberately narrower than the removed graticule grid

Requested as "add the equator line," not "bring back the grid" — implemented
as exactly that: one static ring at lat 0 (`scene/Equator.tsx`), always-on
alongside the atmosphere shells in `Globe.tsx`, not a Layer Engine toggle.
Deliberately did not revisit v5.1.0's removal of the full lat/long graticule
(`CHANGELOG.md`'s v5.1.0 entry) — that was a crisscrossing overlay across the
whole globe, a different-scale visual decision from a single fixed reference
line. `CLAUDE.md`'s opening description and `README.md`'s "Design direction"
both still described the grid as removed with no equator mentioned; both
updated alongside this change so neither goes stale relative to what's
actually rendered.

## 2026-08-14 — v6.2.0: SideRail's click handler generalized instead of special-cased

`SideRail.tsx`'s 10 existing tabs all hardcoded `toggleHudPanel('layers')`
— every tab was assumed to only ever filter `LayerPanel`. The new ALLIANCES
tab needed to open a different, dedicated panel instead (a browse-and-click
pill grid doesn't fit `LayerPanel`'s one-row-per-toggle layout). Rejected:
hardcoding `if (item.id === 'alliances') ...` inside the click handler —
correct for one case, but the file already had a working precedent for
"per-item behavior data" (`SideNavItem.categories`), so a matching optional
`panel` field (defaulting to `'layers'` for every existing item) kept the
handler itself generic and made a *second* future dedicated-panel tab a
data-only change instead of another special case.

## 2026-08-14 — v6.2.0: alliance data scope and format decisions

Several decisions were made explicitly with the user rather than guessed,
worth recording since a future session extending this dataset needs the
same judgment calls, not a re-derivation of them:

- **18 alliances, not more.** A Trade category (USMCA/CPTPP/RCEP/AfCFTA)
  was drafted, then explicitly dropped — not deferred — after a count check
  caught that 22 blocs had actually been listed against an "18 ONLY"
  instruction. Broader/looser groupings (Arab League, Commonwealth of
  Nations, ANZUS, SAARC, CSTO) were reviewed and rejected specifically as
  dormant/functionally inert, not merely "not gotten to yet" — see
  `data/allianceMemberships.ts`'s own header for the per-org reasoning
  (ANZUS's suspended US-NZ leg, SAARC paralyzed since 2016, CSTO's
  non-intervention record, Arab League's resolution track record).
- **Real ISO3 codes, not country names, as the join key** — deliberately
  more plumbing (a new `countryIso3.ts` lookup table) in exchange for codes
  independently verifiable against each org's own site, rather than
  silently coupled to this app's own display-name spelling quirks (see the
  entry below for exactly what goes wrong with the alternative).
- **Membership rosters were hand-adjusted, not each org's raw published
  list.** OAS excludes Cuba/Venezuela/Nicaragua; Mercosur excludes
  suspended Venezuela and includes newly-full-member Bolivia. Getting this
  right required treating "the org's own page" as a starting point, not an
  ending point — SCO, OAS, and BRICS all needed a second, more specific
  query (full members vs. observers/dialogue-partners/disputed status)
  beyond the first fetch; the Nicaragua exclusion specifically was found
  mid-research (not in the original spec) and flagged for confirmation
  before being applied, rather than silently added or silently dropped.
- **One alliance highlighted at a time, not a multi-select Set.**
  Considered and rejected: highlighting all 18 alliances' rosters
  simultaneously would read as "most of the globe is colored," defeating
  the point of a highlight. Matches `selectionStore.ts`'s single-`selected`
  precedent rather than `layerStore.ts`'s independently-toggleable-many
  precedent — deliberately the former, since this is "which one am I
  looking at," not "which layers are on."
- **Reused `HIGHLIGHT_COLORS.categoryHighlight` rather than adding an 8th
  color slot** for the alliance-highlight layer, specifically because
  `highlightColors.ts`'s own header documents its 7-slot ROYGBIV palette as
  a deliberate, CVD-validated design constraint — adding an 8th hue
  casually would have quietly broken that constraint for a feature that's
  semantically identical to what `categoryHighlight` already means ("every
  entity in a highlighted group, at once").

## 2026-08-14 — v6.2.0: alliance data keyed by ISO3, not country name — the "United States of America" catch

When rewriting `data/allianceMemberships.ts` to use real ISO 3166-1 alpha-3
codes (see the scope-decisions entry above for why), building the
name-to-code join table surfaced a latent bug in the *first* draft of this
same file, written earlier the same day: `countryProfiles.ts` keys the US
as `"United States of America"` (Natural Earth's raw name — unchanged by
`unMembers.ts`'s `DISPLAY_NAME_OVERRIDES`), not the colloquial
`"United States"` the first draft had hardcoded as a `Record` key. That
draft's US entry would have silently never matched `country.name` at render
time — no error, no warning, just an empty ALLIANCES section for the one
country that should have had the most badges. Caught only because building
`countryIso3.ts` required reading `countryProfiles.ts`'s actual generated
keys directly rather than assuming a colloquial name, and then verifying
the full 193-entry table programmatically (a throwaway script
cross-checking every name from `unMembers.ts` against a hand-typed alpha-3
map: zero missing, zero extra, zero duplicate codes) instead of trusting
hand-transcription by eye. **Lesson: when a "country" string is used as an
equality key (a `Record` lookup), not just displayed, verify the actual
source-of-truth key format in code — never assume the colloquial name.**
This codebase already had one other instance of exactly this trap before
this session: `Country.id`'s doc comment claims ISO alpha-3 convention, but
the runtime-registered value is actually the numeric topology id (see
`data/countryEconomics.ts`'s header comment).

## 2026-08-14 — AREA formatting: plain comma-grouped km², not a Million/Billion tier

`formatPopulation`/`formatGdp` both promote large raw numbers into "X
Million"/"X Billion" for readability (`utils/formatScale.ts`). AREA
deliberately does *not* get the same tier treatment, even though copying
the existing pattern was the path of least resistance. Population/GDP need
tiering because they range over enough orders of magnitude that a raw digit
count is genuinely hard to read (a GDP figure can run 14+ digits). Area's
range — Nauru's ~21 km² to Russia's ~17.1 million km² — is comfortably
readable as a single comma-grouped count the way reference sources (the CIA
Factbook itself) already present it: "17,098,242 km²" reads more naturally
for a physical area than "17.1 Million km²" would, in a way that isn't true
for a population or GDP count. Copying the tier pattern reflexively here
would have been consistency for its own sake, not actual legibility —
worth naming explicitly since the next person touching this file will see
the tiered pattern right next to it and may reasonably wonder why AREA
didn't get the same treatment.

## 2026-08-13 — v6.0.1: population formatter needed a Thousand tier

Reported directly: small countries (under 1 Million population — Tuvalu,
Nauru, San Marino, several dozen UN members) showed as an awkward
"0.0337 Million" in the panel instead of something legible. `utils/
formatScale.ts`'s `POPULATION_TIERS` only had Million/Billion — added a
Thousand tier below Million (San Marino-scale now reads "33.7 Thousand",
Tuvalu-scale "11.2 Thousand"). `GDP_TIERS` intentionally untouched: no UN
member's GDP falls under $1M (Tuvalu's, the smallest, is still tens of
millions), so GDP never had this problem. Updated
`formatScale.test.ts`'s existing "keeps sub-1 values in Million" case,
which was asserting the exact behavior just changed, plus three new cases
for the tier boundary and a real Thousand-scale figure.

## 2026-08-13 — v6.1.0: GeoEntity population/GDP, hand-curated from a WDI report — and the bug from wiring only half of it

Follow-up to this same day's `Country` population/GDP work (below):
territories like Puerto Rico still showed no GDP/population in the panel,
because `GeoEntity` (unlike `Country`) never had `population`/`gdpUsd`
fields at all. Added them to `data/types.ts`'s `GeoEntity` — same shape as
`Country`'s (`population`/`populationYear`/`gdpUsd`/`gdpYear`).

**Sourcing had to be hand-curated, not auto-merged, and that's a real
architectural difference from `Country`, not a shortcut.** A `GeoEntity`
record also carries `administeredBy`/`claimedBy`/`claims` — hand-curated
relationship data with no API equivalent — so a script that auto-writes
into `geoEntities.ts` every run risks clobbering that the moment the file's
shape changes, in a way `useCountryFeatures.ts`'s runtime merge into the
(relationship-free) `Country` registry never risks. Wrote
`scripts/buildGeoEntityEconomics.mjs` to query World Bank WDI
(`NY.GDP.MKTP.CD`/`SP.POP.TOTL`, same date-range-lookback methodology as
`buildGovCapitalPopGdp.mjs`) for every `'territory'`/`'geopolitical-entity'`
GeoEntity with a resident population, but to only ever produce a **report**
(`scripts/geoEntityEconomicsReport.json`) — never write `geoEntities.ts`
directly. Used that report to hand-populate 23 of 56 entities (Puerto Rico,
Hong Kong, Macao, Kosovo, Palestine, ...), each with a per-field comment
citing the exact WDI entity name/code/year and a new `wdiProvenance()`
helper building a `provenance` that's explicit about the split: population/
GDP are now a real, confirmed, cited figure; the entity's relationship data
stays exactly as simplified/hand-curated as it was before. 16 entities were
queried and came back with genuinely no WDI data (Jersey, Guernsey, Åland,
Anguilla, Montserrat, Saint Helena, Cook Islands, Niue, Pitcairn, Wallis and
Futuna, Norfolk Island, British Indian Ocean Territory, French Southern and
Antarctic Lands, Saint Barthélemy, Saint Pierre and Miquelon, Falkland
Islands) — left unscored with an explicit "No WDI data" comment so a
missing figure reads as "checked, not tracked" rather than "not checked
yet." Taiwan, Western Sahara, and Crimea were deliberately excluded from
the query entirely, per the task's own instruction — Taiwan because WDI
structurally excludes it (needs IMF World Economic Outlook sourcing
instead), Western Sahara/Crimea because both have contested administration,
so no single WDI query is an uncontroversial answer to "population of X."
The three uninhabited entries (Heard Island/McDonald Islands, U.S. Minor
Outlying Islands, South Georgia and the South Sandwich Islands) were never
queried at all — no resident population, no WDI entry to look for.

**Real bug, caught by the user, not by verification:** `tsc -b --noEmit`
and `npx vitest run` both passed clean after adding the type fields and the
data — and still would have, because neither actually exercises
`IntelligencePanel.tsx`'s render output. `GeoEntityDetails` (the component
that renders a selected territory's card) was never updated to actually
read `entity.population`/`entity.gdpUsd` — the data layer was fully wired,
the render layer wasn't touched at all, so clicking Puerto Rico showed
exactly what it always had. Fixed by adding the same POPULATION/GDP
`DataRow`s `CountryDetails` already had (same source-year-in-parens
treatment, same `utils/formatScale.ts` formatter) to `GeoEntityDetails`.
Worth remembering: this codebase's Vitest coverage is pure-function only
(see this file's own header and `CLAUDE.md`'s Commands section) — a change
that's correct at the type/data layer but incomplete at the render layer
will pass every automated check here and still be visibly broken; the dev
server is still the only thing that actually catches it.

## 2026-08-13 — population/GDP become the first auto-merged `Country` fields; raw-value/render-time-formatting split

`CLAUDE.md`'s "Geopolitical data architecture" section has said since v2.1
that `countryProfiles.ts` and the `Country` registry schema "are not
merged" — true when written, since nothing populated `Country.population`/
`gdpUsd` at all. `scripts/buildGovCapitalPopGdp.mjs` (government type +
capital from a frozen CIA World Factbook snapshot, population + GDP from
the World Bank API v2) changed that: `useCountryFeatures.ts` now merges
`population`/`gdpUsd`/`populationYear`/`gdpYear` from the script's
`data/countryEconomics.ts` output into the `Country` registry at load time,
keyed by the same numeric topology id the registry already uses. Updated
`CLAUDE.md`'s stale "not merged" line to describe the actual state rather
than leave a false invariant standing for the next reader to trust at face
value.

The exception is narrow, not a reversal: `government`/`governmentNote` and
`capital`/`capitalLat`/`capitalLng` stay hand-curated in
`countryProfiles.ts` and are **not** auto-merged, because both require
judgment calls a script shouldn't make silently — which contested/
transitional governments (Chad, Gabon, Sudan, Libya, Yemen, Afghanistan,
...) get a descriptive string instead of being forced into a stable
"Presidential Republic" shape, and which of several plausible capitals a
multi-capital country (South Africa, Bolivia, ...) actually gets, both
already logged as explicit gaps in `BACKLOG.md` when ambiguous rather than
guessed. `population`/`gdpUsd` cleared a bar those two don't: an
unambiguous per-country source (World Bank API, date-range queried
2000-2024 rather than a single year, so "no current figure" and "no figure
at all" are distinguishable and every gap is logged instead of silently
left blank or backfilled with a stale year presented as current), and no
possibility of clobbering a hand-curated field, since `Country` never had
`government`/`capital` fields to collide with in the first place.

**Also fixed in the same pass: population/GDP had originally been written
into `countryProfiles.ts` as pre-formatted display strings
(`"2.14 Billion"`) computed at build time** — flagged as wrong because a
future correction crossing a unit threshold (millions -> billions) would
require re-running the whole build instead of just fixing the formatter,
and it meant two places a rounding/scale bug could live instead of one.
Fixed by storing raw numeric `population`/`gdpUsd` on `Country` and adding
a single shared formatter, `utils/formatScale.ts`
(`formatPopulation`/`formatGdp`, unit-tested directly rather than via
snapshot assertions on the data file), called at render time by
`IntelligencePanel.tsx`. This is also what made the World Bank lookback
worth doing carefully: `resolveWorldBankIndicator` now queries a date
range and returns both the value and the actual year it came from, so a
stale-but-real figure (South Sudan's GDP, last reported 2015) is cited
explicitly with its year rather than presented as current — and widening
the lookback surfaced that Cuba (2020) and Eritrea (2011) aren't the
genuine data voids they'd been assumed to be; only North Korea has no
World Bank GDP figure in the entire 2000-2024 window.

`BACKLOG.md`'s generated gap-report section needed one fix to stay
idempotent under this change: gaps were logged via `push()` inside
per-country concurrent async work, so their array order depended on
network timing and varied run to run even with identical upstream data.
Sorted by country then field before serialization — re-running the script
against unchanged data now produces a byte-identical `BACKLOG.md`, and a
closed gap (verified by faking a World Bank response) disappears from the
list cleanly instead of leaving a stale entry behind.

## 2026-08-12 — v5.2.9: the same `distanceFactor` bug, a third time, plus a large data-completeness pass

**`scene/PointerMarker.tsx`'s capital-marker label had the identical
`distanceFactor={8}` bug just fixed in `EntityRenderLayer.tsx`'s
`HoverLabel` for v5.2.8** — reported next as "the font for the capitals is
way too big" (referencing the callout that appears at a selected
country's capital). Same root cause, same fix: dropped the prop. Worth
noting as a pattern now, not just a one-off: this is the fourth `<Html>`
in this codebase found carrying `distanceFactor` and reported as
oversized/growing wrong (`WaterLabels`, `Lakes.tsx`, `HoverLabel`, now
`PointerMarker`) — worth grepping for `distanceFactor` across `scene/`
before adding any *new* `<Html>` label, rather than waiting for it to be
reported again on a fifth.

**Callout line length halved** on the same request, in the same
component — `CALLOUT_RADIUS_FACTOR` (1.1 → 1.05, halving the radial
excess above the anchor point) and `DEFAULT_CALLOUT_OFFSET_DEG` (4° → 2°,
halving the diagonal swing). Both needed to move together since the
line's rendered length is the combination of the two, not either alone.

**Separately, in the same session: "a lot of countries are missing their
capitals."** `data/countryProfiles.ts` had shipped as intentionally
partial "illustrative demo data" since it was introduced (~60 of 193
UN members) — `CLAUDE.md`'s own "Data quirks" section documented this as
expected, not a bug. Asked the user to scope the fix before writing 132
countries' worth of data (capital-only vs. full profile matching the
existing shape) rather than assuming — chose full profile, so the
intelligence panel doesn't look visibly thinner for some countries than
others. Filled in all 132 in one pass, verified programmatically (a
throwaway script diffing the UN-193 topology's name list against what the
file actually exports) to guarantee no duplicate keys, no typo'd names
that don't match the topology's `name` property, and no UN member left
uncovered — the kind of exhaustive 1:1 check that's easy to get subtly
wrong by hand at this volume and hard to notice missed by eye. A handful
of countries were mid-transition (military/transitional governments in
Chad, Gabon, Guinea, Mali, Niger, Burkina Faso; contested/unrecognized
governments in Sudan, Libya, Yemen, Afghanistan) and got a descriptive
`government` string instead of being forced into the "Presidential
Republic"-shaped box every stable entry uses.

## 2026-08-12 — v5.2.8: matching a formula wasn't enough — `distanceFactor` was scaling one label and not the other

Follow-up to v5.2.7's "hover replaces the passive label in place." First
report was "two different font sizes when hovering — the glowing yellow
font should only be the smaller size not the big one." Traced to
`EntityRenderLayer.tsx`'s `HoverLabel` hardcoding a flat `text-xs` (12px)
while `PassiveEntityLabels.tsx` computes its font size from apparent
on-screen extent, clamped to 6-11px — so the hover label was bigger than
even the largest entity's passive label. Fix: pulled the formula into a
new shared module, `useApparentFontSize.ts` (a plain `.ts` file, not
`.tsx`, so `HoverLabel` can import the hook without
`PassiveEntityLabels.tsx` exporting a non-component value from itself —
same reasoning `geoEntityEntries.ts` already established for its own
extraction), with a pure `computeApparentFontSizePx` for
`PassiveEntityLabels.tsx`'s per-candidate loop (can't call a hook there —
variable iteration count per render) and a reactive `useApparentFontSize`
wrapper for `HoverLabel`'s single entity.

**Verified against the formula, shipped, and the user immediately reported
it again: "the font still gets bigger when hovering."** The formula fix
was real but incomplete — `HoverLabel`'s `<Html>` still carried
`distanceFactor={8}`, left over from before this component ever computed
its own font size. `distanceFactor` applies an *additional*
distance-dependent CSS scale on top of whatever `fontSize` is set to;
`PassiveEntityLabels.tsx`'s `<Html>` has never used it (its `fontSizePx`
is already meant to BE the final on-screen size). So the two labels could
only ever coincidentally match at one specific camera distance, not
generally — matching the *formula* that produces the CSS `fontSize` value
was necessary but not sufficient while one of the two `<Html>` elements
was still scaling that value by something the other wasn't. Dropped
`distanceFactor` from `HoverLabel`, same call already made for the same
reason in `Globe.tsx`'s `WaterLabels`, `Lakes.tsx`, and
`UsCityLabels.tsx` — worth remembering as a category, not just a
one-off: any two `<Html>` elements meant to render at visually equivalent
sizes need to agree on distanceFactor use, not just on the font-size
number fed into them.

Also dropped: the hover label no longer renders at all for a *selected*
(not hovered) entity — `IntelligencePanel.tsx`'s name heading already
covers that case, and it was the last remaining caller of the "up to two
HoverLabels mounted at once" path this refactor's own comments still
referenced.

## 2026-08-09 — v5.2.7: removing the callout line meant hover and passive labels now share a position — and a scope question worth asking first

**Asked two clarifying questions before writing any code, since the request
had real ambiguity: "political states" (this app's own Layer Engine
category label for `StatesProvinces.tsx` — confirmed, not guessed) and a
concrete reveal-distance target (the user's answer — "further away than
lakes, but closer than country fill because sometimes multiple countries
can be in view" — gave two existing reference points to anchor between
rather than a bare number to invent).** Landed on
`CAMERA_MIN_DISTANCE + 0.7` (~3.2): further than `Lakes.tsx`'s tightest
existing gate (~2.8), closer than the distance a single country already
fills the view (~3.5-4), matching the stated reasoning that several of the
9 countries this layer covers are large enough to have multiple states
visible together before a single-country zoom.

**Removing `EntityRenderLayer.tsx`'s small-entity leader-line callout was
mechanically simple — always use the inline-at-centroid branch large
entities already had — but it quietly turned a documented, accepted gap
into an active, visible bug.** `GeoEntityLabels.tsx`'s own comment already
said "GeoEntities.tsx has never wired an onHoverChange publisher... a
hovered territory can briefly show both its glowing HoverLabel and this
dim passive label at once; harmless visual duplication" — harmless
specifically because the two labels used to render in DIFFERENT places (a
leader-line callout well away from center for anything under
`LARGE_ENTITY_THRESHOLD_DEG`, vs. the passive label at the centroid).
Once hover labels stopped using that callout and started rendering AT the
centroid — the exact request: "the hovered text should remain on the
country but replace the regular visible text" — that old duplication
stopped being harmless: two labels at the identical position read as one
garbled, stacked mess instead of two labels near each other. Caught this
by re-reading `GeoEntityLabels.tsx`'s own comment while implementing the
callout removal, not by testing first — the comment had already written
down exactly the condition ("both labels at once") that was about to
become visible for the first time.

**Fix: extended the exact mechanism `CountryLabels.tsx`/
`hoveredCountry.ts` already used, to the other two consumers** —
`hoveredGeoEntity.ts` and `hoveredStateProvince.ts`, published from
`GeoEntities.tsx`'s/`StatesProvinces.tsx`'s own `onHoverChange` callbacks.
One real subtlety worth the extra step rather than passing the hovered id
straight through: `EntityRenderLayer.tsx` reports hover by **geometryId**
(the id its pointer handlers actually see, from iterating
`entries.map()`), but the exclusion check in `PassiveEntityLabels.tsx`
needs the **entityId** — geoEntityEntries.ts's own doc comment already
explains why the two aren't always the same string (44 of 55 GeoEntities
have a numeric geometry id that differs from their registry entity id).
Skipping the geometryId→entityId lookup before publishing would have
"fixed" 11 of the 55 GeoEntities by coincidence and silently left the
other 44 still double-labeling on hover — the kind of bug that would only
surface later, on a specific entity, looking like a fresh regression
rather than an incomplete first fix. Converted through the entries list at
publish time instead, the same lookup `Countries.tsx` never needs (a
country's geometryId and entityId are always the same string) but every
other consumer of this pattern does.

## 2026-08-09 — v5.2.6: `geometryToAngularExtent`'s antimeridian assumption had one more hole — a ring that encircles a pole

**"Antarctica is abbreviated even zoomed all the way out, despite having
plenty of room" — asked directly to look for more instances of the v5.2.4
class of bug, since the symptom (a huge, obviously-not-tiny entity stuck
abbreviated) matched exactly.** Reproduced the same way as v5.2.4: a plain
Node script against the real topology, this time `public/geo/entities.json`
(Antarctica is a GeoEntity — a treaty-governed region, not a UN member
country — so it's not even in `countries-un193.json`). Its computed extent
was exactly `360`. Printed every ring's raw (non-unwrapped) longitude range
to see why: ring 0 (its main coastline, 6224 points) spans `-180.0` to
`179.8` raw — it runs all the way around the pole, touching essentially
every longitude, rather than dipping near the antimeridian just once the
way v5.2.4's fix already handled correctly for Russia/the USA.

**Why the v5.2.4 fix didn't already cover this.** That fix's own comment
claimed "a single connected ring's own unwrap never needs to cross more
than one dateline" — true for every country's coastline, false for a ring
that circumnavigates a pole. `unwrapRingLongitudes` doesn't error on such
a ring — each individual step still just keeps the next point within 180°
of the previous one — but the CUMULATIVE drift over a full trip around the
pole doesn't cancel out the way it does for a normal ring: by the time you
walk back around to your own starting point, you've drifted a full 360°
away from where you started (rather than back to ~0° away, like any ring
that doesn't encircle a pole). The resulting longitude span (~360°) then
broke `apparentSizePx`'s trig the exact same way the v5.2.4 bug did —
`sin(360°/2) = sin(180°) ≈ 0` — but landing on *zero* apparent size instead
of a negative one, so Antarctica's symptom was "always abbreviated,
regardless of zoom" rather than "abbreviated until you're almost at
`CAMERA_MIN_DISTANCE`."

**Fix: detect the pole-encircling case directly, using the same unwrap
output the function already computes.** A ring's own first and last point
are the same physical location (rings are closed) — for any normal ring,
after unwrapping, they land within a few degrees of each other, because
the drift direction reverses and cancels out over the course of a ring
that doesn't enclose a pole. A ring that DOES encircle a pole never
reverses — it keeps drifting the same direction the whole way around — so
its unwrapped last point ends up nearly 360° from its unwrapped first
point instead. Checking `|unwrapped.last - unwrapped.first| > 180` cleanly
separates the two cases (there's a huge margin — real rings land near 0,
pole-encircling ones land near 360, nothing in between) without needing
any special-casing by name ("if this is Antarctica...") or by hardcoded
geometry. When true, only the ring's latitude span is used — its longitude
span is genuinely meaningless for something that spans every longitude by
construction.

**Audited the rest of the dataset for the same class of problem before
calling it done** — the same discipline v5.2.4's entry ended on. Swept
every country and every GeoEntity for extent values that were impossible
(>170°, since no real single ring should legitimately exceed that) or
suspicious (exactly 0). No other pole-encircling rings exist — Antarctica
is the only landmass in this dataset that surrounds a pole, so this was a
one-off, not a pattern. A handful of GeoEntities DID come back with a
genuine `0°` extent (Gibraltar, Spratly Islands, Bajo Nuevo Bank,
Serranilla Bank, Scarborough Reef, the U.S. Minor Outlying Islands) —
checked their raw geometry directly rather than assuming a second bug:
each is a real degenerate 4-point ring where every point is the exact same
coordinate, i.e. a genuinely point-sized feature that topojson-simplify
collapsed down from an already-tiny polygon. Correct behavior for
something that small to always read as an abbreviation — not a bug,
verified rather than assumed.

## 2026-08-09 — v5.2.5: font size hit its ceiling too early, silently breaking long-name abbreviation too

**"DRC stays abbreviated even when zoomed in" — same class of "verify with
real numbers before touching code" approach as v5.2.4's antimeridian bug,
applied to a design/tuning problem instead of a math bug.** Computed
`apparentSizePx`/`estimateTextWidthPx`'s actual output for "Democratic
Republic of the Congo" (33 characters) at several camera distances using
the exact constants shipped in v5.2.3/v5.2.4
(`FONT_TO_APPARENT_RATIO=0.32`, `MAX_FONT_PX=13`,
`MAX_NAME_WIDTH_FRACTION=1.15`): the full name only stopped being
abbreviated at `CAMERA_MIN_DISTANCE` (2.5, the absolute closest zoom this
app allows) — at any more ordinary "zoomed in on this country" distance
(3.5, 4.8) it stayed abbreviated. Root cause: once `apparentPx * 0.32`
exceeds 13 (i.e. apparentPx > ~41px — reached almost immediately, even at
the default overview distance, for any country of moderate size), the
rendered font size stops growing entirely. Since the estimated text width
scales directly with font size, the width also freezes at a constant once
the font caps out — while the ABBREVIATION THRESHOLD
(`apparentPx * MAX_NAME_WIDTH_FRACTION`) keeps growing as you zoom in
further. For a short name, the frozen width is small enough that the
still-growing threshold overtakes it quickly. For a 33-character name, the
frozen width (based on a 13px font) is large enough that the threshold
doesn't catch up until apparentPx is enormous — i.e., until the camera is
about as close as it can physically get.

**Same root cause silently explains the other complaint in the same
message: "country text is still too big at zoomed out levels."** Because
font size saturates at ~41px apparent size, and most countries at the
DEFAULT overview distance already exceed that, most country labels were
rendering at the SAME maxed-out font (13px, bold) regardless of whether
they were barely visible or filling a third of the screen — not
meaningfully zoom-adaptive in practice for anything but the smallest
countries. This also explains the third complaint ("Zambia's label
overlaps DRC") as a likely symptom rather than a separate bug: bigger,
maxed-out fonts render more total pixels of width, increasing the odds
any given label's estimated bounding box spills past its own country's
visual footprint into a neighbor — `declutterLabels` only prevents
label-vs-label collisions, not label-vs-neighboring-country-shape
collisions, so a label that's simply too wide for what it's sitting on
will read as overlapping regardless of spacing logic.

**Fix: lower both the ratio and the cap** (`FONT_TO_APPARENT_RATIO`
0.32→0.12, `MAX_FONT_PX` 13→11, `MIN_FONT_PX` 7→6, `MAX_NAME_WIDTH_FRACTION`
left unchanged at 1.15). Re-verified numerically before touching the
browser: Democratic Republic of the Congo now flips to its full name
around apparentPx≈240 (roughly camera distance 3.5, a normal "focused on
this country" zoom) instead of requiring apparentPx≈330+ (distance 2.5);
Russia/USA/Canada (already full-name, large apparent sizes) are
unaffected; Zambia/Congo/Angola now scale gradually from ~7-10px at the
default overview instead of already sitting at the old 13px cap. Confirmed
in a live browser session: default-overview country labels
(Mexico/Venezuela/Colombia/Brazil/etc.) visibly render smaller/less bold
than before the retune, and DRC still correctly abbreviates at the
default search-flight distance (~4.8) — matching the tuned prediction.
Could not directly re-confirm the full-name flip at distance 3.5 in the
same session (this session's browser automation couldn't sustain a
reliable zoom-in beyond the initial fly-to at this window size — scroll-
wheel and repeated key-press zoom were both inconsistent here, a tooling
limitation already noted in v5.2.4's entry, not something the app itself
does) — trusted the direct numerical verification against the real
shipped functions instead, which is deterministic and needs no interactive
confirmation to be correct.

## 2026-08-09 — v5.2.4: four label bugs from one round of feedback, one root-caused by comparing against a hand computation

**"Why is the USA abbreviated, it has one of the largest footprints" —
root-caused by not trusting `geometryToAngularExtent`'s output at face
value.** Reproduced with a plain Node script against the real topology
(`node -e` against `world-atlas`'s `countries-un193.json`, no app code) —
Russia's computed extent was **502.9°**, an impossible value for any real
lat/lng bounding box (max possible is 360°). Traced to `unwrapRingLongitudes`
starting fresh from each ring's OWN first point with no shared reference —
fine for triangulation (each ring is handled independently anyway), wrong
for a function that then combines every ring's independently-unwrapped
points into ONE running min/max. Russia's Kaliningrad exclave (~20°E) and
its Far East (unwrapped relative to ITS OWN start, landing on a different
360°-multiple branch than Kaliningrad's) got merged into a single bounding
box spanning neither's real extent. `apparentSizePx`'s `sin(extentRad/2)`
on a half-angle past 180° flips sign, silently making the USA/Russia
register as having ~0 or negative apparent size and always fall back to
abbreviation — huge countries were the ONLY ones that could hit this,
because they're the only ones large enough to actually reach the
antimeridian with a detached exclave on the far side. Fixed by taking the
MAX of each polygon's own independent extent instead of a combined
bounding box — this also matches what the function's own (pre-existing,
but not actually implemented) doc comment already claimed the behavior
was. The existing test for this function had actually locked in the OLD
buggy contract as intentional ("spans a single bounding box across every
polygon's points, including the gap between them") — updated it to match
the corrected contract, and added a dedicated regression test using two
small polygons on opposite antimeridian branches, mirroring the real bug
instead of just re-testing the fix in the abstract.

**"I can see Lebanon before Israel even though Israel is bigger" —
investigated with a second Node script simulating the real
`declutterLabels` greedy pass against real centroids/extents for the whole
neighborhood (Israel, Lebanon, Syria, Jordan, Cyprus, Turkey, Iraq, Egypt,
Saudi Arabia).** Found the actual mechanism by sweeping a range of
plausible zoom levels: Israel isn't losing a conflict to Lebanon directly —
it's losing to **Jordan** (bigger, so processed earlier in
priority order and accepted first), and Lebanon happens to sit just far
enough from Jordan to clear the same flat 80px spacing requirement Israel
can't. This is inherent to a flat, one-size-fits-all spacing radius: a
small, heavily-abbreviated label needs far less clearance than a big
country's full name, but the old code gave every candidate the same
40px-per-side fallback regardless. Fix: while extracting
`PassiveEntityLabels.tsx` (see below), each candidate's spacing radius is
now half its OWN estimated rendered width — the same fix
`labelDeclutter.ts`'s doc comment already documents for the Gulfport/
Biloxi regression, just not previously applied to `CountryLabels.tsx`.
Genuinely reduces how often this class of collision happens; doesn't
eliminate it outright — a greedy priority-ordered pass can still reject a
smaller neighbor sitting close enough to ANY bigger, higher-priority one,
at some zoom level. Verifying the exact before/after zoom threshold in a
live browser session turned out to be unreliable (this session's browser
automation couldn't reproduce sustained scroll-zoom consistently across
window-size changes); trusted the Node-level simulation, which exercises
the actual shipped `declutterLabels`/`apparentSizePx` functions, not a
reimplementation.

**"Territories like Greenland should have the same logic."** GeoEntities
never had an always-on passive label at all — only
`EntityRenderLayer.tsx`'s hover/selection-triggered `HoverLabel`. Rather
than duplicate `CountryLabels.tsx`'s now-fairly-substantial zoom-adaptive
logic (apparent-size sizing, abbreviation, per-candidate spacing, uniform
color) a second time for a new `GeoEntityLabels.tsx`, extracted it into
`PassiveEntityLabels.tsx` first — the same "duplication became real, so
extract" call `EntityRenderLayer.tsx` already made once for border/fill/
hover rendering shared by `Countries.tsx`/`GeoEntities.tsx`/
`StatesProvinces.tsx`.

**Debugging note, not a real bug:** while verifying `GeoEntityLabels.tsx`
in the browser, every rendered GeoEntity label appeared to be silently
missing — entries built correctly (confirmed via a temporary debug log:
55 entries, real names/extents), but nothing rendered anywhere on the
globe, for either `CountryLabels.tsx` or `GeoEntityLabels.tsx`, and even a
second debug log placed inside `PassiveEntityLabels.tsx`'s `useFrame`
never fired at all. Restarting the Vite dev server (not just reloading the
page) resolved it immediately. Suspected cause: React Fast Refresh
struggling to reconcile a structural refactor that moved hook logic across
files while the dev server stayed running (`CountryLabels.tsx` changed
from a full implementation to a thin wrapper around a brand-new sibling
component in the same edit) — never fully confirmed, but worth remembering
as the first thing to try when a component's `useFrame`/effects appear to
stop firing entirely after a large structural edit, before assuming the
new code itself is wrong.

**"Strait of Hormuz overlapping the Persian Gulf, the Red Sea overlapping
sovereign states, bodies of water shouldn't extend past their area."**
`WaterLabels` used `Html`'s `distanceFactor={8}` — scales a label to a
constant WORLD-SPACE size, meaning it reads BIGGER on screen the closer
the camera gets, unbounded. `UsCityLabels.tsx` already documents dropping
this exact prop for this exact reason ("even a 3px CSS size rendered as
text spanning most of the screen — confirmed directly in a live browser").
`WaterLabels` was the one remaining consumer still using it. No apparent-
size-based scaling was added here the way countries/GeoEntities now have —
water bodies are a single lat/lng point with no polygon data to size
against (see `data/waterBodies.ts`'s own doc comment) — this fix only
removes the unbounded growth, leaving a small fixed on-screen size at
every zoom level.

## 2026-08-09 — v5.2.3: label size/abbreviation needs to track current zoom, not fixed physical size

**The bug wasn't that small countries never abbreviated — it's that the
abbreviation decision (and the label's color) was keyed to the wrong
variable.** `CountryLabels.tsx`'s old 4-tier system picked a label's size,
color, and (implicitly, by never abbreviating) its text purely from
`geometryToAngularExtent` — a country's fixed real-world size. That answers
"is Russia bigger than Luxembourg," which is real and useful for declutter
*priority*, but not "does this label currently fit on screen," which
depends just as much on how far the camera is right now. A physically huge
country (the USA) can have a full name that doesn't fit its OWN apparent
footprint from the default overview distance, and a physically small one
(any small European country) can earn its full name once you're zoomed in
close — extent alone can't distinguish either case.

**Fix: derive apparent (zoom-dependent) size instead of using fixed extent
directly.** New `apparentSizePx` (`labelDeclutter.ts`) turns
`(extentDeg, cameraDistance, viewportHeight, fovDeg, sphereRadius)` into a
current on-screen pixel estimate, using the standard "world units visible
per pixel at distance d, given vertical FOV" relationship — deliberately a
flat-plane approximation, not a true two-point screen projection (project
the feature's near/far edge and measure the pixel gap), because this only
needs to answer a threshold question ("short or long form"), not render a
literal bounding box. Font size now scales with that value directly
(clamped); the full-vs-abbreviated choice compares an estimated rendered
text width (`estimateTextWidthPx` — a rough average-glyph-width heuristic,
not a real layout pass) against it.

**Abbreviation needed a source, and the topology data doesn't have one.**
`countries-un193.json`'s `id` field is the ISO 3166-1 **numeric** code
(`360` for Indonesia), not an alpha-2/alpha-3 code — confirmed by reading a
sample feature directly rather than assuming. Adding a hand-maintained
193-entry alpha-code lookup table was the obvious option; instead,
`countryAbbreviation.ts` derives a short form from the display name string
already in hand: multi-word names take initials of their significant words
(stop words "of"/"the"/"and" dropped) — "Democratic Republic of the Congo"
-> "DRC", "United Kingdom" -> "UK" — which turns out to reproduce a lot of
real common/ISO abbreviations for free, since that's literally how most of
them were coined. Single-word names (Ukraine, Luxembourg) fall back to
their first 3 letters. Not guaranteed collision-free (South Africa and
Saudi Arabia both reduce to "SA") — accepted, the same tradeoff real-world
atlas abbreviations make, and the full name is always one hover/click/zoom
away.

**Verifying the zoom-dependent transition in the browser hit a tooling
limit, not an app bug.** Both synthetic mouse-wheel `scroll` events and
repeated `w` keypresses (this app's zoom-in binding) were unreliable for
sustained zooming through the browser automation tool — a single scroll
event did produce one real zoom-in transition (confirmed: several countries
flipped from abbreviated to full name in that one before/after pair), but
repeated key events didn't accumulate further, likely because the app's
held-key tracking (`KeyboardController.ts`'s `Set` of currently-held keys,
mutated on real keydown/keyup) doesn't see a synthetic "repeat" as truly
held — each repeat is its own instantaneous down+up pair. Fell back to
DOM-level verification instead: queried `getComputedStyle` on rendered
labels at a single fixed camera position and confirmed BRAZIL/COLOMBIA
(large, full name, bold, 13px) vs USA/CV (abbreviated, 7px) vs CR/GUY
(mid-size) all share the exact same `color` while size/weight differ — the
uniform-color and apparent-size-driven-sizing requirements verified
directly, and the zoom-transition mechanism trusted to the already-unit-
tested inverse-distance relationship in `apparentSizePx` plus the one
observed real transition.

## 2026-08-09 — v5.2.2: the water-label bug was one symptom of a wider pattern, not the whole bug

**After shipping v5.2.1, asked directly: are there other instances of this?**
Worth checking rather than assuming the fix was scoped correctly the first
time — `WaterLabels` was reported broken because ocean names are highly
visible and easy to notice, not because it was the only place with the
underlying defect. The real defect, stated generally: **an `Html` label is a
DOM overlay with no WebGL depth buffer, so nothing hides it automatically
when it should be behind the globe — every other rendered thing in this
scene (a `<mesh>` dot, a `<Line>` leader line) gets that for free from
ordinary depth-testing against the opaque core sphere, but `Html` doesn't.**
Anything that (a) renders an `Html` label and (b) can end up positioned on
the far side while still meant to render — not excluded some other way
first — has this bug.

Audited every `Html` call site in `src/scene/` against that description.
Split cleanly into three buckets:
- **Already safe**: `CountryLabels.tsx`, `UsCityLabels.tsx`, `Lakes.tsx`
  (lake names) all already run the analytic front/back check
  (`labelDeclutter.ts`) before ever reaching `Html`, for an unrelated
  reason (they have thousands of candidates and need `declutterLabels`'
  screen-space spacing logic anyway) — the occlusion correctness was a free
  side effect of solving a different problem first.
- **Already safe for a different reason**: `UsCityOutlineHighlight.tsx`
  only ever appears immediately after `flyToUsCity()`, which is its *only*
  setter and always moves the camera there in the same action — it can
  never be selected without also being front-and-center.
- **Had the bug**: `EntityRenderLayer.tsx`'s `HoverLabel`,
  `Cities.tsx`'s `CityLabel`, and `PointerMarker.tsx` (shared by
  `CapitalMarker` and `ClaimsOverlayLayer.tsx`'s related-country marker) —
  none of these had *any* front/back check, analytic or raycast. All three
  persist a label based on *selection*, which (unlike hover) has no
  built-in guarantee of being front-facing: clicking a country's polygon to
  select it proves that country was front-facing **at the moment of the
  click**, but selection outlives the click, and nothing re-checks after
  the globe rotates. Confirmed directly: click Mexico (no camera flight),
  drag-rotate it to the opposite side of the globe, and "MEXICO" /
  "MEXICO CITY" stayed fully legible the entire time — the exact same
  symptom as the ocean-label report, just for a different trigger.

**Fix:** rather than copy `WaterLabels`' inline analytic-check-plus-throttle
code three more times, extracted it into `scene/useFrontOfGlobeVisible.ts`
— a small hook taking a local (pre-rotation) position and returning whether
it's currently camera-facing, encapsulating the same rotationY compensation
and throttled `useFrame` check. Each of the three components now gates only
its `Html` element on this; the dot/leader-line meshes next to each label
were left unconditional, since those already render correctly without any
help. Worth remembering generally: when a bug report names one specific
instance of a pattern, check whether the pattern has other instances before
closing it out — the fix for "one" and the fix for "the class" are often
the same amount of work if you generalize instead of patching in place.

## 2026-08-09 — v5.2.1: `Html`'s raycast `occlude` never actually hid a far-side water label

**Reported as: "I can see the ocean wording through the globe" — Indian
Ocean visible from the USA, Gulf of Mexico visible from the Indian Ocean.
Not an edge/terminator glitch — every water body, every zoom level,
static or moving.** `WaterLabels` (`Globe.tsx`) hid far-side labels by
passing `occlude={[coreSphereRef]}` to `Html`, which runs a per-frame
raycast from the camera to each label's anchor point and toggles
`display: none` on a miss/hit. Manually inspecting the DOM
(`getComputedStyle`/the inline `display` drei sets) across several camera
positions initially showed *correct* `display: none` toggling, which
briefly suggested no bug existed — but that only held for the handful of
static states tested; the report was that it doesn't hold up in real,
continuous interaction.

**Root-caused by comparison, not by debugging the raycast itself.**
`CountryLabels.tsx` and `UsCityLabels.tsx` both solve this exact "is this
point on the near or far hemisphere" problem already, and *don't* use
`occlude` — they use `labelDeclutter.ts`'s analytic dot-product test
(`isCandidateVisible`/`projectToScreen`'s `onNearSide` check) instead,
with an explicit comment on `UsCityLabels.tsx` explaining the raycast
prop is deliberately unused because the analytic test already excluded
far-side candidates. `Lakes.tsx` (v5.2.0) actually runs *both* — it
already calls `declutterLabels` (analytic) before ever reaching `Html`,
then also passes `occlude` redundantly on top, which is why its lake-name
labels never displayed the reported symptom: the analytic filter alone
was already doing the real work, and the redundant `occlude` prop was
inert. `WaterLabels` was the *only* consumer of this app's front/back
test still depending on `occlude` alone for it, and the only one
reported broken — strong evidence the raycast approach itself is what's
unreliable here (never isolated exactly why; `frameloop="demand"` making
`Html`'s internal occlusion `useFrame` run at some indeterminate cadence
relative to camera movement is the leading suspect, not confirmed).

**Fix:** gave `WaterLabels` the same analytic check, dropping `occlude`
entirely — no new mechanism, just stopped being the one holdout using a
different, broken one. Needed the same `rotationY` compensation
`CountryLabels.tsx` already has: `WaterLabels` renders inside `Globe.tsx`'s
ambient-rotation group, so a label's local (pre-rotation) position isn't
its current *world* position, which the camera-relative analytic math
needs — `getGlobeRotationY()` supplies the current spin to reconstruct it,
exactly as `CountryLabels.tsx` already does for the same reason. Worth
remembering: when two components solve the same "is this visible" problem
with two different mechanisms and only one is reported broken, check
whether the working one's approach just needs porting over before
debugging the broken mechanism itself.

## 2026-08-08 — v5.2.0: a tinted fill over solid land reads as wrong, even when the tint is "correct"

**Lakes' first implementation was a translucent blue fill, and it looked
like a bug even though the geometry was right.** Country/state fill meshes
have no interior holes anywhere — confirmed on the US polygon specifically
— so a lake polygon drawn on top of one, translucent, still shows solid
land tinted blue through it rather than open water. The honest fix is a
geometric cutout (subtract lake polygons from country/state polygons at
build time), rejected for this pass as too large: a new polygon-clipping
dependency, touching the core country/states build pipeline that
`countryGeometry.ts`'s test coverage (v4.3.1) exists specifically to guard.
Landed on opaque pitch-black fill instead — same color as the ocean/core
sphere, so a lake reads as real open water regardless of what's
underneath, without touching land geometry at all. Deferred to
`BACKLOG.md` rather than treated as solved.

**Rivers are the first geometry type in `countryGeometry.ts` with no ring
and no interior.** Every function there — `geometryToBorderSegments`,
`geometryToFillMesh`, even the antimeridian unwrapper they both call —
assumes a `Polygon`/`MultiPolygon`. A `LineString` river has neither a
ring to close nor an interior to triangulate; calling the existing
polygon functions on one silently returns empty output (well-formed,
no crash, just nothing rendered — worth remembering as a debugging trap:
"nothing rendered" doesn't always mean the fetch/registration failed).
New `geometryToLineSegments` walks the line's own points directly,
reusing the antimeridian-unwrap and per-segment projection logic but
skipping the ring-closing step polygons need.

**A Layer Engine-mounted component can't receive a prop the way a direct
child of `Globe.tsx` can.** `WaterLabels` occludes its `Html` labels
against the core sphere via a ref passed down as a prop — straightforward,
since it's rendered directly inside `Globe.tsx`. `Lakes.tsx`/`Rivers.tsx`
mount through the Layer Engine instead (`LakesLayer.tsx`/`RiversLayer.tsx`
-> `LayerManager.tsx`), several component boundaries away from
`Globe.tsx`'s own JSX, so there's no prop path down to them at all. Fix
mirrors `globeRotation.ts`'s existing scene-to-HUD pattern in the opposite
direction: `coreSphereRef.ts` exports a plain `{ current }` box at module
scope; `Globe.tsx` assigns its core sphere mesh's `ref` prop to that
export directly instead of a local `useRef`, and `Lakes.tsx`/`Rivers.tsx`
import the same object. Worth remembering as the general answer whenever
a Layer Engine component needs something only `Globe.tsx` itself holds a
ref to.

## 2026-08-08 — v5.1.0: the black hole was a flat triangle sagging below a curved sphere

**Root cause of the v5.0.0 black-gap defect, finally found.** Every
explanation the earlier investigation ruled out (triangulation error, flipped
winding, a missing-geometry gap, an overlapping GeoEntity) was checked
correctly — the defect was never in `earcut`'s 2D triangulation at all. It's
a projection problem: earcut can legitimately produce one "ear" triangle
spanning 20-30+ degrees of arc to cover a wide concave notch in a country's
coastline. The GPU renders every triangle as a flat plane between its three
projected corners — it has no idea the surface it's approximating is a
sphere. For a triangle that wide, the flat plane's middle sags measurably
*inward* from the sphere's true curved surface. Measured directly against
Brazil's actual worst-offending triangle (extracted from the real shipped
`countries-un193.json`, not a synthetic case): it dipped **3.04% of
`GLOBE_RADIUS`** below the nominal fill radius — comfortably past the opaque
core sphere sitting only ~2% inward (`Globe.tsx`'s `RADIUS * 0.98`), which
then occludes the sagging patch from the camera.

**Confirmed the mechanism, not just the correlation, before writing the
fix.** Rather than patching based on "the worst offenders are the
highest-vertex-count countries" (the only lead the original investigation
had), this pass wrote a standalone script projecting the real triangle's
three corners through the exact `latLngToVector3` formula, linearly
interpolated across the flat triangle in 3D (matching what the GPU
rasterizer actually does), and measured the resulting radius at the
interpolated midpoint directly. That's what turned "probably a
big-country-shaped coincidence" into "here is the exact geometric
mechanism, here is the exact percentage, here is why 2%-inward is the
threshold that matters."

**Fix: recursive triangle subdivision keyed on measured sag, not a fixed
angular threshold.** `countryGeometry.ts`'s `emitTriangle()` computes actual
chord sag (project the triangle's 3 corners, sample the 3 edge midpoints +
centroid, compare each sample's radius against the nominal one) and splits
the longest edge (in lng/lat space — safe because `unwrapPolygonRings()`
already resolved any antimeridian wraparound before earcut ever ran)
whenever the sag exceeds a safe fraction of the radius, recursing on the two
resulting triangles. A fixed angular threshold (e.g. "split any triangle
wider than 10°") would have been a proxy for the real constraint; measuring
the actual projected sag is exact and self-documenting.

**A depth cap chosen without checking convergence first can silently
under-subdivide.** The first version capped recursion at depth 8 and looked
fine against Brazil's real triangle — sag came in right at the edge of the
safe threshold. A deliberately more obtuse synthetic test triangle (added to
`countryGeometry.test.ts` specifically to stress this) failed at depth 8 and
needed depth 9 to actually converge — longest-edge bisection only shrinks
the *one* edge it picks each split, so a scalene/obtuse triangle's other two
edges carry over unchanged into each child, and convergence isn't the flat
"halves every edge every level" intuition suggests. Depth cranked to 14 for
real margin over both cases; the added cost is negligible (Brazil's mainland
went from 3,610 to 3,984 triangles — only the handful of bad "ears" needed
splitting, not the whole mesh).

**Same session, three other tuning changes landed alongside the fix** (see
`CHANGELOG.md`'s v5.1.0 entry for the user-facing description of each):
the core sphere (ocean) is now always fully opaque and pitch black instead
of a translucent-while-idle navy shell; the lat/long graticule grid is
removed outright; and `highlightColors.ts`'s 7-slot palette moved from
v5.0.0's blue/cyan/violet family (reported as reading too similar to
distinguish at a glance — 5 of 7 slots were shades of the same few hues) to
one ROYGBIV spectrum hue per slot, validated with the dataviz skill's
palette checker against the app's actual near-black surface rather than
picked by eye.

## 2026-07-28 — v5.0.0: a country's fill mesh can raycast correctly, triangulate perfectly, and still render as a black hole

**Raising a country's fill opacity from ~5% to solid surfaced a real,
previously-invisible rendering defect.** While trying a navy-land/charcoal-
water/gold-border restyle of the globe (a session detour that was ultimately
reverted — see below), a chunk of Brazil's interior rendered as an opaque
black gap instead of the country's fill color. Once flagged, the same defect
was confirmed on Russia, Canada, USA, Australia, and Antarctica. It had
presumably always been there; `EntityRenderLayer.tsx`'s default fill opacity
(0.05) was low enough that nobody had ever noticed.

Diagnosing it black-box (no WebGL frame debugger available, and
`countryGeometry.ts` is under a standing "no changes without sign-off"
constraint, so this stayed read-only) ruled out every explanation that
usually causes a hole in a triangulated fill:
- **Not a triangulation defect** — `earcut.deviation()` against the actual
  shipped `countries-un193.json` came back ~1e-15 for all 43 of Brazil's
  MultiPolygon sub-polygons and all 214 of Russia's. A real triangulation
  failure shows up as deviation near 1, not 1e-15.
- **Not inconsistent triangle winding** — a custom per-triangle orientation
  check (independent of `deviation()`, since a small minority of
  wrong-winding triangles can hide inside an otherwise-correct area sum)
  found 0 flipped triangles in either mesh.
- **Not a missing-geometry gap** — hovering the black region fires the fill
  mesh's own `onPointerOver` (cursor → `pointer`), proving real triangles
  exist there and R3F's picking resolves to them correctly.
- **Not an overlapping GeoEntity** — no registered GeoEntity's centroid
  falls inside Brazil's bounding box.
- **Confirmed anchored to the globe's surface**, not a screen-space
  overlay — the black region rotates with the mesh when the camera moves.

Root cause is still open (logged in `BACKLOG.md`). The one pattern found:
all six affected features are among the highest-vertex-count meshes in the
dataset (Russia's mainland alone is 8,964 vertices; Brazil's merged 43-
polygon fill totals ~4,200) — circumstantial, not proven, but the only lead
that survived the above.

**A "restyle to match this mockup" request needs the mockup treated as
data, not vibes.** The whole v5.0.0 pass (palette, typography, panel chrome,
layout) was done by extracting literal values from the reference — hex
codes from its CSS/Three.js color literals, exact px/rgba spacing from its
`.panel`/`.panel-head` rules — rather than eyeballing "looks navy-ish."
Where the reference didn't cleanly cover an existing concept (5 of
`highlightColors.ts`'s 7 semantic slots have no equivalent in a screenshot
that only ever shows one selection state; the reference has no monospace
font at all, this app has a real functional reason to keep one for numeric
readouts), that gap got flagged and asked about explicitly rather than
silently invented — see `CHANGELOG.md`'s v5.0.0 entry for how each of those
landed.

**A "tactical HUD" decorative layer and a "glass console" one are different
visual identities, not a reskin of the same idea.** `hud/HUDFrame.tsx`'s
corner brackets + scanlines + vignette (this app's pre-v5 identity, per
`CLAUDE.md`'s "closer to a tactical display than a map app") has no
equivalent anywhere in the v5 reference — recoloring it to fit the new
palette would have kept an aesthetic the redesign was actively moving away
from. Removed it entirely rather than adapt it, once asked directly (this
was flagged as a genuine judgment call, not assumed).

**The navy/charcoal/gold globe-fill experiment (dot-fill, then solid) was
reverted the same session it was built.** Both attempts got as far as
passing typecheck/lint/tests/build and a real browser click-through before
the user judged the result worse than the pre-existing look and asked for a
full revert — the HUD chrome changes were unaffected since they'd already
been committed to (this session's) working state independently. Lesson
carried forward: this project's "verify in a real browser" step catches
things typecheck/lint/tests structurally cannot — matching valid code to
"looks right" is still a separate, necessary check.

## 2026-07-26 — v4.3: a private distance table doesn't scale past its first consumer

**`UsCityLabels.tsx`'s population/zoom-tier gate started as a private
`REVEAL_TIERS` array with no way for another feature to reuse or even see
its thresholds.** Generalized into the LOD Engine (`src/lod/`) specifically
so the next zoom-gated dataset (rivers, roads, ...) has one shared,
ordered ladder to plug into instead of a second hand-copied distance table.
Reformulating each level's "active" check as independent and cumulative
(`distance <= revealDistance`, checked per level) rather than a
descending, first-match-wins scan also turned out to remove an entire
footgun: the old scan needed a separate `NO_CITIES_ABOVE_DISTANCE` upper-
bound constant purely to stop its first threshold from incorrectly
matching from very far away, which the independent-check formulation never
needed in the first place.

**A candidate-pool filter needs an "is this actually on screen" test, not
just "is this on the near side of the globe."** The sphere-horizon
dot-product test alone (is this point facing the camera, not hidden by the
globe's curvature) stays true for 40+ degrees of arc regardless of zoom.
The camera's actual framed field of view at close zoom can be only a few
degrees wide. Those two facts together meant a candidate-pool filter built
on the horizon test alone let cities hundreds of miles outside the current
view, but still technically front-facing, consume every candidate/label-
budget slot ahead of a real, smaller city that actually was on screen —
reported as a specific real town, well inside the population floor for its
zoom tier, never appearing no matter how far you zoomed into its own
state. Fixed by projecting to screen space and checking the actual
viewport bounds too, not just curvature.

**A flat label-spacing constant assumes every label is roughly the same
size.** It isn't — this layer's labels range from 6px town names to 11px
bold metro names, a real difference in on-screen width. Applying one
shared minimum-spacing constant to that whole range meant a legibility
threshold tuned for the biggest labels was also silently rejecting much
narrower labels that were never actually at risk of overlapping. Fixed by
having each candidate carry its own spacing radius, summed pairwise,
instead of one constant for everyone.

**Promotion note:** cherry-picking this work onto `main` surfaced a real
gap from excluding an unrelated commit — `UsCityOutlineHighlight.tsx`
(v4.2) was originally mounted in `Globe.tsx` by a later branch commit that
also happened to touch ambient rotation (already shipped independently on
`main` as v3.3.1, so excluded here as redundant). Excluding that commit
silently left `UsCityOutlineHighlight` unmounted dead code on `main` after
v4.2 landed; resolving this commit's cherry-pick conflict in `Globe.tsx`
restored the mount alongside the new label components. Worth remembering
next time a promotion excludes a commit: check whether anything *else* in
that commit was actually load-bearing.

## 2026-07-26 — v4.2: 32,608 places is a scale where "always render everything" stops being an option

**The first implementation shipped as one always-on merged-polygon layer
(every boundary precomputed into a single buffer, the same
one-merged-geometry-per-entity approach that works well for 193 countries
and 294 provinces) and it read as visual noise in review — "clustered
dots/blobs," not legible city shapes.** Tracing one real city's geometry
(Austin, TX) all the way through the pipeline confirmed the underlying data
was structurally correct; the actual problem was scale interacting with an
existing limitation — this app's `LineBasicMaterial`-only borders have no
real line width on any platform, which is fine when 193 countries' worth of
borders are spread across a whole globe, but becomes illegible once
thousands of small, often-fragmented polygons (Austin alone has many,
from its own annexation history) are packed into city-block-sized screen
regions all at once. The fix was a **product-shape change** — search-
triggered, one-city-at-a-time reveal — not a rendering tweak, because no
amount of color/opacity tuning fixes "too many thin lines in too small a
space" when the actual requirement is "find one specific city," not
"see every city's outline simultaneously."

**Camera zoom has much less headroom than it looks like.** Pushing
`CAMERA_MIN_DISTANCE` from `GLOBE_RADIUS * 1.35` down to `* 1.005` (~35x
closer, aiming to resolve individual city polygons) packed the camera into
the same thin geometry shell as every other surface radius in the scene
(core sphere, country fill, borders, atmosphere shells) — grazing/near-
tangent viewing angles ended up looking through surface geometry instead of
at it. Settled on a more conservative `* 1.05` (~13x closer) instead; this
constant would be revisited twice more later (v4.3).

**Two real, separate bugs surfaced building the on-demand outline fetch:**
- `useSyncExternalStore`'s `getSnapshot` must return a stable reference
  when nothing's changed — an early version of the outline-fetch hook built
  a fresh object literal on every call, causing an infinite re-render loop
  that froze/crashed the browser tab. Fixed by caching the resolved result
  and only recomputing when the underlying (city id, shard-loaded) key
  changes.
- Two sequential store mutations for one logical action — `flyToDirection()`
  then `showUsCityOutline()` as separate calls — left a window where a
  subscriber could read inconsistent intermediate state between them.
  Collapsed into one atomic `flyToUsCity()`.

## 2026-07-26 — v4.1: a classification doesn't have to join every existing system to fit in

**`city` was deliberately left out of `CategoryHighlightLayer.tsx`/
`LegendPanel.tsx` even though every other `GeoEntityType` member is wired
into both.** That highlight system's visual (a dashed border plus a fill
overlay) is inherently a polygon operation — there's no honest equivalent
for a single point marker, and forcing one in just to keep a "every
classification supports every feature" rule would have meant either a fake
highlight effect or quietly changing what "highlighted" means. Everything
else (`GeoEntityRegistry`, `EntityResolver`, search, Tab-cycling,
`IntelligencePanel`'s `GeoEntityDetails` card) still treats `city`
identically to the other six — the exclusion is scoped to exactly the one
system where it doesn't make sense, not a reason to treat cities as a
second-class classification everywhere.

**Filtering to "real UN members" needed to check the actual runtime output,
not just ISO code validity.** A capital whose country has a valid-looking
ISO code isn't necessarily one of the 193 *registered* UN members this app
actually renders — cross-checking against `countries-un193.json`'s own
generated output (not the raw source data's country list) is what caught
the 5 non-UN capitals in the source (Vatican City, Kosovo, Bermuda,
Somaliland, Taiwan) that would otherwise have shipped a `parentCountryId`
pointing at a country that doesn't exist in this app's own registry.

**Point geometry needed a real branch in the build pipeline, not just a
smaller polygon.** `topologyPipeline.mjs`'s rebuild/presimplify/simplify/
quantize steps all exist to reduce coastline point density — meaningless
for a single lat/lng pair. `buildCitiesData.mjs` skips that pipeline
entirely rather than routing a point through machinery built for polygons
and hoping it's a no-op.

## 2026-07-26 — v4.0: states/provinces proves the Data Engine pattern before the Data Engine exists

**Added a dataset from a source this app had never used before (Natural
Earth's admin-1 boundaries, vendored directly, no npm wrapper) specifically
to test whether the existing architecture could absorb a new geographic
classification without special-casing it — before committing to build a
formal Data Engine.** Every consumer that dispatches on `GeoEntityType`
(`IntelligencePanel`, `SearchBar`, `CategoryHighlightLayer`,
`SelectionController`'s Tab-cycling, `LegendPanel`) already switched
generically on `kind`/`type` rather than enumerating classifications by
name, so adding `administrative-division` as a sixth member was additive
everywhere except the handful of `Record<GeoEntityType, ...>` maps
TypeScript itself flagged as needing the new key. That result is the actual
value of this version: the pattern (new vendored source → new build script
→ new `GeoEntityType` member → zero changes to existing rendering/
selection/HUD code) is now proven, not just planned.

**Deliberately partial coverage (9 countries) instead of waiting for
complete data.** The 1:50m resolution Natural Earth ships only usefully
resolves admin-1 boundaries for a handful of large countries — smaller
countries' subdivisions are either missing or too coarse to be worth
rendering at this zoom range. Shipping the resolution-limited pilot now,
with the 1:10m upgrade path documented (`BACKLOG.md`), was chosen over
blocking the whole feature on sourcing better data for every country.

**`topologyPipeline.mjs`'s `readSourceFeatures()` needed to accept a plain
GeoJSON `FeatureCollection`, not just the TopoJSON `Topology` every prior
build script fed it** — Natural Earth ships admin-1 boundaries as GeoJSON
directly, no topology-conversion step. Generalizing that one function
(rather than duplicating the pipeline's back half a second time, which is
exactly what v3.3.2's extraction happened one commit earlier specifically
to prevent) was the actual reason that refactor's timing mattered.

## 2026-07-23 — v3.3.1: ambient rotation moved from an inferred behavior to a persistent setting

**Replaced a "stop while selected, resume on deselect" heuristic with a
plain on/off setting the user controls directly, because the heuristic had
no state of its own — it inferred the right `autoRotate` value from
`selected` changing, which only works if selection is the only thing that
ever needs to suspend rotation.** `scene/CameraControls.tsx` used to watch
`selected` with a `wasSelected` ref and flip `autoRotate` back to `true`
the instant it saw a transition from *something selected* to *nothing
selected* — correct as far as it went, but it meant "is rotation currently
on" was never an explicit fact anywhere, only ever re-derived from
selection state at the moment of a transition. A `ambientRotationEnabled`
boolean in `settingsStore.ts` (default `false` — previously ambient
rotation was always on while nothing was selected, flipped per direct
request), toggled by a new **T** key binding, makes "should the globe be
spinning right now" a real, independently-inspectable value instead of
something reconstructed from a side effect of selection changes. The two
camera-flight completion handlers (`useCameraFlight.ts`, `useCameraReset.ts`)
that used to hardcode `controls.autoRotate = true` once a flight finished
now read the same setting instead, so a flight that completes while
ambient rotation is off doesn't silently turn it back on.

## 2026-07-21 — v3.3.0: six independent toggles instead of one picker, and why the second copy of a pattern is when you extract it

**Registered six Layer Engine layers instead of building one "pick a
category" control, because the Layer Engine already solves exactly that
problem.** First instinct for "highlight all entities of one category" was
a small new store (`highlightedCategory: Category | null`) plus a new HUD
control to set it — but that's a parallel toggle mechanism sitting right
next to a Layer Engine that already does "independently enable/disable any
number of registered visualizations," built in v2.0 specifically so future
overlays would never need new HUD plumbing. Registering six layers (one per
classification, `category: 'highlight'` so they group together in
`LayerPanel.tsx`) meant the feature needed zero new store, zero new HUD
component, and zero edits to `LayerPanel.tsx` — it already iterates
`getLayerDefinitions()` generically. It also came with a capability a
single mutually-exclusive picker wouldn't have: enabling two categories at
once (sovereign states *and* strategic regions, say) just works, because
that's already how independently-toggleable layers behave. Worth noticing
when a new feature's "obvious" first design (a dedicated store + control)
is actually reinventing a mechanism that already exists one directory over.

**`scene/PointerMarker.tsx` and `scene/countryEntries.ts` both got
extracted for the same reason, on the same day: a second consumer arrived
needing the exact same thing, not a similar thing.** `CategoryHighlightLayer.tsx`'s
sovereign-states highlight needed precisely the "raw country feature →
border/fill `BufferGeometry`" logic `ClaimsOverlayLayer.tsx`'s related-
country rendering already had inline — not almost the same, byte-for-byte
the same, just called from a different place. Same story for the marker:
`Globe.tsx`'s `CapitalMarker` and `ClaimsOverlayLayer.tsx`'s claimant/
parent marker had independently near-identical "dot + leader line + label"
implementations that had already drifted apart in their exact sizing
(0.009 vs. 0.014 dot radius, `RADIUS × 1.3` vs. `× 1.32` callout distance,
±9° vs. ±10° swing) before this session even started — which is itself
the evidence for extracting a shared component now rather than continuing
to patch two copies: two independent "make it smaller" edits would have
produced two independently-tuned-by-feel sizes, drifting a third time.
One shared `PointerMarker.tsx`, tuned once, used twice, can't do that.

**The "too big, comes out too far" complaint was resolved by comparing
values across the file, not by picking new numbers from scratch.** Read
both markers' actual constants before touching either
(`CapitalMarker`: dot 0.009, callout `RADIUS × 1.3`, swing ±9°;
`RelatedCountryMarker`: dot 0.014, callout `RADIUS × 1.32`, swing ±10°) —
both already near the upper end of what this app's own established
"small-entity leader-line callout" convention uses elsewhere
(`Countries.tsx`/`GeoEntities.tsx`'s `HoverLabel` goes out to
`RADIUS × 1.35` for country/entity *names*, which is a comparable
convention but wasn't part of this complaint and was left untouched — the
report was specifically about the claimant/capital markers, not every
leader-line callout in the app). New shared constants (dot 0.007, callout
`RADIUS × 1.1`, swing ±4°) are a genuine reduction across the board, not
just "smaller than whichever one was worse."

## 2026-07-21 — v3.2.0: teaching selectEntity() a third argument without teaching its three existing callers anything new

**The one place "purely additive" needed a real design decision, not just
new files.** Keyboard arrow-key navigation has to call the same
`selectEntity()` every other selection path uses — that's the whole point
of "keyboard and mouse selection must use the same underlying state" — but
every existing caller (`Countries.tsx`, `GeoEntities.tsx`, `SearchBar.tsx`)
was written assuming selecting something always opens the Intelligence
Panel, because pre-v3.2 that was simply true. Arrow-key browsing needs to
update the globe highlight and status bar on *every keypress* without
yanking the panel open each time (ENTER does that, deliberately, per the
spec). Two ways to reconcile this without touching any of the three
existing call sites: (a) give `selectEntity()` a new required parameter
and update all three anyway, or (b) make the new parameter optional with a
default that reproduces every existing caller's behavior exactly. Went
with (b) — `options?.openInspector` defaults to `true`, so
`selectEntity(resolved, direction)` (all three existing call sites,
unedited) behaves identically to before v3.2.0 existed. Verified by
grepping for every `selectEntity(` call site before considering this done,
not just reasoning about it.

**`openInspector: false` means "don't force it open," not "force it
closed."** First draft had the false branch set `inspectorOpen: false`
unconditionally — which would mean arrow-keying to a new entity while the
panel happened to already be open (say, from an earlier click) would slam
it shut on every keypress, actively fighting the user's own prior action.
Changed to `shouldOpen ? true : state.inspectorOpen` — `false` leaves
whatever was already there alone. Net effect: if the panel's closed,
arrow-key browsing stays closed (matches the spec — only ENTER opens it);
if it's already open, arrow-key browsing updates it live as you navigate,
which reads as a feature (a live preview while browsing) rather than
something that needed to be prevented.

**Reused `useCameraFlight.ts`/`useCameraReset.ts`'s exact spherical-camera
pattern for WASDQE instead of finding a new way to drive OrbitControls.**
Both existing hooks already manipulate the camera the only way this app
ever does: read `camera.position.clone().sub(target)` into a `Spherical`,
adjust theta/phi/radius, write back via `camera.position.copy(target).add
(offset)` + `controls.update()`. Three.js's `OrbitControls` doesn't expose
public rotate/zoom methods to call directly (only internal, underscore-
prefixed ones not meant for external use) — rather than reach for those,
`CameraController.ts`'s per-frame nudge is the same three-line pattern
`useCameraFlight`/`useCameraReset` already use, just applied every frame
instead of tweened between two fixed points. One consequence this pattern
gave for free: checking `controls.enabled` before nudging (the same flag
`useCameraFlight`/`useCameraReset` already set to `false` while a flight
owns the camera) means a held WASD key can never fight an in-progress
"FOCUS CAMERA" tween — no new coordination code needed, just reading a flag
that already existed for exactly this reason.

**A keydown listener that reads `useSelection()`/`useInspectorOpen()`
values needs a ref, or it dispatches against stale state.**
`useKeyboardController` attaches its `window.addEventListener` exactly
once (empty-deps `useEffect`, deliberately — re-attaching on every render
would mean the DOM listener count and the Set of held keys could drift).
But `InputManager`'s `onCommand` closure captures whatever `selected`/
`inspectorOpen` were *at the render that created it* — if the listener
call the exact function object from that one render forever, Escape would
keep testing against whatever the selection was when the app first
mounted. Standard fix, applied here: `useKeyboardController` stores the
callback in a ref, reassigned on every render (`onCommandRef.current =
onCommand`, a plain assignment, not inside an effect), and the
once-attached listener always calls `onCommandRef.current(...)` — always
the latest closure, without ever tearing down and re-creating the actual
DOM listener.

**Verified the directional algorithm against real geography before
trusting it, and found a pre-existing precision limit instead of a new
bug.** Couldn't import `SelectionController.ts` directly for testing — it
transitively pulls in `hud/selectionStore.ts`, which reads
`import.meta.env.DEV` (a Vite-only global `tsx` doesn't provide) — so
verified a standalone copy of the pure bearing/distance functions against
`countries-un193.json` instead. Fiji (sitting almost exactly on the
antimeridian) resolved sensibly in all four directions, confirming the
great-circle bearing formula handles ±180° wraparound correctly (a naive
`lng2 - lng1` would not have — see `countryGeometry.ts`'s ring-unwrapping
doc comment for the same underlying issue in a different context). Germany
returned Luxembourg for *both* "south" and "west," which looked wrong at
first — until checking `geometryToCentroid()` itself, whose own doc
comment already says "simple (non-area-weighted) centroid... not meant to
be a precise geographic centroid." The new algorithm is faithfully
reusing the same centroid every other consumer (hover labels, camera
flight targets, search) already relies on — inheriting its imprecision
is consistent behavior, not a new defect, and "fixing" `geometryToCentroid`
itself was out of scope (see the "do not rewrite existing functionality"
constraint this feature was built under). Flagged in `BACKLOG.md` instead
of silently accepted.

## 2026-07-21 — v3.1.5: the blue overlay was scoped to "claimant" when the real concept was "connected country"

**39 territory entries got real `claimedBy` data (v3.0.0-v3.1.4) without
anyone noticing the visualization only ever looked at `claimedBy`.** The
report that triggered this fix: select Curaçao, expect the Netherlands to
highlight the way China highlighted when Taiwan was selected — it didn't.
Curaçao has no `claimedBy` (it's an uncontested Netherlands dependency,
correctly modeled that way), so `useClaimantCountryIds` — which only ever
read `geoEntity.claimedBy` — had nothing to find. The bug wasn't in the
data (Curaçao's `parentEntity: Netherlands` was correct and had been since
v3.0.0) or even really in the overlay code (it did exactly what its name
said: show claimants) — it was a scope mismatch between what the feature
was named/built for ("claimant countries") and what a user reasonably
expects "the country connected to what I selected" to mean, which spans
both `parentEntity` and `claimedBy`. Worth remembering: a feature that
"does what it says" can still under-deliver if the name itself was scoped
narrower than the actual user need — the fix here was mostly a reframing
(one mechanism serving two relationship kinds, distinguished by a role
label) more than new logic.

**Gibraltar turned out to be a real test case for "a country can be both a
parent and a claimant of different entities, or even the same one."**
After adding Spain as a claimant (v3.1.4) on top of Gibraltar's existing
UK parent (v3.0.0), Gibraltar became the one entity in this dataset with
two *different* countries in two *different* roles simultaneously. Built
`useRelatedCountryRoles` to return `Map<countryId, Set<role>>` rather than
a plain `Set<countryId>` specifically so this case wouldn't need special-
casing — the same country appearing as both `parent` and `claimant` for
one entity (not represented anywhere currently, but structurally possible)
would just join both role labels on one marker instead of needing a second
data structure or a "which one wins" tiebreak. Verified with `tsx` against
the real registry before considering this done, same discipline as
v3.0.1/v3.1.4: Curaçao → Netherlands (parent only), Taiwan → China
(claimant only, unaffected regression check), Gibraltar → UK (parent) +
Spain (claimant) both rendered, Puerto Rico → USA (parent only, still no
claimant since it remains uncontested).

## 2026-07-21 — v3.1.4: verified every numeric id again before trusting a user-supplied correction list

**Re-ran the exact verification `LOGBOOK.md`'s v3.0.1 entry describes,
before touching any data.** That entry's whole point was: alpha-3 codes
("USA", "ESP") are not what this app's Country Registry actually keys on —
the raw ISO 3166-1 *numeric* code from the topology is, and assuming
otherwise shipped a real bug that made two overlay layers silently do
nothing for an entire version. This iteration added five new country
references (Spain, Mauritius, Madagascar, Israel, Cyprus) that had never
appeared in `geoEntities.ts` before — rather than trusting general
knowledge of ISO numeric codes, queried `public/geo/countries-un193.json`
directly the same way the v3.0.1 fix did, confirmed all five (and the
already-used Argentina/USA/Jamaica/Honduras/Nicaragua, to be sure nothing
had drifted) before writing a single `toCountry()` call. Cheap insurance
against repeating a bug that already had its own postmortem in this file.

**`dependency()`'s "uncontroversial" framing needed a correction, not just
a new parameter.** The helper's original doc comment described every
Territory it builds as having "no dispute" — true when it was written (the
40 entries it covered were all uncontested dependencies), false the moment
Gibraltar/Falklands/South Georgia/BIOT/French Southern & Antarctic Lands
needed a `claimedBy` list while keeping their single uncontested
administering parent. Fixed the comment alongside the code change, not
just the code: "who administers this" and "does anyone dispute it" are
independent facts (the same distinction `GeoEntity`'s own doc comment in
`data/types.ts` already draws between `administeredBy` and `claimedBy` for
every other entry) — a helper named for the common case shouldn't have a
comment that quietly asserts the common case is the only case.

**Nicaragua's Bajo Nuevo/Serranilla claims were not "possibly disputable
opinion" — they were superseded by name.** The 2012 ICJ judgment
(*Territorial and Maritime Dispute, Nicaragua v. Colombia*) is a specific,
citable ruling that resolved the exact claim this dataset had been
carrying since v3.0.0 as if still live. Removing Nicaragua (and Honduras,
per its own 1986 bilateral treaty with Colombia) and adding the US's
still-unrelinquished 1856 Guano Islands Act claim isn't a judgment call the
way Kosovo's `claimedBy: Serbia` or the Territory `parentEntity` additions
in v3.0.0 were (see that entry) — it's a correction against a specific
legal source, and the code comment above both entries now cites it by
name and year so the next person to touch this file doesn't have to take
it on faith either.

## 2026-07-21 — v3.1.3: "claimed by" and "claims" are supposed to be the same fact from two ends, and this dataset only ever writes one of them

**A GeoEntity's `claims` field is real infrastructure with zero real data
in it.** `data/types.ts`'s doc comment for `GeoEntity.claims` is explicit
that it's the inverse of `claimedBy` — "every entity THIS entity claims
sovereignty over" — and `LOGBOOK.md`'s own v3.0.0 entry already flagged
that "most entries in this dataset only populate `claimedBy`... `claims`
exists for the cases that do." What that entry didn't spell out: as of
v3.1.2, *no* entry populates `claims` — Taiwan claims Spratly Islands and
Scarborough Reef in every practical sense (both reefs list Taiwan in their
own `claimedBy`), but Taiwan's own `claims` array is `[]`. The first version
of `generateClaimsDoc.mjs`'s complete-roster rewrite read `entity.claims`
directly and printed "Claims: None" for Taiwan — technically accurate to
the field, factually wrong about the relationship. Caught by spot-checking
Taiwan's entry against what `ClaimsOverlayLayer.tsx` already does at
runtime (`useClaimRelatedEntityIds` scans `[...claimedBy, ...claims]`
together specifically because of this — see that file's comments), not by
assuming the raw field was the whole story.

**Fix: infer the missing direction instead of requiring the data to state
both.** Built `inferredClaimsByKey` — one pass over every entity's
`claimedBy`, inverted into "what does the claimant claim" — and union it
with each entity's explicit `claims` when rendering. Same general lesson as
`ClaimsOverlayLayer.tsx`'s own `useClaimRelatedEntityIds`/
`useClaimantCountryIds` split from v3.1.0: a bidirectional relationship
recorded on only one side needs the *reader* (whether that's a render
layer or a doc generator) to reconstruct the other side, not a hope that
every future data entry remembers to populate both fields symmetrically.
If `geoEntities.ts` ever does start populating `claims` directly, this
still works unchanged — the union just becomes redundant with itself,
not wrong.

## 2026-07-21 — v3.1.1: a generated doc still needs its own presentation layer, and why plain `node` can run one script but not the next

**Generating `CLAIMS.md` straight from `GeoEntityRelation.displayName`
almost shipped a register where seven Antarctic claimants all had the same
17-word section header.** `displayName` strings in `geoEntities.ts` are
written to read naturally inline in the Intelligence Panel's
"Claimed by: X, Y, Z" sentence — Antarctica's claimants all carry a
"(claim suspended under the Antarctic Treaty)" qualifier for exactly that
context, and Guantanamo Bay's Cuba entry carries "(disputes the lease's
continued legitimacy)" the same way. First pass at `generateClaimsDoc.mjs`
used `displayName` verbatim as both the inline text *and* the "By
claimant" section's `### heading` — correct for the former, noisy for the
latter (a heading repeated seven times differing only in which country
precedes an identical 8-word parenthetical isn't a scannable index). Fixed
with a `canonicalLabel()` step that strips a trailing parenthetical for
grouping/heading purposes only — the full annotated text still appears in
the "By disputed entity" section via the unmodified `formatRelation()`.
Same lesson as `data/countryProfiles.ts` vs. `data/types.ts`'s `Country`
(see that split's own reasoning in `CLAUDE.md`): one field written for one
presentation context doesn't automatically read well in a different one,
even when the underlying fact is identical.

**Why `buildEntityTopology.mjs` runs under plain `node` but
`generateClaimsDoc.mjs` needed `tsx`.** Both are `.mjs` scripts importing a
`.ts` module. The difference is what that module imports in turn:
`entityGeometryIds.ts` (read by `buildEntityTopology.mjs`) has zero
imports of its own — a leaf module, and Node's built-in TypeScript
stripping (stable by Node 24, this repo's runtime) only strips types, it
doesn't add bundler-style extension resolution. `geoEntities.ts` (needed
here, to read the live registry rather than re-deriving claim data by
hand) imports `./GeoEntityRegistry` and `../types` with no extension —
resolves fine under Vite/`tsx` (enhanced resolution, the same reason the
app itself never needs `.ts` suffixes in its own imports) but throws
`ERR_MODULE_NOT_FOUND` under plain `node`. Added `tsx` as a real
devDependency rather than continuing to reach for `npx --yes tsx`
ad hoc — that path only worked at all in earlier verification steps this
session because of network access this project's own CI/regeneration
shouldn't have to depend on.

## 2026-07-21 — v3.1.0: computeLineDistances() isn't a BufferGeometry method, a legend almost got hidden behind the panel it exists to explain, and "claimed" needed a mirror-image "claimant"

**The claims overlay only ever pointed one direction, because a Country
and a GeoEntity render through two unconnected systems.** First pass at
v3.1's dashed claims overlay (and, before that, v3.0's pulsing-color one)
only ever populated `claimRelatedIds` by scanning for `ref.type ===
'geo-entity'` — clicking China correctly flagged Taiwan/Spratly
Islands/Scarborough Reef, and it was tempting to call the overlay done
there, since that matches the v3 spec's own worked example exactly. But
selecting Taiwan showed nothing for China: `ref.type === 'country'`
relations were being silently filtered out of the same loop, because a
`Country` has no rendered presence in `scene/GeoEntities.tsx`'s geometry at
all — it's a completely different component (`Countries.tsx`), fetching a
completely different topology (`useCountryFeatures()`, not
`useGeoEntityFeatures()`). "Highlight the claimant" and "highlight the
claimed" look like the same problem from the data model's side
(`GeoEntityRelation` either way) but are NOT the same problem from the
rendering side — one target type has geometry sitting right there in the
same entry list, the other requires fetching an entirely separate feature
collection and building geometry from scratch. Fixed by giving
`ClaimsOverlayLayer.tsx` a second, independent sub-component
(`ClaimantCountriesOverlay`) that fetches country features directly and
renders on that geometry — and giving it an intentionally different visual
treatment (blue instead of magenta, a prominent fill covering the whole
country rather than a near-invisible tint, plus a labeled pulsing marker)
rather than just reusing `CLAIM_COLOR`, so "X claims Y" and "Y is claimed
by X" don't read as the identical fact rendered twice. General lesson,
worth remembering the next time a relationship field spans two
different entity kinds: check whether "the other end of this relationship"
is even representable in the renderer that's about to loop over it, not
just whether the data model can express the reference.

**`THREE.Line.prototype.computeLineDistances()` operates on an object
instance, not a geometry.** Reached for it expecting a `BufferGeometry`
method (the same shape as `computeVertexNormals()`, `computeBoundingBox()`,
etc.) — it isn't one. It lives on `Line` (and `LineSegments`, which extends
`Line` without overriding it), reads `this.geometry.attributes.position`,
and writes the `lineDistance` attribute back onto `this.geometry`. That's
awkward for this codebase's shape: `scene/geoEntityEntries.ts`'s
`buildGeoEntityEntries()` builds a plain `BufferGeometry` with no scene
object attached to it yet — `GeoEntities.tsx`, `ParentOverlayLayer.tsx`, and
`ClaimsOverlayLayer.tsx` each mount their own `<lineSegments>` from the same
shared geometry later, independently, so there's no single "the" Line
instance to call the method on even if timing allowed it. Ported the
algorithm itself (it's ~10 lines, verbatim from three.js's source) into a
standalone function operating directly on a `BufferGeometry`, called once
right after the border geometry is built — every entry is dash-ready before
any component ever sees it, and `LineBasicMaterial` (every other consumer)
silently ignores the extra attribute.

**The legend almost shipped in the one spot that hides it exactly when it's
needed.** First draft put `LegendPanel` at bottom-right, mirroring
`Telemetry.tsx`'s bottom-left placement for visual symmetry. Caught before
shipping: `hud/IntelligencePanel.tsx` is `fixed inset-y-0 right-0` at
`z-30` — it covers the *entire* right edge, top to bottom, for as long as
anything is selected, not just a corner. A legend explaining
selection/overlay colors is specifically most useful exactly when something
is selected — meaning bottom-right (or top-right, same problem) would be
covered by the one panel that's guaranteed to be open whenever the legend
had anything to say. Moved it to stack with `Telemetry.tsx` in a shared
bottom-left flex column instead (`App.tsx`), which meant pulling both
components' own `fixed bottom-* left-*` wrapper out into that shared
container — neither had to start hardcoding pixel offsets to stack above
the other, flexbox does it regardless of either one's actual rendered
height (which varies: `LegendPanel`'s row count depends on which overlay
layers are enabled). General lesson: before placing a new always-on HUD
element, check what covers that screen region under the state where the
element would actually be read, not just the empty/idle state it looks
fine in during a first pass.

## 2026-07-21 — v3.0.1: the overlays were architecturally correct and functionally inert, because of two id spaces that look identical

**The bug: every `EntityRef{type:'country', id:...}` in `geoEntities.ts`
used the wrong id space.** `Country.id` in this app is not ISO 3166-1
alpha-3 ("USA", "CHN") — it's whatever `scene/useCountryFeatures.ts`
registers straight off the topojson feature id (`String(f.id)`), which for
`world-atlas`'s source data is the ISO 3166-1 **numeric** code as a
zero-padded string ("840", "156"). Nothing in the country pipeline ever
remaps numeric to alpha-3 — `buildCountryTopology.mjs` only filters and
renames by *display name*, never touches `id`. `data/registry/geoEntities.ts`
was written using alpha-3 codes throughout (`toCountry('USA', ...)`,
`toCountry('CHN', ...)`, 27 codes across ~40 call sites) because alpha-3 is
the standard, human-readable convention — and because `data/types.ts`'s own
`Country.id` doc comment explicitly says "Convention: ISO 3166-1 alpha-3."
That comment describes the *intended* convention for a `Country` record's
own id; it does not describe what id a rendered country polygon actually
carries at runtime, and nothing forced those two to be checked against each
other before shipping.

**Why this didn't throw, warn, or fail typecheck.** `EntityRef.id` is `string`
— any string typechecks. `ParentOverlayLayer`/`ClaimsOverlayLayer` compare
`ref.id === selected.id` and simply get `false` for every comparison,
forever, which reads identically to "nothing here is related to the
selection" — the correct, silent, expected result for the overwhelming
majority of clicks (most countries have no dependencies and are claimed by
nobody). The bug was invisible in exactly the cases someone would casually
click to check the feature, and only detectable by clicking specifically
US/China/a claimed entity and noticing the *absence* of an overlay — the
same "confirmed by screenshot, not by a type error" shape as the
`TerritoryEntry` geometryId/entityId bug in v2.3.0's entry below. Worth
repeating the lesson from that entry here since it bit twice: comparing two
values that are "obviously" the same id space is exactly the kind of
assumption that needs an explicit check, not a glance at the type
signature — `string === string` compiles whether or not the two strings
came from compatible universes.

**How it was actually caught:** the user reported the overlays "aren't
actually implemented" after presumably clicking through the running app.
Rather than assume the fix was a missing `defaultEnabled: true` (Claims
Overlay does default off, and that's a real secondary gap — see below), the
id equality checks were traced end to end and verified against the
*compiled* topology (`public/geo/countries-un193.json`), not assumed from
the source alpha-3 codes — that's what surfaced the actual mismatch.
Verified the fix the same way: ran the real dataset through `tsx` (no
browser available this session) and confirmed selecting China's real id
(`"156"`) now resolves exactly the three entities the v3 spec's own example
names (Taiwan, Spratly Islands, Scarborough Reef), and selecting the US's
real id (`"840"`) resolves its 6 registered dependencies.

**The secondary gap, fixed at the same time:** `ClaimsOverlayLayer`
defaulted to `defaultEnabled: false`, reading the spec's "when enabled" as
"starts off." Changed to default-on — a toggle a first-time viewer has to
discover in the Layer Panel before the spec's own headline example (click
China, see Taiwan/Spratly flagged) becomes visible isn't "implemented," from
a user's perspective, even once the underlying logic is correct. The layer
is still a real toggle (switchable off in the Layer Panel like any other
layer) — only the starting state changed.

**Fix:** `ISO_ALPHA3_TO_NUMERIC`, a lookup table in `geoEntities.ts` scoped
to exactly the 27 country codes that file references, with `countryRef()`
resolving through it. Kept the alpha-3 codes at every call site rather than
rewriting ~40 lines to numeric codes directly — "USA"/"CHN" stay readable
for whoever edits this file next; only the one function that turns them
into an `EntityRef` needed to change. Throws on an unmapped code rather than
silently producing a broken ref again, so adding a 28th country reference
without extending the table fails loudly at module load instead of
compiling into another invisible no-op.

## 2026-07-21 — v3.0.0: one registry instead of five, and the judgment calls the spec left open

**Why one `GeoEntity` interface instead of five (`GeopoliticalEntity`,
`Territory`, `StrategicRegion`, `MaritimeFeature`, `GeographicRegion`), each
with their own registry.** The spec named five classifications and asked for
one `GeoEntityRegistry.ts` with `registerEntity`/`getEntity`/`getEntities`/
`getEntitiesByType`/`getRelatedEntities` — that function list only makes
sense over one registry, not five, since `getEntitiesByType` implies
filtering a single collection rather than picking which of five to call. The
alternative (mirroring `CountryRegistry`/`TerritoryRegistry` — a separate
file per kind, deliberately duplicated so one addition can't regress another,
per the v2.3.0 entry below) stops making sense once there are five kinds that
share one relationship shape: `parentEntity`/`administeredBy`/`claimedBy`/
`claims` apply identically to a disputed maritime feature and a Crown
dependency. Five interfaces would mean five near-identical copies of the same
four fields; one `GeoEntity` with a `type: GeoEntityType` discriminant is what
the spec's own registry shape was already implying.

**Every requested entity turned out to have real, standalone polygon
geometry in `world-atlas`'s 10m source** — including things that looked like
they might not (Guantanamo Bay, Baikonur, the Spratly Islands, the Cyprus UN
Buffer Zone). Checked this before writing any data by dumping every feature
id/name in the source topology rather than assuming. Eleven of the fifty-five
have no numeric ISO id (Kosovo and ten others) but are still separate named
features — matched by raw source name instead, at build time, and given a
stable synthetic id (their target `GeoEntityRegistry` id, stamped on before
the topology rebuild) so nothing downstream has to know which features
started out id-less. This meant the "some territories can't be geometrically
represented, they stay search-only" situation `TERRITORY_GEOMETRY_IDS`
documented for Crimea did NOT generalize to the new entity set — Crimea
remains the only geometry-less entity in v3, unchanged from pre-v3.

**Judgment calls the spec left ambiguous or silent on — flagged here rather
than guessed-and-hidden:**

- **Gibraltar** appears in the spec's Known Relationships section
  (`parentEntity: United Kingdom`) but not in its explicit Territory list.
  Added as a 40th Territory entry on the assumption this was an omission,
  not a deliberate exclusion — it has real source geometry and an
  unambiguous relationship, so leaving it out felt more likely to be wrong
  than including it. Trivial to remove (`src/data/registry/geoEntities.ts`,
  one `register(dependency(...))` call) if that assumption doesn't hold.
- **Crimea** isn't in the v3 spec's entity list at all, but existed in the
  pre-v3 dataset. Carried forward rather than dropped (removing working,
  previously-shipped functionality wasn't asked for), classified as
  `'territory'` for lack of a better fit among the five v3 types — it isn't
  a dependency, but none of the other four classifications (primary
  political significance / strategic-military / maritime / treaty-region)
  describe it better either.
- **Several parent relationships beyond the spec's explicit list** were
  added where uncontroversial and easily verified (Curaçao/Aruba/Sint
  Maarten → Netherlands, Åland → Finland, Norfolk Island/Heard & McDonald →
  Australia, Cook Islands/Niue → New Zealand) — the spec's Known
  Relationships section reads as "at least these," not "only these," and
  leaving 10 of 39 Territory entries with no parent at all seemed a worse
  default than filling in well-established facts.
- **Claimants for Bajo Nuevo Bank / Serranilla Bank** aren't in the spec at
  all (only Spratly Islands, Scarborough Reef, and Siachen Glacier have
  spec'd claimedBy lists). Added Colombia/Jamaica/Nicaragua/Honduras per
  well-documented real disputes, at `confidence: 'estimated'` like
  everything else in this dataset — flagged here specifically because this
  is the least-verified corner of the v3 data and the one most likely to
  need a correction from someone who actually knows the dispute.
- **"Claims overlay" hatching** is approximated with a distinct pulsing
  outline color + near-zero fill, not a true diagonal-hatch texture — native
  `LineBasicMaterial`/`MeshBasicMaterial` can't do that without a custom
  shader, which felt like scope the spec's "future-compatible... visualization
  layer" framing didn't ask for yet. The infrastructure (a real Layer Engine
  layer, real bidirectional claim data via `getRelatedEntities`) is there for
  a future pass to swap in a real hatch shader without touching the data
  model.

See `CHANGELOG.md`'s v3.0.0 entry for the full file-by-file breakdown.

## 2026-07-20 — v2.3.0: a shape's own id is not the same thing as what it means, and two ways that bit us in one afternoon

**The core bug: `TerritoryEntry` compared a geometry id to an entity id
because `Countries.tsx` never had to tell the two apart.** Mirroring
`Countries.tsx` for `Territories.tsx` meant copying `const isSelected =
selected?.id === entry.id` — correct for countries, where a rendered
polygon's own topojson feature id *is* the country's registry id, no
translation needed. `GeometryMap` (v2.2.0) exists specifically because that
assumption doesn't hold for territories: Taiwan's shape id is `"158"` (an
ISO numeric code), its entity id is `"taiwan"` (the `TerritoryRegistry`
slug), and `selectionStore`'s `selected.id` is always the *entity* id
(whatever `EntityResolver` resolved to), never the raw geometry id. So
`isSelected` silently evaluated to `false` for every territory, always —
the selected shape rendered with the same faint dimmed treatment as
everything else instead of the red "selected" highlight, and the bug
produced no error, no warning, nothing to grep for. It only became visible
by actually looking at a screenshot of a selected territory and noticing
the highlight wasn't there. Fixed by giving `TerritoryEntry` two ids —
`geometryId` for hover state and `GeometryMap` lookups, `entityId` for
comparison against `selected.id` — rather than the one `Countries.tsx`
gets away with. Worth remembering generally: when copying a pattern from
code where "the shape's id" and "the thing's id" happen to be the same
string, check whether that's a coincidence of the specific case or an
actual invariant — it was deliberately *not* an invariant here, that's the
entire reason `GeometryMap` exists, and the copy-paste re-introduced the
assumption it was built to remove.

**The second bug, found while screenshotting the first one: selecting the
Taiwan *territory* showed Taipei's capital marker — a country's UI
artifact leaking onto a territory selection.** `Globe.tsx`'s
`CapitalMarker` has always looked up `COUNTRY_PROFILES[selected.name]` by
name alone, no check on what kind of thing was selected. That was
harmless through v2.2.x because nothing named the same as a
`COUNTRY_PROFILES` entry could ever be selected except an actual country
— territories weren't independently selectable yet. `countryProfiles.ts`
happens to carry a `"Taiwan"` entry (ordinary illustrative country data,
written long before the Territory registry existed, with no knowledge of
it). The moment `Territories.tsx` made `selected.name === "Taiwan"` a real
possibility for a *Territory* selection, that name collision stopped being
theoretical and started rendering a live UI bug: Taipei's marker and
leader-line label, layered right on top of the territory's own hover
label, on a screenshot that was supposed to be showing off the highlight
fix. Fixed by gating on `selected.entity.kind === 'country'` before the
name lookup. The pattern connecting both bugs: neither was a bug in the
code that shipped it (`Countries.tsx`'s id comparison and
`CapitalMarker`'s name lookup were both completely correct for the only
case that could reach them at the time) — both were assumptions that
quietly stopped holding the instant a second, structurally-different case
started running through the same code path for the first time. That's the
specific risk worth watching for whenever "make X also work for
territories" is the task: not "does the new code have bugs" but "does
existing code near it have an unstated country-only assumption that new
code just made reachable."

**How the click-vs-drag testing actually got resolved.** Automated
verification for this version needed to click a real point on the
rendered globe, not just drive `selectEntity()` through search/devtools —
the whole point was proving the *mesh* is clickable. First attempts
(clicking a fixed screen offset computed from one earlier screenshot)
flaked intermittently, and turned out not to be an app bug at all: `Globe.
tsx` only freezes ambient auto-rotation while `selected != null`, so
closing the Intelligence panel via clearSelection() (rather than
resetView()) leaves the camera in place but *resumes* rotation, drifting
the just-tested shape out from under a fixed pixel within a second or two.
Separately, the exact resting camera angle after a search-triggered flight
varies run to run by a degree or two, because ambient rotation keeps
accumulating for however long the test script takes to get from page load
to clicking the search result — real wall-clock timing, not seeded or
deterministic. Fixed the *test*, not the app: keep something selected
(freezing rotation) for the whole interaction sequence, and locate the
target by spiraling outward from screen center checking the canvas cursor
style, rather than trusting one hardcoded offset. Worth remembering for
any future test against this globe: never assume a screen position stays
valid across more than one action unless something is currently selected.

## 2026-07-19 — v2.2.4: two "unimported by design" datasets collided the moment one of them stopped being unimported

**Search needing real, named territory results (China/Taiwan/Puerto
Rico/Crimea/Western Sahara) forced a decision every prior version had
deferred: something has to actually load territory data into the running
app.** Every version since v2.1.2 kept `exampleTerritories.ts` explicitly
unimported — proving the schema without taking an implicit editorial
position by shipping specific disputed-territory data live. That constraint
doesn't disappear just because search needs data to return; it means the
example file still isn't the answer. `data/registry/territories.ts` is a
new, separate "real" dataset (same three disputed entries, reworded
slightly, plus Puerto Rico as a genuinely uncontroversial fourth) that *is*
wired in, via a side-effect import in `data/index.ts`. The distinction is
about what's promised, not what's technically true: `exampleTerritories.ts`
was always documented as "not authoritative, not this project's position";
`territories.ts` inherits that same caveat in its own provenance data, it
just also happens to be the thing the running app actually shows. Whether
that's a real distinction or a fig leaf is worth being honest about — the
data is nearly identical. What changed is that shipping *something* live
was no longer optional once a feature (search) needed to return it.

**This exact collision — two independently-reasonable "unimported by
design" decisions turning into a live bug the moment one stopped being
true — is worth a specific callout.** v2.2.3's `__debugSelectTerritory`
hook imported `exampleTerritories.ts` to guarantee something was
registered before letting you select it, reasoned about as safe because
*nothing else* registered territories at the time. The moment
`territories.ts` started registering the same ids for real, that
assumption silently broke: both modules ran on every dev page load,
`exampleTerritories.ts`'s `registerTerritory()` calls have no try/catch
(never needed one — it was supposed to be the only registrant), and the
second one to run threw an uncaught "already registered" error into the
console on every single page load. tsc and oxlint both stayed clean
through this; it only showed up as a `pageerror` during live Playwright
verification. Fixed by dropping the `exampleTerritories.ts` import from the
hook entirely (real data covers the same ids now, so nothing needs it) —
but the general lesson is the sharper one: an "unimported by design" file
is an implicit dependency of anything that *does* import it, and a note in
that file's own docstring doesn't warn the next person adding a second,
independent import of the same underlying ids. Grepping for existing
importers of a thing you're about to duplicate the effect of — not just
reading its docstring — is the actual check.

## 2026-07-19 — v2.2.3: the verification hook stayed, on purpose

**The user asked "i can't see the hud and territory changes at all in my
local host browser" — and they were right, by design.** Two different
things were being reported as one. Country cards were an explicit
pixel-identical requirement in v2.2.2, so there is genuinely nothing new
to notice there. Territory cards are new, but every version from v2.1.2
onward deliberately kept territories disconnected from real interaction
("do not connect visualization yet," "do not add highlighting," "do not
modify rendering behavior yet") — no territory has clickable geometry, and
the example data files are never imported by the running app. So a normal
user clicking around the live globe was never going to hit a Territory
card. The only place it had ever rendered was in a screenshot from a debug
hook that was then reverted.

**Decided to keep a version of that hook permanently, dev-only, rather
than either reverting it again or building real territory geometry.**
Building real clickable geometry for Taiwan/Crimea/Western Sahara is a
meaningfully larger task (they aren't part of the rendered UN-193 country
set, and Crimea has no standalone polygon in the source data at all) and
wasn't what was being asked — the user wanted to *see the existing work*,
not a new feature. `window.__debugSelectTerritory(id)` in
`hud/selectionStore.ts`, gated by `import.meta.env.DEV`, gives a reliable
way to do that from the browser console without hitting the module-
identity trap described below, and costs nothing in production since Vite
statically eliminates the dead branch. Worth remembering: a verification
hook that answers "how would anyone actually confirm this without a test
framework" is sometimes worth productizing as a permanent dev affordance,
not just a disposable scaffold — especially for a feature that has no
other way to be observed yet.

## 2026-07-19 — v2.2.2: Entity-based Intelligence HUD, and how to verify a panel with no test framework

**Verifying the Territory card was harder than expected, and the first
approach silently failed.** Tried driving the live app by dynamically
`import()`-ing `selectionStore.ts` from inside `page.evaluate()` and
calling `selectEntity()` on the result. It ran without error and returned
a correctly-resolved territory — but the panel never updated. The likely
cause: a dynamic `import()` injected into the page from outside Vite's own
transform pipeline doesn't reliably resolve to the *same* module instance
the already-mounted React tree is subscribed to (module identity is
URL-keyed, and there's no guarantee the ad hoc path matches Vite's internal
resolution exactly) — so the call almost certainly updated a second,
orphaned copy of the store's `state`/`listeners` that nothing was
listening to. Fixed by temporarily adding a debug hook (`window.
__debugSelectEntity = selectEntity`, guarded by `import.meta.env.DEV`)
*inside* `selectionStore.ts` itself, guaranteeing the call hits the exact
singleton the app uses — then reverted it immediately after confirming
the screenshot, before committing. `git status`/`git diff` after reverting
showed the file byte-identical to before, confirming no debug residue
shipped. Worth remembering next time something needs to be forced into a
running app's state for a screenshot: reach for a temporary hook *inside*
the real module, not a fresh import from outside it.

**Why Territory cards omit CONTROLLER/CLAIMANTS individually instead of
falling back to one "no data" message.** `Territory.status` is a required
field, so anything that resolves as a territory at all always has at least
a Political Status to show — there's no realistic "this territory has
literally nothing to display" case the way an unprofiled country has.
`controllingAuthorities`/`claimants` being empty arrays is the actual
"nothing here" case, and it's per-field, so the omission is per-row
(matching "if no territory fields exist, gracefully omit them" literally)
rather than an all-or-nothing panel-level fallback.

**How this generalizes to a future entity kind (organization, conflict,
infrastructure, ...).** The dispatch in `IntelligencePanel.tsx` is a
two-way check on `selected.entity.kind` — deliberately not a registry/
plugin system like the Layer Engine's (the task said not to touch that,
and two cases don't justify one anyway; see "three similar lines is better
than a premature abstraction"). Adding a third kind means: extend
`ResolvedEntity`'s union in `entities/types.ts`, write one more
`XDetails({ x: X })` component following the same shape as `CountryDetails`/
`TerritoryDetails` (reuse `DataRow`, gracefully omit missing fields), and
add one more arm to the panel's kind check. Nothing about the panel's
outer structure (header, FOCUS CAMERA, close button, the pending-sections
footer) changes — only the middle section swaps.

## 2026-07-19 — v2.2.1: wiring selection to Entity Resolution — the empty-registry problem

**The Country Registry being empty would have silently broken every single
country selection the moment the click handler started calling
`resolveEntity()`.** This was the biggest risk in this version and almost
got missed: v2.1.1 through v2.2.0 built `CountryRegistry`, `EntityResolver`,
and `GeometryMap`, but nothing had ever actually called `registerCountry()`
with real data — `data/countries/countries.json` is still an empty `[]`
(see v2.1's LOGBOOK entry: populating it was explicitly deferred). If
`Countries.tsx`'s click handler had switched to `resolveEntity(id)` without
first making sure the registry actually had all 193 countries in it, every
click would have resolved to `undefined` and (depending on the fallback
logic) either selected nothing or silently regressed to synthesized,
data-less entities — a direct violation of "preserve existing country
functionality," the task's first requirement. Caught this by tracing
through what `resolveEntity` would actually do against the registry's real
(empty) state before writing the click handler, not after.

**Fix: `useCountryFeatures.ts` now registers every fetched feature into the
Country Registry, in the same `.then()` callback that already sets
`features`.** Considered doing this bootstrap in `Countries.tsx` instead
(a `useEffect` on mount), but `useCountryFeatures` is the actual singleton
source of truth (`SearchBar`/`CommandBar`/`Countries` all read from it) and
already runs its population logic exactly once, guarded by the existing
`fetchStarted` flag — piggybacking on that guarantee is more reliable than
adding a second, independent "run once" mechanism in a component that
isn't even the only consumer of the feature list.

**Why `SelectedEntity` denormalizes `id`/`name` instead of consumers
reading `entity.id`/`entity.name`.** Could have required
`IntelligencePanel.tsx` to change `selected.name` to `selected.entity.name`
— a small, mechanical, three-line diff. Chose not to, specifically because
the task said "do not redesign the HUD yet," and even a one-line property
path change is still a change to a file the task asked to leave alone.
Denormalizing costs a small amount of duplication (`id`/`name` exist at two
levels of the object); the payoff is `IntelligencePanel.tsx`,
`Countries.tsx`'s highlight comparisons, `Globe.tsx`'s `CapitalMarker`, and
`useCameraFlight.ts` all needed exactly zero changes, verified by `git
status` showing only the three files that actually needed to change.

**Why `selectCountry()` still exists, unchanged in signature, instead of
updating `SearchBar.tsx` to call `selectEntity()` directly.** Same
reasoning as above, applied to "do not change search": `SearchBar.tsx`
only ever finds countries (it searches the rendered country list;
territories were never in that list), so there was no *behavioral* reason
it needed to change. Kept it calling the exact same function with the
exact same signature, and moved the entity-resolution logic *inside*
`selectCountry()` instead — the compatibility wrapper absorbs the
migration so the search code doesn't have to know it happened.

## 2026-07-19 — v2.2.0: Geometry Map, and Crimea has no polygon

**Crimea does not exist as a standalone feature in Natural Earth's country
data, at any resolution this project has touched.** Went looking for a real
geometry id to use for Crimea's placeholder mapping, the same way Taiwan
(158) and Western Sahara (732) have real ISO 3166-1 numeric ids in the raw
10m source. There isn't one — Crimea is geometrically part of Ukraine's
polygon in this data, not a separately-clickable shape. This is a genuinely
useful thing to have discovered now rather than when someone tries to
actually make Crimea selectable: representing it as its own clickable
region will eventually need either a hand-authored sub-polygon clipped out
of Ukraine's border, or a point-in-region test layered on top of the
existing polygon — not just a registry entry. `GeometryMap` doesn't solve
this (a synthetic placeholder id stands in for now, clearly labeled as
such); it just means the *next* piece of work in this direction has a known
shape instead of being a surprise.

**Why `getEntityForGeometry` resolves all the way to a `ResolvedEntity`
instead of stopping at the entity id.** Could have kept `GeometryMap`
narrowly scoped to "geometry id -> entity id" and made callers chain
`resolveEntity()` themselves. Didn't, because the whole point of this
version (per the goal: prepare the globe for independent territory
selection) is that a future click handler should be able to ask one
question — "what entity does this polygon represent, if any" — and get one
answer. Splitting that into two calls a consumer has to remember to chain
would just relocate the "does this caller know about both registries"
problem `EntityResolver` already solved in v2.1.3, one level up.

**Why `registerGeometryMapping` throws on a duplicate, matching
`CountryRegistry`/`TerritoryRegistry` rather than reconsidering the
convention.** No new reasoning here beyond what's already in the v2.1.1
entry — kept for consistency, since two entities claiming the same polygon
id is exactly the same *kind* of bug as two data sources disagreeing about
a country id, and there's still no benign (HMR-like) reason for a
legitimate duplicate to occur.

## 2026-07-19 — v2.1.3: Entity Resolution layer

**`GeopoliticalEntity` is deliberately just the fields Country and Territory
already both have — no changes to either.** First instinct was to add a
discriminant field (something like `entityKind`) directly to `Country` and
`Territory` in `data/types.ts`, so they'd formally `extends
GeopoliticalEntity`. Decided against it: those two interfaces were already
revised twice this week (v2.1's initial shape, v2.1.2's control/claims
split), and this version's actual job is the resolution layer, not another
schema change. TypeScript's structural typing means `GeopoliticalEntity`
containing only `id`/`name`/`aliases`/`provenance` is satisfied by both
types exactly as they stand today — the interface describes their existing
common ground rather than asking them to grow into it. The discriminant
(`kind`) and the normalized `location` live on `ResolvedEntity` instead,
which `EntityResolver` constructs — so the "unification" happens at
resolution time, not by mutating the source schemas.

**Why `resolveEntity`/`resolveCountry`/`resolveTerritory` return `undefined`
for a miss instead of throwing.** `CountryRegistry.registerCountry()` and
`TerritoryRegistry.registerTerritory()` throw on a *duplicate* registration
because that's a real bug (two sources disagreeing about one id).
Resolution is different: "this id isn't a country" is an entirely normal,
expected outcome for `resolveCountry()` when checking an id that turns out
to be a territory (or vice versa, or neither) — `resolveEntity()`'s whole
implementation is `resolveCountry(id) ?? resolveTerritory(id)`, which only
works cleanly if a miss is a value, not an exception.

**Why this isn't wired into `scene/Countries.tsx`'s click handler yet, even
though "resolve a clicked polygon" is literally the module's stated
purpose.** Explicitly out of scope for this version — the task was the
resolution *seam*, not changing what a click does. Wiring it in means
`Countries.tsx`'s `handlePointerUp` would need to look up the clicked
polygon's id through `resolveEntity()` and branch on `.kind` before calling
`selectCountry()` (which — see `selectionStore.ts` — is currently
country-shaped: `id`/`name`/`direction`, no concept of "this is a
territory"). That's a real, deliberate design decision about how
territory selection should work in the HUD/selection model, not something
to decide as a side effect of adding a resolver.

## 2026-07-19 — v2.1.2: Territory Registry, and separating control from claims

**Why `controllingAuthorities` and `claimants` are separate fields instead of
one field with a type flag.** The original v2.1 `Territory` design had a
single `claimants: TerritoryClaimant[]` list where `claimType` could be
`'de-facto-control'` alongside `'recognized-sovereign'`/`'disputed-claim'`/
`'historical-claim'` — i.e., control was modeled as *one kind of claim*.
Working through the Taiwan/Crimea/Western Sahara examples exposed why that's
the wrong shape: control and claimed sovereignty are answers to two
different questions ("who runs this place" vs. "who says they own it") that
routinely disagree — Russia controls Crimea; that is a separate fact from
whether that control is internationally recognized as legitimate, and the
overwhelming majority of claimants/recognition disagree with it. Modeling
control as a *kind of claim* implicitly encodes an assumption ("control is
itself a claim, on the same axis as recognized sovereignty") that isn't
neutral — it flattens two independent facts onto one scale. Splitting them
into `controllingAuthorities` and `claimants` means a consumer reads two
separate lists and draws its own conclusions (or, more likely, just renders
both) instead of this data model pre-deciding how they relate.

**Why `controllingAuthorities` is a list, not a single value.** Almost
modeled it as `controllingAuthority: ControllingAuthority | null` (singular)
before writing the Western Sahara example, where it became obvious that's
wrong: Morocco and the Polisario Front/SADR each genuinely administer part
of the territory, split by a berm. A singular field would have forced
picking one, which is exactly the "single political interpretation" this
version was asked not to force. Added `extent` as free-text prose (not a
percentage) for the same reason `Conflict.severity` uses a coarse band
instead of a casualty count — precise proportions are themselves usually
contested, and a fake-precise number would just relocate the same problem.

**Why `ControllingAuthority`/`TerritoryClaimant` both take an optional
`ref` plus a required `displayName`, instead of always requiring a
`Country` reference.** Taiwan's controlling authority is its own
government, which isn't a registered UN-member `Country` in this dataset
(see `unMembers.ts` — the app's country data is deliberately scoped to the
193 UN members). Western Sahara's second controlling authority (the
Polisario Front/SADR) has the same problem. Requiring `ref` would make
these — arguably the *most* important examples for this schema to handle
correctly — unrepresentable. This mirrors `ConflictParticipant`'s existing
`ref?`/`displayName?` shape from v2.1, just with `displayName` made
required here since (unlike a conflict participant, which is at least
usually a country) an unregistered claimant/administrator is closer to the
common case for disputed territories than the exception.

**Why the example territories live in an unimported file rather than in
`territories.json`.** `territories.json` is meant to eventually hold a real,
sourced dataset — populating it with three illustrative, admittedly-
simplified examples would make it ambiguous later whether the file's
contents are "the real data" or "worked examples," especially since JSON
can't hold the neutrality caveats these specific examples need inline.
Keeping them in a `.ts` file that's never imported by the app gets the
worked-example value (and lets `tsc` type-check them, which a JSON file
wouldn't) without that ambiguity. Verified they actually register
correctly (all three, no throw, `western-sahara` shows both controlling
authorities) by running the module directly — see the file for the import
line that would wire it in, which nothing currently uses.

## 2026-07-19 — v2.1.1: Country Registry

**Duplicate registration throws here, unlike the Layer Registry's warn-and-
overwrite.** Copied the Layer Registry's shape almost exactly, but changed
this one behavior on purpose. Layer re-registration is a normal, harmless
occurrence (Vite HMR re-executing a placeholder module on save) where
overwriting-with-a-warning is the right call. A duplicate *country*
registration has no equivalent benign cause yet — nothing auto-registers
countries at all right now, so the only way to hit this is two data sources
genuinely disagreeing about the same id, which is a real bug worth stopping
on rather than silently picking whichever one happened to register last.
If a future dynamic-loading system needs idempotent re-registration (a live
refresh re-fetching the same country), that's on the loader to handle
explicitly (check-then-register, or `removeCountry()` first) — the registry
itself stays strict.

**The registry doesn't import `countries.json`.** Deliberately left the
"populate the registry from the JSON file" step undone here, even though
`countries.json` already exists (from v2.1) and importing it would have
been one line. Two reasons: first, it's still an empty array, so wiring it
up right now accomplishes nothing observable — there's nothing to verify
against. Second, and more importantly, baking a specific data source into
the registry module would undercut the actual point of this version ("query
geopolitical entities without knowing where the data comes from") — the
registry is supposed to be the stable seam a future loader plugs into, not
itself coupled to one particular loading strategy. Whatever seeds it later
(a JSON loader, an API-backed Data Engine, both) is a separate, deliberate
piece of work, the same way `layers/placeholders/index.ts` — not
`layerRegistry.ts` — is what actually knows which layers exist.

## 2026-07-19 — v2.1: Data architecture foundations

**Why this is v2.1, not v3.0.** By the changelog's own rule, "a new data
layer" is listed as a new-major-version example — this looked like v3.0
material at first pass. Decided against it: v3.0 (or whichever major is
next) should be a *shippable* new capability, the same way v2.0's Layer
Engine wasn't just types-on-paper but a working, wired-in mount/unmount
system with a HUD toggle. This is one step earlier than that — schema with
nothing populated and nothing reading it — so it's a point release under
v2, not its own major version. Worth naming explicitly since "when does
prep work get its own major version" will come up again.

**Numeric population/GDP instead of the formatted strings `countryProfiles.ts`
uses.** That file stores `"335 Million"` / `"$27.4 Trillion"` because it only
ever feeds directly into the IntelligencePanel's text display. This new
`Country` type is meant for layers that will *compute* with the data —
sort by population, threshold by GDP, choose a marker size — so it stores
plain numbers and leaves formatting to whatever eventually displays them.
Deliberately did not attempt to merge or migrate `countryProfiles.ts` onto
this — that's a real decision (does the intelligence panel become a
consumer of this data, or stay independent?) that shouldn't be made as a
side effect of adding an unrelated schema.

**`EntityRef` is `{ type, id }`, not a bare string id.** Territory ids and
country ids aren't drawn from a shared namespace (countries use ISO
3166-1 alpha-3; territories use ad hoc slugs, since no equivalent standard
covers disputed/dependent regions) — nothing currently guarantees they
can't collide, and a consumer resolving a `Conflict`'s participant or a
`Relationship`'s party needs to know which collection to look in regardless.
Cheap to add now; the alternative (a bare string, disambiguated by
convention or by checking both collections) is the kind of implicit
contract that's easy to get subtly wrong once more than one person/session
is writing data against it.

**Category-shaped fields (`Country.region`, `Territory.status`, etc.) stay
open strings where there's no fixed real-world enumeration.** Same
reasoning as the Layer Engine's `category` field (see the v2.0 entry
below): a closed union means every future region/status value edits a type
file it has no other reason to touch. Where the set of values genuinely
*is* fixed and small (`ConflictParticipant.role`, `Relationship.directionality`)
a union is still used — the distinction is whether new values are expected
over time, not a blanket rule either way.

**Conflict data deliberately has no casualty/statistical fields.** Added a
coarse `severity: 'low' | 'medium' | 'high' | 'unknown'` band instead of
anything numeric. This dataset has no editorial process behind it yet and
ships empty — the same caution the project already applied to
IntelligencePanel's Military/Economy/Diplomacy placeholder sections
("Awaiting data feed" rather than fabricated assessments) extends to not
even shaping a field that would invite a future contributor to casually
fill in sensitive numbers without one.

## 2026-07-19 — v2.0: Layer Engine architecture

**Why split Registry, Store, Manager, and Engine into four pieces instead of
one file.** They change for different reasons and at different rates: the
Registry is a static catalog (what layers *exist*, populated once at import
time); the Store is runtime state (what's *enabled right now*, changes on
every toggle); the Manager is rendering/lifecycle logic (how enabled layers
actually get mounted/unmounted/isolated); the Engine is the public seam
(`Globe.tsx`'s only integration point). Collapsing these would work today
with three placeholder layers, but the whole point of this version is
future engines (Country, Relationship, Intelligence, Data, Timeline) being
able to register layers without caring how mounting/toggling works — that
requires the contract (Registry) to stay decoupled from the mechanism
(Manager).

**Category is a free-form string, not a closed union.** First draft used a
`LayerCategory` union (`'geography' | 'infrastructure' | 'conflict' | ...`)
with a `CATEGORY_LABELS` lookup table in `LayerPanel.tsx`. That meant every
future engine introducing a new grouping (a Timeline Engine's layers might
want a "temporal" category, say) would have to edit a HUD file it has no
other reason to touch — exactly the coupling this version exists to remove.
Switched to a plain string, displayed as-is (uppercased) in the panel. Costs
autocomplete/typo-safety on the category field; worth it for not needing to
touch `LayerPanel.tsx` to add a category.

**Registration happens as an import side effect, not an explicit call from
some central setup function.** A layer module calls `registerLayer()` at its
own top level, and the only thing that "installs" it is one import line in
`placeholders/index.ts`. This only works because ES module evaluation runs
the entire import graph before React renders anything — so as long as
*something* reachable from `main.tsx` imports the barrel (`src/layers/index.ts`,
which imports `LayerEngine.tsx`, which imports `placeholders/`), registration
is guaranteed complete before any component that reads the registry actually
renders, regardless of which file happens to import which first. Documented
this explicitly in `CLAUDE.md` because it's the kind of thing that looks like
a race condition until you think through module evaluation order.

**Per-layer error boundaries, even though v2.0 has no real layers yet.** Added
`LayerErrorBoundary` (a class component — no hook equivalent exists) wrapping
each mounted layer individually. Not strictly required for three placeholder
markers that can't fail, but "future layers should be addable without
modifying Globe.tsx" implies those future layers (live APIs, databases,
whoever writes them) shouldn't be able to take the whole globe down if they
have a bug. Cheap to add now, much more annoying to retrofit once several
real layers depend on the current no-isolation behavior.

**`LayerPanel.tsx` lives in `hud/`, not `layers/`.** Everything else in the
Layer Engine lives together in `src/layers/` (types, registry, store,
manager, engine), but the toggle UI follows the existing rule that all
DOM/Tailwind HUD panels live in `hud/` (see `CLAUDE.md`'s "Two-layer split")
and import whatever scene-side state they need — `LayerPanel.tsx` imports
from `'../layers'` the same way `SettingsPanel.tsx` imports from
`'./settingsStore'`. Kept the engine's own directory scene-only rather than
mixing HUD components into it.

**Only three placeholder layers, not one per forbidden topic.** The spec
listed a long list of things not to build (terrain, rivers, military bases,
hospitals, oil fields, ports, airports, conflict visualization, relationship
arcs, live APIs, ...). Rather than one placeholder per item, built three
spanning distinct categories (geography/terrain, infrastructure, conflict) —
enough to prove the registry groups by category correctly and that multiple
layers can be enabled simultaneously without interference, without padding
the placeholder set past what's needed to validate the architecture.

## 2026-07-18 — Initial build session

**Antimeridian triangulation bug (Russia, and any country crossing ±180°).**
`earcut` triangulates in flat lng/lat space. A ring that crosses the
antimeridian (Russia's Far East, Fiji) alternates between longitudes near
+180 and -180; without unwrapping, earcut reads that as a polygon spanning
the *entire* globe and produces garbage triangles. Confirmed with
`earcut.deviation()`: 1.85 (badly wrong) before a fix, ~0 after. Fix: shift
each ring's longitudes by ±360° increments so consecutive points stay within
180° of each other, before triangulation, before border-line projection, and
before centroid calculation. See `unwrapRingLongitudes`/`unwrapPolygonRings`
in `countryGeometry.ts`.

**Click-through to the wrong hemisphere.** Country fill meshes used
`DoubleSide`. When a pointer ray missed every near-hemisphere country (e.g. a
gap over open ocean at low simplification), it would keep going through the
globe and hit a *different* country's back-facing triangles on the far side —
so a click could select a country nowhere near the cursor. Fix: `FrontSide`
only. Verified the fix wouldn't just make everything unclickable by checking
triangle winding direction first (57/59 sample triangles outward-facing,
confirming normals point the right way for `FrontSide` to work).

**Duplicate feature IDs collided three countries into one.** Kosovo, N.
Cyprus, and Somaliland all have no numeric `id` in the source topology.
`String(f.id)` gave all three the literal string `"undefined"` — they
compared equal for selection purposes and shared a React key, so selecting
one would sometimes visibly select/highlight another. Fix: fall back to
`` `feature-${index}` `` (always unique) instead of trusting `String(f.id)`
alone. Worth checking for this pattern anywhere else features get keyed by id.

**"All 193 UN members" needed the 10m dataset, not 110m/50m.** world-atlas's
pre-baked lower resolutions silently drop several small member states as
separate polygons entirely (Malta, Singapore, Nauru, Tuvalu, Marshall
Islands, ...) — they're too small to survive that level of simplification.
Had to start from full 10m detail and do our own filtering + simplification
in `scripts/buildCountryTopology.mjs` to get all 193 without losing any.

**Rebuilding a topology without quantization makes it *bigger*, not smaller.**
First attempt at `buildCountryTopology.mjs`: filter to 193 features, rebuild
via `topojson-server`'s `topology()`, simplify, write out — result was 5.9MB,
*larger* than the original 3.6MB 10m source. Two things needed fixing:
(1) `topology()` needs an explicit quantization argument or it emits raw
floating-point coordinates instead of the source's delta-encoded integers;
(2) `presimplify()` strips delta-encoding entirely to compute simplification
weights, and `simplify()` doesn't restore it — the output has to be
re-quantized afterward (`topojson-client`'s `quantize()`) or it's stored as
full-precision floats. Final result: 1.3MB, correctly smaller.

**The real performance bottleneck was draw call count, not vertex density.**
After switching to the UN-193 dataset at full 10m detail, the app dropped to
~25fps. First fix (coastline simplification via the quantization work above,
plus disabling antialiasing/lowering `dpr`) helped but didn't solve it.
Actually profiling draw calls (instrumenting `drawElements`/`drawArrays` on
the WebGL context) found ~5,700 draw calls *per frame* — because countries
with multiple islands/holes/exclaves were rendering one `<Line>`/`<mesh>` per
ring/polygon: 193 countries produced 3,625 border-line objects + 3,609
fill-mesh objects. Merging each country's rings into one `lineSegments` and
its polygons into one `mesh` cut that to 386 objects total and fixed the
frame rate. Lesson: profile draw calls before assuming vertex/triangle count
is the bottleneck at this kind of object-count scale. Tradeoff taken: native
`LineBasicMaterial` ignores `linewidth` on essentially every platform, so
border hover/select emphasis lost its thickness cue and relies on
color/opacity only now.

**`frameloop="never"` + manual `advance()` needs seconds, not milliseconds.**
Added a hard 60fps cap by disabling R3F's own render loop and driving it
manually via `advance(timestamp)` on a throttled `requestAnimationFrame`.
Passed the raw rAF timestamp (milliseconds) straight through — `advance()`
feeds it directly into `state.clock.elapsedTime`, which Three.js's `Clock`
(and everything that reads `delta` from it: ambient rotation, OrbitControls
autoRotate/damping, camera flights) tracks in seconds. Every computed delta
came out ~1000x too large, and the globe spun wildly. Fix: `advance(time /
1000)`.

**`Html`'s `occlude` prop occludes against everything by default, not just
what you'd expect.** Water body labels used `occlude` to hide themselves on
the far side of the globe, but with no ref array it raycasts the whole scene
— including the atmosphere glow shells, which sit in front of every label
regardless of which hemisphere it's on. Result: no water labels ever showed,
on either side. Fix: `occlude={[coreSphereRef]}`, occluding against
specifically the core sphere rather than the whole scene graph.

**Capital markers and country-name labels can land on top of each other.**
A country's capital is often close to its geographic centroid — exactly
where the country-name hover label anchors. A purely radial leader-line
callout for the capital put both labels in nearly the same screen position
at normal zoom. Fix: offset the capital's callout diagonally (shift lat/lng,
not just push the radius out) so the two leader lines visibly diverge.
