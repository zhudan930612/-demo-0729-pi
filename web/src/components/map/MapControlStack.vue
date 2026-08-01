<template>
  <div ref="controlStackRef" class="ctrl-stack">
    <div class="tool-entry">
      <button
        ref="disasterButtonRef" type="button" class="icon-btn disaster-btn" :class="{ active: disasterMenuOpen || disasterActive }"
        :disabled="disasterEntryDisabled || disasterActive"
        :title="disasterTip" :aria-label="disasterTip" aria-haspopup="menu" :aria-expanded="disasterMenuOpen" aria-controls="disaster-tool-menu"
        @click="toggleDisasterMenu"
      >
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 18c4-1 5-5 8-8 2-2 4-3 8-4-1 4-2 6-4 8-3 3-7 4-8 8"/><path d="M5 6c3 1 5 3 6 6M3 10h5"/></svg>
        <span class="icon-tip" role="tooltip">{{ disasterTip }}</span>
      </button>
      <Transition name="tool-menu">
        <div v-if="disasterMenuOpen" id="disaster-tool-menu" class="tool-menu" role="menu" aria-label="选择灾害风险查看项">
          <button type="button" class="menu-action" role="menuitem" @click="chooseTyphoon"><span class="menu-icon" aria-hidden="true">台</span><span>查看台风</span></button>
          <button type="button" class="menu-action" role="menuitem" disabled title="查看天气为预留功能，本期暂不实现"><span class="menu-icon" aria-hidden="true">云</span><span>查看天气</span><small>预留</small></button>
        </div>
      </Transition>
    </div>

    <div v-if="parcelToolsVisible" class="tool-entry">
      <button
        ref="parcelToolButtonRef" type="button" class="icon-btn parcel-tool-btn" :class="{ active: parcelMenuOpen }"
        :disabled="parcelToolsDisabled" :title="parcelTip" :aria-label="parcelTip"
        aria-haspopup="menu" :aria-expanded="parcelMenuOpen" aria-controls="parcel-tool-menu" @click="toggleParcelMenu"
      >
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m3 5 7-2 5 5-2 10-8 2-2-8Z"/><path d="M17 13h4M19 11v4"/></svg>
        <span class="icon-tip" role="tooltip">{{ parcelTip }}</span>
      </button>
      <Transition name="tool-menu">
        <div v-if="parcelMenuOpen" id="parcel-tool-menu" class="tool-menu" role="menu" aria-label="选择地块操作">
          <button type="button" class="menu-action" role="menuitem" @click="chooseParcelMode('manual')"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m4 5 7-2 5 5-2 10-9 2-2-8Z"/><path d="M18 13v8M14 17h8"/></svg><span>新增地块</span></button>
          <button type="button" class="menu-action" role="menuitem" :disabled="!parcelOn || !hasFilterableParcels" :title="!parcelOn ? '请先打开地块图层' : (hasFilterableParcels ? '筛选地块' : '当前村没有可筛选的地块')" @click="chooseParcelMode('filter')"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 5h16l-6.5 7.2V19l-3 1.5v-8.3Z"/></svg><span>筛选地块</span></button>
        </div>
      </Transition>
    </div>

    <button type="button" class="icon-btn" :aria-label="basemap === 'img' ? '底图：卫星（点击切换矢量）' : '底图：矢量（点击切换卫星）'" @click="emit('switch-basemap', basemap === 'img' ? 'vec' : 'img')">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 2 2 7l10 5 10-5-10-5z"/><path d="m2 17 10 5 10-5"/><path d="m2 12 10 5 10-5"/></svg><span class="icon-tip" role="tooltip">{{ basemap === 'img' ? '切换为矢量底图' : '切换为卫星底图' }}</span>
    </button>
    <button v-if="rsVisible" type="button" class="icon-btn" :class="{ off: !rsOn }" :aria-label="rsOn ? '关闭高分影像' : '打开高分影像'" @click="emit('toggle-rs')">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/><line v-if="!rsOn" x1="3" y1="3" x2="21" y2="21"/></svg><span class="icon-tip" role="tooltip">{{ rsOn ? '关闭高分影像' : '打开高分影像' }}</span>
    </button>
    <button v-if="parcelVisible" type="button" class="icon-btn parcel-btn" :class="{ off: !parcelOn }" :disabled="parcelToolsDisabled" :aria-label="parcelToolsDisabled ? parcelTip : (parcelOn ? '关闭地块图层' : '打开地块图层')" @click="emit('toggle-parcels')">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m3 4 7-1 3 6-2 11-8 1z"/><path d="m10 3 8 2 3 6-4 9-6-1"/><path d="m13 9 8 2"/><path d="m4 14 8-2"/></svg><span class="icon-tip" role="tooltip">{{ parcelToolsDisabled ? parcelTip : (parcelOn ? '关闭地块图层' : '打开地块图层') }}</span>
    </button>
  </div>
  <div class="zoom-stack" aria-label="地图缩放工具">
    <button type="button" class="icon-btn" :disabled="!canZoomIn" title="放大" aria-label="放大" @click="emit('zoom-in')"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M5 12h14M12 5v14"/></svg></button>
    <button type="button" class="icon-btn" :disabled="!canZoomOut" title="缩小" aria-label="缩小" @click="emit('zoom-out')"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M5 12h14"/></svg></button>
  </div>
