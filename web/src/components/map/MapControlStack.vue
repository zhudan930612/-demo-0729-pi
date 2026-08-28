<template>
  <div ref="controlStackRef" class="ctrl-stack">
    <!-- 演示模式入口（顶层）：农情监测 / 受灾预警 / 受灾评估 -->
    <div class="tool-entry" @mouseenter="openDemoMenu" @mouseleave="scheduleCloseMenus" @focusin="openDemoMenu">
      <button
        type="button" class="icon-btn demo-btn" :class="{ active: demoMenuOpen || agriMonitoringActive || disasterWarningActive }"
        :aria-label="demoTip" aria-haspopup="true" :aria-expanded="demoMenuOpen" aria-controls="demo-tool-menu" @click="openDemoMenu"
      >
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M2 3h20M4 3v7a2 2 0 0 0 2 2h4a2 2 0 0 0 2-2V3M9 12v3a3 3 0 0 0 3 3 3 3 0 0 0 3-3v-3M12 3v8"/></svg>
        <span class="icon-tip" role="tooltip">{{ demoTip }}</span>
      </button>
      <Transition name="tool-menu">
        <div v-if="demoMenuOpen" id="demo-tool-menu" class="tool-menu" aria-label="选择演示模式">
          <button type="button" class="menu-action" :class="{ selected: agriMonitoringActive }" :title="agriMonitoringActive ? '退出农情监测' : '进入农情监测'" @click="chooseDemo('agri')">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 22V10"/><path d="M6 14c-1.5 0-3-1.5-3-3.5S5 6 8 6c1.5 0 3 .8 4 2 1-1.2 2.5-2 4-2 3 0 5 2.5 5 4.5S19.5 14 18 14"/></svg>
            <span>农情监测</span>
          </button>
          <button type="button" class="menu-action" :class="{ selected: disasterWarningActive }" :title="disasterWarningActive ? '退出受灾预警' : '进入受灾预警'" @click="chooseDemo('disaster')">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 3 3.5 7.4v5.2c0 4.5 3.2 7.4 8.5 8.9 5.3-1.5 8.5-4.4 8.5-8.9V7.4L12 3Z"/></svg>
            <span>受灾预警</span>
          </button>
          <button type="button" class="menu-action" disabled title="即将上线">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 2 2 7l10 5 10-5-10-5z"/><path d="m2 17 10 5 10-5"/></svg>
            <span>受灾评估 <small style="color:#94a3b8">(即将上线)</small></span>
          </button>
        </div>
      </Transition>
    </div>

    <div class="tool-entry" @mouseenter="openWeatherMenu" @mouseleave="scheduleCloseMenus">
      <button
        ref="weatherButtonRef" type="button" class="icon-btn weather-btn" :class="{ active: weatherMenuOpen }"
        :disabled="weatherEntryDisabled" :aria-label="weatherTip"
        aria-haspopup="true" :aria-expanded="weatherMenuOpen" aria-controls="weather-tool-menu" @click="focusWeatherMenu"
      >
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M6.5 18.5h10a3.5 3.5 0 1 0-.78-6.91A5.25 5.25 0 0 0 5.61 13.2 2.7 2.7 0 0 0 6.5 18.5Z"/><path d="M8 5.5v-2M4.1 7.1 2.7 5.7M11.9 7.1l1.4-1.4"/></svg>
        <span class="icon-tip" role="tooltip">{{ weatherTip }}</span>
      </button>
      <Transition name="tool-menu">
        <div v-if="weatherMenuOpen" id="weather-tool-menu" class="tool-menu" aria-label="选择天气查看模块">
          <button ref="firstWeatherActionRef" type="button" class="menu-action" :class="{ selected: weatherModules.includes('alerts') }" :title="weatherModules.includes('alerts') ? '退出气象预警查看' : '进入气象预警查看'" @click="chooseWeatherModule('alerts')"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 3 3.5 7.4v5.2c0 4.5 3.2 7.4 8.5 8.9 5.3-1.5 8.5-4.4 8.5-8.9V7.4L12 3Z"/><path d="M12 7.5v5M12 16.5h.01"/></svg><span>气象预警</span></button>
          <button type="button" class="menu-action" :class="{ selected: weatherModules.includes('current') }" :title="weatherModules.includes('current') ? '退出实时天气查看' : '进入实时天气查看'" @click="chooseWeatherModule('current')"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="3.5"/><path d="M12 2.5v2M12 19.5v2M2.5 12h2M19.5 12h2M5.3 5.3l1.4 1.4M17.3 17.3l1.4 1.4M18.7 5.3l-1.4 1.4M6.7 17.3l-1.4 1.4"/></svg><span>实时天气</span></button>
          <button type="button" class="menu-action" :class="{ selected: weatherModules.includes('precipitation') }" :title="weatherModules.includes('precipitation') ? '退出降雨量查看' : '进入降雨量查看'" @click="chooseWeatherModule('precipitation')"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 3s-5.5 7-5.5 10.5a5.5 5.5 0 0 0 11 0C17.5 10 12 3 12 3Z"/><path d="M8.5 13.5 7 15.5"/><path d="M12 13.5l-1.5 2"/><path d="M15.5 13.5 14 15.5"/></svg><span>降雨量</span></button>
        </div>
      </Transition>
    </div>

    <!-- 风险评估入口 -->
    <div class="tool-entry" @mouseenter="openLodgingMenu" @mouseleave="scheduleCloseMenus" @focusin="openLodgingMenu">
      <button
        type="button" class="icon-btn lodging-btn" :class="{ active: lodgingMenuOpen || lodgingAssessmentActive }"
        :disabled="lodgingEntryDisabled" :aria-label="lodgingTip"
        aria-haspopup="true" :aria-expanded="lodgingMenuOpen" aria-controls="lodging-tool-menu" @click="toggleLodgingMenu"
      >
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 2L2 7l10 5 10-5-10-5z"/><path d="M2 17l10 5 10-5"/><path d="M2 12l10 5 10-5"/><circle cx="12" cy="12" r="2"/></svg>
        <span class="icon-tip" role="tooltip">{{ lodgingTip }}</span>
      </button>
      <Transition name="tool-menu">
        <div v-if="lodgingMenuOpen" id="lodging-tool-menu" class="tool-menu" aria-label="选择评估类型">
          <button type="button" class="menu-action" :class="{ selected: lodgingAssessmentActive }" @click="chooseLodgingAssessment('rice')">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 2v20M8 6c0 2 1 4 4 4s4-2 4-4M6 10c0 2 1.5 4 6 4s6-2 6-4M4 14c0 2 2 4 8 4s8-2 8-4"/></svg>
            <span>🌾 水稻倒伏</span>
          </button>
          <button type="button" class="menu-action" disabled title="即将上线">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 2v20M9 8c0 1.5 1 3 3 3s3-1.5 3-3M7 12c0 1.5 1.5 3 5 3s5-1.5 5-3"/></svg>
            <span>🌿 小麦倒伏 <small style="color:#94a3b8">(即将上线)</small></span>
          </button>
          <button v-if="lodgingAssessmentActive" type="button" class="menu-action" @click="exitLodgingAssessment">
            <span>✕ 退出评估</span>
          </button>
          <div class="menu-divider"></div>
          <label class="menu-toggle">
            <span class="toggle-label">演示模式</span>
            <input type="checkbox" :checked="lodgingDemoMode" @change="toggleLodgingDemoMode" />
            <span class="toggle-switch"></span>
          </label>
        </div>
      </Transition>
    </div>

    <button
      type="button" class="icon-btn typhoon-btn" :class="{ active: disasterActive }"
      :disabled="disasterEntryDisabled || disasterActive"
      :aria-label="typhoonTip"
      @click="emit('open-typhoon')"
    >
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="2.1"/><path d="M12 3.5c3.7 0 6.8 2.6 7.5 6.1-1.4-1-3.1-1.5-4.7-1.1"/><path d="M20.5 12c0 3.7-2.6 6.8-6.1 7.5 1-1.4 1.5-3.1 1.1-4.7"/><path d="M12 20.5c-3.7 0-6.8-2.6-7.5-6.1 1.4 1 3.1 1.5 4.7 1.1"/><path d="M3.5 12c0-3.7 2.6-6.8 6.1-7.5-1 1.4-1.5 3.1-1.1 4.7"/></svg>
      <span class="icon-tip" role="tooltip">{{ typhoonTip }}</span>
    </button>

    <div v-if="parcelToolsVisible" class="tool-entry" @mouseenter="openParcelMenu" @mouseleave="scheduleCloseMenus">
      <button
        type="button" class="icon-btn parcel-tool-btn" :class="{ active: parcelMenuOpen }"
        :disabled="parcelToolsDisabled" :aria-label="parcelTip"
        aria-haspopup="true" :aria-expanded="parcelMenuOpen" aria-controls="parcel-tool-menu" @click="focusParcelMenu"
      >
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m3 5 7-2 5 5-2 10-8 2-2-8Z"/><path d="M17 13h4M19 11v4"/></svg>
        <span class="icon-tip" role="tooltip">{{ parcelTip }}</span>
      </button>
      <Transition name="tool-menu">
        <div v-if="parcelMenuOpen" id="parcel-tool-menu" class="tool-menu" aria-label="选择地块操作">
          <button ref="firstParcelActionRef" type="button" class="menu-action" @click="chooseParcelMode('manual')"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m4 5 7-2 5 5-2 10-9 2-2-8Z"/><path d="M18 13v8M14 17h8"/></svg><span>新增地块</span></button>
          <button type="button" class="menu-action" :disabled="!parcelOn || !hasFilterableParcels" :title="!parcelOn ? '请先打开地块图层' : (hasFilterableParcels ? '筛选地块' : '当前村没有可筛选的地块')" @click="chooseParcelMode('filter')"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 5h16l-6.5 7.2V19l-3 1.5v-8.3Z"/></svg><span>筛选地块</span></button>
        </div>
      </Transition>
    </div>

    <div class="tool-entry basemap-entry" @mouseenter="openBasemapMenu" @mouseleave="scheduleCloseMenus" @focusin="openBasemapMenu">
      <button
        type="button" class="icon-btn layer-btn" :class="{ active: basemapMenuOpen }"
        :aria-label="basemapLabel"
        aria-haspopup="true" :aria-expanded="basemapMenuOpen" aria-controls="basemap-tool-menu" @click="openBasemapMenu"
      >
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 2 2 7l10 5 10-5-10-5z"/><path d="m2 17 10 5 10-5"/><path d="m2 12 10 5 10-5"/></svg><span class="icon-tip" role="tooltip">选择底图</span>
      </button>
      <Transition name="tool-menu">
        <div v-if="basemapMenuOpen" id="basemap-tool-menu" class="tool-menu basemap-menu" role="radiogroup" aria-label="选择底图">
          <button type="button" class="menu-action" role="radio" :aria-checked="basemap === 'img'" :class="{ selected: basemap === 'img' }" @click="chooseBasemap('img')"><span>卫星底图</span></button>
          <button type="button" class="menu-action" role="radio" :aria-checked="basemap === 'vec'" :class="{ selected: basemap === 'vec' }" @click="chooseBasemap('vec')"><span>矢量底图</span></button>
          <button type="button" class="menu-action" role="radio" :aria-checked="basemap === 'osm'" :class="{ selected: basemap === 'osm' }" @click="chooseBasemap('osm')"><span>OSM 标准</span></button>
          <button type="button" class="menu-action" role="radio" :aria-checked="basemap === 'topo'" :class="{ selected: basemap === 'topo' }" @click="chooseBasemap('topo')"><span>OSM 地貌</span></button>
        </div>
      </Transition>
    </div>
    <button v-if="rsVisible" type="button" class="icon-btn" :class="{ off: !rsOn }" :aria-label="rsOn ? '关闭高分影像' : '打开高分影像'" @click="emit('toggle-rs')">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/><line v-if="!rsOn" x1="3" y1="3" x2="21" y2="21"/></svg><span class="icon-tip" role="tooltip">{{ rsOn ? '关闭高分影像' : '打开高分影像' }}</span>
    </button>
    <button v-if="parcelVisible" type="button" class="icon-btn parcel-btn" :class="{ off: !parcelOn }" :disabled="mode !== 'idle'" :aria-label="parcelOn ? '关闭地块图层' : '打开地块图层'" @click="emit('toggle-parcels')">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m3 4 7-1 3 6-2 11-8 1z"/><path d="m10 3 8 2 3 6-4 9-6-1"/><path d="m13 9 8 2"/><path d="m4 14 8-2"/></svg><span class="icon-tip" role="tooltip">{{ parcelOn ? '关闭地块图层' : '打开地块图层' }}</span>
    </button>
    <div v-if="parcelVisualModeVisible" class="tool-entry" @mouseenter="openLayerMenu" @mouseleave="scheduleCloseMenus" @focusin="openLayerMenu">
      <button
        type="button" class="icon-btn layer-btn" :class="{ active: layerMenuOpen }"
        :aria-label="layerTip" aria-haspopup="true" :aria-expanded="layerMenuOpen" aria-controls="layer-tool-menu" @click="openLayerMenu"
      >
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 2 2 7l10 5 10-5-10-5z"/><path d="m2 17 10 5 10-5"/><path d="m2 12 10 5 10-5"/></svg><span class="icon-tip" role="tooltip">{{ layerTip }}</span>
      </button>
      <Transition name="tool-menu">
        <div v-if="layerMenuOpen" id="layer-tool-menu" class="tool-menu" role="radiogroup" aria-label="选择地图图层">
          <button type="button" class="menu-action" role="radio" :aria-checked="parcelVisualMode === 'parcel'" :class="{ selected: parcelVisualMode === 'parcel' }" @click="chooseVisualMode('parcel')"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m3 4 7-1 3 6-2 11-8 1z"/><path d="m10 3 8 2 3 6-4 9-6-1"/><path d="m13 9 8 2"/><path d="m4 14 8-2"/></svg><span>地块</span></button>
          <button type="button" class="menu-action" role="radio" :aria-checked="parcelVisualMode === 'planting'" :class="{ selected: parcelVisualMode === 'planting' }" @click="chooseVisualMode('planting')"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 22V10"/><path d="M6 14c-1.5 0-3-1.5-3-3.5S5 6 8 6c1.5 0 3 .8 4 2 1-1.2 2.5-2 4-2 3 0 5 2.5 5 4.5S19.5 14 18 14"/></svg><span>种植</span></button>
          <button type="button" class="menu-action" role="radio" :aria-checked="parcelVisualMode === 'insurance'" :class="{ selected: parcelVisualMode === 'insurance' }" @click="chooseVisualMode('insurance')"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 3 4 7v5c0 5.25 3.4 8.35 8 9.5 4.6-1.15 8-4.25 8-9.5V7l-8-4z"/><path d="M9 12l2 2 4-4"/></svg><span>保险</span></button>
        </div>
      </Transition>
    </div>
  </div>
  <div class="zoom-stack" aria-label="地图缩放工具">
    <button type="button" class="icon-btn" :disabled="!canZoomIn" title="放大" aria-label="放大" @click="emit('zoom-in')"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M5 12h14M12 5v14"/></svg></button>
    <button type="button" class="icon-btn" :disabled="!canZoomOut" title="缩小" aria-label="缩小" @click="emit('zoom-out')"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M5 12h14"/></svg></button>
  </div>
