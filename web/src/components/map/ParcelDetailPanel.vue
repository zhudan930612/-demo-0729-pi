<template>
  <aside class="parcel-detail" aria-label="地块详情">
    <header class="detail-header">
      <div class="parcel-number-heading">
        <span class="detail-label">地块编号</span>
        <h2>{{ parcelNumber }}</h2>
      </div>
      <button class="icon-button" aria-label="关闭地块详情" @click="$emit('request-close')">×</button>
    </header>

    <section class="parcel-facts" aria-label="地块摘要">
      <div><span>地类属性</span><strong>耕地</strong></div>
      <div><span>地块来源</span><strong>{{ parcel.source === 'manual' ? '人工新增' : '基础地块' }}</strong></div>
      <div><span>地块面积</span><strong>{{ parcel.areaMu.toFixed(2) }} 亩</strong></div>
      <div><span>当前作物</span><strong>{{ current.record?.crop ?? (current.nearestRecord ? '当前未种植' : '未标注') }}</strong></div>
      <div><span>承保面积</span><strong>{{ policy.currentCoverage ? `${Number(policy.currentCoverage.insuredAreaMu).toFixed(2)} 亩` : '—' }}</strong></div>
    </section>
    <p v-if="cropMismatch" class="mismatch">当前标注为{{ current.record?.crop }}，保单承保标的为{{ policy.currentPolicy?.insuredObject }}</p>

    <div class="detail-scroll">
      <section class="detail-section archive-section" aria-labelledby="parcel-archive-title">
        <div class="section-title">
          <div><span class="section-kicker">01</span><h3 id="parcel-archive-title">地块档案</h3></div>
          <button v-if="!editing" class="text-button" @click="startEditing">编辑档案</button>
        </div>
        <dl class="definition-list">
          <div><dt>地块编号</dt><dd>{{ parcelNumber }}</dd></div>
          <div><dt>地类属性</dt><dd>耕地</dd></div>
          <div><dt>地块面积</dt><dd>{{ parcel.areaMu.toFixed(2) }} 亩 / {{ parcel.areaM2.toFixed(2) }} ㎡</dd></div>
          <div><dt>行政区划</dt><dd>浙江省 · 绍兴市 · 上虞区 · 章镇镇 · {{ villageName }}</dd></div>
          <template v-if="parcel.source === 'manual'">
            <div><dt>创建时间</dt><dd>{{ parcel.createdAt }}</dd></div>
            <div><dt>更新时间</dt><dd>{{ parcel.updatedAt }}</dd></div>
          </template>
        </dl>

        <div v-if="!editing">
          <div v-if="records.length" class="record-list">
            <article v-for="record in records" :key="recordKey(record)" class="record-card">
              <div class="record-heading"><strong>{{ record.year }} · {{ record.season }}</strong><span class="badge">{{ record.status }}</span></div>
              <p>{{ record.crop }} · {{ record.variety || '品种未填写' }}</p>
              <p>{{ record.startDate }} 至 {{ record.endDate }}</p>
              <p v-if="record.note">{{ record.note }}</p>
              <div class="record-actions"><button class="text-button" @click="editRecord(record)">编辑</button><button v-if="!isInitial(record)" class="danger-link" @click="removeRecord(record)">删除</button></div>
            </article>
          </div>
          <div v-else class="empty-state"><strong>尚无种植档案</strong><p>可为该地块添加多年度、多季节种植信息。</p><button class="primary-button" @click="startEditing">添加种植信息</button></div>
        </div>

        <form v-else class="edit-form" @submit.prevent="saveEdit">
          <label>种植年度<input v-model.number="draft.year" type="number" min="2020" max="2100" :disabled="Boolean(editingKey)" /></label>
          <label>种植季节<select v-model="draft.season" :disabled="Boolean(editingKey)"><option v-for="season in seasons" :key="season">{{ season }}</option></select></label>
          <label>作物<input v-model.trim="draft.crop" required /></label>
          <label>品种<input v-model.trim="draft.variety" list="varieties" /><datalist id="varieties"><option>甬优1540</option><option>嘉优中科1号</option><option>中早39</option></datalist></label>
          <label>开始日期<input v-model="draft.startDate" type="date" required /></label>
          <label>结束日期<input v-model="draft.endDate" type="date" required /></label>
          <label>核查状态<select v-model="draft.status"><option v-for="status in statuses" :key="status">{{ status }}</option></select></label>
          <label>核查时间<input v-model="draft.checkedAt" type="date" :disabled="draft.status === '未核查'" /></label>
          <label class="span-two">备注<textarea v-model.trim="draft.note" rows="3"></textarea></label>
          <p v-if="formError" class="form-error">{{ formError }}</p>
          <div class="form-actions"><button type="button" class="text-button" @click="cancelEdit">取消</button><button type="submit" class="primary-button">保存</button></div>
        </form>
        <div v-if="records.length && !editing" class="archive-actions"><button class="text-button" @click="startAdding">添加记录</button><button class="danger-link" @click="$emit('request-restore')">恢复初始档案</button></div>
      </section>

      <section class="detail-section" aria-labelledby="policy-title">
        <div class="section-title"><div><span class="section-kicker">02</span><h3 id="policy-title">所属保单</h3></div></div>
        <div v-if="!policy.currentPolicy" class="empty-state"><strong>暂无关联保单</strong><p>当前地块尚未纳入承保清单。</p></div>
        <template v-else>
          <div class="policy-overview">
            <div><span>保单状态</span><strong class="policy-status">{{ policy.currentPolicy.status }}</strong></div>
            <div><span>当前地块承保面积</span><strong>{{ Number(policy.currentCoverage!.insuredAreaMu).toFixed(2) }} 亩</strong></div>
            <p>承保比例 {{ coverageRatio }} · 当前地块保险金额 {{ money(currentParcelSumInsured) }}</p>
          </div>
          <div class="info-block">
            <div class="policy-title-row"><div><span>保险产品</span><h4>{{ policy.currentPolicy.product }}</h4></div><span class="status-chip">{{ policy.currentPolicy.status }}</span></div>
            <button class="policy-number" @click="copyPolicyNo">{{ policy.currentPolicy.policyNo }}</button><span v-if="copyNotice" class="copy-notice">{{ copyNotice }}</span>
            <dl class="definition-list compact">
              <div><dt>投保人</dt><dd>{{ policy.applicant?.name }} · {{ policy.applicant?.partyType }}</dd></div>
              <div><dt>被保险人</dt><dd>{{ policy.currentInsured?.name }} · {{ policy.currentInsured?.partyType }}</dd></div>
              <div><dt>保险标的</dt><dd>{{ policy.currentPolicy.insuredObject }}</dd></div>
              <div><dt>保险期间</dt><dd>{{ policy.currentPolicy.periodStart }} 至 {{ policy.currentPolicy.periodEnd }}</dd></div>
              <div><dt>单位保险金额</dt><dd>1,250.00 元/亩</dd></div>
              <div><dt>费率 / 补贴</dt><dd>3.2% / 80%</dd></div>
              <div><dt>总保险金额</dt><dd>{{ money(policy.currentPolicy.summary.sum_insured_cents) }}</dd></div>
              <div><dt>总保费</dt><dd>{{ money(policy.currentPolicy.summary.premium_cents) }}</dd></div>
            </dl>
            <button class="text-button" @click="$emit('highlight-policy')">查看整张保单覆盖范围</button>
          </div>
        </template>

        <details v-for="entry in policy.history" :key="entry.policy.id" class="history-card">
          <summary>{{ entry.policy.periodStart.slice(0, 4) }} 年历史保单 · {{ entry.policy.status }}</summary>
          <dl class="definition-list compact"><div><dt>承保分类</dt><dd>{{ entry.policy.insuredMode === 'single_insured' ? '单一被保险人' : '分户清单承保' }}</dd></div><div><dt>保单号</dt><dd>{{ entry.policy.policyNo }}</dd></div><div><dt>签单主体</dt><dd>{{ entry.insured?.name }}</dd></div><div><dt>承保面积</dt><dd>{{ Number(entry.coverage.insuredAreaMu).toFixed(2) }} 亩</dd></div><div><dt>单位保额 / 费率</dt><dd>{{ money(entry.policy.unitSumInsuredCentsPerMu) }}/亩 · {{ Number(entry.policy.premiumRate) * 100 }}%</dd></div><div><dt>保险金额</dt><dd>{{ money(entry.policy.summary.sum_insured_cents) }}</dd></div><div><dt>财政补贴 / 自缴</dt><dd>{{ money(entry.policy.summary.subsidy_cents) }} / {{ money(entry.policy.summary.self_paid_cents) }}</dd></div></dl>
          <ClaimSummaryBlock :claim="historyClaim(entry.policy.id)" />
        </details>
      </section>

      <section class="detail-section" aria-labelledby="item-title">
        <div class="section-title"><div><span class="section-kicker">03</span><h3 id="item-title">分项清单</h3></div></div>
        <div v-if="!policy.currentPolicy" class="empty-state compact-empty"><p>关联保单后显示承保分项。</p></div>
        <div v-else-if="policy.currentItem" class="info-block">
          <div class="item-heading"><div><span>被保险人</span><h4>{{ policy.currentInsured?.name }}</h4></div><strong>{{ policy.currentItem.itemNo }}</strong></div>
          <dl class="definition-list compact">
            <div><dt>平台主体编号</dt><dd>{{ policy.currentInsured?.id }}</dd></div>
            <div><dt>主体类型</dt><dd>{{ policy.currentInsured?.partyType }}</dd></div>
            <div><dt>关联地块</dt><dd>{{ policy.currentItem.parcelCoverageIds.length }} 块</dd></div>
            <div><dt>汇总承保面积</dt><dd>{{ Number(policy.currentItem.insuredAreaMu).toFixed(2) }} 亩</dd></div>
            <div><dt>保险金额</dt><dd>{{ money(policy.currentItem.sum_insured_cents) }}</dd></div>
            <div><dt>总保费 / 自缴</dt><dd>{{ money(policy.currentItem.premium_cents) }} / {{ money(policy.currentItem.self_paid_cents) }}</dd></div>
          </dl>
          <div class="button-row"><button class="text-button" @click="$emit('highlight-insured')">查看该户地块</button><button class="primary-button" @click="$emit('open-roster')">查看完整投保清单</button></div>
        </div>
        <div v-else class="empty-state compact-empty"><strong>单一被保险人承保</strong><p>该保单不设分户清单，全部承保地块归属于同一被保险人。</p><button class="text-button" @click="$emit('highlight-insured')">查看该户地块</button></div>
      </section>

      <section class="detail-section claim-section" aria-labelledby="claim-title">
        <div class="section-title"><div><span class="section-kicker">04</span><h3 id="claim-title">理赔摘要</h3></div></div>
        <ClaimSummaryBlock :claim="claim" />
      </section>
    </div>
  </aside>
