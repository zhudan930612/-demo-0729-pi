<template>
  <Teleport to="body">
    <Transition name="drawer-fade">
      <div v-if="open" class="drawer-backdrop" @click.self="emit('close')">
        <Transition name="drawer-slide">
          <div v-if="open" class="parcel-drawer" role="dialog" aria-label="受损地块列表">
            <header class="drawer-header">
              <h2 class="drawer-title">受损地块列表</h2>
              <button type="button" class="close-btn" aria-label="关闭" @click="emit('close')">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M18 6L6 18M6 6l12 12"/></svg>
              </button>
            </header>

            <!-- 筛选栏 -->
            <div class="filter-bar">
              <label class="filter-label">受损等级：</label>
              <select v-model="filterLevel" class="filter-select">
                <option value="all">全部</option>
                <option value="100">重度 (100%)</option>
                <option value="60">中度 (60%)</option>
                <option value="30">轻度 (30%)</option>
                <option value="0">无受损 (0%)</option>
              </select>
              <span class="result-count">共 {{ filteredParcels.length }} 个地块</span>
            </div>

            <!-- 表格 -->
            <div class="table-container">
              <table class="parcel-table">
                <thead>
                  <tr>
                    <th class="col-id" @click="toggleSort('parcelId')">
                      地块编号
                      <span v-if="sortKey === 'parcelId'" class="sort-icon">{{ sortDir === 'asc' ? '↑' : '↓' }}</span>
                    </th>
                    <th class="col-level" @click="toggleSort('damageRate')">
                      受损等级
                      <span v-if="sortKey === 'damageRate'" class="sort-icon">{{ sortDir === 'asc' ? '↑' : '↓' }}</span>
                    </th>
                    <th class="col-rate" @click="toggleSort('damageRate')">
                      受损率
                      <span v-if="sortKey === 'damageRate'" class="sort-icon">{{ sortDir === 'asc' ? '↑' : '↓' }}</span>
                    </th>
                    <th class="col-area" @click="toggleSort('areaMu')">
                      受损面积
                      <span v-if="sortKey === 'areaMu'" class="sort-icon">{{ sortDir === 'asc' ? '↑' : '↓' }}</span>
                    </th>
                    <th class="col-comp" @click="toggleSort('compensation')">
                      赔付金额
                      <span v-if="sortKey === 'compensation'" class="sort-icon">{{ sortDir === 'asc' ? '↑' : '↓' }}</span>
                    </th>
                    <th class="col-insured">被保险人</th>
                  </tr>
                </thead>
                <tbody>
                  <tr
                    v-for="parcel in visibleParcels"
                    :key="parcel.parcelId"
                    class="parcel-row"
                    :class="{ selected: selectedParcelId === parcel.parcelId }"
                    @click="emit('select-parcel', parcel.parcelId)"
                  >
                    <td class="col-id">地块#{{ parcel.parcelId }}</td>
                    <td class="col-level">
                      <span class="damage-badge" :class="damageLevelClass(parcel.damageRate)">
                        {{ damageLevelText(parcel.damageRate) }}
                      </span>
                    </td>
                    <td class="col-rate">{{ parcel.damageRate }}%</td>
                    <td class="col-area">{{ fmtArea(parcel.areaMu) }} 亩</td>
                    <td class="col-comp">{{ fmtYuan(parcel.compensation) }}</td>
                    <td class="col-insured">{{ parcel.insuredName || '-' }}</td>
                  </tr>
                </tbody>
              </table>
            </div>
          </div>
        </Transition>
      </div>
    </Transition>
  </Teleport>
</template>

<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import type { DamageRate } from '../../features/lodging/lodgingCalc'

export interface ParcelRowData {
  parcelId: string
  damageRate: DamageRate
  areaMu: number
  compensation: number
  insuredName: string
}

const props = defineProps<{
  open: boolean
  parcels: ParcelRowData[]
  selectedParcelId: string | null
}>()

const emit = defineEmits<{
  close: []
  'select-parcel': [parcelId: string]
}>()

const filterLevel = ref<string>('all')
const sortKey = ref<string>('compensation')
const sortDir = ref<'asc' | 'desc'>('desc')

const filteredParcels = computed(() => {
  let result = [...props.parcels]

  // 筛选
  if (filterLevel.value !== 'all') {
    const level = Number(filterLevel.value) as DamageRate
    result = result.filter((p) => p.damageRate === level)
  }

  // 排序
  result.sort((a, b) => {
    let cmp = 0
    if (sortKey.value === 'parcelId') {
      cmp = a.parcelId.localeCompare(b.parcelId)
    } else if (sortKey.value === 'damageRate') {
      cmp = a.damageRate - b.damageRate
    } else if (sortKey.value === 'areaMu') {
      cmp = a.areaMu - b.areaMu
    } else if (sortKey.value === 'compensation') {
      cmp = a.compensation - b.compensation
    }
    return sortDir.value === 'asc' ? cmp : -cmp
  })

  return result
})

const visibleParcels = computed(() => filteredParcels.value)

function toggleSort(key: string) {
  if (sortKey.value === key) {
    sortDir.value = sortDir.value === 'asc' ? 'desc' : 'asc'
  } else {
    sortKey.value = key
    sortDir.value = 'desc'
  }
}

