<template>
  <div class="map-wrap" :class="{ 'parcel-editing': parcelMode !== 'idle', 'parcel-drawing': parcelMode === 'drawing', 'typhoon-timeline-open': disasterActive && typhoonStore.timelineOpen }">
    <div ref="mapEl" class="map"></div>

    <NationalAlarmPanel v-if="nationalAlarmsActive" :phase="nationalAlarmStore.phase" :snapshot="nationalAlarmStore.snapshot" :selection="nationalAlarmStore.selection" :error-message="nationalAlarmStore.errorMessage" @refresh="refreshNationalAlarms" @close="exitNationalAlarms" @select="selectNationalAlarmFromList" />
    <NationalAlarmPopup v-if="nationalAlarmsActive && selectedNationalAlarm && nationalAlarmStore.selection?.source==='map'" :alarm="selectedNationalAlarm" :detail="nationalAlarmStore.detail" :x="nationalAlarmPopupPosition.x" :y="nationalAlarmPopupPosition.y" @close="nationalAlarmStore.select(null)" @retry="retryNationalAlarmDetail" />
    <div v-if="nationalAlarmMapNotice" class="save-notice national-alarm-map-notice" role="status">{{ nationalAlarmMapNotice }}</div>
    <div v-if="disasterActive && typhoonStore.hasNoActiveTyphoon" class="typhoon-empty-notice" role="status">
      <strong class="notice-title">当前无活跃台风</strong>
      <span class="notice-desc">可查看当年历史台风</span>
    </div>
    <div v-if="weatherPickHintVisible" class="weather-shortcut-hint" role="status"><kbd>Ctrl</kbd><span>+</span><span>左键单击可以按点选查询天气</span></div>
    <WeatherPopup v-if="weatherCurrentActive && weatherStore.locationPopup !== 'none'" kind="location" title="实时天气" :bundle="weatherStore.bundle" :phase="weatherStore.phase" :error-message="weatherStore.errorMessage" :context-name="weatherStore.selectedSeatCode ? weatherMarkersStore.list.find((m) => m.code === weatherStore.selectedSeatCode)?.name : weatherStore.query?.contextName" :context-path="weatherStore.selectedSeatCode ? seatContextPath : store.path.map((crumb) => crumb.name)" :x="weatherPopupPosition.x" :y="weatherPopupPosition.y" @close="closeWeatherLocation" @retry="refreshWeather" />

    <DisasterWorkbenchPanel
      v-if="workbenchActive"
      :active-tabs="workbenchActiveTabs"
      :active-tab="workbenchTab"
      :collapsed="workbenchCollapsed"
      :timeline-open="disasterActive && typhoonStore.timelineOpen"
      :close-label="workbenchCloseLabel"
      @select-tab="selectWorkbenchTab"
      @toggle-collapsed="workbenchCollapsed = !workbenchCollapsed"
      @close="closeWorkbench"
    >
      <template #typhoon>
        <TyphoonPathPanel
          v-if="disasterActive"
          :phase="typhoonStore.phase"
          :realtime-count="typhoonStore.realtimeDetails.length"
          :model="typhoonPanelModel"
          :timeline-open="typhoonStore.timelineOpen"
          :reveal-token="typhoonRevealToken"
          @toggle="toggleTyphoonCard"
          @close-history="closeHistoricalTyphoon"
          @select-node="selectTyphoonPanelNode"
        />
      </template>
      <template #risk>
        <VillageRiskOverview
          v-if="precipitationStore.isOpen && !villageCard"
          :model="riskOverviewModel"
          :precip-loading="precipitationStore.phase === 'loading'"
          :snapshot-error="riskSnapshotError"
          @select-village="selectVillageFromOverview"
        />
        <VillageRiskCard
          v-if="precipitationStore.isOpen && villageCard"
          :model="villageCard.model"
          @back="backFromVillageDetail"
        />
      </template>
    </DisasterWorkbenchPanel>

    <!-- 水稻倒伏评估概览卡片（地块详情打开时隐藏，避免遮挡） -->
    <div v-if="lodgingMode.isActive.value && !selectedParcel" class="lodging-overview-container">
      <LodgingAssessmentOverview
        :model="lodgingMode.overviewModel.value"
        :loading="lodgingMode.isLoading.value"
        @select-region="handleLodgingRegionSelect"
        @view-all-parcels="lodgingParcelDrawerOpen = true"
      />
    </div>

    <!-- 水稻倒伏地块抽屉 -->
    <LodgingParcelDrawer
      :open="lodgingParcelDrawerOpen"
      :parcels="lodgingMode.parcelDrawerRows.value"
      :selected-parcel-id="selectedLodgingParcelId"
      @close="lodgingParcelDrawerOpen = false"
      @select-parcel="handleLodgingParcelSelect"
    />

    <!-- 全局 Toast -->
    <AppToast ref="toastRef" />

    <TyphoonHoverPopup
      v-if="disasterActive"
      :model="typhoonHoverModel"
      :x="typhoonHoverPosition.x"
      :y="typhoonHoverPosition.y"
      :viewport-width="mapViewport.width"
      :viewport-height="mapViewport.height"
    />

    <TyphoonTimelineDrawer
      v-if="disasterActive"
      :open="typhoonStore.timelineOpen"
      :model="typhoonTimelineModel"
      :focused-typhoon-id="typhoonStore.focusedTyphoonId"
      @toggle-drawer="typhoonStore.setTimelineOpen(!typhoonStore.timelineOpen)"
      @toggle-history="toggleHistoricalFromTimeline"
    />

    <PrecipitationPanel
      v-if="precipitationStore.isOpen"
      :phase="precipitationStore.phase"
      :snapshot="precipitationStore.snapshot"
      :selected-day="precipitationStore.selectedDay"
      :playing="precipitationStore.playing"
      :opacity="precipitationStore.opacity"
      :error-message="precipitationStore.errorMessage"
      :show-stale="precipitationStore.showStale"
      @close="exitPrecipitationMode"
      @select-day="selectPrecipDay"
      @toggle-play="togglePrecipPlay"
      @set-opacity="setPrecipOpacity"
      @refresh="refreshPrecipitation"
    />

    <!-- 农情监测：右上角 tab 面板 + 底部居中多日期浮窗 -->
    <AgriMonitoringPanel
      v-if="agriMonitoringStore.isOpen"
      @close="exitAgriMonitoring"
      @select-tab="setAgriTab"
      @select-village="handleAgriSelectVillage"
      @select-child="handleAgriSelectChild"
      @locate-task="locateAgriTask"
      @close-task="clearAgriTaskLocation"
    />
    <div v-if="agriMonitoringStore.isOpen && agriMonitoringStore.visible" class="agri-legend" aria-label="长势 5 级图例">
      <span v-for="lv in agriLegend" :key="lv.key" class="agri-legend-item"><i class="agri-legend-swatch" :style="{ background: lv.color }"></i>{{ lv.label }}</span>
    </div>
    <AgriDateControl
      v-if="agriMonitoringStore.isOpen"
      :phase="agriMonitoringStore.phase"
      :dates="agriMonitoringStore.dates"
      :selected-date="agriMonitoringStore.selectedDate"
      :playing="agriMonitoringStore.playing"
      :opacity="agriMonitoringStore.opacity"
      :error-message="agriMonitoringStore.errorMessage"
      :visible="agriMonitoringStore.visible"
      @close="exitAgriMonitoring"
      @select-date="selectAgriDate"
      @toggle-play="toggleAgriPlay"
      @set-opacity="setAgriOpacity"
      @toggle-visible="toggleAgriVisible"
      @refresh="agriMode.refresh"
    />

    <!-- 村级地块业务操作：入口位于右下角，进入模式后在右上角显示完整工具栏。 -->
    <ParcelEditToolbar
      v-if="store.current.level === 'village' && parcelMode !== 'idle'"
      :mode="parcelMode"
      :hidden-count="hiddenParcelCount"
      :pending-hide-count="pendingHideCount"
      :pending-restore-count="pendingRestoreCount"
      :pending-change-count="pendingChangeCount"
      :batch-saved-count="batchSavedCount"
      :draft-point-count="manualDraftPoints.length"
      :batch-has-changes="batchHasChanges"
      :draft-area-text="manualDraftAreaText"
      @restore-all="restoreAllHiddenParcels"
      @save-filter="saveParcelEdits"
      @cancel-filter="cancelParcelEditing"
      @start-drawing="startBatchDrawing"
      @exit-drawing="exitBatchDrawing"
      @undo-manual="undoManualPoint"
      @save-batch="saveManualBatch"
      @cancel-batch="cancelManualBatch()"
      @save-manual-edit="saveManualDraft"
      @cancel-manual-edit="cancelManualSession"
    />

    <div v-if="parcelMode === 'batch' || parcelMode === 'drawing'" class="draw-shortcut-hint" role="status">
      <span>按</span>
      <kbd>N</kbd>
      <span>开始绘制，再次按</span>
      <kbd>N</kbd>
      <span>完成操作</span>
    </div>

    <div v-if="saveNotice" class="save-notice" :class="{ error: saveNoticeError }" role="status" aria-live="polite">
      {{ saveNotice }}
    </div>

    <Transition name="side-drawer">
      <ParcelDetailPanel
        v-if="selectedParcel && selectedPolicyContext"
        ref="detailPanelRef"
        :parcel="selectedParcel"
        :village-code="parcelVillageCode"
        :village-name="store.current.name"
        :policy="selectedPolicyContext"
        :roster-party-display="selectedRosterPartyDisplay"
        :records="selectedCultivationRecords"
        :initial-record-keys="selectedInitialRecordKeys"
        @request-close="requestCloseDetail"
        @request-restore="requestRestoreCultivation"
        @save-record="saveCultivationRecord"
        @remove-record="removeCultivationRecord"
        @editing-change="cultivationEditing = $event"
        @open-roster="rosterOpen = true"
      />
    </Transition>
    <Transition name="side-drawer">
      <PolicyRosterDrawer
        v-if="rosterOpen && selectedPolicyContext?.currentPolicy?.insuredMode === 'insured_roster'"
        :policy="selectedPolicyContext.currentPolicy"
        :items="selectedRosterItems"
        :parties="policyFixture?.parties ?? []"
        :village-name="store.current.level === 'village' ? store.current.name : ''"
        @close="rosterOpen = false"
        @select="selectRosterItem"
      />
    </Transition>

    <div v-if="businessLoadErrorVisible" class="business-load-error" role="alert">
      <strong>当前区域暂无地块数据</strong>
    </div>

    <ManualConfirmDialog
      :open="manualDialog.open"
      :title="manualDialog.title"
      :message="manualDialog.message"
      :confirm-label="manualDialog.confirmLabel"
      @close="closeManualDialog"
    />

    <ParcelStatusCard
      :mode="parcelMode"
      :parcel-visible="parcelVisible"
      :parcel-on="parcelOn"
      :display-count="parcelDisplayCount"
      :display-area-text="parcelDisplayAreaText"
      :rs-hint="rsHint"
      :rs-visible="rsVisible"
    />

    <ParcelVisualLegend
      v-if="parcelVisualMode !== 'parcel'"
      :title="parcelVisualMode === 'planting' ? '种植情况' : '保险状态'"
      :entries="parcelVisualMode === 'planting' ? plantingLegend() : insuranceLegend()"
      :enabled-categories="parcelVisualMode === 'planting' ? plantingEnabledCategories : insuranceEnabledCategories"
      :empty="parcelVisualMode === 'planting' ? plantingDataEmpty : insuranceDataEmpty"
      :empty-text="parcelVisualMode === 'planting' ? '当前暂无种植数据' : '当前暂无保险数据'"
      :error="parcelVisualMode === 'planting' ? cultivationLoadError : policyLoadError"
      @retry="retryBusinessData"
      @toggle-category="onLegendToggleCategory"
    />

    <MapControlStack
      ref="mapControlRef" :basemap="basemap"
      :rs-visible="rsVisible"
      :rs-on="rsOn"
      :parcel-visible="parcelVisible"
      :parcel-on="parcelOn"
      :mode="parcelMode"
      :can-zoom-in="canZoomIn"
      :can-zoom-out="canZoomOut"
      :parcel-tools-visible="store.current.level === 'village' || disasterActive || anyWeatherActive || precipitationStore.isOpen"
      :parcel-tools-disabled="parcelMode !== 'idle' || disasterActive || anyWeatherActive || precipitationStore.isOpen"
      :has-filterable-parcels="hasFilterableParcels"
      :disaster-entry-disabled="disasterEntryDisabled || anyWeatherActive"
      :disaster-active="disasterActive"
      :weather-entry-disabled="!weatherEntry.enabled && !anyWeatherActive"
      :weather-entry-reason="anyWeatherActive ? '选择天气查看模块' : weatherEntry.reason"
      :weather-active="anyWeatherActive"
      :weather-modules="activeWeatherModules"
      :parcel-visual-mode-visible="parcelVisualModeVisible"
      :parcel-visual-mode="parcelVisualMode"
      :lodging-entry-disabled="lodgingMode.entryDisabled.value"
      :lodging-entry-reason="lodgingMode.entryReason.value"
      :lodging-assessment-active="lodgingMode.isActive.value"
      :lodging-demo-mode="lodgingMode.isDemoMode.value"
      :agri-monitoring-active="agriMonitoringStore.isOpen"
      @switch-basemap="switchBasemap"
      @toggle-rs="toggleRs"
      @toggle-parcels="toggleParcels"
      @set-visual-mode="setVisualMode"
      @start-manual="startManualDrawing"
      @start-filter="startParcelEditing"
      @open-typhoon="enterTyphoonMode"
      @open-weather="enterWeatherMode"
      @close-weather="closeWeatherFromToolbar"
      @zoom-in="zoomIn"
      @zoom-out="zoomOut"
      @enter-lodging-assessment="lodgingMode.enterAssessmentMode()"
      @exit-lodging-assessment="lodgingMode.exitAssessmentMode()"
      @toggle-lodging-demo-mode="lodgingMode.toggleDemoMode()"
      @open-agri-monitoring="enterAgriMonitoring"
      @exit-agri-monitoring="exitAgriMonitoring"
    />
  </div>
