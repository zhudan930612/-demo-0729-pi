import { expect, test, type Page, type Route } from '@playwright/test'
import { cities, counties, province, townships, villages } from './fixtures'

// 独立补充验收（不修改已有测试）：覆盖清单未覆盖的行为侧面与异常/边界路径。
// 依据：docs/requirements/OSM底图接入-V1验收清单.md 1.6 及 R1 覆盖度反向核对缺口。

async function installFixtures(page: Page) {
  await page.route('**/*', async (route) => {
    const url = new URL(route.request().url())
    if (url.pathname === '/data/boundary/province.geojson') return route.fulfill({ json: province })
    if (url.pathname === '/data/boundary/city/330000.geojson') return route.fulfill({ json: cities })
    if (url.pathname === '/data/boundary/county/330100.geojson') return route.fulfill({ json: counties })
    if (url.pathname === '/data/boundary/township/330101.geojson') return route.fulfill({ json: townships })
    if (url.pathname === '/data/villages/330101001000.geojson') return route.fulfill({ json: villages })
    // 高分影像覆盖信息：bounds 覆盖示例村（中心约 120.25,29.25），minZoom 取低值避免下钻被强制抬升
    if (url.pathname === '/data/rs.json') return route.fulfill({ json: { bounds: [120.0, 29.0, 120.5, 29.5], minZoom: 8, maxZoom: 19 } })
    if (url.pathname.startsWith('/tiles/rs/')) return route.fulfill({ status: 204, body: '' })
    if (url.hostname.endsWith('tianditu.gov.cn')) return route.fulfill({ status: 204, body: '' })
    return route.continue()
  })
}

async function interceptOsmTiles(page: Page, status: 204 | 503) {
  const osmRequests: string[] = []
  const topoRequests: string[] = []
  const respond = (route: Route) => route.fulfill({ status, body: '' })
  await page.route('https://tile.openstreetmap.org/**', async (route) => {
    osmRequests.push(route.request().url())
    await respond(route)
  })
  await page.route('https://tile.opentopomap.org/**', async (route) => {
    topoRequests.push(route.request().url())
    await respond(route)
  })
  return { osmRequests, topoRequests }
}

async function mapState(page: Page) {
  return page.evaluate(() => {
    const map = (window as unknown as { __map?: { getCenter(): { lat: number; lng: number }; getZoom(): number } }).__map
    if (!map) throw new Error('window.__map 未暴露')
    const center = map.getCenter()
    return { lat: center.lat, lng: center.lng, zoom: map.getZoom() }
  })
}

