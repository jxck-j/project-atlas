// The real, always-loaded territory dataset — distinct from
// exampleTerritories.ts, which stays deliberately unimported (see that
// file's own comment for why). This module is imported once, as a side
// effect, from data/index.ts, so TerritoryRegistry is already populated by
// the time any consumer (SearchBar, EntityResolver, ...) reads it — the
// same "importing the barrel guarantees registration" guarantee
// layers/index.ts already provides for the Layer Engine.
//
// Kept intentionally small and reuses the same careful, non-partisan
// framing exampleTerritories.ts established for the schema (see LOGBOOK.md
// for why that framing matters) — building a genuinely comprehensive,
// well-sourced territory dataset is separate future work for a Data Engine
// (see CLAUDE.md's engine list). This exists so search has real Territory
// entries to actually return.
import { registerTerritory } from './TerritoryRegistry'

try {
  registerTerritory({
    id: 'taiwan',
    name: 'Taiwan',
    aliases: ['Republic of China', 'Chinese Taipei'],
    status: 'disputed',
    controllingAuthorities: [
      {
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
      source: 'Simplified entry — not a comprehensive or authoritative dataset.',
    },
  })
} catch {
  // Already registered — harmless (Vite HMR re-running this module's
  // top-level code in dev after an edit elsewhere).
}

try {
  registerTerritory({
    id: 'puerto-rico',
    name: 'Puerto Rico',
    aliases: ['Commonwealth of Puerto Rico', 'Estado Libre Asociado de Puerto Rico'],
    // Unlike the other three entries here, Puerto Rico's status isn't
    // contested — it's an uncontroversial, formally recognized dependency,
    // which is exactly the case `parentCountryId` exists for (see
    // data/types.ts's Territory doc comment).
    status: 'dependency',
    controllingAuthorities: [
      {
        ref: { type: 'country', id: 'USA' },
        displayName: 'United States of America',
        since: '1898',
      },
    ],
    claimants: [],
    parentCountryId: 'USA',
    location: { lat: 18.2208, lng: -66.5901 },
    provenance: {
      confidence: 'confirmed',
      source: 'Simplified entry — not a comprehensive or authoritative dataset.',
    },
  })
} catch {
  // Already registered — harmless (Vite HMR re-running this module's
  // top-level code in dev after an edit elsewhere).
}

try {
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
      source: 'Simplified entry — not a comprehensive or authoritative dataset.',
    },
  })
} catch {
  // Already registered — harmless (Vite HMR re-running this module's
  // top-level code in dev after an edit elsewhere).
}

try {
  registerTerritory({
    id: 'western-sahara',
    name: 'Western Sahara',
    aliases: ['Sahrawi Arab Democratic Republic', 'SADR'],
    status: 'disputed',
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
      source: 'Simplified entry — not a comprehensive or authoritative dataset.',
    },
  })
} catch {
  // Already registered — harmless (Vite HMR re-running this module's
  // top-level code in dev after an edit elsewhere).
}
