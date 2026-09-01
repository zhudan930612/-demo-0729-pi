import L from 'leaflet'
import type { NdviRaster } from '../features/agri-monitoring/agriMonitoringTypes'
import { ndviRGB } from '../features/agri-monitoring/agriMonitoringTypes'

/** 颜色查找表：NDVI 0..1 → RGB(24bit，alpha=255)，避免逐像素 5 档颜色扫描（性能关键）。 */
const NDVI_LUT_SIZE = 256
let ndviLut: Uint32Array | null = null
function getNdviLut(): Uint32Array {
  if (ndviLut) return ndviLut
  const lut = new Uint32Array(NDVI_LUT_SIZE)
  for (let i = 0; i < NDVI_LUT_SIZE; i++) {
    const rgb = ndviRGB(i / (NDVI_LUT_SIZE - 1), 1)
    if (rgb) lut[i] = (rgb[0] << 16) | (rgb[1] << 8) | rgb[2]
  }
  ndviLut = lut
  return lut
}

export const AGRI_PANES = { grid: { name: 'agriMonitoringPane', zIndex: 400 } } as const


interface ValueGrid { lats: number[]; lons: number[]; values: number[][] } // values：NaN=无数据（透明）

/** 由结构化栅格（origin+step+cols/rows，lat 升序）重建规整值网格（缺失/无数据格为 NaN）。 */
export function buildAgriGrid(raster: NdviRaster, dateIndex: number): ValueGrid {
  const { cols, rows, layer } = { cols: raster.cols, rows: raster.rows, layer: raster.layers[dateIndex] }
  const lons = new Array<number>(cols)
  for (let c = 0; c < cols; c++) lons[c] = raster.originLon + (c + 0.5) * raster.stepLon
  const lats = new Array<number>(rows)
  for (let r = 0; r < rows; r++) lats[r] = raster.originLat + (r + 0.5) * raster.stepLat
  const values = lats.map((_lat, r) => lons.map((_lon, c) => {
    const v = layer ? layer[r * cols + c] : 0
    return v ? v / 100 : NaN // 0=无数据 → NaN（透明）
  }))
  return { lats, lons, values }
}

/** 双线性插值（NaN 感知：四邻居均 NaN 返回 NaN=透明；否则用可用邻居加权）。 */
export function interpolateAgri(grid: ValueGrid, lat: number, lon: number): number {
  const { lats, lons, values } = grid
  if (lats.length === 0 || lons.length === 0) return NaN
  if (lat < lats[0] || lat > lats[lats.length - 1] || lon < lons[0] || lon > lons[lons.length - 1]) return NaN
  // O(1) 索引：直接按网格间距求行/列（避免逐像素 while 线性搜索造成的 O(n) 卡顿）
  const latStep = lats[1] - lats[0]
  const lonStep = lons[1] - lons[0]
  const i = Math.max(0, Math.min(lats.length - 2, Math.floor((lat - lats[0]) / latStep)))
  const j = Math.max(0, Math.min(lons.length - 2, Math.floor((lon - lons[0]) / lonStep)))
  const latFrac = latStep === 0 ? 0 : (lat - lats[i]) / latStep
  const lonFrac = lonStep === 0 ? 0 : (lon - lons[j]) / lonStep
  const v00 = values[i][j]; const v10 = values[i + 1][j]; const v01 = values[i][j + 1]; const v11 = values[i + 1][j + 1]
  // 加权平均（跳过 NaN，避免边界侵蚀）
  let sum = 0; let weight = 0
  const corners: Array<[number, number]> = [
    [v00, (1 - latFrac) * (1 - lonFrac)],
    [v10, latFrac * (1 - lonFrac)],
    [v01, (1 - latFrac) * lonFrac],
    [v11, latFrac * lonFrac],
  ]
  for (const [v, w] of corners) {
    if (Number.isFinite(v)) { sum += v * w; weight += w }
  }
  if (weight === 0) return NaN
  return sum / weight
}

