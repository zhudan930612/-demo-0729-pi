import type { Ref } from 'vue'
import L from 'leaflet'
import type { FeatureCollection, Geometry } from 'geojson'
import type { useDrilldownStore, Crumb, Level } from '../../stores/drilldown'
import { childrenUrl } from '../../stores/drilldown'
import { useAgriMonitoringStore } from '../../stores/agriMonitoring'
import { createAgriLayerController, type AgriLayerController } from '../../map/agriMonitoringLayerController'
import {
  loadAgriRaster, loadAgriVillages, loadAgriLevels, loadAgriTasks, loadAgriPolicyGrowth,
} from './agriMonitoringData'
import type { VillageGrowth, AgriTask } from './agriMonitoringTypes'
import { townshipFileOf } from '../village-risk/villageRiskData'
import { fetchJSON } from '../../api/data'

export interface AgriMonitoringContext {
  store: ReturnType<typeof useDrilldownStore>
  disasterActive: Ref<boolean>
  anyWeatherActive(): boolean
  hasUnsavedParcelWork(): boolean
  exits: {
    typhoon(restoreView?: boolean): void
    weather(): void
    nationalAlarms(): void
    precipitation(): void
    lodging(): void
  }
  resetToProvince: () => Promise<boolean>
  render: () => Promise<void>
  showNotice: (msg: string, error?: boolean) => void
}

export interface AgriMonitoringMode {
  init(map: L.Map): void
  destroy(): void
  enter(): Promise<void>
  exit(): void
  selectDate(index: number): void
  togglePlay(): void
  setOpacity(value: number): void
  toggleVisible(): void
  setTab(tab: 'overview' | 'anomaly' | 'tasks'): void
  drillToVillage(code: string): void
  createTaskFromAnomaly(village: VillageGrowth): AgriTask | null
  locateTask(location: { lon: number; lat: number; name: string }): void
  clearTaskLocation(): void
  refresh(): void
}

