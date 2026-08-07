<template>
  <section class="roster-drawer" aria-label="分户投保清单">
    <header class="roster-header">
      <div><span class="eyebrow">分户投保清单</span><h2>{{ policy.policyNo }}</h2></div>
      <button class="icon-button" aria-label="返回保单详情" @click="$emit('close')">×</button>
    </header>
    <section class="roster-summary">
      <div><span>被保险人数</span><strong>{{ policy.summary.insuredPartyCount }}</strong></div>
      <div><span>承保地块</span><strong>{{ policy.summary.parcelCount }}</strong></div>
      <div><span>承保面积</span><strong>{{ Number(policy.summary.insuredAreaMu).toFixed(2) }} 亩</strong></div>
      <div><span>总保险金额</span><strong>{{ money(policy.summary.sum_insured_cents) }}</strong></div>
      <div><span>总保费</span><strong>{{ money(policy.summary.premium_cents) }}</strong></div>
      <div><span>自缴保费</span><strong>{{ money(policy.summary.self_paid_cents) }}</strong></div>
    </section>
    <div class="roster-tools">
      <input v-model.trim="query" type="search" placeholder="搜索投保人姓名或证件号" />
      <span>总户数 {{ items.length }} · 当前结果 {{ filtered.length }}</span>
    </div>
    <div class="roster-table-wrap">
      <table>
        <thead><tr><th>序号</th><th>村（居）</th><th>投保人姓名</th><th>组织机构代码 / 身份证号</th><th>联系方式</th><th>投保面积（亩）</th><th>保费金额（元）</th><th>农户自缴（元）</th><th>农户银行卡号或银行账号</th><th>农户开户行</th><th>备注</th></tr></thead>
        <tbody><tr v-for="(item,index) in pageItems" :key="item.id" :class="{ selected: selectedId === item.id }" @click="select(item)"><td>{{ (page-1)*20+index+1 }}</td><td>{{ villageName || '—' }}</td><td>{{ party(item)?.name }}</td><td>{{ party(item)?.identityOrOrgCode ?? '—' }}</td><td>{{ party(item)?.contactPhone ?? '—' }}</td><td>{{ Number(item.insuredAreaMu).toFixed(2) }}</td><td>{{ amount(item.premium_cents) }}</td><td>{{ amount(item.self_paid_cents) }}</td><td>{{ party(item)?.bankAccount ?? '—' }}</td><td>{{ party(item)?.bankName ?? '—' }}</td><td>{{ party(item)?.remark || '—' }}</td></tr></tbody>
      </table>
      <div v-if="!pageItems.length" class="empty-state"><strong>未找到匹配的被保险人</strong></div>
    </div>
    <footer class="pagination"><button :disabled="page===1" @click="page--">上一页</button><span>第 {{ page }} / {{ totalPages }} 页</span><button :disabled="page===totalPages" @click="page++">下一页</button></footer>
  </section>
</template>

<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import type { EnrollmentItem, Party, Policy } from '../../features/policy/policyTypes'

const props = defineProps<{ policy: Policy; items: EnrollmentItem[]; parties: Party[]; villageName: string }>()
const emit = defineEmits<{ close: []; select: [item: EnrollmentItem] }>()
const query = ref('')
const page = ref(1)
const selectedId = ref('')
const party = (item: EnrollmentItem) => props.parties.find((entry) => entry.id === item.insuredPartyId)
const filtered = computed(() => {
  const value = query.value.toLowerCase()
  return props.items.filter((item) => {
    const insured = party(item)
    const fields = [insured?.name, insured?.id, insured?.identityOrOrgCode, insured?.contactPhone, insured?.bankAccount]
    return !value || fields.some((field) => field?.toLowerCase().includes(value))
  })
})
const totalPages = computed(() => Math.max(1, Math.ceil(filtered.value.length / 20)))
const pageItems = computed(() => filtered.value.slice((page.value - 1) * 20, page.value * 20))
watch(query, () => { page.value = 1 })
function select(item: EnrollmentItem) { selectedId.value = item.id; emit('select', item) }
const money = (value: number) => (value / 100).toLocaleString('zh-CN', { style: 'currency', currency: 'CNY' })
const amount = (value: number) => (value / 100).toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
</script>
