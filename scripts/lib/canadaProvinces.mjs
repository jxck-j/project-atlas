// Statistics Canada's PRUID (province/territory unique id) -> postal
// abbreviation + full name, for the 13 provinces/territories the 2021
// Census Subdivision boundary file covers (verified against the vendored
// source directly: exactly these 13 PRUID values appear, matching the
// standard StatCan code list). Used by buildCanadaCitiesData.mjs to shard
// output by province the same way buildUsCitiesData.mjs shards by state.
export const CANADA_PROVINCES = {
  '10': ['NL', 'Newfoundland and Labrador'],
  '11': ['PE', 'Prince Edward Island'],
  '12': ['NS', 'Nova Scotia'],
  '13': ['NB', 'New Brunswick'],
  '24': ['QC', 'Quebec'],
  '35': ['ON', 'Ontario'],
  '46': ['MB', 'Manitoba'],
  '47': ['SK', 'Saskatchewan'],
  '48': ['AB', 'Alberta'],
  '59': ['BC', 'British Columbia'],
  '60': ['YT', 'Yukon'],
  '61': ['NT', 'Northwest Territories'],
  '62': ['NU', 'Nunavut'],
}