</template>

<script setup lang="ts">
import { computed, nextTick, onMounted, onBeforeUnmount, ref, watch } from 'vue'

import L from 'leaflet'
import ManualConfirmDialog from './map/ManualConfirmDialog.vue'
import MapControlStack from './map/MapControlStack.vue'
import ParcelEditToolbar from './map/ParcelEditToolbar.vue'
import ParcelStatusCard from './map/ParcelStatusCard.vue'
import ParcelVisualLegend from './map/ParcelVisualLegend.vue'
import ParcelDetailPanel from './map/ParcelDetailPanel.vue'
import PolicyRosterDrawer from './map/PolicyRosterDrawer.vue'
import TyphoonPathPanel from './typhoon/TyphoonPathPanel.vue'
import TyphoonTimelineDrawer from './typhoon/TyphoonTimelineDrawer.vue'
import DisasterWorkbenchPanel, { type WorkbenchTab } from './disaster/DisasterWorkbenchPanel.vue'
import VillageRiskOverview from './village-risk/VillageRiskOverview.vue'
import PrecipitationPanel from './precipitation/PrecipitationPanel.vue'
import VillageRiskCard from './village-risk/VillageRiskCard.vue'
import TyphoonHoverPopup from './typhoon/TyphoonHoverPopup.vue'
import WeatherPopup from './weather/WeatherPopup.vue'
import NationalAlarmPanel from './weather/NationalAlarmPanel.vue'
import NationalAlarmPopup from './weather/NationalAlarmPopup.vue'
import type { Feature, FeatureCollection, Geometry } from 'geojson'
import type { ParcelMode } from '../features/parcels/parcelTypes'
import { plantingLegend, insuranceLegend } from '../features/parcels/parcelVisualMode'
import { createMapNavigationController, type MapNavigationController } from '../map/mapNavigationController'
import { autoLevelAllowed } from '../features/typhoon/disasterModeLifecycle'
import { useTyphoonMode } from '../features/typhoon/useTyphoonMode'
import { useTyphoonStore } from '../stores/typhoon'
import { useWeatherStore } from '../stores/weather'
import { useWeatherMarkersStore } from '../stores/weatherMarkers'
import { useNationalAlarmStore } from '../stores/nationalAlarms'
import { usePrecipitationStore } from '../stores/precipitation'
import { weatherEntryState } from '../features/weather/weatherLifecycle'
import type { WeatherModuleKind } from '../features/weather/weatherTypes'
import { useLodgingAssessmentMode } from '../features/lodging/useLodgingAssessmentMode'
import { useAgriMonitoringMode } from '../features/agri-monitoring/useAgriMonitoringMode'
import { useAgriMonitoringStore } from '../stores/agriMonitoring'
import { LEVEL_COLORS, LEVEL_LABELS, GROWTH_LEVELS } from '../features/agri-monitoring/agriMonitoringTypes'
import AgriMonitoringPanel from './agri-monitoring/AgriMonitoringPanel.vue'
import AgriDateControl from './agri-monitoring/AgriDateControl.vue'
import LodgingAssessmentOverview from './lodging/LodgingAssessmentOverview.vue'
import LodgingParcelDrawer from './lodging/LodgingParcelDrawer.vue'
import AppToast from './ui/AppToast.vue'
import { useWeatherMode } from '../features/weather/useWeatherMode'
import { usePrecipitationMode } from '../features/precipitation/usePrecipitationMode'
import { useParcelWorkbench } from '../features/parcels/useParcelWorkbench'
import {
  useDrilldownStore,
  childrenUrl,
  NEXT_LEVEL,
  LEVEL_WEIGHT,
  type Level,
} from '../stores/drilldown'
import { createBasemaps, type Basemaps, type BasemapKey } from '../api/tianditu'
import { switchBasemap as applyBasemapSwitch } from '../map/basemapSwitcher'
import { fetchJSON, fetchRsInfo, type RsInfo } from '../api/data'
import { pointInGeometry } from '../utils/geo'

