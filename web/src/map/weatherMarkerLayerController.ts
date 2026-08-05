import L from 'leaflet'
import type { WeatherMarkerItem } from '../stores/weatherMarkers'
import { iconClass } from '../features/weather/weatherAdapter'
import { layoutMarkers, MARKER_SIZE } from './weatherMarkerLayout'
import { WEATHER_PANES } from './weatherLayerController'

export interface WeatherMarkerLayerCallbacks {
  onMarkerClick?(code: string, point: { x: number; y: number }): void
}

function esc(value: string): string {
  return value.replace(/[&<>'"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[c]!))
}
function integer(value: number | null | undefined): string { return value == null ? '--' : String(Math.round(value)) }

/** 由标牌摘要生成 84×34 标牌 HTML：左侧天气图标块，右侧名称与最高/最低温度。 */
export function buildWeatherMarkerHtml(item: WeatherMarkerItem): string {
  const state = item.state
  const failed = state.phase === 'error'
  const code = state.phase === 'ready' ? state.summary?.condition?.code : null
  const condition = state.phase === 'ready' ? state.summary?.condition?.text || '天气' : '天气'
  const high = state.phase === 'ready' ? state.summary?.high : null
  const low = state.phase === 'ready' ? state.summary?.low : null
  const temperature = state.phase === 'ready' ? state.summary?.temperature : null
  const unit = high?.unit ?? temperature?.unit ?? ''
  const range = high || low
    ? `${integer(low?.value)}/${integer(high?.value)}${unit}`
    : temperature?.value != null ? `${integer(temperature.value)}${unit}` : '--'
  const city = failed ? '加载失败' : item.name
  const label = failed
    ? `${item.name} 天气加载失败，点击查看详情和重试`
    : state.phase === 'loading'
      ? `${item.name} 天气加载中`
      : `${item.name}，${condition}，最高${integer(high?.value)}，最低${integer(low?.value ?? temperature?.value)}`
  return `<button type="button" class="weather-marker" aria-label="${esc(label)}"><span class="weather-marker-icon"><i class="${iconClass(code)}" aria-hidden="true"></i></span><span class="weather-marker-detail"><b>${esc(city)}</b><strong>${esc(range)}</strong></span></button>`
}

function markerClassName(item: WeatherMarkerItem, selected: boolean): string {
  const classes = ['weather-marker-wrap', 'seat']
  if (item.state.phase === 'error') classes.push('error')
  if (selected) classes.push('selected')
  return classes.join(' ')
}

/** 省级市级标牌按缩放分层显示：< 6 只显示杭州市；6 ~ 7 显示固定 5 市（金华/宁波/杭州/台州/湖州）；≥ 7 恢复全部 11 个；县级及以下层级不受影响。 */
export const CITY_MIN_ZOOM_FOR_ALL = 7
export const CITY_MIN_ZOOM_FOR_LIMITED = 6
export const CITY_LIMITED_CODES = ['330700', '330200', '330100', '331000', '330500']
export const CITY_NEAREST_CODES = ['330100']
export function limitCityMarkersByZoom(items: WeatherMarkerItem[], zoom: number): WeatherMarkerItem[] {
  const cityItems = items.filter((item) => item.level === 'city')
  if (cityItems.length === 0) return items
  if (zoom >= CITY_MIN_ZOOM_FOR_ALL) return items
  const keepCodes = zoom >= CITY_MIN_ZOOM_FOR_LIMITED ? CITY_LIMITED_CODES : CITY_NEAREST_CODES
  const byCode = new Map(cityItems.map((item) => [item.code, item]))
  const limited = keepCodes.map((code) => byCode.get(code)).filter((item): item is WeatherMarkerItem => Boolean(item))
  const rest = items.filter((item) => item.level !== 'city')
  return [...limited, ...rest]
}

export function createWeatherMarkerLayerController(map: L.Map, callbacks: WeatherMarkerLayerCallbacks = {}) {
  for (const pane of Object.values(WEATHER_PANES)) {
    const element = map.getPane(pane.name) ?? map.createPane(pane.name)
    element.style.zIndex = String(pane.zIndex)
  }
  const layer = L.layerGroup().addTo(map)
  const registry = new Map<string, { marker: L.Marker; seat: L.LatLng; code: string }>()
  const offsets = new Map<string, { dx: number; dy: number }>()
  let selectedCode: string | null = null
  let lastItems: WeatherMarkerItem[] = []

  function applyPositions() {
    if (!registry.size) return
    const inputs = [...registry.entries()].map(([code, entry]) => {
      const point = map.latLngToContainerPoint(entry.seat)
      return { code, x: point.x, y: point.y }
    })
    const layout = layoutMarkers(inputs)
    for (const output of layout) {
      const entry = registry.get(output.code)
      if (!entry) continue
      const latLng = map.containerPointToLatLng(L.point(output.x, output.y))
      entry.marker.setLatLng(latLng)
      offsets.set(output.code, { dx: output.dx, dy: output.dy })
    }
  }
  function render(items: WeatherMarkerItem[], selected: string | null) {
    lastItems = items
    selectedCode = selected
    const visible = limitCityMarkersByZoom(items, map.getZoom())
    const nextCodes = new Set(visible.map((item) => item.code))
    for (const [code, entry] of registry) {
      if (!nextCodes.has(code)) { entry.marker.remove(); registry.delete(code) }
    }
    for (const item of visible) {
      let entry = registry.get(item.code)
      if (!entry) {
        const seat = L.latLng(item.location.lat, item.location.lon)
        const marker = L.marker(seat, { pane: WEATHER_PANES.marker.name, keyboard: true, bubblingMouseEvents: false })
        marker.on('click', (event) => {
          L.DomEvent.stopPropagation(event.originalEvent)
          callbacks.onMarkerClick?.(item.code, displayPoint(item.code) ?? { x: 0, y: 0 })
        })
        entry = { marker, seat, code: item.code }
        registry.set(item.code, entry)
        marker.addTo(layer)
      }
      entry.marker.setIcon(L.divIcon({
        className: markerClassName(item, selectedCode === item.code),
        html: buildWeatherMarkerHtml(item),
        iconSize: [MARKER_SIZE.width, MARKER_SIZE.height],
        iconAnchor: [0, MARKER_SIZE.height],
      }))
    }
    applyPositions()
  }
  function displayPoint(code: string): { x: number; y: number } | null {
    const entry = registry.get(code)
    if (!entry) return null
    const point = map.latLngToContainerPoint(entry.seat)
    const offset = offsets.get(code)
    return { x: point.x + (offset?.dx ?? 0), y: point.y + (offset?.dy ?? 0) }
  }
  function clear() {
    layer.clearLayers()
    registry.clear()
    offsets.clear()
    selectedCode = null
  }
  const onMove = () => applyPositions()
  const onZoom = () => render(lastItems, selectedCode)
  map.on('move', onMove)
  map.on('zoom', onZoom)
  return {
    render,
    displayPoint,
    clear,
    destroy() {
      map.off('move', onMove)
      map.off('zoom', onZoom)
      clear()
    },
  }
}
