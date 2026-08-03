<template>
  <div class="map-wrap" :class="{ 'parcel-editing': parcelMode !== 'idle', 'parcel-drawing': parcelMode === 'drawing', 'typhoon-timeline-open': disasterActive && typhoonStore.timelineOpen }">
    <div ref="mapEl" class="map"></div>

    <WeatherPanel
      v-if="weatherActive"
      :context-name="store.current.name" :context-level="store.current.level" :phase="weatherStore.phase"
      :alerts="weatherStore.bundle?.alerts ?? null" :selection="weatherStore.selection" :attributions="weatherStore.bundle?.attributions ?? []"
      :partial-failure="weatherStore.hasPartialFailure" :last-fetched-at="weatherStore.bundle?.fetchedAt" :stale="weatherStore.bundle ? weatherBundleStale : false" @refresh="refreshWeather" @retry-alerts="refreshWeather" @close="exitWeatherMode"
      @select-alert="selectWeatherAlert" @select-region="weatherStore.selection=null"
    />
    <div v-if="weatherActive" class="weather-shortcut-hint" role="status"><kbd>Ctrl</kbd><span>+</span><span>左键单击可以按点选查询天气</span></div>
    <div v-if="weatherActive" class="weather-edit-notice">天气查看中可查看地块，编辑操作暂不可用</div>
    <WeatherPopup v-if="weatherActive && weatherStore.selection && selectedWeatherAlert" kind="alert" :title="selectedWeatherAlert.alert.headline || '预警标题暂缺'" :alert="selectedWeatherAlert.alert" :x="weatherPopupPosition.x" :y="weatherPopupPosition.y" @close="weatherStore.selectAlert(null)" @retry="refreshWeather" />
    <WeatherPopup v-if="weatherActive && weatherStore.locationPopup !== 'none' && weatherStore.bundle" kind="location" :title="weatherLocationTitle" :bundle="weatherStore.bundle" :x="weatherPopupPosition.x" :y="weatherPopupPosition.y" @close="closeWeatherLocation" @retry="refreshWeather" />

    <TyphoonPathPanel
      v-if="disasterActive"
      :phase="typhoonStore.phase"
      :realtime-count="typhoonStore.realtimeDetails.length"
      :model="typhoonPanelModel"
      :timeline-open="typhoonStore.timelineOpen"
      :reveal-token="typhoonRevealToken"
      @close="exitTyphoonMode"
      @toggle="toggleTyphoonCard"
      @close-history="closeHistoricalTyphoon"
      @select-node="selectTyphoonPanelNode"
    />
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
        @close="rosterOpen = false"
        @select="selectRosterItem"
      />
    </Transition>

    <div v-if="policyLoadError || cultivationLoadError" class="business-load-error" role="alert">
      <strong>业务数据加载失败</strong>
      <span>{{ [policyLoadError, cultivationLoadError].filter(Boolean).join(' ') }}</span>
      <button type="button" @click="loadBusinessData">重试</button>
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

    <MapControlStack
      ref="mapControlRef" :basemap="basemap"
      :rs-visible="rsVisible"
      :rs-on="rsOn"
      :parcel-visible="parcelVisible"
      :parcel-on="parcelOn"
      :mode="parcelMode"
      :can-zoom-in="canZoomIn"
      :can-zoom-out="canZoomOut"
      :parcel-tools-visible="store.current.level === 'village' || disasterActive || weatherActive"
      :parcel-tools-disabled="parcelMode !== 'idle' || disasterActive || weatherActive"
      :has-filterable-parcels="hasFilterableParcels"
      :disaster-entry-disabled="disasterEntryDisabled || weatherActive"
      :disaster-active="disasterActive"
      :weather-entry-disabled="!weatherEntry.enabled"
      :weather-entry-reason="weatherEntry.reason"
      :weather-active="weatherActive"
      @switch-basemap="switchBasemap"
      @toggle-rs="toggleRs"
      @toggle-parcels="toggleParcels"
      @start-manual="startManualDrawing"
      @start-filter="startParcelEditing"
      @open-typhoon="enterTyphoonMode"
      @open-weather="enterWeatherMode"
      @zoom-in="zoomIn"
      @zoom-out="zoomOut"
    />
  </div>
</template>

<script setup lang="ts">
import { computed, nextTick, onMounted, onBeforeUnmount, reactive, ref, toRef, watch } from 'vue'

import L from 'leaflet'
import pointOnFeature from '@turf/point-on-feature'
import ManualConfirmDialog from './map/ManualConfirmDialog.vue'
import MapControlStack from './map/MapControlStack.vue'
import ParcelEditToolbar from './map/ParcelEditToolbar.vue'
import ParcelStatusCard from './map/ParcelStatusCard.vue'
import ParcelDetailPanel from './map/ParcelDetailPanel.vue'
import PolicyRosterDrawer from './map/PolicyRosterDrawer.vue'
import TyphoonPathPanel from './typhoon/TyphoonPathPanel.vue'
import TyphoonTimelineDrawer from './typhoon/TyphoonTimelineDrawer.vue'
import TyphoonHoverPopup from './typhoon/TyphoonHoverPopup.vue'
import WeatherPanel from './weather/WeatherPanel.vue'
import WeatherPopup from './weather/WeatherPopup.vue'
import type { Feature, FeatureCollection, Geometry, Position } from 'geojson'
import { loadCultivationFixture, loadPolicyFixture } from '../features/policy/policyRepository'
import { addCultivationRecord, readEffectiveCultivation, removeAddedCultivation, removeCultivationForParcel, restoreInitialCultivation, saveCultivationOverride, updateAddedCultivation } from '../features/policy/cultivationStorage'
import { cultivationKey, type CultivationRecord } from '../features/policy/cultivationState'
import { fromBaseParcel, fromManualParcel, insuredCoverages, parcelPolicyContext, policyCoverages, type ParcelPolicyContext, type ParcelSummaryInput } from '../features/policy/policySelectors'
import type { EnrollmentItem, PolicyFixture } from '../features/policy/policyTypes'
import { linkedParcelStyle } from '../features/policy/policyVisual'
import type { ParcelId, ParcelMode } from '../features/parcels/parcelTypes'
import { createManualDrawingController, type ManualDrawingController } from '../map/manualDrawingController'
import { createParcelLayerController, type ParcelLayerController } from '../map/parcelLayerController'
import { createParcelDetailClickGuard } from '../map/parcelDetailClickGuard'
import { createMapNavigationController, type MapNavigationController } from '../map/mapNavigationController'
import { createParcelWorkModeController, type ParcelWorkModeController } from '../map/parcelWorkModeController'
import { createTyphoonLayerController, type TyphoonLayerController } from '../map/typhoonLayerController'
import { createWeatherLayerController } from '../map/weatherLayerController'
import { createWeatherInteractionController } from '../map/weatherInteractionController'
import { createTyphoonSessionRepository, type TyphoonSessionRepository } from '../features/typhoon/typhoonRepository'
import { autoLevelAllowed, createDisasterModeCoordinator, mapTyphoonLayerSnapshot, shouldAutoFitTyphoon } from '../features/typhoon/disasterModeLifecycle'
import { buildTyphoonPathPanelViewModel } from '../features/typhoon/typhoonPanelViewModel'
import { buildTyphoonTimelineViewModel } from '../features/typhoon/typhoonTimelineViewModel'
import { actualNodeSelection, buildTyphoonHoverViewModel, type TyphoonHoverTarget } from '../features/typhoon/typhoonHoverViewModel'
import { clearPinnedPopup, clearPinnedWindPopupOnMove, clearPopupForTyphoon, hoverPopup, leavePopup, pinPopup, visiblePopupTarget, type TyphoonPopupState } from '../features/typhoon/typhoonInteractionState'
import { createTyphoonPlaybackController, type TyphoonPlaybackController } from '../features/typhoon/typhoonPlaybackController'
import { useTyphoonStore } from '../stores/typhoon'
import { useWeatherStore } from '../stores/weather'
import { createWeatherRepository, type WeatherRepository } from '../features/weather/weatherRepository'
import { defaultWeatherQuery, pickedWeatherQuery, weatherEntryState } from '../features/weather/weatherLifecycle'
import { locationTitle, selectedAlert } from '../features/weather/weatherAdapter'
import type { WeatherSelection } from '../features/weather/weatherTypes'
import {
  addPendingManualParcel,
  commitManualBatch,
  createManualBatchState,
  hasManualBatchChanges,
  removeManualParcel,
  resetManualBatch,
  undoLatestPendingManualParcel,
  updateManualParcel,
} from '../features/parcels/manualBatchState'
import { loadHiddenParcelIds, persistHiddenParcelIds } from '../features/parcels/parcelHiddenStorage'
import {
  calculateNextHiddenIds,
  clearPendingParcelFilterState,
  createParcelFilterState,
  restoreAllParcels,
  toggleParcelFilterSelection as toggleFilterSelection,
} from '../features/parcels/parcelFilterState'
import {
  useDrilldownStore,
  childrenUrl,
  NEXT_LEVEL,
  LEVEL_WEIGHT,
} from '../stores/drilldown'
import { createBasemaps, type Basemaps } from '../api/tianditu'
import { fetchJSON, fetchRsInfo, type RsInfo } from '../api/data'
import { pointInGeometry } from '../utils/geo'
import { inspectManualGeometry, prepareManualGeometry } from '../utils/parcelGeometry'
import {
  MANUAL_PARCEL_NOTICE_KEY,
  makeManualParcel,
  readManualParcels,
  writeManualParcels,
  type ManualParcelFeature,
} from '../utils/manualParcelStorage'

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
const TYPHOON_INITIAL_ZOOM = 4.5
const PARCEL_EDIT_MIN_ZOOM = 15.25 // 高于村级 z<=15.0 自动退出阈值

