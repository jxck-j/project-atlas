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

Regenerated: 2026-08-15

---

## Summary: active disputes (19)

Quick reference — only entities with a nonempty `claimedBy`/`claims`. See
the full rosters below for everything else, including the 37 GeoEntities and effectively all 193 countries with no dispute at all.

### Akrotiri (Strategic Region)

- **Claimant:** Republic of Cyprus

### Antarctica (Geographic Region)

- **Claimants:** Argentine Republic (claim suspended under the Antarctic Treaty); Commonwealth of Australia (claim suspended under the Antarctic Treaty); Republic of Chile (claim suspended under the Antarctic Treaty); French Republic (claim suspended under the Antarctic Treaty); New Zealand (claim suspended under the Antarctic Treaty); Kingdom of Norway (claim suspended under the Antarctic Treaty); United Kingdom (claim suspended under the Antarctic Treaty)

### Bajo Nuevo Bank (Maritime Feature)

- **Claimants:** Republic of Colombia; Jamaica; United States of America (since 1856)

### British Indian Ocean Territory (Territory)

- **Claimant:** Republic of Mauritius

### Crimea (Territory)

- **Claimants:** Ukraine; Russian Federation (since 2014)

### Dhekelia (Strategic Region)

- **Claimant:** Republic of Cyprus

### Falkland Islands (Territory)

- **Claimant:** Argentine Republic

### French Southern and Antarctic Lands (Territory)

- **Claimants:** Republic of Madagascar (claims the Îles Éparses/Scattered Islands); Republic of Mauritius (claims Tromelin Island)

### Gibraltar (Territory)

- **Claimant:** Kingdom of Spain

### Kosovo (Geopolitical Entity)

- **Claimant:** Republic of Serbia

### Palestine (Geopolitical Entity)

- **Claimant:** State of Israel

### Scarborough Reef (Maritime Feature)

- **Claimants:** People's Republic of China; Republic of the Philippines; Taiwan

### Serranilla Bank (Maritime Feature)

- **Claimants:** Republic of Colombia; United States of America (since 1856); Jamaica

### Siachen Glacier (Strategic Region)

- **Claimants:** Republic of India; Islamic Republic of Pakistan

### South Georgia and South Sandwich Islands (Territory)

- **Claimant:** Argentine Republic

### Spratly Islands (Maritime Feature)

- **Claimants:** People's Republic of China; Socialist Republic of Vietnam; Republic of the Philippines; Malaysia; Brunei Darussalam; Taiwan

### Taiwan (Geopolitical Entity)

- **Claimant:** People's Republic of China
- **Territorial Claims:** Scarborough Reef (Maritime Feature); Spratly Islands (Maritime Feature)

### US Naval Base Guantanamo Bay (Strategic Region)

- **Claimant:** Republic of Cuba (disputes the lease’s continued legitimacy)

### Western Sahara (Geopolitical Entity)

- **Claimants:** Kingdom of Morocco; Sahrawi Arab Democratic Republic (Polisario Front)

---

## All UN Member States (193)

### Afghanistan

- **Territorial Claims:** None

### Albania

- **Territorial Claims:** None

### Algeria

- **Territorial Claims:** None

### Andorra

- **Territorial Claims:** None

### Angola

- **Territorial Claims:** None

### Antigua and Barbuda

- **Territorial Claims:** None

### Argentina

- **Territorial Claims:** Antarctica (Geographic Region); Falkland Islands (Territory); South Georgia and South Sandwich Islands (Territory)

### Armenia

- **Territorial Claims:** None

### Australia

- **Territorial Claims:** Antarctica (Geographic Region)

### Austria

- **Territorial Claims:** None

### Azerbaijan

- **Territorial Claims:** None

### Bahamas

- **Territorial Claims:** None

### Bahrain

- **Territorial Claims:** None

### Bangladesh

- **Territorial Claims:** None

### Barbados

- **Territorial Claims:** None

### Belarus

- **Territorial Claims:** None

### Belgium

- **Territorial Claims:** None

### Belize

- **Territorial Claims:** None

### Benin

- **Territorial Claims:** None

### Bhutan

- **Territorial Claims:** None

### Bolivia

- **Territorial Claims:** None

### Bosnia and Herzegovina

- **Territorial Claims:** None

### Botswana

- **Territorial Claims:** None

