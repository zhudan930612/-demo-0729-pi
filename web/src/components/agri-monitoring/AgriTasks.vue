<template>
  <div class="agri-tasks">
    <div class="tasks-head">
      <span class="list-caption">{{ currentLevel === 'village' ? '本月任务' : '当前区域任务' }}</span>
      <button type="button" class="view-all" @click="showAll = !showAll">查看全部任务</button>
    </div>

    <!-- 列表 -->
    <div v-if="!visibleTask" class="task-list">
      <div v-if="filteredTasks.length === 0" class="empty">暂无任务</div>
      <button v-for="t in filteredTasks" :key="t.id" type="button" class="task-row" @click="openTask(t.id)">
        <span class="task-name">{{ t.name }}</span>
        <span class="task-type">{{ t.typeName }}</span>
        <span class="task-status" :class="`st-${statusKey(t.status)}`">{{ t.status }}</span>
        <span class="task-village">{{ t.villageName }}</span>
        <span class="task-time">{{ t.createdAt }}</span>
      </button>
    </div>

    <!-- 详情卡片 -->
    <div v-else class="task-detail">
      <div class="detail-header">
        <button type="button" class="back-btn" aria-label="返回任务列表" @click="closeTask">‹</button>
        <div class="detail-title-col">
          <span class="detail-title">{{ visibleTask.name }}</span>
          <span class="task-status" :class="`st-${statusKey(visibleTask.status)}`">{{ visibleTask.status }}</span>
        </div>
      </div>
      <div class="detail-meta">
        <div class="meta-row"><span class="meta-label">类型</span><span>{{ visibleTask.typeName }}</span></div>
        <div class="meta-row"><span class="meta-label">所在村</span><span>{{ visibleTask.villageName }}</span></div>
        <div class="meta-row"><span class="meta-label">创建时间</span><span>{{ visibleTask.createdAt }}</span></div>
        <div class="meta-row"><span class="meta-label">执行人</span><span>{{ visibleTask.executor ? `${visibleTask.executor.name}（${visibleTask.executor.role}）` : '未分配' }}</span></div>
      </div>
      <div class="detail-sec"><div class="sec-label">备注</div><div class="sec-body">{{ visibleTask.remark || '无' }}</div></div>
      <div class="detail-sec"><div class="sec-label">SOP 动作</div><div class="sec-body">{{ visibleTask.sopAction }}</div></div>
      <div class="detail-sec"><div class="sec-label">执行要求</div><div class="sec-body">{{ visibleTask.requirement }}</div></div>
      <div class="detail-sec">
        <div class="sec-label">任务定位</div>
        <div class="sec-body loc-row">
          <span>{{ visibleTask.location.name }}（{{ visibleTask.location.lon.toFixed(4) }}, {{ visibleTask.location.lat.toFixed(4) }}）</span>
          <button type="button" class="locate-btn" @click="emit('locate-task', visibleTask.location)">定位到地图</button>
        </div>
      </div>
      <div class="detail-sec">
        <div class="sec-label">取证时间</div>
        <div class="sec-body">{{ visibleTask.evidence.length > 0 ? visibleTask.evidence[0].time : '—' }}</div>
      </div>
      <div class="detail-sec">
        <div class="sec-label">证据</div>
        <div v-if="visibleTask.evidence.length === 0" class="sec-body">暂无证据</div>
        <div v-else class="ev-grid">
          <button v-for="e in visibleTask.evidence" :key="e.url" type="button" class="ev-thumb" @click="openLightbox(e)">
            <img :src="e.url" alt="证据缩略图" />
            <span class="ev-time">{{ e.time }}</span>
          </button>
        </div>
      </div>
    </div>

    <!-- 查看全部任务浮窗 -->
    <div v-if="showAll" class="all-overlay" @click.self="showAll = false">
      <div class="all-panel">
        <div class="all-head"><span>全部任务</span><button type="button" class="close-btn" aria-label="关闭" @click="showAll = false">✕</button></div>
        <div class="all-list">
          <div v-if="allTasks.length === 0" class="empty">暂无任务</div>
          <button v-for="t in allTasks" :key="t.id" type="button" class="all-row" @click="selectFromAll(t.id)">
            <span class="task-name">{{ t.name }}</span>
            <span class="task-status" :class="`st-${statusKey(t.status)}`">{{ t.status }}</span>
            <span class="task-village">{{ t.villageName }}</span>
          </button>
        </div>
      </div>
    </div>

    <!-- 大图浮窗 -->
    <div v-if="lightbox" class="lightbox-overlay" @click.self="lightbox = null">
      <div class="lightbox"><img :src="lightbox.url" alt="证据大图" /><span class="lb-time">{{ lightbox.time }}</span><button type="button" class="close-btn" @click="lightbox = null">✕</button></div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue'
import { useDrilldownStore } from '../../stores/drilldown'
import { useAgriMonitoringStore } from '../../stores/agriMonitoring'
import { tasksForRegion } from '../../features/agri-monitoring/agriMonitoringData'
import type { AgriTask, TaskStatus } from '../../features/agri-monitoring/agriMonitoringTypes'

const emit = defineEmits<{ 'locate-task': [location: { lon: number; lat: number; name: string }]; 'close-task': [] }>()
const store = useDrilldownStore()
const agri = useAgriMonitoringStore()
const showAll = ref(false)
const lightbox = ref<{ url: string; time: string } | null>(null)

