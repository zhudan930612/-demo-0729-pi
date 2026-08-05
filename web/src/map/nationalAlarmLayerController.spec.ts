import {describe,expect,it} from 'vitest'
import {groupMarkerOffset} from './nationalAlarmMarkerLayout'
import type {NationalWeatherAlarm} from '../features/national-alarms/nationalAlarmTypes'

const alarm:NationalWeatherAlarm={id:'330100000001',issuedAt:'2026-08-04T01:00:00Z',title:'杭州市发布暴雨黄色预警信号',iconUrl:'https://image.nmc.cn/assets/img/alarm/p0012003.png',adminCode:'330100',adminLevel:'city',provinceCode:'33',provinceName:'浙江省',eventType:'暴雨',severity:'yellow',mappableInZhejiang:true,mapLocation:{status:'mapped',point:[120,30]}}
describe('national alarm map icon contract',()=>{it('keeps the official list icon and a meaningful accessible title in marker data',()=>{expect(alarm.iconUrl).toMatch(/^https:\/\/image\.nmc\.cn\//);expect(alarm.title).toContain('暴雨');expect(alarm.mapLocation.point).toEqual([120,30])});it('centers same-admin icons at a 4px visual gap',()=>{expect(groupMarkerOffset(0,2)).toBe(-19);expect(groupMarkerOffset(1,2)).toBe(19);expect(groupMarkerOffset(0,3)).toBe(-38);expect(groupMarkerOffset(1,3)).toBe(0);expect(groupMarkerOffset(2,3)).toBe(38)});it('reserves an alert pane above map labels',()=>{expect(460).toBeGreaterThan(450)})})
