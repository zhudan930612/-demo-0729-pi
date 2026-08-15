import { computed, ref, watch, type Ref } from 'vue'
import L from 'leaflet'
import type { FeatureCollection, Geometry } from 'geojson'
import type { useDrilldownStore, Crumb, Level } from '../../stores/drilldown'
import type { WorkbenchTab } from '../../components/disaster/DisasterWorkbenchPanel.vue'
import { useNationalAlarmStore } from '../../stores/nationalAlarms'
import { usePrecipitationStore } from '../../stores/precipitation'
import { useTyphoonStore } from '../../stores/typhoon'
import { fetchJSON } from '../../api/data'
import { childrenUrl } from '../../stores/drilldown'
import { createPrecipitationLayerController, type PrecipitationLayerController } from '../../map/precipitationLayerController'
import { createVillageRiskLayerController, type VillageRiskLayerController } from '../../map/villageRiskLayerController'
import { createPrecipitationRepository, type PrecipitationRepository } from './precipitationRepository'
import { PRECIP_DAY_KEYS, type PrecipGridPoint } from './precipitationTypes'
import { loadPolicySummaries, type VillagePolicySummary } from '../village-risk/villagePolicySummary'
import { buildVillageRiskOverviewModel, type VillageRiskOverviewModel } from '../village-risk/villageRiskOverviewModel'
import {
  loadInsuredVillages,
  coveredGridPoints,
  computeVillageRisk,
  townshipFileOf,
  latestTyphoonRiskPaths,
  alarmItems,
  type VillageBoundary,
} from '../village-risk/villageRiskData'
import type { VillageRiskResult } from '../village-risk/villageRiskData'
import { buildVillageRiskCardModel, type VillageRiskCardModel } from '../village-risk/villageRiskCardModel'
import { windowStage } from '../village-risk/cropCycle'

export interface PrecipitationModeContext {
  store: ReturnType<typeof useDrilldownStore>
  /** 台风模式激活标记（台风域持有） */
  disasterActive: Ref<boolean>
  /** 共用面板 tab（台风/风险），MapView 持有 */
  workbenchTab: Ref<WorkbenchTab>
  /** 共用面板折叠态，MapView 持有 */
  workbenchCollapsed: Ref<boolean>
  /** 程序化缩放期间不重排视野（MapView 持有） */
  pendingNoFly: Ref<boolean>
  anyWeatherActive(): boolean
  hasUnsavedParcelWork(): boolean
  exits: {
    weather(): void
    nationalAlarms(): void
  }
  /** 台风数据未就绪时静默补拉（台风域提供） */
  silentLoadNationalAlarms(): void
  /** 台风仓库：三源补齐时静默进入台风仓库拉取 */
  typhoonRepositoryEnter(): void
  /** 重置到省界并重渲染（MapView 提供） */
  render(): Promise<void>
}

export interface PrecipitationMode {
  init(map: L.Map): void
  destroy(): void
  riskOverviewModel: Ref<VillageRiskOverviewModel | null>
  riskSnapshotError: Ref<boolean>
  villageCard: Ref<{ code: string; model: VillageRiskCardModel } | null>
  enterPrecipitationMode(): Promise<void>
  exitPrecipitationMode(): void
  refreshPrecipitation(): void
  selectPrecipDay(index: number): void
  togglePrecipPlay(): void
  setPrecipOpacity(value: number): void
  selectVillageFromOverview(code: string): void
  backFromVillageDetail(): void
  closeVillageCard(): void
  refreshVillageCard(): void
}

