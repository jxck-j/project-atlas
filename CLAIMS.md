# Claims & Relationships Register

**Generated file — do not hand-edit.** Produced by `npm run docs:claims`
(`scripts/generateClaimsDoc.mjs`) from two sources: `public/geo/
countries-un193.json` (the exact topology `scene/useCountryFeatures.ts`
fetches at runtime — same 193 names/ids the app itself uses) and
`data/registry/geoEntities.ts` via `GeoEntityRegistry` (the same registry
`EntityResolver`, `scene/GeoEntities.tsx`, and `layers/geoOverlays/` read
at runtime). Editing this file by hand will just be overwritten the next
time the generator runs — edit `geoEntities.ts` instead and regenerate.

Covers every UN member state (193) and every registered
GeoEntity (56) — 249
total — not just the ones with an active dispute.

Same sourcing caveat every dataset in `data/registry/` carries: simplified,
hand-curated entries for a demo globe, not a comprehensive or authoritative
reference. See `CLAUDE.md`'s "Geopolitical data architecture" section and
`LOGBOOK.md` for the judgment calls behind specific entries. Note also that
a `Country` record has no `claims`/`claimedBy` field of its own (see
`data/types.ts`) — every claim relationship in this app is modeled from the
GeoEntity side, so a country's "Claims" entry below is always derived by
scanning GeoEntity `claimedBy` fields for a reference back to it, never a
country stating a claim directly.

Regenerated: 2026-07-21

---

## Summary: active disputes (11)

Quick reference — only entities with a nonempty `claimedBy`/`claims`. See
the full rosters below for everything else, including the 45 GeoEntities and effectively all 193 countries with no dispute at all.

### Antarctica (Geographic Region)

- **Claimed by:** Argentine Republic (claim suspended under the Antarctic Treaty); Commonwealth of Australia (claim suspended under the Antarctic Treaty); Republic of Chile (claim suspended under the Antarctic Treaty); French Republic (claim suspended under the Antarctic Treaty); New Zealand (claim suspended under the Antarctic Treaty); Kingdom of Norway (claim suspended under the Antarctic Treaty); United Kingdom (claim suspended under the Antarctic Treaty)

### Bajo Nuevo Bank (Maritime Feature)

- **Claimed by:** Republic of Colombia; Jamaica; Republic of Nicaragua

### Crimea (Territory)

- **Claimed by:** Ukraine; Russian Federation (since 2014)

### Kosovo (Geopolitical Entity)

- **Claimed by:** Republic of Serbia

### Scarborough Reef (Maritime Feature)

- **Claimed by:** People's Republic of China; Republic of the Philippines; Taiwan

### Serranilla Bank (Maritime Feature)

- **Claimed by:** Republic of Colombia; Republic of Honduras; Republic of Nicaragua

### Siachen Glacier (Strategic Region)

- **Claimed by:** Republic of India; Islamic Republic of Pakistan

### Spratly Islands (Maritime Feature)

- **Claimed by:** People's Republic of China; Socialist Republic of Vietnam; Republic of the Philippines; Malaysia; Brunei Darussalam; Taiwan

### Taiwan (Geopolitical Entity)

- **Claimed by:** People's Republic of China
- **Claims:** Scarborough Reef (Maritime Feature); Spratly Islands (Maritime Feature)

### US Naval Base Guantanamo Bay (Strategic Region)

- **Claimed by:** Republic of Cuba (disputes the lease’s continued legitimacy)

### Western Sahara (Geopolitical Entity)

- **Claimed by:** Kingdom of Morocco; Sahrawi Arab Democratic Republic (Polisario Front)

---

## All UN Member States (193)

### Afghanistan

- **Claims:** None

### Albania

- **Claims:** None

### Algeria

- **Claims:** None

### Andorra

- **Claims:** None

### Angola

- **Claims:** None

### Antigua and Barbuda

- **Claims:** None

### Argentina

