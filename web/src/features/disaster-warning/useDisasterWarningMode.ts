import { computed, ref, watch, type Ref } from 'vue'
import L from 'leaflet'
import type { useDrilldownStore, Level, Crumb } from '../../stores/drilldown'
import { useDisasterWarningStore } from '../../stores/disasterWarning'
import { loadDisasterWarningData } from './disasterWarningRepository'
import type { DisasterPrecip, DisasterWarningTab } from './types'
import { createDisasterPlaybackController, type DisasterPlaybackController } from './disasterPlaybackController'
import { createPrecipitationLayerController, type PrecipitationLayerController } from '../../map/precipitationLayerController'
import { createTyphoonLayerController, type TyphoonLayerController } from '../../map/typhoonLayerController'
import { createDisasterWarningLayerController, type DisasterWarningLayerController } from '../../map/disasterWarningLayerController'
import { adaptTyphoonDetail } from '../typhoon/typhoonAdapter'
import { buildTyphoonHoverViewModel } from '../typhoon/typhoonHoverViewModel'
import { clearPinnedWindPopupOnMove, hoverPopup, leavePopup, visiblePopupTarget, type TyphoonPopupState } from '../typhoon/typhoonInteractionState'
import type { TyphoonDetail } from '../typhoon/typhoonTypes'
import type { FeatureCollection, Geometry } from 'geojson'
import { fetchJSON } from '../../api/data'
import { childrenUrl } from '../../stores/drilldown'
import { warnedVillagesAtNode } from './disasterWarningSelectors'
import { TASK_TYPES_BY_WARNING_LEVEL } from '../../stores/disasterWarning'

export interface DisasterWarningContext {
  store: ReturnType<typeof useDrilldownStore>
  /** 台风/灾害模式激活标记（MapView 持有，供互斥判定） */
  disasterActive: Ref<boolean>
  anyWeatherActive(): boolean
  hasUnsavedParcelWork(): boolean
  exits: {
    typhoon(restoreView?: boolean): void
    weather(): void
    nationalAlarms(): void
    precipitation(): void
    lodging(): void
    agri(): void
  }
  resetToProvince: () => Promise<boolean>
  render: () => Promise<void>
  showNotice: (msg: string, error?: boolean) => void
}

export interface DisasterWarningMode {
  init(map: L.Map): void
  destroy(): void
  enter(): Promise<void>
  exit(): void
  setTab(tab: DisasterWarningTab): void
  /** 迷你浮窗：切换播放/暂停 */
  togglePlay(): void
  /** 迷你浮窗：退出受灾预警（R2-5） */
  closePlayback(): void
  /** 点击脉冲/卡片 → 进入村级视角（R3-7/R3-10） */
  selectVillage(code: string): void
  /** 点击聚合徽标 → 下钻该区县（R3-20） */
  selectCounty(countyCode: string): void
  /** 派发任务（R3-15/R5-1）：手工派发单村 */
  dispatchVillage(code: string): void
  /** 一键派发待处理村（R3-16） */
  dispatchAllPending(): void
  /** 悬停浮窗状态（MapView 渲染 TyphoonHoverPopup 用） */
  typhoonHoverModel: Ref<ReturnType<typeof buildTyphoonHoverViewModel> | null>
  typhoonHoverPosition: Ref<{ x: number; y: number }>
}

