// 受灾预警静态数据契约类型（docs/plans/受灾预警-V1-实施.md §6）
// 产物目录 web/public/data/disaster/，由 scripts 离线预生成，运行期零网络依赖（ADR-0009）。

/** 受灾预警面板 tab：灾损预估 / 预警监测 / 任务列表（R1-5）。 */
export type DisasterWarningTab = 'loss' | 'warning' | 'tasks'

export const DISASTER_WARNING_TABS: Array<{ key: DisasterWarningTab; label: string }> = [
  { key: 'loss', label: '灾损预估' },
  { key: 'warning', label: '预警监测' },
  { key: 'tasks', label: '任务列表' },
]

// ---- 6.1 track.json：巴威轨迹固化（保留上游 APIHz 原始字段名，typhoonAdapter 零改动消费） ----

export interface DisasterTrackWindRadius {
  grade?: number | string
  grade_text?: string
  grade_desc?: string
  ne_radius_km?: number
  se_radius_km?: number
  sw_radius_km?: number
  nw_radius_km?: number
  avg_radius_km?: number
}

export interface DisasterTrackNode {
  time_ymdh: string
  lat: number
  lon: number
  position_text?: string
  intensity_code?: string
  intensity_text?: string
  pressure_hpa?: number
  wind_speed_ms?: number
  intensity_desc?: string
  move_dir_code?: string
  move_dir_text?: string
  move_speed_kmh?: number
  move_desc?: string
  wind_radius?: DisasterTrackWindRadius[]
}

export interface DisasterTrack {
  code?: number
  no1: string
  no2?: string
  no3?: string
  no4?: string
  namecn: string
  nameen?: string
  explanation?: string
  type?: string
  /** 影响窗口内 71 个节点，按时间升序；数组下标 i 即播放帧号。 */
  datas: DisasterTrackNode[]
}

// ---- 6.2 precip.json：每节点过程累计雨量网格 ----

export interface DisasterPrecipGridPoint {
  /** 接口返回的真实 ERA5 吸附格点（非 0.25 整数倍） */
  lat: number
  lon: number
  /** cum[i] = 自 aggregateFrom 累计至 nodeTimes[i]，单位 mm，单调不减 */
  cum: number[]
}

export interface DisasterPrecip {
  schemaVersion: number
  model: string
  aggregateFrom: string
  nodeTimes: string[]
  grid: DisasterPrecipGridPoint[]
}

// ---- 6.3 warnings.json：每节点村级预警清单 ----

export type DisasterSeatSource = 'seat' | 'name' | 'nearest' | 'centroid'

export interface DisasterWarningVillage {
  code: string
  name: string
  cityCode: string
  countyCode: string
  townshipCode: string
  lon: number
  lat: number
  seatSource: DisasterSeatSource
}

export type DisasterWarningLevel = 1 | 2 | 3

export interface DisasterWarningNode {
  /** 播放帧号（对应 track.datas / precip.nodeTimes 下标） */
  i: number
  /** [村索引, 等级]；1=低 2=中 3=高；无风险村不入表 */
  w: Array<[number, DisasterWarningLevel]>
}

export interface DisasterWarnings {
  schemaVersion: number
  thresholds: { low: number; mid: number; high: number }
  hysteresisNodes: number
  nodeTimes: string[]
  /** 只含全窗口曾经触发预警的村 */
  villages: DisasterWarningVillage[]
  nodes: DisasterWarningNode[]
}

// ---- 6.5 underwriting.json：村级承保口径（R4-4/R4-8） ----

export interface DisasterUnderwritingVillage {
  code: string
  name: string
  insuredAreaMu: number
  householdCount: number
  sumInsuredYuan: number
  source: 'mock' | 'real'
}

export interface DisasterUnderwriting {
  schemaVersion: number
  seed: string
  sumInsuredPerMu: number
  targetTotalMu: number
  villages: DisasterUnderwritingVillage[]
}

// ---- 6.6 risk-model.json：灾损预估口径（R4-4/R4-5） ----

export interface DisasterRiskBand {
  max?: number
  min?: number
  level: 0 | 1 | 2 | 3
  name: string
  coefficient: number
}

export interface DisasterRiskModel {
  schemaVersion: number
  riskLevelFromCumRainMm: DisasterRiskBand[]
  lossRateByWarningLevel: Array<{ level: 1 | 2 | 3; name: string; lossRate: number }>
  formula: string
}

export interface DisasterWarningData {
  track: DisasterTrack
  precip: DisasterPrecip
  warnings: DisasterWarnings
  underwriting: DisasterUnderwriting
  riskModel: DisasterRiskModel
}

// ---- 灾损预估（R4） ----

export interface DisasterLossSummary {
  /** 预估受灾面积（万亩） */
  areaMuWan: number
  /** 预估涉及户数 */
  households: number
  /** 预估赔偿金额（万元） */
  amountWan: number
}

// ---- 防灾减损任务（R5/R6） ----

export type DisasterTaskType = 'prevent' | 'inspect'
export type DisasterTaskStatus = '待领取' | '进行中' | '已完成'

export interface DisasterTaskHistoryEntry {
  time: string
  text: string
}

export interface DisasterTaskEvidence {
  url: string
  time: string
}

export interface DisasterTask {
  id: string
  /** YJ- 前缀任务编号（R5-12） */
  taskNo: string
  name: string
  type: DisasterTaskType
  typeName: string
  villageCode: string
  villageName: string
  status: DisasterTaskStatus
  /** 创建时的节点下标（状态三段流转用） */
  createdAtNode: number
  /** 创建时间文案（节点时间） */
  createdAt: string
  /** 当前预警等级（随升级刷新，R5-3/R5-5） */
  warningLevel: DisasterWarningLevel | null
  /** 关联预警已解除（R5-2） */
  released: boolean
  /** 变化记录（生成/升级/解除按时间追加，R5-5） */
  history: DisasterTaskHistoryEntry[]
  location: { name: string; lon: number; lat: number }
  evidence: DisasterTaskEvidence[]
  sopAction: string
  requirement: string
  remark: string
}

export interface DisasterWarningSnapshot {
  track: DisasterTrack
  precip: DisasterPrecip
  warnings: DisasterWarnings
  underwriting: DisasterUnderwriting
  riskModel: DisasterRiskModel
}
