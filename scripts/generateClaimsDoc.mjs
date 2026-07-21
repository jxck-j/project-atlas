// Generates CLAIMS.md — a complete roster of all 193 UN member states and
// every registered GeoEntity, with each one's claim relationships (or
// "None") — from the live GeoEntityRegistry plus the built country
// topology. Nothing here is hand-typed: countries come from
// public/geo/countries-un193.json (the exact file scene/useCountryFeatures.ts
// fetches at runtime — same names/ids the app itself uses, not a second,
// possibly-drifted copy), and GeoEntities come from data/registry/
// geoEntities.ts via GeoEntityRegistry. Run with `npm run docs:claims`
// whenever geoEntities.ts changes or countries-un193.json is regenerated;
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
import { feature } from 'topojson-client'
import '../src/data/registry/geoEntities.ts'
import { getEntities } from '../src/data/registry/GeoEntityRegistry.ts'

const OUTPUT = 'CLAIMS.md'
const COUNTRIES_TOPOLOGY = 'public/geo/countries-un193.json'

const TYPE_LABEL = {
  'geopolitical-entity': 'Geopolitical Entity',
  territory: 'Territory',
  'strategic-region': 'Strategic Region',
  'maritime-feature': 'Maritime Feature',
  'geographic-region': 'Geographic Region',
}

// ---------------------------------------------------------------------------
// Source data
// ---------------------------------------------------------------------------

const countryTopology = JSON.parse(fs.readFileSync(COUNTRIES_TOPOLOGY, 'utf8'))
const countries = feature(countryTopology, countryTopology.objects.countries).features
  .map((f) => ({ id: String(f.id), name: f.properties?.name ?? 'Unknown' }))
  .sort((a, b) => a.name.localeCompare(b.name))

const entities = getEntities().slice().sort((a, b) => a.name.localeCompare(b.name))

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function formatRelation(relation) {
  return relation.since ? `${relation.displayName} (since ${relation.since})` : relation.displayName
}

// `claimedBy` and `claims` are meant to be the same fact recorded from two
// ends (see data/types.ts's GeoEntityRelation doc comment: "X.claimedBy
// contains Y" and "Y.claims contains X" both say "Y claims X") — but this
// dataset only ever populates the `claimedBy` side in practice (every
// GeoEntity's `claims` array is currently empty; see LOGBOOK.md's v3.0.0
// entry, which flagged `claims` as forward-compatible infrastructure, not
// yet exercised). Reading `entity.claims` alone would therefore silently
// show "Claims: None" for Taiwan even though Spratly Islands/Scarborough
// Reef both explicitly list Taiwan in *their* `claimedBy` — the same fact,
// just recorded on the other entity. This index inverts every `claimedBy`
// relation with a ref (country or GeoEntity) into "what does the claimant
// claim," so each entity's effective "Claims" list is complete regardless
// of which side of the pair a future data edit happens to populate.
const inferredClaimsByKey = new Map() // "country:<id>" | "geo-entity:<id>" -> [{ name, type }]
for (const entity of entities) {
  for (const relation of entity.claimedBy) {
    if (!relation.ref) continue
    const key = `${relation.ref.type}:${relation.ref.id}`
    const list = inferredClaimsByKey.get(key) ?? []
    list.push({ name: entity.name, type: entity.type })
    inferredClaimsByKey.set(key, list)
  }
}

/** Everything a GeoEntity claims: its own explicit `claims` list, plus anything inferred above, deduped by name. Countries have no explicit `claims` field of their own — see claimsByCountryId below, which is just the country-keyed slice of the same inferred index. */
function claimsOf(entity) {
  const explicit = entity.claims.map((r) => ({ name: r.displayName, type: undefined, relation: r }))
  const inferred = inferredClaimsByKey.get(`geo-entity:${entity.id}`) ?? []
  const seen = new Set()
  const combined = []
  for (const item of [...explicit, ...inferred]) {
    if (seen.has(item.name)) continue
    seen.add(item.name)
    combined.push(item)
  }
  return combined
}

function formatClaimsList(list) {
  return list
    .map((item) => (item.relation ? formatRelation(item.relation) : `${item.name} (${TYPE_LABEL[item.type]})`))
    .join('; ')
}

// The "All UN Member States" section's per-country "Claims" answer — just
// the country-keyed slice of inferredClaimsByKey, since a Country record
// never carries an explicit `claims` field to union with (see data/types.ts).
function claimsByCountryId(id) {
  return inferredClaimsByKey.get(`country:${id}`) ?? []
}

