import L from 'leaflet'
import type { PrecipDayKey, PrecipitationSnapshot } from '../features/precipitation/precipitationTypes'
import { PRECIP_DAY_KEYS } from '../features/precipitation/precipitationTypes'
import { precipitationLevel } from '../features/precipitation/precipitationTypes'

export const PRECIP_PANES = { grid: { name: 'precipitationPane', zIndex: 395 } } as const

export const PRECIP_GRID_BOUNDS = { lonMin: 118.0, lonMax: 123.0, latMin: 27.0, latMax: 31.5 } as const

/** 中国气象局 24h 雨量等级色带（透明→浅绿→绿→青蓝→蓝→紫→深紫）。 */
export const LEVEL_STOPS: ReadonlyArray<readonly [number, readonly [number, number, number]]> = [
  [0.1, [166, 217, 106]],
  [10, [65, 171, 93]],
  [25, [44, 127, 184]],
  [50, [31, 82, 160]],
  [100, [117, 42, 131]],
  [250, [64, 0, 64]],
]

export function precipColor(value: number, alpha: number): string | null {
  if (!Number.isFinite(value) || value < LEVEL_STOPS[0][0] || alpha <= 0) return null
  let from = LEVEL_STOPS[0], to = LEVEL_STOPS[LEVEL_STOPS.length - 1]
  for (let i = 0; i < LEVEL_STOPS.length - 1; i++) {
    if (value >= LEVEL_STOPS[i][0] && value <= LEVEL_STOPS[i + 1][0]) { from = LEVEL_STOPS[i]; to = LEVEL_STOPS[i + 1]; break }
  }
  const [v0, c0] = from, [v1, c1] = to
  const ratio = v1 === v0 ? 0 : Math.min(1, Math.max(0, (value - v0) / (v1 - v0)))
  const r = Math.round(c0[0] + (c1[0] - c0[0]) * ratio)
  const g = Math.round(c0[1] + (c1[1] - c0[1]) * ratio)
  const b = Math.round(c0[2] + (c1[2] - c0[2]) * ratio)
  return `rgba(${r},${g},${b},${alpha.toFixed(3)})`
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
  let mapListeners: Array<{ target: L.Map; event: string; handler: () => void }> = []

  function ensurePane(target: L.Map): HTMLElement {
    const pane = target.getPane(PRECIP_PANES.grid.name) ?? target.createPane(PRECIP_PANES.grid.name)
    pane.style.zIndex = String(PRECIP_PANES.grid.zIndex)
    pane.style.pointerEvents = 'none'
    return pane
  }

  function rebuildGrid() {
    valueGrid = snapshot ? buildValueGrid(snapshot, currentDay) : null
  }

  function render() {
    frameHandle = null
    if (!map || !canvas) return
    const size = map.getSize()
    if (canvas.width !== size.x || canvas.height !== size.y) { canvas.width = size.x; canvas.height = size.y }
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    ctx.clearRect(0, 0, size.x, size.y)
    if (!valueGrid || currentOpacity <= 0) return
    const alpha = Math.min(1, Math.max(0, currentOpacity))
    for (let y = 0; y < size.y; y += stepPx) {
      for (let x = 0; x < size.x; x += stepPx) {
        const latLng = map.containerPointToLatLng(L.point(x, y))
        const value = interpolatePrecip(valueGrid, latLng.lat, latLng.lng)
        if (value < 0.1) continue
        const fill = precipColor(value, alpha)
        if (!fill) continue
        ctx.fillStyle = fill
        ctx.fillRect(x, y, stepPx, stepPx)
      }
    }
  }

  function scheduleRender() {
    if (frameHandle !== null) return
    frameHandle = raf(() => render())
  }

  function attachEvents(target: L.Map) {
    const onMove = () => scheduleRender()
    const onZoom = () => scheduleRender()
    target.on('move', onMove)
    target.on('zoom', onZoom)
    mapListeners = [
      { target, event: 'move', handler: onMove },
      { target, event: 'zoom', handler: onZoom },
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
      canvas.style.inset = '0'
      canvas.style.width = '100%'
      canvas.style.height = '100%'
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
