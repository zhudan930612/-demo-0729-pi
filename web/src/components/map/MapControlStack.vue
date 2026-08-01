<template>
  <div ref="controlStackRef" class="ctrl-stack">
    <div v-if="parcelToolsVisible" class="parcel-tool-entry">
      <button
        ref="parcelToolButtonRef"
        type="button"
        class="icon-btn parcel-tool-btn"
        :class="{ active: parcelMenuOpen }"
        :disabled="mode !== 'idle'"
        :aria-label="mode !== 'idle' ? '操作地块时不能切换工具' : '地块工具'"
        aria-haspopup="menu"
        :aria-expanded="parcelMenuOpen"
        aria-controls="parcel-tool-menu"
        @click="toggleParcelMenu"
      >
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
          <path d="m3 5 7-2 5 5-2 10-8 2-2-8Z" />
          <path d="M17 13h4M19 11v4" />
        </svg>
        <span class="icon-tip" role="tooltip">{{ mode !== 'idle' ? '操作地块时不能切换工具' : '地块工具' }}</span>
      </button>

      <Transition name="parcel-menu">
        <div v-if="parcelMenuOpen" id="parcel-tool-menu" class="parcel-tool-menu" role="menu" aria-label="选择地块操作">
          <button type="button" class="parcel-menu-action" role="menuitem" @click="chooseParcelMode('manual')">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
              <path d="m4 5 7-2 5 5-2 10-9 2-2-8Z" /><path d="M18 13v8M14 17h8" />
            </svg>
            <span>新增地块</span>
          </button>
          <button
            type="button"
            class="parcel-menu-action"
            role="menuitem"
            :disabled="!parcelOn || !hasFilterableParcels"
            :title="!parcelOn ? '请先打开地块图层' : (hasFilterableParcels ? '筛选地块' : '当前村没有可筛选的地块')"
            @click="chooseParcelMode('filter')"
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
              <path d="M4 5h16l-6.5 7.2V19l-3 1.5v-8.3Z" />
            </svg>
            <span>筛选地块</span>
          </button>
        </div>
      </Transition>
    </div>

    <button
      type="button"
      class="icon-btn"
      :aria-label="basemap === 'img' ? '底图：卫星（点击切换矢量）' : '底图：矢量（点击切换卫星）'"
      @click="emit('switch-basemap', basemap === 'img' ? 'vec' : 'img')"
    >
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
        <path d="M12 2 2 7l10 5 10-5-10-5z" />
        <path d="m2 17 10 5 10-5" />
        <path d="m2 12 10 5 10-5" />
      </svg>
      <span class="icon-tip" role="tooltip">{{ basemap === 'img' ? '切换为矢量底图' : '切换为卫星底图' }}</span>
    </button>
    <button
      v-if="rsVisible"
      type="button"
      class="icon-btn"
      :class="{ off: !rsOn }"
      :aria-label="rsOn ? '关闭高分影像' : '打开高分影像'"
      @click="emit('toggle-rs')"
    >
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
        <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
        <circle cx="12" cy="12" r="3" />
        <line v-if="!rsOn" x1="3" y1="3" x2="21" y2="21" />
      </svg>
      <span class="icon-tip" role="tooltip">{{ rsOn ? '关闭高分影像' : '打开高分影像' }}</span>
    </button>
    <button
      v-if="parcelVisible"
      type="button"
      class="icon-btn parcel-btn"
      :class="{ off: !parcelOn }"
      :disabled="mode !== 'idle'"
      :aria-label="mode !== 'idle' ? '操作地块时不能关闭图层' : (parcelOn ? '关闭地块图层' : '打开地块图层')"
      @click="emit('toggle-parcels')"
    >
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
        <path d="m3 4 7-1 3 6-2 11-8 1z" />
        <path d="m10 3 8 2 3 6-4 9-6-1" />
        <path d="m13 9 8 2" />
        <path d="m4 14 8-2" />
      </svg>
      <span class="icon-tip" role="tooltip">{{ mode !== 'idle' ? '操作地块时不能关闭图层' : (parcelOn ? '关闭地块图层' : '打开地块图层') }}</span>
    </button>
  </div>

  <div class="zoom-stack" aria-label="地图缩放工具">
    <button type="button" class="icon-btn" :disabled="!canZoomIn" title="放大" aria-label="放大" @click="emit('zoom-in')">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true">
        <path d="M5 12h14M12 5v14" />
      </svg>
    </button>
    <button type="button" class="icon-btn" :disabled="!canZoomOut" title="缩小" aria-label="缩小" @click="emit('zoom-out')">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true">
        <path d="M5 12h14" />
      </svg>
    </button>
  </div>
</template>

<script setup lang="ts">
import { nextTick, onBeforeUnmount, ref, watch } from 'vue'
import type { ParcelMode } from '../../features/parcels/parcelTypes'

const props = defineProps<{
  basemap: 'img' | 'vec'
  rsVisible: boolean
  rsOn: boolean
  parcelVisible: boolean
  parcelOn: boolean
  mode: ParcelMode
  canZoomIn: boolean
  canZoomOut: boolean
  parcelToolsVisible: boolean
  hasFilterableParcels: boolean
}>()

