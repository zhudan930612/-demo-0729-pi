<template>
  <div class="map-wrap" :class="{ 'parcel-editing': parcelMode !== 'idle', 'parcel-drawing': parcelMode === 'drawing' }">
    <div ref="mapEl" class="map"></div>

    <!-- 村级地块业务操作：新增与筛选保持同组常驻，进入模式后原位替换。 -->
    <ParcelEditToolbar
      v-if="store.current.level === 'village'"
      :mode="parcelMode"
      :parcel-on="parcelOn"
      :has-filterable-parcels="hasFilterableParcels"
      :hidden-count="hiddenParcelCount"
      :pending-hide-count="pendingHideCount"
      :pending-restore-count="pendingRestoreCount"
      :pending-change-count="pendingChangeCount"
      :batch-saved-count="batchSavedCount"
      :draft-point-count="manualDraftPoints.length"
      :batch-has-changes="batchHasChanges"
      :draft-area-text="manualDraftAreaText"
      @start-manual="startManualDrawing"
      @start-filter="startParcelEditing"
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

    <!-- 右下角竖排图标按钮 -->
    <div class="ctrl-stack">
      <button
        class="icon-btn"
        :title="basemap === 'img' ? '底图：卫星（点击切换矢量）' : '底图：矢量（点击切换卫星）'"
        @click="switchBasemap(basemap === 'img' ? 'vec' : 'img')"
      >
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"
             stroke-linecap="round" stroke-linejoin="round">
          <path d="M12 2 2 7l10 5 10-5-10-5z" />
          <path d="m2 17 10 5 10-5" />
          <path d="m2 12 10 5 10-5" />
        </svg>
      </button>
      <button
        v-if="rsVisible"
        class="icon-btn"
        :class="{ off: !rsOn }"
        :title="rsOn ? '高分影像：开（点击关闭）' : '高分影像：关（点击打开）'"
        @click="toggleRs"
      >
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"
             stroke-linecap="round" stroke-linejoin="round">
          <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
          <circle cx="12" cy="12" r="3" />
          <line v-if="!rsOn" x1="3" y1="3" x2="21" y2="21" />
        </svg>
      </button>
      <button
        v-if="parcelVisible"
        class="icon-btn parcel-btn"
        :class="{ off: !parcelOn }"
        :disabled="parcelMode !== 'idle'"
        :title="parcelMode !== 'idle' ? '操作地块时不能关闭图层' : (parcelOn ? '地块：开（点击关闭）' : '地块：关（点击打开）')"
        @click="toggleParcels"
      >
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"
             stroke-linecap="round" stroke-linejoin="round">
          <path d="m3 4 7-1 3 6-2 11-8 1z" />
          <path d="m10 3 8 2 3 6-4 9-6-1" />
          <path d="m13 9 8 2" />
          <path d="m4 14 8-2" />
        </svg>
      </button>
    </div>

    <div class="zoom-stack" aria-label="地图缩放工具">
      <button class="icon-btn" :disabled="!canZoomIn" title="放大" aria-label="放大" @click="zoomIn">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"
             stroke-linecap="round" aria-hidden="true">
          <path d="M5 12h14M12 5v14" />
        </svg>
      </button>
      <button class="icon-btn" :disabled="!canZoomOut" title="缩小" aria-label="缩小" @click="zoomOut">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"
             stroke-linecap="round" aria-hidden="true">
          <path d="M5 12h14" />
        </svg>
      </button>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, onBeforeUnmount, reactive, ref, toRef, watch } from 'vue'