const allTasks = computed(() => agri.allTasks)
const currentLevel = computed(() => store.current.level)
const currentCode = computed(() => store.current.code)

const visibleTask = computed<AgriTask | null>(() => {
  if (!agri.openTaskId) return null
  return allTasks.value.find((t) => t.id === agri.openTaskId) ?? null
})

const statusKey = (s: TaskStatus) => (s === '待下发' ? 'pending' : s === '待领取' ? 'claim' : s === '进行中' ? 'doing' : 'done')

// 不同层级查看相应层级任务（R5-6）
const filteredTasks = computed(() => tasksForRegion(allTasks.value, agri.villages, currentLevel.value, currentCode.value))

function openTask(id: string) { agri.openTask(id) }
function closeTask() { agri.closeTask(); emit('close-task') }
function selectFromAll(id: string) { showAll.value = false; openTask(id) }
function openLightbox(e: { url: string; time: string }) { lightbox.value = e }
</script>

<style scoped>
.agri-tasks { font-size: 12px; }
.tasks-head { display: flex; align-items: center; justify-content: space-between; margin-bottom: 6px; }
.list-caption { font-size: 10px; color: #475569; }
.view-all { border: 0; background: transparent; color: #2563eb; font-size: 11px; cursor: pointer; padding: 2px 4px; border-radius: 4px; }
.view-all:hover { background: #eef2f7; }
.empty { padding: 12px; text-align: center; color: #94a3b8; font-size: 11px; }
.task-row { display: grid; grid-template-columns: 1fr auto auto auto; gap: 6px; align-items: center; width: 100%; padding: 6px 4px; border: 0; border-bottom: 1px solid rgba(148,163,184,0.12); background: transparent; cursor: pointer; color: #334155; text-align: left; }
.task-row:hover { background: #eef2f7; }
.task-name { font-weight: 600; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.task-type { color: #64748b; font-size: 10px; }
.task-status { font-size: 10px; font-weight: 600; padding: 1px 6px; border-radius: 999px; }
.st-pending { background: #dbeafe; color: #1d4ed8; }
.st-claim { background: #ffedd5; color: #c2410c; }
.st-doing { background: #fef9c3; color: #a16207; }
.st-done { background: #dcfce7; color: #166534; }
.task-village { color: #64748b; font-size: 11px; }
.task-time { color: #94a3b8; font-size: 10px; font-variant-numeric: tabular-nums; }
.task-detail .detail-header { display: flex; align-items: center; gap: 4px; margin-bottom: 8px; }
.back-btn { width: 22px; height: 22px; border: 0; border-radius: 5px; background: transparent; color: #2563eb; font-size: 16px; cursor: pointer; }
.detail-title-col { display: flex; align-items: center; gap: 6px; }
.detail-title { font-size: 14px; font-weight: 600; color: #0f172a; }
.detail-meta { margin-bottom: 6px; }
.meta-row { display: flex; gap: 8px; padding: 2px 0; font-size: 11px; color: #334155; }
.meta-label { width: 56px; flex: none; color: #94a3b8; }
.detail-sec { margin-bottom: 6px; }
.sec-label { font-size: 10px; color: #94a3b8; margin-bottom: 2px; }
.sec-body { font-size: 11px; color: #334155; line-height: 1.4; }
.loc-row { display: flex; align-items: center; gap: 8px; }
.locate-btn { padding: 3px 8px; border: 0; border-radius: 5px; background: #2563eb; color: #fff; font-size: 11px; cursor: pointer; }
.locate-btn:hover { background: #1d4ed8; }
.ev-grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 4px; }
.ev-thumb { position: relative; border: 0; padding: 0; border-radius: 4px; overflow: hidden; cursor: pointer; background: #e2e8f0; }
.ev-thumb img { width: 100%; height: 56px; object-fit: cover; display: block; }
.ev-time { position: absolute; bottom: 0; left: 0; right: 0; font-size: 8px; color: #fff; background: rgba(0,0,0,0.55); padding: 1px 2px; }
.all-overlay, .lightbox-overlay { position: fixed; inset: 0; z-index: 1200; background: rgba(15,23,42,0.4); display: flex; align-items: center; justify-content: center; }
.all-panel { width: min(440px, calc(100% - 20px)); max-height: 70vh; background: #fff; border-radius: 10px; box-shadow: 0 12px 30px rgba(15,23,42,0.25); display: flex; flex-direction: column; overflow: hidden; }
.all-head { display: flex; align-items: center; justify-content: space-between; padding: 10px 12px; border-bottom: 1px solid #e2e8f0; font-weight: 600; }
.close-btn { border: 0; background: transparent; color: #64748b; cursor: pointer; font-size: 14px; }
.all-list { overflow: auto; padding: 4px; }
.all-row { display: grid; grid-template-columns: 1fr auto auto; gap: 8px; align-items: center; width: 100%; padding: 7px 8px; border: 0; background: transparent; cursor: pointer; text-align: left; }
.all-row:hover { background: #eef2f7; }
.lightbox { position: relative; }
.lightbox img { max-width: 80vw; max-height: 80vh; border-radius: 8px; }
.lb-time { display: block; text-align: center; color: #fff; margin-top: 6px; }
.lightbox .close-btn { position: absolute; top: -26px; right: 0; color: #fff; background: rgba(0,0,0,0.5); border-radius: 4px; font-size: 12px; padding: 2px 6px; }
</style>
