import { ref, watch, type Ref } from 'vue'
import L from 'leaflet'
import type { Feature, FeatureCollection } from 'geojson'
import type { useDrilldownStore } from '../../stores/drilldown'
import type { Level } from '../../stores/drilldown'
import { NEXT_LEVEL } from '../../stores/drilldown'
import { createChoroplethLayerController, type ChoroplethLayerController, type ChoroplethEntry } from '../../map/lodgingChoroplethController'
import {
  computeDamageRate,
  computeCompensation,
  type LodgingSignals,
  type ParcelDamage,
  type DamageRate,
} from '../../features/lodging/lodgingCalc'
import { getDemoDamageForParcel, getVillageParcelDamageRate } from './lodgingDemoData'
import type { LodgingOverviewModel, LodgingOverviewItem } from '../../components/lodging/LodgingAssessmentOverview.vue'
import type { ParcelRowData } from '../../components/lodging/LodgingParcelDrawer.vue'
import { fetchJSON } from '../../api/data'
import { childrenUrl } from '../../stores/drilldown'
import { loadInsuredVillages, townshipFileOf, type VillageBoundary } from '../village-risk/villageRiskData'
import { loadPolicyFixture } from '../policy/policyRepository'
import { INSURED_VILLAGE_CODES } from '../village-risk/villageRiskData'

/**
 * 水稻倒伏评估模式（需求 §3）
 */

export interface LodgingModeContext {
  store: ReturnType<typeof useDrilldownStore>
  anyWeatherActive(): boolean
  disasterActive: Ref<boolean>
  exits: {
    weather(): void
    nationalAlarms(): void
    typhoon(): void
    precipitation(): void
  }
  resetToProvince(): Promise<boolean>
  render(): Promise<void>
  showToast(message: string): void
  /** 村级视图中点击地块时回调，用于打开地块详情弹窗 */
  onLodgingParcelClick?(parcelId: string): void
}

export interface LodgingWeatherSignals {
  typhoonDistanceKm: number | null
  precipPeakMm: number
  windLevel: number
}

export interface LodgingAssessmentMode {
  init(map: L.Map): void
  destroy(): void
  enterAssessmentMode(): Promise<void>
  exitAssessmentMode(): void
  toggleDemoMode(): void
  isActive: Ref<boolean>
  isDemoMode: Ref<boolean>
  isLoading: Ref<boolean>
  overviewModel: Ref<LodgingOverviewModel | null>
  entryDisabled: Ref<boolean>
  entryReason: Ref<string>
  parcelDrawerRows: Ref<ParcelRowData[]>
  getChildFeature(code: string): Feature | null
  selectParcel(parcelId: string): void
}

// ========== 区划代码匹配工具 ==========

/** 子层级 */
function getChildLevel(level: Level): Level | null {
  return NEXT_LEVEL[level]
}

/**
 * 判断一个 villageCode 是否属于某个区划 feature code（根据子层级）。
 *
 * 行政区划代码格式：
 * - 市级 GeoJSON: 6 位（如 330600），前 4 位有意义，后 2 位 "00"
 * - 县级 GeoJSON: 6 位（如 330604），全部有意义
 * - 乡镇级 GeoJSON: 12 位（如 330604104000），前 9 位有意义，后 3 位 "000"
 * - 村级 GeoJSON: 12 位（如 330604102014），全部有意义
 *
 * villageCode 是 12 位。匹配规则：
 * - city 子层级: villageCode 前 4 位 = featureCode 前 4 位
 * - county 子层级: villageCode 前 6 位 = featureCode
 * - township 子层级: 通过 townshipFileOf 反查
 * - village 子层级: villageCode = featureCode
 */
function villageMatchesFeature(villageCode: string, featureCode: string, childLevel: Level): boolean {
  switch (childLevel) {
    case 'city':
      // city feature "330600" → villageCode starts with "3306"
      return villageCode.startsWith(featureCode.slice(0, 4))
    case 'county':
      // county feature "330604" → villageCode starts with "330604"
      return villageCode.startsWith(featureCode)
    case 'township': {
      // township feature "330604104000" → need reverse lookup
      const file = townshipFileOf(villageCode)
      if (!file) return false
      // Extract township code from file path: '/data/villages/330604104000.geojson' → '330604104000'
      const match = file.match(/\/(\d+)\.geojson$/)
      if (!match) return false
      return match[1] === featureCode
    }
    case 'village':
      return villageCode === featureCode
    default:
      return false
  }
}

