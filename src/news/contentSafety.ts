// Layer 1 of the content-safety filter (news-sourcing-design.md §15f): a caption/metadata pre-filter. Pure — text in, tier out.
//
// WHY IT EXISTS NOW: the per-tab ticker (§15b) publishes first-hand channels' text in `public/data/news-firsthand.json`, which is SERVED,
// so anything that gets in is published whatever the client renders. §15c calls the filter "hard, non-negotiable, no override".
// Layer 2 (a visual classifier over sampled frames) does not exist and the ticker is text-only, so this layer is the whole gate for
// the ticker today. It does NOT make images or video safe to show: FIRST_HAND_MEDIA_ENABLED stays off until Layer 2 exists.
//
// THE THREE TIERS (§15f):
//   A  hard block, no calibration override, ever: harm to a minor, sexual violence, terrorist-organisation propaganda.
//   B  elevated scrutiny — the design routes it to Layer 2 with a lower threshold. There is no visual for a text ticker to route, and
//      the design states the cost asymmetry outright (a false positive blocks a legitimate post, a false negative shows someone a
//      corpse), so with no Layer 2 the ticker treats B as a block too.
//   C  normal routing.
//
// DELIBERATELY BLUNT, and it over-blocks: "UN documents rape as a weapon of war" is a report, not content, and it is blocked all the
// same. That is the asymmetry working as designed, on a feed whose value is speed rather than completeness — the outlet-sourced
// Events cover those stories with editorial standing. These patterns are a first cut written from the design's own wording, not a
// tested classifier: nobody has measured a false-negative rate (§15f asks for one), and J has not reviewed the lists. Extend them
// rather than loosening them; every entry is a regex over lowercased text so a test can pin it.

export type SafetyTier = 'A' | 'B' | 'C'

export interface SafetyVerdict {
  tier: SafetyTier
  /** Which rule fired first, for the build's log and the tests. Absent for tier C. */
  rule?: string
}

interface Rule {
  name: string
  pattern: RegExp
}

const MINOR = String.raw`(?:child|children|kid|kids|minor|minors|underage|under-age|infant|baby|toddler|schoolgirl|schoolboy|girl|girls|boy|boys|teen|teens|teenager|teenagers|teenage)`
const SEXUAL = String.raw`(?:sexual|sexually|rape|raped|raping|molest\w*|porn\w*|csam|grooming|groomed|paedophil\w*|pedophil\w*|abus\w*)`

const TIER_A: Rule[] = [
  { name: 'A: minor + sexual', pattern: new RegExp(String.raw`\b${MINOR}\b[^.!?\n]{0,80}\b${SEXUAL}\b|\b${SEXUAL}\b[^.!?\n]{0,80}\b${MINOR}\b`) },
  { name: 'A: sexual violence', pattern: /\b(?:rape[ds]?|raping|rapist|gang[- ]?rape[ds]?|sexual(?:ly)? (?:assault\w*|violence|abuse[ds]?|torture)|sexual(?:ly)? (?:assaulted|abused|violated))\b/ },
  // Recruitment/psychological-effect material: keyed on the caption's own vocabulary, independent of any visual score.
  { name: 'A: terrorist propaganda', pattern: /\b(?:execution (?:video|footage)|beheading (?:video|footage)|hostage (?:confession|video)|forced confession|martyrdom (?:video|operation|footage)|(?:isis|islamic state|daesh|al-?qaeda|al-?shabaab|boko haram) (?:video|propaganda|footage|releases? video))\b/ },
]

const TIER_B: Rule[] = [
  { name: 'B: self-flagged graphic', pattern: /(?:\bgraphic\b|\b18\+|\bnsfw\b|\bviewer discretion\b|\bsensitive (?:content|footage|images?)\b|\bdisturbing (?:footage|video|images?|content|scenes?)\b|\bwarning[:!])/ },
  // "12 killed in strike" alone is ordinary casualty reporting and is NOT here: the trigger is language describing what a VISUAL shows.
  { name: 'B: describes the visual', pattern: /\b(?:shows?|showing|footage (?:of|shows)|video (?:of|shows)|images? (?:of|show)|pictures? (?:of|show)|aftermath)\b[^.!?\n]{0,50}\b(?:bodies|corpses?|dead|remains|blood\w*|wounded|severed|charred|mutilated)\b/ },
  // No bare "gore" (Al Gore) and no bare "severed" ("Iran severed ties"): both are ordinary news words with no visual meaning.
  { name: 'B: gore terminology', pattern: /\b(?:behead\w*|decapitat\w*|dismember\w*|mutilat\w*|disembowel\w*|tortur(?:e|ed|ing)|gory|corpses?)\b/ },
]

/** Tier of a post's caption. Tier A wins over B when both match; first matching rule within a tier is reported. */
export function classifyCaptionSafety(text: string): SafetyVerdict {
  const t = text.toLowerCase()
  for (const rule of TIER_A) if (rule.pattern.test(t)) return { tier: 'A', rule: rule.name }
  for (const rule of TIER_B) if (rule.pattern.test(t)) return { tier: 'B', rule: rule.name }
  return { tier: 'C' }
}

/** Whether the text-only ticker may publish it: tier C only (see the header for why B is blocked too). */
export function isTickerSafe(text: string): boolean {
  return classifyCaptionSafety(text).tier === 'C'
}
