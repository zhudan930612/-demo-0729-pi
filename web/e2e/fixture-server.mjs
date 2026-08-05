import http from 'node:http'

const hours = Array.from({ length: 24 }, (_, index) => ({
  forecastTime: new Date(Date.parse('2026-08-03T03:00:00Z') + index * 3_600_000).toISOString(),
  condition: { code: index % 3 === 0 ? '305' : '100', text: index % 3 === 0 ? '小雨' : '晴' },
  temperature: { value: 26 + (index % 4), unit: '°C' },
  precipitation: { probability: index % 3 === 0 ? 0.65 : 0.1, amount: { value: index % 3 === 0 ? 0.7 : 0, unit: 'mm' } },
}))
const minutely = Array.from({ length: 24 }, (_, index) => ({
  fxTime: new Date(Date.parse('2026-08-03T04:00:00Z') + index * 300_000).toISOString(),
  precip: index < 4 ? 0 : Number(((index % 6) * 0.12).toFixed(2)),
  type: index % 8 === 0 ? 'snow' : 'rain',
}))
const nationalAlarm = {
  id: '330100000001', issuedAt: '2026-08-03T03:20:00Z', title: '杭州市发布暴雨红色预警信号',
  iconUrl: 'https://image.nmc.cn/assets/img/alarm/p0012001.png', adminCode: '330100', adminLevel: 'city', provinceCode: '33', provinceName: '浙江省', eventType: '暴雨', severity: 'red', mappableInZhejiang: true,
  mapLocation: { status: 'mapped', point: [120.15, 30.25], groupCount: 1 },
}
// 多级政府驻地标牌 fixture：省 -> 11 市，市 -> 1 县，县 -> 密集乡镇（重叠坐标验证避让）
const cityTargets = [
  { code: '330100', name: '杭州市', lat: 29.25, lon: 120.25 },
  { code: '330200', name: '宁波市', lat: 29.87, lon: 121.55 },
  { code: '330300', name: '温州市', lat: 28.0, lon: 120.7 },
  { code: '330400', name: '嘉兴市', lat: 30.75, lon: 120.75 },
  { code: '330500', name: '湖州市', lat: 30.87, lon: 120.1 },
  { code: '330600', name: '绍兴市', lat: 30.0, lon: 120.58 },
  { code: '330700', name: '金华市', lat: 29.08, lon: 119.65 },
  { code: '330800', name: '衢州市', lat: 28.94, lon: 118.87 },
  { code: '330900', name: '舟山市', lat: 29.98, lon: 122.2 },
  { code: '331000', name: '台州市', lat: 28.66, lon: 121.42 },
  { code: '331100', name: '丽水市', lat: 28.45, lon: 119.92 },
]
const markerTargets = {
  'province:330000': cityTargets.map((city) => ({ code: city.code, level: 'city', name: city.name, location: { lat: city.lat, lon: city.lon } })),
  'city:330100': [{ code: '330101', level: 'county', name: '示例县', location: { lat: 29.25, lon: 120.2 } }],
  'county:330101': Array.from({ length: 6 }, (_, index) => ({ code: `33010100${String(index + 1).padStart(4, '0')}000`, level: 'township', name: `示例乡${['甲', '乙', '丙', '丁', '戊', '己'][index]}`, location: { lat: 29.25, lon: 120.2 } })),
}
const markerSummaries = ['甲', '乙', '丙', '丁', '戊', '己']
function markerSummary(index) {
  const rain = index % 2 === 0
  return { condition: { code: rain ? '305' : '100', text: rain ? '小雨' : '晴' }, temperature: { value: 26, unit: '°C' }, high: { value: 29, unit: '°C' }, low: { value: 26, unit: '°C' }, fetchedAt: '2026-08-03T12:00:00+08:00' }
}
function markersNdjson(contextLevel, contextCode) {
  const targets = markerTargets[`${contextLevel}:${contextCode}`] ?? []
  const lines = [{ type: 'targets', contextLevel, contextCode, total: targets.length, targets }]
  targets.forEach((target, index) => lines.push({ type: 'ready', code: target.code, summary: markerSummary(index) }))
  return lines.map((line) => `${JSON.stringify(line)}\n`).join('')
}
const nationalSnapshot = {
  items: [nationalAlarm], summary: { total: 1, snapshotTotal: 1 }, fetchedAt: '2026-08-03T04:00:00Z', expiresAt: '2026-08-03T04:05:00Z', source: '中央气象台（NMC），仅展示浙江省预警',
}
const nationalDetail = { id: nationalAlarm.id, issuedAt: nationalAlarm.issuedAt, body: '预计未来三小时部分地区有强降雨，请注意防范。' }
function weatherBundle(target = 'admin') {
  const picked = target === 'picked'
  const seat = target === 'seat'
  return {
    contextLevel: seat ? 'county' : 'province', contextCode: seat ? '330101' : '330000', target,
    location: { lat: picked ? 30.25 : seat ? 30.1 : 29.5, lon: picked ? 120.25 : seat ? 120.2 : 120.5 },
    originalLocation: { lat: picked ? 30.25 : seat ? 30.1 : 29.5, lon: picked ? 120.25 : seat ? 120.2 : 120.5 },
    fetchedAt: '2026-08-03T12:00:00+08:00',
    address: { status: 'success', data: { address: picked ? '杭州市西湖区测试点' : seat ? '浙江省杭州市示例县' : '浙江省行政中心', hctype: 1, jd: null }, fetchedAt: '2026-08-03T12:00:00+08:00' },
    current: { status: 'success', data: { condition: { code: '305', text: '小雨' }, temperature: { value: 26, unit: '°C' }, feelsLike: { value: 28, unit: '°C' }, precipitation: { amount: { value: 1.2, unit: 'mm' }, intensity: { value: 0.8, unit: 'mm/h' }, type: 'rain' }, humidity: 0.86 }, fetchedAt: '2026-08-03T12:00:00+08:00' },
    alerts: { status: 'success', data: [{ code: '330100', name: '杭州市', point: [120.15, 30.25], status: 'success', alerts: [{ id: 'alert-1', headline: '杭州市发布暴雨红色预警', issuedTime: '2026-08-03T11:20:00+08:00', urgency: 'immediate', severity: 'extreme', certainty: 'observed', description: '预计未来三小时部分地区有强降雨，请注意防范。', criteria: '三小时累计降雨量达到暴雨红色预警标准。', instruction: '停止户外作业，远离低洼地带。', senderName: '测试机构', eventType: { name: '暴雨', code: '1010' }, icon: '1010', color: { code: 'red', red: 220, green: 38, blue: 38, alpha: 1 } }] }] },
    minutely: { status: 'success', data: { updateTime: '2026-08-03T12:00:00+08:00', summary: '20分钟后降雨逐渐增强', minutely, refer: { sources: ['QWeather fixture'], license: ['测试数据，不用于生产'] } }, fetchedAt: '2026-08-03T12:00:00+08:00' },
    hourly: { status: 'success', data: hours, fetchedAt: '2026-08-03T12:00:00+08:00' },
    attributions: [{ name: '和风天气测试归因', url: 'https://example.test/attribution' }],
  }
}
function staleBundle() {
  const bundle = weatherBundle('admin'), refreshError = { code: 'WEATHER_UPSTREAM_TIMEOUT', message: '刷新超时' }
  bundle.current = { ...bundle.current, stale: true, refreshError }
  bundle.minutely = { ...bundle.minutely, stale: true, refreshError }
  bundle.hourly = { ...bundle.hourly, stale: true, refreshError }
  bundle.alerts.data[0] = { ...bundle.alerts.data[0], stale: true, fetchedAt: '2026-08-03T12:00:00+08:00', refreshError }
  return bundle
}
function addressUnavailableBundle(target = 'admin') {
  return { ...weatherBundle(target), address: { status: 'error', error: { code: 'ADDRESS_UNAVAILABLE', message: '地址增强未配置' } } }
}
function failedBundle() {
  return {
    ...weatherBundle('admin'),
    current: { status: 'error', error: { code: 'WEATHER_UPSTREAM_TIMEOUT', message: '实时天气加载失败' } },
    minutely: { status: 'error', error: { code: 'WEATHER_UPSTREAM_TIMEOUT', message: '分钟降水加载失败' } },
    alerts: { status: 'partial', data: [{ code: '330100', name: '杭州市', point: [120.15, 30.25], status: 'error', error: { code: 'WEATHER_UPSTREAM_TIMEOUT', message: '预警加载失败' } }] },
  }
}

