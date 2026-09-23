import { applySeverityCaps, fallbackSeverity, humanitarianSeverity, massCasualtySeverity } from './severity'
import type { Severity, TopicTag } from './types'

// Keyword-heuristic classifier — the Phase 2 STAND-IN for the LLM pass
// (design §6, Phase 3). Everything the build needs from classification goes
// through `Classification`, so Phase 3 replaces `classifyText` without
// touching clustering, the event builder, or the gate. It is deliberately
// coarse and biased toward a safe failure mode: it can under-tier a real
// story (an Event that publishes lower than it deserves) far more easily
// than it can over-tier one, and the only over-tier route it has —
// `headOfStateDeathClaim` — leads to the manual queue, not to publication.
//
// Tier thresholds come from severity.ts (the numeric policy); this file only
// decides which trigger a piece of text hits.

export interface Classification {
  topicTags: TopicTag[]
  severity: Severity
  headOfStateDeathClaim: boolean
}

function words(list: string[]): RegExp {
  // Whole-word with an optional plural, unlike v1's substring `includes`
  // ("war" matched "software", "chip" matched "chipotle").
  return new RegExp(`(?<![\\p{L}\\p{N}])(?:${list.map((w) => w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|')})(?:s|es)?(?![\\p{L}\\p{N}])`, 'iu')
}

// Geopolitically-significant tech (2026-09-22, J): the original science-technology list covered
// AI/cyber but nothing for the "one nation catching up to another's strategic technology" story
// shape (a domestic EUV-class lithography prototype, a reusable-rocket program, backbone telecom
// infrastructure) — a real example (China's own ASML-esque lithography machine) fell through the
// generic keyword net entirely. Kept as compound phrases, not bare 'chip'/'rocket'/'5g' — those
// collide with ordinary nouns (a chocolate chip, the Houston Rockets, a phone's 5G spec sheet) and
// bare terms would also catch routine consumer-product coverage (a new iPhone) that this is
// deliberately NOT meant to pull in. Reused below both for topic tagging and (via STRATEGIC_TECH_RE)
// as its own severity signal — see the "science & technology" branch in classifyText.
const STRATEGIC_TECH_TERMS = [
  'chipmaker', 'chip factory', 'chip export', 'chip ban', 'advanced chip', 'chip war',
  'lithography machine', 'euv lithography', 'semiconductor foundry', 'chip foundry',
  'reusable rocket', 'rocket launch', 'launch vehicle', 'space program', 'space race',
  'satellite constellation', 'moon landing', 'mars mission',
  'undersea cable', 'subsea cable', 'submarine cable', 'telecommunications network', 'telecom infrastructure',
]
const STRATEGIC_TECH_RE = words(STRATEGIC_TECH_TERMS)

// Deliberately wide (design §6: the pre-filter "only needs to avoid discarding
// real candidates, not be precise"). Energy is new in v2; v1 had no such tag.
const TAG_KEYWORDS: Record<TopicTag, RegExp> = {
  'conflict-security': words([
    'war', 'military', 'troop', 'airstrike', 'air strike', 'offensive', 'invasion', 'combat', 'ceasefire',
    'front line', 'missile', 'drone strike', 'army', 'battle', 'shelling', 'clash', 'fighting', 'gunmen',
    'gunfire', 'airforce', 'air force', 'navy', 'strike on', 'defence', 'defense ministry',
    // Added 2026-09-21 (LOGBOOK.md severity review): bare "strike(s)"/"drone(s)" is common real wire wording
    // ("Kyiv launches massive strikes on Moscow", "Ukraine pummels Moscow with drones") that the phrase-only
    // entries above ('strike on', 'airstrike', 'drone strike') missed, leaving real war headlines untagged
    // entirely and falling all the way to Routine. Deliberately wide per this list's own design (§6: the
    // pre-filter should over-tag, not be precise) — a labor/court "strike" landing an extra, spurious
    // conflict-security tag is a much smaller cost than a real strike going completely untagged.
    'strike', 'drone',
  ]),
  'terrorism-non-state-actors': words([
    'terrorist', 'terrorism', 'militant', 'extremist', 'bombing', 'insurgent', 'rebel group', 'isis',
    'al-qaeda', 'hamas', 'hezbollah', 'houthi', 'taliban', 'al-shabaab', 'boko haram', 'suicide bomber',
    // Added 2026-09-21 (severity relabel, phase 2 — LOGBOOK.md): bare 'bomb'/'blast' weren't covered at all — only
    // the compound 'bombing'/'suicide bomber' were — so "31 killed in car bomb at mosque" got no topic tag and its
    // 31 deaths never reached the mass-casualty Critical check. Wide per this list's own design (see the
    // conflict-security list's 'strike'/'drone' comment for the same reasoning).
    'bomb', 'blast',
    // Added 2026-09-23 (J) — the identical gap one word over: 'terrorist'/'terrorism' were here but bare 'terror'
    // wasn't, so the very common "terror attack"/"terror plot" phrasing tagged nothing and its deaths never reached
    // the tag-scoped mass-casualty check ("2015 Paris terror attacks that killed 130 people" -> no tag at all).
    // `words()` is whole-word + optional plural, so this matches "terror"/"terrors" but never "terrified".
    'terror',
  ]),
  'diplomacy-politics': words([
    'summit', 'treaty', 'election', 'president', 'prime minister', 'resign', 'coup', 'parliament',
    'diplomat', 'diplomatic', 'ambassador', 'embassy', 'security council', 'nato', 'sanction', 'talks', 'minister',
  ]),
  'economic-trade': words([
    'tariff', 'trade deal', 'trade war', 'gdp', 'inflation', 'currency', 'default', 'stock market',
    'central bank', 'export', 'import', 'recession', 'interest rate', 'sovereign debt',
  ]),
  energy: words([
    'oil', 'crude', 'opec', 'pipeline', 'refinery', 'lng', 'natural gas', 'energy', 'strait of hormuz',
    'power grid', 'nuclear plant', 'oil price',
  ]),
  'humanitarian-displacement': words([
    'refugee', 'displaced', 'famine', 'drought', 'earthquake', 'flood', 'humanitarian', 'aid group',
    'natural disaster', 'disaster relief', 'outbreak', 'epidemic', 'cholera', 'evacuate', 'evacuation', 'hurricane', 'typhoon', 'wildfire',
  ]),
  'crime-trafficking': words([
    'drug trafficking', 'cartel', 'smuggling', 'human trafficking', 'organized crime', 'money laundering',
    'trafficker', 'narcotics',
  ]),
  'science-technology': words([
    'artificial intelligence', 'semiconductor', 'space launch', 'satellite', 'quantum computing',
    'cyberattack', 'cyber attack', 'ransomware', 'hackers',
    ...STRATEGIC_TECH_TERMS,
  ]),
}
// Tokens too short/ambiguous for the plural-tolerant matcher above.
const AI_RE = /\bAI\b/
const TAG_ORDER = Object.keys(TAG_KEYWORDS) as TopicTag[]

