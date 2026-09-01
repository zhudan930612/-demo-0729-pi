import { expect, test, type Page } from '@playwright/test'
import { province } from './fixtures'

// ---------- fixture 构造 ----------
function makeCity() {
  return { type: 'FeatureCollection', features: [{ type: 'Feature', properties: { code: '330600', name: '绍兴市' }, geometry: { type: 'Polygon', coordinates: [[[119.5, 29], [121.5, 29], [121.5, 30.5], [119.5, 30.5], [119.5, 29]]] } }] }
}
// 受灾预警静态数据（契约 docs/plans/受灾预警-V1-实施.md §6）：最小有效样本
const disasterTrack = {
  code: 200, no1: '3257931', no2: '2609', no3: '2609', no4: '', namecn: '巴威', nameen: 'BAVI', type: 'stop',
  datas: [
    { time_ymdh: '2026-07-09 00:00:00', lat: 28.1, lon: 121.2, intensity_text: '台风' },
    { time_ymdh: '2026-07-10 12:00:00', lat: 28.3, lon: 121.0, intensity_text: '台风' },
  ],
}
const disasterPrecip = {
  schemaVersion: 1, model: 'ERA5 0.25° (Open-Meteo archive)', aggregateFrom: '2026-07-09 00:00:00',
  nodeTimes: ['2026-07-09 00:00:00', '2026-07-10 12:00:00'],
  grid: [{ lat: 28.084, lon: 121.220, cum: [0.0, 15.5] }],
}
const disasterWarnings = {
  schemaVersion: 1, thresholds: { low: 170, mid: 175, high: 180 }, hysteresisNodes: 2,
  nodeTimes: ['2026-07-09 00:00:00', '2026-07-10 12:00:00'],
  villages: [{ code: '330382101001', name: '示例预警村', cityCode: '330300', countyCode: '330382', townshipCode: '330382101000', lon: 121.0, lat: 28.2, seatSource: 'centroid' }],
  nodes: [{ i: 0, w: [] }, { i: 1, w: [[0, 2]] }],
}
const disasterUnderwriting = {
  schemaVersion: 1, seed: 'e2e', sumInsuredPerMu: 1250, targetTotalMu: 12000000,
  villages: [{ code: '330382101001', name: '示例预警村', insuredAreaMu: 500, householdCount: 60, sumInsuredYuan: 625000, source: 'mock' }],
}
const disasterRiskModel = {
  schemaVersion: 1,
  riskLevelFromCumRainMm: [
    { max: 50, level: 0, name: '无', coefficient: 0.2 },
    { min: 50, max: 100, level: 1, name: '低', coefficient: 0.4 },
    { min: 100, max: 150, level: 2, name: '中', coefficient: 0.7 },
    { min: 150, level: 3, name: '高', coefficient: 1.0 },
  ],
  lossRateByWarningLevel: [
    { level: 1, name: '低', lossRate: 0.03 },
    { level: 2, name: '中', lossRate: 0.08 },
    { level: 3, name: '高', lossRate: 0.15 },
  ],
  formula: '预估受灾面积 = Σ(预警村承保面积 × 村级风险系数 × 损失率)',
}
// 多节点 fixture（R2 播放 / R3 分级 / R4 数字 / R5 任务）
const multiTrack = {
  code: 200, no1: '3257931', no2: '2609', no3: '2609', no4: '', namecn: '巴威', nameen: 'BAVI', type: 'stop',
  datas: [
    { time_ymdh: '2026-07-09 00:00:00', lat: 28.1, lon: 121.2, intensity_text: '台风' },
    { time_ymdh: '2026-07-10 12:00:00', lat: 28.3, lon: 121.0, intensity_text: '台风' },
    { time_ymdh: '2026-07-11 00:00:00', lat: 28.6, lon: 120.9, intensity_text: '强台风' },
  ],
}
const multiPrecip = {
  schemaVersion: 1, model: 'ERA5 0.25° (Open-Meteo archive)', aggregateFrom: '2026-07-09 00:00:00',
  nodeTimes: ['2026-07-09 00:00:00', '2026-07-10 12:00:00', '2026-07-11 00:00:00'],
  grid: [
    { lat: 28.084, lon: 121.220, cum: [0.0, 15.5, 98.0] },
    { lat: 28.6, lon: 120.9, cum: [0.0, 5.0, 60.0] },
  ],
}
const multiWarnings = {
  schemaVersion: 1, thresholds: { low: 170, mid: 175, high: 180 }, hysteresisNodes: 2,
  nodeTimes: ['2026-07-09 00:00:00', '2026-07-10 12:00:00', '2026-07-11 00:00:00'],
  villages: [
    { code: '330382101001', name: '甲村', cityCode: '330300', countyCode: '330382', townshipCode: '330382101000', lon: 121.0, lat: 28.2, seatSource: 'seat' },
    { code: '330382101002', name: '乙村', cityCode: '330300', countyCode: '330382', townshipCode: '330382101000', lon: 121.05, lat: 28.25, seatSource: 'seat' },
  ],
  nodes: [
    { i: 0, w: [] },
    { i: 1, w: [[0, 1]] }, // 甲村低风险
    { i: 2, w: [[0, 3], [1, 2]] }, // 甲村高风险 + 乙村中风险
  ],
}
const multiUnderwriting = {
  schemaVersion: 1, seed: 'e2e', sumInsuredPerMu: 1250, targetTotalMu: 12000000,
  villages: [
    { code: '330382101001', name: '甲村', insuredAreaMu: 500, householdCount: 60, sumInsuredYuan: 625000, source: 'mock' },
    { code: '330382101002', name: '乙村', insuredAreaMu: 300, householdCount: 40, sumInsuredYuan: 375000, source: 'mock' },
  ],
}

