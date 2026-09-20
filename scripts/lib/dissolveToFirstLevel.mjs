// Natural Earth's admin-1 layer isn't uniformly a country's FIRST-level
// division: for some countries it models the second level (Spain's provinces,
// Italy's provinces, France's départements, ...) while the row's own `region`
// field names the real first level. This module dissolves those rows into
// one feature per first-level unit, so this app's states layer represents
// every country by the same tier (see LOGBOOK.md 2026-09-19 for how this was
// found, and un193_subnational_architecture.xlsx for the per-country
// reference each entry below was checked against).
//
// A real dissolve via topojson-client's merge(), NOT a MultiPolygon of
// touching polygons — the latter would still draw every child border inside
// the parent.
import { merge } from 'topojson-client'
import { topology } from 'topojson-server'

// Per adm0_a3: `names` maps the source's group key to the English display
// name (every key present in the source MUST be listed — an unmapped key
// throws, so a Natural Earth rename can't silently drop a unit), and the
// optional `keyOf(props)` picks the group key when `region` alone isn't
// enough (defaults to `props.region`).
export const DISSOLVE_CONFIG = {
  ESP: {
    // Keyed by `region`, not `region_cod`: Ceuta and Melilla share "ES.CE".
    names: {
      'Andalucía': 'Andalusia',
      'Aragón': 'Aragon',
      'Asturias': 'Asturias',
      'Islas Baleares': 'Balearic Islands',
      'Valenciana': 'Valencian Community',
      'Canary Is.': 'Canary Islands',
      'Cantabria': 'Cantabria',
      'Castilla-La Mancha': 'Castilla-La Mancha',
      'Castilla y León': 'Castile and León',
      'Cataluña': 'Catalonia',
      'Extremadura': 'Extremadura',
      'Galicia': 'Galicia',
      'La Rioja': 'La Rioja',
      'Madrid': 'Community of Madrid',
      'Murcia': 'Region of Murcia',
      'Foral de Navarra': 'Navarre',
      'País Vasco': 'Basque Country',
      'Ceuta': 'Ceuta',
      'Melilla': 'Melilla',
    },
  },
  ITA: {
    names: {
      "Valle d'Aosta": 'Aosta Valley',
      Piemonte: 'Piedmont',
      Lombardia: 'Lombardy',
      'Trentino-Alto Adige': 'Trentino-Alto Adige',
      Liguria: 'Liguria',
      'Emilia-Romagna': 'Emilia-Romagna',
      Marche: 'Marche',
      Veneto: 'Veneto',
      'Friuli-Venezia Giulia': 'Friuli-Venezia Giulia',
      Abruzzo: 'Abruzzo',
      Molise: 'Molise',
      Apulia: 'Apulia',
      Basilicata: 'Basilicata',
      Calabria: 'Calabria',
      Campania: 'Campania',
      Lazio: 'Lazio',
      Toscana: 'Tuscany',
      Sicily: 'Sicily',
      Sardegna: 'Sardinia',
      Umbria: 'Umbria',
    },
  },
  FRA: {
    // 13 metropolitan regions + 5 overseas regions.
    names: {
      'Guyane française': 'French Guiana',
      'Hauts-de-France': 'Hauts-de-France',
      'Grand Est': 'Grand Est',
      "Provence-Alpes-Côte-d'Azur": "Provence-Alpes-Côte d'Azur",
      'Auvergne-Rhône-Alpes': 'Auvergne-Rhône-Alpes',
      'Nouvelle-Aquitaine': 'Nouvelle-Aquitaine',
      Occitanie: 'Occitania',
      'Bourgogne-Franche-Comté': 'Bourgogne-Franche-Comté',
      'Pays de la Loire': 'Pays de la Loire',
      Bretagne: 'Brittany',
      Normandie: 'Normandy',
      Martinique: 'Martinique',
      Guadeloupe: 'Guadeloupe',
      Réunion: 'Réunion',
      Mayotte: 'Mayotte',
      Corse: 'Corsica',
      'Centre-Val de Loire': 'Centre-Val de Loire',
      'Île-de-France': 'Île-de-France',
    },
  },
  BFA: {
    names: {
      Est: 'East',
      Cascades: 'Cascades',
      'Sud-Ouest': 'South-West',
      Sahel: 'Sahel',
      Nord: 'North',
      'Boucle du Mouhoun': 'Boucle du Mouhoun',
      'Hauts-Bassins': 'Hauts-Bassins',
      'Centre-Est': 'Centre-East',
      'Centre-Sud': 'Centre-South',
      'Centre-Ouest': 'Centre-West',
      'Plateau-Central': 'Plateau-Central',
      Centre: 'Centre',
      'Centre-Nord': 'Centre-North',
    },
  },
  GIN: {
    // 7 regions + Conakry (a special zone), all present in `region`.
    names: {
      Faranah: 'Faranah',
      Kindia: 'Kindia',
      Mamou: 'Mamou',
      Nzérékoré: 'Nzérékoré',
      Kankan: 'Kankan',
      Boke: 'Boké',
      Labé: 'Labé',
      Conakry: 'Conakry',
    },
  },
  LKA: {
    // Natural Earth stores the province names in transliterated Sinhala;
    // each mapping below was checked against its member district count
    // (Eastern 3, Northern 5, North Western 2, Western 3, Southern 3,
    // Sabaragamuwa 2, Uva 2, Central 3, North Central 2 = 25 districts).
    names: {
      'Næ̆gĕnahira paḷāta': 'Eastern',
      'Uturu paḷāta': 'Northern',
      'Vayamba paḷāta': 'North Western',
      'Basnāhira paḷāta': 'Western',
      'Dakuṇu paḷāta': 'Southern',
      'Sabaragamuva paḷāta': 'Sabaragamuwa',
      'Ūva paḷāta': 'Uva',
      'Madhyama paḷāta': 'Central',
      'Uturumæ̆da paḷāta': 'North Central',
    },
  },
  BIH: {
    // 2 entities + the self-governing Brčko District. Natural Earth files
    // Brčko under Republika Srpska's `region`, so it's carved out by name
    // (spelling as in the source) to match the reference file's "2 entities
    // + Brčko District".
    keyOf: (p) => (p.name === 'Brčko Distrikt' ? 'Brcko' : p.region),
    names: {
      'Federacija Bosna i Hercegovina': 'Federation of Bosnia and Herzegovina',
      'Repuplika Srpska': 'Republika Srpska', // sic: the source's own misspelling
      Brcko: 'Brčko District',
    },
  },
  MUS: {
    // 9 districts + the autonomous island of Rodrigues + Agaléga. Natural
    // Earth also carries 5 municipal-city rows as their own tiles (no overlap
    // — checked, they sit beside their district's polygon, not on top of
    // it): Plaines Wilhems' four towns, and Port Louis' urban core, which the
    // source lists as "Port Louis city" next to a separate "Port Louis" row
    // (Port Louis is both a district and the capital city). Each is folded
    // into its district; there's no `region` value to key on, so by name.
    keyOf: (p) =>
      ({
        'Port Louis city': 'Port Louis',
        'Beau Bassin-Rose Hill': 'Plaines Wilhems',
        'Quatre Bornes': 'Plaines Wilhems',
        'Vacoas-Phoenix': 'Plaines Wilhems',
        Curepipe: 'Plaines Wilhems',
      })[p.name] ?? p.name,
    names: {
      'Rivière du Rempart': 'Rivière du Rempart',
      Pamplemousses: 'Pamplemousses',
      'Port Louis': 'Port Louis',
      'Rivière Noire': 'Black River',
      Savanne: 'Savanne',
      'Grand Port': 'Grand Port',
      Flacq: 'Flacq',
      Moka: 'Moka',
      'Plaines Wilhems': 'Plaines Wilhems',
      Rodrigues: 'Rodrigues',
      Agaléga: 'Agaléga',
    },
  },
  GBR: {
    // 232 local authorities -> the 4 constituent countries. Natural Earth's
    // `region` here is a mix of English NUTS1 regions and Scottish/Welsh
    // NUTS2 areas, not the nation, so each is mapped by hand. The names that
    // look ambiguous resolve by member rows: "Eastern" is Scottish (Scottish
    // Borders, Edinburgh, Fife), while "East" is England's East of England
    // (Norfolk, Essex); East/West Wales are both Welsh (the labels are a
    // NUTS2 quirk — Cardiff sits under "West Wales and the Valleys").
    keyOf: (p) =>
      ({
        'Northern Ireland': 'Northern Ireland',
        'West Wales and the Valleys': 'Wales',
        'East Wales': 'Wales',
        Eastern: 'Scotland',
        'South Western': 'Scotland',
        'North Eastern': 'Scotland',
        'Highlands and Islands': 'Scotland',
        'North West': 'England',
        'West Midlands': 'England',
        'South West': 'England',
        'North East': 'England',
        'Yorkshire and the Humber': 'England',
        'East Midlands': 'England',
        East: 'England',
        'South East': 'England',
        'Greater London': 'England',
      })[p.region],
    names: {
      England: 'England',
      Scotland: 'Scotland',
      Wales: 'Wales',
      'Northern Ireland': 'Northern Ireland',
    },
  },
  HUN: {
    // 19 counties + Budapest. Natural Earth also lists the 23 "cities of county
    // rank" (megyei jogú város) as their own "Urban county" rows, tiled beside
    // (often enclosed by) the county they geographically sit in, never
    // overlapping it. Each is folded into its parent county. `region` here is
    // the 7 statistical regions, not a usable key. Every city->county pair was
    // checked against the geometry (the city touches its parent, and no city
    // overlaps any county); Dunaújváros shares more vertices with Bács-Kiskun
    // than Fejér only because the county border follows the Danube on its far
    // bank — it is Fejér County's city. Source spellings ("Gyor", "Gyôr",
    // "Hódmezôvásárhely" with a circumflex) are kept in the keys as-is.
    keyOf: (p) =>
      p.type_en === 'Urban county'
        ? {
            Békéscsaba: 'Békés',
            Debrecen: 'Hajdú-Bihar',
            Dunaújváros: 'Fejér',
            Eger: 'Heves',
            Érd: 'Pest',
            Gyôr: 'Gyor-Moson-Sopron',
            Hódmezôvásárhely: 'Csongrád',
            Kaposvár: 'Somogy',
            Kecskemét: 'Bács-Kiskun',
            Miskolc: 'Borsod-Abaúj-Zemplén',
            Nagykanizsa: 'Zala',
            Nyíregyháza: 'Szabolcs-Szatmár-Bereg',
            Pécs: 'Baranya',
            Salgótarján: 'Nógrád',
            Sopron: 'Gyor-Moson-Sopron',
            Szeged: 'Csongrád',
            Székesfehérvár: 'Fejér',
            Szekszárd: 'Tolna',
            Szolnok: 'Jász-Nagykun-Szolnok',
            Szombathely: 'Vas',
            Tatabánya: 'Komárom-Esztergom',
            Veszprém: 'Veszprém',
            Zalaegerszeg: 'Zala',
          }[p.name]
        : p.name,
    names: {
      Baranya: 'Baranya',
      'Bács-Kiskun': 'Bács-Kiskun',
      Békés: 'Békés',
      'Borsod-Abaúj-Zemplén': 'Borsod-Abaúj-Zemplén',
      Budapest: 'Budapest',
      // Csongrád County was renamed Csongrád-Csanád in 2020; the source predates that.
      Csongrád: 'Csongrád-Csanád',
      Fejér: 'Fejér',
      'Gyor-Moson-Sopron': 'Győr-Moson-Sopron',
      'Hajdú-Bihar': 'Hajdú-Bihar',
      Heves: 'Heves',
      'Jász-Nagykun-Szolnok': 'Jász-Nagykun-Szolnok',
      'Komárom-Esztergom': 'Komárom-Esztergom',
      Nógrád: 'Nógrád',
      Pest: 'Pest',
      Somogy: 'Somogy',
      'Szabolcs-Szatmár-Bereg': 'Szabolcs-Szatmár-Bereg',
      Tolna: 'Tolna',
      Vas: 'Vas',
      Veszprém: 'Veszprém',
      Zala: 'Zala',
    },
  },
  KNA: {
    names: { 'Saint Kitts': 'Saint Kitts', Nevis: 'Nevis' },
  },
  MWI: {
    // Three rows (both "Chitipa" rows, "Machinga") have a null `region` in
    // the source; assigned by name, both districts' regions are unambiguous.
    keyOf: (p) => p.region ?? { Chitipa: 'Northern', Machinga: 'Southern' }[p.name] ?? null,
    names: {
      Northern: 'Northern Region',
      Central: 'Central Region',
      Southern: 'Southern Region',
    },
  },
  MDV: {
    // Natural Earth's 8: the 7 provinces plus Malé, the capital city.
    names: {
      North: 'North Province',
      'Upper North': 'Upper North Province',
      'North Central': 'North Central Province',
      Central: 'Central Province',
      'South Central': 'South Central Province',
      'Upper South': 'Upper South Province',
      South: 'South Province',
      Malé: 'Malé',
    },
  },
}

