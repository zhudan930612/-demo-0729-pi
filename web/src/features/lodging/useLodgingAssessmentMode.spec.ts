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

describe('getDemoDamageForParcel', () => {
  describe('province level', () => {
    it('matches 绍兴市 code for 章镇镇 villages', () => {
      // 330604102014 → 前4位=3306 → +00 → 330600 (绍兴市) → 100
      expect(getDemoDamageForParcel('330604102014', 'province')).toBe(100)
    })

    it('matches 杭州市 code for 杭州区域 villages', () => {
      expect(getDemoDamageForParcel('330102100000', 'province')).toBe(30)
    })

    it('matches 温州市 code', () => {
      expect(getDemoDamageForParcel('330302100000', 'province')).toBe(60)
    })

    it('returns 0 for unmapped city', () => {
      expect(getDemoDamageForParcel('330700100000', 'province')).toBe(0)
    })
  })

  describe('city level', () => {
    it('matches 上虞区 code for 章镇镇 villages', () => {
      // 330604102014 → 前6位=330604 → 上虞区 → 100
      expect(getDemoDamageForParcel('330604102014', 'city')).toBe(100)
    })

    it('matches 嵊州市 code for 三界镇 villages', () => {
      // 330683104224 → 前6位=330683 → 嵊州市 → 60
      expect(getDemoDamageForParcel('330683104224', 'city')).toBe(60)
    })

    it('returns 0 for unmapped county', () => {
      // 330624 → 新昌县 (not in DEMO_DAMAGE_MAP)
      expect(getDemoDamageForParcel('330624100000', 'city')).toBe(0)
    })
  })

  describe('county level', () => {
    it('resolves 龙江村 to 章镇镇 via prefix mapping', () => {
      // 330604102014 → village prefix 330604102 → township code 330604104000 → 100
      expect(getDemoDamageForParcel('330604102014', 'county')).toBe(100)
    })

    it('resolves 新南村 to 章镇镇 via prefix mapping', () => {
      // 330604102011 → village prefix 330604102 → township code 330604104000 → 100
      expect(getDemoDamageForParcel('330604102011', 'county')).toBe(100)
    })

    it('resolves 三界镇 villages to 三界镇 township', () => {
      // 330683104224 → village prefix 330683104 → township code 330683104000
      // 330683104000 is NOT in DEMO_DAMAGE_MAP → 0
      expect(getDemoDamageForParcel('330683104224', 'county')).toBe(0)
    })

    it('returns 0 for villages with no township mapping', () => {
      // Unknown prefix → no mapping → 0
      expect(getDemoDamageForParcel('330102100000', 'county')).toBe(0)
    })
  })

  describe('township level', () => {
    it('matches 龙江村 directly by full village code', () => {
      expect(getDemoDamageForParcel('330604102014', 'township')).toBe(100)
    })

    it('matches 新南村 directly', () => {
      expect(getDemoDamageForParcel('330604102011', 'township')).toBe(100)
    })

    it('matches 大钱村 as 中度', () => {
      expect(getDemoDamageForParcel('330604102015', 'township')).toBe(60)
    })

    it('matches 新三联村 as 轻度', () => {
      expect(getDemoDamageForParcel('330604102018', 'township')).toBe(30)
    })

    it('returns 0 for unmapped village', () => {
      // 330604102001 is not in DEMO_DAMAGE_MAP
      expect(getDemoDamageForParcel('330604102001', 'township')).toBe(0)
    })
  })

  describe('village level', () => {
    it('uses full village code same as township level', () => {
      expect(getDemoDamageForParcel('330604102014', 'village')).toBe(100)
      expect(getDemoDamageForParcel('330604102018', 'village')).toBe(30)
    })
  })
})

// ========== DEMO_DAMAGE_MAP 覆盖完整性 ==========

describe('DEMO_DAMAGE_MAP coverage', () => {
  it('all 13 insured villages have a matching entry at township level', () => {
    // 章镇镇 8 村
    const zhangzhen = [
      '330604102014', '330604102011', '330604102015', '330604102016',
      '330604102017', '330604102018', '330604102020', '330604102033',
    ]
    for (const code of zhangzhen) {
      const rate = getDemoDamageForParcel(code, 'township')
      expect(rate, `village ${code} should have a damage rate`).toBeGreaterThan(0)
    }

    // 三界镇 5 村 — not in DEMO_DAMAGE_MAP at township level, but should match at city level
    const sanjie = [
      '330683104307', '330683104306', '330683104224', '330683104308', '330683104309',
    ]
    for (const code of sanjie) {
      const rate = getDemoDamageForParcel(code, 'city')
      expect(rate, `village ${code} should match 嵊州市 at city level`).toBe(60)
    }
  })
})
