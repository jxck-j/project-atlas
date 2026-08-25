# Project Atlas — Intelligence Engine Scoring Design

**Status:** Core scoring rules locked for v1 (Military — fully specified, multi-source;
Economy — sourcing identified, formula pending revision against the new normalization/
confidence model below). Technology/Diplomacy sourcing identified but weighting and
confidence-model alignment deferred — not needed until those categories are scheduled.
**Owner:** J
**Related backlog item:** "Intelligence Engine" (currently: empty chrome, no score field in data model)



---

## 1. Why this doc exists

The five status bars (Military, Economy, Diplomacy, Technology, Current Status) currently render as
placeholder chrome — flat track, em-dash, "no assessment data is currently sourced." That's a deliberate
policy, not a bug: inventing a "72% military strength" number with no real basis behind it would present
as intelligence when it isn't, which is a bad look for a defense-context demo specifically.

This doc is the design pass promised by that policy: decide, per category, whether a defensible score is
even possible, and if so, from what sources and what formula — before any code gets written.

---

## 2. Governing principles

These apply to every category below. If a proposed metric violates one of these, it gets cut or demoted
to "not scored," not fudged into fitting.

1. **Sourced or unscored.** Every score must trace to a named, public, citable dataset. No proxy invented
   because it "feels right."
2. **Salience ≠ capability.** A country's most *recently reported* achievement (a viral drone, a new EV
   model) is not evidence of aggregate capacity in that domain. Composite, multi-sector indices are
   preferred over any single headline-driven data point, precisely because active conflict or a state
   industrial push will always make a country look artificially dominant in the metric versus its actual
   underlying base.
3. **Institutions, not individuals.** No metric may be a referendum on a sitting leader's popularity,
   personality, or conduct. "Diplomacy" measures a state's institutional track record (treaties, sanctions
   coalitions, mediation outcomes), not whether the current president is well-liked. This also makes scores
   stable across election cycles instead of swinging every time an administration changes.
4. **No national-character claims.** Anything resembling "[nationality] are naturally X negotiators" is
   excluded outright, full stop — not because it lacks a citable source (though it does), but because it's
   not the kind of claim this app should be making about a people, regardless of how the underlying
   observation was intended.
5. **Missing data ships as missing.** If a category can't be sourced for a given entity, the bar stays
   empty/unscored for that entity. No interpolation, no "estimated," no default-to-50.
