// CC BY 4.0 / ODbL both require a persistent, visible credit — not just
// discoverable in a submenu. This is the first data-attribution UI this
// app has ever needed: every prior source (Natural Earth, Census TIGER,
// StatCan, World Bank WDI) is public domain or otherwise doesn't require
// display attribution — see city-boundaries-architecture.md's Open Items.
//
// Bottom-right: the one HUD corner nothing else claims (bottom-left is
// Telemetry/LegendPanel's stack — see App.tsx's own comment on why;
// TopNav owns the top edge; IntelligencePanel claims the right edge only
// while something's selected) — and it's the universal web-map
// attribution convention (Leaflet/Mapbox/Google Maps all default there).
//
// Mounted in App.tsx as of 2026-09-04, alongside migration plan step 3
// (CityLabels.tsx/CityOutlineHighlight.tsx going live for Jordan/Kuwait/US)
// — that's the point real OSM- and geoBoundaries-sourced polygons, plus
// GeoNames-sourced points, first actually render on screen. Add a fourth
// entry here (or widen scope, not license, on these three) if the other
// 190-country pass introduces a new source.
interface AttributionEntry {
  label: string
  url: string
}

const ATTRIBUTIONS: AttributionEntry[] = [
  { label: 'GeoNames', url: 'https://www.geonames.org/' },
  { label: 'OpenStreetMap', url: 'https://www.openstreetmap.org/copyright' },
  { label: 'geoBoundaries', url: 'https://www.geoboundaries.org/' },
]

export function AttributionCredit() {
  if (ATTRIBUTIONS.length === 0) return null

  return (
    <div className="pointer-events-none fixed bottom-2 right-3 z-20 flex gap-3 font-mono text-[9px] text-[#5a79ab]">
      {ATTRIBUTIONS.map((a) => (
        <a
          key={a.url}
          href={a.url}
          target="_blank"
          rel="noreferrer"
          className="pointer-events-auto opacity-70 transition-opacity hover:text-[#dce8fb] hover:opacity-100 hover:underline"
        >
          {a.label}
        </a>
      ))}
    </div>
  )
}
