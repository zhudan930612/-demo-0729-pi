/**
 * 水稻倒伏评估 —— 纯计算逻辑（需求 §3.4，v2.0）
 *
 * v2.0 变更（相对 v1.3）：
 * - 移除气象信号分档 + 木桶原理链路
 * - 受损率改为连续值（0~100%）= 受损面积 ÷ 承保面积
 * - 地块 damageRate 由连片生成器根据距离衰减赋值（非二进制）
 * - 区域受灾率 = Σ(damageAreaMu) ÷ Σ(areaMu)（面积加权平均）
 * - 新增区域受损程度独立分档（阈值可配置）
 * - 赔付公式沿用，但输入改为连续值
 *
 * 所有函数无副作用，输入输出确定，单测锁定。
 */

// ========== 可配置常量 ==========

/** 赔付比例分档阈值（地块受损率，左闭右开） */
export const COMPENSATION_THRESHOLDS = {
  /** (0%, 30%) → 50% */
  THRESHOLD_LIGHT: 30,
  /** [30%, 60%) → 80% */
  THRESHOLD_MEDIUM: 30,
  /** [60%, 100%] → 100% */
  THRESHOLD_HEAVY: 60,
} as const

/** 赔付比例（按档位） */
export const COMPENSATION_RATIOS = {
  LIGHT: 0.5,   // (0%, 30%)
  MEDIUM: 0.8,  // [30%, 60%)
  HEAVY: 1.0,   // [60%, 100%]
} as const

/** 区域受损程度分档阈值（区域受灾率）—— 与地块赔付分档阈值保持一致（30/60） */
export const REGION_SEVERITY_THRESHOLDS = {
  /** < 30% → 轻度 */
  LIGHT: 30,
  /** [30%, 60%) → 中度 */
  MEDIUM: 60,
  // ≥ 60% → 重度
} as const

/** 单位保额（分/亩），产品为"政策性水稻完全成本保险" */
export const UNIT_SUM_INSURED_CENTS_PER_MU = 125000

/** 单位保额（元/亩） */
export const UNIT_SUM_INSURED_YUAN_PER_MU = UNIT_SUM_INSURED_CENTS_PER_MU / 100 // 1250

// ========== 类型 ==========

/** 区域受损程度（v2.0 新增，基于区域受灾率独立分档） */
export type RegionSeverity = 'heavy' | 'medium' | 'light' | 'none'

/** 地块受损数据（v2.0） */
export interface ParcelDamage {
  parcelId: string
  villageCode: string
  /** 承保面积（亩） */
  areaMu: number
  /** 单位保额（元/亩） */
  sumInsured: number
  /** 受损面积（亩）= areaMu × damageRate / 100 */
  damageAreaMu: number
  /** 受损率（连续值 0~100%），由连片生成器根据距离衰减赋值 */
  damageRate: number
  /** 被保险人 ID（用于户数去重） */
  insuredPartyId?: string
}

/** 地块受损结果（包含计算后的赔付） */
export interface ParcelDamageResult extends ParcelDamage {
  /** 地块赔付金额（元） */
  compensation: number
  /** 地块受损程度（用于展示，与赔付分档一致） */
  damageSeverity: RegionSeverity
}

/** 逐级汇总结果 */
export interface AggregatedResult {
  code: string
  /** 参保总面积（亩） */
  totalInsuredAreaMu: number
  /** 预估赔付总额（元） */
  totalCompensation: number
  /** 受损面积（亩）= Σ 各地块的 damageAreaMu */
  damagedAreaMu: number
  /** 受损户数（按投保人去重，只要 damageAreaMu > 0 算 1 户） */
  householdCount: number
  /** 区域受灾率 = damagedAreaMu / totalInsuredAreaMu（面积加权平均） */
  damageRate: number
  /** 区域受损程度 */
  severity: RegionSeverity
}

export type AggregateLevel = 'province' | 'city' | 'county' | 'township' | 'village'

// ========== 地块级计算 ==========

/** 根据地块受损率获取赔付比例（连续值分档） */
export function compensationRatio(damageRate: number): number {
  if (damageRate <= 0) return 0
  if (damageRate < COMPENSATION_THRESHOLDS.THRESHOLD_LIGHT) return COMPENSATION_RATIOS.LIGHT
  if (damageRate < COMPENSATION_THRESHOLDS.THRESHOLD_HEAVY) return COMPENSATION_RATIOS.MEDIUM
  return COMPENSATION_RATIOS.HEAVY
}

/** 计算地块赔付金额（元）
 *  赔付 = 受损面积(亩) × 单位保额(元/亩) × 赔付比例
 *  damageRate = 0 时赔付为 0 */
export function computeCompensation(damageAreaMu: number, sumInsuredPerMu: number, damageRate: number): number {
  if (damageRate <= 0 || damageAreaMu <= 0) return 0
  return Math.round(damageAreaMu * sumInsuredPerMu * compensationRatio(damageRate) * 100) / 100
}

/** 根据地块受损率获取地块受损程度（用于展示，与赔付分档一致） */
export function parcelDamageSeverity(damageRate: number): RegionSeverity {
  if (damageRate <= 0) return 'none'
  if (damageRate < COMPENSATION_THRESHOLDS.THRESHOLD_LIGHT) return 'light'
  if (damageRate < COMPENSATION_THRESHOLDS.THRESHOLD_HEAVY) return 'medium'
  return 'heavy'
}

