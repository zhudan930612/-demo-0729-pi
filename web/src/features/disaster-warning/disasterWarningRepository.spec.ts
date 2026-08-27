import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../../api/data', () => ({ fetchJSON: vi.fn() }))

import { fetchJSON } from '../../api/data'
import { loadDisasterWarningData, isValidTrack, isValidPrecip, isValidWarnings, isValidUnderwriting, isValidRiskModel, DISASTER_DATA_DIR } from './disasterWarningRepository'
import type { DisasterTrack, DisasterPrecip, DisasterWarnings, DisasterUnderwriting, DisasterRiskModel, DisasterPanel } from './types'

const mockFetch = vi.mocked(fetchJSON)

const track: DisasterTrack = {
  code: 200, no1: '3257931', no2: '2609', namecn: '巴威', type: 'stop',
  datas: [{ time_ymdh: '2026-07-09 00:00:00', lat: 28.1, lon: 121.2 }],
}
const precip: DisasterPrecip = {
  schemaVersion: 1, model: 'ERA5', aggregateFrom: '2026-07-09 00:00:00',
  nodeTimes: ['2026-07-09 00:00:00'], grid: [{ lat: 28.084, lon: 121.220, cum: [0.0] }],
}
const warnings: DisasterWarnings = {
  schemaVersion: 1, thresholds: { low: 170, mid: 175, high: 180 }, hysteresisNodes: 2,
  nodeTimes: ['2026-07-09 00:00:00'], villages: [], nodes: [{ i: 0, w: [] }],
}
const underwriting: DisasterUnderwriting = {
  schemaVersion: 1, seed: 'x', sumInsuredPerMu: 1250, targetTotalMu: 100000,
  villages: [{ code: '330382101001', name: 'A村', insuredAreaMu: 100, householdCount: 10, sumInsuredYuan: 125000, source: 'mock' }],
}
const riskModel: DisasterRiskModel = {
  schemaVersion: 1,
  riskLevelFromCumRainMm: [{ max: 50, level: 0, name: '无', coefficient: 0.2 }],
  lossRateByWarningLevel: [{ level: 1, name: '低', lossRate: 0.03 }],
  formula: 'x',
}
const panel: DisasterPanel = {
  schemaVersion: 1,
  nodeTimes: ['2026-07-09 00:00:00'],
  perNode: [{ i: 0, time: '2026-07-09 00:00:00', loss: { areaWanMu: 0, households: 0, amountWanYuan: 0 }, sorted: [], byIdx: {} }],
}

function mockAll(mock: typeof mockFetch) {
  mock.mockImplementation(async (url: string) => {
    if (url.endsWith('/track.json')) return track
    if (url.endsWith('/precip.json')) return precip
    if (url.endsWith('/warnings.json')) return warnings
    if (url.endsWith('/underwriting.json')) return underwriting
    if (url.endsWith('/risk-model.json')) return riskModel
    if (url.endsWith('/panel.json')) return panel
      if (url.endsWith('/panel.json')) return panel
    throw new Error(`${url} -> 404`)
  })
}

