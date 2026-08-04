import assert from 'node:assert/strict'
import { test } from 'node:test'
import { createNationalAlarmUpstream, extractAlarmBody, NMC_LIST_PATH } from '../src/national-alarm-upstream.js'
import { createNationalAlarmService, normalizeNationalAlarms } from '../src/national-alarm-service.js'
import { loadNationalAlarmSpatialIndex } from '../src/national-alarm-spatial-index.js'
import { readServerConfig } from '../src/config.js'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
const serverDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

const spatial = { findAlarmNode(code) { return code === '330100' ? { level: 'city', representativePoint: [120, 30], governmentSeatPoint: [120.1, 30.1] } : code === '330000' ? { level: 'province', representativePoint: [120, 29], governmentSeatPoint: [120.1, 29.1] } : null } }
const rows = [{ alertid: '330100000001', issuetime: '2026-08-04 10:00:00', title: '杭州市发布暴雨黄色预警信号', url: '/publish/alarm/a.html', pic: 'https://image.nmc.cn/a.png' }, { alertid: '310000000001', issuetime: '2026-08-04 11:00:00', title: '上海市发布预警', url: '/publish/alarm/b.html' }]
test('national alarm spatial index loads only map-relevant Zhejiang levels', () => {
  const index = loadNationalAlarmSpatialIndex(path.resolve('test/fixtures/weather-data'))
  assert.equal(index.findAlarmNode('330000').level, 'province'); assert.equal(index.findAlarmNode('330100').level, 'city'); assert.equal(index.findAlarmNode('330101').level, 'county'); assert.deepEqual(index.findAlarmNode('330101').governmentSeatPoint, [120.1, 30.1]); assert.equal(index.findAlarmNode('330101001000'), null)
})
test('server data directory is resolved from server source, not the launch directory', () => {
  const config = readServerConfig({ WEATHER_DATA_DIR: '../.dev-runtime/weather-data' })
  assert.equal(config.nationalAlarms.dataDir, path.resolve(serverDir, '../.dev-runtime/weather-data'))
  assert.equal(config.weather.dataDir, config.nationalAlarms.dataDir)
})
test('normalization emits Zhejiang whitelist only and government-seat map points', () => { const result = normalizeNationalAlarms(rows, spatial); assert.equal(result.items.length, 1); assert.equal(result.items[0].provinceCode, '33'); assert.equal(result.items[0].mappableInZhejiang, true); assert.equal('sourcePath' in result.items[0], false); assert.deepEqual(result.items[0].mapLocation.point, [120.1, 30.1]) })
test('upstream fixes NMC list endpoint and validates complete snapshots', async () => { let seen; const upstream = createNationalAlarmUpstream({}, { fetchImpl: async (url) => { seen = url; return Response.json({ code: 0, data: { page: { pageNo: 1, pageSize: 10000, totalPage: 1, count: 0, list: [] } } }) } }); await upstream.list(); assert.equal(seen.origin, 'https://www.nmc.cn'); assert.equal(seen.pathname, NMC_LIST_PATH); assert.equal(seen.search, '?pageNo=1&pageSize=10000'); const broken = createNationalAlarmUpstream({}, { fetchImpl: async () => Response.json({ code: 0, data: { page: { pageNo: 1, pageSize: 100, totalPage: 1, count: 0, list: [] } } }) }); await assert.rejects(broken.list()) })
test('duplicate IDs fail closed so an advertised complete snapshot is never published', () => { const later = { ...rows[0], issuetime: '2026-08-04 12:00:00', title: '杭州市发布大风蓝色预警信号' }; assert.throws(() => normalizeNationalAlarms([rows[0], later], spatial)); assert.throws(() => normalizeNationalAlarms([rows[0], { ...rows[0] }], spatial)) })
test('body parser uses only the verified NMC alarmtext id and strips markup', () => { assert.equal(extractAlarmBody('<div id=alarmtext><p>第一段</p><p>第二段<script>bad()</script></p></div><div id="alarmtext">第三段<br>第四段</div>'), '第一段\n第二段'); assert.throws(() => extractAlarmBody('<div class="alarmtext">猜测内容</div>')) })
test('service caches full Zhejiang snapshot, refresh cooldown and on-demand detail', async () => { let now = 0, lists = 0, details = 0; const upstream = { async list() { lists++; return rows }, async detail() { details++; return '官方正文' } }; const service = createNationalAlarmService({}, { upstream, loadSpatial: () => spatial, now: () => now }); const initial = await service.list(); assert.equal(initial.items.length, 1); await service.list(); assert.equal(lists, 1); const detail = await service.detail('330100000001'); assert.equal(detail.body, '官方正文'); assert.equal(details, 1); await service.forceRefresh(); await service.forceRefresh(); assert.equal(lists, 2); await assert.rejects(service.detail('310000000001')) })
