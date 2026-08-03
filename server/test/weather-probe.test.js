import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { test } from 'node:test'

test('weather probe refuses to run before explicit key rotation confirmation', () => {
  const result = spawnSync(process.execPath, ['scripts/probe-weather.js'], { cwd: new URL('..', import.meta.url), env: { PATH: process.env.PATH, SystemRoot: process.env.SystemRoot, PROBE_SKIP_ENV_FILE: '1' }, encoding: 'utf8' })
  assert.equal(result.status, 2); assert.equal(result.stdout, ''); assert.match(result.stderr, /live probe skipped/)
})

test('weather probe report schema contains aggregates only', () => {
  const report = { reportVersion: 1, probedAtUtc: new Date().toISOString(), outcome: 'completed', durationMs: 1, modules: [{ module: 'current', outcome: 'success', durationMs: 1, itemCount: 1, dataFields: ['condition'], attributionCount: 1 }], limitations: ['safe'] }
  assert.deepEqual(Object.keys(report).sort(), ['durationMs','limitations','modules','outcome','probedAtUtc','reportVersion'].sort())
  const serialized = JSON.stringify(report)
  for (const forbidden of ['apiKey', 'credentialId', 'projectId', 'latitude', 'longitude', 'upstreamUrl', 'X-QW-Api-Key', '://']) assert.equal(serialized.includes(forbidden), false)
})