// ---------------------------------------------------------------------------
// Section: summary of active disputes — the concise, quick-reference
// version (only entities with a nonempty claimedBy/claims), kept alongside
// the full rosters below rather than replaced by them.
// ---------------------------------------------------------------------------
const disputed = entities.filter((e) => e.claimedBy.length > 0 || claimsOf(e).length > 0)

const summaryLines = []
for (const entity of disputed) {
  summaryLines.push(`### ${entity.name} (${TYPE_LABEL[entity.type]})`)
  summaryLines.push('')
  if (entity.claimedBy.length > 0) {
    summaryLines.push(`- **Claimed by:** ${entity.claimedBy.map(formatRelation).join('; ')}`)
  }
  const claims = claimsOf(entity)
  if (claims.length > 0) {
    summaryLines.push(`- **Claims:** ${formatClaimsList(claims)}`)
  }
  summaryLines.push('')
}

// ---------------------------------------------------------------------------
// Section: all 193 UN member states — every one, not just claimants.
// ---------------------------------------------------------------------------
const countryLines = []
for (const country of countries) {
  const claims = claimsByCountryId(country.id)
  countryLines.push(`### ${country.name}`)
  countryLines.push('')
  countryLines.push(claims.length > 0 ? `- **Claims:** ${formatClaimsList(claims)}` : '- **Claims:** None')
  countryLines.push('')
}

// ---------------------------------------------------------------------------
// Section: all registered GeoEntities — every one, not just disputed ones.
// ---------------------------------------------------------------------------
const entityLines = []
for (const entity of entities) {
  entityLines.push(`### ${entity.name} (${TYPE_LABEL[entity.type]})`)
  entityLines.push('')
  entityLines.push(`- **Parent Entity:** ${entity.parentEntity ? formatRelation(entity.parentEntity) : 'None'}`)
  entityLines.push(
    `- **Administered By:** ${entity.administeredBy.length > 0 ? entity.administeredBy.map(formatRelation).join('; ') : 'None'}`
  )
  entityLines.push(
    `- **Claimed By:** ${entity.claimedBy.length > 0 ? entity.claimedBy.map(formatRelation).join('; ') : 'None'}`
  )
  const claims = claimsOf(entity)
  entityLines.push(`- **Claims:** ${claims.length > 0 ? formatClaimsList(claims) : 'None'}`)
  entityLines.push('')
}

const generatedAt = new Date().toISOString().slice(0, 10)

const doc = `# Claims & Relationships Register

**Generated file — do not hand-edit.** Produced by \`npm run docs:claims\`
(\`scripts/generateClaimsDoc.mjs\`) from two sources: \`public/geo/
countries-un193.json\` (the exact topology \`scene/useCountryFeatures.ts\`
fetches at runtime — same 193 names/ids the app itself uses) and
\`data/registry/geoEntities.ts\` via \`GeoEntityRegistry\` (the same registry
\`EntityResolver\`, \`scene/GeoEntities.tsx\`, and \`layers/geoOverlays/\` read
at runtime). Editing this file by hand will just be overwritten the next
time the generator runs — edit \`geoEntities.ts\` instead and regenerate.

Covers every UN member state (${countries.length}) and every registered
GeoEntity (${entities.length}) — ${countries.length + entities.length}
total — not just the ones with an active dispute.

Same sourcing caveat every dataset in \`data/registry/\` carries: simplified,
hand-curated entries for a demo globe, not a comprehensive or authoritative
reference. See \`CLAUDE.md\`'s "Geopolitical data architecture" section and
\`LOGBOOK.md\` for the judgment calls behind specific entries. Note also that
a \`Country\` record has no \`claims\`/\`claimedBy\` field of its own (see
\`data/types.ts\`) — every claim relationship in this app is modeled from the
GeoEntity side, so a country's "Claims" entry below is always derived by
scanning GeoEntity \`claimedBy\` fields for a reference back to it, never a
country stating a claim directly.

Regenerated: ${generatedAt}

---

## Summary: active disputes (${disputed.length})

Quick reference — only entities with a nonempty \`claimedBy\`/\`claims\`. See
the full rosters below for everything else, including the ${entities.length - disputed.length} GeoEntities and effectively all 193 countries with no dispute at all.

${summaryLines.join('\n')}
---

## All UN Member States (${countries.length})

${countryLines.join('\n')}
---

## All Registered GeoEntities (${entities.length})

${entityLines.join('\n')}
`

fs.writeFileSync(OUTPUT, doc)
console.log(
  `Wrote ${OUTPUT}: ${countries.length} countries, ${entities.length} GeoEntities (${disputed.length} disputed).`
)
