// The real, always-loaded v3 entity dataset — replaces the pre-v3
// registry/territories.ts (4 entries) with the full six-classification set
// from the v3 spec: 4 GeopoliticalEntity, 39 Territory (the spec's 38 plus
// Gibraltar — see the note above that entry), 6 StrategicRegion, 4
// MaritimeFeature, 1 GeographicRegion, plus Crimea carried forward from the
// pre-v3 dataset (not in the v3 spec's list at all; kept so existing
// capability isn't silently dropped — see LOGBOOK.md's v3.0.0 entry).
//
// Imported once, as a side effect, from data/index.ts, so GeoEntityRegistry
// is already populated by the time any consumer (SearchBar, EntityResolver,
// the geoOverlays layers, ...) reads it — same guarantee registry/
// territories.ts provided pre-v3.
//
// Every entity here (except Crimea) has a real standalone polygon in
// world-atlas's 10m source data — see entities/entityGeometryIds.ts and
// scripts/buildEntityTopology.mjs. `location` is therefore left unset for
// all of them; SearchBar/GeoEntities.tsx derive centroid from the rendered
// geometry the same way Countries.tsx does, and only fall back to this
// record's `location` when no geometry exists (Crimea).
//
// Sourcing note, same caveat every dataset in this directory carries:
// simplified, hand-curated entries for a demo globe, not a comprehensive or
// authoritative reference — parent/administration/claim relationships
// reflect widely-reported facts as of this writing, not a sourced or
// continuously-updated feed.
import { registerEntity } from './GeoEntityRegistry'
import type { EntityRef, GeoEntity, GeoEntityRelation } from '../types'

const SIMPLIFIED_PROVENANCE = {
  confidence: 'estimated' as const,
  source: 'Simplified entry — not a comprehensive or authoritative dataset.',
}

// world-atlas's source topology (and therefore this app's Country Registry
// ids, and `selected.id` whenever a country is selected) keys countries by
// their raw ISO 3166-1 NUMERIC code, not the alpha-3 code ("840", not
// "USA") — scene/useCountryFeatures.ts registers each country using
// `String(feature.id)` straight off the topology, with no alpha-3 remapping
// anywhere in the pipeline (see scripts/buildCountryTopology.mjs). Every
// `toCountry()` call below is written with the human-readable alpha-3 code
// for the sake of anyone reading this file; this map is what makes that
// code actually resolve to the country a click/selection produces, instead
// of silently never matching `selected.id` (which is exactly what shipped
// initially — see LOGBOOK.md's v3.0.0 entry for the bug this was). Only
// entries this file actually references.
const ISO_ALPHA3_TO_NUMERIC: Record<string, string> = {
  USA: '840',
  CHN: '156',
  GBR: '826',
  FRA: '250',
  DNK: '208',
  MAR: '504',
  SRB: '688',
  NLD: '528',
  FIN: '246',
  AUS: '036',
  NZL: '554',
  IND: '356',
  PAK: '586',
  VNM: '704',
  PHL: '608',
  MYS: '458',
  BRN: '096',
  RUS: '643',
  UKR: '804',
  COL: '170',
  JAM: '388',
  NIC: '558',
  HND: '340',
  CUB: '192',
  ARG: '032',
  CHL: '152',
  NOR: '578',
}

function countryRef(alpha3: string): EntityRef {
  const numericId = ISO_ALPHA3_TO_NUMERIC[alpha3]
  if (!numericId) {
    throw new Error(
      `[geoEntities] no numeric id mapping for country code "${alpha3}" — add it to ISO_ALPHA3_TO_NUMERIC.`
    )
  }
  return { type: 'country', id: numericId }
}

function entityRef(id: string): EntityRef {
  return { type: 'geo-entity', id }
}

/** A relation pointing at a registered Country, e.g. a Territory's parentEntity. */
function toCountry(id: string, displayName: string, extra?: Partial<GeoEntityRelation>): GeoEntityRelation {
  return { ref: countryRef(id), displayName, ...extra }
}

/** A relation pointing at another registered GeoEntity, e.g. a MaritimeFeature claimed by Taiwan. */
function toEntity(id: string, displayName: string, extra?: Partial<GeoEntityRelation>): GeoEntityRelation {
  return { ref: entityRef(id), displayName, ...extra }
}

/** A relation with no resolvable registry record — a non-state actor or unrecognized government. */
function toUnregistered(displayName: string, extra?: Partial<GeoEntityRelation>): GeoEntityRelation {
  return { displayName, ...extra }
}

