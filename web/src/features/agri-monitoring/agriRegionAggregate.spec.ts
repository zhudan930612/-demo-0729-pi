import { describe, it, expect } from 'vitest'
import { aggregateRegion, splitTownshipArea } from './agriRegionAggregate'
import type { NdviRaster } from './agriMonitoringTypes'
import { readFileSync } from 'fs'

function loadRaster(): NdviRaster {
  return JSON.parse(readFileSync('public/data/agri/ndvi.json', 'utf8')) as NdviRaster
}
function loadVillageGeom(name: string): { type: string; coordinates: unknown } {
  const fc = JSON.parse(readFileSync('public/data/villages/330324110000.geojson', 'utf8')) as { features: Array<{ properties: { name: string }; geometry: { type: string; coordinates: unknown } }> }
  const f = fc.features.find((x) => x.properties.name === name) ?? fc.features[0]!
  return f.geometry
}

describe('aggregateRegion', () => {
  it('正方形内聚合出 5级占比', () => {
    const square = { type: 'Polygon', coordinates: [[[0, 0], [1, 0], [1, 1], [0, 1], [0, 0]]] }
    const grid = { originLon: 0, originLat: 0, stepLon: 0.5, stepLat: 0.5, cols: 3, rows: 3, dates: ['d'], layers: [[10, 20, 30, 40, 50, 60, 70, 80, 90]] } as unknown as NdviRaster
    const a = aggregateRegion(grid, 0, square as never)
    expect(a).not.toBeNull()
    expect(Object.keys(a!.levels)).toHaveLength(5)
  })

  it('真实村几何（岩坦村）聚合出 5级占比 + 农田面积', () => {
    const a = aggregateRegion(loadRaster(), 0, loadVillageGeom('岩坦村'))
    expect(a).not.toBeNull()
    const sum = Object.values(a!.levels).reduce((s, v) => s + v, 0)
    expect(sum).toBeGreaterThan(0.99)
    expect(a!.farmArea).toBeGreaterThan(0)
  })

  it('村之和=镇：splitTownshipArea 按农田面积占比拆分', () => {
    const splits = splitTownshipArea(1000, [
      { code: 'a', farmArea: 300 }, { code: 'b', farmArea: 700 },
    ])
    expect(splits[0]!.area).toBe(300)
    expect(splits[1]!.area).toBe(700)
  })
})
