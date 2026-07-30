import { describe, expect, it } from 'vitest'
import type { ManualParcelFeature } from '../../utils/manualParcelStorage'
import {
  addPendingManualParcel,
  commitManualBatch,
  createManualBatchState,
  hasManualBatchChanges,
  removeManualParcel,
  resetManualBatch,
  undoLatestPendingManualParcel,
  updateManualParcel,
} from './manualBatchState'

function feature(id: string, areaMu = 1): ManualParcelFeature {
  return {
    type: 'Feature',
    geometry: { type: 'Polygon', coordinates: [[[120, 30], [121, 30], [121, 31], [120, 30]]] },
    properties: {
      id,
      village_code: '330000000000',
      source: 'manual',
      area_m2: areaMu * 2000 / 3,
      area_mu: areaMu,
      label_lng: 120.5,
      label_lat: 30.5,
      created_at: '2026-01-01T00:00:00.000Z',
      updated_at: '2026-01-01T00:00:00.000Z',
    },
  }
}

describe('manualBatchState', () => {
  it('adds and removes a pending parcel without marking a formal removal', () => {
    const state = createManualBatchState()
    addPendingManualParcel(state, feature('new-1'))
    removeManualParcel(state, 'new-1', 'new')
    expect(state.pendingParcels).toEqual([])
    expect(state.removedIds).toEqual([])
  })

  it('marks an existing parcel for removal and drops its pending edit', () => {
    const state = createManualBatchState()
    updateManualParcel(state, feature('manual-1', 2), 'existing')
    removeManualParcel(state, 'manual-1', 'existing')
    expect(state.removedIds).toEqual(['manual-1'])
    expect(state.pendingEdits).toEqual([])
  })

  it('replaces edits by id and updates pending parcels in place', () => {
    const state = createManualBatchState()
    addPendingManualParcel(state, feature('new-1'))
    updateManualParcel(state, feature('new-1', 3), 'new')
    updateManualParcel(state, feature('manual-1', 2), 'existing')
    updateManualParcel(state, feature('manual-1', 4), 'existing')
    expect(state.pendingParcels[0].properties.area_mu).toBe(3)
    expect(state.pendingEdits).toHaveLength(1)
    expect(state.pendingEdits[0].properties.area_mu).toBe(4)
  })

  it('undoes only the latest pending parcel', () => {
    const state = createManualBatchState()
    addPendingManualParcel(state, feature('new-1'))
    addPendingManualParcel(state, feature('new-2'))
    undoLatestPendingManualParcel(state)
    expect(state.pendingParcels.map((item) => item.properties.id)).toEqual(['new-1'])
  })

  it('commits existing edits, removals and new parcels together', () => {
    const state = createManualBatchState()
    updateManualParcel(state, feature('manual-1', 5), 'existing')
    removeManualParcel(state, 'manual-2', 'existing')
    addPendingManualParcel(state, feature('new-1', 2))
    const result = commitManualBatch([feature('manual-1'), feature('manual-2')], state)
    expect(result.map((item) => [item.properties.id, item.properties.area_mu])).toEqual([
      ['manual-1', 5],
      ['new-1', 2],
    ])
  })

  it('resets pending state without touching current features', () => {
    const current = [feature('manual-1')]
    const state = createManualBatchState()
    addPendingManualParcel(state, feature('new-1'))
    removeManualParcel(state, 'manual-1', 'existing')
    expect(hasManualBatchChanges(state)).toBe(true)
    resetManualBatch(state)
    expect(hasManualBatchChanges(state)).toBe(false)
    expect(current.map((item) => item.properties.id)).toEqual(['manual-1'])
  })
})