</template>

<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, ref, watch } from 'vue'
import type { ParcelMode } from '../../features/parcels/parcelTypes'
import type { ParcelVisualMode } from '../../features/parcels/parcelVisualMode'
import type { BasemapKey } from '../../api/tianditu'
type WeatherModule = 'alerts' | 'current' | 'precipitation'
const props = defineProps<{ basemap:BasemapKey; rsVisible:boolean; rsOn:boolean; parcelVisible:boolean; parcelOn:boolean; mode:ParcelMode; canZoomIn:boolean; canZoomOut:boolean; parcelToolsVisible:boolean; parcelToolsDisabled:boolean; hasFilterableParcels:boolean; disasterEntryDisabled:boolean; disasterActive:boolean; weatherEntryDisabled:boolean; weatherEntryReason:string; weatherActive:boolean; weatherModules:WeatherModule[]; parcelVisualModeVisible:boolean; parcelVisualMode:ParcelVisualMode; lodgingEntryDisabled:boolean; lodgingEntryReason:string; lodgingAssessmentActive:boolean; lodgingDemoMode:boolean; agriMonitoringActive:boolean; disasterWarningActive:boolean }>()
const emit = defineEmits<{ 'switch-basemap':[type:BasemapKey]; 'toggle-rs':[]; 'toggle-parcels':[]; 'start-manual':[]; 'start-filter':[]; 'open-typhoon':[]; 'open-weather':[module:WeatherModule]; 'close-weather':[module:WeatherModule]; 'zoom-in':[]; 'zoom-out':[]; 'set-visual-mode':[mode:ParcelVisualMode]; 'enter-lodging-assessment':[]; 'exit-lodging-assessment':[]; 'toggle-lodging-demo-mode':[]; 'open-agri-monitoring':[]; 'open-disaster-warning':[] }>()
const controlStackRef=ref<HTMLElement|null>(null), weatherButtonRef=ref<HTMLButtonElement|null>(null)
const firstParcelActionRef=ref<HTMLButtonElement|null>(null),firstWeatherActionRef=ref<HTMLButtonElement|null>(null)
const parcelMenuOpen=ref(false),weatherMenuOpen=ref(false),layerMenuOpen=ref(false),basemapMenuOpen=ref(false),lodgingMenuOpen=ref(false),demoMenuOpen=ref(false)
const typhoonTip=computed(()=>props.disasterActive?'灾害查看模式已开启':props.disasterEntryDisabled?'请先保存或取消当前未完成操作':'查看台风')
const weatherTip=computed(()=>props.weatherActive?`当前：${props.weatherModules.map((module)=>module==='alerts'?'气象预警':module==='precipitation'?'降雨量':'实时天气').join('、')}，点击菜单项可退出`:props.weatherEntryReason)
const parcelTip=computed(()=>props.weatherActive?'天气查看中可查看地块，编辑操作暂不可用':props.disasterActive?'灾害查看中可查看地块，编辑操作暂不可用':props.mode!=='idle'?'操作地块时不能切换工具':'地块工具')
const layerTip=computed(()=>{const label=props.parcelVisualMode==='planting'?'种植':props.parcelVisualMode==='insurance'?'保险':'地块';return`地图图层：${label}`})
const lodgingTip=computed(()=>props.lodgingAssessmentActive?'风险评估模式已开启':props.lodgingEntryReason?props.lodgingEntryReason:'水稻倒伏评估')
const demoTip=computed(()=>props.agriMonitoringActive||props.disasterWarningActive?'演示模式已开启':'演示模式')
const basemapLabel=computed(()=>({img:'底图：卫星',vec:'底图：矢量',osm:'底图：OSM 标准',topo:'底图：OSM 地貌'})[props.basemap])
defineExpose({focusWeather:()=>weatherButtonRef.value?.focus()})
let closeHoverTimer:ReturnType<typeof setTimeout>|undefined
function cancelScheduledClose(){if(closeHoverTimer){clearTimeout(closeHoverTimer);closeHoverTimer=undefined}}
function scheduleCloseMenus(){if(closeHoverTimer)clearTimeout(closeHoverTimer);closeHoverTimer=setTimeout(closeMenus,180)}
function closeMenus(){parcelMenuOpen.value=false;weatherMenuOpen.value=false;layerMenuOpen.value=false;basemapMenuOpen.value=false;lodgingMenuOpen.value=false;demoMenuOpen.value=false}
function openDemoMenu(){cancelScheduledClose();parcelMenuOpen.value=false;weatherMenuOpen.value=false;layerMenuOpen.value=false;basemapMenuOpen.value=false;lodgingMenuOpen.value=false;demoMenuOpen.value=true}
function chooseDemo(type:'agri'|'disaster'){demoMenuOpen.value=false;if(type==='agri')emit('open-agri-monitoring');else emit('open-disaster-warning')}
function openWeatherMenu(){if(props.weatherEntryDisabled)return;cancelScheduledClose();parcelMenuOpen.value=false;layerMenuOpen.value=false;basemapMenuOpen.value=false;lodgingMenuOpen.value=false;demoMenuOpen.value=false;weatherMenuOpen.value=true}
function focusWeatherMenu(){openWeatherMenu();if(weatherMenuOpen.value)void nextTick(()=>firstWeatherActionRef.value?.focus())}
function openLodgingMenu(){if(props.lodgingEntryDisabled)return;cancelScheduledClose();parcelMenuOpen.value=false;weatherMenuOpen.value=false;layerMenuOpen.value=false;basemapMenuOpen.value=false;demoMenuOpen.value=false;lodgingMenuOpen.value=true}
function openParcelMenu(){if(props.parcelToolsDisabled)return;cancelScheduledClose();weatherMenuOpen.value=false;layerMenuOpen.value=false;basemapMenuOpen.value=false;lodgingMenuOpen.value=false;parcelMenuOpen.value=true}
function focusParcelMenu(){openParcelMenu();if(parcelMenuOpen.value)void nextTick(()=>firstParcelActionRef.value?.focus())}
function openLayerMenu(){cancelScheduledClose();parcelMenuOpen.value=false;weatherMenuOpen.value=false;basemapMenuOpen.value=false;lodgingMenuOpen.value=false;layerMenuOpen.value=true}
function openBasemapMenu(){cancelScheduledClose();parcelMenuOpen.value=false;weatherMenuOpen.value=false;layerMenuOpen.value=false;lodgingMenuOpen.value=false;basemapMenuOpen.value=true}
function chooseBasemap(type:BasemapKey){closeMenus();emit('switch-basemap',type)}
function chooseParcelMode(mode:'manual'|'filter'){parcelMenuOpen.value=false;if(mode==='manual')emit('start-manual');else emit('start-filter')}
function chooseWeatherModule(module:WeatherModule){weatherMenuOpen.value=false;if(props.weatherModules.includes(module)){emit('close-weather',module);return}emit('open-weather',module)}
function chooseVisualMode(mode:ParcelVisualMode){layerMenuOpen.value=false;emit('set-visual-mode',mode)}
function toggleLodgingMenu(){
  if(props.lodgingEntryDisabled)return
  // 评估模式下点击图标直接退出；否则打开/收起菜单
  if(props.lodgingAssessmentActive){closeMenus();emit('exit-lodging-assessment');return}
  if(lodgingMenuOpen.value){closeMenus();return}
  openLodgingMenu()
}
function chooseLodgingAssessment(_type:'rice'){lodgingMenuOpen.value=false;emit('enter-lodging-assessment')}
function exitLodgingAssessment(){lodgingMenuOpen.value=false;emit('exit-lodging-assessment')}
function toggleLodgingDemoMode(){emit('toggle-lodging-demo-mode')}
function closeOnOutside(event:PointerEvent){if((parcelMenuOpen.value||weatherMenuOpen.value||layerMenuOpen.value||basemapMenuOpen.value||lodgingMenuOpen.value||demoMenuOpen.value)&&!controlStackRef.value?.contains(event.target as Node))closeMenus()}
function onKeydown(event:KeyboardEvent){if(event.key!=='Escape'||(!parcelMenuOpen.value&&!weatherMenuOpen.value&&!layerMenuOpen.value&&!basemapMenuOpen.value&&!lodgingMenuOpen.value&&!demoMenuOpen.value))return;event.preventDefault();event.stopImmediatePropagation();closeMenus()}
watch(()=>[props.parcelToolsVisible,props.parcelToolsDisabled,props.weatherEntryDisabled,props.parcelVisualModeVisible] as const,()=>{if(!props.parcelToolsVisible||props.parcelToolsDisabled)parcelMenuOpen.value=false;if(props.weatherEntryDisabled)weatherMenuOpen.value=false;if(!props.parcelVisualModeVisible)layerMenuOpen.value=false})
document.addEventListener('pointerdown',closeOnOutside);window.addEventListener('keydown',onKeydown,true)
onBeforeUnmount(()=>{document.removeEventListener('pointerdown',closeOnOutside);window.removeEventListener('keydown',onKeydown,true)})
</script>

