Build the Military intelligence-bar scoring pipeline for Project Atlas.

## Context

This implements the Military category of the Intelligence Engine (5
scoring bars: Military, Economy, Diplomacy, Technology, Current Status).
Full design decisions are locked in `intelligence-engine-scoring-design.md`
— read that file's Military section in full before writing any code. Do
not re-derive or second-guess decisions documented there (normalization
formula, weighting, zero-classification rules); implement them as
specified.

## Scope

Build `scripts/buildMilitary.mjs`, a standalone Node script that:
1. Ingests 7 components per country from their named sources.
2. Applies the locked normalization, weighting, coverage-floor, and
   no-military-override logic to produce one Military score (0–100) per
   country, plus per-component normalized values for display.
3. Writes output to a new `data/militaryScores.ts` (or `.json`, your
   call — match whatever convention `buildGovCapitalPopGdp.mjs`'s output
   already uses in this repo) keyed by the same country id scheme
   `GeoEntity`/`Country` already use.
4. Does NOT modify `GeoEntity`/`Country` type definitions, entity
   registries, or any rendering/UI code. This is a data-generation script
   only. Wiring the output into the actual IntelligencePanel UI is a
   separate, later task — do not attempt it here.

## The 7 components and how to source each

Most of these sources are not API-accessible — they're published as
spreadsheets, PDFs, or reports. Build a structured intermediate data file
for each component with **per-entry provenance** (`sourceUrl`,
`sourceDate`/`snapshotDate`), not a live API call, except where noted.

1. **Military expenditure ($)** — SIPRI Military Expenditure Database.
   SIPRI publishes this as a downloadable Excel file
   (sipri.org/databases/milex). Download the current-year file, extract
   per-country figures, store with `sourceDate` = the database's stated
   release date.
2. **Defense spending, % GDP** — World Bank WDI, indicator
   `MS.MIL.XPND.GD.ZS`. This one IS API-accessible:
   `https://api.worldbank.org/v2/country/all/indicator/MS.MIL.XPND.GD.ZS?format=json&per_page=300&date=<most recent year with broad coverage>`.
   Follow the same pull pattern `buildGovCapitalPopGdp.mjs` already uses
   for other WDI indicators — reuse that script's fetch/pagination/error
   handling rather than writing new logic from scratch.
3. **Military personnel (active)** — World Bank WDI where available;
   fall back to the CIA Factbook archive (`factbook.json` GitHub mirror,
   already a confirmed source for this project) for countries WDI
   doesn't cover. Tag every entry with which source it came from and the
   Factbook archive's frozen snapshot date.
4. **Nuclear warheads** — FAS Nuclear Notebook (fas.org). Only 9
   countries. Manually transcribe from the current published notebook
   entries (one per nuclear state), with `sourceUrl` pointing at the
   specific article per country and `sourceDate` of publication.
5. **Air fleet size** — FlightGlobal World Air Forces directory (free
   annual PDF, published with Cirium data, ~161 countries). Download the
   current year's PDF, extract per-country total aircraft counts, store
   with `sourceDate` = the report's publication year.
6. **Defense-industrial base** — SIPRI Arms Industry Database (Top 100
   arms-producing companies, sipri.org/databases/armsindustry). Extract
   each company's arms-sales revenue and its headquarters country, then
   **sum revenue by country** (not company count) — this is a locked
   design decision, not optional. Countries with zero companies in the
   Top 100 get a true-zero value, not a missing entry.
7. **Arms import/export dependency (TIV)** — SIPRI Arms Transfers
   Database (sipri.org/databases/armstransfers). Extract per-country
   import TIV totals as the dependency figure.

For every component, if a genuinely reliable, low-effort programmatic
source doesn't exist (i.e. it requires manual PDF/spreadsheet
transcription), that's expected and fine — this is consistent with how
this project has always handled non-API sources. Do not substitute an
easier-to-scrape but lower-credibility source (Wikipedia, aggregator
sites) without flagging it explicitly as a deviation for review; do not
silently swap sources.

## Zero-classification and coverage-floor logic (implement exactly as specified)

