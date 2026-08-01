import L from 'leaflet'
import { forecastIsDisplayable } from '../features/typhoon/typhoonForecast'
import { typhoonPointStyle, type TyphoonPointStyle } from '../features/typhoon/typhoonStyles'
import type { ForecastNode, ObservationNode, TyphoonDetail, WindRadius } from '../features/typhoon/typhoonTypes'
import { windCirclePolygon, windRadiusPriority, type LatLon } from '../features/typhoon/typhoonWindCircle'

export const TYPHOON_PANES = {
  windCircle: { name: 'typhoonWindCirclePane', zIndex: 410 },
  guardLine: { name: 'typhoonGuardLinePane', zIndex: 415 },
  path: { name: 'typhoonPathPane', zIndex: 420 },
  point: { name: 'typhoonPointPane', zIndex: 425 },
  center: { name: 'typhoonCenterPane', zIndex: 430 },
  label: { name: 'typhoonLabelPane', zIndex: 435 },
} as const

export const TYPHOON_GUARD_LINES = [
  {
    id: '24h',
    name: '24 小时定位警戒线',
    coordinates: [
      [34.005024, 126.993568], [21.971252, 126.993568], [17.96586, 118.995521],
      [10.97105, 118.995521], [4.48627, 113.018959], [-0.035506, 104.998939],
    ] as readonly LatLon[],
    labelPosition: [27.9, 126.993568] as LatLon,
    color: '#eab308',
    dashArray: undefined,
  },
  {
    id: '48h',
    name: '48 小时定位警戒线',
    coordinates: [
      [-0.035506, 104.998939], [-0.035506, 119.962318], [14.96886, 131.981361], [33.959474, 131.981361],
    ] as readonly LatLon[],
    labelPosition: [24.4, 131.981361] as LatLon,
    color: '#3b82f6',
    dashArray: '8 6',
  },
] as const

export interface TyphoonLayerEntry {
  detail: TyphoonDetail
  /** M7 动画游标；省略时显示完整实际路径。 */
  visibleObservationCount?: number
}

export interface TyphoonLayerSnapshot {
  realtime: readonly TyphoonLayerEntry[]
  historical: readonly TyphoonLayerEntry[]
  focusedTyphoonId: string | null
  selectedNodeByTyphoon: Readonly<Record<string, string | undefined>>
}

export interface TyphoonLayerEvent {
  typhoonId: string
}
export interface TyphoonNodeLayerEvent extends TyphoonLayerEvent {
  nodeId: string
}
export interface TyphoonWindLayerEvent extends TyphoonNodeLayerEvent {
  grade: string
}

export interface TyphoonLayerCallbacks {
  onTyphoonClick?(event: TyphoonLayerEvent): void
  onNodeClick?(event: TyphoonNodeLayerEvent): void
  onNodeEnter?(event: TyphoonNodeLayerEvent): void
  onNodeLeave?(event: TyphoonNodeLayerEvent): void
  onCenterClick?(event: TyphoonNodeLayerEvent): void
  onCenterEnter?(event: TyphoonNodeLayerEvent): void
  onCenterLeave?(event: TyphoonNodeLayerEvent): void
  onWindCircleClick?(event: TyphoonWindLayerEvent): void
  onWindCircleEnter?(event: TyphoonWindLayerEvent): void
  onWindCircleLeave?(event: TyphoonWindLayerEvent): void
}

export interface TyphoonScenePoint {
  id: string
  lat: number
  lon: number
  style: TyphoonPointStyle
}
export interface TyphoonWindScene {
  grade: string
  nodeId: string
  priority: number
  polygon: readonly LatLon[]
  radius: WindRadius
}
export interface TyphoonScene {
  id: string
  detail: TyphoonDetail
  focused: boolean
  actualNodes: readonly ObservationNode[]
  actualPath: readonly LatLon[]
  actualPoints: readonly TyphoonScenePoint[]
  forecastNodes: readonly ForecastNode[]
  forecastPath: readonly LatLon[]
  forecastPoints: readonly TyphoonScenePoint[]
  centerNode: ObservationNode | null
  windCircles: readonly TyphoonWindScene[]
}

function clampVisibleCount(count: number | undefined, length: number): number {
  if (count === undefined) return length
  if (!Number.isFinite(count)) return length
  return Math.max(0, Math.min(length, Math.floor(count)))
}