const mapEl = ref<HTMLDivElement>()
const mapControlRef = ref<InstanceType<typeof MapControlStack>>()
const store = useDrilldownStore()
const typhoonStore = useTyphoonStore()
const weatherStore = useWeatherStore()
const disasterActive = ref(false)
const weatherActive = computed(()=>weatherStore.isOpen)
const disasterEntryDisabled = computed(() => hasUnsavedParcelWork())
const weatherEntry = computed(()=>weatherEntryState({mode:disasterActive.value?'typhoon':weatherActive.value?'weather':'none',crumb:store.current,hasUnsavedWork:hasUnsavedParcelWork()}))
const weatherPopupPosition=ref({x:0,y:0})
const selectedWeatherAlert=computed(()=>selectedAlert(weatherStore.bundle,weatherStore.selection))
const weatherLocationTitle=computed(()=>weatherStore.bundle?locationTitle(weatherStore.bundle,store.current.name,weatherStore.query?.target==='parcel'):'天气')
const weatherBundleStale=computed(()=>Boolean(weatherStore.bundle&&[weatherStore.bundle.address,weatherStore.bundle.current,weatherStore.bundle.minutely,weatherStore.bundle.hourly].some(module=>module.stale)||weatherStore.bundle?.alerts.data.some(region=>region.stale)))
const visibleObservationCountByTyphoon = ref<Record<string, number>>({})
const typhoonRevealToken = ref(0)
const typhoonPopupState = ref<TyphoonPopupState>({ hover: null, pinned: null })
const typhoonHoverPosition = ref({ x: 0, y: 0 })
const mapViewport = ref({ width: 0, height: 0 })
const typhoonHoverTarget = computed(() => visiblePopupTarget(typhoonPopupState.value))
const typhoonHoverModel = computed(() => typhoonHoverTarget.value ? buildTyphoonHoverViewModel(typhoonStore.details, typhoonHoverTarget.value) : null)
const typhoonPanelModel = computed(() => buildTyphoonPathPanelViewModel({
  liveIds: typhoonStore.liveIds,
  openedHistoricalIds: typhoonStore.openedHistoricalIds,
  details: typhoonStore.details,
  focusedTyphoonId: typhoonStore.focusedTyphoonId,
  expandedIds: typhoonStore.expandedIds,
  selectedNodeByTyphoon: typhoonStore.selectedNodeByTyphoon,
}))
const typhoonTimelineModel = computed(() => buildTyphoonTimelineViewModel({
  details: typhoonStore.historicalDetails,
  nowMs: Date.now(),
  realtimeCount: typhoonStore.liveIds.length,
  openedHistoricalIds: typhoonStore.openedHistoricalIds,
  focusedTyphoonId: typhoonStore.focusedTyphoonId,
  selectedNodeByTyphoon: typhoonStore.selectedNodeByTyphoon,
  historyPending: typhoonStore.historyLoad.pending,
  viewportWidth: mapViewport.value.width,
}))
const rsVisible = ref(false)
const rsHint = ref('')
const rsOn = ref(true)
const parcelVisible = ref(false)
const parcelOn = ref(true)
const parcelMode = ref<ParcelMode>('idle')
const hasAiParcels = ref(false)
const hasManualParcels = ref(false)
const hasFilterableParcels = computed(() => hasAiParcels.value || hasManualParcels.value)
const manualDraftPoints = ref<Position[]>([])
const manualDraftDirty = ref(false)
const manualBatchState = reactive(createManualBatchState())
const pendingManualParcels = toRef(manualBatchState, 'pendingParcels')
const pendingManualEdits = toRef(manualBatchState, 'pendingEdits')
const pendingRemovedManualIds = toRef(manualBatchState, 'removedIds')
const batchSavedCount = computed(() => pendingManualParcels.value.length)
const batchHasChanges = computed(() => hasManualBatchChanges(manualBatchState))
const manualDistinctPointCount = computed(() => new Set(manualDraftPoints.value.map(([lng, lat]) => `${lng},${lat}`)).size)
const manualDraftAreaText = computed(() => {
  const prepared = prepareManualGeometry(manualDraftPoints.value).prepared
  return prepared ? `${prepared.areaMu.toFixed(2)} 亩` : '边界待校验'
})

const pendingHideCount = ref(0)
const pendingRestoreCount = ref(0)
const pendingChangeCount = computed(() => pendingHideCount.value + pendingRestoreCount.value)
const hiddenParcelCount = ref(0)
const saveNotice = ref('')
const saveNoticeError = ref(false)
type ManualDialogState = { open: boolean; title: string; message: string; confirmLabel: string }
const manualDialog = ref<ManualDialogState>({ open: false, title: '', message: '', confirmLabel: '确定' })
const parcelDisplayCount = ref(0)
const parcelDisplayAreaMu = ref(0)
const parcelDisplayAreaText = computed(() => parcelDisplayAreaMu.value.toLocaleString('zh-CN', {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
}))
const currentZoom = ref(DEFAULT_MIN_ZOOM)
const mapMinZoom = ref(DEFAULT_MIN_ZOOM)
const canZoomIn = computed(() => currentZoom.value < 19)
const canZoomOut = computed(() => currentZoom.value > mapMinZoom.value)
const RS_OPACITY = 0.7
const basemap = ref<'img' | 'vec'>('img')
const policyFixture = ref<PolicyFixture | null>(null)
const initialCultivationRecords = ref<CultivationRecord[]>([])
const policyLoadError = ref('')
const cultivationLoadError = ref('')
async function loadBusinessData() {
  const [policy, cultivation] = await Promise.all([loadPolicyFixture(), loadCultivationFixture()])
  policyFixture.value = policy.data
  initialCultivationRecords.value = cultivation.data ?? []
  policyLoadError.value = policy.error ?? ''
  cultivationLoadError.value = cultivation.error ?? ''
}
const selectedParcel = ref<ParcelSummaryInput | null>(null)
const selectedPolicyContext = ref<ParcelPolicyContext | null>(null)
const selectedCultivationRecords = ref<CultivationRecord[]>([])
const selectedInitialRecordKeys = computed(() => selectedParcel.value ? initialCultivationRecords.value.filter((record) => record.villageCode === parcelVillageCode && record.parcelId === selectedParcel.value!.id).map(cultivationKey) : [])
const cultivationEditing = ref(false)
const rosterOpen = ref(false)
const highlightedInsuredIds = ref<Set<string>>(new Set())
const highlightedPolicyIds = ref<Set<string>>(new Set())
const detailPanelRef = ref<InstanceType<typeof ParcelDetailPanel>>()
const selectedRosterItems = computed(() => {
  const policy = selectedPolicyContext.value?.currentPolicy
  if (!policyFixture.value || !policy?.enrollmentListId) return []
  const list = policyFixture.value.enrollmentLists.find((entry) => entry.id === policy.enrollmentListId)
  if (!list) return []
  const itemById = new Map(policyFixture.value.enrollmentItems.map((item) => [item.id, item]))
  return list.itemIds.map((itemId) => itemById.get(itemId)).filter((item): item is EnrollmentItem => Boolean(item))
})
const selectedRosterPartyDisplay = computed(() => {
  if (selectedPolicyContext.value?.currentPolicy?.insuredMode !== 'insured_roster') return ''
  const firstItem = selectedRosterItems.value[0]
  const firstParty = firstItem && policyFixture.value?.parties.find((party) => party.id === firstItem.insuredPartyId)
  return firstParty ? `${firstParty.name}等${selectedRosterItems.value.length}户种植户` : '—'
})

