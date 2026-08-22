import { computed, nextTick, ref, watch, type Ref } from 'vue'
import L from 'leaflet'
import type { FeatureCollection, Geometry } from 'geojson'
import type MapControlStack from '../../components/map/MapControlStack.vue'
import type { useDrilldownStore } from '../../stores/drilldown'
import type { ParcelMode } from '../parcels/parcelTypes'
import { useNationalAlarmStore } from '../../stores/nationalAlarms'
import { usePrecipitationStore } from '../../stores/precipitation'
import { useWeatherMarkersStore } from '../../stores/weatherMarkers'
import { useWeatherStore } from '../../stores/weather'
import { fetchJSON } from '../../api/data'
import { createNationalAlarmLayerController } from '../../map/nationalAlarmLayerController'
import { createWeatherInteractionController } from '../../map/weatherInteractionController'
import { createWeatherLayerController } from '../../map/weatherLayerController'
import { createWeatherMarkerLayerController } from '../../map/weatherMarkerLayerController'
import { createNationalAlarmRepository } from '../national-alarms/nationalAlarmRepository'
import { alarmsForMap, mapNotice } from '../national-alarms/nationalAlarmSelectors'
import type { NationalWeatherAlarm } from '../national-alarms/nationalAlarmTypes'
import { createWeatherMarkerRepository, type WeatherMarkerRepository } from './weatherMarkerRepository'
import { createWeatherRepository, type WeatherRepository } from './weatherRepository'
import { pickedWeatherQuery, weatherEntryState } from './weatherLifecycle'
import type { WeatherModuleKind } from './weatherTypes'

export interface WeatherModeContext {
  store: ReturnType<typeof useDrilldownStore>
  /** 地块模式（地块域持有），天气交互在此禁用编辑 */
  parcelMode: Ref<ParcelMode>
  /** 保单名册抽屉（地块域持有），进入天气时关闭 */
  rosterOpen: Ref<boolean>
  /** 台风模式激活标记（台风域持有） */
  disasterActive: Ref<boolean>
  /** 天气入口按钮（退出后焦点回退） */
  mapControlRef: Ref<InstanceType<typeof MapControlStack> | undefined>
  provinceGeometry(): Geometry | null
  weatherActive(): boolean
  weatherCurrentActive(): boolean
  nationalAlarmsActive(): boolean
  weatherEntry(): ReturnType<typeof weatherEntryState>
  exits: {
    typhoon(restoreView?: boolean): void
  }
  /** 天气菜单点降水模块：进入降水模式 */
  enterPrecipitation(): void
  /** 天气激活时已开降水：先退出降水 */
  exitPrecipitation(): void
  closeBusinessForDisaster(): void
  showNotice(message: string, error?: boolean): void
}

export interface WeatherMode {
  init(map: L.Map): void
  destroy(): void
  weatherPopupPosition: Ref<{ x: number; y: number }>
  nationalAlarmPopupPosition: Ref<{ x: number; y: number }>
  selectedNationalAlarm: Ref<NationalWeatherAlarm | null>
  currentCountyCode: Ref<string | null>
  nationalAlarmMapItems: Ref<ReturnType<typeof alarmsForMap>>
  nationalAlarmMapNotice: Ref<string>
  seatContextPath: Ref<string[]>
  enterWeatherMode(module: WeatherModuleKind): Promise<void>
  exitWeatherMode(): void
  enterNationalAlarms(): Promise<void>
  exitNationalAlarms(): void
  closeWeatherLocation(): void
  refreshWeather(): void
  refreshNationalAlarms(): void
  retryNationalAlarmDetail(): void
  selectNationalAlarmFromList(alarm: NationalWeatherAlarm): Promise<void>
  selectNationalAlarmFromMap(alarm: NationalWeatherAlarm, point: { x: number; y: number }): void
  /** 地图空白点击：关闭天气浮窗/预警选中 */
  onMapBlankClick(): void
  /** 行政导航后：清理点选状态并按新层级重开标牌 */
  onNavigate(): void
  /** 降水模式静默补拉预警数据（不打开面板，仅填充风险判定数据源） */
  silentLoadNationalAlarms(): void
  /** 选中地块时：清除点选天气 */
  deselectPicked(): void
}

