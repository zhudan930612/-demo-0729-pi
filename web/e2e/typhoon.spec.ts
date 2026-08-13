import { expect, test, type Page } from '@playwright/test'
import { cities, counties, province, townships, villages } from './fixtures'

async function installFixtures(page: Page, options: { listFixture?: 'request-error' | 'empty' } = {}) {
  await page.route('**/*', async (route) => {
    const url = new URL(route.request().url())
    if (url.pathname === '/data/boundary/province.geojson') return route.fulfill({ json: province })
    if (url.pathname === '/data/boundary/city/330000.geojson') return route.fulfill({ json: cities })
    if (url.pathname === '/data/boundary/county/330100.geojson') return route.fulfill({ json: counties })
    if (url.pathname === '/data/boundary/township/330101.geojson') return route.fulfill({ json: townships })
    if (url.pathname === '/data/villages/330101001000.geojson') return route.fulfill({ json: villages })
    if (url.pathname === '/data/rs.json') return route.fulfill({ status: 404, body: '' })
    if (url.pathname === '/api/typhoons') {
      // 列表走 fixture-server；失败/空变体通过 fixture 参数选择
      if (options.listFixture) return route.continue({ url: `http://127.0.0.1:4173${url.pathname}?fixture=${options.listFixture}` })
      return route.continue()
    }
    if (url.hostname.endsWith('tianditu.gov.cn')) return route.fulfill({ status: 204, body: '' })
    return route.continue()
  })
}

async function openTyphoon(page: Page) {
  await page.goto('/')
  await expect(page.locator('.map-zoom-level')).toHaveText('Z 7.50')
  await page.locator('.typhoon-btn').click()
  await expect(page.locator('.disaster-workbench')).toBeVisible()
  await expect(page.locator('.typhoon-card')).toHaveCount(1)
}

test('进入台风：工作台台风 tab 激活、实时卡片展开带节点表、中心标记出现，视角 4.5', async ({ page }) => {
  await installFixtures(page)
  await openTyphoon(page)
  await expect(page.locator('.map-zoom-level')).toHaveText('Z 4.50')
  await expect(page.locator('#dw-tab-typhoon')).toHaveAttribute('aria-selected', 'true')
  // 无降水时无风险 tab
  await expect(page.locator('#dw-tab-risk')).toHaveCount(0)
  const card = page.locator('.typhoon-card')
  await expect(card).toHaveClass(/expanded/)
  await expect(card).toContainText('格美')
  await expect(card).toContainText('GAEMI')
  // 5 个实况节点，最新节点（08-04 08时）默认选中
  await expect(card.locator('.node-table-wrap tbody tr')).toHaveCount(5)
  await expect(card.locator('tbody tr').first().locator('.node-select')).toHaveAttribute('aria-current', 'true')
  await expect(card.locator('tbody tr').first()).toContainText('08月04日08时')
  await expect(page.locator('.typhoon-vortex-marker.is-live')).toHaveCount(1)
  await expect(page.locator('.typhoon-vortex-marker.is-live')).toHaveCount(1)
})

test('悬停台风中心显示详情浮窗，移开后消失', async ({ page }) => {
  await installFixtures(page)
  await openTyphoon(page)
  const center = page.locator('.typhoon-vortex-marker.is-live')
  await center.hover()
  const popup = page.locator('.typhoon-hover.center')
  await expect(popup).toBeVisible()
  await expect(popup).toContainText('格美')
  await expect(popup).toContainText('中心位置')
  await expect(popup).toContainText('风速风力')
  await expect(popup).toContainText('中心气压')
  await expect(popup).toContainText('移速移向')
  await page.mouse.move(0, 0)
  await expect(popup).toBeHidden()
})