// 缩放下钻阈值: 放大进入下一级 / 缩小退回上级(差 0.5 级防抖滞后)
const ENTER_ZOOM: Partial<Record<string, number>> = {
  province: 9.5,
  city: 11.5,
  county: 13.5,
  township: 15.5,
}
const EXIT_ZOOM: Partial<Record<string, number>> = {
  city: 9.0,
  county: 11.0,
  township: 13.0,
  village: 15.0,
}

const THEME = '#38bdf8' // 统一主题色(决策#14)
const HOVER = '#facc15'
const DEFAULT_MIN_ZOOM = 3.5
const PARCEL_EDIT_MIN_ZOOM = 15.25 // 高于村级 z<=15.0 自动退出阈值

const mapEl = ref<HTMLDivElement>()
const mapControlRef = ref<InstanceType<typeof MapControlStack>>()
const store = useDrilldownStore()
// 跨域共享的 UI 状态：saveNotice 为多域提示；parcelMode/rosterOpen/parcelVisible/parcelOn/detailPanelRef 由地块域写入、模板与天气/台风域读取。
const saveNotice = ref('')
const saveNoticeError = ref(false)
const parcelMode = ref<ParcelMode>('idle')
const rosterOpen = ref(false)
const parcelVisible = ref(false)
const parcelOn = ref(true)
const parcelVisualModeVisible = computed(() => parcelVisible.value && parcelOn.value && store.current.level === 'village')
const detailPanelRef = ref<InstanceType<typeof ParcelDetailPanel>>()
const typhoonStore = useTyphoonStore()
const weatherStore = useWeatherStore()
const weatherMarkersStore = useWeatherMarkersStore()
const nationalAlarmStore = useNationalAlarmStore()
const precipitationStore = usePrecipitationStore()
// 共用面板（台风路径 / 风险概览 双 tab）
const workbenchTab = ref<WorkbenchTab>('typhoon')
const workbenchCollapsed = ref(false)
const workbenchActive = computed(() => disasterActive.value || precipitationStore.isOpen)
const workbenchActiveTabs = computed<WorkbenchTab[]>(() => {
  const tabs: WorkbenchTab[] = []
  if (disasterActive.value) tabs.push('typhoon')
  if (precipitationStore.isOpen) tabs.push('risk')
  return tabs
})
const workbenchCloseLabel = computed(() => (workbenchTab.value === 'typhoon' ? '关闭台风路径并退出灾害风险模式' : '关闭风险概览并退出降雨量模式'))
const nationalAlarmsActive = computed(()=>nationalAlarmStore.isOpen)
const disasterActive = ref(false)
const weatherActive = computed(()=>weatherStore.isOpen)
const anyWeatherActive = computed(()=>weatherActive.value||nationalAlarmsActive.value)
const weatherCurrentActive = computed(()=>weatherActive.value&&weatherStore.module==='current')
const activeWeatherModules = computed<WeatherModuleKind[]>(() => {
  const list: WeatherModuleKind[] = []
  if (weatherActive.value && weatherStore.module) list.push(weatherStore.module)
  if (nationalAlarmsActive.value) list.push('alerts')
  if (precipitationStore.isOpen) list.push('precipitation')
  return list
})
// 按点查询提示只在乡镇及以下显示（省/市/县有常驻标牌，无需提示）。
const weatherPickHintVisible = computed(()=>weatherCurrentActive.value&&(store.current.level==='township'||store.current.level==='village'))
const disasterEntryDisabled = computed(() => parcelHasUnsavedWork())
const weatherEntry = computed(()=>weatherEntryState({mode:disasterActive.value?'typhoon':anyWeatherActive.value?'weather':'none',crumb:store.current,hasUnsavedWork:parcelHasUnsavedWork()}))
const mapViewport = ref({ width: 0, height: 0 })
const rsVisible = ref(false)
const rsHint = ref('')
const rsOn = ref(true)
const currentZoom = ref(DEFAULT_MIN_ZOOM)
const mapMinZoom = ref(DEFAULT_MIN_ZOOM)
const canZoomIn = computed(() => currentZoom.value < 19)
const canZoomOut = computed(() => currentZoom.value > mapMinZoom.value)
const RS_OPACITY = 0.7
const basemap = ref<BasemapKey>('img')
// Canvas 渲染器: 百余个复杂多边形时比默认 SVG 渲染流畅一个量级
const canvasRenderer = L.canvas({ padding: 0.5 })

