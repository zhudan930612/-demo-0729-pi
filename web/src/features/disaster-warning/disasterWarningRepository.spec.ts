import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../../api/data', () => ({ fetchJSON: vi.fn() }))

import { fetchJSON } from '../../api/data'
import { loadDisasterWarningData, isValidTrack, isValidPrecip, isValidWarnings, DISASTER_DATA_DIR } from './disasterWarningRepository'
import type { DisasterTrack, DisasterPrecip, DisasterWarnings } from './types'

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
  schemaVersion: 1, thresholds: { low: 130, mid: 160, high: 185 }, hysteresisNodes: 2,
  nodeTimes: ['2026-07-09 00:00:00'], villages: [], nodes: [{ i: 0, w: [] }],
}

describe('loadDisasterWarningData · 三份静态产物（契约 §6）', () => {
  beforeEach(() => { vi.clearAllMocks() })

  it('三份产物齐全且结构合法 → 返回组合数据', async () => {
    mockFetch.mockImplementation(async (url: string) => {
      if (url.endsWith('/track.json')) return track
      if (url.endsWith('/precip.json')) return precip
      if (url.endsWith('/warnings.json')) return warnings
      throw new Error(`${url} -> 404`)
    })
    const data = await loadDisasterWarningData()
    expect(data.track.datas).toHaveLength(1)
    expect(data.precip.grid).toHaveLength(1)
    expect(data.warnings.nodes).toHaveLength(1)
  })

  it('R2-18 任一文件 404 → 整体失败（拒绝）', async () => {
    mockFetch.mockImplementation(async (url: string) => {
      if (url.endsWith('/track.json')) throw new Error('404')
      if (url.endsWith('/precip.json')) return precip
      if (url.endsWith('/warnings.json')) return warnings
      throw new Error(`${url} -> 404`)
    })
    await expect(loadDisasterWarningData()).rejects.toThrow()
  })

  it('R2-18 轨迹 datas 为空 → 结构校验失败', async () => {
    mockFetch.mockImplementation(async (url: string) => {
      if (url.endsWith('/track.json')) return { ...track, datas: [] }
      if (url.endsWith('/precip.json')) return precip
      if (url.endsWith('/warnings.json')) return warnings
      throw new Error(`${url} -> 404`)
    })
    await expect(loadDisasterWarningData()).rejects.toThrow('巴威轨迹数据缺失')
  })

  it('R2-18 降雨网格为空 → 结构校验失败', async () => {
    mockFetch.mockImplementation(async (url: string) => {
      if (url.endsWith('/track.json')) return track
      if (url.endsWith('/precip.json')) return { ...precip, grid: [] }
      if (url.endsWith('/warnings.json')) return warnings
      throw new Error(`${url} -> 404`)
    })
    await expect(loadDisasterWarningData()).rejects.toThrow('历史降雨网格数据缺失')
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
    expect(isValidWarnings({ ...warnings, thresholds: { low: 'a' as never, mid: 160, high: 185 } })).toBe(false)
  })
  it('DISASTER_DATA_DIR 指向静态产物目录', () => {
    expect(DISASTER_DATA_DIR).toBe('/data/disaster')
  })
})