export function useAgriMonitoringMode(ctx: AgriMonitoringContext): AgriMonitoringMode {
  const store = useAgriMonitoringStore()
  let map: L.Map | null = null
  let layer: AgriLayerController | null = null
  let marker: L.CircleMarker | null = null

  async function loadAll() {
    const generation = store.generation
    try {
      const [raster, villages, levels, tasks] = await Promise.all([
        loadAgriRaster(), loadAgriVillages(), loadAgriLevels(), loadAgriTasks(),
      ])
      const pgEntries = await Promise.all(villages.map((v) =>
        loadAgriPolicyGrowth(v.code).then((rows) => [v.code, rows] as const).catch(() => [v.code, []] as const),
      ))
      const policyGrowth = Object.fromEntries(pgEntries)
      const done = store.receive(generation, { raster, villages, levels: levels.byCode, tasks, policyGrowth })
      if (!done) return
      layer?.setRaster(raster)
      layer?.setDate(store.selectedDate)
    } catch (e) {
      store.fail(generation, e instanceof Error ? e.message : '农情数据加载失败')
    }
  }

  async function enter() {
    if (ctx.hasUnsavedParcelWork()) return
    // 模式互斥：进入农情监测退出其他灾情模式
    if (ctx.anyWeatherActive()) { ctx.exits.weather(); ctx.exits.nationalAlarms() }
    if (ctx.disasterActive.value) ctx.exits.typhoon()
    ctx.exits.precipitation()
    ctx.exits.lodging()
    store.open()
    layer = layer ?? createAgriLayerController()
    layer.mount(map!)
    // 进入默认最近一期，热力图开
    store.visible = true
    // 省级视角 + 渲染
    await ctx.resetToProvince()
    void ctx.render()
    void loadAll()
  }

  function exit() {
    layer?.destroy()
    layer = null
    clearTaskLocation()
    store.close()
    // 无其他活动模式则恢复省界
    if (!ctx.disasterActive.value) {
      void ctx.resetToProvince().then((reset) => { if (reset) void ctx.render() })
    }
  }

  function selectDate(index: number) {
    store.selectDate(index)
    layer?.setDate(store.selectedDate)
  }

  function togglePlay() {
    if (store.playing) store.stopPlay()
    else store.startPlay()
  }

  function setOpacity(value: number) {
    store.setOpacity(value)
    layer?.setOpacity(value)
  }

  function toggleVisible() {
    store.toggleVisible()
    layer?.setVisible(store.visible)
  }

  function setTab(tab: 'overview' | 'anomaly' | 'tasks') { store.setTab(tab) }

  function refresh() { store.phase = 'loading'; void loadAll() }

  /** 下钻到村（异常top/概况点击），补齐完整路径 + 聚焦村视角。 */
  async function findBoundaryFeature(url: string, code: string): Promise<{ name: string; geometry: Geometry } | null> {
    try {
      const fc = await fetchJSON<{ features?: Array<{ properties?: { code?: unknown; name?: unknown }; geometry?: Geometry }> }>(url)
      const feature = fc.features?.find((f) => String(f.properties?.code) === code)
      if (feature?.geometry) return { name: String(feature.properties?.name ?? code), geometry: feature.geometry }
    } catch { /* 数据缺失：放弃补齐该级 */ }
    return null
  }

  async function drillToVillageInner(village: VillageGrowth) {
    const current = ctx.store.current
    if (current.level === 'village' && current.code === village.code) return
    const countyCode = village.countyCode
    const cityCode = village.cityCode
    const townshipFile = townshipFileOf(village.code)
    const townshipCode = townshipFile ? (townshipFile.split('/').pop() ?? '').replace(/\.geojson$/, '') : village.townshipCode
    const crumbs: Crumb[] = [{ level: 'province', code: '330000', name: '浙江省' }]
    const chain: Array<{ level: Level; code: string; url: string | null }> = [
      { level: 'city', code: cityCode, url: childrenUrl({ level: 'province', code: '330000', name: '浙江省' }) ?? `/data/boundary/city/330000.geojson` },
      { level: 'county', code: countyCode, url: `/data/boundary/county/${cityCode}.geojson` },
      { level: 'township', code: townshipCode, url: townshipFile },
    ]
    for (const step of chain) {
      if (!step.url) continue
      const feature = await findBoundaryFeature(step.url, step.code)
      if (!feature) continue
      crumbs.push({ level: step.level, code: step.code, name: feature.name, geometry: feature.geometry })
    }
    // 村几何已在 villages 数据里？village 记录只有 centroid。需要村界几何。
    const villageGeom = await loadVillageGeometry(village.code)
    crumbs.push({ level: 'village', code: village.code, name: village.name, geometry: villageGeom ?? undefined })
    await ctx.store.navigateTo(crumbs)
  }

  /** 加载村界几何（乡镇 villages 文件里取）。 */
  async function loadVillageGeometry(code: string): Promise<Geometry | null> {
    const file = townshipFileOf(code)
    if (!file) return null
    try {
      const fc = await fetchJSON<FeatureCollection>(file)
      const feature = fc.features.find((f) => String(f.properties?.code) === code)
      return feature?.geometry ?? null
    } catch { return null }
  }

  function drillToVillage(code: string) {
    const village = store.villages?.find((v) => v.code === code)
    if (village) void drillToVillageInner(village)
  }

  /** 一键转任务：初始待领取；去重；进入任务列表 tab。 */
  function createTaskFromAnomaly(village: VillageGrowth): AgriTask | null {
    const task = store.createTaskFromAnomaly(village)
    if (task) store.setTab('tasks')
    return task
  }

  /** 任务定位到地图：居中 + 定位图标。 */
  function locateTask(location: { lon: number; lat: number; name: string }) {
    if (!map) return
    store.setTaskLocation(location)
    const latlng: [number, number] = [location.lat, location.lon]
    map.flyTo(latlng, Math.max(map.getZoom(), 15), { duration: 0.8 })
    if (marker) marker.remove()
    marker = L.circleMarker(latlng, {
      radius: 8, color: '#dc2626', weight: 2, fillColor: '#fca5a5', fillOpacity: 0.8,
    }).addTo(map)
  }

  function clearTaskLocation() {
    if (marker) { marker.remove(); marker = null }
    store.setTaskLocation(null)
  }

  function init(target: L.Map) { map = target }
  function destroy() { layer?.destroy(); clearTaskLocation() }

  return {
    init, destroy,
    enter,
    exit,
    selectDate,
    togglePlay,
    setOpacity,
    toggleVisible,
    setTab,
    drillToVillage,
    createTaskFromAnomaly,
    locateTask,
    clearTaskLocation,
    refresh,
  }
}