- **Claims:** Antarctica (Geographic Region)

### Armenia

- **Claims:** None

### Australia

- **Claims:** Antarctica (Geographic Region)

### Austria

- **Claims:** None

### Azerbaijan

- **Claims:** None

### Bahamas

- **Claims:** None

### Bahrain

- **Claims:** None

### Bangladesh

- **Claims:** None

### Barbados

- **Claims:** None

### Belarus

- **Claims:** None

### Belgium

- **Claims:** None

### Belize

- **Claims:** None

### Benin

- **Claims:** None

### Bhutan

- **Claims:** None

### Bolivia

- **Claims:** None

### Bosnia and Herzegovina

- **Claims:** None

### Botswana

- **Claims:** None

### Brazil

- **Claims:** None

### Brunei

- **Claims:** Spratly Islands (Maritime Feature)

### Bulgaria

- **Claims:** None

### Burkina Faso

- **Claims:** None

### Burundi

- **Claims:** None

### Cabo Verde

- **Claims:** None

### Cambodia

- **Claims:** None

### Cameroon

- **Claims:** None

### Canada

- **Claims:** None

### Central African Republic

- **Claims:** None

### Chad

- **Claims:** None

### Chile

- **Claims:** Antarctica (Geographic Region)

### China

- **Claims:** Scarborough Reef (Maritime Feature); Spratly Islands (Maritime Feature); Taiwan (Geopolitical Entity)

### Colombia

- **Claims:** Bajo Nuevo Bank (Maritime Feature); Serranilla Bank (Maritime Feature)

### Comoros

- **Claims:** None

### Congo

- **Claims:** None

### Costa Rica

- **Claims:** None

### Côte d'Ivoire

- **Claims:** None

### Croatia

- **Claims:** None

### Cuba

- **Claims:** US Naval Base Guantanamo Bay (Strategic Region)

### Cyprus

- **Claims:** None

### Czechia

- **Claims:** None

### Democratic Republic of the Congo

- **Claims:** None

### Denmark

- **Claims:** None

### Djibouti

- **Claims:** None

### Dominica

- **Claims:** None

### Dominican Republic

- **Claims:** None

### Ecuador

- **Claims:** None

### Egypt

- **Claims:** None

### El Salvador

- **Claims:** None

### Equatorial Guinea

- **Claims:** None

### Eritrea

- **Claims:** None

### Estonia

- **Claims:** None

### Eswatini

- **Claims:** None

### Ethiopia

- **Claims:** None

### Fiji

- **Claims:** None

### Finland

- **Claims:** None

### France

- **Claims:** Antarctica (Geographic Region)

### Gabon

- **Claims:** None

### Gambia

- **Claims:** None

### Georgia

- **Claims:** None

### Germany

- **Claims:** None

### Ghana

- **Claims:** None

### Greece

- **Claims:** None

### Grenada

- **Claims:** None

### Guatemala

- **Claims:** None

### Guinea

- **Claims:** None

### Guinea-Bissau

- **Claims:** None

### Guyana

- **Claims:** None

### Haiti

- **Claims:** None

### Honduras

- **Claims:** Serranilla Bank (Maritime Feature)

### Hungary

- **Claims:** None

### Iceland

- **Claims:** None

### India

- **Claims:** Siachen Glacier (Strategic Region)

### Indonesia

- **Claims:** None

### Iran

- **Claims:** None

### Iraq

- **Claims:** None

### Ireland

- **Claims:** None

### Israel

- **Claims:** None

### Italy

- **Claims:** None

### Jamaica

- **Claims:** Bajo Nuevo Bank (Maritime Feature)

### Japan

- **Claims:** None

### Jordan

- **Claims:** None

### Kazakhstan

- **Claims:** None

### Kenya

- **Claims:** None

### Kiribati

- **Claims:** None

### Kuwait

- **Claims:** None

### Kyrgyzstan

- **Claims:** None

