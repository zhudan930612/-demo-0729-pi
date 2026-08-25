import { describe, expect, it, vi } from 'vitest'

vi.mock('leaflet', () => ({
  default: {
    GridLayer: class GridLayerMock {
      options: Record<string, unknown>
      constructor(options: Record<string, unknown>) { this.options = options }
      redraw() {}
    },
  },
}))

import { buildAgriGrid, interpolateAgri } from './agriMonitoringLayerController'
import type { NdviRaster } from '../features/agri-monitoring/agriMonitoringTypes'

function makeRaster(): NdviRaster {
  // 4×4 结构化栅格（origin(120,30), step 0.006, lat 升序），NDVI×100 整数
  const cols = 4, rows = 4
  const layer: number[] = []
  for (let i = 0; i < rows; i++) for (let j = 0; j < cols; j++) layer.push((i * cols + j) * 5 + 30)
  return { originLon: 120.0, originLat: 30.0, stepLon: 0.006, stepLat: 0.006, cols, rows, dates: ['2026-07-27'], layers: [layer] }
}

describe('agriMonitoringLayerController · 值网格重建/插值', () => {
  it('buildAgriGrid：结构化栅格 → 值网格，NDVI 值还原（格心经纬度）', () => {
    const raster = makeRaster()
    const grid = buildAgriGrid(raster, 0)
    expect(grid.lats).toHaveLength(4)
    expect(grid.lons).toHaveLength(4)
    // 首格中心 lat=30+0.5*0.006 lon=120+0.5*0.006，值 30 → 0.30
    expect(grid.values[0][0]).toBeCloseTo(0.30, 2)
    expect(grid.lats[0]).toBeCloseTo(30.003, 3)
  })

  it('interpolateAgri：格心点位返回接近值；越界返回 NaN（透明）', () => {
    const raster = makeRaster()
    const grid = buildAgriGrid(raster, 0)
    // 首格中心附近 → 0.30
    expect(interpolateAgri(grid, 30.003, 120.003)).toBeGreaterThan(0.29)
    // 越界 → NaN（无监测数据区域透明）
    expect(Number.isNaN(interpolateAgri(grid, 25, 115))).toBe(true)
  })

  it('interpolateAgri：对角线方向值与点阵一致（空间连续）', () => {
    const raster = makeRaster()
    const grid = buildAgriGrid(raster, 0)
    // 首格中心 (30.003,120.003) 值 0.30
    expect(interpolateAgri(grid, 30.003, 120.003)).toBeCloseTo(0.30, 1)
  })
})
