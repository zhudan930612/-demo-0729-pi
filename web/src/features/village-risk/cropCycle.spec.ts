import { describe, expect, it } from 'vitest'
import {
  cropForMonth,
  measuresFor,
  stageForMonth,
  stageLabelWithCrop,
  STAGE_LABEL,
  windowStage,
  type StageKey,
} from './cropCycle'

describe('stageForMonth 月份→阶段映射（需求 §5.1 双季连作）', () => {
  it('早稻季（3~7 月）', () => {
    expect(stageForMonth(3)).toBe('seedling-tillering') // 早稻育秧播种
    expect(stageForMonth(4)).toBe('seedling-tillering') // 移栽返青
    expect(stageForMonth(5)).toBe('seedling-tillering') // 分蘖
    expect(stageForMonth(6)).toBe('booting-heading') // 拔节孕穗→抽穗
    expect(stageForMonth(7)).toBe('maturity-harvest') // 灌浆→收获（收获最敏感）
  })
  it('晚稻季（8~11 月）', () => {
    expect(stageForMonth(8)).toBe('seedling-tillering') // 晚稻分蘖主导
    expect(stageForMonth(9)).toBe('booting-heading') // 孕穗抽穗
    expect(stageForMonth(10)).toBe('filling') // 灌浆成熟
    expect(stageForMonth(11)).toBe('maturity-harvest') // 成熟收获
  })
  it('冬闲（12~2 月）', () => {
    expect(stageForMonth(12)).toBe('dormant')
    expect(stageForMonth(1)).toBe('dormant')
    expect(stageForMonth(2)).toBe('dormant')
  })
})

describe('cropForMonth 季别', () => {
  it('3~7 早稻、8~11 晚稻、其余无', () => {
    expect(cropForMonth(4)).toBe('早稻')
    expect(cropForMonth(8)).toBe('晚稻')
    expect(cropForMonth(12)).toBeNull()
    expect(cropForMonth(2)).toBeNull()
  })
})

describe('stageLabelWithCrop 带季别标签', () => {
  it('8 月 → 晚稻苗期/分蘖期（卡片"当前阶段"文案）', () => {
    expect(stageLabelWithCrop(8, 'seedling-tillering')).toBe('晚稻苗期/分蘖期')
    expect(stageLabelWithCrop(6, 'booting-heading')).toBe('早稻孕穗/抽穗扬花期')
    expect(stageLabelWithCrop(1, 'dormant')).toBe('非水稻生长期')
  })
})

