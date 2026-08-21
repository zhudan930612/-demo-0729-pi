/**
 * 水稻倒伏评估 —— 演示模式数据与工具函数
 * 纯数据/函数，无浏览器依赖，可直接在 Node 环境中单测。
 */

import type { DamageRate, LodgingSignals } from './lodgingCalc'
import type { Level } from '../../stores/drilldown'

/** 演示模式下，按行政区级别标注受损等级 */
export const DEMO_DAMAGE_MAP: Record<string, DamageRate> = {
  // 省级视图（展示市级 choropleth）
  '330600': 100, // 绍兴市 → 重度
  '330100': 30,  // 杭州市 → 轻度
  '330200': 30,  // 宁波市 → 轻度
  '330300': 60,  // 温州市 → 中度

  // 市级视图（绍兴下辖，展示县级 choropleth）
  '330604': 100, // 上虞区 → 重度
  '330683': 60,  // 嵊州市 → 中度
  '330603': 60,  // 柯桥区 → 中度
  '330602': 30,  // 越城区 → 轻度
  '330681': 30,  // 诸暨市 → 轻度

  // 县级视图（上虞区下辖，展示乡镇级 choropleth）
  '330604104000': 100, // 章镇镇 → 重度
  '330604004000': 60,  // 道墟街道 → 中度
  '330604001000': 60,  // 百官街道 → 中度
  '330604101000': 30,  // 长塘镇 → 轻度
  '330604106000': 30,  // 丰惠镇 → 轻度

  // 乡镇级视图（章镇镇下辖，展示村级 choropleth）
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
}

/**
 * 村码前缀 → 乡镇代码 映射。
 * 用于 county 级别匹配：村码前缀(330604102) ≠ 乡镇代码(330604104000)。
 */
const VILLAGE_PREFIX_TO_TOWNSHIP: Record<string, string> = {
  '330604102': '330604104000', // 章镇镇辖区村 → 章镇镇 township code
  '330683104': '330683104000', // 三界镇辖区村 → 三界镇 township code
}

/** 根据村码反查乡镇代码 */
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
 * 根据当前 drilldown 层级，获取某村庄在 DEMO_DAMAGE_MAP 中的受损率。
 *
 * 匹配逻辑：
 * - province 视图 → 匹配前4位+'00'（市级代码，如 330600）
 * - city 视图 → 匹配前6位（县级代码，如 330604）
 * - county 视图 → 通过村码前缀反查乡镇代码（如 330604102xxx → 330604104000）
 * - township 视图 → 匹配完整12位村代码（如 330604102014）
 * - village 视图 → 匹配完整12位村代码
 */
export function getDemoDamageForParcel(
  villageCode: string,
  currentLevel: Level,
): DamageRate {
  let lookupCode: string
  switch (currentLevel) {
    case 'province':
      lookupCode = villageCode.slice(0, 4) + '00'
      break
    case 'city':
      lookupCode = villageCode.slice(0, 6)
      break
    case 'county':
      // 村码前缀(330604102) ≠ 乡镇代码(330604104000)，需要通过映射反查
      lookupCode = resolveTownshipCode(villageCode)
      break
    case 'township':
    case 'village':
      lookupCode = villageCode
      break
    default:
      return 0
  }

  return DEMO_DAMAGE_MAP[lookupCode] ?? 0
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