/**
 * 获取 villageCode 在子层级对应的区划代码。
 * 用于 DEMO_DAMAGE_MAP 查找和概览聚合。
 */
function getRegionCodeForVillage(villageCode: string, childLevel: Level): string {
  switch (childLevel) {
    case 'city':
      return villageCode.slice(0, 4) + '00'   // e.g. "330600"
    case 'county':
      return villageCode.slice(0, 6)           // e.g. "330604"
    case 'township': {
      const file = townshipFileOf(villageCode)
      if (!file) return ''
      const match = file.match(/\/(\d+)\.geojson$/)
      return match ? match[1] : ''             // e.g. "330604104000"
    }
    case 'village':
      return villageCode
    default:
      return ''
  }
}

/**
 * 将 parcels 按子层级聚合到 feature code 级别。
 * 返回 Map<featureCode, { maxDamageRate, totalDamagedAreaMu, totalCompensation, householdCount }>
 */
function aggregateParcelsByFeatures(
  parcels: ParcelDamage[],
  childLevel: Level,
): Map<string, { maxDamageRate: DamageRate; totalDamagedAreaMu: number; damagedAreaMu: number; totalCompensation: number; householdCount: number }> {
  const groups = new Map<string, { maxDamageRate: DamageRate; totalDamagedAreaMu: number; damagedAreaMu: number; totalCompensation: number; householdCount: number }>()

  for (const parcel of parcels) {
    const regionCode = getRegionCodeForVillage(parcel.villageCode, childLevel)
    if (!regionCode) continue

    const comp = computeCompensation(parcel.areaMu, parcel.sumInsured, parcel.damageRate)

    let group = groups.get(regionCode)
    if (!group) {
      group = { maxDamageRate: 0, totalDamagedAreaMu: 0, damagedAreaMu: 0, totalCompensation: 0, householdCount: 0 }
      groups.set(regionCode, group)
    }
    group.totalDamagedAreaMu += parcel.areaMu
    group.totalCompensation += comp
    if (parcel.damageRate > 0) {
      group.damagedAreaMu += parcel.areaMu
      group.householdCount += 1
    }
    group.maxDamageRate = Math.max(group.maxDamageRate, parcel.damageRate) as DamageRate
  }

  return groups
}

// ========== 主 composable ==========

/** 每个村最多加载的地块数（演示模式限制，避免渲染过多地块） */
const MAX_PARCELS_PER_VILLAGE = 400