export class AgriGridLayer extends L.GridLayer {
  declare options: { grid: ValueGrid | null; opacity: number; pane: string }
  constructor(options: Partial<L.GridLayerOptions & { grid: ValueGrid | null }>) {
    // updateWhenZooming:false —— 缩放动画期间只做缩放变换不重算瓦片，消除逐帧卡顿；动画结束一次重算
    super({ tileSize: 256, opacity: 1, fadeAnimation: false, updateWhenZooming: false, ...options } as L.GridLayerOptions)
    this.options.grid = options.grid ?? null
  }

  createTile(coords: L.Coords): HTMLElement {
    const tileSize = this.getTileSize()
    const tile = document.createElement('canvas')
    tile.width = tileSize.x; tile.height = tileSize.y
    const grid = this.options.grid
    if (!grid || !this._map) return tile
    renderAgriTile(tile, coords, grid, this._map)
    return tile
  }

  setData(grid: ValueGrid | null) {
    this.options.grid = grid
    if (!this._map) { this.redraw(); return }
    const tiles = this._tiles as Record<string, { el?: HTMLElement; coords?: L.Coords }>
    let updated = 0
    for (const key in tiles) {
      const tile = tiles[key]
      if (tile?.el instanceof HTMLCanvasElement && tile.coords) {
        renderAgriTile(tile.el, tile.coords, grid, this._map)
        updated++
      }
    }
    if (updated === 0) this.redraw()
  }

  setOpacityValue(opacity: number) {
    const clamped = Math.min(1, Math.max(0, opacity))
    this.options.opacity = clamped
    const container = this.getContainer()
    if (container) container.style.opacity = String(clamped)
  }


  _updateOpacity = function (this: AgriGridLayer) {
    if (!this._map) return
    const container = this.getContainer()
    if (container) container.style.opacity = String(this.options.opacity)
    const tiles = this._tiles as Record<string, { el?: HTMLElement }>
    for (const key in tiles) {
      const tile = tiles[key]
      if (tile?.el) tile.el.style.opacity = '1'
    }
  } as unknown as () => void
}

/** 裁剪投影缓存（per-zoom，region 变化时清空）
 *  省界不在此裁剪——ndvi.json 生成时已把省外掩膜成 0(无数据)，热力图天然省外透明；
 *  这里只做【区域裁剪】(city/county 等，1-2 环，便宜)。null=省视角(无需裁剪)。 */
// 裁剪环索引：预计算每环 bbox + 空间网格，查询时只取瓦片附近网格的环（村级上千田块环时 O(近邻)，非 O(n) 逐瓦片）
interface ClipIndex {
  rings: Array<Array<[number, number]>>
  bboxes: Array<[number, number, number, number]>  // [minLon, minLat, maxLon, maxLat]
  cells: Map<number, number[]>
  minLon: number; minLat: number; cellSize: number; cols: number; rows: number
}

let clipIndex: ClipIndex | null = null  // 当前裁剪环索引（null=省视角）

function buildClipIndex(rings: Array<Array<[number, number]>>): ClipIndex {
  let minLon = Infinity, minLat = Infinity, maxLon = -Infinity, maxLat = -Infinity
  const bboxes: Array<[number, number, number, number]> = []
  for (const ring of rings) {
    let a = Infinity, b = Infinity, c = -Infinity, d = -Infinity
    for (const [lon, lat] of ring) {
      if (lon < a) a = lon
      if (lon > c) c = lon
      if (lat < b) b = lat
      if (lat > d) d = lat
    }
    bboxes.push([a, b, c, d])
    if (a < minLon) minLon = a
    if (b < minLat) minLat = b
    if (c > maxLon) maxLon = c
    if (d > maxLat) maxLat = d
  }
  const cellSize = 0.01  // ~1km
  const cols = Math.max(1, Math.ceil((maxLon - minLon) / cellSize))
  const rows = Math.max(1, Math.ceil((maxLat - minLat) / cellSize))
  const cells = new Map<number, number[]>()
  for (let i = 0; i < rings.length; i++) {
    const [a, b, c, d] = bboxes[i]!
    const c0 = Math.max(0, Math.floor((a - minLon) / cellSize))
    const c1 = Math.min(cols - 1, Math.floor((c - minLon) / cellSize))
    const r0 = Math.max(0, Math.floor((b - minLat) / cellSize))
    const r1 = Math.min(rows - 1, Math.floor((d - minLat) / cellSize))
    for (let r = r0; r <= r1; r++) {
      for (let col = c0; col <= c1; col++) {
        const k = r * cols + col
        const arr = cells.get(k) || []
        arr.push(i)
        cells.set(k, arr)
      }
    }
  }
  return { rings, bboxes, cells, minLon, minLat, cellSize, cols, rows }
}