// Lives here rather than with the severity triggers below because both use it: the attack
// co-occurrence rule (next) and `strikeWithCasualty`.
const CASUALTY_RE = /\b(kill(?:s|ed|ing)?|dead|deaths?|wounded|injured|casualties|fatalities)\b/i

// Bare "attack" — a CO-OCCURRENCE rule, not a keyword (2026-09-23, J). The last of the
// untagged-violence family (bare 'bomb'/'blast' 2026-09-21, bare 'terror' 2026-09-23): "Court opens
// trial of 8 accused over the 2015 Paris attacks that killed 130 people" names no other
// conflict/terrorism keyword at all, so it got NO topic tag and its 130 deaths never reached the
// tag-scoped mass-casualty check. Unlike 'terror', 'attack' can't just join a keyword list —
// "attacks critics", "attack on the policy", "attack ad" are ordinary political speech. So it tags
// only when a casualty word co-occurs, and only after stripping the senses that sit next to death
// words by nature: medical ("heart attack") and animal ("fatal dog attacks" — a real archive false
// positive). Stripped rather than used as a veto, so a real attack still tags in text that also
// mentions one ("Attacker with a history of panic attacks kills 4").
// Deliberately a gap-filler: it fires only when NOTHING else made the text conflictish, so it can
// never add a second tag (and a second tab placement) to text already tagged.
const ATTACK_RE = /(?<![\p{L}\p{N}])attack(?:s|ed|ing|er|ers)?(?![\p{L}\p{N}])/iu
const NON_VIOLENT_ATTACK_RE =
  /\b(?:heart|panic|asthma|anxiety|angina|dog|canine|shark|bear|wolf|elephant|crocodile|lion|tiger|hippo|snake|monkey)\s+attacks?\b/gi
// conflict-security, not terrorism-non-state-actors: an unattributed attack is generic violence,
// and calling it terrorism would assert a non-state actor the text gives no evidence for. Both tags
// feed `conflictish` identically, so the mass-casualty path — the point of the rule — works either way.
function hasUnattributedViolentAttack(text: string): boolean {
  return ATTACK_RE.test(text.replace(NON_VIOLENT_ATTACK_RE, '')) && CASUALTY_RE.test(text)
}

export function resolveTopicTags(text: string): TopicTag[] {
  const tags = TAG_ORDER.filter((tag) => TAG_KEYWORDS[tag].test(text))
  if (AI_RE.test(text) && !tags.includes('science-technology')) tags.push('science-technology')
  if (
    !tags.includes('conflict-security') &&
    !tags.includes('terrorism-non-state-actors') &&
    hasUnattributedViolentAttack(text)
  ) {
    tags.push('conflict-security')
  }
  return tags
}

