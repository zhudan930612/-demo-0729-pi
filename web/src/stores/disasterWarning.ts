import { defineStore } from 'pinia'
import type {
  DisasterTrack, DisasterPrecip, DisasterWarnings, DisasterUnderwriting, DisasterRiskModel, DisasterPanel,
  DisasterWarningTab, DisasterTask, DisasterTaskStatus, DisasterTaskType,
} from '../features/disaster-warning/types'

export type DisasterWarningPhase = 'closed' | 'loading' | 'ready' | 'error'
export type DisasterDispatchMode = 'manual' | 'auto'

export interface DisasterWarningSnapshot {
  track: DisasterTrack
  precip: DisasterPrecip
  warnings: DisasterWarnings
  underwriting: DisasterUnderwriting
  riskModel: DisasterRiskModel
  panel?: DisasterPanel
}

export const DISASTER_TASK_TYPES: ReadonlyArray<{ key: DisasterTaskType; name: string }> = [
  { key: 'prevent', name: '预防指令类' },
  { key: 'inspect', name: '核查类' },
]
/** 任务类型按预警等级绑定（R5-8）：低/中 → 预防指令类；高 → 预防指令类 + 核查类 */
export const TASK_TYPES_BY_WARNING_LEVEL: Record<1 | 2 | 3, DisasterTaskType[]> = {
  1: ['prevent'],
  2: ['prevent'],
  3: ['prevent', 'inspect'],
}
/** 四态线性模型（R5-6）：本模式不出现「待下发」，生成即「待领取」 */
export const DISASTER_TASK_STATUSES: DisasterTaskStatus[] = ['待领取', '进行中', '已完成']
/** 自生成节点起至播放窗口结束均分三段：第一段末 → 进行中、第二段末 → 已完成 */
export const TASK_STATUS_SEGMENT_INDEX: Record<DisasterTaskStatus, number> = { '待领取': 0, '进行中': 1, '已完成': 2 }
/** 任务编号前缀 YJ-（R5-12，区分农情 RW-） */
export const DISASTER_TASK_NO_PREFIX = 'YJ-'

export interface DisasterLossSummary {
  /** 预估受灾面积（万亩） */
  areaWanMu: number
  /** 预估涉及户数 */
  households: number
  /** 预估赔偿金额（万元） */
  amountWanYuan: number
}

export interface DisasterTaskDedupKey {
  villageCode: string
  type: DisasterTaskType
}

