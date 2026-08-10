import { defineStore } from 'pinia'
import type { PrecipitationSnapshot } from '../features/precipitation/precipitationTypes'

export type PrecipitationPhase = 'closed' | 'loading' | 'ready' | 'error' | 'refreshing'
export const PRECIP_PLAY_INTERVAL_MS = 1200
export const PRECIP_DEFAULT_OPACITY = 0.6
export const PRECIP_DAY_COUNT = 7

interface PlayTimerOptions { setInterval?: typeof setInterval; clearInterval?: typeof clearInterval }

export const usePrecipitationStore = defineStore('precipitation', {
  state: () => ({
    phase: 'closed' as PrecipitationPhase,
    snapshot: null as PrecipitationSnapshot | null,
    selectedDay: 0,
    playing: false,
    opacity: PRECIP_DEFAULT_OPACITY,
    errorMessage: '',
    generation: 0,
    timer: null as ReturnType<typeof setInterval> | null,
  }),
  getters: {
    isOpen: (state) => state.phase !== 'closed',
    days: (state) => state.snapshot?.days ?? [],
    coveredDays: (state) => state.snapshot?.coveredDays ?? 0,
    currentDayLabel: (state) => state.snapshot?.days[state.selectedDay] ?? '',
    showStale: (state) => Boolean(state.snapshot?.stale),
    staleMessage: (state) => state.snapshot?.refreshError ?? '',
  },
  actions: {
    open() {
      this.stopPlay()
      const next = this.generation + 1
      this.$reset()
      this.generation = next
      this.phase = 'loading'
    },
    receive(generation: number, snapshot: PrecipitationSnapshot) {
      if (this.generation !== generation) return false
      this.snapshot = snapshot
      this.selectedDay = 0
      this.playing = false
      this.phase = 'ready'
      this.errorMessage = ''
      return true
    },
    fail(generation: number, message: string) {
      if (this.generation !== generation) return false
      this.phase = this.snapshot ? 'ready' : 'error'
      this.errorMessage = message
      return true
    },
    beginRefresh() { if (this.phase === 'ready') this.phase = 'refreshing' },
    selectDay(index: number) {
      if (index < 0 || index >= PRECIP_DAY_COUNT) return
      this.selectedDay = index
      this.playing = false
    },
    setOpacity(value: number) {
      const parsed = Number(value)
      if (!Number.isFinite(parsed)) return
      this.opacity = Math.min(1, Math.max(0, parsed))
    },
    startPlay(options: PlayTimerOptions = {}) {
      if (this.playing || this.phase !== 'ready') return
      const setI = options.setInterval ?? globalThis.setInterval
      const clearI = options.clearInterval ?? globalThis.clearInterval
      this.playing = true
      // 循环播放：到第 7 天（索引 6）后回第 1 天（索引 0）继续，无自动停止
      this.timer = setI(() => {
        this.selectedDay = (this.selectedDay + 1) % PRECIP_DAY_COUNT
      }, PRECIP_PLAY_INTERVAL_MS)
    },
    stopPlay(options: PlayTimerOptions = {}) {
      const clearI = options.clearInterval ?? globalThis.clearInterval
      if (this.timer !== null) { clearI(this.timer); this.timer = null }
      this.playing = false
    },
    close() {
      this.stopPlay()
      const next = this.generation + 1
      this.$reset()
      this.generation = next
    },
  },
})
