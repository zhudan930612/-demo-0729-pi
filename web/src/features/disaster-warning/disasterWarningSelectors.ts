import type {
  DisasterWarningLevel, DisasterWarnings, DisasterWarningVillage,
  DisasterPrecip, DisasterUnderwriting, DisasterRiskModel, DisasterTask,
} from './types'

// ---------- 预警等级元信息（R3：低=绿/中=黄/高=红，复用 village-risk 配色） ----------

export const WARNING_LEVEL_TEXT: Record<DisasterWarningLevel, string> = { 1: '低', 2: '中', 3: '高' }
export const WARNING_LEVEL_NAME: Record<DisasterWarningLevel, string> = { 1: '低风险', 2: '中风险', 3: '高风险' }
/** 中/高 = 待处理；低 = 待观察（R3-13） */
export const WARNING_STATUS_LABEL: Record<DisasterWarningLevel, string> = { 1: '待观察', 2: '待处理', 3: '待处理' }
export const WARNING_LEVEL_COLOR: Record<DisasterWarningLevel, string> = {
  1: '#166534', // 低 = 绿（village-risk）
  2: '#ca8a04', // 中 = 黄
  3: '#b91c1c', // 高 = 红
}
/** 尺寸：高 = 基础 1.5×，中 = 基础（R3-6） */
export const WARNING_MARKER_RADIUS: Record<DisasterWarningLevel, number> = { 1: 4, 2: 5, 3: 7.5 }

/** AI 建议文案（R3-14）：按预警等级生成 */
export function aiAdviceForLevel(level: DisasterWarningLevel): string {
  if (level === 3) return '建议立即通知农户加固大棚、疏通沟渠并抢收已成熟作物，防范强降雨渍涝。'
  if (level === 2) return '建议通知农户加固大棚并排查排水设施，关注后续雨情升级。'
  return '建议持续关注降雨趋势，提前做好沟渠疏通与物资准备。'
}

// ---------- 预警村清单（R3） ----------

export interface WarnedVillageEntry {
  villageIndex: number
  village: DisasterWarningVillage
  level: DisasterWarningLevel
}

/** 当前节点预警村清单（R3-1~R3-3：等级变化不产生新条目，查表即得） */
export function warnedVillagesAtNode(warnings: DisasterWarnings, nodeIndex: number): WarnedVillageEntry[] {
  const entry = warnings.nodes.find((n) => n.i === nodeIndex)
  if (!entry) return []
  const out: WarnedVillageEntry[] = []
  for (const [villageIndex, level] of entry.w) {
    const village = warnings.villages[villageIndex]
    if (village && level >= 1 && level <= 3) out.push({ villageIndex, village, level })
  }
  return out
}

/** 全省预警村（当前节点），按等级（高→低）→ 预报雨量降序（R3-9） */
export function sortWarnedVillages(entries: WarnedVillageEntry[], future24ByIndex: (index: number) => number): WarnedVillageEntry[] {
  return [...entries].sort((a, b) => {
    if (a.level !== b.level) return b.level - a.level
    return future24ByIndex(b.villageIndex) - future24ByIndex(a.villageIndex)
  })
}

/** 预警村概览（R3-12）：{ total, high, mid, low } */
export function warningOverview(entries: WarnedVillageEntry[]): { total: number; high: number; mid: number; low: number } {
  const overview = { total: entries.length, high: 0, mid: 0, low: 0 }
  for (const entry of entries) {
    if (entry.level === 3) overview.high++
    else if (entry.level === 2) overview.mid++
    else overview.low++
  }
  return overview
}

/**
 * 地图预警层重绘签名：仅中/高风险上图，但等级也是视觉状态的一部分。
 * 相邻节点村集合不变而等级升降时，签名必须变化以触发徽标和村标记重绘。
 */
export function warningRenderSignature(entries: WarnedVillageEntry[]): string {
  return entries
    .filter((entry) => entry.level >= 2)
    .map((entry) => `${entry.village.code}:${entry.level}`)
    .sort()
    .join(',')
}

// ---------- 未来 24h 预报雨量（R3-9 列表显示；口径 cum[i+24]-cum[i]，见计划 §6.2） ----------

/** 村级未来 24h 预报雨量（mm）：村庄吸附到最近 ERA5 格点后查表。 */
export function future24RainByGrid(precip: DisasterPrecip, villageLon: number, villageLat: number, nodeIndex: number): number {
  let bestIndex = 0
  let bestDist = Infinity
  const grid = precip.grid
  for (let i = 0; i < grid.length; i++) {
    const dx = (grid[i]!.lon - villageLon) * 0.88
    const dy = grid[i]!.lat - villageLat
    const d = dx * dx + dy * dy
    if (d < bestDist) { bestDist = d; bestIndex = i }
  }
  const cum = grid[bestIndex]!.cum
  const end = Math.min(cum.length - 1, nodeIndex + 24)
  return Math.max(0, (cum[end] ?? 0) - (cum[nodeIndex] ?? 0))
}

