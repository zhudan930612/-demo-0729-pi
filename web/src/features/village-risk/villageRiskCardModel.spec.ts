import { describe, expect, it } from 'vitest'
import type { PrecipitationSnapshot } from '../precipitation/precipitationTypes'
import type { VillageRiskResult } from './villageRiskData'
import { buildVillageRiskCardModel, consecutiveRainWindow, SEVERITY_TEXT } from './villageRiskCardModel'
import type { VillageDayStat } from './villageRisk'
import type { VillagePolicySummary } from './villagePolicySummary'

function result(overrides: Partial<VillageRiskResult> = {}): VillageRiskResult {
  return {
    level: 3, peak: { level: 3, mm: 112, dayIndex: 3 }, consecutive: false, precipSignal: 3,
    typhoonSignal: 0, typhoonPathDistanceKm: null, typhoonWindCovered: false, typhoonName: null, typhoonCoverageHours: null,
    alarmSignal: 0, matchedEvent: null, matchedSeverity: null,
    ...overrides,
  }
}

function snapshot(dayValues: Record<string, number>): PrecipitationSnapshot {
  return {
    grid: [{ lat: 29.75, lon: 120.85, values: { d1: dayValues.d1 ?? 0, d2: dayValues.d2 ?? 0, d3: dayValues.d3 ?? 0, d4: dayValues.d4 ?? 0, d5: dayValues.d5 ?? 0, d6: dayValues.d6 ?? 0, d7: dayValues.d7 ?? 0 } }],
    days: ['2026-08-10', '2026-08-11', '2026-08-12', '2026-08-13', '2026-08-14', '2026-08-15', '2026-08-16'],
    coveredDays: 7, model: 'x', updatedAt: '', aggregateFrom: '',
  }
}

const base = {
  villageName: '清潭村', month: 8, selectedDay: 0, stageNote: null, typhoonScenario: null as null,
  dataAvailable: { precip: true, typhoon: true, alarm: true },
  policy: null as VillagePolicySummary | null,
}

function summary(): VillagePolicySummary {
  return { code: '330604102016', insuredAreaMu: 580, sumInsuredYuan: 720_000, householdCount: 64, policyCount: 5, bigHolderPolicyCount: 4, rosterHouseholdCount: 60 }
}