const server = http.createServer((request, response) => {
  const url = new URL(request.url ?? '/', 'http://127.0.0.1:8790')
  if (url.pathname === '/healthz') return json(response, { ok: true })
  if (url.pathname === '/api/weather') {
    const target = url.searchParams.get('target')
    const fixture = url.searchParams.get('fixture')
    if (target === 'seat') return json(response, fixture === 'address-unavailable' ? addressUnavailableBundle('seat') : { ...weatherBundle('seat'), address: { status: 'success', data: { address: '浙江省杭州市示例县', hctype: 1, jd: null }, fetchedAt: '2026-08-03T12:00:00+08:00' } })
    const isPicked = target === 'picked'
    if (fixture === 'request-error') { response.writeHead(503, { 'content-type': 'application/json' }); return response.end(JSON.stringify({ error: { code: 'WEATHER_SERVICE_BUSY', message: '天气服务繁忙' } })) }
    return json(response, fixture === 'failed' ? failedBundle() : fixture === 'stale' ? staleBundle() : fixture === 'address-unavailable' ? addressUnavailableBundle(isPicked ? 'picked' : 'admin') : weatherBundle(isPicked ? 'picked' : 'admin'))
  }
  if (url.pathname === '/api/weather/markers') {
    response.writeHead(200, { 'content-type': 'application/x-ndjson; charset=utf-8', 'cache-control': 'no-store' })
    return response.end(markersNdjson(url.searchParams.get('contextLevel') ?? 'province', url.searchParams.get('contextCode') ?? '330000'))
  }
  if (url.pathname === '/api/national-weather-alarms') return json(response, nationalSnapshot)
  if (url.pathname === `/api/national-weather-alarms/${nationalAlarm.id}`) return json(response, nationalDetail)
  if (url.pathname === '/api/national-weather-alarms/refresh' && request.method === 'POST') return json(response, nationalSnapshot)
  response.writeHead(404, { 'content-type': 'application/json' })
  response.end('{"error":"fixture route not found"}')
})
function json(response, body) {
  response.writeHead(200, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' })
  response.end(JSON.stringify(body))
}
server.listen(8790, '127.0.0.1')
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => server.close(() => process.exit(0)))
