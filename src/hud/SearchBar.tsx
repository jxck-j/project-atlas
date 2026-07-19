import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react'
import { Vector3 } from 'three'
import { useCountryFeatures } from '../scene/useCountryFeatures'
import { geometryToCentroid } from '../scene/countryGeometry'
import { latLngToVector3 } from '../utils/geo'
import { GLOBE_RADIUS } from '../scene/constants'
import { getGlobeRotationY } from '../scene/globeRotation'
import { flyToSelectedCountry, selectCountry } from './selectionStore'
import { useHudPanel } from './hudPanelStore'

const UP_AXIS = new Vector3(0, 1, 0)

interface SearchEntry {
  id: string
  name: string
  lat: number
  lng: number
}

export function SearchBar() {
  const isOpen = useHudPanel() === 'search'
  const features = useCountryFeatures()
  const [query, setQuery] = useState('')
  const [notFound, setNotFound] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)

  const entries = useMemo<SearchEntry[]>(() => {
    return features.map((f, index) => {
      const centroid = geometryToCentroid(f.geometry)
      return {
        id: f.id !== undefined && f.id !== null ? String(f.id) : `feature-${index}`,
        name: (f.properties?.name as string) ?? 'Unknown',
        lat: centroid.lat,
        lng: centroid.lng,
      }
    })
  }, [features])

  useEffect(() => {
    if (isOpen) inputRef.current?.focus()
  }, [isOpen])

  if (!isOpen) return null

  function handleSubmit(e: FormEvent) {
    e.preventDefault()
    const q = query.trim().toLowerCase()
    if (!q) return

    const match =
      entries.find((c) => c.name.toLowerCase() === q) ??
      entries.find((c) => c.name.toLowerCase().startsWith(q)) ??
      entries.find((c) => c.name.toLowerCase().includes(q))

    if (!match) {
      setNotFound(true)
      return
    }

    // Same technique as the click handler: project the country's centroid
    // through the globe's CURRENT rotation to get a live world-space
    // direction, since there's no clicked mesh to read localToWorld() from.
    const local = latLngToVector3(match.lat, match.lng, GLOBE_RADIUS)
    const direction = local.applyAxisAngle(UP_AXIS, getGlobeRotationY()).normalize()

    selectCountry({ id: match.id, name: match.name, direction })
    flyToSelectedCountry()
    setQuery('')
    setNotFound(false)
  }

  return (
    <div className="pointer-events-auto fixed top-24 left-4 md:top-28 md:left-8 z-30 w-40 md:w-48">
      <div className="border border-cyan-400/25 bg-cyan-950/25 backdrop-blur-sm px-4 py-3 font-mono">
        <div className="mb-2 text-amber-400/90 tracking-[0.25em] text-[10px] md:text-xs">SEARCH</div>
        <form onSubmit={handleSubmit}>
          <input
            ref={inputRef}
            type="text"
            value={query}
            onChange={(e) => {
              setQuery(e.target.value)
              setNotFound(false)
            }}
            placeholder="COUNTRY NAME..."
            className="w-full border border-cyan-400/25 bg-cyan-950/30 px-2 py-1.5 font-mono text-[11px] tracking-[0.05em] text-cyan-100 placeholder:text-cyan-500/40 outline-none focus:border-cyan-300"
          />
        </form>
        {notFound && (
          <div className="mt-1.5 text-[10px] tracking-[0.1em] text-red-400/80">NOT FOUND</div>
        )}
      </div>
    </div>
  )
}
