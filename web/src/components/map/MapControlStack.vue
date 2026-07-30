<template>
  <div class="ctrl-stack">
    <button
      class="icon-btn"
      :title="basemap === 'img' ? '底图：卫星（点击切换矢量）' : '底图：矢量（点击切换卫星）'"
      @click="emit('switch-basemap', basemap === 'img' ? 'vec' : 'img')"
    >
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
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
      @click="emit('toggle-rs')"
    >
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
        <circle cx="12" cy="12" r="3" />
        <line v-if="!rsOn" x1="3" y1="3" x2="21" y2="21" />
      </svg>
    </button>
    <button
      v-if="parcelVisible"
      class="icon-btn parcel-btn"
      :class="{ off: !parcelOn }"
      :disabled="mode !== 'idle'"
      :title="mode !== 'idle' ? '操作地块时不能关闭图层' : (parcelOn ? '地块：开（点击关闭）' : '地块：关（点击打开）')"
      @click="emit('toggle-parcels')"
    >
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
        <path d="m3 4 7-1 3 6-2 11-8 1z" />
        <path d="m10 3 8 2 3 6-4 9-6-1" />
        <path d="m13 9 8 2" />
        <path d="m4 14 8-2" />
      </svg>
    </button>
  </div>

  <div class="zoom-stack" aria-label="地图缩放工具">
    <button class="icon-btn" :disabled="!canZoomIn" title="放大" aria-label="放大" @click="emit('zoom-in')">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true">
        <path d="M5 12h14M12 5v14" />
      </svg>
    </button>
    <button class="icon-btn" :disabled="!canZoomOut" title="缩小" aria-label="缩小" @click="emit('zoom-out')">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true">
        <path d="M5 12h14" />
      </svg>
    </button>
  </div>
</template>

<script setup lang="ts">
import type { ParcelMode } from '../../features/parcels/parcelTypes'

defineProps<{
  basemap: 'img' | 'vec'
  rsVisible: boolean
  rsOn: boolean
  parcelVisible: boolean
  parcelOn: boolean
  mode: ParcelMode
  canZoomIn: boolean
  canZoomOut: boolean
}>()

const emit = defineEmits<{
  'switch-basemap': [type: 'img' | 'vec']
  'toggle-rs': []
  'toggle-parcels': []
  'zoom-in': []
  'zoom-out': []
}>()
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
</style>
