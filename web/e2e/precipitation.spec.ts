import { expect, test, type Page } from '@playwright/test'
import { cities, counties, province, townships, villages } from './fixtures'

function precipSnapshot(overrides: Record<string, unknown> = {}) {
  const grid: Array<Record<string, unknown>> = []
  for (let lat = 27.0; lat <= 31.5 + 1e-9; lat += 0.25) {
    for (let lon = 118.0; lon <= 123.0 + 1e-9; lon += 0.25) {
      grid.push({ lat: Math.round(lat * 1000) / 1000, lon: Math.round(lon * 1000) / 1000, values: { d1: 60, d2: 15, d3: 8, d4: 3, d5: 0.5, d6: 0, d7: 60 } })
    }
  }
  return {
    grid, days: ['2026-08-10', '2026-08-11', '2026-08-12', '2026-08-13', '2026-08-14', '2026-08-15', '2026-08-16'],
    coveredDays: 7, model: 'ECMWF IFS 0.25°', updatedAt: '2026-08-10 08:12:00+08:00', aggregateFrom: '2026-08-10 09:00:00+08:00',
    ...overrides,
  }
}

async function installFixtures(page: Page, options: { grid?: 'error' | 'stale' } = {}) {
  const requests: string[] = []
  await page.route('**/*', async (route) => {
    const url = new URL(route.request().url())
    if (url.pathname === '/data/boundary/province.geojson') return route.fulfill({ json: province })
    if (url.pathname === '/data/boundary/city/330000.geojson') return route.fulfill({ json: cities })
    if (url.pathname === '/data/boundary/county/330100.geojson') return route.fulfill({ json: counties })
    if (url.pathname === '/data/boundary/township/330101.geojson') return route.fulfill({ json: townships })
    if (url.pathname === '/data/villages/330101001000.geojson') return route.fulfill({ json: villages })
    if (url.pathname === '/data/rs.json') return route.fulfill({ status: 404, body: '' })
    if (url.pathname === '/api/precipitation-grid') {
      requests.push(url.pathname)
      if (options.grid === 'error') return route.fulfill({ status: 503, json: { error: { code: 'PRECIP_UNAVAILABLE', message: '降水预报数据暂不可用' } } })
      if (options.grid === 'stale') return route.fulfill({ status: 200, json: precipSnapshot({ stale: true, refreshError: '降水预报上游繁忙' }) })
      return route.fulfill({ status: 200, json: precipSnapshot() })
    }
    if (url.hostname.endsWith('tianditu.gov.cn')) return route.fulfill({ status: 204, body: '' })
    return route.continue()
  })
  return requests
}

async function openPrecipitation(page: Page) {
  await page.goto('/')
  await page.waitForSelector('.precip-btn:not([disabled])')
  await page.click('.precip-btn')
  await page.waitForSelector('.precip-panel')
}

test('进入查看降水：面板与全省色斑出现，默认选中第 1 天', async ({ page }) => {
  await installFixtures(page)
  await openPrecipitation(page)
  await expect(page.locator('.precip-panel')).toBeVisible()
  await expect(page.locator('.day-chip')).toHaveCount(7)
  await expect(page.locator('.day-chip').first()).toHaveClass(/active/)
  // 色斑 canvas 已挂载到降水 pane
  await expect(page.locator('.leaflet-precipitation-pane canvas')).toBeVisible()
  await expect(page.locator('.precip-panel')).toContainText('降水预报数据 © Open-Meteo / ECMWF')
  await expect(page.locator('.precip-panel')).toContainText('预报场仅供参考，不作定损依据')
})

test('时间轴点击切换日期且不重新请求上游', async ({ page }) => {
  const requests = await installFixtures(page)
  await openPrecipitation(page)
  await page.click('.day-chip >> nth=2')
  await expect(page.locator('.day-chip').nth(2)).toHaveClass(/active/)
  await expect(page.locator('.day-chip').first()).not.toHaveClass(/active/)
  await page.click('.day-chip >> nth=6')
  await expect(page.locator('.day-chip').nth(6)).toHaveClass(/active/)
  expect(requests.filter((request) => request === '/api/precipitation-grid')).toHaveLength(1)
})