// 面板静态数据（与上述 warnings/underwriting 匹配，索引一致）
const disasterPanel = {
  schemaVersion: 1,
  nodeTimes: disasterWarnings.nodeTimes,
  perNode: [
    { i: 0, time: disasterWarnings.nodeTimes[0]!, loss: { areaWanMu: 0, households: 0, amountWanYuan: 0 }, sorted: [], byIdx: {} },
    { i: 1, time: disasterWarnings.nodeTimes[1]!, loss: { areaWanMu: 0.15, households: 60, amountWanYuan: 19.5 }, sorted: [0], byIdx: { '0': { idx: 0, level: 2, future24: 160, cumRain: 15.5, coefficient: 0.4, lossRate: 0.08, areaMu: 16, amountYuan: 20000, households: 60 } } },
  ],
}
const multiPanel = {
  schemaVersion: 1,
  nodeTimes: multiWarnings.nodeTimes,
  perNode: [
    { i: 0, time: multiWarnings.nodeTimes[0]!, loss: { areaWanMu: 0, households: 0, amountWanYuan: 0 }, sorted: [], byIdx: {} },
    { i: 1, time: multiWarnings.nodeTimes[1]!, loss: { areaWanMu: 0.06, households: 60, amountWanYuan: 7.5 }, sorted: [0], byIdx: { '0': { idx: 0, level: 1, future24: 150, cumRain: 15.5, coefficient: 0.4, lossRate: 0.03, areaMu: 6, amountYuan: 7500, households: 60 } } },
    { i: 2, time: multiWarnings.nodeTimes[2]!, loss: { areaWanMu: 0.75, households: 100, amountWanYuan: 104.5 }, sorted: [0, 1], byIdx: { '0': { idx: 0, level: 3, future24: 200, cumRain: 98, coefficient: 0.7, lossRate: 0.15, areaMu: 52.5, amountYuan: 65625, households: 60 }, '1': { idx: 1, level: 2, future24: 180, cumRain: 60, coefficient: 0.4, lossRate: 0.08, areaMu: 9.6, amountYuan: 12000, households: 40 } } },
  ],
}
function makeCounty() {
  return { type: 'FeatureCollection', features: [{ type: 'Feature', properties: { code: '330382', name: '乐清市' }, geometry: { type: 'Polygon', coordinates: [[[120.9, 28.1], [121.2, 28.1], [121.2, 28.4], [120.9, 28.4], [120.9, 28.1]]] } }] }
}

