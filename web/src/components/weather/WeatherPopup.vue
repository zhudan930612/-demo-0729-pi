<template>
  <section ref="dialog" class="weather-popup" :class="[kind, placement, side]" :style="positionStyle" role="dialog" aria-modal="false" tabindex="-1" :aria-label="kind === 'alert' ? '天气预警详情' : '位置天气详情'" @click.stop>
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
        <p class="query-context"><svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 21s-7-5.1-7-11a7 7 0 0 1 14 0c0 5.9-7 11-7 11z"/><circle cx="12" cy="10" r="2.6"/></svg><span>{{ locationContext }}</span></p>

        <section class="current" :class="{ hero: bundle?.current.status === 'success' }">
          <template v-if="bundle.current.status === 'success'">
            <div class="hero-head"><h3>当前天气</h3><span v-if="currentRange" class="current-range">{{ currentRange }}</span></div>
            <div class="current-main">
              <QWeatherIcon :code="bundle.current.data.condition.code" />
              <span class="hero-cond">{{ bundle.current.data.condition.text || '--' }}</span>
              <b class="hero-temp">{{ temperatureText(bundle.current.data.temperature) }}</b>
            </div>
            <dl class="weather-metrics">
              <div><dt>体感温度</dt><dd>{{ temperatureText(bundle.current.data.feelsLike) }}</dd></div>
              <div><dt>近一小时降水</dt><dd>{{ unitText(bundle.current.data.precipitation?.amount) }}</dd></div>
              <div><dt>降水强度</dt><dd>{{ unitText(bundle.current.data.precipitation?.intensity) }}</dd></div>
              <div><dt>降水类型</dt><dd>{{ precipitationType(bundle.current.data.precipitation?.type) }}</dd></div>
              <div><dt>湿度</dt><dd>{{ percentage(bundle.current.data.humidity) }}</dd></div>
            </dl>
            <small class="data-freshness">获取时间 {{ formatBeijing(bundle.current.fetchedAt) }}</small>
          </template>
          <div v-else-if="bundle.current.status === 'error'" class="module-error">实时天气加载失败 <button @click="emit('retry', 'current')">重试</button></div>
          <div v-if="bundle.current.status !== 'error' && bundle.current.stale && bundle.current.refreshError" class="module-error refresh-error">实时天气更新失败，上次成功于 {{ formatBeijing(bundle.current.fetchedAt) }} <button @click="emit('retry', 'current')">重试</button></div>
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
            <button v-show="hourCanLeft" type="button" class="hour-hint left" aria-label="查看前面的小时预报" @click="scrollHours(-1)">‹</button>
            <div ref="hours" class="hour-strip" tabindex="0" aria-label="未来24小时天气，可使用左右方向键浏览" @scroll="updateHourHints" @keydown.left.prevent="scrollHours(-1)" @keydown.right.prevent="scrollHours(1)" @wheel="onHourWheel">
              <article v-for="(item, index) in hourly.items" :key="`${item.forecastTime}-${index}`" :class="{ now: index === 0 }">
                <span class="hour-row top"><time>{{ hourTimeLabel(item.forecastTime, hourly.items[0]?.forecastTime || item.forecastTime, index) }}</time><QWeatherIcon :code="item.condition.code" /></span>
                <span class="hour-row mid"><strong :title="item.condition.text || '--'">{{ item.condition.text || '--' }}</strong><b>{{ temperatureText(item.temperature) }}</b></span>
                <span class="hour-row bottom"><span>降水 {{ percentage(item.precipitation?.probability) }}</span><span>{{ unitText(item.precipitation?.amount) }}</span></span>
              </article>
            </div>
            <button v-show="hourCanRight" type="button" class="hour-hint right" aria-label="查看后面的小时预报" @click="scrollHours(1)">›</button>
          </div>
        </section>

        <p class="responsibility">查询约 1 km 附近的信息，不代表地块或行政区域实测，仅供风险辅助。</p>
      </template>

      <div v-else-if="phase === 'error'" class="popup-loading popup-request-error" role="alert"><i class="qi-999" aria-hidden="true"></i><strong>位置天气加载失败</strong><span>{{ errorMessage || '请稍后重试' }}</span><button type="button" @click="emit('retry', 'current')">重试</button></div>
      <div v-else class="popup-loading" role="status"><i class="qi-999" aria-hidden="true"></i><strong>正在加载新位置天气…</strong></div>
    </div>
  </section>
