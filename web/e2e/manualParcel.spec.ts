import { expect, test, type Page } from '@playwright/test'
import { cities, counties, province, townships, villages } from './fixtures'

const VILLAGE_CODE = '330101001001'
const MANUAL_KEY = 'agri-map:manual-parcels:v1'

async function installFixtures(page: Page) {
  await page.route('**/*', async (route) => {
    const url = new URL(route.request().url())
    if (url.pathname === '/data/boundary/province.geojson') return route.fulfill({ json: province })
    if (url.pathname === '/data/boundary/city/330000.geojson') return route.fulfill({ json: cities })
    if (url.pathname === '/data/boundary/county/330100.geojson') return route.fulfill({ json: counties })
    if (url.pathname === '/data/boundary/township/330101.geojson') return route.fulfill({ json: townships })
    if (url.pathname === '/data/villages/330101001000.geojson') return route.fulfill({ json: villages })
    if (url.pathname === '/data/rs.json') return route.fulfill({ status: 404, body: '' })
    if (url.hostname.endsWith('tianditu.gov.cn')) return route.fulfill({ status: 204, body: '' })
    return route.continue()
  })
}

async function zoomStep(page: Page, zoomPattern: RegExp) {
  await page.mouse.move(640, 360)
  for (let i = 0; i < 30; i++) {
    const text = (await page.locator('.map-zoom-level').textContent()) ?? ''
    if (zoomPattern.test(text)) return
    await page.mouse.wheel(0, -120)
    await page.waitForTimeout(120)
  }
  throw new Error(`放大未达到 ${zoomPattern}`)
}

/** 下钻到示例村：省级 → 滚轮市级 → 点击县级 → 点击乡镇 → 滚轮村级。 */
async function drillToVillage(page: Page) {
  await zoomStep(page, /Z 9\.5/)
  await page.locator('.map').click({ position: { x: 640, y: 360 } })
  await expect(page.locator('.map-zoom-level')).toHaveText('Z 11.25')
  await expect(page.locator('.crumb.active')).toHaveText('示例县')
  await page.locator('.map').click({ position: { x: 640, y: 360 } })
  await expect(page.locator('.crumb.active')).toHaveText('示例乡')
  await page.mouse.move(640, 360)
  for (let i = 0; i < 20; i++) {
    if ((await page.locator('.crumb.active').textContent()) === '示例村') break
    await page.mouse.wheel(0, -120)
    await page.waitForTimeout(140)
  }
  await expect(page.locator('.crumb.active')).toHaveText('示例村')
}

test('手动画地块：村级进入绘制、点击顶点、保存后写入本机存储且工具退出', async ({ page }) => {
  await installFixtures(page)
  await page.goto('/')
  await expect(page.locator('.map-zoom-level')).toHaveText('Z 7.50')
  await drillToVillage(page)

  // 村级显示地块工具；进入新增 → 批量工具栏出现
  await page.getByRole('button', { name: '地块工具' }).click()
  await page.getByRole('button', { name: '新增地块' }).click()
  await expect(page.locator('.parcel-edit-toolbar')).toBeVisible()
  await expect(page.locator('.parcel-edit-toolbar')).toContainText('已绘制')

  // 绘制模式：4 个顶点围成四边形（示例村中心附近）
  await page.getByRole('button', { name: '绘制' }).click()
  for (const [x, y] of [[600, 320], [700, 340], [690, 400], [600, 400]] as const) {
    await page.locator('.map').click({ position: { x, y } })
  }
  // 按 N 闭合多边形 → 回到批量模式，地块待保存
  await page.keyboard.press('n')
  await expect(page.locator('.parcel-edit-toolbar')).toContainText('已绘制')
  await expect(page.locator('.parcel-edit-toolbar')).toContainText('已绘制1地块')

  // 保存：写本机存储、提示已保存、工具退出
  await page.getByRole('button', { name: '保存', exact: true }).click()
  await expect(page.getByText('已保存：新增 1 个，修改 0 个，移除 0 个')).toBeVisible()
  await expect(page.locator('.parcel-edit-toolbar')).toHaveCount(0)

  const stored = await page.evaluate((key) => {
    const raw = localStorage.getItem(key)
    return raw ? JSON.parse(raw) : null
  }, MANUAL_KEY)
  expect(stored).not.toBeNull()
  const features = stored.villages[VILLAGE_CODE]
  expect(features).toHaveLength(1)
  expect(features[0].properties.source).toBe('manual')
  expect(features[0].properties.village_code).toBe(VILLAGE_CODE)
  expect(features[0].geometry.type).toBe('Polygon')
})

test('底图切换：卫星/矢量互切且按钮态同步', async ({ page }) => {
  await installFixtures(page)
  await page.goto('/')
  const button = page.getByRole('button', { name: '底图：卫星（点击切换矢量）' })
  await expect(button).toBeVisible()
  await button.click()
  await expect(page.getByRole('button', { name: '底图：矢量（点击切换卫星）' })).toBeVisible()
  await page.getByRole('button', { name: '底图：矢量（点击切换卫星）' }).click()
  await expect(page.getByRole('button', { name: '底图：卫星（点击切换矢量）' })).toBeVisible()
})
