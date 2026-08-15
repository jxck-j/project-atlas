// Hand-curated, unlike countryEconomics.ts's build-script-generated output —
// there's no single API for "which economic/security blocs is this country
// in," so each organization's OWN official membership page (never Wikipedia
// or an aggregator) was checked by hand on the snapshotDate recorded per
// entry below. This is categorical data (a country either belongs or
// doesn't), not a metric — it deliberately does NOT feed IntelRow's 0-100
// scored bars in hud/IntelligencePanel.tsx (see that file's own comment on
// why no score exists), and gets its own badge/tag UI instead.
//
// `memberCountryCodes` holds real ISO 3166-1 alpha-3 codes — verifiable
// against each org's own site independent of this app — not this app's own
// country-name keys. hud/IntelligencePanel.tsx joins them against a
// selected country via countryIso3.ts's COUNTRY_NAME_TO_ISO3 at render time
// (filtering ALLIANCES, not a second per-country list) — see that file's
// header for why `countryProfiles.ts` itself couldn't be reused as the key
// space (it's keyed by name, not any code, and Country.id is a topology
// numeric id at runtime despite its doc comment's ISO alpha-3 claim).
//
// EXCLUDED — deliberately, not an oversight: ANZUS (the US-NZ leg has been
// suspended since 1985 over New Zealand's nuclear-free policy — the pact
// nominally still exists but doesn't function as a live three-way alliance),
// SAARC (paralyzed since its 2016 summit was cancelled amid India-Pakistan
// tensions and never resumed normal functioning), CSTO (collective-defense
// credibility undermined by non-intervention in the 2021 Kazakhstan unrest
// and the 2022 Armenia-Azerbaijan clashes involving member Armenia), and the
// Arab League (a track record of member states not acting on its own
// resolutions). All four were reviewed and rejected as dormant/functionally
// inert rather than simply not considered.
//
// Scope is fixed at these 18 — the Trade category (USMCA/CPTPP/RCEP/AfCFTA)
// was considered and explicitly dropped, not merely deferred.
export const ALLIANCE_MEMBERSHIP_SNAPSHOT_DATE = '2026-08-14'

export type AllianceType = 'security' | 'economic' | 'political-forum' | 'trade'

export interface Alliance {
  id: string
  name: string
  abbreviation: string
  /**
   * A necessary simplification — several of these orgs genuinely blend
   * security, economic, and political-coordination functions (SCO, GCC,
   * ASEAN, AU, BRICS especially) and a single type can't capture that; each
   * was assigned its most institutionally central function (e.g. GCC's
   * customs union over its smaller Peninsula Shield security role).
   */
  type: AllianceType
  memberCountryCodes: string[]
  snapshotDate: string
  sourceUrl: string
  /** Optional caveat, e.g. for newly formed or contested-membership orgs. */
  annotations?: string
}

