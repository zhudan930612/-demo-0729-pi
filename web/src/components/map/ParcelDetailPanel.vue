<template>
  <aside class="parcel-detail" aria-label="地块详情">
    <header class="detail-header">
      <div class="parcel-number-heading">
        <span class="detail-label">地块编号</span>
        <h2>{{ parcelNumber }}</h2>
      </div>
      <button class="icon-button" aria-label="关闭地块详情" @click="$emit('request-close')">×</button>
    </header>

    <div class="detail-scroll">
      <section class="detail-section archive-section" aria-labelledby="parcel-archive-title">
        <div class="section-title"><div><span class="section-kicker">01</span><h3 id="parcel-archive-title">地块档案</h3></div></div>
        <dl class="definition-list">
          <div><dt>地类属性</dt><dd>耕地</dd></div>
          <div><dt>地块来源</dt><dd>{{ parcel.source === 'manual' ? '人工新增' : '基础地块' }}</dd></div>
          <div><dt>地块面积</dt><dd>{{ parcel.areaMu.toFixed(2) }} 亩 / {{ parcel.areaM2.toFixed(2) }} ㎡</dd></div>
          <div><dt>当前作物</dt><dd>{{ current.record?.crop ?? (current.nearestRecord ? '当前未种植' : '未标注') }}</dd></div>
          <div><dt>行政区划</dt><dd>浙江省 · 绍兴市 · 上虞区 · 章镇镇 · {{ villageName }}</dd></div>
          <template v-if="parcel.source === 'manual'">
            <div><dt>创建时间</dt><dd>{{ parcel.createdAt }}</dd></div>
            <div><dt>更新时间</dt><dd>{{ parcel.updatedAt }}</dd></div>
          </template>
        </dl>
        <p v-if="cropMismatch" class="mismatch">当前标注为{{ current.record?.crop }}，保单承保标的为{{ policy.currentPolicy?.insuredObject }}</p>
      </section>

      <section class="detail-section" aria-labelledby="policy-title">
        <div class="section-title">
          <div><span class="section-kicker">02</span><h3 id="policy-title">所属保单</h3></div>
          <span class="policy-type-chip" :class="`type-${policyTypeClass}`">{{ policyType }}</span>
        </div>
        <div v-if="!policy.currentPolicy" class="empty-state"><strong>暂无关联保单</strong><p>当前地块尚未纳入承保清单。</p></div>
        <template v-else>
          <div class="policy-map-legend" :class="`type-${policyTypeClass}`">
            <span class="policy-map-swatch current" aria-hidden="true"></span><span>当前地块</span>
            <span class="policy-map-swatch linked" aria-hidden="true"></span><span>关联地块</span>
          </div>
          <div class="policy-overview">
            <div><span>保单状态</span><strong class="policy-status">{{ policy.currentPolicy.status }}</strong></div>
            <div><span>当前地块承保面积</span><strong>{{ coverageAreaText }}</strong></div>
            <p>承保比例 {{ coverageRatio }} · 当前地块保险金额 {{ money(currentParcelSumInsured) }}</p>
          </div>
          <div class="info-block">
            <div class="policy-title-row"><div><span>保险产品</span><h4>{{ policy.currentPolicy.product }}</h4></div></div>
            <button class="policy-number" @click="copyPolicyNo">{{ policy.currentPolicy.policyNo }}</button><span v-if="copyNotice" class="copy-notice">{{ copyNotice }}</span>
            <dl class="definition-list compact">
              <div><dt>投保人</dt><dd>{{ policyPartyDisplay }}</dd></div>
              <div><dt>被保险人</dt><dd>{{ policyPartyDisplay }}</dd></div>
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
          <dl class="definition-list compact"><div><dt>承保分类</dt><dd>{{ policyBusinessType(entry.policy.insuredMode) }}</dd></div><div><dt>保单号</dt><dd>{{ entry.policy.policyNo }}</dd></div><div><dt>签单主体</dt><dd>{{ entry.insured?.name }}</dd></div><div><dt>承保面积</dt><dd>{{ Number(entry.coverage.insuredAreaMu).toFixed(2) }} 亩</dd></div><div><dt>单位保额 / 费率</dt><dd>{{ money(entry.policy.unitSumInsuredCentsPerMu) }}/亩 · {{ Number(entry.policy.premiumRate) * 100 }}%</dd></div><div><dt>保险金额</dt><dd>{{ money(entry.policy.summary.sum_insured_cents) }}</dd></div><div><dt>财政补贴 / 自缴</dt><dd>{{ money(entry.policy.summary.subsidy_cents) }} / {{ money(entry.policy.summary.self_paid_cents) }}</dd></div></dl>
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

    </div>
  </aside>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue'
import { getCurrentCultivationRecord, type CultivationRecord } from '../../features/policy/cultivationState'
import { formatParcelNumber } from '../../features/policy/parcelNumber'
import type { ParcelPolicyContext, ParcelSummaryInput } from '../../features/policy/policySelectors'
import { policyBusinessType } from '../../features/policy/policyVisual'

const props = defineProps<{ parcel: ParcelSummaryInput; villageCode: string; villageName: string; policy: ParcelPolicyContext; rosterPartyDisplay: string; records: CultivationRecord[]; initialRecordKeys: string[] }>()
const emit = defineEmits<{ 'request-close': []; 'request-restore': []; 'save-record': [record: CultivationRecord, isExisting: boolean]; 'remove-record': [record: CultivationRecord]; 'editing-change': [editing: boolean]; 'open-roster': []; 'highlight-insured': []; 'highlight-policy': [] }>()
const copyNotice = ref('')
const current = computed(() => getCurrentCultivationRecord(props.records))
const parcelNumber = computed(() => formatParcelNumber(props.villageCode, props.parcel.source, props.parcel.id))
const cropMismatch = computed(() => Boolean(current.value.record && props.policy.currentPolicy && current.value.record.crop !== props.policy.currentPolicy.insuredObject))
const policyType = computed(() => policyBusinessType(props.policy.currentPolicy?.insuredMode))
const policyTypeClass = computed(() => props.policy.currentPolicy?.insuredMode === 'single_insured' ? 'large' : props.policy.currentPolicy?.insuredMode === 'insured_roster' ? 'group' : 'uninsured')
const coverageRatio = computed(() => `${Math.min(100, Number(props.policy.currentCoverage?.insuredAreaMu ?? 0) / props.parcel.areaMu * 100).toFixed(1)}%`)
const policyPartyDisplay = computed(() => {
  if (props.policy.currentPolicy?.insuredMode === 'insured_roster') return props.rosterPartyDisplay || '—'
  const party = props.policy.currentInsured ?? props.policy.applicant
  return party?.name ?? '—'
})
const coverageAreaText = computed(() => {
  const areaMu = Number(props.policy.currentCoverage?.insuredAreaMu ?? 0)
  return `${areaMu.toFixed(2)} 亩 / ${(areaMu * 2000 / 3).toFixed(2)} ㎡`
})
const currentParcelSumInsured = computed(() => Math.round(Number(props.policy.currentCoverage?.insuredAreaMu ?? 0) * 125000))
const money = (value: number) => (value / 100).toLocaleString('zh-CN', { style: 'currency', currency: 'CNY' })
function markSaved() {}
async function copyPolicyNo() { try { await navigator.clipboard.writeText(props.policy.currentPolicy!.policyNo); copyNotice.value = '已复制' } catch { copyNotice.value = '复制失败，请手动选择保单号' } setTimeout(() => { copyNotice.value = '' }, 1800) }
defineExpose({ markSaved })
</script>
