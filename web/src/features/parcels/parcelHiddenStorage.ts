import type { ParcelId } from './parcelTypes'

const PARCEL_STORAGE_KEY = 'agri-map:parcel-edits:v1'
const PARCEL_DATASET_VERSION = '2025-04-02-v1'

interface ParcelEditRecord {
  datasetVersion: string
  hiddenIds: ParcelId[]
}

interface ParcelEditStorage {
  version: 1
  villages: Record<string, ParcelEditRecord>
}

function resolveStorage(storage?: Storage): Storage {
  return storage ?? window.localStorage
}

function readParcelStorage(storage?: Storage): ParcelEditStorage {
  try {
    const parsed = JSON.parse(resolveStorage(storage).getItem(PARCEL_STORAGE_KEY) ?? '') as ParcelEditStorage
    if (parsed.version === 1 && parsed.villages && typeof parsed.villages === 'object') return parsed
  } catch {
    // localStorage 不可用或旧数据损坏时按空记录处理，不影响地图展示。
  }
  return { version: 1, villages: {} }
}

export function loadHiddenParcelIds(villageCode: string, storage?: Storage): Set<ParcelId> {
  const record = readParcelStorage(storage).villages[villageCode]
  if (!record || record.datasetVersion !== PARCEL_DATASET_VERSION || !Array.isArray(record.hiddenIds)) {
    return new Set()
  }
  return new Set(record.hiddenIds.map(String))
}

export function persistHiddenParcelIds(villageCode: string, ids: Set<ParcelId>, storage?: Storage): boolean {
  try {
    const resolved = resolveStorage(storage)
    const data = readParcelStorage(resolved)
    if (ids.size) {
      data.villages[villageCode] = {
        datasetVersion: PARCEL_DATASET_VERSION,
        hiddenIds: [...ids].sort((a, b) => a.localeCompare(b, undefined, { numeric: true })),
      }
    } else {
      delete data.villages[villageCode]
    }
    resolved.setItem(PARCEL_STORAGE_KEY, JSON.stringify(data))
    return true
  } catch {
    return false
  }
}