// --- Severity triggers (design §5) ----------------------------------------
// The trailing \b on the unit group matters: without it, "28 militants" or "5 killed in market" would
// match the bare 'm'/'k' abbreviation against the first letter of the NEXT word ("militants", "market")
// and scale 28 or 5 up by a factor of a million/thousand — found 2026-09-21 mining the archive for label
// candidates (a real headline, "Pakistan says it killed 28 militants...", read as 28,000,000 deaths).
// DEATHS_RES's verb-first pattern's permissive `${WHO}\w*` tail is what let the bogus match survive
// instead of failing and backtracking away from it — see LOGBOOK.md.
const NUMBER = String.raw`(\d{1,3}(?:,\d{3})+|\d+(?:\.\d+)?)(?:\s*(million|m|thousand|k)\b)?`
const WHO = String.raw`(?:people\s+|civilians\s+|others\s+|soldiers\s+|children\s+|residents\s+)?`
// Headlines put the count on either side of the verb ("12 killed" / "kills
// 12"), and often as a toll ("death toll rises to 600"); each is its own
// pattern and the largest figure wins.
const DEATHS_RES = [
  new RegExp(String.raw`\b${NUMBER}\+?\s*${WHO}(?:killed|dead|died|deaths|fatalities|casualties|lives)\b`, 'i'),
  new RegExp(String.raw`\b(?:kill(?:s|ed|ing)?|leav(?:es|ing)|left)\s+(?:at least\s+|over\s+|more than\s+|nearly\s+)?${NUMBER}\+?\s*(?:${WHO}dead|${WHO}\w*)`, 'i'),
  new RegExp(String.raw`\b(?:death toll|toll)\b[^.\d]{0,30}${NUMBER}`, 'i'),
]
const DISPLACED_RES = [
  new RegExp(String.raw`\b${NUMBER}\+?\s*${WHO}(?:displaced|homeless|evacuated|fled|left homeless)\b`, 'i'),
  new RegExp(String.raw`\b(?:displac\w+|evacuat\w+|forc\w+ (?:from|to flee))\s+(?:at least\s+|over\s+|more than\s+|nearly\s+)?${NUMBER}`, 'i'),
]
// An evacuation ORDER/ADVISORY is not displacement (J, 2026-09-21: it is 'in lower regard'), so it is parsed separately and can reach Major only.
// "1.6 million in Japan urged to evacuate", "evacuation order for 600,000", and the unnumbered "Millions urged to evacuate".
const EVACUATION_ORDER_RES = [
  new RegExp(String.raw`\b${NUMBER}\+?\s*(?:[\p{L}'-]+\s+){0,4}?(?:urged|ordered|told|asked|advised|encouraged|warned)\s+to\s+(?:evacuate|leave)`, 'iu'),
  new RegExp(String.raw`\bevacuation\s+(?:order|advisory|warning|notice)s?\s+(?:for|covering|affecting|to)\s+(?:up to\s+|more than\s+|over\s+|nearly\s+)?${NUMBER}`, 'i'),
]
const MILLIONS_EVACUATE_RE = /\bmillions\b[^.]{0,40}\b(?:urged|ordered|told|asked|advised)\s+to\s+evacuate/i
const HEAD_OF_STATE = String.raw`(?:president|prime minister|premier|king|queen|emperor|sultan|emir|supreme leader|head of state|head of government|chancellor)`
// Death specifically — v1's pattern also matched "deposed" and any "dead"
// within 60 characters, so "president says 10 dead" flagged a death claim.
const HEAD_OF_STATE_DEATH_RE = new RegExp(
  String.raw`\b${HEAD_OF_STATE}\b(?:\s+[\p{Lu}][\p{L}'.-]+){0,3}\s+(?:has\s+been\s+|was\s+|is\s+)?(?:killed|assassinated|dies|died|found dead|shot dead)\b|\b(?:death|assassination|killing) of\b[^.]{0,20}\b${HEAD_OF_STATE}\b`,
  'iu',
)
const WMD_RE = /\b(nuclear (weapon|strike|attack|warhead|detonation)|chemical (weapon|attack)|biological (weapon|attack)|radiological (weapon|attack)|dirty bomb)\b/i
// Broadened 2026-09-21 (see LOGBOOK.md's severity-review entry): the original required the literal phrase "attack on
// [the] embassy/capital", which missed the far more common wire-headline shapes "attack(s) ON [country's] capital" (plural
// dropped the match), "tried to ATTACK its capital", "targeted ... capital", "missile AT ... capital". Both orders,
// tolerant of tense/number, still gated to conflictish text by the caller so "capital" alone (as in "capital markets")
// can't fire this on its own. Split into two patterns (settled call 7): an embassy attack is inherently rare and stays
// unconditionally Critical; a capital attack needs CAPITAL_ATTACK_RARE_RE too (below) — applied literally, "capital =
// Critical" would make every Ukraine drone attack on Moscow Critical, one of the most frequent headline shapes in that
// war, contradicting 11/11 real labeled examples all deliberately called Major.
const EMBASSY_ATTACK_RE =
  /\bembassy\b[^.]{0,60}\b(attack\w*|strikes?|struck|bomb\w*|storm\w*|shell\w*|target\w*|missile|drone)\b|\b(attack\w*|strikes?|struck|bomb\w*|storm\w*|shell\w*|target\w*|missile|drone)\b[^.]{0,60}\bembassy\b/i
const CAPITAL_ATTACK_RE =
  /\bcapital\b[^.]{0,60}\b(attack\w*|strikes?|struck|bomb\w*|storm\w*|shell\w*|target\w*|missile|drone)\b|\b(attack\w*|strikes?|struck|bomb\w*|storm\w*|shell\w*|target\w*|missile|drone)\b[^.]{0,60}\bcapital\b/i
