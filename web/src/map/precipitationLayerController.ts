import L from 'leaflet'
import type { PrecipDayKey, PrecipitationSnapshot } from '../features/precipitation/precipitationTypes'
import { PRECIP_DAY_KEYS } from '../features/precipitation/precipitationTypes'
import { precipitationLevel } from '../features/precipitation/precipitationTypes'

export const PRECIP_PANES = { grid: { name: 'precipitationPane', zIndex: 395 } } as const

export const PRECIP_GRID_BOUNDS = { lonMin: 118.0, lonMax: 123.0, latMin: 27.0, latMax: 31.5 } as const

/** 图2 风格色带（浙江省水利厅台风路径发布系统）：极浅绿→绿→青绿→亮蓝→紫/洋红，
 *  第四项为按强度的透明度因子（外透内实：外围 0.45、中心 0.95），与滑动条基础透明度相乘。 */
export const LEVEL_STOPS: ReadonlyArray<readonly [number, readonly [number, number, number], number]> = [
  [0.1, [208, 240, 170], 0.45],
  [10, [122, 204, 112], 0.6],
  [25, [82, 172, 152], 0.75],
  [50, [52, 112, 222], 0.85],
  [100, [158, 60, 212], 0.95],
  [250, [204, 46, 196], 1.0],
]

export function precipColor(value: number, alpha: number): string | null {
  if (!Number.isFinite(value) || value < LEVEL_STOPS[0][0] || alpha <= 0) return null
  let from = LEVEL_STOPS[0], to = LEVEL_STOPS[LEVEL_STOPS.length - 1]
  for (let i = 0; i < LEVEL_STOPS.length - 1; i++) {
    if (value >= LEVEL_STOPS[i][0] && value <= LEVEL_STOPS[i + 1][0]) { from = LEVEL_STOPS[i]; to = LEVEL_STOPS[i + 1]; break }
  }
  const [v0, c0, a0] = from, [v1, c1, a1] = to
  const ratio = v1 === v0 ? 0 : Math.min(1, Math.max(0, (value - v0) / (v1 - v0)))
  const r = Math.round(c0[0] + (c1[0] - c0[0]) * ratio)
  const g = Math.round(c0[1] + (c1[1] - c0[1]) * ratio)
  const b = Math.round(c0[2] + (c1[2] - c0[2]) * ratio)
  // 外透内实：档位透明度因子在区间内插值，再乘滑动条基础透明度
  const levelAlpha = Math.min(1, Math.max(0, a0 + (a1 - a0) * ratio))
  return `rgba(${r},${g},${b},${(levelAlpha * Math.min(1, Math.max(0, alpha))).toFixed(3)})`
}

export interface PrecipValueGrid {
  lats: number[]
  lons: number[]
  values: number[][] // [latIdx][lonIdx]
}

/** 将快照 grid（任意顺序的点数组）重建为 lat 行 × lon 列的规整网格供双线性插值。 */
export function buildValueGrid(snapshot: PrecipitationSnapshot, day: PrecipDayKey): PrecipValueGrid {
  const latSet = new Set<number>(), lonSet = new Set<number>()
  const byKey = new Map<string, number>()
  for (const point of snapshot.grid) {
    latSet.add(point.lat); lonSet.add(point.lon)
    byKey.set(`${point.lat},${point.lon}`, point.values[day] ?? 0)
  }
  const lats = [...latSet].sort((a, b) => a - b)
  const lons = [...lonSet].sort((a, b) => a - b)
  const values = lats.map((lat) => lons.map((lon) => byKey.get(`${lat},${lon}`) ?? 0))
  return { lats, lons, values }
}

/** 双线性插值：返回网格矩形内任意经纬度的值；越界返回 0。 */
export function interpolatePrecip(grid: PrecipValueGrid, lat: number, lon: number): number {
  const { lats, lons, values } = grid
  if (lat < lats[0] || lat > lats[lats.length - 1] || lon < lons[0] || lon > lons[lons.length - 1]) return 0
  let i1 = 0, j1 = 0
  while (i1 < lats.length - 2 && lats[i1 + 1] <= lat) i1++
  while (j1 < lons.length - 2 && lons[j1 + 1] <= lon) j1++
  const latFrac = lats[i1 + 1] === lats[i1] ? 0 : (lat - lats[i1]) / (lats[i1 + 1] - lats[i1])
  const lonFrac = lons[j1 + 1] === lons[j1] ? 0 : (lon - lons[j1]) / (lons[j1 + 1] - lons[j1])
  const v00 = values[i1][j1], v01 = values[i1][j1 + 1], v10 = values[i1 + 1][j1], v11 = values[i1 + 1][j1 + 1]
  const top = v00 + (v01 - v00) * lonFrac
  const bottom = v10 + (v11 - v10) * lonFrac
  return top + (bottom - top) * latFrac
}

export interface PrecipitationLayerOptions {
  opacity?: number
  stepPx?: number
  requestAnimationFrame?: typeof requestAnimationFrame
  cancelAnimationFrame?: typeof cancelAnimationFrame
}

