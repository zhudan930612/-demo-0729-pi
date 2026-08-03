import { expect, test, type Page } from '@playwright/test'
import { cities, province } from './fixtures'

async function installFixtures(page: Page, options: { failed?: boolean } = {}) {
  const requests: string[] = []
  await page.route('**/*', async (route) => {
    const url = new URL(route.request().url())
    if (url.pathname === '/data/boundary/province.geojson') return route.fulfill({ json: province })
    if (url.pathname === '/data/boundary/city/330000.geojson') return route.fulfill({ json: cities })
    if (url.pathname === '/data/rs.json') return route.fulfill({ status: 404, body: '' })
    if (url.pathname === '/api/weather') {
      requests.push(url.search)
      if (options.failed) url.searchParams.set('fixture', 'failed')
      return route.continue({ url: `http://127.0.0.1:4173${url.pathname}${url.search}` })
    }
    if (url.hostname.endsWith('tianditu.gov.cn')) return route.fulfill({ status: 204, body: '' })
    return route.continue()
  })
  return requests
}

async function openWeather(page: Page) {
  await page.goto('/')
  await page.getByRole('button', { name: '查看天气' }).click()
  await expect(page.getByRole('heading', { name: '天气', exact: true })).toBeVisible()
  await expect(page.locator('.weather-marker')).toBeVisible()
}

test('进入和退出天气保持地图视角，并恢复入口焦点', async ({ page }) => {
  await installFixtures(page)
  await page.goto('/')
  await expect(page.locator('.map-zoom-level')).toHaveText('Z 7.50')
  const before = await page.locator('.map-zoom-level').textContent()
  await page.getByRole('button', { name: '查看天气' }).click()
  await expect(page.getByText('Ctrl', { exact: true })).toBeVisible()
  await expect(page.getByText('左键单击可以按点选查询天气')).toBeVisible()
  await expect(page.locator('.weather-marker')).toHaveAccessibleName(/小雨.*26/)
  expect(await page.locator('.map-zoom-level').textContent()).toBe(before)
  await page.getByRole('button', { name: '退出天气查看' }).click()
  await expect(page.getByRole('heading', { name: '天气', exact: true })).toBeHidden()
  await expect(page.getByRole('button', { name: '查看天气' })).toBeFocused()
  expect(await page.locator('.map-zoom-level').textContent()).toBe(before)
})

test('成功响应展示预警详情和完整位置天气，两个浮窗互斥', async ({ page }) => {
  await installFixtures(page)
  await openWeather(page)
  await expect(page.getByText('1 个地区 / 1 条预警')).toBeVisible()
  await page.locator('.weather-marker').click()
  const popup = page.getByRole('dialog', { name: '位置天气详情' })
  await expect(popup).toContainText('浙江省行政中心附近')
  await expect(popup).toContainText('当前天气')
  await expect(popup).toContainText('未来两小时降水')
  await expect(popup).toContainText('未来 24 小时预报')
  await expect(popup.locator('.hour-strip article')).toHaveCount(24)
  await page.locator('.weather-panel .alert-chips button').click()
  const alert = page.getByRole('dialog', { name: '天气预警详情' })
  await expect(alert).toContainText('杭州市发布暴雨红色预警')
  await expect(alert).toContainText('预警说明')
  await expect(alert).toContainText('触发标准')
  await expect(alert).toContainText('防御指南')
  await expect(popup).toBeHidden()
})

test('Ctrl 点选仅刷新临时位置，Esc 恢复默认标记且不改变层级', async ({ page }) => {
  const requests = await installFixtures(page)
  await openWeather(page)
  await page.locator('.map').click({ position: { x: 500, y: 330 }, modifiers: ['Control'] })
  const popup = page.getByRole('dialog', { name: '位置天气详情' })
  await expect(popup).toContainText('杭州市西湖区测试点附近')
  await expect(popup).toContainText('地图点选位置')
  expect(requests.filter((query) => query.includes('target=picked'))).toHaveLength(1)
  expect(requests.filter((query) => query.includes('target=picked'))[0]).not.toContain('key=')
  await page.keyboard.press('Escape')
  await expect(popup).toBeHidden()
  await expect(page.getByText('当前范围：浙江省')).toBeVisible()
  await expect(page.locator('.weather-marker-wrap.picked')).toHaveCount(0)
  await expect(page.locator('.weather-marker-wrap.default')).toHaveCount(1)
})

test('部分失败在 520px 视口保留成功模块与可达重试/关闭操作', async ({ page }) => {
  await page.setViewportSize({ width: 500, height: 760 })
  await installFixtures(page, { failed: true })
  await openWeather(page)
  await expect(page.getByText('部分数据更新失败')).toBeVisible()
  await expect(page.getByText('数据获取失败')).toBeVisible()
  await page.locator('.weather-marker').click()
  const popup = page.getByRole('dialog', { name: '位置天气详情' })
  await expect(popup).toContainText('实时天气加载失败')
  await expect(popup).toContainText('未来两小时降水加载失败')
  await expect(popup).toContainText('未来 24 小时预报')
  const box = await popup.boundingBox()
  expect(box).not.toBeNull()
  expect(box!.x).toBeGreaterThanOrEqual(11)
  expect(box!.x + box!.width).toBeLessThanOrEqual(489)
  await expect(popup.getByRole('button', { name: '关闭天气浮窗' })).toBeVisible()
  await expect(page.getByRole('button', { name: '退出天气查看' })).toBeVisible()
})