- **True-zero components:** nuclear warheads (#4), defense-industrial
  base (#6). Absence of a value here means the country genuinely has
  none — store as `0`, not `null`/missing.
- **Coverage-gap components:** expenditure (#1), %GDP (#2), personnel
  (#3), air fleet (#5), arms dependency (#7). Absence of a value here
  means "unmeasured" — store as `null`/missing, and exclude from both the
  coverage-floor count and the composite average for that country.
- **Coverage floor:** a country needs at least 4 of these 5
  coverage-gap components present (non-null) to receive a Military score
  at all. Below that, output no score for that country (omit it from the
  output, or set an explicit `null`/`unscored` flag — match whatever
  convention this project's other "empty bar" cases already use
  elsewhere in the codebase; check `data/countryProfiles.ts` or similar
  for precedent before inventing a new convention).
- **No-standing-military override:** maintain an explicit
  `NO_STANDING_MILITARY` list (Costa Rica, Panama, Iceland, and other
  confirmed cases), sourced from primary documentation (national
  constitutions, CIA World Factbook country entries — NOT Wikipedia's
  compiled list directly, cite the primary sources it itself points to).
  Countries on this list bypass the coverage floor entirely: every
  component is set to `0`, and the Military score is exactly `0.0`,
  tagged with a `confirmed: true` flag distinct from the "coverage floor
  not met" case — these two zero/absent states must be
  distinguishable in the output data, not collapsed into the same value.

## Normalization (implement exactly as specified)

Log-min-max, computed per-component across all countries that have a
real value for that component (not a hardcoded global min/max):

```
normalized = (ln(x + ε) − ln(min + ε)) / (ln(max + ε) − ln(min + ε)) × 100
```

- `ε` (epsilon) = 1% of the smallest nonzero value observed in that
  component's own dataset. Compute this per-component, not as a single
  global constant.
- Natural log; the base doesn't affect the final result after min-max
  rescaling, so don't spend effort choosing a different base.
- **Component #7 (arms dependency) gets inverted after normalization:**
  `finalValue = 100 − normalized`. This is required — component #7
  measures import dependency as a vulnerability signal, and higher
  normalized dependency must LOWER the composite, not raise it. A
  reference Python simulation (see attached `military_sim.py` if
  available, otherwise implement fresh) confirmed this inversion
  materially changes rankings and is not optional polish.

## Weighting

Equal weighting across all components that have a real value for a given
country (true-zero components always included; coverage-gap components
included only where present, i.e. the composite is an average over
however many of the 7 are actually populated for that country, not
always 7). Do not implement unequal/importance-based weighting — this
was explicitly considered and rejected during design; do not reintroduce
it.

## Verification steps (required before considering this done)

1. Run the script end-to-end against real data for at least the 15
   countries used in the design-phase simulation (US, China, Russia,
   India, UK, France, Germany, Japan, Israel, Pakistan, North Korea,
   Brazil, Poland, Luxembourg, Costa Rica) and print the resulting
   scores + per-component normalized breakdown, same shape as the
   original simulation's output table.
2. Confirm Costa Rica scores exactly `0.0` with `confirmed: true`, and
   that at least one country below the coverage floor (if any exist in
   this initial batch) is correctly omitted/flagged rather than given a
   misleading partial score.
3. Confirm the arms-dependency inversion is actually applied — spot
   check that a country with genuinely high import dependency (e.g.
   North Korea, Pakistan in the sample) does NOT get an inflated score
   from that component.
4. Report final country coverage counts per component (how many
   countries actually got a real, sourced value for each of the 7) —
   this becomes the coverage numbers cited in the Intelligence Engine's
   public methodology write-up, so they need to be real output, not
   estimates.
5. Do not fabricate, estimate, or interpolate any country's component
   value that isn't actually present in the source data. A country
   missing a component stays missing — this is the entire point of the
   coverage-floor design.

## Explicit stopping conditions

- Do not modify any file outside `scripts/buildMilitary.mjs` and its
  data output file(s).
- Do not attempt UI/rendering wiring.
- Do not substitute a different data source for any of the 7 components
  without flagging the substitution explicitly in your final summary for
  human review.
- Do not add caching/refresh-scheduling infrastructure — this is a
  manually-rerun build script, same pattern as the existing `buildX.mjs`
  scripts in this repo, not a live service.
- If SIPRI/FlightGlobal/FAS data can't be reasonably extracted
  programmatically from their published formats (locked PDFs, complex
  Excel layouts), stop and report back with what was found rather than
  fabricating placeholder numbers to make the script "complete."
