import { weatherApi, weatherRequestKey, type WeatherApiClient } from '../../api/weather'
import type { WeatherBundle, WeatherQuery } from './weatherTypes'

export interface WeatherSink {
 begin(query:WeatherQuery,refresh?:boolean):number
 receive(generation:number,key:string,bundle:WeatherBundle):boolean
 fail(generation:number,message:string):boolean
}
export interface WeatherRepository { load(query:WeatherQuery,options?:{refresh?:boolean;openPicked?:boolean}):Promise<void>; retry():Promise<void>; startAutoRefresh():void; stopAutoRefresh():void; exit():void }
function aborted(error:unknown,signal:AbortSignal){return signal.aborted||(error instanceof Error&&error.name==='AbortError')}
export function createWeatherRepository(sink:WeatherSink,options:{api?:WeatherApiClient;intervalMs?:number;now?:()=>number;document?:Pick<Document,'visibilityState'|'addEventListener'|'removeEventListener'>;setInterval?:typeof setInterval;clearInterval?:typeof clearInterval}={}):WeatherRepository{
 const api=options.api??weatherApi, intervalMs=options.intervalMs??600000, now=options.now??Date.now, doc=options.document??globalThis.document
 const setI=options.setInterval??globalThis.setInterval,clearI=options.clearInterval??globalThis.clearInterval
 let active:{controller:AbortController;query:WeatherQuery}|null=null,timer:ReturnType<typeof setInterval>|null=null,lastSuccess=0
 async function load(query:WeatherQuery,{refresh=false}: {refresh?:boolean}={}){
  active?.controller.abort();const controller=new AbortController();active={controller,query};const generation=sink.begin(query,refresh),key=`${query.contextLevel}|${query.contextCode}|${query.target}|${query.lat??''}|${query.lon??''}`
  try{const bundle=await api.bundle(query,controller.signal);if(active?.controller!==controller)return;if(sink.receive(generation,key,bundle))lastSuccess=now()}catch(error){if(!aborted(error,controller.signal)&&active?.controller===controller)sink.fail(generation,error instanceof Error?error.message:'天气数据加载失败')}
 }
 async function retry(){if(active)await load(active.query,{refresh:true})}
 const onVisibility=()=>{if(doc?.visibilityState==='visible'&&active&&now()-lastSuccess>=intervalMs)void retry()}
 function startAutoRefresh(){if(timer)return;timer=setI(()=>{if((!doc||doc.visibilityState==='visible')&&active)void retry()},intervalMs);doc?.addEventListener('visibilitychange',onVisibility)}
 function stopAutoRefresh(){if(timer){clearI(timer);timer=null}doc?.removeEventListener('visibilitychange',onVisibility)}
 function exit(){stopAutoRefresh();active?.controller.abort();active=null}
 return{load,retry,startAutoRefresh,stopAutoRefresh,exit}
}
export function queryKey(query:WeatherQuery){return weatherRequestKey(query)}
