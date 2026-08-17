import { useCallback, useEffect, useRef } from 'react'

// Tracks where a pointer-down started (in screen space) so a drag-to-rotate
// gesture over an entry doesn't get misread as a click-to-select. Its own
// plain .ts module (2026-08-16, extracted out of EntityRenderLayer.tsx)
// for two reasons: oxlint's react-refresh rule flags a hook exported
// alongside components from the same .tsx file (the same rule
// scene/geoEntityEntries.ts was already split out to satisfy), and
// scene/ProvinceFillLayer.tsx needs the exact same click-vs-drag behavior
// EntityRenderLayer.tsx has always used, without duplicating the
// pointerdown listener/threshold logic a second time.
const DEFAULT_CLICK_MOVE_THRESHOLD_PX = 6

// 2026-08-17: wasDragGesture is wrapped in useCallback (stable across
// renders as long as thresholdPx doesn't change, which in practice it
// never does) rather than a fresh closure every call — ProvinceFillLayer.tsx
// passes this down to every active country's <CountryFillMesh>, and an
// unstable reference there defeats React.memo on all of them, forcing
// every one to re-render on every hover change regardless of whether that
// specific country's own props actually changed. See LOGBOOK.md's
// "States/provinces FPS" part 7.
export function useClickDragGuard(thresholdPx: number = DEFAULT_CLICK_MOVE_THRESHOLD_PX) {
  const dragStart = useRef<{ x: number; y: number } | null>(null)

  useEffect(() => {
    const onDown = (e: PointerEvent) => {
      dragStart.current = { x: e.clientX, y: e.clientY }
    }
    window.addEventListener('pointerdown', onDown)
    return () => window.removeEventListener('pointerdown', onDown)
  }, [])

  return useCallback(
    (clientX: number, clientY: number): boolean => {
      const start = dragStart.current
      if (!start) return false
      return Math.hypot(clientX - start.x, clientY - start.y) > thresholdPx
    },
    [thresholdPx]
  )
}
