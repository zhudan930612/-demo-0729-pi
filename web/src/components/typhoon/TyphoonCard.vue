<template>
  <article :ref="(element) => emit('register-card', card.id, element)" class="typhoon-card" :class="[{ focused: card.focused, expanded: card.expanded }, card.status]">
    <div class="card-title-row">
      <button type="button" class="card-title" :aria-expanded="card.expanded" :aria-controls="contentId" @click="emit('toggle', card.id)">
        <span class="state-icon" aria-hidden="true">◉</span>
        <span class="identity"><strong>{{ card.number }} {{ card.nameCn }}</strong><small>（{{ card.nameEn }}）</small></span>
        <span class="status-text">{{ card.statusLabel }}</span>
      </button>
      <button v-if="card.canClose" type="button" class="history-close" :aria-label="`关闭历史台风 ${card.nameCn}`" title="从地图和列表移除" @click.stop="emit('close-history', card.id)">
        <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M5 5l10 10M15 5 5 15" /></svg>
      </button>
    </div>
    <div v-if="card.expanded" :id="contentId" class="card-content">
      <TyphoonNodeTable :table-id="tableId" :nodes="card.nodes" :reveal-token="revealToken" @select-node="emit('select-node', card.id, $event)" />
    </div>
  </article>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import type { TyphoonCardViewModel } from '../../features/typhoon/typhoonPanelViewModel'
import TyphoonNodeTable from './TyphoonNodeTable.vue'
const props = defineProps<{ card: TyphoonCardViewModel; revealToken?: number }>()
const emit = defineEmits<{ toggle: [typhoonId: string]; 'close-history': [typhoonId: string]; 'select-node': [typhoonId: string, nodeId: string]; 'register-card': [typhoonId: string, element: unknown] }>()
const safeId = computed(() => props.card.id.replace(/[^a-zA-Z0-9_-]/g, '-'))
const contentId = computed(() => `typhoon-card-content-${safeId.value}`)
const tableId = computed(() => `typhoon-node-table-${safeId.value}`)
</script>

<style scoped>
.typhoon-card{position:relative;border:0;border-radius:7px;overflow:hidden;background:#fff}.typhoon-card.focused{box-shadow:inset 0 0 0 2px rgba(37,99,235,.92)}.card-title-row{display:flex;align-items:stretch;background:#fff}.card-title{min-width:0;min-height:42px;display:grid;grid-template-columns:20px minmax(0,1fr) auto;align-items:center;gap:5px;flex:1;padding:5px 7px;border:0;background:transparent;color:#475569;text-align:left;cursor:pointer}.card-title:hover{background:#f1f5f9}.card-title:focus-visible,.history-close:focus-visible{position:relative;z-index:3;outline:3px solid rgba(37,99,235,.3);outline-offset:-3px}.expanded .card-title{font-weight:700}.state-icon{color:#2563eb;font-size:18px;line-height:1}.historical .state-icon{color:#cbd5e1}.identity{min-width:0;display:flex;align-items:baseline;gap:3px;overflow:hidden}.identity strong,.identity small{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.identity strong{color:#475569;font-size:13px;font-weight:500}.identity small{color:#64748b;font-size:12px;font-weight:500}.status-text{position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0);white-space:nowrap}.history-close{position:absolute;top:7px;right:5px;z-index:2;width:28px;height:28px;display:grid;place-items:center;padding:0;border:0;border-radius:5px;background:rgba(255,255,255,.96);color:#64748b;cursor:pointer;opacity:0;pointer-events:none;transition:opacity 120ms ease,background-color 120ms ease,color 120ms ease}.history-close svg{width:15px;height:15px}.historical:hover .history-close,.historical:focus-within .history-close{opacity:1;pointer-events:auto}.history-close:hover{background:#fee2e2;color:#b91c1c}.historical .card-title{padding-right:34px}.card-content{border-top:1px solid #cbd5e1}@media(hover:none){.history-close{opacity:1;pointer-events:auto}}@media(prefers-reduced-motion:reduce){.history-close{transition:none}}
</style>