// Canvas 渲染器: 百余个复杂多边形时比默认 SVG 渲染流畅一个量级
const canvasRenderer = L.canvas({ padding: 0.5 })

let map: L.Map
let navigationController: MapNavigationController
let parcelLayerController: ParcelLayerController
let manualDrawingController: ManualDrawingController
let workModeController: ParcelWorkModeController
let typhoonLayerController: TyphoonLayerController
let weatherLayerController: ReturnType<typeof createWeatherLayerController>
let weatherInteractionController: ReturnType<typeof createWeatherInteractionController>
let weatherRepository: WeatherRepository
let provinceGeometry: Geometry | null = null
let typhoonRepository: TyphoonSessionRepository
let typhoonPlaybackController: TyphoonPlaybackController
let zoomLevelOutput: HTMLOutputElement | null = null
let parcelSource: FeatureCollection | null = null
let manualParcels: ManualParcelFeature[] = []

let editingManualOriginal: ManualParcelFeature | null = null
let editingPendingManualId: string | null = null
let editingBatchManualKind: 'new' | 'existing' | null = null
let parcelVillageCode = ''
const parcelFilterState = createParcelFilterState()
const hiddenParcelIds = parcelFilterState.hiddenIds
const pendingHideParcelIds = parcelFilterState.pendingHideIds
const pendingRestoreParcelIds = parcelFilterState.pendingRestoreIds
let saveNoticeTimer: ReturnType<typeof setTimeout> | null = null
let rsInfo: RsInfo | null = null
let flySeq = 0
let disposed = false
let firstRender = true
let pendingNoFly = false // 自动切换层级时不重排视野(决策: 不动视野)
let suppressAutoZoom = false // 点击下钻/返回的程序化缩放不得触发自动进退层级
let basemaps: Basemaps
let beforeUnloadHandler: ((event: BeforeUnloadEvent) => void) | null = null
let manualDialogResolve: ((confirmed: boolean) => void) | null = null
let provinceRenderPromise: Promise<void> | null = null
let fittedTyphoonSessionId: number | null = null
const disasterModeCoordinator = createDisasterModeCoordinator()
// Leaflet Canvas 在部分浏览器中会让地块点击继续触发 map click；显式守卫是详情入口的回归保护。
const parcelDetailClickGuard = createParcelDetailClickGuard()