function pointScene(node: Pick<ObservationNode | ForecastNode, 'id' | 'lat' | 'lon' | 'windSpeedMs'>): TyphoonScenePoint | null {
  const style = typhoonPointStyle(node.windSpeedMs)
  return style ? { id: node.id, lat: node.lat, lon: node.lon, style } : null
}

function forecastForDetail(detail: TyphoonDetail) {
  const latest = detail.latestObservation
  return latest && forecastIsDisplayable(latest.forecastSnapshot, detail.status)
    ? { origin: latest, snapshot: latest.forecastSnapshot! }
    : null
}

/** 将业务快照转换为无 Leaflet 依赖的完整绘制意图，供控制器和单元测试共同使用。 */
export function buildTyphoonScenes(snapshot: TyphoonLayerSnapshot): TyphoonScene[] {
  const entries = [...snapshot.realtime, ...snapshot.historical]
  return entries.map(({ detail, visibleObservationCount }) => {
    const visibleCount = clampVisibleCount(visibleObservationCount, detail.observationsAsc.length)
    const actualNodes = detail.observationsAsc.slice(0, visibleCount)
    const selectedId = snapshot.selectedNodeByTyphoon[detail.id]
    const selected = selectedId ? detail.observationsAsc.find((node) => node.id === selectedId) ?? null : null
    const visibleSelected = selected && actualNodes.some((node) => node.id === selected.id) ? selected : null
    const centerNode = detail.status === 'start'
      ? visibleSelected ?? actualNodes[actualNodes.length - 1] ?? null
      : visibleSelected
    const forecast = forecastForDetail(detail)
    const forecastNodes = forecast?.snapshot.nodes ?? []
    const windCircles = centerNode
      ? centerNode.windRadii
          .map((radius) => ({ radius, priority: windRadiusPriority(radius), polygon: windCirclePolygon(centerNode, radius) }))
          .filter((item): item is { radius: WindRadius; priority: number; polygon: LatLon[] } => Boolean(item.polygon))
          // 外层低等级先画，十二级等内层后画并位于上方。
          .sort((left, right) => left.priority - right.priority)
          .map(({ radius, priority, polygon }) => ({ grade: radius.grade, nodeId: centerNode.id, priority, polygon, radius }))
      : []
    return {
      id: detail.id,
      detail,
      focused: snapshot.focusedTyphoonId === detail.id,
      actualNodes,
      actualPath: actualNodes.map((node) => [node.lat, node.lon] as LatLon),
      actualPoints: actualNodes.map(pointScene).filter((point): point is TyphoonScenePoint => Boolean(point)),
      forecastNodes,
      forecastPath: forecast ? [[forecast.origin.lat, forecast.origin.lon] as LatLon, ...forecastNodes.map((node) => [node.lat, node.lon] as LatLon)] : [],
      forecastPoints: forecastNodes.map(pointScene).filter((point): point is TyphoonScenePoint => Boolean(point)),
      centerNode,
      windCircles,
    }
  })
}

/** 小型资源注册表保证每个台风资源独立替换、移除和释放。 */
export function createTyphoonSceneRegistry<T>(dispose: (resource: T) => void) {
  const resources = new Map<string, T>()
  return {
    replace(id: string, resource: T) {
      const previous = resources.get(id)
      if (previous) dispose(previous)
      resources.set(id, resource)
    },
    remove(id: string) {
      const resource = resources.get(id)
      if (!resource) return false
      dispose(resource)
      resources.delete(id)
      return true
    },
    clear() {
      for (const resource of resources.values()) dispose(resource)
      resources.clear()
    },
    has(id: string) { return resources.has(id) },
    keys() { return [...resources.keys()] },
    get(id: string) { return resources.get(id) },
  }
}

interface RenderedTyphoon {
  group: L.LayerGroup
  scene: TyphoonScene
}

function ensurePanes(map: L.Map) {
  for (const pane of Object.values(TYPHOON_PANES)) {
    const element = map.getPane(pane.name) ?? map.createPane(pane.name)
    element.style.zIndex = String(pane.zIndex)
  }
}

function latLngs(points: readonly LatLon[]): L.LatLngTuple[] {
  return points.map(([lat, lon]) => [lat, lon])
}

