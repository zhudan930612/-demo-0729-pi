/**
 * 参保村灾害风险联动 —— 双季连作周期与防灾措施映射（需求 §5）
 * 双季连作模型：早稻 3~7 月 → 连作晚稻 7 月底~11 月，同一块田两季接力、时间不交叉；不建模单季稻。
 * 当前日期月份 → 在田阶段 → 取对应措施列；12~2 月冬闲。
 */

import type { RiskLevel } from './villageRisk'

export type StageKey = 'seedling-tillering' | 'booting-heading' | 'filling' | 'maturity-harvest' | 'dormant'

export const STAGE_LABEL: Record<StageKey, string> = {
  'seedling-tillering': '苗期/分蘖期',
  'booting-heading': '孕穗/抽穗扬花期',
  filling: '灌浆期',
  'maturity-harvest': '成熟收获期',
  dormant: '非水稻生长期',
}

/** 灾害敏感排序（抽穗扬花 > 灌浆成熟 ≈ 成熟收获 > 分蘖 > 苗期；冬闲最低）。窗口跨阶段取最敏感。 */
export const STAGE_SENSITIVITY: Record<StageKey, number> = {
  'booting-heading': 5,
  filling: 4,
  'maturity-harvest': 4,
  'seedling-tillering': 3,
  dormant: 0,
}

export type CropKey = '早稻' | '晚稻' | null

/** 月份（1~12）→ 在田阶段（需求 §5.1 双季连作周期表） */
export function stageForMonth(month: number): StageKey {
  if (month === 12 || month <= 2) return 'dormant'
  if (month === 3 || month === 4 || month === 5) return 'seedling-tillering'
  if (month === 6) return 'booting-heading'
  if (month === 7) return 'maturity-harvest' // 早稻灌浆→收获，收获最敏感
  if (month === 8) return 'seedling-tillering' // 晚稻分蘖主导
  if (month === 9) return 'booting-heading'
  if (month === 10) return 'filling'
  return 'maturity-harvest' // 11 月
}

/** 月份 → 季别（卡片"当前阶段：晚稻孕穗抽穗"用） */
export function cropForMonth(month: number): CropKey {
  if (month >= 3 && month <= 7) return '早稻'
  if (month >= 8 && month <= 11) return '晚稻'
  return null
}

export function stageLabelWithCrop(month: number, stage: StageKey): string {
  if (stage === 'dormant') return STAGE_LABEL.dormant
  const crop = cropForMonth(month)
  return crop ? `${crop}${STAGE_LABEL[stage]}` : STAGE_LABEL[stage]
}

// ---------- 降水风险措施（需求 §5.2，按生育阶段取列） ----------
const PRECIP_MEASURES: Record<RiskLevel, Record<StageKey, string[]>> = {
  0: {
    'seedling-tillering': ['常规田间管理'],
    'booting-heading': ['保持正常水层'],
    filling: ['正常管理'],
    'maturity-harvest': ['按计划安排收获'],
    dormant: [],
  },
  1: {
    'seedling-tillering': ['巡查排水沟'],
    'booting-heading': ['关注预报、备排涝'],
    filling: ['防倒伏巡查'],
    'maturity-harvest': ['关注收获窗口'],
    dormant: [],
  },
  2: {
    'seedling-tillering': ['疏通沟渠、预排降低田间水位', '防淹苗巡查'],
    'booting-heading': ['深水护胎、强排水防倒', '备抢收预案'],
    filling: ['强排降低水位', '加固防倒伏'],
    'maturity-harvest': ['成熟地块提前抢收'],
    dormant: [],
  },
  3: {
    'seedling-tillering': ['提前排水防淹', '备好补苗'],
    'booting-heading': ['优先保穗：排水防涝', '大风后扶秧洗苗', '雨后防稻瘟/纹枯'],
    filling: ['防倒伏为主', '能收则抢收'],
    'maturity-harvest': ['连夜抢收', '防穗发芽霉变', '晒场/烘干安排'],
    dormant: [],
  },
}