/** 受灾预警模式装配（R1~R6 共享装配层）：复用台风/降水图层，新增预警图层 + 循环播放。 */
export function useDisasterWarningMode(ctx: DisasterWarningContext): DisasterWarningMode {
  const store = useDisasterWarningStore()

  let map: L.Map | null = null
  let playbackStarted = false
  let typhoonController: TyphoonLayerController | null = null
  let precipController: PrecipitationLayerController | null = null
  let warningController: DisasterWarningLayerController | null = null
  let playback: DisasterPlaybackController | null = null
  let typhoonDetail: TyphoonDetail | null = null

  const typhoonPopupState = ref<TyphoonPopupState>({ hover: null, pinned: null })
  const typhoonHoverPosition = ref({ x: 0, y: 0 })
  const typhoonHoverModel = computed(() => {
    const target = visiblePopupTarget(typhoonPopupState.value)
    return target && typhoonDetail ? buildTyphoonHoverViewModel({ [typhoonDetail.id]: typhoonDetail }, target) : null
  })

  // ---- 区县徽标落点（R3-19：政府驻地缺失时用区县边界质心） ----
  const countySeats = ref<Map<string, [number, number]>>(new Map())
  let countySeatsLoading: Promise<Map<string, [number, number]>> | null = null

  /** 从 boundary/county/{cityCode}.geojson 计算区县质心（无源数据时兜底）。 */
  async function loadCountySeats(): Promise<Map<string, [number, number]>> {
    if (countySeatsLoading) return countySeatsLoading
    countySeatsLoading = (async () => {
      const seats = new Map<string, [number, number]>()
      // 11 个地市的 county 文件，逐一取辖区所有区县质心
      const cityFiles = ['330100', '330200', '330300', '330400', '330500', '330600', '330700', '330800', '330900', '331000', '331100']
      const jobs = cityFiles.map(async (cityCode) => {
        try {
          const fc = await fetchJSON<FeatureCollection>(`/data/boundary/county/${cityCode}.geojson`)
          for (const feature of fc.features) {
            const code = String(feature.properties?.code ?? '')
            if (!code || !feature.geometry) continue
            const centroid = polygonCentroid(feature.geometry)
            if (centroid) seats.set(code, centroid)
          }
        } catch { /* 数据缺失：该市无徽标落点 */ }
      })
      await Promise.all(jobs)
      countySeats.value = seats
      // 徽标落点就绪后重置图层渲染缓存，强制用真实落点重渲一次
      lastWarnedRenderKey = ''
      renderWarningLayer(store.nodeIndex)
      return seats
    })()
    return countySeatsLoading
  }

  function polygonCentroid(geometry: Geometry): [number, number] | null {
    const rings = geometry.type === 'Polygon'
      ? geometry.coordinates
      : geometry.type === 'MultiPolygon'
        ? geometry.coordinates.flat()
        : []
    if (rings.length === 0) return null
    // 取面积最大环（外环）计算多边形质心
    let best = rings[0]!
    let bestArea = -1
    for (const ring of rings) {
      const area = Math.abs(ringArea(ring))
      if (area > bestArea) { bestArea = area; best = ring }
    }
    let cx = 0
    let cy = 0
    let twiceArea = 0
    for (let i = 0; i < best.length - 1; i++) {
      const [x1, y1] = best[i]!
      const [x2, y2] = best[i + 1]!
      const cross = x1 * y2 - x2 * y1
      twiceArea += cross
      cx += (x1 + x2) * cross
      cy += (y1 + y2) * cross
    }
    if (twiceArea === 0) return null
    return [cx / (3 * twiceArea), cy / (3 * twiceArea)]
  }

  function ringArea(ring: number[][]): number {
    let sum = 0
    for (let i = 0; i < ring.length - 1; i++) {
      const [x1, y1] = ring[i]!
      const [x2, y2] = ring[i + 1]!
      sum += x1 * y2 - x2 * y1
    }
    return sum / 2
  }

  // ---- 数据加载 ----

  /** 数据就绪后从静态 track 适配台风详情（init 时 track 未到，必须在 receive 后执行，R2-10~R2-12）。 */
  function syncTyphoonDetail() {
    const track = store.track
    typhoonDetail = track ? adaptTyphoonDetail(track) : null
  }

  async function loadAll() {
    const generation = store.generation
    try {
      const data = await loadDisasterWarningData()
      store.receive(generation, data)
      // 台风详情依赖 track：init 时数据未到，这里重新适配（R2-10~R2-12 修复）
      syncTyphoonDetail()
      // 预计算徽标落点（异步，不阻塞播放）
      void loadCountySeats()
    } catch (e) {
      store.fail(generation, e instanceof Error ? e.message : '受灾预警数据加载失败')
      ctx.showNotice('受灾预警数据加载失败，已按降级模式展示（预警监测空态、灾损预估 0、派发不可用）。', true)
    }
  }

  // ---- 图层渲染 ----

  /** 台风轨迹 + 当前位置风圈（R2-10~R2-12）：复用 typhoonLayerController，visibleObservationCount 驱动动画 */
  function renderTyphoonLayer(nodeIndex: number) {
    if (!typhoonController || !typhoonDetail) return
    const count = nodeIndex + 1 // 已播节点数（含当前帧）
    const node = typhoonDetail.observationsAsc[nodeIndex]
    typhoonController.render({
      realtime: [],
      historical: [{ detail: typhoonDetail, visibleObservationCount: count }],
      focusedTyphoonId: typhoonDetail.id,
      selectedNodeByTyphoon: node ? { [typhoonDetail.id]: node.id } : {},
    })
  }

  /** 热力图帧：precip.json 每帧适配为 PrecipitationSnapshot（R2-6，复用降水渲染） */
  // 降水热力图重绘节流：累计雨量单调不减，相邻节点若雨量几乎未变则无需重绘（R2-6 边界：数据缺失/未变时保持上一份，不闪空）
  let lastPrecipRenderedNode = -1
  let lastPrecipHash = -1

  function precipFrameHash(precip: DisasterPrecip, nodeIndex: number): number {
    // 用累计雨量全网格的简单累加校验和作签名（仅 398 个点，O(n) 极廉价）；区分不同雨量场
    let hash = 0
    for (const g of precip.grid) {
      const v = g.cum[nodeIndex] ?? 0
      hash = (hash * 31 + Math.round(v * 10)) | 0
    }
    return hash
  }

  function renderPrecipFrame(nodeIndex: number) {
    const precip = store.precip
    if (!precipController || !precip) return
    // 累计雨量几乎未变（早期无雨/小雨节点）：跳过重绘，沿用上一份热力图，避免每帧全瓦片重绘
    const hash = precipFrameHash(precip, nodeIndex)
    if (nodeIndex !== lastPrecipRenderedNode && hash === lastPrecipHash) return
    lastPrecipRenderedNode = nodeIndex
    lastPrecipHash = hash
    const time = precip.nodeTimes[nodeIndex] ?? ''
    const snapshot = {
      grid: precip.grid.map((g) => ({ lat: g.lat, lon: g.lon, values: { d1: g.cum[nodeIndex] ?? 0, d2: g.cum[nodeIndex] ?? 0, d3: g.cum[nodeIndex] ?? 0, d4: g.cum[nodeIndex] ?? 0, d5: g.cum[nodeIndex] ?? 0, d6: g.cum[nodeIndex] ?? 0, d7: g.cum[nodeIndex] ?? 0 } })),
      days: [time, time, time, time, time, time, time],
      coveredDays: 7,
      model: precip.model,
      updatedAt: time,
      aggregateFrom: precip.aggregateFrom,
    }
    precipController.setSnapshot(snapshot as never)
    // 注：setSnapshot 内部已把 currentDay 重置为 d1 并 rebuildGrid；无需再 setDay（否则降水瓦片每帧被重绘两次，单帧成本翻倍）
  }

  /** 村级预警图层：按层级过滤后渲染（R3-6/R3-19/R3-22） */
  // 图层标记重建节流：预警标记/徽标在集合未变时无需每帧 clearLayers+重建（预警村爆发时每帧重建几百 marker 是主卡顿之一）
  let lastWarnedRenderKey = ''

  function renderWarningLayer(nodeIndex: number) {
    if (noMarkers) return
    const warnings = store.warnings
    if (!warningController || !warnings) return
    const level = ctx.store.current.level
    const code = ctx.store.current.code
    // R2-3 变更为 1s/步：标记集合在多数相邻节点未变；仅当 节点+层级+区划 都未变时跳过重建
    const key = `${nodeIndex}|${level}|${code}`
    if (key === lastWarnedRenderKey) return
    lastWarnedRenderKey = key
    const entries = warnedVillagesAtNode(warnings, nodeIndex).filter((e) => e.level >= 2) // 低风险不上图（仅列表）
    let filtered = entries
    if (level === 'county') {
      const countyCode = ctx.store.current.code
      filtered = entries.filter((e) => e.village.countyCode === countyCode)
    } else if (level === 'township') {
      const townshipCode = ctx.store.current.code
      filtered = entries.filter((e) => e.village.townshipCode === townshipCode)
    } else if (level === 'village') {
      const code = ctx.store.current.code
      const current = warnings.villages.find((v) => v.code === code)
      const currentTownship = current?.townshipCode
      // R3-22 村级视角：本村 + 同乡镇预警村
      filtered = entries.filter((e) => e.village.code === code || (currentTownship && e.village.townshipCode === currentTownship))
    }
    warningController.render({
      level,
      entries: filtered,
      countySeats: countySeats.value,
    })
  }

  // ---- 播放推进（R2-3/R2-4） ----

  function onStep(nodeIndex: number) {
    store.setNode(nodeIndex)
    renderTyphoonLayer(nodeIndex)
    if (!noPrecip) renderPrecipFrame(nodeIndex)
    renderWarningLayer(nodeIndex)
    // 任务状态三段流转（R5-6）
    store.advanceTaskStatuses(nodeIndex)
    // 自动派发（R5-11）：预警达中风险及以上自动生成
    if (store.dispatchMode === 'auto') autoDispatch(nodeIndex)
    // 预警升级/解除联动（R5-2/R5-3/R5-4）
    syncTaskWarningLinkage(nodeIndex)
  }

  function onLoopRestart() {
    // R5-7 循环回起点 = 演示状态全部重置（预警+任务+灾损预估清零）
    store.resetRound()
    // 播放回首帧并重渲染
    const index = 0
    store.setNode(index)
    renderTyphoonLayer(index)
    if (!noPrecip) renderPrecipFrame(index)
    renderWarningLayer(index)
  }

  // ---- 预警-任务联动（R5-2/R5-3/R5-4） ----

  function warnedVillageMap(nodeIndex: number): Map<string, number> {
    const map = new Map<string, number>()
    for (const entry of warnedVillagesAtNode(store.warnings!, nodeIndex)) {
      const prev = map.get(entry.village.code)
      map.set(entry.village.code, Math.max(prev ?? 0, entry.level))
    }
    return map
  }

  /** 升级：新等级对应新任务类型则生成新类型任务（R5-3）；同类型不重复（R5-4）。 */
  function syncTaskWarningLinkage(nodeIndex: number) {
    if (!store.warnings || store.phase !== 'ready') return
    const nodeTime = store.nodeTimeLabel
    const map = warnedVillageMap(nodeIndex)
    for (const task of store.tasks) {
      if (task.released) {
        // 预警再次触发（R5-4）：标记恢复 + 追加说明
        if (map.has(task.villageCode)) store.markWarningReTriggered(task.villageCode, nodeTime)
        continue
      }
      const currentLevel = map.get(task.villageCode)
      if (currentLevel === undefined) {
        store.releaseTasksForVillage(task.villageCode, nodeTime)
      } else {
        store.updateTaskWarningLevel(task.villageCode, currentLevel as 1 | 2 | 3, nodeTime)
        // 高风险升级 → 补核查类任务（R5-3/R5-8）
        if (currentLevel >= 3 && task.type === 'prevent' && !store.isDispatched(task.villageCode, 'inspect')) {
          const village = store.warnings.villages.find((v) => v.code === task.villageCode)
          if (village) {
            store.createTask({
              villageCode: village.code, villageName: village.name, type: 'inspect',
              nodeIndex, nodeTimeLabel: nodeTime, warningLevel: 3, lon: village.lon, lat: village.lat,
            })
          }
        }
      }
    }
  }

  // ---- 派发（R3-15/R3-16/R5-10/R5-11） ----

  function createTasksForVillage(villageCode: string, nodeIndex: number) {
    if (!store.warnings) return
    const entry = warnedVillagesAtNode(store.warnings, nodeIndex).find((e) => e.village.code === villageCode)
    if (!entry) return
    const level = entry.level as 1 | 2 | 3
    const types = TASK_TYPES_BY_WARNING_LEVEL[level]
    for (const type of types) {
      store.createTask({
        villageCode: entry.village.code,
        villageName: entry.village.name,
        type,
        nodeIndex,
        nodeTimeLabel: store.nodeTimeLabel,
        warningLevel: level,
        lon: entry.village.lon,
        lat: entry.village.lat,
      })
    }
  }

  function dispatchVillage(code: string) {
    if (store.phase !== 'ready') return
    createTasksForVillage(code, store.nodeIndex)
  }

  function dispatchAllPending() {
    if (store.phase !== 'ready') return
    const entries = warnedVillagesAtNode(store.warnings!, store.nodeIndex)
    for (const entry of entries) {
      if (entry.level >= 2 && !store.isDispatched(entry.village.code)) createTasksForVillage(entry.village.code, store.nodeIndex)
    }
  }

  function autoDispatch(nodeIndex: number) {
    if (store.phase !== 'ready') return
    const entries = warnedVillagesAtNode(store.warnings!, nodeIndex)
    for (const entry of entries) {
      if (entry.level >= 2 && !store.isDispatched(entry.village.code)) createTasksForVillage(entry.village.code, nodeIndex)
    }
  }

  // ---- 播放控制 ----

  function startPlayback() {
    const count = store.nodeCount
    if (!playback || count <= 0 || !map) return
    store.setPlaying(true)
    playback.start(count, { onStep, onLoopRestart })
  }

  // 隔离诊断开关：临时置 true —— 完全隐藏/不加载降雨热力图（只留台风+预警标记+面板），定位卡顿是否来自热力图。
  // 诊断开关（用户要求：先移除降雨热力图，只保留台风+面板来排查卡顿；完成排查后再恢复 false）
  const noPrecip = true
  const noMarkers = false

  /** 进入受灾预警时：挂载图层并渲染首帧，但不自动启动播放（R2-3 变更：默认不自动播放，用户点 ▶ 启动）。 */
  function renderInitialFrame() {
    const count = store.nodeCount
    if (!map || count <= 0) return
    // 进入受灾预警才挂载降水/预警图层（不常驻地图）
    precipController?.destroy()
    // 受灾预警播放时每帧重绘降水热力图（高频），用较小 renderSize 降低每帧瓦片插值成本；降水模式仍用默认 64
    if (!noPrecip) {
      precipController = createPrecipitationLayerController({ renderSize: 32 })
      precipController.mount(map)
    }
    warningController?.destroy()
    if (!noMarkers) {
      warningController = createDisasterWarningLayerController({
        onBadgeClick: (countyCode) => void selectCounty(countyCode),
        onVillageClick: (code) => void selectVillage(code),
      })
      warningController.mount(map)
    }
    store.setNode(0)
    renderTyphoonLayer(0)
    if (!noPrecip) renderPrecipFrame(0)
    renderWarningLayer(0)
    store.setPlaying(false)
  }

  function togglePlay() {
    if (!playback || store.phase !== 'ready') return
    if (playback.isPlaying()) { playback.pause(); store.setPlaying(false) }
    else {
      store.setPlaying(true)
      // 首次播放：播放器未启动则 start；暂停后继续则 resume
      if (playbackStarted) { playback.resume() } else { playbackStarted = true; startPlayback() }
    }
  }

  function closePlayback() {
    exit()
  }

  // ---- 下钻（R3-7/R3-10/R3-20） ----

  async function findBoundaryFeature(url: string, code: string): Promise<{ name: string; geometry: Geometry } | null> {
    try {
      const fc = await fetchJSON<FeatureCollection>(url)
      const feature = fc.features.find((f) => String(f.properties?.code) === code)
      if (feature?.geometry) return { name: String(feature.properties?.name ?? code), geometry: feature.geometry }
    } catch { /* 数据缺失 */ }
    return null
  }

  async function drillToVillageWithFullPath(village: { code: string; name: string; countyCode: string; townshipCode: string; lon: number; lat: number }) {
    const current = ctx.store.current
    if (current.level === 'village' && current.code === village.code) return
    const cityCode = `${village.countyCode.slice(0, 4)}00`
    const crumbs: Crumb[] = [{ level: 'province', code: '330000', name: '浙江省' }]
    const chain: Array<{ level: Level; code: string; url: string }> = [
      { level: 'city', code: cityCode, url: childrenUrl({ level: 'province', code: '330000', name: '浙江省' })! },
      { level: 'county', code: village.countyCode, url: `/data/boundary/county/${cityCode}.geojson` },
      { level: 'township', code: village.townshipCode, url: `/data/boundary/township/${village.countyCode}.geojson` },
    ]
    for (const step of chain) {
      const feature = await findBoundaryFeature(step.url, step.code)
      if (!feature) break
      crumbs.push({ level: step.level, code: step.code, name: feature.name, geometry: feature.geometry })
    }
    crumbs.push({ level: 'village', code: village.code, name: village.name })
    await ctx.store.navigateTo(crumbs)
    // 进入村级视角后重渲预警层（R3-22）
    renderWarningLayer(store.nodeIndex)
  }

  async function selectVillage(code: string) {
    if (!store.warnings) return
    const village = store.warnings.villages.find((v) => v.code === code)
    if (!village) return
    await drillToVillageWithFullPath(village)
  }

  async function selectCounty(countyCode: string) {
    const cityCode = `${countyCode.slice(0, 4)}00`
    const current = ctx.store.current
    if (current.level === 'county' && current.code === countyCode) return
    const crumbs: Crumb[] = [{ level: 'province', code: '330000', name: '浙江省' }]
    const feature = await findBoundaryFeature(childrenUrl({ level: 'province', code: '330000', name: '浙江省' })!, cityCode)
    const countyFeature = await findBoundaryFeature(`/data/boundary/county/${cityCode}.geojson`, countyCode)
    if (feature) crumbs.push({ level: 'city', code: cityCode, name: feature.name, geometry: feature.geometry })
    if (countyFeature) crumbs.push({ level: 'county', code: countyCode, name: countyFeature.name, geometry: countyFeature.geometry })
    if (crumbs.length < 2) { crumbs.push({ level: 'city', code: cityCode, name: cityCode }) }
    if (crumbs.length < 3) { crumbs.push({ level: 'county', code: countyCode, name: countyCode }) }
    await ctx.store.navigateTo(crumbs)
    renderWarningLayer(store.nodeIndex)
  }

  // ---- 模式进入/退出 ----

  async function enter() {
    if (ctx.hasUnsavedParcelWork()) return
    // R1-4 模式互斥：进入受灾预警退出农情监测/台风/天气/降水/倒伏评估等其他模式
    if (ctx.anyWeatherActive()) { ctx.exits.weather(); ctx.exits.nationalAlarms() }
    if (ctx.disasterActive.value) ctx.exits.typhoon()
    ctx.exits.precipitation()
    ctx.exits.lodging()
    ctx.exits.agri()
    store.open()
    // R1-2：进入后地图切回省级视角
    await ctx.resetToProvince()
    void ctx.render()
    await loadAll()
    // 数据就绪后渲染首帧（R2-3 变更：默认不自动播放，用户点 ▶ 启动）
    if (store.phase === 'ready') renderInitialFrame()
  }

  function exit() {
    playback?.pause()
    playbackStarted = false
    store.close()
    // 移除受灾预警专属图层（不常驻地图，避免与降水模式共用 pane 冲突）
    precipController?.destroy()
    precipController = null
    warningController?.destroy()
    warningController = null
    if (!ctx.disasterActive.value) {
      void ctx.resetToProvince().then((reset) => { if (reset) void ctx.render() })
    }
  }

  function setTab(tab: DisasterWarningTab) { store.setTab(tab) }

  function init(target: L.Map) {
    map = target
    // 台风图层控制器创建时不依赖 track；typhoonDetail 在 loadAll→receive 后由 syncTyphoonDetail 适配（R2-10~R2-12）
    typhoonController = createTyphoonLayerController(target, {
      onNodeEnter: ({ typhoonId, nodeId, containerPoint }) => {
        typhoonPopupState.value = hoverPopup(typhoonPopupState.value, { kind: 'center', typhoonId, nodeId })
        typhoonHoverPosition.value = containerPoint
      },
      onNodeLeave: ({ typhoonId, nodeId }) => {
        typhoonPopupState.value = leavePopup(typhoonPopupState.value, { kind: 'center', typhoonId, nodeId })
      },
      onCenterEnter: ({ typhoonId, nodeId, containerPoint }) => {
        typhoonPopupState.value = hoverPopup(typhoonPopupState.value, { kind: 'center', typhoonId, nodeId })
        typhoonHoverPosition.value = containerPoint
      },
      onCenterLeave: ({ typhoonId, nodeId }) => {
        typhoonPopupState.value = leavePopup(typhoonPopupState.value, { kind: 'center', typhoonId, nodeId })
      },
      onWindCircleEnter: ({ typhoonId, nodeId, grade, containerPoint }) => {
        typhoonPopupState.value = hoverPopup(typhoonPopupState.value, { kind: 'wind', typhoonId, nodeId, grade })
        typhoonHoverPosition.value = containerPoint
      },
      onWindCircleLeave: ({ typhoonId, nodeId, grade }) => {
        typhoonPopupState.value = leavePopup(typhoonPopupState.value, { kind: 'wind', typhoonId, nodeId, grade })
      },
    })
    // 播放控制器（R2-3/R2-4 循环）——intervalMs 设为 1000ms/节点：演示更从容，避免高频重绘三图层导致主线程饱和（用户建议放慢）
    playback = createDisasterPlaybackController({ intervalMs: 1000 })
    // 地图空白点击清除钉住的浮窗
    target.getContainer().addEventListener('pointermove', () => {
      typhoonPopupState.value = clearPinnedWindPopupOnMove(typhoonPopupState.value)
    })
  }

  function destroy() {
    playback?.destroy()
    typhoonController?.destroy()
    precipController?.destroy()
    warningController?.destroy()
    map = null
  }

  // 层级变化 → 重渲预警层（R3-19/R3-20/R3-22）
  watch(() => ctx.store.current, () => { renderWarningLayer(store.nodeIndex) }, { deep: true })

  return {
    init,
    destroy,
    enter,
    exit,
    setTab,
    togglePlay,
    closePlayback,
    selectVillage,
    selectCounty,
    dispatchVillage,
    dispatchAllPending,
    typhoonHoverModel,
    typhoonHoverPosition,
  }
}
