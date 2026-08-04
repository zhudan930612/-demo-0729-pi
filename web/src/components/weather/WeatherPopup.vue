<template>
  <section ref="dialog" class="weather-popup" :class="[kind, placement]" :style="positionStyle" role="dialog" aria-modal="false" tabindex="-1" :aria-label="kind === 'alert' ? '天气预警详情' : '位置天气详情'" @click.stop>
    <header :style="kind === 'alert' ? { '--warning': alertColor } : {}">
      <strong>{{ title }}</strong>
      <button type="button" aria-label="关闭天气浮窗" @click="emit('close')">×</button>
    </header>

    <div class="popup-body">
      <template v-if="kind === 'alert' && alert">
        <dl class="alert-fields">
          <div><dt>发布时间</dt><dd>{{ formatBeijing(alert.issuedTime) }}</dd></div>
          <div v-if="alert.urgency"><dt>紧迫程度</dt><dd>{{ weatherEnumZh(alert.urgency) }}</dd></div>
          <div><dt>严重程度</dt><dd>{{ weatherEnumZh(alert.severity) }}</dd></div>
          <div v-if="alert.certainty"><dt>确定性</dt><dd>{{ weatherEnumZh(alert.certainty) }}</dd></div>
        </dl>
        <section><h3>预警说明</h3><p>{{ alert.description || '--' }}</p></section>
        <section v-if="alert.criteria"><h3>触发标准</h3><p>{{ alert.criteria }}</p></section>
        <section v-if="alert.instruction"><h3>防御指南</h3><p>{{ alert.instruction }}</p></section>
      </template>

      <template v-else-if="bundle">
        <div class="query-context">
          <strong>{{ queryObject }}</strong>
          <span>{{ locationContext }}</span>
        </div>

        <section class="current">
          <h3>当前天气</h3>
          <div v-if="bundle.current.status === 'success'" class="current-main">
            <QWeatherIcon :code="bundle.current.data.condition.code" />
            <strong>{{ bundle.current.data.condition.text || '--' }} <b>{{ unitText(bundle.current.data.temperature) }}</b></strong>
          </div>
          <div v-else-if="bundle.current.status === 'error'" class="module-error">实时天气加载失败 <button @click="emit('retry', 'current')">重试</button></div>
          <div v-if="bundle.current.status !== 'error' && bundle.current.stale && bundle.current.refreshError" class="module-error refresh-error">实时天气更新失败，上次成功于 {{ formatBeijing(bundle.current.fetchedAt) }} <button @click="emit('retry', 'current')">重试</button></div>
          <dl v-if="bundle.current.status === 'success'" class="weather-metrics">
            <div><dt>体感温度</dt><dd>{{ unitText(bundle.current.data.feelsLike) }}</dd></div>
            <div><dt>近一小时降水</dt><dd>{{ unitText(bundle.current.data.precipitation?.amount) }}</dd></div>
            <div><dt>降水强度</dt><dd>{{ unitText(bundle.current.data.precipitation?.intensity) }}</dd></div>
            <div><dt>降水类型</dt><dd>{{ precipitationType(bundle.current.data.precipitation?.type) }}</dd></div>
            <div><dt>湿度</dt><dd>{{ percentage(bundle.current.data.humidity) }}</dd></div>
          </dl>
          <small v-if="bundle.current.status !== 'error'" class="data-freshness">本站获取 {{ formatBeijing(bundle.current.fetchedAt) }}</small>
        </section>

        <section class="minutely">
          <div class="section-heading"><h3>未来两小时降水 <small>每 5 分钟</small></h3></div>
          <div v-if="minutelyKind === 'error'" class="module-error">未来两小时降水加载失败 <button @click="emit('retry', 'minutely')">重试</button></div>
          <div v-if="bundle.minutely.status !== 'error' && bundle.minutely.stale && bundle.minutely.refreshError" class="module-error refresh-error">未来两小时降水更新失败，上次成功于 {{ formatBeijing(bundle.minutely.fetchedAt) }} <button @click="emit('retry', 'minutely')">重试</button></div>
          <p v-if="minutelyKind === 'empty'">当前查询位置暂无分钟级降水预报</p>
          <template v-else-if="minutelyData">
            <div class="minutely-meta"><p>{{ minutelyData.summary || '暂无降水摘要' }}</p><small>更新于 {{ formatBeijing(minutelyData.updateTime, false) }}</small></div>
            <div class="rain-legend"><span v-for="type in precipTypes" :key="type" :class="type"><i></i>{{ precipitationType(type) }}</span></div>
            <div class="bars" role="list" :aria-label="minuteA11y">
              <button v-for="item in minutelyData.minutely" :key="item.fxTime" type="button" role="listitem" :aria-label="`${formatBeijing(item.fxTime, false)}，5分钟累计${item.precip}毫米，${precipitationType(item.type)}`" :title="`${formatBeijing(item.fxTime, false)} ${item.precip} mm ${precipitationType(item.type)}`"><i :class="item.type || 'other'" :style="{ height: `${barHeight(item.precip)}%` }"></i></button>
            </div>
            <div class="minute-axis"><time v-for="index in minuteTicks" :key="index">{{ formatBeijing(minutelyData.minutely[index]?.fxTime, false) }}</time></div>
            <p v-if="minutelyKind === 'zero'" class="zero">未来两小时暂无降水</p>
          </template>
        </section>

        <section class="hourly">
          <h3>未来 24 小时预报 <small>每小时</small><em v-if="hourly.incomplete">数据不完整：共 {{ hourly.items.length }} 个时点</em></h3>
          <div v-if="bundle.hourly.status === 'error' || !hourly.items.length" class="module-error">未来 24 小时预报加载失败 <button @click="emit('retry', 'hourly')">重试</button></div>
          <div v-if="bundle.hourly.status !== 'error' && bundle.hourly.stale && bundle.hourly.refreshError" class="module-error refresh-error">未来 24 小时预报更新失败，上次成功于 {{ formatBeijing(bundle.hourly.fetchedAt) }} <button @click="emit('retry', 'hourly')">重试</button></div>
          <div v-if="bundle.hourly.status !== 'error' && hourly.items.length" class="hour-shell">
            <span v-show="hourCanLeft" class="hour-hint left" aria-hidden="true">‹</span>
            <div ref="hours" class="hour-strip" tabindex="0" aria-label="未来24小时天气，可使用左右方向键浏览" @scroll="updateHourHints" @keydown.left.prevent="scrollHours(-1)" @keydown.right.prevent="scrollHours(1)" @wheel="onHourWheel">
              <article v-for="(item, index) in hourly.items" :key="`${item.forecastTime}-${index}`">
                <time>{{ hourTimeLabel(item.forecastTime, hourly.items[0]?.forecastTime || item.forecastTime, index) }}</time>
                <QWeatherIcon :code="item.condition.code" />
                <strong>{{ item.condition.text || '--' }}</strong>
                <b>{{ unitText(item.temperature) }}</b>
                <span>降水 {{ percentage(item.precipitation?.probability) }}</span>
                <span>{{ unitText(item.precipitation?.amount) }}</span>
              </article>
            </div>
            <span v-show="hourCanRight" class="hour-hint right" aria-hidden="true">›</span>
          </div>
        </section>

        <p class="responsibility">约 1 km 查询点附近信息，仅供风险辅助；不代表整块地块或整个行政区域实测，不作定损或理赔依据。</p>
        <div class="refer"><span>数据来源</span><template v-for="a in bundle.attributions" :key="`${a.name}-${a.url}`"><span>{{ a.name }}</span></template><span v-for="s in minutelyData?.refer.sources || []" :key="s">{{ s }}</span><span v-for="l in minutelyData?.refer.license || []" :key="l">{{ l }}</span></div>
      </template>

      <div v-else-if="phase === 'error'" class="popup-loading popup-request-error" role="alert"><i class="qi-999" aria-hidden="true"></i><strong>位置天气加载失败</strong><span>{{ errorMessage || '请稍后重试' }}</span><button type="button" @click="emit('retry', 'current')">重试</button></div>
      <div v-else class="popup-loading" role="status"><i class="qi-999" aria-hidden="true"></i><strong>正在加载新位置天气…</strong></div>
    </div>
  </section>
