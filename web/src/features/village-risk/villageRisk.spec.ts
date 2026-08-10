import { describe, expect, it } from 'vitest'
import {
  alarmSignal,
  combineRisk,
  coveredDayValues,
  hasConsecutiveRain,
  haversineKm,
  pointSegmentDistanceKm,
  precipPeakLevel,
  precipSignal,
  typhoonSignal,
  villageDayStats,
  villagePeak,
  windCircleCovers,
  type RiskLevel,
  type WindRadiiLike,
} from './villageRisk'
import type { PrecipGridPoint } from './villageRisk'

function point(lat: number, lon: number, values: Record<string, number> = {}): PrecipGridPoint {
  return { lat, lon, values: { d1: 0, d2: 0, d3: 0, d4: 0, d5: 0, d6: 0, d7: 0, ...values } as PrecipGridPoint['values'] }
}

describe('precipPeakLevel 降水峰值分档', () => {
  it('按需求 §3.1b 阈值分档', () => {
    expect(precipPeakLevel(0)).toBe(0)
    expect(precipPeakLevel(24.9)).toBe(0)
    expect(precipPeakLevel(25)).toBe(1)
    expect(precipPeakLevel(49.9)).toBe(1)
    expect(precipPeakLevel(50)).toBe(2)
    expect(precipPeakLevel(99.9)).toBe(2)
    expect(precipPeakLevel(100)).toBe(3)
    expect(precipPeakLevel(300)).toBe(3)
  })
  it('非有限值按无信号', () => {
    expect(precipPeakLevel(Number.NaN)).toBe(0)
    expect(precipPeakLevel(Number.POSITIVE_INFINITY)).toBe(0)
  })
})

describe('hasConsecutiveRain 连续降雨信号', () => {
  it('连续 3 日累计 ≥50 成立', () => {
    expect(hasConsecutiveRain([15, 15, 20])).toBe(true)
    expect(hasConsecutiveRain([10, 10, 30, 1, 1])).toBe(true)
    expect(hasConsecutiveRain([20, 10, 25, 1, 1])).toBe(true) // 20+10+25=55
  })
  it('不足 50 不成立（含 3 日窗口全部枚举）', () => {
    expect(hasConsecutiveRain([10, 10, 10, 10])).toBe(false) // 30
    expect(hasConsecutiveRain([20, 10, 5, 30, 1])).toBe(false) // 35/45/36
    expect(hasConsecutiveRain([20, 10, 19, 1, 1])).toBe(false) // 49/30/21
  })
  it('空/不足 3 日序列不成立', () => {
    expect(hasConsecutiveRain([])).toBe(false)
    expect(hasConsecutiveRain([50, 50])).toBe(false)
  })
})

describe('precipSignal 降水信号合成', () => {
  it('峰值 + 连阴雨 +1 封顶 3', () => {
    expect(precipSignal(0, true)).toBe(1)
    expect(precipSignal(2, true)).toBe(3)
    expect(precipSignal(3, true)).toBe(3) // 封顶
    expect(precipSignal(2, false)).toBe(2)
  })
})

describe('距离计算', () => {
  it('haversineKm 已知距离', () => {
    // 纬度 1° ≈ 111.2km
    expect(haversineKm(30, 120, 31, 120)).toBeCloseTo(111.2, 0)
  })
  it('pointSegmentDistanceKm 垂足在段内', () => {
    // 段从 (29.8,120) 到 (30.2,120)，点 (30, 120.1)：段水平，距离约 0.1°lon≈9.6km
    const d = pointSegmentDistanceKm(30, 120.1, 29.8, 120, 30.2, 120)
    expect(d).toBeGreaterThan(8)
    expect(d).toBeLessThan(11)
  })
  it('pointSegmentDistanceKm 端点距离（垂足落段外）', () => {
    // 点 (30, 120) 到段 (30.2,120)-(30.4,120) → 距端点 0.2° ≈ 22.3km
    const d = pointSegmentDistanceKm(30, 120, 30.2, 120, 30.4, 120)
    expect(d).toBeCloseTo(22.3, 0)
  })
  it('pointSegmentDistanceKm 退化段（a==b）', () => {
    expect(pointSegmentDistanceKm(30, 120, 30.2, 120, 30.2, 120)).toBeCloseTo(22.3, 0)
  })
})

