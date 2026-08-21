/**
 * 水稻倒伏评估 —— 演示模式数据与工具函数
 * 纯数据/函数，无浏览器依赖，可直接在 Node 环境中单测。
 *
 * ## 数据一致性设计
 *
 * DEMO_DAMAGE_MAP 只保留 **乡镇级** 和 **村级** 两个层次的条目：
 *   - 乡镇级：参保村所属乡镇的基准受损率（如 章镇镇=100，三界镇=60）
 *   - 村级：各村差异化受损率（覆盖乡镇基准值）
 *
 * 所有上层视图（省/市/县）的受损率均由实际参保地块数据 **向上聚合** 而来，
 * 不再独立赋值。这保证了无论当前处于哪一层级，同一村庄的受损率始终一致，
 * 上下级钻取时数据自然承接，不会出现「上虞区 100%，进去只有章镇镇有受损」的矛盾。
 */

import type { DamageRate, LodgingSignals } from './lodgingCalc'

/**
 * 演示模式受损率基准表。
 *
 * 只包含有实际参保村的区域：
 *   - 乡镇级（12位，后3位=000）：作为该乡镇参保村的默认受损率
 *   - 村级（12位完整村码）：覆盖乡镇基准，实现村间差异化
 *
 * 不在表中的区域（无参保村）返回 0，不会出现在地图上。
 */
export const DEMO_DAMAGE_MAP: Record<string, DamageRate> = {
  // ========== 乡镇级（参保村所属乡镇的基准受损率） ==========

  // 上虞区 · 章镇镇（8 个参保村，基准=重度）
  '330604104000': 100,

  // 嵊州市 · 三界镇（5 个参保村，基准=中度）
  '330683104000': 60,

  // ========== 村级（章镇镇各村差异化） ==========
  '330604102014': 100, // 龙江村 → 重度
  '330604102011': 100, // 新南村 → 重度
  '330604102015': 60,  // 大钱村 → 中度
  '330604102016': 60,  // 清潭村 → 中度
  '330604102017': 60,  // 新魏家庄村 → 中度
  '330604102018': 30,  // 新三联村 → 轻度
  '330604102020': 30,  // 新魏村 → 轻度
  '330604102033': 30,  // 湾头村 → 轻度
  '330604102013': 30,  // 龙浦村 → 轻度
  '330604102012': 30,  // 泰山村 → 轻度

  // ========== 村级（三界镇各村差异化） ==========
  '330683104307': 60,  // 临虞村 → 中度
  '330683104306': 60,  // 北街村 → 中度
  '330683104224': 30,  // 白沙村 → 轻度
  '330683104308': 60,  // 车骑山村 → 中度
  '330683104309': 30,  // 盛岙村 → 轻度
}

/**
 * 村码前缀 → 乡镇代码 映射。
 * 用于根据村码反查所属乡镇（村码前缀 ≠ 乡镇代码，见 villageRiskData.ts）。
 */
const VILLAGE_PREFIX_TO_TOWNSHIP: Record<string, string> = {
  '330604102': '330604104000', // 章镇镇辖区村 → 章镇镇 township code
  '330683104': '330683104000', // 三界镇辖区村 → 三界镇 township code
}

/** 根据村码反查乡镇代码，未匹配返回空字符串 */
function resolveTownshipCode(villageCode: string): string {
  for (const [prefix, townshipCode] of Object.entries(VILLAGE_PREFIX_TO_TOWNSHIP)) {
    if (villageCode.startsWith(prefix)) return townshipCode
  }
  return ''
}

/** 根据目标受损率反算信号组合（无台风，仅用降水+风力） */
export function signalsForDamageRate(rate: DamageRate): LodgingSignals {
  switch (rate) {
    case 0:   return { precip: 30,  wind: 5,  typhoon: null }
    case 30:  return { precip: 75,  wind: 7,  typhoon: null }
    case 60:  return { precip: 150, wind: 9,  typhoon: null }
    case 100: return { precip: 250, wind: 12, typhoon: null }
  }
}

/**
 * 获取某村庄的演示受损率。
 *
 * ## 一致性保证
 *
 * 无论当前 drilldown 处于哪一层级（province / city / county / township / village），
 * 同一村庄始终返回相同的受损率。查找策略：
 *
 *   1. 优先匹配完整村码（村级差异化条目）
 *   2. 未命中则反查乡镇代码，匹配乡镇基准值
 *   3. 仍未命中返回 0（无参保数据 / 不在演示范围内）
 *
 * `currentLevel` 参数保留仅为向后兼容，实际不参与查找逻辑。
 */
export function getDemoDamageForParcel(
  villageCode: string,
  _currentLevel?: string,
): DamageRate {
  // 1. 直接匹配村码（村级差异化）
  const directRate = DEMO_DAMAGE_MAP[villageCode]
  if (directRate !== undefined) return directRate

  // 2. 反查乡镇代码，匹配乡镇基准
  const townshipCode = resolveTownshipCode(villageCode)
  if (townshipCode) {
    const townshipRate = DEMO_DAMAGE_MAP[townshipCode]
    if (townshipRate !== undefined) return townshipRate
  }

  // 3. 无匹配 → 0
  return 0
}

/**
 * 村级视图：为单个地块生成差异化受损率。
 * 基于村整体受损率和 parcelId 种子，产生 0%/30%/60%/100% 的混合分布。
 */
export function getVillageParcelDamageRate(
  villageDamageRate: DamageRate,
  parcelId: string,
): DamageRate {
  if (villageDamageRate === 0) return 0

  const seed = parseInt(parcelId, 10) || 0
  const variant = seed % 10

  // 按村整体受损率决定分布比例
  // 重度村: 50% 重度, 20% 中度, 20% 轻度, 10% 无
  // 中度村: 20% 重度, 40% 中度, 30% 轻度, 10% 无
  // 轻度村: 10% 重度, 20% 中度, 40% 轻度, 30% 无
  const thresholds: Record<DamageRate, [number, number, number]> = {
    100: [5, 7, 9],   // 0-4:重度, 5-6:中度, 7-8:轻度, 9:无
    60:  [2, 6, 9],   // 0-1:重度, 2-5:中度, 6-8:轻度, 9:无
    30:  [1, 3, 7],   // 0:重度, 1-2:中度, 3-6:轻度, 7-9:无
    0:   [0, 0, 0],
  }

  const [heavy, medium, light] = thresholds[villageDamageRate]
  if (variant < heavy) return 100
  if (variant < medium) return 60
  if (variant < light) return 30
  return 0
}
