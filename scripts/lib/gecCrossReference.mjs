// ISO 3166-1 alpha-3 -> GEC (formerly FIPS) two-letter country code, e.g.
// "DEU" -> "GM" for Germany, "MMR" -> "BM" for Burma. factbook.json (see
// buildGovCapitalPopGdp.mjs) indexes every country profile by GEC code, not
// ISO — for most countries the two differ (Germany is "de" in ISO2 but
// "gm.json" in factbook.json; Austria is "at" in ISO2 but "au.json"), so a
// script matching this project's ISO-alpha3-keyed Country registry (see
// scripts/lib/iso3166.mjs) back to a factbook.json file path needs this
// table to bridge the two, the same way iso3166.mjs bridges alpha-3 to
// world-atlas's numeric ids.
//
// Sourced from the CIA World Factbook's own "Appendix D: Cross-Reference
// List of Country Data Codes" (entity / GEC / ISO 3166-1 alpha-2 / alpha-3 /
// numeric / STANAG / internet TLD), mirrored at
// https://simonw.github.io/cia-world-factbook-2020/appendix/appendix-d.html
// (the live CIA site was taken down Feb 4 2026 — see factbook.json's own
// README). Fetched 2026-08-13.
//
// Two rows from the source table are deliberately NOT included here:
// - Palestine (ISO alpha-3 "PSE") appears twice — once for the Gaza Strip
//   ("GZ") and once for the West Bank ("WE") — because factbook.json splits
//   it into two separate profiles with no single "Palestine" entry. Neither
//   is a UN member state, so no consumer of this table (built for the 193
//   UN-member Country registry) needs it; add a real resolution here if a
//   future caller ever needs to look up Palestine specifically.
// - "France, Metropolitan" (ISO alpha-3 "FXX") and the "United States Minor
//   Outlying Islands" (ISO alpha-3 "UMI") both list "-" (no GEC code
//   assigned) in the source table, so there's nothing to map either to.
//
// Kept complete for every other entry in the source table (not trimmed to
// only the 193 UN members) — same "shared, generic infrastructure" reasoning
// iso3166.mjs's own header comment gives for staying complete rather than
// pre-filtered to one caller's needs.
export const ISO3_TO_GEC = {
  ABW: "AA", // Aruba
  AFG: "AF", // Afghanistan
  AGO: "AO", // Angola
  AIA: "AV", // Anguilla
  ALB: "AL", // Albania
  AND: "AN", // Andorra
  ARE: "AE", // United Arab Emirates
  ARG: "AR", // Argentina
  ARM: "AM", // Armenia
  ASM: "AQ", // American Samoa
  ATA: "AY", // Antarctica
  ATF: "FS", // French Southern and Antarctic Lands
  ATG: "AC", // Antigua and Barbuda
  AUS: "AS", // Australia
  AUT: "AU", // Austria
  AZE: "AJ", // Azerbaijan
  BDI: "BY", // Burundi
  BEL: "BE", // Belgium
  BEN: "BN", // Benin
  BFA: "UV", // Burkina Faso
  BGD: "BG", // Bangladesh
  BGR: "BU", // Bulgaria
  BHR: "BA", // Bahrain
  BHS: "BF", // Bahamas, The
  BIH: "BK", // Bosnia and Herzegovina
  BLM: "TB", // Saint Barthelemy
  BLR: "BO", // Belarus
  BLZ: "BH", // Belize
  BMU: "BD", // Bermuda
  BOL: "BL", // Bolivia
  BRA: "BR", // Brazil
  BRB: "BB", // Barbados
  BRN: "BX", // Brunei
  BTN: "BT", // Bhutan
  BVT: "BV", // Bouvet Island
  BWA: "BC", // Botswana
  CAF: "CT", // Central African Republic
  CAN: "CA", // Canada
  CCK: "CK", // Cocos (Keeling) Islands
  CHE: "SZ", // Switzerland
  CHL: "CI", // Chile
  CHN: "CH", // China
  CIV: "IV", // Cote d'Ivoire
  CMR: "CM", // Cameroon
  COD: "CG", // Congo, Democratic Republic of the
  COG: "CF", // Congo, Republic of the
  COK: "CW", // Cook Islands
  COL: "CO", // Colombia
  COM: "CN", // Comoros
  CPV: "CV", // Cabo Verde
  CRI: "CS", // Costa Rica
  CUB: "CU", // Cuba
  CUW: "UC", // Curacao
  CXR: "KT", // Christmas Island
  CYM: "CJ", // Cayman Islands
  CYP: "CY", // Cyprus
  CZE: "EZ", // Czechia
  DEU: "GM", // Germany
  DJI: "DJ", // Djibouti
  DMA: "DO", // Dominica
  DNK: "DA", // Denmark
  DOM: "DR", // Dominican Republic
  DZA: "AG", // Algeria
  ECU: "EC", // Ecuador
  EGY: "EG", // Egypt
  ERI: "ER", // Eritrea
  ESH: "WI", // Western Sahara
  ESP: "SP", // Spain
  EST: "EN", // Estonia
  ETH: "ET", // Ethiopia
  FIN: "FI", // Finland
  FJI: "FJ", // Fiji
  FLK: "FK", // Falkland Islands (Islas Malvinas)
  FRA: "FR", // France
  FRO: "FO", // Faroe Islands
  FSM: "FM", // Micronesia, Federated States of
  GAB: "GB", // Gabon
  GBR: "UK", // United Kingdom
  GEO: "GG", // Georgia
  GGY: "GK", // Guernsey
  GHA: "GH", // Ghana
  GIB: "GI", // Gibraltar
  GIN: "GV", // Guinea
  GLP: "GP", // Guadeloupe
  GMB: "GA", // Gambia, The
  GNB: "PU", // Guinea-Bissau
  GNQ: "EK", // Equatorial Guinea
  GRC: "GR", // Greece
  GRD: "GJ", // Grenada
  GRL: "GL", // Greenland
  GTM: "GT", // Guatemala
  GUF: "FG", // French Guiana
  GUM: "GQ", // Guam
  GUY: "GY", // Guyana
  HKG: "HK", // Hong Kong
  HMD: "HM", // Heard Island and McDonald Islands
  HND: "HO", // Honduras
  HRV: "HR", // Croatia
  HTI: "HA", // Haiti
  HUN: "HU", // Hungary
  IDN: "ID", // Indonesia
  IMN: "IM", // Isle of Man
  IND: "IN", // India
  IOT: "IO", // British Indian Ocean Territory
  IRL: "EI", // Ireland
  IRN: "IR", // Iran
  IRQ: "IZ", // Iraq
  ISL: "IC", // Iceland
  ISR: "IS", // Israel
  ITA: "IT", // Italy
  JAM: "JM", // Jamaica
  JEY: "JE", // Jersey
  JOR: "JO", // Jordan
  JPN: "JA", // Japan
  KAZ: "KZ", // Kazakhstan
  KEN: "KE", // Kenya
  KGZ: "KG", // Kyrgyzstan
  KHM: "CB", // Cambodia
  KIR: "KR", // Kiribati
  KNA: "SC", // Saint Kitts and Nevis
  KOR: "KS", // Korea, South
  KWT: "KU", // Kuwait
  LAO: "LA", // Laos
  LBN: "LE", // Lebanon
  LBR: "LI", // Liberia
  LBY: "LY", // Libya
  LCA: "ST", // Saint Lucia
  LIE: "LS", // Liechtenstein
  LKA: "CE", // Sri Lanka
  LSO: "LT", // Lesotho
  LTU: "LH", // Lithuania
  LUX: "LU", // Luxembourg
  LVA: "LG", // Latvia
  MAC: "MC", // Macau
  MAF: "RN", // Saint Martin
  MAR: "MO", // Morocco
  MCO: "MN", // Monaco
  MDA: "MD", // Moldova
  MDG: "MA", // Madagascar
  MDV: "MV", // Maldives
  MEX: "MX", // Mexico
  MHL: "RM", // Marshall Islands
  MKD: "MK", // North Macedonia
  MLI: "ML", // Mali
  MLT: "MT", // Malta
  MMR: "BM", // Burma
  MNE: "MJ", // Montenegro
  MNG: "MG", // Mongolia
  MNP: "CQ", // Northern Mariana Islands
  MOZ: "MZ", // Mozambique
  MRT: "MR", // Mauritania
  MSR: "MH", // Montserrat
  MTQ: "MB", // Martinique
  MUS: "MP", // Mauritius
  MWI: "MI", // Malawi
  MYS: "MY", // Malaysia
  MYT: "MF", // Mayotte
  NAM: "WA", // Namibia
  NCL: "NC", // New Caledonia
  NER: "NG", // Niger
  NFK: "NF", // Norfolk Island
  NGA: "NI", // Nigeria
  NIC: "NU", // Nicaragua
  NIU: "NE", // Niue
  NLD: "NL", // Netherlands
  NOR: "NO", // Norway
  NPL: "NP", // Nepal
  NRU: "NR", // Nauru
  NZL: "NZ", // New Zealand
  OMN: "MU", // Oman
  PAK: "PK", // Pakistan
  PAN: "PM", // Panama
  PCN: "PC", // Pitcairn Islands
  PER: "PE", // Peru
  PHL: "RP", // Philippines
  PLW: "PS", // Palau
  PNG: "PP", // Papua New Guinea
  POL: "PL", // Poland
  PRI: "RQ", // Puerto Rico
  PRK: "KN", // Korea, North
  PRT: "PO", // Portugal
  PRY: "PA", // Paraguay
  PYF: "FP", // French Polynesia
  QAT: "QA", // Qatar
  REU: "RE", // Reunion
  ROU: "RO", // Romania
  RUS: "RS", // Russia
  RWA: "RW", // Rwanda
  SAU: "SA", // Saudi Arabia
  SDN: "SU", // Sudan
  SEN: "SG", // Senegal
  SGP: "SN", // Singapore
  SGS: "SX", // South Georgia and the Islands
  SHN: "SH", // Saint Helena, Ascension, and Tristan da Cunha
  SJM: "SV", // Svalbard
  SLB: "BP", // Solomon Islands
  SLE: "SL", // Sierra Leone
  SLV: "ES", // El Salvador
  SMR: "SM", // San Marino
  SOM: "SO", // Somalia
  SPM: "SB", // Saint Pierre and Miquelon
  SRB: "RI", // Serbia
  SSD: "OD", // South Sudan
  STP: "TP", // Sao Tome and Principe
  SUR: "NS", // Suriname
  SVK: "LO", // Slovakia
  SVN: "SI", // Slovenia
  SWE: "SW", // Sweden
  SWZ: "WZ", // Eswatini
  SXM: "NN", // Sint Maarten
  SYC: "SE", // Seychelles
  SYR: "SY", // Syria
  TCA: "TK", // Turks and Caicos Islands
  TCD: "CD", // Chad
  TGO: "TO", // Togo
  THA: "TH", // Thailand
  TJK: "TI", // Tajikistan
  TKL: "TL", // Tokelau
  TKM: "TX", // Turkmenistan
  TLS: "TT", // Timor-Leste
  TON: "TN", // Tonga
  TTO: "TD", // Trinidad and Tobago
  TUN: "TS", // Tunisia
  TUR: "TU", // Turkey
  TUV: "TV", // Tuvalu
  TWN: "TW", // Taiwan
  TZA: "TZ", // Tanzania
  UGA: "UG", // Uganda
  UKR: "UP", // Ukraine
  URY: "UY", // Uruguay
  USA: "US", // United States
  UZB: "UZ", // Uzbekistan
  VAT: "VT", // Holy See (Vatican City)
  VCT: "VC", // Saint Vincent and the Grenadines
  VEN: "VE", // Venezuela
  VGB: "VI", // British Virgin Islands
  VIR: "VQ", // Virgin Islands
  VNM: "VM", // Vietnam
  VUT: "NH", // Vanuatu
  WLF: "WF", // Wallis and Futuna
  WSM: "WS", // Samoa
  XKS: "KV", // Kosovo
  YEM: "YM", // Yemen
  ZAF: "SF", // South Africa
  ZMB: "ZA", // Zambia
  ZWE: "ZI", // Zimbabwe
}
