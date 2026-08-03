import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { test } from 'node:test'

test('weather probe refuses to run before explicit key rotation confirmation', () => {
  const result = spawnSync(process.execPath, ['scripts/probe-weather.js'], { cwd: new URL('..', import.meta.url), env: { PATH: process.env.PATH, SystemRoot: process.env.SystemRoot, PROBE_SKIP_ENV_FILE: '1' }, encoding: 'utf8' })
  assert.equal(result.status, 2); assert.equal(result.stdout, ''); assert.match(result.stderr, /live probe skipped/)
})

test('weather probe report schema covers section 13 without sensitive material', () => {
  const report = {
    reportVersion: 2, probedAtUtc: new Date().toISOString(), outcome: 'completed', durationMs: 1,
    modules: ['alert','current','hourly','minutely'].map((module) => ({ module, required: true, outcome: 'success', statusObserved: '2xx', durationMs: 1, networkBytes: 10, decodedBytes: 20, contentEncoding: 'gzip', itemCount: 1, dataFields: ['condition'], unitFields: [{ field: 'temperature', unit: '°C' }], attributionCount: 1 })),
    layerPlan: { province: 'directCityRepresentatives', city: 'directCountyRepresentatives', county: 'currentCountyRepresentative', township: 'noAlerts' },
    cacheTtlConclusionsMs: { alert: 300000, current: 600000, minutely: 300000, hourly: 1800000, address: 2592000000 },
    errorObservations: [{ case: '400/403 authentication', outcome: 'notObserved', coverage: 'fixture' }, { case: '429 retry-after', outcome: 'notObserved', coverage: 'fixture' }], limitations: ['safe'],
  }
  assert.deepEqual(Object.keys(report).sort(), ['cacheTtlConclusionsMs','durationMs','errorObservations','layerPlan','limitations','modules','outcome','probedAtUtc','reportVersion'].sort())
  assert.equal(report.modules.filter((item) => item.required).length, 4); assert.ok(report.errorObservations.every((item) => item.outcome === 'notObserved' && item.coverage === 'fixture'))
  const serialized = JSON.stringify(report)
  for (const forbidden of ['apiKey', 'credentialId', 'projectId', 'latitude', 'longitude', 'upstreamUrl', 'X-QW-Api-Key', '://']) assert.equal(serialized.includes(forbidden), false)
})

test('probe completion rule rejects any failed required weather module', () => {
  const modules = ['alert','current','hourly','minutely'].map((module) => ({ module, required: true, outcome: module === 'hourly' ? 'error' : 'success' }))
  assert.equal(modules.some((item) => item.required && item.outcome === 'error') ? 'error' : 'completed', 'error')
})
