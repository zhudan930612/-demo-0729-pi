import {describe,expect,it} from 'vitest'
import {createDisasterViewModeCoordinator,defaultWeatherQuery,shouldInterceptWeatherClick,weatherEntryState} from './weatherLifecycle'
const crumb={level:'village' as const,code:'3301',name:'村'}
describe('weather lifecycle',()=>{
 it('none/weather/typhoon 严格互斥',()=>{const c=createDisasterViewModeCoordinator();expect(c.enter('weather')).toBe(true);expect(c.enter('typhoon')).toBe(false);expect(c.exit('typhoon')).toBe(false);expect(c.exit('weather')).toBe(true);expect(c.enter('typhoon')).toBe(true)})
 it('入口校验浙江上下文与未保存状态',()=>{expect(weatherEntryState({mode:'none',crumb,hasUnsavedWork:false}).enabled).toBe(true);expect(weatherEntryState({mode:'none',crumb,hasUnsavedWork:true}).reason).toContain('保存');expect(weatherEntryState({mode:'none',crumb:{...crumb,code:'3201'},hasUnsavedWork:false}).reason).toContain('浙江省')})
 it('地块 label point 优先且缺失时不伪造',()=>{expect(defaultWeatherQuery(crumb,{feature:{type:'Feature',geometry:{type:'Point',coordinates:[120,30]},properties:{label_lat:30,label_lng:120}}}).target).toBe('parcel');expect(defaultWeatherQuery(crumb,{feature:{type:'Feature',geometry:{type:'Point',coordinates:[120,30]},properties:{}}}).target).toBe('admin')})
 it('仅 Ctrl 左键天气态抢占',()=>{expect(shouldInterceptWeatherClick({mode:'weather',ctrlKey:true,button:0,parcelMode:'idle'})).toBe(true);expect(shouldInterceptWeatherClick({mode:'weather',ctrlKey:false,button:0,parcelMode:'idle'})).toBe(false)})
})