// A rarity/novelty phrase — the mechanical signal that a capital strike is NOT the routine baseline of an already-
// active war. Riyadh's real headline said "for the first time since the Yemen conflict resumed"; none of the 11 real
// Moscow-drone-attack headlines said anything like it, even calling one the "largest ever."
const CAPITAL_ATTACK_RARE_RE = /\b(first time|first[- ]ever|for the first time|since (?:the )?[\p{L}\s]{0,30}(?:conflict|war) resumed|unprecedented|never before)\b/iu
// A physical strike/sabotage on energy infrastructure short of the capital/embassy case above — settled call 2
// (LOGBOOK.md 2026-09-21): capital = Critical without casualties, infrastructure = Major. Separate from
// INFRASTRUCTURE_CYBER_RE below, which is a cyberattack, not a physical one.
const ENERGY_INFRA_ATTACK_RE =
  /\b(pipeline|refinery|power grid|fuel depot|lng terminal|oil field|oilfield)\b[^.]{0,60}\b(attack\w*|strikes?|struck|bomb\w*|drone|missile|shell\w*|sabotag\w*|explo\w*|shut|shutdown|halt\w*)\b|\b(attack\w*|strikes?|struck|bomb\w*|drone|missile|shell\w*|sabotag\w*)\b[^.]{0,60}\b(pipeline|refinery|power grid|fuel depot|lng terminal|oil field|oilfield)\b/i
// Tightened 2026-09-21 (severity relabel, phase 2 — LOGBOOK.md): the original fired on bare 'ousted'/'overthrown',
// which matched "China... Removing OUSTED Generals From Party" (military officers expelled from a party, not a
// regime change) — a false Critical. 'ousted'/'overthrown'/'forced resignation' now need a head-of-state/
// government term nearby; 'coup' alone is still a strong enough signal to stay unscoped, EXCEPT when the coup
// itself is dated ("the 2021 coup") — a historical reference, not a fresh one (the same class of bug
// LEGAL_FOLLOWUP_RE already fixes for a head-of-state DEATH claim).
const HISTORICAL_COUP_RE = /\b(?:19|20)\d{2}\s+coup\b|\bcoup\s+(?:of|in)\s+(?:19|20)\d{2}\b/i
const OUSTED_LEADER_RE =
  /\b(overthrown|ousted|forced (?:to )?resign(?:ation)?)\b[^.]{0,50}\b(president|prime minister|premier|king|queen|emperor|government|regime|leader|head of state)\b|\b(president|prime minister|premier|king|queen|emperor|government|regime|leader|head of state)\b[^.]{0,50}\b(overthrown|ousted|forced (?:to )?resign(?:ation)?)\b/i
const REGIME_CHANGE_RE = { test: (text: string) => (/\bcoup\b/i.test(text) && !HISTORICAL_COUP_RE.test(text)) || OUSTED_LEADER_RE.test(text) }
const WAR_DECLARATION_RE = /\bdeclares? war\b/i
const PACT_WITHDRAWAL_RE = /\bwithdraw(?:s|al|ing)? from\b[^.]{0,30}\b(nato|nuclear (?:deal|treaty)|non-proliferation treaty|new start)\b/i
const SOVEREIGN_DEFAULT_RE = /\b(sovereign default|defaults? on (?:its )?(?:sovereign )?debt|currency collapse|hyperinflation)\b/i
const CHOKEPOINT_CLOSURE_RE = /\b(?:closes?|closed|closure of|blockad\w+)\b[^.]{0,30}\b(strait of hormuz|suez canal|bab el-mandeb|strait of malacca)\b/i
const PHEIC_RE = /\b(pandemic declared|public health emergency of international concern|pheic)\b/i
const STRIKE_RE = /\b((?:air ?)?strike[sd]?|struck|attack(?:s|ed)?|bomb(?:s|ed|ing)?|shell(?:s|ed|ing)?|missile|drone|raid(?:s|ed)?|assault)\b/i
const TERRITORIAL_RE = /\b(captur(?:es|ed|ing)|seiz(?:es|ed|ing)|annex(?:es|ed|ation)|takes control of)\b/i
// "captured"/"seized" also describe detaining a PERSON — an arrest, not a territorial gain. Found
// 2026-09-23 on the archive, exposed (not caused) by the attack co-occurrence rule above: "Eleven
// injured in shooting outside Turkish school... the attacker has been captured" newly carried a
// conflict tag, and `territorial` then made a school shooting Major. The veto is text-wide, so a
// real territorial gain reported alongside an arrest loses its `territorial` flag too — accepted
// because it only ever LOWERS a tier, this file's stated safe direction, and that story reaches
// Major by the ordinary strike+casualty route anyway.
const PERSON_CAPTURE_RE =
  /\b(?:attacker|assailant|suspect|gunman|shooter|hijacker|fugitive|militant|insurgent|hostage)s?\b[^.]{0,30}\b(?:captur|seiz)\w*|\b(?:captur|seiz)\w*\b[^.]{0,30}\b(?:attacker|assailant|suspect|gunman|shooter|hijacker|fugitive)s?\b/i
