<template>
  <div class="agri-tasks">
    <!-- 列表 -->
    <div v-if="!visibleTask" class="task-list">
      <div class="tasks-head">
        <span class="list-caption">{{ currentLevel === 'village' ? '本月任务' : '当前区域任务' }}</span>
        <button type="button" class="view-all" @click="showAll = !showAll">查看全部任务</button>
      </div>
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
        <button type="button" class="back-btn" aria-label="返回任务列表" @click="closeTask"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M15 18l-6-6 6-6"/></svg></button>
        <span class="detail-title">{{ visibleTask.name }}</span>
      </div>

      <div class="detail-group">
        <div class="group-label">基础信息</div>
        <div class="detail-meta">
          <div class="meta-row"><span class="meta-label">状态</span><span class="meta-value"><span class="task-status" :class="`st-${statusKey(visibleTask.status)}`">{{ visibleTask.status }}</span></span></div>
          <div class="meta-row"><span class="meta-label">类型</span><span class="meta-value">{{ visibleTask.typeName }}</span></div>
          <div class="meta-row"><span class="meta-label">所在村</span><span class="meta-value">{{ visibleTask.villageName }}</span></div>
          <div class="meta-row"><span class="meta-label">创建时间</span><span class="meta-value">{{ visibleTask.createdAt }}</span></div>
          <div class="meta-row"><span class="meta-label">执行人</span><span class="meta-value">{{ visibleTask.executor ? `${visibleTask.executor.name}（${visibleTask.executor.role}）` : '未分配' }}</span></div>
        </div>
      </div>

      <div class="detail-group">
        <div class="group-label">处置说明</div>
        <div class="detail-sec"><div class="sec-label">备注</div><div class="sec-body">{{ visibleTask.remark || '无' }}</div></div>
        <div class="detail-sec"><div class="sec-label">SOP 动作</div><div class="sec-body">{{ visibleTask.sopAction }}</div></div>
        <div class="detail-sec"><div class="sec-label">执行要求</div><div class="sec-body">{{ visibleTask.requirement }}</div></div>
        <div class="detail-sec">
          <div class="sec-label">任务定位</div>
          <div class="sec-body loc-row">
            <span class="loc-text"><span class="loc-name">{{ visibleTask.location.name }}</span><span class="loc-coord">{{ visibleTask.location.lon.toFixed(4) }}, {{ visibleTask.location.lat.toFixed(4) }}</span></span>
            <button type="button" class="locate-btn" @click="emit('locate-task', visibleTask.location)">定位到地图</button>
          </div>
        </div>
      </div>

      <div class="detail-group">
        <div class="group-label">取证</div>
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
.agri-tasks { font-size: 12px; display: flex; flex-direction: column; flex: 1 1 auto; min-height: 0; }
.tasks-head { display: flex; align-items: center; justify-content: space-between; margin-bottom: 10px; }
.list-caption { font-size: 15px; font-weight: 700; color: #1e3a8a; }
.view-all { border: 0; background: transparent; color: #2563eb; font-size: 11px; cursor: pointer; padding: 2px 4px; border-radius: 4px; }
.view-all:hover { background: #eef2f7; }
.empty { padding: 12px; text-align: center; color: #94a3b8; font-size: 11px; }
/* 任务列表：内容滚动容器 */
.task-list { flex: 1 1 auto; min-height: 0; overflow-y: auto; }
.task-row { display: grid; grid-template-columns: 1fr auto auto auto; gap: 8px; align-items: center; width: 100%; padding: 14px 8px; border: 0; border-bottom: 1px solid rgba(148,163,184,0.14); background: transparent; cursor: pointer; color: #334155; text-align: left; transition: background 0.12s ease; }
.task-row:hover { background: #f8fafc; }
.task-name { font-weight: 600; font-size: 13px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.task-type { color: #64748b; font-size: 11px; }
.task-status { font-size: 10px; font-weight: 600; padding: 2px 8px; border-radius: 999px; }
.st-pending { background: #dbeafe; color: #1d4ed8; }
.st-claim { background: #ffedd5; color: #c2410c; }
.st-doing { background: #fef9c3; color: #a16207; }
.st-done { background: #dcfce7; color: #166534; }
.task-village { color: #64748b; font-size: 11px; }
.task-time { color: #94a3b8; font-size: 10px; font-variant-numeric: tabular-nums; }
/* 详情卡片：内容滚动容器，避免证据被面板底部截断 */
.task-detail { flex: 1 1 auto; min-height: 0; overflow-y: auto; padding-right: 2px; }
.task-detail .detail-header { display: flex; align-items: center; justify-content: flex-start; gap: 6px; padding: 0 0 10px; border-bottom: 1px solid rgba(148,163,184,0.2); margin-bottom: 10px; }
.back-btn { width: 24px; height: 24px; flex: none; display: grid; place-items: center; padding: 0; border: 0; border-radius: 6px; background: transparent; color: #2563eb; cursor: pointer; }
.back-btn:hover { background: #eff6ff; color: #1d4ed8; }
.back-btn svg { width: 18px; height: 18px; }
.detail-title { flex: 1; min-width: 0; font-size: 15px; font-weight: 700; color: #1e3a8a; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
/* 详情分组：设计系统 Detail Sections（白色信息块 + 蓝色 kicker 分区标题 + 标签/值两列） */
.detail-group { padding: 10px 12px; border-radius: 10px; background: #f8fafc; margin-bottom: 8px; }
.detail-group:last-child { margin-bottom: 0; }
.group-label { font-size: 11px; font-weight: 600; color: #2563eb; margin-bottom: 8px; letter-spacing: 0.02em; }
.detail-meta { display: flex; flex-direction: column; gap: 8px; }
.meta-row { display: flex; align-items: baseline; gap: 12px; font-size: 12px; color: #334155; }
.meta-label { width: 52px; flex: none; color: #64748b; }
.meta-value { flex: 1; color: #0f172a; overflow-wrap: anywhere; }
.detail-sec { margin-bottom: 10px; }
.detail-sec:last-child { margin-bottom: 0; }
.sec-label { font-size: 11px; color: #64748b; margin-bottom: 3px; }
.sec-body { font-size: 12px; color: #334155; line-height: 1.55; }
.loc-row { display: flex; align-items: center; justify-content: space-between; gap: 10px; }
.loc-text { display: flex; flex-direction: column; gap: 2px; min-width: 0; }
.loc-name { font-weight: 600; color: #0f172a; }
.loc-coord { font-size: 11px; color: #64748b; font-variant-numeric: tabular-nums; }
.locate-btn { flex: none; padding: 4px 10px; border: 0; border-radius: 6px; background: #2563eb; color: #fff; font-size: 12px; cursor: pointer; }
.locate-btn:hover { background: #1d4ed8; }
.ev-grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 6px; }
.ev-thumb { position: relative; border: 0; padding: 0; border-radius: 6px; overflow: hidden; cursor: pointer; background: #e2e8f0; }
.ev-thumb img { width: 100%; height: 64px; object-fit: cover; display: block; }
.ev-time { position: absolute; bottom: 0; left: 0; right: 0; font-size: 9px; color: #fff; background: rgba(0,0,0,0.6); padding: 2px 3px; }
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
