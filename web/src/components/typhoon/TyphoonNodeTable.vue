<template>
  <div class="node-table-wrap" :id="tableId">
    <table>
      <thead><tr><th scope="col">时间</th><th scope="col">气压</th><th scope="col">风力</th><th scope="col">移速</th></tr></thead>
      <tbody>
        <tr v-for="node in nodes" :key="node.id" :ref="(element) => setNodeRef(node.id, element)" :class="{ selected: node.selected }" @click="emit('select-node', node.id)">
          <td><button type="button" class="node-select" :aria-current="node.selected ? 'true' : undefined" :aria-label="`${node.time}，气压${node.pressure}，风力${node.wind}，移速${node.movementSpeed}`" @click.stop="emit('select-node', node.id)"><i aria-hidden="true">{{ node.selected ? '●' : '○' }}</i>{{ node.time }}</button></td>
          <td>{{ node.pressure }}</td><td>{{ node.wind }}</td><td>{{ node.movementSpeed }}</td>
        </tr>
      </tbody>
    </table>
  </div>
</template>
<script setup lang="ts">
import { nextTick, watch } from 'vue'
import type { TyphoonNodeRowViewModel } from '../../features/typhoon/typhoonPanelViewModel'
const props = defineProps<{ tableId:string; nodes:readonly TyphoonNodeRowViewModel[]; revealToken?:number }>()
const emit = defineEmits<{ 'select-node':[nodeId:string] }>()
const nodeRefs=new Map<string,Element>()
function setNodeRef(id:string,element:unknown){if(element instanceof Element)nodeRefs.set(id,element);else nodeRefs.delete(id)}
watch(()=>props.revealToken,async()=>{const id=props.nodes.find(node=>node.selected)?.id;if(!id)return;await nextTick();nodeRefs.get(id)?.scrollIntoView({block:'nearest',inline:'nearest'})})
</script>
<style scoped>
.node-table-wrap{max-height:330px;overflow-x:hidden;overflow-y:auto}table{width:100%;border-collapse:collapse;table-layout:fixed;font-size:12px;font-variant-numeric:tabular-nums}th{position:sticky;top:0;z-index:1;padding:7px 3px;border-bottom:1px solid #cbd5e1;background:#f8fafc;color:#334155;font-weight:500;text-align:center}th:first-child{width:30%}th:nth-child(2){width:12%}th:nth-child(3){width:42%}th:nth-child(4){width:16%}td{padding:7px 3px;border-bottom:1px solid #e2e8f0;overflow:hidden;color:#475569;text-align:center;text-overflow:ellipsis;white-space:nowrap}tbody tr{background:#fff;cursor:pointer}tbody tr:hover{background:#eff6ff}tr.selected{background:#dbeafe;box-shadow:inset 3px 0 #2563eb;color:#0f172a;font-weight:700}.node-select{max-width:100%;display:flex;align-items:center;gap:4px;padding:0;border:0;background:transparent;color:inherit;font:inherit;text-align:left;cursor:pointer}.node-select i{flex:none;color:#ef4444;font-size:10px;font-style:normal}.historical .node-select i{color:#16a34a}.node-select:focus-visible{outline:3px solid rgba(37,99,235,.28);outline-offset:2px}@media(max-width:520px){table{font-size:11px}th,td{padding-left:2px;padding-right:2px}.node-select{gap:3px}}
</style>