import L from 'leaflet'
import ManualConfirmDialog from './map/ManualConfirmDialog.vue'
import ParcelEditToolbar from './map/ParcelEditToolbar.vue'
import ParcelStatusCard from './map/ParcelStatusCard.vue'
import type { Feature, FeatureCollection, Geometry, Position } from 'geojson'
import type { ParcelId, ParcelMode } from '../features/parcels/parcelTypes'
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
import {
  calculateNextHiddenIds,
  clearPendingParcelFilterState,
  createParcelFilterState,
  restoreAllParcels,
  toggleParcelFilterSelection as toggleFilterSelection,
} from '../features/parcels/parcelFilterState'
import {
  MANUAL_DRAFT_STYLE,
  MANUAL_PARCEL_STYLE,
  MANUAL_PENDING_STYLE,
  PARCEL_EDIT_STYLE,
  PARCEL_HIDDEN_STYLE,
  PARCEL_HOVER_STYLE,
  PARCEL_PENDING_HIDE_STYLE,
  PARCEL_PENDING_RESTORE_STYLE,
  PARCEL_STYLE,
} from '../features/parcels/parcelStyles'
import {
  useDrilldownStore,
  childrenUrl,
  NEXT_LEVEL,
  LEVEL_WEIGHT,
  type Crumb,
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
const PARCEL_STORAGE_KEY = 'agri-map:parcel-edits:v1'
const PARCEL_DATASET_VERSION = '2025-04-02-v1'
const DEFAULT_MIN_ZOOM = 7
const PARCEL_EDIT_MIN_ZOOM = 15.25 // 高于村级 z<=15.0 自动退出阈值
const PARCEL_AREA_LABEL_MIN_ZOOM = 18.5
const M2_PER_MU = 2000 / 3

interface ParcelEditRecord {
  datasetVersion: string
  hiddenIds: ParcelId[]
}
interface ParcelEditStorage {
  version: 1
  villages: Record<string, ParcelEditRecord>
}

const mapEl = ref<HTMLDivElement>()
const store = useDrilldownStore()
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

// Canvas 渲染器: 百余个复杂多边形时比默认 SVG 渲染流畅一个量级
const canvasRenderer = L.canvas({ padding: 0.5 })

let map: L.Map
let childLayer: L.GeoJSON | null = null
let outlineLayer: L.GeoJSON | null = null
let rsLayer: L.TileLayer | null = null
let parcelLayer: L.GeoJSON | null = null
let manualParcelLayer: L.GeoJSON | null = null
let pendingManualLayer: L.GeoJSON | null = null
let manualDraftLayer: L.Polygon | L.Polyline | null = null
let manualVertexLayer: L.LayerGroup | null = null
let manualDraftAreaMarker: L.Marker | null = null
let pendingActionMarker: L.Marker | null = null
let batchAreaLabelLayer: L.LayerGroup | null = null
let parcelAreaLabelLayer: L.LayerGroup | null = null
let editDimLayer: L.Rectangle | null = null
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
let firstRender = true
let pendingNoFly = false // 自动切换层级时不重排视野(决策: 不动视野)
let suppressAutoZoom = false // 点击下钻/返回的程序化缩放不得触发自动进退层级
let basemaps: Basemaps
let beforeUnloadHandler: ((event: BeforeUnloadEvent) => void) | null = null
let manualDialogResolve: ((confirmed: boolean) => void) | null = null

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

function clearLayers() {
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
  if (childLayer) { childLayer.remove(); childLayer = null }
  if (outlineLayer) { outlineLayer.remove(); outlineLayer = null }
  if (rsLayer) { rsLayer.remove(); rsLayer = null }
  if (parcelLayer) { parcelLayer.remove(); parcelLayer = null }
  if (manualParcelLayer) { manualParcelLayer.remove(); manualParcelLayer = null }
  if (pendingManualLayer) { pendingManualLayer.remove(); pendingManualLayer = null }
  if (pendingActionMarker) { pendingActionMarker.remove(); pendingActionMarker = null }
  if (batchAreaLabelLayer) { batchAreaLabelLayer.remove(); batchAreaLabelLayer = null }
  clearManualDraftLayers()
  if (parcelAreaLabelLayer) { parcelAreaLabelLayer.remove(); parcelAreaLabelLayer = null }
  rsVisible.value = false
  parcelVisible.value = false
  rsHint.value = ''
  rsOn.value = true
  parcelOn.value = true
}

/** 高分影像 开/关 */
function toggleRs() {
  rsOn.value = !rsOn.value
  rsLayer?.setOpacity(rsOn.value ? RS_OPACITY : 0)
}

/** AI 地块独立开/关 */
function toggleParcels() {
  if (parcelMode.value !== 'idle') return
  parcelOn.value = !parcelOn.value
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

function readParcelStorage(): ParcelEditStorage {
  try {
    const parsed = JSON.parse(localStorage.getItem(PARCEL_STORAGE_KEY) ?? '') as ParcelEditStorage
    if (parsed.version === 1 && parsed.villages && typeof parsed.villages === 'object') return parsed
  } catch {
    // localStorage 不可用或旧数据损坏时按空记录处理，不影响地图展示。
  }
  return { version: 1, villages: {} }
}

function loadHiddenParcelIds(villageCode: string): Set<ParcelId> {
  const record = readParcelStorage().villages[villageCode]
  if (!record || record.datasetVersion !== PARCEL_DATASET_VERSION || !Array.isArray(record.hiddenIds)) {
    return new Set()
  }
  return new Set(record.hiddenIds.map(String))
}

function persistHiddenParcelIds(villageCode: string, ids: Set<ParcelId>): boolean {
  try {
    const storage = readParcelStorage()
    if (ids.size) {
      storage.villages[villageCode] = {
        datasetVersion: PARCEL_DATASET_VERSION,
        hiddenIds: [...ids].sort((a, b) => a.localeCompare(b, undefined, { numeric: true })),
      }
    } else {
      delete storage.villages[villageCode]
    }
    localStorage.setItem(PARCEL_STORAGE_KEY, JSON.stringify(storage))
    return true
  } catch {
    return false
  }
}

function updateParcelAreaLabels() {
  parcelAreaLabelLayer?.clearLayers()
  if (!parcelVisible.value || !parcelOn.value || map.getZoom() < PARCEL_AREA_LABEL_MIN_ZOOM) return

  if (!parcelAreaLabelLayer) parcelAreaLabelLayer = L.layerGroup().addTo(map)
  const view = map.getBounds().pad(0.05)
  const displayedFeatures: Feature[] = [
    ...(parcelSource?.features.filter((feature) => {
      const id = parcelId(feature)
      return parcelMode.value === 'filter' || parcelMode.value === 'batch' || parcelMode.value === 'drawing' || id === null || !hiddenParcelIds.has(id)
    }) ?? []),
    ...((parcelMode.value === 'batch' || parcelMode.value === 'drawing')
      ? []
      : manualParcels.filter((feature) => parcelMode.value === 'filter' || !hiddenParcelIds.has(feature.properties.id))),
  ]
  for (const feature of displayedFeatures) {
    const properties = feature.properties ?? {}
    const lng = Number(properties.label_lng)
    const lat = Number(properties.label_lat)
    const areaMu = Number(properties.area_mu)
    if (!Number.isFinite(lng) || !Number.isFinite(lat) || !Number.isFinite(areaMu)) continue
    const point = L.latLng(lat, lng)
    if (!view.contains(point)) continue

    const icon = L.divIcon({
      className: 'parcel-area-label-wrap',
      html: `<span class="parcel-area-label">${areaMu.toFixed(2)} 亩</span>`,
      iconSize: undefined,
      iconAnchor: [0, 0],
    })
    L.marker(point, { pane: 'parcelLabelPane', icon, interactive: false, keyboard: false }).addTo(parcelAreaLabelLayer)
  }
}

function parcelEditStyle(id: ParcelId | null): L.PathOptions {
  if (!id) return PARCEL_EDIT_STYLE
  if (pendingRestoreParcelIds.has(id)) return PARCEL_PENDING_RESTORE_STYLE
  if (pendingHideParcelIds.has(id)) return PARCEL_PENDING_HIDE_STYLE
  if (hiddenParcelIds.has(id)) return PARCEL_HIDDEN_STYLE
  return PARCEL_EDIT_STYLE
}

function parcelEditActionLabel(id: ParcelId): string {
  if (hiddenParcelIds.has(id)) {
    return pendingRestoreParcelIds.has(id) ? '再次点击取消恢复' : '点击恢复此地块'
  }
  return pendingHideParcelIds.has(id) ? '再次点击取消隐藏' : '点击隐藏此地块'
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
  parcelLayer?.remove()
  manualParcelLayer?.remove()
  pendingManualLayer?.remove()
  if (pendingActionMarker) { pendingActionMarker.remove(); pendingActionMarker = null }
  if (batchAreaLabelLayer) { batchAreaLabelLayer.remove(); batchAreaLabelLayer = null }
  parcelLayer = null
  manualParcelLayer = null
  pendingManualLayer = null

  const aiFeatures = parcelSource?.features ?? []
  const showHiddenParcels = parcelMode.value === 'filter' || parcelMode.value === 'batch' || parcelMode.value === 'drawing'
  const visibleAiFeatures = aiFeatures.filter((feature) => {
    const id = parcelId(feature)
    return showHiddenParcels || id === null || !hiddenParcelIds.has(id)
  })
  const displayedAi = aiFeatures.filter((feature) => {
    const id = parcelId(feature)
    return id === null || !hiddenParcelIds.has(id)
  })
  const displayedManual = manualParcels.filter((feature) => !hiddenParcelIds.has(feature.properties.id))
  hiddenParcelCount.value = hiddenParcelIds.size
  const displayedFeatures: Feature[] = [...displayedAi, ...displayedManual]
  parcelDisplayCount.value = displayedFeatures.length
  parcelDisplayAreaMu.value = displayedFeatures.reduce((total, feature) => {
    const areaM2 = Number(feature.properties?.area_m2)
    if (Number.isFinite(areaM2)) return total + areaM2 / M2_PER_MU
    const areaMu = Number(feature.properties?.area_mu)
    return Number.isFinite(areaMu) ? total + areaMu : total
  }, 0)
  parcelVisible.value = aiFeatures.length > 0 || manualParcels.length > 0

  if (visibleAiFeatures.length) {
    const visibleParcels: FeatureCollection = { type: 'FeatureCollection', features: visibleAiFeatures }
    parcelLayer = L.geoJSON(visibleParcels, {
      interactive: parcelMode.value === 'filter' && parcelOn.value,
      style: (feature) => {
        const id = feature ? parcelId(feature as Feature) : null
        if (parcelMode.value === 'filter') return parcelEditStyle(id)
        if (parcelMode.value === 'batch' || parcelMode.value === 'drawing') {
          return id && hiddenParcelIds.has(id) ? PARCEL_HIDDEN_STYLE : PARCEL_EDIT_STYLE
        }
        return parcelOn.value ? PARCEL_STYLE : { ...PARCEL_STYLE, opacity: 0, fillOpacity: 0 }
      },
      onEachFeature: (feature: Feature, layer: L.Layer) => {
        const path = layer as L.Path
        const id = parcelId(feature)
        if (parcelMode.value === 'filter' && id) {
          const actionClass = hiddenParcelIds.has(id) ? 'restore' : 'hide'
          layer.bindTooltip(parcelEditActionLabel(id), { sticky: true, direction: 'top', className: `parcel-edit-tooltip ${actionClass}` })
        }
        layer.on('mouseover', () => {
          if (parcelMode.value !== 'filter' || !id) return
          const unchanged = !hiddenParcelIds.has(id) && !pendingHideParcelIds.has(id)
          path.setStyle(unchanged ? PARCEL_HOVER_STYLE : { ...parcelEditStyle(id), color: PARCEL_HOVER_STYLE.color, weight: PARCEL_HOVER_STYLE.weight })
          path.bringToFront()
        })
        layer.on('mouseout', () => {
          if (parcelMode.value === 'filter' && id) path.setStyle(parcelEditStyle(id))
        })
        layer.on('click', (event) => {
          if (parcelMode.value !== 'filter' || !id) return
          L.DomEvent.stopPropagation(event)
          toggleParcelFilterSelection(id)
          path.setStyle(parcelEditStyle(id))
          path.setTooltipContent(parcelEditActionLabel(id))
        })
      },
    }).addTo(map)
  }

  const batchManualById = new Map(pendingManualEdits.value.map((feature) => [feature.properties.id, feature]))
  const showHiddenManualParcels = parcelMode.value === 'filter' || parcelMode.value === 'batch' || parcelMode.value === 'drawing'
  const visibleManualParcels = manualParcels
    .filter((feature) => showHiddenManualParcels || !hiddenParcelIds.has(feature.properties.id))
    .filter((feature) => !pendingRemovedManualIds.value.includes(feature.properties.id))
    .map((feature) => batchManualById.get(feature.properties.id) ?? feature)
    .filter((feature) => parcelMode.value !== 'editing' || feature.properties.id !== editingManualOriginal?.properties.id)
    .filter((feature) => editingBatchManualKind !== 'existing' || feature.properties.id !== editingPendingManualId)
  if (visibleManualParcels.length) {
    const manualCollection: FeatureCollection = { type: 'FeatureCollection', features: visibleManualParcels }
    manualParcelLayer = L.geoJSON(manualCollection, {
      interactive: parcelOn.value && (parcelMode.value === 'batch' || parcelMode.value === 'filter'),
      style: (feature) => {
        if (!parcelOn.value) return { ...PARCEL_STYLE, opacity: 0, fillOpacity: 0 }
        const id = feature ? parcelId(feature as Feature) : null
        if (parcelMode.value === 'filter') return parcelEditStyle(id)
        if (parcelMode.value === 'batch' || parcelMode.value === 'drawing') return MANUAL_PARCEL_STYLE
        return PARCEL_STYLE
      },
      onEachFeature: (feature: Feature, layer: L.Layer) => {
        const manual = feature as ManualParcelFeature
        const path = layer as L.Path
        const id = manual.properties.id
        if (parcelMode.value === 'filter') {
          const actionClass = hiddenParcelIds.has(id) ? 'restore' : 'hide'
          layer.bindTooltip(parcelEditActionLabel(id), { sticky: true, direction: 'top', className: `parcel-edit-tooltip ${actionClass}` })
          layer.on('mouseover', () => {
            const unchanged = !hiddenParcelIds.has(id) && !pendingHideParcelIds.has(id)
            path.setStyle(unchanged ? PARCEL_HOVER_STYLE : { ...parcelEditStyle(id), color: PARCEL_HOVER_STYLE.color, weight: PARCEL_HOVER_STYLE.weight })
            path.bringToFront()
          })
          layer.on('mouseout', () => path.setStyle(parcelEditStyle(id)))
          layer.on('click', (event) => {
            L.DomEvent.stopPropagation(event)
            toggleParcelFilterSelection(id)
            path.setStyle(parcelEditStyle(id))
            path.setTooltipContent(parcelEditActionLabel(id))
          })
        } else if (parcelMode.value === 'batch') {
          layer.bindTooltip(`人工绘制 · ${manual.properties.area_mu.toFixed(2)} 亩`, { sticky: true, direction: 'top', className: 'manual-parcel-tooltip' })
          layer.on('click', (event) => {
            if (!parcelOn.value) return
            L.DomEvent.stopPropagation(event)
            void startBatchExistingManualEditing(manual)
          })
        }
      },
    }).addTo(map)
  }

  if ((parcelMode.value === 'batch' || parcelMode.value === 'drawing') && pendingManualParcels.value.length) {
    const visiblePending = pendingManualParcels.value.filter((feature) => feature.properties.id !== editingPendingManualId)
    if (visiblePending.length) {
      const pendingCollection: FeatureCollection = { type: 'FeatureCollection', features: visiblePending }
      pendingManualLayer = L.geoJSON(pendingCollection, {
        interactive: parcelMode.value === 'batch',
        style: MANUAL_PENDING_STYLE,
        onEachFeature: (feature: Feature, layer: L.Layer) => {
          const pending = feature as ManualParcelFeature
          layer.bindTooltip(`待保存 · ${pending.properties.area_mu.toFixed(2)} 亩`, { sticky: true, direction: 'top', className: 'manual-parcel-tooltip' })
          layer.on('click', (event) => {
            if (parcelMode.value !== 'batch') return
            L.DomEvent.stopPropagation(event)
            void startPendingManualEditing(pending)
          })
        },
      }).addTo(map)
    }
  }
  if (parcelMode.value === 'batch' && editingPendingManualId) renderPendingRemoveAction()
  if (parcelMode.value === 'batch' || parcelMode.value === 'drawing') renderBatchAreaLabels(visibleManualParcels)
  outlineLayer?.bringToFront()
  updateParcelAreaLabels()
}

function enterParcelWorkMode(mode: ParcelMode, dim = true) {
  parcelMode.value = mode
  map.setMinZoom(PARCEL_EDIT_MIN_ZOOM)
  mapMinZoom.value = PARCEL_EDIT_MIN_ZOOM
  if (dim && !editDimLayer) {
    editDimLayer = L.rectangle([[-85, -180], [85, 180]], {
      pane: 'editDimmingPane',
      stroke: false,
      fillColor: '#0f172a',
      fillOpacity: 0.34,
      interactive: false,
    }).addTo(map)
  }
}

function leaveParcelWorkMode() {
  parcelMode.value = 'idle'
  if (map) {
    map.off('click', onManualMapClick)
    map.off('click', onBatchMapClick)
    map.setMinZoom(DEFAULT_MIN_ZOOM)
  }
  mapMinZoom.value = DEFAULT_MIN_ZOOM
  if (editDimLayer) { editDimLayer.remove(); editDimLayer = null }
}

function startParcelEditing() {
  if (!parcelOn.value || !hasFilterableParcels.value) return
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

function clearManualDraftLayers() {
  if (manualDraftLayer) { manualDraftLayer.remove(); manualDraftLayer = null }
  if (manualVertexLayer) { manualVertexLayer.remove(); manualVertexLayer = null }
  if (manualDraftAreaMarker) { manualDraftAreaMarker.remove(); manualDraftAreaMarker = null }
}

function toLatLngs(points: Position[]): L.LatLngExpression[] {
  return points.map(([lng, lat]) => L.latLng(lat, lng))
}

function manualVertexIcon(first = false) {
  return L.divIcon({
    className: `manual-vertex-icon${first ? ' first' : ''}`,
    html: '<span></span>',
    iconSize: [18, 18],
    iconAnchor: [9, 9],
  })
}

function renderManualDraft(editable: boolean) {
  clearManualDraftLayers()
  if (!manualDraftPoints.value.length) return
  manualDraftLayer = editable
    ? L.polygon(toLatLngs(manualDraftPoints.value), MANUAL_DRAFT_STYLE).addTo(map)
    : L.polyline(toLatLngs(manualDraftPoints.value), { ...MANUAL_DRAFT_STYLE, fill: false }).addTo(map)
  manualVertexLayer = L.layerGroup().addTo(map)
  manualDraftPoints.value.forEach(([lng, lat], index) => {
    const canClose = !editable && index === 0 && manualDistinctPointCount.value >= 3
    const marker = L.marker([lat, lng], {
      icon: manualVertexIcon(canClose),
      draggable: editable,
      keyboard: editable || canClose,
      title: canClose ? '点击闭合地块' : `顶点 ${index + 1}`,
      interactive: true,
      zIndexOffset: canClose ? 1000 : 0,
    })
    marker.on('click', (event) => {
      L.DomEvent.stopPropagation(event)
      if (canClose) finishManualDrawing()
    })
    if (editable) {
      marker.on('drag', () => {
        const point = marker.getLatLng()
        manualDraftPoints.value[index] = [point.lng, point.lat]
        manualDraftDirty.value = true
        ;(manualDraftLayer as L.Polygon | null)?.setLatLngs(toLatLngs(manualDraftPoints.value))
        renderManualDraftArea()
        renderPendingRemoveAction()
      })
    }
    marker.addTo(manualVertexLayer!)
  })
  if (editable) renderManualDraftArea()
}

function areaLabelIcon(areaMu: number, className = '') {
  return L.divIcon({
    className: `parcel-area-label-wrap ${className}`,
    html: `<span class="parcel-area-label">${areaMu.toFixed(2)} 亩</span>`,
    iconSize: undefined,
    iconAnchor: [0, 0],
  })
}

function renderManualDraftArea() {
  if (manualDraftAreaMarker) { manualDraftAreaMarker.remove(); manualDraftAreaMarker = null }
  const prepared = prepareManualGeometry(manualDraftPoints.value).prepared
  if (!prepared) return
  manualDraftAreaMarker = L.marker([prepared.labelLat, prepared.labelLng], {
    pane: 'parcelLabelPane',
    icon: areaLabelIcon(prepared.areaMu, 'batch-area-label'),
    interactive: false,
    keyboard: false,
    zIndexOffset: 1100,
  }).addTo(map)
}

function renderBatchAreaLabels(existingManualFeatures: ManualParcelFeature[]) {
  if (batchAreaLabelLayer) { batchAreaLabelLayer.remove(); batchAreaLabelLayer = null }
  batchAreaLabelLayer = L.layerGroup().addTo(map)
  const features = [
    ...existingManualFeatures,
    ...pendingManualParcels.value.filter((feature) => feature.properties.id !== editingPendingManualId),
  ]
  for (const feature of features) {
    L.marker([feature.properties.label_lat, feature.properties.label_lng], {
      pane: 'parcelLabelPane',
      icon: areaLabelIcon(feature.properties.area_mu, 'batch-area-label'),
      interactive: false,
      keyboard: false,
    }).addTo(batchAreaLabelLayer)
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

function onManualMapClick(event: L.LeafletMouseEvent) {
  if (parcelMode.value !== 'drawing') return
  manualDraftPoints.value = [...manualDraftPoints.value, [event.latlng.lng, event.latlng.lat]]
  manualDraftDirty.value = true
  renderManualDraft(false)
}

function onBatchMapClick() {
  if (parcelMode.value !== 'batch' || !editingPendingManualId) return
  void finishPendingManualEditing()
}

function startManualDrawing() {
  if (store.current.level !== 'village') return
  showManualStorageNoticeOnce()
  parcelOn.value = true
  editingManualOriginal = null
  editingPendingManualId = null
  manualDraftPoints.value = []
  resetManualBatch(manualBatchState)
  manualDraftDirty.value = false
  enterParcelWorkMode('batch')
  map.off('click', onManualMapClick)
  map.off('click', onBatchMapClick)
  map.on('click', onBatchMapClick)
  renderParcelLayer()
}

async function startBatchDrawing() {
  if (parcelMode.value !== 'batch') return
  if (editingPendingManualId && !await finishPendingManualEditing()) return
  editingPendingManualId = null
  editingBatchManualKind = null
  manualDraftPoints.value = []
  clearManualDraftLayers()
  parcelMode.value = 'drawing'
  map.off('click', onBatchMapClick)
  map.off('click', onManualMapClick)
  map.on('click', onManualMapClick)
  renderParcelLayer()
}

function exitBatchDrawing() {
  if (parcelMode.value !== 'drawing') return
  manualDraftPoints.value = []
  clearManualDraftLayers()
  parcelMode.value = 'batch'
  map.off('click', onManualMapClick)
  map.off('click', onBatchMapClick)
  map.on('click', onBatchMapClick)
  manualDraftDirty.value = batchHasChanges.value
  renderParcelLayer()
}

function undoManualPoint() {
  if (parcelMode.value !== 'batch' && parcelMode.value !== 'drawing') return
  if (editingPendingManualId) {
    editingPendingManualId = null
    editingBatchManualKind = null
    manualDraftPoints.value = []
    clearManualDraftLayers()
    renderParcelLayer()
    return
  }
  if (manualDraftPoints.value.length) {
    manualDraftPoints.value = manualDraftPoints.value.slice(0, -1)
    renderManualDraft(false)
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
  clearManualDraftLayers()
  parcelMode.value = 'batch'
  map.off('click', onManualMapClick)
  map.off('click', onBatchMapClick)
  map.on('click', onBatchMapClick)
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
  renderManualDraft(true)
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
  clearManualDraftLayers()
  renderParcelLayer()
  return true
}

function renderPendingRemoveAction() {
  if (pendingActionMarker) { pendingActionMarker.remove(); pendingActionMarker = null }
  if (!editingPendingManualId) return
  const prepared = prepareManualGeometry(manualDraftPoints.value).prepared
  if (!prepared) return
  const geometry = prepared.geometry.coordinates[0].slice(0, -1)
  const bottom = geometry.reduce((current, point) => point[1] < current[1] ? point : current, geometry[0])
  const icon = L.divIcon({
    className: 'pending-remove-icon',
    html: '<button type="button" title="移除此地块" aria-label="移除此人工地块">移除</button>',
    iconSize: [48, 28],
    iconAnchor: [24, -10],
  })
  pendingActionMarker = L.marker([bottom[1], bottom[0]], { icon, keyboard: true, zIndexOffset: 1200 }).addTo(map)
  pendingActionMarker.on('click', (event) => {
    L.DomEvent.stopPropagation(event)
    removeBatchManualParcel(editingPendingManualId!)
  })
}

function removeBatchManualParcel(id: string) {
  const kind = editingBatchManualKind === 'existing' || manualParcels.some((feature) => feature.properties.id === id) ? 'existing' : 'new'
  removeManualParcel(manualBatchState, id, kind)
  if (editingPendingManualId === id) {
    editingPendingManualId = null
    editingBatchManualKind = null
    manualDraftPoints.value = []
    clearManualDraftLayers()
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
  const persisted = writeManualParcels(parcelVillageCode, nextFeatures)
  if (!persisted.ok) {
    showNotice(persisted.error, true)
    return
  }
  const addedCount = pendingManualParcels.value.length
  const changedCount = pendingManualEdits.value.length
  const removedCount = pendingRemovedManualIds.value.length
  manualParcels = nextFeatures
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
  clearManualDraftLayers()
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
  clearManualDraftLayers()
  leaveParcelWorkMode()
  renderParcelLayer()
}

function cancelManualSession() {
  map.off('click', onManualMapClick)
  map.off('click', onBatchMapClick)
  clearManualDraftLayers()
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

  const next = makeManualParcel(parcelVillageCode, checked.prepared, editingManualOriginal ?? undefined)
  const nextFeatures = editingManualOriginal
    ? manualParcels.map((feature) => feature.properties.id === editingManualOriginal!.properties.id ? next : feature)
    : [...manualParcels, next]
  const persisted = writeManualParcels(parcelVillageCode, nextFeatures)
  if (!persisted.ok) {
    showNotice(persisted.error, true)
    return
  }
  manualParcels = nextFeatures
  hasManualParcels.value = manualParcels.length > 0
  clearManualDraftLayers()
  manualDraftPoints.value = []
  manualDraftDirty.value = false
  editingManualOriginal = null
  leaveParcelWorkMode()
  renderParcelLayer()
  showNotice('人工地块已保存到当前浏览器')
}

function hasUnsavedParcelWork(): boolean {
  if (parcelMode.value === 'batch' || parcelMode.value === 'drawing') return manualDraftPoints.value.length > 0 || batchHasChanges.value || Boolean(editingPendingManualId)
  if (parcelMode.value === 'editing') return manualDraftDirty.value
  return pendingChangeCount.value > 0
}

function isTypingTarget(target: EventTarget | null): boolean {
  return target instanceof HTMLElement && (target.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName))
}

function onManualKeydown(event: KeyboardEvent) {
  if (isTypingTarget(event.target)) return
  if (event.key === 'Escape' && manualDialog.value.open) {
    event.preventDefault()
    closeManualDialog(false)
    return
  }
  if (manualDialog.value.open) return
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
function renderOutline(crumb: Crumb) {
  if (!crumb.geometry) return
  outlineLayer = L.geoJSON(
    toFeature(crumb.geometry),
    {
      style: { color: HOVER, weight: 3, fill: false, dashArray: '6 4' },
      interactive: false,
    },
  ).addTo(map)
}

async function render(noFly = false) {
  const crumb = store.current
  const seq = ++flySeq
  clearLayers()
  renderOutline(crumb)

  // 视野: flyTo 当前区域 (决策#4 动效); 自动切换层级时不动视野
  let bounds: L.LatLngBounds | null = null
  if (crumb.geometry) {
    bounds = L.geoJSON(toFeature(crumb.geometry)).getBounds()
  } else {
    const prov = await fetchJSON<FeatureCollection>('/data/boundary/province.geojson')
    if (seq !== flySeq) return
    bounds = L.geoJSON(prov).getBounds()
  }
  if (!noFly && bounds.isValid()) {
    // zoomend 早于 moveend：保持抑制到本次程序化移动完全结束，防止点击下钻后被自动退出逻辑撤销。
    suppressAutoZoom = true
    map.once('moveend', () => { suppressAutoZoom = false })
    setTimeout(() => { suppressAutoZoom = false }, 1500)
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
    if (seq !== flySeq) return
    rsInfo = info
    if (rsInfo && crumb.geometry) {
      const [w, s, e, n] = rsInfo.bounds
      const currentBounds = L.geoJSON(toFeature(crumb.geometry)).getBounds()
      const rsBounds = L.latLngBounds([s, w], [n, e])
      if (currentBounds.intersects(rsBounds)) {
        rsLayer = L.tileLayer('/tiles/rs/{z}/{x}/{y}.png', {
          minZoom: rsInfo.minZoom,
          maxZoom: rsInfo.maxZoom,
          opacity: RS_OPACITY,
          zIndex: 3, // 高于底图；文字注记在独立 annotationPane 中置顶
        }).addTo(map)
        rsVisible.value = true
        rsHint.value = `吉林一号 0.5m 影像（${rsInfo.minZoom}~${rsInfo.maxZoom} 级）`

        if (crumb.level === 'village') {
          const parcels = await fetchJSON<FeatureCollection>(`/data/parcels/${crumb.code}.geojson`).catch(() => null)
          if (seq !== flySeq) return
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
          map.once('zoomend', () => { suppressAutoZoom = false })
          setTimeout(() => { suppressAutoZoom = false }, 500)
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
    if (seq !== flySeq) return
    const next = NEXT_LEVEL[crumb.level]!
    childLayer = L.geoJSON(fc, {
      style: () => baseStyle(crumb.level),
      onEachFeature: (feature: Feature, layer: L.Layer) => {
        const name = feature.properties?.name ?? ''
        const code = feature.properties?.code ?? ''
        const path = layer as L.Path
        layer.bindTooltip(name, { sticky: true, direction: 'top' })
        layer.on('mouseover', () => {
          path.setStyle({ color: HOVER, weight: LEVEL_WEIGHT[crumb.level] + 1.5, fillOpacity: 0.2 })
          path.bringToFront()
        })
        layer.on('mouseout', () => childLayer?.resetStyle(path))
        layer.on('click', () => {
          store.drill({ level: next, code, name, geometry: feature.geometry })
        })
      },
    }).addTo(map)
  }
}

watch(() => store.path.length, () => {
  const nf = pendingNoFly
  pendingNoFly = false
  // 所有导航都经过 store 守卫；确认离开后在重渲染前丢弃本轮草稿与待筛选状态。
  if (parcelMode.value === 'filter') {
    clearPendingParcelFilterState(parcelFilterState)
    syncPendingParcelCounts()
  }
  map.off('click', onManualMapClick)
  clearManualDraftLayers()
  manualDraftPoints.value = []
  manualDraftDirty.value = false
  render(nf)
})

/** 缩放下钻: zoomend 时按中心点判定自动进出层级(平移不触发) */
function onAutoLevel() {
  if (suppressAutoZoom || parcelMode.value !== 'idle') return
  const crumb = store.current
  const z = map.getZoom()

  // 放大: 进入中心点所在子区域，乡级继续自动进入村级
  const enterZ = ENTER_ZOOM[crumb.level]
  if (enterZ !== undefined && z >= enterZ && childLayer) {
    const c = map.getCenter()
    for (const layer of childLayer.getLayers() as L.GeoJSON[]) {
      const f = layer.feature as Feature | undefined
      if (f && pointInGeometry([c.lng, c.lat], f.geometry)) {
        pendingNoFly = true
        store.drill({
          level: NEXT_LEVEL[crumb.level]!,
          code: f.properties?.code ?? '',
          name: f.properties?.name ?? '',
          geometry: f.geometry,
        })
        return
      }
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

onMounted(() => {
  map = L.map(mapEl.value!, {
    minZoom: DEFAULT_MIN_ZOOM,
    maxZoom: 19,
    zoomControl: false,
    zoomSnap: 0.25, // 允许小数级缩放, fitBounds 才能精确贴合(整数级会被迫放松最多1级)
    wheelPxPerZoomLevel: 120, // 滚轮步幅放缓(默认60, 一次滚动跳~1.7级导致瓦片爆发重载)
    renderer: canvasRenderer, // 矢量图层默认走 Canvas
  })
  map.setView([29.5, 120.5], 7) // 初始视野, 防止 flyToBounds 前无中心点
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
  basemaps = createBasemaps()
  basemaps.img.addTo(map)
  map.on('zoomend', () => {
    currentZoom.value = map.getZoom()
    updateParcelAreaLabels()
    onAutoLevel()
  })
  map.on('moveend', updateParcelAreaLabels)
  store.setNavigationGuard(() => {
    if (!hasUnsavedParcelWork()) return true
    return window.confirm('当前地块修改尚未保存，离开后将丢失。确定离开吗？')
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
  if (saveNoticeTimer) clearTimeout(saveNoticeTimer)
  if (beforeUnloadHandler) window.removeEventListener('beforeunload', beforeUnloadHandler)
  window.removeEventListener('keydown', onManualKeydown)
  store.setNavigationGuard(null)
  map?.remove()
})
</script>

<style scoped>
.map-wrap { position: absolute; inset: 0; }
.map { width: 100%; height: 100%; }
.parcel-editing .map { cursor: grab; }
.parcel-editing .map:active { cursor: grabbing; }
.parcel-drawing .map,
.parcel-drawing .map:active { cursor: crosshair; }
.draw-shortcut-hint {
  position: absolute;
  top: 12px;
  left: 50%;
  z-index: 1000;
  display: inline-flex;
  align-items: center;
  gap: 8px;
  transform: translateX(-50%);
  padding: 7px 11px;
  border: 1px solid rgba(192, 132, 252, 0.48);
  border-radius: 8px;
  background: rgba(255, 255, 255, 0.96);
  box-shadow: 0 6px 18px rgba(15, 23, 42, 0.18);
  color: #475569;
  font-size: 12px;
  font-weight: 600;
  pointer-events: none;
  white-space: nowrap;
}
.draw-shortcut-hint kbd {
  min-width: 24px;
  padding: 3px 6px;
  border: 1px solid #d8b4fe;
  border-bottom-width: 2px;
  border-radius: 5px;
  background: #faf5ff;
  color: #7e22ce;
  font: inherit;
  font-weight: 750;
  line-height: 1;
  text-align: center;
}
.save-notice {
  position: absolute;
  top: 64px;
  left: 50%;
  z-index: 1100;
  transform: translateX(-50%);
  padding: 9px 14px;
  border-radius: 8px;
  background: #166534;
  box-shadow: 0 8px 22px rgba(15, 23, 42, 0.22), 0 2px 5px rgba(15, 23, 42, 0.16);
  color: #fff;
  font-size: 13px;
  font-weight: 600;
  white-space: nowrap;
  animation: notice-in 180ms cubic-bezier(0.16, 1, 0.3, 1);
}
.save-notice.error { background: #b91c1c; }
@keyframes notice-in {
  from { opacity: 0.4; transform: translate(-50%, -6px); }
  to { opacity: 1; transform: translate(-50%, 0); }
}
.ctrl-stack,
.zoom-stack {
  position: absolute;
  right: 10px;
  z-index: 1000;
  display: flex;
  flex-direction: column;
  gap: 2px;
  padding: 4px;
  border: 1px solid rgba(148, 163, 184, 0.34);
  border-radius: 10px;
  background: rgba(248, 250, 252, 0.96);
  box-shadow: 0 6px 20px rgba(15, 23, 42, 0.18), 0 1px 2px rgba(15, 23, 42, 0.12);
  backdrop-filter: blur(8px);
}
.ctrl-stack { bottom: 116px; }
.zoom-stack { bottom: 24px; }
.icon-btn {
  width: 36px;
  height: 36px;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 0;
  border: 0;
  border-radius: 7px;
  background: transparent;
  color: #475569;
  cursor: pointer;
  transition: background-color 160ms ease, color 160ms ease, box-shadow 160ms ease;
}
.icon-btn + .icon-btn { position: relative; }
.icon-btn + .icon-btn::before {
  content: '';
  position: absolute;
  top: -1px;
  left: 7px;
  right: 7px;
  height: 1px;
  background: #e2e8f0;
}
.icon-btn svg { width: 18px; height: 18px; }
.icon-btn:hover:not(:disabled) { background: #e2e8f0; color: #0f172a; }
.icon-btn:focus-visible { outline: 3px solid rgba(37, 99, 235, 0.28); outline-offset: 2px; }
.icon-btn:disabled { cursor: not-allowed; opacity: 0.38; }
.icon-btn.off { color: #94a3b8; }
.icon-btn.off:hover:not(:disabled) { background: #f1f5f9; color: #64748b; }
.parcel-btn:not(.off) { background: #eff6ff; color: #2563eb; }
.parcel-btn:not(.off):hover:not(:disabled) { background: #dbeafe; color: #1d4ed8; }

.map-wrap :deep(.leaflet-tooltip.parcel-edit-tooltip) {
  padding: 6px 9px;
  border-width: 1px;
  border-radius: 6px;
  box-shadow: 0 4px 12px rgba(15, 23, 42, 0.24);
  color: #fff;
  font-size: 12px;
  font-weight: 600;
}
.map-wrap :deep(.leaflet-tooltip.parcel-edit-tooltip.hide) {
  border-color: #fdba74;
  background: #c2410c;
}
.map-wrap :deep(.leaflet-tooltip-top.parcel-edit-tooltip.hide)::before {
  border-top-color: #c2410c;
}
.map-wrap :deep(.leaflet-tooltip.parcel-edit-tooltip.restore) {
  border-color: #86efac;
  background: #15803d;
}
.map-wrap :deep(.leaflet-tooltip-top.parcel-edit-tooltip.restore)::before {
  border-top-color: #15803d;
}
.map-wrap :deep(.leaflet-tooltip.manual-parcel-tooltip) {
  padding: 6px 9px;
  border: 1px solid #d8b4fe;
  border-radius: 6px;
  background: #6b21a8;
  box-shadow: 0 4px 12px rgba(15, 23, 42, 0.24);
  color: #fff;
  font-size: 12px;
  font-weight: 600;
}
.map-wrap :deep(.leaflet-tooltip-top.manual-parcel-tooltip)::before { border-top-color: #6b21a8; }
.map-wrap :deep(.manual-vertex-icon) {
  border: 0;
  background: transparent;
}
.map-wrap :deep(.manual-vertex-icon span) {
  display: block;
  width: 12px;
  height: 12px;
  margin: 3px;
  border: 3px solid #fff;
  border-radius: 50%;
  background: #a21caf;
  box-shadow: 0 2px 7px rgba(15, 23, 42, 0.5);
}
.map-wrap :deep(.manual-vertex-icon:focus-visible span) { outline: 3px solid rgba(250, 204, 21, 0.65); outline-offset: 2px; }
.map-wrap :deep(.manual-vertex-icon.first) { cursor: pointer; }
.map-wrap :deep(.manual-vertex-icon.first span) {
  background: #7e22ce;
  box-shadow: 0 0 0 4px rgba(232, 121, 249, 0.35), 0 2px 7px rgba(15, 23, 42, 0.5);
  transform: scale(1.08);
}
.map-wrap :deep(.manual-vertex-icon.first:hover span) { background: #581c87; }
.map-wrap :deep(.pending-remove-icon) { border: 0; background: transparent; }
.map-wrap :deep(.pending-remove-icon button) {
  min-width: 48px;
  height: 28px;
  padding: 0 9px;
  border: 1px solid #fecaca;
  border-radius: 7px;
  background: #fff;
  box-shadow: 0 4px 12px rgba(15, 23, 42, 0.24);
  color: #b91c1c;
  font: inherit;
  font-size: 12px;
  font-weight: 650;
  cursor: pointer;
}
.map-wrap :deep(.pending-remove-icon button:hover) { background: #fef2f2; }
.map-wrap :deep(.pending-remove-icon button:focus-visible) { outline: 3px solid rgba(239, 68, 68, 0.28); outline-offset: 2px; }

.map-wrap :deep(.parcel-area-label-wrap) {
  width: 0 !important;
  height: 0 !important;
  border: 0;
  background: transparent;
}
.map-wrap :deep(.parcel-area-label) {
  position: absolute;
  left: 0;
  top: 0;
  transform: translate(-50%, -50%);
  color: #fff;
  font-size: 11px;
  font-weight: 650;
  line-height: 1;
  white-space: nowrap;
  text-shadow:
    -1px -1px 0 rgba(15, 23, 42, 0.9),
    1px -1px 0 rgba(15, 23, 42, 0.9),
    -1px 1px 0 rgba(15, 23, 42, 0.9),
    1px 1px 0 rgba(15, 23, 42, 0.9),
    0 1px 2px rgba(15, 23, 42, 0.85);
  font-variant-numeric: tabular-nums;
}

</style>
