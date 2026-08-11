import { describe, expect, it, vi } from 'vitest'
import type { PrecipGridPoint } from '../precipitation/precipitationTypes'
import type { TyphoonDetail, ObservationNode } from '../typhoon/typhoonTypes'
import {
  alarmItems,
  computeVillageRisk,
  countyCodeOf,
  coveredGridPoints,
  geometricCentroid,
  INSURED_VILLAGE_CODES,
  loadInsuredVillages,
  latestTyphoonRiskPaths,
  observationRiskPath,
  pointInRing,
  pointInVillage,
  townshipFileOf,
  type VillageBoundary,
} from './villageRiskData'

function village(overrides: Partial<VillageBoundary> = {}): VillageBoundary {
  return {
    code: '330604102016',
    name: '清潭村',
    polygons: [[
      [[120.8, 29.7], [120.9, 29.7], [120.9, 29.8], [120.8, 29.8], [120.8, 29.7]],
    ]],
    bbox: { latMin: 29.7, latMax: 29.8, lonMin: 120.8, lonMax: 120.9 },
    centroid: { lat: 29.75, lon: 120.85 },
    countyCode: '330604',
    ...overrides,
  }
}

function gridPoint(lat: number, lon: number): PrecipGridPoint {
  return { lat, lon, values: { d1: 10, d2: 20, d3: 30, d4: 5, d5: 0, d6: 0, d7: 0 } }
}

describe('参保村清单与区县推导', () => {
  it('13 村代码齐全（章镇 8 + 三界 5）', () => {
    expect(INSURED_VILLAGE_CODES).toHaveLength(13)
    expect(INSURED_VILLAGE_CODES.filter((c) => c.startsWith('330604102'))).toHaveLength(8)
    expect(INSURED_VILLAGE_CODES.filter((c) => c.startsWith('330683104'))).toHaveLength(5)
  })
  it('countyCodeOf 取前 6 位（章镇→330604 上虞区，三界→330683 嵊州市）', () => {
    expect(countyCodeOf('330604102016')).toBe('330604')
    expect(countyCodeOf('330683104307')).toBe('330683')
  })
  it('townshipFileOf 按村码前缀匹配乡镇文件（前缀≠乡镇码）', () => {
    expect(townshipFileOf('330604102016')).toBe('/data/villages/330604104000.geojson')
    expect(townshipFileOf('330683104307')).toBe('/data/villages/330683104000.geojson')
    expect(townshipFileOf('330100000000')).toBeNull()
  })
})

describe('loadInsuredVillages 村界加载', () => {
  it('从两个乡镇文件提取 13 村边界（名称/几何/区县/质心）', async () => {
    const makeFeature = (code: string, name: string) => ({
      properties: { code, name },
      geometry: { type: 'Polygon', coordinates: [[[120.8, 29.7], [120.9, 29.7], [120.9, 29.8], [120.8, 29.8], [120.8, 29.7]]] },
    })
    const zhang = { features: INSURED_VILLAGE_CODES.filter((c) => c.startsWith('330604102')).map((c) => makeFeature(c, `章${c.slice(-4)}`)) }
    const sanjie = { features: INSURED_VILLAGE_CODES.filter((c) => c.startsWith('330683104')).map((c) => makeFeature(c, `界${c.slice(-4)}`)) }
    const fetchImpl = vi.fn(async (url: string) => {
      if (String(url).includes('330604104000')) return { ok: true, json: async () => zhang } as Response
      if (String(url).includes('330683104000')) return { ok: true, json: async () => sanjie } as Response
      return { ok: false } as Response
    })
    const result = await loadInsuredVillages(fetchImpl as unknown as typeof fetch)
    expect(result).toHaveLength(13)
    expect(result.find((v) => v.code === '330604102016')?.name).toBe('章2016')
    expect(result.every((v) => v.countyCode === v.code.slice(0, 6))).toBe(true)
    expect(result.every((v) => v.polygons.length > 0)).toBe(true)
  })
  it('文件失败降级为空（不阻断）', async () => {
    const fetchImpl = vi.fn(async () => ({ ok: false }) as Response)
    expect(await loadInsuredVillages(fetchImpl as unknown as typeof fetch)).toEqual([])
  })
})

