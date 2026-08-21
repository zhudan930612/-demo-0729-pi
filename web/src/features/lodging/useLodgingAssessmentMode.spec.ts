import { describe, expect, it } from 'vitest'
import {
  signalsForDamageRate,
  getDemoDamageForParcel,
} from './lodgingDemoData'
import { computeDamageRate, type DamageRate } from './lodgingCalc'

// ========== signalsForDamageRate ==========

describe('signalsForDamageRate', () => {
  it('returns signals that produce 0% damage rate', () => {
    const signals = signalsForDamageRate(0)
    expect(computeDamageRate(signals)).toBe(0)
  })

  it('returns signals that produce 30% damage rate', () => {
    const signals = signalsForDamageRate(30)
    expect(computeDamageRate(signals)).toBe(30)
  })

  it('returns signals that produce 60% damage rate', () => {
    const signals = signalsForDamageRate(60)
    expect(computeDamageRate(signals)).toBe(60)
  })

  it('returns signals that produce 100% damage rate', () => {
    const signals = signalsForDamageRate(100)
    expect(computeDamageRate(signals)).toBe(100)
  })

  it('always returns null typhoon (no typhoon signal)', () => {
    for (const rate of [0, 30, 60, 100] as DamageRate[]) {
      expect(signalsForDamageRate(rate).typhoon).toBeNull()
    }
  })
})

// ========== getDemoDamageForParcel ==========
//
// 新设计：无论当前处于哪一层级，同一村庄始终返回相同受损率。
// 查找策略：村码精确匹配 → 乡镇基准值 → 0

describe('getDemoDamageForParcel', () => {
  describe('章镇镇各村（有村级差异化条目）', () => {
    it('龙江村 → 重度 100%', () => {
      expect(getDemoDamageForParcel('330604102014')).toBe(100)
    })

    it('新南村 → 重度 100%', () => {
      expect(getDemoDamageForParcel('330604102011')).toBe(100)
    })

    it('大钱村 → 中度 60%', () => {
      expect(getDemoDamageForParcel('330604102015')).toBe(60)
    })

    it('清潭村 → 中度 60%', () => {
      expect(getDemoDamageForParcel('330604102016')).toBe(60)
    })

    it('新魏家庄村 → 中度 60%', () => {
      expect(getDemoDamageForParcel('330604102017')).toBe(60)
    })

    it('新三联村 → 轻度 30%', () => {
      expect(getDemoDamageForParcel('330604102018')).toBe(30)
    })

    it('新魏村 → 轻度 30%', () => {
      expect(getDemoDamageForParcel('330604102020')).toBe(30)
    })

    it('湾头村 → 轻度 30%', () => {
      expect(getDemoDamageForParcel('330604102033')).toBe(30)
    })

    it('龙浦村 → 轻度 30%', () => {
      expect(getDemoDamageForParcel('330604102013')).toBe(30)
    })

    it('泰山村 → 轻度 30%', () => {
      expect(getDemoDamageForParcel('330604102012')).toBe(30)
    })
  })

  describe('三界镇各村（有村级差异化条目）', () => {
    it('临虞村 → 中度 60%', () => {
      expect(getDemoDamageForParcel('330683104307')).toBe(60)
    })

    it('北街村 → 中度 60%', () => {
      expect(getDemoDamageForParcel('330683104306')).toBe(60)
    })

    it('白沙村 → 轻度 30%', () => {
      expect(getDemoDamageForParcel('330683104224')).toBe(30)
    })

    it('车骑山村 → 中度 60%', () => {
      expect(getDemoDamageForParcel('330683104308')).toBe(60)
    })

    it('盛岙村 → 轻度 30%', () => {
      expect(getDemoDamageForParcel('330683104309')).toBe(30)
    })
  })

  describe('乡镇基准值回退', () => {
    it('章镇镇辖区内未单独列出的村 → 回退到乡镇基准 100%', () => {
      // 330604102001 是章镇镇辖区村码前缀，但不在村级条目中
      expect(getDemoDamageForParcel('330604102001')).toBe(100)
    })

    it('三界镇辖区内未单独列出的村 → 回退到乡镇基准 60%', () => {
      // 330683104001 是三界镇辖区村码前缀，但不在村级条目中
      expect(getDemoDamageForParcel('330683104001')).toBe(60)
    })
  })

  describe('无匹配区域 → 0', () => {
    it('不属于任何参保乡镇的村庄 → 0', () => {
      expect(getDemoDamageForParcel('330102100000')).toBe(0)
    })

    it('未知前缀 → 0', () => {
      expect(getDemoDamageForParcel('330700100000')).toBe(0)
    })
  })

  describe('层级无关性（核心一致性保证）', () => {
    it('同一村庄在不同层级参数下返回相同值', () => {
      const levels = ['province', 'city', 'county', 'township', 'village'] as const
      for (const level of levels) {
        expect(getDemoDamageForParcel('330604102014', level)).toBe(100)
        expect(getDemoDamageForParcel('330604102015', level)).toBe(60)
        expect(getDemoDamageForParcel('330604102018', level)).toBe(30)
        expect(getDemoDamageForParcel('330683104307', level)).toBe(60)
        expect(getDemoDamageForParcel('330683104224', level)).toBe(30)
      }
    })
  })
})

