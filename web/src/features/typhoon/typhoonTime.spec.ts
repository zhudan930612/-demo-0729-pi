import { describe, expect, it } from 'vitest'
import { beijingYearRange, formatBeijingDateTime, parseBeijingDateTime, stableTimeSort } from './typhoonTime'

describe('typhoonTime', () => {
  it('严格按 UTC+8 解析和格式化，不依赖本机时区', () => {
    const epoch = parseBeijingDateTime('2026-01-01 00:00:00')
    expect(epoch).toBe(Date.UTC(2025, 11, 31, 16))
    expect(formatBeijingDateTime(epoch!)).toBe('2026-01-01 00:00:00')
  })

  it('接受闰日并拒绝非法日期和宽松格式', () => {
    expect(parseBeijingDateTime('2024-02-29 23:59:59')).not.toBeNull()
    expect(parseBeijingDateTime('2026-02-29 00:00:00')).toBeNull()
    expect(parseBeijingDateTime('2026-04-31 00:00:00')).toBeNull()
    expect(parseBeijingDateTime('2026-1-01 00:00:00')).toBeNull()
  })

  it('北京时间年界不受 UTC 日期影响', () => {
    const now = Date.UTC(2025, 11, 31, 16, 30)
    expect(beijingYearRange(now)).toEqual({ year: 2026, startMs: Date.UTC(2025, 11, 31, 16), endMs: now })
  })

  it('相同时间始终保留 API 原顺序', () => {
    const items = [{ epochMs: 20, sourceIndex: 2 }, { epochMs: 10, sourceIndex: 1 }, { epochMs: 20, sourceIndex: 0 }]
    expect(stableTimeSort(items).map((item) => item.sourceIndex)).toEqual([1, 0, 2])
    expect(stableTimeSort(items, 'desc').map((item) => item.sourceIndex)).toEqual([0, 2, 1])
  })
})
