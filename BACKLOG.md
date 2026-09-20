# Backlog

Ideas, recommendations, and known gaps that have **not** been implemented —
hand-maintained (unlike `CLAIMS.md`, there's no structured source to
generate this from). Not a roadmap or a commitment; a place to write down
"we should probably..." before it's forgotten. Move an item to
`CHANGELOG.md` (and delete it here) once it's actually built — don't let
this file describe features that already exist.

Grouped by theme, not priority. Each item says *why* it's here, not just
*what*, per this repo's usual convention (see `LOGBOOK.md`).

## States/provinces: other countries may sit on the wrong admin tier, and regional capitals aren't modeled

- **Wrong-tier audit against `un193_subnational_architecture.xlsx` (2026-09-19): every country the file could fix
  is done** — Spain, Italy, France, Burkina Faso, Guinea, Sri Lanka, Bosnia, Mauritius, UK, Hungary, Saint Kitts and
  Nevis, Malawi, Maldives, via `scripts/lib/dissolveToFirstLevel.mjs` (see `LOGBOOK.md`). Belgium deliberately stays
  at provinces (user decision). **Maldives' merged regions are unverified visually** (camera can't zoom close
  enough to inspect tiny island groups — a separate camera-limits issue). The remaining mismatches in
  `un193_tier1_comparison.xlsx` are the out-of-date-source group below, plus several "Moderate difference" rows
  (21) that were never individually reviewed.
- **Natural Earth's admin-1 data is out of date for some countries; dissolving can't fix it** — needs a different
  source (GADM/geoBoundaries) or a hand-authored mapping: Vietnam (63 vs 34 after the 2025 mergers), Nepal (old
  zones vs 7 provinces), Somalia (old regions vs federal member states), Kenya (8 provinces vs 47 counties),
  DR Congo (11 vs 26), Mali (9 vs 19 + Bamako), Ghana (10 vs 16), Algeria, Indonesia, Angola, Lebanon, Norway.
  Tiny states are also coarse: Marshall Islands (2 vs 24), Kiribati (2 vs 21), Tuvalu (1 vs 8), Monaco (1 vs 10),
  Luxembourg (3 vs 12).
- **Regional capitals** (Barcelona for Catalonia, etc.) aren't represented: `cities.json`'s `isCapital` is
  national-capital-only, and admin-1 features carry no capital field. Barcelona still shows as an ordinary
  major-city marker, just not tied to the Catalonia polygon.

## Cross-cutting: every country-code/name join needs a real audit, not just the one bug found so far

**Scope note (2026-09-04): the confirmed finding below (South Sudan's `SSD`/`SDS` alias) is one instance of
a general class, not the whole problem.** This codebase joins country-keyed data across a lot of
independent code/name-matching mechanisms, and this pass has only checked one of them — the same "verify
before trusting a per-entity gap" discipline needs to be applied to *every entity* (not just South Sudan)
in *every dataset* that does a country-code or country-name join, not just the five scripts already found.
Known mechanisms that haven't been audited this way yet, each a candidate for the same kind of silent
mismatch:

- `data/registry/geoEntities.ts`'s own separate, deliberately-partial `ISO_ALPHA3_TO_NUMERIC` table (distinct
  from `scripts/lib/iso3166.mjs`'s — two tables that could disagree).
- `UNSD_NAME_ALIASES` / `ARDA_NAME_ALIASES` in `buildCurrentStatus.mjs` (~11 / ~13 hand-bridged name
  mismatches for ethnicity/religion sourcing) — free-text name matching, not code-based, so its failure mode
  is different (a silently-unmatched name) but the same "did we actually check every entity, not just the
  ones that happened to surface a visible gap" question applies.
- `scripts/lib/gleditschWard.mjs` (UCDP's Gleditsch-Ward numeric codes → this project's UN-193 topology
  names, for Current Status conflict matching).
- GeoNames' own alpha-2 → alpha-3 bridge (`countryInfo.txt`, used by `buildGlobalCitiesData.mjs` and
  `buildCitiesData.mjs`).
- Natural Earth's `adm0_a3` field, wherever it's matched against `iso3166.mjs` (`buildStatesProvincesTopology.mjs`,
  `buildCountryTopology.mjs`) — the same dataset whose South-Sudan-specific quirk (`SDS`) caused the
  confirmed bug below; worth checking whether any *other* country has a similar quirky/non-standard code in
  this same source that hasn't been noticed yet.
- SIPRI's literal-name matching for Taiwan (`findYearSeriesForLiteralName()` in `buildMilitary.mjs`) and UN
  Comtrade's reporter code 490 for Taiwan (`buildTechnology.mjs`) — both bypass the normal topology-based
  matcher entirely for one specific entity; worth checking no other entity silently needs the same kind of
  bypass and isn't getting it.
- `scripts/lib/gecCrossReference.mjs` (Factbook's GEC code cross-reference, used by the demographics
  fallback path).
- `scripts/researchCityAdminLevels.mjs`'s own alpha3 usage against geoBoundaries' API (the script this bug
  was originally found in) — fixed for the one duplicate found, but not independently re-verified entity-by-
  entity beyond the spot-checks already in `city-boundaries-architecture.md`.

None of these has been confirmed broken the way the `SSD`/`SDS` case below has — this is a list of where to
look, not a list of known bugs. The actual next step is picking one mechanism at a time and checking it
against every entity it's supposed to cover (not just the ones that already look wrong), the same way the
South Sudan case was only found by querying it directly rather than trusting a script's own "0 coverage"
report.

### Confirmed instance: South Sudan's `SSD`/`SDS` alias breaks 5 build scripts' World Bank lookups

**Confirmed 2026-09-04, not yet fixed.** `scripts/lib/iso3166.mjs`'s `ALPHA3_TO_NUMERIC` deliberately maps
South Sudan to two alpha-3 codes — `SSD` (the real ISO code) and `SDS` (a non-standard code Natural Earth's
admin-1 layer uses, added 2026-08-17 specifically for `buildStatesProvincesTopology.mjs`'s benefit — see that
file's own comment). Every script that builds a numeric-id → alpha3 reverse lookup from this table with a
naive last-write-wins assignment (`map[num] = a3` for every entry, no dedup) silently resolves South Sudan to
`SDS` instead of `SSD` — and World Bank's API 400s on `SDS` outright (verified live:
`.../country/SDS/indicator/SP.POP.TOTL` → `"Invalid value"`; `.../country/SSD/...` returns real data).

Confirmed present in, and already shipping wrong data via:
- `scripts/buildTechnology.mjs` — South Sudan's Technology score is `null`/`unavailable`, 0 of 4 components.
- `scripts/buildMilitary.mjs` — personnel/%GDP both null (1 of 3 components; only the SIPRI-by-name
  expenditure figure survives, since that match is by literal country name, not this table).
- `scripts/buildEconomy.mjs` — Economy score `null`/`unavailable`, 0 of 5 components, every `sourceUrl`
  literally embeds the invalid `SDS` code.
- `scripts/buildCurrentStatus.mjs` — South Sudan's `ethnicGroups` field is missing entirely (the Factbook
  fallback path shares the same broken alias).
- `scripts/buildGovCapitalPopGdp.mjs` — not currently broken (`countryEconomics.ts` was last regenerated
  2026-08-14, before the `SDS` alias existed) but will break the same way next run.

Fix is mechanical and small — same shape as the one already applied in `researchCityAdminLevels.mjs`: make
each reversal keep the first/canonical alias instead of whichever iterates last, or centralize a single
correct `NUMERIC_TO_ALPHA3` export in `iso3166.mjs` itself so five scripts stop reimplementing the same
reversal (and the same bug) independently. `scripts/buildStatesProvincesTopology.mjs`/
`scripts/buildCitiesData.mjs` do a forward (`alpha3 → numeric`) lookup only, so they're unaffected by this
specific bug shape. Not fixed in this pass — found via an investigation fork while working on
`city-boundaries-architecture.md`'s own, unrelated `SSD`/`SDS` mixup; logged here rather than fixed
opportunistically, since it touches shipped `main` behavior outside this branch's actual scope.

## Data sourcing (`buildTechnology.mjs`)

<!-- BEGIN buildTechnology.mjs gap report -->

