# Project Atlas — News & Sourcing System Design

**Status:** Active scaffold — design in progress, not yet implemented. **Scope:** News tab (standalone, tabbed) + per-country news surfacing on the Intelligence Panel. **Explicitly deferred:** Organization panels (terrorist/criminal non-state actors) — backlog item. No fixed geography, cross-border presence, and a separate ID space needed; folding it in now would block this whole feature on a harder problem. `linkedEntityIds` points only at existing 193-country IDs for v1.

------------------------------------------------------------------------

## 1. Why this matters

The News tab is not a bolt-on feature — it's what separates Atlas from "just a globe with static country stats." Alongside the Globe and Analytics panel, it's a first-class pillar of the app, arguably the most differentiating one, since it's the only part of Atlas that's *alive* rather than a snapshot.

------------------------------------------------------------------------

## 2. Governing principles (inherited + news-specific)

- **No scoring metric.** News does not feed the Intelligence Engine's scored categories (Military/Economy/Technology/Current Status). It's presented, not ranked into a bar.
- **Sourced or unscored still applies to defensibility**, even without a numeric score — every claim must trace to a named source or be excluded.
- **Validity over volume**, especially for military/terrorism/criminal claims. Severity-gated publishing (§6) is the core integrity mechanism.
- **First-hand accounts are never given a political leaning.** They get their own schema and their own visual treatment — a testimony is not an editorial position.
- **Community discussion is never evidence.** Community Pulse (§9b) is structurally walled off from corroboration/severity logic — it informs nothing about what's published or how it's tiered.
- **Static build-time pipeline**, same as the rest of Atlas. News refreshes **twice daily at 10AM and 10PM** via a recurring `buildNews.mjs`, plus an **event-triggered exception for breaking news** — a qualifying event (e.g. a Critical-tier trigger firing) can kick off an out-of-schedule build run. This is still build-time and static from the client's perspective, not a runtime call — the trigger mechanism becomes cron **and** event-triggered rather than pure cron, which is a genuinely new pattern for Atlas worth a CLAUDE.md/LOGBOOK note when implemented.

------------------------------------------------------------------------

## 3. Relevance scope — what counts as "geopolitical-adjacent" for Atlas

