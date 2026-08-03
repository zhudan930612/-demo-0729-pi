import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { loadEnvFile, readServerConfig } from '../src/config.js'
import { createWeatherUpstream } from '../src/weather-upstream.js'

const serverDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
if (process.env.PROBE_SKIP_ENV_FILE !== '1') loadEnvFile(path.join(serverDir, '.env.local'))
const config = readServerConfig().weather
if (process.env.QWEATHER_KEY_ROTATED_CONFIRMED !== 'yes') {
  console.error('QWeather live probe skipped: set QWEATHER_KEY_ROTATED_CONFIRMED=yes only after rotating the exposed key')
  process.exitCode = 2
} else if (!config.apiOrigin || !config.apiKey || !config.projectId || !config.credentialId || !process.env.PROBE_WEATHER_LAT || !process.env.PROBE_WEATHER_LON) {
  console.error('QWeather live probe skipped: host, key and probe coordinates must be configured locally')
  process.exitCode = 2
} else {
  const lat = Number(process.env.PROBE_WEATHER_LAT), lon = Number(process.env.PROBE_WEATHER_LON)
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) throw new Error('probe coordinates must be finite')
  const client = createWeatherUpstream(config), started = Date.now(), modules = []
  for (const module of ['alert', 'current', 'hourly', 'minutely']) {
    const moduleStarted = Date.now()
    try {
      const result = await client.qweather(module, Math.round(lat * 100) / 100, Math.round(lon * 100) / 100)
      modules.push({ module, required: true, outcome: result.empty ? 'empty' : 'success', statusObserved: '2xx', durationMs: Date.now() - moduleStarted, networkBytes: result.metrics?.networkBytes ?? null, decodedBytes: result.metrics?.decodedBytes ?? null, contentEncoding: result.metrics?.contentEncoding ?? null, itemCount: Array.isArray(result.data) ? result.data.length : Array.isArray(result.data?.minutely) ? result.data.minutely.length : result.data ? 1 : 0, dataFields: result.data && !Array.isArray(result.data) ? Object.keys(result.data).sort() : [], unitFields: collectUnits(result.data), attributionCount: result.metadata?.attributions?.length ?? 0 })
    } catch (error) { modules.push({ module, required: true, outcome: 'error', statusObserved: error.status ?? null, durationMs: Date.now() - moduleStarted, errorKind: error.kind ?? 'unknown' }) }
  }
  const addressStarted = Date.now()
  if (!config.addressUrl) modules.push({ module: 'address', required: false, outcome: 'notConfigured', durationMs: 0 })
  else try { const result = await client.address(lon, lat); modules.push({ module: 'address', required: false, outcome: 'success', statusObserved: '2xx', durationMs: Date.now() - addressStarted, networkBytes: result.metrics?.networkBytes ?? null, decodedBytes: result.metrics?.decodedBytes ?? null, contentEncoding: result.metrics?.contentEncoding ?? null, dataFields: Object.keys(result.data).sort() }) } catch (error) { modules.push({ module: 'address', required: false, outcome: 'error', statusObserved: error.status ?? null, durationMs: Date.now() - addressStarted, errorKind: error.kind ?? 'unknown' }) }
  const requiredFailed = modules.some((item) => item.required && item.outcome === 'error')
  const report = {
    reportVersion: 2, probedAtUtc: new Date().toISOString(), outcome: requiredFailed ? 'error' : 'completed', durationMs: Date.now() - started, modules,
    layerPlan: { province: 'directCityRepresentatives', city: 'directCountyRepresentatives', county: 'currentCountyRepresentative', township: 'noAlerts', village: 'noAlerts', parcel: 'noAlerts' },
    cacheTtlConclusionsMs: { alert: 300000, current: 600000, minutely: 300000, hourly: 1800000, address: 2592000000 },
    errorObservations: [{ case: '400/403 authentication', outcome: 'notObserved', coverage: 'fixture' }, { case: '429 retry-after', outcome: 'notObserved', coverage: 'fixture' }],
    limitations: ['报告不保存凭据、URL、坐标、完整天气正文或认证请求头。', '不安全制造真实 400/403/429；未观察分支明确标为 notObserved，并由固定 fixture 覆盖。', '层级计划由自动测试验证；单点真实探针不批量抓取行政区域。'],
  }
  const output = path.join(serverDir, 'reports', 'weather-probe-summary.local.json')
  fs.mkdirSync(path.dirname(output), { recursive: true }); fs.writeFileSync(output, `${JSON.stringify(report, null, 2)}\n`, { mode: 0o600 })
  console.log(JSON.stringify({ report: 'server/reports/weather-probe-summary.local.json', outcome: report.outcome, modules: modules.map(({ module, outcome, durationMs, itemCount }) => ({ module, outcome, durationMs, itemCount })) }, null, 2))
  if (requiredFailed) process.exitCode = 1
}

function collectUnits(value, prefix = '', result = []) {
  if (Array.isArray(value)) value.forEach((item, index) => collectUnits(item, `${prefix}[${index}]`, result))
  else if (value && typeof value === 'object') for (const [key, child] of Object.entries(value)) { const next = prefix ? `${prefix}.${key}` : key; if (key === 'unit' && typeof child === 'string') result.push({ field: prefix, unit: child }); else collectUnits(child, next, result) }
  return result
}
