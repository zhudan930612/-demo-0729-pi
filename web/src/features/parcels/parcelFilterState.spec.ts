import { describe, expect, it } from 'vitest'
import {
  calculateNextHiddenIds,
  clearPendingParcelFilterState,
  createParcelFilterState,
  getParcelFilterCounts,
  restoreAllParcels,
  toggleParcelFilterSelection,
} from './parcelFilterState'

describe('parcelFilterState', () => {
  it('toggles visible parcels in the pending hide set', () => {
    const state = createParcelFilterState()
    toggleParcelFilterSelection(state, 'ai-1')
    expect([...state.pendingHideIds]).toEqual(['ai-1'])
    toggleParcelFilterSelection(state, 'ai-1')
    expect(state.pendingHideIds.size).toBe(0)
  })

  it('toggles hidden manual parcels in the pending restore set', () => {
    const state = createParcelFilterState(['manual-1'])
    toggleParcelFilterSelection(state, 'manual-1')
    expect([...state.pendingRestoreIds]).toEqual(['manual-1'])
    toggleParcelFilterSelection(state, 'manual-1')
    expect(state.pendingRestoreIds.size).toBe(0)
  })

  it('marks every hidden parcel for restore without changing pending hides', () => {
    const state = createParcelFilterState(['ai-1', 'manual-1'])
    toggleParcelFilterSelection(state, 'ai-2')
    restoreAllParcels(state)
    expect([...state.pendingRestoreIds]).toEqual(['ai-1', 'manual-1'])
    expect([...state.pendingHideIds]).toEqual(['ai-2'])
  })

  it('calculates hidden plus pending hide minus pending restore', () => {
    const state = createParcelFilterState(['ai-1', 'manual-1'])
    toggleParcelFilterSelection(state, 'ai-2')
    toggleParcelFilterSelection(state, 'manual-1')
    expect([...calculateNextHiddenIds(state)].sort()).toEqual(['ai-1', 'ai-2'])
  })

  it('reports counts and clears only pending state', () => {
    const state = createParcelFilterState(['ai-1'])
    toggleParcelFilterSelection(state, 'ai-2')
    toggleParcelFilterSelection(state, 'ai-1')
    expect(getParcelFilterCounts(state)).toEqual({ hidden: 1, pendingHide: 1, pendingRestore: 1 })
    clearPendingParcelFilterState(state)
    expect(getParcelFilterCounts(state)).toEqual({ hidden: 1, pendingHide: 0, pendingRestore: 0 })
  })
})