This is the hardest-won part of the design so far — early drafts were too narrow (event-only) and let irrelevant name/keyword matches through (a FIFA president story matching on "president"; a footballer's remarks matching on "racist"). Revised scope below incorporates both event-based *and* structural/systemic geopolitical relevance.

### In scope

- **A state actor takes or announces an action** — government, military, head of state/government — doing something, not merely being named in passing.
- **A structural/systemic risk theme** materially affecting global markets, supply chains, or alliance structures (see §4b, Systemic Theme Tags). An individual article doesn't need to be dramatic on its own if it's a real data point feeding an ongoing dynamic (e.g. one more data center regulation in the AI/tech-decoupling theme).
- **Cyber / critical-infrastructure attacks**, state-backed or otherwise — own trigger, doesn't require kinetic violence to qualify.
- **AI/technology governance, export controls, tech-sovereignty policy** — explicitly geopolitical when tied to great-power competition, not treated as neutral R&D news.
- **Domestic political developments in strategically significant countries** (leadership changes, election outcomes/eligibility rulings, major policy shifts) — test is *plausible effect on the country's foreign policy trajectory or alliance posture*, not mere mention of an official.
- **Organized crime / domestic incidents that trigger a state security or diplomatic response** (terrorist-organization designation, indictment of officials, international escalation) — the state action is what brings it into scope, not the underlying incident alone.
- **Natural disasters causing significant population displacement** (e.g. wildfires, major earthquakes) — feeds Humanitarian & Displacement and the existing planned `DisplacementFlow` model.
- Cross-border consequence generally: trade, conflict, migration, diplomacy, sanctions.
- Non-state armed/criminal actor operational activity (attack, trafficking action, arrest tied to same).

### Out of scope

- Sports, entertainment, celebrity content — even when it involves a "president"/official title or a country name, with no governmental substance.
- An official's personal remarks/rhetoric with no policy action or trajectory-altering potential attached (stays out entirely, or drops to Routine at most).
- Domestic incidents (crime, disasters) with no state security/diplomatic response and no international dimension.
- Human-interest or opinion pieces that merely reference a country/conflict without reporting a new state action or event.
- Community discussion/sentiment (Reddit, Twitter/X) — see §9b. Never treated as a news item, ever.

### Still open

- Where exactly domestic-violence-with-no-international-dimension sits: **resolved** — such incidents stay in scope but are capped at Significant, regardless of casualty count, unless a state security/diplomatic response attaches (which can then push it into Major per the existing rule). Flagged from the Philippines school-shooting discussion.

------------------------------------------------------------------------

## 4. Tagging model — two independent tag dimensions

An article can carry tags from **both** dimensions simultaneously, and **multiple tags within a dimension** (e.g. a Houthi strike on Saudi Arabia in retaliation coordination with Iran is both Conflict and Terrorism). They answer different questions: *what kind of event is this* vs. *what larger dynamic does it feed*.

### 4a. Event-type tags (`topicTags`) — now eight, drives tab structure (§9a)

1.  Conflict & Security
2.  Terrorism & Non-State Actors
3.  Diplomacy & Politics
4.  Economic & Trade
5.  **Energy** — new. Pipelines, energy infrastructure attacks, OPEC/production decisions, price shocks, refinery strikes, chokepoint disruption. Split out from Economic & Trade because it earned its own tab (§9a); distinct from the "Energy Security Crisis" systemic theme, which can badge articles across Energy, Conflict, *and* Economic & Trade simultaneously — the theme is the ongoing narrative thread, the tag is what populates the tab.
6.  Humanitarian & Displacement
7.  Crime & Trafficking
8.  Science & Technology

**Decision: Terrorism & Non-State Actors stays separate from Conflict & Security, not merged.** Tested against two real examples (a US strike on Houthis as an Iran proxy after a Saudi attack; a KGB-linked assassination attempt on a Ukrainian diplomat in Monaco) — both genuinely span both tags, but that's because terrorism examples by nature tend to be conflict-adjacent. The reverse isn't true: the bulk of Conflict-tab content (state-vs-state strikes, troop movements, ceasefires) has nothing to do with terrorism. Merging would dump all terrorism content into the already-highest-volume tab, working against the whole point of tabs (preventing overload). Overlap is handled by the multi-tag placement rule below, not by merging categories.

**Multi-tag placement rule:** an article appears in **every** tab whose tag it carries — no forced single "primary tag." `topicTags` is already an array; this is a filter question, not a schema change.

*(Terrorism & Non-State Actors exists as a tag now even though org panels are deferred — a news item can be tagged and geo-linked without needing the separate non-state-actor entity model.)*

### 4b. Systemic theme tags (`systemicThemes`)

Persistent, ongoing risk dynamics that individual articles feed into over time, modeled on the risk-register structure in a reference document reviewed this session:

- Middle East Regional War
- Energy Security Crisis
- Global Technology Decoupling
- Major Terror or Cyber Attack(s)
- Western Hemisphere Tensions
- Global Trade Protectionism
- U.S.–China Strategic Competition
- Russia–NATO Conflict
- Transatlantic Reordering
- North Korea Conflict

*(This list should be treated as a living set, not fixed forever — reviewed periodically as global dynamics shift, similar to how a risk register is revisited. Unlike the event-type tags, this list is expected to change over time. Themes cut across multiple topic tags/tabs by nature and do not get their own tab — they surface as a badge/filter within whichever topic tab an article already lives in.)*

### Open question — elaborated

Should each systemic theme also carry its own **standing likelihood/trend indicator** (e.g. "Middle East regional war: High"), independent of any single article — the way the reference risk document assigned a persistent judgment call to each risk line, revisited periodically rather than derived live from article counts? This is a real scope decision, not a schema nicety: an automated proxy (e.g. "more Critical-tagged articles this month = trending up") would be a poor substitute for genuine analytical judgment. Doing it properly means a standing research/writing commitment — periodically sitting down and making a real editorial call on each theme, the same kind of work that produced the reference document — not something that falls out of the corroboration/severity pipeline automatically. **Not yet decided whether this commitment is worth taking on.**

**Systemic theme list review mechanism** (separate from the trend-indicator question above — this is about changing the *list itself*, not updating each theme's status): a **quarterly pass**, asking two questions — (a) has a new persistent risk dynamic emerged that deserves a standing theme (e.g. a new war becomes protracted enough to warrant its own line, the way "Russia–NATO Conflict" earned one), and (b) has a listed theme effectively resolved or gone dormant (e.g. a meaningfully de-escalated North Korea situation)? **Retirement is archival, not deletion** — a retired theme gets an `active`/`archived` status rather than being removed from the data model. Archived themes stop appearing as an active filter/tab badge going forward, but stay attached to their historical articles and can be reactivated (flipped back to `active`) if the underlying dynamic resurfaces later, without losing any historical linkage.

------------------------------------------------------------------------

## 5. Severity tiers — four levels, tag-scoped definitions

**Critical \> Major \> Significant \> Routine**

| Tier            | Conflict & Security / Terrorism                                                                                                                                                                    | Diplomacy & Politics                                                                                                                                | Economic & Trade / Energy                                                                                             | Humanitarian & Displacement                                                                                        | Crime & Trafficking / Sci-Tech                                                                                                                    |
|-----------------|----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------|-----------------------------------------------------------------------------------------------------------------------------------------------------|-----------------------------------------------------------------------------------------------------------------------|--------------------------------------------------------------------------------------------------------------------|---------------------------------------------------------------------------------------------------------------------------------------------------|
| **Critical**    | Head-of-state/government casualty; WMD/chemical/nuclear use; mass-casualty single incident (**10+ deaths, single reported incident** — see note); capital-city/embassy attack                      | Regime change (coup, overthrow, forced resignation of head of state); war declaration; withdrawal from major security pact (NATO, nuclear treaties) | Sovereign default; currency collapse; major sanctions-regime change; major chokepoint closure (e.g. Strait of Hormuz) | **500+ deaths in a single disaster event, OR 500,000+ people displaced, OR PHEIC-equivalent outbreak declaration** | Not applicable on its own — only reaches Critical by co-occurring with another tag's Critical trigger                                             |
| **Major**       | Real strike/attack with casualties below the single-event threshold; significant territorial change; notable escalation (new weapon type, cross-border strike into previously untouched territory) | Real major policy action/realignment: real sanctions package, formal treaty-exit notice, snap election call                                         | Market shock, major central bank action, significant trade-deal collapse, notable production-cut/price-shock event    | **50+ deaths in a single disaster event, OR 10,000+ people displaced/requiring emergency shelter**                 | Cyberattack on critical infrastructure; major cartel/trafficking action triggering state response (e.g. FTO designation, indictment of officials) |
| **Significant** | Real but contained military/security action; ceasefire violation; notable troop deployment                                                                                                         | Real policy step, election outcome, notable diplomatic engagement — below Major's "package/realignment" bar                                         | Routine-but-real trade/tariff/energy-policy action, notable but non-shock market move                                 | Notable but contained humanitarian development                                                                     | Real, notable individual crime/trafficking event with cross-border or organized dimension                                                         |
| **Routine**     | Statements, rhetoric, posturing, procedural/diplomatic notices with no concrete action yet                                                                                                         | Political rhetoric, remarks, non-binding statements                                                                                                 | Routine market commentary, minor procedural trade/energy news                                                         | Minor/localized humanitarian news                                                                                  | Minor/local crime news with a tangential state mention                                                                                            |

**Evacuation note (J, 2026-09-21):** an evacuation ORDER or ADVISORY is *not* displacement and is ranked one tier below the same number of people actually displaced. 500,000+ people under evacuation orders is **Major**, never Critical (the same number actually displaced is Critical); a smaller evacuation adds nothing beyond the humanitarian baseline. Decided against the live case of a typhoon with "1.6 million urged to evacuate", which the doc's original wording would have made Critical.

**Domestic-incident note (J, 2026-09-21, restating §3):** domestic violence incidents (a school shooting) and incidents in which a state actor is the actor (an ICE agent shooting someone) stay in scope, capped at Significant.

**Single-event death threshold note:** 10+ deaths in one reported incident is an **internally set judgment call**, not a borrowed/citable figure the way UCDP's 25+/year aggregate threshold is (used elsewhere in Atlas for Current Status conflict inclusion). Logged explicitly as such — if Atlas's "sourced or unscored" defensibility standard is ever extended to non-scored features, this is the number that would need its own justification on record.

**Humanitarian/disaster thresholds are deliberately separate numbers from the conflict threshold**, not a reuse of the 10-death figure — natural disasters have a much higher base rate (a "routine" earthquake often exceeds 10 deaths), so reusing the conflict number would make Humanitarian's Critical tier trivially easy to hit and meaningless as a filter. The 50/500-death and 10,000/500,000-displacement numbers above are, like the conflict threshold, internally set judgment calls open to adjustment — not borrowed/citable figures.

**Fallback rule** for anything not matching an explicit trigger: Significant if it substantively names a country leader, government body, or military unit taking a real action; Routine otherwise. This fallback only runs *after* the relevance gate (§6) — it does not itself determine relevance.

------------------------------------------------------------------------

## 6. Relevance gate + classification pipeline

**Root cause of early misclassifications:** keyword/name matching was doing double duty as both a relevance filter and a severity signal, with no actual substance check. ("FIFA president" matched on "president"; Trump's mail-in-voting remarks and Ukraine missile strikes both matched "significant" purely on name/military-word presence, despite being wildly different in actual stakes.)

**Pipeline, tiered by reading depth (cost-aware):**

1.  **Cheap keyword pre-filter** — narrows raw pull from outlets/feeds to plausible candidates. Deliberately crude/wide — only needs to avoid discarding real candidates, not be precise.
2.  **LLM classification pass, title + subheadline/dek first** — a build-time API call (not runtime — same category as other `buildX.mjs` scripts hitting external sources) asks: does this substantively belong to a topic/systemic-theme tag, and what tier does the actual content warrant? Most candidates resolve confidently here.
3.  **Full-article read, only for low-confidence cases** — a small minority of the pool, not the default.
4.  **Three-way routing based on confidence:**
    - Confident-relevant → proceed to tagging/tiering
    - Confident-irrelevant → discard
    - Low-confidence after full-article read → manual review queue

This replaces "better word engineering" as the fix, since keyword-only approaches hit a structural wall (common words like "president," "strike," "casualties," "racist" appear constantly in irrelevant contexts — negative-keyword lists just chase false positives into new false negatives).

**Cost/volume consideration flagged, not resolved:** per-candidate classification calls, 3–4x/day, across however many outlets are pulled — worth estimating rough daily article volume before this is locked into a build prompt.

------------------------------------------------------------------------

## 7. Source schema

Three separate shapes now — no shared "leaning" field between any of them except outlet.

### Outlet-sourced (`sourceType: "outlet"`)

- `outlet` — e.g. "Reuters," "The Telegraph"
- `leaning` — left / lean-left / center / lean-right / right (matches AllSides' actual 5-point scale rather than a collapsed 3-point one, so the schema doesn't lose precision AllSides itself tracks — Middle East Eye's "Left" vs. most other left-leaning sources' "Lean Left" is exactly the distinction this preserves)
- `leaningSource` — citation for the leaning label itself (AllSides.com specifically, per J's direction — Ad Fontes/MBFC only as fallback for outlets AllSides doesn't rate), so the label is defensible, not a subjective call
- `leaningConfidence` — "high" \| "medium" \| "low/initial" — carries AllSides' own stated confidence level rather than presenting every rating as equally certain
- `contested` — boolean, optional — true when AllSides' own methods disagree (blind survey vs. editorial review), or when AllSides materially disagrees with other major raters (Ad Fontes, MBFC) on the same outlet. Flags cases like The Telegraph and BBC where a single clean label oversimplifies real rater disagreement.
- `tier` — wire / broadsheet / broadcast / regional-specialist / **country-native** (new — single-country depth sources, especially for press-restricted or conflict-prone countries not otherwise well covered)
- `caveat` — optional, surfaced in the UI caption bar, not buried (e.g. "News only — Opinion section rated/excluded separately" for WSJ; "state-funded" for Al Jazeera)
- `pressControl` — new, for `tier: "country-native"` sources where AllSides' `leaning` doesn't apply (state-restricted press environments aren't a left/right question): `"state-controlled"` \| `"state-run-democratic"` (e.g. Focus Taiwan/CNA — official but operating under genuine press freedom, a different animal from a propaganda-mouthpiece state outlet) \| `"independent"` \| `"exile"`
- `pressFreedomContext` — citation to RSF (Reporters Without Borders) or Freedom House's rating for that country, giving `pressControl` the same defensibility standard AllSides gives `leaning` — not left blank as an unsupported editorial judgment

**Fractured-governance pattern:** several countries (Yemen, Libya, and Nicaragua in different ways) don't fit a clean single-state-outlet model. Yemen and Libya both have **competing authorities each claiming legitimacy**, with a state-aligned outlet on each side rather than one canonical "state" source — these need distinct `affiliationNote`s per side rather than a single `pressControl: "state-controlled"` label. Nicaragua is a different pattern: independent journalism about the country is now produced **entirely in exile**, so there's effectively no live domestic-independent counterpart to pair against the state side. **Saudi Arabia is a third pattern**: total state monopoly with genuinely no country-specific independent counterpart at all — critical coverage of Saudi Arabia comes only from pan-regional/international outlets, not a dedicated Saudi-focused independent outlet the way Iran or Russia have one. This is worth watching for in future country additions rather than assuming every restricted-press country cleanly splits into one state source and one independent source.

### Analysis/research orgs (`sourceType: "analysis"`) — new

For non-partisan policy/research bodies whose identity is built around being above the left/right axis — forcing a leaning label onto these would misrepresent them, same logic as first-hand accounts having no leaning, different reason.

- `org` — e.g. "Carnegie Endowment," "Chatham House," "CSIS," "International Crisis Group," "Foreign Policy," "World Politics Review," "Geopolitical Futures," "RANE/Stratfor Worldview"
- `label` — fixed: "Non-partisan analysis"
- No leaning field.

### First-hand accounts (`sourceType: "first-hand"`)

- `label` — fixed string: "First-hand account" (never editable per-source, never a leaning)
- `channel` — Telegram handle/channel, for provenance only
- `affiliationNote` — optional, factual only (e.g. "posted by soldier of X unit") — describes who's speaking, not a political judgment. **For combatant-affiliated channels specifically (§15a, tier 4), this should be prominent and specific** (e.g. "Pro-Russian military blogger") rather than a soft caveat — the design choice here is maximum visibility of affiliation rather than exclusion from corroboration.

**UI implication:** first-hand accounts get a visually distinct badge/section (video-thumbnail-forward, since this content skews toward raw video/photo), never interleaved with the outlet grid — keeps "first-hand ≠ editorial leaning" visible at the layout level, not just in metadata.

### Curated source shortlist — verified against AllSides.com (this session)

**Methodology note:** ratings below were pulled directly from AllSides.com source pages and blind-survey reports where possible. Where only cross-referenced/aggregator data was available (not AllSides' own page directly), the row is marked *provisional*. AllSides itself flags some ratings as low/initial confidence or contested between methods (blind survey vs. editorial review) — both are carried into the schema (`leaningConfidence`, `contested`) rather than flattened into a single clean label. AllSides' coverage skews toward US-relevant outlets, so most non-US regional specialists are simply **not rated** — this is expected, not a gap to chase.

**Wire (always-first, auto-ingest tier):**

- Reuters — **Center**, high confidence
- AP — **Lean Left**, confirmed across multiple surveys/editorial reviews (correction from an earlier assumption of AP as neutral — wire-agency status is about newsgathering structure, not an exemption from the leaning caption)
- AFP — Not rated by AllSides

**General leaning spread — Left / Lean Left / Left:**

- The Guardian — Lean Left, confirmed
- Al Jazeera (`caveat`: state-funded) — Lean Left, low/initial confidence
- NPR (Online News, not radio) — Lean Left, medium confidence (moved from a long-contested Center/Lean-Left border in Sept 2026)
- Sky News (UK) — Lean Left, low/initial confidence. **Note:** distinct from Sky News Australia (rated Right, rebranding to "News24"). Confirm which is meant before ingesting — same brand name, different outlets, opposite leanings.
- NBC News — Lean Left, medium confidence, confirmed directly
- Business Insider / Business Insider Africa — Lean Left, medium confidence, confirmed directly
- PBS NewsHour — **Lean Left**, medium confidence, confirmed directly (correction from an earlier provisional Center guess)
- Semafor — **Lean Left**, confirmed directly (correction from an earlier provisional Center guess)
- Middle East Eye — **Left** (full, not Lean), low/initial confidence, confirmed directly. **Removed from consideration per J's decision** — raised as the mirror case to New York Post's removal, and J opted the same way on this side of the spectrum.

**General leaning spread — Center:**

- WSJ **News** only (`caveat`: rating applies to news section; Opinion rated separately and is contested — not used) — Center, high confidence
- The Telegraph (UK) (`contested: true`) — AllSides moved it from Lean Right to **Center** in a June 2026 editorial review, high confidence per AllSides — but Ad Fontes, Media Bias/Fact Check, and Biasly still rate it Lean Right to Right. Genuine disagreement between raters, not a settled fact — surface both in the UI caveat if this outlet's rating is ever challenged.
- BBC (`contested: true`) — AllSides' listed rating is Center, but AllSides' own April 2024 blind survey rated its content Lean Left (-1.62)
- PBS NewsHour and Semafor have moved — see Left section above
- Deutsche Welle — Center, low/initial confidence, confirmed directly
- Financial Times — Center, confirmed directly
- The Hill — Center, medium confidence, confirmed directly (`contested: true` — has fluctuated between Center and Lean Left across multiple reviews; most recent April 2026 review landed Center)
- Tangle — Center, confirmed
- **Reason** — **Center** (correction: moved from Lean Right to Center following a November 2024 AllSides Blind Bias Survey + Editorial Review — no longer a Right-column source)
- Bloomberg (`contested: true`) — Bloomberg's own AllSides page states Center, but AllSides' own 2024 retrospective blog post listed Bloomberg among outlets that had "moved further left" to Lean Left — an internal inconsistency on AllSides' own site, not resolved this session
- France 24 — Not rated by AllSides

**General leaning spread — Lean Right (deliberately stopping here, not extending to Right-tier advocacy outlets like Fox News/OAN):**

- Washington Examiner — Lean Right, confirmed, medium-high confidence
- National Review (News) — Lean Right, confirmed
- The Dispatch — Lean Right, medium confidence. AllSides' own reviewer noted: "if rated anything other than Lean Right, it would likely be rated Center" — about as close to the center-right line as AllSides tracks

*(New York Post removed per J's call — J reads it as further right in practice than AllSides' Lean Right (News) label reflects. Reason removed from this column per the AllSides correction above, not a judgment call. Noted separately so the two removals aren't conflated.)*

**Financial/macro:** Financial Times, Bloomberg News (see leaning notes above)

**Regional specialists** (`tier: "regional-specialist"`, fills Western-media coverage gaps flagged early in this design process; not rated by AllSides — treated as leaning-neutral by absence of data, not by design claim): Nikkei Asia / Kyodo News (East Asia), The Diplomat (Indo-Pacific defense/security), South China Morning Post Asia Desk (East Asian trade/diplomacy), Al-Monitor (Middle East diplomacy), Balkan Insight/BIRN (Southeastern Europe), Eurasianet (Central Asia/Caucasus), AllAfrica / Institute for Security Studies Africa, InSight Crime (Latin America/Caribbean organized crime), Rest of World (tech/infrastructure/regulation in the Global South), Maritime Executive (naval activity, maritime chokepoints), **The Daily Star (thedailystar.net, Bangladesh's leading English-language paper — South Asia coverage; not the UK tabloid or Lebanon's Daily Star, disambiguated per J)**

**Non-partisan analysis (`sourceType: "analysis"`, no leaning by design):** Carnegie Endowment for International Peace, Chatham House, International Crisis Group, CSIS, Foreign Policy, World Politics Review, Geopolitical Futures, RANE/Stratfor Worldview

**OSINT/data-verification specialists** (see §8, elevated `specialist-verified` corroboration status): Institute for the Study of War (ISW), Bellingcat, ACLED

**Not yet vetted / flagged for review before inclusion:** "Military News" (unspecified outlet — needs a real name before it can be schema'd). The Daily Star and Middle East Eye are both now resolved (see above).

### Country-native sources (`tier: "country-native"`) — new, for conflict/uprising-prone and press-restricted countries

Distinct from `regional-specialist` (macro-region correspondent coverage) — this tier is single-country depth, and for press-restricted countries specifically pairs a state-aligned source with an independent/exile counterpart so Atlas can show both what a government wants heard and what independent reporting actually finds. Uses a new `pressControl` field (see §7 schema) rather than forcing these into the `leaning` (AllSides) field, since AllSides doesn't rate almost any of these and left/right isn't the relevant axis for a state-controlled press environment anyway.

**Restricted-press pairs (`pressControl: "state-controlled"` + `"independent"`/`"exile"`):**

| Country          | State-aligned                                                                                                                                                                                                                                                                   | Independent/exile                                                                                                                                                                                                                                                                                                                                        |
|------------------|---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------|----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------|
| Iran             | Tasnim News Agency / IRNA                                                                                                                                                                                                                                                       | Iran International                                                                                                                                                                                                                                                                                                                                       |
| Russia           | TASS / Interfax                                                                                                                                                                                                                                                                 | Meduza                                                                                                                                                                                                                                                                                                                                                   |
| China            | Xinhua News Agency                                                                                                                                                                                                                                                              | China Digital Times                                                                                                                                                                                                                                                                                                                                      |
| Venezuela        | TeleSUR English / VTV                                                                                                                                                                                                                                                           | Efecto Cocuyo, Caracas Chronicles                                                                                                                                                                                                                                                                                                                        |
| Syria            | SANA (`caveat`: state ownership continues under the post-Assad transitional government since Dec 2024 — this pairing is more in flux than the others, not a settled long-term case)                                                                                             | Syria Direct (Berlin-based, English/Arabic)                                                                                                                                                                                                                                                                                                              |
| Yemen            | SABA — **split institution, not a single source**: Houthi-controlled (saba.ye) vs. internationally-recognized-government-aligned (sabanew.net), same name and lineage, opposing political control. Both need distinct `affiliationNote`s rather than one generic "state" label. | Not yet identified — flagged for a follow-up vetting pass                                                                                                                                                                                                                                                                                                |
| Myanmar          | MRTV (junta)                                                                                                                                                                                                                                                                    | The Irrawaddy (exile, English, well-established)                                                                                                                                                                                                                                                                                                         |
| Sudan            | SUNA                                                                                                                                                                                                                                                                            | Sudan Tribune (exile, Paris-based)                                                                                                                                                                                                                                                                                                                       |
| Ethiopia         | ENA *(provisional — not independently reconfirmed this session)*                                                                                                                                                                                                                | Addis Standard *(provisional — not independently reconfirmed this session, strong Tigray-conflict coverage reputation)*                                                                                                                                                                                                                                  |
| North Korea      | KCNA (the only domestic source; treat as pure state mouthpiece, no ambiguity)                                                                                                                                                                                                   | NK News / Daily NK (Seoul-based specialists)                                                                                                                                                                                                                                                                                                             |
| **Saudi Arabia** | **Saudi Press Agency (SPA)**, Al Arabiya (MBC Group-owned), Arab News (oldest English-language daily), Asharq Al-Awsat                                                                                                                                                          | **No domestic independent counterpart exists** — RSF confirms independent media is non-existent (170/180 globally); closest available option is **DAWN (Democracy for the Arab World Now)**, a Gulf-focused human-rights/accountability org founded by Jamal Khashoggi before his assassination (`caveat`: advocacy-oriented, not a day-to-day newsroom) |

**Country-native, no state/independent duality needed (functioning democracies with real press freedom, added for single-country depth on conflict-relevant states not otherwise well covered):**

- **India** — Press Trust of India (PTI, nonprofit cooperative wire service, largest in India), The Hindu, The Indian Express (strong investigative reputation) — relevant given Kashmir, India-Pakistan-China border tensions, and domestic insurgency coverage
- **Pakistan** — Dawn (most internationally respected English-language paper) vs. Associated Press of Pakistan (APP, official state agency) — this one does have a real state/independent contrast worth preserving despite Pakistan's mixed democratic status
- **Nigeria** — Premium Times (independent, strong investigative reputation, Boko Haram/ISWAP/banditry coverage)
- **Lebanon** — **The Daily Star (Lebanon)** — a real, legitimate English-language Lebanese paper. Explicitly disambiguated by name from The Daily Star (Bangladesh, already in the regional-specialist list) to avoid recreating the earlier naming confusion — always store/display with the "(Lebanon)" qualifier.

**Additional pairs from the original outline, filling out existing regional coverage rather than new gaps:**

- **Taiwan** — Taipei Times, Focus Taiwan (CNA) (`pressControl: "state-run-democratic"` — official but operating under genuine press freedom, not a propaganda outlet; distinct from the restricted-press "state-controlled" label)
- **Israel** — Times of Israel, Haaretz
- **Mexico** — Reforma, El Universal
- **Colombia** — El Espectador, El Tiempo
- **Ukraine** — The Kyiv Independent, The New Voice of Ukraine (NV)
- **Japan** — The Japan Times, Nikkei *(partial overlap with existing Nikkei Asia/Kyodo — added for depth, not filling a blank)*
- **Germany** — Der Spiegel (International Desk) *(new)*, Deutsche Welle *(already in the general leaning spread, §7)*
- **Canada** — The Globe and Mail, CBC News

**Still open:** an independent/exile Yemeni source hasn't been identified yet; Ethiopia's pairing needs direct reconfirmation rather than the provisional entries above; and this whole tier — like the outlet list — will need periodic re-vetting given how fast press environments in these specific countries change (Syria's is mid-transition right now).

### South America & Caribbean additions

- **Cuba** — Granma (official Communist Party paper, `pressControl: "state-controlled"`) vs. CiberCuba, Havana Times (independent digital — Cuba's constitution prohibits private media ownership, so these operate in a legal gray zone, not fully legal but not always blocked either)
- **Nicaragua** — a genuine exile-only case, similar in spirit to Myanmar: El 19 Digital *(provisional, moderate confidence — regime-aligned)* vs. **Confidencial** and **La Prensa**, both confirmed now operating in exile after the Ortega government's crackdown since 2018 — per current reporting, independent journalism *about* Nicaragua is now produced entirely outside the country
- **Haiti** — RTNH (state broadcaster, confirmed) vs. Le Nouvelliste *(provisional — well-established reputation, not directly reconfirmed this session)*. **Different kind of press-freedom problem than the others**: Haiti's press freedom collapse is driven by gang control over Port-au-Prince and the absence of any elected government since Jan 2023, not classic state censorship — worth noting this is a security-collapse case, not an authoritarian-control case, even though it lands at a similarly poor RSF ranking
- **Brazil** *(country-native depth, no state/independent duality — functioning democracy)* — Folha de S.Paulo, O Globo, Agência Pública (investigative nonprofit)
- **Argentina** *(country-native depth, no duality)* — Clarín, La Nación, Página 12. **Caveat worth carrying into the schema**: RSF's 2025 index flags the Milei government's "belligerent, confrontational" approach to the press and dismantling of public media — a real erosion in a still-functioning democracy, not a settled press-freedom picture
- **Peru** *(country-native depth, no duality)* — El Comercio, La República, IDL-Reporteros (investigative nonprofit). **Caveat**: Peru has fallen 67 RSF places since 2022, driven by violence against journalists (4 killed in 2025) and legislative/judicial pressure on independent media — actively deteriorating, not stable
- **Bolivia** — Bolivia TV (state broadcaster, confirmed) vs. El Deber, La Razón, Los Tiempos (private outlets). **Note**: per the source used to confirm Bolivia TV's status, Bolivia's independent-media tier is unusually thin regionally — mostly indigenous community radio and university channels rather than robust independent digital outlets — this may be a real coverage gap rather than a vetting gap

### Africa additions

- **DRC (Democratic Republic of Congo)** — RTNC (state broadcaster, "lacks independence" per RSF, confirmed) vs. Actualite.cd, 7sur7.cd (independent digital outlets, confirmed via RSF, described as "in full development" — younger/less established than some other independent counterparts on this list). Conflict context: eastern DRC's M23 conflict makes reporting there specifically dangerous — journalists are described as caught between armed groups and the national army
- **Egypt** — Al-Ahram (major state-owned paper) vs. Mada Masr *(leading independent/oppositional outlet, frequently blocked domestically — provisional, not directly reconfirmed this session but well-established reputation)*
- **Somalia** *(provisional — not directly reconfirmed this session, flagged for a follow-up pass)* — state broadcasting apparatus (Radio Mogadishu/SNTV) vs. Hiiraan Online (diaspora-run independent aggregator)
- **Libya** — **another fractured-governance case, like Yemen's split SABA**: no single state outlet, since Libya has competing authorities (the Tripoli-based GNU and the eastern Haftar/LNA-aligned administration). LANA (Libyan News Agency, GNU-aligned) vs. Libya Observer (Tripoli-based, independent-leaning) — *both provisional, needs a proper vetting pass given the split-governance complexity, similar treatment to Yemen*
- **Mali / Burkina Faso / Niger (Sahel military-junta bloc)** — press freedom actively collapsing under all three juntas per RSF (arbitrary detention of journalists, outlet suspensions); no confirmed single independent domestic outlet identified this session. RFI (Radio France Internationale) covers the region from outside but is frequently banned within these countries — useful as an external-observer source, not a domestic one. **Flagged as needing real vetting work**, not filled in with provisional guesses given how fast-moving and repressive this specific press environment is right now

### Left / Center / Right tally (outlets with an actual leaning determination only — excludes analysis-type, OSINT, first-hand, and not-rated sources; Middle East Eye excluded pending inclusion decision)

| Left (incl. Lean Left / Left)                                                                         | Center                                                                                          | Right (incl. Lean Right)                                   |
|-------------------------------------------------------------------------------------------------------|-------------------------------------------------------------------------------------------------|------------------------------------------------------------|
| **9** — AP, Guardian, Al Jazeera, NPR, Sky News UK, NBC News, Business Insider, PBS NewsHour, Semafor | **10** — Reuters, WSJ News, Telegraph\*, DW, FT, The Hill\*, Tangle, Reason, Bloomberg\*, BBC\* | **3** — Washington Examiner, National Review, The Dispatch |

\*= flagged `contested` (real disagreement between raters or between AllSides' own methods, not just low confidence)

**This is worse, not better, than the pre-vetting estimate (was 7/10/4).** The fuller direct-verification pass confirmed several outlets as Lean Left that had only been provisionally guessed at Center (PBS NewsHour, Semafor), and removed one outlet from the Right column entirely after finding its rating had genuinely changed (Reason → Center). No new outlets were confirmed into the Right column in this pass. **Not yet decided:** whether to actively search for additional Lean Right outlets to close the gap further (candidates not yet checked: Washington Times, CNBC, Newsweek — though Newsweek's own AllSides history is volatile), whether to accept 9/10/3 as the working ratio, or whether the Middle East Eye inclusion question (a Left counterweight in the opposite direction) is meant to address balance from the other side instead.

------------------------------------------------------------------------

## 8. Corroboration + publishing gate (by severity tier)

**Manual review is deliberately minimal.** J's direction: professional news agencies and OSINT specialists are trusted to do their job — Atlas reports what they report, corroboration-gated by tier, without a general human moderation layer second-guessing every Major/Significant item. The **only** case requiring manual confirmation is a claim that a head of state or head of government has been killed — the single highest-consequence, most rumor-prone claim type — even after wire confirmation.

| Tier            | Corroboration floor                            | Publish behavior                                                                                                                                                                                                                                                                                                             |
|-----------------|------------------------------------------------|------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------|
| **Critical**    | Wire-confirmed, **or 3+ distinct non-state outlets** (amended 2026-09-20 to 4; lowered to 3 on 2026-09-21 — see note below) | Auto-publishes once the floor is met — no manual gate — **except** head-of-state/government death claims specifically, which require manual confirmation even after clearing the floor. No other exceptions to the floor, even with 2+ independent OSINT corroborations or specialist-verified status. |
| **Major**       | OSINT-corroborated (2+) or specialist-verified | Auto-publishes — no manual gate                                                                                                                                                                                                                                                                                              |
| **Significant** | OSINT-corroborated (2+)                        | Auto-publishes — no manual gate                                                                                                                                                                                                                                                                                              |
| **Routine**     | OSINT-corroborated (2+)                        | Auto-publishes                                                                                                                                                                                                                                                                                                               |

**New corroboration tier: `specialist-verified`** — sits between generic `osint-corroborated (2+)` and `wire-confirmed`. Applies when a claim is independently mapped/logged by ISW, ACLED, or Bellingcat specifically — a materially stronger evidentiary standing than two arbitrary sources agreeing, since these organizations run their own verification methodology. Does not clear the Critical floor (wire, or 3+ outlets).

**Amendment (2026-09-20, J's direction): Critical also accepts 4+ distinct outlets — lowered to 3+ on 2026-09-21 (J).** No wire feed (Reuters/AP/AFP) is currently reachable, so a wire-only floor would keep Critical permanently dark. Only `outlet`-category sources count toward the three (not analysis orgs, first-hand, or official statements), distinct by source, and community discussion never counts. **State-controlled outlets (`pressControl: "state-controlled"`) do not count toward the three** — they may appear in the dossier, but a state-media claim reaches Critical only alongside three non-state outlets. A wire report still clears Critical alone. **Known weakness, open:** the count is of sources, not independent newsgathering, so three outlets carrying one syndicated wire story pass — a weakness the lower floor makes slightly worse.

`Unconfirmed` items never publish regardless of tier. The head-of-state-death review queue is now the **only** manual review surface in the system — a narrow, purpose-built queue, not a general moderation backlog.

------------------------------------------------------------------------

## 9. Structure: tabs + Community Pulse

### 9a. Tab structure

News is organized into tabs — one word each — both to aid navigation and to prevent any single feed from being overloaded (this is also why Community Pulse, §9b, is scoped per-tab rather than one global aggregate).

| Tab              | Source tag(s)                                                                     | Community Pulse?                        | First-hand ticker?                          |
|------------------|-----------------------------------------------------------------------------------|-----------------------------------------|---------------------------------------------|
| **World**        | Landing tab — trending-across-most-countries default (§10), not a topicTag filter | **No** — stays a pure news landing view | No                                          |
| **Conflict**     | Conflict & Security                                                               | Yes                                     | Yes, scoped to Conflict & Security          |
| **Terrorism**    | Terrorism & Non-State Actors                                                      | Yes                                     | Yes, scoped to Terrorism & Non-State Actors |
| **Politics**     | Diplomacy & Politics                                                              | Yes                                     | Yes, scoped to Diplomacy & Politics         |
| **Business**     | Economic & Trade                                                                  | Yes                                     | Yes, scoped to Economic & Trade             |
| **Energy**       | Energy                                                                            | Yes                                     | Yes, scoped to Energy                       |
| **Humanitarian** | Humanitarian & Displacement                                                       | Yes                                     | Yes, scoped to Humanitarian & Displacement  |
| **Crime**        | Crime & Trafficking                                                               | Yes                                     | Yes, scoped to Crime & Trafficking          |
| **Tech**         | Science & Technology                                                              | Yes                                     | Yes, scoped to Science & Technology         |

**The first-hand text ticker (§15b) is per-tab, not News-tab-exclusive** — each topic tab surfaces first-hand/Telegram text posts scoped to that tab's own topic tag, using the same tiering and affiliation-labeling rules from §15a. World stays clean of both Community Pulse and the ticker, preserving it as a pure trending-news landing view.

An article carrying multiple `topicTags` appears in every matching tab (§4a multi-tag placement rule) — tabs are an overlapping filter, not a strict partition.

**Open, pending in-app visual check:** eight content tabs plus World may be more than comfortably fits a tab bar — J flagged this needs to be seen in-app before finalizing the count; possible that some tabs get consolidated or presented differently (e.g. a "more" overflow) once real layout is visible.

### 9b. Community Pulse — new, separate subsystem

**Not a NewsItem variant.** Surfaces trending Reddit threads (e.g. r/CredibleDefense, r/geopolitics), notable X/Twitter discussion, and **Telegram discussion-channel content** (distinct from the verified/first-hand Telegram channels in §15a — this is general public sentiment/commentary channels, not frontline reporting) relevant to the active tab's topic — framed explicitly as "what people are discussing," never "what happened."

**Hard walls, matching the project's integrity-first principle:**

- Never counts toward corroboration — no severity/publishing logic reads from Community Pulse, ever, regardless of a subreddit's or channel's quality bar
- Never treated as a NewsItem — separate data shape, separate UI section, no shared schema fields with `NewsItem`'s sourcing/severity/corroboration model
- Scoped per-tab, not global — prevents one noisy aggregate feed and keeps discussion topically relevant (e.g. Conflict tab surfaces conflict-relevant discussion, not general geopolitics chatter)
- **Not present on World** — World stays a pure trending-news landing view with no discussion layer

**Draft shape (placeholder, not finalized):**

```text
CommunityPulseItem {
  id
  platform          // "reddit" | "twitter" | "telegram"
  sourceCommunity   // e.g. "r/CredibleDefense", or a Telegram discussion-channel name
  linkedTab         // which topic tab this surfaces under
  snapshotDate
  url
}
```

**Open:** full design (ingestion method, read-only API integration, UI paradigm) is deliberately not fleshed out here — this is a genuinely different subsystem (no severity/corroboration pipeline at all) and may warrant its own standalone design doc rather than living inside this one long-term.

------------------------------------------------------------------------

## 10. Ranking logic

Same underlying rule everywhere — **severity tier first, recency second** — differing only in scope and layout.

- **Intelligence Panel:** top 3 for the selected country only, **stacked**, with a "more" link to the News tab pre-filtered to that country.
- **Topic tab, filtered view:** top 3 for that tab/active region-or-theme filter, **side by side**, YouTube-style layout — deliberate departure from traditional news-site layout, discovery-oriented rather than a scored readout.
- **World tab (default landing):** ranked by `linkedEntityIds.length` first — i.e. **trending across the most countries simultaneously** — then severity/recency within that. Chosen over "most severe worldwide" specifically to avoid the default view being dominated by whatever's most volatile that day regardless of breadth.
- **Below the featured 3, everywhere:** pure recency, no severity weighting.

------------------------------------------------------------------------

## 11. Presets & filtering

- **Region presets** (e.g. "Middle East") — saved bundles of country IDs. Implies a `region` tag on countries if not already present in the schema.
- **Topic tabs** (§9a) — now the primary topic-filtering mechanism, superseding the earlier idea of topic as just a preset.
- **Systemic theme filters** (§4b) — filter/badge within a tab (e.g. a standing "U.S.–China Strategic Competition" view inside Politics or Business).
- All filtering is **client-side over static JSON** — no new backend, consistent with the zero-runtime-network-calls architecture rule.
- "Customizable to an extent" — user-defined combinations (pick your own countries/themes within a tab) are straightforward once the tag infrastructure exists.

------------------------------------------------------------------------

## 12. Draft `NewsItem` schema (consolidated)

```text
NewsItem {
  id
  headline
  summary            // short, neutral paraphrase — not a scraped excerpt
  linkedEntityIds    // country ID(s)
  topicTags          // event-type tags, §4a — array, drives tab placement (multi-tab allowed)
  systemicThemes     // ongoing-dynamic tags, §4b
  severity           // "critical" | "major" | "significant" | "routine"
  relevanceConfidence // from classification pipeline, §6
  sourceType         // "outlet" | "analysis" | "first-hand"
  source: {
    // outlet
    outlet?, leaning?, leaningSource?, tier?, caveat?,
    // analysis
    org?, label?,
    // first-hand
    channel?, affiliationNote?
  }
  corroboration      // "wire-confirmed" | "specialist-verified" | "osint-corroborated (2+)" | "unconfirmed"
  reviewStatus       // "auto-published" | "pending-confirmation" | "manual-only"
  snapshotDate
  url
}
```

------------------------------------------------------------------------

## 13. Open items (tracked, not yet resolved)

1.  ~~Domestic-incident scope~~ — **resolved**: in scope, capped at Significant unless a state response attaches (§3).
2.  Systemic theme trend indicators — elaborated (§4b); **not yet decided** whether the standing editorial-judgment commitment is worth taking on.
3.  ~~Manual review queue~~ — **resolved**: manual review is now limited to head-of-state/government death claims only; everything else auto-publishes off its corroboration floor (§8).
4.  Build cadence — **resolved**: twice daily (10AM/10PM) plus event-triggered exception for breaking news (§2). Estimated daily article volume (needed to sanity-check LLM classification-pass cost under this new cadence) remains unresolved.
5.  Systemic theme list review mechanism — **resolved**: quarterly pass, add/retire criteria defined (§4b).
6.  ~~Humanitarian/disaster thresholds~~ — **resolved**: 50/500-death and 10,000/500,000-displacement numbers proposed (§5), open to adjustment.
7.  Tab count (8 + World) still needs the in-app visual check — unresolved, pending J.
8.  Community Pulse — confirmed deferred to a standalone design doc; no further action now.
9.  Outlet vetting — **largely complete this session**: NBC News, Business Insider, PBS NewsHour, Semafor, DW, FT, The Hill, Middle East Eye all directly confirmed against AllSides. Remaining: Bloomberg (contested, unresolved), The Daily Star (needs disambiguation), "Military News" (needs a real name).
10. Left/Center/Right tally is now **9/10/3** after the full vetting pass — moved further left-heavy than the pre-vetting estimate, not closer to balanced. Not yet decided: whether to search for more Lean Right candidates (Washington Times, CNBC, Newsweek flagged as unchecked options), whether to accept this ratio, or whether the still-pending Middle East Eye inclusion decision is meant to address balance from the opposite direction. Needs periodic re-auditing regardless, since AllSides ratings shift over time (NPR, Telegraph, Washington Examiner, and now Reason have all moved across past reviews).
11. ~~Middle East Eye~~ — **resolved**: not added to the roster, per J's decision (mirror case to the New York Post removal).
12. Admin/ops UI — scope confirmed: manual data-entry only (no automated AllSides lookups), and it houses the head-of-state-death review queue alongside source-leaning/theme-status editing (§14). Still open: access control (likely none, local-only) and tech stack (likely React/Vite).
13. Telegram/first-hand pipeline (§15) — channel tiering, UI placement, and architecture drafted. Open: NSFW/graphic-content detection method, whether combatant-affiliated channels get extra visual distinction beyond the affiliation note, and the full candidate channel vetting list.
14. **Frontlines (§15e)** — new dedicated video section for active-conflict footage, separate from the per-tab text ticker and structured as its own standalone destination outside the tab system entirely (not a peer tab, resolved). 16:9 widescreen, pillarboxed vertical video, sourced from the same §15a channel tiering scoped to Conflict/Terrorism only.
15. **Content-safety filter design (§15f) — resolved.** Layer 1 caption/metadata tiering (hard-block Tier A for minors/sexual-violence/terrorist-propaganda content, elevated-scrutiny Tier B for graphic-language flags) plus Layer 2 visual classification on sampled frames (AWS Rekognition as primary candidate), with a one-time ~100-video calibration pass in the Admin Console setting the actual confidence thresholds. Periodic re-calibration proposed on the same quarterly cadence as the systemic-theme review. Applies to both the per-tab ticker and Frontlines, with Frontlines carrying the higher stakes given its autoplay video format. **Scope explicitly resolved**: filter targets visible blood/gore/mutilation, not death itself — a fatal strike/engagement clip with no visible graphic injury (e.g. explosion obscures the moment of impact) is in scope and should display. Tier A's hard-block line (minors, sexual violence, terrorist propaganda) remains absolute regardless of calibration outcomes.
16. Community Pulse (§9b) now explicitly includes Telegram discussion channels alongside Reddit/X — resolved.
17. Frontlines (§15e) now sources from X/Twitter OSINT video accounts alongside Telegram, using the same platform-agnostic tiering (§15a) — resolved.
18. **Verified Commentary feed (§16)** — new revolving podcast/commentary video carousel above the top-3 on every page. Open: podcast vetting criteria not yet defined (candidates flagged, not approved: War on the Rocks, CFR's The World Next Week, BBC Global News Podcast); whether commentary segments carry a `leaning` field like outlets do.
19. **Event-as-primary-object architecture reframe (§17)** — major structural change: `NewsItem` is superseded, individual reports become `SourceEntry` items in an `Event`'s dossier, and corroboration (§8) becomes a direct computation over that dossier rather than a separately-tracked field. Tabs/ranking/presets now operate on Events, not individual articles. New "official statement" source category defined (`issuingBody`/`statementType`, no `leaning` field). **Live video question resolved**: an Event dossier's "live video" entry means "most recent clip, refreshed at high frequency" (static architecture intact); genuine open streaming is handled separately as Warzone Livestreams (§16b).
20. **Top-of-page video hub (§16)** now has two modes: News Clips (podcast/commentary, vetting criteria still open) and **Warzone Livestreams** (§16b, new) — genuine live conflict-zone streaming with a mandatory 5–10 second delay buffer for real-time content-safety filtering, modeled on broadcast TV's censor-delay pattern, **plus a frontend "viewer discretion advised" click-through gate** (additive consent layer, not a substitute for the backend filter — the filter still governs what's allowed to exist behind the gate; the gate governs how a viewer chooses to encounter it). Open: actual candidate livestream sources not yet identified/vetted; exact delay duration should be set empirically rather than fixed in advance; whether live-buffer filtering needs its own separate calibration dataset from the recorded-clip pipeline (§15f), given the much tighter time constraint on classification. **Flagged honestly as carrying more false-negative risk than the recorded-clip pipeline, delay notwithstanding** — an ongoing risk to monitor, not one the buffer or the consent gate fully eliminates.
21. Country-native source tier (§7) — expanded this session to cover South America/Caribbean (Cuba, Nicaragua, Haiti, Brazil, Argentina, Peru, Bolivia) and Africa (DRC, Egypt, Somalia, Libya, Mali/Burkina Faso/Niger) alongside the earlier batch (Iran, Russia, China, Venezuela, Syria, Yemen, Myanmar, Sudan, Ethiopia, North Korea, India, Pakistan, Nigeria, Lebanon, Taiwan, Israel, Mexico, Colombia, Ukraine, Japan, Germany, Canada). Two fractured-governance cases identified needing special schema handling like Yemen's split SABA: **Libya** (competing Tripoli/eastern authorities, no single state outlet) and **Nicaragua** (independent journalism now exile-only, not a live domestic independent tier). Several entries flagged `provisional` and need direct reconfirmation: Egypt, Somalia, Libya, Haiti's Le Nouvelliste, Nicaragua's El 19 Digital. Mali/Burkina Faso/Niger's independent tier could not be filled in with confidence this session — genuinely needs dedicated vetting work given how fast that press environment is deteriorating, not a gap to paper over with guesses.

------------------------------------------------------------------------

## 14. Admin/Ops Console — new requirement, scoping in progress

J wants a dev-facing UI for maintaining editorial data — starting with source leaning review (the AllSides vetting work done manually in this session), and extending naturally to the systemic-theme quarterly review (§4b) and the archived/active theme toggle. This is a **separate, private tool** from the public Atlas globe app — not something the 193-country-facing frontend needs to expose.

**Proposed shape, consistent with Atlas's existing static/file-based architecture:** rather than standing up a database and backend, the console reads and writes the same source-of-truth config files that `buildNews.mjs` consumes (e.g. a `sources.json` holding outlet/leaning/tier/caveat records, a `systemicThemes.json` holding the active/archived theme list). This keeps the console itself lightweight — a local-only admin webapp, not a production service — and keeps the "build-time static pipeline" principle intact, since the console edits inputs to the build, not runtime state.

**Scope, confirmed by J:**

- **Purely a manual data-entry/edit surface** — no automated AllSides lookups built in. J researches ratings (as done manually in this session) and enters/edits them directly; the console doesn't call out to AllSides or any other rating service itself.
- **Also houses the head-of-state-death review queue** (§8) — the console is now the single home for both editorial-data maintenance (source leanings, systemic theme active/archived status) and the one narrow manual-review surface the news pipeline still has. Two different rhythms living in one tool: quarterly/occasional data upkeep alongside an urgent, rare, high-stakes confirmation queue — worth keeping these visually/navigationally distinct within the console (e.g. separate views) even though they share one app, given how different their urgency profiles are.

**Still not yet scoped:**

- Who uses it — just J, or does it need any access control? (Leaning toward none needed if it only ever runs locally.)
- Tech choice — likely reuses the existing React/Vite stack for consistency with the rest of Atlas's tooling, but this is J's call once the above is settled.

------------------------------------------------------------------------

## 15. Telegram / X / First-Hand Accounts pipeline

### 15a. Channel/account tiering — not one flat "first-hand" bucket, and platform-agnostic

The tiering below applies equally to Telegram channels and X/Twitter accounts — platform doesn't change which trust category a source falls into; the categories are about *how* a source operates (verifies before posting, aggregates raw footage, curates regionally, or holds a combatant affiliation), not which app it lives on.

Candidate channels split into real categories with different trust properties:

1.  **Verification specialists** — channels that geolocate/verify content *before* publishing (e.g. `@DeepStateUA`, `@AMK_Mapping`/`@liveconflictmaps`). These run their own independent methodology, the same way ISW/ACLED/Bellingcat do — they get the same **`specialist-verified` corroboration status** (§8), not the generic first-hand tier.
2.  **OSINT aggregators** — fast re-posters of raw frontline media without their own independent verification layer (e.g. `@ClashReport`, `@OSINTdefender`, `@OsintTv`). Generic first-hand/unverified until corroborated elsewhere.
3.  **Regional translators/curators** — channels translating/curating local-language primary posts (e.g. `@middleeastobserver`, `@globalconflictmonitor`). Same trust tier as aggregators, valuable specifically for regional coverage gaps the outlet list doesn't reach.
4.  **Combatant-affiliated channels** — channels run by or closely tied to a party in a conflict (e.g. Rybar, Intel Slava Z). **Decision: affiliation is made as visible as possible in the UI, rather than excluding these from corroboration counting.** J's call, made deliberately rather than defaulting to exclusion — readers get the full picture (including who's speaking and their stake in the narrative) and weigh it themselves, rather than Atlas silently deciding a source doesn't count. The `affiliationNote` field (§7) carries this — for combatant-affiliated channels specifically, it should be prominent and specific (e.g. "Pro-Russian military blogger" rather than a soft/vague note), not a buried caveat.

### 15b. UI placement

- **Community Pulse** (Reddit/Twitter discussion, §9b) fills the left-side blank space on each topic tab.
- **First-hand/Telegram text ticker** sits on the right, **per-tab** — scoped to that tab's own topic tag (§9a table) — **text-only**, styled as a live scrolling feed of post captions/words, not a video/photo grid (a deliberate change from the earlier video-thumbnail-forward assumption — a fast text ticker suits a raw, high-frequency feed better, and reduces graphic-imagery exposure by not surfacing visuals directly in the ticker itself).
- Clearly labeled as unverified/primary-source content, distinct from the editorially-sourced News tab content, per the "Unverified Field Reports" framing.
- **"Frontlines" (§15e) is a separate, dedicated video destination** — not part of the per-tab ticker system, and not scoped to every topic. See below.

### 15c. Pipeline architecture

Matches Atlas's existing build-time-only pattern — a Telethon/Pyrogram-based ingestion script runs at build time (not a client-side runtime call), same category as `buildNews.mjs`:

```text
Telegram Public API (Telethon/Pyrogram)
        │
        ▼
Automated Noise Filter
  • Strip t.me links, forward-loop spam, ad/cross-promo phrases
        │
        ▼
NSFW / Graphic-Content Filter — HARD, NON-NEGOTIABLE, NO OVERRIDE
  • Drop flagged graphic/violent media entirely, no click-through exception
        │
        ▼
Verification/Corroboration Tagging
  • Tier-1 (verification specialists) → specialist-verified
  • Tier-2/3 (aggregators, regional curators) → generic first-hand/unverified
  • Tier-4 (combatant-affiliated) → first-hand, affiliation prominently labeled, never excluded from display
  • Cross-reference against wire/OSINT-specialist claims where possible
        │
        ▼
Structured Feed — "Unverified Field Reports" / first-hand ticker
```

**Separate, faster build cadence than the main News pipeline.** The value of these channels (ClashReport-style "real-time alerts") is speed — locking the ticker to the same 10AM/10PM+event cadence as curated News content would defeat the point. **Proposed: hourly refresh, still event-triggerable for breaking situations**, independent of the main News build schedule (§2).

### 15d. Still open

- Exact automated NSFW/graphic-content detection method (image/video classifier, keyword+metadata heuristics, or both) — not yet specified, but the hard-filter requirement itself is settled and non-negotiable.
- Whether combatant-affiliated channels get any additional visual distinction beyond the `affiliationNote` (e.g. a distinct badge color) to make the affiliation legible at a glance, not just on hover/click.
- Full candidate channel list beyond the examples above (Eastern Europe/Ukraine, Middle East, Global/Africa/Central Asia regions were suggested as starting coverage areas) — needs the same kind of vetting pass the outlet list got, likely another Admin Console (§14) data-entry category.

### 15e. Frontlines — dedicated video section, active conflicts only

**A wholly separate destination from the per-tab ticker**, not a variant of it. Purpose-built for video content from active conflict zones specifically — narrower in topical scope than the ticker (Conflict & Security and Terrorism & Non-State Actors only, not all eight topic tags) but far deeper in format (full video, not text captions).

**Format:** snap-scroll, one-clip-at-a-time, TikTok/Reels-style vertical scrolling gesture — but rendered in a **16:9 widescreen frame**, not full-bleed vertical. This is a deliberate departure from the reels convention specifically to avoid looking/feeling like short-form entertainment content.

- **Vertical (phone-shot) footage is pillarboxed, not cropped** — full original frame preserved with bars on the sides. This isn't just an aesthetic choice: cropping combat footage risks losing exactly the contextual/geolocation detail (landmarks, unit markings, surroundings) the verification pipeline (§15a-c) depends on.
- Landscape/widescreen-shot footage fills the 16:9 frame natively.

**Sourcing:** the video-heavy Telegram channels from §15a's tiering (`@ClashReport`, `@OSINTdefender`, `@OsintTv`, `@DeepStateUA`, regional conflict channels), **plus equivalent video-heavy X/Twitter OSINT accounts** — same tiering, corroboration, and affiliation-labeling rules apply regardless of platform. Frontlines doesn't get its own separate trust model — it's the same verified/first-hand data, just displayed as a dedicated video destination instead of folded into a topic tab's ticker. §15a's channel-tiering framework (verification specialists / aggregators / regional curators / combatant-affiliated) applies identically to X accounts as to Telegram channels — platform doesn't change the trust category a source falls into.

**Content-safety is load-bearing here, not peripheral.** An autoplay, swipe-driven video feed of active-conflict footage is the single highest content-exposure surface in the entire design — meaningfully higher risk than the text ticker it sits alongside. The hard NSFW/graphic-content filter from §15c isn't just a non-negotiable checkbox for Frontlines specifically — filter accuracy and false-negative rate need a real, tested answer before this feature is viable to ship, not just a stated intention to filter.

**Placement: a wholly separate structure, outside the tab system entirely** — not a peer tab in the World/Conflict/Politics bar. Frontlines is its own dedicated destination/nav entry, distinct from the topic-tab structure altogether, matching its fundamentally different experience (immersive full-screen video vs. an article feed). This also sidesteps the tab-count crowding concern from §13 entirely, since Frontlines never competes for space in that bar.

**Still open:**

- Filter design is now specified in §15f below — this item is resolved.

### 15f. Content-safety filter design — Layers 1 & 2, and the calibration workflow

Resolves the previously-open NSFW/graphic-content question for both the per-tab ticker and Frontlines.

**Layer 1 — caption/metadata pre-filter, three tiers:**

*Tier A — hard auto-block, no calibration override, ever:*

- Any indication content involves harm to a minor — zero tolerance, no exception, regardless of newsworthiness framing
- Content indicating sexual violence
- Content reading as designated-terrorist-organization propaganda specifically produced for recruitment/psychological effect (execution videos, hostage "confession" videos, martyrdom/glorification content). **This is a distinct rule from gore-filtering** — the problem with this content isn't only that it's graphic, it's that displaying it at all platforms propaganda by design, even a low-violence excerpt. Detection here should key on caption/source pattern (known-propaganda-producing channels, characteristic phrasing) independent of what the visual classifier scores.

*Tier B — elevated scrutiny, routes to Layer 2 with a lower auto-block threshold than default:*

- Explicit self-flagging language: "graphic," "18+," "NSFW," "viewer discretion," "warning"
- Death/casualty language specifically describing what the attached *visual* shows ("shows the bodies," "footage of the dead," "graphic aftermath") — distinct from ordinary casualty reporting with no visual-content descriptor ("12 killed in strike" alone is not a Tier B trigger)
- Torture, mutilation, beheading-specific terminology

*Tier C — normal routing:* everything else (standard conflict footage, equipment, troop movements, non-graphic aftermath).

**Layer 2 — visual content classification, sampled frames:**

- Extract frames at short intervals (~1/second) plus the poster/thumbnail frame; classify each rather than processing full video (cost-practical)
- Candidate vendors: **AWS Rekognition Content Moderation** (has explicit "Visually Disturbing" → "Graphic Violence or Gore" and "Physical Violence" labels, purpose-built for this exact problem) as primary candidate; Hive or Sightengine (gore/violence-specialized moderation vendors) as an alternative or second-opinion check
- **Any single flagged frame blocks the whole clip** — no averaging across a clip's frames. A brief flash of genuine gore is enough to cause harm even surrounded by benign footage; the cost of a false positive (blocking a legitimate clip) and a false negative (showing someone a corpse) are not symmetric, so thresholds should be deliberately conservative/over-blocking by design

**Calibration workflow — the ~100-video pass, in the Admin Console (§14):**

New Console mode: **Calibration Review**. For each sample video: J sees the clip, Layer 2's raw confidence scores per label, and which frame(s) triggered them. J marks Block/Allow. This does two things:

1.  Builds a labeled dataset specific to Atlas's actual context — a generic vendor threshold (tuned for general social-media moderation) isn't necessarily right here; some intense-but-legitimate footage (visible weapons, distant explosions, wounded-but-not-graphic combatants) should likely pass in a defense-intelligence context where a generic classifier might over-flag it
2.  Sets the actual confidence thresholds Layer 2 uses going forward

**This is a one-time calibration pass with periodic re-calibration** (proposed: same quarterly cadence as the systemic-theme review, §4b) — not continuous per-video review. This is the reconciliation of J's "let professionals do their job, don't hand-hold" principle (§8) with genuine safety need: training the safety infrastructure once is a fundamentally different kind of work than gatekeeping every individual clip's truth claims forever.

**Scope decision:** the filter targets visible blood/gore specifically, not death or violence in the abstract. Tested against a concrete case — a drone-strike clip showing a soldier tracked to the moment of impact, killed by an explosion that obscures the moment itself (no visible blood, injury, or mutilation). **J's explicit call: this is in scope and should be shown.** The line is drawn at visible graphic injury (blood, mutilation, visible gore), not at whether a clip depicts someone's death — a strike/engagement outcome without visible gore is legitimate documentation of what modern warfare looks like, consistent with Atlas's defense-intelligence framing, even when the outcome is clearly fatal. This means Layer 2's actual job is narrower and more literal than "detect death" — it's specifically detecting visible blood/gore/mutilation in frame, which is exactly what AWS Rekognition's "Graphic Violence or Gore" label is built to catch. The calibration pass (100-video review) should use this exact standard when marking Block/Allow, so the resulting thresholds reflect this line precisely rather than a vaguer "is this disturbing" judgment.

------------------------------------------------------------------------

## 16. Top-of-page video hub — two modes, one revolving carousel

Sits **above** the top-3 event dossiers (§17) on every tab page — larger visual footprint than the per-tab ticker. **Two selectable modes within one carousel**, not two separate features: **News Clips** (curated podcast/commentary content, the original concept) and **Warzone Livestreams** (genuine live streaming from active conflict zones — see §16b). J's UI concept: an angled semi-circle segmented control for switching modes, preserving a "revolving" feel rather than a flat tab bar — a frontend-design detail to work out visually later, but the two-mode structure itself is settled now.

### 16a. News Clips mode — curated commentary from vetted podcasts

Distinct from both Frontlines (raw conflict footage) and Community Pulse (social discussion) — this is **curated analysis/commentary content from vetted podcasts**, discussing that page's top headlines.

**Page layout order, top to bottom:** Verified Commentary carousel → top-3 event dossiers (stacked on Intelligence Panel / side-by-side on tab pages, per §10's existing ranking logic) → rest of feed, with Community Pulse and the first-hand ticker in their existing side positions (§9a/§9b).

**Scoping:** tied to the page's active topic (like the ticker) — a podcast segment discussing Middle East conflict dynamics surfaces on the Conflict tab if relevant, not globally on every page. Should link to the specific top headlines it's discussing where identifiable, not just float unattached.

**Draft shape:**

```text
CommentarySegment {
  id
  title
  sourcePodcast
  podcastVettingTier   // see below — needs its own vetting standard
  topicTags            // same tag set as everything else, for page-scoping
  relatedEventIds       // links to the specific event(s)/headline(s) being discussed, where identifiable
  videoUrl
  publishDate
  durationSeconds
}
```

**Open — podcast vetting criteria not yet defined.** This needs the same kind of standard the outlet list got (§7), not an assumed list. Reasonable starting criteria to vet against: established news/policy-org affiliation (e.g. a podcast produced by or affiliated with a recognized outlet or think tank), host credentials (professional journalists/analysts, not anonymous commentary), and transparency about funding/affiliation — mirroring the same "the label itself must be defensible" standard applied to AllSides leanings and RSF press-freedom context elsewhere in this doc. Candidate examples to vet, not yet approved additions: War on the Rocks, CFR's The World Next Week, BBC Global News Podcast — flagged as starting points for a vetting pass, following the same pattern as every other source category in this document, not pre-decided.

**Also open:** whether Verified Commentary segments should carry a `leaning` field the way outlets do (a podcast's editorial framing is arguably as relevant as a written outlet's), or whether host credibility/affiliation transparency is a sufficient trust signal on its own without a political-lean rating.

### 16b. Warzone Livestreams mode — genuine live streaming, with a mandatory delay buffer

Real, continuously-streaming feeds from active conflict zones (fixed war-zone cameras, live broadcast embeds, occasional live footage during active fighting) — not recorded clips, and not the "most recent clip" near-live interpretation originally assumed for Events' "live video" source category (§17c) — that reframing still stands for an Event's dossier entry; this is a separate, dedicated mode specifically for genuine open streams.

**This directly reopens the core tension flagged in §17c: everything else in Atlas reviews a complete file before anyone sees it, and a true live stream has no "before."** Solved the way broadcast television solves the same problem — **a short, mandatory delay buffer (5–10 seconds proposed)** between capture and display:

- Layer 2's frame-sampling (§15f) runs continuously against the buffered feed during the delay window
- Any flagged frame **auto-cuts the stream to a "content under review" placeholder** for that viewer, rather than ever rendering it — same conservative, over-blocking bias as the recorded-clip pipeline (any flag blocks, no averaging)
- Tier A's absolute hard-blocks (minors, sexual violence, terrorist propaganda) apply with zero exception, identical to every other surface in this design
- The gore-scope decision from §15f (blood/mutilation blocked; a non-graphic fatal strike/engagement is in scope) governs what actually trips a cut here too — no separate, looser standard for live content

**Honest risk this carries, not eliminated by the delay:** a filter with only seconds to act on a live buffer has a higher false-negative risk than one reviewing a complete file at leisure with no time pressure. The delay meaningfully reduces this risk versus zero delay, but doesn't equal the safety margin of the recorded-clip pipeline. This should be treated as an ongoing risk to monitor (a natural extension of the calibration process in §15f — live-buffer performance likely needs its own calibration pass, separate from the recorded-clip one, since the time-pressure characteristics are genuinely different).

**Frontend consent layer, additive to the backend filter above:** a **"Viewer discretion advised" click-through thumbnail** gates entry to Warzone Livestreams — the user must actively click through before a stream plays, rather than being autoplayed into it. **This is a UX/consent layer, not a substitute for the delay-buffer content-safety filtering above.** The click-through governs whether a viewer sees content *without warning*; it does not govern whether the content is allowed to exist at all — that's still entirely the backend filter's job. Tier A's absolute hard-blocks and the gore-scope line apply identically regardless of whether a viewer has clicked through, since a consent screen can't be the thing standing between a viewer and content that should never be shown in the first place. Both layers exist together: filter decides what can be behind the gate; the gate decides how a viewer chooses to encounter it.

**Open, not yet resolved:**

- Actual candidate sources for genuine live conflict-zone streams haven't been identified/vetted yet — this needs its own sourcing pass, the same way outlets, Telegram channels, and country-native sources each got one. Nothing should be assumed here without going through that process.
- Exact delay duration (5–10 seconds proposed, not fixed) should probably be set empirically based on how long Layer 2's classification actually takes in practice, not picked arbitrarily in advance.
- Whether Warzone Livestreams needs its own, separate calibration dataset (§15f) given the live-buffer time constraint is a materially different problem than filtering a complete recorded file.

------------------------------------------------------------------------

## 17. Architecture reframe: Event as the primary object, not the article

**This changes the shape of the whole system, and it's a genuine improvement, not just a feature addition.** J's proposal: instead of `NewsItem` (an individual outlet's article) being the primary thing Atlas displays, the primary object becomes an **Event** — a real-world occurrence — with individual reports, posts, and statements attached to it as a heterogeneous **source dossier**. If 17 outlets report the same missile strike, Atlas shows one Event card, not 17 near-duplicate NewsItem cards.

**Example from J's proposal:**

```text
EVENT — Explosion reported in Kyiv
09:14 UTC
  • Reuters report
  • BBC report
  • 3 X posts
  • 2 Telegram videos
  • Reddit discussion
  • live video
  • official Ukrainian statement
```

### 17a. Why this is a structural improvement, not just deduplication

This reframe doesn't just fix a display/clutter problem — it actually **simplifies the corroboration model already built in §8.** Right now, corroboration (`wire-confirmed` / `specialist-verified` / `osint-corroborated (2+)` / `unconfirmed`) is tracked as an abstract field on each individual NewsItem. Under the Event model, corroboration becomes a **direct computation over the Event's own source dossier**: count the qualifying source entries and check their tiers against §8's existing floor table. An event with a Reuters report *and* a BBC report in its dossier is trivially wire-confirmed — there's no separate field to maintain, the answer falls directly out of what's already in the dossier. This is a cleaner implementation of a rule that already existed, not a new rule.

It also resolves a real tension from §9b: Community Pulse was specced as an ambient, tab-wide side panel of general discussion trends — that stays as-is for browsing a whole topic. But J's example shows "Reddit discussion" as an entry *inside* a specific event's dossier — that's a different, narrower thing: discussion threads specifically about *that* event, surfaced as one line in its dossier, when they exist. Both can coexist: Community Pulse (ambient, ordering by tab) and per-event discussion links (specific, nested in a dossier) aren't the same feature and don't compete.

### 17b. Proposed schema

```text
Event {
  id
  title              // short, neutral, factual — "Explosion reported in Kyiv," not editorializing
  eventTimestamp     // the canonical UTC time of the occurrence itself, distinct from any individual source's publish time
  linkedEntityIds
  topicTags
  systemicThemes
  severity           // "critical" | "major" | "significant" | "routine" — same tag-scoped rules as §5, now assigned at the Event level
  corroboration      // now DERIVED from sources[], not a separately-tracked field — see 17a
  reviewStatus       // same head-of-state-death gate as §8, now evaluated against the Event's aggregate dossier
  sources: SourceEntry[]
  snapshotDate
}

SourceEntry {
  id
  sourceCategory     // "outlet" | "analysis" | "first-hand" | "official-statement" | "community-discussion" | "live-video"
  countsTowardCorroboration   // boolean — outlet/analysis/specialist-verified first-hand = true; community-discussion = always false (§9b's hard wall, now expressed per-entry rather than by being a wholly separate subsystem); live-video = unresolved, see 17c
  refUrl
  timestamp
  // then category-specific fields exactly as already defined elsewhere in this doc:
  //   outlet → §7's outlet fields (leaning, leaningSource, tier, caveat, etc.)
  //   first-hand → §15a/§7's first-hand fields (channel, affiliationNote)
  //   analysis → §7's analysis fields
}
```

`NewsItem` (§12) is superseded by this model — an individual outlet article is now one `SourceEntry` of category `"outlet"` attached to an Event, not a standalone top-level object. Tabs (§9a), ranking (§10), and presets (§11) all now filter/sort **Events**, not individual articles — the top-3 stacked/side-by-side display (§10) shows top-3 *events*, each expandable into its dossier, which is exactly what makes the Verified Commentary feed (§16) able to link `relatedEventIds` meaningfully.

### 17c. Two genuinely new categories this introduces, both needing explicit decisions

**"Official statement" is a new source category, not a fit for any existing one.** A government/military press release or official account post isn't an outlet (no editorial leaning applies — it's a primary-source statement, not journalism) and isn't first-hand in the Telegram/X-witness sense either. New fields: `issuingBody` (e.g. "Ukrainian Ministry of Defense"), `statementType` (press release / press conference / official social account post). No `leaning` field — political framing is inherent to what a government statement is, not something to bias-rate the way journalism gets rated.

**"Live video" as an Event dossier entry is resolved as "most recent available clip, refreshed at high frequency"** — keeps the static build-time architecture fully intact for the Event/dossier model specifically. **Genuine open live streaming is a separate, dedicated feature** — Warzone Livestreams mode (§16b) — solved with a mandatory delay-buffer content-safety approach rather than folded into the Event dossier model. These are two different problems with two different solutions; an Event's dossier never needs to handle a true open stream.

------------------------------------------------------------------------

*This document supersedes the two LOGBOOK.md entries dated 2026-09-17 for anything they conflict with — this is the current state of the design, those are the historical decision trail. Once implementation begins, migrate final decisions back into CLAUDE.md / LOGBOOK.md per the project's standard doc-of-record pattern.*
