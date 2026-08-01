<template>
  <article :ref="(element) => emit('register-card', card.id, element)" class="typhoon-card" :class="[{ focused: card.focused, expanded: card.expanded }, card.status]">
    <div class="card-title-row">
      <button
        type="button"
        class="card-title"
        :aria-expanded="card.expanded"
        :aria-controls="contentId"
        @click="emit('toggle', card.id)"
      >
        <span class="state-icon" aria-hidden="true">{{ card.status === 'realtime' ? '●' : '◷' }}</span>
        <span class="identity"><strong>{{ card.number }} · {{ card.nameCn }}</strong><small>{{ card.nameEn }}</small></span>
        <span class="status-text">{{ card.statusLabel }}</span>
        <span class="chevron" aria-hidden="true">{{ card.expanded ? '⌃' : '⌄' }}</span>
      </button>
      <button
        v-if="card.canClose"
        type="button"
        class="history-close"
        :aria-label="`关闭历史台风 ${card.nameCn}`"
        title="从地图和列表移除，时间轴标签保留"
        @click.stop="emit('close-history', card.id)"
      >×</button>
    </div>

    <div v-if="card.expanded" :id="contentId" class="card-content">
      <section v-if="card.detail" class="selected-detail" aria-label="当前选中节点详情">
        <div class="detail-heading"><strong>{{ card.detail.number }} · {{ card.detail.nameCn }}</strong><span>{{ card.detail.nameEn }}</span></div>
        <dl>
          <div><dt>时间</dt><dd>{{ card.detail.time }}</dd></div><div><dt>位置</dt><dd>{{ card.detail.position }}</dd></div>
          <div><dt>气压</dt><dd>{{ card.detail.pressure }}</dd></div><div><dt>最大风速/强度</dt><dd>{{ card.detail.maximumWind }}</dd></div>
          <div><dt>移动方向</dt><dd>{{ card.detail.movementDirection }}</dd></div><div><dt>移动速度</dt><dd>{{ card.detail.movementSpeed }}</dd></div>
        </dl>
        <p class="wind-note" :class="{ missing: card.detail.windRadiusMessage.startsWith('暂无') }">{{ card.detail.windRadiusMessage }}</p>
      </section>
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
.typhoon-card { border:1px solid #cbd5e1; border-radius:8px; overflow:hidden; background:rgba(255,255,255,.96); }
.typhoon-card.focused { border:2px solid #2563eb; box-shadow:0 0 0 2px rgba(37,99,235,.1); }
.card-title-row { display:flex; align-items:stretch; background:#fff; }
.card-title { min-width:0; min-height:46px; display:grid; grid-template-columns:auto minmax(0,1fr) auto auto; align-items:center; gap:7px; flex:1; padding:6px 8px; border:0; background:transparent; color:#334155; text-align:left; cursor:pointer; }
.card-title:hover { background:#f1f5f9; }.card-title:focus-visible,.history-close:focus-visible { position:relative; z-index:2; outline:3px solid rgba(37,99,235,.28); outline-offset:-3px; }
.focused .card-title { background:#eff6ff; }.expanded .card-title { font-weight:700; }
.state-icon { color:#2563eb; font-size:11px; }.historical .state-icon { color:#7e22ce; }
.identity { min-width:0; display:grid; gap:1px; }.identity strong,.identity small { overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }.identity strong { color:#0f172a; font-size:12px; }.identity small { color:#64748b; font-size:10px; font-weight:600; }
.status-text { padding:3px 5px; border:1px solid #bfdbfe; border-radius:5px; background:#eff6ff; color:#1e40af; font-size:9px; font-weight:750; white-space:nowrap; }.historical .status-text { border-color:#e9d5ff; background:#faf5ff; color:#6b21a8; }
.chevron { font-size:13px; }.history-close { width:34px; flex:none; border:0; border-left:1px solid #e2e8f0; background:#fff; color:#b91c1c; font-size:20px; cursor:pointer; }.history-close:hover { background:#fef2f2; }
.card-content { border-top:1px solid #cbd5e1; }.selected-detail { padding:8px 9px; background:#f8fafc; }.detail-heading { display:flex; align-items:baseline; gap:6px; margin-bottom:6px; }.detail-heading strong { font-size:11px; }.detail-heading span { color:#64748b; font-size:9px; font-weight:700; }
dl { display:grid; grid-template-columns:1fr 1fr; gap:4px 10px; margin:0; }dl div { min-width:0; display:grid; grid-template-columns:58px minmax(0,1fr); gap:4px; }dt { color:#64748b; font-size:9px; }dd { min-width:0; margin:0; overflow:hidden; color:#334155; font-size:9px; font-weight:650; text-overflow:ellipsis; white-space:nowrap; }
.wind-note { margin:6px 0 0; color:#166534; font-size:9px; font-weight:650; }.wind-note.missing { color:#b45309; }
</style>
