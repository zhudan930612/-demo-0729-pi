<template>
  <div class="agri-tasks">
    <!-- 列表 -->
    <div v-if="!visibleTask" class="task-list">
      <div class="tasks-head">
        <span class="list-caption">任务列表</span>
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
      <button v-if="listTasks.length" type="button" class="view-all-bottom" @click="showAll = true">查看全部任务</button>
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
          <div class="meta-row"><span class="meta-label">关联保单</span><span class="meta-value">{{ visibleTask.policyNo ? `${visibleTask.policyNo} · ${visibleTask.policyInsuredName}` : '—' }}</span></div>
          <div class="meta-row"><span class="meta-label">任务定位</span><span class="meta-value loc-value">{{ visibleTask.villageName }}<button type="button" class="locate-icon" :aria-label="'定位到村'" :title="'定位到村'" @click="emit('locate-task', visibleTask.villageCode, visibleTask.id)"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 21s-6-5.5-6-10a6 6 0 1 1 12 0c0 4.5-6 10-6 10z"/><circle cx="12" cy="11" r="2"/></svg></button></span></div>
          <div class="meta-row"><span class="meta-label">创建时间</span><span class="meta-value">{{ visibleTask.createdAt }}</span></div>
          <div class="meta-row"><span class="meta-label">执行人</span><span class="meta-value">{{ visibleTask.executor ? `${visibleTask.executor.role} · ${visibleTask.executor.name}` : '未分配' }}</span></div>
        </div>
      </div>

      <div class="detail-group">
        <div class="group-label">处置说明</div>
        <div class="detail-sec"><div class="sec-label">SOP 动作</div><div class="sec-body">{{ visibleTask.sopAction }}</div></div>
        <div class="detail-sec"><div class="sec-label">执行要求</div><div class="sec-body">{{ visibleTask.requirement }}</div></div>

      </div>

      <div class="detail-group">
        <div class="group-label">影像资料</div>
        <div class="detail-sec">
          <div class="sec-label">提交时间</div>
          <div class="sec-body">{{ visibleTask.evidence.length > 0 ? visibleTask.evidence[0].time : '—' }}</div>
        </div>
        <div v-if="visibleTask.evidence.length === 0" class="sec-body">暂无影像</div>
        <div v-else class="ev-grid">
          <button v-for="e in visibleTask.evidence" :key="e.url" type="button" class="ev-thumb" @click="openLightbox(e)">
            <img :src="e.url" alt="影像缩略图" />
            <span class="ev-time">{{ e.time }}</span>
          </button>
        </div>
      </div>
    </div>

    <!-- 全部任务：分户清单抽屉样式 -->
    <Teleport to="body">
    <Transition name="side-drawer">
    <aside v-if="showAll" class="task-drawer" aria-label="全部任务">
      <header class="task-drawer-header">
        <div><span class="task-drawer-eyebrow">任务清单</span><h2 class="task-drawer-title">全部任务</h2></div>
        <button type="button" class="task-drawer-close" aria-label="关闭" @click="showAll = false">×</button>
      </header>

      <!-- 统计概况：可点击作为列表筛选 -->
      <section class="task-drawer-summary">
        <button v-for="s in drawerStati" :key="s" type="button" class="ds-item" :class="[`ds-${sfKey(s)}`, { active: drawerStatus === s }]" @click="drawerStatus = s">
          <span>{{ s }}</span><strong>{{ s === '总任务' ? allTasks.length : statusCount(s) }}</strong>
        </button>
      </section>

      <!-- 左右分栏：左卡片列表 + 右详情 -->
      <div v-if="drawerTaskId && drawerTask" class="task-drawer-split">
        <section class="task-drawer-list-pane">
          <div class="task-drawer-tools">
            <input v-model.trim="query" type="search" placeholder="搜索任务名称或村" />
              </div>
          <div class="task-drawer-cards">
            <div v-if="pageItems.length === 0" class="empty">暂无任务</div>
            <button v-for="t in pageItems" :key="t.id" type="button" class="drawer-card" :class="{ active: drawerTaskId === t.id }" @click="selectFromDrawer(t.id)">
              <span class="dc-main">
                <span class="dc-eyebrow">{{ t.taskNo }}</span>
                <span class="dc-name">{{ t.name }}</span>
                <span class="dc-meta">{{ t.typeName }} · {{ t.villageName }} · {{ t.createdAt }}</span>
              </span>
              <span class="task-status" :class="`st-${statusKey(t.status)}`">{{ t.status }}</span>
            </button>
          </div>
          <footer class="task-drawer-pagination">
            <button :disabled="page === 1" @click="page--">上一页</button>
            <span>第 {{ page }} / {{ totalPages }} 页</span>
            <button :disabled="page === totalPages" @click="page++">下一页</button>
          </footer>
        </section>
        <section class="task-drawer-detail-pane">
          <header class="task-drawer-detail-head">
            <button type="button" class="back-btn" aria-label="返回任务列表" @click="closeDrawerDetail"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M15 18l-6-6 6-6"/></svg></button>
            <span class="detail-title">{{ drawerTask.taskNo }}</span>
          </header>
          <div class="task-detail-scroll">
            <div class="detail-group">
              <div class="group-label">基础信息</div>
              <div class="detail-meta">
                <div class="meta-row"><span class="meta-label">状态</span><span class="meta-value"><span class="task-status" :class="`st-${statusKey(drawerTask.status)}`">{{ drawerTask.status }}</span></span></div>
                <div class="meta-row"><span class="meta-label">任务类型</span><span class="meta-value">{{ drawerTask.typeName }}</span></div>
                <div class="meta-row"><span class="meta-label">任务描述</span><span class="meta-value">{{ drawerTask.name }}</span></div>
                <div class="meta-row"><span class="meta-label">关联保单</span><span class="meta-value">{{ drawerTask.policyNo ? `${drawerTask.policyNo} · ${drawerTask.policyInsuredName}` : '—' }}</span></div>
                <div class="meta-row"><span class="meta-label">任务定位</span><span class="meta-value loc-value">{{ drawerTask.villageName }}<button type="button" class="locate-icon" :aria-label="'定位到村'" :title="'定位到村'" @click="emit('locate-task', drawerTask.villageCode, drawerTask.id)"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 21s-6-5.5-6-10a6 6 0 1 1 12 0c0 4.5-6 10-6 10z"/><circle cx="12" cy="11" r="2"/></svg></button></span></div>
                <div class="meta-row"><span class="meta-label">创建时间</span><span class="meta-value">{{ drawerTask.createdAt }}</span></div>
                <div class="meta-row"><span class="meta-label">执行人</span><span class="meta-value">{{ drawerTask.executor ? `${drawerTask.executor.role} · ${drawerTask.executor.name}` : '未分配' }}</span></div>
              </div>
            </div>
            <div class="detail-group">
              <div class="group-label">处置说明</div>
              <div class="detail-sec"><div class="sec-label">SOP 动作</div><div class="sec-body">{{ drawerTask.sopAction }}</div></div>
              <div class="detail-sec"><div class="sec-label">执行要求</div><div class="sec-body">{{ drawerTask.requirement }}</div></div>
            </div>
            <div class="detail-group">
              <div class="group-label">影像资料</div>
              <div class="detail-sec">
                <div class="sec-label">提交时间</div>
                <div class="sec-body">{{ drawerTask.evidence.length > 0 ? drawerTask.evidence[0]!.time : '—' }}</div>
              </div>
              <div v-if="drawerTask.evidence.length === 0" class="sec-body">暂无影像</div>
              <div v-else class="ev-grid">
                <button v-for="e in drawerTask.evidence" :key="e.url" type="button" class="ev-thumb" @click="openLightbox(e)"><img :src="e.url" alt="影像缩略图" /><span class="ev-time">{{ e.time }}</span></button>
              </div>
            </div>
          </div>
        </section>
      </div>

      <!-- 列表态：搜索 + 表格 + 分页 -->
      <template v-else>
        <div class="task-drawer-tools">
          <input v-model.trim="query" type="search" placeholder="搜索任务名称或村" />
          </div>
        <div class="task-drawer-list">
          <div v-if="pageItems.length === 0" class="empty">暂无任务</div>
          <table>
            <thead><tr><th>序号</th><th>任务编号</th><th>任务名称</th><th>类型</th><th>状态</th><th>村</th><th>创建时间</th></tr></thead>
            <tbody>
              <tr v-for="(t, idx) in pageItems" :key="t.id" @click="selectFromDrawer(t.id)">
                <td>{{ (page - 1) * pageSize + idx + 1 }}</td>
                <td class="t-no">{{ t.taskNo }}</td>
                <td class="t-name">{{ t.name }}</td>
                <td>{{ t.typeName }}</td>
                <td><span class="task-status" :class="`st-${statusKey(t.status)}`">{{ t.status }}</span></td>
                <td>{{ t.villageName }}</td>
                <td class="t-time">{{ t.createdAt }}</td>
              </tr>
            </tbody>
          </table>
        </div>
        <footer class="task-drawer-pagination">
          <button :disabled="page === 1" @click="page--">上一页</button>
          <span>第 {{ page }} / {{ totalPages }} 页</span>
          <button :disabled="page === totalPages" @click="page++">下一页</button>
        </footer>
      </template>
    </aside>
    </Transition>
    </Teleport>

    <!-- 大图浮窗 -->
    <div v-if="lightbox" class="lightbox-overlay" @click.self="lightbox = null">
      <div class="lightbox"><img :src="lightbox.url" alt="证据大图" /><span class="lb-time">{{ lightbox.time }}</span><button type="button" class="close-btn" @click="lightbox = null">✕</button></div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { useDrilldownStore } from '../../stores/drilldown'
