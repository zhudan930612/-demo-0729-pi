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
const outputPath = path.join(dataDir, 'government-seats-v1.json')
const key = process.env.TIANDITU_GEOCODER_KEY
const outputOnly = process.argv.includes('--output-only')
if (!outputOnly && !/^[0-9a-f]{32}$/i.test(key ?? '')) throw new Error('TIANDITU_GEOCODER_KEY 未配置或格式无效')

function governmentName(node, nodes) {
  if (node.level === 'province') return `${node.name}人民政府`
  if (node.level === 'city') return `${node.name}人民政府`
  const city = nodes.get(node.parentCode)
  if (!city?.name) throw new Error(`缺少县级父市：${node.code}`)
  return `${city.name}${node.name}人民政府`
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
const targets = index.nodes.filter((node) => ['province', 'city', 'county'].includes(node.level)).sort((a, b) => a.code.localeCompare(b.code))
if (outputOnly) {
  if (!fs.existsSync(outputPath)) throw new Error('政府驻地坐标表不存在；请先使用 TIANDITU_GEOCODER_KEY 生成')
  const output = JSON.parse(fs.readFileSync(outputPath, 'utf8'))
  const entries = output?.entries
  if (output?.schemaVersion !== 1 || output?.provinceCode !== '330000' || !Array.isArray(entries) || entries.length !== targets.length) throw new Error('政府驻地坐标表结构或覆盖范围无效')
  const byCode = new Map(entries.map((entry) => [entry.code, entry]))
  for (const node of targets) {
    const entry = byCode.get(node.code)
    if (!entry || entry.name !== node.name || entry.level !== node.level || entry.governmentName !== governmentName(node, nodes) || entry.status !== 'candidate' || !point(entry.point) || !Number.isFinite(entry.score) || entry.score < 99) throw new Error(`政府驻地坐标记录无效：${node.code}`)
  }
  console.log(JSON.stringify({ output: path.relative(root, outputPath), total: entries.length, candidate: entries.filter((entry) => entry.status === 'candidate').length, mode: 'offline-structure-check' }, null, 2))
} else {
  const server = await requestPage()
  const address = server.address(); const origin = `http://127.0.0.1:${address.port}`
  const browser = await chromium.launch({ channel: 'chrome', headless: true })
  try {
    const page = await browser.newPage()
    await page.goto(origin)
    const entries = []
    for (const node of targets) {
      const query = governmentName(node, nodes)
      const result = await page.evaluate(async ({ query, key }) => {
        const url = `https://api.tianditu.gov.cn/geocoder?ds=${encodeURIComponent(JSON.stringify({ keyWord: query }))}&tk=${encodeURIComponent(key)}`
        const response = await fetch(url)
        const payload = await response.json().catch(() => null)
        return { httpStatus: response.status, payload }
      }, { query, key })
      const location = result.payload?.location
      const lon = Number(location?.lon), lat = Number(location?.lat), score = Number(location?.score)
      entries.push({ code: node.code, name: node.name, level: node.level, governmentName: query, query, point: Number.isFinite(lon) && Number.isFinite(lat) ? [lon, lat] : null, score: Number.isFinite(score) ? score : null, geocoder: '天地图地理编码 API', httpStatus: result.httpStatus, status: result.payload?.status === '0' && point([lon, lat]) ? 'candidate' : 'unresolved' })
    }
    const output = { schemaVersion: 1, provinceCode: '330000', generatedAt: new Date().toISOString(), source: '天地图地理编码 API（政府名称查询）', entries }
    fs.writeFileSync(`${outputPath}.tmp`, `${JSON.stringify(output, null, 2)}\n`, 'utf8')
    fs.renameSync(`${outputPath}.tmp`, outputPath)
    const resolved = entries.filter((entry) => entry.status === 'candidate'), scores = resolved.map((entry) => entry.score).filter(Number.isFinite)
    console.log(JSON.stringify({ output: path.relative(root, outputPath), total: entries.length, candidate: resolved.length, unresolved: entries.length - resolved.length, minScore: scores.length ? Math.min(...scores) : null }, null, 2))
  } finally {
    await browser.close()
    await new Promise((resolve) => server.close(resolve))
  }
}
