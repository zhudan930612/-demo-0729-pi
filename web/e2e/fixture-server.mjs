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
const nationalAlarmSecond = {
  id: '330200000001', issuedAt: '2026-08-03T05:10:00Z', title: '宁波市发布台风橙色预警信号',
  iconUrl: 'https://image.nmc.cn/assets/img/alarm/p0012002.png', adminCode: '330200', adminLevel: 'city', provinceCode: '33', provinceName: '浙江省', eventType: '台风', severity: 'orange', mappableInZhejiang: true,
  mapLocation: { status: 'mapped', point: [121.55, 29.87], groupCount: 1 },
}
const nationalSnapshot = {
  items: [nationalAlarm], summary: { total: 1, snapshotTotal: 1 }, fetchedAt: '2026-08-03T04:00:00Z', expiresAt: '2026-08-03T04:05:00Z', source: '中央气象台（NMC），仅展示浙江省预警',
}
const nationalDetail = { id: nationalAlarm.id, issuedAt: nationalAlarm.issuedAt, body: '预计未来三小时部分地区有强降雨，请注意防范。' }
const nationalDetailSecond = { id: nationalAlarmSecond.id, issuedAt: nationalAlarmSecond.issuedAt, body: '请远离海岸线，做好防风加固。' }
// 台风（APIHz 原始字段，前端 typhoonAdapter 解析）：实时 1 条 + 历史 1 条
const typhoonList = {
  code: 200,
  list: [
    { no1: '2608', no2: '2608', no3: '2608', no4: '2608', namecn: '格美', nameen: 'GAEMI', type: 'start' },
    { no1: '2602', no2: '2602', no3: '2602', no4: '2602', namecn: '艾云尼', nameen: 'EWINIAR', type: 'stop' },
  ],
}
function typhoonNode(timeYmdh, lat, lon, windSpeedMs, pressureHpa, intensityText, moveSpeedKmh, moveDirText, extra = {}) {
  return { time_ymdh: timeYmdh, lat, lon, wind_speed_ms: windSpeedMs, pressure_hpa: pressureHpa, intensity_text: intensityText, move_speed_kmh: moveSpeedKmh, move_dir_text: moveDirText, position_text: '西北太平洋洋面', wind_radius: [], ...extra }
}
const windRadius7 = [
  { grade: '7', grade_text: '七级风圈', ne_radius_km: 300, se_radius_km: 300, sw_radius_km: 240, nw_radius_km: 240 },
  { grade: '10', grade_text: '十级风圈', ne_radius_km: 120, se_radius_km: 120, sw_radius_km: 90, nw_radius_km: 90 },
]
const liveTyphoonDetail = {
  code: 200, no1: '2608', no2: '2608', no3: '2608', no4: '2608', namecn: '格美', nameen: 'GAEMI', type: 'start',
  datas: [
    typhoonNode('2026-08-03 08:00:00', 24.5, 128.0, 42, 950, '强台风', 20, '西北'),
    typhoonNode('2026-08-03 14:00:00', 25.8, 126.2, 42, 950, '强台风', 22, '西北'),
    typhoonNode('2026-08-03 20:00:00', 27.2, 124.3, 38, 960, '台风', 24, '西北'),
    typhoonNode('2026-08-04 02:00:00', 28.5, 122.5, 33, 970, '台风', 26, '西北偏北', { wind_radius: windRadius7 }),
    typhoonNode('2026-08-04 08:00:00', 29.6, 121.0, 28, 978, '强热带风暴', 22, '西北', {
      wind_radius: windRadius7,
      forecast_babj: [
        { forecast_hour: 24, lat: 30.8, lon: 119.5, wind_speed_ms: 24, pressure_hpa: 980, intensity_text: '热带风暴', target_time_ymdh: '2026-08-05 08:00:00' },
        { forecast_hour: 48, lat: 31.9, lon: 118.2, wind_speed_ms: 20, pressure_hpa: 988, intensity_text: '热带低压', target_time_ymdh: '2026-08-06 08:00:00' },
      ],
    }),
  ],
}
const historyTyphoonDetail = {
  code: 200, no1: '2602', no2: '2602', no3: '2602', no4: '2602', namecn: '艾云尼', nameen: 'EWINIAR', type: 'stop',
  datas: [
    typhoonNode('2026-06-20 08:00:00', 16.5, 132.0, 30, 980, '强热带风暴', 15, '西北'),
    typhoonNode('2026-06-21 02:00:00', 18.4, 130.1, 35, 965, '台风', 16, '西北'),
    typhoonNode('2026-06-22 08:00:00', 21.0, 127.2, 40, 955, '台风', 18, '西北'),
    typhoonNode('2026-06-23 08:00:00', 23.6, 124.0, 45, 945, '强台风', 20, '西北'),
  ],
}
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

