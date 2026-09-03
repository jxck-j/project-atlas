// Build-time asset generator: a global city/populated-place index, from a
// vendored GeoNames export (see scripts/vendor/README.md for provenance).
// Candidate replacement for cities.json's 223-entry curated list — see
// city-boundaries-architecture.md for why (the per-country vendoring plan
// doesn't scale/reach every country) and LOGBOOK.md's 2026-09-03 entries
// for the sourcing investigation this follows from.
//
// NOT yet wired into any component and NOT part of `npm run build:geo` —
// this is the candidate output for inspection/validation (migration plan
// step 3/4 in city-boundaries-architecture.md), run by hand via
// `npm run build:geo:cities-global` until cutover.
//
// Deliberately produces ONLY the lightweight point/population index
// (id/name/lat/lng/population/capital flag/country) — same shape and same
// "index vs geometry" split as us-cities-index.json/buildUsCitiesData.mjs.
// No boundary geometry here; that's a separate script (see
// city-boundaries-architecture.md's migration plan step 2 — geoBoundaries
// primary, direct OSM query only where geoBoundaries doesn't reach
// city-level granularity).
import fs from 'node:fs'
import { feature } from 'topojson-client'
import { readZipEntry } from './lib/zip.mjs'
import { ALPHA3_TO_NUMERIC } from './lib/iso3166.mjs'

const CITIES_ZIP = 'scripts/vendor/geonames/cities500.zip'
const CITIES_ENTRY = 'cities500.txt'
const COUNTRY_INFO = 'scripts/vendor/geonames/countryInfo.txt'
const COUNTRIES_SOURCE = 'public/geo/countries-un193.json'
const OUTPUT = 'public/geo/global-cities-index.json'

// GeoNames' own alpha-2 -> alpha-3 bridge (countryInfo.txt) — GeoNames dump
// files key every place by ISO alpha-2, this project's existing
// ALPHA3_TO_NUMERIC table (shared with buildCitiesData.mjs) keys by
// alpha-3, so this is just the missing link between the two, not a
// second/competing country-code table.
const alpha2ToAlpha3 = new Map()
for (const line of fs.readFileSync(COUNTRY_INFO, 'utf8').split('\n')) {
  if (!line || line.startsWith('#')) continue
  const cols = line.split('\t')
  alpha2ToAlpha3.set(cols[0], cols[1])
}

// The set of numeric ISO ids actually registered as UN-member Countries at
// runtime — same pattern as buildCitiesData.mjs, same reason: a place whose
// country doesn't resolve to a real registered Country (Kosovo, Somaliland,
// Taiwan, Western Sahara, ...) gets excluded rather than shipped with a
// parentCountryId that never resolves via getCountry().
const countriesTopo = JSON.parse(fs.readFileSync(COUNTRIES_SOURCE, 'utf8'))
const countryFeatures = feature(countriesTopo, countriesTopo.objects.countries).features
const validCountryIds = new Set(countryFeatures.map((f) => String(f.id)))

const citiesTxt = readZipEntry(fs.readFileSync(CITIES_ZIP), CITIES_ENTRY).toString('utf8')

const entries = []
let skippedNoCountryMatch = 0
let skippedUnresolvedCountry = 0
let skippedNonPopulatedPlace = 0

for (const line of citiesTxt.split('\n')) {
  if (!line) continue
  // geonameid, name, asciiname, alternatenames, lat, lng, feature class,
  // feature code, country code, cc2, admin1, admin2, admin3, admin4,
  // population, elevation, dem, timezone, modification date — see
  // scripts/vendor/README.md's GeoNames entry / the vendored readme.txt
  // for the full column spec.
  const cols = line.split('\t')
  const [geonameid, name, , , lat, lng, featureClass, featureCode, countryCode, , , , , , population] = cols

  if (featureClass !== 'P') {
    skippedNonPopulatedPlace++
    continue
  }

  const alpha3 = alpha2ToAlpha3.get(countryCode)
  const parentCountryId = alpha3 ? ALPHA3_TO_NUMERIC[alpha3] : undefined
  if (!parentCountryId) {
    skippedNoCountryMatch++
    continue
  }
  if (!validCountryIds.has(parentCountryId)) {
    skippedUnresolvedCountry++
    continue
  }

  entries.push({
    id: geonameid,
    name,
    lat: Number(lat),
    lng: Number(lng),
    parentCountryId,
    // Raw GeoNames population — 0 for many small/rural PPL entries, not a
    // gap marker (unlike US CDPs, GeoNames doesn't distinguish "unmeasured"
    // from "genuinely tiny"). The population-floor/reveal logic that reads
    // this stays a render-time concern (see UsCityLabels.tsx's
    // STATE_CAPITAL_FLOOR precedent) — this script doesn't apply one.
    population: Number(population) || 0,
    // PPLC = "seat of a first-order administrative division" per GeoNames'
    // feature code table — i.e. national capital. Generalizes
    // UsCityIndexEntry's isStateCapital the same way city-boundaries-
    // architecture.md's Decision section describes.
    isCapital: featureCode === 'PPLC',
  })
}

const seenIds = new Set()
const dupIds = new Set()
for (const e of entries) {
  if (seenIds.has(e.id)) dupIds.add(e.id)
  seenIds.add(e.id)
}
if (dupIds.size > 0) {
  throw new Error(`[buildGlobalCitiesData] ${dupIds.size} duplicate geonameid(s) in output — source data integrity problem, not expected.`)
}

fs.writeFileSync(OUTPUT, JSON.stringify(entries))

const capitalCount = entries.filter((e) => e.isCapital).length
console.log(`Kept ${entries.length.toLocaleString()} populated places across ${new Set(entries.map((e) => e.parentCountryId)).size} countries (${capitalCount} flagged as national capitals via PPLC).`)
console.log(`Skipped: ${skippedNonPopulatedPlace.toLocaleString()} non-populated-place rows, ${skippedNoCountryMatch.toLocaleString()} with no GeoNames->ISO country match, ${skippedUnresolvedCountry.toLocaleString()} whose country doesn't resolve to a registered UN member.`)

const outputMB = fs.statSync(OUTPUT).size / 1024 / 1024
console.log(`Wrote ${OUTPUT}: ${outputMB.toFixed(1)} MB`)
