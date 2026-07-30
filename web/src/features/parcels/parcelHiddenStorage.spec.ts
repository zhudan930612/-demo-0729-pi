import { describe, expect, it } from 'vitest'
import { loadHiddenParcelIds, persistHiddenParcelIds } from './parcelHiddenStorage'

function memoryStorage(): Storage {
  const data = new Map<string, string>()
  return {
    get length() { return data.size },
    clear: () => data.clear(),
    getItem: (key) => data.get(key) ?? null,
    key: (index) => [...data.keys()][index] ?? null,
    removeItem: (key) => { data.delete(key) },
    setItem: (key, value) => { data.set(key, value) },
  }
}

describe('parcelHiddenStorage', () => {
  it('persists sorted hidden IDs by village and reloads them', () => {
    const storage = memoryStorage()
    expect(persistHiddenParcelIds('village-1', new Set(['manual-2', 'ai-10', 'ai-2']), storage)).toBe(true)
    expect([...loadHiddenParcelIds('village-1', storage)]).toEqual(['ai-2', 'ai-10', 'manual-2'])
  })

  it('removes empty village records without affecting other villages', () => {
    const storage = memoryStorage()
    persistHiddenParcelIds('village-1', new Set(['ai-1']), storage)
    persistHiddenParcelIds('village-2', new Set(['ai-2']), storage)
    persistHiddenParcelIds('village-1', new Set(), storage)
    expect([...loadHiddenParcelIds('village-1', storage)]).toEqual([])
    expect([...loadHiddenParcelIds('village-2', storage)]).toEqual(['ai-2'])
  })

  it('ignores invalid or incompatible records', () => {
    const storage = memoryStorage()
    storage.setItem('agri-map:parcel-edits:v1', '{bad json')
    expect([...loadHiddenParcelIds('village-1', storage)]).toEqual([])
    storage.setItem('agri-map:parcel-edits:v1', JSON.stringify({
      version: 1,
      villages: { 'village-1': { datasetVersion: 'old', hiddenIds: ['ai-1'] } },
    }))
    expect([...loadHiddenParcelIds('village-1', storage)]).toEqual([])
  })
})
