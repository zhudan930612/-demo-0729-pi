import L from 'leaflet'
import type { NdviRaster } from '../features/agri-monitoring/agriMonitoringTypes'
import { ndviColor } from '../features/agri-monitoring/agriMonitoringTypes'
import { ndviValue } from '../features/agri-monitoring/agriMonitoringData'
import { ensurePrecipBoundary } from './precipitationLayerController'

export const AGRI_PANES = { grid: { name: 'agriMonitoringPane', zIndex: 430 } } as const

/** 瓦片渲染分辨率 */
const RENDER_SIZE = 64

interface ValueGrid { lats: number[]; lons: number[]; values: number[][] } // values：NaN=无数据（透明）

/** 由稀疏点阵重建规整值网格（缺失格为 NaN）。 */
export function buildAgriGrid(raster: NdviRaster, dateIndex: number): ValueGrid {
  const latSet = new Set<number>(); const lonSet = new Set<number>()
  for (const p of raster.grid) { latSet.add(p.lat); lonSet.add(p.lon) }
  const lats = [...latSet].sort((a, b) => a - b)
  const lons = [...lonSet].sort((a, b) => a - b)
  const li = new Map(lats.map((l, i) => [l, i]))
  const lj = new Map(lons.map((l, i) => [l, i]))
  const values = lats.map(() => new Array<number>(lons.length).fill(NaN))
  for (const p of raster.grid) {
    const ri = li.get(p.lat); const ci = lj.get(p.lon)
    if (ri === undefined || ci === undefined) continue
    values[ri][ci] = ndviValue(p.values[dateIndex] ?? 0)
  }
  return { lats, lons, values }
}

/** 双线性插值（NaN 感知：四邻居均 NaN 返回 NaN=透明；否则用可用邻居加权）。 */
export function interpolateAgri(grid: ValueGrid, lat: number, lon: number): number {
  const { lats, lons, values } = grid
  if (lat < lats[0] || lat > lats[lats.length - 1] || lon < lons[0] || lon > lons[lons.length - 1]) return NaN
  let i = 0; let j = 0
  while (i < lats.length - 2 && lats[i + 1] <= lat) i++
  while (j < lons.length - 2 && lons[j + 1] <= lon) j++
  const latFrac = lats[i + 1] === lats[i] ? 0 : (lat - lats[i]) / (lats[i + 1] - lats[i])
  const lonFrac = lons[j + 1] === lons[j] ? 0 : (lon - lons[j]) / (lons[j + 1] - lons[j])
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
    super({ tileSize: 256, opacity: 1, fadeAnimation: false, ...options } as L.GridLayerOptions)
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

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
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

/** 省界投影缓存（per-zoom） */
const boundaryProjCache = new Map<number, Array<Array<[number, number]>>>()
let agriBoundaryRings: Array<Array<[number, number]>> | null = null
let agriBoundaryPromise: Promise<Array<Array<[number, number]>>> | null = null

function boundaryProjected(map: L.Map, zoom: number): Array<Array<[number, number]>> | null {
  if (!agriBoundaryRings) return null
  let proj = boundaryProjCache.get(zoom)
  if (!proj) {
    proj = agriBoundaryRings
      .map((ring) => ring.map(([lon, lat]) => { const p = map.project([lat, lon], zoom); return [p.x, p.y] as [number, number] }))
      .filter((ring) => ring.length >= 3)
    boundaryProjCache.set(zoom, proj)
  }
  return proj
}

/** 瓦片渲染：低分辨率采样 + 插值 → 高质量平滑放大；省界 clip（evenodd 处理洞与岛屿）。 */
function renderAgriTile(tile: HTMLCanvasElement, coords: L.Coords, grid: ValueGrid | null, map: L.Map): void {
  const ctx = tile.getContext('2d')
  if (!ctx) return
  const tileSizeX = tile.width; const tileSizeY = tile.height
  if (!grid) { ctx.clearRect(0, 0, tileSizeX, tileSizeY); return }
  const northWest = map.unproject([coords.x * tileSizeX, coords.y * tileSizeY], coords.z)
  const southEast = map.unproject([(coords.x + 1) * tileSizeX, (coords.y + 1) * tileSizeY], coords.z)
  const north = northWest.lat; const south = southEast.lat
  const west = northWest.lng; const east = southEast.lng
  const off = document.createElement('canvas')
  off.width = RENDER_SIZE; off.height = RENDER_SIZE
  const octx = off.getContext('2d')
  if (!octx) return
  // 先采样到离屏
  const sampled = new Array<number>(RENDER_SIZE * RENDER_SIZE)
  for (let ty = 0; ty < RENDER_SIZE; ty++) {
    const lat = north - (north - south) * (ty + 0.5) / RENDER_SIZE
    for (let tx = 0; tx < RENDER_SIZE; tx++) {
      const lng = west + (east - west) * (tx + 0.5) / RENDER_SIZE
      const value = interpolateAgri(grid, lat, lng)
      sampled[ty * RENDER_SIZE + tx] = value
    }
  }
  // 上色
  for (let ty = 0; ty < RENDER_SIZE; ty++) {
    for (let tx = 0; tx < RENDER_SIZE; tx++) {
      const v = sampled[ty * RENDER_SIZE + tx]
      const fill = Number.isFinite(v) ? ndviColor(v, 1) : null
      if (!fill) continue
      octx.fillStyle = fill
      octx.fillRect(tx, ty, 1, 1)
    }
  }
  ctx.imageSmoothingEnabled = true
  ctx.imageSmoothingQuality = 'high'
  const originX = coords.x * tileSizeX; const originY = coords.y * tileSizeY
  const proj = boundaryProjected(map, coords.z)
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
      // 异步省界：加载完成后重绘（应用裁剪）
      if (!agriBoundaryPromise) {
        agriBoundaryPromise = ensurePrecipBoundary().then((rings) => { agriBoundaryRings = rings; return rings })
      }
      void agriBoundaryPromise.then(() => { if (layer && grid) layer.setData(grid) })
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
