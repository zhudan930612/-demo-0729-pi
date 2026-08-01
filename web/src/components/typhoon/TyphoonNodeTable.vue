<template>
  <div class="node-table-wrap" :id="tableId">
    <table>
      <thead><tr><th scope="col">时间</th><th scope="col">气压</th><th scope="col">风力</th><th scope="col">移速</th></tr></thead>
      <tbody>
        <tr v-for="node in nodes" :key="node.id" :class="{ selected: node.selected }">
          <td colspan="4">
            <button
              type="button"
              class="node-row-button"
              :aria-current="node.selected ? 'true' : undefined"
              :aria-label="`${node.time}，气压${node.pressure}，风力${node.wind}，移速${node.movementSpeed}`"
              @click="emit('select-node', node.id)"
            >
              <span class="time"><i aria-hidden="true">{{ node.selected ? '●' : '○' }}</i>{{ node.time }}</span>
              <span>{{ node.pressure }}</span>
              <span>{{ node.wind }}</span>
              <span>{{ node.movementSpeed }}</span>
            </button>
          </td>
        </tr>
      </tbody>
    </table>
  </div>
</template>

<script setup lang="ts">
import type { TyphoonNodeRowViewModel } from '../../features/typhoon/typhoonPanelViewModel'
defineProps<{ tableId: string; nodes: readonly TyphoonNodeRowViewModel[] }>()
const emit = defineEmits<{ 'select-node': [nodeId: string] }>()
</script>

<style scoped>
.node-table-wrap { max-height:210px; overflow:auto; border-top:1px solid #e2e8f0; }
table { width:100%; min-width:340px; border-collapse:collapse; table-layout:fixed; font-size:10px; font-variant-numeric:tabular-nums; }
th { position:sticky; top:0; z-index:1; padding:6px 5px; border-bottom:1px solid #cbd5e1; background:#f8fafc; color:#64748b; font-weight:700; text-align:left; }
th:first-child { width:34%; } th:nth-child(2) { width:14%; } th:nth-child(3) { width:32%; } th:nth-child(4) { width:20%; }
td { padding:0; border-bottom:1px solid #f1f5f9; }
.node-row-button { width:100%; min-height:34px; display:grid; grid-template-columns:34% 14% 32% 20%; align-items:center; padding:0; border:0; background:#fff; color:#475569; font:inherit; text-align:left; cursor:pointer; }
.node-row-button > span { min-width:0; padding:6px 5px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
.node-row-button:hover { background:#eff6ff; }
.node-row-button:focus-visible { position:relative; z-index:2; outline:3px solid rgba(37,99,235,.28); outline-offset:-3px; }
tr.selected .node-row-button { background:#dbeafe; box-shadow:inset 3px 0 #2563eb; color:#0f172a; font-weight:700; }
.time { display:flex; align-items:center; gap:4px; }
.time i { flex:none; color:#2563eb; font-style:normal; }
@media (max-width:520px) { .node-table-wrap { overflow-x:auto; } table { min-width:390px; } }
</style>
