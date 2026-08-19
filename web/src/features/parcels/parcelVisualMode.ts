import type L from 'leaflet'
import type { CultivationRecord } from '../policy/cultivationState'
import type { PolicyFixture, PolicyInsuredMode } from '../policy/policyTypes'

/** 图层模式：地块（默认 V1） / 种植着色 / 保险着色 */
export type ParcelVisualMode = 'parcel' | 'planting' | 'insurance'

export interface LegendEntry {
  color: string
  borderColor: string
  label: string
  /** 分类键，用于与 enabledCategories Set 匹配 */
  key: string
}

const CHOROPLETH_COMMON: Pick<L.PathOptions, 'weight' | 'opacity' | 'fillOpacity'> = {
  weight: 1.5,
  opacity: 0.9,
  fillOpacity: 0.30,
}

/* ────────────────────────────────────────────
 * 种植分类（Spec §3.2）
 * ──────────────────────────────────────────── */

/** 种植图层子分类键（与 CultivationRecord.crop 映射） */
export const PLANTING_CATEGORIES = ['水稻', '小麦', '玉米', '其他', '当前未种植'] as const
export type PlantingCategory = typeof PLANTING_CATEGORIES[number]

const PLANTING_COLORS: Record<string, { fillColor: string; color: string }> = {
  '水稻': { fillColor: '#4ade80', color: '#16a34a' },
  '小麦': { fillColor: '#fbbf24', color: '#b45309' },
  '玉米': { fillColor: '#fb923c', color: '#c2410c' },
  '其他': { fillColor: '#a3e635', color: '#65a30d' },
  '当前未种植': { fillColor: '#e2e8f0', color: '#94a3b8' },
}

function cropCategory(crop: string): PlantingCategory {
  if (crop.includes('水稻') || crop.includes('稻')) return '水稻'
  if (crop.includes('麦')) return '小麦'
  if (crop.includes('玉米')) return '玉米'
  return '其他'
}

/**
 * 种植着色样式。
 * @param enabledCategories 当前启用的分类集合；不在其中的分类返回 null（回退默认蓝）。
 */
export function plantingParcelStyle(
  parcelId: string,
  cultivationByParcelId: Map<string, CultivationRecord>,
  enabledCategories: ReadonlySet<string>,
): L.PathOptions | null {
  const record = cultivationByParcelId.get(parcelId)
  const category: PlantingCategory = record ? cropCategory(record.crop) : '当前未种植'
  if (!enabledCategories.has(category)) return null
  const palette = PLANTING_COLORS[category]
  return { ...CHOROPLETH_COMMON, color: palette.color, fillColor: palette.fillColor }
}

export function buildCultivationLookup(
  records: CultivationRecord[],
): Map<string, CultivationRecord> {
  const map = new Map<string, CultivationRecord>()
  for (const record of records) {
    if (!map.has(record.parcelId)) map.set(record.parcelId, record)
  }
  return map
}

/* ────────────────────────────────────────────
 * 保险分类（Spec §3.3）
 * ──────────────────────────────────────────── */

export const INSURANCE_CATEGORIES = ['大户', '团单', '未参保'] as const
export type InsuranceCategory = typeof INSURANCE_CATEGORIES[number]

const INSURANCE_COLORS: Record<string, { fillColor: string; color: string }> = {
  '大户': { fillColor: '#4ade80', color: '#16a34a' },
  '团单': { fillColor: '#c4b5fd', color: '#8b5cf6' },
  '未参保': { fillColor: '#cbd5e1', color: '#94a3b8' },
}

function insuredModeCategory(mode: PolicyInsuredMode | null | undefined): InsuranceCategory {
  if (mode === 'single_insured') return '大户'
  if (mode === 'insured_roster') return '团单'
  return '未参保'
}

/**
 * 保险着色样式。
 * @param enabledCategories 当前启用的分类集合；不在其中的分类返回 null。
 */
export function insuranceParcelStyle(
  parcelId: string,
  insuranceByParcelId: Map<string, PolicyInsuredMode | null>,
  enabledCategories: ReadonlySet<string>,
): L.PathOptions | null {
  const mode = insuranceByParcelId.get(parcelId)
  const category = insuredModeCategory(mode)
  if (!enabledCategories.has(category)) return null
  const palette = INSURANCE_COLORS[category]
  return { ...CHOROPLETH_COMMON, color: palette.color, fillColor: palette.fillColor }
}

export function buildInsuranceLookup(
  fixture: PolicyFixture,
): Map<string, PolicyInsuredMode | null> {
  const map = new Map<string, PolicyInsuredMode | null>()
  for (const coverage of fixture.parcelCoverages) {
    if (map.has(coverage.parcelId)) continue
    const policy = fixture.policies.find((p) => p.id === coverage.policyId)
    if (policy && (policy.status === '保障中' || policy.status === '待生效')) {
      map.set(coverage.parcelId, policy.insuredMode)
    }
  }
  return map
}

/* ────────────────────────────────────────────
 * 图例数据（Spec §4）— 仅返回 enabled 的分类
 * ──────────────────────────────────────────── */

/**
 * 种植图例 — 始终返回全部分类（取消勾选的项以 disabled 视觉呈现，不消失）。
 */
export function plantingLegend(): LegendEntry[] {
  return PLANTING_CATEGORIES.map((category) => ({
    key: category,
    label: category,
    color: PLANTING_COLORS[category].fillColor,
    borderColor: PLANTING_COLORS[category].color,
  }))
}

export function insuranceLegend(): LegendEntry[] {
  return INSURANCE_CATEGORIES.map((category) => ({
    key: category,
    label: category,
    color: INSURANCE_COLORS[category].fillColor,
    borderColor: INSURANCE_COLORS[category].color,
  }))
}

/* ────────────────────────────────────────────
 * 数据可用性检测（Spec §11/§12）
 * ──────────────────────────────────────────── */

export function isCultivationEmpty(
  cultivationByParcelId: Map<string, CultivationRecord>,
): boolean {
  return cultivationByParcelId.size === 0
}

export function isInsuranceEmpty(
  insuranceByParcelId: Map<string, PolicyInsuredMode | null>,
): boolean {
  return insuranceByParcelId.size === 0
}
