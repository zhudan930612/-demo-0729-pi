import type { NationalAlarmMapContext, NationalWeatherAlarm } from './nationalAlarmTypes'

export function sortNationalAlarms(items: readonly NationalWeatherAlarm[]) { return [...items].sort((a, b) => (Date.parse(b.issuedAt ?? '') - Date.parse(a.issuedAt ?? '')) || a.id.localeCompare(b.id)) }
function currentCounty(context: NationalAlarmMapContext) { return context.level === 'county' ? context.code : context.countyCode ?? null }
export function alarmsForMap(items: readonly NationalWeatherAlarm[], context: NationalAlarmMapContext) {
  const county = currentCounty(context)
  return sortNationalAlarms(items).filter((alarm) => {
    if (!alarm.mappableInZhejiang || alarm.mapLocation.status !== 'mapped' || !alarm.adminCode) return false
    if (context.level === 'province') return alarm.adminLevel === 'province' || alarm.adminLevel === 'city'
    if (context.level === 'city') return alarm.adminLevel === 'county' && alarm.adminCode.slice(0, 4) === context.code.slice(0, 4)
    return Boolean(county) && alarm.adminLevel === 'county' && alarm.adminCode === county
  })
}
export function mapNotice(items: readonly NationalWeatherAlarm[], context: NationalAlarmMapContext) {
  const visible = alarmsForMap(items, context)
  if (['township', 'village'].includes(context.level)) return '预警地图查看到县级'
  if (context.level === 'province' && !visible.length && items.some((item) => item.adminLevel === 'county')) return '当前层级无预警图标；请从右上列表进入市县查看'
  return ''
}
export function formatNationalAlarmTime(value: string | null | undefined) {
  if (!value) return '--'; const date = new Date(value); if (Number.isNaN(date.getTime())) return '--'
  return new Intl.DateTimeFormat('zh-CN', { timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false }).format(date).replace(/\//g, '/')
}
