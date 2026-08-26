import { defineStore } from 'pinia'
import type { AgriTask, AgriTab, NdviRaster, VillageGrowth, LevelAggregate, PolicyGrowthRow } from '../features/agri-monitoring/agriMonitoringTypes'

export type AgriPhase = 'closed' | 'loading' | 'ready' | 'error'
export const AGRI_PLAY_INTERVAL_MS = 1400
export const AGRI_DEFAULT_OPACITY = 1 // 可见度默认 100%（不透明）；用户可经可见度滑块调低露出底图

export interface AgriSnapshot {
  raster: NdviRaster | null
  villagesByDate: VillageGrowth[][] | null
  levelsByDate: Record<string, LevelAggregate>[] | null
  tasksByDate: AgriTask[][]
  policyByDate: Record<string, PolicyGrowthRow[]>[]
}

export const useAgriMonitoringStore = defineStore('agriMonitoring', {
  state: () => ({
    phase: 'closed' as AgriPhase,
    raster: null as NdviRaster | null,
    villagesByDate: null as VillageGrowth[][] | null,
    levelsByDate: null as Record<string, LevelAggregate>[] | null,
    // 非参保村 on-demand：loadChildren 进镇时按村几何聚合暂存（村概况/演示保单用），离开/重置清空
    onDemandVillages: null as Record<string, { code: string; levels: Record<string, number>; insuredAreaMu: number; householdCount: number }> | null,
    tasksByDate: [] as AgriTask[][],
    policyByDate: [] as Record<string, PolicyGrowthRow[]>[],
    generatedTasks: [] as AgriTask[],
    selectedDate: 0,
    playing: false,
    opacity: AGRI_DEFAULT_OPACITY,
    visible: true,
    activeTab: 'overview' as AgriTab,
    errorMessage: '',
    generation: 0,
    isOpen: false,
    // 异常详情（村级）打开村码
    villageDetailCode: null as string | null,
    // 任务详情打开的任务 id
    openTaskId: null as string | null,
    // 任务「定位到地图」图标
    taskLocation: null as { lon: number; lat: number; name: string } | null,
    // 已一键转任务的村码（去重）
    convertedVillageCodes: [] as string[],
    timer: null as ReturnType<typeof setInterval> | null,
    startDate: 0,
    dateCount: 0,
  }),
  getters: {
    dates: (s) => s.raster?.dates ?? [],
    currentDateLabel: (s) => s.raster?.dates[s.selectedDate] ?? '',
    isReady: (s) => s.phase === 'ready' && s.raster !== null,
    // 聚合跟随选中日期：村庄/层级/保单/任务按当前 heatmap 日期取用
    villages: (s) => s.villagesByDate?.[s.selectedDate] ?? null,
    levels: (s) => s.levelsByDate?.[s.selectedDate] ?? null,
    policyGrowth: (s) => s.policyByDate?.[s.selectedDate] ?? {},
    // 任务固定显示最近一期（与异常top一致，不随日期选择变化）
    tasks: (s) => s.tasksByDate?.[s.tasksByDate.length - 1] ?? [],
    allTasks: (s) => [...(s.tasksByDate?.[s.tasksByDate.length - 1] ?? []), ...s.generatedTasks],
    convertedSet: (s) => new Set(s.convertedVillageCodes),
  },
  actions: {
    open() {
      this.stopPlay()
      const next = this.generation + 1
      this.$reset()
      this.generation = next
      this.phase = 'loading'
      this.isOpen = true
      this.dateCount = this.raster?.dates.length ?? 0
    },
    receive(generation: number, snapshot: Partial<AgriSnapshot>) {
      if (this.generation !== generation) return false
      if (snapshot.raster) {
        this.raster = snapshot.raster
        this.dateCount = snapshot.raster.dates.length
        this.selectedDate = Math.max(0, snapshot.raster.dates.length - 1) // 最近一期
      }
      if (snapshot.villagesByDate) this.villagesByDate = snapshot.villagesByDate
      if (snapshot.levelsByDate) this.levelsByDate = snapshot.levelsByDate
      if (snapshot.tasksByDate) this.tasksByDate = snapshot.tasksByDate
      if (snapshot.policyByDate) this.policyByDate = snapshot.policyByDate
      this.playing = false
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
    selectDate(index: number) {
      const count = this.dateCount || this.raster?.dates.length || 0
      if (index < 0 || index >= count) return
      this.selectedDate = index
      this.stopPlay()
    },
    startPlay() {
      const count = this.dateCount || this.raster?.dates.length || 0
      if (this.playing || count <= 0) return
      this.playing = true
      this.timer = setInterval(() => {
        this.selectedDate = (this.selectedDate + 1) % count // 循环播放（一期→末期→回退到首期）
      }, AGRI_PLAY_INTERVAL_MS)
    },
    stopPlay() {
      if (this.timer !== null) { clearInterval(this.timer); this.timer = null }
      this.playing = false
    },
    setOpacity(value: number) {
      const parsed = Number(value)
      if (!Number.isFinite(parsed)) return
      this.opacity = Math.min(1, Math.max(0, parsed))
    },
    toggleVisible() { this.visible = !this.visible },
    setTab(tab: AgriTab) { this.activeTab = tab },
    openVillageDetail(code: string) { this.villageDetailCode = code },
    closeVillageDetail() { this.villageDetailCode = null },
    openTask(id: string) { this.openTaskId = id },
    closeTask() {
      this.openTaskId = null
      this.taskLocation = null // 退出任务详情时定位图标移除
    },
    setTaskLocation(loc: { lon: number; lat: number; name: string } | null) { this.taskLocation = loc },
    /** 一键转任务：生成初始「待领取」任务；同村已转则去重返回 null */
    createTaskFromAnomaly(village: { code: string; name: string; anomalyRatio: number; centroid?: { lon: number; lat: number } | null }): AgriTask | null {
      if (this.convertedVillageCodes.includes(village.code)) return null
      const seq = this.allTasks.length + 1
      const task: AgriTask = {
        id: `task-gen-${village.code}-${seq}`,
        taskNo: `RW-2026-${String(seq).padStart(4, '0')}`,
        name: `${village.name}核查异常长势`,
        type: 'poor_growth',
        typeName: '核查异常长势',
        villageCode: village.code,
        villageName: village.name,
        status: '待领取',
        createdAt: '2026-07-27',
        executor: null,
        remark: `派发任务：${village.name}长势异常，极差+较差承保面积占比约 ${(village.anomalyRatio * 100).toFixed(0)}%，需核查。`,
        sopAction: '携带遥感图斑定位异常地块，核实作物长势与承保面积是否一致、是否存在明显减产。',
        requirement: '到场核实并拍照留痕，48 小时内反馈核查结论。',
        location: { name: village.name, lon: village.centroid?.lon ?? 0, lat: village.centroid?.lat ?? 0 },
        evidence: [],
      }
      this.generatedTasks.push(task)
      // 去重记录
      this.convertedVillageCodes = [...this.convertedVillageCodes, village.code]
      return task
    },
    /** 撤销一键转：移除任务 + 去重记录（防误按）。 */
    cancelConvertVillage(code: string) {
      this.convertedVillageCodes = this.convertedVillageCodes.filter((c) => c !== code)
      this.generatedTasks = this.generatedTasks.filter((t) => t.villageCode !== code)
    },
    close() {
      this.stopPlay()
      const next = this.generation + 1
      this.$reset()
      this.generation = next
      this.isOpen = false
    },
  },
})
