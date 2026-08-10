import { describe, expect, it, vi } from 'vitest'

vi.mock('leaflet', () => ({
  default: {
    GridLayer: class GridLayerMock {
      options: Record<string, unknown>
      constructor(options: Record<string, unknown>) { this.options = { tileSize: 256, opacity: 0.6, stepPx: 4, ...options } }
      redraw() {}
    },
  },
}))

import { buildValueGrid, interpolatePrecip, precipColor, PRECIP_PANES, PrecipGridLayer } from './precipitationLayerController'
import type { PrecipitationSnapshot } from '../features/precipitation/precipitationTypes'

function makeSnapshot(overrides: Partial<PrecipitationSnapshot> = {}): PrecipitationSnapshot {
  const grid = []
  for (let lat = 27.0; lat <= 31.5 + 1e-9; lat += 0.25) {
    for (let lon = 118.0; lon <= 123.0 + 1e-9; lon += 0.25) {
      grid.push({ lat: Math.round(lat * 1000) / 1000, lon: Math.round(lon * 1000) / 1000, values: { d1: 0, d2: 0, d3: 0, d4: 0, d5: 0, d6: 0, d7: 0 } })
    }
  }
  return { grid, days: ['2026-08-10', '2026-08-11', '2026-08-12', '2026-08-13', '2026-08-14', '2026-08-15', '2026-08-16'], coveredDays: 7, model: 'ECMWF IFS 0.25°', updatedAt: 'x', aggregateFrom: 'y', ...overrides }
}

describe('precipColor 分档色阶 + 阈值渐变带（平滑边界，缩放颜色稳定）', () => {
  it('低于 0.1 或 alpha<=0 返回 null（无雨透明）', () => {
    expect(precipColor(0, 0.6)).toBeNull()
    expect(precipColor(0.05, 0.6)).toBeNull()
    expect(precipColor(30, 0)).toBeNull()
  })
  it('档内中部值取档色（纯色，缩放稳定）', () => {
    expect(precipColor(5, 1)).toMatch(/^rgba\(208,240,170,0\.750\)$/) // 小雨
    expect(precipColor(15, 1)).toMatch(/^rgba\(122,204,112,0\.850\)$/) // 中雨
    expect(precipColor(30, 1)).toMatch(/^rgba\(82,172,152,0\.900\)$/) // 大雨
    expect(precipColor(60, 1)).toMatch(/^rgba\(52,112,222,0\.950\)$/) // 暴雨
    expect(precipColor(150, 1)).toMatch(/^rgba\(158,60,212,1\.000\)$/) // 大暴雨
    expect(precipColor(300, 1)).toMatch(/^rgba\(204,46,196,1\.000\)$/) // 特大暴雨
  })
  it('阈值渐变带：带内颜色平滑过渡（消除硬边界锯齿）', () => {
    const atThreshold = precipColor(10, 1)
    const inBand = precipColor(11, 1)
    const aboveBand = precipColor(12, 1)
    expect(atThreshold).not.toBe(aboveBand)
    expect(inBand).not.toBe(aboveBand)
    expect(inBand).not.toBe(atThreshold)
  })
  it('分层透明度与滑动条基础透明度相乘：强降水在 60% 基础下仍更实', () => {
    expect(precipColor(300, 0.6)).toContain('0.600')
    const light = precipColor(5, 0.6)
    const heavy = precipColor(300, 0.6)
    const lightAlpha = Number(light!.match(/[\d.]+(?=\)$)/)![0])
    const heavyAlpha = Number(heavy!.match(/[\d.]+(?=\)$)/)![0])
    expect(lightAlpha).toBeLessThan(heavyAlpha)
  })
})

describe('buildValueGrid 网格重建', () => {
  it('399 点重建为 19 行 × 21 列，排序正确', () => {
    const grid = buildValueGrid(makeSnapshot(), 'd1')
    expect(grid.lats).toHaveLength(19)
    expect(grid.lons).toHaveLength(21)
    expect(grid.lats[0]).toBe(27); expect(grid.lats[18]).toBe(31.5)
    expect(grid.lons[0]).toBe(118); expect(grid.lons[20]).toBe(123)
    expect(grid.values).toHaveLength(19)
    expect(grid.values[0]).toHaveLength(21)
  })
  it('缺失点位补 0', () => {
    const snapshot = makeSnapshot()
    snapshot.grid = snapshot.grid.filter((point) => !(point.lat === 30 && point.lon === 120))
    const grid = buildValueGrid(snapshot, 'd1')
    expect(grid.values[grid.lats.indexOf(30)][grid.lons.indexOf(120)]).toBe(0)
  })
})

describe('interpolatePrecip 双线性插值', () => {
  it('网格点上取值精确', () => {
    const snapshot = makeSnapshot()
    snapshot.grid.forEach((point) => { point.values.d2 = point.lat * 100 + point.lon })
    const grid = buildValueGrid(snapshot, 'd2')
    expect(interpolatePrecip(grid, 27, 118)).toBe(27 * 100 + 118)
    expect(interpolatePrecip(grid, 31.5, 123)).toBe(31.5 * 100 + 123)
  })
  it('两网格点中点取均值', () => {
    const snapshot = makeSnapshot()
    snapshot.grid.forEach((point) => { point.values.d1 = point.lon === 120 ? 10 : point.lon === 120.25 ? 20 : 0 })
    const grid = buildValueGrid(snapshot, 'd1')
    expect(interpolatePrecip(grid, 27, 120.125)).toBeCloseTo(15, 5)
  })
  it('越界返回 0', () => {
    const grid = buildValueGrid(makeSnapshot(), 'd1')
    expect(interpolatePrecip(grid, 32, 120)).toBe(0)
    expect(interpolatePrecip(grid, 30, 117)).toBe(0)
  })
})

describe('PRECIP_PANES 与 GridLayer', () => {
  it('pane zIndex 低于注记 450', () => {
    expect(PRECIP_PANES.grid.zIndex).toBeLessThan(450)
  })
  it('PrecipGridLayer 继承 GridLayer（瓦片参与 Leaflet 缩放/平移动画）', () => {
    expect(PrecipGridLayer.prototype).toBeInstanceOf(Object)
    expect(new PrecipGridLayer({}).options.tileSize).toBe(256)
  })
})
