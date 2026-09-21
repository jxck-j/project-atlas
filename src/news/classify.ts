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

// Deliberately wide (design §6: the pre-filter "only needs to avoid discarding
// real candidates, not be precise"). Energy is new in v2; v1 had no such tag.
const TAG_KEYWORDS: Record<TopicTag, RegExp> = {
  'conflict-security': words([
    'war', 'military', 'troop', 'airstrike', 'air strike', 'offensive', 'invasion', 'combat', 'ceasefire',
    'front line', 'missile', 'drone strike', 'army', 'battle', 'shelling', 'clash', 'fighting', 'gunmen',
    'gunfire', 'airforce', 'air force', 'navy', 'strike on', 'defence', 'defense ministry',
  ]),
  'terrorism-non-state-actors': words([
    'terrorist', 'terrorism', 'militant', 'extremist', 'bombing', 'insurgent', 'rebel group', 'isis',
    'al-qaeda', 'hamas', 'hezbollah', 'houthi', 'taliban', 'al-shabaab', 'boko haram', 'suicide bomber',
  ]),
  'diplomacy-politics': words([
    'summit', 'treaty', 'election', 'president', 'prime minister', 'resign', 'coup', 'parliament',
    'diplomat', 'diplomatic', 'embassy', 'security council', 'nato', 'sanction', 'talks', 'minister',
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
  ]),
}
// Tokens too short/ambiguous for the plural-tolerant matcher above.
const AI_RE = /\bAI\b/
const TAG_ORDER = Object.keys(TAG_KEYWORDS) as TopicTag[]

export function resolveTopicTags(text: string): TopicTag[] {
  const tags = TAG_ORDER.filter((tag) => TAG_KEYWORDS[tag].test(text))
  if (AI_RE.test(text) && !tags.includes('science-technology')) tags.push('science-technology')
  return tags
}

// --- Severity triggers (design §5) ----------------------------------------
const NUMBER = String.raw`(\d{1,3}(?:,\d{3})+|\d+(?:\.\d+)?)(?:\s*(million|m|thousand|k))?`
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
const CAPITAL_EMBASSY_ATTACK_RE = /\b(embassy|capital city)\b[^.]{0,40}\b(attack|attacked|bombed|struck|storm|stormed|shelled)\b|\b(attack|strike|bombing) on (?:the )?[^.]{0,30}\b(embassy|capital)\b/i
const REGIME_CHANGE_RE = /\b(coup|overthrown|ousted|forced (?:to )?resign(?:ation)?)\b/i
const WAR_DECLARATION_RE = /\bdeclares? war\b/i
const PACT_WITHDRAWAL_RE = /\bwithdraw(?:s|al|ing)? from\b[^.]{0,30}\b(nato|nuclear (?:deal|treaty)|non-proliferation treaty|new start)\b/i
const SOVEREIGN_DEFAULT_RE = /\b(sovereign default|defaults? on (?:its )?(?:sovereign )?debt|currency collapse|hyperinflation)\b/i
const CHOKEPOINT_CLOSURE_RE = /\b(?:closes?|closed|closure of|blockad\w+)\b[^.]{0,30}\b(strait of hormuz|suez canal|bab el-mandeb|strait of malacca)\b/i
const PHEIC_RE = /\b(pandemic declared|public health emergency of international concern|pheic)\b/i
const STRIKE_RE = /\b((?:air ?)?strike[sd]?|struck|attack(?:s|ed)?|bomb(?:s|ed|ing)?|shell(?:s|ed|ing)?|missile|drone|raid(?:s|ed)?|assault)\b/i
const CASUALTY_RE = /\b(kill(?:s|ed|ing)?|dead|deaths?|wounded|injured|casualties|fatalities)\b/i
const TERRITORIAL_RE = /\b(captur(?:es|ed|ing)|seiz(?:es|ed|ing)|annex(?:es|ed|ation)|takes control of)\b/i
const MAJOR_POLICY_RE = /\b(sanctions? (?:package|on)|new sanctions|snap election|formal notice|triggers? article|treaty exit)\b/i
const MARKET_SHOCK_RE = /\b(market (?:crash|rout|plunge|turmoil)|stocks? (?:plunge|tumble|crash)|central bank (?:cuts?|raises?|hikes?)|(?:cuts?|raises?|hikes?) (?:interest )?rates?|production cuts?|oil price (?:spike|surge|plunge))\b/i
const INFRASTRUCTURE_CYBER_RE = /\b(?:cyber ?attack|ransomware|hack\w*)\b[^.]{0,50}\b(power grid|pipeline|hospital|airport|water|infrastructure|bank)\b/i
const RHETORIC_RE = /\b(says?|said|warns?|vows?|threatens?|calls? for|urges?|slams?|condemns?|claims?|insists?|pledges?)\b/i
const ACTION_RE = /\b((?:air ?)?strike[sd]?|struck|attack(?:s|ed)?|launch(?:es|ed)?|deploy(?:s|ed)?|invade[sd]?|sign(?:s|ed)?|imposes?|imposed|announces?|orders?|ordered|kill(?:s|ed)?|seiz(?:es|ed)?|captur(?:es|ed)?|elects?|wins?)\b/i
const LEADER_OR_MILITARY_RE = /\b(president|prime minister|parliament|government|military|army|minister|senate|congress|troops|navy|air force)\b/i

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

