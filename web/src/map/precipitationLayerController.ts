import L from 'leaflet'
import type { PrecipDayKey, PrecipitationSnapshot } from '../features/precipitation/precipitationTypes'
import { PRECIP_DAY_KEYS } from '../features/precipitation/precipitationTypes'
import { precipitationLevel } from '../features/precipitation/precipitationTypes'

export const PRECIP_PANES = { grid: { name: 'precipitationPane', zIndex: 395 } } as const

export const PRECIP_GRID_BOUNDS = { lonMin: 118.0, lonMax: 123.0, latMin: 27.0, latMax: 31.5 } as const

/** 图2 风格离散色阶（浙江省水利厅台风路径发布系统）：极浅绿→绿→青绿→亮蓝→紫/洋红。
 *  档内固定色（缩放颜色稳定）；档位阈值右侧 BAND 渐变带内与下档色平滑混合，消除硬边界锯齿。 */
export const LEVEL_STOPS: ReadonlyArray<readonly [number, readonly [number, number, number], number]> = [
  [0.1, [208, 240, 170], 0.75],
  [10, [122, 204, 112], 0.85],
  [25, [82, 172, 152], 0.9],
  [50, [52, 112, 222], 0.95],
  [100, [158, 60, 212], 1.0],
  [250, [204, 46, 196], 1.0],
]

/** 阈值渐变带宽度（相对档位阈值），消除色阶硬边界的阶梯锯齿 */
export const LEVEL_BAND = 0.18

