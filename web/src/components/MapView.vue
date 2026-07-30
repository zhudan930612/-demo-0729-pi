<template>
  <div class="map-wrap" :class="{ 'parcel-editing': parcelMode !== 'idle' && parcelMode !== 'selected', 'parcel-drawing': parcelMode === 'drawing' }">
    <div ref="mapEl" class="map"></div>

    <!-- 村级地块业务操作：新增与 AI 筛选保持同组常驻，进入模式后原位替换。 -->
    <div
      v-if="store.current.level === 'village'"
      class="parcel-edit-toolbar"
      :class="{ active: parcelMode !== 'idle' }"
      aria-label="地块操作工具"
    >
      <template v-if="parcelMode === 'filter'">
        <div class="edit-stat">
          <span class="stat-dot hidden" aria-hidden="true"></span>
          <span>已隐藏</span>
          <strong>{{ hiddenParcelCount }}</strong>
        </div>
        <button
          type="button"
          class="edit-action restore-all"
          :disabled="hiddenParcelCount === 0 || pendingRestoreCount === hiddenParcelCount"
          title="将当前村全部隐藏地块标记为待恢复"
          @click="restoreAllHiddenParcels"
        >全部恢复</button>
        <span class="toolbar-divider" aria-hidden="true"></span>
        <div class="edit-stat">
          <span class="stat-dot pending-hide" aria-hidden="true"></span>
          <span>待隐藏</span>
          <strong>{{ pendingHideCount }}</strong>
        </div>
        <div class="edit-stat">
          <span class="stat-dot pending-restore" aria-hidden="true"></span>
          <span>待恢复</span>
          <strong>{{ pendingRestoreCount }}</strong>
        </div>
        <button type="button" class="edit-action primary" :disabled="pendingChangeCount === 0" @click="saveParcelEdits">保存更改</button>
        <button type="button" class="edit-action cancel" @click="cancelParcelEditing">取消</button>
      </template>

      <template v-else-if="parcelMode === 'drawing'">
        <div class="draw-guide"><strong>正在绘制</strong><span>单击地图添加顶点</span><small>{{ manualDraftPoints.length }} 点</small><small v-if="batchSavedCount > 0" class="batch-saved">已保存 {{ batchSavedCount }} 个</small></div>
        <button type="button" class="edit-action" :disabled="manualDraftPoints.length === 0" @click="undoManualPoint">撤销一点</button>
        <button type="button" class="edit-action primary" :disabled="manualDistinctPointCount < 3" @click="finishManualDrawing">完成绘制</button>
        <button type="button" class="edit-action cancel" @click="cancelManualSession">{{ batchSavedCount > 0 ? '退出' : '取消' }}</button>
      </template>

      <template v-else-if="parcelMode === 'review' || parcelMode === 'editing'">
        <div class="draw-guide"><strong>{{ parcelMode === 'review' ? '调整新地块' : '编辑人工地块' }}</strong><span>拖动顶点修正边界</span><small>{{ manualDraftAreaText }}</small></div>
        <button type="button" class="edit-action primary" @click="saveManualDraft">保存</button>
        <button type="button" class="edit-action cancel" @click="cancelManualSession">取消</button>
      </template>

      <template v-else-if="parcelMode === 'selected'">
        <div class="draw-guide selected"><strong>人工绘制</strong><small>{{ selectedManualAreaText }}</small></div>
        <button type="button" class="edit-action" @click="editSelectedManualParcel">编辑边界</button>
        <button type="button" class="edit-action danger" @click="deleteSelectedManualParcel">删除地块</button>
        <button type="button" class="edit-action cancel" @click="clearManualSelection">取消选择</button>
      </template>

      <template v-else>
        <button type="button" class="edit-launch primary-launch" @click="startManualDrawing">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
            <path d="m4 5 7-2 5 5-2 10-9 2-2-8Z" /><path d="M18 13v8M14 17h8" />
          </svg>
          新增地块
        </button>
        <button
          type="button"
          class="edit-launch"
          :disabled="!parcelOn || !hasAiParcels"
          :title="hasAiParcels ? '筛选地块' : '当前村没有可筛选的地块'"
          @click="startParcelEditing"
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
            <path d="M4 5h16l-6.5 7.2V19l-3 1.5v-8.3Z" />
          </svg>
          筛选地块
        </button>
      </template>
    </div>

    <div v-if="saveNotice" class="save-notice" :class="{ error: saveNoticeError }" role="status" aria-live="polite">
      {{ saveNotice }}
    </div>

    <section v-if="parcelVisible && parcelOn" class="parcel-summary" aria-label="地块统计">
      <div class="summary-metrics">
        <div class="summary-metric">
          <span>当前地块</span>
          <strong>{{ parcelDisplayCount.toLocaleString() }}</strong>
          <small>块</small>
        </div>
        <span class="summary-divider" aria-hidden="true"></span>
        <div class="summary-metric area">
          <span>合计面积</span>
          <strong>{{ parcelDisplayAreaText }}</strong>
          <small>亩</small>
        </div>
      </div>
      <div v-if="rsHint" class="summary-imagery" :class="{ off: !rsVisible }">{{ rsHint }}</div>
    </section>

    <!-- 无地块数据时仍单独展示影像状态 -->
    <div v-else-if="rsHint" class="rs-hint" :class="{ off: !rsVisible }">{{ rsHint }}</div>

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
        :disabled="parcelMode !== 'idle' && parcelMode !== 'selected'"
        :title="parcelMode !== 'idle' && parcelMode !== 'selected' ? '操作地块时不能关闭图层' : (parcelOn ? '地块：开（点击关闭）' : '地块：关（点击打开）')"
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
import { computed, onMounted, onBeforeUnmount, ref, watch } from 'vue'
import L from 'leaflet'
import type { Feature, FeatureCollection, Geometry, Position } from 'geojson'
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
const PARCEL_STYLE: L.PathOptions = {
  color: '#93c5fd',
  weight: 1,
  opacity: 0.95,
  fillColor: '#60a5fa',
  fillOpacity: 0.26,
}
const PARCEL_EDIT_STYLE: L.PathOptions = {
  color: '#38bdf8',
  weight: 2,
  opacity: 1,
  fillColor: '#0ea5e9',
  fillOpacity: 0.13,
}
const PARCEL_HOVER_STYLE: L.PathOptions = {
  color: '#f8fafc',
  weight: 4,
  opacity: 1,
  fillColor: '#22d3ee',
  fillOpacity: 0.34,
}
const PARCEL_PENDING_HIDE_STYLE: L.PathOptions = {
  color: '#fb2c36',
  weight: 3.5,
  opacity: 1,
  fillColor: '#f97316',
  fillOpacity: 0.46,
}
const PARCEL_HIDDEN_STYLE: L.PathOptions = {
  color: '#fde047',
  weight: 3.5,
  opacity: 1,
  fillColor: '#facc15',
  fillOpacity: 0.18,
  dashArray: '8 4',
}
const PARCEL_PENDING_RESTORE_STYLE: L.PathOptions = {
  color: '#22c55e',
  weight: 3.5,
  opacity: 1,
  fillColor: '#16a34a',
  fillOpacity: 0.34,
}
const MANUAL_PARCEL_STYLE: L.PathOptions = {
  color: '#a855f7',
  weight: 2.4,
  opacity: 1,
  fillColor: '#c084fc',
  fillOpacity: 0.24,
}
const MANUAL_PARCEL_SELECTED_STYLE: L.PathOptions = {
  color: '#f8fafc',
  weight: 4,
  opacity: 1,
  fillColor: '#a855f7',
  fillOpacity: 0.42,
}
const MANUAL_DRAFT_STYLE: L.PathOptions = {
  color: '#e879f9',
  weight: 3,
  opacity: 1,
  fillColor: '#c026d3',
  fillOpacity: 0.25,
  dashArray: '8 5',
}
const PARCEL_STORAGE_KEY = 'agri-map:parcel-edits:v1'
const PARCEL_DATASET_VERSION = '2025-04-02-v1'
const DEFAULT_MIN_ZOOM = 7
const PARCEL_EDIT_MIN_ZOOM = 15.25 // 高于村级 z<=15.0 自动退出阈值
const PARCEL_AREA_LABEL_MIN_ZOOM = 18.5
const M2_PER_MU = 2000 / 3

