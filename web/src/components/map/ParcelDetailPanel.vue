<template>
  <aside class="parcel-detail" aria-label="地块详情">
    <header class="detail-header">
      <div><span class="eyebrow">地块详情</span><h2>{{ shortId }}</h2></div>
      <button class="icon-button" aria-label="关闭地块详情" @click="$emit('request-close')">×</button>
    </header>

    <section class="summary-grid">
      <div><span>所属村</span><strong>{{ villageName }}</strong></div>
      <div><span>地块来源</span><strong>{{ parcel.source === 'manual' ? '人工新增' : '基础地块' }}</strong></div>
      <div><span>当前状态</span><strong :class="policy.currentPolicy ? 'status-active' : ''">{{ policy.currentPolicy?.status ?? '当前未承保' }}</strong></div>
      <div><span>几何面积</span><strong>{{ parcel.areaMu.toFixed(2) }} 亩</strong></div>
      <div><span>当前作物</span><strong>{{ current.record?.crop ?? (current.nearestRecord ? '当前未种植' : '未标注') }}</strong></div>
      <div><span>承保面积</span><strong>{{ policy.currentCoverage ? `${Number(policy.currentCoverage.insuredAreaMu).toFixed(2)} 亩` : '—' }}</strong></div>
    </section>
    <p v-if="cropMismatch" class="mismatch">当前标注为{{ current.record?.crop }}，保单承保标的为{{ policy.currentPolicy?.insuredObject }}</p>

    <nav class="tabs" aria-label="详情页签">
      <button :class="{ active: tab === 'archive' }" @click="switchTab('archive')">地块档案</button>
      <button :class="{ active: tab === 'policy' }" @click="switchTab('policy')">承保信息</button>
    </nav>

    <div class="detail-scroll">
      <section v-if="tab === 'archive'" class="detail-section">
        <div class="section-title"><div><span class="eyebrow">基础信息</span><h3>地块档案</h3></div><button v-if="!editing" class="text-button" @click="startEditing">编辑</button></div>
        <dl class="definition-list">
          <div><dt>完整地块编号</dt><dd>{{ parcel.id }}</dd></div><div><dt>面积</dt><dd>{{ parcel.areaMu.toFixed(2) }} 亩 / {{ parcel.areaM2.toFixed(2) }} ㎡</dd></div>
          <div><dt>行政区划</dt><dd>浙江省 · 绍兴市 · 上虞区 · 章镇镇 · {{ villageName }}</dd></div>
          <template v-if="parcel.source === 'manual'"><div><dt>创建时间</dt><dd>{{ parcel.createdAt }}</dd></div><div><dt>更新时间</dt><dd>{{ parcel.updatedAt }}</dd></div></template>
        </dl>
        <div v-if="!editing">
          <div v-if="records.length" class="record-list"><article v-for="record in records" :key="recordKey(record)" class="record-card"><div><strong>{{ record.year }} · {{ record.season }}</strong><span class="badge">{{ record.status }}</span></div><p>{{ record.crop }} · {{ record.variety || '品种未填写' }}</p><p>{{ record.startDate }} 至 {{ record.endDate }}</p><p v-if="record.note">{{ record.note }}</p><div class="record-actions"><button class="text-button" @click="editRecord(record)">编辑</button><button v-if="!isInitial(record)" class="danger-link" @click="removeRecord(record)">删除</button></div></article></div>
          <div v-else class="empty-state"><strong>尚无种植档案</strong><p>可为该地块添加多年度、多季节种植信息。</p><button class="primary-button" @click="startEditing">添加种植信息</button></div>
        </div>
        <form v-else class="edit-form" @submit.prevent="saveEdit">
          <label>种植年度<input v-model.number="draft.year" type="number" min="2020" max="2100" :disabled="Boolean(editingKey)" /></label>
          <label>种植季节<select v-model="draft.season" :disabled="Boolean(editingKey)"><option v-for="season in seasons" :key="season">{{ season }}</option></select></label>
          <label>作物<input v-model.trim="draft.crop" required /></label><label>品种<input v-model.trim="draft.variety" list="varieties" /><datalist id="varieties"><option>甬优1540</option><option>嘉优中科1号</option><option>中早39</option></datalist></label>
          <label>开始日期<input v-model="draft.startDate" type="date" required /></label><label>结束日期<input v-model="draft.endDate" type="date" required /></label>
          <label>核查状态<select v-model="draft.status"><option v-for="status in statuses" :key="status">{{ status }}</option></select></label><label>核查时间<input v-model="draft.checkedAt" type="date" :disabled="draft.status === '未核查'" /></label>
          <label class="span-two">备注<textarea v-model.trim="draft.note" rows="3"></textarea></label>
          <p v-if="formError" class="form-error">{{ formError }}</p>
          <div class="form-actions"><button type="button" class="text-button" @click="cancelEdit">取消</button><button type="submit" class="primary-button">保存</button></div>
        </form>
        <div v-if="records.length && !editing" class="archive-actions"><button class="text-button" @click="startAdding">添加记录</button><button class="danger-link" @click="$emit('request-restore')">恢复初始档案</button></div>
      </section>

      <section v-else class="detail-section">
        <div v-if="!policy.currentPolicy" class="empty-state"><strong>暂无关联保单</strong><p>当前地块尚未纳入承保清单。</p></div>
        <template v-else>
          <div class="coverage-hero"><span>当前地块承保</span><strong>{{ Number(policy.currentCoverage!.insuredAreaMu).toFixed(2) }} 亩</strong><small>承保比例 {{ coverageRatio }} · 保险金额 {{ money(currentParcelSumInsured) }}</small></div>
          <div v-if="policy.currentItem" class="info-card"><span class="eyebrow">分户清单汇总项</span><h3>{{ policy.currentInsured?.name }}</h3><dl class="definition-list compact"><div><dt>清单项</dt><dd>{{ policy.currentItem.itemNo }}</dd></div><div><dt>平台主体编号</dt><dd>{{ policy.currentInsured?.id }}</dd></div><div><dt>主体类型</dt><dd>{{ policy.currentInsured?.partyType }}</dd></div><div><dt>关联地块</dt><dd>{{ policy.currentItem.parcelCoverageIds.length }} 块</dd></div><div><dt>汇总面积</dt><dd>{{ Number(policy.currentItem.insuredAreaMu).toFixed(2) }} 亩</dd></div><div><dt>自缴保费</dt><dd>{{ money(policy.currentItem.self_paid_cents) }}</dd></div></dl><div class="button-row"><button class="text-button" @click="$emit('highlight-insured')">查看该户地块</button><button class="primary-button" @click="$emit('open-roster')">查看完整投保清单</button></div></div>
          <div class="info-card"><span class="eyebrow">所属保单</span><h3>{{ policy.currentPolicy.product }}</h3><button class="policy-number" @click="copyPolicyNo">{{ policy.currentPolicy.policyNo }}</button><span v-if="copyNotice" class="copy-notice">{{ copyNotice }}</span><dl class="definition-list compact"><div><dt>投保人</dt><dd>{{ policy.applicant?.name }} · {{ policy.applicant?.partyType }}</dd></div><div><dt>被保险人</dt><dd>{{ policy.currentInsured?.name }} · {{ policy.currentInsured?.partyType }}</dd></div><div><dt>保险标的</dt><dd>{{ policy.currentPolicy.insuredObject }}</dd></div><div><dt>保险期间</dt><dd>{{ policy.currentPolicy.periodStart }} 至 {{ policy.currentPolicy.periodEnd }}</dd></div><div><dt>单位保险金额</dt><dd>1,250.00 元/亩</dd></div><div><dt>费率 / 补贴</dt><dd>3.2% / 80%</dd></div><div><dt>总保险金额</dt><dd>{{ money(policy.currentPolicy.summary.sum_insured_cents) }}</dd></div><div><dt>总保费</dt><dd>{{ money(policy.currentPolicy.summary.premium_cents) }}</dd></div></dl><button class="text-button" @click="$emit('highlight-policy')">查看整张保单覆盖范围</button></div>
          <ClaimSummaryBlock :claim="claim" />
        </template>
        <details v-for="entry in policy.history" :key="entry.policy.id" class="history-card"><summary>{{ entry.policy.periodStart.slice(0, 4) }} 年历史保单 · {{ entry.policy.status }}</summary><dl class="definition-list compact"><div><dt>承保分类</dt><dd>{{ entry.policy.insuredMode === 'single_insured' ? '单一被保险人' : '分户清单承保' }}</dd></div><div><dt>保单号</dt><dd>{{ entry.policy.policyNo }}</dd></div><div><dt>签单主体</dt><dd>{{ entry.insured?.name }}</dd></div><div><dt>承保面积</dt><dd>{{ Number(entry.coverage.insuredAreaMu).toFixed(2) }} 亩</dd></div><div><dt>单位保额 / 费率</dt><dd>{{ money(entry.policy.unitSumInsuredCentsPerMu) }}/亩 · {{ Number(entry.policy.premiumRate) * 100 }}%</dd></div><div><dt>保险金额</dt><dd>{{ money(entry.policy.summary.sum_insured_cents) }}</dd></div><div><dt>财政补贴 / 自缴</dt><dd>{{ money(entry.policy.summary.subsidy_cents) }} / {{ money(entry.policy.summary.self_paid_cents) }}</dd></div></dl><ClaimSummaryBlock :claim="historyClaim(entry.policy.id)" /></details>
      </section>
    </div>
  </aside>