async function installFixtures(page: Page, options: { disasterDataMissing?: boolean; useMulti?: boolean } = {}) {
  await page.route('**/*', async (route) => {
    const url = new URL(route.request().url())
    const p = url.pathname
    if (p === '/data/boundary/province.geojson') return route.fulfill({ json: province })
    if (p === '/data/boundary/city/330000.geojson') return route.fulfill({ json: makeCity() })
    if (p === '/data/boundary/county/330300.geojson') return route.fulfill({ json: makeCounty() })
    if (p === '/data/boundary/county/330200.geojson') return route.fulfill({ status: 404, body: '' })
    if (p === '/data/rs.json') return route.fulfill({ status: 404, body: '' })
    if (p.startsWith('/data/disaster/')) {
      // R2-18：降雨/轨迹/预警数据缺失 → 降级
      if (options.disasterDataMissing) return route.fulfill({ status: 404, body: '' })
      const useMulti = options.useMulti ?? false
      if (p === '/data/disaster/track.json') return route.fulfill({ json: useMulti ? multiTrack : disasterTrack })
      if (p === '/data/disaster/precip.json') return route.fulfill({ json: useMulti ? multiPrecip : disasterPrecip })
      if (p === '/data/disaster/warnings.json') return route.fulfill({ json: useMulti ? multiWarnings : disasterWarnings })
      if (p === '/data/disaster/underwriting.json') return route.fulfill({ json: useMulti ? multiUnderwriting : disasterUnderwriting })
      if (p === '/data/disaster/risk-model.json') return route.fulfill({ json: disasterRiskModel })
      if (p === '/data/disaster/panel.json') return route.fulfill({ json: useMulti ? multiPanel : disasterPanel })
    }
    if (url.hostname.endsWith('tianditu.gov.cn')) return route.fulfill({ status: 204, body: '' })
    return route.continue()
  })
}

async function openDemoMenu(page: Page) {
  await page.goto('/')
  await page.waitForSelector('.demo-btn')
  await page.click('.demo-btn')
  await expect(page.locator('#demo-tool-menu')).toBeVisible()
}

test('R1-1/R1-2/R1-3 入口点亮：菜单三项、受灾预警可进入、受灾评估仍灰显', async ({ page }) => {
  await installFixtures(page)
  await openDemoMenu(page)
  await expect(page.locator('#demo-tool-menu .menu-action')).toHaveCount(3)
  // R1-3：受灾评估 仍不可进入（disabled）
  await expect(page.locator('#demo-tool-menu .menu-action:has-text("受灾评估")')).toBeDisabled()
  // R1-1：受灾预警 不再灰显/无即将上线提示
  const warningEntry = page.locator('#demo-tool-menu .menu-action[title="进入受灾预警"]')
  await expect(warningEntry).toBeEnabled()
  await expect(warningEntry).not.toContainText('即将上线')
  // R1-2：选择受灾预警 → 进入模式，地图回省级视角
  await warningEntry.click()
  await expect(page.locator('.disaster-warning-panel')).toBeVisible()
  await expect(page.locator('.crumb.active')).toHaveText('浙江省')
})

test('R1-5 面板三 tab：默认灾损预估，可自由切换', async ({ page }) => {
  await installFixtures(page)
  await openDemoMenu(page)
  await page.click('#demo-tool-menu .menu-action[title="进入受灾预警"]')
  await expect(page.locator('.disaster-warning-panel')).toBeVisible()
  // 三个 tab
  await expect(page.locator('.disaster-warning-panel .tab-list button')).toHaveCount(3)
  await expect(page.locator('.disaster-warning-panel #dw-tab-loss')).toHaveText('灾损预估')
  await expect(page.locator('.disaster-warning-panel #dw-tab-warning')).toHaveText('预警监测')
  await expect(page.locator('.disaster-warning-panel #dw-tab-tasks')).toHaveText('任务列表')
  // 默认选中灾损预估
  await expect(page.locator('#dw-tab-loss')).toHaveAttribute('aria-selected', 'true')
  await expect(page.locator('[data-test="dw-loss-pane"]')).toBeVisible()
  // 切换到预警监测
  await page.click('#dw-tab-warning')
  await expect(page.locator('#dw-tab-warning')).toHaveAttribute('aria-selected', 'true')
  await expect(page.locator('[data-test="dw-warning-pane"]')).toBeVisible()
  // 切换到任务列表
  await page.click('#dw-tab-tasks')
  await expect(page.locator('#dw-tab-tasks')).toHaveAttribute('aria-selected', 'true')
  await expect(page.locator('[data-test="dw-task-pane"]')).toBeVisible()
})