describe('点在多边形内', () => {
  it('pointInRing 内外判定', () => {
    const ring: Array<[number, number]> = [[120.8, 29.7], [120.9, 29.7], [120.9, 29.8], [120.8, 29.8], [120.8, 29.7]]
    expect(pointInRing(29.75, 120.85, ring)).toBe(true)
    expect(pointInRing(29.6, 120.85, ring)).toBe(false)
  })
  it('pointInVillage 支持洞（外环内但洞内不算）', () => {
    const withHole = village({
      polygons: [[
        [[120.8, 29.7], [120.9, 29.7], [120.9, 29.8], [120.8, 29.8], [120.8, 29.7]],
        [[120.84, 29.74], [120.86, 29.74], [120.86, 29.76], [120.84, 29.76], [120.84, 29.74]],
      ]],
    })
    expect(pointInVillage(29.75, 120.85, withHole)).toBe(false) // 洞内
    expect(pointInVillage(29.79, 120.81, withHole)).toBe(true) // 洞外
  })
  it('MultiPolygon 任一 polygon 命中即算', () => {
    const multi = village({
      polygons: [
        [[[120.8, 29.7], [120.85, 29.7], [120.85, 29.75], [120.8, 29.75], [120.8, 29.7]]],
        [[[120.95, 29.75], [120.99, 29.75], [120.99, 29.79], [120.95, 29.79], [120.95, 29.75]]],
      ],
    })
    expect(pointInVillage(29.77, 120.97, multi)).toBe(true)
    expect(pointInVillage(29.9, 120.9, multi)).toBe(false)
  })
})

describe('coveredGridPoints 村界覆盖网格点', () => {
  const grid = [
    gridPoint(29.75, 120.85), // 村内
    gridPoint(29.75, 120.5), // 村外
    gridPoint(29.5, 121.0), // 村外远
  ]
  it('村内网格点入选', () => {
    const covered = coveredGridPoints(village(), grid)
    expect(covered.map((p) => [p.lat, p.lon])).toContainEqual([29.75, 120.85])
    expect(covered).toHaveLength(1)
  })
  it('小村落在网格缝隙：按 bbox 中心单元关联至少 1 点', () => {
    // 村 bbox 中心 (29.755, 120.855)，网格点 (29.75,120.85) 距中心 0.005° < 0.125 → 关联
    const tiny = village({ polygons: [[[[120.854, 29.754], [120.856, 29.754], [120.856, 29.756], [120.854, 29.756], [120.854, 29.754]]]], bbox: { latMin: 29.754, latMax: 29.756, lonMin: 120.854, lonMax: 120.856 }, centroid: { lat: 29.755, lon: 120.855 } })
    const covered = coveredGridPoints(tiny, grid)
    expect(covered.length).toBeGreaterThanOrEqual(1)
  })
  it('单元四角与村相交也算覆盖', () => {
    // 网格点 (29.75,120.5) 的单元角 (29.75-0.125=29.625,120.5-0.125=120.375)…构造村覆盖其单元一角
    const cornerVillage = village({ polygons: [[[[120.38, 29.62], [120.39, 29.62], [120.39, 29.63], [120.38, 29.63], [120.38, 29.62]]]], bbox: { latMin: 29.62, latMax: 29.63, lonMin: 120.38, lonMax: 120.39 }, centroid: { lat: 29.625, lon: 120.385 } })
    const covered = coveredGridPoints(cornerVillage, grid)
    expect(covered.map((p) => [p.lat, p.lon])).toContainEqual([29.75, 120.5])
  })
})

