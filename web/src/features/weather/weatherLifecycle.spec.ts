import {describe,expect,it} from 'vitest'
import {createDisasterViewModeCoordinator,defaultWeatherQuery,isZhejiangCrumb,shouldInterceptWeatherClick,weatherEntryState} from './weatherLifecycle'
const crumb={level:'village' as const,code:'330101001001',name:'村'}
describe('weather lifecycle',()=>{
 it('none/weather/typhoon 严格互斥',()=>{const c=createDisasterViewModeCoordinator();expect(c.enter('weather')).toBe(true);expect(c.enter('typhoon')).toBe(false);expect(c.exit('typhoon')).toBe(false);expect(c.exit('weather')).toBe(true);expect(c.enter('typhoon')).toBe(true)})
 it('入口校验浙江上下文、完整合法 code 与未保存状态',()=>{expect(weatherEntryState({mode:'none',crumb,hasUnsavedWork:false}).enabled).toBe(true);expect(weatherEntryState({mode:'weather',crumb,hasUnsavedWork:false}).enabled).toBe(true);expect(weatherEntryState({mode:'typhoon',crumb,hasUnsavedWork:false}).enabled).toBe(false);expect(weatherEntryState({mode:'weather',crumb,hasUnsavedWork:true}).reason).toContain('保存');for(const code of ['33','3301','330000000000','320101001001'])expect(isZhejiangCrumb({...crumb,code})).toBe(false);expect(isZhejiangCrumb({level:'province',code:'330000',name:'浙江省'})).toBe(true)})
 it('地块 label point 优先且缺失时不伪造',()=>{expect(defaultWeatherQuery(crumb,{feature:{type:'Feature',geometry:{type:'Point',coordinates:[120,30]},properties:{label_lat:30,label_lng:120}}}).target).toBe('parcel');expect(defaultWeatherQuery(crumb,{feature:{type:'Feature',geometry:{type:'Point',coordinates:[120,30]},properties:{}}}).target).toBe('admin')})
 it('仅 Ctrl 左键天气态抢占',()=>{expect(shouldInterceptWeatherClick({mode:'weather',ctrlKey:true,button:0,parcelMode:'idle'})).toBe(true);expect(shouldInterceptWeatherClick({mode:'weather',ctrlKey:false,button:0,parcelMode:'idle'})).toBe(false)})
})