const emit = defineEmits<{
  'switch-basemap': [type: 'img' | 'vec']
  'toggle-rs': []
  'toggle-parcels': []
  'start-manual': []
  'start-filter': []
  'zoom-in': []
  'zoom-out': []
}>()

const controlStackRef = ref<HTMLElement | null>(null)
const parcelToolButtonRef = ref<HTMLButtonElement | null>(null)
const parcelMenuOpen = ref(false)

function toggleParcelMenu() {
  if (props.mode !== 'idle') return
  parcelMenuOpen.value = !parcelMenuOpen.value
}

function chooseParcelMode(nextMode: 'manual' | 'filter') {
  parcelMenuOpen.value = false
  if (nextMode === 'manual') emit('start-manual')
  else emit('start-filter')
}

function closeParcelMenu(event: PointerEvent) {
  if (!parcelMenuOpen.value || controlStackRef.value?.contains(event.target as Node)) return
  parcelMenuOpen.value = false
}

function onKeydown(event: KeyboardEvent) {
  if (event.key !== 'Escape' || !parcelMenuOpen.value) return
  event.preventDefault()
  event.stopImmediatePropagation()
  parcelMenuOpen.value = false
  void nextTick(() => parcelToolButtonRef.value?.focus())
}

watch([() => props.parcelToolsVisible, () => props.mode], ([visible, mode]) => {
  if (!visible || mode !== 'idle') parcelMenuOpen.value = false
})

document.addEventListener('pointerdown', closeParcelMenu)
window.addEventListener('keydown', onKeydown, true)

onBeforeUnmount(() => {
  document.removeEventListener('pointerdown', closeParcelMenu)
  window.removeEventListener('keydown', onKeydown, true)
})
</script>

<style scoped>
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
  position: relative;
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
.parcel-tool-entry,
.ctrl-stack > * + *,
.zoom-stack .icon-btn + .icon-btn { position: relative; }
.ctrl-stack > * + *::before,
.zoom-stack .icon-btn + .icon-btn::before {
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
.icon-btn:focus-visible,
.parcel-menu-action:focus-visible { outline: 3px solid rgba(37, 99, 235, 0.28); outline-offset: 2px; }
.icon-btn:disabled { cursor: not-allowed; color: #94a3b8; }
.icon-btn:disabled svg { opacity: 0.38; }
.icon-btn.off { color: #94a3b8; }
.icon-btn.off:hover:not(:disabled) { background: #f1f5f9; color: #64748b; }
.parcel-btn:not(.off) { background: #eff6ff; color: #2563eb; }
.parcel-btn:not(.off):hover:not(:disabled) { background: #dbeafe; color: #1d4ed8; }
.parcel-tool-btn.active { background: #dbeafe; color: #1d4ed8; }
.icon-tip {
  position: absolute;
  right: calc(100% + 10px);
  top: 50%;
  z-index: 2;
  padding: 5px 8px;
  border-radius: 6px;
  background: #0f172a;
  box-shadow: 0 4px 12px rgba(15, 23, 42, 0.24);
  color: #fff;
  font-size: 12px;
  font-weight: 600;
  line-height: 1.2;
  white-space: nowrap;
  opacity: 0;
  pointer-events: none;
  transform: translate(4px, -50%);
  transition: opacity 120ms ease, transform 160ms cubic-bezier(0.22, 1, 0.36, 1);
}
.icon-btn:hover .icon-tip,
.icon-btn:focus-visible .icon-tip {
  opacity: 1;
  transform: translate(0, -50%);
}
.parcel-tool-btn.active .icon-tip { display: none; }
.parcel-tool-menu {
  position: absolute;
  right: calc(100% + 10px);
  top: 0;
  width: max-content;
  min-width: 116px;
  display: grid;
  gap: 2px;
  padding: 4px;
  border: 1px solid rgba(148, 163, 184, 0.34);
  border-radius: 10px;
  background: rgba(248, 250, 252, 0.98);
  box-shadow: 0 8px 24px rgba(15, 23, 42, 0.2), 0 1px 2px rgba(15, 23, 42, 0.12);
  backdrop-filter: blur(8px);
}
.parcel-menu-action {
  height: 36px;
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 0 8px;
  border: 0;
  border-radius: 7px;
  background: transparent;
  color: #334155;
  font: inherit;
  font-size: 13px;
  font-weight: 600;
  cursor: pointer;
  transition: background-color 160ms ease, color 160ms ease;
}
.parcel-menu-action svg { width: 17px; height: 17px; flex: none; }
.parcel-menu-action:hover:not(:disabled) { background: #e2e8f0; color: #0f172a; }
.parcel-menu-action:disabled { cursor: not-allowed; color: #94a3b8; opacity: 0.65; }
.parcel-menu-enter-active { transition: opacity 140ms ease, transform 180ms cubic-bezier(0.22, 1, 0.36, 1); }
.parcel-menu-leave-active { transition: opacity 100ms ease, transform 120ms ease; }
.parcel-menu-enter-from,
.parcel-menu-leave-to { opacity: 0; transform: translateX(6px); }

@media (prefers-reduced-motion: reduce) {
  .icon-btn,
  .parcel-menu-action,
  .icon-tip,
  .parcel-menu-enter-active,
  .parcel-menu-leave-active { transition: none; }
}
</style>
