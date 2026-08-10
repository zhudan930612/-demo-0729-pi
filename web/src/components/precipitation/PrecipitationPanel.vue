<template>
  <aside class="precip-panel" aria-labelledby="precip-panel-title" role="region">
    <header class="panel-header">
      <h2 id="precip-panel-title">未来 7 天降水预报</h2>
      <div class="panel-header-actions">
        <button type="button" class="icon-button" :disabled="refreshing" :title="refreshing ? '正在更新' : '刷新降水预报'" aria-label="刷新降水预报" @click="emit('refresh')">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21 12a9 9 0 1 1-2.6-6.4" /><path d="M21 3v6h-6" /></svg>
        </button>
        <button type="button" class="icon-button close-button" aria-label="退出降水查看" title="退出降水查看" @click="emit('close')">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6 6 18" /></svg>
        </button>
      </div>
    </header>

    <div v-if="showStale" class="status stale" role="status" aria-live="polite">数据获取失败，显示上次成功数据（获取于 {{ snapshot?.updatedAt ?? '' }}）</div>
    <div v-else-if="errorMessage && !ready" class="status error" role="status" aria-live="polite">降水预报暂不可用{{ errorMessage ? `（${errorMessage}）` : '' }}</div>
    <div v-else-if="refreshing" class="status refreshing" role="status" aria-live="polite">正在更新…</div>

    <template v-if="ready">
      <!-- 时间轴：节点 + 日期，单行紧凑 -->
      <div class="timeline" role="group" aria-label="预报日期时间轴">
        <button
          v-for="(day, index) in days"
          :key="day"
          type="button"
          class="day-node"
          :class="{ active: index === selectedDay }"
          :aria-pressed="index === selectedDay"
          :title="`${dayLabel(index)} ${dayWeek(index)} 当日累计降雨量`"
          @click="emit('select-day', index)"
        >
          <span class="day-node-dot" aria-hidden="true"></span>
          <span class="day-node-text">{{ dayShort(index) }}</span>
        </button>
      </div>

      <!-- 播放 + 可见度 + 图例（色斑辨识）合并一行 -->
      <div class="controls-legend-row">
        <button type="button" class="play-button" :aria-label="playing ? '暂停逐日播放' : '播放逐日动画'" @click="emit('toggle-play')">
          <svg v-if="!playing" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M8 5v14l11-7z" /></svg>
          <svg v-else viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M7 5h4v14H7zM13 5h4v14h-4z" /></svg>
          <span>{{ playing ? '暂停' : '播放' }}</span>
        </button>
        <div class="opacity-control">
          <label id="precip-opacity-label" for="precip-opacity">可见度</label>
          <input id="precip-opacity" type="range" min="0" max="100" :value="Math.round(opacity * 100)" aria-labelledby="precip-opacity-label" @input="onOpacity" />
        </div>
        <span class="opacity-value">{{ Math.round(opacity * 100) }}%</span>
        <div class="legend" aria-label="当日累计降雨量图例">
          <div class="legend-bar" aria-hidden="true">
            <span v-for="stop in legendStops" :key="stop.label" class="legend-swatch" :style="{ background: stop.color }"></span>
          </div>
          <div class="legend-labels" aria-hidden="true">
            <span v-for="stop in legendStops" :key="stop.label">{{ stop.label }}</span>
          </div>
        </div>
      </div>

      <footer class="panel-footer">
        <span>当日累计降雨量</span>
        <span class="attribution">降水预报数据 © Open-Meteo / ECMWF（0.25° 网格，约 25 km）</span>
        <span class="disclaimer">预报场仅供参考，不作定损依据</span>
      </footer>
    </template>
    <div v-else-if="phase === 'loading'" class="status" role="status" aria-live="polite">降水预报加载中…</div>
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
  { label: '小雨', color: 'rgb(208,240,170)' },
  { label: '中雨', color: 'rgb(122,204,112)' },
  { label: '大雨', color: 'rgb(82,172,152)' },
  { label: '暴雨', color: 'rgb(52,112,222)' },
  { label: '大暴雨', color: 'rgb(158,60,212)' },
  { label: '特大暴雨', color: 'rgb(204,46,196)' },
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
  bottom: 12px;
  transform: translateX(-50%);
  z-index: 1010;
  width: min(640px, calc(100% - 20px));
  box-sizing: border-box;
  display: flex;
  flex-direction: column;
  gap: 4px;
  padding: 7px 12px 7px;
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
.panel-header h2 { margin: 0; font-size: 12px; line-height: 1; font-weight: 600; }
.panel-header-actions { display: flex; gap: 2px; }
.icon-button {
  width: 20px; height: 20px; display: grid; place-items: center;
  padding: 0; border: 0; border-radius: 5px; background: transparent; color: #64748b; cursor: pointer;
}
.icon-button:hover { background: #e2e8f0; }
.icon-button:focus-visible { outline: 2px solid #2563eb; outline-offset: -2px; }
.icon-button:disabled { opacity: 0.5; cursor: default; }
.icon-button svg { width: 12px; height: 12px; }
.status { margin: 0; padding: 4px 8px; border-radius: 6px; background: #fff; color: #475569; font-size: 11px; }
.status.error { color: #b91c1c; }
.status.stale { color: #b45309; background: #fffbeb; }
.status.refreshing { color: #1d4ed8; background: #eff6ff; }

/* 时间轴：节点 + 日期单行紧凑 */
.timeline {
  display: flex;
  align-items: flex-end;
  overflow-x: auto;
  scrollbar-width: none;
}
.timeline::-webkit-scrollbar { display: none; }
.day-node {
  flex: 1 1 0;
  min-width: 0;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 1px;
  padding: 1px 0 2px;
  border: 0;
  border-radius: 6px;
  background: transparent;
  color: #64748b;
  cursor: pointer;
}
.day-node:hover { background: #eef2f7; }
.day-node:focus-visible { outline: 2px solid #2563eb; outline-offset: -2px; }
.day-node-dot {
  width: 5px; height: 5px;
  border-radius: 50%;
  background: #cbd5e1;
  transition: width 0.12s ease, height 0.12s ease, background 0.12s ease;
}
.day-node-text { font-size: 10px; line-height: 1; white-space: nowrap; }
.day-node.active .day-node-dot { width: 9px; height: 9px; background: #2563eb; }
.day-node.active .day-node-text { color: #1d4ed8; font-weight: 600; }

/* 播放 + 可见度 + 图例单行 */
.controls-legend-row {
  display: flex;
  align-items: center;
  gap: 10px;
}
.play-button {
  display: inline-flex; align-items: center; gap: 4px;
  padding: 2px 8px; border: 1px solid rgba(148, 163, 184, 0.34); border-radius: 6px;
  background: #fff; color: #0f172a; cursor: pointer; font-size: 11px;
}
.play-button:hover { background: #e2e8f0; }
.play-button:focus-visible { outline: 2px solid #2563eb; outline-offset: -2px; }
.play-button svg { width: 10px; height: 10px; }
.opacity-control { display: flex; align-items: center; gap: 5px; }
.opacity-control label { white-space: nowrap; color: #64748b; font-size: 11px; }
.opacity-control input[type='range'] { width: 90px; accent-color: #60a5fa; height: 14px; margin: 0; }
.opacity-value { min-width: 28px; text-align: right; color: #64748b; font-size: 10px; }
.legend { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 1px; margin-left: 4px; }
.legend-bar { display: flex; height: 4px; border-radius: 2px; overflow: hidden; }
.legend-swatch { flex: 1; }
.legend-labels { display: flex; }
.legend-labels span { flex: 1; text-align: center; font-size: 8px; color: #94a3b8; line-height: 1; }

/* 页脚：单行紧凑 */
.panel-footer {
  display: flex;
  align-items: center;
  gap: 8px;
  border-top: 1px solid rgba(148, 163, 184, 0.25);
  padding-top: 4px;
  font-size: 9.5px;
  color: #94a3b8;
  white-space: nowrap;
  overflow: hidden;
}
.panel-footer .attribution { color: #94a3b8; }
.panel-footer .disclaimer { color: #b45309; margin-left: auto; }
@media (max-width: 560px) {
  .precip-panel { width: calc(100% - 12px); bottom: 8px; }
  .controls-legend-row { flex-wrap: wrap; row-gap: 3px; }
  .legend { flex: 1 1 100%; margin-left: 0; }
  .panel-footer { flex-wrap: wrap; gap: 2px 8px; }
  .panel-footer .disclaimer { margin-left: 0; }
}
</style>
