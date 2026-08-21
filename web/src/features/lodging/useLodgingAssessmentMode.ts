import { ref, watch, type Ref } from 'vue'
import L from 'leaflet'
import type { Feature, FeatureCollection } from 'geojson'
import type { useDrilldownStore } from '../../stores/drilldown'
import type { Level } from '../../stores/drilldown'
import { NEXT_LEVEL } from '../../stores/drilldown'
import { createChoroplethLayerController, type ChoroplethLayerController, type ChoroplethEntry } from '../../map/lodgingChoroplethController'
import {
  computeCompensation,
  computeRegionSeverity,
  parcelDamageSeverity,
  sortRegionResults,
  type ParcelDamage,
  type AggregatedResult,
  type RegionSeverity,
} from '../../features/lodging/lodgingCalc'
import { generateDemoDamageData, type ParcelCoverageInput } from './lodgingDemoData'
import type { LodgingOverviewModel, ParcelRow } from '../../components/lodging/LodgingAssessmentOverview.vue'
import type { RegionTableRow } from '../../components/lodging/LodgingRegionTable.vue'
import type { ParcelRowData } from '../../components/lodging/LodgingParcelDrawer.vue'
import { fetchJSON } from '../../api/data'
import { childrenUrl } from '../../stores/drilldown'
import { loadInsuredVillages, townshipFileOf, type VillageBoundary } from '../village-risk/villageRiskData'
import { loadPolicyFixture } from '../policy/policyRepository'
import { INSURED_VILLAGE_CODES } from '../village-risk/villageRiskData'

/**
 * 水稻倒伏评估模式（需求 §3，v2.0）
 *
 * v2.0 变更：
 * - 移除气象信号依赖
 * - 演示模式：调用 lodgingDamageGenerator 生成空间连片受灾数据
 * - 真实模式：无数据输入，展示空态
 * - 概览卡片改为 KPI + 区域统计表结构
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

function getChildLevel(level: Level): Level | null {
  return NEXT_LEVEL[level]
}

/**
 * 获取 villageCode 在子层级对应的区划代码。
 */
function getRegionCodeForVillage(villageCode: string, childLevel: Level): string {
  switch (childLevel) {
    case 'city':
      return villageCode.slice(0, 4) + '00'
    case 'county':
      return villageCode.slice(0, 6)
    case 'township': {
      const file = townshipFileOf(villageCode)
      if (!file) return ''
      const match = file.match(/\/(\d+)\.geojson$/)
      return match ? match[1] : ''
    }
    case 'village':
      return villageCode
    default:
      return ''
  }
}