describe('台风/预警数据提取', () => {
  const observation = (overrides: Partial<ObservationNode> = {}): ObservationNode => ({
    id: 'obs-1', sourceIndex: 0, timeYmdh: '2026-08-01 20:00:00', epochMs: 1, lat: 30, lon: 120, windSpeedMs: 25, pressureHpa: 960, intensityText: '台风',
    windRadii: [{ grade: '7', neRadiusKm: 300, seRadiusKm: 300, swRadiusKm: 300, nwRadiusKm: 300 }],
    forecastSnapshot: { observationId: 'obs-1', nodes: [{ id: 'f1', sourceIndex: 0, forecastHour: 24, lat: 30.2, lon: 120.5, windSpeedMs: 22 }], maxForecastHour: 24, historicalVersionConfirmed: true },
    ...overrides,
  })
  it('observationRiskPath 首点观测 + 预报点（含强度文本）', () => {
    const path = observationRiskPath(observation())
    expect(path).toHaveLength(2)
    expect(path[0]?.intensityText).toBe('台风')
    expect(path[1]?.windSpeedMs).toBe(22)
    expect(observationRiskPath(null)).toEqual([])
  })
  it('latestTyphoonRiskPaths 只取实时台风且有最近观测', () => {
    const detail = { status: 'start', latestObservation: observation() } as TyphoonDetail
    const stopped = { status: 'stop', latestObservation: observation() } as TyphoonDetail
    const noObs = { status: 'start', latestObservation: null } as TyphoonDetail
    const result = latestTyphoonRiskPaths([detail, stopped, noObs])
    expect(result).toHaveLength(1)
    expect(result[0]?.maxForecastHour).toBe(24)
  })
  it('alarmItems 从快照映射 adminCode/eventType/severity', () => {
    const snapshot = { items: [{ adminCode: '330604', eventType: '暴雨', severity: 'orange' }] }
    expect(alarmItems(snapshot as never)).toEqual([{ adminCode: '330604', eventType: '暴雨', severity: 'orange' }])
    expect(alarmItems(null)).toEqual([])
  })
})

describe('computeVillageRisk 村级风险装配', () => {
  const snapshot = {
    grid: [
      { lat: 29.75, lon: 120.85, values: { d1: 60, d2: 0, d3: 0, d4: 10, d5: 0, d6: 0, d7: 0 } }, // 村内：d1=60 → 峰值 60 → 3 级（v3.8 ≥25）；无连阴雨（单日暴雨不判）
    ],
    days: ['2026-08-10', '2026-08-11', '2026-08-12', '2026-08-13', '2026-08-14', '2026-08-15', '2026-08-16'],
    coveredDays: 7, model: 'x', updatedAt: '', aggregateFrom: '',
  }
  const v = village()
  it('无台风无预警：仅降水峰值定级', () => {
    const result = computeVillageRisk({ village: v, snapshot: snapshot as never, typhoons: [], alarms: [] })
    expect(result.peak).toEqual({ level: 3, mm: 60, dayIndex: 0 })
    expect(result.precipSignal).toBe(3)
    expect(result.typhoonSignal).toBe(0)
    expect(result.level).toBe(3)
  })
  it('台风覆盖 + 降水暴雨 → 组合直接高', () => {
    const typhoons = [{ path: [{ lat: 29.9, lon: 120.9, windSpeedMs: 20 }], windRadii: null }] // 距村质心 (29.75,120.85) 约 17km → 覆盖
    const result = computeVillageRisk({ village: v, snapshot: snapshot as never, typhoons, alarms: [] })
    expect(result.typhoonSignal).toBe(2)
    expect(result.level).toBe(3) // P≥2 且 T≥2 → 3
  })
  it('预警提级 +1', () => {
    const alarms = [{ adminCode: '330604', eventType: '暴雨', severity: 'yellow' }]
    const result = computeVillageRisk({ village: v, snapshot: snapshot as never, typhoons: [], alarms })
    expect(result.alarmSignal).toBe(1)
    expect(result.matchedEvent).toBe('暴雨')
    expect(result.level).toBe(3) // 2+1
  })
  it('红色预警直接高', () => {
    const alarms = [{ adminCode: '330604', eventType: '暴雨', severity: 'red' }]
    const result = computeVillageRisk({ village: v, snapshot: snapshot as never, typhoons: [], alarms })
    expect(result.alarmSignal).toBe(3)
    expect(result.level).toBe(3)
  })
  it('降水快照不可用 → 降水信号 0（其余源照常）', () => {
    const alarms = [{ adminCode: '330604', eventType: '暴雨', severity: 'yellow' }]
    const result = computeVillageRisk({ village: v, snapshot: null, typhoons: [], alarms })
    expect(result.precipSignal).toBe(0)
    expect(result.peak).toEqual({ level: 0, mm: 0, dayIndex: 0 })
    expect(result.level).toBe(1) // 0 + 预警 1
  })
  it('全源无信号 → 无风险', () => {
    const result = computeVillageRisk({ village: v, snapshot: null, typhoons: [], alarms: [] })
    expect(result.level).toBe(0)
  })
})

