import { watch } from 'vue'
import type { Ref } from 'vue'
import L from 'leaflet'
import type { FeatureCollection, Geometry } from 'geojson'
import type { useDrilldownStore, Crumb, Level } from '../../stores/drilldown'
import { useAgriMonitoringStore } from '../../stores/agriMonitoring'
import { createAgriLayerController, type AgriLayerController } from '../../map/agriMonitoringLayerController'
import {
  loadAgriRaster, loadAgriBusiness,
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
  drillToVillage(code: string): Promise<void>
  createTaskFromAnomaly(village: VillageGrowth): AgriTask | null
  locateTask(location: { lon: number; lat: number; name: string }): void
  clearTaskLocation(): void
  refresh(): void
}

export function useAgriMonitoringMode(ctx: AgriMonitoringContext): AgriMonitoringMode {
  const store = useAgriMonitoringStore()
  let map: L.Map | null = null
  let layer: AgriLayerController | null = null
  let marker: L.Marker | null = null

  async function loadAll() {
    const generation = store.generation
    try {
      const [raster, business] = await Promise.all([
        loadAgriRaster(), loadAgriBusiness(),
      ])
      const done = store.receive(generation, {
        raster,
        villagesByDate: business.villages,
        levelsByDate: business.levels.map((l) => l.byCode),
        tasksByDate: business.tasks,
        policyByDate: business.policyGrowth,
      })
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
    // 热力图裁剪跟随当前下钻区域（进入默认省界）
    void setCurrentClip()
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

  /** GeoJSON geometry → rings（[lon,lat] 数组），用于热力图裁剪。 */
  function geometryToRings(geometry: Geometry | null | undefined): Array<Array<[number, number]>> | null {
    if (!geometry) return null
    const rings: Array<Array<[number, number]>> = []
    const addPoly = (coords: number[][][]) => {
      for (const ring of coords) {
        const arr = ring.map((p) => [p[0], p[1]] as [number, number])
        if (arr.length >= 3) rings.push(arr)
      }
    }
    if (geometry.type === 'Polygon') addPoly(geometry.coordinates as number[][][])
    else if (geometry.type === 'MultiPolygon') for (const poly of geometry.coordinates as number[][][][]) addPoly(poly)
    return rings.length ? rings : null
  }

  /** 当前下钻区域的裁剪 rings（省/市/县/镇/村；省 base 无 geometry → null=省界）。 */
  function currentClipRings(): Array<Array<[number, number]>> | null {
    return geometryToRings(ctx.store.current.geometry)
  }

  /** 村级：加载本村 AI 田块 rings（热力图只盖在田块上，非田块不显示；空间索引保证不卡）。 */
  async function loadVillageFieldRings(code: string): Promise<Array<Array<[number, number]>> | null> {
    try {
      const fc = await fetchJSON<{ features?: Array<{ geometry?: Geometry | null }> }>(`/data/parcels/${code}.geojson`)
      const rings: Array<Array<[number, number]>> = []
      for (const f of fc.features ?? []) {
        const r = geometryToRings(f.geometry ?? null)
        if (r) rings.push(...r)
      }
      return rings.length ? rings : null
    } catch { return null }
  }

  /** 设当前裁剪：村级=AI 田块（只盖有地块处），其余=下钻区域（省/市/县/镇/村界）。 */
  async function setCurrentClip(): Promise<void> {
    const current = ctx.store.current
    let rings = currentClipRings()
    if (current.level === 'village') {
      const fieldRings = await loadVillageFieldRings(current.code)
      if (fieldRings) rings = fieldRings
    }
    layer?.setClip(rings)
  }

  // 下钻区域变化 → 热力图裁剪跟随
  watch(() => ctx.store.current, () => { void setCurrentClip() }, { immediate: true })

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
    const townshipCode = village.townshipCode
    const crumbs: Crumb[] = [{ level: 'province', code: '330000', name: '浙江省' }]
    const chain: Array<{ level: Level; code: string; url: string | null }> = [
      { level: 'city', code: cityCode, url: `/data/boundary/city/330000.geojson` },
      { level: 'county', code: countyCode, url: `/data/boundary/county/${cityCode}.geojson` },
      { level: 'township', code: townshipCode, url: `/data/boundary/township/${countyCode}.geojson` },
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

  async function drillToVillage(code: string) {
    const village = store.villages?.find((v) => v.code === code)
    if (village) await drillToVillageInner(village)
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
    marker = L.marker(latlng, {
      icon: L.divIcon({
        className: 'agri-loc-marker',
        html: '<div class="agri-loc-pin"></div>',
        iconSize: [20, 20],
        iconAnchor: [10, 10],
      }),
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
