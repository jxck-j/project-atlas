// Single source of truth for "which registered GeoEntity records have a
// real, standalone polygon in world-atlas's raw 10m source data, and how to
// find it there" — replaces the pre-v3 territoryGeometryIds.ts (3 entries,
// all ISO-numeric-id-keyed) now that the v3 dataset is ~54 entities, eleven
// of which have NO numeric `id` in the source at all (disputed/unrecognized
// areas the raw data still ships as separate features, just without an ISO
// 3166-1 numeric code — same situation unMembers.ts/buildCountryTopology.mjs
// already handle for Kosovo/N. Cyprus/Somaliland in the country pipeline).
//
// Used by both scripts/buildEntityTopology.mjs (which raw features to keep,
// and — for the id-less ones — what geometry id to stamp onto them before
// rebuilding the topology) and scene/useGeoEntityFeatures.ts (mapping a
// loaded feature's id back to the GeoEntity it belongs to, for
// registerGeometryMapping()). One pair of maps instead of two separate build
// vs. runtime tables so the build-time allowlist and the runtime lookup can
// never drift apart — same reasoning the pre-v3 file gave for a single map,
// just split in two now because id-less features need a different lookup
// key (their source `properties.name`, not their absent `id`).

/**
 * Numeric-ISO-id features: source `id` (already a zero-padded ISO 3166-1
 * numeric string, e.g. "630") -> GeoEntityRegistry id. topojson preserves
 * this id unchanged through the rebuild/simplify pipeline, so the same
 * string that selects a feature at build time is what
 * useGeoEntityFeatures.ts sees at runtime as `feature.id`.
 */
export const ENTITY_GEOMETRY_IDS: Record<string, string> = {
  // GeopoliticalEntity
  '158': 'taiwan',
  '275': 'palestine',
  '732': 'western-sahara',
  // Territory
  '630': 'puerto-rico',
  '304': 'greenland',
  '344': 'hong-kong',
  '446': 'macao',
  '540': 'new-caledonia',
  '531': 'curacao',
  '533': 'aruba',
  '796': 'turks-and-caicos-islands',
  '663': 'saint-martin',
  '534': 'sint-maarten',
  '666': 'saint-pierre-and-miquelon',
  '612': 'pitcairn-islands',
  '258': 'french-polynesia',
  '260': 'french-southern-and-antarctic-lands',
  '581': 'us-minor-outlying-islands',
  '500': 'montserrat',
  '850': 'us-virgin-islands',
  '652': 'saint-barthelemy',
  '660': 'anguilla',
  '092': 'british-virgin-islands',
  '136': 'cayman-islands',
  '060': 'bermuda',
  '654': 'saint-helena',
  '832': 'jersey',
  '831': 'guernsey',
  '833': 'isle-of-man',
  '248': 'aland',
  '234': 'faroe-islands',
  '086': 'british-indian-ocean-territory',
  '574': 'norfolk-island',
  '184': 'cook-islands',
  '876': 'wallis-and-futuna',
  '239': 'south-georgia-and-south-sandwich-islands',
  '238': 'falkland-islands',
  '570': 'niue',
  '016': 'american-samoa',
  '316': 'guam',
  '580': 'northern-mariana-islands',
  '334': 'heard-island-and-mcdonald-islands',
  '292': 'gibraltar',
  // GeographicRegion
  '010': 'antarctica',
}

/**
 * Id-less features: raw source `properties.name` (exactly as it appears in
 * world-atlas's 10m topology — e.g. "USNB Guantanamo Bay") -> GeoEntityRegistry
 * id. Only scripts/buildEntityTopology.mjs reads this map directly (to find
 * these features, since they have no `id` to key on); it then stamps the
 * target GeoEntityRegistry id onto the kept feature's `id` field *before*
 * calling topojson-server's topology(), so the rebuilt output carries that
 * id like any other feature — useGeoEntityFeatures.ts never needs to know
 * these started out id-less, and doesn't need to read this map at all.
 */
export const ENTITY_GEOMETRY_NAME_KEYS: Record<string, string> = {
  Kosovo: 'kosovo',
  Dhekelia: 'dhekelia',
  'USNB Guantanamo Bay': 'guantanamo-bay',
  Baikonur: 'baikonur',
  'Cyprus U.N. Buffer Zone': 'cyprus-buffer-zone',
  'Siachen Glacier': 'siachen-glacier',
  Akrotiri: 'akrotiri',
  'Spratly Is.': 'spratly-islands',
  'Bajo Nuevo Bank': 'bajo-nuevo-bank',
  'Serranilla Bank': 'serranilla-bank',
  'Scarborough Reef': 'scarborough-reef',
}
