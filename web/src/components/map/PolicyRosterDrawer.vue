<template>
  <section class="roster-drawer" aria-label="完整投保清单">
    <header class="roster-header">
      <div><span class="eyebrow">完整投保清单</span><h2>{{ policy.policyNo }}</h2></div>
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
      <input v-model.trim="query" type="search" placeholder="搜索被保险人名称或平台主体编号" />
      <span>总户数 {{ items.length }} · 当前结果 {{ filtered.length }}</span>
    </div>
    <div class="roster-table-wrap">
      <table>
        <thead><tr><th>序号</th><th>被保险人</th><th>主体编号</th><th>类型</th><th>地块数</th><th>承保面积</th><th>保险金额</th><th>总保费</th><th>补贴</th><th>自缴</th></tr></thead>
        <tbody><tr v-for="(item,index) in pageItems" :key="item.id" :class="{ selected: selectedId === item.id }" @click="select(item)"><td>{{ (page-1)*20+index+1 }}</td><td>{{ party(item)?.name }}</td><td>{{ party(item)?.id }}</td><td>{{ party(item)?.partyType }}</td><td>{{ item.parcelCoverageIds.length }}</td><td>{{ Number(item.insuredAreaMu).toFixed(2) }} 亩</td><td>{{ money(item.sum_insured_cents) }}</td><td>{{ money(item.premium_cents) }}</td><td>{{ money(item.subsidy_cents) }}</td><td>{{ money(item.self_paid_cents) }}</td></tr></tbody>
      </table>
      <div v-if="!pageItems.length" class="empty-state"><strong>未找到匹配的被保险人</strong></div>
    </div>
    <footer class="pagination"><button :disabled="page===1" @click="page--">上一页</button><span>第 {{ page }} / {{ totalPages }} 页</span><button :disabled="page===totalPages" @click="page++">下一页</button></footer>
  </section>
</template>

<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import type { EnrollmentItem, Party, Policy } from '../../features/policy/policyTypes'

const props = defineProps<{ policy: Policy; items: EnrollmentItem[]; parties: Party[] }>()
const emit = defineEmits<{ close: []; select: [item: EnrollmentItem] }>()
const query = ref('')
const page = ref(1)
const selectedId = ref('')
const party = (item: EnrollmentItem) => props.parties.find((entry) => entry.id === item.insuredPartyId)
const filtered = computed(() => {
  const value = query.value.toLowerCase()
  return props.items.filter((item) => {
    const insured = party(item)
    return !value || insured?.name.toLowerCase().includes(value) || insured?.id.toLowerCase().includes(value)
  })
})
const totalPages = computed(() => Math.max(1, Math.ceil(filtered.value.length / 20)))
const pageItems = computed(() => filtered.value.slice((page.value - 1) * 20, page.value * 20))
watch(query, () => { page.value = 1 })
function select(item: EnrollmentItem) { selectedId.value = item.id; emit('select', item) }
const money = (value: number) => (value / 100).toLocaleString('zh-CN', { style: 'currency', currency: 'CNY' })
</script>
