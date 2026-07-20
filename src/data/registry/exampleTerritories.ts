// Illustrative example data for the Territory schema — NOT imported by
// index.ts, App.tsx, or anything else the running app loads. This module
// exists purely to prove the schema (specifically, the split between
// `controllingAuthorities` and `claimants` introduced in v2.1.2) holds up
// against real, genuinely complicated cases, and to give a concrete example
// for anyone reading types.ts.
//
// These three entries are simplified for schema demonstration. They are NOT
// an authoritative or complete accounting of any of these disputes, are not
// sourced from a maintained dataset, and should not be treated as this
// project's editorial position on any of them. Each includes multiple
// claimants and/or administrators specifically so that rendering this data
// later can show the dispute as a dispute, rather than picking a side by
// omission. If/when a real layer consumes territory data, it should pull
// from an actual maintained, citable source — not this file.
//
// To actually register these (e.g. for local testing), import this module
// once from somewhere: `import './exampleTerritories'` — importing it is
// what runs the registerTerritory() calls below, same as
// layers/placeholders/index.ts's role for layers. Nothing does that import
// yet, by design (see v2.1.2's "do not connect visualization yet").
import { registerTerritory } from './TerritoryRegistry'

registerTerritory({
  id: 'taiwan',
  name: 'Taiwan',
  aliases: ['Republic of China', 'Chinese Taipei'],
  // "disputed" states the fact of the dispute without characterizing which
  // side is correct — Taiwan governs itself independently in practice; the
  // dispute is over whether it is part of China or a separate sovereign
  // state.
  status: 'disputed',
  controllingAuthorities: [
    {
      // No `ref` — the Republic of China / Taiwan government is not itself
      // a registered Country in this dataset (it is not a UN member and
      // this project's country data is scoped to the 193 UN members — see
      // unMembers.ts), which is exactly the case `displayName` exists for.
      displayName: 'Government of the Republic of China (Taiwan)',
      since: '1949',
    },
  ],
  claimants: [
    {
      countryRef: { type: 'country', id: 'CHN' },
      displayName: "People's Republic of China",
      claimType: 'disputed-claim',
    },
  ],
  location: { lat: 23.7, lng: 121.0 },
  provenance: {
    confidence: 'estimated',
    source: 'Illustrative example for schema demonstration — not an authoritative dataset.',
  },
})

registerTerritory({
  id: 'crimea',
  name: 'Crimea',
  aliases: ['Autonomous Republic of Crimea', 'Republic of Crimea'],
  status: 'disputed',
  controllingAuthorities: [
    {
      ref: { type: 'country', id: 'RUS' },
      displayName: 'Russian Federation (de facto administration since 2014)',
      since: '2014',
    },
  ],
  claimants: [
    {
      countryRef: { type: 'country', id: 'UKR' },
      displayName: 'Ukraine',
      // Ukraine's sovereignty over Crimea is the position recognized by the
      // UN General Assembly and the overwhelming majority of states.
      claimType: 'recognized-sovereign',
    },
    {
      countryRef: { type: 'country', id: 'RUS' },
      displayName: 'Russian Federation',
      claimType: 'disputed-claim',
      since: '2014',
    },
  ],
  location: { lat: 45.3, lng: 34.4 },
  provenance: {
    confidence: 'estimated',
    source: 'Illustrative example for schema demonstration — not an authoritative dataset.',
  },
})

registerTerritory({
  id: 'western-sahara',
  name: 'Western Sahara',
  aliases: ['Sahrawi Arab Democratic Republic', 'SADR'],
  status: 'disputed',
  // Split control is the reason `controllingAuthorities` is a list, not a
  // single value — Morocco and the Polisario Front/SADR each administer
  // part of the territory, separated by a berm (defensive wall). `extent`
  // is deliberately vague prose, not a percentage, since even the rough
  // proportions are contested.
  controllingAuthorities: [
    {
      ref: { type: 'country', id: 'MAR' },
      displayName: 'Kingdom of Morocco',
      extent: 'most of the territory, west of the berm',
      since: '1975',
    },
    {
      displayName: 'Sahrawi Arab Democratic Republic (Polisario Front)',
      extent: 'a smaller portion east of the berm',
      since: '1976',
    },
  ],
  claimants: [
    {
      countryRef: { type: 'country', id: 'MAR' },
      displayName: 'Kingdom of Morocco',
      claimType: 'disputed-claim',
    },
    {
      displayName: 'Sahrawi Arab Democratic Republic (Polisario Front)',
      claimType: 'disputed-claim',
    },
  ],
  location: { lat: 24.5, lng: -13.0 },
  provenance: {
    confidence: 'estimated',
    source: 'Illustrative example for schema demonstration — not an authoritative dataset.',
  },
})
