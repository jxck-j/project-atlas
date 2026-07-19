// Static labels for oceans, seas, gulfs, straits, and bays. There's no
// polygon data for these (world-atlas only ships land/country topology), so
// each is just a name pinned to an approximate open-water point — good
// enough for a label, not meant to imply a precise boundary.

export interface WaterBody {
  name: string
  lat: number
  lng: number
  // Oceans get a slightly larger, more widely-tracked label than smaller
  // seas/gulfs/straits, matching atlas convention.
  kind: 'ocean' | 'sea'
}

export const WATER_BODIES: WaterBody[] = [
  { name: 'PACIFIC OCEAN', lat: 0, lng: -150, kind: 'ocean' },
  { name: 'ATLANTIC OCEAN', lat: 0, lng: -30, kind: 'ocean' },
  { name: 'INDIAN OCEAN', lat: -15, lng: 75, kind: 'ocean' },
  { name: 'SOUTHERN OCEAN', lat: -65, lng: -30, kind: 'ocean' },
  { name: 'ARCTIC OCEAN', lat: 84, lng: 0, kind: 'ocean' },

  { name: 'GULF OF MEXICO', lat: 25, lng: -90, kind: 'sea' },
  { name: 'CARIBBEAN SEA', lat: 15, lng: -75, kind: 'sea' },
  { name: 'MEDITERRANEAN SEA', lat: 34, lng: 18, kind: 'sea' },
  { name: 'BLACK SEA', lat: 43, lng: 35, kind: 'sea' },
  { name: 'RED SEA', lat: 20, lng: 38, kind: 'sea' },
  { name: 'PERSIAN GULF', lat: 26.5, lng: 51.5, kind: 'sea' },
  { name: 'STRAIT OF HORMUZ', lat: 26.5, lng: 56.3, kind: 'sea' },
  { name: 'GULF OF ADEN', lat: 12.5, lng: 47, kind: 'sea' },
  { name: 'ARABIAN SEA', lat: 15, lng: 65, kind: 'sea' },
  { name: 'BAY OF BENGAL', lat: 15, lng: 88, kind: 'sea' },
  { name: 'SOUTH CHINA SEA', lat: 12, lng: 114, kind: 'sea' },
  { name: 'SEA OF JAPAN', lat: 40, lng: 135, kind: 'sea' },
  { name: 'BERING SEA', lat: 58, lng: -178, kind: 'sea' },
  { name: 'GULF OF ALASKA', lat: 58, lng: -145, kind: 'sea' },
  { name: 'HUDSON BAY', lat: 60, lng: -85, kind: 'sea' },
  { name: 'BALTIC SEA', lat: 58, lng: 20, kind: 'sea' },
  { name: 'NORTH SEA', lat: 56, lng: 3, kind: 'sea' },
  { name: 'ENGLISH CHANNEL', lat: 50, lng: -2, kind: 'sea' },
  { name: 'SEA OF OKHOTSK', lat: 55, lng: 150, kind: 'sea' },
  { name: 'CORAL SEA', lat: -15, lng: 155, kind: 'sea' },
  { name: 'TASMAN SEA', lat: -40, lng: 160, kind: 'sea' },
  { name: 'GULF OF GUINEA', lat: 2, lng: 0, kind: 'sea' },
]