export function usePrecipitationMode(ctx: PrecipitationModeContext): PrecipitationMode {
  const precipitationStore = usePrecipitationStore()
  const typhoonStore = useTyphoonStore()
  const nationalAlarmStore = useNationalAlarmStore()

  let map!: L.Map
  let precipitationRepository: PrecipitationRepository | null = null
  let precipitationLayerController: PrecipitationLayerController | null = null
  const villageRiskLayerController = ref<VillageRiskLayerController | null>(null)
  const villageCard = ref<{ code: string; model: VillageRiskCardModel } | null>(null)
  let villageBoundaries: VillageBoundary[] = []
  const villageRiskResults = new Map<string, VillageRiskResult>()
  const villageCovered = new Map<string, PrecipGridPoint[]>()
  // 村界为普通 let（由异步加载赋值），computed 依赖需用版本号触发重算
  const villageBoundariesVersion = ref(0)
  const policySummaries = ref<Map<string, VillagePolicySummary> | null>(null)

  const riskSnapshotError = computed(() => precipitationStore.phase === 'error' || (precipitationStore.phase === 'ready' && precipitationStore.snapshot === null))
  const riskOverviewModel = computed<VillageRiskOverviewModel | null>(() => {
    void villageBoundariesVersion.value // 村界加载完成后触发重算（须在最前建立依赖）
    if (!precipitationStore.isOpen || villageBoundaries.length === 0) return null
    const snapshot = precipitationStore.snapshot
    if (!snapshot) return null
    const villages = villageBoundaries.map((village) => ({
      code: village.code,
      name: village.name,
      result: villageRiskResults.get(village.code) ?? computeVillageRisk({
        village,
        snapshot,
        typhoons: currentTyphoonRiskEntries(),
        alarms: alarmItems(nationalAlarmStore.snapshot),
      }),
    }))
    return buildVillageRiskOverviewModel({ villages, policies: policySummaries.value ?? new Map(), days: snapshot.days, updatedAt: snapshot.updatedAt })
  })

  function precipitationRepositoryLoad() {
    precipitationRepository = precipitationRepository ?? createPrecipitationRepository({
      begin: () => precipitationStore.generation,
      receive: (generation, snapshot) => precipitationStore.receive(generation, snapshot),
      fail: (generation, message) => precipitationStore.fail(generation, message),
    })
    return precipitationRepository.load()
  }

  function riskDataAvailability() {
    return {
      precip: precipitationStore.snapshot !== null,
      typhoon: typhoonStore.phase === 'ready',
      alarm: nationalAlarmStore.snapshot !== null,
    }
  }

  function currentTyphoonRiskEntries() {
    return latestTyphoonRiskPaths(typhoonStore.realtimeDetails)
  }

  /** 重算 13 村风险并渲染标注（快照/台风/预警任一变化时调用）。 */
  function computeVillageRisks() {
    if (!precipitationStore.isOpen) return
    const snapshot = precipitationStore.snapshot
    const typhoons = currentTyphoonRiskEntries()
    const alarms = alarmItems(nationalAlarmStore.snapshot)
    villageRiskResults.clear()
    villageCovered.clear()
    for (const village of villageBoundaries) {
      const covered = snapshot ? coveredGridPoints(village, snapshot.grid) : []
      villageCovered.set(village.code, covered)
      villageRiskResults.set(village.code, computeVillageRisk({ village, snapshot, typhoons, alarms }))
    }
    renderVillageRiskLayer()
    refreshVillageCard()
  }

  /** 渲染标注：省市不显示；乡镇级仅当前乡镇的村；村级全部高亮。 */
  function renderVillageRiskLayer() {
    const controller = villageRiskLayerController.value
    if (!controller) return
    controller.setLevel(ctx.store.current.level)
    controller.setCurrent(ctx.store.current.level === 'village' ? ctx.store.current.code : null)
    let entries = villageBoundaries.map((village) => ({ village, level: villageRiskResults.get(village.code)?.level ?? 0 }))
    if (ctx.store.current.level === 'township') {
      const file = `/data/villages/${ctx.store.current.code}.geojson`
      entries = entries.filter((entry) => townshipFileOf(entry.village.code) === file)
    }
    controller.setData(entries)
  }

  function buildVillageCardModel(village: VillageBoundary): VillageRiskCardModel {
    const snapshot = precipitationStore.snapshot
    const result = villageRiskResults.get(village.code)
      ?? computeVillageRisk({ village, snapshot, typhoons: currentTyphoonRiskEntries(), alarms: alarmItems(nationalAlarmStore.snapshot) })
    const month = new Date().getMonth() + 1
    const days = snapshot?.days ?? []
    const monthOf = (ymd: string) => { const parts = ymd.split('-'); return Number(parts[1]) || month }
    const startMonth = days.length > 0 ? monthOf(days[0]!) : month
    const endMonth = days.length > 0 ? monthOf(days[days.length - 1]!) : month
    const stageWindow = windowStage(startMonth, endMonth)
    const typhoonScenario = result.typhoonSignal >= 3 ? 'storm' : result.typhoonSignal >= 2 ? 'path' : null
    return buildVillageRiskCardModel({
      villageName: village.name,
      result,
      snapshot,
      covered: villageCovered.get(village.code) ?? [],
      month,
      selectedDay: precipitationStore.selectedDay,
      stageNote: stageWindow.note,
      typhoonScenario,
      dataAvailable: riskDataAvailability(),
      policy: policySummaries.value?.get(village.code) ?? null,
    })
  }

  function openVillageCard(code: string) {
    if (villageCard.value?.code === code) { closeVillageCard(); return }
    const village = villageBoundaries.find((v) => v.code === code)
    if (!village) return
    villageCard.value = { code, model: buildVillageCardModel(village) }
    villageRiskLayerController.value?.setSelected(code)
    ctx.workbenchCollapsed.value = false // 详情在右上面板展示，打开时展开面板
  }

  function closeVillageCard() {
    villageCard.value = null
    villageRiskLayerController.value?.setSelected(null)
    // 关闭详情后面板保持展开（显示列表，用户确认：点空白/Esc 回列表不折叠）
  }

  /** 详情返回按钮：关闭详情回列表，地图视角回镇级（用户 2026-08-10 确认）。 */
  function backFromVillageDetail() {
    closeVillageCard()
    if (ctx.store.current.level === 'village') void ctx.store.back()
  }

  /** 按 code 在边界文件中查找行政区 feature（市/区/镇补齐路径用）。 */
  async function findBoundaryFeature(url: string, code: string): Promise<{ name: string; geometry: Geometry } | null> {
    try {
      const fc = await fetchJSON<FeatureCollection>(url)
      const feature = fc.features.find((f) => String(f.properties?.code) === code)
      if (feature?.geometry) return { name: String(feature.properties?.name ?? code), geometry: feature.geometry }
    } catch {
      // 数据缺失：放弃补齐该级
    }
    return null
  }

  /**
   * 下钻到目标村并补齐完整路径（省/市/区/镇/村）：一次性 navigateTo + 单次 flyTo（与返回动画对称，丝滑不卡）。
   * 中间边界数据缺失时路径截断（从已有层级直接跳到村）。
   */
  async function drillToVillageWithFullPath(village: VillageBoundary) {
    const current = ctx.store.current
    if (current.level === 'village' && current.code === village.code) {
      openVillageCard(village.code)
      return
    }
    const countyCode = village.countyCode
    const cityCode = `${countyCode.slice(0, 4)}00`
    const townshipCode = (townshipFileOf(village.code)?.split('/').pop() ?? '').replace(/\.geojson$/, '')
    // 构造完整路径：省 → 市 → 区 → 镇 → 村（缺中间数据则截断）
    const crumbs: Crumb[] = [{ level: 'province', code: '330000', name: '浙江省' }]
    const chain: Array<{ level: Level; code: string; url: string }> = [
      { level: 'city', code: cityCode, url: childrenUrl({ level: 'province', code: '330000', name: '浙江省' })! },
      { level: 'county', code: countyCode, url: `/data/boundary/county/${cityCode}.geojson` },
      { level: 'township', code: townshipCode, url: `/data/boundary/township/${countyCode}.geojson` },
    ]
    for (const step of chain) {
      const feature = await findBoundaryFeature(step.url, step.code)
      if (!feature) break
      crumbs.push({ level: step.level, code: step.code, name: feature.name, geometry: feature.geometry })
    }
    crumbs.push({
      level: 'village',
      code: village.code,
      name: village.name,
      geometry: { type: 'MultiPolygon', coordinates: village.polygons },
    })
    ctx.pendingNoFly.value = false
    // 先打开详情（同步设置 villageCard），再导航——避免 navigateTo 的村级 watch 先自动打开、随后 openVillageCard 同码 toggle 误关
    openVillageCard(village.code)
    await ctx.store.navigateTo(crumbs)
  }

  /** 风险概览列表/地图标记点击 → 补齐路径下钻该村（村级视图）+ 右上面板展示详情。 */
  function selectVillageFromOverview(code: string) {
    const village = villageBoundaries.find((v) => v.code === code)
    if (!village) return
    void drillToVillageWithFullPath(village)
  }

  function refreshVillageCard() {
    if (!villageCard.value) return
    const village = villageBoundaries.find((v) => v.code === villageCard.value!.code)
    if (village) villageCard.value = { ...villageCard.value, model: buildVillageCardModel(village) }
  }

  async function enterPrecipitationMode() {
    if (ctx.hasUnsavedParcelWork()) return
    // 天气与降水互斥；台风保留（可叠加）
    if (ctx.anyWeatherActive()) { ctx.exits.weather(); ctx.exits.nationalAlarms() }
    // 三源齐全（v3.11）：台风/预警数据未加载时静默补拉（不进入对应模式，只填充数据源供风险判定）
    if (typhoonStore.phase !== 'ready') void ctx.typhoonRepositoryEnter()
    if (nationalAlarmStore.snapshot === null) {
      // 静默补拉：silentLoading 期间 isOpen=false（面板不出现），结束后恢复 closed（保留 snapshot 供风险判定）
      ctx.silentLoadNationalAlarms()
    }
    precipitationStore.open()
    precipitationLayerController = precipitationLayerController ?? createPrecipitationLayerController()
    precipitationLayerController.mount(map)
    // 参保村风险标注：挂载图层 + 异步加载村界后重算
    villageRiskLayerController.value = villageRiskLayerController.value ?? createVillageRiskLayerController({ onVillageClick: selectVillageFromOverview })
    villageRiskLayerController.value.mount(map)
    villageRiskLayerController.value.setVisible(true)
    void loadInsuredVillages().then((villages) => {
      if (!precipitationStore.isOpen) return
      villageBoundaries = villages
      villageBoundariesVersion.value++
      computeVillageRisks()
    })
    // 保单敞口汇总（进入降水即并行拉取 13 村）
    void loadPolicySummaries().then((summaries) => {
      if (precipitationStore.isOpen) policySummaries.value = summaries
    })
    await ctx.store.resetToProvince()
    void ctx.render() // 进入定位浙江省全省全景（方案 B：叠加时降水优先）
    void precipitationRepositoryLoad()
  }

  function exitPrecipitationMode() {
    precipitationRepository?.exit()
    // 退出即销毁图层（移除 canvas 与监听），验收 10：退出后色斑图层清除
    precipitationLayerController?.destroy()
    precipitationLayerController = null
    // 参保村风险标注与卡片一并清除
    closeVillageCard()
    villageRiskLayerController.value?.destroy()
    villageRiskLayerController.value = null
    villageBoundaries = []
    villageRiskResults.clear()
    villageCovered.clear()
    policySummaries.value = null
    precipitationStore.close()
    // 台风仍活动：保持当前视图不重置（方案 B：最后一个活动模式退出才恢复省界相机）
    if (!ctx.disasterActive.value) {
      void ctx.store.resetToProvince().then((reset) => { if (reset) void ctx.render() })
    }
  }

  function refreshPrecipitation() {
    if (!precipitationStore.isOpen) return
    precipitationStore.beginRefresh()
    void precipitationRepositoryLoad()
  }

  function selectPrecipDay(index: number) {
    precipitationStore.selectDay(index)
    precipitationLayerController?.setDay(PRECIP_DAY_KEYS[index])
  }

  function togglePrecipPlay() {
    if (precipitationStore.playing) precipitationStore.stopPlay()
    else precipitationStore.startPlay()
  }

  function setPrecipOpacity(value: number) {
    precipitationStore.setOpacity(value)
    precipitationLayerController?.setOpacity(value)
  }

  watch(() => precipitationStore.snapshot, (snapshot) => { precipitationLayerController?.setSnapshot(snapshot) })
  watch(() => precipitationStore.selectedDay, (day) => { precipitationLayerController?.setDay(PRECIP_DAY_KEYS[day]) })
  watch(() => precipitationStore.opacity, (opacity) => { precipitationLayerController?.setOpacity(opacity) })
  // 参保村风险联动：数据源与层级变化 → 重算/重渲/刷新卡片
  watch(() => precipitationStore.snapshot, () => { if (precipitationStore.isOpen) computeVillageRisks() })
  watch(() => typhoonStore.phase, () => { if (precipitationStore.isOpen) computeVillageRisks() })
  watch(() => typhoonStore.liveIds, () => { if (precipitationStore.isOpen) computeVillageRisks() })
  watch(() => typhoonStore.details, () => { if (precipitationStore.isOpen) computeVillageRisks() }, { deep: true })
  watch(() => nationalAlarmStore.snapshot, () => { if (precipitationStore.isOpen) computeVillageRisks() })
  watch(() => ctx.store.current.level, () => { if (precipitationStore.isOpen) renderVillageRiskLayer() })
  watch(() => precipitationStore.selectedDay, () => { if (precipitationStore.isOpen) refreshVillageCard() })
  watch(() => ctx.store.current.level, (level) => {
    if (level === 'village') {
      // 村级：自动展开右上面板并显示当前村风险概况（未手动打开详情时）
      if (!villageCard.value) {
        const code = ctx.store.current.code
        const village = villageBoundaries.find((v) => v.code === code)
        if (village) villageCard.value = { code, model: buildVillageCardModel(village) }
      }
      ctx.workbenchCollapsed.value = false
    } else {
      // 离开村级：关闭详情回列表，面板展开（非村级默认展开）
      closeVillageCard()
      ctx.workbenchCollapsed.value = false
    }
  })

  function init(target: L.Map) {
    map = target
  }

  function destroy() {
    precipitationLayerController?.destroy()
    villageRiskLayerController.value?.destroy()
  }

  return {
    init,
    destroy,
    riskOverviewModel,
    riskSnapshotError,
    villageCard,
    enterPrecipitationMode,
    exitPrecipitationMode,
    refreshPrecipitation,
    selectPrecipDay,
    togglePrecipPlay,
    setPrecipOpacity,
    selectVillageFromOverview,
    backFromVillageDetail,
    closeVillageCard,
    refreshVillageCard,
  }
}