</template>

<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, ref, watch } from 'vue'
import type { ParcelMode } from '../../features/parcels/parcelTypes'
const props = defineProps<{ basemap:'img'|'vec'; rsVisible:boolean; rsOn:boolean; parcelVisible:boolean; parcelOn:boolean; mode:ParcelMode; canZoomIn:boolean; canZoomOut:boolean; parcelToolsVisible:boolean; parcelToolsDisabled:boolean; hasFilterableParcels:boolean; disasterEntryDisabled:boolean; disasterActive:boolean }>()
const emit = defineEmits<{ 'switch-basemap':[type:'img'|'vec']; 'toggle-rs':[]; 'toggle-parcels':[]; 'start-manual':[]; 'start-filter':[]; 'open-typhoon':[]; 'zoom-in':[]; 'zoom-out':[] }>()
const controlStackRef=ref<HTMLElement|null>(null), parcelToolButtonRef=ref<HTMLButtonElement|null>(null), disasterButtonRef=ref<HTMLButtonElement|null>(null)
const parcelMenuOpen=ref(false), disasterMenuOpen=ref(false)
const disasterTip=computed(()=>props.disasterActive?'灾害风险模式已开启':props.disasterEntryDisabled?'请先保存或取消当前未完成操作':'灾害风险')
const parcelTip=computed(()=>props.disasterActive?'灾害风险模式下不能使用地块工具':props.mode!=='idle'?'操作地块时不能切换工具':'地块工具')
function closeMenus(){parcelMenuOpen.value=false;disasterMenuOpen.value=false}
function toggleDisasterMenu(){if(props.disasterEntryDisabled||props.disasterActive)return;parcelMenuOpen.value=false;disasterMenuOpen.value=!disasterMenuOpen.value}
function toggleParcelMenu(){if(props.parcelToolsDisabled)return;disasterMenuOpen.value=false;parcelMenuOpen.value=!parcelMenuOpen.value}
function chooseTyphoon(){disasterMenuOpen.value=false;emit('open-typhoon')}
function chooseParcelMode(mode:'manual'|'filter'){parcelMenuOpen.value=false;if(mode==='manual')emit('start-manual');else emit('start-filter')}
function closeOnOutside(event:PointerEvent){if((parcelMenuOpen.value||disasterMenuOpen.value)&&!controlStackRef.value?.contains(event.target as Node))closeMenus()}
function onKeydown(event:KeyboardEvent){if(event.key!=='Escape'||(!parcelMenuOpen.value&&!disasterMenuOpen.value))return;event.preventDefault();event.stopImmediatePropagation();const focus=parcelMenuOpen.value?parcelToolButtonRef.value:disasterButtonRef.value;closeMenus();void nextTick(()=>focus?.focus())}
watch(()=>[props.parcelToolsVisible,props.parcelToolsDisabled,props.disasterEntryDisabled,props.disasterActive] as const,()=>{if(!props.parcelToolsVisible||props.parcelToolsDisabled)parcelMenuOpen.value=false;if(props.disasterEntryDisabled||props.disasterActive)disasterMenuOpen.value=false})
document.addEventListener('pointerdown',closeOnOutside);window.addEventListener('keydown',onKeydown,true)
onBeforeUnmount(()=>{document.removeEventListener('pointerdown',closeOnOutside);window.removeEventListener('keydown',onKeydown,true)})
</script>

