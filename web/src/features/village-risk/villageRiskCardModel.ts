import type { PrecipitationSnapshot, PrecipGridPoint } from '../precipitation/precipitationTypes'
import { PRECIP_DAY_KEYS, precipitationLevel } from '../precipitation/precipitationTypes'
import type { VillageDayStat } from './villageRisk'
import { RISK_LEVEL_TEXT } from './villageRisk'
import { coveredDayValues, villageDayStats } from './villageRisk'
import { measuresFor, type TyphoonScenario } from './cropCycle'
import type { VillageRiskResult } from './villageRiskData'
import type { PolicyGroupStat, VillagePolicySummary } from './villagePolicySummary'

/**
 * 参保村风险卡片 —— view-model 构建（需求 §4.5）
 * - 风险依据：信号行（降水峰值/连阴雨/台风/预警）；等级徽标在卡片头部展示
 * - 保单概况：仅保单结构（保单数 / 大户保单 + 清单户），承保概况不重复
 * - 7 天趋势高亮该村峰值日
 */

export interface VillageRiskCardModel {
  villageName: string
  level: number
  levelText: string
  signalRows: string[]
  unavailableRows: string[]
  policy: {
    policyCount: number
    bigHolderPolicyCount: number
    rosterHouseholdCount: number
    insuredAreaMu: number
    sumInsuredYuan: number
    householdCount: number
    bigHolderStat: PolicyGroupStat
    rosterStat: PolicyGroupStat
    periodStart: string | null
    periodEnd: string | null
    inForce: boolean
  } | null
  stageLabel: string
  stageNote: string | null
  measures: string[]
  dormant: boolean
  trend: { days: string[]; stats: VillageDayStat[]; dayIndex: number } | null
  degraded: boolean
}

export interface VillageRiskCardInput {
  villageName: string
  result: VillageRiskResult
  snapshot: PrecipitationSnapshot | null
  covered: PrecipGridPoint[]
  month: number
  selectedDay: number
  stageNote: string | null
  typhoonScenario: TyphoonScenario | null
  dataAvailable: { precip: boolean; typhoon: boolean; alarm: boolean }
  policy: VillagePolicySummary | null
}

export const SEVERITY_TEXT: Record<'red' | 'orange' | 'yellow' | 'blue', string> = {
  red: '红色',
  orange: '橙色',
  yellow: '黄色',
  blue: '蓝色',
}

/** yyyy-mm-dd → M/D（去前导零，如 2026-08-13 → 8/13） */
export function shortDate(ymd: string): string {
  const parts = ymd.split('-')
  const month = Number(parts[1])
  const day = Number(parts[2])
  return Number.isFinite(month) && Number.isFinite(day) ? `${month}/${day}` : ymd
}

/** 连阴雨触发窗口信息（首个满足的连续 3 日窗口：起止日 + 累计） */
export function consecutiveRainWindow(dailyStats: readonly VillageDayStat[], days: readonly string[]): { sum: number; startLabel: string; endLabel: string } | null {
  for (let i = 0; i + 3 <= dailyStats.length; i++) {
    const [a, b, c] = [dailyStats[i]!.mean, dailyStats[i + 1]!.mean, dailyStats[i + 2]!.mean]
    if (a >= 0.1 && b >= 0.1 && c >= 0.1 && a + b + c >= 50) {
      return { sum: Math.round((a + b + c) * 10) / 10, startLabel: shortDate(days[i] ?? ''), endLabel: shortDate(days[i + 2] ?? '') }
    }
  }
  return null
}