function register(entity: GeoEntity) {
  try {
    registerEntity(entity)
  } catch {
    // Already registered — harmless (Vite HMR re-running this module's
    // top-level code in dev after an edit elsewhere).
  }
}

// Uncontroversial dependency shorthand: the overwhelming majority of the
// Territory classification (see data/types.ts's GeoEntity doc comment) is
// exactly this shape — one parent, one administrator (the parent itself),
// no dispute. Written as a helper instead of ~39 near-identical literal
// objects; entries with anything more (a genuine dispute, a non-standard
// administrator) are still written out by hand below instead of forced
// through this helper.
function dependency(id: string, name: string, aliases: string[], parentIso: string, parentName: string): GeoEntity {
  return {
    id,
    name,
    aliases,
    type: 'territory',
    parentEntity: toCountry(parentIso, parentName),
    administeredBy: [toCountry(parentIso, parentName)],
    claimedBy: [],
    claims: [],
    provenance: SIMPLIFIED_PROVENANCE,
  }
}

// ---------------------------------------------------------------------------
// 1. GeopoliticalEntity — primary selectable entities with international
//    political significance, alongside sovereign states.
// ---------------------------------------------------------------------------

register({
  id: 'taiwan',
  name: 'Taiwan',
  aliases: ['Republic of China', 'Chinese Taipei'],
  type: 'geopolitical-entity',
  administeredBy: [toUnregistered('Government of the Republic of China (Taiwan)', { since: '1949' })],
  claimedBy: [toCountry('CHN', "People's Republic of China")],
  claims: [],
  provenance: SIMPLIFIED_PROVENANCE,
})

register({
  id: 'palestine',
  name: 'Palestine',
  aliases: ['State of Palestine', 'Palestinian Territories'],
  type: 'geopolitical-entity',
  administeredBy: [
    toUnregistered('Palestinian Authority', { extent: 'parts of the West Bank and Gaza' }),
  ],
  claimedBy: [],
  claims: [],
  provenance: SIMPLIFIED_PROVENANCE,
})

register({
  id: 'kosovo',
  name: 'Kosovo',
  aliases: ['Republic of Kosovo'],
  type: 'geopolitical-entity',
  administeredBy: [toUnregistered('Government of the Republic of Kosovo', { since: '2008' })],
  claimedBy: [toCountry('SRB', 'Republic of Serbia')],
  claims: [],
  provenance: SIMPLIFIED_PROVENANCE,
})

register({
  id: 'western-sahara',
  name: 'Western Sahara',
  aliases: ['Sahrawi Arab Democratic Republic', 'SADR'],
  type: 'geopolitical-entity',
  administeredBy: [
    toCountry('MAR', 'Kingdom of Morocco', { extent: 'most of the territory, west of the berm', since: '1975' }),
    toUnregistered('Sahrawi Arab Democratic Republic (Polisario Front)', {
      extent: 'a smaller portion east of the berm',
      since: '1976',
    }),
  ],
  claimedBy: [
    toCountry('MAR', 'Kingdom of Morocco'),
    toUnregistered('Sahrawi Arab Democratic Republic (Polisario Front)'),
  ],
  claims: [],
  provenance: SIMPLIFIED_PROVENANCE,
})

// ---------------------------------------------------------------------------
// 2. Territory — dependent territories, autonomous regions, crown
//    dependencies, overseas territories, special administrative regions.
//    Every entry has a known, uncontested parent, so `dependency()` covers
//    all of them uniformly.
//
//    Gibraltar is not in the v3 spec's explicit Territory list, but the
//    spec's Known Relationships section gives it a parentEntity (United
//    Kingdom) anyway — added here on the assumption that omission from the
//    list was an oversight, not a deliberate exclusion. Flagged for
//    confirmation; trivial to remove if that assumption is wrong.
// ---------------------------------------------------------------------------