### Brazil

- **Territorial Claims:** None

### Brunei

- **Territorial Claims:** Spratly Islands (Maritime Feature)

### Bulgaria

- **Territorial Claims:** None

### Burkina Faso

- **Territorial Claims:** None

### Burundi

- **Territorial Claims:** None

### Cabo Verde

- **Territorial Claims:** None

### Cambodia

- **Territorial Claims:** None

### Cameroon

- **Territorial Claims:** None

### Canada

- **Territorial Claims:** None

### Central African Republic

- **Territorial Claims:** None

### Chad

- **Territorial Claims:** None

### Chile

- **Territorial Claims:** Antarctica (Geographic Region)

### China

- **Territorial Claims:** Scarborough Reef (Maritime Feature); Spratly Islands (Maritime Feature); Taiwan (Geopolitical Entity)

### Colombia

- **Territorial Claims:** Bajo Nuevo Bank (Maritime Feature); Serranilla Bank (Maritime Feature)

### Comoros

- **Territorial Claims:** None

### Congo

- **Territorial Claims:** None

### Costa Rica

- **Territorial Claims:** None

### Côte d'Ivoire

- **Territorial Claims:** None

### Croatia

- **Territorial Claims:** None

### Cuba

- **Territorial Claims:** US Naval Base Guantanamo Bay (Strategic Region)

### Cyprus

- **Territorial Claims:** Akrotiri (Strategic Region); Dhekelia (Strategic Region)

### Czechia

- **Territorial Claims:** None

### Democratic Republic of the Congo

- **Territorial Claims:** None

### Denmark

- **Territorial Claims:** None

### Djibouti

- **Territorial Claims:** None

### Dominica

- **Territorial Claims:** None

### Dominican Republic

- **Territorial Claims:** None

### Ecuador

- **Territorial Claims:** None

### Egypt

- **Territorial Claims:** None

### El Salvador

- **Territorial Claims:** None

### Equatorial Guinea

- **Territorial Claims:** None

### Eritrea

- **Territorial Claims:** None

### Estonia

- **Territorial Claims:** None

### Eswatini

- **Territorial Claims:** None

### Ethiopia

- **Territorial Claims:** None

### Fiji

- **Territorial Claims:** None

### Finland

- **Territorial Claims:** None

### France

- **Territorial Claims:** Antarctica (Geographic Region)

### Gabon

- **Territorial Claims:** None

### Gambia

- **Territorial Claims:** None

### Georgia

- **Territorial Claims:** None

### Germany

- **Territorial Claims:** None

### Ghana

- **Territorial Claims:** None

### Greece

- **Territorial Claims:** None

### Grenada

- **Territorial Claims:** None

### Guatemala

- **Territorial Claims:** None

### Guinea

- **Territorial Claims:** None

### Guinea-Bissau

- **Territorial Claims:** None

### Guyana

- **Territorial Claims:** None

### Haiti

- **Territorial Claims:** None

### Honduras

- **Territorial Claims:** None

### Hungary

- **Territorial Claims:** None

### Iceland

- **Territorial Claims:** None

### India

- **Territorial Claims:** Siachen Glacier (Strategic Region)

### Indonesia

- **Territorial Claims:** None

### Iran

- **Territorial Claims:** None

### Iraq

- **Territorial Claims:** None

### Ireland

- **Territorial Claims:** None

### Israel

- **Territorial Claims:** Palestine (Geopolitical Entity)

### Italy

- **Territorial Claims:** None

### Jamaica

- **Territorial Claims:** Bajo Nuevo Bank (Maritime Feature); Serranilla Bank (Maritime Feature)

### Japan

- **Territorial Claims:** None

### Jordan

- **Territorial Claims:** None

### Kazakhstan

- **Territorial Claims:** None

### Kenya

- **Territorial Claims:** None

### Kiribati

- **Territorial Claims:** None

### Kuwait

- **Territorial Claims:** None

### Kyrgyzstan

- **Territorial Claims:** None

### Laos

- **Territorial Claims:** None

### Latvia

- **Territorial Claims:** None

### Lebanon

- **Territorial Claims:** None

### Lesotho

- **Territorial Claims:** None

### Liberia

- **Territorial Claims:** None

### Libya

- **Territorial Claims:** None

### Liechtenstein

