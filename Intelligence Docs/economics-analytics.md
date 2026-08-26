# Economy — Scoring Methodology

**Status:** implemented, live. **Source of truth for behavior:** `scripts/buildEconomy.mjs` — if this doc and
the script ever disagree, the script is correct and this doc is stale; re-read the script's own comments
before trusting anything below.
**Generates:** `src/data/economyScores.ts`, consumed by `hud/IntelligencePanel.tsx`'s ECONOMY status bar
(with citation drill-down) and `hud/AnalyticsPanel.tsx`'s ECONOMY ranked list.
**Locked design / governing principles:** `Intelligence Docs/intelligence-engine-scoring-design.md` §2
(applies to every category) — §3.2's original Economy stub predates implementation entirely ("not yet
revised" against the log-min-max/coverage-floor model) and is superseded by this doc for anything about how
Economy actually works today.
**Full change history / real-output reasoning trail:** `LOGBOOK.md` (search "Economy") — this doc explains
the *current* logic; LOGBOOK explains *why it changed*, with real numbers, including two methods that were
tried and rejected (see §3.4).

This is a per-category series — see `military-analytics.md`, `technology-analytics.md`, and
`current-status-analytics.md` for the same treatment of Military, Technology, and Current Status. Diplomacy
will get its own `diplomacy-analytics.md` once it's built.

---

## 1. What this measures

One 0–100 composite score per UN member country (193) plus Taiwan (194 total — see §6), reflecting economic
**size, prosperity, growth trajectory, labor-market health, and price stability** together. Unlike Military
(where every scored component uses the same normalization method), Economy deliberately uses a *different*
method per component, because the 5 components aren't the same *kind* of quantity — see §3 for why each one
gets the treatment it does.

## 2. Components at a glance

| Component | Source (indicator code) | Method | Weight |
|---|---|---|---|
| GDP (nominal) | World Bank WDI, `NY.GDP.MKTP.CD` | **Log-min-max** | **2×** |
| GDP per capita (PPP) | World Bank WDI, `NY.GDP.PCAP.PP.CD` | Percentile rank | 1× |
| GDP growth (5yr trailing average) | World Bank WDI, `NY.GDP.MKTP.KD.ZG` | Percentile rank | 1× |
| Unemployment rate | World Bank WDI, `SL.UEM.TOTL.ZS` | Percentile rank, inverted | 1× |
| Inflation (CPI) | World Bank WDI, `FP.CPI.TOTL.ZG` | **Tolerance-band + gaussian** (absolute, not relative) | 1× |

All 5 are coverage-gap-only — there's no true-zero component in Economy the way Military has nuclear
warheads/industrial-base revenue (every country genuinely has *some* GDP, growth rate, unemployment rate, and
inflation rate; a missing value here always means "not sourced," never "genuinely zero").

## 3. Normalization methods used, and why each was picked

Three different methods are in play across the 5 components — this is deliberate, not inconsistency. Each
component gets whichever method actually fits the *kind* of quantity it is.

### 3.1 Percentile rank — GDP per capita, GDP growth, unemployment

```
sort all real values low → high
rank = 1-indexed position (ties get the AVERAGE/fractional rank of the positions they jointly occupy)
percentile = (rank − 1) / (n − 1) × 100
```

The lowest value in the dataset scores 0, the highest scores 100 — unemployment additionally gets
`100 − percentile` afterward, since a *lower* rate is better. Tie handling (average/fractional rank, matching
Excel's `PERCENTRANK` / scipy's `rankdata(method='average')`) was confirmed with the user before this script
was written, per the original build prompt's explicit "stop and ask before picking a tie-breaking convention"
instruction — never arbitrarily favors one tied country over another.

**Why this fits these three:** all three are fundamentally about *order*, not magnitude. A country with the
world's highest GDP per capita isn't meaningfully "more prosperous" in some multiplicative sense than the
second-highest the way a $29T economy is multiplicatively bigger than a $90B one — for a per-capita or
rate-based comparison, relative standing is the whole signal. Percentile rank also does real, useful work
here: it's what prevents an extreme outlier (a country with abnormally high growth off a tiny base, for
instance) from compressing everyone else's differentiation the way an unbounded raw-value scale would.

### 3.2 Log-min-max — GDP (nominal) only, as of 2026-08-26

```
epsilon = 1% of the smallest nonzero raw value in the dataset
lnMin   = ln(min(raw values) + epsilon)
lnMax   = ln(max(raw values) + epsilon)
score   = 100 × (ln(raw + epsilon) − lnMin) / (lnMax − lnMin)
```

Identical implementation to Military's own log-min-max normalizer (`military-analytics.md` §3) — copied, not
imported, since these are separate standalone scripts by design.