register(dependency('puerto-rico', 'Puerto Rico', ['Commonwealth of Puerto Rico'], 'USA', 'United States of America'))
register(dependency('greenland', 'Greenland', ['Kalaallit Nunaat'], 'DNK', 'Kingdom of Denmark'))
register(dependency('hong-kong', 'Hong Kong', ['Hong Kong SAR'], 'CHN', "People's Republic of China"))
register(dependency('macao', 'Macao', ['Macao SAR', 'Macau'], 'CHN', "People's Republic of China"))
register(dependency('new-caledonia', 'New Caledonia', [], 'FRA', 'French Republic'))
register(dependency('curacao', 'Curaçao', [], 'NLD', 'Kingdom of the Netherlands'))
register(dependency('aruba', 'Aruba', [], 'NLD', 'Kingdom of the Netherlands'))
register(dependency('turks-and-caicos-islands', 'Turks and Caicos Islands', [], 'GBR', 'United Kingdom'))
register(dependency('saint-martin', 'Saint Martin', [], 'FRA', 'French Republic'))
register(dependency('sint-maarten', 'Sint Maarten', [], 'NLD', 'Kingdom of the Netherlands'))
register(dependency('saint-pierre-and-miquelon', 'Saint Pierre and Miquelon', [], 'FRA', 'French Republic'))
register(dependency('pitcairn-islands', 'Pitcairn Islands', [], 'GBR', 'United Kingdom'))
register(dependency('french-polynesia', 'French Polynesia', [], 'FRA', 'French Republic'))
register(
  dependency('french-southern-and-antarctic-lands', 'French Southern and Antarctic Lands', ['TAAF'], 'FRA', 'French Republic'),
)
register(dependency('us-minor-outlying-islands', 'U.S. Minor Outlying Islands', [], 'USA', 'United States of America'))
register(dependency('montserrat', 'Montserrat', [], 'GBR', 'United Kingdom'))
register(dependency('us-virgin-islands', 'U.S. Virgin Islands', [], 'USA', 'United States of America'))
register(dependency('saint-barthelemy', 'Saint Barthélemy', [], 'FRA', 'French Republic'))
register(dependency('anguilla', 'Anguilla', [], 'GBR', 'United Kingdom'))
register(dependency('british-virgin-islands', 'British Virgin Islands', [], 'GBR', 'United Kingdom'))
register(dependency('cayman-islands', 'Cayman Islands', [], 'GBR', 'United Kingdom'))
register(dependency('bermuda', 'Bermuda', [], 'GBR', 'United Kingdom'))
register(dependency('saint-helena', 'Saint Helena', ['Saint Helena, Ascension and Tristan da Cunha'], 'GBR', 'United Kingdom'))
register(dependency('jersey', 'Jersey', ['Bailiwick of Jersey'], 'GBR', 'United Kingdom'))
register(dependency('guernsey', 'Guernsey', ['Bailiwick of Guernsey'], 'GBR', 'United Kingdom'))
register(dependency('isle-of-man', 'Isle of Man', [], 'GBR', 'United Kingdom'))
register(dependency('aland', 'Åland', ['Åland Islands'], 'FIN', 'Republic of Finland'))
register(dependency('faroe-islands', 'Faroe Islands', [], 'DNK', 'Kingdom of Denmark'))
register(dependency('british-indian-ocean-territory', 'British Indian Ocean Territory', [], 'GBR', 'United Kingdom'))
register(dependency('norfolk-island', 'Norfolk Island', [], 'AUS', 'Commonwealth of Australia'))
register(dependency('cook-islands', 'Cook Islands', [], 'NZL', 'New Zealand'))
register(dependency('wallis-and-futuna', 'Wallis and Futuna Islands', [], 'FRA', 'French Republic'))
register(
  dependency('south-georgia-and-south-sandwich-islands', 'South Georgia and South Sandwich Islands', [], 'GBR', 'United Kingdom'),
)
register(dependency('falkland-islands', 'Falkland Islands', ['Islas Malvinas'], 'GBR', 'United Kingdom'))
register(dependency('niue', 'Niue', [], 'NZL', 'New Zealand'))
register(dependency('american-samoa', 'American Samoa', [], 'USA', 'United States of America'))
register(dependency('guam', 'Guam', [], 'USA', 'United States of America'))
register(dependency('northern-mariana-islands', 'Northern Mariana Islands', [], 'USA', 'United States of America'))
register(
  dependency('heard-island-and-mcdonald-islands', 'Heard Island and McDonald Islands', [], 'AUS', 'Commonwealth of Australia'),
)
register(dependency('gibraltar', 'Gibraltar', [], 'GBR', 'United Kingdom'))

// ---------------------------------------------------------------------------
// 3. StrategicRegion — military, intelligence, or strategic significance.
//    Not treated as countries or territories: no parentEntity field is set
//    even where a sovereign owns the land (Dhekelia/Akrotiri), since the
//    defining fact about these places is the base/installation, not
//    dependency status.
// ---------------------------------------------------------------------------

