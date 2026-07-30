import { describe, expect, it } from 'vitest'
import { makeManualParcel, readManualParcels, writeManualParcels } from './manualParcelStorage'
import { prepareManualGeometry } from './parcelGeometry'

class MemoryStorage implements Storage {
  private data = new Map<string, string>()
  get length() { return this.data.size }
  clear() { this.data.clear() }
  getItem(key: string) { return this.data.get(key) ?? null }
  key(index: number) { return [...this.data.keys()][index] ?? null }
  removeItem(key: string) { this.data.delete(key) }
  setItem(key: string, value: string) { this.data.set(key, value) }
}

const prepared = prepareManualGeometry([
  [120, 30], [120.01, 30], [120.01, 30.01], [120, 30.01],
]).prepared!

describe('manual parcel storage', () => {
  it('isolates records by village', () => {
    const storage = new MemoryStorage()
    const feature = makeManualParcel('v1', prepared, undefined, '2026-01-01T00:00:00.000Z')
    expect(writeManualParcels('v1', [feature], storage).ok).toBe(true)
    expect(readManualParcels('v1', storage).features).toHaveLength(1)
    expect(readManualParcels('v2', storage).features).toHaveLength(0)
  })

  it('preserves id and creation time when editing', () => {
    const original = makeManualParcel('v1', prepared, undefined, '2026-01-01T00:00:00.000Z')
    const edited = makeManualParcel('v1', prepared, original, '2026-01-02T00:00:00.000Z')
    expect(edited.properties.id).toBe(original.properties.id)
    expect(edited.properties.created_at).toBe(original.properties.created_at)
    expect(edited.properties.updated_at).not.toBe(original.properties.updated_at)
  })

  it('does not overwrite corrupted data', () => {
    const storage = new MemoryStorage()
    storage.setItem('agri-map:manual-parcels:v1', '{broken')
    const feature = makeManualParcel('v1', prepared)
    const result = writeManualParcels('v1', [feature], storage)
    expect(result.ok).toBe(false)
    expect(storage.getItem('agri-map:manual-parcels:v1')).toBe('{broken')
  })

  it('deletes a village bucket when its last feature is removed', () => {
    const storage = new MemoryStorage()
    const feature = makeManualParcel('v1', prepared)
    writeManualParcels('v1', [feature], storage)
    writeManualParcels('v1', [], storage)
    expect(readManualParcels('v1', storage).features).toHaveLength(0)
  })

  it('returns an error instead of throwing when storage reads are blocked', () => {
    const storage = new MemoryStorage()
    storage.getItem = () => { throw new DOMException('blocked', 'SecurityError') }
    expect(() => readManualParcels('v1', storage)).not.toThrow()
    expect(readManualParcels('v1', storage).error).toContain('无法读取')
    expect(writeManualParcels('v1', [], storage).ok).toBe(false)
  })

  it('keeps the feature when storage writes fail', () => {
    const storage = new MemoryStorage()
    storage.setItem = () => { throw new DOMException('quota', 'QuotaExceededError') }
    const feature = makeManualParcel('v1', prepared)
    expect(writeManualParcels('v1', [feature], storage).ok).toBe(false)
  })

  it('rejects an array used as the villages map', () => {
    const storage = new MemoryStorage()
    storage.setItem('agri-map:manual-parcels:v1', JSON.stringify({ version: 1, villages: [] }))
    const feature = makeManualParcel('v1', prepared)
    expect(writeManualParcels('v1', [feature], storage).ok).toBe(false)
  })

  it('skips unclosed polygons and polygons with holes', () => {
    const storage = new MemoryStorage()
    const base = makeManualParcel('v1', prepared)
    const unclosed = structuredClone(base)
    unclosed.geometry.coordinates[0] = unclosed.geometry.coordinates[0].slice(0, -1)
    const holed = structuredClone(base)
    holed.geometry.coordinates.push([[120.002, 30.002], [120.003, 30.002], [120.003, 30.003], [120.002, 30.002]])
    storage.setItem('agri-map:manual-parcels:v1', JSON.stringify({ version: 1, villages: { v1: [unclosed, holed] } }))
    const result = readManualParcels('v1', storage)
    expect(result.features).toHaveLength(0)
    expect(result.error).toContain('无效')
  })
})
