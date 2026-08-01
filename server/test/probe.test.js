import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { test } from 'node:test'

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