let map: L.Map
let navigationController: MapNavigationController
let provinceGeometry: Geometry | null = null
let zoomLevelOutput: HTMLOutputElement | null = null
let saveNoticeTimer: ReturnType<typeof setTimeout> | null = null
let rsInfo: RsInfo | null = null
let flySeq = 0
let disposed = false
let firstRender = true
const pendingNoFly = ref(false) // 自动切换层级时不重排视野(决策: 不动视野)
let suppressAutoZoom = false // 点击下钻/返回的程序化缩放不得触发自动进退层级
let lastZoom = DEFAULT_MIN_ZOOM // 上一次 zoomend 的缩放级, 用于区分放大/缩小方向
let basemaps: Basemaps
let beforeUnloadHandler: ((event: BeforeUnloadEvent) => void) | null = null
let provinceRenderPromise: Promise<void> | null = null

// 地块域在最后创建；台风/天气/降水依赖的 hasUnsavedParcelWork 与 closeBusinessPanels 经 holder 延迟绑定，避免循环依赖。
let parcelHasUnsavedWork: () => boolean = () => false
let closeBusinessPanels: () => void = () => {}

const typhoonMode = useTyphoonMode({
  store,
  disasterActive,
  workbenchTab,
  pendingNoFly,
  viewportWidth: () => mapViewport.value.width,
  anyWeatherActive: () => anyWeatherActive.value,
  hasUnsavedParcelWork: () => parcelHasUnsavedWork(),
  closeBusinessForDisaster: () => closeBusinessPanels(),
  prepareProvinceLayers: prepareProvinceLayersWithoutMovingCamera,
  renderProvinceView,
  invalidateNavigation,
  showNotice,
})
const {
  typhoonRevealToken,
  typhoonHoverModel,
  typhoonPanelModel,
  typhoonTimelineModel,
  typhoonHoverPosition,
  toggleTyphoonCard,
  closeHistoricalTyphoon,
  selectTyphoonPanelNode,
  toggleHistoricalFromTimeline,
  enterTyphoonMode,
} = typhoonMode

// 降水模式在 weatherMode 之后创建；天气与降水的互斥进入/退出经 holder 延迟绑定，避免循环依赖。
let precipitationEnter: () => void = () => {}
let precipitationExit: () => void = () => {}
const weatherMode = useWeatherMode({
  store,
  parcelMode,
  rosterOpen,
  mapControlRef,
  disasterActive,
  provinceGeometry: () => provinceGeometry,
  weatherActive: () => weatherActive.value,
  weatherCurrentActive: () => weatherCurrentActive.value,
  nationalAlarmsActive: () => nationalAlarmsActive.value,
  weatherEntry: () => weatherEntry.value,
  exits: {
    typhoon: (restoreView) => typhoonMode.exitTyphoonMode(restoreView),
  },
  enterPrecipitation: () => precipitationEnter(),
  exitPrecipitation: () => precipitationExit(),
  closeBusinessForDisaster: () => closeBusinessPanels(),
  showNotice,
})
const {
  weatherPopupPosition,
  nationalAlarmPopupPosition,
  selectedNationalAlarm,
  nationalAlarmMapNotice,
  seatContextPath,
  enterWeatherMode,
  exitNationalAlarms,
  closeWeatherLocation,
  refreshWeather,
  refreshNationalAlarms,
  retryNationalAlarmDetail,
  selectNationalAlarmFromList,
} = weatherMode

const precipitationMode = usePrecipitationMode({
  store,
  disasterActive,
  workbenchTab,
  workbenchCollapsed,
  pendingNoFly,
  anyWeatherActive: () => anyWeatherActive.value,
  hasUnsavedParcelWork: () => parcelHasUnsavedWork(),
  exits: {
    weather: () => weatherMode.exitWeatherMode(),
    nationalAlarms: () => weatherMode.exitNationalAlarms(),
  },
  silentLoadNationalAlarms: () => weatherMode.silentLoadNationalAlarms(),
  typhoonRepositoryEnter: () => { void typhoonMode.typhoonRepository.enter() },
  render: () => render(),
})
precipitationEnter = () => { void precipitationMode.enterPrecipitationMode() }
precipitationExit = () => precipitationMode.exitPrecipitationMode()

