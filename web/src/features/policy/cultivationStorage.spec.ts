import { describe, expect, it } from 'vitest'
import { addCultivationRecord, readEffectiveCultivation, removeAddedCultivation, restoreInitialCultivation, saveCultivationOverride } from './cultivationStorage'
import type { CultivationRecord } from './cultivationState'

class MemoryStorage implements Storage {
  private data = new Map<string, string>()
  get length() { return this.data.size }
  clear() { this.data.clear() }
  getItem(key: string) { return this.data.get(key) ?? null }
  key(index: number) { return [...this.data.keys()][index] ?? null }
  removeItem(key: string) { this.data.delete(key) }
  setItem(key: string, value: string) { this.data.set(key, value) }
}

const initial: CultivationRecord = { villageCode: 'v', parcelId: '1', year: 2025, season: '早稻', crop: '水稻', variety: '甲', startDate: '2025-05-01', endDate: '2025-07-20', status: '已核查', checkedAt: '2025-06-01', note: '' }
const added: CultivationRecord = { ...initial, year: 2024, season: '其他', startDate: '2024-01-01', endDate: '2024-02-01' }

describe('cultivation storage', () => {
  it('overrides, adds, deletes additions and isolates by village/parcel', () => {
    const storage = new MemoryStorage()
    expect(saveCultivationOverride('v', { ...initial, variety: '乙' }, [initial], storage).ok).toBe(true)
    expect(addCultivationRecord('v', added, [initial], storage).ok).toBe(true)
    expect(readEffectiveCultivation('v', '1', [initial], storage).map((r) => r.variety)).toContain('乙')
    expect(readEffectiveCultivation('other', '1', [initial], storage)).toHaveLength(0)
    expect(removeAddedCultivation('v', added, storage).ok).toBe(true)
    expect(readEffectiveCultivation('v', '1', [initial], storage)).toHaveLength(1)
  })
  it('restores only the selected parcel initial state', () => {
    const storage = new MemoryStorage()
    saveCultivationOverride('v', { ...initial, variety: '乙' }, [initial], storage)
    addCultivationRecord('v', added, [initial], storage)
    expect(restoreInitialCultivation('v', '1', storage).ok).toBe(true)
    expect(readEffectiveCultivation('v', '1', [initial], storage)).toEqual([initial])
  })
  it('keeps persisted data when storage write fails', () => {
    const storage = new MemoryStorage()
    storage.setItem = () => { throw new Error('quota') }
    expect(addCultivationRecord('v', added, [initial], storage).ok).toBe(false)
  })
  it('does not delete a preloaded initial record through the added-record API', () => {
    const storage = new MemoryStorage()
    expect(removeAddedCultivation('v', initial, storage).ok).toBe(true)
    expect(readEffectiveCultivation('v', '1', [initial], storage)).toEqual([initial])
  })
})