</template>

<script setup lang="ts">
import { computed, reactive, ref, watch } from 'vue'
import ClaimSummaryBlock from './ClaimSummaryBlock.vue'
import { CULTIVATION_SEASONS, CULTIVATION_STATUSES, cultivationKey, getCurrentCultivationRecord, type CultivationRecord } from '../../features/policy/cultivationState'
import type { ParcelPolicyContext, ParcelSummaryInput } from '../../features/policy/policySelectors'
import type { ClaimSummary } from '../../features/policy/policyTypes'

const props = defineProps<{ parcel: ParcelSummaryInput; villageCode: string; villageName: string; policy: ParcelPolicyContext; records: CultivationRecord[]; initialRecordKeys: string[]; claim: ClaimSummary | null; historyClaims: ClaimSummary[]; initialTab?: 'archive' | 'policy' }>()
const emit = defineEmits<{ 'request-close': []; 'request-restore': []; 'save-record': [record: CultivationRecord, isInitial: boolean]; 'remove-record': [record: CultivationRecord]; 'editing-change': [editing: boolean]; 'open-roster': []; 'highlight-insured': []; 'highlight-policy': [] }>()
const tab = ref<'archive' | 'policy'>(props.initialTab ?? (props.policy.currentPolicy ? 'policy' : 'archive'))
const editing = ref(false); const editingKey = ref(''); const formError = ref(''); const copyNotice = ref('')
const seasons = CULTIVATION_SEASONS; const statuses = CULTIVATION_STATUSES
const blank = (): CultivationRecord => ({ villageCode: props.villageCode, parcelId: props.parcel.id, year: 2025, season: '单季稻', crop: '水稻', variety: '', startDate: '2025-05-01', endDate: '2025-11-30', status: '未核查', checkedAt: '', note: '' })
const draft = reactive<CultivationRecord>(blank())
const current = computed(() => getCurrentCultivationRecord(props.records))
const shortId = computed(() => props.parcel.id.startsWith('manual-') ? props.parcel.id.slice(0, 16) : `地块 ${props.parcel.id}`)
const cropMismatch = computed(() => Boolean(current.value.record && props.policy.currentPolicy && current.value.record.crop !== props.policy.currentPolicy.insuredObject))
const coverageRatio = computed(() => `${Math.min(100, Number(props.policy.currentCoverage?.insuredAreaMu ?? 0) / props.parcel.areaMu * 100).toFixed(1)}%`)
const currentParcelSumInsured = computed(() => Math.round(Number(props.policy.currentCoverage?.insuredAreaMu ?? 0) * 125000))
watch(() => props.parcel.id, () => { cancelEdit(); tab.value = props.policy.currentPolicy ? 'policy' : 'archive' })
const money = (value: number) => (value / 100).toLocaleString('zh-CN', { style: 'currency', currency: 'CNY' })
const recordKey = cultivationKey
function switchTab(value: 'archive' | 'policy') { if (editing.value) return; tab.value = value }
function assign(record: CultivationRecord) { Object.assign(draft, structuredClone(record)); draft.checkedAt ||= '' }
function startEditing() { const record = props.records[0]; if (record) { assign(record); editingKey.value = cultivationKey(record) } else { assign(blank()); editingKey.value = '' } editing.value = true; emit('editing-change', true) }
function startAdding() { assign(blank()); editingKey.value = ''; editing.value = true; emit('editing-change', true) }
function editRecord(record: CultivationRecord) { assign(record); editingKey.value = cultivationKey(record); editing.value = true; emit('editing-change', true) }
function isInitial(record: CultivationRecord) { return props.initialRecordKeys.includes(cultivationKey(record)) }
function removeRecord(record: CultivationRecord) { if (isInitial(record)) return; emit('remove-record', record) }
function cancelEdit() { editing.value = false; editingKey.value = ''; formError.value = ''; emit('editing-change', false) }
function saveEdit() { if (draft.status === '未核查') draft.checkedAt = ''; else if (!draft.checkedAt) draft.checkedAt = '2025-07-15'; if (!draft.crop || !draft.startDate || !draft.endDate) { formError.value = '请完整填写作物和种植期间。'; return } emit('save-record', structuredClone(draft), Boolean(editingKey.value)); }
function historyClaim(policyId: string) { return props.historyClaims.find((item) => item.policyId === policyId) ?? null }
function markSaved() { cancelEdit() }
async function copyPolicyNo() { try { await navigator.clipboard.writeText(props.policy.currentPolicy!.policyNo); copyNotice.value = '已复制' } catch { copyNotice.value = '复制失败，请手动选择保单号' } setTimeout(() => { copyNotice.value = '' }, 1800) }
defineExpose({ markSaved })
</script>