</template>

<script setup lang="ts">
import { computed, nextTick, onMounted, onBeforeUnmount, ref } from 'vue'
import type { WeatherAlert, WeatherBundle } from '../../features/weather/weatherTypes'
import { formatBeijing, hourlyCards, hourTimeLabel, minutelyState, percentage, precipitationType, unitText, warningColor, weatherEnumZh } from '../../features/weather/weatherAdapter'
import QWeatherIcon from './QWeatherIcon.vue'

const props = defineProps<{ kind: 'alert' | 'location'; title: string; bundle?: WeatherBundle | null; alert?: WeatherAlert | null; x: number; y: number; contextName?: string; contextPath?: string[]; parcelId?: string; phase?: string; errorMessage?: string }>()
const emit = defineEmits<{ close: []; retry: [module: 'current' | 'minutely' | 'hourly'] }>()
const dialog = ref<HTMLElement | null>(null)
const hours = ref<HTMLElement | null>(null)
const hourCanLeft = ref(false)
const hourCanRight = ref(false)
const measuredWidth = ref(360)
const measuredHeight = ref(320)
const placement = ref<'above' | 'below'>('above')
const viewport = ref({ width: window.innerWidth, height: window.innerHeight })
const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null
let resizeObserver: ResizeObserver | null = null

