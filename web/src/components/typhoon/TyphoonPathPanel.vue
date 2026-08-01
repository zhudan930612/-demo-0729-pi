<template>
  <aside class="typhoon-path-panel" :class="{ 'timeline-open': timelineOpen }" aria-labelledby="typhoon-panel-title">
    <header class="panel-header">
      <div><span class="mode-kicker">灾害风险 · 单次快照</span><h2 id="typhoon-panel-title">台风路径</h2></div>
      <button type="button" class="close-button" aria-label="关闭台风路径并退出灾害风险模式" title="退出灾害风险模式" @click="emit('close')">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6 6 18" /></svg>
      </button>
    </header>

    <div class="status-row" :class="phase" role="status" aria-live="polite">
      <span v-if="phase === 'loading-live'" class="spinner" aria-hidden="true"></span>
      <span v-else class="status-icon" aria-hidden="true">{{ phase === 'error' ? '!' : realtimeCount ? '●' : '○' }}</span>
      <div><strong>{{ statusTitle }}</strong><span>{{ statusDescription }}</span></div>
    </div>

    <div v-if="model.displayedCount" class="panel-scroll">
      <section v-if="model.realtime.length" class="typhoon-group" aria-labelledby="live-group-title">
        <h3 id="live-group-title"><span aria-hidden="true">●</span>实时台风 <b>{{ model.realtime.length }}</b></h3>
        <div class="card-list"><TyphoonCard v-for="card in model.realtime" :key="card.id" :card="card" :reveal-token="revealToken" @toggle="emit('toggle', $event)" @select-node="forwardNode" @register-card="setCardRef" /></div>
      </section>
      <section v-if="model.historical.length" class="typhoon-group" aria-labelledby="history-group-title">
        <h3 id="history-group-title"><span aria-hidden="true">◷</span>历史台风 <b>{{ model.historical.length }}</b></h3>
        <div class="card-list"><TyphoonCard v-for="card in model.historical" :key="card.id" :card="card" :reveal-token="revealToken" @toggle="emit('toggle', $event)" @close-history="emit('close-history', $event)" @select-node="forwardNode" @register-card="setCardRef" /></div>
      </section>
    </div>

    <TyphoonLegend />
  </aside>
</template>

<script setup lang="ts">
import { computed, nextTick, watch } from 'vue'
import type { TyphoonPathPanelViewModel } from '../../features/typhoon/typhoonPanelViewModel'
import type { TyphoonPhase } from '../../stores/typhoon'
import TyphoonCard from './TyphoonCard.vue'
import TyphoonLegend from './TyphoonLegend.vue'
const props = defineProps<{ phase: TyphoonPhase; realtimeCount: number; model: TyphoonPathPanelViewModel; timelineOpen: boolean; revealToken?: number }>()
const emit = defineEmits<{ close: []; toggle: [typhoonId: string]; 'close-history': [typhoonId: string]; 'select-node': [typhoonId: string, nodeId: string] }>()
const forwardNode = (typhoonId: string, nodeId: string) => emit('select-node', typhoonId, nodeId)
const cardRefs = new Map<string, Element>()
function setCardRef(id: string, element: unknown) {
  if (element instanceof Element) cardRefs.set(id, element)
  else cardRefs.delete(id)
}
watch(() => [props.model.realtime.find((card) => card.focused)?.id ?? props.model.historical.find((card) => card.focused)?.id, props.revealToken] as const, async ([id]) => {
  if (!id) return
  await nextTick()
  cardRefs.get(id)?.scrollIntoView({ block: 'nearest', inline: 'nearest' })
})
const statusTitle = computed(() => props.phase === 'loading-live' ? '实时台风加载中' : props.phase === 'error' ? '实时台风数据加载异常' : props.realtimeCount === 0 ? '当前无活动台风' : `当前活动台风 ${props.realtimeCount} 个`)
const statusDescription = computed(() => props.phase === 'loading-live' ? '实时详情到达后将逐条显示。' : props.phase === 'error' ? '当前仅保留数据异常状态占位。' : props.realtimeCount ? '全部活动台风保持显示，选择只改变焦点与详情。' : '历史台风需从底部时间轴主动打开。')
</script>

<style scoped>
.typhoon-path-panel { position:absolute; top:66px; right:10px; bottom:170px; z-index:1000; width:390px; box-sizing:border-box; display:flex; flex-direction:column; gap:8px; padding:10px; overflow:hidden; border:1px solid rgba(148,163,184,.34); border-radius:10px; background:rgba(248,250,252,.96); box-shadow:0 6px 20px rgba(15,23,42,.18),0 1px 2px rgba(15,23,42,.12); color:#0f172a; backdrop-filter:blur(8px); }
.panel-header { display:flex; align-items:flex-start; justify-content:space-between; gap:12px; }.mode-kicker { display:block; margin-bottom:2px; color:#64748b; font-size:10px; font-weight:700; letter-spacing:.08em; }h2 { margin:0; font-size:16px; line-height:1.25; }
.close-button { width:34px; height:34px; display:grid; place-items:center; flex:none; padding:0; border:0; border-radius:7px; background:transparent; color:#475569; cursor:pointer; }.close-button:hover { background:#e2e8f0; color:#0f172a; }.close-button:focus-visible { outline:3px solid rgba(37,99,235,.28); outline-offset:2px; }.close-button svg { width:17px; height:17px; }
.status-row { display:flex; align-items:center; gap:9px; padding:8px 9px; border:1px solid #cbd5e1; border-radius:7px; background:#fff; }.status-row > div { min-width:0; display:grid; gap:1px; }.status-row strong { font-size:12px; }.status-row span { color:#64748b; font-size:10px; line-height:1.35; }.status-icon,.spinner { width:17px; height:17px; flex:none; color:#2563eb; text-align:center; }.status-row.error { border-color:#fecaca; background:#fff7ed; }.status-row.error .status-icon { color:#b91c1c; font-weight:800; }.spinner { box-sizing:border-box; border:2px solid #bfdbfe; border-top-color:#2563eb; border-radius:50%; animation:spin .8s linear infinite; }
.panel-scroll { min-height:0; flex:1; overflow-y:auto; padding-right:2px; }.typhoon-group + .typhoon-group { margin-top:9px; }.typhoon-group > h3 { position:sticky; top:0; z-index:4; display:flex; align-items:center; gap:5px; margin:0 0 5px; padding:5px 3px; background:rgba(248,250,252,.98); color:#334155; font-size:11px; }.typhoon-group > h3 span { color:#2563eb; }.typhoon-group:nth-child(2) > h3 span { color:#7e22ce; }.typhoon-group > h3 b { min-width:18px; padding:1px 5px; border-radius:9px; background:#e2e8f0; text-align:center; font-variant-numeric:tabular-nums; }.card-list { display:grid; gap:6px; }
@keyframes spin { to { transform:rotate(360deg); } }
.typhoon-path-panel.timeline-open { bottom:206px; }
@media (max-width:720px) { .typhoon-path-panel { top:64px; bottom:154px; width:min(350px,calc(100vw - 24px)); } .typhoon-path-panel.timeline-open { bottom:194px; } }
@media (max-width:520px) { .typhoon-path-panel { top:62px; left:12px; right:12px; bottom:148px; width:auto; } .typhoon-path-panel.timeline-open { bottom:190px; } }
@media (prefers-reduced-motion:reduce) { .spinner { animation:none; border-color:#2563eb; } }
</style>
