#!/usr/bin/env node
/**
 * Generate a private, one-time Zhejiang government-seat coordinate table.
 *
 * The TianDiTu key is intentionally read only from process environment. It is
 * used inside a temporary browser because browser-type keys cannot call the
 * geocoder from Node directly. The generated table, source data and key are
 * all ignored by Git; runtime code performs no TianDiTu requests.
 *
 * Usage:
 *   TIANDITU_GEOCODER_KEY=... node scripts/generate-government-seats.mjs
 *   TIANDITU_GEOCODER_KEY=... node scripts/generate-government-seats.mjs --full
 *   node scripts/generate-government-seats.mjs --output-only [--full]
 *
 * Default mode: province/city/county only -> government-seats-v1.json
 *   (the runtime alarm index consumes exactly this file).
 *
 * --full: all five levels (incl. township + village) ->
 *   government-seats-full-v1.json. This file is NOT consumed by the runtime
 *   alarm index; it is a future-proof asset. Loading it is intentionally not
 *   part of the alarm pipeline because ~35k features delayed the first NMC
 *   response by about a minute. Generation resumes from the existing file,
 *   so interrupted runs can be re-launched safely.
 */
import fs from 'node:fs'
import http from 'node:http'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import playwright from '../web/node_modules/@playwright/test/index.js'
const { chromium } = playwright

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const dataDir = path.join(root, '.dev-runtime', 'weather-data')
const indexPath = path.join(dataDir, 'weather', 'index-v2.json')
// 政府驻地表是受控版本化资产，写入仓库内 server/data/（运行索引默认从该路径读取）；
// 旧的 .dev-runtime 副本已废弃。
const coreOutputPath = path.join(root, 'server', 'data', 'government-seats-v1.json')
const fullOutputPath = path.join(root, 'server', 'data', 'government-seats-full-v1.json')
const key = process.env.TIANDITU_GEOCODER_KEY
const outputOnly = process.argv.includes('--output-only')
const full = process.argv.includes('--full')
if (!outputOnly && !/^[0-9a-f]{32}$/i.test(key ?? '')) throw new Error('TIANDITU_GEOCODER_KEY 未配置或格式无效')
const outputPath = full ? fullOutputPath : coreOutputPath

function governmentName(node, nodes) {
  if (node.level === 'province') return `${node.name}人民政府`
  if (node.level === 'city') return `${node.name}人民政府`
  if (node.level === 'county') {
    const city = nodes.get(node.parentCode)
    if (!city?.name) throw new Error(`缺少县级父市：${node.code}`)
    return `${city.name}${node.name}人民政府`
  }
  if (node.level === 'township') {
    const county = nodes.get(node.parentCode)
    if (!county?.name) throw new Error(`缺少乡镇父县：${node.code}`)
    // 名称已带“办事处”不再追加；以“街道”结尾补“办事处”；镇/乡补“人民政府”。
    // 父县名重复前缀（如“慈溪市林场”已含“慈溪市”）需跳过，避免“慈溪市慈溪市…”。
    const countyPrefix = county.name.replace(/市$/, '')
    const base = node.name.startsWith(countyPrefix) ? node.name : `${county.name}${node.name}`
    if (node.name.endsWith('办事处')) return base
    if (node.name.endsWith('街道')) return `${base}办事处`
    return `${base}人民政府`
  }
  if (node.level === 'village') {
    // 村/社区没有“人民政府”；用上级乡镇 + 村名作为查询词，匹配村委会/居委会驻地
    const township = nodes.get(node.parentCode)
    if (!township?.name) throw new Error(`缺少村级父乡镇：${node.code}`)
    return `${township.name}${node.name}`
  }
  throw new Error(`未知层级：${node.level}`)
}
function point(value) { return Array.isArray(value) && value.length === 2 && value.every(Number.isFinite) }
function requestPage() {
  return new Promise((resolve) => {
    const server = http.createServer((_request, response) => { response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }); response.end('<!doctype html><title>government-seat-geocoder</title>') })
    server.listen(0, '127.0.0.1', () => resolve(server))
  })
}

