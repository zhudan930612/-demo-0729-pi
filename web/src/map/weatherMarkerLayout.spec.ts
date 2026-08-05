import { describe, expect, it } from 'vitest'
import { layoutMarkers, MARKER_SIZE, MARKER_GAP } from './weatherMarkerLayout'

describe('weather marker layout', () => {
  it('非重叠输入保持原位且结果按行政代码排序', () => {
    const inputs = [
      { code: '330101002000', x: 400, y: 200 },
      { code: '330101001000', x: 100, y: 100 },
    ]
    const result = layoutMarkers(inputs)
    expect(result.map((item) => item.code)).toEqual(['330101001000', '330101002000'])
    expect(result.every((item) => item.dx === 0 && item.dy === 0)).toBe(true)
  })
  it('重叠时上方/下方确定性偏移且不改变查询锚点', () => {
    const inputs = [
      { code: '330101001000', x: 100, y: 100 },
      { code: '330101002000', x: 100, y: 100 },
      { code: '330101003000', x: 100, y: 100 },
      { code: '330101004000', x: 100, y: 100 },
    ]
    const a = layoutMarkers(inputs)
    const b = layoutMarkers(inputs)
    expect(a).toEqual(b) // 确定性
    const rects = a.map((item) => [item.x, item.y - MARKER_SIZE.height, item.x + MARKER_SIZE.width, item.y])
    for (let i = 0; i < rects.length; i++) {
      for (let j = i + 1; j < rects.length; j++) {
        const [ax, ay1, ax2, ay2] = rects[i], [bx, by1, bx2, by2] = rects[j]
        const overlaps = ax < bx2 && ax2 > bx && ay1 < by2 && ay2 > by1
        expect(overlaps).toBe(false)
      }
    }
    expect(a.find((item) => item.code === '330101001000')).toMatchObject({ dx: 0, dy: 0 })
    const distinctOffsets = new Set(a.map((item) => `${item.dx},${item.dy}`))
    expect(distinctOffsets.size).toBeGreaterThan(1)
  })
  it('水平偏移仅在垂直方向耗尽后使用', () => {
    const step = MARKER_SIZE.height + MARKER_GAP
    const inputs = Array.from({ length: 5 }, (_, i) => ({ code: `330101${String(i).padStart(6, '0')}000`, x: 200, y: 100 }))
    const result = layoutMarkers(inputs)
    const vertical = result.filter((item) => item.dx === 0)
    expect(vertical.length).toBeGreaterThanOrEqual(3)
    expect(result.some((item) => item.dx !== 0)).toBe(true)
    expect(result.every((item) => Math.abs(item.dy) <= 3 * step)).toBe(true)
  })
  it('密集输入超过最大环数时保留原锚点（不丢弃）', () => {
    const inputs = Array.from({ length: 40 }, (_, i) => ({ code: `330101${String(i).padStart(6, '0')}000`, x: 300, y: 300 }))
    const result = layoutMarkers(inputs)
    expect(result).toHaveLength(40)
    expect(result.some((item) => item.dx === 0 && item.dy === 0)).toBe(true)
  })
})
