import { expect, test, type Page } from '@playwright/test'
import { cities, counties, province, townships } from './fixtures'
import { INSURED_VILLAGE_CODES } from '../src/features/village-risk/villageRiskData'

/** 合成 13 参保村村界（分布在示例县范围内，与 0.25° 网格点相邻以便覆盖判定）。 */
function makeVillageGeoJson(codes: string[]) {
  return {
    type: 'FeatureCollection',
    features: codes.map((code, index) => {
      const lon = 120.06 + (index % 4) * 0.12
      const lat = 29.06 + Math.floor(index / 4) * 0.12
      return {
        type: 'Feature',
        properties: { code, name: `参保村${index + 1}` },
        geometry: { type: 'Polygon', coordinates: [[[lon, lat], [lon + 0.02, lat], [lon + 0.02, lat + 0.02], [lon, lat + 0.02], [lon, lat]]] },
      }
    }),
  }
}

function precipSnapshot() {
  const grid: Array<Record<string, unknown>> = []
  for (let lat = 27.0; lat <= 31.5 + 1e-9; lat += 0.25) {
    for (let lon = 118.0; lon <= 123.0 + 1e-9; lon += 0.25) {
      grid.push({ lat: Math.round(lat * 1000) / 1000, lon: Math.round(lon * 1000) / 1000, values: { d1: 60, d2: 15, d3: 8, d4: 3, d5: 0.5, d6: 0, d7: 60 } })
    }
  }
  return {
    grid, days: ['2026-08-10', '2026-08-11', '2026-08-12', '2026-08-13', '2026-08-14', '2026-08-15', '2026-08-16'],
    coveredDays: 7, model: 'ECMWF IFS 0.25°', updatedAt: '2026-08-10 08:12:00+08:00', aggregateFrom: '2026-08-10 09:00:00+08:00',
  }
}

async function installFixtures(page: Page) {
  await page.route('**/*', async (route) => {
    const url = new URL(route.request().url())
    if (url.pathname === '/data/boundary/province.geojson') return route.fulfill({ json: province })
    if (url.pathname === '/data/boundary/city/330000.geojson') return route.fulfill({ json: cities })
    if (url.pathname === '/data/boundary/county/330100.geojson') return route.fulfill({ json: counties })
    if (url.pathname === '/data/boundary/township/330101.geojson') return route.fulfill({ json: townships })
    if (url.pathname === '/data/villages/330604104000.geojson') {
      return route.fulfill({ json: makeVillageGeoJson(INSURED_VILLAGE_CODES.filter((c) => c.startsWith('330604102'))) })
    }
    if (url.pathname === '/data/villages/330683104000.geojson') {
      return route.fulfill({ json: makeVillageGeoJson(INSURED_VILLAGE_CODES.filter((c) => c.startsWith('330683104'))) })
    }
    if (url.pathname === '/data/rs.json') return route.fulfill({ status: 404, body: '' })
    if (url.pathname === '/api/precipitation-grid') return route.fulfill({ status: 200, json: precipSnapshot() })
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

async function openPrecipitation(page: Page) {
  await page.goto('/')
  await page.waitForSelector('.weather-btn:not([disabled])')
  await page.click('.weather-btn')
  await page.click('#weather-tool-menu button:has-text("降雨量")')
  await page.waitForSelector('.precip-panel')
}

test('进入降水下钻县级：13 参保村标记 + 图例；点击村开风险卡片；再点/点空白关闭；退出清除', async ({ page }) => {
  await installFixtures(page)
  await openPrecipitation(page)
  // 下钻县级（示例县中心 = 省中心）
  await zoomStep(page, /Z 9\.5/)
  await page.locator('.map').click()
  await expect(page.locator('.map-zoom-level')).toHaveText('Z 11.25')

  // 13 参保村标记 + 图例（乡镇级及以上）
  await expect(page.locator('.village-risk-marker-wrap')).toHaveCount(13)
  await expect(page.locator('.village-risk-legend')).toBeVisible()
  await expect(page.locator('.village-risk-legend')).toContainText('未参保村不标注')

  // 点击标记 → 风险卡片（d1=60mm → 峰值 60 → 暴雨级 + 连阴雨 → 高风险）
  await page.locator('.village-risk-marker').first().click()
  await expect(page.locator('.village-risk-card')).toBeVisible()
  await expect(page.locator('.village-risk-card h2')).not.toBeEmpty()
  await expect(page.locator('.village-risk-card .risk-pill')).toHaveText('高风险')
  await expect(page.locator('.village-risk-card')).toContainText('7 天峰值')
  await expect(page.locator('.village-risk-card .measures li').first()).toBeVisible()
  await expect(page.locator('.village-risk-card')).toContainText('防灾措施')
  // 台风/预警未加载 → 降级行
  await expect(page.locator('.village-risk-card')).toContainText('台风数据暂不可用')
  await expect(page.locator('.village-risk-card')).toContainText('预警数据暂不可用')

  // 再点同一标记 → 收起
  await page.locator('.village-risk-marker').first().click()
  await expect(page.locator('.village-risk-card')).toHaveCount(0)

  // 打开后点地图空白 → 关闭
  await page.locator('.village-risk-marker').first().click()
  await expect(page.locator('.village-risk-card')).toBeVisible()
  await page.locator('.map').click({ position: { x: 40, y: 400 } })
  await expect(page.locator('.village-risk-card')).toHaveCount(0)

  // 退出降水 → 标记与图例清除
  await page.locator('.precip-panel .close-button').click()
  await expect(page.locator('.village-risk-marker-wrap')).toHaveCount(0)
  await expect(page.locator('.village-risk-legend')).not.toBeVisible()
})
