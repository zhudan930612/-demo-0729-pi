import { expect, test, type Page } from '@playwright/test'
import { cities, counties, province, townships, villages } from './fixtures'

const ALARM_ID = '330100000001'

type AlarmFixture = 'empty' | 'request-error' | 'many' | 'not-mappable'

async function installFixtures(page: Page, options: { alarmFixture?: AlarmFixture } = {}) {
  await page.route('**/*', async (route) => {
    const url = new URL(route.request().url())
    if (url.pathname === '/data/boundary/province.geojson') return route.fulfill({ json: province })
    if (url.pathname === '/data/boundary/city/330000.geojson') return route.fulfill({ json: cities })
    if (url.pathname === '/data/boundary/county/330100.geojson') return route.fulfill({ json: counties })
    if (url.pathname === '/data/boundary/township/330101.geojson') return route.fulfill({ json: townships })
    if (url.pathname === '/data/villages/330101001000.geojson') return route.fulfill({ json: villages })
    if (url.pathname === '/data/rs.json') return route.fulfill({ status: 404, body: '' })
    if (url.pathname === '/api/precipitation-grid') return route.fulfill({ status: 503, body: '' })
    if (url.pathname === '/api/national-weather-alarms') {
      // 列表走 fixture-server；变体通过 fixture 参数选择
      if (options.alarmFixture) return route.continue({ url: `http://127.0.0.1:4173${url.pathname}?fixture=${options.alarmFixture}` })
      return route.continue()
    }
    if (url.hostname.endsWith('tianditu.gov.cn')) return route.fulfill({ status: 204, body: '' })
    return route.continue()
  })
}

async function openAlarms(page: Page) {
  await page.goto('/')
  await expect(page.locator('.map-zoom-level')).toHaveText('Z 7.50')
  await page.getByRole('button', { name: '查看天气' }).click()
  await page.getByRole('button', { name: '气象预警' }).click()
  await expect(page.getByRole('heading', { name: '气象预警', exact: true })).toBeVisible()
}

test('独立进入与退出预警：面板数据时间与标记出现；退出清除并恢复入口焦点', async ({ page }) => {
  await installFixtures(page)
  await openAlarms(page)
  // 进入重置到省级、不动视野
  await expect(page.locator('.map-zoom-level')).toHaveText('Z 7.50')
  await expect(page.getByText('数据时间：2026/08/03 12:00')).toBeVisible()
  await expect(page.getByText('数据来源：中央气象台（NMC）')).toBeVisible()
  const records = page.locator('.national-alarm-panel .records button')
  await expect(records).toHaveCount(1)
  await expect(records.first()).toHaveAttribute('aria-label', /2026\/08\/03 11:20，杭州市发布暴雨红色预警信号，行政代码 330100/)
  await expect(page.locator('.national-alarm-marker')).toHaveCount(1)
  await page.getByRole('button', { name: '关闭浙江预警' }).click()
  await expect(page.getByRole('heading', { name: '气象预警', exact: true })).toBeHidden()
  await expect(page.locator('.national-alarm-marker')).toHaveCount(0)
  await expect(page.getByRole('button', { name: '查看天气' })).toBeFocused()
  await expect(page.locator('.map-zoom-level')).toHaveText('Z 7.50')
})

test('列表选择：点击预警定位到对应市级、记录高亮且不弹浮窗', async ({ page }) => {
  await installFixtures(page)
  await openAlarms(page)
  await page.locator('.national-alarm-panel .records button').first().click()
  // 定位到杭州市（城市 fitBounds 抬升到退出阈值 9.0 + 0.25 之上）
  await expect(page.locator('.crumb.active')).toHaveText('杭州市')
  await expect(page.locator('.map-zoom-level')).toHaveText('Z 9.25')
  await expect(page.locator('.national-alarm-panel .records button.selected')).toHaveCount(1)
  await expect(page.getByRole('dialog', { name: '浙江预警详情' })).toBeHidden()
})

test('无法定位的预警：点击提示且不下钻、不渲染标记', async ({ page }) => {
  await installFixtures(page, { alarmFixture: 'not-mappable' })
  await openAlarms(page)
  await expect(page.locator('.national-alarm-marker')).toHaveCount(0)
  await page.locator('.national-alarm-panel .records button').first().click()
  await expect(page.getByText('该预警暂无法定位到当前地图')).toBeVisible()
  await expect(page.locator('.crumb.active')).toHaveText('浙江省')
  await expect(page.locator('.map-zoom-level')).toHaveText('Z 7.50')
})