describe('loadDisasterWarningData · 六份静态产物（契约 §6）', () => {
  beforeEach(() => { vi.clearAllMocks() })

  it('六份产物齐全且结构合法 → 返回组合数据', async () => {
    mockAll(mockFetch)
    const data = await loadDisasterWarningData()
    expect(data.track.datas).toHaveLength(1)
    expect(data.precip.grid).toHaveLength(1)
    expect(data.warnings.nodes).toHaveLength(1)
    expect(data.underwriting.villages).toHaveLength(1)
    expect(data.riskModel.riskLevelFromCumRainMm).toHaveLength(1)
    expect(data.panel.perNode).toHaveLength(1)
  })

  it('R2-18 任一文件 404 → 整体失败（拒绝）', async () => {
    mockFetch.mockImplementation(async (url: string) => {
      if (url.endsWith('/track.json')) throw new Error('404')
      if (url.endsWith('/precip.json')) return precip
      if (url.endsWith('/warnings.json')) return warnings
      if (url.endsWith('/underwriting.json')) return underwriting
      if (url.endsWith('/risk-model.json')) return riskModel
      if (url.endsWith('/panel.json')) return panel
      throw new Error(`${url} -> 404`)
    })
    await expect(loadDisasterWarningData()).rejects.toThrow()
  })

  it('R2-18 轨迹 datas 为空 → 结构校验失败', async () => {
    mockFetch.mockImplementation(async (url: string) => {
      if (url.endsWith('/track.json')) return { ...track, datas: [] }
      if (url.endsWith('/precip.json')) return precip
      if (url.endsWith('/warnings.json')) return warnings
      if (url.endsWith('/underwriting.json')) return underwriting
      if (url.endsWith('/risk-model.json')) return riskModel
      if (url.endsWith('/panel.json')) return panel
      throw new Error(`${url} -> 404`)
    })
    await expect(loadDisasterWarningData()).rejects.toThrow('巴威轨迹数据缺失')
  })

  it('R2-18 降雨网格为空 → 结构校验失败', async () => {
    mockFetch.mockImplementation(async (url: string) => {
      if (url.endsWith('/track.json')) return track
      if (url.endsWith('/precip.json')) return { ...precip, grid: [] }
      if (url.endsWith('/warnings.json')) return warnings
      if (url.endsWith('/underwriting.json')) return underwriting
      if (url.endsWith('/risk-model.json')) return riskModel
      if (url.endsWith('/panel.json')) return panel
      throw new Error(`${url} -> 404`)
    })
    await expect(loadDisasterWarningData()).rejects.toThrow('历史降雨网格数据缺失')
  })

  it('R2-18 承保数据缺失 → 结构校验失败', async () => {
    mockFetch.mockImplementation(async (url: string) => {
      if (url.endsWith('/track.json')) return track
      if (url.endsWith('/precip.json')) return precip
      if (url.endsWith('/warnings.json')) return warnings
      if (url.endsWith('/underwriting.json')) return { ...underwriting, villages: [] }
      if (url.endsWith('/risk-model.json')) return riskModel
      if (url.endsWith('/panel.json')) return panel
      throw new Error(`${url} -> 404`)
    })
    await expect(loadDisasterWarningData()).rejects.toThrow('承保数据缺失')
  })
})

describe('结构校验函数（契约 §6）', () => {
  it('isValidTrack：datas 非空且每节点有时间/经纬度', () => {
    expect(isValidTrack(track)).toBe(true)
    expect(isValidTrack(null)).toBe(false)
    expect(isValidTrack({ ...track, datas: [] })).toBe(false)
    expect(isValidTrack({ ...track, datas: [{ time_ymdh: '', lat: Number.NaN, lon: 0 }] })).toBe(false)
  })
  it('isValidPrecip：nodeTimes/grid 非空且格点含 lat/lon/cum', () => {
    expect(isValidPrecip(precip)).toBe(true)
    expect(isValidPrecip(null)).toBe(false)
    expect(isValidPrecip({ ...precip, grid: [] })).toBe(false)
    expect(isValidPrecip({ ...precip, nodeTimes: [] })).toBe(false)
  })
  it('isValidWarnings：villages/nodes 为数组且阈值为数值', () => {
    expect(isValidWarnings(warnings)).toBe(true)
    expect(isValidWarnings(null)).toBe(false)
    expect(isValidWarnings({ ...warnings, villages: undefined as never })).toBe(false)
    expect(isValidWarnings({ ...warnings, thresholds: { low: 'a' as never, mid: 175, high: 180 } })).toBe(false)
  })
  it('isValidUnderwriting：villages 非空', () => {
    expect(isValidUnderwriting(underwriting)).toBe(true)
    expect(isValidUnderwriting(null)).toBe(false)
    expect(isValidUnderwriting({ ...underwriting, villages: [] })).toBe(false)
  })
  it('isValidRiskModel：风险分档/损失率映射非空', () => {
    expect(isValidRiskModel(riskModel)).toBe(true)
    expect(isValidRiskModel(null)).toBe(false)
    expect(isValidRiskModel({ ...riskModel, lossRateByWarningLevel: [] })).toBe(false)
  })
  it('DISASTER_DATA_DIR 指向静态产物目录', () => {
    expect(DISASTER_DATA_DIR).toBe('/data/disaster')
  })
})
