<template>
  <aside class="typhoon-path-panel" :class="{ 'timeline-open': timelineOpen }" aria-labelledby="typhoon-panel-title">
    <header class="panel-header">
      <h2 id="typhoon-panel-title">台风路径</h2>
      <button type="button" class="close-button" aria-label="关闭台风路径并退出灾害风险模式" title="退出灾害风险模式" @click="emit('close')">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6 6 18" /></svg>
      </button>
    </header>

    <div v-if="phase === 'loading-live' || phase === 'error'" class="transient-status" :class="phase" role="status" aria-live="polite">
      {{ phase === 'loading-live' ? '台风数据加载中…' : '台风数据加载异常' }}
    </div>

    <div v-if="model.displayedCount" class="panel-scroll">
      <div class="card-list">
        <TyphoonCard
          v-for="card in model.cards"
          :key="card.id"
          :card="card"
          :reveal-token="revealToken"
          @toggle="emit('toggle', $event)"
          @close-history="emit('close-history', $event)"
          @select-node="forwardNode"
          @register-card="setCardRef"
        />
      </div>
    </div>
  </aside>
</template>

<script setup lang="ts">
import { nextTick, watch } from 'vue'
import type { TyphoonPathPanelViewModel } from '../../features/typhoon/typhoonPanelViewModel'
import type { TyphoonPhase } from '../../stores/typhoon'
import TyphoonCard from './TyphoonCard.vue'
const props = defineProps<{ phase: TyphoonPhase; realtimeCount: number; model: TyphoonPathPanelViewModel; timelineOpen: boolean; revealToken?: number }>()
const emit = defineEmits<{ close: []; toggle: [typhoonId: string]; 'close-history': [typhoonId: string]; 'select-node': [typhoonId: string, nodeId: string] }>()
const forwardNode = (typhoonId: string, nodeId: string) => emit('select-node', typhoonId, nodeId)
const cardRefs = new Map<string, Element>()
function setCardRef(id: string, element: unknown) {
  if (element instanceof Element) cardRefs.set(id, element)
  else cardRefs.delete(id)
}
watch(() => [props.model.cards.find((card) => card.focused)?.id, props.revealToken] as const, async ([id]) => {
  if (!id) return
  await nextTick()
  cardRefs.get(id)?.scrollIntoView({ block: 'nearest', inline: 'nearest' })
})
</script>

<style scoped>
.typhoon-path-panel{position:absolute;top:12px;right:12px;z-index:1000;width:390px;max-width:calc(100% - 24px);max-height:calc(100% - 24px);box-sizing:border-box;display:flex;flex-direction:column;overflow:hidden;border:5px solid #2563eb;border-radius:10px;background:#2563eb;box-shadow:0 7px 22px rgba(15,23,42,.24);color:#0f172a}.panel-header{height:34px;display:flex;flex:none;align-items:center;justify-content:space-between;padding:0 5px 0 7px;color:#fff}.panel-header h2{margin:0;font-size:14px;line-height:1}.close-button{width:28px;height:28px;display:grid;place-items:center;padding:0;border:0;border-radius:5px;background:transparent;color:#bfdbfe;cursor:pointer}.close-button:hover{background:rgba(255,255,255,.16);color:#fff}.close-button:focus-visible{outline:2px solid #fff;outline-offset:-2px}.close-button svg{width:15px;height:15px}.transient-status{margin:0 2px 5px;padding:7px 8px;border-radius:6px;background:#fff;color:#475569;font-size:11px}.transient-status.error{color:#b91c1c}.panel-scroll{min-height:0;flex:0 1 auto;overflow-y:auto;padding:0 1px 1px}.card-list{display:grid;gap:7px}.typhoon-path-panel.timeline-open{max-height:calc(100% - 218px)}@media(max-width:720px){.typhoon-path-panel{width:min(390px,calc(100% - 24px))}.typhoon-path-panel.timeline-open{max-height:calc(100% - 206px)}}@media(max-width:520px){.typhoon-path-panel{left:12px;right:12px;width:auto;min-width:0}.typhoon-path-panel.timeline-open{max-height:calc(100% - 202px)}}
</style>
