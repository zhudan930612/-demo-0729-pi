import fs from 'node:fs'

export const DEFAULT_APIHZ_URL = 'https://cn.apihz.cn/api/tianqi/taifeng.php'

export function loadEnvFile(filePath, target = process.env) {
  if (!fs.existsSync(filePath)) return false
  const lines = fs.readFileSync(filePath, 'utf8').split(/\r?\n/)
  for (const line of lines) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('#')) continue
    const separator = trimmed.indexOf('=')
    if (separator <= 0) continue
    const key = trimmed.slice(0, separator).trim()
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key) || target[key] !== undefined) continue
    let value = trimmed.slice(separator + 1).trim()
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1)
    }
    target[key] = value
  }
  return true
}

function positiveInteger(value, fallback) {
  if (value === undefined || value === '') return fallback
  const parsed = Number(value)
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : fallback
}

export function readServerConfig(env = process.env) {
  return {
    developerId: env.APIHZ_DEVELOPER_ID || env.APIHZ_ID || '',
    key: env.APIHZ_KEY || '',
    upstreamUrl: DEFAULT_APIHZ_URL,
    port: positiveInteger(env.PORT, 8787),
    timeoutMs: positiveInteger(env.APIHZ_TIMEOUT_MS, 8000),
    maxResponseBytes: positiveInteger(env.APIHZ_MAX_RESPONSE_BYTES, 5 * 1024 * 1024),
    upstreamConcurrency: positiveInteger(env.APIHZ_UPSTREAM_CONCURRENCY, 6),
    cacheTtlMs: positiveInteger(env.APIHZ_CACHE_TTL_MS, 30_000),
    rateLimitPerMinute: positiveInteger(env.APIHZ_RATE_LIMIT_PER_MINUTE, 60),
  }
}
