import L from 'leaflet'
import type { Feature, FeatureCollection } from 'geojson'
import type { ManualBatchKind } from '../features/parcels/manualBatchState'
import type { ParcelId, ParcelMode } from '../features/parcels/parcelTypes'
import {
  MANUAL_PARCEL_STYLE,
  MANUAL_PENDING_STYLE,
  PARCEL_EDIT_STYLE,
  PARCEL_HIDDEN_STYLE,
  PARCEL_HOVER_STYLE,
  PARCEL_PENDING_HIDE_STYLE,
  PARCEL_PENDING_RESTORE_STYLE,
  PARCEL_STYLE,
} from '../features/parcels/parcelStyles'
import type { ManualParcelFeature } from '../utils/manualParcelStorage'

const M2_PER_MU = 2000 / 3
const PARCEL_AREA_LABEL_MIN_ZOOM = 18.5

export interface ParcelLayerSnapshot {
  mode: ParcelMode
  parcelOn: boolean
  parcelSource: FeatureCollection | null
  manualParcels: ManualParcelFeature[]
  pendingManualParcels: ManualParcelFeature[]
  pendingManualEdits: ManualParcelFeature[]
  removedManualIds: string[]
  editingManualOriginalId: string | null
  editingPendingManualId: string | null
  editingBatchKind: ManualBatchKind | null
  hiddenIds: ReadonlySet<ParcelId>
  pendingHideIds: ReadonlySet<ParcelId>
  pendingRestoreIds: ReadonlySet<ParcelId>
}

export interface ParcelLayerCallbacks {
  parcelId(feature: Feature): ParcelId | null
  onFilterToggle(id: ParcelId): void
  onEditExisting(feature: ManualParcelFeature): void
  onEditPending(feature: ManualParcelFeature): void
  onAfterRender(): void
}

export interface ParcelLayerMetrics {
  parcelVisible: boolean
  hiddenCount: number
  displayCount: number
  displayAreaMu: number
}

