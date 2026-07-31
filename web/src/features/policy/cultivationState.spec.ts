import { describe, expect, it } from 'vitest'
import { getCurrentCultivationRecord, validateCultivationRecords, type CultivationRecord } from './cultivationState'

const record = (season: CultivationRecord['season'], start = '2025-05-01', end = '2025-07-20'): CultivationRecord => ({
  villageCode: 'v', parcelId: '1', year: 2025, season, crop: '水稻', variety: '品种', startDate: start, endDate: end,
  status: '已核查', checkedAt: '2025-06-01', note: '',
})

describe('cultivation state', () => {
  it('allows early rice and ratooning late rice together', () => {
    expect(validateCultivationRecords([record('早稻'), record('连作晚稻', '2025-07-21', '2025-11-30')]).valid).toBe(true)
  })
  it('rejects duplicate season, single-season mixture and overlapping periods', () => {
    expect(validateCultivationRecords([record('早稻'), record('早稻', '2025-08-01', '2025-09-01')]).errors[0]).toContain('唯一键重复')
    expect(validateCultivationRecords([record('单季稻'), record('早稻', '2025-07-21', '2025-11-30')]).errors[0]).toContain('互斥')
    expect(validateCultivationRecords([record('早稻'), record('连作晚稻', '2025-07-01', '2025-11-30')]).errors[0]).toContain('期间重叠')
  })
  it('chooses the latest-start match as fallback and nearest current-year record when none matches', () => {
    const matches = [record('早稻', '2025-05-01', '2025-08-01'), record('其他', '2025-06-01', '2025-08-01')]
    const result = getCurrentCultivationRecord(matches)
    expect(result.multipleMatches).toBe(true)
    expect(result.record?.season).toBe('其他')
    const noMatch = getCurrentCultivationRecord([record('早稻', '2025-01-01', '2025-02-01')])
    expect(noMatch.record).toBeNull()
    expect(noMatch.nearestRecord?.season).toBe('早稻')
  })
})
