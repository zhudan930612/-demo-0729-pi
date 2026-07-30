import L from 'leaflet'
import type { ParcelMode } from '../features/parcels/parcelTypes'

interface ParcelWorkModeOptions {
  defaultMinZoom: number
  editMinZoom: number
  onModeChange(mode: ParcelMode): void
  onMinZoomChange(minZoom: number): void
  stopDrawingInteraction(): void
}

export function createParcelWorkModeController(map: L.Map, options: ParcelWorkModeOptions) {
  let dimLayer: L.Rectangle | null = null

  function enter(mode: ParcelMode, dim = true) {
    options.onModeChange(mode)
    map.setMinZoom(options.editMinZoom)
    options.onMinZoomChange(options.editMinZoom)
    if (dim && !dimLayer) {
      dimLayer = L.rectangle([[-85, -180], [85, 180]], {
        pane: 'editDimmingPane',
        stroke: false,
        fillColor: '#0f172a',
        fillOpacity: 0.34,
        interactive: false,
      }).addTo(map)
    }
  }

  function leave() {
    options.onModeChange('idle')
    options.stopDrawingInteraction()
    map.setMinZoom(options.defaultMinZoom)
    options.onMinZoomChange(options.defaultMinZoom)
    if (dimLayer) { dimLayer.remove(); dimLayer = null }
  }

  function destroy() {
    options.stopDrawingInteraction()
    if (dimLayer) { dimLayer.remove(); dimLayer = null }
  }

  return { destroy, enter, leave }
}

export type ParcelWorkModeController = ReturnType<typeof createParcelWorkModeController>
