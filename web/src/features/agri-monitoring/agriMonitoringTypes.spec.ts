import { describe, expect, it } from 'vitest'
import { ndviColor, growthLevelOf, LEVEL_COLORS, GROWTH_LEVELS } from './agriMonitoringTypes'

describe('agriMonitoringTypes · 5 级分档', () => {
  it('划分 5 级：极差<0.4 / 较差0.4~<0.55 / 正常0.55~<0.7 / 较好0.7~<0.8 / 极好>=0.8', () => {
    expect(growthLevelOf(0.35)).toBe('veryPoor')
    expect(growthLevelOf(0.4)).toBe('poor')
    expect(growthLevelOf(0.54)).toBe('poor')
    expect(growthLevelOf(0.55)).toBe('normal')
    expect(growthLevelOf(0.69)).toBe('normal')
    expect(growthLevelOf(0.7)).toBe('good')
    expect(growthLevelOf(0.79)).toBe('good')
    expect(growthLevelOf(0.8)).toBe('excellent')
    expect(growthLevelOf(0.85)).toBe('excellent')
  })

  it('5 档各有颜色（R2-5 图例）', () => {
    expect(GROWTH_LEVELS).toEqual(['veryPoor', 'poor', 'normal', 'good', 'excellent'])
    for (const lv of GROWTH_LEVELS) {
      expect(LEVEL_COLORS[lv]).toHaveLength(3)
    }
  })

  it('ndviColor: NaN/alpha<=0 返回 null（透明），有效值返回 rgba', () => {
    expect(ndviColor(NaN, 1)).toBeNull()
    expect(ndviColor(0.6, 0)).toBeNull()
    expect(ndviColor(0.6, 1)).toMatch(/^rgba\(/)
  })
})