// ---------- 台风叠加措施（需求 §5.3，按生育阶段取列） ----------
export type TyphoonScenario = 'path' | 'storm'

const TYPHOON_MEASURES: Record<TyphoonScenario, Record<StageKey, string[]>> = {
  path: {
    'seedling-tillering': ['加固大棚、转移棚内设备', '秧田覆膜防冲刷'],
    'booting-heading': ['提前深水护稻', '强台风前排水防倒'],
    filling: ['加固防倒伏', '抢排积水'],
    'maturity-harvest': ['抢收', '防穗发芽'],
    dormant: [],
  },
  storm: {
    'seedling-tillering': ['人员撤离低洼棚舍', '物资转移', '防海水倒灌（沿海村）'],
    'booting-heading': ['台风过后尽快扶秧洗苗', '补肥防病'],
    filling: ['倒伏稻尽早收割止损'],
    'maturity-harvest': ['收割机/烘干线调度预案'],
    dormant: [],
  },
}

export interface MeasuresInput {
  month: number
  riskLevel: RiskLevel
  typhoonScenario: TyphoonScenario | null
}

/** 措施合成：降水措施 + 台风叠加措施，按风险档条数上限截取（高/中≤3，低/无 1~2，需求 §4.3）。
 *  冬闲期返回"非水稻生长期，无田间措施建议"。 */
export function measuresFor({ month, riskLevel, typhoonScenario }: MeasuresInput): { items: string[]; stage: StageKey; stageLabel: string } {
  const stage = stageForMonth(month)
  const label = stageLabelWithCrop(month, stage)
  if (stage === 'dormant') {
    return { items: ['非水稻生长期，无田间措施建议'], stage, stageLabel: label }
  }
  const base = PRECIP_MEASURES[riskLevel][stage] ?? []
  const typhoon = typhoonScenario ? TYPHOON_MEASURES[typhoonScenario][stage] ?? [] : []
  const combined = [...base, ...typhoon]
  const cap = riskLevel >= 2 ? 3 : 2
  return { items: combined.slice(0, cap), stage, stageLabel: label }
}

// ---------- 窗口跨阶段（需求 §5.5） ----------
export interface WindowStageResult {
  stage: StageKey
  stageLabel: string
  crosses: boolean
  note: string | null
}

/** 窗口内更敏感阶段；敏感度并列时成熟收获优先于灌浆（收获措施更保守）。 */
function moreSensitive(a: StageKey, b: StageKey): StageKey {
  const sa = STAGE_SENSITIVITY[a]
  const sb = STAGE_SENSITIVITY[b]
  if (sa !== sb) return sa > sb ? a : b
  if (a === 'maturity-harvest' && b === 'filling') return a
  if (b === 'maturity-harvest' && a === 'filling') return b
  return a
}

/** 7 天窗口跨月时取最敏感阶段并生成标注（如"跨晚稻灌浆→收获"）。 */
export function windowStage(monthStart: number, monthEnd: number): WindowStageResult {
  const startStage = stageForMonth(monthStart)
  const endStage = stageForMonth(monthEnd)
  if (monthStart === monthEnd || startStage === endStage) {
    return { stage: startStage, stageLabel: stageLabelWithCrop(monthStart, startStage), crosses: false, note: null }
  }
  // 遍历窗口内月份取最敏感阶段
  let most = startStage
  for (let m = monthStart; m !== monthEnd; ) {
    m = m === 12 ? 1 : m + 1
    most = moreSensitive(most, stageForMonth(m))
  }
  most = moreSensitive(most, endStage)
  const labelOf = (stage: StageKey, month: number) => (stage === 'dormant' ? STAGE_LABEL.dormant : stageLabelWithCrop(month, stage))
  const note = `跨${labelOf(startStage, monthStart)}→${labelOf(endStage, monthEnd)}`
  return { stage: most, stageLabel: stageLabelWithCrop(monthEnd, most), crosses: true, note }
}
