<template>
  <div class="map-wrap" :class="{ 'parcel-editing': parcelEditing }">
    <div ref="mapEl" class="map"></div>

    <!-- 仅在地块图层显示时出现；编辑中替换为保存/取消 -->
    <div
      v-if="parcelVisible && parcelOn && (parcelDisplayCount > 0 || hiddenParcelCount > 0)"
      class="parcel-edit-toolbar"
      :class="{ active: parcelEditing }"
      aria-label="地块编辑工具"
    >
      <template v-if="parcelEditing">
        <div class="edit-stat">
          <span class="stat-dot hidden" aria-hidden="true"></span>
          <span>已隐藏</span>
          <strong>{{ hiddenParcelCount }}</strong>
        </div>
        <button
          type="button"
          class="edit-action reset"
          :disabled="hiddenParcelCount === 0"
          title="恢复当前村全部隐藏地块"
          @click="resetHiddenParcels"
        >重置</button>
        <span class="toolbar-divider" aria-hidden="true"></span>
        <div class="edit-stat">
          <span class="stat-dot selected" aria-hidden="true"></span>
          <span>已选</span>
          <strong>{{ selectedParcelCount }}</strong>
        </div>
        <button
          type="button"
          class="edit-action primary"
          :disabled="selectedParcelCount === 0"
          @click="saveParcelEdits"
        >保存</button>
        <button type="button" class="edit-action cancel" @click="cancelParcelEditing">取消</button>
      </template>
      <button
        v-else
        type="button"
        class="edit-launch"
        @click="startParcelEditing"
      >
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"
             stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
          <path d="M12 20h9" />
          <path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L8 18l-4 1 1-4Z" />
        </svg>
        编辑地块
      </button>
    </div>

    <div
      v-if="resetDialogOpen"
      class="dialog-backdrop"
      role="presentation"
      @click.self="closeResetDialog"
    >
      <section
        ref="resetDialogEl"
        class="confirm-dialog"
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="reset-dialog-title"
        aria-describedby="reset-dialog-description"
        tabindex="-1"
        @keydown.esc="closeResetDialog"
      >
        <div class="dialog-icon" aria-hidden="true">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"
               stroke-linecap="round" stroke-linejoin="round">
            <path d="M3 6h18" />
            <path d="M8 6V4h8v2" />
            <path d="m19 6-1 14H6L5 6" />
            <path d="M10 11v5M14 11v5" />
          </svg>
        </div>
        <div class="dialog-copy">
          <h2 id="reset-dialog-title">恢复隐藏地块</h2>
          <p id="reset-dialog-description">
            将恢复当前村已隐藏的 <strong>{{ hiddenParcelCount }}</strong> 个地块。本机保存的隐藏记录会被清除。
          </p>
        </div>
        <div class="dialog-actions">
          <button type="button" class="dialog-button secondary" @click="closeResetDialog">取消</button>
          <button type="button" class="dialog-button danger" @click="confirmResetHiddenParcels">确认重置</button>
        </div>
      </section>
    </div>

    <!-- 村级: 影像状态角标(无弹窗, 仅文字) -->
    <div v-if="rsHint" class="rs-hint" :class="{ off: !rsVisible }">{{ rsHint }}</div>

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
        :disabled="parcelEditing"
        :title="parcelEditing ? '编辑地块时不能关闭图层' : (parcelOn ? 'AI地块：开（点击关闭）' : 'AI地块：关（点击打开）')"
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
import { computed, nextTick, onMounted, onBeforeUnmount, ref, watch } from 'vue'
import L from 'leaflet'
import type { Feature, FeatureCollection, Geometry } from 'geojson'
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
const PARCEL_SELECTED_STYLE: L.PathOptions = {
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
const PARCEL_STORAGE_KEY = 'agri-map:parcel-edits:v1'
const PARCEL_DATASET_VERSION = '2025-04-02-v1'
const DEFAULT_MIN_ZOOM = 7
const PARCEL_EDIT_MIN_ZOOM = 15.25 // 高于村级 z<=15.0 自动退出阈值

type ParcelId = string
interface ParcelEditRecord {
  datasetVersion: string
  hiddenIds: ParcelId[]
}
interface ParcelEditStorage {
  version: 1
  villages: Record<string, ParcelEditRecord>
}

const mapEl = ref<HTMLDivElement>()
const resetDialogEl = ref<HTMLElement>()
const store = useDrilldownStore()
const rsVisible = ref(false)
const rsHint = ref('')
const rsOn = ref(true)
const parcelVisible = ref(false)
const parcelOn = ref(true)
const parcelEditing = ref(false)
const resetDialogOpen = ref(false)
const selectedParcelCount = ref(0)
const hiddenParcelCount = ref(0)
const parcelDisplayCount = ref(0)
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
let editDimLayer: L.Rectangle | null = null
let parcelSource: FeatureCollection | null = null
let parcelVillageCode = ''
let hiddenParcelIds = new Set<ParcelId>()
let selectedParcelIds = new Set<ParcelId>()
let rsInfo: RsInfo | null = null
let flySeq = 0
let firstRender = true
let pendingNoFly = false // 自动切换层级时不重排视野(决策: 不动视野)
let suppressAutoZoom = false // 点击下钻/返回的程序化缩放不得触发自动进退层级
let basemaps: Basemaps

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
  if (parcelEditing.value && map) {
    map.setMinZoom(DEFAULT_MIN_ZOOM)
    mapMinZoom.value = DEFAULT_MIN_ZOOM
  }
  parcelEditing.value = false
  resetDialogOpen.value = false
  selectedParcelIds.clear()
  selectedParcelCount.value = 0
  parcelSource = null
  parcelVillageCode = ''
  hiddenParcelIds.clear()
  hiddenParcelCount.value = 0
  parcelDisplayCount.value = 0
  if (childLayer) { childLayer.remove(); childLayer = null }
  if (outlineLayer) { outlineLayer.remove(); outlineLayer = null }
  if (rsLayer) { rsLayer.remove(); rsLayer = null }
  if (parcelLayer) { parcelLayer.remove(); parcelLayer = null }
  if (editDimLayer) { editDimLayer.remove(); editDimLayer = null }
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
  if (parcelEditing.value) return
  parcelOn.value = !parcelOn.value
  parcelLayer?.setStyle(parcelOn.value
    ? PARCEL_STYLE
    : { ...PARCEL_STYLE, opacity: 0, fillOpacity: 0 })
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

function updateParcelHint() {
  if (!parcelSource) return
  rsHint.value = `吉林一号 0.5m 影像 · 当前地块 ${parcelDisplayCount.value.toLocaleString()} `
}

function renderParcelLayer() {
  parcelLayer?.remove()
  parcelLayer = null
  if (!parcelSource) return

  const visibleFeatures = parcelSource.features.filter((feature) => {
    const id = parcelId(feature)
    return parcelEditing.value || id === null || !hiddenParcelIds.has(id)
  })
  hiddenParcelCount.value = hiddenParcelIds.size
  parcelDisplayCount.value = parcelSource.features.length - hiddenParcelIds.size

  const visibleParcels: FeatureCollection = { type: 'FeatureCollection', features: visibleFeatures }
  parcelLayer = L.geoJSON(visibleParcels, {
    interactive: parcelEditing.value && parcelOn.value,
    style: (feature) => {
      const id = feature ? parcelId(feature as Feature) : null
      if (id && selectedParcelIds.has(id)) return PARCEL_SELECTED_STYLE
      if (parcelEditing.value && id && hiddenParcelIds.has(id)) return PARCEL_HIDDEN_STYLE
      if (parcelEditing.value) return PARCEL_EDIT_STYLE
      return parcelOn.value ? PARCEL_STYLE : { ...PARCEL_STYLE, opacity: 0, fillOpacity: 0 }
    },
    onEachFeature: (feature: Feature, layer: L.Layer) => {
      const path = layer as L.Path
      const id = parcelId(feature)
      layer.on('mouseover', () => {
        if (!parcelEditing.value || !id || hiddenParcelIds.has(id) || selectedParcelIds.has(id)) return
        path.setStyle(PARCEL_HOVER_STYLE)
        path.bringToFront()
      })
      layer.on('mouseout', () => {
        if (!parcelEditing.value || !id || hiddenParcelIds.has(id)) return
        path.setStyle(selectedParcelIds.has(id) ? PARCEL_SELECTED_STYLE : PARCEL_EDIT_STYLE)
      })
      layer.on('click', (event) => {
        if (!parcelEditing.value) return
        L.DomEvent.stopPropagation(event)
        if (!id || hiddenParcelIds.has(id)) return
        if (selectedParcelIds.has(id)) selectedParcelIds.delete(id)
        else selectedParcelIds.add(id)
        selectedParcelCount.value = selectedParcelIds.size
        path.setStyle(selectedParcelIds.has(id) ? PARCEL_SELECTED_STYLE : PARCEL_EDIT_STYLE)
      })
    },
  }).addTo(map)
  outlineLayer?.bringToFront()
  updateParcelHint()
}

function startParcelEditing() {
  if (!parcelOn.value || !parcelSource?.features.length) return
  selectedParcelIds.clear()
  selectedParcelCount.value = 0
  parcelEditing.value = true
  map.setMinZoom(PARCEL_EDIT_MIN_ZOOM)
  mapMinZoom.value = PARCEL_EDIT_MIN_ZOOM
  editDimLayer = L.rectangle([[-85, -180], [85, 180]], {
    pane: 'editDimmingPane',
    stroke: false,
    fillColor: '#0f172a',
    fillOpacity: 0.34,
    interactive: false,
  }).addTo(map)
  renderParcelLayer()
}

function finishParcelEditing() {
  parcelEditing.value = false
  selectedParcelIds.clear()
  selectedParcelCount.value = 0
  map.setMinZoom(DEFAULT_MIN_ZOOM)
  mapMinZoom.value = DEFAULT_MIN_ZOOM
  if (editDimLayer) { editDimLayer.remove(); editDimLayer = null }
  renderParcelLayer()
}

function saveParcelEdits() {
  if (!selectedParcelIds.size || !parcelVillageCode) return
  const nextHidden = new Set([...hiddenParcelIds, ...selectedParcelIds])
  if (!persistHiddenParcelIds(parcelVillageCode, nextHidden)) {
    window.alert('本机保存失败，请检查浏览器是否允许本地存储后重试。')
    return
  }
  hiddenParcelIds = nextHidden
  finishParcelEditing()
}

function cancelParcelEditing() {
  finishParcelEditing()
}

async function resetHiddenParcels() {
  if (!hiddenParcelIds.size || !parcelVillageCode) return
  resetDialogOpen.value = true
  await nextTick()
  resetDialogEl.value?.focus()
}

function closeResetDialog() {
  resetDialogOpen.value = false
}

function confirmResetHiddenParcels() {
  if (!hiddenParcelIds.size || !parcelVillageCode) {
    closeResetDialog()
    return
  }
  if (!persistHiddenParcelIds(parcelVillageCode, new Set())) {
    closeResetDialog()
    window.alert('重置失败，请检查浏览器是否允许本地存储后重试。')
    return
  }
  hiddenParcelIds.clear()
  selectedParcelIds.clear()
  selectedParcelCount.value = 0
  closeResetDialog()
  renderParcelLayer()
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
    return
  }

  // 村级: 高分影像叠加(仅当村范围与影像范围相交)
  if (crumb.level === 'village') {
    // 等飞行结束再加影像层: 中途缩放低于 minZoom 时插入, 瓦片可能被清空不恢复
    const [info] = await Promise.all([
      rsInfo ? Promise.resolve(rsInfo) : fetchRsInfo().catch(() => null),
      flyDone,
    ])
    if (seq !== flySeq) return
    rsInfo = info
    if (!rsInfo || !crumb.geometry) return
    const [w, s, e, n] = rsInfo.bounds
    const vb = L.geoJSON(toFeature(crumb.geometry)).getBounds()
    const rsBounds = L.latLngBounds([s, w], [n, e])
    if (vb.intersects(rsBounds)) {
      rsLayer = L.tileLayer('/tiles/rs/{z}/{x}/{y}.png', {
        minZoom: rsInfo.minZoom,
        maxZoom: rsInfo.maxZoom,
        opacity: RS_OPACITY,
        zIndex: 3, // 高于底图；文字注记在独立 annotationPane 中置顶
      }).addTo(map)
      rsVisible.value = true
      rsHint.value = `吉林一号 0.5m 影像（${rsInfo.minZoom}~${rsInfo.maxZoom} 级）`

      // AI 识别地块: 按村按需加载；没有地块产物的村静默跳过
      const parcels = await fetchJSON<FeatureCollection>(`/data/parcels/${crumb.code}.geojson`).catch(() => null)
      if (seq !== flySeq) return
      if (parcels?.features.length) {
        parcelSource = parcels
        parcelVillageCode = crumb.code
        const validIds = new Set(parcels.features.map(parcelId).filter((id): id is ParcelId => id !== null))
        hiddenParcelIds = new Set([...loadHiddenParcelIds(crumb.code)].filter((id) => validIds.has(id)))
        renderParcelLayer()
        parcelVisible.value = true
      }

      // 程序化抬升到影像最低级别时也禁止触发自动退出村级。
      if (map.getZoom() < rsInfo.minZoom) {
        suppressAutoZoom = true
        map.once('zoomend', () => { suppressAutoZoom = false })
        setTimeout(() => { suppressAutoZoom = false }, 500)
        map.setZoom(rsInfo.minZoom)
      }
    } else {
      rsHint.value = '该村不在高分影像覆盖范围内'
    }
  }
}