// ========== 13 个参保村覆盖完整性 ==========

describe('DEMO_DAMAGE_MAP coverage', () => {
  it('所有 13 个参保村都有非零受损率', () => {
    // 章镇镇 8 村
    const zhangzhen = [
      '330604102014', '330604102011', '330604102015', '330604102016',
      '330604102017', '330604102018', '330604102020', '330604102033',
    ]
    for (const code of zhangzhen) {
      expect(getDemoDamageForParcel(code), `章镇镇 ${code} 应有受损率`).toBeGreaterThan(0)
    }

    // 三界镇 5 村
    const sanjie = [
      '330683104307', '330683104306', '330683104224', '330683104308', '330683104309',
    ]
    for (const code of sanjie) {
      expect(getDemoDamageForParcel(code), `三界镇 ${code} 应有受损率`).toBeGreaterThan(0)
    }
  })

  it('章镇镇各村受损率分布：重度×2 + 中度×3 + 轻度×5（含乡镇基准回退村）', () => {
    // 显式列出的村
    expect(getDemoDamageForParcel('330604102014')).toBe(100) // 龙江村
    expect(getDemoDamageForParcel('330604102011')).toBe(100) // 新南村
    expect(getDemoDamageForParcel('330604102015')).toBe(60)  // 大钱村
    expect(getDemoDamageForParcel('330604102016')).toBe(60)  // 清潭村
    expect(getDemoDamageForParcel('330604102017')).toBe(60)  // 新魏家庄村
    expect(getDemoDamageForParcel('330604102018')).toBe(30)  // 新三联村
    expect(getDemoDamageForParcel('330604102020')).toBe(30)  // 新魏村
    expect(getDemoDamageForParcel('330604102033')).toBe(30)  // 湾头村
    expect(getDemoDamageForParcel('330604102013')).toBe(30)  // 龙浦村
    expect(getDemoDamageForParcel('330604102012')).toBe(30)  // 泰山村
  })

  it('三界镇各村受损率分布：中度×3 + 轻度×2', () => {
    expect(getDemoDamageForParcel('330683104307')).toBe(60)  // 临虞村
    expect(getDemoDamageForParcel('330683104306')).toBe(60)  // 北街村
    expect(getDemoDamageForParcel('330683104224')).toBe(30)  // 白沙村
    expect(getDemoDamageForParcel('330683104308')).toBe(60)  // 车骑山村
    expect(getDemoDamageForParcel('330683104309')).toBe(30)  // 盛岙村
  })
})