- **Territorial Claims:** None

### Lithuania

- **Territorial Claims:** None

### Luxembourg

- **Territorial Claims:** None

### Madagascar

- **Territorial Claims:** French Southern and Antarctic Lands (Territory)

### Malawi

- **Territorial Claims:** None

### Malaysia

- **Territorial Claims:** Spratly Islands (Maritime Feature)

### Maldives

- **Territorial Claims:** None

### Mali

- **Territorial Claims:** None

### Malta

- **Territorial Claims:** None

### Marshall Islands

- **Territorial Claims:** None

### Mauritania

- **Territorial Claims:** None

### Mauritius

- **Territorial Claims:** British Indian Ocean Territory (Territory); French Southern and Antarctic Lands (Territory)

### Mexico

- **Territorial Claims:** None

### Micronesia

- **Territorial Claims:** None

### Moldova

- **Territorial Claims:** None

### Monaco

- **Territorial Claims:** None

### Mongolia

- **Territorial Claims:** None

### Montenegro

- **Territorial Claims:** None

### Morocco

- **Territorial Claims:** Western Sahara (Geopolitical Entity)

### Mozambique

- **Territorial Claims:** None

### Myanmar

- **Territorial Claims:** None

### Namibia

- **Territorial Claims:** None

### Nauru

- **Territorial Claims:** None

### Nepal

- **Territorial Claims:** None

### Netherlands

- **Territorial Claims:** None

### New Zealand

- **Territorial Claims:** Antarctica (Geographic Region)

### Nicaragua

- **Territorial Claims:** None

### Niger

- **Territorial Claims:** None

### Nigeria

- **Territorial Claims:** None

### North Korea

- **Territorial Claims:** None

### North Macedonia

- **Territorial Claims:** None

### Norway

- **Territorial Claims:** Antarctica (Geographic Region)

### Oman

- **Territorial Claims:** None

### Pakistan

- **Territorial Claims:** Siachen Glacier (Strategic Region)

### Palau

- **Territorial Claims:** None

### Panama

- **Territorial Claims:** None

### Papua New Guinea

- **Territorial Claims:** None

### Paraguay

- **Territorial Claims:** None

### Peru

- **Territorial Claims:** None

### Philippines

- **Territorial Claims:** Scarborough Reef (Maritime Feature); Spratly Islands (Maritime Feature)

### Poland

- **Territorial Claims:** None

### Portugal

- **Territorial Claims:** None

### Qatar

- **Territorial Claims:** None

### Romania

- **Territorial Claims:** None

### Russia

- **Territorial Claims:** Crimea (Territory)

### Rwanda

- **Territorial Claims:** None

### Saint Kitts and Nevis

- **Territorial Claims:** None

### Saint Lucia

- **Territorial Claims:** None

### Saint Vincent and the Grenadines

- **Territorial Claims:** None

### Samoa

- **Territorial Claims:** None

### San Marino

- **Territorial Claims:** None

### Sao Tome and Principe

- **Territorial Claims:** None

### Saudi Arabia

- **Territorial Claims:** None

### Senegal

- **Territorial Claims:** None

### Serbia

- **Territorial Claims:** Kosovo (Geopolitical Entity)

### Seychelles

- **Territorial Claims:** None

### Sierra Leone

- **Territorial Claims:** None

### Singapore

- **Territorial Claims:** None

### Slovakia

- **Territorial Claims:** None

### Slovenia

- **Territorial Claims:** None

### Solomon Islands

- **Territorial Claims:** None

### Somalia

- **Territorial Claims:** None

### South Africa

- **Territorial Claims:** None

### South Korea

- **Territorial Claims:** None

### South Sudan

- **Territorial Claims:** None

### Spain

- **Territorial Claims:** Gibraltar (Territory)

### Sri Lanka

- **Territorial Claims:** None

### Sudan

- **Territorial Claims:** None

### Suriname

- **Territorial Claims:** None

### Sweden

- **Territorial Claims:** None

### Switzerland

- **Territorial Claims:** None

### Syria

- **Territorial Claims:** None

### Tajikistan

- **Territorial Claims:** None

### Tanzania

- **Territorial Claims:** None

### Thailand

- **Territorial Claims:** None

### Timor-Leste

- **Territorial Claims:** None

### Togo

- **Territorial Claims:** None

### Tonga

