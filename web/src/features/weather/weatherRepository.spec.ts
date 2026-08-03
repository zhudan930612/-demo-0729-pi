import {describe,expect,it,vi} from 'vitest'
import {createWeatherRepository} from './weatherRepository'
import type {WeatherBundle,WeatherQuery} from './weatherTypes'
const q=(code:string):WeatherQuery=>({contextLevel:'city',contextCode:code,contextName:code,target:'admin'})
const bundle=(code:string)=>({contextLevel:'city',contextCode:code,target:'admin'}) as WeatherBundle
function sink(){let gen=0;return{begin:vi.fn(()=>++gen),receive:vi.fn(()=>true),fail:vi.fn(()=>true)}}
describe('weather repository',()=>{
 it('后发取消并覆盖先发',async()=>{const s=sink(),resolvers=new Map<string,(v:WeatherBundle)=>void>();const api={bundle:vi.fn((query:WeatherQuery,signal?:AbortSignal)=>new Promise<WeatherBundle>((resolve,reject)=>{resolvers.set(query.contextCode,resolve);signal?.addEventListener('abort',()=>reject(new DOMException('x','AbortError'))) }))};const r=createWeatherRepository(s,{api,document:undefined});const a=r.load(q('330100')),b=r.load(q('330200'));resolvers.get('330200')!(bundle('330200'));await b;await a;expect(s.receive).toHaveBeenCalledTimes(1);expect(s.receive.mock.calls.at(0)?.at(2)).toMatchObject({contextCode:'330200'})})
 it('定时、visibility 与退出停止',async()=>{vi.useFakeTimers();let visible:'visible'|'hidden'='visible';const listeners=new Set<()=>void>(),doc={get visibilityState(){return visible},addEventListener:(_:string,f:()=>void)=>listeners.add(f),removeEventListener:(_:string,f:()=>void)=>listeners.delete(f)};const s=sink(),api={bundle:vi.fn(async(query:WeatherQuery)=>bundle(query.contextCode))};const r=createWeatherRepository(s,{api,document:doc as any,intervalMs:600000,now:()=>Date.now()});await r.load(q('330100'));r.startAutoRefresh();await vi.advanceTimersByTimeAsync(600000);expect(api.bundle).toHaveBeenCalledTimes(2);visible='hidden';await vi.advanceTimersByTimeAsync(600000);expect(api.bundle).toHaveBeenCalledTimes(2);r.exit();visible='visible';listeners.forEach(f=>f());expect(api.bundle).toHaveBeenCalledTimes(2);vi.useRealTimers()})
})
