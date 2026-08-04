import L from 'leaflet'
import type { NationalWeatherAlarm } from '../features/national-alarms/nationalAlarmTypes'

function esc(value: string) { return value.replace(/[&<>'"]/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[char]!)) }
function markerHtml(alarm: NationalWeatherAlarm, selected: boolean) {
  const image = alarm.iconUrl ? `<img src="${esc(alarm.iconUrl)}" alt="" referrerpolicy="no-referrer">` : '<span aria-hidden="true">⚠</span>'
  return `<button type="button" class="national-alarm-marker ${selected ? 'selected' : ''}" data-national-alarm-id="${esc(alarm.id)}" aria-label="${esc(alarm.title)}">${image}</button>`
}
export interface NationalAlarmLayerCallbacks {
  onOpen(alarm: NationalWeatherAlarm, point: { x: number; y: number }): void
}
export function createNationalAlarmLayerController(map: L.Map, callbacks: NationalAlarmLayerCallbacks) {
  // Place alerts above geographic labels/annotations (450), beneath Vue popups (1040).
  // Otherwise base-map text and parcel labels can visually cut through the official icon.
  const pane = map.getPane('nationalAlarmPane') ?? map.createPane('nationalAlarmPane'); pane.style.zIndex = '460'
  const layer = L.layerGroup().addTo(map)
  function render(alarms: readonly NationalWeatherAlarm[], selectedId: string | null) {
    layer.clearLayers(); const offsets = new Map<string, number>()
    for (const alarm of alarms) {
      const point = alarm.mapLocation.point; if (!point) continue
      const index = offsets.get(alarm.adminCode ?? alarm.id) ?? 0; offsets.set(alarm.adminCode ?? alarm.id, index + 1)
      const marker = L.marker([point[1], point[0]], { pane: 'nationalAlarmPane', bubblingMouseEvents: false, keyboard: true, icon: L.divIcon({ className: 'national-alarm-marker-wrap', iconSize: [34, 26], iconAnchor: [17 - index * 7, 13], html: markerHtml(alarm, selectedId === alarm.id) }) })
      const open = () => { const p = map.latLngToContainerPoint(marker.getLatLng()); callbacks.onOpen(alarm, { x: p.x, y: p.y }) }
      // A marker only opens details on explicit activation; it must not react
      // to hover or focus because the popup stays open until Esc or its close button.
      marker.on('click', (event) => { L.DomEvent.stopPropagation(event.originalEvent); open() })
      marker.addTo(layer)
    }
  }
  const clear = () => layer.clearLayers()
  return { render, clear, destroy: clear }
}
