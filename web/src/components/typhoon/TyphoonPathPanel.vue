<template>
  <div class="typhoon-body" :class="{ 'timeline-open': timelineOpen }">
    <div v-if="phase !== 'ready'" class="transient-status" :class="phase" role="status" aria-live="polite">
      {{ phase === 'error' ? '台风数据加载异常' : '台风数据加载中…' }}
    </div>

    <div v-else-if="realtimeCount === 0" class="empty-typhoon" role="status">
      <p class="empty-title">当前无活跃台风</p>
      <p class="empty-desc">台风数据已正常返回（本年 {{ realtimeCount }} 个活跃台风）；可点击左下角"查看当年台风"查看历史台风路径。</p>
    </div>

    <div v-else-if="model.displayedCount" class="panel-scroll">
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
  </div>
</template>

<script setup lang="ts">
import { nextTick, watch } from 'vue'
import type { TyphoonPathPanelViewModel } from '../../features/typhoon/typhoonPanelViewModel'
import type { TyphoonPhase } from '../../stores/typhoon'
import TyphoonCard from './TyphoonCard.vue'
const props = defineProps<{ phase: TyphoonPhase; realtimeCount: number; model: TyphoonPathPanelViewModel; timelineOpen: boolean; revealToken?: number }>()
const emit = defineEmits<{ toggle: [typhoonId: string]; 'close-history': [typhoonId: string]; 'select-node': [typhoonId: string, nodeId: string] }>()
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
.typhoon-body{min-height:0;display:flex;flex-direction:column}
.transient-status{margin:0 2px 5px;padding:7px 8px;border-radius:6px;background:#fff;color:#475569;font-size:11px}
.transient-status.error{color:#b91c1c}
.empty-typhoon{margin:0 2px 5px;padding:12px 10px;border-radius:8px;background:#fff;border:1px dashed #cbd5e1;color:#475569}
.empty-title{margin:0 0 3px;font-size:12px;font-weight:700;color:#0f172a}
.empty-desc{margin:0;font-size:10.5px;line-height:1.5;color:#64748b}
.panel-scroll{min-height:0;flex:0 1 auto;overflow-y:auto;padding:0 1px 1px}
.card-list{display:grid;gap:7px}
</style>