describe('buildVillageRiskCardModel 卡片模型', () => {
  it('降水峰值信号行：峰值 mm + 日期 + 分级（等级徽标在头部，依据区不单列合并行）', () => {
    const model = buildVillageRiskCardModel({ ...base, snapshot: snapshot({ d3: 112 }), covered: snapshot({ d3: 112 }).grid, result: result() })
    expect(model.signalRows).toContain('降水 峰值 112mm（8/13 大暴雨）')
  })

  it('连阴雨行：连续 3 日累计窗口', () => {
    const snap = snapshot({ d1: 20, d2: 15, d3: 15 })
    const model = buildVillageRiskCardModel({
      ...base,
      snapshot: snap, covered: snap.grid,
      result: result({ level: 2, peak: { level: 1, mm: 20, dayIndex: 0 }, precipSignal: 2, consecutive: true }),
    })
    expect(model.signalRows).toContain('降水 连续 3 日累计 50mm（8/10~8/12）')
  })

  it('台风行：路径距村 + 预报覆盖时长', () => {
    const model = buildVillageRiskCardModel({
      ...base, snapshot: null, covered: [],
      result: result({ typhoonSignal: 2, typhoonPathDistanceKm: 40, typhoonName: '摩羯', typhoonCoverageHours: 72 }),
    })
    expect(model.signalRows).toContain("台风 '摩羯' 路径距村 40km，预报72h")
  })

  it('台风行：风圈覆盖', () => {
    const model = buildVillageRiskCardModel({
      ...base, snapshot: null, covered: [],
      result: result({ typhoonSignal: 2, typhoonPathDistanceKm: 80, typhoonWindCovered: true, typhoonName: '摩羯' }),
    })
    expect(model.signalRows).toContain("台风 '摩羯' 实时风圈覆盖（距中心 80km）")
  })

  it('台风行：强热带风暴级以上临近', () => {
    const model = buildVillageRiskCardModel({
      ...base, snapshot: null, covered: [],
      result: result({ typhoonSignal: 3, typhoonPathDistanceKm: 30, typhoonName: '摩羯' }),
    })
    expect(model.signalRows[0]).toContain('强热带风暴级以上临近')
  })

  it('预警行：橙色暴雨预警生效', () => {
    const model = buildVillageRiskCardModel({
      ...base, snapshot: null, covered: [],
      result: result({ alarmSignal: 1, matchedEvent: '暴雨', matchedSeverity: 'orange' }),
    })
    expect(model.signalRows).toContain('预警 橙色暴雨预警生效')
  })

  it('数据源不可用行：单源缺失标注，剩余源照常', () => {
    const model = buildVillageRiskCardModel({
      ...base, snapshot: null, covered: [],
      dataAvailable: { precip: false, typhoon: true, alarm: true },
      result: result({ alarmSignal: 1, matchedEvent: '暴雨', matchedSeverity: 'yellow' }),
    })
    expect(model.unavailableRows).toContain('降水预报数据暂不可用')
    expect(model.signalRows).toContain('预警 黄色暴雨预警生效')
    expect(model.degraded).toBe(false)
  })

  it('保单概况：保单数 / 大户保单 + 清单户', () => {
    const model = buildVillageRiskCardModel({ ...base, policy: summary(), snapshot: null, covered: [], result: result() })
    expect(model.policy).toEqual({ policyCount: 5, bigHolderPolicyCount: 4, rosterHouseholdCount: 60 })
  })

  it('保单数据不可用：policy 为 null（组件显示不可用）', () => {
    const model = buildVillageRiskCardModel({ ...base, policy: null, snapshot: null, covered: [], result: result() })
    expect(model.policy).toBeNull()
  })

  it('全源不可用 → degraded（风险暂不可评定，无依据首行）', () => {
    const model = buildVillageRiskCardModel({
      ...base, snapshot: null, covered: [],
      dataAvailable: { precip: false, typhoon: false, alarm: false },
      result: result(),
    })
    expect(model.degraded).toBe(true)
    expect(model.unavailableRows).toHaveLength(3)
  })

  it('措施：8 月晚稻分蘖取苗期/分蘖列；跨阶段标注透传', () => {
    const model = buildVillageRiskCardModel({
      ...base, snapshot: null, covered: [],
      result: result({ level: 2 }), stageNote: '跨晚稻苗期/分蘖期→晚稻孕穗/抽穗扬花期',
    })
    expect(model.stageLabel).toBe('晚稻苗期/分蘖期')
    expect(model.stageNote).toContain('跨')
    expect(model.measures).toContain('疏通沟渠、预排降低田间水位')
  })

  it('冬闲期：dormant 标记 + 非水稻生长期措施', () => {
    const model = buildVillageRiskCardModel({
      ...base, month: 1, snapshot: null, covered: [],
      result: result({ level: 2 }),
    })
    expect(model.dormant).toBe(true)
    expect(model.measures).toEqual(['非水稻生长期，无田间措施建议'])
  })

  it('趋势展开数据：7 天 dailyStats + 高亮该村峰值日（dayIndex=peak.dayIndex）', () => {
    const snap = snapshot({ d1: 10, d2: 60 })
    const model = buildVillageRiskCardModel({ ...base, selectedDay: 1, snapshot: snap, covered: snap.grid, result: result() })
    expect(model.trend?.days).toHaveLength(7)
    expect(model.trend?.stats[1]).toEqual({ min: 60, max: 60, mean: 60 })
    expect(model.trend?.dayIndex).toBe(3) // 峰值日（d4=112），与 selectedDay 无关
  })
})

describe('consecutiveRainWindow', () => {
  it('找到首个满足窗口', () => {
    const stats: VillageDayStat[] = [
      { min: 10, max: 10, mean: 10 },
      { min: 15, max: 15, mean: 15 },
      { min: 30, max: 30, mean: 30 },
      { min: 1, max: 1, mean: 1 },
    ]
    const days = ['2026-08-10', '2026-08-11', '2026-08-12', '2026-08-13']
    expect(consecutiveRainWindow(stats, days)).toEqual({ sum: 55, startLabel: '8/10', endLabel: '8/12' })
  })
  it('无窗口返回 null', () => {
    const stats: VillageDayStat[] = [
      { min: 10, max: 10, mean: 10 },
      { min: 15, max: 15, mean: 15 },
      { min: 0, max: 0, mean: 0 },
    ]
    expect(consecutiveRainWindow(stats, ['a', 'b', 'c'])).toBeNull()
  })
})

describe('SEVERITY_TEXT', () => {
  it('四色文案', () => {
    expect(SEVERITY_TEXT).toEqual({ red: '红色', orange: '橙色', yellow: '黄色', blue: '蓝色' })
  })
})
