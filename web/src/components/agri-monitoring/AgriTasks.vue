<template>
  <div class="agri-tasks">
    <!-- 列表 -->
    <div v-if="!visibleTask" class="task-list">
      <div class="tasks-head">
        <span class="list-caption">{{ currentLevel === 'village' ? '本月任务' : '当前区域任务' }}</span>
        <button type="button" class="view-all" @click="showAll = !showAll">查看全部任务</button>
      </div>
      <div class="status-filter" aria-label="任务状态筛选">
        <button v-for="s in statusFilters" :key="s" type="button" class="sf-item" :class="[`sf-${sfKey(s)}`, { active: statusFilter === s }]" @click="statusFilter = s">{{ s }}</button>
      </div>
      <div v-if="listTasks.length === 0" class="empty">暂无任务</div>
      <button v-for="t in listTasks" :key="t.id" type="button" class="task-row" @click="openTask(t.id)">
        <span class="task-main">
          <span class="task-eyebrow">{{ t.taskNo }}</span>
          <span class="task-name">{{ t.name }}</span>
          <span class="task-meta">{{ t.typeName }} · {{ t.villageName }} · {{ t.createdAt }}</span>
        </span>
        <span class="task-status" :class="`st-${statusKey(t.status)}`">{{ t.status }}</span>
      </button>
    </div>

    <!-- 详情卡片 -->
    <div v-else class="task-detail">
      <div class="detail-header">
        <button type="button" class="back-btn" aria-label="返回任务列表" @click="closeTask"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M15 18l-6-6 6-6"/></svg></button>
        <span class="detail-title">{{ visibleTask.taskNo }}</span>
      </div>

      <div class="detail-group">
        <div class="group-label">基础信息</div>
        <div class="detail-meta">
          <div class="meta-row"><span class="meta-label">状态</span><span class="meta-value"><span class="task-status" :class="`st-${statusKey(visibleTask.status)}`">{{ visibleTask.status }}</span></span></div>
          <div class="meta-row"><span class="meta-label">任务类型</span><span class="meta-value">{{ visibleTask.typeName }}</span></div>
          <div class="meta-row"><span class="meta-label">任务描述</span><span class="meta-value">{{ visibleTask.name }}</span></div>
          <div class="meta-row"><span class="meta-label">所在村</span><span class="meta-value">{{ visibleTask.villageName }}</span></div>
          <div class="meta-row"><span class="meta-label">创建时间</span><span class="meta-value">{{ visibleTask.createdAt }}</span></div>
          <div class="meta-row"><span class="meta-label">执行人</span><span class="meta-value">{{ visibleTask.executor ? `${visibleTask.executor.name}（${visibleTask.executor.role}）` : '未分配' }}</span></div>
        </div>
      </div>

      <div class="detail-group">
        <div class="group-label">处置说明</div>
        <div class="detail-sec"><div class="sec-label">SOP 动作</div><div class="sec-body">{{ visibleTask.sopAction }}</div></div>
        <div class="detail-sec"><div class="sec-label">执行要求</div><div class="sec-body">{{ visibleTask.requirement }}</div></div>
        <div class="detail-sec">
          <div class="sec-label">任务定位</div>
          <div class="sec-body loc-row">
            <span class="loc-text"><span class="loc-name">{{ visibleTask.location.name }}</span><span class="loc-coord">{{ visibleTask.location.lon.toFixed(4) }}, {{ visibleTask.location.lat.toFixed(4) }}</span></span>
            <button type="button" class="locate-icon" :aria-label="'定位到村'" :title="'定位到村'" @click="emit('locate-task', visibleTask.villageCode)">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 21s-6-5.5-6-10a6 6 0 1 1 12 0c0 4.5-6 10-6 10z"/><circle cx="12" cy="11" r="2"/></svg>
            </button>
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

    <!-- 查看全部任务：分户清单抽屉样式 -->
    <aside v-if="showAll" class="task-drawer" aria-label="全部任务">
      <header class="task-drawer-header">
        <div><span class="task-drawer-eyebrow">任务清单</span><h2 class="task-drawer-title">全部任务</h2></div>
        <button type="button" class="task-drawer-close" aria-label="关闭" @click="showAll = false">×</button>
      </header>
      <div class="task-drawer-list">
        <div v-if="allTasks.length === 0" class="empty">暂无任务</div>
        <button v-for="t in allTasks" :key="t.id" type="button" class="all-row" @click="selectFromAll(t.id)">
          <span class="task-name">{{ t.name }}</span>
          <span class="task-status" :class="`st-${statusKey(t.status)}`">{{ t.status }}</span>
          <span class="task-village">{{ t.villageName }}</span>
        </button>
      </div>
    </aside>

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

