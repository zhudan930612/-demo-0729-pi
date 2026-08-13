import { defineStore } from 'pinia'
import type { NationalAlarmDetailState, NationalAlarmPhase, NationalAlarmSelection, NationalAlarmSnapshot } from '../features/national-alarms/nationalAlarmTypes'

export const useNationalAlarmStore = defineStore('nationalAlarms', {
  state: () => ({ phase: 'closed' as NationalAlarmPhase, generation: 0, snapshot: null as NationalAlarmSnapshot | null, errorMessage: '', selection: null as NationalAlarmSelection | null, detail: null as NationalAlarmDetailState | null, silentLoading: false }),
  getters: { isOpen: (state) => state.phase !== 'closed' && !state.silentLoading },
  actions: {
    beginSilent() { this.silentLoading = true },
    endSilent() { this.silentLoading = false },
    open() { this.$reset(); this.phase = 'loading'; return ++this.generation },
    begin(refresh = false) { this.errorMessage = ''; this.phase = refresh && this.snapshot ? 'refreshing' : 'loading'; return ++this.generation },
    receive(generation: number, snapshot: NationalAlarmSnapshot) { if (generation !== this.generation) return false; this.snapshot = snapshot; this.phase = 'ready'; if (this.selection && !snapshot.items.some((item) => item.id === this.selection?.id)) { this.selection = null; this.detail = null } return true },
    fail(generation: number, message: string) { if (generation !== this.generation) return false; this.phase = this.snapshot ? 'ready' : 'error'; this.errorMessage = message; return true },
    select(selection: NationalAlarmSelection | null) { this.selection = selection; if (!selection) this.detail = null },
    beginDetail(id: string, retryAvailable = true) { this.detail = { id, phase: 'loading', body: null, retryAvailable } },
    receiveDetail(id: string, body: string | null) { if (this.detail?.id !== id) return false; this.detail = { id, phase: 'ready', body, retryAvailable: false }; return true },
    failDetail(id: string) { if (this.detail?.id !== id) return false; this.detail = { id, phase: 'error', body: null, retryAvailable: Boolean(this.detail.retryAvailable) }; return true },
    consumeDetailRetry() { if (this.detail) this.detail.retryAvailable = false },
    close() { const generation = this.generation + 1; this.$reset(); this.generation = generation },
  },
})