// 水稻倒伏评估模式
const toastRef = ref<InstanceType<typeof AppToast>>()
const lodgingParcelDrawerOpen = ref(false)
const selectedLodgingParcelId = ref<string | null>(null)

function handleLodgingRegionSelect(code: string) {
  // 村级视图：Top 10 点击的是地块（code = parcelId），打开详情弹窗
  if (store.current.level === 'village') {
    handleLodgingParcelSelect(code)
    return
  }
  // 非村级：点击子区划 → drilldown
  const feature = lodgingMode.getChildFeature(code)
  if (!feature) return
  const level = store.current.level
  const nextLevel = NEXT_LEVEL[level]
  if (!nextLevel) return
  const name = String(feature.properties?.name ?? code)
  void store.drill({
    level: nextLevel,
    code,
    name,
    geometry: feature.geometry,
  })
}

function handleLodgingParcelSelect(parcelId: string) {
  selectedLodgingParcelId.value = parcelId
  // 先关闭抽屉，避免其 z-index(2000) 遮挡地块详情弹窗(1050)
  lodgingParcelDrawerOpen.value = false
  // 从地块抽屉数据中找到对应的地块信息
  const row = lodgingMode.parcelDrawerRows.value.find(r => r.parcelId === parcelId)
  if (!row) return
  // 构造 ParcelSummaryInput 并调用 parcelWorkbench.selectParcel 打开详情弹窗
  void parcelWorkbench.selectParcel({
    id: parcelId,
    source: 'base',
    areaMu: row.areaMu,
    areaM2: row.areaMu * 666.67,
  }, true)
}

const lodgingMode = useLodgingAssessmentMode({
  store,
  anyWeatherActive: () => anyWeatherActive.value,
  disasterActive,
  exits: {
    weather: () => weatherMode.exitWeatherMode(),
    nationalAlarms: () => weatherMode.exitNationalAlarms(),
    typhoon: () => typhoonMode.exitTyphoonMode(),
    precipitation: () => precipitationMode.exitPrecipitationMode(),
  },
  resetToProvince: () => store.resetToProvince(),
  render: () => render(),
  showToast: (msg) => { toastRef.value?.show(msg) },
  onLodgingParcelClick: (parcelId) => {
    handleLodgingParcelSelect(parcelId)
  },
})

// 农情监测模式（演示模式入口）
const agriMonitoringStore = useAgriMonitoringStore()
const agriMode = useAgriMonitoringMode({
  store,
  disasterActive,
  anyWeatherActive: () => anyWeatherActive.value,
  hasUnsavedParcelWork: () => parcelHasUnsavedWork(),
  exits: {
    typhoon: (restoreView) => typhoonMode.exitTyphoonMode(restoreView),
    weather: () => weatherMode.exitWeatherMode(),
    nationalAlarms: () => weatherMode.exitNationalAlarms(),
    precipitation: () => precipitationMode.exitPrecipitationMode(),
    lodging: () => lodgingMode.exitAssessmentMode(),
  },
  resetToProvince: () => store.resetToProvince(),
  render: () => render(),
  showNotice,
})
const {
  selectDate: selectAgriDate,
  togglePlay: toggleAgriPlay,
  setOpacity: setAgriOpacity,
  toggleVisible: toggleAgriVisible,
  setTab: setAgriTab,
  drillToVillage: drillAgriToVillage,
  locateTask: locateAgriTask,
  clearTaskLocation: clearAgriTaskLocation,
} = agriMode

const agriLegend = GROWTH_LEVELS.map((lv) => ({ key: lv, label: LEVEL_LABELS[lv], color: `rgb(${LEVEL_COLORS[lv].join(',')})` }))

function enterAgriMonitoring() { void agriMode.enter() }
function exitAgriMonitoring() { agriMode.exit() }
function handleAgriSelectVillage(code: string) {
  agriMonitoringStore.openVillageDetail(code)
  drillAgriToVillage(code)
}
function handleAgriSelectChild(row: { code: string; name: string; geometry: unknown; level: string }) {
  void store.drill({ level: row.level as Level, code: row.code, name: row.name, geometry: row.geometry as Feature['geometry'] })
}

// 模式互斥：当其他模式激活时，自动退出评估/农情监测模式
watch([anyWeatherActive, disasterActive, () => precipitationStore.isOpen], ([weather, typhoon, precip]) => {
  if (lodgingMode.isActive.value && (weather || typhoon || precip)) {
    lodgingMode.exitAssessmentMode()
  }
  if (agriMonitoringStore.isOpen && (weather || typhoon || precip)) {
    agriMode.exit()
  }
})

const parcelWorkbench = useParcelWorkbench({
  store,
  parcelMode,
  rosterOpen,
  parcelVisible,
  parcelOn,
  detailPanelRef,
  disasterActive: () => disasterActive.value,
  weatherCurrentActive: () => weatherCurrentActive.value,
  deselectPicked: () => weatherMode.deselectPicked(),
  showNotice,
  onAfterRender: () => { navigationController.bringOutlineToFront() },
  onMinZoomChange: (minZoom) => { mapMinZoom.value = minZoom },
  defaultMinZoom: DEFAULT_MIN_ZOOM,
  editMinZoom: PARCEL_EDIT_MIN_ZOOM,
})
parcelHasUnsavedWork = () => parcelWorkbench.hasUnsavedParcelWork()
closeBusinessPanels = () => parcelWorkbench.closeBusinessPanels()
const {
  hasFilterableParcels,
  manualDraftPoints,
  batchSavedCount,
  batchHasChanges,
  manualDraftAreaText,
  pendingHideCount,
  pendingRestoreCount,
  pendingChangeCount,
  hiddenParcelCount,
  manualDialog,
  parcelDisplayCount,
  parcelDisplayAreaText,
  policyFixture,
  policyLoadError,
  cultivationLoadError,
  selectedParcel,
  selectedPolicyContext,
  selectedCultivationRecords,
  selectedInitialRecordKeys,
  cultivationEditing,
  selectedRosterItems,
  selectedRosterPartyDisplay,
  retryBusinessData,
  toggleParcels,
  requestCloseDetail,
  requestRestoreCultivation,
  saveCultivationRecord,
  removeCultivationRecord,
  selectRosterItem,
  restoreAllHiddenParcels,
  saveParcelEdits,
  cancelParcelEditing,
  startParcelEditing,
  startBatchDrawing,
  exitBatchDrawing,
  undoManualPoint,
  finishManualDrawing,
  saveManualBatch,
  cancelManualBatch,
  saveManualDraft,
  cancelManualSession,
  closeManualDialog,
  removeBatchManualParcel,
  startManualDrawing,
  parcelVillageCode,
  setVisualMode,
  parcelVisualMode,
  plantingEnabledCategories,
  insuranceEnabledCategories,
  togglePlantingCategory,
  toggleInsuranceCategory,
  plantingDataEmpty,
  insuranceDataEmpty,
} = parcelWorkbench
const {
  riskOverviewModel,
  riskSnapshotError,
  villageCard,
  exitPrecipitationMode,
  closeVillageCard,
  selectVillageFromOverview,
  backFromVillageDetail,
  selectPrecipDay,
  togglePrecipPlay,
  setPrecipOpacity,
  refreshPrecipitation,
} = precipitationMode

