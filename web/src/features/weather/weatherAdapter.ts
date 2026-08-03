import type { AlertRegion, HourlyItem, MinutelyForecast, WeatherAlert, WeatherBundle, WeatherModule, WeatherSelection } from './weatherTypes'

const severityRank: Record<string, number> = { Extreme: 5, Severe: 4, Moderate: 3, Minor: 2, Unknown: 1 }
const enumZh: Record<string, string> = {
  Immediate:'立即', Expected:'预计', Future:'未来', Past:'过去', Unknown:'未知',
  Extreme:'极端', Severe:'严重', Moderate:'中等', Minor:'轻微', Observed:'已观测', Likely:'很可能', Possible:'可能', Unlikely:'不太可能',
}
export function weatherEnumZh(value: string | null | undefined): string { return value ? enumZh[value] ?? '未知' : '--' }
export function percentage(value: number | null | undefined): string { return value == null || !Number.isFinite(value) || value < 0 || value > 1 ? '--' : `${Math.round(value * 100)}%` }
export function unitText(value: { value:number|null; unit:string|null } | null | undefined): string { return value?.value == null ? '--' : `${value.value}${value.unit ? ` ${value.unit}` : ''}` }
export function formatBeijing(value: string | null | undefined, withDate = true): string {
  if (!value || Number.isNaN(Date.parse(value))) return '--'
  return new Intl.DateTimeFormat('zh-CN', { timeZone:'Asia/Shanghai', ...(withDate ? { year:'numeric',month:'2-digit',day:'2-digit' } : {}), hour:'2-digit',minute:'2-digit',hour12:false }).format(new Date(value)).replaceAll('/','/')
}
export function sortAlerts(alerts: readonly WeatherAlert[]): WeatherAlert[] {
  return [...alerts].sort((a,b)=>(severityRank[b.severity ?? '']??0)-(severityRank[a.severity ?? '']??0) || Date.parse(b.issuedTime ?? '')-Date.parse(a.issuedTime ?? ''))
}
export function sortAlertRegions(regions: readonly AlertRegion[]): AlertRegion[] {
  return [...regions].sort((a,b)=>{
    const aa=sortAlerts(a.alerts??[])[0], bb=sortAlerts(b.alerts??[])[0]
    return (severityRank[bb?.severity??'']??0)-(severityRank[aa?.severity??'']??0) || Date.parse(bb?.issuedTime??'')-Date.parse(aa?.issuedTime??'') || a.code.localeCompare(b.code)
  })
}
export function selectedAlert(bundle: WeatherBundle | null, selection: WeatherSelection | null): { region:AlertRegion; alert:WeatherAlert } | null {
  if (!bundle || !selection) return null
  const region=bundle.alerts.data.find(r=>r.code===selection.contextCode), alert=region?.alerts?.find(a=>a.id===selection.alertId)
  return region&&alert?{region,alert}:null
}
export function minutelyState(module: WeatherModule<MinutelyForecast>): 'loading'|'error'|'empty'|'zero'|'data' {
  if (module.status==='error') return 'error'; if (module.status==='empty'||!module.data) return 'empty'
  if (!module.data.minutely.length) return 'empty'
  return module.data.minutely.every(i=>i.precip===0)?'zero':'data'
}
export function hourlyCards(module: WeatherModule<HourlyItem[]>): { items:HourlyItem[]; incomplete:boolean } {
  if (module.status!=='success'||!Array.isArray(module.data)) return {items:[],incomplete:false}
  const indexed=module.data.map((item,index)=>({item,index})).sort((a,b)=>Date.parse(a.item.forecastTime)-Date.parse(b.item.forecastTime)||a.index-b.index)
  return {items:indexed.map(x=>x.item),incomplete:indexed.length<24}
}
export function locationTitle(bundle: WeatherBundle, contextName: string, parcel:boolean): string {
  const address=bundle.address.status==='success'&&bundle.address.data?.address?.trim()
  if(address)return `${address}附近`
  if(bundle.target==='picked')return '地图点选位置附近'
  return parcel?'当前地块查询点附近':`${contextName}代表点附近`
}
export function iconClass(code:string|null|undefined, fallback='999'): string {
  return /^\d{3,4}$/.test(code??'')?`qi-${code}`:`qi-${fallback}`
}
export function warningColor(alert:WeatherAlert): string {
  const c=alert.color; return c&&[c.red,c.green,c.blue].every(Number.isFinite)?`rgba(${c.red},${c.green},${c.blue},${c.alpha==null?1:Math.max(0,Math.min(1,c.alpha))})`:'#64748b'
}
export function precipitationType(value:string|null|undefined):string { return ({rain:'雨',snow:'雪',none:'无降水',sleet:'雨夹雪',ice:'冰粒/冻雨',mixed:'混合降水'} as Record<string,string>)[value??'']??(value?'其他降水':'--') }