**Generated by `npm run build:technology` (`scripts/buildTechnology.mjs`), 2026-08-27.** Technology category component fields that couldn't be sourced cleanly this run — left unscored, not guessed. Re-running the script regenerates the 3 WDI-sourced components' gaps; the ICT Development Index gap list only changes if IDI_2024 is hand-updated (see scripts/buildTechnology.mjs's own header comment).

- **[Afghanistan] Patent applications, residents:** World Bank has no IP.PAT.RESD value for AFG in range — left unscored.
- **[Afghanistan] R&D expenditure (% GDP):** World Bank has no GB.XPD.RSDV.GD.ZS value for AFG in range — left unscored.
- **[Antigua and Barbuda] R&D expenditure (% GDP):** World Bank has no GB.XPD.RSDV.GD.ZS value for ATG in range — left unscored.
- **[Bahamas] R&D expenditure (% GDP):** World Bank has no GB.XPD.RSDV.GD.ZS value for BHS in range — left unscored.
- **[Bangladesh] R&D expenditure (% GDP):** World Bank has no GB.XPD.RSDV.GD.ZS value for BGD in range — left unscored.
- **[Barbados] R&D expenditure (% GDP):** World Bank has no GB.XPD.RSDV.GD.ZS value for BRB in range — left unscored.
- **[Belize] ICT Development Index:** No ITU IDI 2024 entry for BLZ — not published/not an ITU member — left unscored.
- **[Belize] R&D expenditure (% GDP):** World Bank has no GB.XPD.RSDV.GD.ZS value for BLZ in range — left unscored.
- **[Benin] Patent applications, residents:** World Bank has no IP.PAT.RESD value for BEN in range — left unscored.
- **[Benin] R&D expenditure (% GDP):** World Bank has no GB.XPD.RSDV.GD.ZS value for BEN in range — left unscored.
- **[Cameroon] Patent applications, residents:** World Bank has no IP.PAT.RESD value for CMR in range — left unscored.
- **[Cameroon] R&D expenditure (% GDP):** World Bank has no GB.XPD.RSDV.GD.ZS value for CMR in range — left unscored.
- **[Central African Republic] ICT Development Index:** No ITU IDI 2024 entry for CAF — not published/not an ITU member — left unscored.
- **[Central African Republic] Patent applications, residents:** World Bank has no IP.PAT.RESD value for CAF in range — left unscored.
- **[Central African Republic] R&D expenditure (% GDP):** World Bank has no GB.XPD.RSDV.GD.ZS value for CAF in range — left unscored.
- **[Chad] High-tech exports (% of manufactured exports):** World Bank has no TX.VAL.TECH.MF.ZS value for TCD in range — left unscored.
- **[Chad] Patent applications, residents:** World Bank has no IP.PAT.RESD value for TCD in range — left unscored.
- **[Comoros] Patent applications, residents:** World Bank has no IP.PAT.RESD value for COM in range — left unscored.
- **[Comoros] R&D expenditure (% GDP):** World Bank has no GB.XPD.RSDV.GD.ZS value for COM in range — left unscored.
- **[Congo] Patent applications, residents:** World Bank has no IP.PAT.RESD value for COG in range — left unscored.
- **[Djibouti] R&D expenditure (% GDP):** World Bank has no GB.XPD.RSDV.GD.ZS value for DJI in range — left unscored.
- **[Dominica] Patent applications, residents:** World Bank has no IP.PAT.RESD value for DMA in range — left unscored.
- **[Dominica] R&D expenditure (% GDP):** World Bank has no GB.XPD.RSDV.GD.ZS value for DMA in range — left unscored.
- **[Dominican Republic] R&D expenditure (% GDP):** World Bank has no GB.XPD.RSDV.GD.ZS value for DOM in range — left unscored.
- **[Equatorial Guinea] High-tech exports (% of manufactured exports):** World Bank has no TX.VAL.TECH.MF.ZS value for GNQ in range — left unscored.
- **[Equatorial Guinea] Patent applications, residents:** World Bank has no IP.PAT.RESD value for GNQ in range — left unscored.
- **[Equatorial Guinea] R&D expenditure (% GDP):** World Bank has no GB.XPD.RSDV.GD.ZS value for GNQ in range — left unscored.
- **[Eritrea] High-tech exports (% of manufactured exports):** World Bank has no TX.VAL.TECH.MF.ZS value for ERI in range — left unscored.
- **[Eritrea] ICT Development Index:** No ITU IDI 2024 entry for ERI — not published/not an ITU member — left unscored.
- **[Eritrea] Patent applications, residents:** World Bank has no IP.PAT.RESD value for ERI in range — left unscored.
- **[Eritrea] R&D expenditure (% GDP):** World Bank has no GB.XPD.RSDV.GD.ZS value for ERI in range — left unscored.
- **[Eswatini] Patent applications, residents:** World Bank has no IP.PAT.RESD value for SWZ in range — left unscored.
- **[Fiji] Patent applications, residents:** World Bank has no IP.PAT.RESD value for FJI in range — left unscored.
- **[Fiji] R&D expenditure (% GDP):** World Bank has no GB.XPD.RSDV.GD.ZS value for FJI in range — left unscored.
- **[Gabon] Patent applications, residents:** World Bank has no IP.PAT.RESD value for GAB in range — left unscored.
- **[Gambia] ICT Development Index:** No ITU IDI 2024 entry for GMB — not published/not an ITU member — left unscored.
- **[Gambia] Patent applications, residents:** World Bank has no IP.PAT.RESD value for GMB in range — left unscored.
- **[Grenada] Patent applications, residents:** World Bank has no IP.PAT.RESD value for GRD in range — left unscored.
- **[Grenada] R&D expenditure (% GDP):** World Bank has no GB.XPD.RSDV.GD.ZS value for GRD in range — left unscored.
- **[Guinea] ICT Development Index:** No ITU IDI 2024 entry for GIN — not published/not an ITU member — left unscored.
- **[Guinea] Patent applications, residents:** World Bank has no IP.PAT.RESD value for GIN in range — left unscored.
- **[Guinea] R&D expenditure (% GDP):** World Bank has no GB.XPD.RSDV.GD.ZS value for GIN in range — left unscored.
- **[Guinea-Bissau] Patent applications, residents:** World Bank has no IP.PAT.RESD value for GNB in range — left unscored.
- **[Guinea-Bissau] R&D expenditure (% GDP):** World Bank has no GB.XPD.RSDV.GD.ZS value for GNB in range — left unscored.
- **[Guyana] ICT Development Index:** No ITU IDI 2024 entry for GUY — not published/not an ITU member — left unscored.
- **[Guyana] R&D expenditure (% GDP):** World Bank has no GB.XPD.RSDV.GD.ZS value for GUY in range — left unscored.
- **[Haiti] High-tech exports (% of manufactured exports):** World Bank has no TX.VAL.TECH.MF.ZS value for HTI in range — left unscored.
- **[Haiti] ICT Development Index:** No ITU IDI 2024 entry for HTI — not published/not an ITU member — left unscored.
- **[Haiti] R&D expenditure (% GDP):** World Bank has no GB.XPD.RSDV.GD.ZS value for HTI in range — left unscored.
- **[India] ICT Development Index:** No ITU IDI 2024 entry for IND — not published/not an ITU member — left unscored.
- **[Iraq] High-tech exports (% of manufactured exports):** World Bank has no TX.VAL.TECH.MF.ZS value for IRQ in range — left unscored.
- **[Kiribati] Patent applications, residents:** World Bank has no IP.PAT.RESD value for KIR in range — left unscored.
- **[Kiribati] R&D expenditure (% GDP):** World Bank has no GB.XPD.RSDV.GD.ZS value for KIR in range — left unscored.
- **[Lebanon] ICT Development Index:** No ITU IDI 2024 entry for LBN — not published/not an ITU member — left unscored.
- **[Lebanon] R&D expenditure (% GDP):** World Bank has no GB.XPD.RSDV.GD.ZS value for LBN in range — left unscored.
- **[Liberia] Patent applications, residents:** World Bank has no IP.PAT.RESD value for LBR in range — left unscored.
- **[Liberia] R&D expenditure (% GDP):** World Bank has no GB.XPD.RSDV.GD.ZS value for LBR in range — left unscored.
- **[Libya] Patent applications, residents:** World Bank has no IP.PAT.RESD value for LBY in range — left unscored.
- **[Libya] R&D expenditure (% GDP):** World Bank has no GB.XPD.RSDV.GD.ZS value for LBY in range — left unscored.
- **[Liechtenstein] High-tech exports (% of manufactured exports):** World Bank has no TX.VAL.TECH.MF.ZS value for LIE in range — left unscored.
- **[Liechtenstein] Patent applications, residents:** World Bank has no IP.PAT.RESD value for LIE in range — left unscored.
- **[Maldives] Patent applications, residents:** World Bank has no IP.PAT.RESD value for MDV in range — left unscored.
- **[Maldives] R&D expenditure (% GDP):** World Bank has no GB.XPD.RSDV.GD.ZS value for MDV in range — left unscored.
- **[Mali] Patent applications, residents:** World Bank has no IP.PAT.RESD value for MLI in range — left unscored.
- **[Marshall Islands] High-tech exports (% of manufactured exports):** World Bank has no TX.VAL.TECH.MF.ZS value for MHL in range — left unscored.
- **[Marshall Islands] ICT Development Index:** No ITU IDI 2024 entry for MHL — not published/not an ITU member — left unscored.
- **[Marshall Islands] Patent applications, residents:** World Bank has no IP.PAT.RESD value for MHL in range — left unscored.
- **[Marshall Islands] R&D expenditure (% GDP):** World Bank has no GB.XPD.RSDV.GD.ZS value for MHL in range — left unscored.
- **[Mauritania] Patent applications, residents:** World Bank has no IP.PAT.RESD value for MRT in range — left unscored.
- **[Micronesia] High-tech exports (% of manufactured exports):** World Bank has no TX.VAL.TECH.MF.ZS value for FSM in range — left unscored.
- **[Micronesia] ICT Development Index:** No ITU IDI 2024 entry for FSM — not published/not an ITU member — left unscored.
- **[Micronesia] Patent applications, residents:** World Bank has no IP.PAT.RESD value for FSM in range — left unscored.
- **[Micronesia] R&D expenditure (% GDP):** World Bank has no GB.XPD.RSDV.GD.ZS value for FSM in range — left unscored.
- **[Monaco] High-tech exports (% of manufactured exports):** World Bank has no TX.VAL.TECH.MF.ZS value for MCO in range — left unscored.
- **[Myanmar] Patent applications, residents:** World Bank has no IP.PAT.RESD value for MMR in range — left unscored.
- **[Nauru] High-tech exports (% of manufactured exports):** World Bank has no TX.VAL.TECH.MF.ZS value for NRU in range — left unscored.
- **[Nauru] ICT Development Index:** No ITU IDI 2024 entry for NRU — not published/not an ITU member — left unscored.
- **[Nauru] Patent applications, residents:** World Bank has no IP.PAT.RESD value for NRU in range — left unscored.
- **[Nauru] R&D expenditure (% GDP):** World Bank has no GB.XPD.RSDV.GD.ZS value for NRU in range — left unscored.
- **[Nepal] ICT Development Index:** No ITU IDI 2024 entry for NPL — not published/not an ITU member — left unscored.
- **[Niger] ICT Development Index:** No ITU IDI 2024 entry for NER — not published/not an ITU member — left unscored.
- **[Niger] Patent applications, residents:** World Bank has no IP.PAT.RESD value for NER in range — left unscored.
- **[Niger] R&D expenditure (% GDP):** World Bank has no GB.XPD.RSDV.GD.ZS value for NER in range — left unscored.
- **[North Korea] High-tech exports (% of manufactured exports):** World Bank has no TX.VAL.TECH.MF.ZS value for PRK in range — left unscored.
- **[North Korea] ICT Development Index:** No ITU IDI 2024 entry for PRK — not published/not an ITU member — left unscored.
- **[North Korea] R&D expenditure (% GDP):** World Bank has no GB.XPD.RSDV.GD.ZS value for PRK in range — left unscored.
- **[Palau] ICT Development Index:** No ITU IDI 2024 entry for PLW — not published/not an ITU member — left unscored.
- **[Palau] Patent applications, residents:** World Bank has no IP.PAT.RESD value for PLW in range — left unscored.
- **[Palau] R&D expenditure (% GDP):** World Bank has no GB.XPD.RSDV.GD.ZS value for PLW in range — left unscored.
- **[Papua New Guinea] ICT Development Index:** No ITU IDI 2024 entry for PNG — not published/not an ITU member — left unscored.
- **[Saint Kitts and Nevis] Patent applications, residents:** World Bank has no IP.PAT.RESD value for KNA in range — left unscored.
- **[Saint Kitts and Nevis] R&D expenditure (% GDP):** World Bank has no GB.XPD.RSDV.GD.ZS value for KNA in range — left unscored.
- **[Saint Lucia] R&D expenditure (% GDP):** World Bank has no GB.XPD.RSDV.GD.ZS value for LCA in range — left unscored.
- **[Saint Vincent and the Grenadines] Patent applications, residents:** World Bank has no IP.PAT.RESD value for VCT in range — left unscored.
- **[Samoa] R&D expenditure (% GDP):** World Bank has no GB.XPD.RSDV.GD.ZS value for WSM in range — left unscored.
- **[San Marino] High-tech exports (% of manufactured exports):** World Bank has no TX.VAL.TECH.MF.ZS value for SMR in range — left unscored.
- **[San Marino] R&D expenditure (% GDP):** World Bank has no GB.XPD.RSDV.GD.ZS value for SMR in range — left unscored.
- **[Sao Tome and Principe] Patent applications, residents:** World Bank has no IP.PAT.RESD value for STP in range — left unscored.
- **[Sao Tome and Principe] R&D expenditure (% GDP):** World Bank has no GB.XPD.RSDV.GD.ZS value for STP in range — left unscored.
- **[Senegal] Patent applications, residents:** World Bank has no IP.PAT.RESD value for SEN in range — left unscored.
- **[Sierra Leone] Patent applications, residents:** World Bank has no IP.PAT.RESD value for SLE in range — left unscored.
- **[Sierra Leone] R&D expenditure (% GDP):** World Bank has no GB.XPD.RSDV.GD.ZS value for SLE in range — left unscored.
- **[Solomon Islands] ICT Development Index:** No ITU IDI 2024 entry for SLB — not published/not an ITU member — left unscored.
- **[Solomon Islands] Patent applications, residents:** World Bank has no IP.PAT.RESD value for SLB in range — left unscored.
- **[Solomon Islands] R&D expenditure (% GDP):** World Bank has no GB.XPD.RSDV.GD.ZS value for SLB in range — left unscored.
- **[Somalia] High-tech exports (% of manufactured exports):** World Bank has no TX.VAL.TECH.MF.ZS value for SOM in range — left unscored.
- **[Somalia] Patent applications, residents:** World Bank has no IP.PAT.RESD value for SOM in range — left unscored.
- **[Somalia] R&D expenditure (% GDP):** World Bank has no GB.XPD.RSDV.GD.ZS value for SOM in range — left unscored.
- **[South Sudan] High-tech exports (% of manufactured exports):** World Bank has no TX.VAL.TECH.MF.ZS value for SDS in range — left unscored.
- **[South Sudan] ICT Development Index:** No ITU IDI 2024 entry for SDS — not published/not an ITU member — left unscored.
- **[South Sudan] Patent applications, residents:** World Bank has no IP.PAT.RESD value for SDS in range — left unscored.
- **[South Sudan] R&D expenditure (% GDP):** World Bank has no GB.XPD.RSDV.GD.ZS value for SDS in range — left unscored.
- **[Sudan] ICT Development Index:** No ITU IDI 2024 entry for SDN — not published/not an ITU member — left unscored.
- **[Suriname] Patent applications, residents:** World Bank has no IP.PAT.RESD value for SUR in range — left unscored.
- **[Suriname] R&D expenditure (% GDP):** World Bank has no GB.XPD.RSDV.GD.ZS value for SUR in range — left unscored.
- **[Taiwan] ICT Development Index:** No ITU IDI 2024 entry for Taiwan — not published/not an ITU member — left unscored.
- **[Tajikistan] ICT Development Index:** No ITU IDI 2024 entry for TJK — not published/not an ITU member — left unscored.
- **[Timor-Leste] Patent applications, residents:** World Bank has no IP.PAT.RESD value for TLS in range — left unscored.
- **[Timor-Leste] R&D expenditure (% GDP):** World Bank has no GB.XPD.RSDV.GD.ZS value for TLS in range — left unscored.
- **[Togo] Patent applications, residents:** World Bank has no IP.PAT.RESD value for TGO in range — left unscored.
- **[Tonga] Patent applications, residents:** World Bank has no IP.PAT.RESD value for TON in range — left unscored.
- **[Tonga] R&D expenditure (% GDP):** World Bank has no GB.XPD.RSDV.GD.ZS value for TON in range — left unscored.
- **[Turkmenistan] High-tech exports (% of manufactured exports):** World Bank has no TX.VAL.TECH.MF.ZS value for TKM in range — left unscored.
- **[Turkmenistan] ICT Development Index:** No ITU IDI 2024 entry for TKM — not published/not an ITU member — left unscored.
- **[Turkmenistan] Patent applications, residents:** World Bank has no IP.PAT.RESD value for TKM in range — left unscored.
- **[Tuvalu] High-tech exports (% of manufactured exports):** World Bank has no TX.VAL.TECH.MF.ZS value for TUV in range — left unscored.
- **[Tuvalu] ICT Development Index:** No ITU IDI 2024 entry for TUV — not published/not an ITU member — left unscored.
- **[Tuvalu] Patent applications, residents:** World Bank has no IP.PAT.RESD value for TUV in range — left unscored.
- **[Tuvalu] R&D expenditure (% GDP):** World Bank has no GB.XPD.RSDV.GD.ZS value for TUV in range — left unscored.
- **[Vanuatu] High-tech exports (% of manufactured exports):** World Bank has no TX.VAL.TECH.MF.ZS value for VUT in range — left unscored.
- **[Vanuatu] Patent applications, residents:** World Bank has no IP.PAT.RESD value for VUT in range — left unscored.
- **[Vanuatu] R&D expenditure (% GDP):** World Bank has no GB.XPD.RSDV.GD.ZS value for VUT in range — left unscored.
- **[Venezuela] High-tech exports (% of manufactured exports):** World Bank has no TX.VAL.TECH.MF.ZS value for VEN in range — left unscored.
- **[Yemen] R&D expenditure (% GDP):** World Bank has no GB.XPD.RSDV.GD.ZS value for YEM in range — left unscored.
- **[Zimbabwe] R&D expenditure (% GDP):** World Bank has no GB.XPD.RSDV.GD.ZS value for ZWE in range — left unscored.

<!-- END buildTechnology.mjs gap report -->

## Data sourcing (`buildCurrentStatus.mjs`)

<!-- BEGIN buildCurrentStatus.mjs gap report -->

**Generated by `npm run build:current-status` (`scripts/buildCurrentStatus.mjs`), 2026-08-27.** Gleditsch-Ward country codes referenced by UCDP conflict data that couldn't be resolved to a UN-193 Country this run. Re-running the script regenerates this list.

**Standing deviations/limitations** (see scripts/buildCurrentStatus.mjs's own header comment for the full reasoning): `sanctionTier`/`sanctionPrograms` are a hand-maintained static seed (three OFAC tiers — RED/ORANGE/YELLOW — as of 2026-08-27), not a live pull. **RED tier is fully verified** against each program's own OFAC regulatory text (Cuba, Iran, North Korea, Syria). **ORANGE tier** (Russia, Belarus, Venezuela, Myanmar, Sudan, Nicaragua) **and YELLOW tier** (Afghanistan, Central African Republic, Democratic Republic of the Congo, Ethiopia, Iraq, Lebanon, Libya, Mali, Somalia, South Sudan, Yemen) are seeded from secondary-source characterization only — cross-referenced across several independent sanctions-compliance sites, internally consistent, but NOT yet individually checked against each country's own OFAC program page the way RED was, and the `sanctionPrograms` name text for those two tiers is a reasonable approximation of OFAC's naming convention, not copied verbatim from each program's own page either. **TODO before this ships as anything more than portfolio-demo-confidence data: verify every ORANGE/YELLOW tier assignment and program name against https://ofac.treasury.gov/sanctions-programs-and-country-information and each country's own program page.** Separately: this whole dataset is a static seed, not a live pull — **candidate for a live OFAC pull** if this project ever needs sanction-status freshness tighter than "update by hand when it changes." And unrelated to sanctions: the UCDP API (as opposed to the direct CSV downloads this script uses) requires a free but manually-issued access token — not something this script can obtain on its own; if a future need arises for API-only UCDP data (e.g. finer-grained event queries), that token would need to be requested by a human from UCDP's API maintainer first.

- None this run — every referenced Gleditsch-Ward code resolved to a UN-193 Country.

<!-- END buildCurrentStatus.mjs gap report -->

<!-- BEGIN buildCurrentStatus.mjs demographics gap report -->

**Generated by `npm run build:current-status` (`scripts/buildCurrentStatus.mjs`), 2026-08-27.** Countries where the CIA World Factbook's "Ethnic groups"/"Religions" text either had no field at all, or had one but it contained no parseable "<name> <pct>%" clause (see this script's own DEMOGRAPHICS header comment for real examples — free text with no percentages at all, or percentages nested inside a parenthetical aside rather than a top-level clause). Left `undefined`, never fabricated. Re-running the script regenerates this list.

- **[Afghanistan (Factbook fallback)]:** "Ethnic groups" text has no parseable percentages ("current, reliable statistical data on ethnicity in Afghanistan are not available; Afghanistan's 2004 Constitution cited Pashtun, Tajik, Hazara, Uzbek, Turkman, Baluch, Pashaie, Nuristani, Aymaq, Arab, Qirghiz, Qizilbash, Gujur, and Brahwui ethnicities; Afghanistan has dozens of other small ethnic groups") — left unsourced.
- **[Bolivia (ethnicity, UNSD)]:** 2012: largest group is "Unknown" at 58.25% — a generic/residual bucket dominating the result, not a real named group. Deferred to the Factbook fallback instead of storing this (see isDominatedByGenericBucket()'s own comment for the reasoning).
- **[Burundi (Factbook fallback)]:** "Ethnic groups" text has no parseable percentages ("Hutu, Tutsi, Twa, South Asian") — left unsourced.
- **[Colombia (ethnicity, UNSD)]:** 2018: largest group is "Other" at 87.58% — a generic/residual bucket dominating the result, not a real named group. Deferred to the Factbook fallback instead of storing this (see isDominatedByGenericBucket()'s own comment for the reasoning).
- **[Comoros (Factbook fallback)]:** "Ethnic groups" text has no parseable percentages ("Antalote, Cafre, Makoa, Oimatsaha, Sakalava") — left unsourced.
- **[Costa Rica (ethnicity, UNSD)]:** 2011: largest group is "Other" at 94.10% — a generic/residual bucket dominating the result, not a real named group. Deferred to the Factbook fallback instead of storing this (see isDominatedByGenericBucket()'s own comment for the reasoning).
- **[Democratic Republic of the Congo (Factbook fallback)]:** "Ethnic groups" text has no parseable percentages ("more than 200 African ethnic groups of which the majority are Bantu; the four largest groups - Mongo, Luba, Kongo (all Bantu), and the Mangbetu-Azande (Hamitic) - make up about 45% of the population") — left unsourced.
- **[Eswatini (Factbook fallback)]:** "Ethnic groups" text has no parseable percentages ("<p>predominantly Swazi; smaller populations of other African ethnic groups, including the Zulu, as well as people of European ancestry</p>") — left unsourced.
- **[Fiji (ethnicity, UNSD)]:** 2007: duplicate "Total" rows across record types with different values (Census - de facto - complete tabulation: 837271 vs Census - de jure - complete tabulation: 835230) — kept the Census - de jure - complete tabulation figure.
- **[Fiji (ethnicity, UNSD)]:** 2007: duplicate "Fijian" rows across record types with different values (Census - de facto - complete tabulation: 475739 vs Census - de jure - complete tabulation: 475887) — kept the Census - de jure - complete tabulation figure.
- **[Fiji (ethnicity, UNSD)]:** 2007: duplicate "Indian" rows across record types with different values (Census - de facto - complete tabulation: 313798 vs Census - de jure - complete tabulation: 315417) — kept the Census - de jure - complete tabulation figure.
- **[Fiji (ethnicity, UNSD)]:** 2007: duplicate "Rotuman" rows across record types with different values (Census - de facto - complete tabulation: 10335 vs Census - de jure - complete tabulation: 10197) — kept the Census - de jure - complete tabulation figure.
- **[Fiji (ethnicity, UNSD)]:** 2007: duplicate "Other" rows across record types with different values (Census - de facto - complete tabulation: 12312 vs Census - de jure - complete tabulation: 33729) — kept the Census - de jure - complete tabulation figure.
- **[Finland (Factbook fallback)]:** "Ethnic groups" text has no parseable percentages ("Finnish, Swedish, Russian, Estonian, Romani, Sami") — left unsourced.
- **[France (Factbook fallback)]:** "Ethnic groups" text has no parseable percentages ("Celtic and Latin with Teutonic, Slavic, North African (Algerian, Moroccan, Tunisian), Indochinese, Basque minorities") — left unsourced.
- **[Italy (Factbook fallback)]:** "Ethnic groups" text has no parseable percentages ("Italian (includes small clusters of German-, French-, and Slovene-Italians in the north, Albanian-Italians, Croat-Italians, and Greek-Italians in the south)") — left unsourced.
- **[Madagascar (Factbook fallback)]:** "Ethnic groups" text has no parseable percentages ("Malayo-Indonesian (Merina and related Betsileo), Cotiers (mixed African, Malayo-Indonesian, and Arab ancestry - Betsimisaraka, Tsimihety, Antaisaka, Sakalava), French, Indian, Creole, Comoran") — left unsourced.
- **[Maldives (Factbook fallback)]:** "Ethnic groups" text has no parseable percentages ("homogeneous mixture of Sinhalese, Dravidian, Arab, Australasian, and African resulting from historical changes in regional hegemony over marine trade routes") — left unsourced.
- **[Malta (Factbook fallback)]:** "Ethnic groups" text has no parseable percentages ("Maltese (descendants of ancient Carthaginians and Phoenicians with strong elements of Italian and other Mediterranean stock)") — left unsourced.
- **[Mauritius (Factbook fallback)]:** "Ethnic groups" text has no parseable percentages ("Indo-Mauritian (compose approximately two thirds of the total population), Creole, Sino-Mauritian, Franco-Mauritian") — left unsourced.
- **[North Korea (Factbook fallback)]:** "Ethnic groups" text has no parseable percentages ("racially homogeneous; there is a small Chinese community and a few ethnic Japanese") — left unsourced.
- **[Oman (Factbook fallback)]:** "Ethnic groups" text has no parseable percentages ("Arab, Baluchi, South Asian (Indian, Pakistani, Sri Lankan, Bangladeshi), African") — left unsourced.
- **[Papua New Guinea (Factbook fallback)]:** "Ethnic groups" text has no parseable percentages ("Melanesian, Papuan, Negrito, Micronesian, Polynesian") — left unsourced.
- **[Poland (ethnicity, UNSD)]:** 2021: largest group is "Other" at 98.19% — a generic/residual bucket dominating the result, not a real named group. Deferred to the Factbook fallback instead of storing this (see isDominatedByGenericBucket()'s own comment for the reasoning).
- **[Rwanda (Factbook fallback)]:** "Ethnic groups" text has no parseable percentages ("Hutu, Tutsi, Twa") — left unsourced.
- **[San Marino (Factbook fallback)]:** "Ethnic groups" text has no parseable percentages ("Sammarinese, Italian") — left unsourced.
- **[Sao Tome and Principe (Factbook fallback)]:** "Ethnic groups" text has no parseable percentages ("Mestico, Angolares (descendants of Angolan slaves), Forros (descendants of freed slaves), Servicais (contract laborers from Angola, Mozambique, and Cabo Verde), Tongas (children of servicais born on the islands), Europeans (primarily Portuguese), Asians (mostly Chinese)") — left unsourced.
- **[Seychelles (Factbook fallback)]:** "Ethnic groups" text has no parseable percentages ("predominantly Creole (mainly of East African and Malagasy heritage); also French, Indian, Chinese, and Arab populations") — left unsourced.
- **[Somalia (Factbook fallback)]:** "Ethnic groups" text has no parseable percentages ("predominantly Somali with lesser numbers of Arabs, Bantus, and others") — left unsourced.
- **[South Korea (Factbook fallback)]:** "Ethnic groups" text has no parseable percentages ("Korean") — left unsourced.
- **[South Sudan (Factbook fallback)]:** No factbook.json path resolved for this country — left unsourced.
- **[Sudan (Factbook fallback)]:** "Ethnic groups" text has no parseable percentages ("Sudanese Arab (approximately 70%), Fur, Beja, Nuba, Ingessana, Uduk, Fallata, Masalit, Dajo, Gimir, Tunjur, Berti; there are over 500 ethnic groups") — left unsourced.
- **[Syria (Factbook fallback)]:** "Ethnic groups" text has no parseable percentages ("Arab ~50%, Alawite ~15%, Kurd ~10%, Levantine ~10%, other ~15% (includes Druze, Ismaili, Imami, Nusairi, Assyrian, Turkoman, Armenian)") — left unsourced.
- **[Timor-Leste (Factbook fallback)]:** "Ethnic groups" text has no parseable percentages ("Austronesian (Malayo-Polynesian) (includes Tetun, Mambai, Tokodede, Galoli, Kemak, Baikeno), Melanesian-Papuan (includes Bunak, Fataluku, Bakasai), small Chinese minority") — left unsourced.
- **[Venezuela (Factbook fallback)]:** "Ethnic groups" text has no parseable percentages ("unspecified Spanish, Italian, Portuguese, Arab, German, African, Indigenous") — left unsourced.
- **[Yemen (Factbook fallback)]:** "Ethnic groups" text has no parseable percentages ("predominantly Arab; but also Afro-Arab, South Asian, European") — left unsourced.

<!-- END buildCurrentStatus.mjs demographics gap report -->

## Data sourcing (`buildEconomy.mjs`)

<!-- BEGIN buildEconomy.mjs gap report -->

**Generated by `npm run build:economy` (`scripts/buildEconomy.mjs`), 2026-08-23.** Economy category component fields that couldn't be sourced cleanly this run — left unscored, not guessed. Re-running the script regenerates this list.

**Tie-handling convention** (see scripts/buildEconomy.mjs's own header comment): percentile rank uses average/fractional rank for ties, confirmed with the user before this script was written, per Intelligence Docs/buildEconomy-prompt.md's explicit "stop and ask before picking a tie-breaking convention" instruction.

- **[Andorra] inflation (CPI):** World Bank has no FP.CPI.TOTL.ZG value for AND in range — left unscored.
- **[Andorra] unemployment rate:** World Bank has no SL.UEM.TOTL.ZS value for AND in range — left unscored.
- **[Antigua and Barbuda] unemployment rate:** World Bank has no SL.UEM.TOTL.ZS value for ATG in range — left unscored.
- **[Cuba] GDP per capita PPP:** World Bank has no NY.GDP.PCAP.PP.CD value for CUB in range — left unscored.
- **[Cuba] inflation (CPI):** World Bank has no FP.CPI.TOTL.ZG value for CUB in range — left unscored.
- **[Dominica] unemployment rate:** World Bank has no SL.UEM.TOTL.ZS value for DMA in range — left unscored.
- **[Eritrea] inflation (CPI):** World Bank has no FP.CPI.TOTL.ZG value for ERI in range — left unscored.
- **[Grenada] unemployment rate:** World Bank has no SL.UEM.TOTL.ZS value for GRD in range — left unscored.
- **[Kiribati] unemployment rate:** World Bank has no SL.UEM.TOTL.ZS value for KIR in range — left unscored.
- **[Liechtenstein] GDP per capita PPP:** World Bank has no NY.GDP.PCAP.PP.CD value for LIE in range — left unscored.
- **[Liechtenstein] inflation (CPI):** World Bank has no FP.CPI.TOTL.ZG value for LIE in range — left unscored.
- **[Liechtenstein] unemployment rate:** World Bank has no SL.UEM.TOTL.ZS value for LIE in range — left unscored.
- **[Marshall Islands] inflation (CPI):** World Bank has no FP.CPI.TOTL.ZG value for MHL in range — left unscored.
- **[Marshall Islands] unemployment rate:** World Bank has no SL.UEM.TOTL.ZS value for MHL in range — left unscored.
- **[Micronesia] unemployment rate:** World Bank has no SL.UEM.TOTL.ZS value for FSM in range — left unscored.
- **[Monaco] GDP per capita PPP:** World Bank has no NY.GDP.PCAP.PP.CD value for MCO in range — left unscored.
- **[Monaco] inflation (CPI):** World Bank has no FP.CPI.TOTL.ZG value for MCO in range — left unscored.
- **[Monaco] unemployment rate:** World Bank has no SL.UEM.TOTL.ZS value for MCO in range — left unscored.
- **[Nauru] unemployment rate:** World Bank has no SL.UEM.TOTL.ZS value for NRU in range — left unscored.
- **[North Korea] GDP (nominal):** World Bank has no NY.GDP.MKTP.CD value for PRK in range — left unscored.
- **[North Korea] GDP growth (5yr avg):** World Bank has no NY.GDP.MKTP.KD.ZG values for PRK in range — left unscored.
- **[North Korea] GDP per capita PPP:** World Bank has no NY.GDP.PCAP.PP.CD value for PRK in range — left unscored.
- **[North Korea] inflation (CPI):** World Bank has no FP.CPI.TOTL.ZG value for PRK in range — left unscored.
- **[Palau] unemployment rate:** World Bank has no SL.UEM.TOTL.ZS value for PLW in range — left unscored.
- **[Saint Kitts and Nevis] unemployment rate:** World Bank has no SL.UEM.TOTL.ZS value for KNA in range — left unscored.
- **[San Marino] unemployment rate:** World Bank has no SL.UEM.TOTL.ZS value for SMR in range — left unscored.
- **[Seychelles] unemployment rate:** World Bank has no SL.UEM.TOTL.ZS value for SYC in range — left unscored.
- **[Somalia] inflation (CPI):** World Bank has no FP.CPI.TOTL.ZG value for SOM in range — left unscored.
- **[South Sudan] GDP (nominal):** World Bank has no NY.GDP.MKTP.CD value for SDS in range — left unscored.
- **[South Sudan] GDP growth (5yr avg):** World Bank has no NY.GDP.MKTP.KD.ZG values for SDS in range — left unscored.
- **[South Sudan] GDP per capita PPP:** World Bank has no NY.GDP.PCAP.PP.CD value for SDS in range — left unscored.
- **[South Sudan] inflation (CPI):** World Bank has no FP.CPI.TOTL.ZG value for SDS in range — left unscored.
- **[South Sudan] unemployment rate:** World Bank has no SL.UEM.TOTL.ZS value for SDS in range — left unscored.
- **[Turkmenistan] inflation (CPI):** World Bank has no FP.CPI.TOTL.ZG value for TKM in range — left unscored.
- **[Tuvalu] unemployment rate:** World Bank has no SL.UEM.TOTL.ZS value for TUV in range — left unscored.

<!-- END buildEconomy.mjs gap report -->

## Data sourcing (`buildMilitary.mjs`)

<!-- BEGIN buildMilitary.mjs gap report -->

**Generated by `npm run build:military` (`scripts/buildMilitary.mjs`), 2026-08-26.** Military category coverage-gap fields (expenditure/%GDP/personnel) that couldn't be sourced cleanly this run — left unscored, not guessed. Re-running the script regenerates this list.

**Standing deviations from the locked design** (see scripts/buildMilitary.mjs's own header comment for the full reasoning): Air fleet size (component #5, FlightGlobal) is not implemented — the source is a paid subscription paywall with no free/citable equivalent found. Arms import/export dependency (component #7, SIPRI TIV) was demoted 2026-08-20 from a scored component to a non-scoring annotation — the `100 - normalized` inversion assumed low import volume signals resilience, but that direction doesn't reliably hold once alliance-embedded procurement (reads as "import-dependent" the same as genuine exposure) and too-small-to-import micro-states (score identically to genuinely self-sufficient ones) are both in the data, and this project doesn't source the supplier-diversity/alliance-context data that would be needed to tell them apart. Still sourced and displayed (see `annotations.armsImportTiv` in src/data/militaryScores.ts), just not blended into `value`. Coverage floor/confidence tiers were revised to 3 coverage-gap components (>= 2 of 3 present) accordingly.

**No-standing-military override list** (see `NO_STANDING_MILITARY` in scripts/buildMilitary.mjs): expanded 2026-08-20 from the original 3 (Costa Rica, Panama, Iceland) to 17, using worldpopulationreview.com's "Countries Without a Military" table as a candidate list only — each candidate was individually re-verified against factbook.json before being added, per the design doc's sourcing requirement. Two findings from that verification pass, kept here rather than silently resolved: **San Marino** appears on WPR's list but was REJECTED — factbook.json names a real, currently-serving military (the "San Marino Military Corps"), so WPR is wrong about it. **Solomon Islands, Marshall Islands, and Kiribati** are DEFERRED, not added — factbook.json lists only a police force for each (same shape as the 17 confirmed countries) but without that source's own explicit "no regular military forces" disclaimer phrase, so this is a genuine ambiguity needing a human sourcing call (e.g. checking each country's constitution directly), not a guess in either direction.

- **[Antigua and Barbuda] %GDP:** World Bank has no MS.MIL.XPND.GD.ZS value for ATG in range — left unscored.
- **[Antigua and Barbuda] expenditure:** Not present in SIPRI Milex xlsx (name unmatched or genuinely absent) — left unscored.
- **[Bahamas] %GDP:** World Bank has no MS.MIL.XPND.GD.ZS value for BHS in range — left unscored.
- **[Bahamas] expenditure:** Not present in SIPRI Milex xlsx (name unmatched or genuinely absent) — left unscored.
- **[Barbados] %GDP:** World Bank has no MS.MIL.XPND.GD.ZS value for BRB in range — left unscored.
- **[Barbados] expenditure:** Not present in SIPRI Milex xlsx (name unmatched or genuinely absent) — left unscored.
- **[Bhutan] %GDP:** World Bank has no MS.MIL.XPND.GD.ZS value for BTN in range — left unscored.
- **[Bhutan] expenditure:** Not present in SIPRI Milex xlsx (name unmatched or genuinely absent) — left unscored.
- **[Comoros] %GDP:** World Bank has no MS.MIL.XPND.GD.ZS value for COM in range — left unscored.
- **[Comoros] expenditure:** Not present in SIPRI Milex xlsx (name unmatched or genuinely absent) — left unscored.
- **[Kiribati] %GDP:** World Bank has no MS.MIL.XPND.GD.ZS value for KIR in range — left unscored.
- **[Kiribati] expenditure:** Not present in SIPRI Milex xlsx (name unmatched or genuinely absent) — left unscored.
- **[Kiribati] personnel:** No WDI value and no factbook.json personnel-strengths text — left unscored.
- **[Maldives] %GDP:** World Bank has no MS.MIL.XPND.GD.ZS value for MDV in range — left unscored.
- **[Maldives] expenditure:** Not present in SIPRI Milex xlsx (name unmatched or genuinely absent) — left unscored.
- **[Marshall Islands] %GDP:** World Bank has no MS.MIL.XPND.GD.ZS value for MHL in range — left unscored.
- **[Marshall Islands] expenditure:** Not present in SIPRI Milex xlsx (name unmatched or genuinely absent) — left unscored.
- **[Marshall Islands] personnel:** No WDI value and no factbook.json personnel-strengths text — left unscored.
- **[North Korea] %GDP:** World Bank has no MS.MIL.XPND.GD.ZS value for PRK in range — left unscored.
- **[Saint Kitts and Nevis] %GDP:** World Bank has no MS.MIL.XPND.GD.ZS value for KNA in range — left unscored.
- **[Saint Kitts and Nevis] expenditure:** Not present in SIPRI Milex xlsx (name unmatched or genuinely absent) — left unscored.
- **[San Marino] %GDP:** World Bank has no MS.MIL.XPND.GD.ZS value for SMR in range — left unscored.
- **[San Marino] expenditure:** Not present in SIPRI Milex xlsx (name unmatched or genuinely absent) — left unscored.
- **[San Marino] personnel:** No WDI value and no factbook.json personnel-strengths text — left unscored.
- **[Sao Tome and Principe] %GDP:** World Bank has no MS.MIL.XPND.GD.ZS value for STP in range — left unscored.
- **[Sao Tome and Principe] expenditure:** Not present in SIPRI Milex xlsx (name unmatched or genuinely absent) — left unscored.
- **[Solomon Islands] %GDP:** World Bank has no MS.MIL.XPND.GD.ZS value for SLB in range — left unscored.
- **[Solomon Islands] expenditure:** Not present in SIPRI Milex xlsx (name unmatched or genuinely absent) — left unscored.
- **[Solomon Islands] personnel:** No WDI value and no factbook.json personnel-strengths text — left unscored.
- **[South Sudan] %GDP:** World Bank has no MS.MIL.XPND.GD.ZS value for SDS in range — left unscored.
- **[South Sudan] personnel:** No WDI value and no factbook.json path resolved — left unscored.
- **[Suriname] %GDP:** World Bank has no MS.MIL.XPND.GD.ZS value for SUR in range — left unscored.
- **[Suriname] expenditure:** Not present in SIPRI Milex xlsx (name unmatched or genuinely absent) — left unscored.
- **[Tonga] %GDP:** World Bank has no MS.MIL.XPND.GD.ZS value for TON in range — left unscored.
- **[Tonga] expenditure:** Not present in SIPRI Milex xlsx (name unmatched or genuinely absent) — left unscored.
- **[Turkmenistan] %GDP:** World Bank has no MS.MIL.XPND.GD.ZS value for TKM in range — left unscored.
- **[Turkmenistan] expenditure:** Not present in SIPRI Milex xlsx (name unmatched or genuinely absent) — left unscored.

<!-- END buildMilitary.mjs gap report -->

## Intelligence Engine — Technology sourcing

- **Advanced Industry component (semiconductor/aerospace/robotics/biotech
  capability)** — backlogged 2026-08-25. No single named public dataset covers this
  combination of sub-sectors as one composite. Would need per-sector sourcing
  (semiconductor fab capacity, aerospace export value, industrial robot installations,
  etc.), each independently vetted against the citation bar Military's naval/ground
  equipment and air-fleet items were already ruled out against. Not source-by-source
  investigated yet — that's the actual next step when this is picked back up.

## Data sourcing (`buildGeoEntityEconomics.mjs`)

<!-- BEGIN buildGeoEntityEconomics.mjs gap report -->

**Generated by `npm run build:geo-entity-economics` (`scripts/buildGeoEntityEconomics.mjs`), 2026-08-26.** This script only ever writes a report (scripts/geoEntityEconomicsReport.json) and never edits src/data/registry/geoEntities.ts directly — the items below are what a human still needs to act on, or accept as a permanent gap. Re-running the script regenerates this list — don't hand-edit it.

- **Resolved outside this script, still WDI-skipped (no WDI code exists for either):**
  - **[taiwan]:** World Bank WDI structurally excludes Taiwan (China's WDI figures already claim to represent "one China"). RESOLVED 2026-08-26 — population/gdpUsd are now sourced directly, by hand, from IMF World Economic Outlook in geoEntities.ts's own Taiwan entry (see CLAUDE.md's Intelligence Engine section), not by this script.

- **Deliberately deferred this pass, needs its own sourcing decision:**
  - **[western-sahara]:** Administration is contested (Morocco west of the berm, the Polisario Front/SADR east of it) — no single WDI query is an uncontroversial answer to "population of Western Sahara."
  - **[crimea]:** Administration is contested (Russian de facto control since 2014, not internationally recognized) — same problem as Western Sahara, no single source's figure is uncontroversial.

- **WDI has one figure but not the other (population OR gdp, not both):**
  - **[british-virgin-islands] gdp:** No WDI NY.GDP.MKTP.CD data for VGB in 2000-2024 — left unscored.
  - **[gibraltar] gdp:** No WDI NY.GDP.MKTP.CD data for GIB in 2000-2024 — left unscored.

- **No WDI data at all (population AND gdp), 16 entities — genuinely not tracked by WDI, not just "not reported yet":**
  - [aland] (ALA)
  - [anguilla] (AIA)
  - [british-indian-ocean-territory] (IOT)
  - [cook-islands] (COK)
  - [falkland-islands] (FLK)
  - [french-southern-and-antarctic-lands] (ATF)
  - [guernsey] (GGY)
  - [jersey] (JEY)
  - [montserrat] (MSR)
  - [niue] (NIU)
  - [norfolk-island] (NFK)
  - [pitcairn-islands] (PCN)
  - [saint-barthelemy] (BLM)
  - [saint-helena] (SHN)
  - [saint-pierre-and-miquelon] (SPM)
  - [wallis-and-futuna] (WLF)

<!-- END buildGeoEntityEconomics.mjs gap report -->

## Data sourcing (`buildGovCapitalPopGdp.mjs`)

<!-- BEGIN buildGovCapitalPopGdp.mjs gap report -->

**Generated by `npm run build:profiles` (`scripts/buildGovCapitalPopGdp.mjs`), 2026-08-14.** Every field below couldn't be sourced cleanly from World Bank/factbook.json this run: either it fell back to countryProfiles.ts's prior value (capital/government), cited an older year than 2024 explicitly (population/GDP — see countryEconomics.ts's populationYear/gdpYear), or was left unscored entirely (a genuine gap in the source, no figure at any year in the lookback window). Re-running the script regenerates this list — don't hand-edit it.

- **[Afghanistan] area:** World Bank's most recent AG.LND.TOTL.K2 figure for AFG is 2023 (no 2024 figure reported yet) — cited explicitly as 2023 rather than backfilled as current.
- **[Albania] area:** World Bank's most recent AG.LND.TOTL.K2 figure for ALB is 2023 (no 2024 figure reported yet) — cited explicitly as 2023 rather than backfilled as current.
- **[Algeria] area:** World Bank's most recent AG.LND.TOTL.K2 figure for DZA is 2023 (no 2024 figure reported yet) — cited explicitly as 2023 rather than backfilled as current.
- **[Andorra] area:** World Bank's most recent AG.LND.TOTL.K2 figure for AND is 2023 (no 2024 figure reported yet) — cited explicitly as 2023 rather than backfilled as current.
- **[Angola] area:** World Bank's most recent AG.LND.TOTL.K2 figure for AGO is 2023 (no 2024 figure reported yet) — cited explicitly as 2023 rather than backfilled as current.
- **[Antigua and Barbuda] area:** World Bank's most recent AG.LND.TOTL.K2 figure for ATG is 2023 (no 2024 figure reported yet) — cited explicitly as 2023 rather than backfilled as current.
- **[Argentina] area:** World Bank's most recent AG.LND.TOTL.K2 figure for ARG is 2023 (no 2024 figure reported yet) — cited explicitly as 2023 rather than backfilled as current.
- **[Armenia] area:** World Bank's most recent AG.LND.TOTL.K2 figure for ARM is 2023 (no 2024 figure reported yet) — cited explicitly as 2023 rather than backfilled as current.
- **[Australia] area:** World Bank's most recent AG.LND.TOTL.K2 figure for AUS is 2023 (no 2024 figure reported yet) — cited explicitly as 2023 rather than backfilled as current.
- **[Austria] area:** World Bank's most recent AG.LND.TOTL.K2 figure for AUT is 2023 (no 2024 figure reported yet) — cited explicitly as 2023 rather than backfilled as current.
- **[Azerbaijan] area:** World Bank's most recent AG.LND.TOTL.K2 figure for AZE is 2023 (no 2024 figure reported yet) — cited explicitly as 2023 rather than backfilled as current.
- **[Bahamas] area:** World Bank's most recent AG.LND.TOTL.K2 figure for BHS is 2023 (no 2024 figure reported yet) — cited explicitly as 2023 rather than backfilled as current.
- **[Bahrain] area:** World Bank's most recent AG.LND.TOTL.K2 figure for BHR is 2023 (no 2024 figure reported yet) — cited explicitly as 2023 rather than backfilled as current.
- **[Bangladesh] area:** World Bank's most recent AG.LND.TOTL.K2 figure for BGD is 2023 (no 2024 figure reported yet) — cited explicitly as 2023 rather than backfilled as current.
- **[Barbados] area:** World Bank's most recent AG.LND.TOTL.K2 figure for BRB is 2023 (no 2024 figure reported yet) — cited explicitly as 2023 rather than backfilled as current.
- **[Belarus] area:** World Bank's most recent AG.LND.TOTL.K2 figure for BLR is 2023 (no 2024 figure reported yet) — cited explicitly as 2023 rather than backfilled as current.
- **[Belgium] area:** World Bank's most recent AG.LND.TOTL.K2 figure for BEL is 2023 (no 2024 figure reported yet) — cited explicitly as 2023 rather than backfilled as current.
- **[Belize] area:** World Bank's most recent AG.LND.TOTL.K2 figure for BLZ is 2023 (no 2024 figure reported yet) — cited explicitly as 2023 rather than backfilled as current.
- **[Benin] area:** World Bank's most recent AG.LND.TOTL.K2 figure for BEN is 2023 (no 2024 figure reported yet) — cited explicitly as 2023 rather than backfilled as current.
- **[Benin] capital:** factbook.json lists multiple/non-standard capitals ("Porto-Novo (constitutional capital); Cotonou (seat of government)") with only one coordinate pair — kept prior capital "Porto-Novo"; needs a human call on which is the capital of record.
- **[Bhutan] area:** World Bank's most recent AG.LND.TOTL.K2 figure for BTN is 2023 (no 2024 figure reported yet) — cited explicitly as 2023 rather than backfilled as current.
- **[Bolivia] area:** World Bank's most recent AG.LND.TOTL.K2 figure for BOL is 2023 (no 2024 figure reported yet) — cited explicitly as 2023 rather than backfilled as current.
- **[Bolivia] capital:** factbook.json lists multiple/non-standard capitals ("La Paz (administrative capital); Sucre (constitutional [legislative and judicial] capital)") with only one coordinate pair — kept prior capital "La Paz"; needs a human call on which is the capital of record.
- **[Bosnia and Herzegovina] area:** World Bank's most recent AG.LND.TOTL.K2 figure for BIH is 2023 (no 2024 figure reported yet) — cited explicitly as 2023 rather than backfilled as current.
- **[Botswana] area:** World Bank's most recent AG.LND.TOTL.K2 figure for BWA is 2023 (no 2024 figure reported yet) — cited explicitly as 2023 rather than backfilled as current.
- **[Brazil] area:** World Bank's most recent AG.LND.TOTL.K2 figure for BRA is 2023 (no 2024 figure reported yet) — cited explicitly as 2023 rather than backfilled as current.
- **[Brunei] area:** World Bank's most recent AG.LND.TOTL.K2 figure for BRN is 2023 (no 2024 figure reported yet) — cited explicitly as 2023 rather than backfilled as current.
- **[Bulgaria] area:** World Bank's most recent AG.LND.TOTL.K2 figure for BGR is 2023 (no 2024 figure reported yet) — cited explicitly as 2023 rather than backfilled as current.
- **[Burkina Faso] area:** World Bank's most recent AG.LND.TOTL.K2 figure for BFA is 2023 (no 2024 figure reported yet) — cited explicitly as 2023 rather than backfilled as current.
- **[Burundi] area:** World Bank's most recent AG.LND.TOTL.K2 figure for BDI is 2023 (no 2024 figure reported yet) — cited explicitly as 2023 rather than backfilled as current.
- **[Cabo Verde] area:** World Bank's most recent AG.LND.TOTL.K2 figure for CPV is 2023 (no 2024 figure reported yet) — cited explicitly as 2023 rather than backfilled as current.
- **[Cambodia] area:** World Bank's most recent AG.LND.TOTL.K2 figure for KHM is 2023 (no 2024 figure reported yet) — cited explicitly as 2023 rather than backfilled as current.
- **[Cameroon] area:** World Bank's most recent AG.LND.TOTL.K2 figure for CMR is 2023 (no 2024 figure reported yet) — cited explicitly as 2023 rather than backfilled as current.
- **[Canada] area:** World Bank's most recent AG.LND.TOTL.K2 figure for CAN is 2023 (no 2024 figure reported yet) — cited explicitly as 2023 rather than backfilled as current.
- **[Central African Republic] area:** World Bank's most recent AG.LND.TOTL.K2 figure for CAF is 2023 (no 2024 figure reported yet) — cited explicitly as 2023 rather than backfilled as current.
- **[Chad] area:** World Bank's most recent AG.LND.TOTL.K2 figure for TCD is 2023 (no 2024 figure reported yet) — cited explicitly as 2023 rather than backfilled as current.
- **[Chile] area:** World Bank's most recent AG.LND.TOTL.K2 figure for CHL is 2023 (no 2024 figure reported yet) — cited explicitly as 2023 rather than backfilled as current.
- **[Chile] capital:** factbook.json lists multiple/non-standard capitals ("Santiago; note - Valparaiso is the seat of the national legislature") with only one coordinate pair — kept prior capital "Santiago"; needs a human call on which is the capital of record.
- **[China] area:** World Bank's most recent AG.LND.TOTL.K2 figure for CHN is 2023 (no 2024 figure reported yet) — cited explicitly as 2023 rather than backfilled as current.
- **[Colombia] area:** World Bank's most recent AG.LND.TOTL.K2 figure for COL is 2023 (no 2024 figure reported yet) — cited explicitly as 2023 rather than backfilled as current.
- **[Comoros] area:** World Bank's most recent AG.LND.TOTL.K2 figure for COM is 2023 (no 2024 figure reported yet) — cited explicitly as 2023 rather than backfilled as current.
- **[Congo] area:** World Bank's most recent AG.LND.TOTL.K2 figure for COG is 2023 (no 2024 figure reported yet) — cited explicitly as 2023 rather than backfilled as current.
- **[Costa Rica] area:** World Bank's most recent AG.LND.TOTL.K2 figure for CRI is 2023 (no 2024 figure reported yet) — cited explicitly as 2023 rather than backfilled as current.
- **[Côte d'Ivoire] area:** World Bank's most recent AG.LND.TOTL.K2 figure for CIV is 2023 (no 2024 figure reported yet) — cited explicitly as 2023 rather than backfilled as current.
- **[Côte d'Ivoire] capital:** factbook.json lists multiple/non-standard capitals ("Yamoussoukro (legislative capital), Abidjan (administrative and economic capital); note - the US Embassy is in Abidjan") with only one coordinate pair — kept prior capital "Yamoussoukro"; needs a human call on which is the capital of record.
- **[Croatia] area:** World Bank's most recent AG.LND.TOTL.K2 figure for HRV is 2023 (no 2024 figure reported yet) — cited explicitly as 2023 rather than backfilled as current.
- **[Cuba] area:** World Bank's most recent AG.LND.TOTL.K2 figure for CUB is 2023 (no 2024 figure reported yet) — cited explicitly as 2023 rather than backfilled as current.
- **[Cuba] gdp:** World Bank's most recent NY.GDP.MKTP.CD figure for CUB is 2020 (no 2024 figure reported yet) — cited explicitly as 2020 rather than backfilled as current.
- **[Cyprus] area:** World Bank's most recent AG.LND.TOTL.K2 figure for CYP is 2023 (no 2024 figure reported yet) — cited explicitly as 2023 rather than backfilled as current.
- **[Czechia] area:** World Bank's most recent AG.LND.TOTL.K2 figure for CZE is 2023 (no 2024 figure reported yet) — cited explicitly as 2023 rather than backfilled as current.
- **[Democratic Republic of the Congo] area:** World Bank's most recent AG.LND.TOTL.K2 figure for COD is 2023 (no 2024 figure reported yet) — cited explicitly as 2023 rather than backfilled as current.
- **[Denmark] area:** World Bank's most recent AG.LND.TOTL.K2 figure for DNK is 2023 (no 2024 figure reported yet) — cited explicitly as 2023 rather than backfilled as current.
- **[Djibouti] area:** World Bank's most recent AG.LND.TOTL.K2 figure for DJI is 2023 (no 2024 figure reported yet) — cited explicitly as 2023 rather than backfilled as current.
- **[Dominica] area:** World Bank's most recent AG.LND.TOTL.K2 figure for DMA is 2023 (no 2024 figure reported yet) — cited explicitly as 2023 rather than backfilled as current.
- **[Dominican Republic] area:** World Bank's most recent AG.LND.TOTL.K2 figure for DOM is 2023 (no 2024 figure reported yet) — cited explicitly as 2023 rather than backfilled as current.
- **[Ecuador] area:** World Bank's most recent AG.LND.TOTL.K2 figure for ECU is 2023 (no 2024 figure reported yet) — cited explicitly as 2023 rather than backfilled as current.
- **[Egypt] area:** World Bank's most recent AG.LND.TOTL.K2 figure for EGY is 2023 (no 2024 figure reported yet) — cited explicitly as 2023 rather than backfilled as current.
- **[El Salvador] area:** World Bank's most recent AG.LND.TOTL.K2 figure for SLV is 2023 (no 2024 figure reported yet) — cited explicitly as 2023 rather than backfilled as current.
- **[Equatorial Guinea] area:** World Bank's most recent AG.LND.TOTL.K2 figure for GNQ is 2023 (no 2024 figure reported yet) — cited explicitly as 2023 rather than backfilled as current.
- **[Equatorial Guinea] capital:** factbook.json lists multiple/non-standard capitals ("Malabo; note - Malabo is on the island of Bioko; some months of the year, the government operates out of Bata on the mainland region.") with only one coordinate pair — kept prior capital "Malabo"; needs a human call on which is the capital of record.
- **[Eritrea] area:** World Bank's most recent AG.LND.TOTL.K2 figure for ERI is 2023 (no 2024 figure reported yet) — cited explicitly as 2023 rather than backfilled as current.
- **[Eritrea] gdp:** World Bank's most recent NY.GDP.MKTP.CD figure for ERI is 2011 (no 2024 figure reported yet) — cited explicitly as 2011 rather than backfilled as current.
- **[Estonia] area:** World Bank's most recent AG.LND.TOTL.K2 figure for EST is 2023 (no 2024 figure reported yet) — cited explicitly as 2023 rather than backfilled as current.
- **[Eswatini] area:** World Bank's most recent AG.LND.TOTL.K2 figure for SWZ is 2023 (no 2024 figure reported yet) — cited explicitly as 2023 rather than backfilled as current.
- **[Eswatini] capital:** factbook.json lists multiple/non-standard capitals ("Mbabane (administrative capital); Lobamba (royal and legislative capital)") with only one coordinate pair — kept prior capital "Mbabane"; needs a human call on which is the capital of record.
- **[Ethiopia] area:** World Bank's most recent AG.LND.TOTL.K2 figure for ETH is 2023 (no 2024 figure reported yet) — cited explicitly as 2023 rather than backfilled as current.
- **[Fiji] area:** World Bank's most recent AG.LND.TOTL.K2 figure for FJI is 2023 (no 2024 figure reported yet) — cited explicitly as 2023 rather than backfilled as current.
- **[Finland] area:** World Bank's most recent AG.LND.TOTL.K2 figure for FIN is 2023 (no 2024 figure reported yet) — cited explicitly as 2023 rather than backfilled as current.
- **[France] area:** World Bank's most recent AG.LND.TOTL.K2 figure for FRA is 2023 (no 2024 figure reported yet) — cited explicitly as 2023 rather than backfilled as current.
- **[Gabon] area:** World Bank's most recent AG.LND.TOTL.K2 figure for GAB is 2023 (no 2024 figure reported yet) — cited explicitly as 2023 rather than backfilled as current.
- **[Gambia] area:** World Bank's most recent AG.LND.TOTL.K2 figure for GMB is 2023 (no 2024 figure reported yet) — cited explicitly as 2023 rather than backfilled as current.
- **[Georgia] area:** World Bank's most recent AG.LND.TOTL.K2 figure for GEO is 2023 (no 2024 figure reported yet) — cited explicitly as 2023 rather than backfilled as current.
- **[Germany] area:** World Bank's most recent AG.LND.TOTL.K2 figure for DEU is 2023 (no 2024 figure reported yet) — cited explicitly as 2023 rather than backfilled as current.
- **[Ghana] area:** World Bank's most recent AG.LND.TOTL.K2 figure for GHA is 2023 (no 2024 figure reported yet) — cited explicitly as 2023 rather than backfilled as current.
- **[Greece] area:** World Bank's most recent AG.LND.TOTL.K2 figure for GRC is 2023 (no 2024 figure reported yet) — cited explicitly as 2023 rather than backfilled as current.
- **[Grenada] area:** World Bank's most recent AG.LND.TOTL.K2 figure for GRD is 2023 (no 2024 figure reported yet) — cited explicitly as 2023 rather than backfilled as current.
- **[Guatemala] area:** World Bank's most recent AG.LND.TOTL.K2 figure for GTM is 2023 (no 2024 figure reported yet) — cited explicitly as 2023 rather than backfilled as current.
- **[Guinea] area:** World Bank's most recent AG.LND.TOTL.K2 figure for GIN is 2023 (no 2024 figure reported yet) — cited explicitly as 2023 rather than backfilled as current.
- **[Guinea-Bissau] area:** World Bank's most recent AG.LND.TOTL.K2 figure for GNB is 2023 (no 2024 figure reported yet) — cited explicitly as 2023 rather than backfilled as current.
- **[Guyana] area:** World Bank's most recent AG.LND.TOTL.K2 figure for GUY is 2023 (no 2024 figure reported yet) — cited explicitly as 2023 rather than backfilled as current.
- **[Haiti] area:** World Bank's most recent AG.LND.TOTL.K2 figure for HTI is 2023 (no 2024 figure reported yet) — cited explicitly as 2023 rather than backfilled as current.
- **[Honduras] area:** World Bank's most recent AG.LND.TOTL.K2 figure for HND is 2023 (no 2024 figure reported yet) — cited explicitly as 2023 rather than backfilled as current.
- **[Hungary] area:** World Bank's most recent AG.LND.TOTL.K2 figure for HUN is 2023 (no 2024 figure reported yet) — cited explicitly as 2023 rather than backfilled as current.
- **[Iceland] area:** World Bank's most recent AG.LND.TOTL.K2 figure for ISL is 2023 (no 2024 figure reported yet) — cited explicitly as 2023 rather than backfilled as current.
- **[India] area:** World Bank's most recent AG.LND.TOTL.K2 figure for IND is 2023 (no 2024 figure reported yet) — cited explicitly as 2023 rather than backfilled as current.
- **[Indonesia] area:** World Bank's most recent AG.LND.TOTL.K2 figure for IDN is 2023 (no 2024 figure reported yet) — cited explicitly as 2023 rather than backfilled as current.
- **[Iran] area:** World Bank's most recent AG.LND.TOTL.K2 figure for IRN is 2023 (no 2024 figure reported yet) — cited explicitly as 2023 rather than backfilled as current.
- **[Iraq] area:** World Bank's most recent AG.LND.TOTL.K2 figure for IRQ is 2023 (no 2024 figure reported yet) — cited explicitly as 2023 rather than backfilled as current.
- **[Ireland] area:** World Bank's most recent AG.LND.TOTL.K2 figure for IRL is 2023 (no 2024 figure reported yet) — cited explicitly as 2023 rather than backfilled as current.
- **[Israel] area:** World Bank's most recent AG.LND.TOTL.K2 figure for ISR is 2023 (no 2024 figure reported yet) — cited explicitly as 2023 rather than backfilled as current.
- **[Italy] area:** World Bank's most recent AG.LND.TOTL.K2 figure for ITA is 2023 (no 2024 figure reported yet) — cited explicitly as 2023 rather than backfilled as current.
- **[Jamaica] area:** World Bank's most recent AG.LND.TOTL.K2 figure for JAM is 2023 (no 2024 figure reported yet) — cited explicitly as 2023 rather than backfilled as current.
- **[Japan] area:** World Bank's most recent AG.LND.TOTL.K2 figure for JPN is 2023 (no 2024 figure reported yet) — cited explicitly as 2023 rather than backfilled as current.
- **[Jordan] area:** World Bank's most recent AG.LND.TOTL.K2 figure for JOR is 2023 (no 2024 figure reported yet) — cited explicitly as 2023 rather than backfilled as current.
- **[Kazakhstan] area:** World Bank's most recent AG.LND.TOTL.K2 figure for KAZ is 2023 (no 2024 figure reported yet) — cited explicitly as 2023 rather than backfilled as current.
- **[Kenya] area:** World Bank's most recent AG.LND.TOTL.K2 figure for KEN is 2023 (no 2024 figure reported yet) — cited explicitly as 2023 rather than backfilled as current.
- **[Kiribati] area:** World Bank's most recent AG.LND.TOTL.K2 figure for KIR is 2023 (no 2024 figure reported yet) — cited explicitly as 2023 rather than backfilled as current.
- **[Kuwait] area:** World Bank's most recent AG.LND.TOTL.K2 figure for KWT is 2023 (no 2024 figure reported yet) — cited explicitly as 2023 rather than backfilled as current.
- **[Kyrgyzstan] area:** World Bank's most recent AG.LND.TOTL.K2 figure for KGZ is 2023 (no 2024 figure reported yet) — cited explicitly as 2023 rather than backfilled as current.
- **[Laos] area:** World Bank's most recent AG.LND.TOTL.K2 figure for LAO is 2023 (no 2024 figure reported yet) — cited explicitly as 2023 rather than backfilled as current.
- **[Latvia] area:** World Bank's most recent AG.LND.TOTL.K2 figure for LVA is 2023 (no 2024 figure reported yet) — cited explicitly as 2023 rather than backfilled as current.
- **[Lebanon] area:** World Bank's most recent AG.LND.TOTL.K2 figure for LBN is 2023 (no 2024 figure reported yet) — cited explicitly as 2023 rather than backfilled as current.
- **[Lesotho] area:** World Bank's most recent AG.LND.TOTL.K2 figure for LSO is 2023 (no 2024 figure reported yet) — cited explicitly as 2023 rather than backfilled as current.
- **[Liberia] area:** World Bank's most recent AG.LND.TOTL.K2 figure for LBR is 2023 (no 2024 figure reported yet) — cited explicitly as 2023 rather than backfilled as current.
- **[Libya] area:** World Bank's most recent AG.LND.TOTL.K2 figure for LBY is 2023 (no 2024 figure reported yet) — cited explicitly as 2023 rather than backfilled as current.
- **[Liechtenstein] area:** World Bank's most recent AG.LND.TOTL.K2 figure for LIE is 2023 (no 2024 figure reported yet) — cited explicitly as 2023 rather than backfilled as current.
- **[Lithuania] area:** World Bank's most recent AG.LND.TOTL.K2 figure for LTU is 2023 (no 2024 figure reported yet) — cited explicitly as 2023 rather than backfilled as current.
- **[Luxembourg] area:** World Bank's most recent AG.LND.TOTL.K2 figure for LUX is 2023 (no 2024 figure reported yet) — cited explicitly as 2023 rather than backfilled as current.
- **[Madagascar] area:** World Bank's most recent AG.LND.TOTL.K2 figure for MDG is 2023 (no 2024 figure reported yet) — cited explicitly as 2023 rather than backfilled as current.
- **[Malawi] area:** World Bank's most recent AG.LND.TOTL.K2 figure for MWI is 2023 (no 2024 figure reported yet) — cited explicitly as 2023 rather than backfilled as current.
- **[Malaysia] area:** World Bank's most recent AG.LND.TOTL.K2 figure for MYS is 2023 (no 2024 figure reported yet) — cited explicitly as 2023 rather than backfilled as current.
- **[Maldives] area:** World Bank's most recent AG.LND.TOTL.K2 figure for MDV is 2023 (no 2024 figure reported yet) — cited explicitly as 2023 rather than backfilled as current.
- **[Mali] area:** World Bank's most recent AG.LND.TOTL.K2 figure for MLI is 2023 (no 2024 figure reported yet) — cited explicitly as 2023 rather than backfilled as current.
- **[Malta] area:** World Bank's most recent AG.LND.TOTL.K2 figure for MLT is 2023 (no 2024 figure reported yet) — cited explicitly as 2023 rather than backfilled as current.
- **[Marshall Islands] area:** World Bank's most recent AG.LND.TOTL.K2 figure for MHL is 2023 (no 2024 figure reported yet) — cited explicitly as 2023 rather than backfilled as current.
- **[Mauritania] area:** World Bank's most recent AG.LND.TOTL.K2 figure for MRT is 2023 (no 2024 figure reported yet) — cited explicitly as 2023 rather than backfilled as current.
- **[Mauritius] area:** World Bank's most recent AG.LND.TOTL.K2 figure for MUS is 2023 (no 2024 figure reported yet) — cited explicitly as 2023 rather than backfilled as current.
- **[Mexico] area:** World Bank's most recent AG.LND.TOTL.K2 figure for MEX is 2023 (no 2024 figure reported yet) — cited explicitly as 2023 rather than backfilled as current.
- **[Micronesia] area:** World Bank's most recent AG.LND.TOTL.K2 figure for FSM is 2023 (no 2024 figure reported yet) — cited explicitly as 2023 rather than backfilled as current.
- **[Moldova] area:** World Bank's most recent AG.LND.TOTL.K2 figure for MDA is 2023 (no 2024 figure reported yet) — cited explicitly as 2023 rather than backfilled as current.
- **[Monaco] area:** World Bank's most recent AG.LND.TOTL.K2 figure for MCO is 2023 (no 2024 figure reported yet) — cited explicitly as 2023 rather than backfilled as current.
- **[Mongolia] area:** World Bank's most recent AG.LND.TOTL.K2 figure for MNG is 2023 (no 2024 figure reported yet) — cited explicitly as 2023 rather than backfilled as current.
- **[Montenegro] area:** World Bank's most recent AG.LND.TOTL.K2 figure for MNE is 2023 (no 2024 figure reported yet) — cited explicitly as 2023 rather than backfilled as current.
- **[Morocco] area:** World Bank's most recent AG.LND.TOTL.K2 figure for MAR is 2023 (no 2024 figure reported yet) — cited explicitly as 2023 rather than backfilled as current.
- **[Mozambique] area:** World Bank's most recent AG.LND.TOTL.K2 figure for MOZ is 2023 (no 2024 figure reported yet) — cited explicitly as 2023 rather than backfilled as current.
- **[Myanmar] area:** World Bank's most recent AG.LND.TOTL.K2 figure for MMR is 2023 (no 2024 figure reported yet) — cited explicitly as 2023 rather than backfilled as current.
- **[Myanmar] capital:** factbook.json lists multiple/non-standard capitals ("Rangoon (aka Yangon, continues to be recognized as the primary Burmese capital by the US Government); Nay Pyi Taw is the administrative capital") with only one coordinate pair — kept prior capital "Naypyidaw"; needs a human call on which is the capital of record.
- **[Namibia] area:** World Bank's most recent AG.LND.TOTL.K2 figure for NAM is 2023 (no 2024 figure reported yet) — cited explicitly as 2023 rather than backfilled as current.
- **[Nauru] area:** World Bank's most recent AG.LND.TOTL.K2 figure for NRU is 2023 (no 2024 figure reported yet) — cited explicitly as 2023 rather than backfilled as current.
- **[Nauru] capital:** factbook.json lists multiple/non-standard capitals ("no official capital; government offices in the Yaren District") with only one coordinate pair — kept prior capital "Yaren"; needs a human call on which is the capital of record.
- **[Nepal] area:** World Bank's most recent AG.LND.TOTL.K2 figure for NPL is 2023 (no 2024 figure reported yet) — cited explicitly as 2023 rather than backfilled as current.
- **[Netherlands] area:** World Bank's most recent AG.LND.TOTL.K2 figure for NLD is 2023 (no 2024 figure reported yet) — cited explicitly as 2023 rather than backfilled as current.
- **[New Zealand] area:** World Bank's most recent AG.LND.TOTL.K2 figure for NZL is 2023 (no 2024 figure reported yet) — cited explicitly as 2023 rather than backfilled as current.
- **[Nicaragua] area:** World Bank's most recent AG.LND.TOTL.K2 figure for NIC is 2023 (no 2024 figure reported yet) — cited explicitly as 2023 rather than backfilled as current.
- **[Niger] area:** World Bank's most recent AG.LND.TOTL.K2 figure for NER is 2023 (no 2024 figure reported yet) — cited explicitly as 2023 rather than backfilled as current.
- **[Nigeria] area:** World Bank's most recent AG.LND.TOTL.K2 figure for NGA is 2023 (no 2024 figure reported yet) — cited explicitly as 2023 rather than backfilled as current.
- **[North Korea] area:** World Bank's most recent AG.LND.TOTL.K2 figure for PRK is 2023 (no 2024 figure reported yet) — cited explicitly as 2023 rather than backfilled as current.
- **[North Korea] gdp:** World Bank has no NY.GDP.MKTP.CD value for PRK in any year from 2000 to 2024 — genuinely no data in range, left unscored.
- **[North Macedonia] area:** World Bank's most recent AG.LND.TOTL.K2 figure for MKD is 2023 (no 2024 figure reported yet) — cited explicitly as 2023 rather than backfilled as current.
- **[Norway] area:** World Bank's most recent AG.LND.TOTL.K2 figure for NOR is 2023 (no 2024 figure reported yet) — cited explicitly as 2023 rather than backfilled as current.
- **[Oman] area:** World Bank's most recent AG.LND.TOTL.K2 figure for OMN is 2023 (no 2024 figure reported yet) — cited explicitly as 2023 rather than backfilled as current.
- **[Pakistan] area:** World Bank's most recent AG.LND.TOTL.K2 figure for PAK is 2023 (no 2024 figure reported yet) — cited explicitly as 2023 rather than backfilled as current.
- **[Palau] area:** World Bank's most recent AG.LND.TOTL.K2 figure for PLW is 2023 (no 2024 figure reported yet) — cited explicitly as 2023 rather than backfilled as current.
- **[Panama] area:** World Bank's most recent AG.LND.TOTL.K2 figure for PAN is 2023 (no 2024 figure reported yet) — cited explicitly as 2023 rather than backfilled as current.
- **[Papua New Guinea] area:** World Bank's most recent AG.LND.TOTL.K2 figure for PNG is 2023 (no 2024 figure reported yet) — cited explicitly as 2023 rather than backfilled as current.
- **[Paraguay] area:** World Bank's most recent AG.LND.TOTL.K2 figure for PRY is 2023 (no 2024 figure reported yet) — cited explicitly as 2023 rather than backfilled as current.
- **[Peru] area:** World Bank's most recent AG.LND.TOTL.K2 figure for PER is 2023 (no 2024 figure reported yet) — cited explicitly as 2023 rather than backfilled as current.
- **[Philippines] area:** World Bank's most recent AG.LND.TOTL.K2 figure for PHL is 2023 (no 2024 figure reported yet) — cited explicitly as 2023 rather than backfilled as current.
- **[Poland] area:** World Bank's most recent AG.LND.TOTL.K2 figure for POL is 2023 (no 2024 figure reported yet) — cited explicitly as 2023 rather than backfilled as current.
- **[Portugal] area:** World Bank's most recent AG.LND.TOTL.K2 figure for PRT is 2023 (no 2024 figure reported yet) — cited explicitly as 2023 rather than backfilled as current.
- **[Qatar] area:** World Bank's most recent AG.LND.TOTL.K2 figure for QAT is 2023 (no 2024 figure reported yet) — cited explicitly as 2023 rather than backfilled as current.
- **[Romania] area:** World Bank's most recent AG.LND.TOTL.K2 figure for ROU is 2023 (no 2024 figure reported yet) — cited explicitly as 2023 rather than backfilled as current.
- **[Russia] area:** World Bank's most recent AG.LND.TOTL.K2 figure for RUS is 2023 (no 2024 figure reported yet) — cited explicitly as 2023 rather than backfilled as current.
- **[Rwanda] area:** World Bank's most recent AG.LND.TOTL.K2 figure for RWA is 2023 (no 2024 figure reported yet) — cited explicitly as 2023 rather than backfilled as current.
- **[Saint Kitts and Nevis] area:** World Bank's most recent AG.LND.TOTL.K2 figure for KNA is 2023 (no 2024 figure reported yet) — cited explicitly as 2023 rather than backfilled as current.
- **[Saint Lucia] area:** World Bank's most recent AG.LND.TOTL.K2 figure for LCA is 2023 (no 2024 figure reported yet) — cited explicitly as 2023 rather than backfilled as current.
- **[Saint Vincent and the Grenadines] area:** World Bank's most recent AG.LND.TOTL.K2 figure for VCT is 2023 (no 2024 figure reported yet) — cited explicitly as 2023 rather than backfilled as current.
- **[Samoa] area:** World Bank's most recent AG.LND.TOTL.K2 figure for WSM is 2023 (no 2024 figure reported yet) — cited explicitly as 2023 rather than backfilled as current.
- **[San Marino] area:** World Bank's most recent AG.LND.TOTL.K2 figure for SMR is 2023 (no 2024 figure reported yet) — cited explicitly as 2023 rather than backfilled as current.
- **[San Marino] gdp:** World Bank's most recent NY.GDP.MKTP.CD figure for SMR is 2023 (no 2024 figure reported yet) — cited explicitly as 2023 rather than backfilled as current.
- **[Sao Tome and Principe] area:** World Bank's most recent AG.LND.TOTL.K2 figure for STP is 2023 (no 2024 figure reported yet) — cited explicitly as 2023 rather than backfilled as current.
- **[Saudi Arabia] area:** World Bank's most recent AG.LND.TOTL.K2 figure for SAU is 2023 (no 2024 figure reported yet) — cited explicitly as 2023 rather than backfilled as current.
- **[Senegal] area:** World Bank's most recent AG.LND.TOTL.K2 figure for SEN is 2023 (no 2024 figure reported yet) — cited explicitly as 2023 rather than backfilled as current.
- **[Serbia] area:** World Bank's most recent AG.LND.TOTL.K2 figure for SRB is 2023 (no 2024 figure reported yet) — cited explicitly as 2023 rather than backfilled as current.
- **[Seychelles] area:** World Bank's most recent AG.LND.TOTL.K2 figure for SYC is 2023 (no 2024 figure reported yet) — cited explicitly as 2023 rather than backfilled as current.
- **[Sierra Leone] area:** World Bank's most recent AG.LND.TOTL.K2 figure for SLE is 2023 (no 2024 figure reported yet) — cited explicitly as 2023 rather than backfilled as current.
- **[Singapore] area:** World Bank's most recent AG.LND.TOTL.K2 figure for SGP is 2023 (no 2024 figure reported yet) — cited explicitly as 2023 rather than backfilled as current.
- **[Slovakia] area:** World Bank's most recent AG.LND.TOTL.K2 figure for SVK is 2023 (no 2024 figure reported yet) — cited explicitly as 2023 rather than backfilled as current.
- **[Slovenia] area:** World Bank's most recent AG.LND.TOTL.K2 figure for SVN is 2023 (no 2024 figure reported yet) — cited explicitly as 2023 rather than backfilled as current.
- **[Solomon Islands] area:** World Bank's most recent AG.LND.TOTL.K2 figure for SLB is 2023 (no 2024 figure reported yet) — cited explicitly as 2023 rather than backfilled as current.
- **[Somalia] area:** World Bank's most recent AG.LND.TOTL.K2 figure for SOM is 2023 (no 2024 figure reported yet) — cited explicitly as 2023 rather than backfilled as current.
- **[South Africa] area:** World Bank's most recent AG.LND.TOTL.K2 figure for ZAF is 2023 (no 2024 figure reported yet) — cited explicitly as 2023 rather than backfilled as current.
- **[South Africa] capital:** factbook.json lists multiple/non-standard capitals ("Pretoria (administrative capital); Cape Town (legislative capital); Bloemfontein (judicial capital)") with only one coordinate pair — kept prior capital "Pretoria"; needs a human call on which is the capital of record.
- **[South Korea] area:** World Bank's most recent AG.LND.TOTL.K2 figure for KOR is 2023 (no 2024 figure reported yet) — cited explicitly as 2023 rather than backfilled as current.
- **[South Sudan] area:** World Bank's most recent AG.LND.TOTL.K2 figure for SSD is 2023 (no 2024 figure reported yet) — cited explicitly as 2023 rather than backfilled as current.
- **[South Sudan] gdp:** World Bank's most recent NY.GDP.MKTP.CD figure for SSD is 2015 (no 2024 figure reported yet) — cited explicitly as 2015 rather than backfilled as current.
- **[Spain] area:** World Bank's most recent AG.LND.TOTL.K2 figure for ESP is 2023 (no 2024 figure reported yet) — cited explicitly as 2023 rather than backfilled as current.
- **[Sri Lanka] area:** World Bank's most recent AG.LND.TOTL.K2 figure for LKA is 2023 (no 2024 figure reported yet) — cited explicitly as 2023 rather than backfilled as current.
- **[Sri Lanka] capital:** factbook.json lists multiple/non-standard capitals ("Colombo (commercial capital); Sri Jayewardenepura Kotte (legislative capital)") with only one coordinate pair — kept prior capital "Sri Jayawardenepura Kotte"; needs a human call on which is the capital of record.
- **[Sudan] area:** World Bank's most recent AG.LND.TOTL.K2 figure for SDN is 2023 (no 2024 figure reported yet) — cited explicitly as 2023 rather than backfilled as current.
- **[Suriname] area:** World Bank's most recent AG.LND.TOTL.K2 figure for SUR is 2023 (no 2024 figure reported yet) — cited explicitly as 2023 rather than backfilled as current.
- **[Sweden] area:** World Bank's most recent AG.LND.TOTL.K2 figure for SWE is 2023 (no 2024 figure reported yet) — cited explicitly as 2023 rather than backfilled as current.
- **[Switzerland] area:** World Bank's most recent AG.LND.TOTL.K2 figure for CHE is 2023 (no 2024 figure reported yet) — cited explicitly as 2023 rather than backfilled as current.
- **[Syria] area:** World Bank's most recent AG.LND.TOTL.K2 figure for SYR is 2023 (no 2024 figure reported yet) — cited explicitly as 2023 rather than backfilled as current.
- **[Syria] gdp:** World Bank's most recent NY.GDP.MKTP.CD figure for SYR is 2022 (no 2024 figure reported yet) — cited explicitly as 2022 rather than backfilled as current.
- **[Tajikistan] area:** World Bank's most recent AG.LND.TOTL.K2 figure for TJK is 2023 (no 2024 figure reported yet) — cited explicitly as 2023 rather than backfilled as current.
- **[Tanzania] area:** World Bank's most recent AG.LND.TOTL.K2 figure for TZA is 2023 (no 2024 figure reported yet) — cited explicitly as 2023 rather than backfilled as current.
- **[Thailand] area:** World Bank's most recent AG.LND.TOTL.K2 figure for THA is 2023 (no 2024 figure reported yet) — cited explicitly as 2023 rather than backfilled as current.
- **[Timor-Leste] area:** World Bank's most recent AG.LND.TOTL.K2 figure for TLS is 2023 (no 2024 figure reported yet) — cited explicitly as 2023 rather than backfilled as current.
- **[Togo] area:** World Bank's most recent AG.LND.TOTL.K2 figure for TGO is 2023 (no 2024 figure reported yet) — cited explicitly as 2023 rather than backfilled as current.
- **[Tonga] area:** World Bank's most recent AG.LND.TOTL.K2 figure for TON is 2023 (no 2024 figure reported yet) — cited explicitly as 2023 rather than backfilled as current.
- **[Trinidad and Tobago] area:** World Bank's most recent AG.LND.TOTL.K2 figure for TTO is 2023 (no 2024 figure reported yet) — cited explicitly as 2023 rather than backfilled as current.
- **[Tunisia] area:** World Bank's most recent AG.LND.TOTL.K2 figure for TUN is 2023 (no 2024 figure reported yet) — cited explicitly as 2023 rather than backfilled as current.
- **[Turkey] area:** World Bank's most recent AG.LND.TOTL.K2 figure for TUR is 2023 (no 2024 figure reported yet) — cited explicitly as 2023 rather than backfilled as current.
- **[Turkmenistan] area:** World Bank's most recent AG.LND.TOTL.K2 figure for TKM is 2023 (no 2024 figure reported yet) — cited explicitly as 2023 rather than backfilled as current.
- **[Tuvalu] area:** World Bank's most recent AG.LND.TOTL.K2 figure for TUV is 2023 (no 2024 figure reported yet) — cited explicitly as 2023 rather than backfilled as current.
- **[Uganda] area:** World Bank's most recent AG.LND.TOTL.K2 figure for UGA is 2023 (no 2024 figure reported yet) — cited explicitly as 2023 rather than backfilled as current.
- **[Ukraine] area:** World Bank's most recent AG.LND.TOTL.K2 figure for UKR is 2023 (no 2024 figure reported yet) — cited explicitly as 2023 rather than backfilled as current.
- **[United Arab Emirates] area:** World Bank's most recent AG.LND.TOTL.K2 figure for ARE is 2023 (no 2024 figure reported yet) — cited explicitly as 2023 rather than backfilled as current.
- **[United Kingdom] area:** World Bank's most recent AG.LND.TOTL.K2 figure for GBR is 2023 (no 2024 figure reported yet) — cited explicitly as 2023 rather than backfilled as current.
- **[United States of America] area:** World Bank's most recent AG.LND.TOTL.K2 figure for USA is 2023 (no 2024 figure reported yet) — cited explicitly as 2023 rather than backfilled as current.
- **[Uruguay] area:** World Bank's most recent AG.LND.TOTL.K2 figure for URY is 2023 (no 2024 figure reported yet) — cited explicitly as 2023 rather than backfilled as current.
- **[Uzbekistan] area:** World Bank's most recent AG.LND.TOTL.K2 figure for UZB is 2023 (no 2024 figure reported yet) — cited explicitly as 2023 rather than backfilled as current.
- **[Vanuatu] area:** World Bank's most recent AG.LND.TOTL.K2 figure for VUT is 2023 (no 2024 figure reported yet) — cited explicitly as 2023 rather than backfilled as current.
- **[Venezuela] area:** World Bank's most recent AG.LND.TOTL.K2 figure for VEN is 2023 (no 2024 figure reported yet) — cited explicitly as 2023 rather than backfilled as current.
- **[Vietnam] area:** World Bank's most recent AG.LND.TOTL.K2 figure for VNM is 2023 (no 2024 figure reported yet) — cited explicitly as 2023 rather than backfilled as current.
- **[Yemen] area:** World Bank's most recent AG.LND.TOTL.K2 figure for YEM is 2023 (no 2024 figure reported yet) — cited explicitly as 2023 rather than backfilled as current.
- **[Yemen] gdp:** World Bank's most recent NY.GDP.MKTP.CD figure for YEM is 2018 (no 2024 figure reported yet) — cited explicitly as 2018 rather than backfilled as current.
- **[Zambia] area:** World Bank's most recent AG.LND.TOTL.K2 figure for ZMB is 2023 (no 2024 figure reported yet) — cited explicitly as 2023 rather than backfilled as current.
- **[Zimbabwe] area:** World Bank's most recent AG.LND.TOTL.K2 figure for ZWE is 2023 (no 2024 figure reported yet) — cited explicitly as 2023 rather than backfilled as current.

<!-- END buildGovCapitalPopGdp.mjs gap report -->

## Alliance memberships (`data/allianceMemberships.ts`)

- **18 blocs tracked, fixed scope.** Rewritten 2026-08-14 (superseding the
  first, 7-bloc version from earlier the same day) to a real-ISO3-code
  schema — `memberCountryCodes` holds standard ISO 3166-1 alpha-3 codes,
  joined against a selected country via the new `data/countryIso3.ts`
  (`COUNTRY_NAME_TO_ISO3`, verified by script against all 193 entries in
  `unMembers.ts`) rather than a name-keyed per-country list. Security: NATO,
  AUKUS, Quad, SCO, the Mecca Joint Defence Agreement. Economic/political:
  G7, G20, BRICS, OECD, EU, EAEU. Regional: ASEAN, AU, OAS, GCC, Mercosur,
  Pacific Alliance, CARICOM. A Trade category (USMCA/CPTPP/RCEP/AfCFTA) was
  considered and explicitly dropped, not deferred. ANZUS/SAARC/CSTO/the Arab
  League were reviewed and excluded as dormant/functionally inert (see the
  file's own header for the specific reasoning behind each).
- **Several entries reflect a hand-adjusted roster, not just each org's raw
  published list** — worth knowing before trusting one at a glance: OAS
  excludes Cuba, Venezuela, and Nicaragua (all three non-participating or
  formally withdrawn, not merely disputed); Mercosur excludes Venezuela
  (suspended since 2017) and includes Bolivia (full member since 2024); AU
  includes Western Sahara (ESH) and CARICOM includes 8 non-sovereign
  associate territories plus Montserrat — none of the AU/CARICOM
  territory-only codes will ever match a selected country in this app since
  they're not UN members, but they're included for fidelity to each org's
  own official roster. The Mecca Joint Defence Agreement is flagged
  provisional (signed 2026-08-07, scope/durability still being assessed).
- **BRICS's and OAS's own official pages returned HTTP 403 to direct
  fetch** — both entries' membership lists are cross-verified through
  independent reporting on those sites rather than a direct read, noted in
  each entry's own `annotations` field. Worth a periodic re-check once/if
  those pages become fetchable.
- **Nothing re-verifies this against source.** Unlike `countryEconomics.ts`
  (regenerated by `npm run build:profiles` against a live API), this file
  has no build script — a future accession/exit will silently go stale past
  each entry's own `snapshotDate` until someone manually re-checks it.
  Several of these 18 have changed membership within the last two years
  already (NATO/Finland+Sweden, BRICS's 2024/2025 expansion, ASEAN/
  Timor-Leste, Mercosur/Bolivia, SCO/Belarus) — this is not a slow-moving
  dataset.
- **United States renders 7 alliance badges** (NATO, AUKUS, Quad, G7, G20,
  OECD, OAS) — the only country that does; everyone else tops out at 5
  (Canada, France, Germany, Italy, UK). Rendered as-is (the badge row
  already wraps), not capped/collapsed — a deliberate choice, not an
  overlooked edge case, should a future badge design want to revisit it.

## Data sourcing (largest city)

- **No clean "largest city" field exists in either data source this repo
  already pulls from.** Investigated 2026-08-14 while adding AREA to
  `IntelligencePanel.tsx`. factbook.json's `People and Society` section has
  a `"Major urban areas - population"` field, but it's unstructured prose —
  a single comma-joined string mixing "million"/plain-thousands units,
  variable city-name formatting, and the capital flagged only by being
  in ALL CAPS within the name itself (e.g. Nigeria: `"15.946 million
  Lagos, 4.348 million Kano, ... 3.840 million ABUJA (capital), ..."`).
  It's also simply absent for a number of small/micro states (Nauru
  checked, came back with no such field at all). Splitting on `", "` is
  itself unreliable — nothing guarantees a city name can't contain a
  comma. World Bank has no "largest city" indicator at all (its city-level
  data, where it exists, isn't queryable this way). Per this project's
  standing policy against guess-parsing free text into structured data
  (see `resolveCapital`'s handling of factbook.json's own ambiguous
  multi-capital entries for the precedent), this needs either a different,
  structured source (e.g. a maintained world-cities dataset joined by
  country) or a deliberate decision to hand-curate it the way
  `countryProfiles.ts`'s `capital`/`government` fields already are — not
  attempted here.

## Data quality — needs a second pair of eyes

- **Gibraltar's inclusion** in the Territory list was an inference (it
  appears in the v3 spec's Known Relationships but not its explicit entity
  list) — confirm this was the intended reading, not an oversight to
  actually exclude.
- **Only 10 relationships have had a real, citation-level accuracy pass**
  (v3.1.4: Falkland Islands/South Georgia/Gibraltar/BIOT/French Southern &
  Antarctic Lands/Palestine/Akrotiri/Dhekelia claimedBy additions, plus the
  Bajo Nuevo/Serranilla Bank corrections — see `LOGBOOK.md`'s v3.1.4 entry
  for the ICJ/treaty citations behind the latter). Everything else in
  `geoEntities.ts` still carries the original "simplified, hand-curated...
  not a comprehensive or authoritative reference" provenance note — the
  other ~46 GeoEntities' claim/administration data hasn't had the same
  scrutiny and may have similar gaps. One noticed in passing:
  `british-indian-ocean-territory`'s entry doesn't model the US military
  presence at Diego Garcia at all (the UK administers BIOT; the US
  operates a leased naval/air base there, similar in shape to the
  Guantanamo Bay entry's `administeredBy` treatment, but nothing here
  reflects it).
- **Kosovo's `claimedBy: Serbia`** and several Territory `parentEntity`
  values (Curaçao/Aruba/Sint Maarten → Netherlands, Åland → Finland, Cook
  Islands/Niue → New Zealand, Norfolk Island/Heard & McDonald → Australia)
  were added beyond the v3 spec's explicit relationship list, on the
  reasoning that the spec's list read as "at least these," not "only
  these." Worth a deliberate sign-off rather than standing entirely on that
  inference.
- **Crimea's classification as `'territory'`** is a placeholder choice —
  none of the five `GeoEntityType` values actually fit a case that's
  neither a dependency nor one of the four named `geopolitical-entity`
  examples. Worth a real decision (a sixth classification? a special case?)
  rather than leaving it in the bucket that happened to compile.
- **No `GeoEntity` in `geoEntities.ts` populates its own `claims` field** —
  every claim relationship is recorded only as `claimedBy` on the claimed
  side (Taiwan claims Spratly Islands/Scarborough Reef in every practical
  sense, but `taiwan.claims` is `[]`; both reefs list Taiwan in their own
  `claimedBy` instead). `ClaimsOverlayLayer.tsx` and
  `generateClaimsDoc.mjs` both now infer the missing direction (see
  `LOGBOOK.md`'s v3.1.3 entry), so nothing currently reads `.claims` and
  gets a wrong answer — but a future consumer that reads `entity.claims`
  directly, without knowing to union it against everyone else's
  `claimedBy`, will. Worth either actually populating `claims` for real
  entities that have one (Taiwan being the obvious first case) or updating
  `GeoEntity`'s doc comment in `data/types.ts` to say outright that
  `claims` is aspirational/unused so far, rather than implying it's just
  sparsely populated.
- **Country display names are inconsistent between sources**: the country
  topology (`countries-un193.json`, via `DISPLAY_NAME_OVERRIDES`) uses
  short forms ("China"), while `GeoEntityRelation.displayName` values
  written by hand in `geoEntities.ts` mostly use long official forms
  ("People's Republic of China"). Cosmetic — `CLAIMS.md` shows both forms
  for the same country in different sections — but worth normalizing to
  one convention if this data ever needs to cross-reference cleanly against
  itself.

## Geographic coverage

- **States/provinces upgraded to the 1:10m resolution (2026-08-15)**: 4,539
  features (up from 294 at 1:50m) across 235 distinct parent-country ids —
  all 193 UN member states now have coverage, plus 42 more ISO-coded
  non-UN territories/dependencies (Taiwan, Hong Kong, Puerto Rico,
  Greenland, Antarctica, ...) whose provinces carry a `parentCountryId`
  that has no matching entry in `CountryRegistry` (UN members only) — not
  wired into any consumer differently than a UN member's provinces are,
  just worth knowing if a future feature keys off `parentCountryId`
  expecting it to always resolve. Output is `public/geo/
  states-provinces.json`, 3.75 MB (up from 262 KB).
- **57 provinces skipped during the 1:10m upgrade — no ISO country code to
  attach a parent to.** `scripts/buildStatesProvincesTopology.mjs` only
  keeps features whose `adm0_a3` resolves via `iso3166.mjs`; these 17
  distinct `adm0_a3` values don't, because they're not sovereign countries:
  Kosovo (30 provinces), Western Sahara, Somaliland, Northern Cyprus, the
  Gaza Strip, the West Bank, the Spratly Islands, Guantanamo Bay, Baikonur,
  the Siachen Glacier, the Akrotiri and Dhekelia Sovereign Base Areas, and
  five uninhabited dependencies (Åland, Clipperton Island, Ashmore and
  Cartier Islands, Coral Sea Islands, the Indian Ocean Territories). Most
  of the non-uninhabited ones already have their own `GeoEntity` record
  (`data/registry/geoEntities.ts`) at the country/territory level — routing
  their admin-1 subdivisions into `GeometryMap`/`GeoEntityRegistry` instead
  of silently dropping them is a real follow-up worth considering, but a
  bigger change than this pass (touches `GeoEntity`-adjacent code) and was
  deliberately left out of it.
- **South Sudan and Nauru have no capital marker (v4.1)** — Natural Earth's
  1:50m populated places layer doesn't flag either country's capital at
  this resolution. Every other of the 193 UN members does. Worth a manual
  addition if this ever needs to be complete rather than resolution-limited.
- **Israel has no `PPLC`-flagged capital in GeoNames (found 2026-09-03,
  `scripts/buildGlobalCitiesData.mjs`'s candidate global cities index).**
  Every other of the 193 UN members resolves exactly one `PPLC` entry;
  Israel resolves zero. Checked directly, not assumed a bug: GeoNames'
  `IL.txt` export tags Jerusalem `PPLA` (ordinary first-order-admin-division
  seat) rather than `PPLC` — deliberate, not missing data, almost certainly
  because Jerusalem's status as Israel's capital is internationally
  disputed (most UN members maintain embassies in/around Tel Aviv, not
  Jerusalem). This project takes no position on the dispute; noting it here
  as a real, known per-source quirk rather than silently patching Jerusalem
  to `isCapital: true` in the build script (which would be making the
  editorial call GeoNames itself deliberately avoided) or leaving it
  unflagged with no explanation (which would misrepresent it as an
  oversight the way South Sudan/Nauru's gap above actually is). Worth a
  deliberate, logged decision before this index ships — not resolved here.
- **The global city index is sourced from GeoNames' `cities500.zip` — population ≥ 500 (or any
  administrative seat), not GeoNames' full `allCountries` export — so a real, named, populated place can be
  completely absent from this app's data with no boundary-join or per-country-sourcing work able to fix it**
  (found 2026-09-06, reported directly: El Naranjo, Petén, Guatemala doesn't appear anywhere in the app).
  Verified directly against the vendored source, not just this app's filtered output: `El Naranjo` does not
  exist anywhere in `scripts/vendor/geonames/cities500.zip`'s Guatemala rows at all (340 total GT entries,
  zero mentioning "Naranjo" except the unrelated "Santa Cruz Naranjo"). **Root cause pinned down exactly, not
  just inferred** — fetched GeoNames' own full, unfiltered `GT.zip` per-country export directly
  (`download.geonames.org/export/dump/GT.zip`, not the vendored cities500 subset) and found the real record:
  geoname id `3596710`, feature code `PPL` (an ordinary populated place, not any kind of administrative
  seat), **recorded population: `0`** — not "a small nonzero population under 500," genuinely unset. GeoNames
  has the place, with correct coordinates; nobody ever populated its population field. This is a common
  GeoNames data-quality gap for smaller Latin American towns specifically, not unique to this one place.
  **This is a fundamentally different kind of gap than every city-boundaries finding logged elsewhere in
  this section** (Botswana/Libya/South Sudan/Belize are all missing *boundary polygons* for known places) —
  this is a place missing its *point* in the index, which means it can never show as a label or a search
  result in any country, independent of whether that country's boundary work is done at all. **Switching to
  GeoNames' full `allCountries.zip` would NOT fully fix this on its own** — a population-based floor applied
  to that fuller source would still exclude a population=0 entry the same way cities500 does; closing this
  specific gap needs a floor shaped like "population > 0 OR any populated place at all," not just "a lower
  population number," alongside the much larger source (every populated place regardless of recorded
  population — likely still needs its own new inclusion rule to keep output size sane, since it's several
  million `P`-class rows globally vs. this app's current ~234K). A real scope decision, not a quick patch,
  and not attempted here (direct call: log it and keep working through the city-boundaries country list
  rather than swap the underlying index source right now).
- **Rivers (v5.2.0) only render `scalerank <= 3` — 116 of the source's 462
  features.** Deliberately partial, same pilot-scope reasoning as
  states/provinces above: raising the constant in
  `scripts/buildRiversTopology.mjs` (up to 6, for full coverage) is the
  documented upgrade path, no pipeline redesign required.
- **Lakes (v5.2.0) render as an opaque fill over land that has no actual
  hole where the lake sits** — a visual approximation, not a true
  geometric cutout. A real fix means subtracting lake polygons from
  country/state polygons at build time (a new polygon-clipping dependency,
  touching the core country/states pipeline) and was explicitly deferred as
  too large a change for the pass that added lakes. See `CHANGELOG.md`'s
  v5.2.0 entry and `scene/Lakes.tsx`'s own header comment.
- **Botswana, Libya, and South Sudan have no usable city-scale boundary
  source, from either geoBoundaries or OSM (found 2026-09-04, direct
  per-country Overpass checks — see `city-boundaries-architecture.md`'s
  "Fourth pass").** Real, confirmed gaps, not unverified assumptions:
  - Botswana: OSM's real sub-district tier (`admin_level=6`) is almost
    entirely untagged (2 of 23 real sub-districts); geoBoundaries' own ADM2
    (25 units, 691 km² min) is the best available and it's still coarser
    than city-scale.
  - Libya: confirmed its baladiyat tier (~22-23 units) really is the finest
    *official* administrative division — both geoBoundaries and OSM agree,
    and no proposed-but-unimplemented governorate layer exists to find. A
    real Tripoli/Benghazi-scale polygon would need a place/landuse-based
    urban-extent technique instead of walking the admin hierarchy deeper —
    not attempted yet.
  - South Sudan: real county-level data (matches geoBoundaries' 78
    counties) but its real payam tier is essentially unmapped in OSM (2 of
    540). One partial win: Juba itself has real OSM neighborhood-level data
    (37 relations) — usable for the capital specifically, not nationwide.
- **Belize has real city-boundary data for only its 9 actual municipalities — the other ~92% of its
  populated places have no containing polygon at all, and that's correct, not a coverage gap to close**
  (found 2026-09-05, `city-boundaries-architecture.md`'s "Eighth pass"). geoBoundaries' only sub-national
  level for Belize is electoral constituencies (not settlement boundaries — confirmed against independent
  sources before use); Belize's real local-government layer is a hand-curated 9-municipality OSM name list
  instead (`scripts/buildCityBoundaries.mjs`'s `BELIZE_MUNICIPALITY_NAMES`). The per-feature join found and
  kept all 9 real municipalities correctly, then left 127 of 138 GeoNames points unmatched — because most of
  Belize's land area genuinely has no municipal government at all, not because the join or the source missed
  something. A distinct third outcome alongside "full coverage" (Jordan/Kuwait/Costa Rica/El Salvador/
  Guatemala/Honduras/Nicaragua/Panama/US) and "no coverage" (Botswana/Libya/South Sudan above) — worth
  tracking as its own category in any future per-country source table, not collapsed into either.
- **Two of geoBoundaries' Central America downloads (Panama, Honduras) turned out to be unsimplified
  full-resolution source shapefiles, not pre-simplified data** (found 2026-09-05 by checking the real output
  file size after the first join run — same discipline that caught the Sixth pass's US-mega-file bug). One
  Panama corregimiento ("Arco Iris") alone had 631,536 points; the unfixed output was 291MB (Panama)/159MB
  (Honduras) for a single country. Fixed with a plain-JS Douglas-Peucker simplifier applied to every kept
  feature (`scripts/lib/sphericalGeometry.mjs`'s `simplifyGeometry`, `SIMPLIFY_EPSILON_DEG = 0.001` ≈ 111m),
  verified against real area-distortion numbers before picking the tolerance (typical feature: <0.2%
  distortion; the worst outlier: <1%) rather than guessed. Worth remembering for **every** future
  geoBoundaries-sourced country, not just these two — nothing about Jordan/Kuwait/the other four Central
  American countries' own geometry signaled this problem in advance; it only showed up because Panama/
  Honduras's source data happened to be far denser than every country checked before them.
- **Mexico's largest per-state city-boundary shard (Veracruz, 212 municipios) is 11.9MB — over 3x the
  largest existing US state shard (Texas, 3.7MB)** (found 2026-09-05, `city-boundaries-architecture.md`'s
  "Ninth pass"). Sharding by state (`scripts/buildCityBoundaries.mjs`'s `shardByState()`) fixed the much
  worse problem — a single 69.9MB flat file, bigger than the Sixth pass's already-caught-once US-mega-file
  mistake — but didn't make every shard uniformly small the way the US's own state shards are. Not
  tuned further in this pass (flagged, not fixed): a future pass could try a tighter
  `SIMPLIFY_EPSILON_DEG` for this specific case, or a second sharding axis for Mexico's densest states.
- **`scripts/vendor/canada/` (a 155MB hand-downloaded 2021 StatCan census-subdivision shapefile) is now
  confirmed, not just suspected, to be safe to delete** (`city-boundaries-architecture.md`'s "Ninth pass").
  Its data doesn't beat geoBoundaries' own 2016 copy of the same StatCan dataset on either unit count
  (5,161 vs. 5,162) or field richness, and nothing in the shipped pipeline reads from it — Canada's real
  city-boundary source is geoBoundaries' direct download instead. Left in place pending an explicit
  deletion decision (untracked local data, not something to remove without confirmation).
- ~~Argentina's real city-boundary join needed a source swap mid-pass, not just a threshold tweak~~ —
  **134 remaining unmatched towns fixed 2026-09-12** (`city-boundaries-architecture.md`'s "Twelfth pass").
  The first OSM fix (found 2026-09-05, "Tenth pass": geoBoundaries' Departamentos/Partidos (ADM2) rejected
  762/1,204 points including genuine provincial capitals — Paraná, Neuquén, Formosa, San Luis, Comodoro
  Rivadavia — fixed by switching to OSM `admin_level` 7|8, a real comprehensive locality tier) left 134 towns
  clustered in Buenos Aires and San Juan provinces unmatched. Root cause found by checking is_in() at each
  point directly: Buenos Aires Province's partidos (its real, only municipal-equivalent tier — no
  sub-partido government exists) are tagged `admin_level=5`, a third level entirely from the 7|8 already
  queried. Widening the query to `admin_level~"^(5|7|8)$"` eliminated every unmatched town: 1,106/1,204 kept
  (up from 1,038), 98 rejected (up from 32 — real, large departamentos/partidos a city still doesn't fit
  inside even at this coarser fallback), 0 unmatched.
- ~~Kuwait's 3 unmatched towns (Al Mahbūlah, Al Funayţīs, Al Fințās) needed a per-city fallback~~ — **all 3
  fixed.** 2 of 3 fixed 2026-09-12 (`city-boundaries-architecture.md`'s "Eleventh pass") by switching Kuwait's
  source to OSM's own `admin_level=6` layer (real gaps in geoBoundaries' ADM2 don't exist in this one). The
  3rd, Al Funayţīs (population 1,878) — a real OSM polygon (relation 17935319) that GeoNames' point coordinate
  lands just outside — needed the "snap to nearest candidate within a small radius" fallback this entry used
  to say was unbuilt; it's now built (`joinCityPointsToPolygons`'s `SNAP_MAX_KM`, "Thirteenth pass",
  2026-09-12) and fixed it directly (0.24km snap).
- ~~The source-swap-first check found 7 real residuals across Kuwait/Costa Rica/Panama/Canada/Colombia/
  Venezuela/Honduras that a source swap alone couldn't close~~ — **the snap-to-nearest fallback closed all but
  7 of them** (`city-boundaries-architecture.md`'s "Thirteenth pass," 2026-09-12). Direct inspection of a real
  Caribbean-pass case (Haiti's Saint-Marc, Cité Soleil, Jérémie, Grand Gosier — all real cities whose correct
  commune polygon sits within TENS OF METERS of the GeoNames point, a floating-point on-the-boundary
  ray-casting failure, not a genuine coordinate mismatch) showed this was a general, fixable class of bug, not
  one-off per-country weirdness — `distanceToGeometryKm()` (`scripts/lib/sphericalGeometry.mjs`) plus a
  2km-radius fallback in `joinCityPointsToPolygons()` (preferring a same-named candidate within range over a
  closer differently-named one — see the Grand Gosier case in that pass, where blind nearest-wins picked the
  wrong neighboring commune) resolved: Kuwait 1→0, Costa Rica 1→0, Panama 5→0, Canada 13→0, Colombia 3→0 (all
  snapped within 0.02-0.44km of their own correctly-named candidate — Colombia's 3 were previously logged as a
  genuine zero-boundary gap based on is_in() at the exact point; the snap fallback shows a same-named polygon
  actually exists 36-435m away, so that earlier conclusion was too pessimistic, not wrong about the exact
  point itself). Honduras closed 11→5 (Sambo Creek, Río Esteban, Punta Piedra, Jericó — real Caribbean
  coastal/island gaps with nothing within 2km in either source; Magdalena — a confirmed GeoNames country-tag
  error, actually in El Salvador) and Venezuela stayed at 2 (Los Roques, an offshore federal-dependency
  island; La Aguada — both confirmed nothing within 2km either, so the fallback correctly declined to
  force-match them to a distant, wrong polygon). These 7 are real, structural residuals now, not
  further-fixable by this mechanism.
- ~~Uruguay's 49/154 unmatched (32%) is a real structural gap in the source, not a join failure~~ —
  **fixed same day (found and fixed 2026-09-05, `city-boundaries-architecture.md`'s "Tenth pass").**
  Uruguay's geoBoundaries municipio file genuinely had no polygon for any of its 18 departmental capitals
  (Salto, Rivera, Paysandú, Tacuarembó, Melo, Artigas, Mercedes, Durazno, Minas, Florida, San José de Mayo,
  Colonia del Sacramento, Rocha, Fray Bentos, Treinta y Tres, Trinidad, ...) — its municipio law historically
  left departmental capitals under direct departmental (Intendencia) governance instead of requiring them to
  form their own municipio. **Surfaced concretely by a direct user report**: "looking at Flores... there are
  no cities, not even the capital, Trinidad" — Flores department has essentially no other town, so the
  missing capital meant the entire department showed nothing. Confirmed Trinidad was real in the source
  (GeoNames, population 22,897) and legitimately unmatched, the same root cause already logged. Fixed by
  replacing geoBoundaries entirely with a direct OSM `admin_level=8` query — a real, comprehensive
  `place=city/town/village` layer (628 relations nationwide, a populated-place tag, not an
  administrative-subdivision one) that includes every departmental capital. Result: 144/154 kept (94%, up
  from 103), 0 rejected, 10 unmatched (small towns only, largest 7,235 population — no capitals left out).
  The general lesson — a country's real settlement geometry can live in OSM under a populated-place tag with
  no administrative equivalent at all, not just under a different `admin_level` number — is worth checking
  for explicitly in the remaining 169-country walk, not just "does a finer administrative level exist."
- **The Overpass endpoint this pipeline depends on had to be swapped mid-pass** (found 2026-09-05,
  `city-boundaries-architecture.md`'s "Tenth pass"). `overpass.private.coffee` (working since the Fourth
  pass) reliably 504-timed-out on Peru's ~1,900-relation nationwide query, then also 504-timed-out on
  Jordan's own unchanged, previously-working query later in the same pass — real mirror flakiness, not a
  query regression. `overpass-api.de` (logged unreachable from this environment back in the Fourth pass)
  was re-checked directly and found reachable, fast, and able to resolve even the full Peru query in ~9s;
  switched to it as the one Overpass endpoint `buildCityBoundaries.mjs` uses. Re-running Jordan against it
  reproduced the exact prior numbers (138/148 kept), confirming the swap changed nothing about correctness.
  Worth remembering if `overpass-api.de` itself ever goes flaky in a future pass — this project has now
  seen every Overpass mirror it's tried degrade at least once.
- **An Overpass mirror can return a silently-incomplete response — HTTP 200, valid JSON, just a truncated
  `elements` array — with no error to catch** (found 2026-09-13, `city-boundaries-architecture.md`'s
  "Fourteenth pass"). Worse than the already-known 504/timeout flakiness above, because `fetchWithRetry`
  has nothing to retry on: the request "succeeded." Hit twice in the same pass — Ireland's `admin_level`
  6|7 query came back once missing the entire Dublin metro area (surfacing as 92 cities, including Dublin
  itself, newly "unmatched"), and the United Kingdom's supplemental `admin_level=8` `extraOsm` query came
  back with 5 of an expected ~232 relations (only caught because the rejection rate stayed at the
  pre-`extraOsm` 48% instead of dropping). Both resolved by simply re-running the identical query moments
  later, which returned the real, complete data both times. No code fix yet — flagged as a real risk for
  every future OSM-sourced country in the remaining 146-country walk: a plausible-looking kept/rejected/
  unmatched count is not by itself proof the underlying fetch was complete, especially right after a run
  that needed retries. A future pass could add a plausibility check (e.g. comparing `extraOsm` candidate
  counts against `researchCityAdminLevels.mjs`'s independently-known relation count) rather than relying on
  a human noticing an unchanged rejection rate.
- ~~A single area's Overpass fetch hanging forever, or exhausting its retries, could take down this whole
  script's progress on every other country/area already fetched in the same run~~ — **fixed** (found and
  fixed 2026-09-16, `city-boundaries-architecture.md`'s "Fifteenth pass"). Surfaced only once a country's
  fetch shape got big enough to matter: Germany's 20 separate per-Bundesland/Regierungsbezirk queries against
  a shared, heavily-loaded public Overpass mirror hit two real failure modes no single-query country in this
  file had ever hit before. First, `fetchOverpass` had no client-side timeout at all — a query to Bayern hung
  indefinitely past its own `[timeout:120]` Overpass-side directive with no response ever coming back, so
  `fetchWithRetry` never got the rejection it needed to retry against; fixed with a 180s `AbortSignal.timeout`
  on every Overpass fetch. Second, a single area exhausting all retries used to `throw` and crash the entire
  Germany block via an uncaught rejection, discarding every other area already fetched in the same run — hit
  twice for real, losing 9 then 3 already-fetched states each time. Fixed with a real try/catch per area (a
  total failure now logs to a `failedAreas` list in the report and the run continues) plus raising Germany's
  own per-area retry budget from the shared default of 6 to 10, given how aggressively the shared mirror was
  rate-limiting/timing out that pass. Worth remembering for any future country whose fetch shape needs many
  separate Overpass requests rather than one nationwide query — a single request's total failure should never
  be allowed to cost every other request's already-fetched progress in the same run.
- **`pointInGeometry` had no bounding-box pre-check, and stayed fast enough not to matter until France's
  ~35,000-candidate, ~15,000-point join made it the real bottleneck** (found and fixed 2026-09-16,
  `city-boundaries-architecture.md`'s "Fifteenth pass") — an unoptimized run was killed after running
  substantially longer than every previous country's join combined, still short of finishing. Fixed with
  `sphericalGeometry.mjs`'s `geometryBBox`/`bboxContains`, a cheap bounding-box check that can only ever
  reject a true negative (never changes which candidate wins, only how many full ring walks the join does) —
  re-run, France's full join completed in minutes. Worth remembering for any future country whose candidate
  count approaches or exceeds France's — Mexico's 2,457 was the previous high and never needed this.
- **Finland's Raisio (pop. 25,846, a real independent municipality near Turku, not a merger-absorbed
  town) came back unmatched** (found 2026-09-13, "Fourteenth pass") — a genuine geoBoundaries data gap
  (no candidate within `SNAP_MAX_KM` either), not a join bug. Single-country residual, logged rather than
  chased further, the same treatment Honduras's own remaining 5 got in the Twelfth pass.
- **"London" resolves to "City of Westminster" (22 km²), not a Greater-London-wide polygon** (found
  2026-09-13, "Fourteenth pass") — GeoNames' London point sits in Westminster specifically, and Greater
  London has no single `admin_level=8` polygon of its own (a two-tier structure, 32 boroughs + the City of
  London below the GLA) for "smallest containing polygon wins" to pick instead. A real, structural
  limitation for any city whose everyday name refers to a multi-borough conurbation rather than one
  administrative unit — not fixable by this pipeline's existing join logic, and not otherwise checked for
  across the 46 other done countries (a capital city spanning multiple local-government units the way
  London does is uncommon among them, but not verified absent).
- ~~Germany's first full join left 263 of 11,914 points unmatched, dominated by its own flagship cities
  (Munich, Cologne, Stuttgart, Nuremberg, Leipzig, and more) rather than a long tail of small towns~~ —
  **fixed** (found and fixed 2026-09-16, `city-boundaries-architecture.md`'s "Fifteenth pass"). Root cause:
  Germany's ~107 kreisfreie Städte (independent cities) are tagged OSM `admin_level=6`, the same level a
  normal Landkreis (county) sits at, while the per-area query only fetched `admin_level=8` — every ordinary
  town's real Gemeinde was found, but no kreisfreie Stadt's own boundary ever was. Fixed by widening the
  filter to `admin_level~"^(6|8)$"` (the same mixed-level, smallest-containing-polygon-wins pattern
  Argentina's 5|7|8 and Ireland's 6|7 already established). Re-run: 11,914/11,914 kept, 0 rejected, 0
  unmatched. Worth remembering for any future country with a similar "some cities are administratively
  simultaneously their own top-level unit" structure (Austria's statutory cities were checked and found NOT
  to have this problem — geoBoundaries' own ADM3 download already includes Vienna, Graz, Linz, etc. as
  ordinary features, unlike Germany's raw OSM tagging split).
- ~~Serbia's first join rejected 44 of 492 points, all matched to a single 3235.7 km² "Belgrade" polygon~~ —
  **fixed** (found and fixed 2026-09-17, `city-boundaries-architecture.md`'s "Sixteenth pass"). Root cause:
  the City of Belgrade's own geoBoundaries ADM2 unit spans the whole metro region (rural exurbs like
  Mladenovac and Barajevo included), so every one of Belgrade's own inner boroughs (Vračar, Zvezdara,
  Palilula, Stari Grad, ...) and outer settlements landed inside it rather than their own smaller unit. Fixed
  with a supplemental OSM `admin_level=9` layer scoped to just Belgrade's own `admin_level=7` area (166
  real, correctly-named features) via `extraOsm`, the same smallest-containing-polygon-wins pattern
  Panama/Canada/Venezuela/UK's own `extraOsm` blocks already established. Re-run: 492/492 kept, 0 rejected, 0
  unmatched. Worth remembering for any future capital whose own administrative unit is unusually large
  relative to its built-up area, the same shape as Germany's kreisfreie Städte finding above and London's
  multi-borough gap below, but the opposite fix direction (a real finer OSM layer existed here, unlike
  London's structural gap).
- **Montenegro's join rejected 4 small villages (Zagrad, Miločani, Kuta, Dučice — all under 1,000
  population), matched to Nikšić Municipality's 2019 km² polygon, just over the 2000 km² `SOFT_MAX_SQKM`
  ceiling** (found 2026-09-17, "Sixteenth pass"). Montenegro's geoBoundaries ADM1 is the finest level
  available (confirmed, no ADM2 exists) — unlike Serbia's Belgrade finding above, there's no finer real
  layer to supplement with, so this is a genuine large-rural-municipality residual, the same shape as
  Jordan's desert sub-districts. Single-country residual, logged rather than chased further.
- **Greece left 2 of 1,986 points unmatched (Kyparissía, Kalamákion)** (found 2026-09-17, "Sixteenth pass") —
  in line with every prior pass's small residual tail (Honduras 5, Finland's Raisio above, Sweden 9, United
  Kingdom 2), not investigated further since nothing about a 2-town residual out of 1,986 suggested a
  systemic wrong-level issue the way Germany's 263-major-cities pattern did.
- **Saudi Arabia is a real, significant, currently-unresolved city-boundary gap — not a small residual tail**
  (found 2026-09-18, `city-boundaries-architecture.md`'s "Eighteenth pass"). geoBoundaries' ADM2 (147
  governorates) rejects 98 of 160 GeoNames points, including the capital itself (Riyadh, 4.2M population,
  8532.8 km² governorate) and roughly a dozen other real major cities (Jeddah-area, Ta'if, Buraydah, Ha'il,
  Tabuk, Khamis Mushait, Madinah, Al Kharj, Al Hufuf, Abha, ...) — a governorate built around one substantial
  city can still span thousands of km² of surrounding desert. Checked directly whether a finer source exists
  anywhere and found none: OSM's own `admin_level=6` governorate layer (149 units) is the identical coarse
  tier under a different admin_level number, and Riyadh's own real, individually-drawn city-limit boundary
  ("مدينة الرياض"/Madinat Al Riyad, `admin_level=8`) is a genuine one-off, not part of a systematic per-city
  layer — a nationwide search for similarly-named "مدينة "-prefixed relations found only small planned
  communities and UAE cities sharing the same bounding box, not any of Saudi Arabia's other major cities. The
  OSM `admin_level=6` layer was added as a supplement anyway (it resolved the run's 2 originally-unmatched
  points, Dammam and Dhahran) but does nothing for the rejected major cities. Final: 62/160 kept, 98 rejected,
  0 unmatched. Needs either a dedicated Saudi-specific source (e.g. the country's own General Authority for
  Statistics or a national address-system open-data feed, neither investigated here) or acceptance that this
  gap stands until one surfaces — genuinely unresolved, not merely unattempted.
- **Israel's OSM-sourced local-authority join leaves exactly the West Bank unmatched** (found 2026-09-18,
  "Eighteenth pass") — 12 of 724 GeoNames points, every one a real Israeli settlement in the West Bank (Ariel,
  Talmon, Kokhav HaShahar, Nili, Na'ale, Dolev, Beit Horon, Nahliel, El'azar, Giv'on HaHadasha, Miẕpé Yeriẖo,
  Naẖal Teqoa'). Reported here as a plain technical/data-coverage fact: neither geoBoundaries' own Israel ADM2
  (its 15 subdistricts include one for Golan Heights but none covering this area) nor the OSM
  `admin_level=8` Israeli-local-authority query used for this join returns a boundary relation for any of
  these points — there is no candidate polygon in either checked source, the same "real, structural gap, not
  a technique failure" shape as Saudi Arabia's major cities above.
- **United Arab Emirates: 15 of 107 points still rejected after widening the OSM query to admin_level 4-10**
  (found 2026-09-18, "Eighteenth pass") — 11 substantial, almost all real but modern planned Dubai
  developments (Dubai Marina, Dubai Sports City, Dubai Internet City, Dubai Festival City, Dubai Investments
  Park, Al Furjan, Knowledge Village, Palm Jumeirah) falling back to the whole 7214.8 km² Dubai emirate
  polygon — plausibly just not yet drawn as their own boundary in OSM, not chased further given how much the
  level-9/10 widening already recovered (46% → 85% kept). Also 1 unmatched: Abu Musa, a small disputed island
  with no boundary in the checked source at any level.
- **Iraq's western Anbar desert border towns remain a small residual after the `admin_level=7` nahiya
  supplement** (found 2026-09-18, "Eighteenth pass") — 12 of 173 points rejected (6 substantial: Safwan,
  Al-Qaim, Rutbah, Ana, Al-Zawiya), all real towns in oversized desert qada/nahiya units — the same
  sparse-desert-district shape as Jordan's own qadas, not a technique failure.
- **Iran left 17 of 2,632 points unmatched, including one provincial capital (Yasuj, 96,786)** (found
  2026-09-18, "Eighteenth pass") — not investigated further given the pass's overall 96% match rate; worth a
  closer look if Iran's own coverage is ever revisited.
- **Oman rejected 7 of 39 points, 3 substantial** — Thamarīt (10,552), Adam (17,283), and 'Ibrī (163,473, a
  real, sizeable city) — all matched to wilayat polygons over 20,000 km² (found 2026-09-18, "Eighteenth
  pass"). Oman's 61 wilayat are geoBoundaries' only level and genuinely the country's real base
  local-government unit (not a coarser tier sitting above a municipality layer that doesn't exist), so this
  is the same "real desert district, no finer real tier" shape as Jordan's qadas — not investigated against
  OSM for a possible finer layer the way Iraq/Lebanon/Saudi Arabia were, so worth a check if Oman's own
  coverage is ever revisited.
- **Turkey left 1 of 4,028 points unmatched (Çey, a small town near the Iraq border) and rejected 317, none
  substantial** (found 2026-09-18, "Eighteenth pass") — the usual small-village-in-oversized-rural-ilçe
  residual tail this file has already logged for Ecuador/Ireland/Sweden/Greece; not chased further since no
  real city was affected.
- **Syria rejected 16 of 310 points, 1 substantial (Tadmur/Palmyra, 51,015, in a 17,173.9 km² desert
  sub-district) and left 0 unmatched** (found 2026-09-18, "Eighteenth pass") — same accepted desert-district
  shape as Oman/Jordan above, not chased further.
- **Yemen rejected 47 of 316 points, 1 substantial (Al Ghaydhah, 10,948, in a 7,182 km² district) and left 0
  unmatched** (found 2026-09-18, "Eighteenth pass") — same accepted desert-district shape, not chased
  further.
- **Kazakhstan is this file's largest remaining single-country residual: 41 of 352 points still substantial
  and rejected, after a supplemental OSM sub-district layer already took the country from 8% to 49% kept**
  (found 2026-09-18, `city-boundaries-architecture.md`'s "Nineteenth pass"). Every regional-capital-scale
  city (Karagandy, Pavlodar, Oral, Semey, Ust-Kamenogorsk, Atyrau, Kostanay, Petropavl, Turkistan) is now
  kept; what remains is smaller towns (mostly 10,000-40,000 population, e.g. Zhezqazghan 104,357, Balqash
  81,364, Sarqant 76,919) spread across a country large and sparse enough that even OSM's own real,
  comprehensive "ауыл округі" (sub-district) layer still leaves genuine gaps around them. Not chased further
  given how much the existing fix already recovered — a real, large, but not indefinitely chaseable gap.
- **Turkmenistan rejected 75 of 124 points, 26 substantial (Balkanabat 87,822, Tejen 67,488, Yolöten 37,705,
  Bäherden 37,588, ...), after switching fully to OSM** (found 2026-09-18, "Nineteenth pass") — the same
  sparse-country residual shape as Kazakhstan above, at Turkmenistan's own smaller scale; not chased
  further.
- **Kyrgyzstan rejected 63 of 112 points, 10 substantial (all real towns like At-Bashi, Toktogul, Kara-Kulja
  in oversized rural districts), after switching fully to OSM** (found 2026-09-18, "Nineteenth pass") — same
  accepted shape, not chased further.
- **Uzbekistan rejected 37 of 221 points, 7 substantial (Qŭnghirot 80,090, Oltinko'l 59,122, Novyy
  Turtkul' 48,908, ...), after a supplemental OSM layer already improved it from 49 to 37 rejected** (found
  2026-09-18, "Nineteenth pass") — same accepted shape, not chased further.
- **Tajikistan rejected 18 of 103 points, 2 substantial (Murghob 10,815 and Khorugh 30,500, both in the
  remote Pamir highlands' Gorno-Badakhshan region)** (found 2026-09-18, "Nineteenth pass") — a real,
  small, geographically genuine residual (Central Asia's most sparsely populated, mountainous region); not
  chased further.
- **Azerbaijan left 1 of 245 points unmatched and rejected 26, none substantial** (found 2026-09-18,
  "Nineteenth pass") — not investigated against OSM the way every other country in this pass was, since
  there was no substantial rejection to chase; worth a closer look if this country's own coverage is ever
  revisited.
- **Georgia rejected 10 of 218 points, none substantial** (found 2026-09-18, "Nineteenth pass") — same as
  Azerbaijan above, not investigated further.
- **Afghanistan rejected 65 of 320 points, 11 substantial (Bāzār-e Yakāwlang 65,000, Shīnḏanḏ 29,264, Khān
  Neshīn 25,600, Fayrōz Kōh/Chaghcharan 15,000, ...), all lost to oversized desert wuleswali (districts) up to
  21,667 km²** (found 2026-09-18, `city-boundaries-architecture.md`'s "Twentieth pass"). A live OSM
  admin-level check found only 54 `admin_level=7` relations nationwide — far too sparse to be a real
  comprehensive supplemental tier the way Kazakhstan's "ауыл округі" layer was — so no supplement was added;
  same accepted desert-district shape as Oman/Jordan/Syria/Yemen above, not chased further.
- **Pakistan rejected 49 of 572 points, 14 substantial (Khuzdar 218,112, Turbat 75,694, Mithi 52,376, Zhob
  50,537, Yazman 60,738, ...), concentrated in Balochistan/Sindh's own oversized desert tehsils** (found
  2026-09-18, "Twentieth pass") — a live OSM check found only 27 `admin_level=8` and 5 `admin_level=9`
  relations nationwide, too sparse to supplement with; same accepted shape, not chased further.
- **Bhutan left 1 of 34 points unmatched: Nganglam, population 707, a small town near the Assam (India)
  border** (found 2026-09-18, "Twentieth pass") — a genuine small-border-town gap, not chased further given
  the country's overall clean result (33/34 kept; Thimphu and Phuntsholing, its two real municipalities, both
  matched correctly — see `city-boundaries-architecture.md`'s Twentieth pass).
- **China rejected 7,195 of 16,055 points, 278 substantial, dominated by Xinjiang/Inner Mongolia/Tibet/remote
  Heilongjiang/Yunnan's own genuinely enormous desert/plateau county-level cities** (found 2026-09-18,
  `city-boundaries-architecture.md`'s "Twenty-first pass") — Hami's own Yizhou District alone is 81,117 km²,
  larger than several UN member states in this dataset. A live OSM check for a finer township tier
  (`admin_level=9`) in Xinjiang specifically found exactly 1 relation province-wide, confirming no
  comprehensive finer tier exists anywhere close to this scale; same accepted "real geography, not a
  technique failure" shape as Kazakhstan/Afghanistan/Pakistan above, not chased further.
- **Japan left 1 of 2,190 points unmatched: Minamichita, population 16,617, a small peninsula town in Aichi
  Prefecture** (found 2026-09-18, "Twenty-first pass") — a genuine small residual (not resolved by the 2km
  snap fallback either), not chased further given the country's otherwise clean result (2,189/2,190 kept, 0
  rejected).
- **Mongolia rejected 269 of 332 points, only 1 substantial (Tosontsengel, 9,526, just over the non-substantial
  area ceiling)** (found 2026-09-18, "Twenty-first pass") — the world's most sparsely populated sovereign
  country, and most of its GeoNames points are population-0 bag-center villages inside soums that routinely
  run 2,000-15,000+ km². A live OSM check for a finer "bag" tier (`admin_level=8`) found zero relations
  nationwide, confirming soum-level really is the finest comprehensive tier available from any checked source;
  not chased further.
- **Indonesia rejected 4,172 of 9,302 points, 40 substantial, dominated by Kalimantan/Papua/remote outer
  islands' own genuinely enormous rural regencies** (found 2026-09-18, `city-boundaries-architecture.md`'s
  "Twenty-second pass") — Merauke's own Papua regency alone is 44,201 km², larger than Denmark. Same accepted
  "real geography, not a technique failure" shape as China/Kazakhstan/Mongolia above; not chased further.
- **Myanmar rejected 80 of 576 points, 11 substantial (Dawei 136,783 in 6,855 km², Ann 119,714 in 6,279 km²,
  Myitkyina 90,894 in 6,239 km², ...), concentrated in remote Rakhine/Kachin/Sagaing border townships** (found
  2026-09-18, "Twenty-second pass") — same accepted shape as the countries above, not chased further.
- **Malaysia's Sabah/Sarawak residual: 13 of 740 points rejected, 3 substantial (Lahad Datu 105,622 in a 7,392
  km² district, Bandar Nabawan 31,807 in 6,250 km², Kinabatangan 10,256 in 7,339 km²), after adding a
  supplemental ADM2 layer already fixed the much larger initial 35-unmatched gap (Kota Kinabalu, Sandakan,
  Tawau, and 32 other Sabah towns — the Peninsular Malaysia "Mukim" tier barely reaches East Malaysia at all,
  only 16 of 1,859 features)** (found 2026-09-18, "Twenty-second pass") — real genuinely huge Sabah interior
  districts remaining after the fix; not chased further.
- **Vietnam left 1 of 913 points unmatched: Thổ Châu, population 1,829, a small offshore island** (found
  2026-09-18, "Twenty-second pass") — a genuine small-island gap, not chased further given the country's
  otherwise clean result (907/913 kept, 0 substantial rejects).
- **Australia rejected 1,743 of 4,901 points, 39 substantial (Toowoomba 142,163 in a 12,978 km² regional
  council, Mildura 34,565 in a 22,084 km² one, ...)** (found 2026-09-18, `city-boundaries-architecture.md`'s
  "Twenty-third pass") — a well-known real fact about Australian local government amalgamation (many regional
  councils genuinely span this much rural area), not a technique failure; not chased further.
- **New Zealand rejected 314 of 732 points, 13 substantial (Hastings 88,300 in a 5,213 km² district,
  Marlborough/Blenheim 29,800 in 10,463 km², ...)** (found 2026-09-18, "Twenty-third pass") — NZ's own
  "Districts" routinely amalgamate a small town with a vast rural hinterland, a real documented feature of NZ
  local government; not chased further.
- **Marshall Islands rejected 2 of 26 points (Ailuk 3,316 km², Lae 2,001 km², both real lagoon-inclusive whole-
  atoll areas) and left 2 unmatched (Aur, Kili — small outlying atolls)** (found 2026-09-18, "Twenty-third
  pass") — same accepted atoll-lagoon-inclusion shape as this file's other Pacific/coastal findings; not
  chased further.
- **Libya rejected 103 of 119 points, 57 substantial (Benghazi 757,490 in a 9,835 km² baladiya, Misratah
  355,657 in 49,770 km², ...) — the worst ratio of any country in this file, already predicted by the Fourth
  pass's own 2026-09-04 investigation, not a new finding** (found 2026-09-18,
  `city-boundaries-architecture.md`'s "Twenty-fourth pass"). Libya's baladiyat (ADM1, 22 units — the country
  has no ADM2 at all) is confirmed the finest tier that exists anywhere for Libya; not chased further.
- **Sudan rejected 60 of 112 points, 51 substantial (El Obeid 393,311 in an 8,440 km² district, El Fasher
  252,609 in 8,534 km², ...)** (found 2026-09-18, "Twenty-fourth pass") — a fresh live OSM check for a finer
  tier found `admin_level=6` returning only 129 relations, fewer than geoBoundaries' own 189 districts (not a
  finer comprehensive tier), and `admin_level=7` returning zero nationwide; confirmed no finer source exists,
  not chased further.
- **Morocco rejected 304 of 480 points, 78 substantial (Taza 162,110 in a 6,097 km² province, Settat 155,333
  in 6,881 km², ...)** (found 2026-09-18, "Twenty-fourth pass") — Morocco's rural "province"-level ADM2 units
  (as opposed to its urban "prefecture"-level ones) routinely span large agricultural/desert hinterlands
  around one real town; no finer level exists in this source at all. Not chased further.
- **Algeria rejected 35 of 353 points, 13 substantial** and **Egypt rejected 33 of 260 points, 25 substantial**
  (found 2026-09-18, "Twenty-fourth pass") — real oversized Saharan communes/Upper Egypt marakiz respectively;
  not chased further given the otherwise-clean results (both under 15% of total points).
- **South Sudan's Juba-neighborhood OSM supplement (from the Fourth pass) measured zero actual benefit**:
  every one of the 7 kept South Sudan features came from the plain ADM2 county source, none from the 37-
  relation neighborhood layer added specifically for Juba (found 2026-09-18, "Twenty-fourth pass"). GeoNames'
  own "Juba" coordinate (31.58247, 4.85165) sits in a real gap between neighborhood polygons — the nearest,
  "Hai Nyakama," comes within ~0.02° but doesn't contain it — and since Juba's own ADM2 county polygon *does*
  contain the point, the join's snap-to-nearest fallback (which only activates when no candidate contains the
  point at all) never triggers either. Result: 7/23 kept, 15 rejected (11 substantial, Juba's own
  450,000-population point among them), 1 unmatched. Kept in the code since it's still a theoretically sound,
  correctly-implemented technique that could help a future GeoNames data refresh; not chased further now.
- **Mauritania rejected 67 of 88 points, 22 substantial (Nouadhibou 146,048 in a 15,816 km² region, Zouérat
  55,183 in a 167,659 km² mining-region moughataa, ...)** (found 2026-09-18,
  `city-boundaries-architecture.md`'s "Twenty-fifth pass") — real Saharan geography, no finer tier exists in
  this source; not chased further.
- **Burkina Faso rejected 81 of 118 points, 45 substantial (Bobo-Dioulasso 904,920 in an 11,592 km² province,
  Ouahigouya 124,587 in 6,790 km², ...), after switching from ADM3 to the coarser ADM2 to fix a real
  shapeName/geometry misalignment bug** (found 2026-09-18, "Twenty-fifth pass") — ADM3's own "Ouagadougou" and
  "Bobo-dioulasso" features were geometrically located 150+ km from the real cities of those names; ADM2 has
  no such problem, just real province-level coarseness. Not chased further.
- **Nigeria rejected 137 of 927 points, 15 substantial; Niger rejected 19 of 74, 8 substantial; Senegal
  rejected 35 of 157, 4 substantial; Mali rejected 15 of 94, 6 substantial (1 unmatched)** (found 2026-09-18,
  "Twenty-fifth pass") — real oversized rural LGA/commune/arrondissement residuals, the same accepted shape as
  every other country in this pass; not chased further.
- **DR Congo rejected 81 of 118 points, 79 substantial, after a Kinshasa-commune OSM supplement already fixed
  the capital itself (16,000,000 population) and Masina (485,167)** (found 2026-09-18,
  `city-boundaries-architecture.md`'s "Twenty-sixth pass") — DR Congo's remaining rural territories are
  genuinely enormous (Sandoa territory alone is 29,712 km²), the worst substantial-rejection ratio of any
  country in this pass; not chased further given the highest-value gap (the capital) is already fixed.
- **Chad rejected 56 of 74 points, 38 substantial; Congo rejected 56 of 60, 27 substantial (after a
  Brazzaville-commune OSM supplement already fixed both of the country's two most important cities); Gabon
  rejected 36 of 50, 12 substantial; Cameroon rejected 21 of 145, 10 substantial; Central African Republic
  rejected 13 of 51, 6 substantial** (found 2026-09-18, "Twenty-sixth pass") — real oversized rural
  department/territory residuals across Central Africa's sparse, forested/Sahelian interior; not chased
  further.
- **Zambia rejected 44 of 98 points, 35 substantial; Somalia rejected 52 of 76, 27 substantial (concentrated
  in Somaliland's own Hargeisa-scale districts and limited comprehensive mapping); Kenya rejected 68 of 336,
  26 substantial; Ethiopia rejected 31 of 255, 26 substantial** (found 2026-09-18,
  `city-boundaries-architecture.md`'s "Twenty-seventh pass") — real oversized rural district residuals across
  East Africa; not chased further.
- **Malawi rejected 14 of 39 points, 6 substantial, including the capital itself (Lilongwe, 1,115,815, in a
  6,247.85 km² district combining the city with a large rural hinterland)** (found 2026-09-18, "Twenty-seventh
  pass") — a live OSM check found no separate Lilongwe-city-only boundary either (OSM's own "Lilongwe"
  relation is the same coarse admin_level=4 district); a real, confirmed gap for the capital specifically, not
  chased further.
- **Zimbabwe rejected 37 of 69 points, only 5 substantial** (found 2026-09-18, "Twenty-seventh pass") — real
  district-scale coarseness; not chased further given the low substantial count.
- **South Africa rejected 648 of 989 points, 153 substantial — the largest substantial-reject count of any
  single country in this project — including the capital, Pretoria (2,112,693, in the 6,310.24 km² "City of
  Tshwane" metro)** (found 2026-09-18, `city-boundaries-architecture.md`'s "Twenty-eighth pass") — a real,
  well-documented fact about South Africa's post-1994 municipal consolidation (Bloemfontein/Mangaung 9,898.8
  km², Welkom/Matjhabeng 5,699.1 km², Polokwane 5,065.4 km², George 5,192.9 km², Potchefstroom/
  Ventersdorp-Tlokwe 6,409.7 km²), not a technique failure; the only finer level (ADM4 "Ward," 4,392 units)
  would fragment every city into sub-few-km² pieces, the same over-fragmentation problem this file has
  rejected everywhere else. Not chased further.
- **Botswana rejected 124 of 139 points, 26 substantial, including Francistown (the country's second city, no
  unit of its own name in this source)** (found 2026-09-18, "Twenty-eighth pass") — an already-documented
  structural gap from the Fourth pass (2026-09-04): no city-scale boundary source exists for Botswana from
  either geoBoundaries or OSM. Not a new finding, not chased further.
- **Angola rejected 168 of 565 points, 12 substantial** (found 2026-09-18, "Twenty-eighth pass") — real
  oversized rural commune residuals; not chased further.
- **Namibia rejected 67 of 93 points, 12 substantial, and left 3 unmatched (Schlip, Kalkrand, Groot Aub) after
  excluding 3 confirmed shapeName/geometry-misaligned ADM2 features (a fourth instance of the Twenty-fifth/
  Twenty-sixth passes' own misalignment bug — "Opuwo" is geometrically Walvis Bay, "Walvisbay Urban"/"Walvisbay
  Rural" are both wildly oversized and displaced inland)** (found 2026-09-18, "Twenty-eighth pass") — a live
  OSM check found no substitute boundary for either Walvis Bay or the real Opuwo; a real, honestly-logged gap
  rather than a silently wrong match. Not chased further.
- **India rejected 41 of 7,112 points (11 substantial: Bhuj 148,834, Jaisalmer, Bhachau, Leh, Pokaran, Padam/
  Zanskar, Choglamsar, Abbaspur, plus Madhapar/Sukhpar/Mankuwa, which land in Bhuj's own 5,354 km² taluka) and
  left 1 unmatched (Sarupathar, 9,827)** (found 2026-09-19, "Twenty-ninth pass") — real oversized sparse-
  region units (Kutch, Thar desert, Ladakh), same shape as Mongolia/Namibia/Botswana; OSM has no
  comprehensive finer tier in these regions to supplement with (India's own city-level OSM tagging is
  inconsistent — L7/L8 for some cities, absent for Mumbai/Ahmedabad/Pune/Lucknow). Not chased further.
- **India's ADM3 fragments some megacities' own coordinates into a sub-city unit that was NOT replaced:
  Surat -> "Majura" (95.3 km²), Ahmedabad -> "Sabarmati" (334.3 km²), Mumbai -> "Mumbai Suburban" (406.5 km²,
  no Mumbai City district feature was checked)** (found 2026-09-19, "Twenty-ninth pass") — city-plausible
  scale, and OSM has no whole-city relation for Mumbai/Ahmedabad to replace with (only Delhi and Hyderabad
  did, and were fixed). Left as the honest best available unit; a candidate for a future per-city pass if
  someone reports a specific one looking wrong.
- **Russia rejected 2,202 of 5,319 non-federal-city points, 174 substantial (Ukhta 102,187 in a 13,490 km²
  okrug; Mezhdurechensk 101,026; Serov 98,438; Vorkuta 80,039; Vyborg 78,633; Beloretsk 70,468; Neryungri
  66,320 in a 98,208 km² district; Tikhvin; Krasnokamensk; Kuybyshev)** (found 2026-09-19,
  `city-boundaries-architecture.md`'s "Thirtieth pass") — real, enormous rural municipal districts with a
  town as one settlement inside; 0 unmatched. A Cyrillic-name OSM check on 15 of the biggest found no
  comprehensive finer tier (only Vyborg has an L8 relation — a one-off fix left undone as churn). Not chased
  further.
- **Russia's Saint Petersburg whole-city polygon is 2,271 km² vs. the official ~1,439 km²** (found 2026-09-19,
  "Thirtieth pass") — sea-inclusive OSM L4 boundary, accepted as-is (same call as Manila/Yeonggwang).
- **Natural Earth's RUS admin-1 layer has `RU-MOW`/`RU-MOS` swapped (oblast/city) and a nameless `RU-X01~`
  Yamal sliver** (found 2026-09-19, "Thirtieth pass") — corrected in `russiaShardKey()` for city-boundary
  sharding only. Checked `states-provinces.json`: it keys on NE's `name`, not `iso_3166_2`, and the names are
  correct ("Moskva" = city 2,841 km², "Moskovskaya" = oblast 43,797 km²) — only the ISO codes are swapped, so
  the states layer is unaffected.
- **Simferopol and Sevastopol are not in Russia's city-boundary data** (found 2026-09-19, "Thirtieth pass") —
  GeoNames files Crimea under Ukraine; consistent with Crimea's existing search-only contested-territory
  treatment, but worth knowing if Ukraine's own boundary data doesn't cover them either (unchecked).

## Visualization

- **Max zoom (`CAMERA_MIN_DISTANCE`, `scene/constants.ts` — currently 2.5, ~265km altitude) confirmed too
  far out to usefully show a neighborhood-scale city boundary, now that `CityLabels.tsx`/
  `CityOutlineHighlight.tsx` (migration plan step 3) actually ship as a consumer (2026-09-04).** This
  entry originally raised the concern hypothetically, before those components existed; wiring them in
  this pass turned it into a real, directly-observed finding, not just a worry: Jordan's Amman (Qada
  Marka, ~277 km²) and a US city (Chicago's real Census Place) both render as a clearly visible fill/
  border at the fly-to-city camera distance, but Kuwait City's matched geoBoundaries ADM2 district (real
  neighborhood scale — see `city-boundaries-architecture.md`'s Fifth pass, e.g. Qibla/Sharq/Dasman) reads
  as barely perceptible at the same distance — confirmed via a live in-browser check with the network
  fetch (`city-boundaries/414.json`) succeeding and the correct feature matched, so this is a genuine
  zoom-ceiling/rendering-scale gap, not a data or wiring bug. `CAMERA_MIN_DISTANCE` is still not an
  oversight — its own comment documents a real prior attempt at ~32km altitude that "broke badly in
  practice" (the core sphere/country-fill/border/atmosphere shells packed into too thin a margin, grazing
  camera angles looking through surface geometry instead of at it), pulled back to the current, more
  conservative range. Real decision still needed: whether a real neighborhood-scale boundary needs the
  same rendering-engine work (widening the fill/border/atmosphere shell separation) that was tried and
  reverted once already, or whether a smaller/different visual treatment (a filled dot instead of a thin
  polygon outline, below some real-world-area threshold) reads better at this zoom ceiling without
  touching camera bounds at all. Not attempted in this pass — flagged, not fixed.
- **Claims overlay's dashed border is a real dash, but the "hatching"
  described in the original spec is still an approximation.** A true
  diagonal cross-hatch fill needs a custom shader/texture —
  `ClaimsOverlayLayer.tsx`'s dashed border + prominent fill was chosen as a
  legible stand-in achievable with stock `three.js` materials. Revisit if a
  literal hatch pattern matters more than "visibly flagged, distinct color."
- **`DASH_SIZE`/`GAP_SIZE` (2026-08-15) switched from absolute world units
  to fractions of each ring/line's own normalized length**
  (`countryGeometry.ts`'s distance functions now output `[0, 1]` per ring
  instead of raw world distance) — fixes the underlying "small shape's
  border renders as a solid line instead of dashed" bug the previous
  absolute-unit version had. Now relevant only to `ClaimsOverlayLayer.tsx`'s
  dashed claim outlines — states/provinces itself dropped dashing entirely
  on 2026-08-16 (see the states/provinces FPS item below), so it's no
  longer exercising this path. The values (0.05/0.033, ~12 dashes per ring)
  are still a first-pass number chosen by reasoning about the math, not a
  browser-confirmed visual pass — worth checking dash rhythm still reads
  well across both large claimants (Russia) and tiny disputed features
  (Scarborough Reef).
- **`states` LOD reveal distance (5.0, `src/lod/lodLevels.ts`, 2026-08-15)
  is a first-pass number, not eye-tuned in the browser** — chosen to land
  just outside `CAMERA_FOCUS_DISTANCE` (4.8) by reasoning about the camera
  system, the same way the existing city tiers were hand-tuned by watching
  the app run but this one wasn't. Worth confirming in the browser that
  admin-1 boundaries reveal at a distance that actually feels right, not
  just "technically fixes the FPS regression" (which it didn't fully do —
  see the states/provinces FPS item below).
- **States/provinces FPS: per-country merge + React re-render fixes
  implemented (2026-08-17).** LOD-gating and a front-facing filter
  helped but didn't reduce per-mesh overhead; a first merged-mesh attempt
  (one single global mesh) fixed that but made Europe WORSE — measured,
  not guessed: no internal spatial structure means R3F's unthrottled
  per-pointermove raycast does a flat linear scan of every triangle once
  the one bounding sphere passes, and Europe had ~2.7x Brazil's active
  triangles at a comparable zoom. `scene/useMergedFillsByCountry.ts`
  merges per COUNTRY instead (119 meshes over Europe instead of 1, worst
  case 39,609 triangles instead of 227,116) — genuinely better, but still
  reported as laggy. A second, independent cost was compounding it: React
  re-rendering every active country mesh on every hover change (unstable
  callback props defeated any memoization) plus `Array.find()`/`.some()`
  re-scans of up to ~2,700 entries per hover change. Fixed with
  `useCallback` all the way from `StatesProvinces.tsx` down through
  `useClickDragGuard.ts`, a `Map`-based O(1) lookup in
  `ProvinceFillLayer.tsx`, and `React.memo` on `CountryFillMesh`.
  **Measured before AND after this second fix** (a synthetic
  `PointerEvent('pointermove')` sweep timed with `performance.now()`, the
  exact code path a real mousemove triggers): Brazil ~11ms → ~5.75ms/event,
  Germany ~25ms → ~7.9ms/event — the region gap nearly closed.
  **Confirmed by the user: smooth when zoomed on a single country, still
  choppy when most of Europe is in frame — remeasured and quantified
  (2026-08-17): 4 active countries/4,694 triangles at single-country zoom
  vs. 119 active countries/290,612 triangles at the "most of Europe" zoom,
  ~30x more. None of the fixes so far reduce active MESH COUNT for a wide
  view — they reduced per-mesh cost and eliminated wasted re-renders, a
  different axis.** Resolved a different way (2026-08-17, part 10): rather
  than a rendering-side fix for the wide-view case, `lod/lodLevels.ts`'s
  `'states'` tier `revealDistance` was tightened from 5.0 to 2.8 — at that
  distance the camera is too close for "most of Europe" (or any comparably
  wide multi-country view) to be in frame at all, so the ~30x-mesh-count
  case doesn't occur anymore rather than being made cheap. Confirmed
  working by the user in the browser. The cap/cluster and BVH-single-mesh
  options are no longer needed for this specific case, though either would
  still be the right call if a future wide-view use case needs states
  visible at a looser zoom than 2.8 allows.
  **2026-08-20: eased to 2.85** (matching the `'metro-areas'` city tier
  exactly, per direct request that states/provinces read at the same zoom
  level as major cities) — a much smaller move than the 5.0/3.5 → 2.8 jump
  that originally fixed the wide-view case, so expected to be safe, but
  NOT yet re-profiled in the browser the way that fix was. Re-check the
  "most of Europe" case if choppiness is reported again.
- **States/provinces layer-mount freeze: FIXED and verified (2026-08-17).**
  Was a ~1.3-1.7 SECOND synchronous main-thread block, reported by the
  user as "delay/lag on the switch when turning on the states/provinces
  layer." Root cause, found by instrumenting three candidates rather than
  guessing (fetch 368ms, topology conversion 268ms, per-country merge
  29-48ms — all ruled out): `buildGeoEntityEntries(features)` in
  `StatesProvinces.tsx` — earcut triangulation for all 4,539 provinces run
  synchronously inside a `useMemo`. Not a regression from anything else
  done this session; an original, never-separately-measured cost of the
  1:10m upgrade itself. Fixed with `scene/useChunkedGeoEntityEntries.ts` —
  processes the triangulation in batches of 400 across
  `requestIdleCallback`/`setTimeout` turns instead of all at once.
  **Verified with a real `PerformanceObserver({entryTypes: ['longtask']})`
  capture, not eyeballed**: before, one 1,320-1,683ms task; after, five
  ~102ms tasks. `StateProvinceLabels`/`ProvinceFillLayer` now populate
  progressively over roughly the same total wall-clock time instead of
  appearing all at once after the freeze — an intentional, accepted
  tradeoff, not a bug.
- **`useFrontFacingEntries.ts`'s initial state defaults to the FULL
  unfiltered entries list** (deliberate, 2026-08-16, to avoid a flash of
  emptiness before the first filter pass) — means the very first render
  after mount briefly requests ALL 235 countries before the throttled
  filter narrows it down. Somewhat mitigated now that entries arrive
  chunked (all 235 aren't actually available to request until every chunk
  lands anyway), but the underlying "default to everything vs. nothing on
  first render" tension is still there. Low priority now that the
  wide-view mesh-count case above is resolved via LOD gating rather than a
  filtering fix, but still worth a look on its own.
- See `LOGBOOK.md`'s "States/provinces FPS" parts 1-10 for the full
  reasoning trail behind all three items above, including every round of
  measurement methodology, if this needs re-profiling again.
- **`hud/LegendPanel.tsx`'s overlay rows are hardcoded to specific layer
  ids** — `'parent-territory-overlay'`, `'claims-overlay'`, and now (v3.3.0)
  a list of all six `'highlight-*'` ids — rather than driven generically by
  the Layer Engine registry. A future overlay layer would need a manual
  `LegendPanel.tsx` edit to appear in the legend — unlike registering the
  layer itself, which needs no edits anywhere else (see `CLAUDE.md`'s Layer
  Engine section). This item was flagged after two layers and is still
  unaddressed after three (one of them six ids at once) — worth actually
  doing now: an optional `legend?: {color, label, description}[]` field on
  `LayerDefinition`, so `LegendPanel.tsx` can iterate
  `getLayerDefinitions()` the same way `LayerPanel.tsx` already does,
  instead of naming ids by hand.
- **Crimea still has no rendered geometry** — confirmed to genuinely not
  exist as a standalone polygon anywhere in `world-atlas`'s source data (not
  just unimplemented). Hand-authoring a real sub-region shape is possible
  but was explicitly treated as "not this project's call to make casually"
  as far back as v2.2.0 — revisit only with a deliberate decision, not as a
  drive-by fix.

## Planned engines (named in `CLAUDE.md`, none started)

- **Country Engine** — `data/types.ts`'s `Country` interface has
  `population`/`gdpUsd`/`government`/`region` fields the registry never
  populates; only `id`/`name` are set (`scene/useCountryFeatures.ts`).
  `data/countryProfiles.ts` covers ~60 countries with illustrative,
  hand-written data for the Intelligence Panel only — the two datasets were
  deliberately never merged (see `LOGBOOK.md`'s v2.1 reasoning). A real
  Country Engine would need to decide whether to populate the registry from
  a live source or finally reconcile the two datasets.
- **Relationship Engine** — `data/types.ts`'s `Relationship` type (alliances,
  treaties, trade partnerships, tensions) is schema-only; `data/relationships/
  relationships.json` ships empty. Nothing renders a relationship arc
  between two entities anywhere in the app.
- **Intelligence Engine** — as of v6.3.1, MILITARY is wired to real data
  (`data/militaryScores.ts`, country selections only) with a citation
  drill-down; as of v6.6.0, ECONOMY (`data/economyScores.ts`,
  `scripts/buildEconomy.mjs` — percentile-rank normalization + the weighted-
  sourceCoverage confidence model, a deliberate divergence from Military's
  log-min-max/coverage-floor mechanism, see design doc §3.2 and
  `LOGBOOK.md`) has the identical treatment: `IntelligencePanel.tsx`'s
  ECONOMY status bar, citation drill-down, and `AnalyticsPanel.tsx`'s
  ECONOMY thumbnail/sortable ranked-list columns are all wired up, sharing
  the generic ranked-list machinery Military's own v6.5.3/v6.5.4 columns
  established (`BaseRankedRow`/`AnalyticsColumn`/`compareRows` — see
  `CLAUDE.md`'s v6.6.0 entry). TECHNOLOGY got the identical treatment later
  the same day (`data/technologyScores.ts`, `scripts/buildTechnology.mjs` —
  World Bank WDI + a hand-transcribed ITU IDI table): status bar, citation
  drill-down, and `AnalyticsPanel.tsx` ranked-list columns, all real and
  sourced, no placeholder left. DIPLOMACY was never built out the same way
  (its weighting was never locked — design doc §9) and was **dropped
  entirely (v6.9.1, 2026-08-26)** rather than shipped as a permanent
  placeholder — direct decision, not a deferral. See `CLAUDE.md`'s
  "Diplomacy dropped" entry and `LOGBOOK.md`'s 2026-08-26 entry for the
  removal. There are 4 Intelligence Engine categories now, not 5.
  **CURRENT STATUS is a different shape of gap, as of `scripts/
  buildCurrentStatus.mjs`/`data/currentStatus.ts`:** real, sourced data
  exists (UCDP conflicts + a 3-tier OFAC sanction model, see design doc §3.5
  and `LOGBOOK.md`) and `IntelligencePanel.tsx` reads it — a `ConflictChip`
  row (colored/labeled by `conflictType`, citation in a tooltip) plus a
  standalone `SanctionBadge` ("S", colored red/orange/yellow by
  `sanctionTier`, program name(s) in a tooltip), deliberately not the
  `IntelRow`/bar treatment Military/Economy use, per the design doc's "two
  independent fields, not a composite score." **`AnalyticsPanel.tsx` wiring
  is now done too (v6.7.2):** a filter-tabs-plus-sortable-list view
  (ALL / ACTIVE CONFLICT / SANCTIONED tabs with live counts; COUNTRY /
  CONFLICTS / SANCTION sortable columns), not a `buildXRows`/`X_COLUMNS`
  copy of Military/Economy's ranked-list-with-a-SCORE-bar machinery — there
  was still no single number to put in that bar, so this got its own design
  pass instead, per this entry's own prior note. `CONFLICT_TYPE_STYLE` moved
  out of `IntelligencePanel.tsx` into a new shared `scene/
  conflictTypeStyles.ts` (mirroring `scene/sanctionTierColors.ts`) so both
  surfaces color a conflict type identically. Every Intelligence Engine
  metric that still exists (Military, Economy, Technology, Current Status —
  Diplomacy was dropped, see above) now has real UI treatment wherever real
  data exists — see `CLAUDE.md`'s v6.7.2 entry for the full breakdown.
  **Still open:** ORANGE/YELLOW sanction-tier assignments and program names
  are secondary-source seeds, not individually verified against each
  country's own OFAC program page — see this file's `buildCurrentStatus.mjs`
  gap-report section above for the specific verification TODO before this
  ships as more than portfolio-demo-confidence data. And a real sanction
  logo (`Intelligence Docs/current-status/`) hasn't landed yet — the S badge
  is a placeholder until then.
  **Also raised (2026-08-27): Current Status has no way to represent
  "gray zone"/Cold-War-like tension short of an actual UCDP-typed
  conflict** — e.g. Taiwan-China (median-line incursions, ADIZ pressure,
  coercion below UCDP's 25-battle-deaths-in-a-year threshold), correctly
  shows `conflicts: []` today, which is accurate to UCDP's own methodology
  but reads as "nothing going on" for a relationship that clearly isn't
  calm. `ConflictType` shouldn't be extended for this — that union is
  meant to mirror UCDP's real classification 1:1, and "gray zone" isn't a
  UCDP category. If this gets built, it's a separate field (parallel to
  `sanctionTier`, not a conflict), and unlike UCDP's battle-death
  threshold or OFAC's program list, "gray zone" has no bright-line,
  widely-cited source to hand-seed from — the user wants to discuss the
  framing with a geopolitical professional before this gets specced out
  any further. Not started.
- **Data Engine** — every dataset in `src/data/registry/` is hand-curated
  and static; there's no live-refresh mechanism, and every provenance note
  says as much (`confidence: 'estimated'`, "not a comprehensive or
  authoritative dataset").
- **Timeline Engine** — no version of Atlas has any time-based dimension
  (dispute history, when a territory changed hands, etc.) — every dataset
  is a single present-tense snapshot.

## Layer Engine

- **`src/layers/placeholders/` (terrain, infrastructure, conflict) are still
  architecture-validating stubs, not real layers** — each is registration +
  lifecycle logging + a trivial debug marker, unchanged since v2.0. A real
  terrain/infrastructure/conflict layer is still a from-scratch build, not
  a placeholder-to-real upgrade.
- **Relationship arcs as a Layer Engine layer** — once the Relationship
  Engine (above) has real data, rendering alliance/tension arcs between
  entities is a natural `geoOverlays`-style layer, following the same
  pattern `ParentOverlayLayer`/`ClaimsOverlayLayer` established.

## Tooling

- **No registry-level tests exist** — v4.3.1 added Vitest coverage for this
  repo's pure geometry/math functions (`utils/geo.ts`, `lod/lodLevels.ts`,
  `scene/labelDeclutter.ts`, `scene/countryGeometry.ts`), but
  `src/data/registry/`/`src/entities/` (CountryRegistry, GeoEntityRegistry,
  EntityResolver, GeometryMap) still have none. Worth adding if that layer
  keeps growing — the kind of id-mismatch bug documented in `LOGBOOK.md`'s
  v3.0.1 entry (alpha-3 vs. numeric country ids) is exactly the class of bug
  a handful of registry-level unit tests would have caught immediately
  instead of shipping silently broken.
- **`CLAIMS.md` only covers `claimedBy`/`claims`** — `administeredBy` and
  `parentEntity` relationships (who actually controls Western Sahara,
  which country each Territory belongs to) have no equivalent generated
  register. Could be a second section in `CLAIMS.md` or a sibling generated
  doc if that information turns out to be useful outside the app itself.
- **`data/registry/GeoEntityRegistry.ts`'s `getRelatedEntities()` has no
  UI consumer yet** — built as general-purpose infrastructure for the
  claims overlay and future relationship-graph views, but only
  `ClaimsOverlayLayer.tsx` currently does its own narrower relationship
  walk rather than calling it. Worth revisiting once a second consumer
  actually needs it, to confirm the function's shape is right rather than
  speculative.

## Not yet verified

- **A real, hand-sourced US Hispanic/Latino ethnicity override is a genuine open follow-on, not built yet.**
  Verified directly (2026-08-26): UNSD's US ethnicGroups entry uses the same Census Bureau RACE categories
  (White, Black or African American, Asian, ...) Factbook's own text already summarized — no separate
  Hispanic/non-Hispanic breakdown exists in UNSD's US data either, so the structural gap Factbook's own note
  flags ("a separate listing for Hispanic is not included... an estimated 18.7% of the total US population is
  Hispanic") persists unchanged under the UNSD-primary source. Layering real Census Bureau ethnicity-question
  data (e.g. ACS table B03002) on top of the UNSD race breakdown, specifically for the US, would need to be a
  new, explicit, hand-built exception — nothing like it exists in the codebase today. See `LOGBOOK.md`'s
  2026-08-26 "Demographics re-sourced to UNSD-primary" entry for the full verification trail.
- **`scripts/buildCurrentStatus.mjs`'s Factbook ethnicity/religion parser (`parseFactbookPctList`, the
  fallback path once UNSD doesn't cover a country/field) still drops some real, human-readable data as
  unparseable rather than extracting it** — e.g. Saudi Arabia's religion text ("Muslim (official; citizens
  are 85-90% Sunni and 10-12% Shia), other (...)") has real percentages, just nested inside a parenthetical
  aside instead of a top-level clause; the parser intentionally doesn't reach into a paren to find them (see
  the script's own DEMOGRAPHICS header comment for why — risk of misattributing a nested figure the way the
  Taiwan bug did). Every case like this is logged in the demographics gap report above, not silently dropped
  — worth a look if the remaining ethnicity/religion gaps (after UNSD; see the gap report's own generated
  counts) ever need to shrink further.
- **UNSD's own real data-quality issues are only handled where they were actually found, not exhaustively
  audited for every one of the 113/117 covered countries.** Confirmed real: duplicate (country, year, group)
  rows across census Record Types (Fiji 2007, Malaysia 2010 — the latter's conflict never surfaces in this
  app's output only because a cleaner 2020 record also exists), and at least one implausible outlier value
  spotted while investigating (a since-unused Venezuela ethnicGroups row reporting "Indigenous: 272,279,300,"
  ~10x Venezuela's real population — never trusted because Venezuela has no "Total" row to use as a
  denominator either way, but the raw table itself may have more silently-implausible values that happen to
  have a valid Total row nearby and would currently be trusted as-is). Worth a systematic sanity check (e.g.
  flag any resolved UNSD total that's wildly off from a country's known population) if this data is ever
  promoted beyond portfolio-demo confidence.
- **The v3.1.5 "related country" overlay's dual-role case (Gibraltar: UK as
  parent, Spain as claimant, both highlighted simultaneously) has only
  been checked against the data (`tsx`, not a browser)** — confirmed the
  right two countries and roles resolve, but not that the two markers'
  leader-line callouts (each offset from its own country's centroid) don't
  visually crowd each other at typical zoom levels. No browser tooling was
  available this session either.
- **Mobile/narrow-viewport layout for the v3.1 HUD additions**
  (`LegendPanel`/`Telemetry`'s shared bottom-left stack,
  `IntelligencePanel`'s full-width-on-mobile behavior) was reasoned about
  but never checked in an actual narrow browser viewport — no browser
  tooling was available in the sessions that built it.
- **No accessibility pass** (ARIA labeling) has been done specifically for
  the v3 additions (`LegendPanel`, the claims/territory overlay toggles in
  `LayerPanel`, `GeoEntityDetails`). The rest of the HUD has the same gap;
  it isn't v3-specific, just never addressed.
- **v3.2.0's entire keyboard input system has never been exercised in an
  actual browser** — every check that could be done without one was done
  (typecheck, lint, production build, dev server boot, the directional
  algorithm verified against real geography via a standalone script — see
  `LOGBOOK.md`'s v3.2.0 entry), but no keypress has actually been sent to a
  running page. Needs a real pass: does W/A/S/D/Q/E feel right at the
  chosen rates (`ROTATE_RATE`/`TILT_RATE`/`ZOOM_RATE` in
  `input/CameraController.ts` — picked relative to the existing camera
  bounds, not tuned by feel), does arrow-key navigation reliably land on
  the geographically-obvious neighbor, does the two-stage Escape feel
  natural, does Tab's category-cycling read as useful once you can actually
  try it.

- **`scene/useDistanceScaledRotateSpeed.ts`'s `MIN_DISTANCE_ROTATE_SCALE`
  (0.25, 2026-08-17) was picked by reasoning about the math, not tuned in a
  running browser.** Added because rotate-drag was reported as too fast when
  zoomed in close, even at the sensitivity slider's own minimum (0.1) —
  scales the effective `rotateSpeed` down as camera distance approaches
  `CAMERA_MIN_DISTANCE`, leaving `CAMERA_DEFAULT_DISTANCE` and beyond
  unchanged (the zoom level the slider's default of 0.5 was already judged
  correct at). Worth a real check at the closest zoom to confirm 0.25 is the
  right amount of damping, not just "less than before."

## Input Layer (v3.2.0)

- **Tab/Shift+Tab were repurposed for entity-category cycling, which means
  they no longer move DOM focus between HUD elements while the app has
  "keyboard navigation focus"** (anywhere outside a text input). That's a
  real accessibility regression for keyboard-only users who'd otherwise
  Tab through the toolbar/panel buttons — a deliberate trade-off to satisfy
  the spec's explicit Tab binding, not an oversight, but one that should be
  revisited alongside a real accessibility pass rather than left as
  permanent.
- **"Cycle forward through available selectable entity categories/layers"
  was ambiguous** — could mean cycling entity-type categories (what was
  built: country → geopolitical-entity → territory → strategic-region →
  maritime-feature → geographic-region, landing on the alphabetically-first
  entity each time) or cycling registered Layer Engine layers, or something
  else entirely. Went with the entity-category reading since Tab sits in
  the spec's "ENTITY SELECTION" section, not "HUD CONTROLS" — worth
  confirming this was the intended behavior.
- **`SelectionController.ts`'s directional algorithm inherits
  `geometryToCentroid()`'s known imprecision** (that function's own doc
  comment: "simple, non-area-weighted centroid... not meant to be a
  precise geographic centroid"). Verified against real data that this
  produces occasionally-surprising results for oddly-shaped countries
  (Germany → south and → west both resolved to Luxembourg) — not a bug in
  the new arrow-key algorithm, the same imprecision every existing consumer
  of that function (hover labels, camera flight targets, search) already
  has, just newly visible because directional navigation is more sensitive
  to centroid placement than those uses are. Would improve automatically if
  `geometryToCentroid()` ever moves to an area-weighted calculation — not
  attempted here (out of scope; "do not rewrite existing functionality").
- **No haptic/audio feedback for arrow-key navigation landing on nothing**
  (pressing an arrow when there's no candidate in that direction, e.g.
  east of the easternmost entity) — currently a silent no-op. Might be
  worth a subtle HUD cue so it's clear the key was received, not just
  that nothing happened to be there.