import { useAgriMonitoringStore } from '../../stores/agriMonitoring'

import { TASK_STATUSES, type AgriTask, type TaskStatus } from '../../features/agri-monitoring/agriMonitoringTypes'

const emit = defineEmits<{ 'locate-task': [code: string, seed: string]; 'close-task': [] }>()
const store = useDrilldownStore()
const agri = useAgriMonitoringStore()
const showAll = ref(false)
watch(showAll, (v) => { agri.taskDrawerOpen = v })  // 抽屉打开时隐藏长势监测·时序区
const lightbox = ref<{ url: string; time: string } | null>(null)

const allTasks = computed(() => agri.allTasks)
const currentLevel = computed(() => store.current.level)
const currentCode = computed(() => store.current.code)

// 全部任务抽屉：搜索/分页/状态统计
const query = ref('')
const page = ref(1)
const pageSize = 10
const drawerStatus = ref<string>('总任务')  // 顶部统计概况筛选
const drawerStati = ['总任务', '待下发', '待领取', '进行中', '已完成']
const filteredAll = computed(() => {
  let tasks = allTasks.value
  if (drawerStatus.value !== '总任务') tasks = tasks.filter((t) => t.status === drawerStatus.value)
  const v = query.value.toLowerCase()
  if (v) tasks = tasks.filter((t) => [t.name, t.villageName, t.taskNo].some((f) => f.toLowerCase().includes(v)))
  return tasks
})
const totalPages = computed(() => Math.max(1, Math.ceil(filteredAll.value.length / pageSize)))
const pageItems = computed(() => filteredAll.value.slice((page.value - 1) * pageSize, page.value * pageSize))
watch(query, () => { page.value = 1 })
watch(drawerStatus, () => { page.value = 1 })  // 状态切换返回第1页
function statusCount(s: string) { return allTasks.value.filter((t) => t.status === s).length }