export const ALLIANCES: Alliance[] = [
  // --- Security ---------------------------------------------------------
  {
    id: 'nato',
    name: 'North Atlantic Treaty Organization',
    abbreviation: 'NATO',
    type: 'security',
    memberCountryCodes: [
      'ALB', 'BEL', 'BGR', 'CAN', 'HRV', 'CZE', 'DNK', 'EST', 'FIN', 'FRA',
      'DEU', 'GRC', 'HUN', 'ISL', 'ITA', 'LVA', 'LTU', 'LUX', 'MNE', 'NLD',
      'MKD', 'NOR', 'POL', 'PRT', 'ROU', 'SVK', 'SVN', 'ESP', 'SWE', 'TUR',
      'GBR', 'USA',
    ],
    snapshotDate: '2026-08-14',
    sourceUrl: 'https://www.nato.int/cps/en/natohq/nato_countries.htm',
  },
  {
    id: 'aukus',
    name: 'Australia-United Kingdom-United States Security Partnership',
    abbreviation: 'AUKUS',
    type: 'security',
    memberCountryCodes: ['AUS', 'GBR', 'USA'],
    snapshotDate: '2026-08-14',
    sourceUrl: 'https://www.dfat.gov.au/aukus',
    annotations:
      'A fixed trilateral pact, not a membership organization with an accession process or a single canonical members page — Australia\'s own government AUKUS page is cited as the most authoritative single source among the three partners\' own sites.',
  },
  {
    id: 'quad',
    name: 'Quadrilateral Security Dialogue',
    abbreviation: 'Quad',
    type: 'security',
    memberCountryCodes: ['USA', 'AUS', 'JPN', 'IND'],
    snapshotDate: '2026-08-14',
    sourceUrl: 'https://www.state.gov/the-quad/',
    annotations:
      'Like AUKUS, a fixed four-country dialogue with no accession process or single official membership page — the U.S. State Department\'s own Quad page is cited as the source.',
  },
  {
    id: 'sco',
    name: 'Shanghai Cooperation Organisation',
    abbreviation: 'SCO',
    type: 'security',
    memberCountryCodes: ['CHN', 'RUS', 'IND', 'PAK', 'KAZ', 'KGZ', 'TJK', 'UZB', 'IRN', 'BLR'],
    snapshotDate: '2026-08-14',
    sourceUrl: 'https://eng.sectsco.org/20170109/192193.html',
    annotations:
      'Full members only — Afghanistan/Mongolia (observer status) and the 17-country "SCO Partners" tier (a 2025-summit merger of the former separate observer/dialogue-partner categories) are deliberately excluded.',
  },
  {
    id: 'mecca-joint-defence-agreement',
    name: 'Mecca Joint Defence Agreement',
    abbreviation: 'Mecca Pact',
    type: 'security',
    memberCountryCodes: ['SAU', 'PAK', 'TUR'],
    snapshotDate: '2026-08-07',
    sourceUrl: 'https://www.spa.gov.sa/en/N2649227',
    annotations:
      'Newly formed — signed 2026-08-07 at the Makkah Al-Mukarramah Summit for Joint Defence (Saudi Arabia, Pakistan, Türkiye; an armed attack on one is treated as an attack on all). Scope and durability are still being assessed by regional analysts; treat this entry as provisional pending how the pact is actually exercised.',
  },

  // --- Economic/political -------------------------------------------------
  {
    id: 'g7',
    name: 'Group of Seven',
    abbreviation: 'G7',
    type: 'political-forum',
    memberCountryCodes: ['CAN', 'FRA', 'DEU', 'ITA', 'JPN', 'GBR', 'USA'],
    snapshotDate: '2026-08-14',
    sourceUrl: 'https://www.diplomatie.gouv.fr/en/priorites-et-actions/grands-dossiers/la-presidence-francaise-du-g7-2026',
    annotations: 'The EU also attends every summit as a non-enumerated participant but isn\'t counted among the seven and isn\'t a country, so it\'s not in memberCountryCodes.',
  },
  {
    id: 'g20',
    name: 'Group of Twenty',
    abbreviation: 'G20',
    type: 'political-forum',
    memberCountryCodes: [
      'ARG', 'AUS', 'BRA', 'CAN', 'CHN', 'FRA', 'DEU', 'IND', 'IDN', 'ITA',
      'JPN', 'KOR', 'MEX', 'RUS', 'SAU', 'ZAF', 'TUR', 'GBR', 'USA',
    ],
    snapshotDate: '2026-08-14',
    sourceUrl: 'https://www.g20.org/',
    annotations: 'The European Union and African Union are also institutional G20 members (19 countries + 2 regional bodies) but aren\'t countries, so they\'re not in memberCountryCodes.',
  },
  {
    id: 'brics',
    name: 'BRICS',
    abbreviation: 'BRICS',
    type: 'political-forum',
    memberCountryCodes: ['BRA', 'RUS', 'IND', 'CHN', 'ZAF', 'EGY', 'ETH', 'IRN', 'IDN', 'ARE', 'SAU'],
    snapshotDate: '2026-08-14',
    sourceUrl: 'https://www.brics2026.gov.in/about-us/',
    annotations:
      'Membership has expanded and is actively contested — original five (Brazil, Russia, India, China, South Africa) plus Egypt/Ethiopia/Iran/UAE (full members since 2024-01-01), Indonesia (joined 2025), and Saudi Arabia (accepted the standing invitation and completed accession in 2025-07 after an extended hedge — as of mid-2026 it continues balancing this against its U.S. relationship). Direct fetch of the cited 2026 chair-country site returned HTTP 403; this list is cross-verified through independent reporting on that site rather than a direct read of it. Also excludes ~10 lesser "partner countries" (Belarus, Nigeria, Kazakhstan, ...) that BRICS itself distinguishes from full membership.',
  },
  {
    id: 'oecd',
    name: 'Organisation for Economic Co-operation and Development',
    abbreviation: 'OECD',
    type: 'economic',
    memberCountryCodes: [
      'AUS', 'AUT', 'BEL', 'CAN', 'CHL', 'COL', 'CRI', 'CZE', 'DNK', 'EST',
      'FIN', 'FRA', 'DEU', 'GRC', 'HUN', 'ISL', 'IRL', 'ISR', 'ITA', 'JPN',
      'LVA', 'LTU', 'LUX', 'MEX', 'NLD', 'NZL', 'NOR', 'POL', 'PRT', 'SVK',
      'SVN', 'KOR', 'ESP', 'SWE', 'CHE', 'TUR', 'GBR', 'USA',
    ],
    snapshotDate: '2026-08-14',
    sourceUrl: 'https://www.oecd.org/en/about/members-partners.html',
    annotations:
      'Argentina, Brazil, Bulgaria, Croatia, Peru, and Romania (accession talks opened 2022) and Indonesia and Thailand (opened 2024) are in active accession discussions but are not yet members — excluded.',
  },
  {
    id: 'eu',
    name: 'European Union',
    abbreviation: 'EU',
    type: 'economic',
    memberCountryCodes: [
      'AUT', 'BEL', 'BGR', 'HRV', 'CYP', 'CZE', 'DNK', 'EST', 'FIN', 'FRA',
      'DEU', 'GRC', 'HUN', 'IRL', 'ITA', 'LVA', 'LTU', 'LUX', 'MLT', 'NLD',
      'POL', 'PRT', 'ROU', 'SVK', 'SVN', 'ESP', 'SWE',
    ],
    snapshotDate: '2026-08-14',
    sourceUrl: 'https://european-union.europa.eu/principles-countries-history/country-profiles_en',
  },
  {
    id: 'eaeu',
    name: 'Eurasian Economic Union',
    abbreviation: 'EAEU',
    type: 'economic',
    memberCountryCodes: ['ARM', 'BLR', 'KAZ', 'KGZ', 'RUS'],
    snapshotDate: '2026-08-14',
    sourceUrl: 'https://eaeunion.org/?lang=en',
  },

  // --- Regional -----------------------------------------------------------
  {
    id: 'asean',
    name: 'Association of Southeast Asian Nations',
    abbreviation: 'ASEAN',
    type: 'political-forum',
    memberCountryCodes: ['BRN', 'KHM', 'IDN', 'LAO', 'MYS', 'MMR', 'PHL', 'SGP', 'THA', 'TLS', 'VNM'],
    snapshotDate: '2026-08-14',
    sourceUrl: 'https://asean.org/member-states/',
    annotations: 'Timor-Leste is the newest member, admitted 2025-10-26.',
  },
  {
    id: 'au',
    name: 'African Union',
    abbreviation: 'AU',
    type: 'political-forum',
    memberCountryCodes: [
      'BDI', 'CMR', 'CAF', 'TCD', 'COG', 'COD', 'GNQ', 'GAB', 'STP',
      'COM', 'DJI', 'ERI', 'ETH', 'KEN', 'MDG', 'MUS', 'RWA', 'SYC', 'SOM', 'SSD', 'SDN', 'TZA', 'UGA',
      'DZA', 'EGY', 'LBY', 'MRT', 'MAR', 'ESH', 'TUN',
      'AGO', 'BWA', 'SWZ', 'LSO', 'MWI', 'MOZ', 'NAM', 'ZAF', 'ZMB', 'ZWE',
      'BEN', 'BFA', 'CPV', 'CIV', 'GMB', 'GHA', 'GIN', 'GNB', 'LBR', 'MLI', 'NER', 'NGA', 'SEN', 'SLE', 'TGO',
    ],
    snapshotDate: '2026-08-14',
    sourceUrl: 'https://au.int/en/member_states/countryprofiles2',
    annotations:
      'Includes the Sahrawi Arab Democratic Republic (ESH / Western Sahara) as a full AU member, per the AU\'s own roster — ESH has no entry in this app\'s Country registry (it\'s not a UN member state), so it will never match a selected country here; included anyway for fidelity to the official list.',
  },
  {
    id: 'oas',
    name: 'Organization of American States',
    abbreviation: 'OAS',
    type: 'political-forum',
    memberCountryCodes: [
      'ATG', 'ARG', 'BHS', 'BRB', 'BLZ', 'BOL', 'BRA', 'CAN', 'CHL', 'COL',
      'CRI', 'DMA', 'DOM', 'ECU', 'SLV', 'GRD', 'GTM', 'GUY', 'HTI', 'HND',
      'JAM', 'MEX', 'PAN', 'PRY', 'PER', 'KNA', 'LCA', 'VCT', 'SUR', 'TTO',
      'USA', 'URY',
    ],
    snapshotDate: '2026-08-14',
    sourceUrl: 'https://www.oas.org/en/about/member_states.asp',
    annotations:
      'Three of the official 35-state roster are deliberately excluded, not oversights: Cuba (1962 exclusion technically lifted 2009, but Cuba has never rejoined or participated), Venezuela (its government has asserted since Jan 2026 that it is no longer a member; OAS\'s own materials list it as disputed), and Nicaragua (formally completed a 2-year withdrawal process on 2023-11-19 — not disputed, simply no longer a member). Direct fetch of the cited page returned HTTP 403; this roster is cross-verified through independent reporting rather than a direct read of it.',
  },
  {
    id: 'gcc',
    name: 'Gulf Cooperation Council',
    abbreviation: 'GCC',
    type: 'economic',
    memberCountryCodes: ['BHR', 'KWT', 'OMN', 'QAT', 'SAU', 'ARE'],
    snapshotDate: '2026-08-14',
    sourceUrl: 'https://www.gcc-sg.org/en-us/Pages/default.aspx',
  },
  {
    id: 'mercosur',
    name: 'Mercado Común del Sur',
    abbreviation: 'Mercosur',
    type: 'trade',
    memberCountryCodes: ['ARG', 'BRA', 'PRY', 'URY', 'BOL'],
    snapshotDate: '2026-08-14',
    sourceUrl: 'https://www.mercosur.int/en/about-mercosur/countries',
    annotations:
      'Venezuela remains suspended from all rights/obligations of membership under the 2017 Ushuaia Protocol decision — excluded here. Bolivia completed its accession in 2024 and is now a full member — included.',
  },
  {
    id: 'pacific-alliance',
    name: 'Pacific Alliance',
    abbreviation: 'Pacific Alliance',
    type: 'trade',
    memberCountryCodes: ['CHL', 'COL', 'MEX', 'PER'],
    snapshotDate: '2026-08-14',
    sourceUrl: 'https://alianzapacifico.net/en/',
    annotations: 'Costa Rica has been in active accession talks since 2022 (progress reported as recently as Jan 2026) but has not completed full membership as of this snapshot — excluded.',
  },
  {
    id: 'caricom',
    name: 'Caribbean Community',
    abbreviation: 'CARICOM',
    type: 'economic',
    memberCountryCodes: [
      // 15 full members
      'ATG', 'BHS', 'BRB', 'BLZ', 'DMA', 'GRD', 'GUY', 'HTI', 'JAM', 'MSR',
      'LCA', 'KNA', 'VCT', 'SUR', 'TTO',
      // 8 associate members (non-sovereign Caribbean territories)
      'AIA', 'BMU', 'VGB', 'CYM', 'CUW', 'GUF', 'MTQ', 'TCA',
    ],
    snapshotDate: '2026-08-14',
    sourceUrl: 'https://caricom.org/member-states-and-associate-members/',
    annotations:
      '23 total: 15 full members + 8 associate members, per your instruction to include associates. Associate members are non-sovereign territories (Anguilla, Bermuda, British Virgin Islands, Cayman Islands, Curaçao, French Guiana, Martinique, Turks and Caicos Islands) with no entry in this app\'s Country registry — none will ever match a selected country here, included anyway for fidelity to the official roster. Montserrat (MSR), a full member despite being a UK overseas territory, has the same limitation.',
  },
]