export function buildVillageRiskCardModel(input: VillageRiskCardInput): VillageRiskCardModel {
  const { result, snapshot } = input
  const days = snapshot?.days ?? []

  const signalRows: string[] = []
  const unavailableRows: string[] = []

  // 降水峰值行（依据信号之一；等级徽标在头部展示，不再单列合并行）
  if (input.dataAvailable.precip && snapshot) {
    if (result.peak.mm >= 0.1) signalRows.push(`降水 峰值 ${result.peak.mm.toFixed(0)}mm（${shortDate(days[result.peak.dayIndex] ?? '')} ${precipitationLevel(result.peak.mm)}）`)
    if (result.consecutive) {
      const dailyStats = PRECIP_DAY_KEYS.map((day) => villageDayStats(coveredDayValues(input.covered, day)))
      const window = consecutiveRainWindow(dailyStats, days)
      if (window) signalRows.push(`降水 连续 3 日累计 ${window.sum.toFixed(0)}mm（${window.startLabel}~${window.endLabel}）`)
    }
  } else if (!input.dataAvailable.precip) {
    unavailableRows.push('降水预报数据暂不可用')
  }

  // 台风行
  if (input.dataAvailable.typhoon) {
    if (result.typhoonSignal >= 1) {
      const name = result.typhoonName ? `'${result.typhoonName}'` : ''
      if (result.typhoonSignal >= 3) {
        signalRows.push(`台风 ${name} 强热带风暴级以上临近（距村 ${Math.round(result.typhoonPathDistanceKm ?? 0)}km）`)
      } else if (result.typhoonWindCovered) {
        signalRows.push(`台风 ${name} 实时风圈覆盖（距中心 ${Math.round(result.typhoonPathDistanceKm ?? 0)}km）`)
      } else {
        const coverage = result.typhoonCoverageHours ? `，预报${result.typhoonCoverageHours}h` : ''
        signalRows.push(`台风 ${name} 路径距村 ${Math.round(result.typhoonPathDistanceKm ?? 0)}km${coverage}`)
      }
    }
  } else {
    unavailableRows.push('台风数据暂不可用')
  }

  // 预警行
  if (input.dataAvailable.alarm) {
    if (result.alarmSignal >= 1 && result.matchedEvent) {
      const severity = result.matchedSeverity ? `${SEVERITY_TEXT[result.matchedSeverity]}${result.matchedEvent}预警生效` : `${result.matchedEvent}预警生效`
      signalRows.push(`预警 ${severity}`)
    }
  } else {
    unavailableRows.push('预警数据暂不可用')
  }

  // 全源不可用 → 风险暂不可评定
  const allUnavailable = !input.dataAvailable.precip && !input.dataAvailable.typhoon && !input.dataAvailable.alarm

  // 措施（当前生育期阶段；冬闲返回非水稻生长期）
  const measures = measuresFor({
    month: input.month,
    riskLevel: result.level,
    peakLevel: result.peak.level,
    consecutive: result.consecutive,
    typhoonScenario: input.typhoonScenario,
    alarmLevel: result.alarmSignal,
  })

  const trend = snapshot
    ? {
        days,
        stats: PRECIP_DAY_KEYS.map((day) => villageDayStats(coveredDayValues(input.covered, day))),
        // 高亮该村峰值日（v3.7 定稿，与色斑无联动）
        dayIndex: Math.max(0, Math.min(result.peak.dayIndex, PRECIP_DAY_KEYS.length - 1)),
      }
    : null

  return {
    villageName: input.villageName,
    level: result.level,
    levelText: RISK_LEVEL_TEXT[result.level],
    signalRows,
    unavailableRows,
    policy: input.policy
      ? {
          policyCount: input.policy.policyCount,
          bigHolderPolicyCount: input.policy.bigHolderPolicyCount,
          rosterHouseholdCount: input.policy.rosterHouseholdCount,
          insuredAreaMu: input.policy.insuredAreaMu,
          sumInsuredYuan: input.policy.sumInsuredYuan,
          householdCount: input.policy.householdCount,
          bigHolderStat: input.policy.bigHolderStat,
          rosterStat: input.policy.rosterStat,
          periodStart: input.policy.periodStart,
          periodEnd: input.policy.periodEnd,
          inForce: input.policy.inForce,
        }
      : null,
    stageLabel: measures.stageLabel,
    stageNote: input.stageNote,
    measures: measures.items,
    dormant: measures.stage === 'dormant',
    trend,
    degraded: allUnavailable,
  }
}
