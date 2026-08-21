/**
 * 水稻倒伏评估 —— 纯计算逻辑（需求 §3.4）
 * 所有函数无副作用，输入输出确定，单测锁定。
 */

// ========== 类型 ==========

export type DamageRate = 0 | 30 | 60 | 100

export interface LodgingSignals {
  /** 24h 降水峰值（mm） */
  precip: number
  /** 风力等级 */
  wind: number
  /** 台风距离（km），无台风时为 null（跳过不参与计算） */
  typhoon: number | null
}

export interface ParcelDamage {
  parcelId: string
  villageCode: string
  areaMu: number
  sumInsured: number
  damageRate: DamageRate
}

export interface AggregatedResult {
  code: string
  totalAreaMu: number
  totalCompensation: number
  damagedAreaMu: number
  householdCount: number
  maxDamageRate: DamageRate
}

export type AggregateLevel = 'province' | 'city' | 'county' | 'township' | 'village'

// ========== 信号分档 ==========

/** 降水信号分档（需求 §3.4）：<50mm→0%；50-100mm→30%；100-200mm→60%；≥200mm→100% */
export function precipBracket(mm: number): DamageRate {
  if (mm < 50) return 0
  if (mm < 100) return 30
  if (mm < 200) return 60
  return 100
}

/** 风力信号分档（需求 §3.4）：<7级→0%；7-8级→30%；9-10级→60%；≥11级→100% */
export function windBracket(level: number): DamageRate {
  if (level < 7) return 0
  if (level <= 8) return 30
  if (level <= 10) return 60
  return 100
}

/** 台风距离信号分档（需求 §3.4）：无台风→null（跳过）；100-200km→30%；50-100km→60%；<50km→100%；≥200km→0% */
export function typhoonDistanceBracket(km: number | null): DamageRate | null {
  if (km === null) return null
  if (km >= 200) return 0
  if (km >= 100) return 30
  if (km >= 50) return 60
  return 100
}

// ========== 木桶原理 ==========

/** 地块受损率 = 三个信号分档结果的**最大值**（需求 §3.4 木桶原理）。无台风时跳过台风信号。 */
export function computeDamageRate(signals: LodgingSignals): DamageRate {
  const brackets: DamageRate[] = [
    precipBracket(signals.precip),
    windBracket(signals.wind),
  ]
  if (signals.typhoon !== null) {
    const tb = typhoonDistanceBracket(signals.typhoon)
    if (tb !== null) brackets.push(tb)
  }
  return Math.max(...brackets) as DamageRate
}

// ========== 赔付比例 ==========

/** 赔付比例（需求 §3.4，左闭右开）：[0%,30%)→50%；[30%,60%)→80%；[60%,100%]→100%。
 *  注意：damageRate=0 时赔付比例仍为 50%，但实际赔付金额为 0（见 computeCompensation）。 */
export function compensationRatio(damageRate: DamageRate): number {
  if (damageRate < 30) return 0.5
  if (damageRate < 60) return 0.8
  return 1
}

// ========== 赔付金额 ==========

/** 赔付 = 受损面积(亩) × 单位保额(元/亩) × 赔付比例。
 *  damageRate=0 时视为无受损，赔付金额为 0（即使赔付比例为 50%）。 */
export function computeCompensation(areaMu: number, sumInsuredPerMu: number, damageRate: DamageRate): number {
  if (damageRate === 0) return 0
  return areaMu * sumInsuredPerMu * compensationRatio(damageRate)
}

// ========== 逐级汇总 ==========

/** 区划代码截取前缀长度（按层级） */
function codePrefixLength(level: AggregateLevel): number | null {
  switch (level) {
    case 'province': return 2
    case 'city': return 4
    case 'county': return 6
    case 'township': return 9
    case 'village': return null // 使用完整村码
  }
}

/** 逐级汇总（需求 §3.4）：地块级结果按行政区划代码前缀聚合到村→镇→县→市→省 */
export function aggregateByLevel(parcels: ParcelDamage[], level: AggregateLevel): AggregatedResult[] {
  const prefixLen = codePrefixLength(level)
  const groups = new Map<string, {
    totalAreaMu: number
    totalCompensation: number
    damagedAreaMu: number
    householdCount: number
    maxDamageRate: DamageRate
  }>()

  for (const parcel of parcels) {
    const code = prefixLen === null ? parcel.villageCode : parcel.villageCode.slice(0, prefixLen)
    const comp = computeCompensation(parcel.areaMu, parcel.sumInsured, parcel.damageRate)

    let group = groups.get(code)
    if (!group) {
      group = { totalAreaMu: 0, totalCompensation: 0, damagedAreaMu: 0, householdCount: 0, maxDamageRate: 0 }
      groups.set(code, group)
    }
    group.totalAreaMu += parcel.areaMu
    group.totalCompensation += comp
    if (parcel.damageRate > 0) {
      group.damagedAreaMu += parcel.areaMu
      group.householdCount += 1
    }
    group.maxDamageRate = Math.max(group.maxDamageRate, parcel.damageRate) as DamageRate
  }

  return Array.from(groups.entries()).map(([code, g]) => ({
    code,
    totalAreaMu: Math.round(g.totalAreaMu * 100) / 100,
    totalCompensation: Math.round(g.totalCompensation * 100) / 100,
    damagedAreaMu: Math.round(g.damagedAreaMu * 100) / 100,
    householdCount: g.householdCount,
    maxDamageRate: g.maxDamageRate,
  }))
}