function slug(name) {
  return name
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^A-Za-z]+/g, '-')
    .replace(/^-|-$/g, '')
}

// Returns `features` with every configured country's rows replaced by one
// dissolved feature per first-level unit. Untouched countries pass through.
export function dissolveToFirstLevel(features) {
  const report = []
  const passthrough = features.filter((f) => !DISSOLVE_CONFIG[f.properties.adm0_a3])
  const dissolved = []

  for (const [a3, config] of Object.entries(DISSOLVE_CONFIG)) {
    const rows = features.filter((f) => f.properties.adm0_a3 === a3)
    if (rows.length === 0) continue

    const topo = topology({ p: { type: 'FeatureCollection', features: rows } })
    const geometries = topo.objects.p.geometries
    const keyOf = config.keyOf ?? ((p) => p.region)
    const groups = new Map()
    rows.forEach((f, i) => {
      const key = keyOf(f.properties)
      if (!key || !config.names[key]) {
        throw new Error(`[dissolveToFirstLevel] ${a3} row "${f.properties.name}" has unmapped group key "${key}".`)
      }
      if (!groups.has(key)) groups.set(key, { first: f, geometries: [] })
      groups.get(key).geometries.push(geometries[i])
    })
    for (const key of Object.keys(config.names)) {
      if (!groups.has(key)) console.warn(`[dissolveToFirstLevel] ${a3}: configured key "${key}" matched no rows.`)
    }

    for (const [key, { first, geometries: group }] of groups) {
      const name = config.names[key]
      dissolved.push({
        type: 'Feature',
        // Fills the `adm1_code` slot the caller derives the feature id from
        // — not a real Natural Earth code; a dissolved unit has none.
        properties: { ...first.properties, adm1_code: `${a3}-${slug(name)}`, name },
        geometry: merge(topo, group),
      })
    }
    report.push(`${a3}: ${rows.length} rows -> ${groups.size}`)
  }

  if (report.length > 0) console.log(`Dissolved to first-level units: ${report.join('; ')}.`)
  return [...passthrough, ...dissolved]
}
