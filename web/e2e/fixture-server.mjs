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
function weatherBundle(target = 'admin') {
  const picked = target === 'picked'
  return {
    contextLevel: 'province', contextCode: '330000', target,
    location: { lat: picked ? 30.25 : 29.5, lon: picked ? 120.25 : 120.5 },
    originalLocation: { lat: picked ? 30.25 : 29.5, lon: picked ? 120.25 : 120.5 },
    fetchedAt: '2026-08-03T12:00:00+08:00',
    address: { status: 'success', data: { address: picked ? '杭州市西湖区测试点' : '浙江省行政中心', hctype: 1, jd: null }, fetchedAt: '2026-08-03T12:00:00+08:00' },
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
    const target = url.searchParams.get('target') === 'picked' ? 'picked' : 'admin'
    const fixture=url.searchParams.get('fixture')
    if(fixture==='request-error'){response.writeHead(503,{'content-type':'application/json'});return response.end(JSON.stringify({error:{code:'WEATHER_SERVICE_BUSY',message:'天气服务繁忙'}}))}
    return json(response, fixture === 'failed' ? failedBundle() : fixture==='stale' ? staleBundle() : weatherBundle(target))
  }
  response.writeHead(404, { 'content-type': 'application/json' })
  response.end('{"error":"fixture route not found"}')
})
function json(response, body) {
  response.writeHead(200, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' })
  response.end(JSON.stringify(body))
}
server.listen(8790, '127.0.0.1')
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => server.close(() => process.exit(0)))