// Settled call 5 (LOGBOOK.md 2026-09-21): a contained strike in an ongoing war is Major only at 5+ deaths in the single
// incident, or a notable escalation regardless of count — not any casualty count, which §5's literal wording would make
// Major (every routine Gaza/Ukraine strike headline). Escalation markers are approximate on purpose.
export const CONTAINED_STRIKE_MAJOR_DEATHS = 5
// Split in two 2026-09-23, from a live Phase 4 report: "Burnham to meet Trump FOR THE FIRST TIME at the UN" was
// tiering Major. A first diplomatic meeting is not an escalation — but the text also said "after offering UK
// military support for Saudis", which made it `conflictish`, and conflictish + escalation is Major on its own.
//  - MILITARY_ESCALATION_RE: phrases that are inherently about fighting. Safe unscoped.
//    `de-escalation`/`de-escalate` are excluded: \b matches after the hyphen, so the bare `escalat\w+` alternative
//    used to fire on a call for the OPPOSITE of escalation.
//  - NOVELTY_ESCALATION_RE: "first time"/"first-ever" counts only when a FIGHTING word sits within the same
//    sentence clause. Alone it is a perfectly ordinary way to describe a first visit, meeting or election.
//    Requiring the fighting word merely to be present somewhere in the text was tried first and is too loose —
//    the Burnham article says "military support for Saudis" in its title. `[^.]{0,60}` is doing two jobs: real
//    proximity, and a sentence boundary (which is also why "meet U.S. President Trump for the first time"
//    can't reach back past "U.S."). Checked against the labeled set: it keeps "first time since the May 2025
//    military clashes" and "In Combat For First Time" (both labeled Major) while dropping the diplomatic ones.
// The original Houthi case that motivated an unscoped escalation trigger ("threatening further escalation", no
// casualty figure, no fighting word at all) still matches via MILITARY_ESCALATION_RE — asserted in a test.
const MILITARY_ESCALATION_RE =
  /\b(previously untouched|new (?:\w+\s+)?(?:weapon|missile)|cross-border strike|crosses? (?:the )?border|(?<!de-)(?<!de)escalat\w+)\b/i
const NOVELTY = String.raw`(?:first[ -]time|first[- ]ever)`
// Bare "war" is deliberately NOT here: it is background context in a great deal of economic coverage ("diesel
// topped $6.50 for the FIRST TIME, extending a WAR-driven rally" — two real labeled articles, both Significant,
// both tiered Major while it was in the list). The words kept are ones that name a fighting EVENT.
const FIGHTING = String.raw`(?:(?:air ?)?strikes?|struck|attacks?|attacked|bomb\w*|shell\w*|missiles?|drones?|raids?|assault\w*|combat|clash\w*|fighting|offensive|invasion|troops)`
const NOVELTY_ESCALATION_RE = new RegExp(
  String.raw`\b${NOVELTY}\b[^.]{0,60}\b${FIGHTING}\b|\b${FIGHTING}\b[^.]{0,60}\b${NOVELTY}\b`,
  'i',
)
// Settled call — "sanctions? on" also matches LIFTING sanctions ("US lifts sanctions on Eritrean officials"), a
// de-escalation, not the new-sanctions-package action §5 means (found in the severity relabel, phase 2). Guarded
// below, not folded into the regex itself, since it's the one alternative in this list that needs the guard.
const SANCTIONS_LIFTED_RE = /\b(lifts?|lifted|removes?|removed|eases?|eased|drops?|dropped)\b[^.]{0,20}\bsanctions?\b/i
const MAJOR_POLICY_RE = /\b(sanctions? (?:package|on)|new sanctions|snap election|early (?:parliamentary )?elections?|formal notice|triggers? article|treaty exit)\b/i
// Settled call 6: severing relations is Major; expelling/recalling an ambassador (no severance) stays Significant via the
// ordinary diplomacy-politics fallback, so it needs no regex of its own here.
const DIPLOMATIC_SEVER_RE = /\b(cuts?|severs?|sever(?:ed|ing)|breaks?|broke|ends?|ended)\s+(?:diplomatic|all diplomatic)\s+(?:relations|ties)\b/i
// Settled call 4: a verdict/sentence against an ex-head-of-state/leader is Major; an arrest, extradition or trial over a
// PAST head-of-state killing is Significant (the ordinary fallback already gives Significant once headOfStateDeathClaim
// is correctly suppressed for that case below — see LEGAL_FOLLOWUP_RE). A pardon/clemency/commutation is neither a
// fresh conviction nor an escalation — it's leniency — so it's guarded out (found in the severity relabel, phase 2:
// "Malaysia's ex-PM can serve his 1MDB sentence under house arrest" after a royal pardon isn't a new verdict).
const PARDON_RE = /\b(pardon\w*|clemency|commut\w*)\b/i
const EX_LEADER_VERDICT_RE = /\b(sentenc\w+|convict\w+|verdict)\b[^.]{0,60}\b(?:ex-|former )?(?:president|prime minister|premier|king|leader)\b|\b(?:ex-|former )?(?:president|prime minister|premier|king|leader)\b[^.]{0,60}\b(sentenc\w+|convict\w+|verdict)\b/i
// Broadened 2026-09-21 (severity relabel, phase 2): "market (?:crash|rout|...)" missed "global BOND rout intensifies" —
// a rout in bonds or stocks specifically is the same shock class as a market-wide one.
const MARKET_SHOCK_RE = /\b((?:market|bond|stock)s? (?:crash|rout|plunge|turmoil)|stocks? (?:plunge|tumble|crash)|central bank (?:cuts?|raises?|hikes?)|(?:cuts?|raises?|hikes?) (?:interest )?rates?|production cuts?|oil price (?:spike|surge|plunge))\b/i
const INFRASTRUCTURE_CYBER_RE = /\b(?:cyber ?attack|ransomware|hack\w*)\b[^.]{0,50}\b(power grid|pipeline|hospital|airport|water|infrastructure|bank)\b/i
const RHETORIC_RE = /\b(says?|said|warns?|vows?|threatens?|calls? for|urges?|slams?|condemns?|claims?|insists?|pledges?)\b/i
const ACTION_RE = /\b((?:air ?)?strike[sd]?|struck|attack(?:s|ed)?|launch(?:es|ed)?|deploy(?:s|ed)?|invade[sd]?|sign(?:s|ed)?|imposes?|imposed|announces?|orders?|ordered|kill(?:s|ed)?|seiz(?:es|ed)?|captur(?:es|ed)?|elects?|wins?)\b/i
const LEADER_OR_MILITARY_RE = /\b(president|prime minister|parliament|government|military|army|minister|senate|congress|troops|navy|air force)\b/i