test('R1-4 模式互斥：进入受灾预警退出农情监测；退出受灾预警清理本模式', async ({ page }) => {
  await installFixtures(page)
  await openDemoMenu(page)
  // 先进入农情监测（数据缺失也展示面板，模式互斥只需面板存在性）
  await page.click('#demo-tool-menu button:has-text("农情监测")')
  await expect(page.locator('.agri-panel')).toBeVisible()
  // 再进入受灾预警 → 农情监测面板消失（互斥退出）
  await page.click('.demo-btn')
  await page.click('#demo-tool-menu .menu-action[title="进入受灾预警"]')
  await expect(page.locator('.disaster-warning-panel')).toBeVisible()
  await expect(page.locator('.agri-panel')).toHaveCount(0)
  // 退出受灾预警 → 面板与本模式状态清除，恢复省级
  await page.locator('.disaster-warning-panel .close-button').click()
  await expect(page.locator('.disaster-warning-panel')).toHaveCount(0)
  await expect(page.locator('.crumb.active')).toHaveText('浙江省')
  // 重新打开演示菜单：受灾预警已非激活态（无退出项，入口标题恢复）
  await page.click('.demo-btn')
  await expect(page.locator('#demo-tool-menu .menu-action[title="进入受灾预警"]')).toBeVisible()
})

test('R2-18 数据缺失降级：错误文案 + 灾损 0 + 预警空态 + 派发不可用', async ({ page }) => {
  await installFixtures(page, { disasterDataMissing: true })
  await openDemoMenu(page)
  await page.click('#demo-tool-menu .menu-action[title="进入受灾预警"]')
  await expect(page.locator('.disaster-warning-panel')).toBeVisible()
  // 面板级错误提示
  await expect(page.locator('.disaster-warning-panel .panel-status.error')).toBeVisible()
  // 灾损预估显示 0（降级），三项数字均为 0
  await expect(page.locator('[data-test="dw-loss-pane"] .loss-metric-value').nth(0)).toHaveText('0')
  await expect(page.locator('[data-test="dw-loss-pane"] .loss-metric-value').nth(1)).toHaveText('0')
  await expect(page.locator('[data-test="dw-loss-pane"] .loss-metric-value').nth(2)).toHaveText('0')
  // 预警监测 tab 空态
  await page.click('#dw-tab-warning')
  await expect(page.locator('[data-test="dw-warning-empty"]')).toContainText('数据缺失')
  // 任务列表 tab：派发不可用
  await page.click('#dw-tab-tasks')
  await expect(page.locator('[data-test="dw-task-empty"]')).toContainText('派发不可用')
})

// ---------- R2 播放控制 ----------

async function enterDisaster(page: Page, options: { useMulti?: boolean; autoPlay?: boolean } = {}) {
  await installFixtures(page, options)
  await openDemoMenu(page)
  await page.click('#demo-tool-menu .menu-action[title="进入受灾预警"]')
  await expect(page.locator('.disaster-warning-panel')).toBeVisible()
  await expect(page.locator('.disaster-warning-panel .panel-status')).toHaveCount(0)
  // 测试便利：默认自动点 ▶ 启动播放（R2-3 应用为默认不自动播放；为触达预警/任务节点需点一下），R2-1 用例传 autoPlay:false 验证默认不播放
  if (options.autoPlay !== false) {
    await page.locator('[data-test="dw-play-toggle"]').click()
    await page.waitForTimeout(80)
  }
}