### Laos

- **Claims:** None

### Latvia

- **Claims:** None

### Lebanon

- **Claims:** None

### Lesotho

- **Claims:** None

### Liberia

- **Claims:** None

### Libya

- **Claims:** None

### Liechtenstein

- **Claims:** None

### Lithuania

- **Claims:** None

### Luxembourg

- **Claims:** None

### Madagascar

- **Claims:** None

### Malawi

- **Claims:** None

### Malaysia

- **Claims:** Spratly Islands (Maritime Feature)

### Maldives

- **Claims:** None

### Mali

- **Claims:** None

### Malta

- **Claims:** None

### Marshall Islands

- **Claims:** None

### Mauritania

- **Claims:** None

### Mauritius

- **Claims:** None

### Mexico

- **Claims:** None

### Micronesia

- **Claims:** None

### Moldova

- **Claims:** None

### Monaco

- **Claims:** None

### Mongolia

- **Claims:** None

### Montenegro

- **Claims:** None

### Morocco

- **Claims:** Western Sahara (Geopolitical Entity)

### Mozambique

- **Claims:** None

### Myanmar

- **Claims:** None

### Namibia

- **Claims:** None

### Nauru

- **Claims:** None

### Nepal

- **Claims:** None

### Netherlands

- **Claims:** None

### New Zealand

- **Claims:** Antarctica (Geographic Region)

### Nicaragua

- **Claims:** Bajo Nuevo Bank (Maritime Feature); Serranilla Bank (Maritime Feature)

### Niger

- **Claims:** None

### Nigeria

- **Claims:** None

### North Korea

- **Claims:** None

### North Macedonia

- **Claims:** None

### Norway

- **Claims:** Antarctica (Geographic Region)

### Oman

- **Claims:** None

### Pakistan

- **Claims:** Siachen Glacier (Strategic Region)

### Palau

- **Claims:** None

### Panama

- **Claims:** None

### Papua New Guinea

- **Claims:** None

### Paraguay

- **Claims:** None

### Peru

- **Claims:** None

### Philippines

- **Claims:** Scarborough Reef (Maritime Feature); Spratly Islands (Maritime Feature)

### Poland

- **Claims:** None

### Portugal

- **Claims:** None

### Qatar

- **Claims:** None

### Romania

- **Claims:** None

### Russia

- **Claims:** Crimea (Territory)

### Rwanda

- **Claims:** None

### Saint Kitts and Nevis

- **Claims:** None

### Saint Lucia

- **Claims:** None

### Saint Vincent and the Grenadines

- **Claims:** None

### Samoa

- **Claims:** None

### San Marino

- **Claims:** None

### Sao Tome and Principe

- **Claims:** None

### Saudi Arabia

- **Claims:** None

### Senegal

- **Claims:** None

### Serbia

- **Claims:** Kosovo (Geopolitical Entity)

### Seychelles

- **Claims:** None

### Sierra Leone

- **Claims:** None

### Singapore

- **Claims:** None

### Slovakia

- **Claims:** None

### Slovenia

- **Claims:** None

### Solomon Islands

- **Claims:** None

### Somalia

- **Claims:** None

### South Africa

- **Claims:** None

### South Korea

- **Claims:** None

### South Sudan

- **Claims:** None

### Spain

- **Claims:** None

### Sri Lanka

- **Claims:** None

### Sudan

- **Claims:** None

### Suriname

- **Claims:** None

### Sweden

- **Claims:** None

### Switzerland

- **Claims:** None

### Syria

- **Claims:** None

### Tajikistan

- **Claims:** None

### Tanzania

- **Claims:** None

### Thailand

- **Claims:** None

### Timor-Leste

- **Claims:** None

### Togo

- **Claims:** None

### Tonga

- **Claims:** None

### Trinidad and Tobago

- **Claims:** None

### Tunisia

- **Claims:** None

### Turkey

- **Claims:** None