test('地图标记详情：正文展示、再点/空白/Esc 关闭、标记保留', async ({ page }) => {
  await installFixtures(page)
  await openAlarms(page)
  const marker = page.locator('.national-alarm-marker')
  await expect(marker).toHaveCount(1)
  const popup = page.getByRole('dialog', { name: '浙江预警详情' })
  await marker.click()
  await expect(popup).toBeVisible()
  await expect(popup).toContainText('杭州市发布暴雨红色预警信号')
  await expect(popup).toContainText('发布时间：2026/08/03 11:20')
  await expect(popup).toContainText('预计未来三小时部分地区有强降雨，请注意防范。')
  // 再点同一标记关闭
  await marker.click()
  await expect(popup).toBeHidden()
  // 空白点击关闭
  await marker.click()
  await expect(popup).toBeVisible()
  await page.locator('.map').click({ position: { x: 40, y: 680 } })
  await expect(popup).toBeHidden()
  // Esc 关闭
  await marker.click()
  await expect(popup).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(popup).toBeHidden()
  await expect(marker).toHaveCount(1)
})

test('详情失败可重试：首次失败显示重试按钮，重试后展示正文', async ({ page }) => {
  await installFixtures(page)
  let detailCalls = 0
  await page.route(`**/api/national-weather-alarms/${ALARM_ID}`, async (route) => {
    detailCalls++
    if (detailCalls === 1) return route.fulfill({ status: 503, json: { error: { code: 'NATIONAL_ALARM_DETAIL_BUSY', message: '详情服务繁忙' } } })
    return route.continue()
  })
  await openAlarms(page)
  await page.locator('.national-alarm-marker').click()
  const popup = page.getByRole('dialog', { name: '浙江预警详情' })
  await expect(popup).toContainText('预警正文暂不可用')
  const retry = popup.getByRole('button', { name: '重试' })
  await expect(retry).toBeVisible()
  await retry.click()
  await expect(popup).toContainText('预计未来三小时部分地区有强降雨，请注意防范。')
  await expect(retry).toBeHidden()
  expect(detailCalls).toBe(2)
})

test('列表加载失败：显示错误且不伪装成空态、不渲染标记', async ({ page }) => {
  await installFixtures(page, { alarmFixture: 'request-error' })
  await openAlarms(page)
  await expect(page.locator('.national-alarm-panel .error')).toContainText('预警服务繁忙')
  await expect(page.getByText('当前未查询到浙江省生效预警')).toBeHidden()
  await expect(page.locator('.national-alarm-panel .records button')).toHaveCount(0)
  await expect(page.locator('.national-alarm-marker')).toHaveCount(0)
})

test('空快照：显示无生效预警、无记录与标记', async ({ page }) => {
  await installFixtures(page, { alarmFixture: 'empty' })
  await openAlarms(page)
  await expect(page.getByText('当前未查询到浙江省生效预警')).toBeVisible()
  await expect(page.locator('.national-alarm-panel .records button')).toHaveCount(0)
  await expect(page.locator('.national-alarm-marker')).toHaveCount(0)
})

test('多条预警：按发布时间倒序排列，每条可定位预警渲染标记', async ({ page }) => {
  await installFixtures(page, { alarmFixture: 'many' })
  await openAlarms(page)
  const records = page.locator('.national-alarm-panel .records button')
  await expect(records).toHaveCount(2)
  await expect(records.nth(0)).toContainText('宁波市发布台风橙色预警信号')
  await expect(records.nth(1)).toContainText('杭州市发布暴雨红色预警信号')
  await expect(page.locator('.national-alarm-marker')).toHaveCount(2)
})

test('刷新：点击刷新触发上游更新，面板数据时间更新且无错误', async ({ page }) => {
  await installFixtures(page)
  await openAlarms(page)
  await expect(page.getByText('数据时间：2026/08/03 12:00')).toBeVisible()
  await page.getByRole('button', { name: '刷新浙江预警' }).click()
  await expect(page.getByText('数据时间：2026/08/03 13:00')).toBeVisible()
  await expect(page.locator('.national-alarm-panel .error')).toHaveCount(0)
  await expect(page.locator('.national-alarm-marker')).toHaveCount(1)
})

test('与降水互斥：进入降雨量关闭预警面板与标记', async ({ page }) => {
  await installFixtures(page)
  await openAlarms(page)
  await expect(page.locator('.precip-panel')).toBeHidden()
  await page.click('.weather-btn')
  await page.click('#weather-tool-menu button:has-text("降雨量")')
  await expect(page.locator('.precip-panel')).toBeVisible()
  await expect(page.getByRole('heading', { name: '气象预警', exact: true })).toBeHidden()
  await expect(page.locator('.national-alarm-marker')).toHaveCount(0)
})
