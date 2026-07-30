import L from 'leaflet'
import type { Position } from 'geojson'
import type { ParcelMode } from '../features/parcels/parcelTypes'
import { MANUAL_DRAFT_STYLE } from '../features/parcels/parcelStyles'
import { prepareManualGeometry } from '../utils/parcelGeometry'

export interface ManualDrawingSnapshot {
  mode: ParcelMode
  points: Position[]
  distinctPointCount: number
  selectedId: string | null
}

export interface ManualDrawingCallbacks {
  onPointAdded(point: Position): void
  onPointMoved(index: number, point: Position): void
  onCloseRequested(): void
  onBlankMapClick(): void
  onRemoveRequested(id: string): void
}

export function createManualDrawingController(
  map: L.Map,
  getState: () => ManualDrawingSnapshot,
  callbacks: ManualDrawingCallbacks,
) {
  let draftLayer: L.Polygon | L.Polyline | null = null
  let vertexLayer: L.LayerGroup | null = null
  let draftAreaMarker: L.Marker | null = null
  let removeActionMarker: L.Marker | null = null

  const onDrawingMapClick = (event: L.LeafletMouseEvent) => {
    if (getState().mode !== 'drawing') return
    callbacks.onPointAdded([event.latlng.lng, event.latlng.lat])
  }

  const onBatchMapClick = () => {
    const state = getState()
    if (state.mode !== 'batch' || !state.selectedId) return
    callbacks.onBlankMapClick()
  }

  function toLatLngs(points: Position[]): L.LatLngExpression[] {
    return points.map(([lng, lat]) => [lat, lng])
  }

  function vertexIcon(first = false) {
    return L.divIcon({
      className: `manual-vertex-icon${first ? ' first' : ''}`,
      html: '<span></span>',
      iconSize: [18, 18],
      iconAnchor: [9, 9],
    })
  }

  function areaLabelIcon(areaMu: number) {
    return L.divIcon({
      className: 'parcel-area-label-wrap batch-area-label',
      html: `<span class="parcel-area-label">${areaMu.toFixed(2)} 亩</span>`,
      iconSize: undefined,
      iconAnchor: [0, 0],
    })
  }

  function clearDraft() {
    if (draftLayer) { draftLayer.remove(); draftLayer = null }
    if (vertexLayer) { vertexLayer.remove(); vertexLayer = null }
    if (draftAreaMarker) { draftAreaMarker.remove(); draftAreaMarker = null }
  }

  function clearRemoveAction() {
    if (removeActionMarker) { removeActionMarker.remove(); removeActionMarker = null }
  }

  function clear() {
    clearDraft()
    clearRemoveAction()
  }

  function renderArea() {
    if (draftAreaMarker) { draftAreaMarker.remove(); draftAreaMarker = null }
    const prepared = prepareManualGeometry(getState().points).prepared
    if (!prepared) return
    draftAreaMarker = L.marker([prepared.labelLat, prepared.labelLng], {
      pane: 'parcelLabelPane',
      icon: areaLabelIcon(prepared.areaMu),
      interactive: false,
      keyboard: false,
      zIndexOffset: 1100,
    }).addTo(map)
  }

  function renderRemoveAction() {
    if (removeActionMarker) { removeActionMarker.remove(); removeActionMarker = null }
    const state = getState()
    if (!state.selectedId) return
    const prepared = prepareManualGeometry(state.points).prepared
    if (!prepared) return
    const geometry = prepared.geometry.coordinates[0].slice(0, -1)
    const bottom = geometry.reduce((current, point) => point[1] < current[1] ? point : current, geometry[0])
    const icon = L.divIcon({
      className: 'pending-remove-icon',
      html: '<button type="button" title="移除此地块" aria-label="移除此人工地块">移除</button>',
      iconSize: [48, 28],
      iconAnchor: [24, -10],
    })
    removeActionMarker = L.marker([bottom[1], bottom[0]], { icon, keyboard: true, zIndexOffset: 1200 }).addTo(map)
    removeActionMarker.on('click', (event) => {
      L.DomEvent.stopPropagation(event)
      callbacks.onRemoveRequested(state.selectedId!)
    })
  }

  function renderDraft(editable: boolean) {
    clearDraft()
    const state = getState()
    if (!state.points.length) return
    draftLayer = editable
      ? L.polygon(toLatLngs(state.points), MANUAL_DRAFT_STYLE).addTo(map)
      : L.polyline(toLatLngs(state.points), { ...MANUAL_DRAFT_STYLE, fill: false }).addTo(map)
    vertexLayer = L.layerGroup().addTo(map)
    state.points.forEach(([lng, lat], index) => {
      const canClose = !editable && index === 0 && state.distinctPointCount >= 3
      const marker = L.marker([lat, lng], {
        icon: vertexIcon(canClose),
        draggable: editable,
        keyboard: editable || canClose,
        title: canClose ? '点击闭合地块' : `顶点 ${index + 1}`,
        interactive: true,
        zIndexOffset: canClose ? 1000 : 0,
      })
      marker.on('click', (event) => {
        L.DomEvent.stopPropagation(event)
        if (canClose) callbacks.onCloseRequested()
      })
      if (editable) {
        marker.on('drag', () => {
          const point = marker.getLatLng()
          callbacks.onPointMoved(index, [point.lng, point.lat])
          ;(draftLayer as L.Polygon | null)?.setLatLngs(toLatLngs(getState().points))
          renderArea()
          renderRemoveAction()
        })
      }
      marker.addTo(vertexLayer!)
    })
    if (editable) renderArea()
  }

  function setInteraction(mode: 'none' | 'batch' | 'drawing') {
    map.off('click', onDrawingMapClick)
    map.off('click', onBatchMapClick)
    if (mode === 'drawing') map.on('click', onDrawingMapClick)
    if (mode === 'batch') map.on('click', onBatchMapClick)
  }

  function destroy() {
    setInteraction('none')
    clear()
  }

  return { clear, clearDraft, clearRemoveAction, destroy, renderDraft, renderRemoveAction, setInteraction }
}

export type ManualDrawingController = ReturnType<typeof createManualDrawingController>
