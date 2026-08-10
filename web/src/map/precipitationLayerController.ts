import L from 'leaflet'
import type { PrecipDayKey, PrecipitationSnapshot } from '../features/precipitation/precipitationTypes'
import { PRECIP_DAY_KEYS } from '../features/precipitation/precipitationTypes'
import { precipitationLevel } from '../features/precipitation/precipitationTypes'

export const PRECIP_PANES = { grid: { name: 'precipitationPane', zIndex: 395 } } as const

export const PRECIP_GRID_BOUNDS = { lonMin: 118.0, lonMax: 123.0, latMin: 27.0, latMax: 31.5 } as const

/** 图2 风格离散色阶（浙江省水利厅台风路径发布系统）：极浅绿→绿→青绿→亮蓝→紫/洋红。
 *  每档固定颜色与透明度因子（外透内实：小雨 0.75、特大暴雨 1.0）；离散分档保证
 *  同一位置在不同缩放级别下颜色固定（不做连续渐变插值，避免采样点差异导致颜色漂移）。 */
export const LEVEL_STOPS: ReadonlyArray<readonly [number, readonly [number, number, number], number]> = [
  [0.1, [208, 240, 170], 0.75],
  [10, [122, 204, 112], 0.85],
  [25, [82, 172, 152], 0.9],
  [50, [52, 112, 222], 0.95],
  [100, [158, 60, 212], 1.0],
  [250, [204, 46, 196], 1.0],
]