// ========== 主 composable ==========

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
  let childFeatureMap = new Map<string, Feature>()

  /** 加载行政边界名称 */
  async function loadAdminNames(): Promise<Map<string, string>> {
    const nameMap = new Map<string, string>()
    nameMap.set('330000', '浙江省')

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

    for (const v of villageBoundaries) {
      nameMap.set(v.code, v.name)
    }

    return nameMap
  }

  function getAdminName(code: string): string {
    return adminNameMap.get(code) ?? code
  }

  /**
   * 加载所有 13 村保单数据，生成演示受灾数据。
   * v2.0：演示模式调用连片生成器；真实模式返回空数据。
   */
  async function loadAllData(): Promise<{
    parcels: ParcelDamage[]
    villages: VillageBoundary[]
    partyNames: Map<string, string>
  }> {
    const villageCodesToLoad = [...INSURED_VILLAGE_CODES]
    const villages = await loadInsuredVillages()

    // 加载保单数据
    const fixtureResults = await Promise.all(
      villageCodesToLoad.map(async (code) => {
        const result = await loadPolicyFixture(code)
        return { code, fixture: result.data }
      })
    )

    const partyNames = new Map<string, string>()
    const coveragesByVillage = new Map<string, ParcelCoverageInput[]>()

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

      const coverages: ParcelCoverageInput[] = []
      for (const coverage of fixture.parcelCoverages) {
        const policyInfo = policyMap.get(coverage.policyId)
        if (!policyInfo || policyInfo.status !== '保障中') continue

        const partyName = partyMap.get(coverage.insuredPartyId) ?? ''
        if (partyName) partyNames.set(coverage.parcelId, partyName)

        coverages.push({
          parcelId: coverage.parcelId,
          areaMu: Number(coverage.insuredAreaMu),
          sumInsured: policyInfo.unitSumInsured,
          insuredPartyId: coverage.insuredPartyId,
        })
      }
      if (coverages.length > 0) {
        coveragesByVillage.set(code, coverages)
      }
    }

    // 演示模式：调用连片生成器
    let parcels: ParcelDamage[] = []
    if (isDemoMode.value) {
      parcels = await generateDemoDamageData(villages, coveragesByVillage)
    }
    // 真实模式：parcels 为空（所有地块 damageAreaMu = 0 → 空态）

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

  /** 聚合 parcels 到子层级 feature code 级别，返回 AggregatedResult[] */
  function aggregateByFeatureCode(
    parcels: ParcelDamage[],
    childLevel: Level,
  ): AggregatedResult[] {
    interface GroupAccum {
      totalInsuredAreaMu: number
      totalCompensation: number
      damagedAreaMu: number
      householdIds: Set<string>
    }
    const groups = new Map<string, GroupAccum>()

    for (const parcel of parcels) {
      const regionCode = getRegionCodeForVillage(parcel.villageCode, childLevel)
      if (!regionCode) continue

      const damageRate = parcel.damageRate
      const comp = computeCompensation(parcel.damageAreaMu, parcel.sumInsured, damageRate)

      let group = groups.get(regionCode)
      if (!group) {
        group = { totalInsuredAreaMu: 0, totalCompensation: 0, damagedAreaMu: 0, householdIds: new Set() }
        groups.set(regionCode, group)
      }
      group.totalInsuredAreaMu += parcel.areaMu
      group.totalCompensation += comp
      group.damagedAreaMu += parcel.damageAreaMu
      if (parcel.damageAreaMu > 0 && parcel.insuredPartyId) {
        group.householdIds.add(parcel.insuredPartyId)
      }
    }

    return Array.from(groups.entries()).map(([code, g]) => {
      const regionDamageRate = g.totalInsuredAreaMu > 0
        ? Math.round((g.damagedAreaMu / g.totalInsuredAreaMu) * 10000) / 100
        : 0
      return {
        code,
        totalInsuredAreaMu: Math.round(g.totalInsuredAreaMu * 100) / 100,
        totalCompensation: Math.round(g.totalCompensation * 100) / 100,
        damagedAreaMu: Math.round(g.damagedAreaMu * 100) / 100,
        householdCount: g.householdIds.size,
        damageRate: regionDamageRate,
        severity: computeRegionSeverity(regionDamageRate),
      }
    })
  }

  /** 构建区域统计表行 */
  function buildRegionTableRows(aggregated: AggregatedResult[]): RegionTableRow[] {
    const sorted = sortRegionResults(aggregated, adminNameMap)
    return sorted.map((r) => ({
      code: r.code,
      name: getAdminName(r.code),
      severity: r.severity,
      damageRate: r.damageRate,
      damagedAreaMu: r.damagedAreaMu,
    }))
  }

  /** 构建地块列表行（村级） */
  function buildParcelRows(parcels: ParcelDamage[]): ParcelRow[] {
    return parcels
      .map(p => {
        const damageRate = p.damageRate
        const compensation = computeCompensation(p.damageAreaMu, p.sumInsured, damageRate)
        const severity = parcelDamageSeverity(damageRate)
        return {
          parcelId: p.parcelId,
          severity,
          damageRate,
          damageAreaMu: p.damageAreaMu,
          compensation,
        }
      })
      .filter(p => p.damageAreaMu > 0)
      .sort((a, b) => {
        // 排序：受损程度（重>中>轻）→ 受损率降序 → 地块编号
        const severityWeight: Record<RegionSeverity, number> = { heavy: 0, medium: 1, light: 2, none: 3 }
        const sw = severityWeight[a.severity] - severityWeight[b.severity]
        if (sw !== 0) return sw
        if (a.damageRate !== b.damageRate) return b.damageRate - a.damageRate
        return a.parcelId.localeCompare(b.parcelId)
      })
  }

  /** 构建概览卡片模型
   *  @param aggregated 预计算的区域聚合结果（与 Choropleth 共享，确保一致）
   */
  function buildOverviewModel(
    parcels: ParcelDamage[],
    currentLevelName: string,
    isVillageLevel: boolean,
    aggregated: AggregatedResult[],
  ): LodgingOverviewModel {
    const relevantParcels = filterParcelsToScope(parcels)

    // KPI 统计
    let totalDamagedAreaMu = 0
    const householdIds = new Set<string>()
    let totalCompensation = 0

    for (const p of relevantParcels) {
      const damageRate = p.damageRate
      if (p.damageAreaMu > 0) {
        totalDamagedAreaMu += p.damageAreaMu
        if (p.insuredPartyId) householdIds.add(p.insuredPartyId)
      }
      totalCompensation += computeCompensation(p.damageAreaMu, p.sumInsured, damageRate)
    }

    // 区域统计表（非村级，使用共享的聚合数据）或地块列表（村级）
    let regionRows: RegionTableRow[] = []
    let parcelRows: ParcelRow[] = []

    if (!isVillageLevel) {
      regionRows = buildRegionTableRows(aggregated)
    } else {
      parcelRows = buildParcelRows(relevantParcels)
    }

    return {
      currentLevelName,
      isVillageLevel,
      totalDamagedAreaMu: Math.round(totalDamagedAreaMu * 100) / 100,
      totalHouseholdCount: householdIds.size,
      totalCompensation: Math.round(totalCompensation * 100) / 100,
      totalParcelCount: isVillageLevel ? parcelRows.length : 0,
      regionRows,
      parcelRows,
      evaluatedAt: evaluatedAt ?? '',
      isDemoMode: isDemoMode.value,
    }
  }

  /** 构建地块抽屉数据 */
  function buildParcelDrawerRows(parcels: ParcelDamage[]): ParcelRowData[] {
    if (ctx.store.current.level !== 'village') return []
    const villageCode = ctx.store.current.code
    return parcels
      .filter(p => p.villageCode === villageCode)
      .map(p => {
        const damageRate = p.damageRate
        return {
          parcelId: p.parcelId,
          damageRate,
          areaMu: p.damageAreaMu,
          compensation: computeCompensation(p.damageAreaMu, p.sumInsured, damageRate),
          insuredName: partyNameByParcelId.get(p.parcelId) ?? '',
        }
      })
  }

  /** 构建 ChoroplethEntry[] */
  /** 构建 ChoroplethEntry[]
   *  @param parcels 地块数据
   *  @param aggregatedMap 预计算的区域聚合结果（code → damageRate），非村级使用，确保与统计表一致
   */
  async function buildChoroplethEntries(
    parcels: ParcelDamage[],
    aggregatedMap: Map<string, number>,
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

        // 构建 parcelId → damageRate map
        const damageByParcelId = new Map<string, number>()
        for (const p of parcels) {
          if (p.villageCode === villageCode) {
            damageByParcelId.set(p.parcelId, p.damageRate)
          }
        }

        const entries: ChoroplethEntry[] = []
        for (const feature of parcelFc.features) {
          const parcelId = String(feature.properties?.id ?? feature.properties?.parcelId ?? '')
          const damageRate = damageByParcelId.get(parcelId) ?? 0
          if (damageRate <= 0 || !feature.geometry) continue

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

    // 非村级：加载子区划边界 GeoJSON，使用预计算的聚合结果
    const crumb = ctx.store.current
    const url = childrenUrl(crumb)
    if (!url) return []

    let fc: FeatureCollection
    try {
      fc = await fetchJSON<FeatureCollection>(url)
    } catch {
      return []
    }

    const entries: ChoroplethEntry[] = []
    for (const feature of fc.features) {
      const code = String(feature.properties?.code ?? '')
      const name = String(feature.properties?.name ?? code)
      if (!code || !feature.geometry) continue

      // 使用预计算的聚合 damageRate，确保与统计表完全一致
      const damageRate = aggregatedMap.get(code) ?? 0
      if (damageRate <= 0) continue

      entries.push({ code, name, damageRate, geometry: feature.geometry })
      childFeatureMap.set(code, feature as Feature)
    }

    return entries
  }

  async function renderChoropleth(parcels: ParcelDamage[], aggregatedMap: Map<string, number>) {
    if (!choroplethController) return
    const entries = await buildChoroplethEntries(parcels, aggregatedMap)
    choroplethController.setData(entries)
    choroplethController.setVisible(true)
  }

  async function runAssessment() {
    isLoading.value = true
    try {
      const now = new Date()
      evaluatedAt = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')} ${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`

      const { parcels, villages, partyNames } = await loadAllData()
      parcelDamages = parcels
      villageBoundaries = villages
      partyNameByParcelId = partyNames

      adminNameMap = await loadAdminNames()

      // 计算一次聚合，Choropleth 和统计表共享，确保数据完全一致
      const level = ctx.store.current.level
      const childLevel = getChildLevel(level)
      const relevantParcels = filterParcelsToScope(parcelDamages)
      let aggregatedMap = new Map<string, number>()
      let aggregatedResults: AggregatedResult[] = []
      if (childLevel) {
        aggregatedResults = aggregateByFeatureCode(relevantParcels, childLevel)
        for (const r of aggregatedResults) {
          aggregatedMap.set(r.code, r.damageRate)
        }
      }

      await renderChoropleth(parcelDamages, aggregatedMap)

      const currentLevelName = ctx.store.current.name
      const isVillageLevel = ctx.store.current.level === 'village'
      overviewModel.value = buildOverviewModel(parcelDamages, currentLevelName, isVillageLevel, aggregatedResults)

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
