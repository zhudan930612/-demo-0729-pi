import type { ParcelId } from './parcelTypes'

export interface ParcelFilterState {
  hiddenIds: Set<ParcelId>
  pendingHideIds: Set<ParcelId>
  pendingRestoreIds: Set<ParcelId>
}

export function createParcelFilterState(hiddenIds: Iterable<ParcelId> = []): ParcelFilterState {
  return {
    hiddenIds: new Set(hiddenIds),
    pendingHideIds: new Set(),
    pendingRestoreIds: new Set(),
  }
}

export function clearPendingParcelFilterState(state: ParcelFilterState): void {
  state.pendingHideIds.clear()
  state.pendingRestoreIds.clear()
}

export function toggleParcelFilterSelection(state: ParcelFilterState, id: ParcelId): void {
  if (state.hiddenIds.has(id)) {
    if (state.pendingRestoreIds.has(id)) state.pendingRestoreIds.delete(id)
    else state.pendingRestoreIds.add(id)
    return
  }
  if (state.pendingHideIds.has(id)) state.pendingHideIds.delete(id)
  else state.pendingHideIds.add(id)
}

export function restoreAllParcels(state: ParcelFilterState): void {
  state.pendingRestoreIds.clear()
  for (const id of state.hiddenIds) state.pendingRestoreIds.add(id)
}

export function calculateNextHiddenIds(state: ParcelFilterState): Set<ParcelId> {
  const next = new Set([...state.hiddenIds, ...state.pendingHideIds])
  for (const id of state.pendingRestoreIds) next.delete(id)
  return next
}

export function getParcelFilterCounts(state: ParcelFilterState) {
  return {
    hidden: state.hiddenIds.size,
    pendingHide: state.pendingHideIds.size,
    pendingRestore: state.pendingRestoreIds.size,
  }
}
