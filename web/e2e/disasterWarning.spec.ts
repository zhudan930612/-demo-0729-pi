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
  schemaVersion: 1, thresholds: { low: 130, mid: 160, high: 185 }, hysteresisNodes: 2,
  nodeTimes: ['2026-07-09 00:00:00', '2026-07-10 12:00:00'],
  villages: [{ code: '330382101001', name: '示例预警村', cityCode: '330300', countyCode: '330382', townshipCode: '330382101000', lon: 121.0, lat: 28.2, seatSource: 'centroid' }],
  nodes: [{ i: 0, w: [] }, { i: 1, w: [[0, 2]] }],
}

async function installFixtures(page: Page, options: { disasterDataMissing?: boolean } = {}) {
  await page.route('**/*', async (route) => {
    const url = new URL(route.request().url())
    const p = url.pathname
    if (p === '/data/boundary/province.geojson') return route.fulfill({ json: province })
    if (p === '/data/boundary/city/330000.geojson') return route.fulfill({ json: makeCity() })
    if (p === '/data/rs.json') return route.fulfill({ status: 404, body: '' })
    if (p.startsWith('/data/disaster/')) {
      // R2-18：降雨/轨迹/预警数据缺失 → 降级
      if (options.disasterDataMissing) return route.fulfill({ status: 404, body: '' })
      if (p === '/data/disaster/track.json') return route.fulfill({ json: disasterTrack })
      if (p === '/data/disaster/precip.json') return route.fulfill({ json: disasterPrecip })
      if (p === '/data/disaster/warnings.json') return route.fulfill({ json: disasterWarnings })
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
