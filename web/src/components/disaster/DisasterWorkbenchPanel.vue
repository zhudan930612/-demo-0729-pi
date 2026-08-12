<template>
  <aside
    class="disaster-workbench"
    :class="{ collapsed, 'timeline-open': timelineOpen }"
    :aria-label="workbenchLabel"
  >
    <header class="workbench-header">
      <div class="tab-list" role="tablist" aria-label="灾害风险工作台视图">
        <button
          v-if="activeTabs.includes('typhoon')"
          id="dw-tab-typhoon"
          type="button"
          role="tab"
          :aria-selected="activeTab === 'typhoon'"
          :tabindex="activeTab === 'typhoon' ? 0 : -1"
          @click="emit('select-tab', 'typhoon')"
        >台风路径</button>
        <button
          v-if="activeTabs.includes('risk')"
          id="dw-tab-risk"
          type="button"
          role="tab"
          :aria-selected="activeTab === 'risk'"
          :tabindex="activeTab === 'risk' ? 0 : -1"
          @click="emit('select-tab', 'risk')"
        >风险概览</button>
      </div>
      <button
        type="button"
        class="collapse-button"
        :aria-expanded="!collapsed"
        :aria-label="collapsed ? '展开面板' : '收起面板'"
        :title="collapsed ? '展开面板' : '收起面板'"
        @click="emit('toggle-collapsed')"
      >{{ collapsed ? '▴' : '▾' }}</button>
      <button
        type="button"
        class="close-button"
        :aria-label="closeLabel"
        :title="closeLabel"
        @click="emit('close')"
      >
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6 6 18" /></svg>
      </button>
    </header>

    <div v-show="!collapsed && activeTab === 'typhoon'" class="tab-body" role="tabpanel" aria-labelledby="dw-tab-typhoon">
      <slot name="typhoon" />
    </div>
    <div v-show="!collapsed && activeTab === 'risk'" class="tab-body" role="tabpanel" aria-labelledby="dw-tab-risk">
      <slot name="risk" />
    </div>
  </aside>
</template>

<script setup lang="ts">
import { computed } from 'vue'

export type WorkbenchTab = 'typhoon' | 'risk'

const props = defineProps<{
  activeTabs: WorkbenchTab[]
  activeTab: WorkbenchTab
  collapsed: boolean
  timelineOpen: boolean
  closeLabel: string
}>()
const emit = defineEmits<{ 'select-tab': [tab: WorkbenchTab]; 'toggle-collapsed': []; close: [] }>()

const workbenchLabel = computed(() => (props.collapsed ? '灾害风险工作台（已收起）' : '灾害风险工作台'))
</script>

<style scoped>
.disaster-workbench{
  position:absolute;top:12px;right:12px;z-index:1020;width:390px;max-width:calc(100% - 24px);
  max-height:calc(100% - 24px);box-sizing:border-box;display:flex;flex-direction:column;overflow:hidden;
  border:5px solid #2563eb;border-radius:10px;background:#2563eb;box-shadow:0 7px 22px rgba(15,23,42,.24);color:#0f172a;
}
.disaster-workbench.timeline-open{max-height:calc(100% - 218px)}
.workbench-header{height:34px;display:flex;flex:none;align-items:center;padding:0 4px 0 0;color:#fff}
.tab-list{display:flex;flex:1;align-items:stretch;height:100%;min-width:0}
.tab-list button{
  height:100%;padding:0 14px;border:0;background:transparent;color:#bfdbfe;font-size:13px;font-weight:600;cursor:pointer;
}
.tab-list button[aria-selected='true']{background:rgba(255,255,255,.18);color:#fff}
.tab-list button:hover{color:#fff}
.tab-list button:focus-visible{outline:2px solid #fff;outline-offset:-2px}
.collapse-button,.close-button{
  width:28px;height:28px;flex:none;display:grid;place-items:center;padding:0;border:0;border-radius:5px;
  background:transparent;color:#bfdbfe;cursor:pointer;
}
.collapse-button:hover,.close-button:hover{background:rgba(255,255,255,.16);color:#fff}
.collapse-button:focus-visible,.close-button:focus-visible{outline:2px solid #fff;outline-offset:-2px}
.close-button svg{width:15px;height:15px}
.tab-body{min-height:0;background:#fff;overflow-y:auto;overflow-x:hidden;scrollbar-width:none}
@media(max-width:720px){.disaster-workbench{width:min(390px,calc(100% - 24px))}.disaster-workbench.timeline-open{max-height:calc(100% - 206px)}}
@media(max-width:520px){.disaster-workbench{left:12px;right:12px;width:auto;min-width:0}.disaster-workbench.timeline-open{max-height:calc(100% - 202px)}}
</style>