### Turkmenistan

- **Claims:** None

### Tuvalu

- **Claims:** None

### Uganda

- **Claims:** None

### Ukraine

- **Claims:** Crimea (Territory)

### United Arab Emirates

- **Claims:** None

### United Kingdom

- **Claims:** Antarctica (Geographic Region)

### United States of America

- **Claims:** None

### Uruguay

- **Claims:** None

### Uzbekistan

- **Claims:** None

### Vanuatu

- **Claims:** None

### Venezuela

- **Claims:** None

### Vietnam

- **Claims:** Spratly Islands (Maritime Feature)

### Yemen

- **Claims:** None

### Zambia

- **Claims:** None

### Zimbabwe

- **Claims:** None

---

## All Registered GeoEntities (56)

### Akrotiri (Strategic Region)

- **Parent Entity:** None
- **Administered By:** United Kingdom (Sovereign Base Area) (since 1960)
- **Claimed By:** None
- **Claims:** None

### Åland (Territory)

- **Parent Entity:** Republic of Finland
- **Administered By:** Republic of Finland
- **Claimed By:** None
- **Claims:** None

### American Samoa (Territory)

- **Parent Entity:** United States of America
- **Administered By:** United States of America
- **Claimed By:** None
- **Claims:** None

### Anguilla (Territory)

- **Parent Entity:** United Kingdom
- **Administered By:** United Kingdom
- **Claimed By:** None
- **Claims:** None

### Antarctica (Geographic Region)

- **Parent Entity:** None
- **Administered By:** None
- **Claimed By:** Argentine Republic (claim suspended under the Antarctic Treaty); Commonwealth of Australia (claim suspended under the Antarctic Treaty); Republic of Chile (claim suspended under the Antarctic Treaty); French Republic (claim suspended under the Antarctic Treaty); New Zealand (claim suspended under the Antarctic Treaty); Kingdom of Norway (claim suspended under the Antarctic Treaty); United Kingdom (claim suspended under the Antarctic Treaty)
- **Claims:** None

### Aruba (Territory)

- **Parent Entity:** Kingdom of the Netherlands
- **Administered By:** Kingdom of the Netherlands
- **Claimed By:** None
- **Claims:** None

### Baikonur (Strategic Region)

- **Parent Entity:** None
- **Administered By:** Russian Federation (leased spaceport complex) (since 1994)
- **Claimed By:** None
- **Claims:** None

### Bajo Nuevo Bank (Maritime Feature)

- **Parent Entity:** None
- **Administered By:** Republic of Colombia
- **Claimed By:** Republic of Colombia; Jamaica; Republic of Nicaragua
- **Claims:** None

### Bermuda (Territory)

- **Parent Entity:** United Kingdom
- **Administered By:** United Kingdom
- **Claimed By:** None
- **Claims:** None

### British Indian Ocean Territory (Territory)

- **Parent Entity:** United Kingdom
- **Administered By:** United Kingdom
- **Claimed By:** None
- **Claims:** None

### British Virgin Islands (Territory)

- **Parent Entity:** United Kingdom
- **Administered By:** United Kingdom
- **Claimed By:** None
- **Claims:** None

### Cayman Islands (Territory)

- **Parent Entity:** United Kingdom
- **Administered By:** United Kingdom
- **Claimed By:** None
- **Claims:** None

### Cook Islands (Territory)

- **Parent Entity:** New Zealand
- **Administered By:** New Zealand
- **Claimed By:** None
- **Claims:** None

### Crimea (Territory)

- **Parent Entity:** None
- **Administered By:** Russian Federation (de facto administration since 2014) (since 2014)
- **Claimed By:** Ukraine; Russian Federation (since 2014)
- **Claims:** None

### Curaçao (Territory)

- **Parent Entity:** Kingdom of the Netherlands
- **Administered By:** Kingdom of the Netherlands
- **Claimed By:** None
- **Claims:** None