6. **Weights need the same sourcing discipline as data.** *(New — added during Military's design pass.)*
   An unequal weight (e.g. "defense-industrial base matters more than air fleet, weight it higher") is a
   claim, exactly like a data point is a claim, and needs the same citable backing. Absent a published,
   citable weighting framework to ground an unequal scheme in, default to equal weighting — it's the
   scheme that requires no external justification, not the "safe/lazy" option. *(Exception on record,
   2026-08-20: Military double-weights expenditure — no citable framework behind it, an explicit,
   documented departure from this principle, not a case that was found to satisfy it. See §3.1's Weighting
   section and its Exclusions & Annotations Log entry.)*

---

## 3. Per-category breakdown

### 3.1 Military — sourceable, multi-source composite (revised)

**Status: fully locked (design); 5 of 7 originally-scored components actually scored as of 2026-08-20 — see
"Implementation update" below.** Seven components in the original design, of which 5 are currently scored,
1 is a non-scoring annotation (arms import/export dependency — demoted, see below), and 1 is backlogged (air
fleet). Plus three pre-existing non-scoring annotations and several explicit exclusions — see the
Exclusions & Annotations Log at the end of this section for the full reasoning trail on everything that was
considered and *not* included.

**Scored components, as originally locked (7):**

| # | Component | Source | Coverage | Zero classification |
|---|---|---|---|---|
| 1 | Military expenditure ($) | SIPRI Military Expenditure Database | ~170 countries | Coverage-gap-only |
| 2 | Defense spending, % GDP | World Bank WDI | ~170 countries | Coverage-gap-only |
| 3 | Military personnel (active) | World Bank / CIA Factbook archive (frozen snapshot) | ~150–170 countries | Coverage-gap-only |
| 4 | Nuclear warheads | FAS Nuclear Notebook | 9 countries | True-zero |
| 5 | Air fleet size | FlightGlobal World Air Forces (w/ Cirium data) | ~161 countries | Coverage-gap-only* |
| 6 | Defense-industrial base (summed Top-100 arms revenue by HQ country) | SIPRI Arms Industry Database | ~25–40 countries | True-zero |
| 7 | Arms import/export dependency (TIV) | SIPRI Arms Transfers Database | ~150+ countries | **Demoted 2026-08-20 — no longer scored, see below** |

\* Defaults to coverage-gap-only; a handful of genuine micro-states with literally no air assets are a
plausible true-zero exception — flag individually, don't assume by default.

**Component #7 demoted to a non-scoring annotation (2026-08-20).** Reviewing real generated output exposed
a directional problem the metric can't resolve on its own: the locked design inverted a high import volume
into a *lower* score (`100 − normalized`), on the theory that heavy importing signals vulnerability. In
practice this penalized alliance-embedded procurement identically to genuine exposure (a NATO member buying
US/UK equipment reads as "import-dependent" the same way a truly exposed country does — arguably the
opposite signal, since it reflects allied-supply resilience) and rewarded countries with negligible
militaries and nothing to import in the first place the same way it would reward genuine self-sufficiency
("too small to import much" and "genuinely self-sufficient" are indistinguishable from TIV alone). Resolving
this would need supplier-diversity or alliance-context data this project doesn't source — rather than keep a
directional score whose direction doesn't reliably hold, component #7 moves to the same treatment already
used for cereal self-sufficiency and willingness-to-fight below: real, cited, and displayed as context, not
blended into the composite. It now sits in the Annotations table below, not the scored-components table
above; the `100 − normalized` inversion is removed entirely (not merely skipped — see the Weighting section's
note below and `scripts/buildMilitary.mjs`'s own header comment for the full trail).

**Implementation update (2026-08-20):** `scripts/buildMilitary.mjs` implements components #1, #2, #3, #4,
and #6 as SCORED. **Component #5 (air fleet) is backlogged, not implemented** — investigated and confirmed
genuinely blocked, not a scraping-difficulty problem: the FlightGlobal World Air Forces directory is a
straight paid subscription paywall (no PDF link, no free/email-gated form actually present despite older
claims of a free download), the same licensing wall this doc already ruled out IISS/Jane's for elsewhere in
this section's Backlogged table. No equivalent free, citable source was found. See that table's new "Air
fleet size" row below, and the coverage-floor/confidence revision immediately below this table.
**Component #7 (arms import/export dependency) is implemented but demoted to a non-scoring annotation** —
its source turned out to need more than the publicly documented API (see `scripts/buildMilitary.mjs`'s own
header comment for the full trail: its live backend was found by driving the actual SIPRI portal UI and
capturing the resulting request, still the same official SIPRI Arms Transfers Database this doc names, not
a substituted source), and separately, reviewing the real output it produced led to the demotion described
above (this superseded an earlier open question here about whether #7's zero-classification should be
"coverage-gap" or "true-zero" — that question no longer applies now that #7 isn't scored at all; see Section
10's history).

**Zero classification logic:** does absence of a value mean the country genuinely has none of this thing,
or that nobody measured it? True-zero components (nuclear, defense-industrial base) always contribute a
real value — the sourced number or a legitimate 0 — because most countries genuinely lack a nuclear
arsenal or a Top-100 arms manufacturer, and that absence is itself meaningful. Coverage-gap components
assume every country has *some* nonzero real value, so a missing entry means "unmeasured" and is excluded
from both the coverage floor and the composite average.

**Confirmed no-standing-military override.** A set of countries have no standing military at all: confirmed
fact, not a data gap. These bypass the coverage floor and zero-classification logic entirely — every
component is set to a verified 0, and the resulting score is exactly 0.0, tagged `confirmed: true`,
distinguishable in the data from "coverage floor not met." **Sourcing requirement:** cite primary sources
(national constitutions, CIA World Factbook entries) for this list, not a Wikipedia-style compiled list
directly.

**List (17, as of 2026-08-20):** Costa Rica, Panama, Iceland (the original 3), plus Andorra, Dominica,
Grenada, Liechtenstein, Mauritius, Micronesia, Monaco, Nauru, Palau, Saint Lucia, Saint Vincent and the
Grenadines, Samoa, Tuvalu, Vanuatu — each individually re-verified against factbook.json (see
`scripts/buildMilitary.mjs`'s `NO_STANDING_MILITARY` for the exact quoted confirming text per country).
worldpopulationreview.com's "Countries Without a Military" table was used only to generate candidates, per
this section's own sourcing requirement — its list attributes itself to the CIA World Factbook, but wasn't
trusted as-is. That re-verification step caught a real error: **San Marino** appears on WPR's list but was
rejected — factbook.json names an actual, currently-serving military (the "San Marino Military Corps").
**Solomon Islands, Marshall Islands, and Kiribati** are deferred, not added — factbook.json lists only a
police force for each, same as the 17 confirmed countries, but without that source's own explicit "no
regular military forces" disclaimer phrase, so this is a genuine ambiguity rather than a confirmed fact. See
`BACKLOG.md` for both.

**Coverage floor:** a country needs at least 4 of the 5 coverage-gap components present to receive a
Military score at all. Below that, no bar renders — same empty-bar-as-credibility-signal treatment used
everywhere else. True-zero components don't count toward this floor (they're never actually "missing").

**Coverage floor and confidence — revision history (2026-08-20):** with air fleet backlogged (see
"Implementation update" above), there were briefly only 4 coverage-gap components left (expenditure, %GDP,
personnel, arms-import-TIV), floor ≥ 3 of 4. **Superseded the same day** by component #7's demotion to a
non-scoring annotation (see above): coverage-gap components are now just 3 — expenditure, %GDP, personnel.
**Current floor: ≥ 2 of 3 present.** `measured` = 3 of 3 present, `proxy` = exactly 2 of 3 (floor met, not
full coverage — this is what resolves Section 5's previously-open "should Military have a `proxy` tier"
question), `unavailable` = below 2. True-zero components are unaffected throughout — still never counted
toward the floor. If air fleet is ever sourced and added back, or #7 is ever reinstated as scored, this
floor/tier math changes again; until then, this is the actual implemented behavior, not either table above
it.

**Normalization:** log-min-max, applied uniformly — see Section 4 (revised).

**Weighting: originally equal**, across whichever components have a real value for a given country
(true-zero components always included; coverage-gap components included only where present). Unequal,
importance-based weighting was explicitly considered and rejected — see the Exclusions & Annotations Log
below. **(Superseded 2026-08-20 — see the demotion note above.)** Component #7 (arms dependency) was
originally inverted after normalization (`100 − normalized`), on the theory that it measures a vulnerability
signal rather than a capability signal, so higher import-dependency should lower the composite rather than
raise it. That inversion was confirmed to change rankings via a reference simulation before being locked —
but a mechanism working as designed isn't the same as its underlying direction being correct, and real
output review found the direction itself didn't reliably hold (see the demotion note above). The inversion
is now removed entirely along with #7's removal from the composite, not merely disabled.

**Weighting is no longer fully equal, as of 2026-08-20 — expenditure (#1) is double-weighted.** Reviewing
real output showed countries with extreme %GDP or personnel figures relative to their actual resource-pool
size (small countries under heavy strain, conscription-driven personnel counts) outranking countries with
far larger absolute military resources. Expenditure was judged the hardest-to-inflate proxy for
resource-pool size among the components currently sourced — %GDP and personnel can both be disproportionate
to real capability in ways expenditure generally isn't — so its normalized value is now summed twice into
the composite average instead of once (a country with all 5 scored components present now averages over 6
values, not 5). Applies identically at `measured` or `proxy` tier; if expenditure itself is the missing
value for a `proxy`-tier country, neither copy counts — never a partial/half-weight. **This is a documented
EXCEPTION to Governing Principle 6, not something that satisfies it:** there is no published, citable
weighting framework behind the 2x factor, only a judgment call made after reviewing real generated output —
the same basis the arms-import-TIV demotion above used, but Principle 6 specifically holds *weights* to a
citable-backing bar that a directional-assumption problem (TIV) doesn't have to clear the same way. Recorded
here rather than silently reconciled with Principle 6, per this doc's own "don't silently re-litigate a
locked call" discipline — see the Exclusions & Annotations Log's weighting row below for the fuller history
of this principle being reopened.

**Historical conquest, colonial history, and territorial extent (past or present) are excluded from the
score.** The score measures present-day standing capacity only. Rationale: past outcomes reflect
conditions (technology, norms, opponents) that no longer hold, so including them rewards countries for
history rather than current capability, while unfairly penalizing countries with no major-war history
despite that being uninformative about present strength.

**Recent combat experience is excluded as a scoring input for the same reason** — not just historical
conquest. Example: the PRC's current government hasn't fought a major war since 1979, yet is broadly
assessed as the world's #2 military power by expenditure, personnel, industrial production, and equipment
inventories. A metric that weighted combat experience would contradict standing-capacity reality in both
directions — penalizing untested-but-strong militaries, and rewarding recently-active-but-underfunded
ones. "Has fought recently" and "is currently strong" are not the same claim.

**What changed and why:** the original v1 draft of this section listed 4 coarse SIPRI-only inputs
(expenditure %GDP, personnel/population, arms production/export volume, equipment inventory) and framed
Military as a **"single-source category" needing no weighting math**. Working through actual sourcing
revealed the opposite: no single source covers hardware counts, nuclear status, and industrial base
together, so Military became the most multi-source category in the Intelligence Engine (5 distinct
providers, 7 components), not the simplest. This is not a downgrade in confidence — every one of the 7
sources independently clears the same citation bar — but it does mean Military can no longer piggyback on
"single-source" shortcuts elsewhere in this doc (see Sections 4, 5–6, 8 below).

---

#### Exclusions & Annotations Log (Military)

Kept as a permanent record so these decisions don't get silently re-litigated or re-added without the
original reasoning being revisited first.

**Annotations — tracked as non-scoring context, not blended into the number:**

| Item | Source | Why an annotation, not a score |
|---|---|---|
| Cereal self-sufficiency / import dependency | FAOSTAT (~200 countries) | Real logistics signal (relevant to prolonged-campaign sustainment), but converting it into a scored input would require inventing a proxy formula with no doctrinal backing. Also conceptually adjacent to Economy, but filed under Military since it specifically concerns campaign sustainment rather than general economic health. |
| Willingness to fight | WIN/Gallup International Association survey + World Values Survey/European Values Study | Real, named, citable data — but irregular coverage (45–64 countries depending on survey wave, not annual, not all 193), and cross-wave question wording isn't fully consistent. Too thin/irregular to treat as a hard numeric score input; strong enough to surface as context with a `snapshotDate`/wave note. |
| Cohesiveness (Group Grievance, Factionalized Elites) | Fund for Peace Fragile States Index (~179 countries) | Measures *fragility/grievance* (an inverted framing) rather than cohesion directly — using it as a scored proxy would mean inverting a composite that wasn't designed to measure the thing being claimed. Filed under Military (campaign-resilience context) rather than Diplomacy, per explicit decision. |
| Arms import/export dependency (TIV) | SIPRI Arms Transfers Database | **Demoted from a scored component, 2026-08-20** — see §3.1's "Component #7 demoted" note above for the full reasoning. Real, citable, per-country data (SIPRI TIV), but no reliable single direction: a high value reads as vulnerability for a genuinely exposed importer and as allied-supply resilience for an alliance-embedded procurer, and TIV alone can't tell those apart without supplier-diversity/alliance-context data this project doesn't source. Unlike the three rows above (never scored to begin with), this one was scored, shipped, then demoted after reviewing real generated output — kept as the concrete example of that review process actually working. |

**Excluded entirely — no score, no annotation:**

| Item | Reasoning |
|---|---|
| Effective marketing / propaganda capability | No citable, methodology-transparent dataset identified that measures this. Press-freedom/disinformation indices (V-Dem, Freedom House) measure a related but different concept (media control/censorship), and substituting one for the other would be exactly the kind of proxy-substitution error already flagged elsewhere in this doc (see CINC's steel-production critique in the design history) — measuring the wrong thing precisely is worse than not measuring the right thing at all. |
| Historical conquest / colonial history / past territorial extent | See main section above — past outcomes reflect obsolete conditions, rewards history over current capability. |
| Recent combat experience | See main section above — PRC case study is the concrete counterexample used to lock this exclusion. |
| Unequal, importance-based component weighting | Considered directly (a full proposed weighting scheme, with specific percentages and per-metric normalization curves, was drafted and reviewed). Rejected under Governing Principle 6: the weights themselves weren't traceable to a citable framework, and no adequate one was found. Reopened once, explicitly, before re-confirming equal weighting. **Reopened a second time, 2026-08-20, and this time NOT re-confirmed** — expenditure (#1) is now double-weighted, after real generated output showed extreme %GDP/personnel figures (small strained countries, conscription-driven counts) outranking countries with far larger absolute resources. This is an explicit, acknowledged exception to Principle 6, not a reversal of it: the 2x factor still has no citable framework behind it, only a judgment call from reviewing real output — recorded as an exception rather than quietly treated as compliant. See §3.1's Weighting section for the full reasoning. |
| Per-metric normalization curves (e.g. a 0.35 power curve for nuclear diminishing returns) | Considered alongside the weighting proposal above. Rejected for the same reason — the specific exponent had no citable source, only intuition. The uniform log transform already produces a milder version of the same diminishing-returns behavior without introducing an unsourced constant. |

**Backlogged — deferred on sourcing grounds, not excluded on principle:**

| Item | Status |
|---|---|
| Naval/ground equipment (ships, tanks, artillery counts) | No automated bulk source clears the licensing/credibility bar. Investigated and ruled out: IISS Military Balance+ (CC BY-NC-ND, subscription), Jane's Fighting Ships (same publisher-group model as IISS), USNI Guide to Combat Fleets of the World (purchased book, no redistribution rights), Global Firepower and GlobalMilitary.net (undisclosed methodology), Navbase/TheWorldWars.net (explicitly non-licensable per its own FAQ, and only ~24 navies), GlobalSecurity.org/Seaforces Online (no named data provider, unverifiable sourcing). Full per-source reasoning also lives in `BACKLOG.md`. Viable path when resourced: curated manual OSINT tier (~30–40 countries) via procurement journalism (USNI News, Defense News, Reuters), with Wikidata/Wikipedia used only as a discovery layer, never cited directly. |
| Air fleet size (component #5, FlightGlobal World Air Forces) | Investigated 2026-08-20: the directory page is a straight paid subscription paywall (£19.17/mo) — no PDF link, no free/email-gated download form actually present on the page (older "free download" social-media claims appear stale or referred to a past promotional period). Same licensing wall as the naval/ground equipment row above; every alternative at this project's citation bar is already ruled out there too (IISS/Jane's, Global Firepower, Wikipedia). Viable path when resourced: a personal/organizational FlightGlobal subscription (log in, then read the directory manually or automate against the authenticated session), or a human-supplied copy of the PDF dropped in for `scripts/buildMilitary.mjs` to parse. Not attempted here — see that script's own header comment. |

### 3.2 Economy — sourceable

**Formula inputs (World Bank):**
- GDP, GDP growth trend
- GDP per capita
- Trade volume / trade balance

**Confidence:** high — already scoped for ingestion. **Not yet revised** against the new log-min-max
normalization / coverage-floor confidence model below — Economy was designed under the original
percentile-rank / weighted-sourceCoverage assumptions and needs the same reconciliation pass Military just
went through before it's implementation-ready. Flagged, not resolved, here.

### 3.3 Technology — sourceable, but must be a composite

The Ukraine/China conundrum lives here. Ukraine's wartime drone/EW innovation and China's EV/robotics
manufacturing lead are both real, but both are narrow, sector-concentrated signals — not evidence of
aggregate tech capacity. A single-sector data point should never set this bar; it should feed one of
several weighted inputs.

**Formula inputs:**
- WIPO Global Innovation Index (composite: R&D spend, patent filings, high-tech exports, researcher
  density) — this is the backbone metric
- WIPO PCT patent filings by country — proxy for applied R&D activity
- Stanford AI Index — country-level research paper counts, model counts, compute access
- Optional sector-specific layer (semiconductor capacity, aerospace, etc.) if you want drill-down detail
  later, but not as the headline score

**Explicitly excluded:** any single "country X just shipped Y" event as a direct score driver. Military
tech specifically should pull from SIPRI's arms production data (3.1), not from this general index — keep
"military tech" and "general tech" as separate questions even if the UI ends up showing one number.

**Confidence:** medium — good composite indices exist, but coverage isn't universal (~130 countries for
WIPO GII), so this bar will be unscored for a meaningful chunk of entities. **Not yet revised** against the
new confidence model — same flag as Economy above.

### 3.4 Diplomacy — sourceable, but the hardest category

**Formula inputs (institutional, not personality-driven):**
- Size/reach of diplomatic mission network (embassy/consulate count)
- Treaty ratification count / participation in multilateral frameworks
- UN coalition voting alignment patterns
- Sanctions-coalition participation or leadership (e.g., legislative actions like sanctions bills are a
  real institutional signal — a useful example of the *right* kind of diplomacy data point, since it's an
  institutional/legislative act, not a leader's approval rating)
- Track record in mediated negotiations (outcomes, not caricature — e.g. actual compliance/verification
  record in a deal like the JCPOA, not a claim about a population's negotiating "style")

**Explicitly excluded:**
- Leader approval ratings / "how well-liked is the current administration"
- Government type as a legitimacy multiplier (an editorial judgment, not a measurement)
- Any national-character claim about a population's negotiating style, trustworthiness, or agreeableness

**Confidence:** low-to-medium — this is the category most likely to ship partially unscored, and that's
the correct outcome rather than a gap to paper over. **Not yet revised** against the new confidence model
— same flag as Economy/Technology above.

### 3.5 Current Status — categorical, not a bar (finalized, implemented)

**Decided and implemented** (`scripts/buildCurrentStatus.mjs` → `src/data/currentStatus.ts` — see
`LOGBOOK.md`'s 2026-08-26 entry for the full build). This is not a 0–100 score, and never converges to one:
it's two **independent** fields, each a real, sourced, categorical fact rather than a magnitude. The original
sketch of this section (a single `CurrentStatus` enum: `'active_conflict' | 'sanctioned' | 'normal' |
'disputed_territory'`) is superseded — it couldn't represent a country that is simultaneously sanctioned and
in an active conflict (one enum slot, two true facts), which is part of why it was replaced before any code
was written against it:

```ts
type ConflictType =
  | 'interstate'
  | 'internal'
  | 'internationalized_internal'
  | 'extrasystemic'
  | 'unclassified';

interface ConflictEntry {
  conflictType: ConflictType;
  conflictName?: string;
  snapshotDate: string;                        // which source release this reflects
  source: 'ucdp-candidate' | 'ucdp-prio-annual';
}

type SanctionTier = 'red' | 'orange' | 'yellow' | null;

interface CurrentStatus {
  conflicts: ConflictEntry[];                   // 0, 1, or many — every entry renders as a chip
  sanctionTier: SanctionTier;                   // null = no active OFAC country program, badge hidden
  sanctionPrograms?: string[];                  // the actual OFAC program name(s), e.g. ['Cuba Sanctions']
}
```

**Sourcing.** `conflictType` (for anything other than `'unclassified'`) comes from the UCDP/PRIO Armed
Conflict Dataset's own `type_of_conflict` classification — the only UCDP product that actually types a
conflict. That dataset is annual, so the UCDP Candidate Events Dataset (monthly, ~1-month lag) fills the gap
for a conflict active in the current year but not yet in any annual release; a conflict detected only that
way is `'unclassified'`, with no manual override path — the honest state until UCDP itself classifies it. See
`scripts/buildCurrentStatus.mjs`'s own header comment for the full country-code-based (Gleditsch-Ward, not
name-string) matching logic, and the real edge cases the Candidate-vs-annual reconciliation had to handle
(UCDP's own "not yet numbered" sentinel, avoiding double-counting a conflict already active in the annual
data, restricting to state-based armed conflict and excluding non-state/one-sided-violence records the ACD
doesn't classify at all).

**`sanctionTier`/`sanctionPrograms` (revised 2026-08-24 from a single `sanctioned: boolean`) is a small
hand-maintained seed, now three OFAC tiers instead of one:**

- **RED — comprehensive embargo.** Sourced directly from each program's own OFAC regulatory text (Cuba's
  CACR, Iran's ITSR, and the equivalent North Korea/Syria regulations). Fully verified, per-program, against
  OFAC's own page for each: Cuba, Iran, North Korea, Syria.
- **ORANGE — sectoral/hybrid.** Multiple overlapping sectoral+entity programs requiring general licenses for
  large activity categories, not a blanket embargo: Russia, Belarus, Venezuela, Burma (Myanmar), Sudan,
  Nicaragua.
- **YELLOW — list-based only.** SDN/Consolidated List screening exposure only, no country-wide sectoral
  program: Afghanistan, Central African Republic, Democratic Republic of the Congo, Ethiopia, Iraq, Lebanon,
  Libya, Mali, Somalia, South Sudan, Yemen.
- **`null`** — no active OFAC country program at all. This is a real, positive fact (same as `conflicts: []`)
  and hides the badge entirely, rather than rendering an empty/zero state.

**Confidence differs by tier, and this matters for how much this field should be trusted:** RED is fully
verified against each program's own OFAC page. ORANGE and YELLOW are seeded from secondary-source
characterization — cross-referenced across several independent sanctions-compliance sites, internally
consistent with each other, but **not yet individually checked against each country's own OFAC program page**
the way RED was, and their `sanctionPrograms` name text is a reasonable approximation of OFAC's naming
convention rather than copied verbatim from each program's own page. Flagged in `BACKLOG.md`: verify every
ORANGE/YELLOW tier assignment and program name against
https://ofac.treasury.gov/sanctions-programs-and-country-information and each country's own program page
before this ships as anything more than portfolio-demo-confidence data. Not a live pull either way — see
`LOGBOOK.md` for why that isn't worth building yet, and `BACKLOG.md` for it as a standing candidate if the
freshness bar ever tightens.

**Rendering (implemented, `hud/IntelligencePanel.tsx`):** a chip row (one `ConflictChip` per `ConflictEntry`,
colored/labeled by `conflictType`, citation in a tooltip) plus a separate standalone `SanctionBadge` — a
compact "S" mark colored red/orange/yellow by `sanctionTier`, program name(s) in its tooltip, hidden entirely
when `sanctionTier` is `null`. Deliberately not a chip variant, since sanction status isn't one-of-many the
way conflicts are. A real sanction logo is expected to land in `Intelligence Docs/current-status/` and replace
this placeholder badge later — see that folder's own README. `AnalyticsPanel.tsx` wiring (a ranked/filtered
view, since there's no single number to sort Current Status by) is still an open follow-on — see `BACKLOG.md`'s
"Intelligence Engine" entry.

---

## 4. Normalization method (revised)

**Log-min-max, not percentile rank.**

```
normalized = (ln(x + ε) − ln(min + ε)) / (ln(max + ε) − ln(min + ε)) × 100
```

`min`/`max` computed per-component across all countries with a real value for that specific component
(not a global constant). `ε` (epsilon) is derived **per-component as 1% of the smallest nonzero value
observed in that component's own dataset** — not a fixed arbitrary constant — so it's traceable to sourced
data rather than invented. The log base doesn't affect the outcome after min-max rescaling, so it isn't a
judgment call worth spending effort on; natural log is the default.

Vulnerability-framed metrics (currently just Military component #7, arms-trade dependency) are inverted
after normalization (`100 − normalized`) so that "higher = stronger" holds consistently across every
metric in a composite.

**What changed and why:** the original version of this section locked **percentile rank**, explicitly
because "min-max scaling is fragile to outliers... US military spend or a single petrostate's GDP would
compress every other country into the bottom of the range." That reasoning is still valid *against plain
min-max* — but log-min-max isn't plain min-max. The log transform is specifically what absorbs the outlier
problem (it compresses the US-vs-everyone gap) while still preserving *relative magnitude* in a way
percentile rank structurally cannot — under percentile rank, the real-world gap between the #1 and #2
military power reads identically to the gap between #50 and #51, which understates just how much larger a
top-tier power actually is. This was a deliberate reversal, made and validated against real illustrative
data (a 15-country reference simulation) before being locked — not an oversight. Percentile rank remains a
reasonable choice in the abstract; log-min-max was chosen because it better represents genuine magnitude
differences in military capability specifically, which matters more here than in a category like Diplomacy
where relative ranking probably matters more than absolute magnitude.

**Open item:** Economy, Technology, and Diplomacy (Section 3.2–3.4) still assume percentile rank per the
original design. Whether they should switch to log-min-max too, stay on percentile rank, or use different
methods per category (magnitude-sensitive domains vs. rank-sensitive domains) is undecided — revisit when
each category is actually scheduled, not now.

---

## 5. Confidence model (revised)

Military uses a different, more granular mechanism than the general model below — see "Military's
confidence mechanism" at the end of this section for exactly how it maps back onto the shared
`ScoreConfidence` enum in Section 6.

**General model, still valid for Economy/Technology/Diplomacy until each is individually revisited:**

For **composite categories** (multiple weighted sub-metrics):

**Constraint: weights for a category's sub-metrics must sum to exactly 1.** This isn't just tidiness — the
`sourceCoverage` formula below only means "fraction of total signal present" if the weights are a true
partition of 1. Enforce this at the point weights are defined (e.g. a unit test or a runtime assertion when
a category's weight config loads), not just by eyeballing it.

```
sourceCoverage = sum(weight of each sub-metric with data present for this entity)

if sourceCoverage >= 0.8  → 'measured'
if sourceCoverage > 0     → 'proxy'
if sourceCoverage == 0    → 'unavailable'
```

For **single-source categories** (none currently — Military moved out of this bucket, see below): no
weighting math needed, since there's no multi-source blend.

```
if all core figures present     → 'measured'
if some but not all present     → 'proxy'
if none present                 → 'unavailable'
```

The 0.8 threshold is a tunable constant, not a fixed rule — revisit once real coverage gaps in the data
show where it should actually sit.

**Military's confidence mechanism (does not use the weighted-threshold formula above):**

- **`measured`** — coverage floor met (≥4 of 5 coverage-gap components present); composite computed from
  whichever components are actually available, per the true-zero/coverage-gap rules in 3.1.
- **`unavailable`** — coverage floor not met; no score rendered.
- **`proxy`** — **resolved 2026-08-20, no longer an open question.** With air fleet backlogged (see §3.1's
  "Implementation update"), Military has 4 coverage-gap components instead of 5, and the floor/tier math
  was revised to produce a real middle tier: `measured` = 4 of 4 present, `proxy` = exactly 3 of 4,
  `unavailable` = below 3 — see §3.1 for the full reasoning. The `sourceCoverage`/weighted-threshold
  language in the general model above still doesn't apply to Military; this is Military's own mechanism,
  just no longer binary. Every `measured`/`proxy` country's score data carries its own
  `coveragePresent`/`coverageTotal` (e.g. "3 of 4") for a future UI to display.
- Countries on the confirmed no-standing-military list get `measured` with `confirmed: true`, distinct from
  a country that happens to score near-zero from thin real data.

**What changed and why:** Military's actual design process (working through 7 real components across 5
sources, and hitting the true-zero-vs-coverage-gap distinction via the Costa Rica edge case in a reference
simulation) produced a more granular set of rules than the general weighted-threshold formula anticipated.
Rather than force-fitting Military into the general model, Military gets its own explicit mechanism here,
and the general model remains as-is for categories that haven't gone through the same design depth yet.
**Whether Military's coverage-floor + true-zero/coverage-gap mechanism should become the new standard for
all future composite categories (replacing the weighted-sourceCoverage formula entirely) is an open
question — deliberately not resolved here.** Decide it when Diplomacy or Technology is actually scheduled,
with real sourcing work behind it, the same way Military's mechanism emerged from real sourcing work rather
than being designed in the abstract.

## 6. Data model change

Replace the implicit "score exists or doesn't" with an explicit confidence field per category, so the
current empty-chrome state becomes one value in an enum rather than a special case to remember:

```ts
type ScoreConfidence = 'measured' | 'proxy' | 'unavailable';

interface CategoryScore {
  value: number | null;       // 0-100, null if unavailable
  confidence: ScoreConfidence;
  sources: string[];          // citation keys, e.g. ['SIPRI-2025', 'WorldBank-GDP-2025']
  annotations?: string[];     // non-scoring caveats, e.g. ['No large-scale combat deployment since 1979']
  confirmed?: boolean;        // true for e.g. confirmed no-standing-military countries — distinguishes
                               // "we verified this is genuinely 0" from an ordinary low/thin score
}
```

`annotations` is deliberately separate from `value` — it exists so a caveat like combat-readiness
uncertainty (3.1) or the cereal-self-sufficiency/willingness-to-fight/cohesiveness annotations (see the
Exclusions & Annotations Log in 3.1) can be surfaced without being blended into the number itself. Any
category can use it, not just Military.

`proxy` matters as its own state (distinct from `measured`) so the UI can visually flag "this is a proxy
metric, not a direct measurement" — e.g. Diplomacy's embassy-count proxy vs. Military's direct expenditure
figure — rather than presenting both with equal confidence. (Note: Military doesn't currently produce
`proxy` under its revised mechanism — see Section 5.)

`confirmed` is new in this revision, added specifically for Military's no-standing-military override, but
generalizable to any future category that has a similar "we know the true answer is zero" case.

## 7. UI interaction: citation drill-down

**Decided:** status bars are clickable. Clicking a bar collapses the other four categories out of the
panel and drops down the list of metrics/sources that fed that bar's score — source name, value used,
snapshot date. This replaces the earlier "hover tooltip vs. methodology page" question with a third
option: the citation lives inside the panel itself, on demand, scoped to the category the user clicked
into. Keeps the default panel clean (no citation clutter on every bar at once) while making the sourcing
fully inspectable per category.

## 8. Launch scope (revised)

**Decided:** ship Military and Economy first. **Revised reasoning:** the original version of this section
justified this as "both single-source, high-confidence categories... needing no weighting math." That
premise no longer holds for Military, which turned out to be the most multi-source category in the whole
Intelligence Engine. The launch-scope decision itself still stands, but for a different reason: Military is
now the *most thoroughly designed and validated* category — 7 components, all independently sourced and
citable, normalization and weighting logic stress-tested against a reference simulation that caught two
real bugs before launch — even though it's also the most complex. Complexity and confidence turned out to
be independent axes here, not correlated. Diplomacy and Technology stay unscored/"coming" in the UI until
their composite formulas, weights, and confidence-model alignment (Section 9, plus the open item in Section
5) are worked through.

## 9. Deferred: Technology / Diplomacy weighting

Not launch-blocking per Section 8. Sources are listed in 3.3/3.4; weights are not yet locked (Technology
has an illustrative example: 0.5 WIPO GII / 0.3 PCT filings / 0.2 AI Index — sums to 1, per the Section 5
constraint, but the individual values aren't confirmed). **Also now deferred alongside weighting:** whether
these categories adopt Military's coverage-floor/true-zero mechanism (Section 5) or stay on the original
weighted-sourceCoverage formula, and whether they use log-min-max or percentile-rank normalization (Section
4). Revisit all of this together when these categories are scheduled for implementation — no reason to
decide it piecemeal now.

## 10. Open questions (not decided here)

- Technology sector drill-down (military-tech vs. general-tech vs. specific industries) — v1 or later?
  Doesn't block Military/Economy work either way.
- ~~Should Military's `'proxy'`-equivalent tier be introduced (see Section 5)?~~ Resolved 2026-08-20 — yes,
  see §3.1/§5. Still open: whether/how the UI actually renders `proxy` vs `measured` differently — deferred
  to IntelligencePanel UI implementation.
- Should Military's confidence/normalization mechanism become the standard for all composite categories,
  replacing the original weighted-threshold model? Deferred to whenever Diplomacy/Technology are scheduled.
- Economy's normalization/confidence model needs the same reconciliation pass Military just went through —
  not yet started.
- ~~Should component #7 (arms import TIV) actually be "coverage-gap-only," or does it behave more like
  true-zero?~~ **Superseded 2026-08-20, not resolved as originally framed** — component #7 was demoted from
  a scored component to a non-scoring annotation the same day (see §3.1), for an unrelated reason (the
  inversion's directional assumption didn't hold up against real output, not a zero-classification concern).
  Since #7 no longer participates in the coverage floor or composite at all, the coverage-gap-vs-true-zero
  question this bullet asked no longer has anything to apply to. Recorded here rather than deleted, per this
  section's own "don't silently re-litigate" discipline: the underlying observation (SIPRI's CSV legend
  distinguishes a reported "0" from an absent row, and the live query never actually hits its "top 300" cap)
  is still true and would matter again if #7 — or a similarly-shaped future TIV-style component — were ever
  reinstated as scored.

---

## 11. Explicitly out of scope for v1

- Real-time/event-driven score updates (a single news event should never move a bar)
- Any leader-specific or population-specific characterization as a scoring input
- Interpolating scores for entities with no underlying data
