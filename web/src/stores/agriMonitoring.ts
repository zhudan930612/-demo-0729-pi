import { defineStore } from 'pinia'
import type { AgriTask, AgriTab, NdviRaster, VillageGrowth, LevelAggregate, PolicyGrowthRow } from '../features/agri-monitoring/agriMonitoringTypes'

export type AgriPhase = 'closed' | 'loading' | 'ready' | 'error'
export const AGRI_PLAY_INTERVAL_MS = 1400
export const AGRI_DEFAULT_OPACITY = 0.55 // 半透明：露出底图(省级天地图卫星/村级吉林一号影像)，卫星影像与长势覆盖层叠加

export interface AgriSnapshot {
  raster: NdviRaster | null
  villages: VillageGrowth[] | null
  levels: Record<string, LevelAggregate> | null
  tasks: AgriTask[]
  policyGrowth: Record<string, PolicyGrowthRow[]>
}

export const useAgriMonitoringStore = defineStore('agriMonitoring', {
  state: () => ({
    phase: 'closed' as AgriPhase,
    raster: null as NdviRaster | null,
    villages: null as VillageGrowth[] | null,
    levels: null as Record<string, LevelAggregate> | null,
    tasks: [] as AgriTask[],
    generatedTasks: [] as AgriTask[],
    policyGrowth: {} as Record<string, PolicyGrowthRow[]>,
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
    allTasks: (s) => [...s.tasks, ...s.generatedTasks],
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
      if (snapshot.villages) this.villages = snapshot.villages
      if (snapshot.levels) this.levels = snapshot.levels
      if (snapshot.tasks) this.tasks = snapshot.tasks
      if (snapshot.policyGrowth) this.policyGrowth = snapshot.policyGrowth
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
        if (this.selectedDate >= count - 1) {
          this.stopPlay() // 播放到最后一期自动停止
          return
        }
        this.selectedDate += 1
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
    createTaskFromAnomaly(village: VillageGrowth): AgriTask | null {
      if (this.convertedVillageCodes.includes(village.code)) return null
      const seq = this.allTasks.length + 1
      const task: AgriTask = {
        id: `task-gen-${village.code}-${seq}`,
        name: `${village.name}核查异常长势`,
        type: 'poor_growth',
        typeName: '核查异常长势',
        villageCode: village.code,
        villageName: village.name,
        status: '待领取',
        createdAt: '2026-07-27',
        executor: null,
        remark: `一键转任务：${village.name}长势异常，极差+较差承保面积占比约 ${(village.anomalyRatio * 100).toFixed(0)}%，需核查。`,
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
    close() {
      this.stopPlay()
      const next = this.generation + 1
      this.$reset()
      this.generation = next
      this.isOpen = false
    },
  },
})