### Cyprus UN Buffer Zone (Strategic Region)

- **Parent Entity:** None
- **Administered By:** United Nations Peacekeeping Force in Cyprus (UNFICYP) (since 1974)
- **Claimed By:** None
- **Claims:** None

### Dhekelia (Strategic Region)

- **Parent Entity:** None
- **Administered By:** United Kingdom (Sovereign Base Area) (since 1960)
- **Claimed By:** None
- **Claims:** None

### Falkland Islands (Territory)

- **Parent Entity:** United Kingdom
- **Administered By:** United Kingdom
- **Claimed By:** None
- **Claims:** None

### Faroe Islands (Territory)

- **Parent Entity:** Kingdom of Denmark
- **Administered By:** Kingdom of Denmark
- **Claimed By:** None
- **Claims:** None

### French Polynesia (Territory)

- **Parent Entity:** French Republic
- **Administered By:** French Republic
- **Claimed By:** None
- **Claims:** None

### French Southern and Antarctic Lands (Territory)

- **Parent Entity:** French Republic
- **Administered By:** French Republic
- **Claimed By:** None
- **Claims:** None

### Gibraltar (Territory)

- **Parent Entity:** United Kingdom
- **Administered By:** United Kingdom
- **Claimed By:** None
- **Claims:** None

### Greenland (Territory)

- **Parent Entity:** Kingdom of Denmark
- **Administered By:** Kingdom of Denmark
- **Claimed By:** None
- **Claims:** None

### Guam (Territory)

- **Parent Entity:** United States of America
- **Administered By:** United States of America
- **Claimed By:** None
- **Claims:** None

### Guernsey (Territory)

- **Parent Entity:** United Kingdom
- **Administered By:** United Kingdom
- **Claimed By:** None
- **Claims:** None

### Heard Island and McDonald Islands (Territory)

- **Parent Entity:** Commonwealth of Australia
- **Administered By:** Commonwealth of Australia
- **Claimed By:** None
- **Claims:** None

### Hong Kong (Territory)

- **Parent Entity:** People's Republic of China
- **Administered By:** People's Republic of China
- **Claimed By:** None
- **Claims:** None

### Isle of Man (Territory)

- **Parent Entity:** United Kingdom
- **Administered By:** United Kingdom
- **Claimed By:** None
- **Claims:** None

### Jersey (Territory)

- **Parent Entity:** United Kingdom
- **Administered By:** United Kingdom
- **Claimed By:** None
- **Claims:** None

### Kosovo (Geopolitical Entity)

- **Parent Entity:** None
- **Administered By:** Government of the Republic of Kosovo (since 2008)
- **Claimed By:** Republic of Serbia
- **Claims:** None

### Macao (Territory)

- **Parent Entity:** People's Republic of China
- **Administered By:** People's Republic of China
- **Claimed By:** None
- **Claims:** None

### Montserrat (Territory)

- **Parent Entity:** United Kingdom
- **Administered By:** United Kingdom
- **Claimed By:** None
- **Claims:** None

### New Caledonia (Territory)

- **Parent Entity:** French Republic
- **Administered By:** French Republic
- **Claimed By:** None
- **Claims:** None

### Niue (Territory)

- **Parent Entity:** New Zealand
- **Administered By:** New Zealand
- **Claimed By:** None
- **Claims:** None

### Norfolk Island (Territory)

- **Parent Entity:** Commonwealth of Australia
- **Administered By:** Commonwealth of Australia
- **Claimed By:** None
- **Claims:** None

### Northern Mariana Islands (Territory)

- **Parent Entity:** United States of America
- **Administered By:** United States of America
- **Claimed By:** None
- **Claims:** None

### Palestine (Geopolitical Entity)

- **Parent Entity:** None
- **Administered By:** Palestinian Authority
- **Claimed By:** None
- **Claims:** None

### Pitcairn Islands (Territory)