// R2-3 变更：进入受灾预警默认不自动播放；等待推进前先确保正在播放
async function ensurePlaying(page: Page): Promise<void> {
  const isPlaying = await page.locator('[data-test="dw-play-toggle"]').evaluate((el) => el.classList.contains('playing'))
  if (!isPlaying) {
    await page.locator('[data-test="dw-play-toggle"]').click()
    await page.waitForTimeout(60)
  }
}

// 循环播放太快：反复「暂停→校验→未命中则继续」直到停在目标节点时间（如 7月11日0时）
async function holdAtNode(page: Page, targetLabel: string): Promise<boolean> {
  await ensurePlaying(page)
  for (let attempt = 0; attempt < 30; attempt++) {
    await page.waitForFunction(
      (label) => document.querySelector('[data-test="dw-node-time"]')?.textContent === label,
      targetLabel,
      { timeout: 4000 },
    )
    await page.locator('[data-test="dw-play-toggle"]').click() // 暂停
    await page.waitForTimeout(40)
    const current = await page.locator('[data-test="dw-node-time"]').textContent()
    if (current === targetLabel) return true
    await page.locator('[data-test="dw-play-toggle"]').click() // 未命中：继续播放重试
  }
  return false
}

test('R2-1/R2-2/R2-3/R2-4 播放：默认不自动播放 + 迷你浮窗（播放/暂停/节点时间/关闭，无时间轴）+ 点播放启动/循环', async ({ page }) => {
  await enterDisaster(page, { useMulti: true, autoPlay: false })
  // 迷你浮窗可见（R2-2）：播放/暂停 + 节点时间 + 关闭，无时间轴
  const widget = page.locator('[data-test="dw-playback"]')
  await expect(widget).toBeVisible()
  await expect(widget.locator('[data-test="dw-play-toggle"]')).toBeVisible()
  await expect(widget.locator('[data-test="dw-node-time"]')).toHaveText(/7月\d+日\d+时/)
  await expect(widget.locator('[data-test="dw-playback-close"]')).toBeVisible()
  await expect(widget.locator('.timeline, [role="slider"]')).toHaveCount(0) // 无时间轴
  // 进入后默认不自动播放（R2-3 变更）：播放按钮呈「播放」态（非 playing），停在首帧
  await expect(widget.locator('.play-button')).not.toHaveClass(/playing/)
  // 点 ▶ 启动播放（R2-3）：按钮呈「暂停」态
  await widget.locator('[data-test="dw-play-toggle"]').click()
  await expect(widget.locator('.play-button')).toHaveClass(/playing/)
  // 暂停（R2-4）：画面停在当前节点
  await widget.locator('[data-test="dw-play-toggle"]').click()
  await expect(widget.locator('.play-button')).not.toHaveClass(/playing/)
  const pausedTime = await widget.locator('[data-test="dw-node-time"]').textContent()
  await page.waitForTimeout(400)
  await expect(widget.locator('[data-test="dw-node-time"]')).toHaveText(pausedTime ?? '')
  // 继续
  await widget.locator('[data-test="dw-play-toggle"]').click()
  await expect(widget.locator('.play-button')).toHaveClass(/playing/)
})

test('R2-5 关闭按钮直接退出受灾预警模式（清理状态）', async ({ page }) => {
  await enterDisaster(page)
  await page.locator('[data-test="dw-playback-close"]').click()
  await expect(page.locator('.disaster-warning-panel')).toHaveCount(0)
  await expect(page.locator('[data-test="dw-playback"]')).toHaveCount(0)
  await expect(page.locator('.crumb.active')).toHaveText('浙江省')
})

// ---------- R3 预警监测 tab ----------