- **Territorial Claims:** None

### Trinidad and Tobago

- **Territorial Claims:** None

### Tunisia

- **Territorial Claims:** None

### Turkey

- **Territorial Claims:** None

### Turkmenistan

- **Territorial Claims:** None

### Tuvalu

- **Territorial Claims:** None

### Uganda

- **Territorial Claims:** None

### Ukraine

- **Territorial Claims:** Crimea (Territory)

### United Arab Emirates

- **Territorial Claims:** None

### United Kingdom

- **Territorial Claims:** Antarctica (Geographic Region)

### United States of America

- **Territorial Claims:** Bajo Nuevo Bank (Maritime Feature); Serranilla Bank (Maritime Feature)

### Uruguay

- **Territorial Claims:** None

### Uzbekistan

- **Territorial Claims:** None

### Vanuatu

- **Territorial Claims:** None

### Venezuela

- **Territorial Claims:** None

### Vietnam

- **Territorial Claims:** Spratly Islands (Maritime Feature)

### Yemen

- **Territorial Claims:** None

### Zambia

- **Territorial Claims:** None

### Zimbabwe

- **Territorial Claims:** None

---

## All Registered GeoEntities (56)

### Akrotiri (Strategic Region)

- **Sovereign State:** None
- **Administering Power:** United Kingdom (Sovereign Base Area) (since 1960)
- **Claimant:** Republic of Cyprus
- **Territorial Claims:** None

### Åland (Territory)

- **Sovereign State:** Republic of Finland
- **Administering Power:** Republic of Finland
- **Claimant:** None
- **Territorial Claims:** None

### American Samoa (Territory)

- **Sovereign State:** United States of America
- **Administering Power:** United States of America
- **Claimant:** None
- **Territorial Claims:** None

### Anguilla (Territory)

- **Sovereign State:** United Kingdom
- **Administering Power:** United Kingdom
- **Claimant:** None
- **Territorial Claims:** None

### Antarctica (Geographic Region)

- **Sovereign State:** None
- **Administering Power:** None
- **Claimants:** Argentine Republic (claim suspended under the Antarctic Treaty); Commonwealth of Australia (claim suspended under the Antarctic Treaty); Republic of Chile (claim suspended under the Antarctic Treaty); French Republic (claim suspended under the Antarctic Treaty); New Zealand (claim suspended under the Antarctic Treaty); Kingdom of Norway (claim suspended under the Antarctic Treaty); United Kingdom (claim suspended under the Antarctic Treaty)
- **Territorial Claims:** None

### Aruba (Territory)

- **Sovereign State:** Kingdom of the Netherlands
- **Administering Power:** Kingdom of the Netherlands
- **Claimant:** None
- **Territorial Claims:** None

### Baikonur (Strategic Region)

- **Sovereign State:** None
- **Administering Power:** Russian Federation (leased spaceport complex) (since 1994)
- **Claimant:** None
- **Territorial Claims:** None

### Bajo Nuevo Bank (Maritime Feature)

- **Sovereign State:** None
- **Administering Power:** Republic of Colombia
- **Claimants:** Republic of Colombia; Jamaica; United States of America (since 1856)
- **Territorial Claims:** None

### Bermuda (Territory)

- **Sovereign State:** United Kingdom
- **Administering Power:** United Kingdom
- **Claimant:** None
- **Territorial Claims:** None

### British Indian Ocean Territory (Territory)

- **Sovereign State:** United Kingdom
- **Administering Power:** United Kingdom
- **Claimant:** Republic of Mauritius
- **Territorial Claims:** None

### British Virgin Islands (Territory)

- **Sovereign State:** United Kingdom
- **Administering Power:** United Kingdom
- **Claimant:** None
- **Territorial Claims:** None

### Cayman Islands (Territory)

- **Sovereign State:** United Kingdom
- **Administering Power:** United Kingdom
- **Claimant:** None
- **Territorial Claims:** None

### Cook Islands (Territory)

- **Sovereign State:** New Zealand
- **Administering Power:** New Zealand
- **Claimant:** None
- **Territorial Claims:** None

### Crimea (Territory)

- **Sovereign State:** None
- **Administering Power:** Russian Federation (de facto administration since 2014) (since 2014)
- **Claimants:** Ukraine; Russian Federation (since 2014)
- **Territorial Claims:** None

