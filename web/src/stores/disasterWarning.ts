import { defineStore } from 'pinia'
import type { DisasterTrack, DisasterPrecip, DisasterWarnings, DisasterWarningTab } from '../features/disaster-warning/types'

export type DisasterWarningPhase = 'closed' | 'loading' | 'ready' | 'error'

export interface DisasterWarningSnapshot {
  track: DisasterTrack
  precip: DisasterPrecip
  warnings: DisasterWarnings
}

/** 受灾预警模式状态（R1/R2/R3 共享；播放/标记/任务由后续切片扩充本 store 或独立 store）。 */
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
  }),
  getters: {
    isReady: (s) => s.phase === 'ready',
    /** 当前播放帧号（后续切片驱动播放/热力图/预警渲染；T3 只保证存在） */
    nodeCount: (s) => s.track?.datas.length ?? 0,
  },
  actions: {
    open() {
      const next = this.generation + 1
      this.$reset()
      this.generation = next
      this.phase = 'loading'
      this.isOpen = true
      this.activeTab = 'loss' // 默认灾损预估（R1-5）
    },
    receive(generation: number, snapshot: DisasterWarningSnapshot) {
      if (this.generation !== generation) return false
      this.track = snapshot.track
      this.precip = snapshot.precip
      this.warnings = snapshot.warnings
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
    close() {
      const next = this.generation + 1
      this.$reset()
      this.generation = next
      this.isOpen = false
    },
  },
})