register({
  id: 'dhekelia',
  name: 'Dhekelia',
  aliases: ['Dhekelia Sovereign Base Area', 'Dhekelia Cantonment'],
  type: 'strategic-region',
  administeredBy: [toCountry('GBR', 'United Kingdom (Sovereign Base Area)', { since: '1960' })],
  claimedBy: [],
  claims: [],
  metadata: {
    strategicSignificance:
      'One of two UK Sovereign Base Areas on Cyprus, retained under the 1960 Cyprus independence treaty; garrisons British Forces Cyprus.',
    tags: ['military-base', 'sovereign-base-area'],
  },
  provenance: SIMPLIFIED_PROVENANCE,
})

register({
  id: 'akrotiri',
  name: 'Akrotiri',
  aliases: ['Akrotiri Sovereign Base Area'],
  type: 'strategic-region',
  administeredBy: [toCountry('GBR', 'United Kingdom (Sovereign Base Area)', { since: '1960' })],
  claimedBy: [],
  claims: [],
  metadata: {
    strategicSignificance:
      'One of two UK Sovereign Base Areas on Cyprus; home to RAF Akrotiri, a key UK/NATO airbase for the Eastern Mediterranean.',
    tags: ['military-base', 'sovereign-base-area'],
  },
  provenance: SIMPLIFIED_PROVENANCE,
})

register({
  id: 'guantanamo-bay',
  name: 'US Naval Base Guantanamo Bay',
  aliases: ['Guantanamo Bay Naval Base', 'GTMO'],
  type: 'strategic-region',
  administeredBy: [toCountry('USA', 'United States (naval base, under an indefinite lease)', { since: '1903' })],
  claimedBy: [toCountry('CUB', 'Republic of Cuba (disputes the lease’s continued legitimacy)')],
  claims: [],
  metadata: {
    strategicSignificance: 'US naval base leased from Cuba since 1903; sovereignty over the land remains Cuban under the lease treaty.',
    tags: ['military-base', 'naval-base'],
  },
  provenance: SIMPLIFIED_PROVENANCE,
})

register({
  id: 'baikonur',
  name: 'Baikonur',
  aliases: ['Baikonur Cosmodrome'],
  type: 'strategic-region',
  administeredBy: [toCountry('RUS', 'Russian Federation (leased spaceport complex)', { since: '1994' })],
  claimedBy: [],
  claims: [],
  metadata: {
    strategicSignificance:
      "Leased by Russia from Kazakhstan through 2050 for the Baikonur Cosmodrome — sovereignty remains Kazakhstan's; Russia administers the leased complex.",
    tags: ['spaceport', 'strategic-lease'],
  },
  provenance: SIMPLIFIED_PROVENANCE,
})

register({
  id: 'cyprus-buffer-zone',
  name: 'Cyprus UN Buffer Zone',
  aliases: ['Green Line', 'United Nations Buffer Zone in Cyprus'],
  type: 'strategic-region',
  administeredBy: [toUnregistered('United Nations Peacekeeping Force in Cyprus (UNFICYP)', { since: '1974' })],
  claimedBy: [],
  claims: [],
  metadata: {
    strategicSignificance: 'UN-patrolled buffer zone separating the Republic of Cyprus from the area administered as Northern Cyprus.',
    tags: ['peacekeeping', 'buffer-zone'],
  },
  provenance: SIMPLIFIED_PROVENANCE,
})

register({
  id: 'siachen-glacier',
  name: 'Siachen Glacier',
  aliases: [],
  type: 'strategic-region',
  administeredBy: [toCountry('IND', 'Republic of India (controls most of the glacier)')],
  claimedBy: [toCountry('IND', 'Republic of India'), toCountry('PAK', 'Islamic Republic of Pakistan')],
  claims: [],
  metadata: {
    strategicSignificance: "World's highest militarized zone; contested since 1984 along an undemarcated section of the India-Pakistan Line of Control.",
    tags: ['military-conflict-zone', 'high-altitude'],
  },
  provenance: SIMPLIFIED_PROVENANCE,
})

// ---------------------------------------------------------------------------
// 4. MaritimeFeature — disputed maritime areas and geographic features.
//    Deliberately no `administeredBy` entries where no single party
//    exercises uncontested day-to-day control — see GeographicEntity's
//    "supports multiple sovereignty claims... does not require sovereign
//    ownership" behavior in the v3 spec.
// ---------------------------------------------------------------------------

register({
  id: 'spratly-islands',
  name: 'Spratly Islands',
  aliases: [],
  type: 'maritime-feature',
  administeredBy: [],
  claimedBy: [
    toCountry('CHN', "People's Republic of China"),
    toCountry('VNM', 'Socialist Republic of Vietnam'),
    toCountry('PHL', 'Republic of the Philippines'),
    toCountry('MYS', 'Malaysia'),
    toCountry('BRN', 'Brunei Darussalam'),
    toEntity('taiwan', 'Taiwan'),
  ],
  claims: [],
  metadata: { tags: ['south-china-sea', 'disputed-maritime'] },
  provenance: SIMPLIFIED_PROVENANCE,
})

