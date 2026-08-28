# Claude Code build prompt — `scripts/buildEconomy.mjs`

## Context

Project Atlas's Intelligence Engine scores five categories (Military, Economy, Diplomacy, Technology,
Current Status). Military is fully built (`scripts/buildMilitary.mjs`). This prompt builds Economy, the
second scored category, per the locked design in `intelligence-engine-scoring-design.md` Section 3.2
(2026-08-20 revision).

**Read `scripts/buildMilitary.mjs` first** for the established patterns this script should follow:
raw-value-at-ingestion (no display formatting baked into stored data), per-entity source citation keys,
and the `ScoreConfidence`/`CategoryScore` shape from the design doc's Section 6.

## Scored components (5, equal weight 0.2 each)

| # | Component | Source / indicator | Direction |
|---|---|---|---|
| 1 | GDP (PPP) | World Bank WDI `NY.GDP.MKTP.PP.CD` | Higher = better |
| 2 | GDP per capita (PPP) | World Bank WDI `NY.GDP.PCAP.PP.CD` | Higher = better |
| 3 | Real GDP growth, 5yr trailing average | World Bank WDI `NY.GDP.MKTP.KD.ZG` | Higher = better |
| 4 | Unemployment rate | World Bank WDI `SL.UEM.TOTL.ZS` | Lower = better (inverted) |
| 5 | Inflation (CPI) | World Bank WDI `FP.CPI.TOTL.ZG` | Lower = better (inverted) — **known limitation:** this does not distinguish healthy low inflation from deflation; a documented, accepted edge case, not a bug to fix here |

All 5 are **coverage-gap-only** — no true-zero components in this category (unlike Military's nuclear/
industrial-base rows). Every country plausibly has a real GDP, growth rate, unemployment rate, and
inflation rate; a missing value means "unmeasured," not "genuinely zero."

**Explicitly dropped from the original v1 draft:** trade volume / trade balance. Not sourced, not scored,
not an annotation — cut outright during the 2026-08-20 design revision.

## Formula

1. **Ingest raw values per entity, per component**, most recent year available for #1, #2, #4, #5.
   For #3 (growth), pull the last 5 years of `NY.GDP.MKTP.KD.ZG` and store the arithmetic mean as the
   value that feeds scoring. Store the individual years used alongside it (not just the average) so a
   future citation drill-down can show the underlying data, matching the drill-down UI already decided
   in Section 7 of the design doc.
2. **Normalize via percentile rank** across all entities with a value for that component — NOT log-min-max.
   This is a deliberate divergence from Military; see design doc Section 3.2 for why (GDP's outlier
   skew is the same problem percentile rank was originally adopted to solve in Section 4).
3. **Invert the percentile for components #4 and #5** (`100 − percentile`) before they enter the average —
   lower unemployment and lower inflation should score higher.
4. **Equal weight, no exceptions.** Average the (already-inverted-where-applicable) percentile scores
   across whichever of the 5 components have real data for that entity. No double-weighting, no
   per-component multiplier — this is a deliberate contrast with Military's expenditure double-weight,
   which had a specific real-output justification that doesn't apply here. Do not port that pattern over.
5. **Confidence tiering** (Section 5's original weighted model, not Military's coverage-floor variant):
   ```
   sourceCoverage = sum(0.2 for each of the 5 components with a real value for this entity)
   sourceCoverage >= 0.8  → 'measured'   (4 or 5 of 5 present)
   sourceCoverage > 0     → 'proxy'      (1–3 of 5 present)
   sourceCoverage == 0    → 'unavailable'
   ```

## Output shape

Match the `CategoryScore` interface from the design doc's Section 6:
```ts
{
  value: number | null;       // 0–100, null if unavailable
  confidence: 'measured' | 'proxy' | 'unavailable';
  sources: string[];          // e.g. ['WorldBank-GDP-PPP-2024', 'WorldBank-Inflation-CPI-2024']
  annotations?: string[];     // none planned for Economy v1 — leave undefined, don't stub empty array
}
```
No `confirmed` field — that's Military-specific (no-standing-military override), doesn't apply here.

## Explicit scope boundaries — do not touch

- Do not modify `scripts/buildMilitary.mjs` or any Military scoring logic.
- Do not touch `GeoEntity` schema fields beyond adding the Economy `CategoryScore` object itself —
  `population` and `gdpUsd` (raw, unscored) already exist on the schema from the earlier data pipeline
  work and are separate from this scored composite; leave them as-is.
- Do not implement Diplomacy, Technology, or Current Status — out of scope for this script.
- Do not add trade volume/trade balance in any form, scored or annotation — confirmed cut, not deferred.
- Do not build a UI component or wire up `IntelligencePanel.tsx` — this script only produces the scored
  data; rendering is a separate task.
- Do not invent a GDP deflator fallback if CPI data (`FP.CPI.TOTL.ZG`) is missing for a country — a
  missing CPI value is a genuine coverage gap for that component, not a case to substitute a different
  indicator into.

## Stopping conditions

- If World Bank API pagination/rate limits become a blocker, stop and report — don't silently drop
  countries to make the script "work."
- If percentile rank produces a tie-handling ambiguity (e.g. multiple countries with identical raw
  values), stop and ask before picking a tie-breaking convention — don't silently pick one.

## After completion

Update `BACKLOG.md` and `LOGBOOK.md` per the standard task-completion pattern. Note in `LOGBOOK.md`
specifically: Economy uses percentile-rank normalization and the original weighted-sourceCoverage
confidence model, diverging from Military's log-min-max/coverage-floor mechanism — this is intentional,
not an inconsistency to reconcile later (see design doc Section 3.2's "what changed and why" for the
reasoning trail).
