import { precipitationLevel } from '../precipitation/precipitationTypes'
import { shortDate } from './villageRiskCardModel'
import { RISK_LEVEL_TEXT, type RiskLevel } from './villageRisk'
import type { VillageRiskResult } from './villageRiskData'
import type { VillagePolicySummary } from './villagePolicySummary'

/**
 * 风险概览 tab view-model（需求 §4.3）——纯函数
 * - 统计：高/中风险村数、受影响参保面积/保额/户数（高+中口径，仅保障中保单覆盖）
 * - 受灾区域列表：仅高/中，等级降序 → 面积降序；村行 = 峰值（8/13 大暴雨 112mm）+ 面积 + 保额 + 户数
 */

export interface VillageRiskOverviewRow {
  code: string
  villageName: string
  level: RiskLevel
  levelText: string
  peakLabel: string
  peakDateLabel: string
  insuredAreaMu: number
  sumInsuredYuan: number
  householdCount: number
  policyAvailable: boolean
}

export interface VillageRiskOverviewModel {
  highCount: number
  midCount: number
  totalInsuredAreaMu: number
  totalSumInsuredYuan: number
  totalHouseholdCount: number
  rows: VillageRiskOverviewRow[]
  policyAllFailed: boolean
  updatedAt: string | null
}

export interface VillageRiskOverviewInput {
  villages: Array<{ code: string; name: string; result: VillageRiskResult }>
  policies: Map<string, VillagePolicySummary>
  days: readonly string[]
  updatedAt: string | null
}

/** 峰值展示文案：峰值日 + 降雨类型 + 雨量（如"8/13 大暴雨 112mm"；无日期时无前导空格）。 */
export function peakLabel(days: readonly string[], peak: VillageRiskResult['peak']): { label: string; dateLabel: string } {
  const dateLabel = days.length > 0 ? shortDate(days[peak.dayIndex] ?? '') : ''
  const type = precipitationLevel(peak.mm)
  return { label: `${dateLabel ? `${dateLabel} ` : ''}${type} ${peak.mm.toFixed(0)}mm`, dateLabel }
}

export function buildVillageRiskOverviewModel(input: VillageRiskOverviewInput): VillageRiskOverviewModel {
  const { villages, policies } = input
  const highCount = villages.filter((v) => v.result.level === 3).length
  const midCount = villages.filter((v) => v.result.level === 2).length

  const affected = villages.filter((v) => v.result.level >= 2)
  let totalInsuredAreaMu = 0
  let totalSumInsuredYuan = 0
  let totalHouseholdCount = 0
  let policyAllFailed = policies.size > 0
  for (const village of affected) {
    const summary = policies.get(village.code)
    totalInsuredAreaMu += summary?.insuredAreaMu ?? 0
    totalSumInsuredYuan += summary?.sumInsuredYuan ?? 0
    totalHouseholdCount += summary?.householdCount ?? 0
    if (summary && summary.insuredAreaMu > 0) policyAllFailed = false
  }
  if (policies.size === 0) policyAllFailed = true

  const rows: VillageRiskOverviewRow[] = affected
    .map((village) => {
      const summary = policies.get(village.code)
      const peak = peakLabel(input.days, village.result.peak)
      return {
        code: village.code,
        villageName: village.name,
        level: village.result.level,
        levelText: RISK_LEVEL_TEXT[village.result.level],
        peakLabel: peak.label,
        peakDateLabel: peak.dateLabel,
        insuredAreaMu: summary?.insuredAreaMu ?? 0,
        sumInsuredYuan: summary?.sumInsuredYuan ?? 0,
        householdCount: summary?.householdCount ?? 0,
        policyAvailable: Boolean(summary && summary.insuredAreaMu > 0),
      }
    })
    .sort((a, b) => b.level - a.level || b.insuredAreaMu - a.insuredAreaMu)

  return {
    highCount,
    midCount,
    totalInsuredAreaMu: Math.round(totalInsuredAreaMu),
    totalSumInsuredYuan: Math.round(totalSumInsuredYuan),
    totalHouseholdCount,
    rows,
    policyAllFailed,
    updatedAt: input.updatedAt,
  }
}