<style scoped>
.ctrl-stack,.zoom-stack{position:absolute;right:10px;z-index:1000;display:flex;flex-direction:column;gap:2px;padding:4px;border:1px solid rgba(148,163,184,.34);border-radius:10px;background:rgba(248,250,252,.96);box-shadow:0 6px 20px rgba(15,23,42,.18),0 1px 2px rgba(15,23,42,.12);backdrop-filter:blur(8px)}.ctrl-stack{bottom:116px}.zoom-stack{bottom:24px}.icon-btn{position:relative;width:36px;height:36px;display:flex;align-items:center;justify-content:center;padding:0;border:0;border-radius:7px;background:transparent;color:#475569;cursor:pointer;transition:background-color 160ms,color 160ms,box-shadow 160ms}.tool-entry,.ctrl-stack>*+*,.zoom-stack .icon-btn+.icon-btn{position:relative}.ctrl-stack>*+*::before,.zoom-stack .icon-btn+.icon-btn::before{content:'';position:absolute;top:-1px;left:7px;right:7px;height:1px;background:#e2e8f0}.icon-btn svg{width:18px;height:18px}.icon-btn:hover:not(:disabled){background:#e2e8f0;color:#0f172a}.icon-btn:focus-visible,.menu-action:focus-visible{outline:3px solid rgba(37,99,235,.28);outline-offset:2px}.icon-btn:disabled{cursor:not-allowed;color:#94a3b8}.icon-btn:disabled svg{opacity:.38}.icon-btn.off{color:#94a3b8}.parcel-btn:not(.off){background:#eff6ff;color:#2563eb}.parcel-tool-btn.active,.disaster-btn.active{background:#dbeafe;color:#1d4ed8}.icon-tip{position:absolute;right:calc(100% + 10px);top:50%;z-index:2;padding:5px 8px;border-radius:6px;background:#0f172a;box-shadow:0 4px 12px rgba(15,23,42,.24);color:#fff;font-size:12px;font-weight:600;line-height:1.2;white-space:nowrap;opacity:0;pointer-events:none;transform:translate(4px,-50%);transition:opacity 120ms,transform 160ms}.icon-btn:hover .icon-tip,.icon-btn:focus-visible .icon-tip,.icon-btn:disabled:hover .icon-tip{opacity:1;transform:translate(0,-50%)}.active .icon-tip{display:none}.tool-menu{position:absolute;right:calc(100% + 10px);top:0;width:max-content;min-width:132px;display:grid;gap:2px;padding:4px;border:1px solid rgba(148,163,184,.34);border-radius:10px;background:rgba(248,250,252,.98);box-shadow:0 8px 24px rgba(15,23,42,.2),0 1px 2px rgba(15,23,42,.12);backdrop-filter:blur(8px)}.menu-action{height:36px;display:flex;align-items:center;gap:8px;padding:0 8px;border:0;border-radius:7px;background:transparent;color:#334155;font:inherit;font-size:13px;font-weight:600;cursor:pointer}.menu-action>svg{width:17px;height:17px;flex:none}.menu-action:hover:not(:disabled){background:#e2e8f0;color:#0f172a}.menu-action:disabled{cursor:not-allowed;color:#94a3b8;opacity:.68}.menu-action small{margin-left:auto;padding:1px 4px;border:1px solid #cbd5e1;border-radius:4px;font-size:9px}.menu-icon{width:19px;height:19px;display:grid;place-items:center;border:1px solid currentColor;border-radius:5px;font-size:10px}.tool-menu-enter-active{transition:opacity 140ms,transform 180ms}.tool-menu-leave-active{transition:opacity 100ms,transform 120ms}.tool-menu-enter-from,.tool-menu-leave-to{opacity:0;transform:translateX(6px)}
@media(prefers-reduced-motion:reduce){.icon-btn,.menu-action,.icon-tip,.tool-menu-enter-active,.tool-menu-leave-active{transition:none}}
</style>
