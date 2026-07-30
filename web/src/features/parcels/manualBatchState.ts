import type { ManualParcelFeature } from '../../utils/manualParcelStorage'

export type ManualBatchKind = 'new' | 'existing'

export interface ManualBatchState {
  pendingParcels: ManualParcelFeature[]
  pendingEdits: ManualParcelFeature[]
  removedIds: string[]
}

export function createManualBatchState(): ManualBatchState {
  return { pendingParcels: [], pendingEdits: [], removedIds: [] }
}

export function addPendingManualParcel(state: ManualBatchState, feature: ManualParcelFeature): void {
  state.pendingParcels.push(feature)
}

export function updateManualParcel(
  state: ManualBatchState,
  feature: ManualParcelFeature,
  kind: ManualBatchKind,
): void {
  const id = feature.properties.id
  if (kind === 'existing') {
    state.pendingEdits = [...state.pendingEdits.filter((item) => item.properties.id !== id), feature]
    return
  }
  state.pendingParcels = state.pendingParcels.map((item) => item.properties.id === id ? feature : item)
}

export function removeManualParcel(state: ManualBatchState, id: string, kind: ManualBatchKind): void {
  if (kind === 'existing') {
    state.removedIds = [...new Set([...state.removedIds, id])]
    state.pendingEdits = state.pendingEdits.filter((feature) => feature.properties.id !== id)
    return
  }
  state.pendingParcels = state.pendingParcels.filter((feature) => feature.properties.id !== id)
}

export function undoLatestPendingManualParcel(state: ManualBatchState): void {
  state.pendingParcels = state.pendingParcels.slice(0, -1)
}

export function commitManualBatch(
  currentFeatures: ManualParcelFeature[],
  state: ManualBatchState,
): ManualParcelFeature[] {
  const editedById = new Map(state.pendingEdits.map((feature) => [feature.properties.id, feature]))
  return [
    ...currentFeatures
      .filter((feature) => !state.removedIds.includes(feature.properties.id))
      .map((feature) => editedById.get(feature.properties.id) ?? feature),
    ...state.pendingParcels,
  ]
}

export function resetManualBatch(state: ManualBatchState): void {
  state.pendingParcels = []
  state.pendingEdits = []
  state.removedIds = []
}

export function hasManualBatchChanges(state: ManualBatchState): boolean {
  return state.pendingParcels.length > 0 || state.pendingEdits.length > 0 || state.removedIds.length > 0
}
