import {describe,expect,it} from 'vitest'
import {createNationalAlarmApi} from './nationalAlarms'
const snapshot={items:[],summary:{total:0,snapshotTotal:0},fetchedAt:'2026-08-04T00:00:00Z',expiresAt:'2026-08-04T00:05:00Z',source:'中央气象台（NMC），仅展示浙江省预警'}
describe('national alarm api',()=>it('uses only same-origin fixed endpoints',async()=>{const calls:string[]=[];const api=createNationalAlarmApi((async(input:RequestInfo|URL)=>{calls.push(String(input));return Response.json(String(input).includes('/330100')?{id:'330100',issuedAt:null,body:'正文'}:snapshot)}) as typeof fetch);await api.list();await api.refresh();await api.detail('330100');expect(calls).toEqual(['/api/national-weather-alarms','/api/national-weather-alarms/refresh','/api/national-weather-alarms/330100'])}))