**Why GDP switched off percentile rank:** GDP size was originally percentile-ranked like everything else, but
real output showed the flaw directly — China's GDP percentile was 100.00 against the US's 99.47, a
0.53-point gap that barely registered *even with GDP double-weighted* (see §4), despite the real ~$10.6T
dollar difference between the two economies. Percentile rank only ever encodes order, so "these two are close
in rank but enormously far apart in real size" is invisible to it. Log-min-max fixes that: post-switch, the
same two countries score US 100.00 / China 96.60 — still not a dramatic gap (the log compression is
deliberate, keeping one outlier from swallowing everyone else's differentiation), but real and directionally
correct. GDP per capita stays on percentile rank deliberately — log-min-max only earns its keep where raw
magnitude itself carries real weight (aggregate economic size/power, the same justification Military uses),
not for a per-capita prosperity comparison, where two similarly-prosperous countries of very different
population sizes should score similarly rather than have their score skewed by population size.

### 3.3 Tolerance-band + gaussian — inflation only, absolute rather than relative

```
target = 2.0%           (the Fed's and Bank of England's own stated longer-run target)
band   = 1.0pp          (the Bank of England's own stated policy tolerance — see below)
sigma  = 1.0pp           (kept equal to the band width; NOT derived from the sample)

distance = |inflation − target|
score = 100                                             if distance ≤ band
score = 100 × exp(−((distance − band)²) / (2 × sigma²))  otherwise
```

This is the one component that isn't ranked against the rest of the dataset at all — every other component's
score depends on who else happens to be in the dataset that year; inflation's doesn't. **2%** is not a
choice made to fit this data — it's the explicit, publicly stated longer-run target of both the
[Federal Reserve](https://www.federalreserve.gov/faqs/economy_14400.htm) and the
[Bank of England](https://www.bankofengland.co.uk/monetary-policy/inflation). The **±1 percentage-point
band** is likewise a real, stated policy threshold, not a number picked to fit this dataset: it's the Bank of
England's own tolerance for the target — a governor's open letter to the Chancellor is legally required if
CPI moves more than 1pp away from 2%. Inside that band, the score doesn't distinguish "closer to 2%" from
"closer to the edge" at all, because by the central bank's own stated standard, anything in that range isn't
a problem worth a graded penalty — inventing one anyway would be scoring against a bar this project didn't
actually adopt. Beyond the band, a gaussian decay picks up, using *excess* distance (how far past the band
edge, not raw distance from the target) as its input, with σ fixed at that same 1.0pp — **deliberately not
derived from the sample's own spread**, because a data-derived spread gets distorted by real hyperinflation
outliers (a handful of countries at -50%+ or +200%+ inflation would blow out a computed standard deviation
and flatten everyone else's score toward the middle, defeating the point of a target-centered score).

**Real falloff, for reference** (anything outside the 1–3% band):

| Inflation (either side of the band) | Distance from 2% | Score |
|---|---|---|
| 1.0% or 3.0% (band edge) | 1.0 | 100.0 |
| 0.5% or 3.5% | 1.5 | 88.2 |
| 0.0% or 4.0% | 2.0 | 60.7 |
| -0.5% or 4.5% | 2.5 | 32.5 |
| -1.0% or 5.0% | 3.0 | 13.5 |
| -2.0% or 6.0% | 4.0 | 1.1 |
| beyond ~5.0 distance | 5.0+ | ~0.0 |

It's steep right past the edge (roughly 40 points lost in the first half-point beyond the band) and bottoms
out fast — by ~3pp past the band, "bad" and "catastrophic" inflation are functionally indistinguishable, both
near zero.

**This method has a real evolution behind it, not a single decision:**
1. *Inverted percentile of the raw rate* ("lower is always better") — the original method, shared with
   unemployment. Scored deflation and near-zero inflation as excellent, which misrepresents deflation as a
   genuine economic hazard rather than "very good low inflation."
2. *Percentile rank of distance from the 2% target* — fixed the deflation problem, but was still relative to
   the dataset (whoever happened to have the smallest distance that year got 100, regardless of how far from
   2% that actually was).
3. *Pure gaussian around 2%, no percentile step* — made the score absolute instead of relative, anchored to
   the real 2% target with σ fixed at the BoE's tolerance band. This is what exposed the current tolerance-
   band version's motivation: even inflation technically *within* the BoE's own stated "not a problem" zone
   (e.g. 2.95%) was still losing real points under a pure gaussian, which is more punitive than the policy
   standard being cited actually calls for.
4. *Tolerance-band plateau + gaussian beyond it* (current) — full score anywhere within the real policy
   tolerance, decay only once you're genuinely outside it.

### 3.4 Methods considered and rejected

Worth recording so they aren't re-tried without remembering why they didn't work:

- **Distance-from-target, log-min-max.** Tried directly. Rejected for two reasons: it silently reintroduces
  dataset-dependence (the same problem the gaussian/tolerance-band approach was specifically adopted to
  remove — a hyperinflation outlier like Venezuela stretches the log-min-max scale so far that the entire
  "normal" 0–2pp-from-target range of real economies gets compressed together, a sample-dependent artifact,
  not a statement about any of those countries' actual inflation), and log-min-max's own justification (real
  multiplicative structure — GDP genuinely spans orders of magnitude with meaningful ratios) doesn't transfer
  to a bounded distance-from-target quantity, where 0.1pp vs. 1.0pp off target isn't "10× worse" in any real
  economic sense.
- **Wider gaussian, no plateau (σ = 2.0pp).** Narrows the spread between near-target and moderately-off-target
  countries without fully flattening it, but has no real citation behind the specific number 2.0 the way the
  BoE's actual 1.0pp threshold does — considered, not adopted, in favor of the tolerance-band version, which
  achieves a similar effect while staying grounded in the same real policy number already being cited.

## 4. Weighting

**Default: equal weight**, per Governing Principle 6 (design doc §2). **Exception, on the record: GDP
(size) is double-weighted** — the exact same rationale as Military's expenditure double-weight
(`military-analytics.md` §4). Real output showed large, mature economies (the US specifically) landing well
below smaller, faster-growing ones despite GDP and GDP per capita being near-maxed — not a data bug, a
structural one: the same absolute dollar increase in GDP is mechanically a much smaller *percentage* of a
$29T base than of a $50B one, so equal-weighting "size" against "growth rate" always structurally penalizes
size. GDP is this category's "overall economic size" metric, so its score counts twice in the composite
average — nominal GDP as of 2026-08-26 (was PPP-adjusted GDP before that; the double-weight itself carries
over unchanged regardless of which GDP measure backs it). If GDP itself is the missing component for a
country, both copies are dropped from the average — never a partial or half-weight, identical to Military's
own rule.

## 5. Coverage floor & confidence tiers

A country needs at least 3 of the 5 components present to receive an Economy score at all:

- `coveragePresent ≥ 4 of 5` → **`measured`**
- `coveragePresent = 3 of 5` → **`proxy`**
- `coveragePresent ≤ 2 of 5` → **`unavailable`** — `value` is `null`, not computed from 1–2 components and
  then withheld.

This floor exists because the original no-floor design broke on real data: Monaco and Liechtenstein, each
with only 1 of 5 components present, were outranking fully-measured economies, since a single component's
percentile had nothing real to average against.

**A genuine implementation trap, worth remembering:** the tiers are conceptually `sourceCoverage = 0.2 ×
components present`, with `≥0.8` measured / `==0.6` proxy / `<0.6` unavailable — but `3 × 0.2 === 0.6` is
**`false`** in JavaScript floating point (`0.2` has no exact binary representation; the real product is
`0.6000000000000001`), which would silently make the proxy tier unreachable if implemented as a literal float
comparison. The actual implementation derives the tiers from the integer `coveragePresent` count instead
(`>= 4` / `=== 3` / `<= 2`), mathematically identical to the float thresholds but safe from this class of bug.

## 6. Taiwan — the one entity not sourced from World Bank WDI

World Bank WDI structurally excludes Taiwan (China's WDI figures already claim to represent "one China"),
so the ordinary 193-country loop never touches it. Rather than leave it unscored entirely, all 5 of Taiwan's
components are sourced from the IMF World Economic Outlook (WEO) instead — the **only** IMF/WEO dependency
this script keeps (an earlier, now-fully-removed standalone trial re-sourced the *entire* category from IMF
WEO instead of WDI; that trial was not adopted — this is a narrow, permanent, Taiwan-only exception layered
on top of the real WDI-sourced dataset, not a revival of it).

Because WEO series genuinely extend years into the future as IMF staff projections (unlike WDI, which has
none at all), Taiwan's values are resolved to the **most recent ACTUAL year only** — projected years are
explicitly filtered out via IMF's `COUNTRY_UPDATE_DATE` attribute, the same standard every WDI-sourced value
already meets by construction. Taiwan's score is folded into the same percentile/log-min-max ranking pools as
the 193 WDI countries, so its real values genuinely affect where everyone else lands, not just its own score.

Taiwan is not a `Country` in this app's registry — it's a `GeoEntity` — so it's keyed here by its GeoEntity
registry id (`'taiwan'`) rather than a numeric ISO topology id, the one exception to this file's "keyed by
numeric id" convention. **No UI wiring exists yet for GeoEntity Economy selection** — Taiwan's score is real
and present in the generated data (and does affect every other country's percentile ranking), but isn't
currently surfaced anywhere a GeoEntity selection is made in `IntelligencePanel.tsx`, the same pre-existing
gap Military already has for every non-Country entity.

## 7. What's intentionally excluded

- **Trade volume / trade balance** — present in the original v1 draft inputs, explicitly dropped, never
  scored or annotated.
- Per Governing Principle 5 (design doc §2): no interpolated, estimated, or default-to-something value ever
  stands in for a genuinely missing component — see §5's coverage floor.

## 8. Change history

Not duplicated here — see `LOGBOOK.md` (search "Economy") for the full real-output reasoning trail behind
every revision mentioned above: the coverage-floor fix, the GDP double-weight, the full inflation-scoring
evolution (§3.3), the GDP nominal/log-min-max switch, the Taiwan addition, and the IMF WEO trial that was
built, evaluated, and ultimately fully removed in favor of the narrow Taiwan-only exception described in §6.