// ---------- 区县聚合徽标（R3-19） ----------

export interface CountyBadge {
  countyCode: string
  countyName: string
  /** 该县中/高风险村数（低风险不计徽标） */
  count: number
  /** 该县最高等级（2=中 3=高） */
  maxLevel: 2 | 3
  /** 徽标落点 [lon, lat]（政府驻地/边界质心） */
  lon: number
  lat: number
}

/** 省/市级视角：按区县聚合中/高风险村（R3-19）。 */
export function buildCountyBadges(entries: WarnedVillageEntry[], countySeats: Map<string, [number, number]>): CountyBadge[] {
  const byCounty = new Map<string, { name: string; count: number; maxLevel: 2 | 3 }>()
  for (const entry of entries) {
    if (entry.level < 2) continue // 低风险不上图、也不进预警监测列表（R3-6 变更）
    const code = entry.village.countyCode
    const current = byCounty.get(code)
    if (current) {
      current.count++
      if (entry.level === 3) current.maxLevel = 3
    } else {
      byCounty.set(code, { name: entry.village.countyCode, count: 1, maxLevel: entry.level as 2 | 3 })
    }
  }
  const badges: CountyBadge[] = []
  for (const [code, agg] of byCounty) {
    const seat = countySeats.get(code)
    badges.push({
      countyCode: code,
      countyName: agg.name,
      count: agg.count,
      maxLevel: agg.maxLevel,
      lon: seat?.[0] ?? 0,
      lat: seat?.[1] ?? 0,
    })
  }
  return badges
}

// ---------- 灾损预估（R4-4：承保 × 村级风险系数 × 损失率） ----------

/** 村级风险等级 ← 该节点**过程累计雨量**分档（契约 §6.6）；与预警触发口径（未来 24h）是两个视角。 */
export function cumulativeRainByGrid(precip: DisasterPrecip, villageLon: number, villageLat: number, nodeIndex: number): number {
  let bestIndex = 0
  let bestDist = Infinity
  const grid = precip.grid
  for (let i = 0; i < grid.length; i++) {
    const dx = (grid[i]!.lon - villageLon) * 0.88
    const dy = grid[i]!.lat - villageLat
    const d = dx * dx + dy * dy
    if (d < bestDist) { bestDist = d; bestIndex = i }
  }
  return grid[bestIndex]!.cum[nodeIndex] ?? 0
}

export interface LossInput {
  entries: WarnedVillageEntry[]
  precip: DisasterPrecip
  underwriting: DisasterUnderwriting
  riskModel: DisasterRiskModel
  nodeIndex: number
}

export interface LossSummary {
  areaWanMu: number
  households: number
  amountWanYuan: number
}

export function riskCoefficient(riskModel: DisasterRiskModel, cumRainMm: number): number {
  const band = riskModel.riskLevelFromCumRainMm.find((b) => {
    const belowMax = b.max === undefined || cumRainMm < b.max
    const aboveMin = b.min === undefined || cumRainMm >= b.min
    return belowMax && aboveMin
  })
  return band?.coefficient ?? 0.2
}

export function lossRateForLevel(riskModel: DisasterRiskModel, level: DisasterWarningLevel): number {
  return riskModel.lossRateByWarningLevel.find((r) => r.level === level)?.lossRate ?? 0
}

/** 灾损预评估（R4-1/R4-4）：按当前层级预警村集合汇总。 */
export function computeLossSummary(input: LossInput): LossSummary {
  const { entries, precip, underwriting, riskModel, nodeIndex } = input
  const underwritingByCode = new Map(underwriting.villages.map((v) => [v.code, v]))
  let areaMu = 0
  let households = 0
  let amountYuan = 0
  for (const entry of entries) {
    const uw = underwritingByCode.get(entry.village.code)
    if (!uw) continue
    const cumRain = cumulativeRainByGrid(precip, entry.village.lon, entry.village.lat, nodeIndex) // 过程累计（风险系数口径）
    const coeff = riskCoefficient(riskModel, cumRain)
    const lossRate = lossRateForLevel(riskModel, entry.level)
    areaMu += uw.insuredAreaMu * coeff * lossRate
    households += uw.householdCount
    amountYuan += uw.sumInsuredYuan * coeff * lossRate
  }
  return {
    areaWanMu: areaMu / 10000,
    households,
    amountWanYuan: amountYuan / 10000,
  }
}

// ---------- 任务编号 / 类型（R5-8） ----------

export function taskTypeName(type: DisasterTask['type']): string {
  return type === 'prevent' ? '预防指令类' : '核查类'
}