/** 受灾预警模式状态（R1~R6 共享）。 */
export const useDisasterWarningStore = defineStore('disasterWarning', {
  state: () => ({
    phase: 'closed' as DisasterWarningPhase,
    isOpen: false,
    activeTab: 'loss' as DisasterWarningTab,
    errorMessage: '',
    generation: 0,
    track: null as DisasterTrack | null,
    precip: null as DisasterPrecip | null,
    warnings: null as DisasterWarnings | null,
    underwriting: null as DisasterUnderwriting | null,
    riskModel: null as DisasterRiskModel | null,
    panel: null as DisasterPanel | null,
    // ---- 播放（R2） ----
    nodeIndex: 0,
    playing: false,
    // ---- 派发（R5） ----
    dispatchMode: 'manual' as DisasterDispatchMode,
    // ---- 任务（R5/R6） ----
    tasks: [] as DisasterTask[],
    taskSeq: 0,
    // 去重：同一村 + 同一台风过程 + 同一任务类型只生成一次（R5-4）
    dispatchedKeys: [] as Array<{ villageCode: string; type: DisasterTaskType }>,
    taskDetailOpen: false,
    openTaskId: null as string | null,
    // 全部任务抽屉
    taskDrawerOpen: false,
    warningDrawerOpen: false,
  }),
  getters: {
    isReady: (s) => s.phase === 'ready',
    /** 当前播放帧号（R2 播放推进） */
    nodeCount: (s) => s.track?.datas.length ?? 0,
    currentNode: (s) => s.track?.datas[s.nodeIndex] ?? null,
    /** 当前节点时间文案（如「7/11 20时」） */
    nodeTimeLabel: (s) => {
      const time = s.track?.datas[s.nodeIndex]?.time_ymdh
      if (!time) return ''
      const m = time.match(/^(\d{4})-(\d{2})-(\d{2}) (\d{2}):/)
      if (!m) return time
      return `${Number(m[2])}月${Number(m[3])}日${m[4]}时`
    },
    /** 当前节点预警清单：[{ villageIdx, level }]，等级 1=低 2=中 3=高（无风险村不入表） */
    currentWarnings: (s) => {
      const nodes = s.warnings?.nodes
      const entry = nodes?.find((n) => n.i === s.nodeIndex)
      return entry?.w ?? []
    },
    /** 任务编号序号（YJ-2026-0001） */
    nextTaskNo: (s) => `${DISASTER_TASK_NO_PREFIX}2026-${String(s.taskSeq + 1).padStart(4, '0')}`,
    taskById: (s) => (id: string) => s.tasks.find((t) => t.id === id) ?? null,
    visibleTask: (s) => (s.openTaskId ? s.tasks.find((t) => t.id === s.openTaskId) ?? null : null),
  },
  actions: {
    open() {
      const next = this.generation + 1
      this.$reset()
      this.generation = next
      this.phase = 'loading'
      this.isOpen = true
      this.activeTab = 'loss' // 默认灾损预估（R1-5）
      this.nodeIndex = 0
      this.dispatchMode = 'manual' // 默认人工（R5-9）
    },
    receive(generation: number, snapshot: DisasterWarningSnapshot) {
      if (this.generation !== generation) return false
      this.track = snapshot.track
      this.precip = snapshot.precip
      this.warnings = snapshot.warnings
      this.underwriting = snapshot.underwriting
      this.riskModel = snapshot.riskModel
      this.panel = snapshot.panel ?? null
      this.nodeIndex = 0
      this.phase = 'ready'
      this.errorMessage = ''
      return true
    },
    fail(generation: number, message: string) {
      if (this.generation !== generation) return false
      this.phase = 'error'
      this.errorMessage = message
      return true
    },
    setTab(tab: DisasterWarningTab) { this.activeTab = tab },
    // ---- 播放（R2） ----
    setNode(index: number) {
      const count = this.nodeCount
      if (!Number.isFinite(index) || count <= 0) return
      this.nodeIndex = Math.max(0, Math.min(count - 1, Math.floor(index)))
    },
    setPlaying(playing: boolean) { this.playing = playing },
    // ---- 派发（R5-9~R5-11） ----
    setDispatchMode(mode: DisasterDispatchMode) { this.dispatchMode = mode },
    // ---- 任务（R5/R6） ----
    createTask(input: {
      villageCode: string
      villageName: string
      type: DisasterTaskType
      nodeIndex: number
      nodeTimeLabel: string
      warningLevel: 1 | 2 | 3 | null
      lon: number
      lat: number
    }): DisasterTask | null {
      // R5-4 去重：同一村 + 同一台风过程 + 同一任务类型只生成一次
      if (this.dispatchedKeys.some((k) => k.villageCode === input.villageCode && k.type === input.type)) return null
      const typeMeta = DISASTER_TASK_TYPES.find((t) => t.key === input.type)!
      const seq = this.taskSeq + 1
      this.taskSeq = seq
      const task: DisasterTask = {
        id: `dw-task-${input.villageCode}-${input.type}`,
        taskNo: `${DISASTER_TASK_NO_PREFIX}2026-${String(seq).padStart(4, '0')}`,
        name: `${input.villageName}${input.type === 'inspect' ? '抢收抢割核查' : '通知加固大棚'}`,
        type: input.type,
        typeName: typeMeta.name,
        villageCode: input.villageCode,
        villageName: input.villageName,
        status: '待领取', // R5-6 生成即待领取；待下发态本模式不出现
        createdAtNode: input.nodeIndex,
        createdAt: input.nodeTimeLabel,
        warningLevel: input.warningLevel,
        released: false,
        history: [{ time: input.nodeTimeLabel, text: `任务生成（${input.warningLevel === 3 ? '高风险' : input.warningLevel === 2 ? '中风险' : '低风险'}预警）` }],
        location: { name: input.villageName, lon: input.lon, lat: input.lat },
        evidence: [],
        sopAction: input.type === 'inspect'
          ? '1. 携带遥感图斑定位地块；\n2. 现场核对抢收进度与受灾程度；\n3. 拍照留痕（全景+近景）并记录坐标；\n4. 48 小时内反馈核查结论。'
          : '1. 电话/入户通知农户加固大棚、疏通沟渠；\n2. 提醒转移低洼地块资产；\n3. 记录通知时间与反馈。',
        requirement: input.type === 'inspect' ? '48 小时内到场核查并提交结论。' : '台风登陆前完成加固通知并留痕。',
        remark: '',
      }
      this.tasks.push(task)
      this.dispatchedKeys = [...this.dispatchedKeys, { villageCode: input.villageCode, type: input.type }]
      return task
    },
    /** 已派发判定（R3-15：派发后按钮变已派发禁用） */
    isDispatched(villageCode: string, type?: DisasterTaskType): boolean {
      if (type) return this.dispatchedKeys.some((k) => k.villageCode === villageCode && k.type === type)
      return this.dispatchedKeys.some((k) => k.villageCode === villageCode)
    },
    /** 循环回起点重置：任务/灾损/预警全部清零（R5-7） */
    resetRound() {
      this.tasks = []
      this.taskSeq = 0
      this.dispatchedKeys = []
      this.nodeIndex = 0
      this.taskDetailOpen = false
      this.openTaskId = null
      this.taskDrawerOpen = false
      this.warningDrawerOpen = false
    },
    // ---- 任务详情/抽屉（R5-12~R5-14） ----
    openTask(id: string) { this.openTaskId = id; this.taskDetailOpen = true },
    closeTask() { this.openTaskId = null; this.taskDetailOpen = false },
    openTaskDrawer() { this.taskDrawerOpen = true },
    closeTaskDrawer() { this.taskDrawerOpen = false },
    openWarningDrawer() { this.warningDrawerOpen = true },
    closeWarningDrawer() { this.warningDrawerOpen = false },
    /** 任务状态推进（R5-6）：自生成节点起至播放窗口结束均分三段，第一段末→进行中、第二段末→已完成 */
    advanceTaskStatuses(nodeIndex: number) {
      const windowEnd = this.nodeCount - 1
      for (const task of this.tasks) {
        if (task.status === '已完成') continue
        const span = Math.max(1, windowEnd - task.createdAtNode)
        const seg1 = task.createdAtNode + Math.floor(span / 3)
        const seg2 = task.createdAtNode + Math.floor((2 * span) / 3)
        if (nodeIndex >= seg2) {
          task.status = '已完成'
          task.history = [...task.history, { time: this.nodeTimeLabel, text: '任务完成（预生成证据挂载）' }]
          task.evidence = [
            { url: '/data/agri/evidence/img_001.jpg', time: `${this.nodeTimeLabel} 现场取证` },
            { url: '/data/agri/evidence/img_002.jpg', time: `${this.nodeTimeLabel} 现场取证` },
          ]
        } else if (nodeIndex >= seg1 && task.status === '待领取') {
          task.status = '进行中'
          task.history = [...task.history, { time: this.nodeTimeLabel, text: '任务进行中' }]
        }
      }
    },
    /** 预警升级联动（R5-3）：刷新任务预警等级标记并追加升级说明 */
    updateTaskWarningLevel(villageCode: string, level: 1 | 2 | 3, nodeTimeLabel: string) {
      for (const task of this.tasks) {
        if (task.villageCode !== villageCode || task.released) continue
        const previous = task.warningLevel
        if (previous !== null && previous < level) {
          task.warningLevel = level
          task.history = [...task.history, { time: nodeTimeLabel, text: `预警由${levelName(previous)}升级为${levelName(level)}` }]
        } else if (previous === null) {
          task.warningLevel = level
        }
      }
    },
    /** 预警解除联动（R5-2）：任务保留，标记已解除 */
    releaseTasksForVillage(villageCode: string, nodeTimeLabel: string) {
      for (const task of this.tasks) {
        if (task.villageCode !== villageCode || task.released) continue
        task.released = true
        task.history = [...task.history, { time: nodeTimeLabel, text: '关联预警已解除，任务保留' }]
      }
    },
    /** 预警再次触发（R5-4）：不重复生成，追加说明 */
    markWarningReTriggered(villageCode: string, nodeTimeLabel: string) {
      for (const task of this.tasks) {
        if (task.villageCode === villageCode && task.released) {
          task.released = false
          task.history = [...task.history, { time: nodeTimeLabel, text: '预警再次触发' }]
        }
      }
    },
    close() {
      const next = this.generation + 1
      this.$reset()
      this.generation = next
      this.isOpen = false
    },
  },
})

function levelName(level: 1 | 2 | 3): string {
  return level === 3 ? '高' : level === 2 ? '中' : '低'
}