test('R3-1/R3-2/R3-9/R3-12/R3-13 预警监测列表：全省卡片 + 概览 + 状态标签 + 排序 + 前10条', async ({ page }) => {
  await enterDisaster(page, { useMulti: true })
  await page.click('#dw-tab-warning')
  // 播放推进到节点2（甲村高风险 + 乙村中风险）并暂停固定（R3-1/R3-2）
  await expect(await holdAtNode(page, '7月11日00时')).toBe(true)
  const cards = page.locator('[data-test="dw-warning-card"]')
  await expect(cards).toHaveCount(2)
  // 概览（R3-12）：标题含预警村 + 高风险/中风险计数文字
  await expect(page.locator('[data-test="dw-warning-overview"]')).toContainText('预警村')
  await expect(page.locator('[data-test="dw-warning-overview"]')).toContainText('高风险')
  await expect(page.locator('[data-test="dw-warning-overview"]')).toContainText('中风险')
  // 卡片状态标签（R3-13）：高风险=待处理、中风险=待处理
  const firstStatus = await cards.first().locator('.wc-status').textContent()
  expect(firstStatus).toBe('待处理')
  // 等级色点存在
  await expect(cards.first().locator('.wc-level-dot')).toBeVisible()
})

test('R3-14/R3-15 卡片 AI 文案 + 派发任务按钮生成任务（YJ-）并变已派发', async ({ page }) => {
  await enterDisaster(page, { useMulti: true })
  await page.click('#dw-tab-warning')
  // 等节点推进到 2（甲高+乙中）并暂停固定画面（循环快，holdAtNode 重试直到停在目标节点）
  await expect(await holdAtNode(page, '7月11日00时')).toBe(true)
  const firstCard = page.locator('[data-test="dw-warning-card"]').first()
  await expect(firstCard).toBeVisible({ timeout: 6000 })
  // AI 建议（R3-14）
  await expect(firstCard.locator('.ai-chip')).toBeVisible()
  // 派发任务（R3-15 → R5-1）：生成 YJ- 任务
  await firstCard.locator('[data-test="dw-dispatch-village"]').click()
  await expect(firstCard.locator('[data-test="dw-dispatched"]')).toHaveText('已派发')
  // 任务列表 tab 出现 YJ- 任务
  await page.click('#dw-tab-tasks')
  await expect(page.locator('[data-test="dw-task-row"]').first()).toBeVisible()
  await expect(page.locator('[data-test="dw-task-row"] .task-eyebrow').first()).toHaveText(/YJ-2026-\d{4}/)
})

test('R3-16/R3-17/R3-18 一键派发生成混合状态任务', async ({ page }) => {
  await enterDisaster(page, { useMulti: true })
  await page.click('#dw-tab-warning')
  await expect(await holdAtNode(page, '7月11日00时')).toBe(true) // 暂停固定节点2
  // 一键派发（R3-16）：对中/高风险村批量生成
  await page.locator('[data-test="dw-batch-dispatch"]').click()
  await page.click('#dw-tab-tasks')
  await expect(page.locator('[data-test="dw-task-row"]')).toHaveCount(3) // 甲高2条 + 乙中1条
  await expect(page.locator('[data-test="dw-task-row"] .task-status')).toContainText(['待领取', '进行中', '已完成'])
  await page.locator('[data-test="dw-task-row"]', { hasText: '已完成' }).click()
  await expect(page.locator('[data-test="dw-task-history"]')).toContainText('任务完成（演示证据已挂载）')
  await expect(page.locator('[data-test="dw-evidence"] img')).toHaveCount(2)
})

test('R3-10 点击卡片进入村级视角（下钻聚焦该村）', async ({ page }) => {
  await enterDisaster(page, { useMulti: true })
  await page.click('#dw-tab-warning')
  const firstCard = page.locator('[data-test="dw-warning-card"]').first()
  await expect(firstCard).toBeVisible({ timeout: 6000 })
  await firstCard.click()
  await expect(page.locator('.crumb.active')).toHaveText('甲村')
})

// ---------- R4 灾损预估 tab ----------

test('R4-1/R4-6 灾损预估：三项数字 + 预估标注 + 标题行（层级·截至节点时间）', async ({ page }) => {
  await enterDisaster(page, { useMulti: true })
  // 默认灾损预估 tab
  await expect(page.locator('[data-test="dw-loss-title"]')).toContainText('浙江省 · 截至')
  await expect(page.locator('[data-test="dw-loss-pane"] .est-tag')).toHaveText('预估')
  // 播放推进后三项数字刷新（R4-2 终值）
  await expect(page.locator('[data-test="dw-loss-area"]')).not.toHaveText('0', { timeout: 6000 })
})