register({
  id: 'scarborough-reef',
  name: 'Scarborough Reef',
  aliases: ['Bajo de Masinloc', 'Huangyan Island'],
  type: 'maritime-feature',
  administeredBy: [],
  claimedBy: [
    toCountry('CHN', "People's Republic of China"),
    toCountry('PHL', 'Republic of the Philippines'),
    toEntity('taiwan', 'Taiwan'),
  ],
  claims: [],
  metadata: { tags: ['south-china-sea', 'disputed-maritime'] },
  provenance: SIMPLIFIED_PROVENANCE,
})

register({
  id: 'bajo-nuevo-bank',
  name: 'Bajo Nuevo Bank',
  aliases: ['Petrel Islands'],
  type: 'maritime-feature',
  administeredBy: [toCountry('COL', 'Republic of Colombia')],
  claimedBy: [
    toCountry('COL', 'Republic of Colombia'),
    toCountry('JAM', 'Jamaica'),
    toCountry('NIC', 'Republic of Nicaragua'),
  ],
  claims: [],
  metadata: { tags: ['caribbean-sea', 'disputed-maritime'] },
  provenance: SIMPLIFIED_PROVENANCE,
})

register({
  id: 'serranilla-bank',
  name: 'Serranilla Bank',
  aliases: [],
  type: 'maritime-feature',
  administeredBy: [toCountry('COL', 'Republic of Colombia')],
  claimedBy: [
    toCountry('COL', 'Republic of Colombia'),
    toCountry('HND', 'Republic of Honduras'),
    toCountry('NIC', 'Republic of Nicaragua'),
  ],
  claims: [],
  metadata: { tags: ['caribbean-sea', 'disputed-maritime'] },
  provenance: SIMPLIFIED_PROVENANCE,
})

// ---------------------------------------------------------------------------
// 5. GeographicRegion — treaty/territorial claim metadata, not sovereign
//    territory.
// ---------------------------------------------------------------------------

register({
  id: 'antarctica',
  name: 'Antarctica',
  aliases: [],
  type: 'geographic-region',
  administeredBy: [],
  claimedBy: [
    toCountry('ARG', 'Argentine Republic (claim suspended under the Antarctic Treaty)'),
    toCountry('AUS', 'Commonwealth of Australia (claim suspended under the Antarctic Treaty)'),
    toCountry('CHL', 'Republic of Chile (claim suspended under the Antarctic Treaty)'),
    toCountry('FRA', 'French Republic (claim suspended under the Antarctic Treaty)'),
    toCountry('NZL', 'New Zealand (claim suspended under the Antarctic Treaty)'),
    toCountry('NOR', 'Kingdom of Norway (claim suspended under the Antarctic Treaty)'),
    toCountry('GBR', 'United Kingdom (claim suspended under the Antarctic Treaty)'),
  ],
  claims: [],
  metadata: {
    treatyFramework:
      'Antarctic Treaty System (1959) — suspends (without resolving) territorial claims south of 60°S and reserves the continent for peaceful, scientific use.',
    tags: ['treaty-governed', 'scientific-research'],
  },
  provenance: SIMPLIFIED_PROVENANCE,
})

// ---------------------------------------------------------------------------
// Carried forward from the pre-v3 dataset, not part of the v3 spec's entity
// list: Crimea has no standalone polygon anywhere in the source data (it's
// geometrically part of Ukraine's — see entities/entityGeometryIds.ts), so
// unlike everything above it keeps an explicit `location` for search/camera
// fly and stays reachable only via search or the dev console helper, exactly
// as it was pre-v3. Classified as 'territory' for lack of a better fit among
// the five v3 classifications — see LOGBOOK.md's v3.0.0 entry.
// ---------------------------------------------------------------------------

register({
  id: 'crimea',
  name: 'Crimea',
  aliases: ['Autonomous Republic of Crimea', 'Republic of Crimea'],
  type: 'territory',
  administeredBy: [toCountry('RUS', 'Russian Federation (de facto administration since 2014)', { since: '2014' })],
  claimedBy: [toCountry('UKR', 'Ukraine'), toCountry('RUS', 'Russian Federation', { since: '2014' })],
  claims: [],
  location: { lat: 45.3, lng: 34.4 },
  provenance: SIMPLIFIED_PROVENANCE,
})
