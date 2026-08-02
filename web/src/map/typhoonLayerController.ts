import L from 'leaflet'
import typhoonIconUrl from '../assets/taifeng.svg?url'
import { forecastIsDisplayable } from '../features/typhoon/typhoonForecast'
import { typhoonPointStyle, type TyphoonPointStyle } from '../features/typhoon/typhoonStyles'
import type { ForecastNode, ObservationNode, TyphoonDetail, WindRadius } from '../features/typhoon/typhoonTypes'
import { windCirclePolygon, windRadiusPriority, type LatLon } from '../features/typhoon/typhoonWindCircle'

export const TYPHOON_PANES = {
  wind7: { name: 'typhoonWind7Pane', zIndex: 410 },
  wind10: { name: 'typhoonWind10Pane', zIndex: 411 },
  wind12: { name: 'typhoonWind12Pane', zIndex: 412 },
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
export interface TyphoonPointerPosition { x: number; y: number }
export interface TyphoonNodeLayerEvent extends TyphoonLayerEvent {
  nodeId: string
  kind: 'actual' | 'forecast'
  containerPoint: TyphoonPointerPosition
}
export interface TyphoonWindLayerEvent extends TyphoonNodeLayerEvent {
  grade: string
  kind: 'actual'
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

interface PointLike { x: number; y: number }

/** 四段原生 SVG 椭圆弧 + 四条轴向连接线；axisPoints 顺序为 N/E、E/S、S/W、W/N。 */
export function quadrantWindArcPath(center: PointLike, axisPoints: readonly PointLike[]): string | null {
  if (axisPoints.length !== 8) return null
  const [nNe, eNe, eSe, sSe, sSw, wSw, wNw, nNw] = axisPoints
  if (!nNe || !eNe || !eSe || !sSe || !sSw || !wSw || !wNw || !nNw) return null
  const arc = (start: PointLike, end: PointLike) => {
    const rx = Math.max(Math.abs(start.x - center.x), Math.abs(end.x - center.x))
    const ry = Math.max(Math.abs(start.y - center.y), Math.abs(end.y - center.y))
    return `A ${rx} ${ry} 0 0 1 ${end.x} ${end.y}`
  }
  return [
    `M ${nNe.x} ${nNe.y}`,
    arc(nNe, eNe),
    `L ${eSe.x} ${eSe.y}`,
    arc(eSe, sSe),
    `L ${sSw.x} ${sSw.y}`,
    arc(sSw, wSw),
    `L ${wNw.x} ${wNw.y}`,
    arc(wNw, nNw),
    'Z',
  ].join(' ')
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
          .map((radius) => ({ radius, priority: windRadiusPriority(radius), polygon: windCirclePolygon(centerNode, radius, 1) }))
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

function pointerPosition(map: L.Map, event: L.LeafletEvent): TyphoonPointerPosition {
  const mouse = event as L.LeafletMouseEvent
  const point = mouse.containerPoint ?? map.latLngToContainerPoint(mouse.latlng)
  return { x: point.x, y: point.y }
}

function windPane(priority: number) {
  if (priority >= 3) return TYPHOON_PANES.wind12.name
  if (priority === 2) return TYPHOON_PANES.wind10.name
  return TYPHOON_PANES.wind7.name
}

function escapeHtml(value: string) {
  return value.replace(/[&<>'"]/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' })[character]!)
}

function windColors(priority: number) {
  if (priority >= 3) return { color: '#f59e0b', fillColor: '#f59e0b' }
  if (priority === 2) return { color: '#f59e0b', fillColor: '#c9953f' }
  return { color: '#f59e0b', fillColor: '#94a3b8' }
}

function windFillOpacity(priority: number, focused: boolean): number {
  const opacity = priority >= 3 ? 0.46 : priority === 2 ? 0.36 : 0.26
  return focused ? opacity : opacity * 0.72
}

export function typhoonCenterIconClass(status: TyphoonDetail['status'], focused: boolean): string {
  return ['typhoon-vortex-marker', status === 'start' ? 'is-live' : 'is-history', focused ? 'is-focused' : ''].filter(Boolean).join(' ')
}

function typhoonCenterIconHtml(): string {
  return `<span class="typhoon-vortex-glyph" aria-hidden="true"><img src="${typhoonIconUrl}" alt="" draggable="false"></span>`
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
      const node = scene.centerNode?.id === circle.nodeId ? scene.centerNode : null
      const axisLatLngs = circle.polygon.slice(0, 8)
      if (!node || axisLatLngs.length !== 8) continue
      const centerPoint = map.project([node.lat, node.lon], 0)
      const axisPoints = axisLatLngs.map(([lat, lon]) => map.project([lat, lon], 0))
      const pathData = quadrantWindArcPath(centerPoint, axisPoints)
      if (!pathData) continue
      const allPoints = [centerPoint, ...axisPoints]
      const minX = Math.min(...allPoints.map((point) => point.x))
      const maxX = Math.max(...allPoints.map((point) => point.x))
      const minY = Math.min(...allPoints.map((point) => point.y))
      const maxY = Math.max(...allPoints.map((point) => point.y))
      const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg')
      svg.setAttribute('viewBox', `${minX} ${minY} ${maxX - minX} ${maxY - minY}`)
      svg.setAttribute('preserveAspectRatio', 'none')
      const path = document.createElementNS('http://www.w3.org/2000/svg', 'path')
      const colors = windColors(circle.priority)
      path.setAttribute('d', pathData)
      path.setAttribute('fill', colors.fillColor)
      path.setAttribute('fill-opacity', String(windFillOpacity(circle.priority, scene.focused)))
      path.setAttribute('stroke', colors.color)
      path.setAttribute('stroke-width', String(scene.focused ? 1.8 : 1.2))
      path.setAttribute('vector-effect', 'non-scaling-stroke')
      path.setAttribute('pointer-events', 'visiblePainted')
      svg.append(path)
      const layer = L.svgOverlay(svg, L.latLngBounds(
        map.unproject([minX, maxY], 0),
        map.unproject([maxX, minY], 0),
      ), {
        pane: windPane(circle.priority),
        interactive: true,
        bubblingMouseEvents: false,
      }).addTo(group)
      const payload = (event: L.LeafletEvent) => ({ typhoonId: scene.id, nodeId: circle.nodeId, grade: circle.grade, kind: 'actual' as const, containerPoint: pointerPosition(map, event) })
      layer.on('click', (event) => { stop(event); callbacks.onWindCircleClick?.(payload(event)) })
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
      const baseRadius = point.style.diameterPx / 2
      const layer = L.circleMarker([point.lat, point.lon], {
        pane: TYPHOON_PANES.point.name,
        radius: baseRadius,
        color: point.style.borderColor,
        weight: point.style.borderWidthPx,
        fillColor: point.style.color,
        fillOpacity: forecast ? 0.78 : 1,
        opacity: 1,
        dashArray: forecast ? '2 2' : undefined,
        bubblingMouseEvents: false,
      }).addTo(group)
      const payload = (event: L.LeafletEvent) => ({ typhoonId: scene.id, nodeId: point.id, kind: forecast ? 'forecast' as const : 'actual' as const, containerPoint: pointerPosition(map, event) })
      layer.on('click', (event) => { stop(event); callbacks.onNodeClick?.(payload(event)) })
      if (!forecast) {
        layer.on('mouseover', (event) => {
          stop(event)
          layer.setRadius(baseRadius + 2.5)
          layer.setStyle({ weight: point.style.borderWidthPx + 1.5 })
          callbacks.onNodeEnter?.(payload(event))
        })
        layer.on('mouseout', (event) => {
          stop(event)
          layer.setRadius(baseRadius)
          layer.setStyle({ weight: point.style.borderWidthPx })
          callbacks.onNodeLeave?.(payload(event))
        })
      }
    }
    scene.actualPoints.forEach((point) => addPoint(point, false))
    scene.forecastPoints.forEach((point) => addPoint(point, true))
    if (scene.centerNode) {
      const node = scene.centerNode
      const payload = (event: L.LeafletEvent) => ({ typhoonId: scene.id, nodeId: node.id, kind: 'actual' as const, containerPoint: pointerPosition(map, event) })
      const iconSize = scene.focused ? 38 : 32
      const center = L.marker([node.lat, node.lon], {
        pane: TYPHOON_PANES.center.name,
        bubblingMouseEvents: false,
        keyboard: true,
        title: `${scene.detail.nameCn || scene.detail.id}${scene.detail.status === 'start' ? '实时台风' : '历史台风'}`,
        alt: `${scene.detail.nameCn || scene.detail.id}${scene.detail.status === 'start' ? '实时台风中心' : '历史台风中心'}`,
        icon: L.divIcon({
          className: typhoonCenterIconClass(scene.detail.status, scene.focused),
          html: typhoonCenterIconHtml(),
          iconSize: [iconSize, iconSize],
          iconAnchor: [iconSize / 2, iconSize / 2],
        }),
      }).addTo(group)
      center.on('click', (event) => { stop(event); callbacks.onCenterClick?.(payload(event)) })
      center.on('mouseover', (event) => { stop(event); callbacks.onCenterEnter?.(payload(event)) })
      center.on('mouseout', (event) => { stop(event); callbacks.onCenterLeave?.(payload(event)) })
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

  function setInitialViewForTyphoon(id: string, zoom: number) {
    const center = registry.get(id)?.scene.detail.latestObservation
    if (!center || !Number.isFinite(zoom)) return false
    map.setView([center.lat, center.lon], zoom, { animate: false })
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

  return { boundsForTyphoon, clear, destroy, fitBoundsForTyphoon, panNodeIntoView, removeTyphoon, render, setInitialViewForTyphoon }
}

export type TyphoonLayerController = ReturnType<typeof createTyphoonLayerController>