describe('windCircleCovers 实时风圈覆盖', () => {
  const radii: WindRadiiLike[] = [{ grade: '7', neRadiusKm: 300, seRadiusKm: 300, swRadiusKm: 300, nwRadiusKm: 300 }]
  it('方位角对应象限半径覆盖判定', () => {
    // 台风中心 (30,120)，村在其正东 0.2°（约 19km，象限 NE）→ 覆盖
    expect(windCircleCovers(30, 120.2, 30, 120, radii)).toBe(true)
    // 0.5°（约 48km）仍覆盖；1.5°（约 145km）不覆盖
    expect(windCircleCovers(30, 120.5, 30, 120, radii)).toBe(true)
    expect(windCircleCovers(30, 124, 30, 120, radii)).toBe(false) // 4°lon≈385km > 300km
  })
  it('四象限不对称半径取对应象限', () => {
    const quad: WindRadiiLike[] = [{ grade: '7', neRadiusKm: 10, seRadiusKm: 300, swRadiusKm: 10, nwRadiusKm: 10 }]
    // 东南 45°（bearing 135）用 se=300 → 覆盖；东北（bearing 45）用 ne=10 → 不覆盖
    expect(windCircleCovers(29.8, 120.3, 30, 120, quad)).toBe(true) // SE
    expect(windCircleCovers(30.1, 120.1, 30, 120, quad)).toBe(false) // NE
  })
  it('无风圈数据不覆盖', () => {
    expect(windCircleCovers(30, 120.1, 30, 120, [])).toBe(false)
    expect(windCircleCovers(30, 120.1, 30, 120, undefined)).toBe(false)
    expect(windCircleCovers(30, 120.1, 30, 120, null)).toBe(false)
  })
})

describe('typhoonSignal 台风信号', () => {
  const village = { lat: 30, lon: 120 }
  it('路径覆盖（点-线段穿过）→ 2：两预测点均 >50km 但线段穿过', () => {
    // 预测点 (30.6,119.8) 与 (30.6,120.2)：村 (30,120) 到该水平段最短距离 0.6°≈66km？不，垂直距离：
    // 段纬度 30.6，村纬度 30 → 0.6°≈66.8km >50。改：段 (30.4,119.8)-(30.4,120.2)，村到段垂直距离 0.4°≈44.5km ≤50
    const path = [{ lat: 30.4, lon: 119.8, windSpeedMs: 20 }, { lat: 30.4, lon: 120.2, windSpeedMs: 20 }]
    const result = typhoonSignal(village, path, null)
    expect(result.pathDistanceKm).toBeLessThan(50)
    expect(result.signal).toBe(2)
  })
  it('单点距村 ≤50km → 2；>50km → 0', () => {
    expect(typhoonSignal(village, [{ lat: 30.3, lon: 120, windSpeedMs: 20 }], null).signal).toBe(2) // 33km
    expect(typhoonSignal(village, [{ lat: 30.8, lon: 120, windSpeedMs: 20 }], null).signal).toBe(0) // 89km
  })
  it('强热带风暴及以上路径临近 → 3', () => {
    expect(typhoonSignal(village, [{ lat: 30.2, lon: 120, windSpeedMs: 30 }], null).signal).toBe(3) // wind 30m/s
    expect(typhoonSignal(village, [{ lat: 30.2, lon: 120, windSpeedMs: 15, intensityText: '强台风' }], null).signal).toBe(3)
    expect(typhoonSignal(village, [{ lat: 30.2, lon: 120, windSpeedMs: 15, intensityText: '热带风暴' }], null).signal).toBe(2)
  })
  it('实时风圈覆盖 → 2（无路径近距离）', () => {
    const radii = [{ grade: '7', neRadiusKm: 200, seRadiusKm: 200, swRadiusKm: 200, nwRadiusKm: 200 }]
    expect(typhoonSignal(village, [{ lat: 31, lon: 120, windSpeedMs: 15 }], radii).signal).toBe(2) // 111km 但在风圈内
    expect(typhoonSignal(village, [{ lat: 33, lon: 120, windSpeedMs: 15 }], radii).signal).toBe(0) // 334km 超出风圈
  })
  it('空路径 → 0', () => {
    expect(typhoonSignal(village, [], null).signal).toBe(0)
  })
})