/** 切换底图；文字注记使用独立 annotationPane 始终置顶 */
function switchBasemap(type: 'img' | 'vec') {
  if (type === basemap.value || !basemaps) return
  map.removeLayer(basemaps[basemap.value])
  basemaps[type].addTo(map)
  basemap.value = type
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

function clearSelection() {
  selectedParcel.value = null
  selectedPolicyContext.value = null
  selectedCultivationRecords.value = []
  cultivationEditing.value = false
  rosterOpen.value = false
  highlightedInsuredIds.value = new Set()
  highlightedPolicyIds.value = new Set()
}

function clearLayers() {
  clearSelection()
  leaveParcelWorkMode()
  pendingHideParcelIds.clear()
  pendingRestoreParcelIds.clear()
  pendingHideCount.value = 0
  pendingRestoreCount.value = 0
  parcelSource = null
  hasAiParcels.value = false
  hasManualParcels.value = false
  manualParcels = []
  editingManualOriginal = null
  manualDraftPoints.value = []
  manualDraftDirty.value = false
  resetManualBatch(manualBatchState)
  editingPendingManualId = null
  editingBatchManualKind = null
  parcelVillageCode = ''
  hiddenParcelIds.clear()
  hiddenParcelCount.value = 0
  parcelDisplayCount.value = 0
  parcelDisplayAreaMu.value = 0
  navigationController?.clear()
  parcelLayerController?.clear()
  manualDrawingController?.clear()
  rsVisible.value = false
  parcelVisible.value = false
  rsHint.value = ''
  rsOn.value = true
  // 台风专题与业务图层可同时显示；行政切换后地块默认保持开启。
  parcelOn.value = true
}

/** 高分影像 开/关 */
function toggleRs() {
  rsOn.value = !rsOn.value
  navigationController.setImageryOpacity(rsOn.value ? RS_OPACITY : 0)
}

/** AI 地块独立开/关 */
async function toggleParcels() {
  if (parcelMode.value !== 'idle') return
  if (parcelOn.value && selectedParcel.value && cultivationEditing.value) {
    const confirmed = await openManualDialog('关闭地块图层', '当前种植档案尚未保存，关闭后将丢失编辑内容。', '确认关闭')
    if (!confirmed) return
  }
  parcelOn.value = !parcelOn.value
  if (!parcelOn.value) clearSelection()
  renderParcelLayer()
}

function zoomIn() {
  if (canZoomIn.value) map.zoomIn()
}

function zoomOut() {
  if (canZoomOut.value) map.zoomOut()
}

function parcelId(feature: Feature): ParcelId | null {
  const id = feature.properties?.id
  return id === null || id === undefined ? null : String(id)
}

function refreshSelectedCultivation() {
  if (!selectedParcel.value) return
  selectedCultivationRecords.value = readEffectiveCultivation(parcelVillageCode, selectedParcel.value.id, initialCultivationRecords.value)
}

function requestSelectParcel(parcel: ParcelSummaryInput, event: L.LeafletMouseEvent) {
  parcelDetailClickGuard.markParcelClick(event.originalEvent)
  void selectParcel(parcel)
}

async function selectParcel(parcel: ParcelSummaryInput) {
  if (parcelMode.value !== 'idle' || !parcelOn.value) return
  if (cultivationEditing.value && !await openManualDialog('切换地块', '当前种植档案尚未保存，是否确认放弃并切换地块？', '确认切换')) return
  selectedParcel.value = parcel
  selectedPolicyContext.value = policyFixture.value ? parcelPolicyContext(policyFixture.value, parcel.id) : { currentCoverage: null, currentPolicy: null, currentItem: null, currentInsured: null, applicant: null, history: [] }
  refreshSelectedCultivation()
  const context = selectedPolicyContext.value
  rosterOpen.value = false
  const currentPolicyCoverages = policyFixture.value && context?.currentPolicy
    ? policyCoverages(policyFixture.value, context.currentPolicy.id)
    : []
  if (currentPolicyCoverages.length > 1) {
    // 只要当前保单关联多个地块，点击其中任一地块就展示同一保单的全部可见关联地块。
    // 当前地块仍由 selectionStyle 使用橙色主高亮，其余关联地块使用绿色次级高亮。
    highlightedInsuredIds.value = new Set(currentPolicyCoverages.map((entry) => entry.parcelId))
    highlightedPolicyIds.value = new Set()
  } else {
    const sameInsuredContext = selectedPolicyContext.value?.currentInsured?.id && highlightedInsuredIds.value.has(parcel.id)
    if (!sameInsuredContext) {
      highlightedInsuredIds.value = new Set()
      highlightedPolicyIds.value = new Set()
    }
  }
  renderParcelLayer()
  if(weatherActive.value){weatherLayerController?.clearPicked();weatherStore.locationPopup='none';void weatherRepository.load(currentWeatherQuery())}
}

async function requestCloseDetail() {
  if (cultivationEditing.value && !await openManualDialog('关闭地块详情', '当前种植档案尚未保存，是否确认放弃？', '确认放弃')) return
  clearSelection()
  renderParcelLayer()
  if(weatherActive.value){weatherLayerController?.clearPicked();weatherStore.locationPopup='none';void weatherRepository.load(currentWeatherQuery())}
}

async function requestRestoreCultivation() {
  if (!selectedParcel.value || !await openManualDialog('恢复初始档案', '将清除当前地块的本机覆盖与新增记录，是否继续？', '确认恢复')) return
  const result = restoreInitialCultivation(parcelVillageCode, selectedParcel.value.id)
  if (!result.ok) { showNotice(result.error ?? '恢复失败', true); return }
  refreshSelectedCultivation(); showNotice('已恢复当前地块初始档案')
}

function saveCultivationRecord(record: CultivationRecord, isExisting: boolean) {
  const initial = selectedInitialRecordKeys.value.includes(cultivationKey(record))
  const result = isExisting ? (initial ? saveCultivationOverride(parcelVillageCode, record, initialCultivationRecords.value) : updateAddedCultivation(parcelVillageCode, record, initialCultivationRecords.value)) : addCultivationRecord(parcelVillageCode, record, initialCultivationRecords.value)
  if (!result.ok) { showNotice(result.error ?? '种植档案保存失败', true); return }
  refreshSelectedCultivation(); cultivationEditing.value = false; detailPanelRef.value?.markSaved(); showNotice('种植档案已保存到当前浏览器')
}

function removeCultivationRecord(record: CultivationRecord) {
  const result = removeAddedCultivation(parcelVillageCode, record)
  if (!result.ok) { showNotice(result.error ?? '删除失败', true); return }
  refreshSelectedCultivation(); showNotice('新增种植档案已删除')
}

function selectRosterItem(item: EnrollmentItem) {
  if (!policyFixture.value || !selectedPolicyContext.value?.currentPolicy) return
  highlightedInsuredIds.value = new Set(insuredCoverages(policyFixture.value, item.insuredPartyId, selectedPolicyContext.value.currentPolicy.id).map((entry) => entry.parcelId))
  renderParcelLayer()
}

function selectionStyle(feature: Feature): L.PathOptions | null {
  const id = parcelId(feature)
  if (!id || !selectedParcel.value) return null
  if (id === selectedParcel.value.id) return { color: '#f97316', weight: 4, fillColor: '#fb923c', fillOpacity: 0.34 }
  if (highlightedInsuredIds.value.has(id)) return linkedParcelStyle(selectedPolicyContext.value?.currentPolicy?.insuredMode)
  if (highlightedPolicyIds.value.has(id)) return { color: '#a78bfa', weight: 2, dashArray: '7 5', fillColor: '#c4b5fd', fillOpacity: 0.14 }
  return null
}

function syncPendingParcelCounts() {
  pendingHideCount.value = pendingHideParcelIds.size
  pendingRestoreCount.value = pendingRestoreParcelIds.size
}

function toggleParcelFilterSelection(id: ParcelId) {
  toggleFilterSelection(parcelFilterState, id)
  syncPendingParcelCounts()
}

function renderParcelLayer() {
  manualDrawingController.clearRemoveAction()
  const metrics = parcelLayerController.render()
  parcelVisible.value = metrics.parcelVisible
  hiddenParcelCount.value = metrics.hiddenCount
  parcelDisplayCount.value = metrics.displayCount
  parcelDisplayAreaMu.value = metrics.displayAreaMu
  if (parcelMode.value === 'batch' && editingPendingManualId) manualDrawingController.renderRemoveAction()
}

function enterParcelWorkMode(mode: ParcelMode, dim = true) {
  workModeController.enter(mode, dim)
}

function leaveParcelWorkMode() {
  workModeController?.leave()
}

async function startParcelEditing() {
  if (disasterActive.value || !parcelOn.value || !hasFilterableParcels.value) return
  if (cultivationEditing.value && !await openManualDialog('进入筛选模式', '当前种植档案尚未保存，是否确认放弃？', '确认进入')) return
  clearSelection()
  clearPendingParcelFilterState(parcelFilterState)
  syncPendingParcelCounts()
  enterParcelWorkMode('filter')
  renderParcelLayer()
}

function finishParcelEditing() {
  leaveParcelWorkMode()
  clearPendingParcelFilterState(parcelFilterState)
  syncPendingParcelCounts()
  renderParcelLayer()
}

function showSaveNotice(hiddenCount: number, restoredCount: number) {
  showNotice(`已隐藏 ${hiddenCount} 个地块，恢复 ${restoredCount} 个地块`)
}

function saveParcelEdits() {
  if (!pendingChangeCount.value || !parcelVillageCode) return
  const hiddenCount = pendingHideParcelIds.size
  const restoredCount = pendingRestoreParcelIds.size
  const nextHidden = calculateNextHiddenIds(parcelFilterState)
  if (!persistHiddenParcelIds(parcelVillageCode, nextHidden)) {
    window.alert('保存失败，本次修改尚未生效。请检查浏览器是否允许本地存储。')
    return
  }
  hiddenParcelIds.clear()
  for (const id of nextHidden) hiddenParcelIds.add(id)
  finishParcelEditing()
  showSaveNotice(hiddenCount, restoredCount)
}

function cancelParcelEditing() {
  finishParcelEditing()
}

function restoreAllHiddenParcels() {
  if (!hiddenParcelIds.size) return
  restoreAllParcels(parcelFilterState)
  syncPendingParcelCounts()
  renderParcelLayer()
}

function showNotice(message: string, error = false) {
  if (saveNoticeTimer) clearTimeout(saveNoticeTimer)
  saveNoticeError.value = error
  saveNotice.value = message
  saveNoticeTimer = setTimeout(() => { saveNotice.value = ''; saveNoticeError.value = false }, error ? 5000 : 3000)
}

function showManualStorageNoticeOnce() {
  try {
    if (localStorage.getItem(MANUAL_PARCEL_NOTICE_KEY)) return
    window.alert('人工地块仅保存在当前浏览器。清理浏览器数据、更换浏览器或设备后将无法恢复。')
    localStorage.setItem(MANUAL_PARCEL_NOTICE_KEY, 'shown')
  } catch {
    // 存储不可用会在实际保存时给出明确错误，不阻塞绘制。
  }
}

function effectiveBatchManualParcels(): ManualParcelFeature[] {
  const edits = new Map(pendingManualEdits.value.map((feature) => [feature.properties.id, feature]))
  return manualParcels
    .filter((feature) => !pendingRemovedManualIds.value.includes(feature.properties.id))
    .map((feature) => edits.get(feature.properties.id) ?? feature)
}

function manualGeometryWarnings(preparedGeometry: ManualParcelFeature['geometry'], excludedPendingId?: string) {
  const otherFeatures: Feature[] = [
    ...(parcelSource?.features ?? []),
    ...effectiveBatchManualParcels().filter((feature) => feature.properties.id !== excludedPendingId),
    ...pendingManualParcels.value.filter((feature) => feature.properties.id !== excludedPendingId),
  ]
  return inspectManualGeometry(preparedGeometry, store.current.geometry, otherFeatures)
}

function openManualDialog(title: string, message: string, confirmLabel = '确定'): Promise<boolean> {
  if (manualDialogResolve) manualDialogResolve(false)
  manualDialog.value = { open: true, title, message, confirmLabel }
  return new Promise((resolve) => { manualDialogResolve = resolve })
}

function closeManualDialog(confirmed: boolean) {
  manualDialog.value.open = false
  const resolve = manualDialogResolve
  manualDialogResolve = null
  resolve?.(confirmed)
}

async function confirmManualWarnings(preparedGeometry: ManualParcelFeature['geometry'], excludedPendingId?: string) {
  const warnings = manualGeometryWarnings(preparedGeometry, excludedPendingId)
  if (!(warnings.overlapCount || warnings.outsideVillage || warnings.incompleteChecks)) return true
  return openManualDialog('地块范围提醒', manualWarningMessage(warnings.overlapCount, warnings.outsideVillage, warnings.incompleteChecks), '仍要继续')
}

async function startManualDrawing() {
  if (disasterActive.value || store.current.level !== 'village') return
  if (cultivationEditing.value && !await openManualDialog('进入新增模式', '当前种植档案尚未保存，是否确认放弃？', '确认进入')) return
  clearSelection()
  showManualStorageNoticeOnce()
  parcelOn.value = true
  editingManualOriginal = null
  editingPendingManualId = null
  manualDraftPoints.value = []
  resetManualBatch(manualBatchState)
  manualDraftDirty.value = false
  enterParcelWorkMode('batch')
  manualDrawingController.setInteraction('batch')
  renderParcelLayer()
}

async function startBatchDrawing() {
  if (parcelMode.value !== 'batch') return
  if (editingPendingManualId && !await finishPendingManualEditing()) return
  editingPendingManualId = null
  editingBatchManualKind = null
  manualDraftPoints.value = []
  manualDrawingController.clearDraft()
  parcelMode.value = 'drawing'
  manualDrawingController.setInteraction('drawing')
  renderParcelLayer()
}

function exitBatchDrawing() {
  if (parcelMode.value !== 'drawing') return
  manualDraftPoints.value = []
  manualDrawingController.clearDraft()
  parcelMode.value = 'batch'
  manualDrawingController.setInteraction('batch')
  manualDraftDirty.value = batchHasChanges.value
  renderParcelLayer()
}

function undoManualPoint() {
  if (parcelMode.value !== 'batch' && parcelMode.value !== 'drawing') return
  if (editingPendingManualId) {
    editingPendingManualId = null
    editingBatchManualKind = null
    manualDraftPoints.value = []
    manualDrawingController.clearDraft()
    renderParcelLayer()
    return
  }
  if (manualDraftPoints.value.length) {
    manualDraftPoints.value = manualDraftPoints.value.slice(0, -1)
    manualDrawingController.renderDraft(false)
  } else if (pendingManualParcels.value.length) {
    undoLatestPendingManualParcel(manualBatchState)
    renderParcelLayer()
  }
  manualDraftDirty.value = manualDraftPoints.value.length > 0 || pendingManualParcels.value.length > 0
}

async function finishManualDrawing() {
  if (parcelMode.value !== 'drawing' || editingPendingManualId) return
  const checked = prepareManualGeometry(manualDraftPoints.value)
  if (!checked.prepared) {
    showNotice(checked.error ?? '至少需要 3 个不同顶点才能闭合地块。', true)
    return
  }
  if (!await confirmManualWarnings(checked.prepared.geometry)) return
  addPendingManualParcel(manualBatchState, makeManualParcel(parcelVillageCode, checked.prepared))
  manualDraftPoints.value = []
  manualDraftDirty.value = true
  manualDrawingController.clearDraft()
  parcelMode.value = 'batch'
  manualDrawingController.setInteraction('batch')
  renderParcelLayer()
}

async function startPendingManualEditing(feature: ManualParcelFeature) {
  await startBatchManualEditing(feature, 'new')
}

async function startBatchExistingManualEditing(feature: ManualParcelFeature) {
  await startBatchManualEditing(feature, 'existing')
}

async function startBatchManualEditing(feature: ManualParcelFeature, kind: 'new' | 'existing') {
  if (manualDraftPoints.value.length && !editingPendingManualId) {
    showNotice('请先点击第一个顶点或按 N 闭合当前地块，或撤销当前顶点。', true)
    return
  }
  if (editingPendingManualId === feature.properties.id && editingBatchManualKind === kind) return
  if (editingPendingManualId && !await finishPendingManualEditing()) return
  editingPendingManualId = feature.properties.id
  editingBatchManualKind = kind
  manualDraftPoints.value = feature.geometry.coordinates[0].slice(0, -1).map(([lng, lat]) => [lng, lat])
  renderParcelLayer()
  manualDrawingController.renderDraft(true)
}

async function finishPendingManualEditing(): Promise<boolean> {
  if (!editingPendingManualId) return true
  const checked = prepareManualGeometry(manualDraftPoints.value)
  if (!checked.prepared) {
    showNotice(checked.error ?? '地块几何无效。', true)
    return false
  }
  if (!await confirmManualWarnings(checked.prepared.geometry, editingPendingManualId)) return false
  const source = editingBatchManualKind === 'existing' ? effectiveBatchManualParcels() : pendingManualParcels.value
  const original = source.find((feature) => feature.properties.id === editingPendingManualId)
  if (!original) return false
  const updated = makeManualParcel(parcelVillageCode, checked.prepared, original)
  updateManualParcel(manualBatchState, updated, editingBatchManualKind === 'existing' ? 'existing' : 'new')
  editingPendingManualId = null
  editingBatchManualKind = null
  manualDraftPoints.value = []
  manualDrawingController.clearDraft()
  renderParcelLayer()
  return true
}

function removeBatchManualParcel(id: string) {
  const kind = editingBatchManualKind === 'existing' || manualParcels.some((feature) => feature.properties.id === id) ? 'existing' : 'new'
  removeManualParcel(manualBatchState, id, kind)
  if (editingPendingManualId === id) {
    editingPendingManualId = null
    editingBatchManualKind = null
    manualDraftPoints.value = []
    manualDrawingController.clearDraft()
  }
  manualDraftDirty.value = batchHasChanges.value
  renderParcelLayer()
}

async function saveManualBatch() {
  if (!parcelVillageCode || (parcelMode.value !== 'batch' && parcelMode.value !== 'drawing')) return
  if (editingPendingManualId && !await finishPendingManualEditing()) return
  if (manualDraftPoints.value.length) {
    showNotice('当前地块尚未闭合，请点击第一个顶点或按 N 完成绘制。', true)
    return
  }
  if (!batchHasChanges.value) return
  const nextFeatures = commitManualBatch(manualParcels, manualBatchState)
  for (const id of pendingRemovedManualIds.value) {
    const cleaned = removeCultivationForParcel(parcelVillageCode, id)
    if (!cleaned.ok) { showNotice(cleaned.error ?? '删除地块关联档案失败，未保存本批次。', true); return }
  }
  const addedCount = pendingManualParcels.value.length
  const changedCount = pendingManualEdits.value.length
  const removedCount = pendingRemovedManualIds.value.length
  const persisted = writeManualParcels(parcelVillageCode, nextFeatures)
  if (!persisted.ok) {
    showNotice(persisted.error, true)
    return
  }
  manualParcels = persisted.features
  hasManualParcels.value = manualParcels.length > 0
  for (const id of pendingRemovedManualIds.value) {
    hiddenParcelIds.delete(id)
    pendingHideParcelIds.delete(id)
    pendingRestoreParcelIds.delete(id)
  }
  persistHiddenParcelIds(parcelVillageCode, hiddenParcelIds)
  resetManualBatch(manualBatchState)
  manualDraftDirty.value = false
  leaveParcelWorkMode()
  manualDrawingController.clearDraft()
  renderParcelLayer()
  showNotice(`已保存：新增 ${addedCount} 个，修改 ${changedCount} 个，移除 ${removedCount} 个`)
}

async function cancelManualBatch(silent = false) {
  const hasOpenDraft = manualDraftPoints.value.length > 0 && !editingPendingManualId
  const hasPendingEdit = Boolean(editingPendingManualId)
  const hasContent = pendingManualParcels.value.length > 0 || pendingManualEdits.value.length > 0 || pendingRemovedManualIds.value.length > 0 || hasOpenDraft || hasPendingEdit
  if (!silent && hasContent
      && !await openManualDialog('取消新增地块', '当前有未保存的操作，是否确认放弃？', '确认放弃')) return
  resetManualBatch(manualBatchState)
  editingPendingManualId = null
  editingBatchManualKind = null
  manualDraftPoints.value = []
  manualDraftDirty.value = false
  manualDrawingController.clearDraft()
  leaveParcelWorkMode()
  renderParcelLayer()
}

function cancelManualSession() {
  manualDrawingController.setInteraction('none')
  manualDrawingController.clearDraft()
  manualDraftPoints.value = []
  manualDraftDirty.value = false
  editingManualOriginal = null
  leaveParcelWorkMode()
  renderParcelLayer()
}

function manualWarningMessage(overlapCount: number, outsideVillage: boolean, incompleteChecks: number): string {
  const parts: string[] = []
  if (overlapCount) parts.push(`与 ${overlapCount} 个已有地块重叠`)
  if (outsideVillage) parts.push('部分范围越过当前村界')
  if (incompleteChecks) parts.push(`${incompleteChecks} 项空间关系无法完整校验`)
  return `当前地块${parts.join('，')}。是否仍要保存？`
}

async function saveManualDraft() {
  if (!parcelVillageCode) return
  const checked = prepareManualGeometry(manualDraftPoints.value)
  if (!checked.prepared) {
    showNotice(checked.error ?? '地块几何无效。', true)
    return
  }
  const editingId = editingManualOriginal?.properties.id
  const otherFeatures: Feature[] = [
    ...(parcelSource?.features ?? []),
    ...manualParcels.filter((feature) => feature.properties.id !== editingId),
  ]
  const warnings = inspectManualGeometry(checked.prepared.geometry, store.current.geometry, otherFeatures)
  if ((warnings.overlapCount || warnings.outsideVillage || warnings.incompleteChecks)
      && !await openManualDialog('地块范围提醒', manualWarningMessage(warnings.overlapCount, warnings.outsideVillage, warnings.incompleteChecks), '仍要保存')) return

  const next = makeManualParcel(
    parcelVillageCode,
    checked.prepared,
    editingManualOriginal ?? undefined,
    undefined,
  )
  const nextFeatures = editingManualOriginal
    ? manualParcels.map((feature) => feature.properties.id === editingManualOriginal!.properties.id ? next : feature)
    : [...manualParcels, next]
  const persisted = writeManualParcels(parcelVillageCode, nextFeatures)
  if (!persisted.ok) {
    showNotice(persisted.error, true)
    return
  }
  manualParcels = persisted.features
  hasManualParcels.value = manualParcels.length > 0
  manualDrawingController.clearDraft()
  manualDraftPoints.value = []
  manualDraftDirty.value = false
  editingManualOriginal = null
  leaveParcelWorkMode()
  renderParcelLayer()
  showNotice('人工地块已保存到当前浏览器')
}

function hasUnsavedParcelWork(): boolean {
  if (cultivationEditing.value) return true
  if (parcelMode.value === 'batch' || parcelMode.value === 'drawing') return manualDraftPoints.value.length > 0 || batchHasChanges.value || Boolean(editingPendingManualId)
  if (parcelMode.value === 'editing') return manualDraftDirty.value
  return pendingChangeCount.value > 0
}

function crumbRepresentativePoint(crumb: typeof store.current){
 const geometry=crumb.geometry??provinceGeometry
 if(geometry){const [lon,lat]=pointOnFeature({type:'Feature',properties:{},geometry}).geometry.coordinates;return{lat,lon}}
 return null
}
function selectedParcelFeature(): Feature | null {
  if(!selectedParcel.value)return null
  const id=selectedParcel.value.id
  return [...(parcelSource?.features??[]),...manualParcels].find(feature=>parcelId(feature)===id)??null
}
function currentWeatherQuery(){return defaultWeatherQuery(store.current,selectedParcel.value?{feature:selectedParcelFeature()}:null)}
async function enterWeatherMode(){
 if(!weatherEntry.value.enabled)return
 if(disasterActive.value)exitTyphoonMode(false)
 closeBusinessForDisaster();weatherStore.open();const skeletonPoint=crumbRepresentativePoint(store.current);if(skeletonPoint)weatherLayerController?.renderLoading(skeletonPoint);await weatherRepository.load(currentWeatherQuery());weatherRepository.startAutoRefresh()
}
function exitWeatherMode(){weatherRepository.exit();weatherLayerController?.clear();weatherStore.close();void nextTick(()=>mapControlRef.value?.focusWeather())}
function refreshWeather(){void weatherRepository.retry()}
function selectWeatherAlert(selection:WeatherSelection){weatherStore.selectAlert(selection);const region=weatherStore.bundle?.alerts.data.find(r=>r.code===selection.contextCode);if(region){const p=map.latLngToContainerPoint([region.point[1],region.point[0]]);weatherPopupPosition.value={x:p.x,y:p.y}}}
function closeWeatherLocation(){const picked=weatherStore.closeLocation();if(picked){weatherLayerController.clearPicked();if(weatherStore.defaultBundle)weatherLayerController.renderDefault(weatherStore.defaultBundle)}}
function loadPickedWeather(lat:number,lon:number){weatherStore.closeLocation();weatherLayerController.clearPicked();void weatherRepository.load(pickedWeatherQuery(store.current,lat,lon)).then(()=>{if(weatherStore.bundle?.target==='picked'){weatherLayerController.renderPicked(weatherStore.bundle);const p=map.latLngToContainerPoint([lat,lon]);weatherPopupPosition.value={x:p.x,y:p.y};weatherStore.openLocation('picked')}})}
function closeBusinessForDisaster() {
  clearSelection()
  rosterOpen.value = false
}

async function prepareProvinceLayersWithoutMovingCamera() {
  await nextTick()
  if (provinceRenderPromise) await provinceRenderPromise
  else await render(true)
}

function rollbackTyphoonMode(error?: unknown) {
  typhoonRepository?.exit()
  typhoonLayerController?.clear()
  typhoonPlaybackController?.cancel()
  visibleObservationCountByTyphoon.value = {}
  typhoonPopupState.value = { hover: null, pinned: null }
  disasterActive.value = false
  fittedTyphoonSessionId = null
  flySeq += 1
  provinceRenderPromise = null
  if (error) showNotice('台风模式加载异常，请稍后重新进入。', true)
}

async function enterTyphoonMode() {
  if(weatherActive.value)return
  // 省级状态 watch 只换行政图层；保持当前相机，等待实时台风直接接管首次视角。
  pendingNoFly = true
  const entered = await disasterModeCoordinator.enter({
    hasUnsavedWork: hasUnsavedParcelWork,
    isActive: () => disasterActive.value,
    setActive: (active) => { disasterActive.value = active },
    closeBusinessPanels: closeBusinessForDisaster,
    resetToProvince: () => store.resetToProvince(),
    prepareProvinceLayers: prepareProvinceLayersWithoutMovingCamera,
    enterRepository: () => {
      pendingNoFly = false
      fittedTyphoonSessionId = null
      map.setZoom(TYPHOON_INITIAL_ZOOM, { animate: false })
      void typhoonRepository.enter()
    },
    rollback: rollbackTyphoonMode,
  })
  if (!entered) { pendingNoFly = false; provinceRenderPromise = null }
}

function focusTyphoonFromUser(typhoonId: string, nodeId?: string) {
  typhoonStore.focusTyphoon(typhoonId)
  if (nodeId) typhoonStore.selectNode(typhoonId, nodeId)
}

function revealTyphoon(typhoonId: string, nodeId?: string) {
  focusTyphoonFromUser(typhoonId, nodeId)
  if (!typhoonStore.expandedIds.includes(typhoonId)) typhoonStore.toggleExpanded(typhoonId)
  typhoonRevealToken.value += 1
}

function toggleTyphoonCard(typhoonId: string) {
  focusTyphoonFromUser(typhoonId)
  typhoonStore.toggleExpanded(typhoonId)
  typhoonRevealToken.value += 1
}

function closeHistoricalTyphoon(typhoonId: string) {
  typhoonPlaybackController?.cancel(typhoonId)
  typhoonPopupState.value = clearPopupForTyphoon(typhoonPopupState.value, typhoonId)
  const nextVisible = { ...visibleObservationCountByTyphoon.value }
  delete nextVisible[typhoonId]
  visibleObservationCountByTyphoon.value = nextVisible
  typhoonStore.closeHistorical(typhoonId)
}

function playHistoricalTyphoon(typhoonId: string) {
  const detail = typhoonStore.details[typhoonId]
  if (!detail || detail.status !== 'stop') return
  typhoonPlaybackController.play(detail, {
    onStep: (node, visibleCount) => {
      visibleObservationCountByTyphoon.value = { ...visibleObservationCountByTyphoon.value, [typhoonId]: visibleCount }
      typhoonStore.advancePlaybackNode(typhoonId, node.id)
    },
    onComplete: (node, visibleCount) => {
      visibleObservationCountByTyphoon.value = { ...visibleObservationCountByTyphoon.value, [typhoonId]: visibleCount }
      typhoonStore.advancePlaybackNode(typhoonId, node.id)
    },
  })
}

function toggleHistoricalFromTimeline(typhoonId: string) {
  if (typhoonStore.openedHistoricalIds.includes(typhoonId)) {
    closeHistoricalTyphoon(typhoonId)
    return
  }
  // 每条历史台风独立播放；打开新台风不停止其他台风的计时器。
  if (!typhoonStore.openHistorical(typhoonId)) return
  const detail = typhoonStore.details[typhoonId]!
  visibleObservationCountByTyphoon.value = { ...visibleObservationCountByTyphoon.value, [typhoonId]: Math.min(1, detail.observationsAsc.length) }
  const fullSnapshot = mapTyphoonLayerSnapshot({
    realtimeDetails: typhoonStore.realtimeDetails,
    openedHistoricalIds: typhoonStore.openedHistoricalIds,
    details: typhoonStore.details,
    focusedTyphoonId: typhoonId,
    selectedNodeByTyphoon: typhoonStore.selectedNodeByTyphoon,
  })
  typhoonLayerController.render(fullSnapshot)
  const firstNode = detail.observationsAsc[0]
  if (firstNode) typhoonLayerController.setViewForTyphoonNode(typhoonId, firstNode.id, TYPHOON_INITIAL_ZOOM)
  playHistoricalTyphoon(typhoonId)
}

function selectActualTyphoonNode(typhoonId: string, nodeId: string) {
  typhoonPlaybackController?.cancel(typhoonId)
  const detail = typhoonStore.details[typhoonId]
  const selection = actualNodeSelection(detail, 'actual', nodeId)
  if (!selection) return false
  if (selection.visibleObservationCount !== undefined) {
    visibleObservationCountByTyphoon.value = { ...visibleObservationCountByTyphoon.value, [typhoonId]: selection.visibleObservationCount }
  }
  revealTyphoon(typhoonId, nodeId)
  void nextTick(() => typhoonLayerController.panNodeIntoView(typhoonId, nodeId, { padding: [40, 40] }))
  return true
}

function selectTyphoonPanelNode(typhoonId: string, nodeId: string) {
  selectActualTyphoonNode(typhoonId, nodeId)
}

function exitTyphoonMode(restoreView = true) {
  disasterModeCoordinator.exit({
    isActive: () => disasterActive.value,
    exitRepository: () => typhoonRepository?.exit(),
    clearTyphoonLayers: () => typhoonLayerController?.clear(),
    setActive: (active) => { disasterActive.value = active },
    invalidateNavigation: () => { flySeq += 1; provinceRenderPromise = null },
    restoreProvinceView: () => {
      if (!restoreView) return
      const alreadyProvince = store.path.length === 1 && store.current.level === 'province'
      void store.resetToProvince().then((reset) => {
        if (!reset || !alreadyProvince) return
        provinceRenderPromise = render().finally(() => { provinceRenderPromise = null })
      })
    },
  })
  fittedTyphoonSessionId = null
  typhoonPlaybackController?.cancel()
  visibleObservationCountByTyphoon.value = {}
  typhoonPopupState.value = { hover: null, pinned: null }
  // 业务抽屉保持关闭；行政状态和相机恢复浙江省默认视角。
}

function isTypingTarget(target: EventTarget | null): boolean {
  return target instanceof HTMLElement && (target.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName))
}

