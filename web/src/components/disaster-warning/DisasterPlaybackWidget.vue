<template>
  <div class="dw-playback" role="region" aria-label="受灾预警播放控制" data-test="dw-playback">
    <button type="button" class="play-button" :class="{ playing }" :aria-label="playing ? '暂停播放' : '播放'" :title="playing ? '暂停' : '播放'" data-test="dw-play-toggle" @click="emit('toggle-play')">
      <svg v-if="!playing" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M8 5v14l11-7z" /></svg>
      <svg v-else viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M7 5h4v14H7zM13 5h4v14h-4z" /></svg>
    </button>
    <span class="node-time" data-test="dw-node-time">{{ nodeTimeLabel || '—' }}</span>
    <span class="node-index">{{ nodeIndex + 1 }}/{{ nodeCount }}</span>
    <button type="button" class="close-button" aria-label="退出受灾预警" title="退出受灾预警" data-test="dw-playback-close" @click="emit('close')">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6 6 18" /></svg>
    </button>
  </div>
</template>

<script setup lang="ts">
defineProps<{
  playing: boolean
  nodeIndex: number
  nodeCount: number
  nodeTimeLabel: string
}>()
const emit = defineEmits<{ 'toggle-play': []; close: [] }>()
</script>

<style scoped>
.dw-playback {
  position: absolute; left: 50%; bottom: 18px; transform: translateX(-50%); z-index: 1015;
  display: flex; align-items: center; gap: 10px;
  padding: 8px 14px;
  border: 1px solid rgba(148, 163, 184, 0.34); border-radius: 999px;
  background: rgba(248, 250, 252, 0.96);
  box-shadow: 0 6px 20px rgba(15, 23, 42, 0.18), 0 1px 2px rgba(15, 23, 42, 0.12);
  backdrop-filter: blur(8px);
  color: #0f172a; font-size: 12px;
}
.play-button {
  width: 28px; height: 28px; flex: none; display: grid; place-items: center; padding: 0; border: 0; border-radius: 50%;
  background: #2563eb; color: #fff; cursor: pointer;
}
.play-button:hover { background: #1d4ed8; }
.play-button svg { width: 14px; height: 14px; }
.node-time { font-weight: 700; color: #0f172a; font-variant-numeric: tabular-nums; min-width: 74px; text-align: center; }
.node-index { color: #94a3b8; font-size: 11px; font-variant-numeric: tabular-nums; }
.close-button {
  width: 26px; height: 26px; flex: none; display: grid; place-items: center; padding: 0; border: 0; border-radius: 50%;
  background: #e2e8f0; color: #334155; cursor: pointer;
}
.close-button:hover { background: #cbd5e1; }
.close-button svg { width: 13px; height: 13px; }
</style>
