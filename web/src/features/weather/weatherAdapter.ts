import type { AlertRegion, HourlyItem, MinutelyForecast, WeatherAlert, WeatherBundle, WeatherModule, WeatherSelection } from './weatherTypes'

const severityRank: Record<string, number> = { extreme: 5, severe: 4, moderate: 3, minor: 2, unknown: 1 }
const enumZh: Record<string, string> = {
  immediate:'立即', expected:'预计', future:'未来', past:'过去', unknown:'未知',
  extreme:'极端', severe:'严重', moderate:'中等', minor:'轻微', observed:'已观测', likely:'很可能', possible:'可能', unlikely:'不太可能',
}
function normalizedEnum(value:string|null|undefined):string{return value?.trim().toLowerCase()??''}
export function weatherEnumZh(value: string | null | undefined): string { return value ? enumZh[normalizedEnum(value)] ?? '未知' : '--' }
export function percentage(value: number | null | undefined): string { return value == null || !Number.isFinite(value) || value < 0 || value > 1 ? '--' : `${Math.round(value * 100)}%` }
export function unitText(value: { value:number|null; unit:string|null } | null | undefined): string { return value?.value == null ? '--' : `${value.value}${value.unit ? ` ${value.unit}` : ''}` }
export function formatBeijing(value: string | null | undefined, withDate = true): string {
  if (!value || Number.isNaN(Date.parse(value))) return '--'
  return new Intl.DateTimeFormat('zh-CN', { timeZone:'Asia/Shanghai', ...(withDate ? { year:'numeric',month:'2-digit',day:'2-digit' } : {}), hour:'2-digit',minute:'2-digit',hour12:false }).format(new Date(value)).replaceAll('/','/')
}
export function sortAlerts(alerts: readonly WeatherAlert[]): WeatherAlert[] {
  return [...alerts].sort((a,b)=>(severityRank[normalizedEnum(b.severity)]??0)-(severityRank[normalizedEnum(a.severity)]??0) || Date.parse(b.issuedTime ?? '')-Date.parse(a.issuedTime ?? ''))
}
export function sortAlertRegions(regions: readonly AlertRegion[]): AlertRegion[] {
  return [...regions].sort((a,b)=>{
    const aa=sortAlerts(a.alerts??[])[0], bb=sortAlerts(b.alerts??[])[0]
    return (severityRank[normalizedEnum(bb?.severity)]??0)-(severityRank[normalizedEnum(aa?.severity)]??0) || Date.parse(bb?.issuedTime??'')-Date.parse(aa?.issuedTime??'') || a.code.localeCompare(b.code)
  })
}
export function selectedAlert(bundle: WeatherBundle | null, selection: WeatherSelection | null): { region:AlertRegion; alert:WeatherAlert } | null {
  if (!bundle || !selection) return null
  const region=bundle.alerts.data.find(r=>r.code===selection.contextCode), alert=region?.alerts?.find(a=>a.id===selection.alertId)
  return region&&alert?{region,alert}:null
}
export function moduleHasRefreshFailure(module:WeatherModule<unknown>):boolean{return module.status==='error'||Boolean(module.stale&&module.refreshError)}
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
const warningColorMap:Record<string,string>={red:'#dc2626',红:'#dc2626',红色:'#dc2626',红色预警:'#dc2626',orange:'#ea580c',橙:'#ea580c',橙色:'#ea580c',橙色预警:'#ea580c',yellow:'#ca8a04',黄:'#ca8a04',黄色:'#ca8a04',黄色预警:'#ca8a04',blue:'#2563eb',蓝:'#2563eb',蓝色:'#2563eb',蓝色预警:'#2563eb',white:'#e2e8f0',白:'#e2e8f0',白色:'#e2e8f0',gray:'#64748b',grey:'#64748b',black:'#0f172a'}
const warningLevelMap:Record<string,string>={red:'红色预警',红:'红色预警',红色:'红色预警',红色预警:'红色预警',orange:'橙色预警',橙:'橙色预警',橙色:'橙色预警',橙色预警:'橙色预警',yellow:'黄色预警',黄:'黄色预警',黄色:'黄色预警',黄色预警:'黄色预警',blue:'蓝色预警',蓝:'蓝色预警',蓝色:'蓝色预警',蓝色预警:'蓝色预警',white:'白色预警',白:'白色预警',白色:'白色预警',gray:'灰色预警',grey:'灰色预警',black:'黑色预警'}
function normalizedColor(value:string|null|undefined):string{const trimmed=value?.trim()??'';return /^[a-z]+$/i.test(trimmed)?trimmed.toLowerCase():trimmed}
export function warningLevelText(alert:WeatherAlert):string{const level=warningLevelMap[normalizedColor(alert.color?.code)];if(level)return level;const severity=weatherEnumZh(alert.severity);return severity==='--'||severity==='未知'?'天气预警':`${severity}预警`}
export function warningColor(alert:WeatherAlert): string {
  const c=alert.color;if(c&&[c.red,c.green,c.blue].every(Number.isFinite))return`rgba(${c.red},${c.green},${c.blue},${c.alpha==null?1:Math.max(0,Math.min(1,c.alpha))})`
  return warningColorMap[normalizedColor(c?.code)]??'#64748b'
}
export function warningForeground(alert:WeatherAlert):'#fff'|'#0f172a'{const c=alert.color;if(c&&[c.red,c.green,c.blue].every(Number.isFinite)){const luminance=(.2126*(c.red??0)+.7152*(c.green??0)+.0722*(c.blue??0))/255;return luminance>.58?'#0f172a':'#fff'}return['yellow','黄','黄色','黄色预警','white','白','白色'].includes(normalizedColor(c?.code))?'#0f172a':'#fff'}
export function hourTimeLabel(value:string,firstValue:string,index:number):string{if(Number.isNaN(Date.parse(value)))return'--';const d=new Date(value),first=new Date(firstValue);const fmt=(options:Intl.DateTimeFormatOptions)=>new Intl.DateTimeFormat('zh-CN',{timeZone:'Asia/Shanghai',...options}).format(d);const time=fmt({hour:'2-digit',minute:'2-digit',hour12:false});const dayKey=(date:Date)=>new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Shanghai',year:'numeric',month:'2-digit',day:'2-digit'}).format(date);if(index===0&&dayKey(d)!==dayKey(new Date()))return`${fmt({month:'2-digit',day:'2-digit'})} ${time}`;if(index>0&&dayKey(d)!==dayKey(first))return`明天 ${time}`;return time}
export function precipitationType(value:string|null|undefined):string { return ({rain:'雨',snow:'雪',none:'无降水',sleet:'雨夹雪',ice:'冰粒/冻雨',mixed:'混合降水'} as Record<string,string>)[value??'']??(value?'其他降水':'--') }
