<template>
  <div class="map-wrap">
    <div ref="mapEl" class="map"></div>

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
    </div>
  </div>
</template>

<script setup lang="ts">
import { onMounted, onBeforeUnmount, ref, watch } from 'vue'
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

const THEME = '#38bdf8' // 统一主题色(决策#14)
const HOVER = '#facc15'

const mapEl = ref<HTMLDivElement>()
const store = useDrilldownStore()
const rsVisible = ref(false)
const rsHint = ref('')
const rsOn = ref(true)
const RS_OPACITY = 0.7
const basemap = ref<'img' | 'vec'>('img')

// Canvas 渲染器: 百余个复杂多边形时比默认 SVG 渲染流畅一个量级
const canvasRenderer = L.canvas({ padding: 0.5 })

let map: L.Map
let childLayer: L.GeoJSON | null = null
let outlineLayer: L.GeoJSON | null = null
let rsLayer: L.TileLayer | null = null
let rsInfo: RsInfo | null = null
let flySeq = 0
let firstRender = true
let basemaps: Basemaps

/** 切换底图(图层顺序由 zIndex 保证: 底图1 < 注记2 < 高分叠加3) */
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
  if (childLayer) { childLayer.remove(); childLayer = null }
  if (outlineLayer) { outlineLayer.remove(); outlineLayer = null }
  if (rsLayer) { rsLayer.remove(); rsLayer = null }
  rsVisible.value = false
  rsHint.value = ''
  rsOn.value = true
}

/** 高分影像 开/关 */
function toggleRs() {
  rsOn.value = !rsOn.value
  rsLayer?.setOpacity(rsOn.value ? RS_OPACITY : 0)
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

async function render() {
  const crumb = store.current
  const seq = ++flySeq
  clearLayers()
  renderOutline(crumb)

  // 视野: flyTo 当前区域 (决策#4 动效)
  let bounds: L.LatLngBounds | null = null
  if (crumb.geometry) {
    bounds = L.geoJSON(toFeature(crumb.geometry)).getBounds()
  } else {
    const prov = await fetchJSON<FeatureCollection>('/data/boundary/province.geojson')
    if (seq !== flySeq) return
    bounds = L.geoJSON(prov).getBounds()
  }
  if (bounds.isValid()) {
    if (firstRender) {
      // 首次渲染: 瞬时贴合省界(不播动画), 默认视野铺满屏幕
      map.fitBounds(bounds.pad(0.02))
      firstRender = false
    } else {
      // 下钻/返回: 同样的紧贴边距, 飞行动画
      map.flyToBounds(bounds.pad(0.02), { duration: 1.0 })
    }
  }

  // 等飞行结束再插入子级图层(动画期间插图层会掉帧); 超时兑底 1.2s
  const flyDone = new Promise<void>((resolve) => {
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
        zIndex: 3, // 高于底图与注记
      }).addTo(map)
      rsVisible.value = true
      rsHint.value = `吉林一号 0.5m 影像（${rsInfo.minZoom}~${rsInfo.maxZoom} 级）`
      // 视野缩放低于瓦片最低级别时抬到最低级, 避免整层不显示
      if (map.getZoom() < rsInfo.minZoom) map.setZoom(rsInfo.minZoom)
    } else {
      rsHint.value = '该村不在高分影像覆盖范围内'
    }
  }
}

watch(() => store.path.length, render)

onMounted(() => {
  map = L.map(mapEl.value!, {
    minZoom: 7,
    maxZoom: 19,
    zoomControl: false,
    zoomSnap: 0.25, // 允许小数级缩放, fitBounds 才能精确贴合(整数级会被迫放松最多1级)
    renderer: canvasRenderer, // 矢量图层默认走 Canvas
  })
  L.control.zoom({ position: 'bottomright' }).addTo(map)
  map.setView([29.5, 120.5], 7) // 初始视野, 防止 flyToBounds 前无中心点
  basemaps = createBasemaps()
  basemaps.img.addTo(map)
  render()
})

onBeforeUnmount(() => map?.remove())
</script>

<style scoped>
.map-wrap { position: absolute; inset: 0; }
.map { width: 100%; height: 100%; }
.ctrl-stack {
  position: absolute;
  right: 10px;
  bottom: 100px;
  z-index: 1000;
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.icon-btn {
  width: 34px;
  height: 34px;
  border: 2px solid rgba(0, 0, 0, 0.2);
  border-radius: 4px;
  background: #fff;
  color: #333;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 0;
}
.icon-btn svg { width: 18px; height: 18px; }
.icon-btn:hover { background: #f4f4f4; }
.icon-btn.off { color: #9ca3af; }

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
</style>
