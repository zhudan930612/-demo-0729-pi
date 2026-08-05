import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

export const DEFAULT_APIHZ_URL = 'https://cn.apihz.cn/api/tianqi/taifeng.php'
const SERVER_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

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

function normalizedHttpsOrigin(value) {
  if (!value) return ''
  try {
    const url = new URL(value.includes('://') ? value : `https://${value}`)
    return url.protocol === 'https:' && url.username === '' && url.password === '' && url.pathname === '/' && !url.search && !url.hash ? url.origin : ''
  } catch { return '' }
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
    cacheMaxEntries: positiveInteger(env.APIHZ_CACHE_MAX_ENTRIES, 128),
    rateLimitPerMinute: positiveInteger(env.APIHZ_RATE_LIMIT_PER_MINUTE, 60),
    rateLimitMaxClients: positiveInteger(env.APIHZ_RATE_LIMIT_MAX_CLIENTS, 2048),
    weather: {
      authMode: env.QWEATHER_AUTH_MODE || 'api-key',
      apiOrigin: normalizedHttpsOrigin(env.QWEATHER_API_HOST),
      apiKey: env.QWEATHER_API_KEY || '',
      projectId: env.QWEATHER_PROJECT_ID || '',
      credentialId: env.QWEATHER_CREDENTIAL_ID || '',
      dataDir: env.WEATHER_DATA_DIR ? path.resolve(SERVER_DIR, env.WEATHER_DATA_DIR) : '',
      addressUrl: env.APIHZ_ADDRESS_URL || '',
      timeoutMs: positiveInteger(env.QWEATHER_TIMEOUT_MS, 8000),
      maxNetworkBytes: positiveInteger(env.QWEATHER_MAX_NETWORK_BYTES, 2 * 1024 * 1024),
      maxDecodedBytes: positiveInteger(env.QWEATHER_MAX_DECODED_BYTES, 4 * 1024 * 1024),
      cacheMaxEntries: positiveInteger(env.QWEATHER_CACHE_MAX_ENTRIES, 2048),
      upstreamConcurrency: positiveInteger(env.QWEATHER_UPSTREAM_CONCURRENCY, 6),
      adminToken: env.WEATHER_ADMIN_TOKEN || '',
      seatsFile: env.GOVERNMENT_SEATS_FILE || '',
    },
    nationalAlarms: {
      dataDir: env.WEATHER_DATA_DIR ? path.resolve(SERVER_DIR, env.WEATHER_DATA_DIR) : '',
      seatsFile: env.GOVERNMENT_SEATS_FILE || '',
      timeoutMs: positiveInteger(env.NATIONAL_ALARM_TIMEOUT_MS, 10_000),
      listMaxBytes: positiveInteger(env.NATIONAL_ALARM_LIST_MAX_BYTES, 3 * 1024 * 1024),
      detailMaxBytes: positiveInteger(env.NATIONAL_ALARM_DETAIL_MAX_BYTES, 512 * 1024),
    },
  }
}