- **Parent Entity:** United Kingdom
- **Administered By:** United Kingdom
- **Claimed By:** None
- **Claims:** None

### Puerto Rico (Territory)

- **Parent Entity:** United States of America
- **Administered By:** United States of America
- **Claimed By:** None
- **Claims:** None

### Saint Barthélemy (Territory)

- **Parent Entity:** French Republic
- **Administered By:** French Republic
- **Claimed By:** None
- **Claims:** None

### Saint Helena (Territory)

- **Parent Entity:** United Kingdom
- **Administered By:** United Kingdom
- **Claimed By:** None
- **Claims:** None

### Saint Martin (Territory)

- **Parent Entity:** French Republic
- **Administered By:** French Republic
- **Claimed By:** None
- **Claims:** None

### Saint Pierre and Miquelon (Territory)

- **Parent Entity:** French Republic
- **Administered By:** French Republic
- **Claimed By:** None
- **Claims:** None

### Scarborough Reef (Maritime Feature)

- **Parent Entity:** None
- **Administered By:** None
- **Claimed By:** People's Republic of China; Republic of the Philippines; Taiwan
- **Claims:** None

### Serranilla Bank (Maritime Feature)

- **Parent Entity:** None
- **Administered By:** Republic of Colombia
- **Claimed By:** Republic of Colombia; Republic of Honduras; Republic of Nicaragua
- **Claims:** None

### Siachen Glacier (Strategic Region)

- **Parent Entity:** None
- **Administered By:** Republic of India (controls most of the glacier)
- **Claimed By:** Republic of India; Islamic Republic of Pakistan
- **Claims:** None

### Sint Maarten (Territory)

- **Parent Entity:** Kingdom of the Netherlands
- **Administered By:** Kingdom of the Netherlands
- **Claimed By:** None
- **Claims:** None

### South Georgia and South Sandwich Islands (Territory)

- **Parent Entity:** United Kingdom
- **Administered By:** United Kingdom
- **Claimed By:** None
- **Claims:** None

### Spratly Islands (Maritime Feature)

- **Parent Entity:** None
- **Administered By:** None
- **Claimed By:** People's Republic of China; Socialist Republic of Vietnam; Republic of the Philippines; Malaysia; Brunei Darussalam; Taiwan
- **Claims:** None

### Taiwan (Geopolitical Entity)

- **Parent Entity:** None
- **Administered By:** Government of the Republic of China (Taiwan) (since 1949)
- **Claimed By:** People's Republic of China
- **Claims:** Scarborough Reef (Maritime Feature); Spratly Islands (Maritime Feature)

### Turks and Caicos Islands (Territory)

- **Parent Entity:** United Kingdom
- **Administered By:** United Kingdom
- **Claimed By:** None
- **Claims:** None

### U.S. Minor Outlying Islands (Territory)

- **Parent Entity:** United States of America
- **Administered By:** United States of America
- **Claimed By:** None
- **Claims:** None

### U.S. Virgin Islands (Territory)

- **Parent Entity:** United States of America
- **Administered By:** United States of America
- **Claimed By:** None
- **Claims:** None

### US Naval Base Guantanamo Bay (Strategic Region)

- **Parent Entity:** None
- **Administered By:** United States (naval base, under an indefinite lease) (since 1903)
- **Claimed By:** Republic of Cuba (disputes the lease’s continued legitimacy)
- **Claims:** None

### Wallis and Futuna Islands (Territory)

- **Parent Entity:** French Republic
- **Administered By:** French Republic
- **Claimed By:** None
- **Claims:** None

### Western Sahara (Geopolitical Entity)

- **Parent Entity:** None
- **Administered By:** Kingdom of Morocco (since 1975); Sahrawi Arab Democratic Republic (Polisario Front) (since 1976)
- **Claimed By:** Kingdom of Morocco; Sahrawi Arab Democratic Republic (Polisario Front)
- **Claims:** None