function stop(event: L.LeafletEvent) {
  const originalEvent = (event as L.LeafletMouseEvent).originalEvent
  if (originalEvent) L.DomEvent.stopPropagation(originalEvent)
}

function escapeHtml(value: string) {
  return value.replace(/[&<>'"]/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' })[character]!)
}

function windColors(priority: number) {
  if (priority >= 3) return { color: '#b91c1c', fillColor: '#ef4444' }
  if (priority === 2) return { color: '#c2410c', fillColor: '#fb923c' }
  return { color: '#0369a1', fillColor: '#38bdf8' }
}

export function createTyphoonLayerController(map: L.Map, callbacks: TyphoonLayerCallbacks = {}) {
  ensurePanes(map)
  let guardLayer: L.LayerGroup | null = null
  const registry = createTyphoonSceneRegistry<RenderedTyphoon>((resource) => resource.group.remove())

  function renderGuardLines() {
    if (guardLayer) return
    guardLayer = L.layerGroup().addTo(map)
    for (const guard of TYPHOON_GUARD_LINES) {
      L.polyline(latLngs(guard.coordinates), {
        pane: TYPHOON_PANES.guardLine.name,
        color: guard.color,
        weight: 2,
        opacity: 0.95,
        dashArray: guard.dashArray,
        fill: false,
        interactive: false,
      }).addTo(guardLayer)
      L.marker([guard.labelPosition[0], guard.labelPosition[1]], {
        pane: TYPHOON_PANES.label.name,
        interactive: false,
        keyboard: false,
        icon: L.divIcon({
          className: 'typhoon-guard-label-wrap',
          html: `<span style="display:block;writing-mode:vertical-rl;padding:4px 2px;border-radius:4px;background:rgba(248,250,252,.9);color:${guard.color};font-size:11px;font-weight:700;line-height:1.1;white-space:nowrap">${guard.name}</span>`,
          iconSize: undefined,
        }),
      }).addTo(guardLayer)
    }
  }

  function renderScene(scene: TyphoonScene): RenderedTyphoon {
    const group = L.layerGroup().addTo(map)
    const pathColor = scene.focused ? '#1d4ed8' : '#475569'
    for (const circle of scene.windCircles) {
      const colors = windColors(circle.priority)
      const layer = L.polygon(latLngs(circle.polygon), {
        pane: TYPHOON_PANES.windCircle.name,
        ...colors,
        weight: scene.focused ? 1.8 : 1.2,
        opacity: 0.8,
        fillOpacity: scene.focused ? 0.13 : 0.08,
        bubblingMouseEvents: false,
      }).addTo(group)
      const payload = { typhoonId: scene.id, nodeId: circle.nodeId, grade: circle.grade }
      layer.on('click', (event) => { stop(event); callbacks.onWindCircleClick?.(payload) })
      layer.on('mouseover', (event) => { stop(event); callbacks.onWindCircleEnter?.(payload) })
      layer.on('mouseout', (event) => { stop(event); callbacks.onWindCircleLeave?.(payload) })
    }
    if (scene.actualPath.length >= 2) {
      const path = L.polyline(latLngs(scene.actualPath), {
        pane: TYPHOON_PANES.path.name,
        color: pathColor,
        weight: scene.focused ? 4 : 2.5,
        opacity: scene.focused ? 1 : 0.72,
        bubblingMouseEvents: false,
      }).addTo(group)
      path.on('click', (event) => { stop(event); callbacks.onTyphoonClick?.({ typhoonId: scene.id }) })
    }
    if (scene.forecastPath.length >= 2) {
      const path = L.polyline(latLngs(scene.forecastPath), {
        pane: TYPHOON_PANES.path.name,
        color: '#f97316',
        weight: scene.focused ? 3 : 2,
        opacity: scene.focused ? 0.95 : 0.68,
        dashArray: '8 6',
        bubblingMouseEvents: false,
      }).addTo(group)
      path.on('click', (event) => { stop(event); callbacks.onTyphoonClick?.({ typhoonId: scene.id }) })
    }
    const addPoint = (point: TyphoonScenePoint, forecast: boolean) => {
      const layer = L.circleMarker([point.lat, point.lon], {
        pane: TYPHOON_PANES.point.name,
        radius: point.style.diameterPx / 2,
        color: point.style.borderColor,
        weight: point.style.borderWidthPx,
        fillColor: point.style.color,
        fillOpacity: forecast ? 0.78 : 1,
        opacity: 1,
        dashArray: forecast ? '2 2' : undefined,
        bubblingMouseEvents: false,
      }).addTo(group)
      const payload = { typhoonId: scene.id, nodeId: point.id }
      layer.on('click', (event) => { stop(event); callbacks.onNodeClick?.(payload) })
      layer.on('mouseover', (event) => { stop(event); callbacks.onNodeEnter?.(payload) })
      layer.on('mouseout', (event) => { stop(event); callbacks.onNodeLeave?.(payload) })
    }
    scene.actualPoints.forEach((point) => addPoint(point, false))
    scene.forecastPoints.forEach((point) => addPoint(point, true))
    if (scene.centerNode) {
      const node = scene.centerNode
      const payload = { typhoonId: scene.id, nodeId: node.id }
      const center = L.circleMarker([node.lat, node.lon], {
        pane: TYPHOON_PANES.center.name,
        radius: scene.focused ? 10 : 8,
        color: '#ffffff',
        weight: scene.focused ? 4 : 3,
        fillColor: '#0f172a',
        fillOpacity: 0.36,
        opacity: 1,
        bubblingMouseEvents: false,
      }).addTo(group)
      center.on('click', (event) => { stop(event); callbacks.onCenterClick?.(payload) })
      center.on('mouseover', (event) => { stop(event); callbacks.onCenterEnter?.(payload) })
      center.on('mouseout', (event) => { stop(event); callbacks.onCenterLeave?.(payload) })
      const labelText = `${scene.detail.nameCn || scene.detail.id}（${node.timeYmdh.slice(5, 16)}）`
      L.marker([node.lat, node.lon], {
        pane: TYPHOON_PANES.label.name,
        interactive: false,
        keyboard: false,
        icon: L.divIcon({
          className: 'typhoon-center-label-wrap',
          html: `<span style="display:inline-block;margin:10px 0 0 10px;padding:3px 6px;border:1px solid rgba(148,163,184,.55);border-radius:5px;background:rgba(248,250,252,.94);box-shadow:0 2px 8px rgba(15,23,42,.2);color:#0f172a;font-size:11px;font-weight:700;white-space:nowrap">${escapeHtml(labelText)}</span>`,
          iconSize: undefined,
        }),
      }).addTo(group)
    }
    return { group, scene }
  }

  function render(snapshot: TyphoonLayerSnapshot) {
    renderGuardLines()
    const scenes = buildTyphoonScenes(snapshot)
    const nextIds = new Set(scenes.map((scene) => scene.id))
    for (const id of registry.keys()) if (!nextIds.has(id)) registry.remove(id)
    // 同 pane 内最后添加的图层位于上方；焦点台风最后渲染以置顶，但不隐藏或移动其他台风。
    const orderedScenes = [...scenes].sort((left, right) => Number(left.focused) - Number(right.focused))
    for (const scene of orderedScenes) registry.replace(scene.id, renderScene(scene))
  }

  function removeTyphoon(id: string) { return registry.remove(id) }

  function clear() {
    registry.clear()
    guardLayer?.remove()
    guardLayer = null
  }

  function boundsForTyphoon(id: string): L.LatLngBounds | null {
    const scene = registry.get(id)?.scene
    if (!scene) return null
    const coordinates = [...scene.actualPath, ...scene.forecastPath]
    if (!coordinates.length) return null
    const bounds = L.latLngBounds(latLngs(coordinates))
    return bounds.isValid() ? bounds : null
  }

  function fitBoundsForTyphoon(id: string, options?: L.FitBoundsOptions) {
    const bounds = boundsForTyphoon(id)
    if (!bounds) return false
    map.fitBounds(bounds, options)
    return true
  }

  function panNodeIntoView(id: string, nodeId: string, options?: L.PanInsideOptions) {
    const scene = registry.get(id)?.scene
    const node = scene?.detail.observationsAsc.find((item) => item.id === nodeId)
      ?? scene?.forecastNodes.find((item) => item.id === nodeId)
    if (!node) return false
    map.panInside([node.lat, node.lon], options)
    return true
  }

  function destroy() { clear() }

  return { boundsForTyphoon, clear, destroy, fitBoundsForTyphoon, panNodeIntoView, removeTyphoon, render }
}

export type TyphoonLayerController = ReturnType<typeof createTyphoonLayerController>
