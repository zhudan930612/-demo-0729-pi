import { expect, test, type Page, type Route } from '@playwright/test'
import { province } from './fixtures'

async function installFixtures(page: Page) {
  await page.route('**/*', async (route) => {
    const url = new URL(route.request().url())
    if (url.pathname === '/data/boundary/province.geojson') return route.fulfill({ json: province })
    if (url.hostname.endsWith('tianditu.gov.cn')) return route.fulfill({ status: 204, body: '' })
    return route.continue()
  })
}

/** 拦截 OSM 两域名（注册在 catch-all 之后，Playwright 后注册优先命中），记录瓦片请求 URL，按 status 返回 204/503 */
async function interceptOsmTiles(page: Page, status: 204 | 503) {
  const osmRequests: string[] = []
  const topoRequests: string[] = []
  const respond = (route: Route) => route.fulfill({ status, body: '' })
  await page.route('https://tile.openstreetmap.org/**', async (route) => {
    osmRequests.push(route.request().url())
    await respond(route)
  })
  await page.route('https://tile.tracestrack.com/**', async (route) => {
    topoRequests.push(route.request().url())
    await respond(route)
  })
  return { osmRequests, topoRequests }
}

/** 读取地图中心/缩放（MapView 在 DEV 下暴露 window.__map，供自动化断言中心不变） */
async function mapState(page: Page) {
  return page.evaluate(() => {
    const map = (window as unknown as { __map?: { getCenter(): { lat: number; lng: number }; getZoom(): number } }).__map
    if (!map) throw new Error('window.__map 未暴露：MapView 需在 DEV 下运行')
    const center = map.getCenter()
    return { lat: center.lat, lng: center.lng, zoom: map.getZoom() }
  })
}

/** 悬浮当前底图按钮打开菜单（按钮 aria-label 随当前底图变化，如 '底图：卫星'） */
async function openBasemapMenu(page: Page, currentLabel: string) {
  // 等上一轮菜单完全关闭（leave 过渡结束后 v-if 才移除），避免新旧 radiogroup 同时在 DOM 中触发 strict 冲突
  await page.getByRole('radiogroup', { name: '选择底图' }).waitFor({ state: 'detached' })
  await page.getByRole('button', { name: currentLabel }).hover()
  const menu = page.getByRole('radiogroup', { name: '选择底图' })
  await expect(menu).toBeVisible()
  return menu
}

test('悬浮底图按钮后可选择矢量底图', async ({ page }) => {
  await installFixtures(page)
  await page.goto('/')

  const trigger = page.getByRole('button', { name: '底图：卫星' })
  await trigger.hover()

  const menu = page.getByRole('radiogroup', { name: '选择底图' })
  await expect(menu).toBeVisible()
  await expect(menu.getByRole('radio', { name: '卫星底图' })).toHaveAttribute('aria-checked', 'true')
  await menu.getByRole('radio', { name: '矢量底图' }).click()

  await expect(page.getByRole('button', { name: '底图：矢量' })).toBeVisible()
  await expect(menu).toBeHidden()
})

test('验收1.1: 底图菜单含 4 项且默认选中卫星底图', async ({ page }) => {
  await installFixtures(page)
  await page.goto('/')

  await openBasemapMenu(page, '底图：卫星')
  const menu = page.getByRole('radiogroup', { name: '选择底图' })
  await expect(menu.getByRole('radio')).toHaveCount(4)
  await expect(menu.getByRole('radio', { name: '卫星底图' })).toHaveAttribute('aria-checked', 'true')
  await expect(menu.getByRole('radio', { name: '矢量底图' })).toHaveAttribute('aria-checked', 'false')
  await expect(menu.getByRole('radio', { name: 'OSM 标准' })).toHaveAttribute('aria-checked', 'false')
  await expect(menu.getByRole('radio', { name: 'OSM 地貌' })).toHaveAttribute('aria-checked', 'false')
})

test('验收1.2: 选择 OSM 标准后请求 tile.openstreetmap.org 且中心/缩放不变、页面不刷新、重复点击无变化', async ({ page }) => {
  await installFixtures(page)
  const { osmRequests } = await interceptOsmTiles(page, 204)
  await page.goto('/')
  await expect(page.locator('.map-zoom-level')).toHaveText('Z 7.50')

  const before = await mapState(page)
  const navMarker = await page.evaluate(() => {
    const token = `marker-${Math.random()}`
    ;(window as unknown as Record<string, unknown>).__basemapNavMarker = token
    return token
  })

  const menu = await openBasemapMenu(page, '底图：卫星')
  await menu.getByRole('radio', { name: 'OSM 标准' }).click()

  await expect(page.getByRole('button', { name: '底图：OSM 标准' })).toBeVisible()
  await expect.poll(() => osmRequests.length).toBeGreaterThan(0)
  expect(osmRequests.every((url) => new URL(url).hostname === 'tile.openstreetmap.org')).toBe(true)

  expect(await mapState(page)).toEqual(before)
  expect(await page.evaluate(() => (window as unknown as Record<string, unknown>).__basemapNavMarker)).toBe(navMarker)

  // 重复点击当前已选中的 OSM 标准不产生任何变化（无新瓦片请求）
  await page.waitForTimeout(500)
  const countAfterSettle = osmRequests.length
  const menuAgain = await openBasemapMenu(page, '底图：OSM 标准')
  await menuAgain.getByRole('radio', { name: 'OSM 标准' }).click()
  await page.waitForTimeout(500)
  expect(osmRequests.length).toBe(countAfterSettle)
})

