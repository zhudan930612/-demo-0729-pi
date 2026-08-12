/**
 * 参保村灾害风险联动 —— 双季连作周期与防灾措施映射（需求 §5，v3.13 信号组合驱动）
 * 双季连作模型：早稻 3~7 月 → 连作晚稻 7 月底~11 月，同一块田两季接力、时间不交叉；不建模单季稻。
 * 措施按"该村风险信号构成"取对应措施组：降水峰值档 / 连阴雨渍涝 / 台风 / 预警，再结合当前生育阶段。
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

type StageTable = Record<StageKey, string[]>

// ---------- 降水峰值措施（需求 §5.2，按峰值档 × 生育阶段；内容含动作+细节） ----------
const PEAK_MEASURES: Record<RiskLevel, StageTable> = {
  0: {
    'seedling-tillering': ['保持正常田间管理，关注气象预报'],
    'booting-heading': ['保持正常水层管理，关注气象预报'],
    filling: ['正常田间管理，巡查防倒伏'],
    'maturity-harvest': ['按计划安排收获，关注天气窗口'],
    dormant: [],
  },
  1: {
    'seedling-tillering': ['巡查疏通田间排水沟，确保沟系畅通，预防局部积水'],
    'booting-heading': ['关注降雨预报，提前疏通排灌系统，备好排涝机具'],
    filling: ['低洼田块提前开沟排水，防倒伏巡查'],
    'maturity-harvest': ['天气转好优先安排成熟田块收割，防穗芽'],
    dormant: [],
  },
  2: {
    'seedling-tillering': ['提前疏通内外沟渠、预排降低田间水位，防止淹苗'],
    'booting-heading': ['深水护胎，强降雨前排水防倒，备好抢收预案'],
    filling: ['强排降低田间水位，加固防倒伏，雨后及时排水露田'],
    'maturity-harvest': ['成熟地块提前抢收，防倒伏与穗发芽霉变'],
    dormant: [],
  },
  3: {
    'seedling-tillering': ['提前抢排积水防淹苗，备好补苗秧源，雨后查苗补栽'],
    'booting-heading': ['优先保穗：暴雨前排水防涝，大风后扶秧洗苗，雨后防治稻瘟病/纹枯病'],
    filling: ['以防倒伏为主，能收则抢收，降低倒伏损失'],
    'maturity-harvest': ['连夜抢收成熟稻谷，防穗发芽霉变，提前落实晒场与烘干'],
    dormant: [],
  },
}

// ---------- 连阴雨/渍涝措施（v3.13 新增：连续 3 日有雨累计 ≥30mm 时并入） ----------
const CONSECUTIVE_MEASURES: StageTable = {
  'seedling-tillering': ['连续阴雨及时排水降渍，防止烂秧，天晴后晒田促根'],
  'booting-heading': ['持续阴雨及时清沟排水，降低田间湿度，重点防治稻瘟病'],
  filling: ['排渍降低田间湿度，防倒伏与穗腐，间歇晒田'],
  'maturity-harvest': ['连阴雨影响收获：抢晴抢收，及时晾晒防霉变，必要时烘干'],
  dormant: [],
}

// ---------- 台风叠加措施（需求 §5.3，v3.13 丰富化） ----------
export type TyphoonScenario = 'path' | 'storm'

const TYPHOON_MEASURES: Record<TyphoonScenario, StageTable> = {
  path: {
    'seedling-tillering': ['加固大棚与设施，转移棚内设备，秧田覆膜防雨水冲刷'],
    'booting-heading': ['提前深水护稻，强台风前排水防倒，固定秧苗'],
    filling: ['加固防倒伏，抢排积水，台风过后扶正稻株'],
    'maturity-harvest': ['抢收成熟稻谷，防穗发芽，加固晒场设施'],
    dormant: [],
  },
  storm: {
    'seedling-tillering': ['人员撤离低洼棚舍，转移重要物资，防海水倒灌（沿海村）'],
    'booting-heading': ['台风过后尽快扶秧洗苗，补肥防病，修复沟渠'],
    filling: ['倒伏稻尽早收割止损，防穗腐霉变'],
    'maturity-harvest': ['收割机/烘干线调度预案，抢收后及时烘干'],
    dormant: [],
  },
}

// ---------- 预警措施（v3.13 新增：区县预警提级时并入） ----------
const ALARM_MEASURES: Record<'plain' | 'red', StageTable> = {
  plain: {
    'seedling-tillering': ['关注预警升级，暂停露天农事作业，做好排水准备'],
    'booting-heading': ['预警期间减少田间作业，保护幼穗，备好排涝机具'],
    filling: ['暂停农事作业，低洼田块提前排水'],
    'maturity-harvest': ['预警期间暂停收割作业，设备断电避雷'],
    dormant: [],
  },
  red: {
    'seedling-tillering': ['红色预警：立即停止田间作业，人员撤离低洼区域，保护秧苗'],
    'booting-heading': ['红色预警：人员撤离田间，保护孕穗稻株，灾后第一时间查田扶秧'],
    filling: ['红色预警：人员撤离，能收地块抢收，防倒伏穗腐'],
    'maturity-harvest': ['红色预警：停止一切收割作业，人员设备转移至安全区'],
    dormant: [],
  },
}

export interface MeasuresInput {
  month: number
  /** 综合风险档（条数上限与冬闲判定用） */
  riskLevel: RiskLevel
  /** 降水峰值档（0-3） */
  peakLevel: RiskLevel
  /** 连阴雨/渍涝信号 */
  consecutive: boolean
  typhoonScenario: TyphoonScenario | null
  /** 预警信号（0 无 / 1 普通 / 3 红色） */
  alarmLevel: 0 | 1 | 3
}

/** 措施合成：按该村风险信号构成取对应措施组（峰值/连阴雨/台风/预警），去重后按综合档条数上限截取（高/中≤3，低/无 1~2）。
 *  冬闲期返回"非水稻生长期，无田间措施建议"。 */
export function measuresFor({ month, riskLevel, peakLevel, consecutive, typhoonScenario, alarmLevel }: MeasuresInput): { items: string[]; stage: StageKey; stageLabel: string } {
  const stage = stageForMonth(month)
  const label = stageLabelWithCrop(month, stage)
  if (stage === 'dormant') {
    return { items: ['非水稻生长期，无田间措施建议'], stage, stageLabel: label }
  }
  const groups: string[] = []
  const push = (rows: string[]) => { for (const row of rows) if (row && !groups.includes(row)) groups.push(row) }
  push(PEAK_MEASURES[peakLevel][stage] ?? [])
  if (consecutive) push(CONSECUTIVE_MEASURES[stage] ?? [])
  if (typhoonScenario) push(TYPHOON_MEASURES[typhoonScenario][stage] ?? [])
  if (alarmLevel >= 1) push(ALARM_MEASURES[alarmLevel === 3 ? 'red' : 'plain'][stage] ?? [])
  const cap = riskLevel >= 2 ? 3 : 2
  return { items: groups.slice(0, cap), stage, stageLabel: label }
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