function measure() {
  const el = dialog.value
  if (!el) return
  const rect = el.getBoundingClientRect()
  measuredWidth.value = rect.width
  measuredHeight.value = rect.height
  viewport.value = { width: window.innerWidth, height: window.innerHeight }
  placement.value = props.y - measuredHeight.value - 12 >= 12 ? 'above' : 'below'
}
function onResize() { measure() }
onMounted(() => nextTick(() => {
  dialog.value?.focus()
  updateHourHints()
  measure()
  resizeObserver = new ResizeObserver(measure)
  if (dialog.value) resizeObserver.observe(dialog.value)
  window.addEventListener('resize', onResize)
}))
onBeforeUnmount(() => {
  resizeObserver?.disconnect()
  window.removeEventListener('resize', onResize)
  previousFocus?.focus()
})

const positionStyle = computed(() => {
  const narrow = viewport.value.width <= 520
  const pad = 12
  const arrow = 12
  const width = narrow ? viewport.value.width - pad * 2 : measuredWidth.value
  const left = narrow ? pad : Math.max(pad, Math.min(props.x - width / 2, viewport.value.width - pad - width))
  const unclampedTop = placement.value === 'above' ? props.y - measuredHeight.value - arrow : props.y + arrow
  const top = Math.max(pad, Math.min(unclampedTop, viewport.value.height - pad - measuredHeight.value - 2))
  const anchor = Math.max(14, Math.min(props.x - left, width - 14))
  return { left: `${left}px`, top: `${top}px`, '--anchor-x': `${anchor}px` }
})
const alertColor = computed(() => props.alert ? warningColor(props.alert) : '#64748b')
const minutelyKind = computed(() => props.bundle ? minutelyState(props.bundle.minutely) : 'empty')
const minutelyData = computed(() => props.bundle && props.bundle.minutely.status !== 'error' ? props.bundle.minutely.data : null)
const hourly = computed(() => props.bundle ? hourlyCards(props.bundle.hourly) : { items: [], incomplete: false })
const precipTypes = computed(() => [...new Set(minutelyData.value?.minutely.map(item => item.type || 'other') || [])])
const minuteTicks = computed(() => {
  const count = minutelyData.value?.minutely.length || 0
  if (!count) return []
  return [...new Set([0, Math.round((count - 1) * .25), Math.round((count - 1) * .5), Math.round((count - 1) * .75), count - 1])]
})
const minuteA11y = computed(() => `未来两小时实际返回 ${minutelyData.value?.minutely.length || 0} 个时点`)
const maxPrecip = computed(() => Math.max(0, ...(minutelyData.value?.minutely.map(item => item.precip) || [])))
const queryObject = computed(() => props.bundle?.target === 'picked' ? '地图点选位置' : props.bundle?.target === 'parcel' ? `${props.contextName || '当前村'}${props.parcelId ? ` · 地块 ${props.parcelId}` : ''}` : props.contextName || '当前行政区域')
const locationContext = computed(() => {
  const address = props.bundle?.address.status === 'success' ? props.bundle.address.data?.address?.trim() : ''
  if (address) return address
  const path = props.contextPath?.filter(Boolean).join(' · ')
  if (props.bundle?.target === 'picked') return path ? `${path}内地图点选位置` : '地图点选位置'
  if (props.bundle?.target === 'parcel') return path || props.contextName || '当前村'
  return path || props.contextName || '当前行政区域'
})
function barHeight(value: number) { return value === 0 ? 0 : Math.max(10, value / (maxPrecip.value || 1) * 100) }
function updateHourHints() {
  const el = hours.value
  if (!el) return
  hourCanLeft.value = el.scrollLeft > 1
  hourCanRight.value = el.scrollLeft + el.clientWidth < el.scrollWidth - 1
}
function scrollHours(direction: number) {
  hours.value?.scrollBy({ left: direction * 180, behavior: 'smooth' })
  requestAnimationFrame(updateHourHints)
}
function onHourWheel(event: WheelEvent) {
  if (!hours.value || Math.abs(event.deltaY) <= Math.abs(event.deltaX)) return
  const canScroll = event.deltaY > 0 ? hours.value.scrollLeft + hours.value.clientWidth < hours.value.scrollWidth : hours.value.scrollLeft > 0
  if (canScroll) {
    event.preventDefault()
    hours.value.scrollLeft += event.deltaY
    updateHourHints()
  }
}
</script>