describe('geometricCentroid 村级几何质心', () => {
  it('L 形村：bbox 中心落在缺口外，质心落在村域内', () => {
    // L 形：右下方缺口（右下角 120.1-120.2 × 29.0-29.1 缺失）
    const polygons: Array<Array<Array<[number, number]>>> = [[
      [[120.0, 29.0], [120.2, 29.0], [120.2, 29.1], [120.1, 29.1], [120.1, 29.2], [120.0, 29.2], [120.0, 29.0]],
    ]]
    const bbox = { latMin: 29.0, latMax: 29.2, lonMin: 120.0, lonMax: 120.2 }
    const village = { code: 'x', name: 'x', polygons, bbox, centroid: { lat: 0, lon: 0 }, countyCode: '' }
    // 右上缺口点 (29.15, 120.15) 不在村内 → 缺口确实存在
    expect(pointInVillage(29.15, 120.15, village)).toBe(false)
    const c = geometricCentroid(polygons, bbox)
    expect(pointInVillage(c.lat, c.lon, village)).toBe(true)
    // 质心偏向 L 的重心（≈29.083, 120.083），避开右上缺口
    expect(c.lat).toBeGreaterThan(29.0)
    expect(c.lat).toBeLessThan(29.1)
    expect(c.lon).toBeGreaterThan(120.0)
    expect(c.lon).toBeLessThan(120.1)
  })

  it('带洞村：质心落在洞内时兜底扫描到村域内', () => {
    // 大方块中央挖洞（质心=洞中心，不在村内 → 兜底）
    const polygons: Array<Array<Array<[number, number]>>> = [[
      [[120.0, 29.0], [120.4, 29.0], [120.4, 29.4], [120.0, 29.4], [120.0, 29.0]],
      [[120.15, 29.15], [120.25, 29.15], [120.25, 29.25], [120.15, 29.25], [120.15, 29.15]],
    ]]
    const bbox = { latMin: 29.0, latMax: 29.4, lonMin: 120.0, lonMax: 120.4 }
    const c = geometricCentroid(polygons, bbox)
    // 兜底点必须在村内（不在洞内、在外环内）
    const inOuter = c.lat >= 29.0 && c.lat <= 29.4 && c.lon >= 120.0 && c.lon <= 120.4
    const inHole = c.lat > 29.15 && c.lat < 29.25 && c.lon > 120.15 && c.lon < 120.25
    expect(inOuter).toBe(true)
    expect(inHole).toBe(false)
  })

  it('普通矩形：质心=bbox 中心（在村内）', () => {
    const polygons: Array<Array<Array<[number, number]>>> = [[
      [[120.0, 29.0], [120.2, 29.0], [120.2, 29.2], [120.0, 29.2], [120.0, 29.0]],
    ]]
    const bbox = { latMin: 29.0, latMax: 29.2, lonMin: 120.0, lonMax: 120.2 }
    const c = geometricCentroid(polygons, bbox)
    expect(c.lat).toBeCloseTo(29.1, 6)
    expect(c.lon).toBeCloseTo(120.1, 6)
  })
})
