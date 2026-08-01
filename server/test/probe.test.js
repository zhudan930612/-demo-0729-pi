import assert from 'node:assert/strict'
import fs from 'node:fs'
import { spawnSync } from 'node:child_process'
import { test } from 'node:test'

const safeReportKeys = new Set([
  'reportVersion', 'probedAtUtc', 'beijingDate', 'year', 'outcome', 'businessCode',
  'listCount', 'startCount', 'stopCount', 'typeValues', 'listFields', 'samples',
  'noActiveTyphoonSampleCovered', 'historicalNoStartStructureSamples', 'limitations',
])

test('probe skips safely with exit code 2 when credentials are unavailable', () => {
  const result = spawnSync(process.execPath, ['scripts/probe-apihz.js'], {
    cwd: new URL('..', import.meta.url),
    env: {
      PATH: process.env.PATH,
      SystemRoot: process.env.SystemRoot,
      PROBE_SKIP_ENV_FILE: '1',
    },
    encoding: 'utf8',
  })
  assert.equal(result.status, 2)
  assert.equal(result.stdout, '')
  assert.equal(result.stderr.trim(), 'APIHz credentials not configured; live probe skipped')
})

test('committed probe report exposes only the approved aggregate schema', () => {
  const report = JSON.parse(fs.readFileSync(new URL('../reports/apihz-probe-summary.json', import.meta.url), 'utf8'))
  assert.deepEqual(Object.keys(report).filter((key) => !safeReportKeys.has(key)), [])
  assert.equal(report.noActiveTyphoonSampleCovered, false)
  assert.deepEqual(report.historicalNoStartStructureSamples.map(({ year, listCount, startCount, stopCount }) => ({ year, listCount, startCount, stopCount })), [
    { year: 2025, listCount: 32, startCount: 0, stopCount: 32 },
    { year: 2024, listCount: 28, startCount: 0, stopCount: 28 },
    { year: 2023, listCount: 20, startCount: 0, stopCount: 20 },
  ])
  const collectKeys = (value, keys = []) => {
    if (Array.isArray(value)) value.forEach((item) => collectKeys(item, keys))
    else if (value && typeof value === 'object') {
      for (const [key, child] of Object.entries(value)) { keys.push(key); collectKeys(child, keys) }
    }
    return keys
  }
  const keys = collectKeys(report)
  for (const forbidden of ['no1', 'namecn', 'nameen', 'lat', 'lon', 'upstreamUrl', 'developerId', 'key', 'rawResponse']) {
    assert.equal(keys.includes(forbidden), false)
  }
  assert.equal(JSON.stringify(report).includes('://'), false)
})
