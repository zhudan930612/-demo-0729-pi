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
  // 4×4 规则栅格（省内点），NDVI×100 整数
  const grid = []
  const lats = [30.0, 30.006, 30.012, 30.018]
  const lons = [120.0, 120.006, 120.012, 120.018]
  for (let i = 0; i < lats.length; i++) {
    for (let j = 0; j < lons.length; j++) {
      grid.push({ lat: lats[i], lon: lons[j], values: [(i * 4 + j) * 5 + 30] })
    }
  }
  return { dates: ['2026-07-27'], grid }
}

describe('agriMonitoringLayerController · 值网格重建/插值', () => {
  it('buildAgriGrid：由稀疏点阵重建规整网格，NDVI 值还原', () => {
    const raster = makeRaster()
    const grid = buildAgriGrid(raster, 0)
    expect(grid.lats).toHaveLength(4)
    expect(grid.lons).toHaveLength(4)
    // 第一个点 lat=30 lon=120 values=30 → 0.30
    expect(grid.values[0][0]).toBeCloseTo(0.30, 2)
  })

  it('interpolateAgri：栅格内点位返回接近值；越界返回 NaN（透明）', () => {
    const raster = makeRaster()
    const grid = buildAgriGrid(raster, 0)
    // 落在第一个点附近 → 0.30
    expect(interpolateAgri(grid, 30.0005, 120.0005)).toBeGreaterThan(0.29)
    // 越界 → NaN（无监测数据区域透明）
    expect(Number.isNaN(interpolateAgri(grid, 25, 115))).toBe(true)
  })

  it('interpolateAgri：对角线方向值与点阵一致（空间连续）', () => {
    const raster = makeRaster()
    const grid = buildAgriGrid(raster, 0)
    // (30,120) 值 0.30
    expect(interpolateAgri(grid, 30.0, 120.0)).toBeCloseTo(0.30, 1)
  })
})