// --- Settled call 1: a state's own claim about its OWN strike's toll (LOGBOOK.md 2026-09-21) --------------------------
// Stays Significant until independently confirmed; once confirmed the ordinary single-incident rule (10+ deaths =
// Critical, 5+ = Major) applies. Detecting genuine third-party confirmation from headline text alone isn't reliable, so
// this is deliberately approximate and one-directional: it can under-tier a confirmed strike whose headline still reads
// "X says" (e.g. a neutral outlet's "Officials say N killed"), never over-tier one — the same safe-failure-mode bias
// this file's header already states for every other trigger here. A genuinely confirmed count (two independent,
// non-state outlets reporting the same toll) is better resolved at the Event/corroboration level than per-article text;
// flagged in BACKLOG.md as a follow-up, not attempted here.
const SELF_CLAIMED_STRIKE_RE = /^\s*[\p{Lu}][\p{L}.'-]*(?:\s+[\p{Lu}][\p{L}.'-]*){0,2}\s+says?\b[^.]{0,80}\bkill(?:ed|s|ing)?\b/u
const INDEPENDENT_CONFIRMATION_RE = /\b(independently (?:confirmed|verified)|confirmed by [^.]{0,30}(?:witnesses|monitors|hospital|officials)|verified by)\b/i
// Legal follow-ups (a trial, sentence, extradition, arrest over a PAST killing) must not read as a fresh head-of-state
// death claim — see the Haiti/Kosovo cases in LOGBOOK.md's severity-review entry.
const LEGAL_FOLLOWUP_RE = /\b(extradit\w+|sentenc\w+|convict\w+|verdict|trial|indict\w+|charged (?:with|over)|arrested (?:over|in connection with)|suspects?|anniversary|years? (?:after|since|on))\b/i
// The JUDICIAL subset of the above, used only for the casualty-inheritance guard (2026-09-23, J). A court reaching a
// verdict takes months or years, so these words imply the underlying attack is PAST. Arrests and "suspects" do NOT —
// police detain people at the scene of a fresh attack the same day, so LEGAL_FOLLOWUP_RE as a whole is too broad to
// gate severity on: it downgraded "Suicide bombing kills 150 at shrine; police arrested two suspects" to Significant.
// headOfStateDeathClaim deliberately keeps using the WIDER regex above — settled call 4's established behavior.
const JUDICIAL_FOLLOWUP_RE = /\b(extradit\w+|sentenc\w+|convict\w+|acquit\w+|verdict|trial|indict\w+|charged (?:with|over)|anniversary|years? (?:after|since|on))\b/i

// Settled call (2026-09-21, J): a death toll accumulated across a recurring campaign is capped at Major via
// this gate, not Critical via the single-incident mass-casualty rule — found via a real headline, "US
// attacks on boats... have killed more than 230 people since September 2025": 230 is a running total over
// roughly a year of separate strikes, not one incident's toll, and design §5's mass-casualty trigger (and
// `HumanitarianFigures`'s own doc comment) both assume a single reported incident. `DEATHS_RES` can't tell
// "230 in this strike" from "230 since a year-old date" apart on its own, so this only blocks the
// CONFLICT/TERRORISM mass-casualty trigger specifically (a natural disaster's toll "since it began" is
// still describing ONE disaster, a different case) — it still lands at Major via the ordinary
// strike+casualty rule below, unaffected. Deliberately narrow: matches the mechanical "since [year]"/"since
// the start of"/"over the past N months" framing actually seen, not a general recurring-campaign detector.
const CUMULATIVE_TOLL_RE = /\b(?:since\s+(?:[\p{L}]+\s+)?(?:19|20)\d{2}\b|since\s+the\s+(?:start|beginning|onset)\s+of\b|over\s+the\s+(?:past|last)\s+\d+\s+(?:months?|years?)\b|combined\s+(?:death\s+)?toll)\b/iu