<style scoped>
.weather-popup {
  position: fixed;
  z-index: 1040;
  width: 360px;
  max-height: calc(100vh - 24px);
  display: flex;
  flex-direction: column;
  border: 1px solid rgba(148, 163, 184, .45);
  border-radius: 12px;
  background: #fff;
  box-shadow: 0 12px 30px rgba(15, 23, 42, .25);
  color: #0f172a;
  outline: 0;
}
.weather-popup::after {
  content: '';
  position: absolute;
  left: var(--anchor-x);
  bottom: -9px;
  width: 16px;
  height: 16px;
  border-right: 1px solid rgba(148, 163, 184, .45);
  border-bottom: 1px solid rgba(148, 163, 184, .45);
  background: #fff;
  transform: translateX(-50%) rotate(45deg);
}
.weather-popup.below::after { top: -9px; bottom: auto; transform: translateX(-50%) rotate(225deg); }
.weather-popup > header {
  flex: none;
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 8px;
  min-height: 42px;
  padding: 0 10px 0 14px;
  border-bottom: 1px solid #e2e8f0;
  border-radius: 11px 11px 0 0;
  background: #f8fafc;
}
.weather-popup > header strong { font-size: 15px; letter-spacing: -.01em; }
.weather-popup.alert > header { border-bottom-color: transparent; background: var(--warning); color: #fff; }
.weather-popup:focus-visible, .weather-popup button:focus-visible, .hour-strip:focus-visible { outline: 3px solid rgba(37, 99, 235, .4); outline-offset: 2px; }
.weather-popup header button {
  display: grid;
  width: 30px;
  height: 30px;
  place-items: center;
  border: 0;
  border-radius: 6px;
  background: transparent;
  color: inherit;
  font-size: 20px;
  cursor: pointer;
}
.weather-popup header button:hover { background: rgba(148, 163, 184, .18); }
.popup-body { min-height: 0; overflow: auto; padding: 10px 12px 12px; }
.popup-body section + section { margin-top: 10px; padding-top: 10px; border-top: 1px solid #e2e8f0; }
.popup-body h3, .popup-body p { margin: 0; }
.popup-body h3 { font-size: 13px; line-height: 1.3; }
.popup-body h3 small { margin-left: 4px; font-weight: 500; color: #64748b; }
.popup-body h3 em { display: block; margin-top: 2px; color: #b45309; font-size: 10px; font-style: normal; }
.popup-body p { white-space: pre-wrap; font-size: 12px; line-height: 1.5; }
.alert-fields { display: grid; gap: 5px; margin: 0 0 10px; }
.alert-fields div { display: grid; grid-template-columns: 90px 1fr; gap: 8px; font-size: 12px; }
.alert-fields dt, .weather-metrics dt { color: #64748b; }
.alert-fields dd, .weather-metrics dd { margin: 0; font-variant-numeric: tabular-nums; }
.popup-loading { min-height: 140px; display: grid; place-items: center; align-content: center; gap: 8px; color: #475569; font-size: 12px; }
.popup-loading i { font-size: 28px; }
.popup-loading button { padding: 5px 9px; border: 0; border-radius: 5px; background: #2563eb; color: #fff; cursor: pointer; }
.query-context { display: grid; gap: 2px; margin-bottom: 10px; padding: 7px 8px; border-radius: 7px; background: #f1f5f9; font-size: 11px; }
.query-context strong { font-size: 12px; }
.query-context span, .data-freshness, .minutely-meta small { color: #64748b; font-variant-numeric: tabular-nums; }
.current-main { display: flex; align-items: center; gap: 8px; min-height: 38px; padding: 5px 0 7px; font-size: 16px; }
.current-main > i { color: #2563eb; font-size: 25px; }
.current-main b { margin-left: 3px; font-size: 20px; font-variant-numeric: tabular-nums; }
.weather-metrics { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 0 12px; margin: 0; }
.weather-metrics div { display: flex; justify-content: space-between; gap: 6px; min-width: 0; padding: 5px 0; border-top: 1px solid #eef2f7; font-size: 11px; }
.weather-metrics dd { overflow: hidden; color: #1e293b; text-overflow: ellipsis; white-space: nowrap; }
.data-freshness { display: block; margin-top: 6px; font-size: 10px; }
.module-error { display: flex; justify-content: space-between; align-items: center; gap: 8px; padding: 7px 8px; border-radius: 7px; background: #fef2f2; color: #991b1b; font-size: 12px; }
.module-error button { flex: none; border: 0; border-radius: 5px; background: #b91c1c; color: #fff; cursor: pointer; }
.section-heading { display: flex; justify-content: space-between; align-items: baseline; }
.minutely-meta { display: flex; justify-content: space-between; align-items: baseline; gap: 8px; margin-top: 5px; }
.minutely-meta p { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.minutely-meta small { flex: none; font-size: 10px; }
.rain-legend { display: flex; gap: 9px; margin: 5px 0; color: #64748b; font-size: 10px; }
.rain-legend span { display: inline-flex; align-items: center; gap: 4px; }
.rain-legend i { width: 6px; height: 6px; border-radius: 50%; background: #3b82f6; }
.rain-legend .snow i { background: #94a3b8; }
.rain-legend .other i { background: #64748b; }
.bars { height: 56px; display: flex; align-items: flex-end; gap: 2px; border-bottom: 1px solid #94a3b8; overflow: hidden; }
.bars button { flex: 1; height: 100%; display: flex; align-items: flex-end; padding: 0; border: 0; background: transparent; cursor: pointer; }
.bars button:hover i { filter: brightness(.84); }
.bars button:focus-visible i { outline: 2px solid #1d4ed8; outline-offset: -2px; }
.bars i { display: block; width: 100%; min-height: 0; background: #3b82f6; transition: height 160ms ease-out, filter 160ms ease-out; }
.bars i.snow { background: #94a3b8; }
.bars i.other { background: #64748b; }
.minute-axis { display: flex; justify-content: space-between; margin-top: 3px; color: #64748b; font-size: 9px; font-variant-numeric: tabular-nums; }
.zero { padding-top: 5px; color: #166534; }
.hour-shell { position: relative; }
.hour-strip { display: flex; gap: 6px; overflow-x: auto; padding: 4px 1px 8px; overscroll-behavior: contain; }
.hour-hint { position: absolute; top: 50%; z-index: 2; display: grid; width: 18px; height: 32px; place-items: center; transform: translateY(-50%); border-radius: 4px; background: rgba(15, 23, 42, .72); color: #fff; pointer-events: none; }
.hour-hint.left { left: 2px; }
.hour-hint.right { right: 2px; }
.hour-strip article { flex: 0 0 96px; display: grid; justify-items: center; gap: 3px; padding: 7px 4px; border: 1px solid #e2e8f0; border-radius: 8px; background: #f8fafc; font-size: 10px; }
.hour-strip article i { color: #2563eb; font-size: 19px; }
.hour-strip time, .hour-strip b { font-variant-numeric: tabular-nums; }
.responsibility { margin-top: 10px !important; padding-top: 8px; border-top: 1px solid #e2e8f0; color: #64748b; font-size: 10px !important; line-height: 1.45 !important; }
.refer { display: flex; flex-wrap: wrap; gap: 4px 6px; padding-top: 5px; color: #94a3b8; font-size: 10px; }
.refer span + span::before { content: '·'; margin-right: 6px; color: #cbd5e1; }
@media (max-width: 520px) {
  .weather-popup { width: calc(100vw - 24px); max-height: calc(100vh - 24px); }
  .weather-popup::after { display: block; }
}
</style>