export function useLodgingAssessmentMode(ctx: LodgingModeContext): LodgingAssessmentMode {
  const isActive = ref(false)
  const isDemoMode = ref(true)
  const isLoading = ref(false)
  const overviewModel = ref<LodgingOverviewModel | null>(null)
  const entryDisabled = ref(false)
  const entryReason = ref('')
  const parcelDrawerRows = ref<ParcelRowData[]>([])

  let map: L.Map | null = null
  let choroplethController: ChoroplethLayerController | null = null
  let parcelDamages: ParcelDamage[] = []
  let villageBoundaries: VillageBoundary[] = []
  let adminNameMap = new Map<string, string>()
  let partyNameByParcelId = new Map<string, string>()
  let evaluatedAt: string | null = null
  const childFeatureMap = new Map<string, Feature>()

  /** 加载行政边界名称（加载所有层级的所有可用文件） */
  async function loadAdminNames(): Promise<Map<string, string>> {
    const nameMap = new Map<string, string>()
    nameMap.set('330000', '浙江省')

    // 加载所有城市的边界数据（用于省级视图名称 + 所有市级名称）
    const cityCodes: string[] = []
    try {
      const cityFc = await fetchJSON<FeatureCollection>('/data/boundary/city/330000.geojson')
      for (const f of cityFc.features) {
        const code = String(f.properties?.code ?? '')
        const name = String(f.properties?.name ?? '')
        if (code && name) {
          nameMap.set(code, name)
          cityCodes.push(code)
        }
      }
    } catch { /* ignore */ }

    // 加载所有城市下的县级数据
    const countyCodes: string[] = []
    for (const cityCode of cityCodes) {
      try {
        const countyFc = await fetchJSON<FeatureCollection>(`/data/boundary/county/${cityCode}.geojson`)
        for (const f of countyFc.features) {
          const code = String(f.properties?.code ?? '')
          const name = String(f.properties?.name ?? '')
          if (code && name) {
            nameMap.set(code, name)
            countyCodes.push(code)
          }
        }
      } catch { /* ignore */ }
    }

    // 加载有参保村的县级下的乡镇数据
    // 从参保村的 countyCode 去重
    const countiesWithVillages = new Set<string>()
    for (const code of INSURED_VILLAGE_CODES) {
      countiesWithVillages.add(code.slice(0, 6))
    }
    for (const countyCode of countiesWithVillages) {
      try {
        const townshipFc = await fetchJSON<FeatureCollection>(`/data/boundary/township/${countyCode}.geojson`)
        for (const f of townshipFc.features) {
          const code = String(f.properties?.code ?? '')
          const name = String(f.properties?.name ?? '')
          if (code && name) nameMap.set(code, name)
        }
      } catch { /* ignore */ }
    }

    // 村级：从村界数据中提取
    for (const v of villageBoundaries) {
      nameMap.set(v.code, v.name)
    }

    return nameMap
  }

  function getAdminName(code: string): string {
    return adminNameMap.get(code) ?? code
  }

  /** 加载所有 13 村保单数据，计算每个地块的受损率 */
  async function loadAllData(signals: LodgingSignals): Promise<{
    parcels: ParcelDamage[]
    villages: VillageBoundary[]
    partyNames: Map<string, string>
  }> {
    const villageCodesToLoad = [...INSURED_VILLAGE_CODES]

    const villages = await loadInsuredVillages()

    const fixtureResults = await Promise.all(
      villageCodesToLoad.map(async (code) => {
        const result = await loadPolicyFixture(code)
        return { code, fixture: result.data }
      })
    )

    const parcels: ParcelDamage[] = []
    const partyNames = new Map<string, string>()

    for (const { code, fixture } of fixtureResults) {
      if (!fixture) continue

      const policyMap = new Map<string, { unitSumInsured: number; status: string }>()
      for (const policy of fixture.policies) {
        policyMap.set(policy.id, {
          unitSumInsured: policy.unitSumInsuredCentsPerMu / 100,
          status: policy.status,
        })
      }

      const partyMap = new Map<string, string>()
      for (const party of fixture.parties) {
        partyMap.set(party.id, party.name)
      }

      // 限制每村最多加载 MAX_PARCELS_PER_VILLAGE 个地块（演示数据量控制）
      let parcelCount = 0
      for (const coverage of fixture.parcelCoverages) {
        if (parcelCount >= MAX_PARCELS_PER_VILLAGE) break
        const policyInfo = policyMap.get(coverage.policyId)
        if (!policyInfo || policyInfo.status !== '保障中') continue

        const partyName = partyMap.get(coverage.insuredPartyId) ?? ''
        if (partyName) partyNames.set(coverage.parcelId, partyName)

        // 演示模式：用 DEMO_DAMAGE_MAP 按区域匹配；村级使用差异化受损率
        let damageRate: DamageRate
        if (isDemoMode.value) {
          if (ctx.store.current.level === 'village') {
            const villageRate = getDemoDamageForParcel(code, 'township')
            damageRate = getVillageParcelDamageRate(villageRate, coverage.parcelId)
          } else {
            damageRate = getDemoDamageForParcel(code, ctx.store.current.level)
          }
        } else {
          damageRate = computeDamageRate(signals)
        }

        parcels.push({
          parcelId: coverage.parcelId,
          villageCode: code,
          areaMu: Number(coverage.insuredAreaMu),
          sumInsured: policyInfo.unitSumInsured,
          damageRate,
        })
        parcelCount++
      }
    }

    return { parcels, villages, partyNames }
  }

  /** 根据当前 drilldown 层级过滤地块到当前视图范围 */
  function filterParcelsToScope(parcels: ParcelDamage[]): ParcelDamage[] {
    const level = ctx.store.current.level
    const code = ctx.store.current.code
    switch (level) {
      case 'province':
        return parcels
      case 'city':
        return parcels.filter(p => p.villageCode.startsWith(code.slice(0, 4)))
      case 'county':
        return parcels.filter(p => p.villageCode.startsWith(code))
      case 'township':
        return parcels.filter(p => {
          const file = townshipFileOf(p.villageCode)
          if (!file) return false
          const match = file.match(/\/(\d+)\.geojson$/)
          return match !== null && match[1] === code
        })
      case 'village':
        return parcels.filter(p => p.villageCode === code)
    }
  }

  /** 构建概览卡片模型 */
  function buildOverviewModel(
    parcels: ParcelDamage[],
    currentLevelName: string,
    isVillageLevel: boolean
  ): LodgingOverviewModel {
    const level = ctx.store.current.level

    // 过滤到当前视图范围
    const relevantParcels = filterParcelsToScope(parcels)

    // 总计（当前视图范围）
    let totalDamagedAreaMu = 0
    let totalHouseholdCount = 0
    let totalCompensation = 0
    for (const p of relevantParcels) {
      if (p.damageRate > 0) {
        totalDamagedAreaMu += p.areaMu
        totalHouseholdCount += 1
      }
      totalCompensation += computeCompensation(p.areaMu, p.sumInsured, p.damageRate)
    }

    // Top N：按子级聚合
    let topItems: LodgingOverviewItem[] = []

    if (!isVillageLevel) {
      const childLevel = getChildLevel(level)
      if (childLevel) {
        const groups = aggregateParcelsByFeatures(relevantParcels, childLevel)
        const sorted = [...groups.entries()]
          .filter(([, g]) => g.maxDamageRate > 0)
          .sort(([, a], [, b]) => b.totalCompensation - a.totalCompensation)

        topItems = sorted.slice(0, 3).map(([code, g]) => ({
          code,
          name: getAdminName(code),
          damageRate: g.maxDamageRate,
          areaMu: Math.round(g.damagedAreaMu * 100) / 100,
          compensation: Math.round(g.totalCompensation * 100) / 100,
        }))
      }
    } else {
      // 村级：Top 10 地块
      const sorted = [...relevantParcels]
        .filter(p => p.damageRate > 0)
        .sort((a, b) => computeCompensation(b.areaMu, b.sumInsured, b.damageRate) - computeCompensation(a.areaMu, a.sumInsured, a.damageRate))
      topItems = sorted.slice(0, 10).map(p => ({
        code: p.parcelId,
        name: '地块#' + p.parcelId,
        damageRate: p.damageRate,
        areaMu: p.areaMu,
        compensation: computeCompensation(p.areaMu, p.sumInsured, p.damageRate),
      }))
    }

    return {
      currentLevelName,
      isVillageLevel,
      totalDamagedAreaMu: Math.round(totalDamagedAreaMu * 100) / 100,
      totalHouseholdCount,
      totalCompensation: Math.round(totalCompensation * 100) / 100,
      totalParcelCount: relevantParcels.length,
      topItems,
      evaluatedAt: evaluatedAt ?? '',
      isDemoMode: isDemoMode.value,
    }
  }

  /** 构建地块抽屉数据 */
  function buildParcelDrawerRows(parcelDamages: ParcelDamage[]): ParcelRowData[] {
    if (ctx.store.current.level !== 'village') return []
    const villageCode = ctx.store.current.code
    return parcelDamages
      .filter(p => p.villageCode === villageCode)
      .map(p => ({
        parcelId: p.parcelId,
        damageRate: p.damageRate,
        areaMu: p.areaMu,
        compensation: computeCompensation(p.areaMu, p.sumInsured, p.damageRate),
        insuredName: partyNameByParcelId.get(p.parcelId) ?? '',
      }))
  }

  /** 构建 ChoroplethEntry[] */
  async function buildChoroplethEntries(
    parcels: ParcelDamage[],
  ): Promise<ChoroplethEntry[]> {
    const level = ctx.store.current.level
    childFeatureMap.clear()

    // 村级视图：地块级填色
    if (level === 'village') {
      const villageCode = ctx.store.current.code
      try {
        const parcelFc = await fetchJSON<FeatureCollection>(
          `/data/parcels/${villageCode}.geojson`
        )
        if (!parcelFc) return []

        const damageByParcelId = new Map<string, DamageRate>()
        for (const p of parcels) {
          if (p.villageCode === villageCode) {
            damageByParcelId.set(p.parcelId, p.damageRate)
          }
        }

        const entries: ChoroplethEntry[] = []
        for (const feature of parcelFc.features) {
          const parcelId = String(feature.properties?.id ?? feature.properties?.parcelId ?? '')
          const damageRate = damageByParcelId.get(parcelId) ?? 0
          if (damageRate === 0 || !feature.geometry) continue

          entries.push({
            code: parcelId,
            name: '地块#' + parcelId,
            damageRate,
            geometry: feature.geometry,
          })
          childFeatureMap.set(parcelId, feature as Feature)
        }
        return entries
      } catch {
        return []
      }
    }

    // 非村级：加载子区划边界 GeoJSON
    const crumb = ctx.store.current
    const url = childrenUrl(crumb)
    if (!url) return []

    let fc: FeatureCollection
    try {
      fc = await fetchJSON<FeatureCollection>(url)
    } catch {
      return []
    }

    const childLevel = getChildLevel(level)
    if (!childLevel) return []

    // 对每个 GeoJSON feature，找到属于它的 parcels，计算最大受损率
    const entries: ChoroplethEntry[] = []
    for (const feature of fc.features) {
      const code = String(feature.properties?.code ?? '')
      const name = String(feature.properties?.name ?? code)
      if (!code || !feature.geometry) continue

      // 找到属于这个区划的所有 parcels
      const matchingParcels = parcels.filter(p =>
        villageMatchesFeature(p.villageCode, code, childLevel)
      )

      if (matchingParcels.length === 0) continue

      // 计算该区划的最大受损率
      let maxDamageRate: DamageRate = 0
      for (const p of matchingParcels) {
        if (p.damageRate > maxDamageRate) {
          maxDamageRate = p.damageRate
        }
      }

      if (maxDamageRate === 0) continue

      entries.push({ code, name, damageRate: maxDamageRate, geometry: feature.geometry })
      childFeatureMap.set(code, feature as Feature)
    }

    return entries
  }

  async function renderChoropleth(parcelDamages: ParcelDamage[]) {
    if (!choroplethController) return
    const entries = await buildChoroplethEntries(parcelDamages)
    choroplethController.setData(entries)
    choroplethController.setVisible(true)
  }

  async function runAssessment() {
    isLoading.value = true
    try {
      const signals: LodgingSignals = isDemoMode.value
        ? { precip: 80, wind: 8, typhoon: 150 }
        : { precip: 80, wind: 8, typhoon: 150 } // TODO: 接入真实信号

      const now = new Date()
      evaluatedAt = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')} ${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`

      const { parcels, villages, partyNames } = await loadAllData(signals)
      parcelDamages = parcels
      villageBoundaries = villages
      partyNameByParcelId = partyNames

      adminNameMap = await loadAdminNames()

      await renderChoropleth(parcelDamages)

      const currentLevelName = ctx.store.current.name
      const isVillageLevel = ctx.store.current.level === 'village'
      overviewModel.value = buildOverviewModel(parcelDamages, currentLevelName, isVillageLevel)

      parcelDrawerRows.value = buildParcelDrawerRows(parcelDamages)

      return true
    } finally {
      isLoading.value = false
    }
  }

  async function enterAssessmentMode() {
    if (isActive.value) return

    if (ctx.anyWeatherActive()) {
      ctx.exits.weather()
      ctx.exits.nationalAlarms()
    }
    if (ctx.disasterActive.value) {
      ctx.exits.typhoon()
    }

    await ctx.resetToProvince()

    if (map && !choroplethController) {
      choroplethController = createChoroplethLayerController({
        onRegionClick: (code) => {
          const level = ctx.store.current.level
          if (level === 'village') {
            // 村级视图：点击地块 → 打开地块详情弹窗
            ctx.onLodgingParcelClick?.(code)
            return
          }
          const nextLevel = NEXT_LEVEL[level]
          if (!nextLevel) return
          const name = getAdminName(code)
          const cachedFeature = childFeatureMap.get(code)
          if (cachedFeature) {
            void ctx.store.drill({
              level: nextLevel,
              code,
              name,
              geometry: cachedFeature.geometry,
            })
          }
        },
      })
      choroplethController.mount(map)
    }

    isActive.value = true
    await runAssessment()
  }

  function exitAssessmentMode() {
    if (!isActive.value) return

    choroplethController?.destroy()
    choroplethController = null
    parcelDamages = []
    villageBoundaries = []
    adminNameMap.clear()
    partyNameByParcelId.clear()
    childFeatureMap.clear()
    overviewModel.value = null
    parcelDrawerRows.value = []
    evaluatedAt = null
    isActive.value = false

    void ctx.resetToProvince().then(() => void ctx.render())
  }

  function toggleDemoMode() {
    isDemoMode.value = !isDemoMode.value
    if (isActive.value) {
      void runAssessment()
    }
  }

  function getChildFeature(code: string): Feature | null {
    return childFeatureMap.get(code) ?? null
  }

  function selectParcel(parcelId: string) {
    void parcelId
  }

  watch(
    () => ctx.store.current.level,
    async () => {
      if (isActive.value) {
        await runAssessment()
      }
    }
  )

  return {
    init(target: L.Map) { map = target },
    destroy() {
      choroplethController?.destroy()
      choroplethController = null
      map = null
    },
    enterAssessmentMode,
    exitAssessmentMode,
    toggleDemoMode,
    isActive,
    isDemoMode,
    isLoading,
    overviewModel,
    entryDisabled,
    entryReason,
    parcelDrawerRows,
    getChildFeature,
    selectParcel,
  }
}
