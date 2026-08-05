import { expect, test, type Page } from '@playwright/test'
import { cities, counties, province, townships, villages } from './fixtures'

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

/** 滚轮逐级放大直到缩放级匹配 zoomPattern（每步 wheel(-120) ≈ +0.5 级）。 */
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

test('点击县下钻后缓慢放大不退回市级：下钻视野抬升到退出区之上', async ({ page }) => {
  await installFixtures(page)
  await page.goto('/')
  // 初始省级视野（示例县中心 = 省中心，位于屏幕中心）
  await expect(page.locator('.map-zoom-level')).toHaveText('Z 7.50')
  // 放大进入市级
  await zoomStep(page, /Z 9\.5/)
  await expect(page.locator('.map-zoom-level')).toHaveText('Z 9.50')
  // 点击地图中心（= 示例县中心）下钻县级
  await page.locator('.map').click()
  // 修复: 示例县在 1280x720 视口下 fitBounds 目标约 Z 10.75, 低于县级退出阈值 11.0;
  // 下钻后必须抬升到退出阈值之上, 否则随后的缩放会被误判为退回市级。
  await expect(page.locator('.map-zoom-level')).toHaveText('Z 11.25')
  // 缓慢放大(每次 0.25 级): 修复前 10.75→11.0 即被误判为"缩小退回"并回到市级
  for (const expectZoom of ['11.50', '11.75', '12.00']) {
    await page.mouse.wheel(0, -30)
    await expect(page.locator('.map-zoom-level')).toHaveText(`Z ${expectZoom}`)
  }
})

test('点击县下钻后缩小到退出阈值退回市级，且可再次下钻', async ({ page }) => {
  await installFixtures(page)
  await page.goto('/')
  await expect(page.locator('.map-zoom-level')).toHaveText('Z 7.50')
  await zoomStep(page, /Z 9\.5/)
  await page.locator('.map').click()
  await expect(page.locator('.map-zoom-level')).toHaveText('Z 11.25')
  // 11.25 -> 11.0(缩小到县级退出阈值 11.0): 缩小退回市级, 视野不重排故 zoom 停在 11.0
  await page.mouse.wheel(0, 30)
  await expect(page.locator('.map-zoom-level')).toHaveText('Z 11.00')
  // 已在市级(子层=县级边界): 点击中心再次下钻县级应回 Z 11.25;
  // 若仍在县级(退回未生效), 点击会命中乡镇子层并抬升到 Z 13.25
  await page.locator('.map').click()
  await expect(page.locator('.map-zoom-level')).toHaveText('Z 11.25')
})