export function useWeatherMode(ctx: WeatherModeContext): WeatherMode {
  const weatherStore = useWeatherStore()
  const weatherMarkersStore = useWeatherMarkersStore()
  const nationalAlarmStore = useNationalAlarmStore()
  const precipitationStore = usePrecipitationStore()
  const disasterActive = ctx.disasterActive

  let map!: L.Map
  let weatherLayerController: ReturnType<typeof createWeatherLayerController>
  let weatherMarkerLayerController: ReturnType<typeof createWeatherMarkerLayerController>
  let weatherInteractionController: ReturnType<typeof createWeatherInteractionController>
  let weatherRepository: WeatherRepository
  let weatherMarkerRepository: WeatherMarkerRepository
  let nationalAlarmRepository: ReturnType<typeof createNationalAlarmRepository>
  let nationalAlarmLayerController: ReturnType<typeof createNationalAlarmLayerController>

  const weatherPopupPosition = ref({ x: 0, y: 0 })
  const nationalAlarmPopupPosition = ref({ x: 0, y: 0 })
  const selectedNationalAlarm = computed(() => nationalAlarmStore.snapshot?.items.find((alarm) => alarm.id === nationalAlarmStore.selection?.id) ?? null)
  const currentCountyCode = computed(() => {
    for (let index = ctx.store.path.length - 1; index >= 0; index -= 1) {
      if (ctx.store.path[index]?.level === 'county') return ctx.store.path[index].code
    }
    return null
  })
  const nationalAlarmMapItems = computed(() => alarmsForMap(nationalAlarmStore.snapshot?.items ?? [], {
    level: ctx.store.current.level,
    code: ctx.store.current.code,
    countyCode: currentCountyCode.value,
  }))
  const nationalAlarmMapNotice = computed(() => ctx.nationalAlarmsActive()
    ? mapNotice(nationalAlarmStore.snapshot?.items ?? [], {
        level: ctx.store.current.level,
        code: ctx.store.current.code,
        countyCode: currentCountyCode.value,
      })
    : '')
  const seatContextPath = computed(() => {
    const marker = weatherMarkersStore.list.find((entry) => entry.code === weatherStore.selectedSeatCode)
    return marker ? [...ctx.store.path.map((crumb) => crumb.name), marker.name] : []
  })

  function weatherMarkerPlaceName() { return weatherStore.query?.contextName || ctx.store.current.name }

  async function enterWeatherMode(module: WeatherModuleKind) {
    if (module === 'alerts') { void enterNationalAlarms(); return }
    if (module === 'precipitation') { ctx.enterPrecipitation(); return }
    if (ctx.weatherActive() && weatherStore.module === module) return
    if (!ctx.weatherActive() && !ctx.weatherEntry().enabled) return
    if (disasterActive.value) ctx.exits.typhoon(false)
    if (precipitationStore.isOpen) ctx.exitPrecipitation()
    weatherRepository.exit()
    weatherMarkerRepository?.exit()
    weatherLayerController?.clear()
    weatherMarkerLayerController?.clear()
    ctx.rosterOpen.value = false
    weatherStore.open(module)
    if (module === 'current') {
      // 多级政府驻地标牌：打开实时天气即按当前层级拉取骨架与逐项摘要；乡镇/村/地块无预置标牌。
      weatherMarkerRepository?.open(ctx.store.current.level, ctx.store.current.code)
      weatherMarkerRepository?.startAutoRefresh()
    }
  }

  function exitWeatherMode() {
    weatherRepository.exit()
    weatherMarkerRepository?.exit()
    weatherLayerController?.clear()
    weatherMarkerLayerController?.clear()
    weatherStore.close()
    weatherMarkersStore.clear()
    void nextTick(() => ctx.mapControlRef.value?.focusWeather())
  }

  async function enterNationalAlarms() {
    if (ctx.nationalAlarmsActive()) return
    if (!ctx.weatherActive() && !ctx.weatherEntry().enabled) return
    if (disasterActive.value) ctx.exits.typhoon(false)
    if (precipitationStore.isOpen) ctx.exitPrecipitation()
    ctx.closeBusinessForDisaster()
    await ctx.store.resetToProvince()
    void nationalAlarmRepository.load(false, true)
  }

  function exitNationalAlarms() {
    nationalAlarmRepository.exit()
    nationalAlarmLayerController?.clear()
    // 保留 NMC 全省预警列表（snapshot）供风险判定复用：仅关闭模式 UI，不清数据（v3.11）
    nationalAlarmStore.phase = 'closed'
    nationalAlarmStore.selection = null
    nationalAlarmStore.detail = null
    void nextTick(() => ctx.mapControlRef.value?.focusWeather())
  }

  function refreshNationalAlarms() { void nationalAlarmRepository.load(true) }

  async function selectNationalAlarmFromList(alarm: NationalWeatherAlarm) {
    nationalAlarmStore.select({ id: alarm.id, source: 'list' })
    if (!alarm.mappableInZhejiang || !alarm.adminCode) { ctx.showNotice('该预警暂无法定位到当前地图', true); return }
    if (alarm.adminLevel === 'province') { await ctx.store.resetToProvince(); return }
    const cityCode = `${alarm.adminCode.slice(0, 4)}00`
    const cities = await fetchJSON<FeatureCollection>('/data/boundary/city/330000.geojson').catch(() => null)
    const city = cities?.features.find(feature => String(feature.properties?.code) === cityCode)
    if (!city) { ctx.showNotice('该预警暂无法定位到当前地图', true); return }
    await ctx.store.resetToProvince()
    await ctx.store.drill({ level: 'city', code: cityCode, name: String(city.properties?.name ?? ''), geometry: city.geometry })
    if (alarm.adminLevel === 'city') return
    const counties = await fetchJSON<FeatureCollection>(`/data/boundary/county/${cityCode}.geojson`).catch(() => null)
    const county = counties?.features.find(feature => String(feature.properties?.code) === alarm.adminCode)
    if (!county) { ctx.showNotice('该预警暂无法定位到当前地图', true); return }
    await ctx.store.drill({ level: 'county', code: alarm.adminCode, name: String(county.properties?.name ?? ''), geometry: county.geometry })
  }

  function selectNationalAlarmFromMap(alarm: NationalWeatherAlarm, point: { x: number; y: number }) {
    const same = nationalAlarmStore.selection?.id === alarm.id && nationalAlarmStore.selection.source === 'map'
    if (same) {
      nationalAlarmStore.select(null)
      return
    }
    nationalAlarmPopupPosition.value = point
    nationalAlarmStore.select({ id: alarm.id, source: 'map' })
    void nationalAlarmRepository.detail(alarm.id)
  }

  function retryNationalAlarmDetail() {
    const id = nationalAlarmStore.selection?.id
    if (id) void nationalAlarmRepository.detail(id, true)
  }

  function refreshWeather() { void weatherMarkerRepository?.retry(); void weatherRepository.retry() }

  function closeWeatherLocation() {
    weatherStore.selectedSeatCode = null
    const picked = weatherStore.closeLocation()
    if (picked) {
      weatherRepository.restore(weatherStore.defaultQuery)
      weatherLayerController.clearPicked()
      if (weatherStore.defaultBundle) weatherLayerController.renderDefault(weatherStore.defaultBundle, weatherMarkerPlaceName())
    }
  }

  function loadPickedWeather(lat: number, lon: number) {
    if (!ctx.weatherCurrentActive()) return
    weatherStore.selectedSeatCode = null
    weatherStore.closeLocation()
    weatherLayerController.clearPicked()
    weatherLayerController.renderLoading({ lat, lon }, 'picked', '地图点选')
    const p = map.latLngToContainerPoint([lat, lon])
    weatherPopupPosition.value = { x: p.x, y: p.y }
    weatherStore.openLocation('picked')
    void weatherRepository.load(pickedWeatherQuery(ctx.store.current, lat, lon)).then(() => {
      if (weatherStore.bundle?.target === 'picked') weatherLayerController.renderPicked(weatherStore.bundle, '地图点选')
    })
  }

  function onSeatMarkerClick(code: string, point: { x: number; y: number }) {
    if (!ctx.weatherCurrentActive()) return
    const item = weatherMarkersStore.list.find((entry) => entry.code === code)
    if (!item) return
    weatherPopupPosition.value = point
    weatherStore.selectedSeatCode = code
    weatherStore.openLocation('default')
    void weatherRepository.load({ contextLevel: item.level, contextCode: item.code, contextName: item.name, target: 'seat' })
  }

  function updateWeatherPopupPosition() {
    if (!ctx.weatherCurrentActive() || weatherStore.locationPopup === 'none') return
    if (weatherStore.bundle?.target === 'seat' && weatherStore.selectedSeatCode) {
      const display = weatherMarkerLayerController?.displayPoint(weatherStore.selectedSeatCode)
      if (display) {
        weatherPopupPosition.value = display
        return
      }
    }
    if (!weatherStore.bundle) return
    const point = weatherStore.bundle.target === 'picked' ? weatherStore.bundle.originalLocation : weatherStore.bundle.location
    const p = map.latLngToContainerPoint([point.lat, point.lon])
    weatherPopupPosition.value = { x: p.x, y: p.y }
  }

  function updateNationalAlarmPopupPosition() {
    const alarm = selectedNationalAlarm.value
    if (!ctx.nationalAlarmsActive() || nationalAlarmStore.selection?.source !== 'map' || !alarm?.mapLocation.point) return
    const [lon, lat] = alarm.mapLocation.point
    const p = map.latLngToContainerPoint([lat, lon])
    nationalAlarmPopupPosition.value = { x: p.x, y: p.y }
  }

  function updateMapPopupPositions() {
    updateWeatherPopupPosition()
    updateNationalAlarmPopupPosition()
  }

  function onMapBlankClick() {
    if (ctx.weatherCurrentActive() && weatherStore.locationPopup !== 'none') closeWeatherLocation()
    if (ctx.nationalAlarmsActive() && nationalAlarmStore.selection?.source === 'map') nationalAlarmStore.select(null)
  }

  function onNavigate() {
    if (ctx.nationalAlarmsActive()) {
      if (nationalAlarmStore.selection?.source === 'map') nationalAlarmStore.select(null)
      nationalAlarmLayerController?.clear()
    }
    if (!ctx.weatherActive()) return
    weatherStore.selection = null
    weatherStore.locationPopup = 'none'
    weatherStore.selectedSeatCode = null
    if (ctx.weatherCurrentActive()) {
      weatherLayerController?.clearPicked()
      weatherMarkerLayerController?.clear()
      weatherMarkerRepository?.open(ctx.store.current.level, ctx.store.current.code)
    }
  }

  function silentLoadNationalAlarms() {
    nationalAlarmStore.beginSilent()
    void nationalAlarmRepository.load().finally(() => {
      nationalAlarmStore.endSilent()
      if (nationalAlarmStore.phase !== 'closed') nationalAlarmStore.phase = 'closed'
    })
  }

  function deselectPicked() {
    weatherLayerController?.clearPicked()
    weatherStore.selectedSeatCode = null
    weatherStore.locationPopup = 'none'
  }

  // 浮窗与标牌共用政府驻地坐标：bundle 刷新后同步对应标牌，避免上游天气变化后浮窗新、标牌旧导致图标不一致。
  watch(() => weatherStore.bundle, (bundle) => {
    if (!ctx.weatherCurrentActive() || !bundle) return
    if (bundle.target === 'picked') weatherLayerController?.renderPicked(bundle, '地图点选')
    if (bundle.target === 'seat' && weatherStore.selectedSeatCode) {
      const current = bundle.current
      if (current.status === 'success') {
        weatherMarkersStore.setReady(weatherMarkersStore.generation, weatherStore.selectedSeatCode, {
          condition: current.data.condition,
          temperature: current.data.temperature,
          high: current.data.high,
          low: current.data.low,
          fetchedAt: bundle.fetchedAt,
        })
      }
    }
  })
  watch(() => weatherStore.phase, (phase) => {
    if (!ctx.weatherCurrentActive() || phase !== 'error' || weatherStore.bundle) return
    const query = weatherStore.query
    if (query?.target !== 'picked') return
    if (query.lat != null && query.lon != null) weatherLayerController?.renderError({ lat: query.lat, lon: query.lon }, 'picked', '地图点选')
  })
  // 多级政府驻地标牌：骨架/逐项成功/失败/选中变化都重建集合；旧层级流事件不会进入新层级（store generation 守卫）。
  watch(() => [weatherMarkersStore.phase, weatherMarkersStore.list, weatherStore.selectedSeatCode] as const, () => {
    if (!ctx.weatherCurrentActive() || weatherMarkersStore.phase === 'closed') {
      weatherMarkerLayerController?.clear()
      return
    }
    weatherMarkerLayerController?.render(weatherMarkersStore.list, weatherStore.selectedSeatCode)
  }, { deep: true })
  // Do not rebuild markers when hover selection changes: replacing the button beneath
  // a stationary pointer emits a new mouseover and immediately reopens a just-closed popup.
  watch(() => [ctx.nationalAlarmsActive(), nationalAlarmStore.snapshot, ctx.store.current.code] as const, () => {
    if (!ctx.nationalAlarmsActive()) {
      nationalAlarmLayerController?.clear()
      return
    }
    nationalAlarmLayerController?.render(nationalAlarmMapItems.value, nationalAlarmStore.selection?.id ?? null)
  }, { deep: true })
  watch(() => nationalAlarmStore.selection?.id, (id) => {
    if (!id || nationalAlarmStore.selection?.source !== 'map') return
    if (!nationalAlarmMapItems.value.some((alarm) => alarm.id === id)) nationalAlarmStore.select(null)
  })

  function init(target: L.Map) {
    map = target
    weatherLayerController = createWeatherLayerController(map, {
      onLocationClick: (kind, point) => {
        weatherPopupPosition.value = point
        weatherStore.openLocation(kind)
      },
      onAlertClick: (selection, point) => {
        weatherPopupPosition.value = point
        weatherStore.selectAlert(selection)
      },
    })
    weatherMarkerLayerController = createWeatherMarkerLayerController(map, {
      onMarkerClick: (code, point) => { onSeatMarkerClick(code, point) },
    })
    weatherInteractionController = createWeatherInteractionController(map, {
      active: () => ctx.weatherCurrentActive(),
      editing: () => ctx.parcelMode.value !== 'idle',
      provinceGeometry: () => ctx.provinceGeometry(),
      onPicked: loadPickedWeather,
      onOutside: () => ctx.showNotice('天气当前仅支持浙江省范围', true),
    })
    weatherRepository = createWeatherRepository(weatherStore)
    weatherMarkerRepository = createWeatherMarkerRepository({
      begin: (level, code) => weatherMarkersStore.begin(level, code),
      targets: (g, l, c, t) => weatherMarkersStore.setTargets(g, l, c, t),
      ready: (g, c, s) => weatherMarkersStore.setReady(g, c, s),
      fail: (g, c, e) => weatherMarkersStore.setFail(g, c, e),
      streamFail: (g, e) => weatherMarkersStore.setStreamFail(g, e),
    })
    nationalAlarmRepository = createNationalAlarmRepository(nationalAlarmStore)
    nationalAlarmLayerController = createNationalAlarmLayerController(map, { onOpen: selectNationalAlarmFromMap })
    map.on('move zoom', updateMapPopupPositions)
  }

  function destroy() {
    weatherInteractionController?.destroy()
    weatherLayerController?.destroy()
    nationalAlarmLayerController?.destroy()
  }

  return {
    init,
    destroy,
    weatherPopupPosition,
    nationalAlarmPopupPosition,
    selectedNationalAlarm,
    currentCountyCode,
    nationalAlarmMapItems,
    nationalAlarmMapNotice,
    seatContextPath,
    enterWeatherMode,
    exitWeatherMode,
    enterNationalAlarms,
    exitNationalAlarms,
    closeWeatherLocation,
    refreshWeather,
    refreshNationalAlarms,
    retryNationalAlarmDetail,
    selectNationalAlarmFromList,
    selectNationalAlarmFromMap,
    onMapBlankClick,
    onNavigate,
    silentLoadNationalAlarms,
    deselectPicked,
  }
}
