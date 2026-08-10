<template>
  <aside class="precip-panel" aria-labelledby="precip-panel-title" role="region">
    <header class="panel-header">
      <h2 id="precip-panel-title">未来 7 天降水预报</h2>
      <div class="panel-header-actions">
        <button type="button" class="refresh-button" :disabled="refreshing" :title="refreshing ? '正在更新' : '刷新降水预报'" aria-label="刷新降水预报" @click="emit('refresh')">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21 12a9 9 0 1 1-2.6-6.4" /><path d="M21 3v6h-6" /></svg>
        </button>
        <button type="button" class="close-button" aria-label="退出降水查看" title="退出降水查看" @click="emit('close')">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6 6 18" /></svg>
        </button>
      </div>
    </header>

    <div v-if="showStale" class="transient-status stale" role="status" aria-live="polite">数据获取失败，显示上次成功数据（获取于 {{ snapshot?.updatedAt ?? '' }}）</div>
    <div v-if="errorMessage && !showStale" class="transient-status error" role="status" aria-live="polite">{{ errorMessage }}</div>
    <div v-if="refreshing" class="transient-status refreshing" role="status" aria-live="polite">正在更新…</div>

    <div v-if="ready" class="panel-body">
      <div class="timeline" role="group" aria-label="预报日期">
        <button
          v-for="(day, index) in days"
          :key="day"
          type="button"
          class="day-chip"
          :class="{ active: index === selectedDay }"
          :aria-pressed="index === selectedDay"
          :title="`${dayLabel(index)} 当日累计降雨量`"
          @click="emit('select-day', index)"
        >
          <b>{{ dayShort(index) }}</b>
          <span>{{ dayWeek(index) }}</span>
        </button>
      </div>

      <div class="controls-row">
        <button type="button" class="play-button" :aria-label="playing ? '暂停逐日播放' : '播放逐日动画'" @click="emit('toggle-play')">
          <svg v-if="!playing" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M8 5v14l11-7z" /></svg>
          <svg v-else viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M7 5h4v14H7zM13 5h4v14h-4z" /></svg>
          <span>{{ playing ? '暂停' : '播放' }}</span>
        </button>
        <div class="opacity-control">
          <label id="precip-opacity-label" for="precip-opacity">色斑可见度</label>
          <input id="precip-opacity" type="range" min="0" max="100" :value="Math.round(opacity * 100)" aria-labelledby="precip-opacity-label" @input="onOpacity" />
          <span class="opacity-value">{{ Math.round(opacity * 100) }}%</span>
        </div>
      </div>

      <div class="legend" aria-label="当日累计降雨量图例">
        <div class="legend-bar" aria-hidden="true">
          <span v-for="stop in legendStops" :key="stop.label" class="legend-swatch" :style="{ background: stop.color }"></span>
        </div>
        <div class="legend-labels" aria-hidden="true">
          <span v-for="stop in legendStops" :key="stop.label">{{ stop.label }}</span>
        </div>
      </div>
    </div>

    <div v-else-if="phase === 'loading'" class="transient-status" role="status" aria-live="polite">降水预报加载中…</div>
    <div v-else-if="phase === 'error'" class="transient-status error" role="status" aria-live="polite">降水预报暂不可用{{ errorMessage ? `（${errorMessage}）` : '' }}</div>

    <footer v-if="ready" class="panel-footer">
      <span>当日累计降雨量</span>
      <span class="attribution">降水预报数据 © Open-Meteo / ECMWF（0.25° 网格，约 25 km）</span>
      <span class="disclaimer">预报场仅供参考，不作定损依据</span>
    </footer>
  </aside>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import type { PrecipitationPhase } from '../../stores/precipitation'
import type { PrecipitationSnapshot } from '../../features/precipitation/precipitationTypes'

const props = defineProps<{
  phase: PrecipitationPhase
  snapshot: PrecipitationSnapshot | null
  selectedDay: number
  playing: boolean
  opacity: number
  errorMessage: string
  showStale: boolean
}>()
const emit = defineEmits<{ close: []; 'select-day': [index: number]; 'toggle-play': []; 'set-opacity': [value: number]; refresh: [] }>()

const ready = computed(() => props.phase === 'ready' && props.snapshot !== null)
const days = computed(() => props.snapshot?.days ?? [])
const refreshing = computed(() => props.phase === 'refreshing')

function parseDay(raw: string): Date {
  const [y, m, d] = raw.split('-').map(Number)
  return new Date(y, (m ?? 1) - 1, d ?? 1)
}
const dayShort = (index: number) => { const date = parseDay(days.value[index] ?? ''); return Number.isNaN(date.getTime()) ? `第${index + 1}天` : `${date.getMonth() + 1}/${date.getDate()}` }
const dayWeek = (index: number) => { const date = parseDay(days.value[index] ?? ''); return Number.isNaN(date.getTime()) ? '' : ['周日', '周一', '周二', '周三', '周四', '周五', '周六'][date.getDay()] }
const dayLabel = (index: number) => { const date = parseDay(days.value[index] ?? ''); return Number.isNaN(date.getTime()) ? '' : `${date.getFullYear()}-${date.getMonth() + 1}-${date.getDate()}` }


