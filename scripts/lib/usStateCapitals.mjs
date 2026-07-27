// The 50 US state capitals, as [state abbreviation, exact Census "Places"
// NAME string] pairs — hand-curated (no dataset flags this; see
// buildUsCitiesData.mjs's doc comment on why Natural Earth's ADM1CAP
// doesn't help here). Matched against scripts/vendor/census/
// cb_2023_us_place_500k.dbf's NAME field, which is NOT always the plain
// city name: Boise ("Boise City"), Indianapolis ("Indianapolis city
// (balance)"), and Nashville ("Nashville-Davidson metropolitan government
// (balance)") carry their exact Census legal/statistical suffix, and
// Minnesota's capital is "St. Paul" (with the period), not "Saint Paul".
// Hawaii's capital, Honolulu, is technically unincorporated (a Census-
// Designated Place, "Urban Honolulu") rather than an incorporated place —
// still included here so it's flagged as a capital regardless of the
// population-estimates gap that leaves CDPs at 0 (see buildUsCitiesData.mjs).
export const US_STATE_CAPITALS = [
  ['AL', 'Montgomery'],
  ['AK', 'Juneau'],
  ['AZ', 'Phoenix'],
  ['AR', 'Little Rock'],
  ['CA', 'Sacramento'],
  ['CO', 'Denver'],
  ['CT', 'Hartford'],
  ['DE', 'Dover'],
  ['FL', 'Tallahassee'],
  ['GA', 'Atlanta'],
  ['HI', 'Urban Honolulu'],
  ['ID', 'Boise City'],
  ['IL', 'Springfield'],
  ['IN', 'Indianapolis city (balance)'],
  ['IA', 'Des Moines'],
  ['KS', 'Topeka'],
  ['KY', 'Frankfort'],
  ['LA', 'Baton Rouge'],
  ['ME', 'Augusta'],
  ['MD', 'Annapolis'],
  ['MA', 'Boston'],
  ['MI', 'Lansing'],
  ['MN', 'St. Paul'],
  ['MS', 'Jackson'],
  ['MO', 'Jefferson City'],
  ['MT', 'Helena'],
  ['NE', 'Lincoln'],
  ['NV', 'Carson City'],
  ['NH', 'Concord'],
  ['NJ', 'Trenton'],
  ['NM', 'Santa Fe'],
  ['NY', 'Albany'],
  ['NC', 'Raleigh'],
  ['ND', 'Bismarck'],
  ['OH', 'Columbus'],
  ['OK', 'Oklahoma City'],
  ['OR', 'Salem'],
  ['PA', 'Harrisburg'],
  ['RI', 'Providence'],
  ['SC', 'Columbia'],
  ['SD', 'Pierre'],
  ['TN', 'Nashville-Davidson metropolitan government (balance)'],
  ['TX', 'Austin'],
  ['UT', 'Salt Lake City'],
  ['VT', 'Montpelier'],
  ['VA', 'Richmond'],
  ['WA', 'Olympia'],
  ['WV', 'Charleston'],
  ['WI', 'Madison'],
  ['WY', 'Cheyenne'],
]