watch(() => store.path.length, () => {
  const nf = pendingNoFly
  pendingNoFly = false
  render(nf)
})

/** 缩放下钻: zoomend 时按中心点判定自动进出层级(平移不触发) */
function onAutoLevel() {
  if (suppressAutoZoom || parcelEditing.value) return
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
  map.createPane('annotationPane')
  map.getPane('annotationPane')!.style.zIndex = '450'
  map.getPane('annotationPane')!.style.pointerEvents = 'none'
  basemaps = createBasemaps()
  basemaps.img.addTo(map)
  map.on('zoomend', () => {
    currentZoom.value = map.getZoom()
    onAutoLevel()
  })
  render()
})

onBeforeUnmount(() => map?.remove())
</script>

<style scoped>
.map-wrap { position: absolute; inset: 0; }
.map { width: 100%; height: 100%; }
.parcel-editing .map { cursor: crosshair; }
.dialog-backdrop {
  position: absolute;
  inset: 0;
  z-index: 2000;
  display: grid;
  place-items: center;
  padding: 20px;
  background: rgba(15, 23, 42, 0.42);
  animation: backdrop-in 160ms ease-out;
}
.confirm-dialog {
  width: min(390px, calc(100vw - 40px));
  display: grid;
  grid-template-columns: 42px 1fr;
  column-gap: 14px;
  padding: 22px;
  border: 1px solid rgba(148, 163, 184, 0.32);
  border-radius: 14px;
  background: #fff;
  box-shadow: 0 24px 60px rgba(15, 23, 42, 0.28), 0 4px 12px rgba(15, 23, 42, 0.12);
  color: #0f172a;
  animation: dialog-in 180ms cubic-bezier(0.16, 1, 0.3, 1);
}
.confirm-dialog:focus { outline: none; }
.dialog-icon {
  width: 42px;
  height: 42px;
  display: grid;
  place-items: center;
  border-radius: 10px;
  background: #fff7ed;
  color: #c2410c;
}
.dialog-icon svg { width: 21px; height: 21px; }
.dialog-copy h2 { margin: 1px 0 7px; font-size: 17px; line-height: 1.35; }
.dialog-copy p { margin: 0; color: #475569; font-size: 14px; line-height: 1.65; }
.dialog-copy strong { color: #0f172a; font-variant-numeric: tabular-nums; }
.dialog-actions {
  grid-column: 1 / -1;
  display: flex;
  justify-content: flex-end;
  gap: 8px;
  margin-top: 20px;
}
.dialog-button {
  height: 36px;
  padding: 0 15px;
  border: 0;
  border-radius: 7px;
  font: inherit;
  font-size: 14px;
  font-weight: 600;
  cursor: pointer;
}
.dialog-button.secondary { background: #f1f5f9; color: #334155; }
.dialog-button.secondary:hover { background: #e2e8f0; }
.dialog-button.danger { background: #c2410c; color: #fff; box-shadow: 0 1px 2px rgba(154, 52, 18, 0.25); }
.dialog-button.danger:hover { background: #9a3412; }
.dialog-button:focus-visible { outline: 3px solid rgba(37, 99, 235, 0.28); outline-offset: 2px; }
@keyframes backdrop-in { from { background: rgba(15, 23, 42, 0); } }
@keyframes dialog-in {
  from { opacity: 0.4; transform: translateY(8px) scale(0.98); }
  to { opacity: 1; transform: translateY(0) scale(1); }
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
.edit-launch:hover { background: #eff6ff; color: #1e40af; }
.edit-action { padding: 0 12px; background: transparent; color: #475569; }
.edit-action:hover:not(:disabled) { background: #e2e8f0; color: #0f172a; }
.edit-launch:focus-visible,
.edit-action:focus-visible { outline: 3px solid rgba(37, 99, 235, 0.28); outline-offset: 2px; }
.edit-action:disabled { cursor: not-allowed; opacity: 0.38; }
.edit-action.primary { background: #2563eb; color: #fff; box-shadow: 0 1px 2px rgba(30, 64, 175, 0.25); }
.edit-action.primary:hover:not(:disabled) { background: #1d4ed8; color: #fff; }
.edit-action.reset { color: #b45309; }
.edit-action.reset:hover:not(:disabled) { background: #fff7ed; color: #92400e; }
.edit-action.cancel { color: #475569; }
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
.stat-dot.selected { background: #ef4444; box-shadow: 0 0 0 3px rgba(239, 68, 68, 0.14); }
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
.ctrl-stack { bottom: 122px; }
.zoom-stack { bottom: 30px; }
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
  .parcel-edit-toolbar.active { gap: 2px; }
  .edit-stat { padding-inline: 4px; }
  .edit-stat span:not(.stat-dot) { display: none; }
  .edit-action { padding-inline: 9px; }
}
</style>