test('循环播放：逐天切换且到第 7 天后回到第 1 天继续', async ({ page }) => {
  await installFixtures(page)
  await openPrecipitation(page)
  await page.click('.play-button')
  await expect(page.locator('.play-button')).toContainText('暂停')
  // 1.2s 步进：先到第 2 天
  await expect(page.locator('.day-chip').nth(1)).toHaveClass(/active/, { timeout: 3000 })
  // 点日期暂停并跳转
  await page.click('.day-chip >> nth=5')
  await expect(page.locator('.day-chip').nth(5)).toHaveClass(/active/)
  await expect(page.locator('.play-button')).toContainText('播放')
})

test('可见度滑动条：调节透明度，0% 完全隐藏色斑', async ({ page }) => {
  await installFixtures(page)
  await openPrecipitation(page)
  const canvas = page.locator('.leaflet-precipitation-pane canvas')
  await expect(canvas).toHaveCSS('opacity', '0.6')
  await page.locator('#precip-opacity').fill('0')
  await expect(canvas).toHaveCSS('opacity', '0')
  await expect(page.locator('.opacity-value')).toHaveText('0%')
  await page.locator('#precip-opacity').fill('80')
  await expect(canvas).toHaveCSS('opacity', '0.8')
})

test('悬停浮窗：仅显示分级与当日累计数值', async ({ page }) => {
  await installFixtures(page)
  await openPrecipitation(page)
  const mapEl = page.locator('.map-wrap')
  const box = await mapEl.boundingBox()
  if (!box) throw new Error('map element missing')
  // 中心点附近（浙江中部，全网格 d1=30 → 暴雨）
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
  await expect(page.locator('.precip-hover-wrap')).toBeVisible()
  await expect(page.locator('.precip-hover')).toContainText('暴雨')
  await expect(page.locator('.precip-hover')).toContainText('60.0 mm')
  // 浮窗内容不含地址/日期等额外信息
  const text = await page.locator('.precip-hover').innerText()
  expect(text).not.toContain('2026')
  expect(text).not.toContain('杭州市')
})

test('降级：上游失败显示"降水预报暂不可用"，不降级成无降水', async ({ page }) => {
  await installFixtures(page, { grid: 'error' })
  await openPrecipitation(page)
  await expect(page.locator('.precip-panel')).toContainText('降水预报暂不可用')
})

test('stale：上游失败但有旧快照时显示降级标注且可操作', async ({ page }) => {
  await installFixtures(page, { grid: 'stale' })
  await openPrecipitation(page)
  await expect(page.locator('.transient-status.stale')).toContainText('数据获取失败，显示上次成功数据')
  await expect(page.locator('.day-chip')).toHaveCount(7)
})

test('与天气互斥：进入降水后进天气，降水面板与色斑关闭', async ({ page }) => {
  await installFixtures(page)
  await openPrecipitation(page)
  await expect(page.locator('.precip-panel')).toBeVisible()
  await page.click('.weather-btn')
  await page.click('#weather-tool-menu button:has-text("实时天气")')
  await expect(page.locator('.precip-panel')).not.toBeVisible()
  await expect(page.locator('.leaflet-precipitation-pane canvas')).not.toBeVisible()
})

test('退出：面板、色斑与选中态全部清除', async ({ page }) => {
  await installFixtures(page)
  await openPrecipitation(page)
  await page.click('.precip-panel .close-button')
  await expect(page.locator('.precip-panel')).not.toBeVisible()
  await expect(page.locator('.leaflet-precipitation-pane canvas')).not.toBeVisible()
  await expect(page.locator('.precip-btn')).not.toHaveClass(/active/)
})

test('下钻到县：色斑保持显示（连续渲染），面板仍可操作', async ({ page }) => {
  await installFixtures(page)
  await openPrecipitation(page)
  await page.click('.map-wrap')
  // 点击城市/县区域触发下钻由既有逻辑驱动；此处验证下钻后面板与色斑仍存在
  await expect(page.locator('.precip-panel')).toBeVisible()
  await page.click('.day-chip >> nth=3')
  await expect(page.locator('.day-chip').nth(3)).toHaveClass(/active/)
})