### Curaçao (Territory)

- **Sovereign State:** Kingdom of the Netherlands
- **Administering Power:** Kingdom of the Netherlands
- **Claimant:** None
- **Territorial Claims:** None

### Cyprus UN Buffer Zone (Strategic Region)

- **Sovereign State:** None
- **Administering Power:** United Nations Peacekeeping Force in Cyprus (UNFICYP) (since 1974)
- **Claimant:** None
- **Territorial Claims:** None

### Dhekelia (Strategic Region)

- **Sovereign State:** None
- **Administering Power:** United Kingdom (Sovereign Base Area) (since 1960)
- **Claimant:** Republic of Cyprus
- **Territorial Claims:** None

### Falkland Islands (Territory)

- **Sovereign State:** United Kingdom
- **Administering Power:** United Kingdom
- **Claimant:** Argentine Republic
- **Territorial Claims:** None

### Faroe Islands (Territory)

- **Sovereign State:** Kingdom of Denmark
- **Administering Power:** Kingdom of Denmark
- **Claimant:** None
- **Territorial Claims:** None

### French Polynesia (Territory)

- **Sovereign State:** French Republic
- **Administering Power:** French Republic
- **Claimant:** None
- **Territorial Claims:** None

### French Southern and Antarctic Lands (Territory)

- **Sovereign State:** French Republic
- **Administering Power:** French Republic
- **Claimants:** Republic of Madagascar (claims the Îles Éparses/Scattered Islands); Republic of Mauritius (claims Tromelin Island)
- **Territorial Claims:** None

### Gibraltar (Territory)

- **Sovereign State:** United Kingdom
- **Administering Power:** United Kingdom
- **Claimant:** Kingdom of Spain
- **Territorial Claims:** None

### Greenland (Territory)

- **Sovereign State:** Kingdom of Denmark
- **Administering Power:** Kingdom of Denmark
- **Claimant:** None
- **Territorial Claims:** None

### Guam (Territory)

- **Sovereign State:** United States of America
- **Administering Power:** United States of America
- **Claimant:** None
- **Territorial Claims:** None

### Guernsey (Territory)

- **Sovereign State:** United Kingdom
- **Administering Power:** United Kingdom
- **Claimant:** None
- **Territorial Claims:** None

### Heard Island and McDonald Islands (Territory)

- **Sovereign State:** Commonwealth of Australia
- **Administering Power:** Commonwealth of Australia
- **Claimant:** None
- **Territorial Claims:** None

### Hong Kong (Territory)

- **Sovereign State:** People's Republic of China
- **Administering Power:** People's Republic of China
- **Claimant:** None
- **Territorial Claims:** None

### Isle of Man (Territory)

- **Sovereign State:** United Kingdom
- **Administering Power:** United Kingdom
- **Claimant:** None
- **Territorial Claims:** None

### Jersey (Territory)

- **Sovereign State:** United Kingdom
- **Administering Power:** United Kingdom
- **Claimant:** None
- **Territorial Claims:** None

### Kosovo (Geopolitical Entity)

- **Sovereign State:** None
- **Administering Power:** Government of the Republic of Kosovo (since 2008)
- **Claimant:** Republic of Serbia
- **Territorial Claims:** None

### Macao (Territory)

- **Sovereign State:** People's Republic of China
- **Administering Power:** People's Republic of China
- **Claimant:** None
- **Territorial Claims:** None

### Montserrat (Territory)

- **Sovereign State:** United Kingdom
- **Administering Power:** United Kingdom
- **Claimant:** None
- **Territorial Claims:** None

### New Caledonia (Territory)

- **Sovereign State:** French Republic
- **Administering Power:** French Republic
- **Claimant:** None
- **Territorial Claims:** None

### Niue (Territory)

- **Sovereign State:** New Zealand
- **Administering Power:** New Zealand
- **Claimant:** None
- **Territorial Claims:** None

### Norfolk Island (Territory)

- **Sovereign State:** Commonwealth of Australia
- **Administering Power:** Commonwealth of Australia
- **Claimant:** None
- **Territorial Claims:** None

### Northern Mariana Islands (Territory)

- **Sovereign State:** United States of America
- **Administering Power:** United States of America
- **Claimant:** None
- **Territorial Claims:** None

### Palestine (Geopolitical Entity)