// 业务数据提示条：任一加载失败时显示「当前区域暂无地块数据」，5 秒后自动消失
const businessLoadErrorVisible = ref(false)
let businessLoadErrorTimer: ReturnType<typeof setTimeout> | null = null
watch([policyLoadError, cultivationLoadError], ([policy, cultivation]) => {
  if (businessLoadErrorTimer) clearTimeout(businessLoadErrorTimer)
  if (policy || cultivation) {
    businessLoadErrorVisible.value = true
    businessLoadErrorTimer = setTimeout(() => {
      businessLoadErrorVisible.value = false
      businessLoadErrorTimer = null
    }, 5000)
  } else {
    businessLoadErrorVisible.value = false
  }
})

/** 切换底图；文字注记使用独立 annotationPane 始终置顶 */
function switchBasemap(type: BasemapKey) {
  if (!basemaps) return
  basemap.value = applyBasemapSwitch(map, basemaps, basemap.value, type)
}

const toFeature = (geometry: Geometry | null | undefined): Feature<Geometry | null> => ({
  type: 'Feature',
  properties: {},
  geometry: geometry ?? null,
})

const baseStyle = (level: keyof typeof LEVEL_WEIGHT): L.PathOptions => ({
  color: THEME,
  weight: LEVEL_WEIGHT[level],
  fillColor: THEME,
  fillOpacity: 0.08,
})

/** 高分影像 开/关 */
function toggleRs() {
  rsOn.value = !rsOn.value
  navigationController.setImageryOpacity(rsOn.value ? RS_OPACITY : 0)
}

/** 图例复选框切换分类：按当前图层模式路由到对应的 toggle 函数 */
function onLegendToggleCategory(category: string) {
  if (parcelVisualMode.value === 'planting') togglePlantingCategory(category)
  else if (parcelVisualMode.value === 'insurance') toggleInsuranceCategory(category)
}

function zoomIn() {
  if (canZoomIn.value) map.zoomIn()
}

function zoomOut() {
  if (canZoomOut.value) map.zoomOut()
}

function showNotice(message: string, error = false) {
  if (saveNoticeTimer) clearTimeout(saveNoticeTimer)
  saveNoticeError.value = error
  saveNotice.value = message
  saveNoticeTimer = setTimeout(() => { saveNotice.value = ''; saveNoticeError.value = false }, error ? 5000 : 3000)
}

function closeWeatherFromToolbar(module: WeatherModuleKind) {
  if (module === 'alerts') weatherMode.exitNationalAlarms()
  else if (module === 'precipitation') precipitationMode.exitPrecipitationMode()
  else weatherMode.exitWeatherMode()
}

function closeWorkbench() {
  if (workbenchTab.value === 'typhoon') void typhoonMode.exitTyphoonMode()
  else precipitationMode.exitPrecipitationMode()
}

/** tab 点击 = 视图 + 模式联动：点台风 tab 时若台风模式未激活则进入（若已激活但下钻过则回省），点风险 tab 时若降水未激活则进入。 */
function selectWorkbenchTab(tab: WorkbenchTab) {
  workbenchTab.value = tab
  if (tab === 'typhoon') {
    if (!disasterActive.value) void typhoonMode.enterTyphoonMode()
    else if (store.current.level !== 'province') void store.resetToProvince() // 台风激活时切回：下钻残留回省
  } else if (tab === 'risk' && !precipitationStore.isOpen) {
    void precipitationMode.enterPrecipitationMode()
  }
}

// 共用面板：模式联动（后进入优先；退出后切到仍激活的模式）
watch(() => disasterActive.value, (active) => {
  if (active) workbenchTab.value = 'typhoon'
  else if (precipitationStore.isOpen) workbenchTab.value = 'risk'
})
watch(() => precipitationStore.isOpen, (open) => {
  if (open) workbenchTab.value = 'risk'
  else if (disasterActive.value) workbenchTab.value = 'typhoon'
})
async function prepareProvinceLayersWithoutMovingCamera() {
  await nextTick()
  if (provinceRenderPromise) await provinceRenderPromise
  else await render(true)
}

function invalidateNavigation() { flySeq += 1; provinceRenderPromise = null }
function renderProvinceView() { provinceRenderPromise = render().finally(() => { provinceRenderPromise = null }) }

function isTypingTarget(target: EventTarget | null): boolean {
  return target instanceof HTMLElement && (target.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName))
}

