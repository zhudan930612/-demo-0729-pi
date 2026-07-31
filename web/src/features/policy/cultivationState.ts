import { BUSINESS_DATE } from './policyTypes'

export const CULTIVATION_SCHEMA_VERSION = 'cultivation-v1'
export const CULTIVATION_STORAGE_VERSION = 1
export const CULTIVATION_SEASONS = ['早稻', '单季稻', '连作晚稻', '其他'] as const
export const CULTIVATION_STATUSES = ['未核查', '已核查', '需复核'] as const

export type CultivationSeason = typeof CULTIVATION_SEASONS[number]
export type CultivationStatus = typeof CULTIVATION_STATUSES[number]

export interface CultivationRecord {
  villageCode: string
  parcelId: string
  year: number
  season: CultivationSeason
  crop: string
  variety: string
  startDate: string
  endDate: string
  status: CultivationStatus
  checkedAt: string
  note: string
}

export interface CultivationValidationResult {
  valid: boolean
  errors: string[]
}

export interface CurrentCultivationResult {
  record: CultivationRecord | null
  nearestRecord: CultivationRecord | null
  matchedRecords: CultivationRecord[]
  multipleMatches: boolean
}

export function cultivationKey(record: Pick<CultivationRecord, 'villageCode' | 'parcelId' | 'year' | 'season'>): string {
  return `${record.villageCode}:${record.parcelId}:${record.year}:${record.season}`
}

function validDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false
  const date = new Date(`${value}T00:00:00Z`)
  return !Number.isNaN(date.valueOf()) && date.toISOString().slice(0, 10) === value
}

function overlaps(a: CultivationRecord, b: CultivationRecord): boolean {
  return a.startDate <= b.endDate && b.startDate <= a.endDate
}

export function validateCultivationRecords(records: CultivationRecord[]): CultivationValidationResult {
  const errors: string[] = []
  const keys = new Set<string>()
  const byParcelYear = new Map<string, CultivationRecord[]>()
  for (const record of records) {
    const key = cultivationKey(record)
    if (keys.has(key)) errors.push(`种植档案唯一键重复：${key}`)
    keys.add(key)
    if (!CULTIVATION_SEASONS.includes(record.season)) errors.push(`季节非法：${key}`)
    if (!CULTIVATION_STATUSES.includes(record.status)) errors.push(`核查状态非法：${key}`)
    if (!Number.isInteger(record.year) || record.year < 1900 || record.year > 2200) errors.push(`年度非法：${key}`)
    if (!validDate(record.startDate) || !validDate(record.endDate) || record.startDate >= record.endDate) errors.push(`种植期间非法：${key}`)
    if (record.status !== '未核查' && !validDate(record.checkedAt)) errors.push(`核查日期非法：${key}`)
    const groupKey = `${record.villageCode}:${record.parcelId}:${record.year}`
    const group = byParcelYear.get(groupKey) ?? []
    group.push(record)
    byParcelYear.set(groupKey, group)
  }
  for (const [groupKey, group] of byParcelYear) {
    const seasons = new Set(group.map((record) => record.season))
    if (seasons.has('单季稻') && (seasons.has('早稻') || seasons.has('连作晚稻'))) errors.push(`单季稻与双季稻互斥：${groupKey}`)
    for (let i = 0; i < group.length; i += 1) {
      for (let j = i + 1; j < group.length; j += 1) {
        if (overlaps(group[i], group[j])) errors.push(`种植期间重叠：${cultivationKey(group[i])} / ${cultivationKey(group[j])}`)
      }
    }
  }
  return { valid: errors.length === 0, errors }
}

export function getCurrentCultivationRecord(records: CultivationRecord[], businessDate = BUSINESS_DATE): CurrentCultivationResult {
  const matches = records.filter((record) => record.startDate <= businessDate && businessDate <= record.endDate)
  const sortedMatches = [...matches].sort((a, b) => b.startDate.localeCompare(a.startDate) || cultivationKey(a).localeCompare(cultivationKey(b)))
  const yearRecords = records.filter((record) => record.year === Number(businessDate.slice(0, 4)))
  const nearestRecord = [...yearRecords].sort((a, b) => {
    const distance = (record: CultivationRecord) => record.startDate > businessDate ? Date.parse(record.startDate) - Date.parse(businessDate) : Date.parse(businessDate) - Date.parse(record.endDate)
    return distance(a) - distance(b) || b.startDate.localeCompare(a.startDate)
  })[0] ?? null
  return { record: sortedMatches[0] ?? null, nearestRecord, matchedRecords: sortedMatches, multipleMatches: sortedMatches.length > 1 }
}

export const getCurrentRecord = getCurrentCultivationRecord
