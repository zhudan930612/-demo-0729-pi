import { describe, expect, it } from 'vitest'
import { polygon } from '@turf/helpers'
import { inspectManualGeometry, prepareManualGeometry } from './parcelGeometry'

const square = [
  [120, 30],
  [120.01, 30],
  [120.01, 30.01],
  [120, 30.01],
]

describe('prepareManualGeometry', () => {
  it('closes a valid polygon and calculates area', () => {
    const result = prepareManualGeometry(square)
    expect(result.error).toBeUndefined()
    expect(result.prepared?.geometry.coordinates[0]).toHaveLength(5)
    expect(result.prepared?.areaM2).toBeGreaterThan(0)
    expect(result.prepared?.areaMu).toBeGreaterThan(0)
  })

  it('rejects fewer than three distinct vertices', () => {
    expect(prepareManualGeometry([[120, 30], [120, 30], [121, 31]]).error).toContain('3 个')
  })

  it('rejects a self-intersection', () => {
    const result = prepareManualGeometry([[120, 30], [120.01, 30.01], [120, 30.01], [120.01, 30]])
    expect(result.error).toContain('自相交')
  })
})

describe('inspectManualGeometry', () => {
  const candidate = prepareManualGeometry(square).prepared!.geometry
  const village = polygon([[
    [119.99, 29.99], [120.02, 29.99], [120.02, 30.02], [119.99, 30.02], [119.99, 29.99],
  ]]).geometry

  it('counts area overlap but not an edge touch', () => {
    const overlap = polygon([[
      [120.005, 30.005], [120.02, 30.005], [120.02, 30.02], [120.005, 30.02], [120.005, 30.005],
    ]])
    const touch = polygon([[
      [120.01, 30], [120.02, 30], [120.02, 30.01], [120.01, 30.01], [120.01, 30],
    ]])
    expect(inspectManualGeometry(candidate, village, [overlap, touch]).overlapCount).toBe(1)
  })

  it('warns when the polygon leaves the village', () => {
    const smallVillage = polygon([[
      [120, 30], [120.005, 30], [120.005, 30.005], [120, 30.005], [120, 30],
    ]]).geometry
    expect(inspectManualGeometry(candidate, smallVillage, []).outsideVillage).toBe(true)
  })
})