async function openBasemapMenu(page: Page, currentLabel: string) {
  await page.getByRole('radiogroup', { name: '选择底图' }).waitFor({ state: 'detached' })
  await page.getByRole('button', { name: currentLabel }).hover()
  const menu = page.getByRole('radiogroup', { name: '选择底图' })
  await expect(menu).toBeVisible()
  return menu
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

test('验收1.6 补充: 切换 OSM 底图不重置高分影像开关、层级/地块工具不受影响，切回恢复', async ({ page }) => {
  await installFixtures(page)
  await interceptOsmTiles(page, 204)
  await page.goto('/')
  await expect(page.locator('.map-zoom-level')).toHaveText('Z 7.50')
  await drillToVillage(page)

  // 村级：高分影像开关可见且默认开启
  const rsOnToggle = page.getByRole('button', { name: '关闭高分影像' })
  await expect(rsOnToggle).toBeVisible()
  // 关闭高分影像，制造一个非默认开关状态
  await rsOnToggle.click()
  await expect(page.getByRole('button', { name: '打开高分影像' })).toBeVisible()

  // 地块工具按钮在村级可见（交互入口不受底图切换影响）
  await expect(page.getByRole('button', { name: '地块工具' })).toBeVisible()
  const before = await mapState(page)
  const crumbBefore = await page.locator('.crumb').count()

  // 切换 OSM 标准
  const menu = await openBasemapMenu(page, '底图：卫星')
  await menu.getByRole('radio', { name: 'OSM 标准' }).click()
  await expect(page.getByRole('button', { name: '底图：OSM 标准' })).toBeVisible()

  // 高分影像仍保持关闭（未被重置为开启）
  await expect(page.getByRole('button', { name: '打开高分影像' })).toBeVisible()
  // 地块工具入口仍在
  await expect(page.getByRole('button', { name: '地块工具' })).toBeVisible()
  // 行政层级面包屑不丢、地图不崩溃
  await expect(page.locator('.crumb.active')).toHaveText('示例村')
  await expect(page.locator('.crumb')).toHaveCount(crumbBefore)
  await expect(page.locator('.leaflet-container')).toBeVisible()
  // 中心/缩放不变
  expect(await mapState(page)).toEqual(before)

  // 切回天地图卫星：一切恢复，高分影像开关仍保持关闭（不重置）
  const menuBack = await openBasemapMenu(page, '底图：OSM 标准')
  await menuBack.getByRole('radio', { name: '卫星底图' }).click()
  await expect(page.getByRole('button', { name: '底图：卫星' })).toBeVisible()
  await expect(page.getByRole('button', { name: '打开高分影像' })).toBeVisible()
  await expect(page.getByRole('button', { name: '地块工具' })).toBeVisible()
  await expect(page.locator('.crumb.active')).toHaveText('示例村')
  await expect(page.locator('.leaflet-control-attribution')).toContainText('天地图')
})

test('补充: OSM 瓦片请求 URL 不含 token/凭据（免 token）', async ({ page }) => {
  await installFixtures(page)
  const { osmRequests, topoRequests } = await interceptOsmTiles(page, 204)
  await page.goto('/')

  const menu = await openBasemapMenu(page, '底图：卫星')
  await menu.getByRole('radio', { name: 'OSM 标准' }).click()
  await expect.poll(() => osmRequests.length).toBeGreaterThan(0)

  const menu2 = await openBasemapMenu(page, '底图：OSM 标准')
  await menu2.getByRole('radio', { name: 'OSM 地貌' }).click()
  await expect.poll(() => topoRequests.length).toBeGreaterThan(0)

  const all = [...osmRequests, ...topoRequests]
  expect(all.length).toBeGreaterThan(0)
  for (const u of all) {
    const url = new URL(u)
    expect(url.username, `不应带用户名: ${u}`).toBe('')
    expect(url.password, `不应带密码: ${u}`).toBe('')
    expect(url.searchParams.get('tk'), `不应带天地图 token: ${u}`).toBeNull()
    expect(url.searchParams.get('token'), `不应带 token: ${u}`).toBeNull()
    expect(url.searchParams.get('key'), `不应带 key: ${u}`).toBeNull()
  }
})

test('补充: 键盘可达性 — 焦点进入底图按钮打开菜单，Tab 移动、Enter 选择 OSM 标准', async ({ page }) => {
  await installFixtures(page)
  const { osmRequests } = await interceptOsmTiles(page, 204)
  await page.goto('/')

  const trigger = page.getByRole('button', { name: '底图：卫星' })
  await trigger.focus()
  await expect(page.getByRole('radiogroup', { name: '选择底图' })).toBeVisible()

  // Tab 依次：卫星底图 → 矢量底图 → OSM 标准
  await page.keyboard.press('Tab')
  await page.keyboard.press('Tab')
  await page.keyboard.press('Tab')
  await expect(page.getByRole('radio', { name: 'OSM 标准' })).toBeFocused()
  await page.keyboard.press('Enter')

  await expect(page.getByRole('button', { name: '底图：OSM 标准' })).toBeVisible()
  await expect.poll(() => osmRequests.length).toBeGreaterThan(0)
})

test('补充: 重复点击已选中的 OSM 地貌不产生新瓦片请求（清单 1.3 备注同 1.2）', async ({ page }) => {
  await installFixtures(page)
  const { topoRequests } = await interceptOsmTiles(page, 204)
  await page.goto('/')

  const menu = await openBasemapMenu(page, '底图：卫星')
  await menu.getByRole('radio', { name: 'OSM 地貌' }).click()
  await expect(page.getByRole('button', { name: '底图：OSM 地貌' })).toBeVisible()
  await expect.poll(() => topoRequests.length).toBeGreaterThan(0)

  await page.waitForTimeout(500)
  const settled = topoRequests.length
  const menuAgain = await openBasemapMenu(page, '底图：OSM 地貌')
  await menuAgain.getByRole('radio', { name: 'OSM 地貌' }).click()
  await page.waitForTimeout(500)
  expect(topoRequests.length).toBe(settled)
})