export interface PrecipitationLayerController {
  mount(map: L.Map): void
  setSnapshot(snapshot: PrecipitationSnapshot | null): void
  setDay(day: PrecipDayKey): void
  setOpacity(opacity: number): void
  redraw(): void
  clear(): void
  destroy(): void
}

const HOVER_OFFSET_X = 14
const HOVER_OFFSET_Y = 20

export function createPrecipitationLayerController(options: PrecipitationLayerOptions = {}): PrecipitationLayerController {
  const initialOpacity = options.opacity ?? 0.6
  const stepPx = Math.max(2, Math.floor(options.stepPx ?? 4))
  const raf = options.requestAnimationFrame ?? ((callback: FrameRequestCallback) => globalThis.requestAnimationFrame(callback))
  const caf = options.cancelAnimationFrame ?? ((handle: number) => globalThis.cancelAnimationFrame(handle))
  let map: L.Map | null = null
  let canvas: HTMLCanvasElement | null = null
  let hoverEl: HTMLDivElement | null = null
  let snapshot: PrecipitationSnapshot | null = null
  let currentDay: PrecipDayKey = PRECIP_DAY_KEYS[0]
  let valueGrid: PrecipValueGrid | null = null
  let currentOpacity = initialOpacity
  let frameHandle: number | null = null
  let zoomStartLevel: number | null = null
  let mapListeners: Array<{ target: L.Map; event: string; handler: () => void }> = []

  function ensurePane(target: L.Map): HTMLElement {
    const pane = target.getPane(PRECIP_PANES.grid.name) ?? target.createPane(PRECIP_PANES.grid.name)
    pane.style.zIndex = String(PRECIP_PANES.grid.zIndex)
    pane.style.pointerEvents = 'none'
    // Leaflet 自定义 pane 无宽高，canvas 100% 会解析为 0（不可见）；补齐容器尺寸
    pane.style.width = '100%'
    pane.style.height = '100%'
    return pane
  }

  function rebuildGrid() {
    valueGrid = snapshot ? buildValueGrid(snapshot, currentDay) : null
  }

// canvas 挂载在 Leaflet pane（随 mapPane transform 平移）。
// 渲染用 layerPoint（pane 局部坐标）填色，canvas 向外扩 LAYER_PAD 像素以覆盖 transform 偏移后的视口。
const LAYER_PAD = 512
// Leaflet 缩放动画只 transform 内部 proxy，自定义 pane 不参与；
// 用 CSS transition + zoomanim 目标变换让色斑与地图同步缩放。
const ZOOM_ANIM_MS = 250

  function render() {
    frameHandle = null
    if (!map || !canvas) return
    const size = map.getSize()
    const width = size.x + LAYER_PAD * 2
    const height = size.y + LAYER_PAD * 2
    if (canvas.width !== width || canvas.height !== height) { canvas.width = width; canvas.height = height }
    canvas.style.width = `${width}px`
    canvas.style.height = `${height}px`
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    ctx.clearRect(0, 0, width, height)
    if (!valueGrid || currentOpacity <= 0) return
    const alpha = Math.min(1, Math.max(0, currentOpacity))
    for (let y = 0; y < size.y; y += stepPx) {
      for (let x = 0; x < size.x; x += stepPx) {
        const latLng = map.containerPointToLatLng(L.point(x, y))
        const value = interpolatePrecip(valueGrid, latLng.lat, latLng.lng)
        if (value < 0.1) continue
        const fill = precipColor(value, alpha)
        if (!fill) continue
        // layerPoint = pane 局部坐标：canvas 在 pane 内随地图 transform 平移，
        // 用 layerPoint 填色即可让色斑精确跟随地图移动/缩放
        const layer = map.containerPointToLayerPoint(L.point(x, y))
        ctx.fillStyle = fill
        ctx.fillRect(layer.x + LAYER_PAD, layer.y + LAYER_PAD, stepPx, stepPx)
      }
    }
  }

  function scheduleRender() {
    if (frameHandle !== null) return
    frameHandle = raf(() => render())
  }

  function attachEvents(target: L.Map) {
    // 缩放动画期间（zoomStartLevel 非空）不重绘：canvas 由 CSS transform 过渡跟随，动画结束统一重绘
    const onMove = () => { if (zoomStartLevel === null) scheduleRender() }
    const onZoom = () => { if (zoomStartLevel === null) scheduleRender() }
    const onSettle = () => scheduleRender()
    // 缩放动画：让 canvas 跟随地图同步缩放（仿 Leaflet tile 的 CSS transition 方式）
    const onZoomStart = () => {
      if (!canvas) return
      zoomStartLevel = map?.getZoom() ?? null
      canvas.style.transition = `transform ${ZOOM_ANIM_MS}ms ease-out`
      canvas.style.transformOrigin = '0 0'
    }
    const onZoomAnim = (event: { center: L.LatLng; zoom: number }) => {
      if (zoomStartLevel === null || !canvas) return
      const z0 = zoomStartLevel, z1 = event.zoom
      const center = event.center
      const c0 = map!.project(center, z0)
      const c1 = map!.project(center, z1)
      const k = map!.getZoomScale(z1, z0)
      // 把旧 zoom 的 layerPoint 内容映射到目标 zoom 的显示位置（transform-origin 0 0）
      canvas.style.transform = `translate3d(${c1.x - c0.x * k}px, ${c1.y - c0.y * k}px, 0) scale(${k})`
    }
    const onZoomEnd = () => {
      zoomStartLevel = null
      if (canvas) { canvas.style.transition = ''; canvas.style.transform = '' }
      scheduleRender()
    }
    target.on('move', onMove)
    target.on('zoom', onZoom)
    target.on('moveend', onSettle)
    target.on('zoomend', onZoomEnd)
    target.on('zoomstart', onZoomStart)
    target.on('zoomanim', onZoomAnim)
    mapListeners = [
      { target, event: 'move', handler: onMove },
      { target, event: 'zoom', handler: onZoom },
      { target, event: 'moveend', handler: onSettle },
      { target, event: 'zoomend', handler: onZoomEnd },
      { target, event: 'zoomstart', handler: onZoomStart },
      { target, event: 'zoomanim', handler: onZoomAnim as unknown as () => void },
    ]
  }

  function detachEvents() {
    for (const { target, event, handler } of mapListeners) target.off(event, handler)
    mapListeners = []
  }

  function hoverContent(value: number): string {
    const level = precipitationLevel(value)
    return `<div class="precip-hover"><span class="precip-hover-level">${level}</span><span class="precip-hover-value">${value < 0.1 ? '<0.1' : value.toFixed(1)} mm</span></div>`
  }

  function onMouseMove(event: L.LeafletMouseEvent) {
    if (!map || !valueGrid || currentOpacity <= 0) return
    const value = interpolatePrecip(valueGrid, event.latlng.lat, event.latlng.lng)
    if (!hoverEl) {
      hoverEl = document.createElement('div')
      hoverEl.className = 'precip-hover-wrap'
      hoverEl.style.position = 'fixed'
      hoverEl.style.pointerEvents = 'none'
      hoverEl.style.zIndex = '900'
      document.body.appendChild(hoverEl)
    }
    if (value < 0.1) { hoverEl.style.display = 'none'; return }
    hoverEl.innerHTML = hoverContent(value)
    hoverEl.style.display = 'block'
    hoverEl.style.left = `${event.containerPoint.x + HOVER_OFFSET_X}px`
    hoverEl.style.top = `${event.containerPoint.y + HOVER_OFFSET_Y}px`
  }

  function onMouseOut() { if (hoverEl) hoverEl.style.display = 'none' }

  function attachHover(target: L.Map) {
    target.on('mousemove', onMouseMove)
    target.on('mouseout', onMouseOut)
    mapListeners.push(
      { target, event: 'mousemove', handler: onMouseMove as unknown as () => void },
      { target, event: 'mouseout', handler: onMouseOut },
    )
  }

  return {
    mount(target: L.Map) {
      if (map) return
      map = target
      ensurePane(target)
      canvas = document.createElement('canvas')
      canvas.style.position = 'absolute'
      // canvas 原点对齐 layerPoint(-LAYER_PAD, -LAYER_PAD)，内容随 mapPane transform 同步移动
      canvas.style.left = `-${LAYER_PAD}px`
      canvas.style.top = `-${LAYER_PAD}px`
      canvas.style.opacity = String(currentOpacity)
      canvas.style.pointerEvents = 'none'
      target.getPane(PRECIP_PANES.grid.name)!.appendChild(canvas)
      attachEvents(target)
      attachHover(target)
      scheduleRender()
    },
    setSnapshot(next) {
      snapshot = next
      currentDay = PRECIP_DAY_KEYS[0]
      rebuildGrid()
      scheduleRender()
    },
    setDay(day) {
      currentDay = day
      rebuildGrid()
      scheduleRender()
    },
    setOpacity(next) {
      currentOpacity = Math.min(1, Math.max(0, next))
      if (canvas) canvas.style.opacity = String(currentOpacity)
      if (currentOpacity <= 0 && hoverEl) hoverEl.style.display = 'none'
      scheduleRender()
    },
    redraw() { scheduleRender() },
    clear() {
      // 闭包快照清理教训：clear() 必须同时重置快照，否则残留数据会被后续 move/zoom 重绘画回地图
      snapshot = null
      valueGrid = null
      currentDay = PRECIP_DAY_KEYS[0]
      if (canvas) { const ctx = canvas.getContext('2d'); ctx?.clearRect(0, 0, canvas.width, canvas.height) }
      if (hoverEl) hoverEl.style.display = 'none'
    },
    destroy() {
      if (frameHandle !== null) caf(frameHandle)
      frameHandle = null
      detachEvents()
      if (hoverEl) { hoverEl.remove(); hoverEl = null }
      if (canvas && map) { canvas.remove(); canvas = null }
      map = null
    },
  }
}
