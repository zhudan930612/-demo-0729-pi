import {
  cultivationKey,
  CULTIVATION_STORAGE_VERSION,
  type CultivationRecord,
  validateCultivationRecords,
} from './cultivationState'

const CULTIVATION_STORAGE_KEY = 'agri-map:cultivation-overrides:v1'

interface VillageCultivationBucket {
  overrides: Record<string, CultivationRecord>
  additions: Record<string, CultivationRecord>
}
interface CultivationStorageData {
  version: typeof CULTIVATION_STORAGE_VERSION
  villages: Record<string, VillageCultivationBucket>
}

export interface CultivationStorageResult {
  ok: boolean
  error?: string
}

function emptyData(): CultivationStorageData {
  return { version: CULTIVATION_STORAGE_VERSION, villages: {} }
}

function resolveStorage(storage?: Storage): Storage {
  if (storage) return storage
  if (typeof window === 'undefined') throw new Error('当前环境没有 localStorage')
  return window.localStorage
}

function readData(storage: Storage): CultivationStorageData {
  try {
    const value = storage.getItem(CULTIVATION_STORAGE_KEY)
    if (!value) return emptyData()
    const parsed = JSON.parse(value) as CultivationStorageData
    if (parsed.version !== CULTIVATION_STORAGE_VERSION || !parsed.villages || Array.isArray(parsed.villages)) return emptyData()
    return parsed
  } catch {
    return emptyData()
  }
}

function writeData(storage: Storage, data: CultivationStorageData): CultivationStorageResult {
  try {
    storage.setItem(CULTIVATION_STORAGE_KEY, JSON.stringify(data))
    return { ok: true }
  } catch (error) {
    return { ok: false, error: `种植档案保存失败：${error instanceof Error ? error.message : '存储不可用'}` }
  }
}

function bucket(data: CultivationStorageData, villageCode: string): VillageCultivationBucket {
  return data.villages[villageCode] ?? { overrides: {}, additions: {} }
}

export function readEffectiveCultivation(villageCode: string, parcelId: string, initialRecords: CultivationRecord[], storage?: Storage): CultivationRecord[] {
  const data = readData(resolveStorage(storage))
  const current = bucket(data, villageCode)
  const initial = initialRecords.filter((record) => record.villageCode === villageCode && record.parcelId === parcelId)
  const result = initial.map((record) => current.overrides[cultivationKey(record)] ?? record)
  result.push(...Object.values(current.additions).filter((record) => record.villageCode === villageCode && record.parcelId === parcelId))
  return result.sort((a, b) => a.year - b.year || a.startDate.localeCompare(b.startDate) || a.season.localeCompare(b.season))
}

export function saveCultivationOverride(villageCode: string, record: CultivationRecord, initialRecords: CultivationRecord[], storage?: Storage): CultivationStorageResult {
  if (record.villageCode !== villageCode) return { ok: false, error: '村代码不匹配' }
  if (!initialRecords.some((initial) => cultivationKey(initial) === cultivationKey(record))) return { ok: false, error: '只能覆盖初始档案，新增请使用 addCultivationRecord' }
  const validation = validateCultivationRecords(readEffectiveCultivation(villageCode, record.parcelId, initialRecords, storage).map((item) => cultivationKey(item) === cultivationKey(record) ? record : item))
  if (!validation.valid) return { ok: false, error: validation.errors.join('；') }
  const resolved = resolveStorage(storage)
  const data = readData(resolved)
  const current = bucket(data, villageCode)
  data.villages[villageCode] = { ...current, overrides: { ...current.overrides, [cultivationKey(record)]: record } }
  return writeData(resolved, data)
}

export function addCultivationRecord(villageCode: string, record: CultivationRecord, initialRecords: CultivationRecord[], storage?: Storage): CultivationStorageResult {
  if (record.villageCode !== villageCode) return { ok: false, error: '村代码不匹配' }
  const effective = readEffectiveCultivation(villageCode, record.parcelId, initialRecords, storage)
  if (effective.some((item) => cultivationKey(item) === cultivationKey(record))) return { ok: false, error: '同一地块年度和季节只能有一条档案' }
  const validation = validateCultivationRecords([...effective, record])
  if (!validation.valid) return { ok: false, error: validation.errors.join('；') }
  const resolved = resolveStorage(storage)
  const data = readData(resolved)
  const current = bucket(data, villageCode)
  data.villages[villageCode] = { ...current, additions: { ...current.additions, [cultivationKey(record)]: record } }
  return writeData(resolved, data)
}

export function removeAddedCultivation(villageCode: string, record: Pick<CultivationRecord, 'parcelId' | 'year' | 'season'>, storage?: Storage): CultivationStorageResult {
  const resolved = resolveStorage(storage)
  const data = readData(resolved)
  const current = bucket(data, villageCode)
  const additions = { ...current.additions }
  delete additions[cultivationKey({ villageCode, ...record })]
  data.villages[villageCode] = { ...current, additions }
  return writeData(resolved, data)
}

export function restoreInitialCultivation(villageCode: string, parcelId: string, storage?: Storage): CultivationStorageResult {
  const resolved = resolveStorage(storage)
  const data = readData(resolved)
  const current = bucket(data, villageCode)
  const filterParcel = (records: Record<string, CultivationRecord>) => Object.fromEntries(Object.entries(records).filter(([, record]) => record.parcelId !== parcelId))
  data.villages[villageCode] = { overrides: filterParcel(current.overrides), additions: filterParcel(current.additions) }
  return writeData(resolved, data)
}

export const removeCultivationForParcel = restoreInitialCultivation
export { CULTIVATION_STORAGE_KEY }