type ParcelId = string
type ParcelMode = 'idle' | 'filter' | 'drawing' | 'review' | 'selected' | 'editing'
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
const manualDraftPoints = ref<Position[]>([])
const manualDraftDirty = ref(false)
const batchSavedCount = ref(0)
const manualDistinctPointCount = computed(() => new Set(manualDraftPoints.value.map(([lng, lat]) => `${lng},${lat}`)).size)
const manualDraftAreaText = computed(() => {
  const prepared = prepareManualGeometry(manualDraftPoints.value).prepared
  return prepared ? `${prepared.areaMu.toFixed(2)} 亩` : '边界待校验'
})
const selectedManualAreaText = ref('')
const pendingHideCount = ref(0)
const pendingRestoreCount = ref(0)
const pendingChangeCount = computed(() => pendingHideCount.value + pendingRestoreCount.value)
const hiddenParcelCount = ref(0)
const saveNotice = ref('')
const saveNoticeError = ref(false)
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
let manualDraftLayer: L.Polygon | L.Polyline | null = null
let manualVertexLayer: L.LayerGroup | null = null
let parcelAreaLabelLayer: L.LayerGroup | null = null
let editDimLayer: L.Rectangle | null = null
let parcelSource: FeatureCollection | null = null
let manualParcels: ManualParcelFeature[] = []
let selectedManualParcel: ManualParcelFeature | null = null
let editingManualOriginal: ManualParcelFeature | null = null
let parcelVillageCode = ''
let hiddenParcelIds = new Set<ParcelId>()
let pendingHideParcelIds = new Set<ParcelId>()
let pendingRestoreParcelIds = new Set<ParcelId>()
let saveNoticeTimer: ReturnType<typeof setTimeout> | null = null
let rsInfo: RsInfo | null = null
let flySeq = 0
let firstRender = true
let pendingNoFly = false // 自动切换层级时不重排视野(决策: 不动视野)
let suppressAutoZoom = false // 点击下钻/返回的程序化缩放不得触发自动进退层级
let basemaps: Basemaps
let beforeUnloadHandler: ((event: BeforeUnloadEvent) => void) | null = null

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
  manualParcels = []
  selectedManualParcel = null
  editingManualOriginal = null
  manualDraftPoints.value = []
  manualDraftDirty.value = false
  selectedManualAreaText.value = ''
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
  if (parcelMode.value !== 'idle' && parcelMode.value !== 'selected') return
  if (parcelMode.value === 'selected') clearManualSelection()
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
      return parcelMode.value === 'filter' || id === null || !hiddenParcelIds.has(id)
    }) ?? []),
    ...manualParcels,
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

