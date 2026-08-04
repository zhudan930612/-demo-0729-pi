import type { NationalAlarmMapContext, NationalWeatherAlarm } from './nationalAlarmTypes'

export function sortNationalAlarms(items: readonly NationalWeatherAlarm[]) { return [...items].sort((a, b) => (Date.parse(b.issuedAt ?? '') - Date.parse(a.issuedAt ?? '')) || a.id.localeCompare(b.id)) }
export function alarmsForMap(items: readonly NationalWeatherAlarm[], _context: NationalAlarmMapContext) {
  // The full Zhejiang snapshot remains visible at every navigation level. Each
  // record stays anchored to its verified government seat; we never move it to
  // the currently selected administrative area or manufacture a replacement.
  return sortNationalAlarms(items).filter((alarm) => alarm.mappableInZhejiang && alarm.mapLocation.status === 'mapped' && Boolean(alarm.adminCode))
}
export function mapNotice(_items: readonly NationalWeatherAlarm[], _context: NationalAlarmMapContext) { return '' }
export function formatNationalAlarmTime(value: string | null | undefined) {
  if (!value) return '--'; const date = new Date(value); if (Number.isNaN(date.getTime())) return '--'
  return new Intl.DateTimeFormat('zh-CN', { timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false }).format(date).replace(/\//g, '/')
}