function scaled(match: RegExpMatchArray): number {
  const base = Number.parseFloat(match[1].replace(/,/g, ''))
  const unit = match[2]?.toLowerCase()
  return unit === 'million' || unit === 'm' ? base * 1_000_000 : unit === 'thousand' || unit === 'k' ? base * 1_000 : base
}

function figure(res: RegExp[], text: string): number {
  return Math.max(0, ...res.map((re) => text.match(re)).map((m) => (m ? scaled(m) : 0)))
}

/** The regex half of the head-of-state death flag. The LLM path ORs it with the model's own flag: a false positive only routes to the manual queue. */
export function matchesHeadOfStateDeath(text: string): boolean {
  return HEAD_OF_STATE_DEATH_RE.test(text)
}

/**
 * Every raw signal `classifyText`'s tier logic below gates on, gathered in one place so a second
 * consumer (the fact-extraction severity model — `severityFeatures.ts`) can build a feature vector
 * from the SAME regex matches the tuned rules use, instead of a parallel implementation that could
 * silently drift from them. Pure, no policy — `classifyText` is still the only place that decides
 * what a given combination of facts actually TIERS to.
 */
export interface SeverityFacts {
  topicTags: TopicTag[]
  conflictish: boolean
  deaths: number
  displaced: number
  evacuationOrdered: number
  headOfStateDeathClaim: boolean
  legalFollowUp: boolean
  unconfirmedSelfClaim: boolean
  cumulativeToll: boolean
  wmd: boolean
  pheic: boolean
  embassyAttack: boolean
  capitalAttack: boolean
  capitalAttackRare: boolean
  regimeChange: boolean
  warDeclaration: boolean
  pactWithdrawal: boolean
  sovereignDefault: boolean
  chokepointClosure: boolean
  territorial: boolean
  strikeWithCasualty: boolean
  escalation: boolean
  majorPolicy: boolean
  sanctionsLifted: boolean
  diplomaticSever: boolean
  exLeaderVerdict: boolean
  pardon: boolean
  marketShock: boolean
  energyInfraAttack: boolean
  infrastructureCyber: boolean
  strategicTech: boolean
  rhetoricOnly: boolean
  leaderOrMilitaryAction: boolean
}

export function extractSeverityFacts(text: string): SeverityFacts {
  const topicTags = resolveTopicTags(text)
  const has = (t: TopicTag) => topicTags.includes(t)
  const conflictish = has('conflict-security') || has('terrorism-non-state-actors')
  // A legal follow-up (trial/sentence/extradition/arrest) over a PAST attack is not a fresh event, and must not inherit
  // that attack's casualty figures — settled call 4 (LOGBOOK.md 2026-09-21), generalized 2026-09-23 (J) from
  // head-of-state killings to any attack. Originally this only suppressed headOfStateDeathClaim, so "18 suspects
  // extradited over the 2021 killing of Haiti's president" stopped reading as a live assassination — but a mass-casualty
  // toll quoted in verdict coverage still forced Critical ("Sri Lanka court convicts 15 over 2019 Easter bombings",
  // whose description carries the original attack's 270 deaths). The death-driven Critical and Major triggers below now
  // consult legalFollowUp too. A verdict against an ex-head-of-state stays Major via exLeaderVerdict — that ceiling is
  // the point, not a side effect.
  const legalFollowUp = JUDICIAL_FOLLOWUP_RE.test(text)
  const headOfStateDeathClaim = HEAD_OF_STATE_DEATH_RE.test(text) && !LEGAL_FOLLOWUP_RE.test(text)
  const deaths = figure(DEATHS_RES, text)
  // Settled call 1: the striking party's own unconfirmed toll claim stays Significant regardless of count. Scoped to
  // conflict/terrorism text only — a humanitarian disaster's official death toll ("officials say 900 dead in floods")
  // goes through humanitarianSeverity below, unaffected by this cap.
  const unconfirmedSelfClaim = conflictish && SELF_CLAIMED_STRIKE_RE.test(text) && !INDEPENDENT_CONFIRMATION_RE.test(text)
  return {
    topicTags,
    conflictish,
    deaths,
    displaced: figure(DISPLACED_RES, text),
    evacuationOrdered: Math.max(figure(EVACUATION_ORDER_RES, text), MILLIONS_EVACUATE_RE.test(text) ? 1_000_000 : 0),
    headOfStateDeathClaim,
    legalFollowUp,
    unconfirmedSelfClaim,
    cumulativeToll: CUMULATIVE_TOLL_RE.test(text),
    wmd: WMD_RE.test(text),
    pheic: PHEIC_RE.test(text),
    embassyAttack: EMBASSY_ATTACK_RE.test(text),
    capitalAttack: CAPITAL_ATTACK_RE.test(text),
    capitalAttackRare: CAPITAL_ATTACK_RARE_RE.test(text),
    regimeChange: REGIME_CHANGE_RE.test(text),
    warDeclaration: WAR_DECLARATION_RE.test(text),
    pactWithdrawal: PACT_WITHDRAWAL_RE.test(text),
    sovereignDefault: SOVEREIGN_DEFAULT_RE.test(text),
    chokepointClosure: CHOKEPOINT_CLOSURE_RE.test(text),
    territorial: TERRITORIAL_RE.test(text) && !PERSON_CAPTURE_RE.test(text),
    strikeWithCasualty: STRIKE_RE.test(text) && CASUALTY_RE.test(text),
    escalation: MILITARY_ESCALATION_RE.test(text) || NOVELTY_ESCALATION_RE.test(text),
    majorPolicy: MAJOR_POLICY_RE.test(text),
    sanctionsLifted: SANCTIONS_LIFTED_RE.test(text),
    diplomaticSever: DIPLOMATIC_SEVER_RE.test(text),
    exLeaderVerdict: EX_LEADER_VERDICT_RE.test(text),
    pardon: PARDON_RE.test(text),
    marketShock: MARKET_SHOCK_RE.test(text),
    energyInfraAttack: ENERGY_INFRA_ATTACK_RE.test(text),
    infrastructureCyber: INFRASTRUCTURE_CYBER_RE.test(text),
    strategicTech: STRATEGIC_TECH_RE.test(text),
    rhetoricOnly: RHETORIC_RE.test(text) && !ACTION_RE.test(text) && !STRIKE_RE.test(text),
    leaderOrMilitaryAction: LEADER_OR_MILITARY_RE.test(text) && ACTION_RE.test(text),
  }
}