export function createParcelLayerController(
  map: L.Map,
  getState: () => ParcelLayerSnapshot,
  callbacks: ParcelLayerCallbacks,
) {
  let parcelLayer: L.GeoJSON | null = null
  let manualParcelLayer: L.GeoJSON | null = null
  let pendingManualLayer: L.GeoJSON | null = null
  let batchAreaLabelLayer: L.LayerGroup | null = null
  let parcelAreaLabelLayer: L.LayerGroup | null = null
  let visible = false

  function editStyle(id: ParcelId | null): L.PathOptions {
    const state = getState()
    if (!id) return PARCEL_EDIT_STYLE
    if (state.pendingRestoreIds.has(id)) return PARCEL_PENDING_RESTORE_STYLE
    if (state.pendingHideIds.has(id)) return PARCEL_PENDING_HIDE_STYLE
    if (state.hiddenIds.has(id)) return PARCEL_HIDDEN_STYLE
    return PARCEL_EDIT_STYLE
  }

  function editActionLabel(id: ParcelId): string {
    const state = getState()
    if (state.hiddenIds.has(id)) {
      return state.pendingRestoreIds.has(id) ? '再次点击取消恢复' : '点击恢复此地块'
    }
    return state.pendingHideIds.has(id) ? '再次点击取消隐藏' : '点击隐藏此地块'
  }

  function areaLabelIcon(areaMu: number, className = '') {
    return L.divIcon({
      className: `parcel-area-label-wrap ${className}`,
      html: `<span class="parcel-area-label">${areaMu.toFixed(2)} 亩</span>`,
      iconSize: undefined,
      iconAnchor: [0, 0],
    })
  }

  function clearRenderedLayers() {
    parcelLayer?.remove()
    manualParcelLayer?.remove()
    pendingManualLayer?.remove()
    if (batchAreaLabelLayer) { batchAreaLabelLayer.remove(); batchAreaLabelLayer = null }
    parcelLayer = null
    manualParcelLayer = null
    pendingManualLayer = null
  }

  function clear() {
    clearRenderedLayers()
    if (parcelAreaLabelLayer) { parcelAreaLabelLayer.remove(); parcelAreaLabelLayer = null }
    visible = false
  }

  function renderBatchAreaLabels(existingManualFeatures: ManualParcelFeature[]) {
    if (batchAreaLabelLayer) { batchAreaLabelLayer.remove(); batchAreaLabelLayer = null }
    batchAreaLabelLayer = L.layerGroup().addTo(map)
    const state = getState()
    const features = [
      ...existingManualFeatures,
      ...state.pendingManualParcels.filter((feature) => feature.properties.id !== state.editingPendingManualId),
    ]
    for (const feature of features) {
      L.marker([feature.properties.label_lat, feature.properties.label_lng], {
        pane: 'parcelLabelPane',
        icon: areaLabelIcon(feature.properties.area_mu, 'batch-area-label'),
        interactive: false,
        keyboard: false,
      }).addTo(batchAreaLabelLayer)
    }
  }

  function updateAreaLabels() {
    parcelAreaLabelLayer?.clearLayers()
    const state = getState()
    if (!visible || !state.parcelOn || map.getZoom() < PARCEL_AREA_LABEL_MIN_ZOOM) return

    if (!parcelAreaLabelLayer) parcelAreaLabelLayer = L.layerGroup().addTo(map)
    const view = map.getBounds().pad(0.05)
    const displayedFeatures: Feature[] = [
      ...(state.parcelSource?.features.filter((feature) => {
        const id = callbacks.parcelId(feature)
        return state.mode === 'filter' || state.mode === 'batch' || state.mode === 'drawing' || id === null || !state.hiddenIds.has(id)
      }) ?? []),
      ...((state.mode === 'batch' || state.mode === 'drawing')
        ? []
        : state.manualParcels.filter((feature) => state.mode === 'filter' || !state.hiddenIds.has(feature.properties.id))),
    ]
    for (const feature of displayedFeatures) {
      const properties = feature.properties ?? {}
      const lng = Number(properties.label_lng)
      const lat = Number(properties.label_lat)
      const areaMu = Number(properties.area_mu)
      if (!Number.isFinite(lng) || !Number.isFinite(lat) || !Number.isFinite(areaMu)) continue
      const point = L.latLng(lat, lng)
      if (!view.contains(point)) continue
      L.marker(point, {
        pane: 'parcelLabelPane',
        icon: areaLabelIcon(areaMu),
        interactive: false,
        keyboard: false,
      }).addTo(parcelAreaLabelLayer)
    }
  }

  function bindFilterInteractions(layer: L.Layer, id: ParcelId) {
    const path = layer as L.Path
    const state = getState()
    const actionClass = state.hiddenIds.has(id) ? 'restore' : 'hide'
    layer.bindTooltip(editActionLabel(id), { sticky: true, direction: 'top', className: `parcel-edit-tooltip ${actionClass}` })
    layer.on('mouseover', () => {
      const current = getState()
      const unchanged = !current.hiddenIds.has(id) && !current.pendingHideIds.has(id)
      path.setStyle(unchanged ? PARCEL_HOVER_STYLE : { ...editStyle(id), color: PARCEL_HOVER_STYLE.color, weight: PARCEL_HOVER_STYLE.weight })
      path.bringToFront()
    })
    layer.on('mouseout', () => path.setStyle(editStyle(id)))
    layer.on('click', (event) => {
      L.DomEvent.stopPropagation(event)
      callbacks.onFilterToggle(id)
      path.setStyle(editStyle(id))
      path.setTooltipContent(editActionLabel(id))
    })
  }

  function render(): ParcelLayerMetrics {
    clearRenderedLayers()
    const state = getState()
    const aiFeatures = state.parcelSource?.features ?? []
    const showHiddenParcels = state.mode === 'filter' || state.mode === 'batch' || state.mode === 'drawing'
    const visibleAiFeatures = aiFeatures.filter((feature) => {
      const id = callbacks.parcelId(feature)
      return showHiddenParcels || id === null || !state.hiddenIds.has(id)
    })
    const displayedAi = aiFeatures.filter((feature) => {
      const id = callbacks.parcelId(feature)
      return id === null || !state.hiddenIds.has(id)
    })
    const displayedManual = state.manualParcels.filter((feature) => !state.hiddenIds.has(feature.properties.id))
    const displayedFeatures: Feature[] = [...displayedAi, ...displayedManual]
    visible = aiFeatures.length > 0 || state.manualParcels.length > 0
    const metrics: ParcelLayerMetrics = {
      parcelVisible: visible,
      hiddenCount: state.hiddenIds.size,
      displayCount: displayedFeatures.length,
      displayAreaMu: displayedFeatures.reduce((total, feature) => {
        const areaM2 = Number(feature.properties?.area_m2)
        if (Number.isFinite(areaM2)) return total + areaM2 / M2_PER_MU
        const areaMu = Number(feature.properties?.area_mu)
        return Number.isFinite(areaMu) ? total + areaMu : total
      }, 0),
    }

    if (visibleAiFeatures.length) {
      const collection: FeatureCollection = { type: 'FeatureCollection', features: visibleAiFeatures }
      parcelLayer = L.geoJSON(collection, {
        interactive: state.mode === 'filter' && state.parcelOn,
        style: (feature) => {
          const current = getState()
          const id = feature ? callbacks.parcelId(feature as Feature) : null
          if (current.mode === 'filter') return editStyle(id)
          if (current.mode === 'batch' || current.mode === 'drawing') {
            return id && current.hiddenIds.has(id) ? PARCEL_HIDDEN_STYLE : PARCEL_EDIT_STYLE
          }
          return current.parcelOn ? PARCEL_STYLE : { ...PARCEL_STYLE, opacity: 0, fillOpacity: 0 }
        },
        onEachFeature: (feature: Feature, layer: L.Layer) => {
          const id = callbacks.parcelId(feature)
          if (state.mode === 'filter' && id) bindFilterInteractions(layer, id)
        },
      }).addTo(map)
    }

    const editedById = new Map(state.pendingManualEdits.map((feature) => [feature.properties.id, feature]))
    const showHiddenManualParcels = state.mode === 'filter' || state.mode === 'batch' || state.mode === 'drawing'
    const visibleManualParcels = state.manualParcels
      .filter((feature) => showHiddenManualParcels || !state.hiddenIds.has(feature.properties.id))
      .filter((feature) => !state.removedManualIds.includes(feature.properties.id))
      .map((feature) => editedById.get(feature.properties.id) ?? feature)
      .filter((feature) => state.mode !== 'editing' || feature.properties.id !== state.editingManualOriginalId)
      .filter((feature) => state.editingBatchKind !== 'existing' || feature.properties.id !== state.editingPendingManualId)

    if (visibleManualParcels.length) {
      const collection: FeatureCollection = { type: 'FeatureCollection', features: visibleManualParcels }
      manualParcelLayer = L.geoJSON(collection, {
        interactive: state.parcelOn && (state.mode === 'batch' || state.mode === 'filter'),
        style: (feature) => {
          const current = getState()
          if (!current.parcelOn) return { ...PARCEL_STYLE, opacity: 0, fillOpacity: 0 }
          const id = feature ? callbacks.parcelId(feature as Feature) : null
          if (current.mode === 'filter') return editStyle(id)
          if (current.mode === 'batch' || current.mode === 'drawing') return MANUAL_PARCEL_STYLE
          return PARCEL_STYLE
        },
        onEachFeature: (feature: Feature, layer: L.Layer) => {
          const manual = feature as ManualParcelFeature
          const id = manual.properties.id
          if (state.mode === 'filter') bindFilterInteractions(layer, id)
          else if (state.mode === 'batch') {
            layer.bindTooltip(`人工绘制 · ${manual.properties.area_mu.toFixed(2)} 亩`, { sticky: true, direction: 'top', className: 'manual-parcel-tooltip' })
            layer.on('click', (event) => {
              if (!getState().parcelOn) return
              L.DomEvent.stopPropagation(event)
              callbacks.onEditExisting(manual)
            })
          }
        },
      }).addTo(map)
    }

    if ((state.mode === 'batch' || state.mode === 'drawing') && state.pendingManualParcels.length) {
      const visiblePending = state.pendingManualParcels.filter((feature) => feature.properties.id !== state.editingPendingManualId)
      if (visiblePending.length) {
        const collection: FeatureCollection = { type: 'FeatureCollection', features: visiblePending }
        pendingManualLayer = L.geoJSON(collection, {
          interactive: state.mode === 'batch',
          style: MANUAL_PENDING_STYLE,
          onEachFeature: (feature: Feature, layer: L.Layer) => {
            const pending = feature as ManualParcelFeature
            layer.bindTooltip(`待保存 · ${pending.properties.area_mu.toFixed(2)} 亩`, { sticky: true, direction: 'top', className: 'manual-parcel-tooltip' })
            layer.on('click', (event) => {
              if (getState().mode !== 'batch') return
              L.DomEvent.stopPropagation(event)
              callbacks.onEditPending(pending)
            })
          },
        }).addTo(map)
      }
    }

    if (state.mode === 'batch' || state.mode === 'drawing') renderBatchAreaLabels(visibleManualParcels)
    updateAreaLabels()
    callbacks.onAfterRender()
    return metrics
  }

  function destroy() {
    clear()
  }

  return { clear, destroy, render, updateAreaLabels }
}

export type ParcelLayerController = ReturnType<typeof createParcelLayerController>
