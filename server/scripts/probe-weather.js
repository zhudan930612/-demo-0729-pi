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
  const client = createWeatherUpstream(config)
  const started = Date.now(), modules = []
  for (const module of ['alert', 'current', 'hourly', 'minutely']) {
    const moduleStarted = Date.now()
    try {
      const result = await client.qweather(module, Math.round(lat * 100) / 100, Math.round(lon * 100) / 100)
      modules.push({ module, outcome: result.empty ? 'empty' : 'success', durationMs: Date.now() - moduleStarted, itemCount: Array.isArray(result.data) ? result.data.length : Array.isArray(result.data?.minutely) ? result.data.minutely.length : result.data ? 1 : 0, dataFields: result.data && !Array.isArray(result.data) ? Object.keys(result.data).sort() : [], attributionCount: result.metadata?.attributions?.length ?? 0 })
    } catch (error) { modules.push({ module, outcome: 'error', durationMs: Date.now() - moduleStarted, errorKind: error.kind ?? 'unknown' }) }
  }
  const report = { reportVersion: 1, probedAtUtc: new Date().toISOString(), outcome: modules.every((m) => m.outcome === 'error') ? 'error' : 'completed', durationMs: Date.now() - started, modules, limitations: ['报告不保存凭据、URL、坐标、完整天气正文或认证请求头。', '单次探针仅证明该时间点与本机账户响应，未遇到的分支由固定 fixture 覆盖。'] }
  const output = path.join(serverDir, 'reports', 'weather-probe-summary.local.json')
  fs.mkdirSync(path.dirname(output), { recursive: true }); fs.writeFileSync(output, `${JSON.stringify(report, null, 2)}\n`, { mode: 0o600 })
  console.log(JSON.stringify({ report: 'server/reports/weather-probe-summary.local.json', outcome: report.outcome, modules: modules.map(({ module, outcome, durationMs, itemCount }) => ({ module, outcome, durationMs, itemCount })) }, null, 2))
}