/** 计算单个地块的完整结果 */
export function computeParcelResult(parcel: ParcelDamage): ParcelDamageResult {
  const compensation = computeCompensation(parcel.damageAreaMu, parcel.sumInsured, parcel.damageRate)
  const damageSeverity = parcelDamageSeverity(parcel.damageRate)
  return { ...parcel, compensation, damageSeverity }
}

// ========== 区域级计算 ==========

/** 根据区域受灾率获取区域受损程度（独立分档，与地块赔付分档解耦） */
export function computeRegionSeverity(regionDamageRate: number): RegionSeverity {
  if (regionDamageRate <= 0) return 'none'
  if (regionDamageRate < REGION_SEVERITY_THRESHOLDS.LIGHT) return 'light'
  if (regionDamageRate < REGION_SEVERITY_THRESHOLDS.MEDIUM) return 'medium'
  return 'heavy'
}

/** 区域受损程度排序权重（用于排序：重 > 中 > 轻 > 无） */
export function severitySortWeight(severity: RegionSeverity): number {
  switch (severity) {
    case 'heavy': return 0
    case 'medium': return 1
    case 'light': return 2
    case 'none': return 3
  }
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

/** 逐级汇总（需求 §3.4.3）：地块级结果按行政区划代码前缀聚合到村→镇→县→市→省
 *
 * 汇总指标：
 * - totalInsuredAreaMu：参保总面积（所有地块承保面积之和）
 * - damagedAreaMu：受损面积 = Σ 各地块 damageAreaMu
 * - householdCount：受损户数（按 insuredPartyId 去重，damageAreaMu > 0 算受灾）
 * - totalCompensation：预估赔付总额
 * - damageRate：区域受灾率 = damagedAreaMu / totalInsuredAreaMu（面积加权平均）
 * - severity：区域受损程度
 */
export function aggregateByLevel(parcels: ParcelDamage[], level: AggregateLevel): AggregatedResult[] {
  const prefixLen = codePrefixLength(level)

  interface GroupAccum {
    totalInsuredAreaMu: number
    totalCompensation: number
    damagedAreaMu: number
    householdIds: Set<string>
  }

  const groups = new Map<string, GroupAccum>()

  for (const parcel of parcels) {
    const code = prefixLen === null ? parcel.villageCode : parcel.villageCode.slice(0, prefixLen)
    const comp = computeCompensation(parcel.damageAreaMu, parcel.sumInsured, parcel.damageRate)

    let group = groups.get(code)
    if (!group) {
      group = { totalInsuredAreaMu: 0, totalCompensation: 0, damagedAreaMu: 0, householdIds: new Set() }
      groups.set(code, group)
    }
    group.totalInsuredAreaMu += parcel.areaMu
    group.totalCompensation += comp
    group.damagedAreaMu += parcel.damageAreaMu
    if (parcel.damageAreaMu > 0 && parcel.insuredPartyId) {
      group.householdIds.add(parcel.insuredPartyId)
    }
  }

  return Array.from(groups.entries()).map(([code, g]) => {
    const damageRate = g.totalInsuredAreaMu > 0
      ? Math.round((g.damagedAreaMu / g.totalInsuredAreaMu) * 10000) / 100
      : 0
    return {
      code,
      totalInsuredAreaMu: Math.round(g.totalInsuredAreaMu * 100) / 100,
      totalCompensation: Math.round(g.totalCompensation * 100) / 100,
      damagedAreaMu: Math.round(g.damagedAreaMu * 100) / 100,
      householdCount: g.householdIds.size,
      damageRate,
      severity: computeRegionSeverity(damageRate),
    }
  })
}

// ========== 排序 ==========

/** 区域统计排序（需求 §3.3）：
 *  1. 受损程度（重 > 中 > 轻 > 无）
 *  2. 受损率降序
 *  3. 区域名称字典序
 */
export function sortRegionResults(
  results: AggregatedResult[],
  nameMap: Map<string, string>,
): AggregatedResult[] {
  return [...results].sort((a, b) => {
    const sw = severitySortWeight(a.severity) - severitySortWeight(b.severity)
    if (sw !== 0) return sw
    if (a.damageRate !== b.damageRate) return b.damageRate - a.damageRate
    const nameA = nameMap.get(a.code) ?? a.code
    const nameB = nameMap.get(b.code) ?? b.code
    return nameA.localeCompare(nameB, 'zh-CN')
  })
}

// ========== 区划代码匹配工具 ==========

/**
 * 村码前缀 → 乡镇代码 映射。
 * 用于 county 级别匹配：村码前缀(330604102) ≠ 乡镇代码(330604104000)。
 */
export const VILLAGE_PREFIX_TO_TOWNSHIP: Record<string, string> = {
  '330604102': '330604104000',
  '330683104': '330683104000',
}

/** 根据村码反查乡镇代码 */
export function resolveTownshipCode(villageCode: string): string {
  for (const [prefix, townshipCode] of Object.entries(VILLAGE_PREFIX_TO_TOWNSHIP)) {
    if (villageCode.startsWith(prefix)) return townshipCode
  }
  return ''
}