</template>

<script setup lang="ts">
import { computed, nextTick, onMounted, onBeforeUnmount, ref } from 'vue'
import type { WeatherAlert, WeatherBundle } from '../../features/weather/weatherTypes'
import { formatBeijing, hourlyCards, hourTimeLabel, minutelyState, percentage, precipitationType, temperatureText, unitText, warningColor, weatherEnumZh } from '../../features/weather/weatherAdapter'
import QWeatherIcon from './QWeatherIcon.vue'

const props = defineProps<{ kind: 'alert' | 'location'; title: string; bundle?: WeatherBundle | null; alert?: WeatherAlert | null; x: number; y: number; contextName?: string; contextPath?: string[]; phase?: string; errorMessage?: string }>()
const emit = defineEmits<{ close: []; retry: [module: 'current' | 'minutely' | 'hourly'] }>()
const dialog = ref<HTMLElement | null>(null)
const hours = ref<HTMLElement | null>(null)
const hourCanLeft = ref(false)
const hourCanRight = ref(false)
const measuredWidth = ref(360)
const measuredHeight = ref(320)
const placement = ref<'above' | 'below'>('above')
const side = ref<'left' | 'right'>('right')
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
  side.value = props.x + 120 + measuredWidth.value <= window.innerWidth - 12 ? 'right' : 'left'
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
  const markerWidth = 84
  const gap = 12
  const width = narrow ? viewport.value.width - pad * 2 : measuredWidth.value
  const preferredLeft = side.value === 'right' ? props.x + markerWidth + gap : props.x - width - gap
  const left = narrow ? pad : Math.max(pad, Math.min(preferredLeft, viewport.value.width - pad - width))
  const top = narrow
    ? Math.max(pad, Math.min(props.y + 12, viewport.value.height - pad - measuredHeight.value - 2))
    : Math.max(pad, Math.min(props.y - measuredHeight.value / 2, viewport.value.height - pad - measuredHeight.value - 2))
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
const currentRange = computed(() => {
  const data = props.bundle?.current.status === 'success' ? props.bundle.current.data : null
  if (!data) return ''
  const high = data.high, low = data.low
  if ((!high || high.value == null) && (!low || low.value == null)) return ''
  const unit = high?.unit ?? low?.unit ?? ''
  const highText = high?.value != null ? String(Math.round(high.value)) : '--'
  const lowText = low?.value != null ? String(Math.round(low.value)) : '--'
  return `${highText}/${lowText}${unit}`
})
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
.weather-popup.location::after { display: none; }
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
.weather-popup > header strong { font-size: 14px; letter-spacing: -.01em; font-weight: 700; }
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
.weather-popup header button:hover { background: rgba(148, 163, 184, .22); }
.popup-body { min-height: 0; overflow: auto; padding: 12px; }
.popup-body section { margin: 0; padding: 12px; border: 1px solid #eef2f7; border-radius: 12px; background: #f8fafc; }
.popup-body section + section { margin-top: 10px; }
.popup-body h3, .popup-body p { margin: 0; }
.popup-body h3 { font-size: 13px; line-height: 1.3; }
.popup-body h3 small { margin-left: 6px; padding: 1px 7px; border-radius: 999px; background: #eff6ff; color: #1d4ed8; font-weight: 600; font-size: 10px; }
.popup-body h3 em { display: block; margin-top: 2px; color: #b45309; font-size: 10px; font-style: normal; }
.popup-body p { white-space: pre-wrap; font-size: 12px; line-height: 1.5; }
.alert-fields { display: grid; gap: 5px; margin: 0 0 10px; padding: 10px 12px; border: 1px solid #eef2f7; border-radius: 12px; background: #f8fafc; }
.alert-fields div { display: grid; grid-template-columns: 90px 1fr; gap: 8px; font-size: 12px; }
.alert-fields dt, .weather-metrics dt { color: #64748b; }
.alert-fields dd, .weather-metrics dd { margin: 0; font-variant-numeric: tabular-nums; }
.popup-loading { min-height: 140px; display: grid; place-items: center; align-content: center; gap: 8px; color: #475569; font-size: 12px; }
.popup-loading i { font-size: 28px; }
.popup-loading button { padding: 5px 9px; border: 0; border-radius: 5px; background: #2563eb; color: #fff; cursor: pointer; }
.query-context { display: flex; align-items: center; gap: 6px; margin: 0 0 10px !important; padding: 8px 10px; overflow-wrap: anywhere; border-radius: 8px; background: #eef2f7; color: #475569; font-size: 12px !important; line-height: 1.45 !important; }
.query-context svg { flex: none; color: #2563eb; }
.query-context span { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.data-freshness, .minutely-meta small { color: #64748b; font-variant-numeric: tabular-nums; }
.current-main { display: flex; align-items: center; gap: 10px; min-height: 44px; padding: 6px 0 8px; }
.current-main > i { flex: none; color: #2563eb; font-size: 30px; }
.current.hero .current-main > i { color: #fff; font-size: 34px; }
.hero-cond { min-width: 0; font-size: 15px; font-weight: 600; line-height: 1.25; }
.current.hero .hero-cond { color: rgba(255, 255, 255, .85); }
.hero-temp { margin-left: auto; font-size: 32px; font-weight: 700; white-space: nowrap; font-variant-numeric: tabular-nums; }
.current-range { flex: none; margin-left: 2px; padding: 2px 8px; border: 1px solid #e2e8f0; border-radius: 999px; background: #f1f5f9; color: #475569; font-size: 11px; font-weight: 700; white-space: nowrap; font-variant-numeric: tabular-nums; }
.current.hero { padding: 14px; background: #0f172a; border-color: #0f172a; color: #fff; }
.hero-head { display: flex; justify-content: space-between; align-items: center; gap: 8px; }
.hero-head h3 { color: rgba(255, 255, 255, .9); }
.current.hero .current-range { border-color: rgba(255, 255, 255, .16); background: rgba(255, 255, 255, .12); color: #fff; }
.current.hero .weather-metrics div { border-top-color: rgba(255, 255, 255, .1); }
.current.hero .weather-metrics dt { color: rgba(255, 255, 255, .6); }
.current.hero .weather-metrics dd { color: #fff; }
.current.hero .data-freshness { color: rgba(255, 255, 255, .45); }
.current.hero .module-error { background: rgba(127, 29, 29, .9); color: #fecaca; }
.current.hero .module-error button { background: #fecaca; color: #7f1d1d; }
.weather-metrics { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 0 12px; margin: 4px 0 0; }
.weather-metrics div { display: flex; justify-content: space-between; gap: 6px; min-width: 0; padding: 6px 0; border-top: 1px solid #f1f5f9; font-size: 11px; }
.weather-metrics dd { overflow: hidden; color: #1e293b; font-weight: 600; text-overflow: ellipsis; white-space: nowrap; }
.data-freshness { display: block; margin-top: 6px; font-size: 10px; color: #94a3b8; }
.module-error { display: flex; justify-content: space-between; align-items: center; gap: 8px; padding: 7px 8px; border-radius: 7px; background: #fef2f2; color: #991b1b; font-size: 12px; }
.module-error button { flex: none; border: 0; border-radius: 5px; background: #b91c1c; color: #fff; cursor: pointer; }
.section-heading { display: flex; justify-content: space-between; align-items: baseline; }
.minutely-meta { display: flex; justify-content: space-between; align-items: baseline; gap: 8px; margin-top: 5px; }
.minutely-meta p { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.minutely-meta small { flex: none; font-size: 10px; }
.rain-legend { display: flex; gap: 10px; margin: 6px 0 5px; color: #64748b; font-size: 10px; }
.rain-legend span { display: inline-flex; align-items: center; gap: 4px; }
.rain-legend i { width: 6px; height: 6px; border-radius: 50%; background: #3b82f6; }
.rain-legend .snow i { background: #94a3b8; }
.rain-legend .other i { background: #64748b; }
.bars { height: 64px; display: flex; align-items: flex-end; gap: 3px; padding: 0 7px; border: 1px solid #e2e8f0; border-radius: 8px; background: #fff; overflow: hidden; }
.bars button { flex: 1; height: 100%; display: flex; align-items: flex-end; padding: 0; border: 0; background: transparent; cursor: pointer; }
.bars button:hover i { filter: brightness(.84); }
.bars button:focus-visible i { outline: 2px solid #1d4ed8; outline-offset: -2px; }
.bars i { display: block; width: 100%; min-height: 0; border-radius: 2px 2px 0 0; background: #3b82f6; transform-origin: bottom; animation: bars-rise 220ms ease-out; }
@keyframes bars-rise { from { transform: scaleY(0); } to { transform: scaleY(1); } }
.bars i.snow { background: #94a3b8; }
.bars i.other { background: #64748b; }
.minute-axis { display: flex; justify-content: space-between; margin-top: 4px; padding: 0 7px; color: #64748b; font-size: 10px; font-variant-numeric: tabular-nums; }
.zero { padding-top: 5px; color: #166534; }
.hour-shell { position: relative; }
.hour-strip { display: flex; gap: 6px; overflow-x: auto; padding: 4px 1px 8px; scrollbar-width: none; overscroll-behavior: contain; }
.hour-strip::-webkit-scrollbar { display: none; }
.hour-hint { position: absolute; top: 50%; z-index: 2; display: grid; width: 22px; height: 22px; place-items: center; padding: 0; transform: translateY(-50%); border: 0; border-radius: 50%; background: rgba(15, 23, 42, .55); color: #fff; font-size: 13px; line-height: 1; cursor: pointer; }
.hour-hint:hover { background: #1d4ed8; }
.hour-hint.left { left: 2px; }
.hour-hint.right { right: 2px; }
.hour-strip article { flex: 0 0 110px; display: grid; gap: 4px; padding: 7px 8px; border: 1px solid #e2e8f0; border-radius: 10px; background: #fff; font-size: 10px; transition: border-color 150ms ease-out, background-color 150ms ease-out; }
.hour-strip article:hover { border-color: #93c5fd; }
.hour-strip article.now { border-color: #2563eb; background: #2563eb; box-shadow: inset 0 0 0 1px #3b82f6; }
.hour-strip article.now time { color: #fff; font-weight: 700; }
.hour-strip article.now strong { color: #fff; }
.hour-strip article.now b { color: #fff; }
.hour-strip article.now i { color: #fff; }
.hour-strip article.now .hour-row.top, .hour-strip article.now .hour-row.bottom { color: rgba(255, 255, 255, .78); }
.hour-strip article i { color: #2563eb; font-size: 17px; }
.hour-strip time, .hour-strip b { font-variant-numeric: tabular-nums; }
.hour-row { display: flex; align-items: center; gap: 4px; min-width: 0; }
.hour-row.top { justify-content: space-between; color: #64748b; }
.hour-row.mid strong { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-weight: 600; }
.hour-row.mid b { font-size: 12px; }
.hour-row.bottom { justify-content: space-between; color: #64748b; font-variant-numeric: tabular-nums; white-space: nowrap; }
.responsibility { margin-top: 12px !important; padding-top: 10px; border-top: 1px solid #e2e8f0; color: #94a3b8; font-size: 10px !important; line-height: 1.5 !important; }
@media (max-width: 520px) {
  .weather-popup { width: calc(100vw - 24px); max-height: calc(100vh - 24px); }
  .weather-popup::after { display: block; }
}
</style>