test('时间轴打开历史台风：标签出现、点击后卡片展开并自动播放至末节点、可关闭', async ({ page }) => {
  await installFixtures(page)
  await openTyphoon(page)
  await page.getByRole('button', { name: '查看当年台风' }).click()
  const drawer = page.locator('#typhoon-history-timeline')
  await expect(drawer).toBeVisible()
  const label = drawer.locator('.timeline-label')
  await expect(label).toHaveCount(1)
  await expect(label).toHaveAttribute('aria-label', /艾云尼/)
  await label.click()
  const card = page.locator('.typhoon-card.historical')
  await expect(card).toHaveCount(1)
  await expect(card).toContainText('艾云尼')
  await expect(card.locator('tbody tr')).toHaveCount(4)
  // 播放从最早节点（表末行）逐点推进到最新节点（表首行），完成后停在最新节点
  await expect(card.locator('tbody tr').first()).toContainText('06月23日08时')
  await expect(card.locator('tbody tr').first().locator('.node-select')).toHaveAttribute('aria-current', 'true', { timeout: 10000 })
  await expect(page.locator('.typhoon-vortex-marker.is-history')).toHaveCount(1)
  // 关闭按钮 hover 才显示：先悬停卡片再点击
  await card.hover()
  await page.getByRole('button', { name: '关闭历史台风 艾云尼' }).click()
  await expect(page.locator('.typhoon-card.historical')).toHaveCount(0)
})

test('点击节点表行切换选中节点', async ({ page }) => {
  await installFixtures(page)
  await openTyphoon(page)
  const rows = page.locator('.typhoon-card tbody tr')
  await expect(rows).toHaveCount(5)
  await rows.nth(2).locator('.node-select').click()
  await expect(rows.nth(2).locator('.node-select')).toHaveAttribute('aria-current', 'true')
  await expect(rows.first().locator('.node-select')).not.toHaveAttribute('aria-current', 'true')
})

test('退出台风：面板、标记、历史抽屉清除，视角恢复省视图', async ({ page }) => {
  await installFixtures(page)
  await openTyphoon(page)
  await page.getByRole('button', { name: '查看当年台风' }).click()
  await page.locator('#typhoon-history-timeline .timeline-label').click()
  await expect(page.locator('.typhoon-card.historical')).toHaveCount(1)
  await page.getByRole('button', { name: '关闭台风路径并退出灾害风险模式' }).click()
  await expect(page.locator('.disaster-workbench')).toHaveCount(0)
  await expect(page.locator('.typhoon-card')).toHaveCount(0)
  await expect(page.locator('.typhoon-vortex-marker')).toHaveCount(0)
  await expect(page.locator('#typhoon-history-timeline')).toBeHidden()
  await expect(page.locator('.map-zoom-level')).toHaveText('Z 7.50')
})

test('台风列表加载失败：显示加载异常且不伪装空数据', async ({ page }) => {
  await installFixtures(page, { listFixture: 'request-error' })
  await page.goto('/')
  await page.locator('.typhoon-btn').click()
  await expect(page.locator('.disaster-workbench')).toBeVisible()
  await expect(page.locator('.transient-status.error')).toHaveText('台风数据加载异常')
  await expect(page.locator('.typhoon-card')).toHaveCount(0)
  await expect(page.locator('.typhoon-vortex-marker')).toHaveCount(0)
})

test('台风与天气互斥：天气激活时台风入口禁用，反之亦然', async ({ page }) => {
  await installFixtures(page)
  await page.goto('/')
  // 先开实时天气 → 台风按钮禁用
  await page.getByRole('button', { name: '查看天气' }).click()
  await page.getByRole('button', { name: '实时天气' }).click()
  await expect(page.locator('.weather-marker-wrap.seat')).toHaveCount(11)
  await expect(page.locator('.typhoon-btn')).toBeDisabled()
  // 退出天气 → 进台风 → 天气按钮禁用并提示
  await page.getByRole('button', { name: '当前：实时天气，点击菜单项可退出' }).click()
  await page.getByRole('button', { name: '实时天气', exact: true }).click()
  await expect(page.locator('.weather-marker-wrap.seat')).toHaveCount(0)
  await page.locator('.typhoon-btn').click()
  await expect(page.locator('.disaster-workbench')).toBeVisible()
  await expect(page.getByRole('button', { name: '请先退出台风查看' })).toBeDisabled()
})
