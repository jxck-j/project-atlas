// Generates CLAIMS.md from the live GeoEntityRegistry — the claimant/
// claimed relationships documented there are read straight off
// data/registry/geoEntities.ts (via GeoEntityRegistry), the same registry
// EntityResolver/GeoEntities.tsx/the geoOverlays layers all read at
// runtime. Run with `npm run docs:claims` whenever geoEntities.ts changes;
// CLAIMS.md itself is a generated artifact — hand-editing it will just be
// overwritten the next time this runs. Same reasoning
// scripts/buildEntityTopology.mjs generates public/geo/entities.json
// instead of it being hand-maintained: one source of truth, no drift.
//
// Run via `tsx`, not plain `node` — geoEntities.ts/GeoEntityRegistry.ts
// import each other with extensionless relative specifiers ('./types',
// './GeoEntityRegistry'), which plain Node's built-in TypeScript support
// doesn't resolve (it requires explicit extensions); tsx's resolver does.
// entityGeometryIds.ts (imported by buildEntityTopology.mjs) gets away
// with plain `node` only because it has zero imports of its own.
import fs from 'node:fs'
import '../src/data/registry/geoEntities.ts'
import { getEntities } from '../src/data/registry/GeoEntityRegistry.ts'

const OUTPUT = 'CLAIMS.md'

const entities = getEntities()
const disputed = entities
  .filter((e) => e.claimedBy.length > 0 || e.claims.length > 0)
  .sort((a, b) => a.name.localeCompare(b.name))

const TYPE_LABEL = {
  'geopolitical-entity': 'Geopolitical Entity',
  territory: 'Territory',
  'strategic-region': 'Strategic Region',
  'maritime-feature': 'Maritime Feature',
  'geographic-region': 'Geographic Region',
}

/** Grouping key for a claimant/claim target: `ref.type:ref.id` when a ref exists (unambiguous — the same country or GeoEntity referenced from two different relations always groups together), else the raw displayName (for unregistered parties like the Polisario Front, which have no ref to key on). */
function relationKey(relation) {
  return relation.ref ? `${relation.ref.type}:${relation.ref.id}` : `name:${relation.displayName}`
}

function formatRelation(relation) {
  return relation.since ? `${relation.displayName} (since ${relation.since})` : relation.displayName
}

// Several displayNames in geoEntities.ts carry a trailing descriptive
// parenthetical meant to read naturally inline in a "Claimed by: X, Y, Z"
// sentence (e.g. "Argentine Republic (claim suspended under the Antarctic
// Treaty)") — appropriate there, but repeated as a standalone "By claimant"
// section header for every one of Antarctica's 7 claimants it just reads as
// noise. Stripped for grouping/header purposes only; the full text still
// appears in the "By disputed entity" section via formatRelation() above.
function canonicalLabel(displayName) {
  return displayName.replace(/\s*\([^)]*\)\s*$/, '').trim()
}

// ---------------------------------------------------------------------------
// Section 1: by disputed entity — every entity with a nonempty claimedBy or
// claims, alphabetically, showing who claims it and what (if anything) it
// claims in turn.
// ---------------------------------------------------------------------------
const byEntityLines = []
for (const entity of disputed) {
  byEntityLines.push(`### ${entity.name} (${TYPE_LABEL[entity.type]})`)
  byEntityLines.push('')
  if (entity.claimedBy.length > 0) {
    byEntityLines.push(`- **Claimed by:** ${entity.claimedBy.map(formatRelation).join('; ')}`)
  }
  if (entity.claims.length > 0) {
    byEntityLines.push(`- **Claims:** ${entity.claims.map(formatRelation).join('; ')}`)
  }
  byEntityLines.push('')
}

// ---------------------------------------------------------------------------
// Section 2: by claimant — the same relationships, inverted and grouped by
// who's doing the claiming, so "what does China claim" is a direct lookup
// instead of scanning every disputed entity's own entry for a mention.
// ---------------------------------------------------------------------------
const claimantGroups = new Map() // relationKey -> { label, targets: [{name, type}] }
for (const entity of disputed) {
  for (const relation of entity.claimedBy) {
    const key = relationKey(relation)
    if (!claimantGroups.has(key)) claimantGroups.set(key, { label: canonicalLabel(relation.displayName), targets: [] })
    claimantGroups.get(key).targets.push({ name: entity.name, type: entity.type })
  }
}

const sortedClaimants = Array.from(claimantGroups.values()).sort((a, b) => a.label.localeCompare(b.label))

const byClaimantLines = []
for (const group of sortedClaimants) {
  byClaimantLines.push(`### ${group.label}`)
  byClaimantLines.push('')
  for (const target of group.targets.sort((a, b) => a.name.localeCompare(b.name))) {
    byClaimantLines.push(`- ${target.name} (${TYPE_LABEL[target.type]})`)
  }
  byClaimantLines.push('')
}

const generatedAt = new Date().toISOString().slice(0, 10)

const doc = `# Claims & Disputes Register

**Generated file — do not hand-edit.** Produced by \`npm run docs:claims\`
(\`scripts/generateClaimsDoc.mjs\`) directly from \`data/registry/geoEntities.ts\`
via \`GeoEntityRegistry\`, the same registry the app itself reads at runtime
(\`EntityResolver\`, \`scene/GeoEntities.tsx\`, \`layers/geoOverlays/\`). Editing
this file by hand will just be overwritten the next time the generator
runs — edit \`geoEntities.ts\` instead and regenerate.

Every \`GeoEntity\` with a nonempty \`claimedBy\` or \`claims\` is listed here —
${disputed.length} entities total. Entities with no claim relationship at
all (the ~40 uncontroversial dependencies — Puerto Rico, Bermuda, and the
rest — plus the Cyprus Sovereign Base Areas, Baikonur, the Cyprus UN Buffer
Zone) are intentionally absent; this register is scoped to disputes, not
every registered entity.

Same sourcing caveat every dataset in \`data/registry/\` carries: simplified,
hand-curated entries for a demo globe, not a comprehensive or authoritative
reference. See \`CLAUDE.md\`'s "Geopolitical data architecture" section and
\`LOGBOOK.md\` for the judgment calls behind specific entries.

Regenerated: ${generatedAt}

---

## By disputed entity

${byEntityLines.join('\n')}
---

## By claimant

${byClaimantLines.join('\n')}
`

fs.writeFileSync(OUTPUT, doc)
console.log(`Wrote ${OUTPUT}: ${disputed.length} disputed entities, ${sortedClaimants.length} distinct claimants.`)