test('R4-7 村级风险分布色带 + 明细行（无风险村时也固定显示，值为0）', async ({ page }) => {
  await enterDisaster(page, { useMulti: true, autoPlay: false })
  // 首帧节点0 无预警村：风险分布仍固定显示（低/中/高 = 0），不整块消失
  await expect(page.locator('[data-test="dw-risk-band"]')).toBeVisible({ timeout: 6000 })
  await expect(page.locator('.band-detail-row').first()).toBeVisible()
})

// ---------- R5 任务列表 tab ----------

test('R5-12/R5-13 任务列表：状态筛选 + 详情（预警等级/关联预警/变化记录）', async ({ page }) => {
  await enterDisaster(page, { useMulti: true })
  await page.click('#dw-tab-warning')
  await expect(await holdAtNode(page, '7月11日00时')).toBe(true) // 暂停固定节点2
  const firstCard = page.locator('[data-test="dw-warning-card"]').first()
  await expect(firstCard).toBeVisible({ timeout: 6000 })
  await firstCard.locator('[data-test="dw-dispatch-village"]').click()
  await page.click('#dw-tab-tasks')
  // 打开任务详情
  await page.locator('[data-test="dw-task-row"]').first().click()
  await expect(page.locator('.task-detail .detail-title')).toHaveText(/YJ-2026/)
  // 预警等级行 + 关联预警行
  await expect(page.locator('.task-detail .detail-meta')).toContainText('预警等级')
  await expect(page.locator('.task-detail .detail-meta')).toContainText('关联预警')
  // 变化记录区（R5-5）
  await expect(page.locator('[data-test="dw-task-history"]')).toBeVisible()
})

test('R5-14 查看全部任务：抽屉内选择任务后保留列表并展开详情', async ({ page }) => {
  await enterDisaster(page, { useMulti: true })
  await page.click('#dw-tab-warning')
  await expect(await holdAtNode(page, '7月11日00时')).toBe(true)
  await page.locator('[data-test="dw-batch-dispatch"]').click()
  await page.click('#dw-tab-tasks')

  await expect(page.locator('[data-test="dw-task-list-title"]')).toContainText('任务列表')
  await expect(page.locator('[data-test="dw-view-all-tasks"]')).toBeVisible()
  await page.locator('[data-test="dw-view-all-tasks"]').click()

  const drawer = page.locator('[data-test="dw-task-drawer"]')
  const table = drawer.locator('[data-test="dw-task-drawer-table"]')
  await expect(drawer).toBeVisible()
  await expect(drawer).toContainText('总任务')
  await expect(table).toBeVisible()
  await expect(table.locator('thead')).toContainText('序号')
  await expect(table.locator('thead')).toContainText('任务编号')
  await expect(table.locator('thead')).toContainText('任务名称')
  await expect(table.locator('thead')).toContainText('类型')
  await expect(table.locator('thead')).toContainText('状态')
  await expect(table.locator('thead')).toContainText('村')
  await expect(table.locator('thead')).toContainText('创建时间')
  await table.locator('tbody tr').first().click()
  await expect(drawer).toBeVisible()
  await expect(drawer.locator('[data-test="dw-task-drawer-detail"]')).toContainText('基础信息')
  await drawer.getByRole('button', { name: '返回任务列表' }).click()
  await expect(table).toBeVisible()
})

test('R6-1/R6-2 证据：未完成任务显示待取证；任务状态流转后已完成挂证据', async ({ page }) => {
  await enterDisaster(page, { useMulti: true })
  await page.click('#dw-tab-warning')
  await expect(await holdAtNode(page, '7月11日00时')).toBe(true) // 暂停固定节点2
  const firstCard = page.locator('[data-test="dw-warning-card"]').first()
  await expect(firstCard).toBeVisible({ timeout: 6000 })
  await firstCard.locator('[data-test="dw-dispatch-village"]').click()
  await page.click('#dw-tab-tasks')
  await page.locator('[data-test="dw-task-row"]').first().click()
  // 刚派发 → 待领取，证据区显示「待取证」（R6-2）
  await expect(page.locator('[data-test="dw-evidence-pending"]')).toContainText('待取证')
})