function renderParcelLayer() {
  parcelLayer?.remove()
  manualParcelLayer?.remove()
  parcelLayer = null
  manualParcelLayer = null

  const aiFeatures = parcelSource?.features ?? []
  const visibleAiFeatures = aiFeatures.filter((feature) => {
    const id = parcelId(feature)
    return parcelMode.value === 'filter' || id === null || !hiddenParcelIds.has(id)
  })
  const displayedAi = aiFeatures.filter((feature) => {
    const id = parcelId(feature)
    return id === null || !hiddenParcelIds.has(id)
  })
  hiddenParcelCount.value = hiddenParcelIds.size
  const displayedFeatures: Feature[] = [...displayedAi, ...manualParcels]
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
          if (hiddenParcelIds.has(id)) {
            if (pendingRestoreParcelIds.has(id)) pendingRestoreParcelIds.delete(id)
            else pendingRestoreParcelIds.add(id)
          } else if (pendingHideParcelIds.has(id)) pendingHideParcelIds.delete(id)
          else pendingHideParcelIds.add(id)
          syncPendingParcelCounts()
          path.setStyle(parcelEditStyle(id))
          path.setTooltipContent(parcelEditActionLabel(id))
        })
      },
    }).addTo(map)
  }

  const visibleManualParcels = parcelMode.value === 'editing'
    ? manualParcels.filter((feature) => feature.properties.id !== editingManualOriginal?.properties.id)
    : manualParcels
  if (visibleManualParcels.length) {
    const manualCollection: FeatureCollection = { type: 'FeatureCollection', features: visibleManualParcels }
    manualParcelLayer = L.geoJSON(manualCollection, {
      interactive: parcelOn.value && (parcelMode.value === 'idle' || parcelMode.value === 'selected'),
      style: (feature) => {
        const selected = feature?.properties?.id === selectedManualParcel?.properties.id
        if (!parcelOn.value) return { ...MANUAL_PARCEL_STYLE, opacity: 0, fillOpacity: 0 }
        return selected ? MANUAL_PARCEL_SELECTED_STYLE : MANUAL_PARCEL_STYLE
      },
      onEachFeature: (feature: Feature, layer: L.Layer) => {
        const manual = feature as ManualParcelFeature
        layer.bindTooltip(`人工绘制 · ${manual.properties.area_mu.toFixed(2)} 亩`, { sticky: true, direction: 'top', className: 'manual-parcel-tooltip' })
        layer.on('click', (event) => {
          if (!parcelOn.value || (parcelMode.value !== 'idle' && parcelMode.value !== 'selected')) return
          L.DomEvent.stopPropagation(event)
          selectedManualParcel = manual
          selectedManualAreaText.value = `${manual.properties.area_mu.toFixed(2)} 亩`
          parcelMode.value = 'selected'
          renderParcelLayer()
        })
      },
    }).addTo(map)
  }
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
    map.setMinZoom(DEFAULT_MIN_ZOOM)
  }
  mapMinZoom.value = DEFAULT_MIN_ZOOM
  if (editDimLayer) { editDimLayer.remove(); editDimLayer = null }
}