// 全部任务抽屉：点击任务 → 左右分栏（左卡片列表 + 右详情）
const drawerTaskId = ref<string | null>(null)
const drawerTask = computed<AgriTask | null>(() => drawerTaskId.value ? allTasks.value.find((t) => t.id === drawerTaskId.value) ?? null : null)
function selectFromDrawer(id: string) { drawerTaskId.value = id }
function closeDrawerDetail() { drawerTaskId.value = null }

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

function openLightbox(e: { url: string; time: string }) { lightbox.value = e }
</script>

<style scoped>
.agri-tasks { font-size: 12px; display: flex; flex-direction: column; flex: 1 1 auto; min-height: 0; }
.tasks-head { display: flex; align-items: center; justify-content: space-between; margin-bottom: 10px; }
.list-caption { font-size: 15px; font-weight: 700; color: #1e3a8a; }
.view-all-bottom { display: block; width: 100%; padding: 13px; border: 0; border-top: 1px solid #e2e8f0; background: transparent; color: #2563eb; font-size: 12px; font-weight: 600; cursor: pointer; }
.view-all-bottom:hover { background: #eef2f7; }
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
.loc-value { display: inline-flex; align-items: center; gap: 8px; }
.loc-value .locate-icon { width: 24px; height: 24px; }
.locate-icon { flex: none; display: grid; place-items: center; width: 26px; height: 26px; border: 0; border-radius: 6px; background: #eff6ff; color: #2563eb; cursor: pointer; }
.locate-icon svg { width: 15px; height: 15px; }
.locate-icon:hover { background: #dbeafe; color: #1d4ed8; }
.ev-grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 6px; }
.ev-thumb { position: relative; border: 0; padding: 0; border-radius: 6px; overflow: hidden; cursor: pointer; background: #e2e8f0; }
.ev-thumb img { width: 100%; height: 64px; object-fit: cover; display: block; }
.ev-time { position: absolute; bottom: 0; left: 0; right: 0; font-size: 9px; color: #fff; background: rgba(0,0,0,0.6); padding: 2px 3px; }
/* 全部任务：与分户清单抽屉一致（右侧圆角模糊抽屉 + roster-header + roster 列表行） */
.task-drawer { position: fixed; top: 0; right: 0; bottom: 0; z-index: 1150; width: min(920px, calc(100vw - 104px)); display: flex; flex-direction: column; overflow: hidden; border: 1px solid rgba(148,163,184,0.35); border-right: 0; border-radius: 16px 0 0 16px; background: rgba(248,250,252,0.98); box-shadow: -10px 18px 48px rgba(15,23,42,0.22); color: #0f172a; backdrop-filter: blur(18px); will-change: transform; }
.task-drawer-header { display: flex; align-items: flex-start; justify-content: space-between; gap: 16px; padding: 18px 20px 14px; border-bottom: 1px solid #e2e8f0; background: #fff; }
.task-drawer-eyebrow { display: block; color: #64748b; font-size: 11px; font-weight: 650; }
.task-drawer-title { margin: 4px 0 0; overflow-wrap: anywhere; color: #0f172a; font-size: 17px; line-height: 1.3; font-variant-numeric: tabular-nums; }
.task-drawer-close { width: 34px; height: 34px; flex: none; border: 0; border-radius: 50%; background: #e2e8f0; color: #334155; font-size: 24px; cursor: pointer; }
.task-drawer-close:hover { background: #cbd5e1; }
.task-drawer-summary { display: grid; grid-template-columns: repeat(5, 1fr); gap: 1px; background: #e2e8f0; }
.ds-item { display: flex; flex-direction: column; align-items: flex-start; gap: 3px; padding: 12px 16px; background: #fff; border: 0; cursor: pointer; text-align: left; transition: background 0.12s ease; }
.ds-item.active { background: #eff6ff; }
.ds-item:hover { background: #f1f5f9; }
.ds-item span { font-size: 11px; }
.ds-item strong { font-size: 15px; font-variant-numeric: tabular-nums; }
/* 概况文字颜色与状态对应 */
.ds-item.ds-all span { color: #64748b; } .ds-item.ds-all strong { color: #0f172a; }
.ds-item.ds-pending span { color: #1d4ed8; } .ds-item.ds-pending strong { color: #1d4ed8; }
.ds-item.ds-claim span { color: #c2410c; } .ds-item.ds-claim strong { color: #c2410c; }
.ds-item.ds-doing span { color: #a16207; } .ds-item.ds-doing strong { color: #a16207; }
.ds-item.ds-done span { color: #166534; } .ds-item.ds-done strong { color: #166534; }
.task-drawer-tools { display: flex; align-items: center; justify-content: space-between; gap: 15px; padding: 14px 18px; }
.task-drawer-tools input { min-width: 0; padding: 8px 10px; border: 1px solid #cbd5e1; border-radius: 8px; background: #fff; font: inherit; font-size: 12px; width: 280px; }
.task-drawer-tools span { color: #64748b; font-size: 12px; }
.task-drawer-list { flex: 1 1 auto; min-height: 0; overflow: auto; }
.task-drawer-list table { width: 100%; border-collapse: collapse; background: #fff; font-size: 12px; white-space: nowrap; }
.task-drawer-list th, .task-drawer-list td { padding: 10px; border-bottom: 1px solid #e2e8f0; text-align: left; }
.task-drawer-list tbody tr { cursor: pointer; }
.task-drawer-list tbody tr:hover { background: #ecfeff; }
.task-drawer-list .t-no { color: #94a3b8; font-variant-numeric: tabular-nums; }
.task-drawer-list .t-name { font-weight: 600; color: #0f172a; }
.task-drawer-list .t-time { color: #64748b; font-variant-numeric: tabular-nums; }
/* 左右分栏：左卡片列表 + 右详情 */
.task-drawer-split { flex: 1 1 auto; min-height: 0; display: flex; }
.task-drawer-list-pane { flex: 0 0 46%; min-height: 0; display: flex; flex-direction: column; border-right: 1px solid #e2e8f0; }
.task-drawer-cards { flex: 1 1 auto; min-height: 0; overflow-y: auto; padding: 8px; }
.drawer-card { display: flex; align-items: center; gap: 10px; width: 100%; padding: 12px; border: 1px solid transparent; border-radius: 10px; background: #fff; cursor: pointer; text-align: left; margin-bottom: 8px; transition: background 0.12s ease, border-color 0.12s ease; }
.drawer-card .dc-main { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 2px; }
.drawer-card.active { border-color: #bfdbfe; background: #eff6ff; }
.drawer-card:hover { background: #f1f5f9; }
.drawer-card .dc-eyebrow { font-size: 10px; font-weight: 600; color: #94a3b8; font-variant-numeric: tabular-nums; letter-spacing: 0.03em; }
.drawer-card .dc-name { font-size: 13px; font-weight: 600; color: #0f172a; }
.drawer-card .dc-meta { font-size: 11px; color: #64748b; }
.drawer-card .task-status { flex: none; }
.task-drawer-detail-pane { flex: 1 1 auto; min-height: 0; display: flex; flex-direction: column; }
.task-drawer-detail-head { display: flex; align-items: center; gap: 8px; padding: 10px 14px; border-bottom: 1px solid #e2e8f0; }
.task-detail-scroll { flex: 1 1 auto; min-height: 0; overflow-y: auto; padding: 12px; }
.task-drawer-pagination { display: flex; align-items: center; justify-content: center; gap: 12px; padding: 12px; }
.task-drawer-pagination button { min-height: 34px; padding: 7px 11px; border: 1px solid #cbd5e1; border-radius: 7px; background: #fff; color: #2563eb; font: inherit; font-size: 12px; font-weight: 700; cursor: pointer; }
.task-drawer-pagination button:disabled { cursor: not-allowed; opacity: 0.45; }
.task-drawer-pagination span { color: #64748b; font-size: 12px; }
.lightbox-overlay { position: fixed; inset: 0; z-index: 1200; background: rgba(15,23,42,0.4); display: flex; align-items: center; justify-content: center; }
.lightbox { position: relative; }
.lightbox img { max-width: 80vw; max-height: 80vh; border-radius: 8px; }
.lb-time { display: block; text-align: center; color: #fff; margin-top: 6px; }
.lightbox .close-btn { position: absolute; top: -26px; right: 0; color: #fff; background: rgba(0,0,0,0.5); border-radius: 4px; font-size: 12px; padding: 2px 6px; }
</style>