const legendStops = [
  { label: '无雨', color: 'transparent' },
  { label: '小雨', color: 'rgb(166,217,106)' },
  { label: '中雨', color: 'rgb(65,171,93)' },
  { label: '大雨', color: 'rgb(44,127,184)' },
  { label: '暴雨', color: 'rgb(31,82,160)' },
  { label: '大暴雨', color: 'rgb(117,42,131)' },
  { label: '特大暴雨', color: 'rgb(64,0,64)' },
]

function onOpacity(event: Event) {
  const value = Number((event.target as HTMLInputElement).value)
  emit('set-opacity', value / 100)
}
</script>

<style scoped>
.precip-panel {
  position: absolute;
  left: 50%;
  bottom: 14px;
  transform: translateX(-50%);
  z-index: 1010;
  width: min(720px, calc(100% - 24px));
  box-sizing: border-box;
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 10px 14px 12px;
  border: 1px solid rgba(148, 163, 184, 0.34);
  border-radius: 10px;
  background: rgba(248, 250, 252, 0.96);
  box-shadow: 0 7px 22px rgba(15, 23, 42, 0.24);
  color: #0f172a;
  font-size: 12px;
}
.panel-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
}
.panel-header h2 { margin: 0; font-size: 13px; line-height: 1; }
.panel-header-actions { display: flex; gap: 4px; }
.refresh-button, .close-button {
  width: 26px; height: 26px; display: grid; place-items: center;
  padding: 0; border: 0; border-radius: 5px; background: transparent; color: #475569; cursor: pointer;
}
.refresh-button:hover, .close-button:hover { background: #e2e8f0; }
.refresh-button:focus-visible, .close-button:focus-visible { outline: 2px solid #2563eb; outline-offset: -2px; }
.refresh-button:disabled { opacity: 0.5; cursor: default; }
.refresh-button svg, .close-button svg { width: 14px; height: 14px; }
.transient-status { margin: 0; padding: 7px 9px; border-radius: 6px; background: #fff; color: #475569; font-size: 11px; }
.transient-status.error { color: #b91c1c; }
.transient-status.stale { color: #b45309; background: #fffbeb; }
.transient-status.refreshing { color: #1d4ed8; background: #eff6ff; }
.panel-body { display: flex; flex-direction: column; gap: 8px; }
.timeline {
  display: flex; gap: 6px; overflow-x: auto; padding-bottom: 2px;
  scrollbar-width: none;
}
.timeline::-webkit-scrollbar { display: none; }
.day-chip {
  flex: 1 1 0; min-width: 0;
  display: flex; flex-direction: column; align-items: center; gap: 1px;
  padding: 6px 2px;
  border: 1px solid rgba(148, 163, 184, 0.34);
  border-radius: 8px;
  background: #fff;
  color: #334155;
  cursor: pointer;
  font-size: 11px;
}
.day-chip b { font-size: 12px; }
.day-chip.active { background: #2563eb; border-color: #2563eb; color: #fff; }
.day-chip:focus-visible { outline: 2px solid #2563eb; outline-offset: -2px; }
.controls-row { display: flex; align-items: center; gap: 12px; }
.play-button {
  display: inline-flex; align-items: center; gap: 5px;
  padding: 5px 10px; border: 1px solid rgba(148, 163, 184, 0.34); border-radius: 7px;
  background: #fff; color: #0f172a; cursor: pointer; font-size: 12px;
}
.play-button:hover { background: #e2e8f0; }
.play-button:focus-visible { outline: 2px solid #2563eb; outline-offset: -2px; }
.play-button svg { width: 13px; height: 13px; }
.opacity-control { display: flex; align-items: center; gap: 8px; flex: 1; min-width: 0; }
.opacity-control label { white-space: nowrap; color: #475569; }
.opacity-control input[type='range'] { flex: 1; min-width: 60px; accent-color: #2563eb; }
.opacity-value { min-width: 34px; text-align: right; color: #475569; }
.legend { display: flex; flex-direction: column; gap: 2px; }
.legend-bar { display: flex; height: 8px; border-radius: 4px; overflow: hidden; }
.legend-swatch { flex: 1; }
.legend-labels { display: flex; }
.legend-labels span { flex: 1; text-align: center; font-size: 10px; color: #475569; }
.panel-footer { display: flex; flex-direction: column; gap: 2px; border-top: 1px solid rgba(148, 163, 184, 0.34); padding-top: 8px; font-size: 10px; color: #64748b; }
.attribution { color: #475569; }
.disclaimer { color: #b45309; }
@media (max-width: 520px) {
  .precip-panel { width: calc(100% - 12px); bottom: 8px; padding: 8px 10px 10px; }
  .timeline { overflow-x: auto; }
  .day-chip { flex: 0 0 auto; min-width: 52px; }
}
</style>