function startParcelEditing() {
  if (!parcelOn.value || !parcelSource?.features.length) return
  pendingHideParcelIds.clear()
  pendingRestoreParcelIds.clear()
  syncPendingParcelCounts()
  enterParcelWorkMode('filter')
  renderParcelLayer()
}

function finishParcelEditing() {
  leaveParcelWorkMode()
  pendingHideParcelIds.clear()
  pendingRestoreParcelIds.clear()
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
  const nextHidden = new Set([...hiddenParcelIds, ...pendingHideParcelIds])
  for (const id of pendingRestoreParcelIds) nextHidden.delete(id)
  if (!persistHiddenParcelIds(parcelVillageCode, nextHidden)) {
    window.alert('保存失败，本次修改尚未生效。请检查浏览器是否允许本地存储。')
    return
  }
  hiddenParcelIds = nextHidden
  finishParcelEditing()
  showSaveNotice(hiddenCount, restoredCount)
}

function cancelParcelEditing() {
  finishParcelEditing()
}

function restoreAllHiddenParcels() {
  if (!hiddenParcelIds.size) return
  pendingRestoreParcelIds = new Set(hiddenParcelIds)
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
}

function toLatLngs(points: Position[]): L.LatLngExpression[] {
  return points.map(([lng, lat]) => L.latLng(lat, lng))
}

function renderManualDraft(editable: boolean) {
  clearManualDraftLayers()
  if (!manualDraftPoints.value.length) return
  if (editable) {
    manualDraftLayer = L.polygon(toLatLngs(manualDraftPoints.value), MANUAL_DRAFT_STYLE).addTo(map)
    const vertexIcon = L.divIcon({ className: 'manual-vertex-icon', html: '<span></span>', iconSize: [18, 18], iconAnchor: [9, 9] })
    manualVertexLayer = L.layerGroup().addTo(map)
    manualDraftPoints.value.forEach(([lng, lat], index) => {
      const marker = L.marker([lat, lng], { icon: vertexIcon, draggable: true, keyboard: true, title: `顶点 ${index + 1}` })
      marker.on('drag', () => {
        const point = marker.getLatLng()
        manualDraftPoints.value[index] = [point.lng, point.lat]
        manualDraftDirty.value = true
        ;(manualDraftLayer as L.Polygon | null)?.setLatLngs(toLatLngs(manualDraftPoints.value))
      })
      marker.addTo(manualVertexLayer!)
    })
  } else {
    manualDraftLayer = L.polyline(toLatLngs(manualDraftPoints.value), { ...MANUAL_DRAFT_STYLE, fill: false }).addTo(map)
    const vertexIcon = L.divIcon({ className: 'manual-vertex-icon', html: '<span></span>', iconSize: [18, 18], iconAnchor: [9, 9] })
    manualVertexLayer = L.layerGroup().addTo(map)
    manualDraftPoints.value.forEach(([lng, lat]) => {
      L.marker([lat, lng], { icon: vertexIcon, interactive: false, keyboard: false }).addTo(manualVertexLayer!)
    })
  }
}