describe('measuresFor 措施合成（需求 §5.2/5.3/4.3）', () => {
  it('冬闲期：风险等级仍显示，措施为"非水稻生长期"', () => {
    const result = measuresFor({ month: 1, riskLevel: 2, peakLevel: 2, consecutive: false, typhoonScenario: null, alarmLevel: 0 })
    expect(result.stage).toBe('dormant')
    expect(result.items).toEqual(['非水稻生长期，无田间措施建议'])
  })
  it('8 月晚稻分蘖：取苗期/分蘖列', () => {
    const result = measuresFor({ month: 8, riskLevel: 2, peakLevel: 2, consecutive: false, typhoonScenario: null, alarmLevel: 0 })
    expect(result.stage).toBe('seedling-tillering')
    expect(result.stageLabel).toBe('晚稻苗期/分蘖期')
    expect(result.items).toContain('提前疏通内外沟渠、预排降低田间水位，防止淹苗')
  })
  it('9 月晚稻孕穗抽穗：取孕穗列', () => {
    const result = measuresFor({ month: 9, riskLevel: 3, peakLevel: 3, consecutive: false, typhoonScenario: null, alarmLevel: 0 })
    expect(result.stage).toBe('booting-heading')
    expect(result.items.join(' ')).toContain('优先保穗：暴雨前排水防涝')
  })
  it('11 月晚稻成熟收获：取成熟收获列', () => {
    const result = measuresFor({ month: 11, riskLevel: 3, peakLevel: 3, consecutive: false, typhoonScenario: null, alarmLevel: 0 })
    expect(result.items.join(' ')).toContain('连夜抢收成熟稻谷')
  })
  it('条数上限：高/中 ≤3，低/无 1~2', () => {
    const highWithTyphoon = measuresFor({ month: 9, riskLevel: 3, peakLevel: 3, consecutive: false, typhoonScenario: 'storm', alarmLevel: 3 })
    expect(highWithTyphoon.items.length).toBeLessThanOrEqual(3)
    const midWithTyphoon = measuresFor({ month: 8, riskLevel: 2, peakLevel: 2, consecutive: false, typhoonScenario: 'path', alarmLevel: 0 })
    expect(midWithTyphoon.items.length).toBeLessThanOrEqual(3)
    const lowWithTyphoon = measuresFor({ month: 8, riskLevel: 1, peakLevel: 1, consecutive: false, typhoonScenario: 'path', alarmLevel: 0 })
    expect(lowWithTyphoon.items.length).toBeLessThanOrEqual(2)
    const none = measuresFor({ month: 8, riskLevel: 0, peakLevel: 0, consecutive: false, typhoonScenario: null, alarmLevel: 0 })
    expect(none.items.length).toBeLessThanOrEqual(2)
  })
  it('信号差异化：暴雨 vs 连阴雨 vs 台风 措施不同', () => {
    const peak = measuresFor({ month: 8, riskLevel: 2, peakLevel: 2, consecutive: false, typhoonScenario: null, alarmLevel: 0 })
    const wet = measuresFor({ month: 8, riskLevel: 2, peakLevel: 1, consecutive: true, typhoonScenario: null, alarmLevel: 0 })
    const ty = measuresFor({ month: 8, riskLevel: 2, peakLevel: 1, consecutive: false, typhoonScenario: 'path', alarmLevel: 0 })
    expect(peak.items.join(' ')).toContain('预排')
    expect(wet.items.join(' ')).toContain('连续阴雨')
    expect(ty.items.join(' ')).toContain('台风'.length > 0 ? '大棚' : '')
    // 三种信号组合互不相同（至少一条不同）
    expect(peak.items.join('|')).not.toBe(wet.items.join('|'))
    expect(peak.items.join('|')).not.toBe(ty.items.join('|'))
  })
  it('预警并入措施：红色预警含人员撤离', () => {
    const result = measuresFor({ month: 8, riskLevel: 3, peakLevel: 1, consecutive: false, typhoonScenario: null, alarmLevel: 3 })
    expect(result.items.join(' ')).toContain('撤离')
  })
  it('台风叠加措施并入', () => {
    const result = measuresFor({ month: 8, riskLevel: 2, peakLevel: 2, consecutive: false, typhoonScenario: 'path', alarmLevel: 0 })
    expect(result.items.join(' ')).toContain('加固大棚与设施')
  })
})

describe('windowStage 窗口跨阶段（需求 §5.5）', () => {
  it('同月不跨阶段', () => {
    const result = windowStage(8, 8)
    expect(result.crosses).toBe(false)
    expect(result.note).toBeNull()
  })
  it('跨月取最敏感阶段并标注（8 月底~9 月初：晚稻分蘖→孕穗抽穗）', () => {
    const result = windowStage(8, 9)
    expect(result.crosses).toBe(true)
    expect(result.stage).toBe('booting-heading') // 更敏感
    expect(result.note).toBe('跨晚稻苗期/分蘖期→晚稻孕穗/抽穗扬花期')
  })
  it('9 月底~10 月初：孕穗→灌浆，取孕穗', () => {
    const result = windowStage(9, 10)
    expect(result.crosses).toBe(true)
    expect(result.stage).toBe('booting-heading')
    expect(result.note).toBe('跨晚稻孕穗/抽穗扬花期→晚稻灌浆期')
  })
  it('10 月~11 月：灌浆→成熟收获，两档敏感并列取前', () => {
    const result = windowStage(10, 11)
    expect(result.stage).toBe('maturity-harvest')
  })
  it('12~1 月跨年冬闲：阶段不变不视为跨阶段', () => {
    const result = windowStage(12, 1)
    expect(result.crosses).toBe(false)
    expect(result.stage).toBe('dormant')
  })
  it('2~3 月冬闲→苗期跨阶段', () => {
    const result = windowStage(2, 3)
    expect(result.crosses).toBe(true)
    expect(result.stage).toBe('seedling-tillering')
    expect(result.note).toBe('跨非水稻生长期→早稻苗期/分蘖期')
  })
})

describe('STAGE_LABEL 完整覆盖', () => {
  it('五阶段都有中文标签', () => {
    const stages: StageKey[] = ['seedling-tillering', 'booting-heading', 'filling', 'maturity-harvest', 'dormant']
    for (const s of stages) expect(STAGE_LABEL[s]).toBeTruthy()
  })
})
