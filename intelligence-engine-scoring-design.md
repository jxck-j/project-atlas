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
   scheme that requires no external justification, not the "safe/lazy" option.

---

## 3. Per-category breakdown

### 3.1 Military — sourceable, multi-source composite (revised)

**Status: fully locked.** Seven scored components, three non-scoring annotations, several explicit
exclusions — see the Exclusions & Annotations Log at the end of this section for the full reasoning trail
on everything that was considered and *not* included.

**Scored components (7):**

| # | Component | Source | Coverage | Zero classification |
|---|---|---|---|---|
| 1 | Military expenditure ($) | SIPRI Military Expenditure Database | ~170 countries | Coverage-gap-only |
| 2 | Defense spending, % GDP | World Bank WDI | ~170 countries | Coverage-gap-only |
| 3 | Military personnel (active) | World Bank / CIA Factbook archive (frozen snapshot) | ~150–170 countries | Coverage-gap-only |
| 4 | Nuclear warheads | FAS Nuclear Notebook | 9 countries | True-zero |
| 5 | Air fleet size | FlightGlobal World Air Forces (w/ Cirium data) | ~161 countries | Coverage-gap-only* |
| 6 | Defense-industrial base (summed Top-100 arms revenue by HQ country) | SIPRI Arms Industry Database | ~25–40 countries | True-zero |
| 7 | Arms import/export dependency (TIV) | SIPRI Arms Transfers Database | ~150+ countries | Coverage-gap-only |

\* Defaults to coverage-gap-only; a handful of genuine micro-states with literally no air assets are a
plausible true-zero exception — flag individually, don't assume by default.

**Zero classification logic:** does absence of a value mean the country genuinely has none of this thing,
or that nobody measured it? True-zero components (nuclear, defense-industrial base) always contribute a
real value — the sourced number or a legitimate 0 — because most countries genuinely lack a nuclear
arsenal or a Top-100 arms manufacturer, and that absence is itself meaningful. Coverage-gap components
assume every country has *some* nonzero real value, so a missing entry means "unmeasured" and is excluded
from both the coverage floor and the composite average.

**Confirmed no-standing-military override.** A small set of countries (Costa Rica, Panama, Iceland, and
similar — full list TBD) have no standing military at all: confirmed fact, not a data gap. These bypass
the coverage floor and zero-classification logic entirely — every component is set to a verified 0, and
the resulting score is exactly 0.0, tagged `confirmed: true`, distinguishable in the data from "coverage
floor not met." **Sourcing requirement:** cite primary sources (national constitutions, CIA World Factbook
entries) for this list, not Wikipedia's compiled list directly.

**Coverage floor:** a country needs at least 4 of the 5 coverage-gap components present to receive a
Military score at all. Below that, no bar renders — same empty-bar-as-credibility-signal treatment used
everywhere else. True-zero components don't count toward this floor (they're never actually "missing").

**Normalization:** log-min-max, applied uniformly — see Section 4 (revised).

**Weighting: equal**, across whichever components have a real value for a given country (true-zero
components always included; coverage-gap components included only where present). Unequal, importance-
based weighting was explicitly considered and rejected — see the Exclusions & Annotations Log below.
Component #7 (arms dependency) is inverted after normalization (`100 − normalized`) since it measures a
vulnerability signal, not a capability signal — higher import-dependency must lower the composite, not
raise it. This inversion was confirmed necessary via a reference simulation before being locked; without
it, small import-dependent countries were artificially inflated.

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

**Excluded entirely — no score, no annotation:**

| Item | Reasoning |
|---|---|
| Effective marketing / propaganda capability | No citable, methodology-transparent dataset identified that measures this. Press-freedom/disinformation indices (V-Dem, Freedom House) measure a related but different concept (media control/censorship), and substituting one for the other would be exactly the kind of proxy-substitution error already flagged elsewhere in this doc (see CINC's steel-production critique in the design history) — measuring the wrong thing precisely is worse than not measuring the right thing at all. |
| Historical conquest / colonial history / past territorial extent | See main section above — past outcomes reflect obsolete conditions, rewards history over current capability. |
| Recent combat experience | See main section above — PRC case study is the concrete counterexample used to lock this exclusion. |
| Unequal, importance-based component weighting | Considered directly (a full proposed weighting scheme, with specific percentages and per-metric normalization curves, was drafted and reviewed). Rejected under Governing Principle 6: the weights themselves weren't traceable to a citable framework, and no adequate one was found. Reopened this decision once, explicitly, before re-confirming equal weighting — see below. |
| Per-metric normalization curves (e.g. a 0.35 power curve for nuclear diminishing returns) | Considered alongside the weighting proposal above. Rejected for the same reason — the specific exponent had no citable source, only intuition. The uniform log transform already produces a milder version of the same diminishing-returns behavior without introducing an unsourced constant. |

**Backlogged — deferred on sourcing grounds, not excluded on principle:**

| Item | Status |
|---|---|
| Naval/ground equipment (ships, tanks, artillery counts) | No automated bulk source clears the licensing/credibility bar. Investigated and ruled out: IISS Military Balance+ (CC BY-NC-ND, subscription), Jane's Fighting Ships (same publisher-group model as IISS), USNI Guide to Combat Fleets of the World (purchased book, no redistribution rights), Global Firepower and GlobalMilitary.net (undisclosed methodology), Navbase/TheWorldWars.net (explicitly non-licensable per its own FAQ, and only ~24 navies), GlobalSecurity.org/Seaforces Online (no named data provider, unverifiable sourcing). Full per-source reasoning also lives in `BACKLOG.md`. Viable path when resourced: curated manual OSINT tier (~30–40 countries) via procurement journalism (USNI News, Defense News, Reuters), with Wikidata/Wikipedia used only as a discovery layer, never cited directly. |

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

### 3.5 Current Status — categorical, not a bar

**Decided:** this is not a 0–100 score. Implemented as a status enum/chip, sourced from a simple public
conflict/sanctions tracker (e.g. UCDP conflict data, OFAC/EU sanctions lists):

```ts
type CurrentStatus = 'active_conflict' | 'sanctioned' | 'normal' | 'disputed_territory';
```

Rendered as a status chip in the panel, not a filled bar — consistent with the rest of the panel's visual
language but structurally distinct in the data model, since it's a state rather than a magnitude.

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
- **`proxy`** — not currently used by Military under this mechanism. The weighted-sourceCoverage model's
  `'proxy'` tier assumed a continuous confidence gradient driven by sub-metric weight sums; Military's
  binary floor (met/not-met) doesn't naturally produce a middle tier. Open question, not resolved: should
  Military introduce its own `'proxy'`-equivalent (e.g. "floor met, but on only 4 of 7 total components")
  to preserve the UI's ability to visually distinguish thin coverage from full coverage — revisit once the
  IntelligencePanel UI work for Military actually starts.
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
- Should Military's `'proxy'`-equivalent tier be introduced (see Section 5)? Deferred to IntelligencePanel
  UI implementation.
- Should Military's confidence/normalization mechanism become the standard for all composite categories,
  replacing the original weighted-threshold model? Deferred to whenever Diplomacy/Technology are scheduled.
- Economy's normalization/confidence model needs the same reconciliation pass Military just went through —
  not yet started.

---

## 11. Explicitly out of scope for v1

- Real-time/event-driven score updates (a single news event should never move a bar)
- Any leader-specific or population-specific characterization as a scoring input
- Interpolating scores for entities with no underlying data
