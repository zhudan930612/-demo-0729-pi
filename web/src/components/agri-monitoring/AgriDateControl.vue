<template>
  <aside class="agri-date-control" aria-labelledby="agri-date-title" role="region">
    <header class="date-header">
      <div class="date-title"><span class="title-mark" aria-hidden="true"></span><h2 id="agri-date-title">长势监测·时序</h2><span v-if="phase === 'loading'" class="loading-hint" role="status" aria-live="polite">加载中…</span></div>
      <div class="header-actions">
        <div class="opacity-inline">
          <input id="agri-opacity" type="range" min="0" max="100" :value="Math.round(opacity * 100)" :style="opacityTrackStyle" aria-label="色斑可见度" title="色斑可见度" @input="onOpacity" />
        </div>
        <button type="button" class="icon-button" :disabled="phase === 'loading'" title="刷新农情数据" aria-label="刷新农情数据" @click="emit('refresh')">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21 12a9 9 0 1 1-2.6-6.4" /><path d="M21 3v6h-6" /></svg>
        </button>
        <button type="button" class="icon-button close-button" aria-label="退出农情监测" title="退出农情监测" @click="emit('close')">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6 6 18" /></svg>
        </button>
      </div>
    </header>

    <div v-if="errorMessage && phase !== 'ready'" class="status error" role="status" aria-live="polite">农情数据暂不可用{{ errorMessage ? `（${errorMessage}）` : '' }}</div>

    <template v-if="ready">
      <div class="timeline-row">
        <button type="button" class="play-button" :class="{ playing }" :aria-label="playing ? '暂停逐期播放' : '播放逐期动画'" @click="emit('toggle-play')">
          <svg v-if="!playing" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M8 5v14l11-7z" /></svg>
          <svg v-else viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M7 5h4v14H7zM13 5h4v14h-4z" /></svg>
          <span>{{ playing ? '暂停' : '播放' }}</span>
        </button>
        <div class="timeline" role="group" aria-label="长势日期时间轴">
          <button v-for="(day, index) in days" :key="day" type="button" class="day-node" :class="{ active: index === selectedDate }" :aria-pressed="index === selectedDate" :title="dayLabel(index)" @click="emit('select-date', index)">
            <span class="day-node-dot" aria-hidden="true"></span>
            <span class="day-node-text">{{ dayShort(index) }}</span>
          </button>
        </div>
      </div>
      <footer class="date-footer">
        <span class="metric-label">当前{{ currentLabel }}</span>
        <span class="attribution">长势指数 NDVI · 百米级栅格 @ 演示数据</span>
      </footer>
    </template>
    <template v-else-if="phase === 'loading'">
      <div class="timeline-row" aria-hidden="true">
        <span class="play-button skeleton"></span>
        <div class="timeline"><span v-for="i in 8" :key="i" class="day-node skeleton"></span></div>
      </div>
    </template>
  </aside>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import type { AgriPhase } from '../../stores/agriMonitoring'

const props = defineProps<{
  phase: AgriPhase
  dates: string[]
  selectedDate: number
  playing: boolean
  opacity: number
  errorMessage: string
}>()
const emit = defineEmits<{ close: []; 'select-date': [index: number]; 'toggle-play': []; 'set-opacity': [value: number]; refresh: [] }>()

const ready = computed(() => props.phase === 'ready' && props.dates.length > 0)
const days = computed(() => props.dates)
const currentLabel = computed(() => {
  const d = days.value[props.selectedDate]
  return d ? `日期 ${d}` : '最近一期'
})
const opacityTrackStyle = computed(() => {
  const pct = Math.round(props.opacity * 100)
  return { background: `linear-gradient(to right, #2563eb ${pct}%, #d3dce7 ${pct}%)` }
})

function parseDay(raw: string): Date {
  const [y, m, d] = raw.split('-').map(Number)
  return new Date(y, (m ?? 1) - 1, d ?? 1)
}
const dayShort = (index: number) => { const date = parseDay(days.value[index] ?? ''); return Number.isNaN(date.getTime()) ? `第${index + 1}期` : `${date.getMonth() + 1}/${date.getDate()}` }
const dayLabel = (index: number) => { const date = parseDay(days.value[index] ?? ''); return Number.isNaN(date.getTime()) ? '' : `${date.getFullYear()}-${date.getMonth() + 1}-${date.getDate()}` }

function onOpacity(event: Event) {
  const value = Number((event.target as HTMLInputElement).value)
  emit('set-opacity', value / 100)
}
</script>