function damageLevelText(rate: DamageRate): string {
  const map: Record<DamageRate, string> = { 0: '无', 30: '轻度', 60: '中度', 100: '重度' }
  return map[rate] ?? '-'
}

function damageLevelClass(rate: DamageRate): string {
  const map: Record<DamageRate, string> = { 0: 'none', 30: 'light', 60: 'mid', 100: 'severe' }
  return map[rate] ?? ''
}

function fmtArea(mu: number): string {
  return mu.toLocaleString('zh-CN', { maximumFractionDigits: 1 })
}

function fmtYuan(yuan: number): string {
  if (yuan >= 10_000) {
    return `¥${(yuan / 10_000).toLocaleString('zh-CN', { maximumFractionDigits: 1 })}万`
  }
  return `¥${yuan.toLocaleString('zh-CN', { maximumFractionDigits: 0 })}`
}

// 关闭时重置筛选
watch(() => props.open, (isOpen) => {
  if (!isOpen) {
    filterLevel.value = 'all'
    sortKey.value = 'compensation'
    sortDir.value = 'desc'
  }
})
</script>

<style scoped>
.drawer-backdrop {
  position: fixed;
  inset: 0;
  z-index: 2000;
  background: rgba(15, 23, 42, 0.3);
  display: flex;
  justify-content: flex-end;
}

.parcel-drawer {
  width: 720px;
  max-width: 90vw;
  height: 100vh;
  background: #fff;
  box-shadow: -8px 0 24px rgba(15, 23, 42, 0.18);
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

.drawer-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 16px 20px;
  border-bottom: 1px solid #e2e8f0;
  background: #f8fafc;
}

.drawer-title {
  margin: 0;
  font-size: 16px;
  font-weight: 700;
  color: #0f172a;
}

.close-btn {
  width: 32px;
  height: 32px;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 0;
  border: 0;
  border-radius: 6px;
  background: transparent;
  color: #64748b;
  cursor: pointer;
  transition: all 0.15s ease;
}

.close-btn:hover {
  background: #e2e8f0;
  color: #0f172a;
}

.close-btn svg {
  width: 18px;
  height: 18px;
}

.filter-bar {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 12px 20px;
  border-bottom: 1px solid #e2e8f0;
  background: #fff;
}

.filter-label {
  font-size: 13px;
  font-weight: 500;
  color: #475569;
}

.filter-select {
  padding: 6px 10px;
  border: 1px solid #cbd5e1;
  border-radius: 6px;
  background: #fff;
  font-size: 13px;
  color: #0f172a;
  cursor: pointer;
}

.filter-select:focus {
  outline: 3px solid rgba(37, 99, 235, 0.28);
  outline-offset: 2px;
}

.result-count {
  margin-left: auto;
  font-size: 12px;
  color: #64748b;
}

.table-container {
  flex: 1;
  overflow-y: auto;
  padding: 0;
}

.parcel-table {
  width: 100%;
  border-collapse: collapse;
  font-size: 13px;
}

.parcel-table thead {
  position: sticky;
  top: 0;
  z-index: 10;
  background: #f1f5f9;
}

.parcel-table th {
  padding: 10px 12px;
  text-align: left;
  font-weight: 600;
  color: #475569;
  border-bottom: 2px solid #e2e8f0;
  cursor: pointer;
  user-select: none;
  white-space: nowrap;
}

.parcel-table th:hover {
  background: #e2e8f0;
}

.sort-icon {
  margin-left: 4px;
  color: #3b82f6;
}

.parcel-table td {
  padding: 10px 12px;
  border-bottom: 1px solid #e2e8f0;
  color: #0f172a;
}

.parcel-row {
  cursor: pointer;
  transition: background 0.1s ease;
}

.parcel-row:hover {
  background: #f8fafc;
}

.parcel-row.selected {
  background: #eff6ff;
}

.col-id {
  width: 120px;
  font-weight: 500;
}

.col-level {
  width: 80px;
}

.col-rate {
  width: 80px;
  font-variant-numeric: tabular-nums;
}

.col-area {
  width: 100px;
  text-align: right;
  font-variant-numeric: tabular-nums;
}

.col-comp {
  width: 120px;
  text-align: right;
  font-variant-numeric: tabular-nums;
  font-weight: 600;
  color: #dc2626;
}

.col-insured {
  width: 100px;
}

.damage-badge {
  display: inline-block;
  padding: 2px 8px;
  border-radius: 4px;
  font-size: 11px;
  font-weight: 600;
}

.damage-badge.none {
  background: #f1f5f9;
  color: #64748b;
}

.damage-badge.light {
  background: #dcfce7;
  color: #16a34a;
}

.damage-badge.mid {
  background: #fef3c7;
  color: #ca8a04;
}

.damage-badge.severe {
  background: #fef2f2;
  color: #dc2626;
}

/* Transitions */
.drawer-fade-enter-active,
.drawer-fade-leave-active {
  transition: opacity 0.2s ease;
}

.drawer-fade-enter-from,
.drawer-fade-leave-to {
  opacity: 0;
}

.drawer-slide-enter-active,
.drawer-slide-leave-active {
  transition: transform 0.25s ease;
}

.drawer-slide-enter-from,
.drawer-slide-leave-to {
  transform: translateX(100%);
}
</style>