</template>

<script setup lang="ts">
import { computed, reactive, ref, watch } from 'vue'
import ClaimSummaryBlock from './ClaimSummaryBlock.vue'
import { CULTIVATION_SEASONS, CULTIVATION_STATUSES, cultivationKey, getCurrentCultivationRecord, type CultivationRecord } from '../../features/policy/cultivationState'
import { formatParcelNumber } from '../../features/policy/parcelNumber'
import type { ParcelPolicyContext, ParcelSummaryInput } from '../../features/policy/policySelectors'
import type { ClaimSummary } from '../../features/policy/policyTypes'

const props = defineProps<{ parcel: ParcelSummaryInput; villageCode: string; villageName: string; policy: ParcelPolicyContext; records: CultivationRecord[]; initialRecordKeys: string[]; claim: ClaimSummary | null; historyClaims: ClaimSummary[] }>()
const emit = defineEmits<{ 'request-close': []; 'request-restore': []; 'save-record': [record: CultivationRecord, isExisting: boolean]; 'remove-record': [record: CultivationRecord]; 'editing-change': [editing: boolean]; 'open-roster': []; 'highlight-insured': []; 'highlight-policy': [] }>()
const editing = ref(false)
const editingKey = ref('')
const formError = ref('')
const copyNotice = ref('')
const seasons = CULTIVATION_SEASONS
const statuses = CULTIVATION_STATUSES
const blank = (): CultivationRecord => ({ villageCode: props.villageCode, parcelId: props.parcel.id, year: 2025, season: '单季稻', crop: '水稻', variety: '', startDate: '2025-05-01', endDate: '2025-11-30', status: '未核查', checkedAt: '', note: '' })
const draft = reactive<CultivationRecord>(blank())
const current = computed(() => getCurrentCultivationRecord(props.records))
const parcelNumber = computed(() => formatParcelNumber(props.villageCode, props.parcel.source, props.parcel.id))
const cropMismatch = computed(() => Boolean(current.value.record && props.policy.currentPolicy && current.value.record.crop !== props.policy.currentPolicy.insuredObject))
const coverageRatio = computed(() => `${Math.min(100, Number(props.policy.currentCoverage?.insuredAreaMu ?? 0) / props.parcel.areaMu * 100).toFixed(1)}%`)
const currentParcelSumInsured = computed(() => Math.round(Number(props.policy.currentCoverage?.insuredAreaMu ?? 0) * 125000))
watch(() => props.parcel.id, () => cancelEdit())
const money = (value: number) => (value / 100).toLocaleString('zh-CN', { style: 'currency', currency: 'CNY' })
const recordKey = cultivationKey
function assign(record: CultivationRecord) { Object.assign(draft, structuredClone(record)); draft.checkedAt ||= '' }
function startEditing() { const record = props.records[0]; if (record) { assign(record); editingKey.value = cultivationKey(record) } else { assign(blank()); editingKey.value = '' } editing.value = true; emit('editing-change', true) }
function startAdding() { assign(blank()); editingKey.value = ''; editing.value = true; emit('editing-change', true) }
function editRecord(record: CultivationRecord) { assign(record); editingKey.value = cultivationKey(record); editing.value = true; emit('editing-change', true) }
function isInitial(record: CultivationRecord) { return props.initialRecordKeys.includes(cultivationKey(record)) }
function removeRecord(record: CultivationRecord) { if (isInitial(record)) return; emit('remove-record', record) }
function cancelEdit() { editing.value = false; editingKey.value = ''; formError.value = ''; emit('editing-change', false) }
function saveEdit() { if (draft.status === '未核查') draft.checkedAt = ''; else if (!draft.checkedAt) draft.checkedAt = '2025-07-15'; if (!draft.crop || !draft.startDate || !draft.endDate) { formError.value = '请完整填写作物和种植期间。'; return } emit('save-record', structuredClone(draft), Boolean(editingKey.value)) }
function historyClaim(policyId: string) { return props.historyClaims.find((item) => item.policyId === policyId) ?? null }
function markSaved() { cancelEdit() }
async function copyPolicyNo() { try { await navigator.clipboard.writeText(props.policy.currentPolicy!.policyNo); copyNotice.value = '已复制' } catch { copyNotice.value = '复制失败，请手动选择保单号' } setTimeout(() => { copyNotice.value = '' }, 1800) }
defineExpose({ markSaved })
</script>