test('验收1.3: 选择 OSM 地貌后请求 tile.tracestrack.com 且中心/缩放不变', async ({ page }) => {
  await installFixtures(page)
  const { topoRequests } = await interceptOsmTiles(page, 204)
  await page.goto('/')
  await expect(page.locator('.map-zoom-level')).toHaveText('Z 7.50')

  const before = await mapState(page)
  const menu = await openBasemapMenu(page, '底图：卫星')
  await menu.getByRole('radio', { name: 'OSM 地貌' }).click()

  await expect(page.getByRole('button', { name: '底图：OSM 地貌' })).toBeVisible()
  await expect.poll(() => topoRequests.length).toBeGreaterThan(0)
  expect(topoRequests.every((url) => new URL(url).hostname === 'tile.tracestrack.com')).toBe(true)

  expect(await mapState(page)).toEqual(before)
})

test('验收1.4: OSM 底图显示正确版权标注，切回天地图后不残留 OSM 标注', async ({ page }) => {
  await installFixtures(page)
  await interceptOsmTiles(page, 204)
  await page.goto('/')

  const attribution = page.locator('.leaflet-control-attribution')
  await expect(attribution).toContainText('天地图')

  // OSM 标准标注
  const menu = await openBasemapMenu(page, '底图：卫星')
  await menu.getByRole('radio', { name: 'OSM 标准' }).click()
  await expect(page.getByRole('button', { name: '底图：OSM 标准' })).toBeVisible()
  await expect(attribution).toContainText('© OpenStreetMap')
  await expect(attribution.locator('a[href="https://www.openstreetmap.org/copyright"]')).toHaveAttribute('target', '_blank')
  await expect(attribution).not.toContainText('天地图')

  // OSM 地貌标注（与标准同一文案）
  const menuTopo = await openBasemapMenu(page, '底图：OSM 标准')
  await menuTopo.getByRole('radio', { name: 'OSM 地貌' }).click()
  await expect(attribution).toContainText('© OpenStreetMap')
  await expect(attribution.locator('a[href="https://www.openstreetmap.org/copyright"]')).toHaveAttribute('target', '_blank')

  // 切回天地图卫星：显示天地图标注，不残留 OSM 标注
  const menuBack = await openBasemapMenu(page, '底图：OSM 地貌')
  await menuBack.getByRole('radio', { name: '卫星底图' }).click()
  await expect(page.getByRole('button', { name: '底图：卫星' })).toBeVisible()
  await expect(attribution).toContainText('天地图')
  await expect(attribution).not.toContainText('OpenStreetMap')
  await expect(attribution).not.toContainText('Tracestrack')
})

test('验收1.5: OSM 瓦片加载失败(503)时地图不崩溃，切回天地图卫星后恢复正常', async ({ page }) => {
  await installFixtures(page)
  await interceptOsmTiles(page, 503)
  await page.goto('/')
  await expect(page.locator('.map-zoom-level')).toHaveText('Z 7.50')

  const before = await mapState(page)
  const menu = await openBasemapMenu(page, '底图：卫星')
  await menu.getByRole('radio', { name: 'OSM 标准' }).click()

  await expect(page.getByRole('button', { name: '底图：OSM 标准' })).toBeVisible()
  // 地图容器不崩溃、中心/缩放不变、缩放等级控件仍响应
  await expect(page.locator('.leaflet-container')).toBeVisible()
  await expect(page.locator('.map-zoom-level')).toHaveText('Z 7.50')
  expect(await mapState(page)).toEqual(before)

  // 切回天地图卫星后底图立即恢复（标注回显天地图）
  const menuBack = await openBasemapMenu(page, '底图：OSM 标准')
  await menuBack.getByRole('radio', { name: '卫星底图' }).click()
  await expect(page.getByRole('button', { name: '底图：卫星' })).toBeVisible()
  await expect(page.locator('.leaflet-control-attribution')).toContainText('天地图')
})
