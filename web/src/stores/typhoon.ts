import { defineStore } from 'pinia'
import { canOpenHistorical, sortRealtimeTyphoons } from '../features/typhoon/typhoonSelectors'
import type { TyphoonDetail, TyphoonId, TyphoonSummary } from '../features/typhoon/typhoonTypes'

export type TyphoonPhase = 'closed' | 'loading-live' | 'ready' | 'error'

export interface TyphoonLoadCounts {
  total: number
  pending: number
  succeeded: number
  failed: number
}

const emptyCounts = (): TyphoonLoadCounts => ({ total: 0, pending: 0, succeeded: 0, failed: 0 })

export const useTyphoonStore = defineStore('typhoon', {
  state: () => ({
    phase: 'closed' as TyphoonPhase,
    sessionId: 0,
    year: null as number | null,
    summaries: {} as Record<TyphoonId, TyphoonSummary>,
    details: {} as Record<TyphoonId, TyphoonDetail>,
    liveIds: [] as TyphoonId[],
    historicalIds: [] as TyphoonId[],
    openedHistoricalIds: [] as TyphoonId[],
    focusedTyphoonId: null as TyphoonId | null,
    selectedNodeByTyphoon: {} as Record<TyphoonId, string>,
    expandedIds: [] as TyphoonId[],
    timelineOpen: false,
    liveLoad: emptyCounts(),
    historyLoad: emptyCounts(),
    errorMessage: '',
  }),
  getters: {
    realtimeDetails: (state): TyphoonDetail[] => state.liveIds.flatMap((id) => state.details[id] ? [state.details[id]] : []),
    historicalDetails: (state): TyphoonDetail[] => state.historicalIds.flatMap((id) => state.details[id] ? [state.details[id]] : []),
    hasNoActiveTyphoon: (state): boolean => state.phase === 'ready' && state.liveIds.length === 0,
    displayedIds: (state): TyphoonId[] => [...state.liveIds, ...state.openedHistoricalIds],
    canOpenMoreHistory: (state): boolean => canOpenHistorical(state.liveIds.length, state.openedHistoricalIds.length),
  },
  actions: {
    beginSession(sessionId: number, year: number) {
      this.$reset()
      this.sessionId = sessionId
      this.year = year
      this.phase = 'loading-live'
    },
    isCurrentSession(sessionId: number) {
      return this.phase !== 'closed' && this.sessionId === sessionId
    },
    receiveSummaries(sessionId: number, summaries: readonly TyphoonSummary[]) {
      if (!this.isCurrentSession(sessionId)) return false
      this.summaries = Object.fromEntries(summaries.map((summary) => [summary.id, summary]))
      this.liveIds = summaries.filter((summary) => summary.status === 'start').map((summary) => summary.id)
      this.historicalIds = summaries.filter((summary) => summary.status === 'stop').map((summary) => summary.id)
      this.liveLoad = { total: this.liveIds.length, pending: this.liveIds.length, succeeded: 0, failed: 0 }
      this.historyLoad = { total: this.historicalIds.length, pending: this.historicalIds.length, succeeded: 0, failed: 0 }
      return true
    },
    receiveLiveDetail(sessionId: number, detail: TyphoonDetail) {
      if (!this.isCurrentSession(sessionId) || detail.status !== 'start' || !this.summaries[detail.id]) return false
      this.details[detail.id] = detail
      this.liveLoad.pending = Math.max(0, this.liveLoad.pending - 1)
      this.liveLoad.succeeded += 1
      this.sortAndSelectLive()
      return true
    },
    failLiveDetail(sessionId: number) {
      if (!this.isCurrentSession(sessionId)) return false
      this.liveLoad.pending = Math.max(0, this.liveLoad.pending - 1)
      this.liveLoad.failed += 1
      return true
    },
    finishLiveLoading(sessionId: number) {
      if (!this.isCurrentSession(sessionId)) return false
      this.sortAndSelectLive()
      const first = this.liveIds.find((id) => Boolean(this.details[id]))
      if (first) {
        this.focusedTyphoonId = first
        this.expandedIds = [first]
        const latest = this.details[first]?.latestObservation
        if (latest) this.selectedNodeByTyphoon[first] = latest.id
      }
      this.phase = this.liveLoad.total > 0 && this.liveLoad.succeeded === 0 ? 'error' : 'ready'
      if (this.phase === 'error') this.errorMessage = '实时台风数据加载异常'
      return true
    },
    receiveHistoricalDetail(sessionId: number, detail: TyphoonDetail) {
      if (!this.isCurrentSession(sessionId) || detail.status !== 'stop' || !this.summaries[detail.id]) return false
      this.details[detail.id] = detail
      this.historyLoad.pending = Math.max(0, this.historyLoad.pending - 1)
      this.historyLoad.succeeded += 1
      return true
    },
    failHistoricalDetail(sessionId: number) {
      if (!this.isCurrentSession(sessionId)) return false
      this.historyLoad.pending = Math.max(0, this.historyLoad.pending - 1)
      this.historyLoad.failed += 1
      return true
    },
    failList(sessionId: number) {
      if (!this.isCurrentSession(sessionId)) return false
      this.phase = 'error'
      this.errorMessage = '实时台风数据加载异常'
      return true
    },
    sortAndSelectLive() {
      const loaded = Object.values(this.details).filter((detail) => detail.status === 'start')
      const loadedIds = sortRealtimeTyphoons(loaded).map((detail) => detail.id)
      const unloadedIds = this.liveIds.filter((id) => !this.details[id])
      this.liveIds = [...loadedIds, ...unloadedIds]
      const first = loadedIds[0]
      if (!first || this.focusedTyphoonId) return
      this.focusedTyphoonId = first
      this.expandedIds = [first]
      const latest = this.details[first]?.latestObservation
      if (latest) this.selectedNodeByTyphoon[first] = latest.id
    },
    focusTyphoon(typhoonId: TyphoonId) {
      if (!this.displayedIds.includes(typhoonId)) return
      this.focusedTyphoonId = typhoonId
    },
    selectNode(typhoonId: TyphoonId, nodeId: string) {
      if (!this.displayedIds.includes(typhoonId)) return
      this.focusedTyphoonId = typhoonId
      this.selectedNodeByTyphoon[typhoonId] = nodeId
    },
    toggleExpanded(typhoonId: TyphoonId) {
      this.expandedIds = this.expandedIds.includes(typhoonId)
        ? this.expandedIds.filter((id) => id !== typhoonId)
        : [...this.expandedIds, typhoonId]
      this.focusedTyphoonId = typhoonId
    },
    setTimelineOpen(open: boolean) {
      this.timelineOpen = open
    },
    openHistorical(typhoonId: TyphoonId) {
      const detail = this.details[typhoonId]
      if (!detail || detail.status !== 'stop' || this.openedHistoricalIds.includes(typhoonId) || !this.canOpenMoreHistory) return false
      this.openedHistoricalIds.push(typhoonId)
      this.focusedTyphoonId = typhoonId
      this.expandedIds = [...this.expandedIds.filter((id) => id !== typhoonId), typhoonId]
      const latest = detail.latestObservation
      if (latest) this.selectedNodeByTyphoon[typhoonId] = latest.id
      return true
    },
    closeHistorical(typhoonId: TyphoonId) {
      if (!this.openedHistoricalIds.includes(typhoonId)) return false
      this.openedHistoricalIds = this.openedHistoricalIds.filter((id) => id !== typhoonId)
      this.expandedIds = this.expandedIds.filter((id) => id !== typhoonId)
      delete this.selectedNodeByTyphoon[typhoonId]
      if (this.focusedTyphoonId === typhoonId) this.focusedTyphoonId = this.liveIds[0] ?? this.openedHistoricalIds[0] ?? null
      return true
    },
    exitSession() {
      const nextSessionId = this.sessionId + 1
      this.$reset()
      this.sessionId = nextSessionId
    },
  },
})