function queryClipIndex(index: ClipIndex, west: number, south: number, east: number, north: number): Array<Array<[number, number]>> {
  const { rings, bboxes, cells, minLon, minLat, cellSize, cols, rows } = index
  const m = 0.02
  const c0 = Math.max(0, Math.floor((west - minLon) / cellSize))
  const c1 = Math.min(cols - 1, Math.floor((east - minLon) / cellSize))
  const r0 = Math.max(0, Math.floor((south - minLat) / cellSize))
  const r1 = Math.min(rows - 1, Math.floor((north - minLat) / cellSize))
  const seen = new Set<number>()
  const out: Array<Array<[number, number]>> = []
  for (let r = r0; r <= r1; r++) {
    for (let col = c0; col <= c1; col++) {
      const arr = cells.get(r * cols + col)
      if (!arr) continue
      for (const i of arr) {
        if (seen.has(i)) continue
        const [a, b, c, d] = bboxes[i]!
        if (a <= east + m && c >= west - m && b <= north + m && d >= south - m) {
          seen.add(i)
          out.push(rings[i]!)
        }
      }
    }
  }
  return out
}

function boundaryProjected(rings: Array<Array<[number, number]>> | null, map: L.Map, zoom: number): Array<Array<[number, number]>> | null {
  if (!rings || rings.length === 0) return null
  // 环数少，直接投影（每次新鲜计算，避免 per-zoom 缓存对村级逐瓦片过滤后的环集失效）
  const proj = rings
    .map((ring) => ring.map(([lon, lat]) => { const p = map.project([lat, lon], zoom); return [p.x, p.y] as [number, number] }))
    .filter((ring) => ring.length >= 3)
  return proj.length ? proj : null
}

/** 最近栅格采样：返回距 (lat,lon) 最近的栅格格值；无数据/越界返回 NaN。 */
export function nearestAgri(grid: ValueGrid, lat: number, lon: number): number {
  const { lats, lons, values } = grid
  if (lats.length === 0 || lons.length === 0 || lat < lats[0] || lat > lats[lats.length - 1] || lon < lons[0] || lon > lons[lons.length - 1]) return NaN
  const i = Math.max(0, Math.min(lats.length - 1, Math.round((lat - lats[0]) / (lats[1] - lats[0]))))
  const j = Math.max(0, Math.min(lons.length - 1, Math.round((lon - lons[0]) / (lons[1] - lons[0]))))
  const v = values[i]?.[j]
  return Number.isFinite(v) ? v : NaN
}