- **Sovereign State:** None
- **Administering Power:** Palestinian Authority
- **Claimant:** State of Israel
- **Territorial Claims:** None

### Pitcairn Islands (Territory)

- **Sovereign State:** United Kingdom
- **Administering Power:** United Kingdom
- **Claimant:** None
- **Territorial Claims:** None

### Puerto Rico (Territory)

- **Sovereign State:** United States of America
- **Administering Power:** United States of America
- **Claimant:** None
- **Territorial Claims:** None

### Saint Barthélemy (Territory)

- **Sovereign State:** French Republic
- **Administering Power:** French Republic
- **Claimant:** None
- **Territorial Claims:** None

### Saint Helena (Territory)

- **Sovereign State:** United Kingdom
- **Administering Power:** United Kingdom
- **Claimant:** None
- **Territorial Claims:** None

### Saint Martin (Territory)

- **Sovereign State:** French Republic
- **Administering Power:** French Republic
- **Claimant:** None
- **Territorial Claims:** None

### Saint Pierre and Miquelon (Territory)

- **Sovereign State:** French Republic
- **Administering Power:** French Republic
- **Claimant:** None
- **Territorial Claims:** None

### Scarborough Reef (Maritime Feature)

- **Sovereign State:** None
- **Administering Power:** None
- **Claimants:** People's Republic of China; Republic of the Philippines; Taiwan
- **Territorial Claims:** None

### Serranilla Bank (Maritime Feature)

- **Sovereign State:** None
- **Administering Power:** Republic of Colombia
- **Claimants:** Republic of Colombia; United States of America (since 1856); Jamaica
- **Territorial Claims:** None

### Siachen Glacier (Strategic Region)

- **Sovereign State:** None
- **Administering Power:** Republic of India (controls most of the glacier)
- **Claimants:** Republic of India; Islamic Republic of Pakistan
- **Territorial Claims:** None

### Sint Maarten (Territory)

- **Sovereign State:** Kingdom of the Netherlands
- **Administering Power:** Kingdom of the Netherlands
- **Claimant:** None
- **Territorial Claims:** None

### South Georgia and South Sandwich Islands (Territory)

- **Sovereign State:** United Kingdom
- **Administering Power:** United Kingdom
- **Claimant:** Argentine Republic
- **Territorial Claims:** None

### Spratly Islands (Maritime Feature)

- **Sovereign State:** None
- **Administering Power:** None
- **Claimants:** People's Republic of China; Socialist Republic of Vietnam; Republic of the Philippines; Malaysia; Brunei Darussalam; Taiwan
- **Territorial Claims:** None

### Taiwan (Geopolitical Entity)

- **Sovereign State:** None
- **Administering Power:** Government of the Republic of China (Taiwan) (since 1949)
- **Claimant:** People's Republic of China
- **Territorial Claims:** Scarborough Reef (Maritime Feature); Spratly Islands (Maritime Feature)

### Turks and Caicos Islands (Territory)

- **Sovereign State:** United Kingdom
- **Administering Power:** United Kingdom
- **Claimant:** None
- **Territorial Claims:** None

### U.S. Minor Outlying Islands (Territory)

- **Sovereign State:** United States of America
- **Administering Power:** United States of America
- **Claimant:** None
- **Territorial Claims:** None

### U.S. Virgin Islands (Territory)

- **Sovereign State:** United States of America
- **Administering Power:** United States of America
- **Claimant:** None
- **Territorial Claims:** None

### US Naval Base Guantanamo Bay (Strategic Region)

- **Sovereign State:** None
- **Administering Power:** United States (naval base, under an indefinite lease) (since 1903)
- **Claimant:** Republic of Cuba (disputes the lease’s continued legitimacy)
- **Territorial Claims:** None

### Wallis and Futuna Islands (Territory)

- **Sovereign State:** French Republic
- **Administering Power:** French Republic
- **Claimant:** None
- **Territorial Claims:** None

### Western Sahara (Geopolitical Entity)

- **Sovereign State:** None
- **Administering Power:** Kingdom of Morocco (since 1975); Sahrawi Arab Democratic Republic (Polisario Front) (since 1976)
- **Claimants:** Kingdom of Morocco; Sahrawi Arab Democratic Republic (Polisario Front)
- **Territorial Claims:** None

