import type { TyphoonDetail, TyphoonId, TyphoonSelectionState } from './typhoonTypes'

export const MAX_DISPLAYED_TYPHOONS = 6

export function sortRealtimeTyphoons(details: readonly TyphoonDetail[]): TyphoonDetail[] {
  return details.filter((detail) => detail.status === 'start').sort((left, right) => {
    const latestOrder = (right.latestObservation?.epochMs ?? Number.NEGATIVE_INFINITY) - (left.latestObservation?.epochMs ?? Number.NEGATIVE_INFINITY)
    return latestOrder || left.sourceIndex - right.sourceIndex
  })
}

export function displayedTyphoonIds(realtime: readonly TyphoonDetail[], openedHistoricalIds: readonly TyphoonId[]): TyphoonId[] {
  return [...sortRealtimeTyphoons(realtime).map((detail) => detail.id), ...openedHistoricalIds]
}

export function canOpenHistorical(realtimeCount: number, openedHistoricalCount: number): boolean {
  return realtimeCount < MAX_DISPLAYED_TYPHOONS && realtimeCount + openedHistoricalCount < MAX_DISPLAYED_TYPHOONS
}

export function createTyphoonSelectionState(): TyphoonSelectionState {
  return { focusedTyphoonId: null, selectedNodeByTyphoon: new Map(), openedHistoricalIds: [] }
}

export function focusTyphoon(state: TyphoonSelectionState, typhoonId: TyphoonId): TyphoonSelectionState {
  return { ...state, focusedTyphoonId: typhoonId }
}

export function selectTyphoonNode(state: TyphoonSelectionState, typhoonId: TyphoonId, nodeId: string): TyphoonSelectionState {
  const selectedNodeByTyphoon = new Map(state.selectedNodeByTyphoon)
  selectedNodeByTyphoon.set(typhoonId, nodeId)
  return { ...state, focusedTyphoonId: typhoonId, selectedNodeByTyphoon }
}

export function openHistoricalTyphoon(state: TyphoonSelectionState, typhoonId: TyphoonId, realtimeCount: number): TyphoonSelectionState {
  if (state.openedHistoricalIds.includes(typhoonId) || !canOpenHistorical(realtimeCount, state.openedHistoricalIds.length)) return state
  return { ...state, focusedTyphoonId: typhoonId, openedHistoricalIds: [...state.openedHistoricalIds, typhoonId] }
}

export function closeHistoricalTyphoon(state: TyphoonSelectionState, typhoonId: TyphoonId): TyphoonSelectionState {
  if (!state.openedHistoricalIds.includes(typhoonId)) return state
  const selectedNodeByTyphoon = new Map(state.selectedNodeByTyphoon)
  selectedNodeByTyphoon.delete(typhoonId)
  return {
    focusedTyphoonId: state.focusedTyphoonId === typhoonId ? null : state.focusedTyphoonId,
    selectedNodeByTyphoon,
    openedHistoricalIds: state.openedHistoricalIds.filter((id) => id !== typhoonId),
  }
}