const index = JSON.parse(fs.readFileSync(indexPath, 'utf8'))
if (index?.schemaVersion !== 2 || !Array.isArray(index.nodes)) throw new Error('weather/index-v2.json 无效')
const nodes = new Map(index.nodes.map((node) => [node.code, node]))
const targetLevels = full ? ['province', 'city', 'county', 'township'] : ['province', 'city', 'county']
const targets = index.nodes.filter((node) => targetLevels.includes(node.level)).sort((a, b) => a.code.localeCompare(b.code))
if (outputOnly) {
  if (!fs.existsSync(outputPath)) throw new Error(`坐标表不存在：${path.relative(root, outputPath)}；请先使用 TIANDITU_GEOCODER_KEY 生成`)
  const output = JSON.parse(fs.readFileSync(outputPath, 'utf8'))
  const entries = output?.entries
  if (output?.schemaVersion !== 1 || output?.provinceCode !== '330000' || !Array.isArray(entries)) throw new Error('政府驻地坐标表结构无效')
  const byCode = new Map(entries.map((entry) => [entry.code, entry]))
  for (const node of targets) {
    const entry = byCode.get(node.code)
    if (!entry || entry.name !== node.name || entry.level !== node.level || entry.governmentName !== governmentName(node, nodes)) throw new Error(`政府驻地坐标记录无效：${node.code}（${entry?.status ?? 'missing'}）`)
    if (entry.status === 'candidate') {
      const minScore = node.level === 'township' ? 60 : 99
      if (!point(entry.point) || !Number.isFinite(entry.score) || entry.score < minScore) throw new Error(`政府驻地坐标记录无效：${node.code}（score=${entry.score}）`)
    } else if (entry.status !== 'unresolved') {
      throw new Error(`政府驻地坐标记录状态无效：${node.code}（${entry.status}）`)
    }
  }
  if (full && entries.length !== targets.length) throw new Error(`政府驻地坐标表覆盖范围无效：期望 ${targets.length} 条，实际 ${entries.length} 条`)
  console.log(JSON.stringify({ output: path.relative(root, outputPath), total: entries.length, candidate: entries.filter((entry) => entry.status === 'candidate').length, mode: 'offline-structure-check', full }, null, 2))
} else {
  const server = await requestPage()
  const address = server.address(); const origin = `http://127.0.0.1:${address.port}`
  const browser = await chromium.launch({ channel: 'chrome', headless: true })
  try {
    const page = await browser.newPage()
    await page.goto(origin)
    // Resume support: keep previously resolved entries so an interrupted full
    // run can be re-launched and only missing codes are queried.
    const previous = fs.existsSync(outputPath) ? JSON.parse(fs.readFileSync(outputPath, 'utf8')) : null
    const previousByCode = previous && Array.isArray(previous.entries) ? new Map(previous.entries.map((entry) => [entry.code, entry])) : new Map()
    const entries = full ? [...(previous?.entries ?? [])] : []
    const done = full ? new Set(entries.map((entry) => entry.code)) : new Set()
    const pending = targets.filter((node) => !done.has(node.code))
    const writeCheckpoint = () => {
      const checkpoint = { schemaVersion: 1, provinceCode: '330000', generatedAt: new Date().toISOString(), source: '天地图地理编码 API（政府名称查询）', full: true, entries }
      fs.writeFileSync(`${outputPath}.tmp`, `${JSON.stringify(checkpoint, null, 2)}\n`, 'utf8')
      fs.renameSync(`${outputPath}.tmp`, outputPath)
    }
    for (const [index, node] of pending.entries()) {
      const query = governmentName(node, nodes)
      const result = await page.evaluate(async ({ query, key }) => {
        const url = `https://api.tianditu.gov.cn/geocoder?ds=${encodeURIComponent(JSON.stringify({ keyWord: query }))}&tk=${encodeURIComponent(key)}`
        const response = await fetch(url)
        const payload = await response.json().catch(() => null)
        return { httpStatus: response.status, payload }
      }, { query, key })
      const location = result.payload?.location
      const lon = Number(location?.lon), lat = Number(location?.lat), score = Number(location?.score)
      const hasPoint = point([lon, lat])
      // 省/市/县保持高分门槛；乡镇级天地图对重名地名常返回省外同名点（score 偏低），
      // 一律以 score>=60 才视为 candidate，低分保留记录但标记 unresolved 不可用。
      const minCandidateScore = node.level === 'township' ? 60 : 99
      entries.push({ code: node.code, name: node.name, level: node.level, governmentName: query, query, point: hasPoint ? [lon, lat] : null, score: Number.isFinite(score) ? score : null, geocoder: '天地图地理编码 API', httpStatus: result.httpStatus, status: result.payload?.status === '0' && hasPoint && Number.isFinite(score) && score >= minCandidateScore ? 'candidate' : 'unresolved' })
      // Checkpoint every 200 rows so an interrupted run keeps all progress and
      // can resume from the on-disk file (the resume path reads it on restart).
      if (full && (index + 1) % 200 === 0) {
        entries.sort((a, b) => a.code.localeCompare(b.code))
        writeCheckpoint()
        console.error(`[full] ${index + 1}/${pending.length} (${((index + 1) / pending.length * 100).toFixed(1)}%) checkpoint 已写入`)
      }
    }
    if (full) entries.sort((a, b) => a.code.localeCompare(b.code))
    writeCheckpoint()
    const resolved = entries.filter((entry) => entry.status === 'candidate'), scores = resolved.map((entry) => entry.score).filter(Number.isFinite)
    console.log(JSON.stringify({ output: path.relative(root, outputPath), total: entries.length, candidate: resolved.length, unresolved: entries.length - resolved.length, minScore: scores.length ? Math.min(...scores) : null, resumed: entries.length - pending.length, full }, null, 2))
  } finally {
    await browser.close()
    await new Promise((resolve) => server.close(resolve))
  }
}
