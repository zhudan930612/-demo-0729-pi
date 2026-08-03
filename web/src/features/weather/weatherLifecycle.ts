import type { Feature } from 'geojson'
import type { Crumb } from '../../stores/drilldown'
import type { DisasterViewMode, WeatherQuery } from './weatherTypes'

const CODE_PATTERN:Record<Crumb['level'],RegExp>={province:/^330000$/,city:/^33\d{2}00$/,county:/^33\d{2}(?!00)\d{2}$/,township:/^33\d{7}000$/,village:/^33\d{10}$/}
export function isZhejiangCrumb(crumb:Crumb|null):boolean{
 if(!crumb||!CODE_PATTERN[crumb.level].test(crumb.code))return false
 if(crumb.level==='township')return crumb.code.slice(6,9)!=='000'
 if(crumb.level==='village')return crumb.code.slice(6,9)!=='000'&&crumb.code.slice(9)!=='000'
 return true
}
export function weatherEntryState(input:{mode:DisasterViewMode;crumb:Crumb|null;hasUnsavedWork:boolean}){
 if(input.hasUnsavedWork)return{enabled:false,reason:'请先保存或取消当前未完成操作'}
 if(input.mode!=='none')return{enabled:false,reason:input.mode==='weather'?'天气查看模式已开启':'请先退出台风查看'}
 if(!isZhejiangCrumb(input.crumb))return{enabled:false,reason:'天气当前仅支持浙江省范围'}
 return{enabled:true,reason:'查看天气'}
}
export function createDisasterViewModeCoordinator(initial:DisasterViewMode='none'){
 let mode=initial
 return{get mode(){return mode},enter(next:Exclude<DisasterViewMode,'none'>){if(mode!=='none')return false;mode=next;return true},exit(expected:Exclude<DisasterViewMode,'none'>){if(mode!==expected)return false;mode='none';return true}}
}
export function defaultWeatherQuery(crumb:Crumb,parcel?:{feature?:Feature|null;manual?:boolean}|null):WeatherQuery{
 const properties=parcel?.feature?.properties??{}
 const lat=Number(properties.label_lat),lon=Number(properties.label_lng)
 if(crumb.level==='village'&&Number.isFinite(lat)&&Number.isFinite(lon))return{contextLevel:crumb.level,contextCode:crumb.code,contextName:crumb.name,target:'parcel',lat,lon}
 return{contextLevel:crumb.level,contextCode:crumb.code,contextName:crumb.name,target:'admin'}
}
export function pickedWeatherQuery(crumb:Crumb,lat:number,lon:number):WeatherQuery{return{contextLevel:crumb.level,contextCode:crumb.code,contextName:crumb.name,target:'picked',lat,lon}}
export function shouldInterceptWeatherClick(input:{mode:DisasterViewMode;ctrlKey:boolean;button:number;parcelMode:string}){return input.mode==='weather'&&input.ctrlKey&&input.button===0&&input.parcelMode==='idle'}