function onManualMapClick(event: L.LeafletMouseEvent) {
  if (parcelMode.value !== 'drawing') return
  manualDraftPoints.value = [...manualDraftPoints.value, [event.latlng.lng, event.latlng.lat]]
  manualDraftDirty.value = true
  renderManualDraft(false)
}

function startManualDrawing() {
  if (store.current.level !== 'village') return
  showManualStorageNoticeOnce()
  parcelOn.value = true
  selectedManualParcel = null
  editingManualOriginal = null
  manualDraftPoints.value = []
  manualDraftDirty.value = false
  batchSavedCount.value = 0
  enterParcelWorkMode('drawing')
  map.on('click', onManualMapClick)
  renderParcelLayer()
}

function undoManualPoint() {
  if (parcelMode.value !== 'drawing' || !manualDraftPoints.value.length) return
  manualDraftPoints.value = manualDraftPoints.value.slice(0, -1)
  manualDraftDirty.value = manualDraftPoints.value.length > 0
  renderManualDraft(false)
}

function finishManualDrawing() {
  const checked = prepareManualGeometry(manualDraftPoints.value)
  if (!checked.prepared) {
    showNotice(checked.error ?? '无法完成地块边界。', true)
    return
  }
  map.off('click', onManualMapClick)
  parcelMode.value = 'review'
  manualDraftPoints.value = checked.prepared.geometry.coordinates[0].slice(0, -1)
  renderManualDraft(true)
}

function cancelManualSession() {
  map.off('click', onManualMapClick)
  clearManualDraftLayers()
  manualDraftPoints.value = []
  manualDraftDirty.value = false
  selectedManualParcel = null
  const wasNewParcelReview = !editingManualOriginal && parcelMode.value === 'review'
  editingManualOriginal = null
  if (wasNewParcelReview && batchSavedCount.value > 0) {
    parcelMode.value = 'drawing'
    map.on('click', onManualMapClick)
  } else {
    batchSavedCount.value = 0
    leaveParcelWorkMode()
  }
  renderParcelLayer()
}

function clearManualSelection() {
  selectedManualParcel = null
  selectedManualAreaText.value = ''
  parcelMode.value = 'idle'
  renderParcelLayer()
}

function editSelectedManualParcel() {
  if (!selectedManualParcel) return
  editingManualOriginal = selectedManualParcel
  manualDraftPoints.value = selectedManualParcel.geometry.coordinates[0].slice(0, -1).map(([lng, lat]) => [lng, lat])
  manualDraftDirty.value = false
  enterParcelWorkMode('editing')
  renderManualDraft(true)
  renderParcelLayer()
}

function manualWarningMessage(overlapCount: number, outsideVillage: boolean, incompleteChecks: number): string {
  const parts: string[] = []
  if (overlapCount) parts.push(`与 ${overlapCount} 个已有地块重叠`)
  if (outsideVillage) parts.push('部分范围越过当前村界')
  if (incompleteChecks) parts.push(`${incompleteChecks} 项空间关系无法完整校验`)
  return `当前地块${parts.join('，')}。是否仍要保存？`
}

function saveManualDraft() {
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
      && !window.confirm(manualWarningMessage(warnings.overlapCount, warnings.outsideVillage, warnings.incompleteChecks))) return

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
  clearManualDraftLayers()
  manualDraftPoints.value = []
  manualDraftDirty.value = false
  selectedManualParcel = null
  const wasNewParcel = !editingManualOriginal
  editingManualOriginal = null
  if (wasNewParcel) {
    batchSavedCount.value++
    parcelMode.value = 'drawing'
    map.on('click', onManualMapClick)
    showNotice(`已保存 ${batchSavedCount.value} 个人工地块`)
  } else {
    leaveParcelWorkMode()
    showNotice('人工地块已保存到当前浏览器')
  }
  renderParcelLayer()
}

