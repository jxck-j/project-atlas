import { extractSeverityFacts } from './classify'
import type { TopicTag } from './types'

// A "keyless severity model" feature vector: the SAME extracted facts classify.ts's hand-written tier
// rules gate on (deaths/displaced/evacuation-order counts, capital/embassy/head-of-state/WMD cues,
// escalation and attribution phrasing), turned into a fixed-length numeric vector a small trained
// model can weigh — instead of the hand-written decision tree in classify.ts owning every threshold
// and every combination rule by itself.
//
// Why this exists and not "just feed embeddings to a classifier": that was tried first (see
// embeddingClassifier.ts's own header and BACKLOG.md) and lost badly on Critical — 384 opaque
// embedding dimensions have no reason to encode "how many people died" as a linear direction, and
// with only ~15 Critical examples there's nothing to learn that mapping from. These features are the
// numbers/flags a human rubric-writer already decided matter (news-sourcing-design.md §5); the model
// only has to learn how to WEIGH and COMBINE them, not discover them. See LOGBOOK.md's 2026-09-21
// "keyless severity model" entry.
//
// Deliberately NOT a re-implementation of classify.ts's regexes: every flag here comes from
// `extractSeverityFacts`, the same fact-gathering step `classifyText` itself uses, so this can never
// silently drift from the tuned rules the way a second regex library would.

const TAG_ORDER: TopicTag[] = [
  'conflict-security',
  'terrorism-non-state-actors',
  'diplomacy-politics',
  'economic-trade',
  'energy',
  'humanitarian-displacement',
  'crime-trafficking',
  'science-technology',
]

// Every boolean field of SeverityFacts except the ones already folded into a topic tag one-hot
// (conflictish is exactly conflict-security OR terrorism-non-state-actors, already implied by those
// two tag columns) or reported as a raw count above (deaths/displaced/evacuationOrdered).
const FLAG_NAMES = [
  'headOfStateDeathClaim',
  'unconfirmedSelfClaim',
  'wmd',
  'pheic',
  'embassyAttack',
  'capitalAttack',
  'capitalAttackRare',
  'regimeChange',
  'warDeclaration',
  'pactWithdrawal',
  'sovereignDefault',
  'chokepointClosure',
  'territorial',
  'strikeWithCasualty',
  'escalation',
  'majorPolicy',
  'sanctionsLifted',
  'diplomaticSever',
  'exLeaderVerdict',
  'pardon',
  'marketShock',
  'energyInfraAttack',
  'infrastructureCyber',
  'rhetoricOnly',
  'leaderOrMilitaryAction',
] as const

/** Same length and order as `severityFeatureVector`'s output. */
export const SEVERITY_FEATURE_NAMES: readonly string[] = [
  'log_deaths',
  'log_displaced',
  'log_evacuationOrdered',
  ...FLAG_NAMES,
  ...TAG_ORDER.map((t) => `tag_${t}`),
]

/**
 * Pure, deterministic — no embeddings, no network, no API key. Counts are log1p-scaled (deaths of
 * 10 vs 10,000 shouldn't be ~1000x apart to a linear model the way the raw figures are); every other
 * feature is a plain 0/1 flag.
 */
export function severityFeatureVector(text: string): number[] {
  const f = extractSeverityFacts(text)
  const log1p = (n: number) => Math.log1p(n)
  return [
    log1p(f.deaths),
    log1p(f.displaced),
    log1p(f.evacuationOrdered),
    ...FLAG_NAMES.map((name) => (f[name] ? 1 : 0)),
    ...TAG_ORDER.map((t) => (f.topicTags.includes(t) ? 1 : 0)),
  ]
}
