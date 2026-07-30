import type { Feature, Polygon } from 'geojson'
import { prepareManualGeometry, type PreparedManualGeometry } from './parcelGeometry'

export const MANUAL_PARCEL_STORAGE_KEY = 'agri-map:manual-parcels:v1'
export const MANUAL_PARCEL_NOTICE_KEY = 'agri-map:manual-parcels:notice:v1'

export interface ManualParcelProperties {
  id: string
  village_code: string
  source: 'manual'
  area_m2: number
  area_mu: number
  label_lng: number
  label_lat: number
  created_at: string
  updated_at: string
}

export type ManualParcelFeature = Feature<Polygon, ManualParcelProperties>

interface ManualParcelStorage {
  version: 1
  villages: Record<string, ManualParcelFeature[]>
}

export interface ManualParcelReadResult {
  features: ManualParcelFeature[]
  error?: string
}

function emptyStorage(): ManualParcelStorage {
  return { version: 1, villages: {} }
}

function isManualFeature(value: unknown, villageCode: string): value is ManualParcelFeature {
  if (!value || typeof value !== 'object') return false
  const feature = value as Partial<ManualParcelFeature>
  const properties = feature.properties as Partial<ManualParcelProperties> | undefined
  const rings = feature.geometry?.type === 'Polygon' ? feature.geometry.coordinates : undefined
  const points = rings?.[0]
  const closed = Array.isArray(points)
    && points.length >= 4
    && points[0]?.[0] === points[points.length - 1]?.[0]
    && points[0]?.[1] === points[points.length - 1]?.[1]
  return feature.type === 'Feature'
    && feature.geometry?.type === 'Polygon'
    && Array.isArray(rings)
    && rings.length === 1
    && closed
    && Boolean(prepareManualGeometry(points.slice(0, -1)).prepared)
    && properties?.source === 'manual'
    && properties.village_code === villageCode
    && typeof properties.id === 'string'
    && Number.isFinite(properties.area_m2)
    && Number.isFinite(properties.area_mu)
    && Number.isFinite(properties.label_lng)
    && Number.isFinite(properties.label_lat)
    && typeof properties.created_at === 'string'
    && typeof properties.updated_at === 'string'
}

function browserStorage(storage?: Storage): Storage | null {
  if (storage) return storage
  try {
    return window.localStorage
  } catch {
    return null
  }
}

function parseStorage(storage: Storage): { data?: ManualParcelStorage; error?: string } {
  try {
    const raw = storage.getItem(MANUAL_PARCEL_STORAGE_KEY)
    if (!raw) return { data: emptyStorage() }
    const parsed = JSON.parse(raw) as Partial<ManualParcelStorage>
    if (parsed.version !== 1 || !parsed.villages || typeof parsed.villages !== 'object' || Array.isArray(parsed.villages)) {
      return { error: '本机人工地块数据版本不兼容，已停止写入以保护原记录。' }
    }
    return { data: parsed as ManualParcelStorage }
  } catch {
    return { error: '无法读取本机人工地块数据，已停止写入以保护原记录。' }
  }
}

export function readManualParcels(villageCode: string, storage?: Storage): ManualParcelReadResult {
  const resolved = browserStorage(storage)
  if (!resolved) return { features: [], error: '当前浏览器不允许访问本机存储，人工地块无法读取或保存。' }
  const parsed = parseStorage(resolved)
  if (!parsed.data) return { features: [], error: parsed.error }
  const records = parsed.data.villages[villageCode]
  if (!Array.isArray(records)) return { features: [] }
  const features = records.filter((feature) => isManualFeature(feature, villageCode))
  return {
    features,
    error: features.length === records.length ? undefined : '部分本机人工地块记录无效，已跳过显示。',
  }
}

export function writeManualParcels(
  villageCode: string,
  features: ManualParcelFeature[],
  storage?: Storage,
): { ok: true } | { ok: false; error: string } {
  const resolved = browserStorage(storage)
  if (!resolved) return { ok: false, error: '当前浏览器不允许访问本机存储，无法保存人工地块。' }
  const parsed = parseStorage(resolved)
  if (!parsed.data) return { ok: false, error: parsed.error ?? '无法读取本机人工地块。' }
  try {
    if (features.length) parsed.data.villages[villageCode] = features
    else delete parsed.data.villages[villageCode]
    resolved.setItem(MANUAL_PARCEL_STORAGE_KEY, JSON.stringify(parsed.data))
    return { ok: true }
  } catch {
    return { ok: false, error: '保存失败，请检查浏览器是否允许本地存储或存储空间是否充足。' }
  }
}

function createId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') return `manual-${crypto.randomUUID()}`
  return `manual-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`
}

export function makeManualParcel(
  villageCode: string,
  prepared: PreparedManualGeometry,
  previous?: ManualParcelFeature,
  now = new Date().toISOString(),
): ManualParcelFeature {
  return {
    type: 'Feature',
    geometry: prepared.geometry,
    properties: {
      id: previous?.properties.id ?? createId(),
      village_code: villageCode,
      source: 'manual',
      area_m2: prepared.areaM2,
      area_mu: prepared.areaMu,
      label_lng: prepared.labelLng,
      label_lat: prepared.labelLat,
      created_at: previous?.properties.created_at ?? now,
      updated_at: now,
    },
  }
}