function deleteSelectedManualParcel() {
  if (!selectedManualParcel || !parcelVillageCode) return
  if (!window.confirm(`确定删除这块 ${selectedManualParcel.properties.area_mu.toFixed(2)} 亩的人工地块吗？此操作只删除本机记录。`)) return
  const next = manualParcels.filter((feature) => feature.properties.id !== selectedManualParcel!.properties.id)
  const persisted = writeManualParcels(parcelVillageCode, next)
  if (!persisted.ok) {
    showNotice(persisted.error, true)
    return
  }
  manualParcels = next
  selectedManualParcel = null
  parcelMode.value = 'idle'
  renderParcelLayer()
  showNotice('人工地块已删除')
}

function hasUnsavedParcelWork(): boolean {
  if (parcelMode.value === 'drawing' || parcelMode.value === 'review' || parcelMode.value === 'editing') return manualDraftDirty.value
  return pendingChangeCount.value > 0
}

function onManualKeydown(event: KeyboardEvent) {
  if (event.key === 'Escape' && ['drawing', 'review', 'editing'].includes(parcelMode.value)) {
    event.preventDefault()
    cancelManualSession()
    return
  }
  if (parcelMode.value === 'drawing' && (event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'z') {
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
            const validIds = new Set(parcels.features.map(parcelId).filter((id): id is ParcelId => id !== null))
            hiddenParcelIds = new Set([...loadHiddenParcelIds(crumb.code)].filter((id) => validIds.has(id)))
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
    pendingHideParcelIds.clear()
    pendingRestoreParcelIds.clear()
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
  if (suppressAutoZoom || !['idle', 'selected'].includes(parcelMode.value)) return
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
.parcel-edit-toolbar {
  position: absolute;
  top: 12px;
  right: 12px;
  z-index: 1000;
  display: flex;
  align-items: center;
  padding: 4px;
  border: 1px solid rgba(148, 163, 184, 0.34);
  border-radius: 10px;
  background: rgba(248, 250, 252, 0.96);
  box-shadow: 0 6px 20px rgba(15, 23, 42, 0.18), 0 1px 2px rgba(15, 23, 42, 0.12);
  color: #334155;
  font-size: 13px;
  backdrop-filter: blur(8px);
}
.parcel-edit-toolbar.active { gap: 4px; padding: 5px 6px; }
.edit-launch,
.edit-action {
  height: 34px;
  border: 0;
  border-radius: 7px;
  font: inherit;
  font-weight: 600;
  cursor: pointer;
  transition: background-color 160ms ease, color 160ms ease, box-shadow 160ms ease;
}
.edit-launch {
  display: inline-flex;
  align-items: center;
  gap: 7px;
  padding: 0 13px;
  background: #fff;
  color: #1d4ed8;
}
.edit-launch svg { width: 16px; height: 16px; }
.edit-launch:hover:not(:disabled) { background: #eff6ff; color: #1e40af; }
.edit-launch.primary-launch { background: #2563eb; color: #fff; box-shadow: 0 1px 2px rgba(30, 64, 175, 0.25); }
.edit-launch.primary-launch:hover { background: #1d4ed8; color: #fff; }
.edit-launch:disabled { cursor: not-allowed; color: #94a3b8; opacity: 0.7; }
.edit-action { padding: 0 12px; background: transparent; color: #475569; }
.edit-action:hover:not(:disabled) { background: #e2e8f0; color: #0f172a; }
.edit-launch:focus-visible,
.edit-action:focus-visible { outline: 3px solid rgba(37, 99, 235, 0.28); outline-offset: 2px; }
.edit-action:disabled { cursor: not-allowed; opacity: 0.38; }
.edit-action.primary { background: #2563eb; color: #fff; box-shadow: 0 1px 2px rgba(30, 64, 175, 0.25); }
.edit-action.primary:hover:not(:disabled) { background: #1d4ed8; color: #fff; }
.edit-action.restore-all { color: #166534; }
.edit-action.restore-all:hover:not(:disabled) { background: #f0fdf4; color: #14532d; }
.edit-action.cancel { color: #475569; }
.edit-action.danger { color: #b91c1c; }
.edit-action.danger:hover { background: #fef2f2; color: #991b1b; }
.draw-guide {
  min-width: 166px;
  height: 34px;
  display: grid;
  grid-template-columns: auto auto;
  align-content: center;
  column-gap: 8px;
  padding: 0 8px;
  white-space: nowrap;
}
.draw-guide strong { color: #581c87; font-size: 12px; }
.draw-guide span { color: #475569; font-size: 12px; }
.draw-guide small { grid-column: 1 / -1; color: #7e22ce; font-size: 10px; font-variant-numeric: tabular-nums; }
.draw-guide.selected { min-width: 112px; }
.edit-stat {
  height: 34px;
  display: inline-flex;
  align-items: center;
  gap: 5px;
  padding: 0 6px;
  color: #64748b;
  white-space: nowrap;
}
.edit-stat strong { min-width: 1.2em; color: #0f172a; font-variant-numeric: tabular-nums; }
.stat-dot { width: 7px; height: 7px; border-radius: 50%; }
.stat-dot.hidden { background: #eab308; box-shadow: 0 0 0 3px rgba(234, 179, 8, 0.16); }
.stat-dot.pending-hide { background: #ef4444; box-shadow: 0 0 0 3px rgba(239, 68, 68, 0.14); }
.stat-dot.pending-restore { background: #22c55e; box-shadow: 0 0 0 3px rgba(34, 197, 94, 0.15); }
.toolbar-divider { width: 1px; height: 22px; margin: 0 2px; background: #cbd5e1; }
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

.parcel-summary {
  position: absolute;
  left: 12px;
  bottom: 24px;
  z-index: 1000;
  width: max-content;
  padding: 9px 11px 8px;
  border: 1px solid rgba(148, 163, 184, 0.34);
  border-radius: 9px;
  background: rgba(248, 250, 252, 0.96);
  box-shadow: 0 4px 14px rgba(15, 23, 42, 0.16), 0 1px 2px rgba(15, 23, 42, 0.1);
  color: #0f172a;
  backdrop-filter: blur(8px);
}
.summary-metrics { display: flex; align-items: flex-end; gap: 9px; }
.summary-metric { display: grid; grid-template-columns: auto auto; align-items: baseline; column-gap: 3px; }
.summary-metric > span { grid-column: 1 / -1; margin-bottom: 2px; color: #64748b; font-size: 10px; }
.summary-metric strong {
  color: #0f172a;
  font-size: 18px;
  line-height: 1.05;
  letter-spacing: -0.02em;
  font-variant-numeric: tabular-nums;
}
.summary-metric small { color: #64748b; font-size: 10px; }
.summary-metric.area { min-width: 88px; }
.summary-divider { width: 1px; height: 32px; background: #dbe3ed; }
.summary-imagery {
  margin: 8px -2px 0;
  padding-top: 7px;
  border-top: 1px solid #e2e8f0;
  color: #166534;
  font-size: 10px;
  line-height: 1.3;
  white-space: nowrap;
}
.summary-imagery.off { color: #6b7280; }
.rs-hint {
  position: absolute;
  left: 16px;
  bottom: 24px;
  z-index: 1000;
  padding: 4px 12px;
  background: rgba(255, 255, 255, 0.85);
  border-radius: 6px;
  font-size: 12px;
  color: #166534;
  box-shadow: 0 1px 4px rgba(0, 0, 0, 0.2);
}
.rs-hint.off { color: #6b7280; }

@media (max-width: 720px) {
  .parcel-edit-toolbar { top: 64px; max-width: calc(100vw - 24px); }
  .parcel-summary { padding: 8px 10px; }
  .summary-metric strong { font-size: 17px; }
  .parcel-edit-toolbar.active { gap: 2px; }
  .edit-stat { padding-inline: 4px; }
  .edit-stat span:not(.stat-dot) { display: none; }
  .edit-action { padding-inline: 9px; }
  .draw-guide span { display: none; }
  .draw-guide { min-width: 96px; }
}

@media (max-width: 520px) {
  .parcel-edit-toolbar { left: 12px; right: 12px; overflow-x: auto; }
  .parcel-edit-toolbar .edit-action,
  .parcel-edit-toolbar .edit-launch { flex: 0 0 auto; }
}
</style>