function onManualKeydown(event: KeyboardEvent) {
  if (isTypingTarget(event.target)) return
  if(event.key==='Escape'&&nationalAlarmsActive.value&&nationalAlarmStore.selection){event.preventDefault();nationalAlarmStore.select(null);return}
  if(event.key==='Escape'&&villageCard.value){event.preventDefault();closeVillageCard();return}
  if(event.key==='Escape'&&weatherCurrentActive.value&&weatherStore.locationPopup!=='none'){event.preventDefault();weatherMode.closeWeatherLocation();return}
  if (event.key === 'Escape' && typhoonMode.typhoonPopupState.value.pinned) {
    event.preventDefault()
    typhoonMode.clearPinnedPopup()
    return
  }
  if (event.key === 'Escape' && manualDialog.value.open) {
    event.preventDefault()
    closeManualDialog(false)
    return
  }
  if (manualDialog.value.open) return
  if (event.key === 'Escape' && rosterOpen.value) { event.preventDefault(); rosterOpen.value = false; return }
  if (event.key === 'Escape' && selectedParcel.value) { event.preventDefault(); void requestCloseDetail(); return }
  if (event.key === 'Escape' && (parcelMode.value === 'batch' || parcelMode.value === 'drawing')) {
    event.preventDefault()
    void cancelManualBatch()
    return
  }
  if (event.key === 'Escape' && parcelMode.value === 'editing') {
    event.preventDefault()
    cancelManualSession()
    return
  }
  if (event.key === 'Delete' && parcelMode.value === 'batch' && parcelWorkbench.editingPendingManualId) {
    event.preventDefault()
    removeBatchManualParcel(parcelWorkbench.editingPendingManualId)
    return
  }
  if ((parcelMode.value === 'batch' || parcelMode.value === 'drawing') && !event.repeat && !event.ctrlKey && !event.metaKey && !event.altKey && event.key.toLowerCase() === 'n') {
    event.preventDefault()
    if (parcelMode.value === 'batch') void startBatchDrawing()
    else if (manualDraftPoints.value.length === 0) exitBatchDrawing()
    else void finishManualDrawing()
    return
  }
  if ((parcelMode.value === 'batch' || parcelMode.value === 'drawing') && (event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'z') {
    event.preventDefault()
    undoManualPoint()
  }
}

/** 当前区域轮廓(下钻时被点击的要素) */
async function render(noFly = false) {
  if (disposed) return
  const crumb = store.current
  const seq = ++flySeq
  const isCurrent = () => !disposed && seq === flySeq
  parcelWorkbench.clearForNavigation()
  navigationController.clear()
  rsVisible.value = false
  rsHint.value = ''
  rsOn.value = true
  navigationController.renderOutline(crumb, { color: HOVER, weight: 3, fill: false, dashArray: '6 4' })

  // 视野: flyTo 当前区域 (决策#4 动效); 自动切换层级时不动视野
  let bounds: L.LatLngBounds | null = null
  if (crumb.geometry) {
    bounds = L.geoJSON(toFeature(crumb.geometry)).getBounds()
  } else {
    const prov = await fetchJSON<FeatureCollection>('/data/boundary/province.geojson')
    if (!isCurrent()) return
    bounds = L.geoJSON(prov).getBounds()
  }
  if (!noFly && bounds.isValid()) {
    // 程序化移动期间抑制自动层级（zoomend 早于 moveend：落点 zoomend 仍受抑制保护）。
    // 关键不变式：目标 zoom 保底到本层级退出阈值之上（floor = EXIT_ZOOM + 0.25），
    // 使落点天然不落在"缩小退回"区间内——即使抑制被旧动画中断残留事件提前解除，
    // 落点 zoomend 也不可能触发误退级（villageRisk 返回按钮偶发多退一级的根因：
    // 旧 flyTo 被中断时其 transitionend 残留事件会异步到达并提前清掉抑制，
    // 使新 flyTo 落点 z≤EXIT_ZOOM 被 onAutoLevel 误判为用户缩小退出）。
    // 不再需要移动结束后的二次抬升收尾，抑制只覆盖动画期间，简单且无残留时序依赖。
    suppressAutoZoom = true
    const exitZ = EXIT_ZOOM[crumb.level]
    const floor = exitZ !== undefined ? exitZ + 0.25 : -Infinity
    const targetZoom = Math.max(map.getBoundsZoom(bounds), floor)
    map.once('moveend', () => { if (isCurrent()) suppressAutoZoom = false })
    setTimeout(() => { if (isCurrent()) suppressAutoZoom = false }, 1500)
    if (firstRender) {
      // 首次渲染: 瞬时贴合省界(不播动画), 默认视野铺满屏幕
      map.fitBounds(bounds.pad(0.02))
      firstRender = false
    } else {
      // 下钻/返回: 同样的紧贴边距, 飞行动画；落点由 floor 保底，避免进入退出区间
      map.flyTo(bounds.getCenter(), targetZoom, { duration: 1.0 })
    }
  }

  // 等飞行结束再插入子级图层(动画期间插图层会掉帧); 自动切换无飞行则立即
  const flyDone = noFly
    ? Promise.resolve()
    : new Promise<void>((resolve) => {
        let done = false
        const finish = () => { if (!done) { done = true; resolve() } }
        map.once('moveend', finish)
        setTimeout(finish, 1200)
      })

  // 人工地块不依赖高分影像或 AI 产物：进入任意村时先建立当前村上下文并读取本机记录。
  if (crumb.level === 'village') {
    parcelWorkbench.enterVillageContext(crumb.code)
  } else {
    // 非村级：清空业务数据，避免上一村数据残留串村
    parcelWorkbench.clearBusinessData()
  }

  // 乡镇和村级共用高分影像；AI 地块仍只在村级按需加载。
  if (crumb.level === 'township' || crumb.level === 'village') {
    // 等飞行结束再插入影像，避免动画中途因低于 minZoom 导致瓦片不恢复。
    const [info] = await Promise.all([
      rsInfo ? Promise.resolve(rsInfo) : fetchRsInfo().catch(() => null),
      flyDone,
    ])
    if (!isCurrent()) return
    rsInfo = info
    if (rsInfo && crumb.geometry) {
      const [w, s, e, n] = rsInfo.bounds
      const currentBounds = L.geoJSON(toFeature(crumb.geometry)).getBounds()
      const rsBounds = L.latLngBounds([s, w], [n, e])
      if (currentBounds.intersects(rsBounds)) {
        navigationController.setImagery(rsInfo, RS_OPACITY)
        rsVisible.value = true
        rsHint.value = `吉林一号 0.5m 影像（${rsInfo.minZoom}~${rsInfo.maxZoom} 级）`

        if (crumb.level === 'village') {
          const parcels = await fetchJSON<FeatureCollection>(`/data/parcels/${crumb.code}.geojson`).catch(() => null)
          if (!isCurrent()) return
          if (parcels?.features.length) parcelWorkbench.applyAiParcels(parcels)
        }

        // 乡镇/村级低于影像最低级别时抬升，保证进入层级后影像实际可见。
        if (map.getZoom() < rsInfo.minZoom) {
          suppressAutoZoom = true
          map.once('zoomend', () => { if (isCurrent()) suppressAutoZoom = false })
          setTimeout(() => { if (isCurrent()) suppressAutoZoom = false }, 500)
          map.setZoom(rsInfo.minZoom)
        }
      } else if (crumb.level === 'village') {
        rsHint.value = '该村不在高分影像覆盖范围内'
      }
    }
  }

  // 子级边界(部分中心城区街道无村界文件 -> 404 时静默按空处理)
  const url = childrenUrl(crumb)
  if (url) {
    const [fc] = await Promise.all([
      fetchJSON<FeatureCollection>(url).catch(
        () => ({ type: 'FeatureCollection', features: [] }) as FeatureCollection,
      ),
      flyDone,
    ])
    if (!isCurrent()) return
    const next = NEXT_LEVEL[crumb.level]!
    navigationController.renderChildren({
      collection: fc,
      style: () => baseStyle(crumb.level),
      hoverStyle: { color: HOVER, weight: LEVEL_WEIGHT[crumb.level] + 1.5, fillOpacity: 0.2 },
      onSelect: (feature) => {
        store.drill({
          level: next,
          code: feature.properties?.code ?? '',
          name: feature.properties?.name ?? '',
          geometry: feature.geometry,
        })
      },
    })
  }
}

watch(() => store.path.length, () => {
  weatherMode.onNavigate()
  const nf = pendingNoFly.value
  pendingNoFly.value = false
  // 所有导航都经过 store 守卫；确认离开后在重渲染前丢弃本轮草稿与待筛选状态。
  parcelWorkbench.onNavigateReset()
  provinceRenderPromise = render(nf).finally(() => { provinceRenderPromise = null })
})

/** 缩放下钻: zoomend 时按中心点判定自动进出层级(平移不触发) */
function onAutoLevel() {
  if (!autoLevelAllowed(parcelMode.value, suppressAutoZoom)) return
  const crumb = store.current
  const z = map.getZoom()

  // 放大: 进入中心点所在子区域，乡级继续自动进入村级
  const enterZ = ENTER_ZOOM[crumb.level]
  if (enterZ !== undefined && z >= enterZ) {
    const c = map.getCenter()
    const feature = navigationController.findChildAt([c.lng, c.lat], pointInGeometry)
    if (feature) {
      pendingNoFly.value = true
      store.drill({
        level: NEXT_LEVEL[crumb.level]!,
        code: feature.properties?.code ?? '',
        name: feature.properties?.name ?? '',
        geometry: feature.geometry,
      })
      return
    }
    return
  }

  // 缩小: 仅在真正缩小时退回上级。下钻后视野可能仍落在退出区(大区域/小视口 fitBounds 缩放级过低),
  // 若放大也触发退出会把用户误退回上级, 故先按 zoom 变化方向过滤。
  if (z < lastZoom) {
    const exitZ = EXIT_ZOOM[crumb.level]
    if (exitZ !== undefined && z <= exitZ && store.path.length > 1) {
      pendingNoFly.value = true
      store.back()
    }
  }
}

onMounted(async () => {
  map = L.map(mapEl.value!, {
    minZoom: DEFAULT_MIN_ZOOM,
    maxZoom: 19,
    zoomControl: false,
    zoomSnap: 0.25, // 允许小数级缩放, fitBounds 才能精确贴合(整数级会被迫放松最多1级)
    wheelPxPerZoomLevel: 120, // 滚轮步幅放缓(默认60, 一次滚动跳~1.7级导致瓦片爆发重载)
    renderer: canvasRenderer, // 矢量图层默认走 Canvas
  })
  map.setView([29.5, 120.5], 7) // 初始视野, 防止 flyToBounds 前无中心点
  // e2e 断言 seam: DEV 下暴露 map 实例供自动化测试读取中心/缩放（生产构建为死代码）
  if (import.meta.env.DEV) (window as unknown as { __map?: L.Map }).__map = map
  const provinceData=await fetchJSON<FeatureCollection>('/data/boundary/province.geojson').catch(()=>null)
  provinceGeometry=provinceData?.features[0]?.geometry??null
  currentZoom.value = map.getZoom()
  const zoomLevelControl = new L.Control({ position: 'bottomright' })
  zoomLevelControl.onAdd = () => {
    zoomLevelOutput = L.DomUtil.create('output', 'map-zoom-level') as HTMLOutputElement
    zoomLevelOutput.setAttribute('aria-live', 'polite')
    zoomLevelOutput.setAttribute('aria-label', '地图缩放等级')
    zoomLevelOutput.textContent = `Z ${currentZoom.value.toFixed(2)}`
    return zoomLevelOutput
  }
  zoomLevelControl.addTo(map)
  // 注记独立置顶: 高于高分影像、AI 地块和行政边界
  map.createPane('editDimmingPane')
  map.getPane('editDimmingPane')!.style.zIndex = '350'
  map.getPane('editDimmingPane')!.style.pointerEvents = 'none'
  map.createPane('parcelPane')
  map.getPane('parcelPane')!.style.zIndex = '400'
  map.createPane('parcelLabelPane')
  map.getPane('parcelLabelPane')!.style.zIndex = '440'
  map.getPane('parcelLabelPane')!.style.pointerEvents = 'none'
  map.createPane('annotationPane')
  map.getPane('annotationPane')!.style.zIndex = '450'
  map.getPane('annotationPane')!.style.pointerEvents = 'none'
  navigationController = createMapNavigationController(map)
  parcelWorkbench.init(map)
  map.on('click', (event) => {
    // 点地图空白不自动关闭风险详情/不切列表（用户确认）；详情用返回/Esc 关闭
    if (typhoonMode.typhoonPopupState.value.pinned) typhoonMode.clearPinnedPopup()
    if(weatherCurrentActive.value&&weatherStore.locationPopup!=='none')weatherMode.closeWeatherLocation()
    if(nationalAlarmsActive.value&&nationalAlarmStore.selection?.source==='map')nationalAlarmStore.select(null)
    parcelWorkbench.onMapClick(event)
  })
  weatherMode.init(map)
  precipitationMode.init(map)
  typhoonMode.init(map)
  lodgingMode.init(map)
  agriMode.init(map)
  basemaps = createBasemaps()
  basemaps.img.addTo(map)
  const syncMapViewport = () => {
    const size = map.getSize()
    mapViewport.value = { width: size.x, height: size.y }
  }
  syncMapViewport()
  map.on('resize', syncMapViewport)
  map.on('zoomend', () => {
    currentZoom.value = map.getZoom()
    if (zoomLevelOutput) zoomLevelOutput.textContent = `Z ${currentZoom.value.toFixed(2)}`
    onAutoLevel()
    lastZoom = map.getZoom()
  })
  store.setNavigationGuard(() => parcelWorkbench.navigationGuard())
  beforeUnloadHandler = (event: BeforeUnloadEvent) => {
    if (!parcelWorkbench.hasUnsavedParcelWork()) return
    event.preventDefault()
  }
  window.addEventListener('beforeunload', beforeUnloadHandler)
  window.addEventListener('keydown', onManualKeydown)
  render()
})

onBeforeUnmount(() => {
  weatherMode.exitWeatherMode()
  weatherMode.exitNationalAlarms()
  precipitationMode.exitPrecipitationMode()
  typhoonMode.exitTyphoonMode(false)
  disposed = true
  flySeq += 1
  if (saveNoticeTimer) clearTimeout(saveNoticeTimer)
  if (businessLoadErrorTimer) clearTimeout(businessLoadErrorTimer)
  if (beforeUnloadHandler) window.removeEventListener('beforeunload', beforeUnloadHandler)
  window.removeEventListener('keydown', onManualKeydown)
  store.setNavigationGuard(null)
  typhoonMode.destroy()
  weatherMode.destroy()
  precipitationMode.destroy()
  agriMode.destroy()
  parcelWorkbench.destroy()
  navigationController?.destroy()
  map?.remove()
})
</script>

<style src="./map/MapView.css"></style>
<style src="./map/NationalAlarm.css"></style>
