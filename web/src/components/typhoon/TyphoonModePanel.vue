<template>
  <aside class="typhoon-mode-panel" aria-labelledby="typhoon-panel-title">
    <header>
      <div>
        <span class="mode-kicker">灾害风险 · 实时</span>
        <h2 id="typhoon-panel-title">台风路径</h2>
      </div>
      <button type="button" class="close-button" aria-label="关闭台风路径并退出灾害风险模式" title="退出灾害风险模式" @click="emit('close')">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6 6 18" /></svg>
      </button>
    </header>
    <div class="status-row" :class="phase" role="status" aria-live="polite">
      <span v-if="phase === 'loading-live'" class="spinner" aria-hidden="true"></span>
      <svg v-else-if="phase === 'error'" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3 2.5 20h19L12 3Zm0 6v5m0 3v.5" /></svg>
      <svg v-else viewBox="0 0 24 24" aria-hidden="true"><path d="M4 12h4l2-5 4 10 2-5h4" /></svg>
      <div>
        <strong>{{ statusTitle }}</strong>
        <span>{{ statusDescription }}</span>
      </div>
    </div>
    <p class="snapshot-note">当前模式使用单次数据快照，不自动刷新。</p>
  </aside>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import type { TyphoonPhase } from '../../stores/typhoon'

const props = defineProps<{ phase: TyphoonPhase; realtimeCount: number }>()
const emit = defineEmits<{ close: [] }>()
const statusTitle = computed(() => {
  if (props.phase === 'loading-live') return '实时台风加载中'
  if (props.phase === 'error') return '实时台风数据加载异常'
  if (props.phase === 'ready' && props.realtimeCount === 0) return '当前无活动台风'
  return `当前活动台风 ${props.realtimeCount} 个`
})
const statusDescription = computed(() => props.phase === 'ready' && props.realtimeCount > 0
  ? '地图已展示全部活动台风，选择状态彼此独立。'
  : props.phase === 'loading-live' ? '实时详情到达后将逐条显示。' : '历史台风入口将在后续模块提供。')
</script>

<style scoped>
.typhoon-mode-panel { position:absolute; top:66px; right:10px; z-index:1000; width:280px; padding:12px; border:1px solid rgba(148,163,184,.34); border-radius:10px; background:rgba(248,250,252,.96); box-shadow:0 6px 20px rgba(15,23,42,.18),0 1px 2px rgba(15,23,42,.12); color:#0f172a; backdrop-filter:blur(8px); }
header { display:flex; align-items:flex-start; justify-content:space-between; gap:12px; }
.mode-kicker { display:block; margin-bottom:2px; color:#64748b; font-size:10px; font-weight:700; letter-spacing:.08em; }
h2 { margin:0; font-size:16px; line-height:1.25; }
.close-button { width:34px; height:34px; display:grid; place-items:center; flex:none; padding:0; border:0; border-radius:7px; background:transparent; color:#475569; cursor:pointer; }
.close-button:hover { background:#e2e8f0; color:#0f172a; }
.close-button:focus-visible { outline:3px solid rgba(37,99,235,.28); outline-offset:2px; }
.close-button svg { width:17px; height:17px; }
.status-row { display:flex; align-items:center; gap:10px; margin-top:10px; padding:10px; border:1px solid #cbd5e1; border-radius:7px; background:#fff; }
.status-row > svg,.spinner { width:18px; height:18px; flex:none; color:#2563eb; }
.status-row > svg { fill:none; stroke:currentColor; stroke-width:1.8; stroke-linecap:round; stroke-linejoin:round; }
.status-row.error { border-color:#fecaca; background:#fff7ed; }
.status-row.error > svg { color:#b91c1c; }
.status-row div { min-width:0; display:grid; gap:2px; }
.status-row strong { font-size:13px; }
.status-row span { color:#64748b; font-size:11px; line-height:1.4; }
.spinner { box-sizing:border-box; border:2px solid #bfdbfe; border-top-color:#2563eb; border-radius:50%; animation:spin .8s linear infinite; }
.snapshot-note { margin:8px 2px 0; color:#64748b; font-size:10px; line-height:1.4; }
@keyframes spin { to { transform:rotate(360deg); } }
@media (max-width:720px) { .typhoon-mode-panel { top:64px; width:min(260px,calc(100vw - 24px)); } }
@media (max-width:520px) { .typhoon-mode-panel { left:12px; right:12px; width:auto; } }
@media (prefers-reduced-motion:reduce) { .spinner { animation:none; border-color:#2563eb; } }
</style>