function onManualKeydown(event: KeyboardEvent) {
  if (isTypingTarget(event.target)) return
  if(event.key==='Escape'&&weatherActive.value&&(weatherStore.locationPopup!=='none'||weatherStore.selection)){event.preventDefault();if(weatherStore.locationPopup!=='none')closeWeatherLocation();else weatherStore.selectAlert(null);return}
  if (event.key === 'Escape' && typhoonPopupState.value.pinned) {
    event.preventDefault()
    typhoonPopupState.value = clearPinnedPopup(typhoonPopupState.value)
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
  if (event.key === 'Delete' && parcelMode.value === 'batch' && editingPendingManualId) {
    event.preventDefault()
    removeBatchManualParcel(editingPendingManualId)
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
  clearLayers()
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
    // zoomend 早于 moveend：保持抑制到本次程序化移动完全结束，防止点击下钻后被自动退出逻辑撤销。
    suppressAutoZoom = true
    map.once('moveend', () => { if (isCurrent()) suppressAutoZoom = false })
    setTimeout(() => { if (isCurrent()) suppressAutoZoom = false }, 1500)
    if (firstRender) {
      // 首次渲染: 瞬时贴合省界(不播动画), 默认视野铺满屏幕
      map.fitBounds(bounds.pad(0.02))
      firstRender = false
    } else {
      // 下钻/返回: 同样的紧贴边距, 飞行动画
      map.flyToBounds(bounds.pad(0.02), { duration: 1.0 })
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
    parcelVillageCode = crumb.code
    const manualResult = readManualParcels(crumb.code)
    manualParcels = manualResult.features
    hasManualParcels.value = manualParcels.length > 0
    hiddenParcelIds.clear()
    for (const id of loadHiddenParcelIds(crumb.code)) hiddenParcelIds.add(id)
    if (manualResult.error) showNotice(manualResult.error, true)
    renderParcelLayer()
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
          if (parcels?.features.length) {
            parcelSource = parcels
            hasAiParcels.value = true
            const validIds = new Set([
              ...parcels.features.map(parcelId).filter((id): id is ParcelId => id !== null),
              ...manualParcels.map((feature) => feature.properties.id),
            ])
            for (const id of [...hiddenParcelIds]) {
              if (!validIds.has(id)) hiddenParcelIds.delete(id)
            }
            renderParcelLayer()
          }
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
  if(weatherActive.value){weatherLayerController?.clearPicked();weatherStore.locationPopup='none';weatherStore.selection=null;void weatherRepository.load(currentWeatherQuery())}
  const nf = pendingNoFly
  pendingNoFly = false
  // 所有导航都经过 store 守卫；确认离开后在重渲染前丢弃本轮草稿与待筛选状态。
  if (parcelMode.value === 'filter') {
    clearPendingParcelFilterState(parcelFilterState)
    syncPendingParcelCounts()
  }
  manualDrawingController.setInteraction('none')
  manualDrawingController.clearDraft()
  manualDraftPoints.value = []
  manualDraftDirty.value = false
  provinceRenderPromise = render(nf).finally(() => { provinceRenderPromise = null })
})

watch(() => weatherStore.bundle,(bundle)=>{if(!weatherActive.value||!bundle)return;if(bundle.target==='picked')weatherLayerController?.renderPicked(bundle);else weatherLayerController?.renderDefault(bundle);weatherLayerController?.renderAlerts(bundle.alerts.data,weatherStore.selection)})
watch(()=>weatherStore.selection,selection=>{if(weatherStore.bundle)weatherLayerController?.renderAlerts(weatherStore.bundle.alerts.data,selection)})

watch(() => ({
  active: disasterActive.value,
  sessionId: typhoonStore.sessionId,
  realtime: typhoonStore.realtimeDetails,
  opened: typhoonStore.openedHistoricalIds,
  focused: typhoonStore.focusedTyphoonId,
  selected: { ...typhoonStore.selectedNodeByTyphoon },
  visibleCounts: { ...visibleObservationCountByTyphoon.value },
  phase: typhoonStore.phase,
}), (state) => {
  if (!state.active || !typhoonLayerController) return
  typhoonLayerController.render(mapTyphoonLayerSnapshot({
    realtimeDetails: state.realtime,
    openedHistoricalIds: state.opened,
    details: typhoonStore.details,
    focusedTyphoonId: state.focused,
    selectedNodeByTyphoon: state.selected,
    visibleObservationCountByTyphoon: state.visibleCounts,
  }))
  if (shouldAutoFitTyphoon({ active: state.active, phase: state.phase, focusedId: state.focused, realtimeIds: state.realtime.map((detail) => detail.id), sessionId: state.sessionId, fittedSessionId: fittedTyphoonSessionId })) {
    if (typhoonLayerController.setInitialViewForTyphoon(state.focused!, TYPHOON_INITIAL_ZOOM)) {
      fittedTyphoonSessionId = state.sessionId
    }
  }
}, { deep: true })

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
      pendingNoFly = true
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

  // 缩小: 退回上级
  const exitZ = EXIT_ZOOM[crumb.level]
  if (exitZ !== undefined && z <= exitZ && store.path.length > 1) {
    pendingNoFly = true
    store.back()
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
  parcelLayerController = createParcelLayerController(
    map,
    () => ({
      mode: parcelMode.value,
      parcelOn: parcelOn.value,
      parcelSource,
      manualParcels,
      pendingManualParcels: pendingManualParcels.value,
      pendingManualEdits: pendingManualEdits.value,
      removedManualIds: pendingRemovedManualIds.value,
      editingManualOriginalId: editingManualOriginal?.properties.id ?? null,
      editingPendingManualId,
      editingBatchKind: editingBatchManualKind,
      hiddenIds: hiddenParcelIds,
      pendingHideIds: pendingHideParcelIds,
      pendingRestoreIds: pendingRestoreParcelIds,
    }),
    {
      parcelId,
      onFilterToggle: toggleParcelFilterSelection,
      onSelectBase: (feature, event) => { const parcel = fromBaseParcel(feature.properties ?? {}); if (parcel) requestSelectParcel(parcel, event) },
      onSelectManual: (feature, event) => { requestSelectParcel(fromManualParcel(feature), event) },
      onEditExisting: (feature) => { void startBatchExistingManualEditing(feature) },
      onEditPending: (feature) => { void startPendingManualEditing(feature) },
      onAfterRender: navigationController.bringOutlineToFront,
      selectionStyle,
    },
  )
  map.on('click', (event) => {
    if (typhoonPopupState.value.pinned) typhoonPopupState.value = clearPinnedPopup(typhoonPopupState.value)
    if (parcelDetailClickGuard.consumeMapClick(event.originalEvent)) return
    const target = event.originalEvent.target
    // Canvas 矢量地块共用地图 canvas；点击 canvas 不等同于地图空白，不能用于关闭详情。
    if (target instanceof HTMLCanvasElement) return
    if (parcelMode.value === 'idle' && selectedParcel.value && !rosterOpen.value) void requestCloseDetail()
  })
  manualDrawingController = createManualDrawingController(
    map,
    () => ({
      mode: parcelMode.value,
      points: manualDraftPoints.value,
      distinctPointCount: manualDistinctPointCount.value,
      selectedId: editingPendingManualId,
    }),
    {
      onPointAdded: (point) => {
        manualDraftPoints.value = [...manualDraftPoints.value, point]
        manualDraftDirty.value = true
        manualDrawingController.renderDraft(false)
      },
      onPointMoved: (index, point) => {
        manualDraftPoints.value[index] = point
        manualDraftDirty.value = true
      },
      onCloseRequested: () => { void finishManualDrawing() },
      onBlankMapClick: () => { if (parcelMode.value === 'idle' && selectedParcel.value) void requestCloseDetail(); else void finishPendingManualEditing() },
      onRemoveRequested: removeBatchManualParcel,
    },
  )
  workModeController = createParcelWorkModeController(map, {
    defaultMinZoom: DEFAULT_MIN_ZOOM,
    editMinZoom: PARCEL_EDIT_MIN_ZOOM,
    onModeChange: (mode) => { parcelMode.value = mode },
    onMinZoomChange: (minZoom) => { mapMinZoom.value = minZoom },
    stopDrawingInteraction: () => manualDrawingController.setInteraction('none'),
  })
  const setHover = (target: TyphoonHoverTarget, point: { x: number; y: number }) => {
    typhoonPopupState.value = hoverPopup(typhoonPopupState.value, target)
    typhoonHoverPosition.value = point
  }
  const clearHover = (target: TyphoonHoverTarget) => { typhoonPopupState.value = leavePopup(typhoonPopupState.value, target) }
  const pinTyphoonPopup = (target: TyphoonHoverTarget, point: { x: number; y: number }) => {
    typhoonPopupState.value = pinPopup(typhoonPopupState.value, target)
    typhoonHoverPosition.value = point
  }
  weatherLayerController=createWeatherLayerController(map,{onLocationClick:(kind,point)=>{weatherPopupPosition.value=point;weatherStore.openLocation(kind)},onAlertClick:(selection,point)=>{weatherPopupPosition.value=point;weatherStore.selectAlert(selection)}})
  weatherInteractionController=createWeatherInteractionController(map,{active:()=>weatherActive.value,editing:()=>parcelMode.value!=='idle',provinceGeometry:()=>provinceGeometry,onPicked:loadPickedWeather,onOutside:()=>showNotice('天气当前仅支持浙江省范围',true)})
  weatherRepository=createWeatherRepository(weatherStore)
  typhoonLayerController = createTyphoonLayerController(map, {
    onTyphoonClick: ({ typhoonId }) => revealTyphoon(typhoonId),
    onNodeClick: ({ typhoonId, nodeId, kind, containerPoint }) => {
      if (kind === 'actual') selectActualTyphoonNode(typhoonId, nodeId)
      else revealTyphoon(typhoonId)
      if (kind === 'actual') pinTyphoonPopup({ kind: 'center', typhoonId, nodeId }, containerPoint)
    },
    onNodeEnter: ({ typhoonId, nodeId, kind, containerPoint }) => {
      setHover({ kind: kind === 'actual' ? 'center' : 'forecast', typhoonId, nodeId }, containerPoint)
    },
    onNodeLeave: ({ typhoonId, nodeId, kind }) => {
      clearHover({ kind: kind === 'actual' ? 'center' : 'forecast', typhoonId, nodeId })
    },
    onCenterClick: ({ typhoonId, nodeId, containerPoint }) => { selectActualTyphoonNode(typhoonId, nodeId); pinTyphoonPopup({ kind: 'center', typhoonId, nodeId }, containerPoint) },
    onWindCircleClick: ({ typhoonId, nodeId, grade, containerPoint }) => { selectActualTyphoonNode(typhoonId, nodeId); pinTyphoonPopup({ kind: 'wind', typhoonId, nodeId, grade }, containerPoint) },
    onCenterEnter: ({ typhoonId, nodeId, containerPoint }) => setHover({ kind: 'center', typhoonId, nodeId }, containerPoint),
    onCenterLeave: ({ typhoonId, nodeId }) => clearHover({ kind: 'center', typhoonId, nodeId }),
  })
  typhoonRepository = createTyphoonSessionRepository(typhoonStore)
  typhoonPlaybackController = createTyphoonPlaybackController({
    reducedMotion: () => window.matchMedia('(prefers-reduced-motion: reduce)').matches,
  })
  await loadBusinessData()
  basemaps = createBasemaps()
  basemaps.img.addTo(map)
  const syncMapViewport = () => {
    const size = map.getSize()
    mapViewport.value = { width: size.x, height: size.y }
  }
  syncMapViewport()
  map.on('resize', syncMapViewport)
  map.getContainer().addEventListener('pointermove', () => {
    typhoonPopupState.value = clearPinnedWindPopupOnMove(typhoonPopupState.value)
  })
  map.on('zoomend', () => {
    currentZoom.value = map.getZoom()
    if (zoomLevelOutput) zoomLevelOutput.textContent = `Z ${currentZoom.value.toFixed(2)}`
    onAutoLevel()
  })
  store.setNavigationGuard(async () => {
    if (!hasUnsavedParcelWork()) { clearSelection(); return true }
    return openManualDialog('离开当前村', '当前修改尚未保存，离开后将丢失。是否继续？', '确认离开')
  })
  beforeUnloadHandler = (event: BeforeUnloadEvent) => {
    if (!hasUnsavedParcelWork()) return
    event.preventDefault()
  }
  window.addEventListener('beforeunload', beforeUnloadHandler)
  window.addEventListener('keydown', onManualKeydown)
  render()
})

onBeforeUnmount(() => {
  exitWeatherMode()
  exitTyphoonMode(false)
  disposed = true
  flySeq += 1
  if (saveNoticeTimer) clearTimeout(saveNoticeTimer)
  if (beforeUnloadHandler) window.removeEventListener('beforeunload', beforeUnloadHandler)
  window.removeEventListener('keydown', onManualKeydown)
  store.setNavigationGuard(null)
  typhoonPlaybackController?.destroy()
  typhoonLayerController?.destroy()
  weatherInteractionController?.destroy()
  weatherLayerController?.destroy()
  workModeController?.destroy()
  manualDrawingController?.destroy()
  parcelLayerController?.destroy()
  navigationController?.destroy()
  map?.remove()
})
</script>

<style src="./map/MapView.css"></style>