export function precipColor(value: number, alpha: number): string | null {
  if (!Number.isFinite(value) || value < LEVEL_STOPS[0][0] || alpha <= 0) return null
  let stop = LEVEL_STOPS[0], idx = 0
  for (let i = 0; i < LEVEL_STOPS.length; i++) {
    if (value >= LEVEL_STOPS[i][0]) { stop = LEVEL_STOPS[i]; idx = i }
  }
  const prev = idx > 0 ? LEVEL_STOPS[idx - 1] : null
  let r: number, g: number, b: number, levelAlpha: number
  if (prev && value < stop[0] * (1 + LEVEL_BAND)) {
    // 渐变带：阈值右侧与下档色平滑混合（值场连续 → 边界为平滑渐变曲线）
    const t = Math.min(1, Math.max(0, (value - stop[0]) / (stop[0] * LEVEL_BAND)))
    r = Math.round(prev[1][0] + (stop[1][0] - prev[1][0]) * t)
    g = Math.round(prev[1][1] + (stop[1][1] - prev[1][1]) * t)
    b = Math.round(prev[1][2] + (stop[1][2] - prev[1][2]) * t)
    levelAlpha = prev[2] + (stop[2] - prev[2]) * t
  } else {
    ;[r, g, b] = stop[1]
    levelAlpha = stop[2]
  }
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

/** Catmull-Rom 三次插值核（值场平滑，等值线圆滑曲线）。 */
function catmullRom(p0: number, p1: number, p2: number, p3: number, t: number): number {
  return 0.5 * ((2 * p1) + (-p0 + p2) * t + (2 * p0 - 5 * p1 + 4 * p2 - p3) * t * t + (-p0 + 3 * p1 - 3 * p2 + p3) * t * t * t)
}

/** 双三次（Catmull-Rom）插值：返回网格矩形内任意经纬度的平滑值；越界返回 0。
 *  相比双线性，等值线为 C1 连续曲线，档位边界无折线阶梯。 */
export function interpolatePrecip(grid: PrecipValueGrid, lat: number, lon: number): number {
  const { lats, lons, values } = grid
  if (lat < lats[0] || lat > lats[lats.length - 1] || lon < lons[0] || lon > lons[lons.length - 1]) return 0
  let i1 = 0, j1 = 0
  while (i1 < lats.length - 2 && lats[i1 + 1] <= lat) i1++
  while (j1 < lons.length - 2 && lons[j1 + 1] <= lon) j1++
  const latFrac = lats[i1 + 1] === lats[i1] ? 0 : (lat - lats[i1]) / (lats[i1 + 1] - lats[i1])
  const lonFrac = lons[j1 + 1] === lons[j1] ? 0 : (lon - lons[j1]) / (lons[j1 + 1] - lons[j1])
  const maxI = lats.length - 1, maxJ = lons.length - 1
  const clampI = (v: number) => Math.max(0, Math.min(maxI, v))
  const clampJ = (v: number) => Math.max(0, Math.min(maxJ, v))
  // 4×4 邻域（边界 clamp）：每行沿经度 Catmull-Rom，再沿纬度 Catmull-Rom
  const rows: number[] = []
  for (let k = 0; k < 4; k++) {
    const row = clampI(i1 - 1 + k)
    const jm = clampJ(j1 - 1), jp = clampJ(j1 + 2)
    rows.push(catmullRom(values[row][jm], values[row][j1], values[row][j1 + 1], values[row][jp], lonFrac))
  }
  return catmullRom(rows[0], rows[1], rows[2], rows[3], latFrac)
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
// ---------- 浙江省界裁剪（色斑仅在浙江界内展示） ----------
// 省界 rings（[lon, lat]），从 /data/boundary/province.geojson 提取；模块级缓存避免重复加载
let precipBoundary: Array<Array<[number, number]>> | null = null
let precipBoundaryPromise: Promise<Array<Array<[number, number]>>> | null = null
// 省界投影缓存：key = zoom（同 zoom 瓦片共享，避免每瓦片重复投影）
const boundaryProjCache = new Map<number, Array<Array<[number, number]>>>()

/** 加载并提取浙江界 rings（失败返回空数组，降级为不裁剪）。 */
export function ensurePrecipBoundary(fetchImpl: typeof fetch = globalThis.fetch): Promise<Array<Array<[number, number]>>> {
  if (precipBoundary) return Promise.resolve(precipBoundary)
  if (precipBoundaryPromise) return precipBoundaryPromise
  precipBoundaryPromise = (async () => {
    try {
      const res = await fetchImpl('/data/boundary/province.geojson')
      if (!res.ok) return []
      const gj = (await res.json()) as { features?: Array<{ geometry?: { type: string; coordinates: unknown } }> }
      const rings: Array<Array<[number, number]>> = []
      for (const feature of gj.features ?? []) {
        const geom = feature.geometry
        if (!geom) continue
        const collect = (poly: unknown) => {
          if (!Array.isArray(poly)) return
          for (const ring of poly as unknown[][]) {
            if (!Array.isArray(ring)) continue
            const pts: Array<[number, number]> = []
            for (const p of ring) {
              if (!Array.isArray(p) || p.length < 2) continue
              const lon = Number(p[0]), lat = Number(p[1])
              if (Number.isFinite(lon) && Number.isFinite(lat)) pts.push([lon, lat])
            }
            if (pts.length >= 3) rings.push(pts)
          }
        }
        if (geom.type === 'Polygon') collect(geom.coordinates)
        else if (geom.type === 'MultiPolygon') for (const poly of geom.coordinates as unknown[][]) collect(poly)
      }
      precipBoundary = rings
      return rings
    } catch {
      return []
    }
  })()
  return precipBoundaryPromise
}

/** 省界投影到指定 zoom 的全局像素（缓存 per-zoom），瓦片渲染共享。 */
function boundaryProjected(map: L.Map, zoom: number): Array<Array<[number, number]>> | null {
  if (!precipBoundary) return null
  let proj = boundaryProjCache.get(zoom)
  if (!proj) {
    proj = precipBoundary
      .map((ring) => ring.map(([lon, lat]) => {
        const p = map.project([lat, lon], zoom)
        return [p.x, p.y] as [number, number]
      }))
      .filter((ring) => ring.length >= 3)
    boundaryProjCache.set(zoom, proj)
  }
  return proj
}

/** 渲染单个瓦片：64×64 低分辨率渲染（双线性插值 + 阈值渐变带）→ 高质量平滑放大。
 *  用浙江界 clip（evenodd 处理洞与岛屿），界外色斑不绘制，边界平滑抗锯齿。
 *  createTile 与 setData 复用（setData 直接重绘已有 canvas，避免 DOM 重建闪烁）。 */
function renderPrecipTile(tile: HTMLCanvasElement, coords: L.Coords, grid: PrecipValueGrid, map: L.Map): void {
  const tileSizeX = tile.width, tileSizeY = tile.height
  const ctx = tile.getContext('2d')
  if (!ctx) return
  const northWest = map.unproject([coords.x * tileSizeX, coords.y * tileSizeY], coords.z)
  const southEast = map.unproject([(coords.x + 1) * tileSizeX, (coords.y + 1) * tileSizeY], coords.z)
  const north = northWest.lat, south = southEast.lat
  const west = northWest.lng, east = southEast.lng
  const renderSize = 64
  const off = document.createElement('canvas')
  off.width = renderSize
  off.height = renderSize
  const octx = off.getContext('2d')
  if (!octx) return
  for (let ty = 0; ty < renderSize; ty++) {
    const lat = north - (north - south) * (ty + 0.5) / renderSize
    for (let tx = 0; tx < renderSize; tx++) {
      const lng = west + (east - west) * (tx + 0.5) / renderSize
      const value = interpolatePrecip(grid, lat, lng)
      if (value < 0.1) continue
      const fill = precipColor(value, 1)
      if (!fill) continue
      octx.fillStyle = fill
      octx.fillRect(tx, ty, 1, 1)
    }
  }
  ctx.imageSmoothingEnabled = true
  ctx.imageSmoothingQuality = 'high'
  const originX = coords.x * tileSizeX, originY = coords.y * tileSizeY
  const proj = boundaryProjected(map, coords.z)
  if (proj && proj.length > 0) {
    // 浙江界 clip（evenodd：外环+洞+岛屿正确），界外色斑不绘制
    ctx.save()
    try {
      ctx.beginPath()
      for (const ring of proj) {
        ctx.moveTo(ring[0][0] - originX, ring[0][1] - originY)
        for (let i = 1; i < ring.length; i++) ctx.lineTo(ring[i][0] - originX, ring[i][1] - originY)
        ctx.closePath()
      }
      ctx.clip('evenodd')
      ctx.drawImage(off, 0, 0, tileSizeX, tileSizeY)
    } finally {
      ctx.restore()
    }
  } else {
    ctx.drawImage(off, 0, 0, tileSizeX, tileSizeY)
  }
}

export class PrecipGridLayer extends L.GridLayer {
  declare options: PrecipGridLayerOptions

  constructor(options: Partial<PrecipGridLayerOptions>) {
    // fadeAnimation: false —— 缩放时新旧瓦片不做半透明叠加过渡，避免色斑颜色因叠加而漂移
    super({ tileSize: 256, opacity: 1, stepPx: 1, fadeAnimation: false, ...options } as L.GridLayerOptions)
  }

  createTile(coords: L.Coords): HTMLElement {
    const tileSize = this.getTileSize()
    const tile = document.createElement('canvas')
    tile.width = tileSize.x
    tile.height = tileSize.y
    const grid = this.options.valueGrid
    if (!grid || !this._map) return tile
    renderPrecipTile(tile, coords, grid, this._map)
    return tile
  }

  setData(grid: PrecipValueGrid | null) {
    if (this.options.valueGrid === grid) return
    this.options.valueGrid = grid
    if (!grid || !this._map) { this.redraw(); return }
    // 更新已有瓦片内容（不重建 DOM）：播放/日期切换即时替换，无瓦片闪现闪烁
    const tiles = this._tiles as Record<string, { el?: HTMLElement; coords?: L.Coords }>
    let updated = 0
    for (const key in tiles) {
      const tile = tiles[key]
      if (tile?.el instanceof HTMLCanvasElement && tile.coords) {
        renderPrecipTile(tile.el, tile.coords, grid, this._map)
        updated++
      }
    }
    if (updated === 0) this.redraw() // 尚无瓦片（未加载）时回退重建
  }

  /** 整体透明度：同步 options.opacity（避免 Leaflet _updateOpacity 在瓦片加载时用旧值覆盖容器），
   *  再直接设 .leaflet-layer 容器 CSS opacity（不重绘瓦片，拖动丝滑） */
  setOpacityValue(opacity: number) {
    const clamped = Math.min(1, Math.max(0, opacity))
    this.options.opacity = clamped
    const container = this.getContainer()
    if (container) container.style.opacity = String(clamped)
  }

  /** 覆盖 Leaflet 内部 _updateOpacity：只同步容器 opacity 并把瓦片立即全显，
   *  禁用 per-tile 200ms 渐显（缩放后颜色不瞬态变化）；
   *  注意：GridLayer 瓦片初始 opacity=0，必须显式置 1，否则色斑不可见 */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  _updateOpacity = function (this: PrecipGridLayer) {
    if (!this._map) return
    const container = this.getContainer()
    if (container) container.style.opacity = String(this.options.opacity)
    // 所有已加载瓦片立即全显（原版通过 fade 渐显到 1，这里直接置 1）
    const tiles = this._tiles as Record<string, { el?: HTMLElement }>
    for (const key in tiles) {
      const tile = tiles[key]
      if (tile?.el) tile.el.style.opacity = '1'
    }
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

let hoverStyleInjected = false
/** 注入 hover 浮窗样式（深色半透明卡片，任何底图上清晰）：分级醒目 + 数值浅蓝 */
function ensureHoverStyle() {
  if (hoverStyleInjected) return
  hoverStyleInjected = true
  const style = document.createElement('style')
  style.textContent = `
.precip-hover-wrap { position: fixed; pointer-events: none; z-index: 900; }
.precip-hover {
  display: flex; align-items: baseline; gap: 7px;
  padding: 5px 10px;
  border-radius: 7px;
  background: rgba(15, 23, 42, 0.88);
  box-shadow: 0 3px 10px rgba(15, 23, 42, 0.35);
  color: #fff;
  white-space: nowrap;
  font-size: 12px;
  line-height: 1.3;
  backdrop-filter: blur(3px);
}
.precip-hover-level { font-weight: 600; font-size: 13px; color: #fff; }
.precip-hover-value { color: #93c5fd; font-variant-numeric: tabular-nums; font-size: 12px; }
`
  document.head.appendChild(style)
}

export function createPrecipitationLayerController(options: PrecipitationLayerOptions = {}): PrecipitationLayerController {
  const initialOpacity = options.opacity ?? 1
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
      ensureHoverStyle()
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
      // 异步加载浙江界：加载完成后若已有数据则重绘（应用省界裁剪）
      void ensurePrecipBoundary().then(() => {
        if (layer && valueGrid) layer.setData(valueGrid)
      })
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