export function classifyText(text: string): Classification {
  const f = extractSeverityFacts(text)
  const { topicTags, conflictish, deaths, headOfStateDeathClaim, unconfirmedSelfClaim } = f
  const has = (t: TopicTag) => topicTags.includes(t)

  let severity: Severity = 'routine'

  // Critical — each trigger scoped to its tag (design §5). Mass-casualty is
  // conflict/terrorism-only: v1 applied it in its tag-independent override,
  // which would tier a 12-death bus crash Critical.
  const critical =
    (conflictish && !unconfirmedSelfClaim && ((!f.cumulativeToll && !f.legalFollowUp && massCasualtySeverity(deaths) === 'critical') || f.wmd)) ||
    (conflictish && f.embassyAttack) ||
    (conflictish && f.capitalAttack && f.capitalAttackRare) ||
    (has('diplomacy-politics') && (f.regimeChange || f.warDeclaration || f.pactWithdrawal)) ||
    ((has('economic-trade') || has('energy')) && (f.sovereignDefault || f.chokepointClosure)) ||
    // Tag-independent: a story naming one of these is high-stakes however the
    // keyword tagger happened to bucket it (v1's cross-tag override).
    headOfStateDeathClaim ||
    f.wmd ||
    f.pheic ||
    f.regimeChange ||
    f.warDeclaration

  const humanitarian = has('humanitarian-displacement') ? humanitarianSeverity({ deaths, displaced: f.displaced, pheic: f.pheic, evacuationOrdered: f.evacuationOrdered }) : null

  if (critical || humanitarian === 'critical') severity = 'critical'
  else if (
    humanitarian === 'major' ||
    (conflictish && !unconfirmedSelfClaim && f.territorial) ||
    // A capital strike that ISN'T flagged rare (the Critical branch above) is still a real strike — Major regardless
    // of casualty count, unlike the generic contained-strike rule just below (settled call 7).
    (conflictish && !unconfirmedSelfClaim && f.capitalAttack) ||
    (conflictish &&
      !unconfirmedSelfClaim &&
      ((f.strikeWithCasualty && !f.legalFollowUp && deaths >= CONTAINED_STRIKE_MAJOR_DEATHS) ||
        // An explicit escalation phrase is Major on its own — doesn't need a co-occurring casualty figure (found in
        // the severity relabel, phase 2: "Houthis hit Saudi Arabia, threatening further escalation" names no death
        // toll, but "further escalation"/"another round of regional escalation" is unambiguous on its own).
        f.escalation)) ||
    (has('diplomacy-politics') &&
      ((f.majorPolicy && !f.sanctionsLifted) ||
        f.diplomaticSever ||
        (f.exLeaderVerdict && !f.pardon))) ||
    ((has('economic-trade') || has('energy')) && (f.marketShock || f.energyInfraAttack)) ||
    ((has('science-technology') || has('crime-trafficking')) && f.infrastructureCyber)
  ) {
    severity = 'major'
  } else if (conflictish || has('diplomacy-politics') || has('humanitarian-displacement') || (has('science-technology') && f.strategicTech)) {
    // Talk without action is Routine (design §5: "statements, rhetoric,
    // posturing"); a concrete verb lifts it to Significant. A strategic-tech hit
    // (2026-09-22, J) gets the same floor rather than the generic fallback below,
    // which needs a named leader/government/military actor — a real capability
    // shift (a domestic chip-lithography prototype, a reusable-rocket program) is
    // geopolitically significant on its own, with or without a named official.
    // A judicial follow-up is never Routine: settled call 4 puts a trial over a past killing at Significant, but trial
    // coverage is full of rhetoric words ("8 accused over the 2015 attacks"), which would otherwise drop it to Routine
    // now that the casualty guard above stops it reaching Critical (2026-09-23).
    severity = f.rhetoricOnly && !f.legalFollowUp ? 'routine' : 'significant'
  } else {
    severity = fallbackSeverity(f.leaderOrMilitaryAction)
  }

  return { topicTags, severity: applySeverityCaps(severity, { topicTags }), headOfStateDeathClaim }
}