export function classifyText(text: string): Classification {
  const topicTags = resolveTopicTags(text)
  const has = (t: TopicTag) => topicTags.includes(t)
  const conflictish = has('conflict-security') || has('terrorism-non-state-actors')
  const headOfStateDeathClaim = HEAD_OF_STATE_DEATH_RE.test(text)
  const deaths = figure(DEATHS_RES, text)

  let severity: Severity = 'routine'

  // Critical — each trigger scoped to its tag (design §5). Mass-casualty is
  // conflict/terrorism-only: v1 applied it in its tag-independent override,
  // which would tier a 12-death bus crash Critical.
  const critical =
    (conflictish && (massCasualtySeverity(deaths) === 'critical' || WMD_RE.test(text) || CAPITAL_EMBASSY_ATTACK_RE.test(text))) ||
    (has('diplomacy-politics') && (REGIME_CHANGE_RE.test(text) || WAR_DECLARATION_RE.test(text) || PACT_WITHDRAWAL_RE.test(text))) ||
    ((has('economic-trade') || has('energy')) && (SOVEREIGN_DEFAULT_RE.test(text) || CHOKEPOINT_CLOSURE_RE.test(text))) ||
    // Tag-independent: a story naming one of these is high-stakes however the
    // keyword tagger happened to bucket it (v1's cross-tag override).
    headOfStateDeathClaim ||
    WMD_RE.test(text) ||
    PHEIC_RE.test(text) ||
    REGIME_CHANGE_RE.test(text) ||
    WAR_DECLARATION_RE.test(text)

  const humanitarian = has('humanitarian-displacement') ? humanitarianSeverity({ deaths, displaced: figure(DISPLACED_RES, text), pheic: PHEIC_RE.test(text), evacuationOrdered: Math.max(figure(EVACUATION_ORDER_RES, text), MILLIONS_EVACUATE_RE.test(text) ? 1_000_000 : 0) }) : null

  if (critical || humanitarian === 'critical') severity = 'critical'
  else if (
    humanitarian === 'major' ||
    (conflictish && ((STRIKE_RE.test(text) && CASUALTY_RE.test(text)) || TERRITORIAL_RE.test(text))) ||
    (has('diplomacy-politics') && MAJOR_POLICY_RE.test(text)) ||
    ((has('economic-trade') || has('energy')) && MARKET_SHOCK_RE.test(text)) ||
    ((has('science-technology') || has('crime-trafficking')) && INFRASTRUCTURE_CYBER_RE.test(text))
  ) {
    severity = 'major'
  } else if (conflictish || has('diplomacy-politics') || has('humanitarian-displacement')) {
    // Talk without action is Routine (design §5: "statements, rhetoric,
    // posturing"); a concrete verb lifts it to Significant.
    severity = RHETORIC_RE.test(text) && !ACTION_RE.test(text) && !STRIKE_RE.test(text) ? 'routine' : 'significant'
  } else {
    severity = fallbackSeverity(LEADER_OR_MILITARY_RE.test(text) && ACTION_RE.test(text))
  }

  return { topicTags, severity: applySeverityCaps(severity, { topicTags }), headOfStateDeathClaim }
}