function readJson(request) {
  return new Promise((resolve) => {
    const chunks = []
    request.on('data', (chunk) => chunks.push(chunk))
    request.on('end', () => {
      try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8'))) } catch { resolve(null) }
    })
  })
}

const server = http.createServer((request, response) => {
  const url = new URL(request.url ?? '/', 'http://127.0.0.1:8790')
  if (url.pathname === '/healthz') return json(response, { ok: true })
  // 登录门禁：e2e 通过 storageState 预置令牌，restore 校验 /api/auth/session；登录页交互走 login/logout。
  if (url.pathname === '/api/auth/session') return json(response, { username: 'admin', expiresAt: Date.now() + 60_000 })
  if (url.pathname === '/api/auth/logout' && request.method === 'POST') { response.writeHead(204, { 'cache-control': 'no-store' }); return response.end() }
  if (url.pathname === '/api/auth/login' && request.method === 'POST') {
    return readJson(request).then((body) => {
      if (!body || body.username !== 'admin' || body.password !== 'admin123') {
        response.writeHead(401, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' })
        return response.end(JSON.stringify({ error: { code: 'INVALID_CREDENTIALS', message: '用户名或密码不正确' } }))
      }
      return json(response, { token: 'e2e-token', username: 'admin', expiresAt: Date.now() + 60_000 })
    })
  }
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
  if (url.pathname === '/api/typhoons') {
    const fixture = url.searchParams.get('fixture')
    if (fixture === 'request-error') { response.writeHead(503, { 'content-type': 'application/json' }); return response.end(JSON.stringify({ error: { code: 'TYPHOON_SERVICE_BUSY', message: '台风服务繁忙' } })) }
    if (fixture === 'empty') return json(response, { code: 200, list: [] })
    return json(response, typhoonList)
  }
  if (url.pathname === '/api/typhoons/2608') return json(response, liveTyphoonDetail)
  if (url.pathname === '/api/typhoons/2602') return json(response, historyTyphoonDetail)
  if (url.pathname === '/api/national-weather-alarms') {
    const fixture = url.searchParams.get('fixture')
    if (fixture === 'request-error') { response.writeHead(503, { 'content-type': 'application/json' }); return response.end(JSON.stringify({ error: { code: 'NATIONAL_ALARM_SERVICE_BUSY', message: '预警服务繁忙' } })) }
    if (fixture === 'empty') return json(response, { ...nationalSnapshot, items: [], summary: { total: 0, snapshotTotal: 0 } })
    if (fixture === 'many') return json(response, { ...nationalSnapshot, items: [nationalAlarm, nationalAlarmSecond], summary: { total: 2, snapshotTotal: 2 } })
    if (fixture === 'not-mappable') return json(response, { ...nationalSnapshot, items: [{ ...nationalAlarm, mappableInZhejiang: false, mapLocation: { status: 'unmapped', point: null, groupCount: 0 } }], summary: { total: 1, snapshotTotal: 1 } })
    return json(response, nationalSnapshot)
  }
  if (url.pathname === `/api/national-weather-alarms/${nationalAlarm.id}`) return json(response, nationalDetail)
  if (url.pathname === `/api/national-weather-alarms/${nationalAlarmSecond.id}`) return json(response, nationalDetailSecond)
  // 刷新返回更新的 fetchedAt（面板数据时间应从 12:00 变为 13:00）
  if (url.pathname === '/api/national-weather-alarms/refresh' && request.method === 'POST') return json(response, { ...nationalSnapshot, fetchedAt: '2026-08-03T05:00:00Z', expiresAt: '2026-08-03T05:05:00Z' })
  response.writeHead(404, { 'content-type': 'application/json' })
  response.end('{"error":"fixture route not found"}')
})
function json(response, body) {
  response.writeHead(200, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' })
  response.end(JSON.stringify(body))
}
server.listen(8790, '127.0.0.1')
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => server.close(() => process.exit(0)))
// 客户端（vite 代理/浏览器）中途中止请求会触发 ECONNRESET；不吞掉会以未处理 error 事件杀死
// fixture server，导致后续测试全部代理失败。每个 socket 的错误单独吞掉即可。
server.on('error', () => {})
server.on('clientError', (error, socket) => socket.destroy())
server.on('connection', (socket) => socket.on('error', () => {}))