<style scoped>
.ctrl-stack,.zoom-stack{position:absolute;right:10px;z-index:1000;display:flex;flex-direction:column;gap:2px;padding:4px;border:1px solid rgba(148,163,184,.34);border-radius:10px;background:rgba(248,250,252,.96);box-shadow:0 6px 20px rgba(15,23,42,.18),0 1px 2px rgba(15,23,42,.12);backdrop-filter:blur(8px)}.ctrl-stack{bottom:116px}.zoom-stack{bottom:24px}.icon-btn{position:relative;width:36px;height:36px;display:flex;align-items:center;justify-content:center;padding:0;border:0;border-radius:7px;background:transparent;color:#475569;cursor:pointer;transition:background-color 160ms,color 160ms,box-shadow 160ms}.tool-entry,.ctrl-stack>*+*,.zoom-stack .icon-btn+.icon-btn{position:relative}.ctrl-stack>*+*::before,.zoom-stack .icon-btn+.icon-btn::before{content:'';position:absolute;top:-1px;left:7px;right:7px;height:1px;background:#e2e8f0}.icon-btn svg{width:18px;height:18px}.icon-btn:hover:not(:disabled){background:#e2e8f0;color:#0f172a}.icon-btn:focus-visible,.menu-action:focus-visible{outline:3px solid rgba(37,99,235,.28);outline-offset:2px}.icon-btn:disabled{cursor:not-allowed;color:#94a3b8}.icon-btn:disabled svg{opacity:.38}.icon-btn.off{color:#94a3b8}.parcel-btn:not(.off){background:#eff6ff;color:#2563eb}.layer-btn.active{background:#dbeafe;color:#1d4ed8}.parcel-tool-btn.active,.typhoon-btn.active,.weather-btn.active,.lodging-btn.active,.demo-btn.active{background:#dbeafe;color:#1d4ed8}.icon-tip{position:absolute;right:calc(100% + 10px);top:50%;z-index:2;padding:5px 8px;border-radius:6px;background:#0f172a;box-shadow:0 4px 12px rgba(15,23,42,.24);color:#fff;font-size:12px;font-weight:600;line-height:1.2;white-space:nowrap;opacity:0;pointer-events:none;transform:translate(4px,-50%);transition:opacity 120ms,transform 160ms}.icon-btn:hover .icon-tip,.icon-btn:focus-visible .icon-tip,.icon-btn:disabled:hover .icon-tip{opacity:1;transform:translate(0,-50%)}.active .icon-tip{display:none}.tool-entry .icon-tip{display:none}.tool-menu{position:absolute;right:calc(100% + 10px);top:50%;transform:translateY(-50%);width:max-content;min-width:110px;display:grid;gap:2px;padding:4px;border:1px solid rgba(148,163,184,.34);border-radius:10px;background:rgba(248,250,252,.98);box-shadow:0 8px 24px rgba(15,23,42,.2),0 1px 2px rgba(15,23,42,.12);backdrop-filter:blur(8px)}.menu-action{height:36px;display:flex;align-items:center;gap:8px;padding:0 8px;border:0;border-radius:7px;background:transparent;color:#334155;font:inherit;font-size:13px;font-weight:600;cursor:pointer}.menu-action>svg{width:17px;height:17px;flex:none}.menu-action:hover:not(:disabled),.menu-action.selected{background:#eff6ff;color:#1d4ed8}.menu-action.selected{box-shadow:inset 3px 0 #2563eb}.menu-action:disabled{cursor:not-allowed;color:#94a3b8;opacity:.68}.tool-menu-enter-active{transition:opacity 140ms,transform 180ms}.tool-menu-leave-active{transition:opacity 100ms,transform 120ms}.tool-menu-enter-from,.tool-menu-leave-to{opacity:0;transform:translate(6px,-50%)}
.menu-divider{height:1px;margin:4px 8px;background:#e2e8f0}
.menu-toggle{display:flex;align-items:center;justify-content:space-between;padding:8px 10px;cursor:pointer;gap:8px}
.toggle-label{font-size:12px;color:#475569;font-weight:500}
.toggle-switch{position:relative;width:36px;height:20px;background:#cbd5e1;border-radius:10px;transition:background 0.2s;flex-shrink:0}
.toggle-switch::after{content:'';position:absolute;top:2px;left:2px;width:16px;height:16px;background:#fff;border-radius:50%;transition:transform 0.2s;box-shadow:0 1px 3px rgba(0,0,0,0.2)}
.menu-toggle input{display:none}
.menu-toggle input:checked + .toggle-switch{background:#3b82f6}
.menu-toggle input:checked + .toggle-switch::after{transform:translateX(16px)}
.exit-action{color:#dc2626!important}
.exit-action:hover:not(:disabled){background:#fef2f2!important;color:#dc2626!important}
@media(prefers-reduced-motion:reduce){.icon-btn,.menu-action,.icon-tip,.tool-menu-enter-active,.tool-menu-leave-active{transition:none}}
</style>