/** 瓦片渲染：全分辨率 + 最近栅格采样（清晰百米级色块，无平滑放大模糊）；省界 clip。 */
function renderAgriTile(tile: HTMLCanvasElement, coords: L.Coords, grid: ValueGrid | null, map: L.Map): void {
  const ctx = tile.getContext('2d')
  if (!ctx) return
  const tileSizeX = tile.width; const tileSizeY = tile.height
  if (!grid) { ctx.clearRect(0, 0, tileSizeX, tileSizeY); return }
  const northWest = map.unproject([coords.x * tileSizeX, coords.y * tileSizeY], coords.z)
  const southEast = map.unproject([(coords.x + 1) * tileSizeX, (coords.y + 1) * tileSizeY], coords.z)
  const north = northWest.lat; const south = southEast.lat
  const west = northWest.lng; const east = southEast.lng
  // 自适应渲染分辨率：按本瓦片覆盖的栅格格数，避免全 256×256 逐像素导致缩放卡顿
  const lonStep = (grid.lons[1] - grid.lons[0]) || 0.003
  const latStep = (grid.lats[1] - grid.lats[0]) || 0.003
  const colsInTile = Math.max(2, Math.ceil((east - west) / lonStep))
  const rowsInTile = Math.max(2, Math.ceil((north - south) / latStep))
  const renderSize = Math.max(24, Math.min(tileSizeX, Math.round(Math.max(colsInTile, rowsInTile))))
  const off = document.createElement('canvas')
  off.width = renderSize; off.height = renderSize
  const octx = off.getContext('2d')
  if (!octx) return
  // ImageData 逐像素双线性插值（连续色斑）+ 一次 putImageData（高效）
  const img = octx.createImageData(renderSize, renderSize)
  const d = img.data
  for (let ty = 0; ty < renderSize; ty++) {
    const lat = north - (north - south) * (ty + 0.5) / renderSize
    for (let tx = 0; tx < renderSize; tx++) {
      const lng = west + (east - west) * (tx + 0.5) / renderSize
      const v = interpolateAgri(grid, lat, lng)
      if (Number.isNaN(v)) continue
      const c = getNdviLut()[Math.max(0, Math.min(NDVI_LUT_SIZE - 1, Math.round(v * (NDVI_LUT_SIZE - 1))))]
      const o = (ty * renderSize + tx) * 4
      d[o] = (c >> 16) & 255; d[o + 1] = (c >> 8) & 255; d[o + 2] = c & 255; d[o + 3] = 255
    }
  }
  octx.putImageData(img, 0, 0)
  ctx.imageSmoothingEnabled = true  // 放大 off→tile 用高质量平滑（连续渐变，一次性）
  ctx.imageSmoothingQuality = 'high'
  const originX = coords.x * tileSizeX; const originY = coords.y * tileSizeY
  const tileRings = clipIndex ? queryClipIndex(clipIndex, west, south, east, north) : null
  // 裁剪区域存在但该瓦片与裁剪环集无交集 → 瓦片完全在区域外 → 透明（不漏出区域外的省级热力图）
  if (clipIndex && (!tileRings || tileRings.length === 0)) {
    ctx.clearRect(0, 0, tileSizeX, tileSizeY)
    return
  }
  const proj = tileRings && tileRings.length ? boundaryProjected(tileRings, map, coords.z) : null
  if (proj && proj.length > 0) {
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

export interface AgriLayerController {
  mount(map: L.Map): void
  setRaster(raster: NdviRaster | null): void
  setDate(index: number): void
  setClip(rings: Array<Array<[number, number]>> | null): void
  setOpacity(opacity: number): void
  setVisible(visible: boolean): void
  redraw(): void
  destroy(): void
}

export function createAgriLayerController(): AgriLayerController {
  let map: L.Map | null = null
  let layer: AgriGridLayer | null = null
  let raster: NdviRaster | null = null
  let currentDate = 0
  let grid: ValueGrid | null = null
  let currentOpacity = 1
  let visible = true

  function ensurePane(target: L.Map): HTMLElement {
    const pane = target.getPane(AGRI_PANES.grid.name) ?? target.createPane(AGRI_PANES.grid.name)
    pane.style.zIndex = String(AGRI_PANES.grid.zIndex)
    return pane
  }

  function rebuildGrid() {
    grid = raster ? buildAgriGrid(raster, currentDate) : null
    layer?.setData(grid)
  }

  return {
    mount(target: L.Map) {
      if (map) return
      map = target
      ensurePane(target)
      layer = new AgriGridLayer({ pane: AGRI_PANES.grid.name, grid, opacity: currentOpacity })
      layer.addTo(target)
      layer.setOpacityValue(currentOpacity)
      if (!visible) layer.setOpacityValue(0)
    },
    setRaster(next) {
      raster = next
      currentDate = 0
      rebuildGrid()
    },
    setDate(index) {
      currentDate = index
      rebuildGrid()
    },
    setClip(rings) {
      clipIndex = rings && rings.length ? buildClipIndex(rings) : null
      layer?.redraw()
    },
    setOpacity(next) {
      currentOpacity = Math.min(1, Math.max(0, next))
      layer?.setOpacityValue(visible ? currentOpacity : 0)
    },
    setVisible(next) {
      visible = next
      layer?.setOpacityValue(next ? currentOpacity : 0)
    },
    redraw() { layer?.redraw() },
    destroy() {
      layer?.remove()
      layer = null
      map = null
    },
  }
}