export function precipColor(value: number, alpha: number): string | null {
  if (!Number.isFinite(value) || value < LEVEL_STOPS[0][0] || alpha <= 0) return null
  // 离散档位：取 value 所属的最高档，档内不插值（保证缩放颜色稳定）
  let stop = LEVEL_STOPS[0]
  for (let i = 0; i < LEVEL_STOPS.length; i++) {
    if (value >= LEVEL_STOPS[i][0]) stop = LEVEL_STOPS[i]
  }
  const [r, g, b] = stop[1]
  const levelAlpha = stop[2]
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

export interface PrecipGridLayerOptions extends L.GridLayerOptions {
  valueGrid: PrecipValueGrid | null
  opacity: number
  stepPx: number
}

/**
 * 基于 L.GridLayer 的降水瓦片层：每瓦片 canvas 渲染对应经纬度范围的插值色斑。
 * Leaflet 原生管理瓦片加载/缩放动画（zoom 动画期间旧瓦片被 transform 过渡），
 * 色斑与地图平移/缩放天然同步，无需手动 transform。
 */
export class PrecipGridLayer extends L.GridLayer {
  declare options: PrecipGridLayerOptions

  constructor(options: Partial<PrecipGridLayerOptions>) {
    // fadeAnimation: false —— 缩放时新旧瓦片不做半透明叠加过渡，避免色斑颜色因叠加而漂移
    super({ tileSize: 256, opacity: 1, stepPx: 4, fadeAnimation: false, ...options } as L.GridLayerOptions)
  }

  createTile(coords: L.Coords): HTMLElement {
    const tileSize = this.getTileSize()
    const tile = document.createElement('canvas')
    tile.width = tileSize.x
    tile.height = tileSize.y
    const ctx = tile.getContext('2d')
    if (!ctx) return tile
    const grid = this.options.valueGrid
    if (!grid) return tile
    // tile 经纬度范围：用 unproject 反算四角（公开 API，避免依赖内部 _tileCoordsToBounds）
    const map = this._map
    if (!map) return tile
    const northWest = map.unproject([coords.x * tileSize.x, coords.y * tileSize.y], coords.z)
    const southEast = map.unproject([(coords.x + 1) * tileSize.x, (coords.y + 1) * tileSize.y], coords.z)
    const north = northWest.lat, south = southEast.lat
    const west = northWest.lng, east = southEast.lng
    const step = Math.max(2, Math.floor(this.options.stepPx))
    for (let ty = 0; ty < tileSize.y; ty += step) {
      const lat = north - (north - south) * (ty + 0.5) / tileSize.y
      for (let tx = 0; tx < tileSize.x; tx += step) {
        const lng = west + (east - west) * (tx + 0.5) / tileSize.x
        const value = interpolatePrecip(grid, lat, lng)
        if (value < 0.1) continue
        // 瓦片内固定外透内实分层因子（alpha=1），整体透明度由容器 CSS opacity 控制（拖动丝滑不重绘）
        const fill = precipColor(value, 1)
        if (!fill) continue
        ctx.fillStyle = fill
        ctx.fillRect(tx, ty, step, step)
      }
    }
    return tile
  }

  setData(grid: PrecipValueGrid | null) {
    if (this.options.valueGrid === grid) return
    this.options.valueGrid = grid
    this.redraw()
  }

  /** 整体透明度：同步 options.opacity（避免 Leaflet _updateOpacity 在瓦片加载时用旧值覆盖容器），
   *  再直接设 .leaflet-layer 容器 CSS opacity（不重绘瓦片，拖动丝滑） */
  setOpacityValue(opacity: number) {
    const clamped = Math.min(1, Math.max(0, opacity))
    this.options.opacity = clamped
    const container = this.getContainer()
    if (container) container.style.opacity = String(clamped)
  }

  /** 覆盖 Leaflet 内部 _updateOpacity：只同步容器 opacity，禁用 per-tile 200ms 渐显，
   *  缩放后新瓦片立即全显，颜色不随缩放瞬态变化 */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  _updateOpacity = function (this: PrecipGridLayer) {
    if (!this._map) return
    const container = this.getContainer()
    if (container) container.style.opacity = String(this.options.opacity)
  } as unknown as () => void
}

export interface PrecipitationLayerOptions {
  opacity?: number
  stepPx?: number
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
  let map: L.Map | null = null
  let layer: PrecipGridLayer | null = null
  let hoverEl: HTMLDivElement | null = null
  let snapshot: PrecipitationSnapshot | null = null
  let currentDay: PrecipDayKey = PRECIP_DAY_KEYS[0]
  let valueGrid: PrecipValueGrid | null = null
  let currentOpacity = initialOpacity
  let hoverBound = false

  function ensurePane(target: L.Map): HTMLElement {
    const pane = target.getPane(PRECIP_PANES.grid.name) ?? target.createPane(PRECIP_PANES.grid.name)
    pane.style.zIndex = String(PRECIP_PANES.grid.zIndex)
    return pane
  }

  function rebuildGrid() {
    valueGrid = snapshot ? buildValueGrid(snapshot, currentDay) : null
    layer?.setData(valueGrid)
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
    if (hoverBound) return
    target.on('mousemove', onMouseMove)
    target.on('mouseout', onMouseOut)
    hoverBound = true
  }

  function detachHover(target: L.Map) {
    if (!hoverBound) return
    target.off('mousemove', onMouseMove)
    target.off('mouseout', onMouseOut)
    hoverBound = false
  }

  return {
    mount(target: L.Map) {
      if (map) return
      map = target
      ensurePane(target)
      layer = new PrecipGridLayer({ pane: PRECIP_PANES.grid.name, valueGrid, opacity: currentOpacity, stepPx })
      layer.addTo(target)
      layer.setOpacityValue(currentOpacity)
      attachHover(target)
    },
    setSnapshot(next) {
      snapshot = next
      currentDay = PRECIP_DAY_KEYS[0]
      rebuildGrid()
    },
    setDay(day) {
      currentDay = day
      rebuildGrid()
    },
    setOpacity(next) {
      currentOpacity = Math.min(1, Math.max(0, next))
      layer?.setOpacityValue(currentOpacity)
      if (currentOpacity <= 0 && hoverEl) hoverEl.style.display = 'none'
    },
    redraw() { layer?.redraw() },
    clear() {
      // 闭包快照清理教训：clear() 必须同时重置快照与网格，避免残留数据在后续重绘/事件中重新出现
      snapshot = null
      valueGrid = null
      currentDay = PRECIP_DAY_KEYS[0]
      layer?.setData(null)
      if (hoverEl) hoverEl.style.display = 'none'
    },
    destroy() {
      detachHover(map ?? undefined as unknown as L.Map)
      layer?.remove()
      layer = null
      if (hoverEl) { hoverEl.remove(); hoverEl = null }
      map = null
    },
  }
}