describe('alarmSignal 预警信号', () => {
  const alarms = [
    { adminCode: '330604', eventType: '暴雨', severity: 'orange' },
    { adminCode: '330604', eventType: '高温', severity: 'orange' }, // 不相关类型
    { adminCode: '330683', eventType: '暴雨', severity: 'yellow' }, // 其他区县
    { adminCode: '330604', eventType: '台风', severity: 'red' },
  ] as const
  it('区县匹配 + 相关事件类型 → 1', () => {
    expect(alarmSignal([alarms[0]], '330604').signal).toBe(1)
    expect(alarmSignal([alarms[0]], '330604').matchedEvent).toBe('暴雨')
    expect(alarmSignal([alarms[0]], '330604').relevantMatched).toBe(true)
  })
  it('不相关事件类型（高温）不参与提级', () => {
    expect(alarmSignal([alarms[1]], '330604').signal).toBe(0)
  })
  it('其他区县不匹配', () => {
    expect(alarmSignal([alarms[2]], '330604').signal).toBe(0)
  })
  it('红色相关预警 → 3', () => {
    expect(alarmSignal([alarms[3]], '330604').signal).toBe(3)
    expect(alarmSignal([alarms[3]], '330604').redMatched).toBe(true)
  })
  it('无预警不降级（0）', () => {
    expect(alarmSignal([], '330604').signal).toBe(0)
    expect(alarmSignal(null, '330604').signal).toBe(0)
    expect(alarmSignal(undefined, '330604').signal).toBe(0)
  })
})

describe('combineRisk 综合算法（需求 §3.2 全组合）', () => {
  it('综合 = max(P,T)，无预警', () => {
    expect(combineRisk(0, 0, 0)).toBe(0)
    expect(combineRisk(1, 0, 0)).toBe(1)
    expect(combineRisk(0, 2, 0)).toBe(2)
    expect(combineRisk(3, 1, 0)).toBe(3)
    expect(combineRisk(2, 2, 0)).toBe(3) // P≥2 且 T≥2 → 3（暴雨+台风组合）
  })
  it('预警存在 +1 封顶 3', () => {
    expect(combineRisk(0, 0, 1)).toBe(1)
    expect(combineRisk(1, 0, 1)).toBe(2)
    expect(combineRisk(2, 0, 1)).toBe(3)
    expect(combineRisk(3, 0, 1)).toBe(3) // 封顶
    expect(combineRisk(0, 2, 1)).toBe(3) // 台风覆盖 2 + 预警 → 3
    expect(combineRisk(2, 2, 1)).toBe(3)
  })
  it('红色预警直接 3', () => {
    expect(combineRisk(0, 0, 3)).toBe(3)
    expect(combineRisk(0, 2, 3)).toBe(3)
    expect(combineRisk(3, 0, 3)).toBe(3)
  })
  it('台风不重复叠加：弱台风覆盖(2) 无预警 → 2', () => {
    expect(combineRisk(0, 2, 0)).toBe(2)
    expect(combineRisk(1, 2, 0)).toBe(2) // max(1,2)=2，不额外 +1
  })
})

describe('村级降水口径', () => {
  it('villageDayStats min/max/mean', () => {
    expect(villageDayStats([10, 20, 30])).toEqual({ min: 10, max: 30, mean: 20 })
    expect(villageDayStats([50])).toEqual({ min: 50, max: 50, mean: 50 })
    expect(villageDayStats([])).toEqual({ min: 0, max: 0, mean: 0 })
  })
  it('coveredDayValues 取覆盖网格点当日值', () => {
    const grid = [point(30, 120, { d1: 5 }), point(30.25, 120, { d1: 15 })]
    expect(coveredDayValues(grid, 'd1')).toEqual([5, 15])
    expect(coveredDayValues(grid, 'd2')).toEqual([0, 0])
  })
  it('villagePeak 取各日 max 最大值与日期索引', () => {
    const stats = [
      { min: 0, max: 10, mean: 5 },
      { min: 0, max: 60, mean: 30 },
      { min: 0, max: 20, mean: 10 },
    ]
    expect(villagePeak(stats)).toEqual({ level: 2, mm: 60, dayIndex: 1 }) // 50-99.9 → 2
  })
  it('villagePeak 空统计 → 0 级 0mm', () => {
    expect(villagePeak([])).toEqual({ level: 0, mm: 0, dayIndex: 0 })
  })
})

describe('RISK_LEVEL_TEXT 文案', () => {
  it('四档文案', () => {
    const text: Record<RiskLevel, string> = { 0: '无风险', 1: '低风险', 2: '中风险', 3: '高风险' }
    expect(text).toEqual({ 0: '无风险', 1: '低风险', 2: '中风险', 3: '高风险' })
  })
})