<style scoped>
.agri-date-control {
  position: absolute; left: 50%; bottom: 12px; transform: translateX(-50%);
  z-index: 1010; width: min(520px, calc(100% - 20px)); min-height: 92px; box-sizing: border-box;
  display: flex; flex-direction: column; gap: 7px; padding: 8px 12px 8px;
  border: 1px solid rgba(37, 99, 235, 0.55); border-radius: 10px;
  background: rgba(248, 250, 252, 0.96); box-shadow: 0 7px 22px rgba(15, 23, 42, 0.24);
  color: #0f172a; font-size: 12px;
}
.date-header { display: flex; align-items: center; justify-content: space-between; gap: 8px; }
.date-title { display: flex; align-items: center; gap: 7px; }
.title-mark { width: 3px; height: 13px; border-radius: 2px; background: #2563eb; }
.date-header h2 { margin: 0; font-size: 12px; line-height: 1; font-weight: 600; }
.header-actions { display: flex; align-items: center; gap: 2px; }
.opacity-inline { display: flex; align-items: center; margin-right: 8px; }
.opacity-inline input[type='range'] { -webkit-appearance: none; appearance: none; width: 72px; height: 3px; margin: 0; border-radius: 2px; cursor: pointer; }
.opacity-inline input[type='range']::-webkit-slider-runnable-track { height: 3px; background: transparent; }
.opacity-inline input[type='range']::-webkit-slider-thumb { -webkit-appearance: none; width: 10px; height: 10px; margin-top: -3.5px; border-radius: 50%; background: #2563eb; border: 1.5px solid #fff; box-shadow: 0 1px 3px rgba(15,23,42,0.3); }
.icon-button { width: 20px; height: 20px; display: grid; place-items: center; padding: 0; border: 0; border-radius: 5px; background: transparent; color: #64748b; cursor: pointer; }
.icon-button:hover { background: #e2e8f0; }
.icon-button:disabled { opacity: 0.5; cursor: default; }
.icon-button svg { width: 12px; height: 12px; }
.icon-button.off { color: #94a3b8; }
.status { margin: 0; padding: 4px 8px; border-radius: 6px; background: #fff; color: #475569; font-size: 11px; }
.status.error { color: #b91c1c; }
.timeline-row { display: flex; align-items: center; gap: 10px; }
.play-button { display: inline-flex; align-items: center; gap: 4px; padding: 3px 9px; border: 1px solid rgba(148,163,184,0.34); border-radius: 6px; background: #fff; color: #334155; cursor: pointer; font-size: 11px; }
.play-button:hover { background: #e2e8f0; }
.play-button svg { width: 10px; height: 10px; }
.play-button.playing { color: #1d4ed8; border-color: rgba(37,99,235,0.5); background: #eff6ff; }
.timeline { flex: 1; min-width: 0; display: flex; align-items: flex-end; overflow-x: auto; scrollbar-width: none; padding: 0 2px; }
.timeline::-webkit-scrollbar { display: none; }
.day-node { position: relative; flex: 1 1 0; min-width: 0; display: flex; flex-direction: column; align-items: center; gap: 4px; padding: 2px 0 2px; border: 0; border-radius: 6px; background: transparent; color: #64748b; cursor: pointer; }
.day-node:not(:first-child)::before { content: ''; position: absolute; top: 5.5px; right: calc(50% + 6px); left: calc(-50% + 6px); height: 1px; background: #cbd5e1; }
.day-node:hover { background: #eef2f7; }
.day-node-dot { position: relative; z-index: 1; width: 8px; height: 8px; border-radius: 50%; background: #cbd5e1; transform: scale(0.65); transition: transform 0.12s ease, background 0.12s ease; }
.day-node-text { font-size: 10px; line-height: 1; white-space: nowrap; }
.day-node.active .day-node-dot { transform: scale(1); background: #2563eb; box-shadow: 0 0 0 2px rgba(37,99,235,0.18); }
.day-node.active .day-node-text { color: #1d4ed8; font-weight: 600; }
.loading-hint { font-size: 10px; color: #94a3b8; font-weight: 400; }
.skeleton { background: #e8edf3 !important; }
.timeline-row .skeleton.play-button { border-color: transparent; }
.day-node.skeleton { pointer-events: none; }
.date-footer { display: flex; align-items: center; gap: 8px; border-top: 1px solid rgba(148,163,184,0.25); padding-top: 4px; font-size: 9.5px; color: #334155; white-space: nowrap; overflow: hidden; }
.date-footer .metric-label { font-weight: 600; color: #0f172a; }
.date-footer .attribution { color: #334155; }
@media (max-width: 560px) { .agri-date-control { width: calc(100% - 12px); bottom: 8px; } }
</style>
