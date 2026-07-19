import { useEffect, type ReactNode } from 'react'
import { getLayerDefinitions } from './layerRegistry'
import { useLayerEnabledMap } from './layerStore'
import { LayerErrorBoundary } from './LayerErrorBoundary'

function LayerLifecycle({ layerId, children }: { layerId: string; children: ReactNode }) {
  useEffect(() => {
    console.info(`[LayerEngine] "${layerId}" mounted`)
    return () => console.info(`[LayerEngine] "${layerId}" unmounted`)
  }, [layerId])

  return <>{children}</>
}

// Mounts/unmounts each registered layer's component based on its enabled
// state in layerStore — this is the seam the Rendering Engine delegates to
// instead of knowing about individual visualization systems. Globe.tsx
// renders <LayerEngine /> (which renders this) once and never again touches
// layer-specific code, no matter how many layers get registered later.
export function LayerManager() {
  const enabledMap = useLayerEnabledMap()
  const definitions = getLayerDefinitions()

  return (
    <group>
      {definitions.map((def) => {
        const isEnabled = enabledMap[def.id] ?? def.defaultEnabled
        if (!isEnabled) return null

        const LayerComponent = def.component
        return (
          <LayerErrorBoundary key={def.id} layerId={def.id}>
            <LayerLifecycle layerId={def.id}>
              <LayerComponent />
            </LayerLifecycle>
          </LayerErrorBoundary>
        )
      })}
    </group>
  )
}
