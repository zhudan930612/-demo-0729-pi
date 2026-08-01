import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { createApiHzClient } from '../src/apihz-client.js'
import { loadEnvFile, readServerConfig } from '../src/config.js'

const serverDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const repoDir = path.resolve(serverDir, '..')
if (process.env.PROBE_SKIP_ENV_FILE !== '1') {
  loadEnvFile(path.join(serverDir, '.env.local'))
  loadEnvFile(path.join(repoDir, '.env.local'))
}
const config = readServerConfig()

if (!config.developerId || !config.key) {
  console.error('APIHz credentials not configured; live probe skipped')
  process.exitCode = 2
} else {
  await runProbe()
}

function beijingYear(now = Date.now()) {
  return new Date(now + 8 * 60 * 60 * 1000).getUTCFullYear()
}

function fieldNames(items) {
  return [...new Set(items.flatMap((item) => item && typeof item === 'object' && !Array.isArray(item) ? Object.keys(item) : []))].sort()
}

function numericRange(values) {
  const valid = values.map(Number).filter(Number.isFinite)
  return valid.length ? [Math.min(...valid), Math.max(...valid)] : null
}

function hasDuplicates(values) {
  return new Set(values).size !== values.length
}

async function runProbe() {
  const client = createApiHzClient(config)
  const probedAtUtc = new Date().toISOString()
  const year = beijingYear()
  const listPayload = await client.list(year)
  const list = listPayload.list
  const startItems = list.filter((item) => item.type === 'start')
  const stopItems = list.filter((item) => item.type === 'stop')
  const samples = []

  for (const [type, item] of [['start', startItems[0]], ['stop', stopItems[0]]]) {
    if (!item) continue
    const detail = await client.detail(String(item.no1))
    const observations = detail.datas
    const radii = observations.flatMap((node) => Array.isArray(node.wind_radius) ? node.wind_radius : [])
    const forecastParents = observations.filter((node) => Array.isArray(node.forecast_babj) && node.forecast_babj.length)
    const forecasts = forecastParents.flatMap((node) => node.forecast_babj)
    const hours = forecasts.map((node) => node.forecast_hour)
    const targetTimes = forecasts.map((node) => node.target_time_ymdh).filter((value) => value !== undefined && value !== null)
    samples.push({
      type,
      observationCount: observations.length,
      observationFields: fieldNames(observations),
      nodesWithWindRadius: observations.filter((node) => Array.isArray(node.wind_radius) && node.wind_radius.length).length,
      windRadiusEntryCount: radii.length,
      windRadiusFields: fieldNames(radii),
      windGradesSeen: [...new Set(radii.map((radius) => radius.grade_text ?? radius.grade).filter(Boolean))].sort(),
      forecastParentCount: forecastParents.length,
      forecastCount: forecasts.length,
      forecastFields: fieldNames(forecasts),
      forecastHourRange: numericRange(hours),
      duplicateForecastHourSeen: hasDuplicates(hours),
      duplicateTargetTimeSeen: hasDuplicates(targetTimes),
    })
  }

  const report = {
    reportVersion: 1,
    probedAtUtc,
    beijingDate: new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(probedAtUtc)),
    year,
    outcome: 'success',
    businessCode: listPayload.code,
    listCount: list.length,
    startCount: startItems.length,
    stopCount: stopItems.length,
    typeValues: [...new Set(list.map((item) => item.type))].sort(),
    listFields: fieldNames(list),
    samples,
    noActiveTyphoonSampleCovered: startItems.length === 0,
    limitations: [
      '单次探针只证明该抓取时刻和所选样本，不保证年度列表长期完整或字段长期稳定。',
      startItems.length === 0 ? '本次当前年度快照覆盖无活动台风状态。' : '本次存在活动台风，未覆盖真实无活动台风样例。',
    ],
  }
  const reportPath = path.join(serverDir, 'reports', 'apihz-probe-summary.json')
  fs.mkdirSync(path.dirname(reportPath), { recursive: true })
  fs.writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`, { mode: 0o600 })
  console.log(JSON.stringify({
    reportPath: path.relative(repoDir, reportPath).replaceAll('\\', '/'),
    probedAtUtc: report.probedAtUtc,
    year: report.year,
    listCount: report.listCount,
    startCount: report.startCount,
    stopCount: report.stopCount,
    sampleSummaries: report.samples.map((sample) => ({
      type: sample.type,
      observationCount: sample.observationCount,
      nodesWithWindRadius: sample.nodesWithWindRadius,
      forecastCount: sample.forecastCount,
    })),
    noActiveTyphoonSampleCovered: report.noActiveTyphoonSampleCovered,
  }, null, 2))
}
