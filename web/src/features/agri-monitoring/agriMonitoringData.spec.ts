import { describe, expect, it } from 'vitest'
import { tasksForRegion } from './agriMonitoringData'
import type { AgriTask, VillageGrowth } from './agriMonitoringTypes'

const villages: VillageGrowth[] = [
  { code: '330604102014', name: '龙江村', centroid: { lon: 120, lat: 30, name: '龙江村' }, insuredAreaMu: 100, householdCount: 10, policyCount: 1, levels: { veryPoor: 0, poor: 0, normal: 1, good: 0, excellent: 0 }, anomalyRatio: 0, isAnomaly: false, countyCode: '330604', cityCode: '330600', townshipCode: '330604104000', data: true },
  { code: '330604102011', name: '新南村', centroid: { lon: 120, lat: 30, name: '新南村' }, insuredAreaMu: 100, householdCount: 10, policyCount: 1, levels: { veryPoor: 0, poor: 0, normal: 1, good: 0, excellent: 0 }, anomalyRatio: 0, isAnomaly: false, countyCode: '330604', cityCode: '330600', townshipCode: '330604104000', data: true },
]
const tasks: AgriTask[] = [
  { id: 't1', name: '龙江村任务', type: 'poor_growth', typeName: '核查异常长势', villageCode: '330604102014', villageName: '龙江村', status: '待领取', createdAt: '2026-06-01', executor: null, remark: '', sopAction: '', requirement: '', location: { name: '龙江村', lon: 0, lat: 0 }, evidence: [] },
  { id: 't2', name: '新南村任务', type: 'poor_growth', typeName: '核查异常长势', villageCode: '330604102011', villageName: '新南村', status: '待领取', createdAt: '2026-06-01', executor: null, remark: '', sopAction: '', requirement: '', location: { name: '新南村', lon: 0, lat: 0 }, evidence: [] },
]

describe('tasksForRegion · 不同层级查看相应层级任务（R5-6）', () => {
  it('省级返回全部', () => {
    expect(tasksForRegion(tasks, villages, 'province', '330000')).toHaveLength(2)
  })
  it('市级/县级/镇级按归属过滤', () => {
    expect(tasksForRegion(tasks, villages, 'city', '330600')).toHaveLength(2)
    expect(tasksForRegion(tasks, villages, 'county', '330604')).toHaveLength(2)
    expect(tasksForRegion(tasks, villages, 'township', '330604104000')).toHaveLength(2)
  })
  it('村级仅该村任务', () => {
    const only = tasksForRegion(tasks, villages, 'village', '330604102014')
    expect(only).toHaveLength(1)
    expect(only[0].villageCode).toBe('330604102014')
  })
})
