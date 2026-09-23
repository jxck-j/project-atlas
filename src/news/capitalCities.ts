// Capital-city names for classify.ts's capital-attack trigger (settled call 7, LOGBOOK.md 2026-09-21: a strike on a
// capital is Major regardless of casualty count). The original trigger only matched the literal WORD "capital", so it
// caught "drone attack on the Russian capital" but never "Russian drones hammer Kyiv" — the far more common way a
// capital strike is actually headlined (found 2026-09-23: a Kyiv strike with 2 dead tiered Significant while a UN
// speech tiered Major).
//
// Hand-cleaned from data/countryProfiles.ts's `capital` field (which carries parenthetical transliterations and notes,
// e.g. "Kyiv (Kiev is the transliteration from Russian)") rather than imported from it, so src/news/ keeps depending
// on nothing outside itself. news.test.ts checks this list still covers every profile's capital, so the two can't
// silently drift apart.
//
// Deliberately left out: names that are also ordinary English words or better-known places, where "attacks on X"
// would misfire far more often than it would find a real capital strike — "Victoria" (Seychelles; also an Australian
// state), "Kingston"/"Kingstown"/"Georgetown" (common town names), "Male" without its accent. Missing one of these
// only under-tiers a story, classify.ts's stated safe direction.
export const CAPITAL_CITY_NAMES: readonly string[] = [
  'Kabul', 'Tirana', 'Algiers', 'Andorra la Vella', 'Luanda', "Saint John's", 'Buenos Aires', 'Yerevan', 'Canberra',
  'Vienna', 'Baku', 'Nassau', 'Manama', 'Dhaka', 'Bridgetown', 'Minsk', 'Brussels', 'Belmopan', 'Porto-Novo',
  'Thimphu', 'La Paz', 'Sarajevo', 'Gaborone', 'Brasília', 'Brasilia', 'Bandar Seri Begawan', 'Sofia', 'Ouagadougou',
  'Gitega', 'Bujumbura', 'Praia', 'Phnom Penh', 'Yaounde', 'Yaoundé', 'Ottawa', 'Bangui', "N'Djamena", 'Santiago',
  'Beijing', 'Bogotá', 'Bogota', 'Moroni', 'Brazzaville', 'San José', 'San Jose', 'Yamoussoukro', 'Zagreb', 'Havana',
  'Nicosia', 'Prague', 'Kinshasa', 'Copenhagen', 'Djibouti', 'Roseau', 'Santo Domingo', 'Quito', 'Cairo',
  'San Salvador', 'Malabo', 'Asmara', 'Tallinn', 'Mbabane', 'Addis Ababa', 'Suva', 'Helsinki', 'Paris', 'Libreville',
  'Banjul', 'Tbilisi', 'Berlin', 'Accra', 'Athens', "Saint George's", 'Guatemala City', 'Conakry', 'Bissau',
  'Port-au-Prince', 'Tegucigalpa', 'Budapest', 'Reykjavik', 'New Delhi', 'Jakarta', 'Tehran', 'Baghdad', 'Dublin',
  'Jerusalem', 'Rome', 'Tokyo', 'Amman', 'Astana', 'Nairobi', 'Tarawa', 'Kuwait City', 'Bishkek', 'Vientiane', 'Riga',
  'Beirut', 'Maseru', 'Monrovia', 'Tripoli', 'Vaduz', 'Vilnius', 'Luxembourg', 'Antananarivo', 'Lilongwe',
  'Kuala Lumpur', 'Malé', 'Bamako', 'Valletta', 'Majuro', 'Nouakchott', 'Port Louis', 'Mexico City', 'Palikir',
  'Chisinau', 'Monaco', 'Ulaanbaatar', 'Podgorica', 'Rabat', 'Maputo', 'Naypyidaw', 'Windhoek', 'Yaren', 'Kathmandu',
  'Amsterdam', 'Wellington', 'Managua', 'Niamey', 'Abuja', 'Pyongyang', 'Skopje', 'Oslo', 'Muscat', 'Islamabad',
  'Ngerulmud', 'Panama City', 'Port Moresby', 'Asunción', 'Asuncion', 'Lima', 'Manila', 'Warsaw', 'Lisbon', 'Doha',
  'Bucharest', 'Moscow', 'Kigali', 'Basseterre', 'Castries', 'Apia', 'San Marino', 'Sao Tome', 'Riyadh', 'Dakar',
  'Belgrade', 'Freetown', 'Singapore', 'Bratislava', 'Ljubljana', 'Honiara', 'Mogadishu', 'Pretoria', 'Seoul', 'Juba',
  'Madrid', 'Sri Jayawardenepura Kotte', 'Khartoum', 'Paramaribo', 'Stockholm', 'Bern', 'Damascus', 'Taipei',
  'Dushanbe', 'Dodoma', 'Bangkok', 'Dili', 'Lome', "Nuku'alofa", 'Port of Spain', 'Tunis', 'Ankara', 'Ashgabat',
  'Funafuti', 'Kampala', 'Kyiv', 'Kiev', 'Abu Dhabi', 'London', 'Washington', 'Montevideo', 'Tashkent', 'Port-Vila',
  'Caracas', 'Hanoi', 'Sanaa', "Sana'a", 'Lusaka', 'Harare',
]

/** Profile capitals intentionally absent from CAPITAL_CITY_NAMES (see the header). */
export const EXCLUDED_CAPITAL_NAMES: readonly string[] = ['Victoria', 'Kingston', 'Kingstown', 'Georgetown']
