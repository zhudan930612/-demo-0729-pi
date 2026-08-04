import {beforeEach,describe,expect,it} from 'vitest'
import {createPinia,setActivePinia} from 'pinia'
import {useWeatherStore} from './weather'
import type {WeatherBundle,WeatherQuery} from '../features/weather/weatherTypes'
const query=(code='330100'):WeatherQuery=>({contextLevel:'city',contextCode:code,contextName:'杭州',target:'admin'})
const openWeather=(store:ReturnType<typeof useWeatherStore>)=>store.open('current')
const bundle=(code='330100')=>({contextLevel:'city',contextCode:code,target:'admin',address:{status:'error',error:{code:'x',message:'x'}},current:{status:'success',data:{}},alerts:{status:'empty',data:[]},minutely:{status:'empty',data:null,message:'none'},hourly:{status:'success',data:[]}}) as unknown as WeatherBundle
describe('weather store',()=>{beforeEach(()=>setActivePinia(createPinia()))
 it('地址降级不算部分失败，天气模块 stale refreshError 才算',()=>{const s=useWeatherStore();s.bundle=bundle();expect(s.hasPartialFailure).toBe(false);(s.bundle.current as any).stale=true;(s.bundle.current as any).refreshError={code:'x',message:'失败'};expect(s.hasPartialFailure).toBe(true)})
 it('上下文切换立即清除旧点，默认刷新保留浮窗和旧数据',()=>{const s=useWeatherStore();openWeather(s);const g=s.begin(query());s.receive(g,'city|330100|admin||',bundle());s.openLocation('default');s.begin(query(),true);expect(s.bundle).not.toBeNull();expect(s.locationPopup).toBe('default');s.begin(query('330200'));expect(s.bundle).toBeNull();expect(s.phase).toBe('loading')})
 it('临时点关闭恢复默认 bundle/query',()=>{const s=useWeatherStore();openWeather(s);const q=query(),g=s.begin(q);s.receive(g,'city|330100|admin||',bundle());const picked={...q,target:'picked' as const,lat:30,lon:120};const pg=s.begin(picked);s.receive(pg,'city|330100|picked|30|120',{...bundle(),target:'picked'});s.openLocation('picked');expect(s.closeLocation()).toBe(true);expect(s.query?.target).toBe('admin')})
})