import { TASK_STATUSES, type AgriTask, type TaskStatus } from '../../features/agri-monitoring/agriMonitoringTypes'

const emit = defineEmits<{ 'locate-task': [code: string]; 'close-task': [] }>()
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

// 状态筛选
const statusFilter = ref<string>('全部')
const statusFilters = ['全部', ...TASK_STATUSES]
const sfKey = (s: string) => (s === '全部' ? 'all' : statusKey(s as TaskStatus))
// 与异常监测一致：非村层级显示全部村任务，进入某村显示该村任务；再按状态筛
const filteredTasks = computed(() => {
  let tasks = allTasks.value
  if (currentLevel.value === 'village') tasks = tasks.filter((t) => t.villageCode === currentCode.value)
  if (statusFilter.value !== '全部') tasks = tasks.filter((t) => t.status === statusFilter.value)
  return tasks
})
// 按日期倒序 + 只显示最近 10 条
const listTasks = computed(() => [...filteredTasks.value].sort((a, b) => b.createdAt.localeCompare(a.createdAt)).slice(0, 10))

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
.status-filter { display: flex; gap: 5px; margin-bottom: 10px; flex-wrap: wrap; padding-left: 4px; }
.sf-item { border: 0; border-radius: 999px; font-size: 11px; padding: 3px 10px; cursor: pointer; transition: opacity 0.12s ease, box-shadow 0.12s ease, font-weight 0.12s ease; }
.sf-item.active { font-weight: 700; box-shadow: 0 0 0 1.5px #2563eb; }
/* 与状态标签颜色对应 */
.sf-all { background: #e2e8f0; color: #475569; opacity: 0.75; }
.sf-all.active { opacity: 1; }
.sf-pending { background: #dbeafe; color: #1d4ed8; opacity: 0.6; }
.sf-pending.active { opacity: 1; }
.sf-claim { background: #ffedd5; color: #c2410c; opacity: 0.6; }
.sf-claim.active { opacity: 1; }
.sf-doing { background: #fef9c3; color: #a16207; opacity: 0.6; }
.sf-doing.active { opacity: 1; }
.sf-done { background: #dcfce7; color: #166534; opacity: 0.6; }
.sf-done.active { opacity: 1; }
.empty { padding: 12px; text-align: center; color: #94a3b8; font-size: 11px; }
/* 任务列表：内容滚动容器 */
.task-list { flex: 1 1 auto; min-height: 0; overflow-y: auto; }
.task-row { display: grid; grid-template-columns: 1fr auto; gap: 10px; align-items: center; width: 100%; padding: 13px 8px; border: 0; border-bottom: 1px solid rgba(148,163,184,0.14); background: transparent; cursor: pointer; color: #334155; text-align: left; transition: background 0.12s ease; }
.task-row:hover { background: #f8fafc; }
.task-main { display: flex; flex-direction: column; gap: 3px; min-width: 0; }
.task-eyebrow { font-size: 10px; font-weight: 600; color: #94a3b8; font-variant-numeric: tabular-nums; letter-spacing: 0.03em; }
.task-name { font-weight: 600; font-size: 13px; color: #0f172a; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.task-meta { font-size: 11px; color: #64748b; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.task-status { flex: none; font-size: 10px; font-weight: 600; padding: 2px 8px; border-radius: 999px; }
.st-pending { background: #dbeafe; color: #1d4ed8; }
.st-claim { background: #ffedd5; color: #c2410c; }
.st-doing { background: #fef9c3; color: #a16207; }
.st-done { background: #dcfce7; color: #166534; }
/* 详情卡片：内容滚动容器，避免证据被面板底部截断 */
.task-detail { flex: 1 1 auto; min-height: 0; overflow-y: auto; padding-right: 2px; }
.task-detail .detail-header { position: sticky; top: 0; z-index: 10; display: flex; align-items: center; gap: 8px; padding: 10px 0 12px; background: #fff; border-bottom: 1px solid rgba(148,163,184,0.2); margin-bottom: 14px; }
.back-btn { width: 24px; height: 24px; flex: none; display: grid; place-items: center; padding: 0; border: 0; border-radius: 6px; background: transparent; color: #2563eb; cursor: pointer; }
.back-btn:hover { background: #eff6ff; color: #1d4ed8; }
.back-btn svg { width: 18px; height: 18px; }
.detail-title { flex: 1; min-width: 0; font-size: 15px; font-weight: 700; color: #1e3a8a; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.detail-status { flex: none; font-size: 10px; font-weight: 600; padding: 2px 8px; border-radius: 999px; }
/* 详情分组：白色信息块 + 蓝色 kicker 分区标题 + 标签/值两列 */
.detail-group { padding: 14px; border-radius: 10px; background: #f8fafc; margin-bottom: 12px; }
.detail-group:last-child { margin-bottom: 0; }
.group-label { font-size: 11px; font-weight: 600; color: #2563eb; margin-bottom: 12px; letter-spacing: 0.02em; }
.detail-meta { display: flex; flex-direction: column; gap: 12px; }
.meta-row { display: flex; align-items: baseline; gap: 12px; font-size: 12px; color: #334155; }
.meta-label { width: 60px; flex: none; color: #64748b; }
.meta-value { flex: 1; color: #0f172a; overflow-wrap: anywhere; }
.detail-sec { margin-bottom: 16px; }
.detail-sec:last-child { margin-bottom: 0; }
.sec-label { font-size: 11px; color: #64748b; margin-bottom: 5px; }
.sec-body { font-size: 12px; color: #334155; line-height: 1.65; white-space: pre-line; }
.loc-row { display: flex; align-items: center; justify-content: space-between; gap: 10px; }
.loc-text { display: flex; flex-direction: column; gap: 2px; min-width: 0; }
.loc-name { font-weight: 600; color: #0f172a; }
.loc-coord { font-size: 11px; color: #64748b; font-variant-numeric: tabular-nums; }
.locate-icon { flex: none; display: grid; place-items: center; width: 26px; height: 26px; border: 0; border-radius: 6px; background: #eff6ff; color: #2563eb; cursor: pointer; }
.locate-icon svg { width: 15px; height: 15px; }
.locate-icon:hover { background: #dbeafe; color: #1d4ed8; }
.ev-grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 6px; }
.ev-thumb { position: relative; border: 0; padding: 0; border-radius: 6px; overflow: hidden; cursor: pointer; background: #e2e8f0; }
.ev-thumb img { width: 100%; height: 64px; object-fit: cover; display: block; }
.ev-time { position: absolute; bottom: 0; left: 0; right: 0; font-size: 9px; color: #fff; background: rgba(0,0,0,0.6); padding: 2px 3px; }
/* 查看全部任务：分户清单抽屉样式（右侧固定抽屉） */
.task-drawer { position: fixed; top: 0; right: 0; bottom: 0; width: min(430px, 88vw); z-index: 1150; display: flex; flex-direction: column; background: #fff; box-shadow: -8px 0 28px rgba(15,23,42,0.2); }
.task-drawer-header { display: flex; align-items: flex-start; justify-content: space-between; padding: 14px 16px; border-bottom: 1px solid #e2e8f0; }
.task-drawer-eyebrow { display: block; font-size: 11px; color: #2563eb; font-weight: 600; letter-spacing: 0.02em; margin-bottom: 2px; }
.task-drawer-title { font-size: 17px; font-weight: 700; color: #0f172a; margin: 0; }
.task-drawer-close { border: 0; background: transparent; color: #64748b; font-size: 20px; cursor: pointer; line-height: 1; }
.task-drawer-close:hover { color: #0f172a; }
.task-drawer-list { flex: 1 1 auto; min-height: 0; overflow-y: auto; padding: 6px; }
.all-row { display: grid; grid-template-columns: 1fr auto auto; gap: 8px; align-items: center; width: 100%; padding: 10px 8px; border: 0; border-bottom: 1px solid rgba(148,163,184,0.12); background: transparent; cursor: pointer; text-align: left; }
.all-row:hover { background: #f8fafc; }
.lightbox-overlay { position: fixed; inset: 0; z-index: 1200; background: rgba(15,23,42,0.4); display: flex; align-items: center; justify-content: center; }
.lightbox { position: relative; }
.lightbox img { max-width: 80vw; max-height: 80vh; border-radius: 8px; }
.lb-time { display: block; text-align: center; color: #fff; margin-top: 6px; }
.lightbox .close-btn { position: absolute; top: -26px; right: 0; color: #fff; background: rgba(0,0,0,0.5); border-radius: 4px; font-size: 12px; padding: 2px 6px; }
</style>
