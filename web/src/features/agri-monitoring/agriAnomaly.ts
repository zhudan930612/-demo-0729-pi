import type { GrowthLevel, LevelAggregate } from './agriMonitoringTypes'

export const ANOMALY_THRESHOLD = 0.50 // 极差+较差占比 > 50% 为异常（B：暂用高阈值；后续用耕地掩膜只算农田区域）

export function anomalyRatioOf(levels: Record<GrowthLevel, number> | undefined): number {
  if (!levels) return 0
  return (levels.veryPoor ?? 0) + (levels.poor ?? 0)
}

/** 从当前期往前数连续异常期数（当前期异常才计；中间断档即停）。 */
export function consecutiveAnomalyPeriods(ratios: number[], currentDate: number): number {
  let count = 0
  for (let d = currentDate; d >= 0; d--) {
    if ((ratios[d] ?? 0) > ANOMALY_THRESHOLD) count++
    else break
  }
  return count
}

/** 每期异常占比（按 5级占比 the veryPoor+poor）。 */
export function anomalyRatiosPerDate(
  getLevels: (dateIndex: number) => Record<GrowthLevel, number> | undefined,
  dateCount: number,
): number[] {
  return Array.from({ length: dateCount }, (_, d) => anomalyRatioOf(getLevels(d)))
}

export interface TownshipAnomaly {
  code: string
  name: string
  cityCode: string
  cityName: string
  countyCode: string
  countyName: string
  anomalyRatio: number
  consecutivePeriods: number
  isAnomaly: boolean
}

/** 全省异常乡镇（按 极差+较差>30%），附 市/县 名称（分栏用）+ 连续异常期数。 */
export function buildTownshipAnomalies(
  levelsByDate: Array<Record<string, LevelAggregate>>,
  selectedDate: number,
): TownshipAnomaly[] {
  const current = levelsByDate[selectedDate] ?? {}
  const out: TownshipAnomaly[] = []
  for (const [code, agg] of Object.entries(current)) {
    if (code.length !== 12 || !agg || !agg.data) continue // 乡镇级(12位)
    const ratios = anomalyRatiosPerDate((d) => levelsByDate[d]?.[code]?.levels, levelsByDate.length)
    const curRatio = anomalyRatioOf(agg.levels)
    if (curRatio <= ANOMALY_THRESHOLD) continue
    const countyCode = code.slice(0, 6)
    const cityCode = code.slice(0, 4) + '00'
    // 县名缺失（已合并旧县如 330103/330104）回落为市名，避免显示编码
    const cityName = current[cityCode]?.name ?? cityCode
    out.push({
      code, name: agg.name,
      cityCode, cityName,
      countyCode, countyName: current[countyCode]?.name ?? cityName,
      anomalyRatio: curRatio,
      consecutivePeriods: consecutiveAnomalyPeriods(ratios, selectedDate),
      isAnomaly: true,
    })
  }
  return out.sort((a, b) => b.anomalyRatio - a.anomalyRatio)
}

export interface VillageAnomaly {
  code: string
  name: string
  levels: Record<GrowthLevel, number>
  anomalyRatio: number
  consecutivePeriods: number
  isAnomaly: boolean
  data: boolean
}

/** 依据村落 perDate levels 生成村级异常信息（isAnomaly/连续期数）。 */
const zeroLevels = (): Record<GrowthLevel, number> => ({ veryPoor: 0, poor: 0, normal: 0, good: 0, excellent: 0 })

export function villageAnomaly(
  code: string, name: string, levelsPerDate: Array<Record<GrowthLevel, number> | undefined>, selectedDate: number,
): VillageAnomaly {
  const cur = levelsPerDate[selectedDate] ?? zeroLevels()
  const ratios = levelsPerDate.map((lv) => anomalyRatioOf(lv))
  return {
    code, name, levels: cur,
    anomalyRatio: anomalyRatioOf(cur),
    consecutivePeriods: consecutiveAnomalyPeriods(ratios, selectedDate),
    isAnomaly: anomalyRatioOf(cur) > ANOMALY_THRESHOLD,
    data: true,
  }
}
