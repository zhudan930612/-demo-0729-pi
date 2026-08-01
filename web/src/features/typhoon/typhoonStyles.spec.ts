import { describe, expect, it } from 'vitest'
import { typhoonPointStyle } from './typhoonStyles'

describe('typhoonPointStyle', () => {
  it.each([
    [0, '#14B8A6', 5], [17.19, '#14B8A6', 5],
    [17.2, '#3B82F6', 6], [24.4, '#3B82F6', 6],
    [24.5, '#FACC15', 7], [32.6, '#FACC15', 7],
    [32.7, '#F97316', 8], [41.4, '#F97316', 8],
    [41.5, '#E879F9', 9], [50.9, '#E879F9', 9],
    [51, '#EF4444', 10],
  ])('映射 %s m/s 到固定视觉快照', (speed, color, diameterPx) => {
    expect(typhoonPointStyle(speed)).toMatchObject({ color, diameterPx, borderColor: '#334155', borderWidthPx: 1 })
  })

  it.each([24.45, 32.65, 41.45, 50.95, -1, Number.NaN, Number.POSITIVE_INFINITY, undefined])('不猜测无效或规格缝隙 %s', (speed) => {
    expect(typhoonPointStyle(speed)).toBeNull()
  })
})
