import { expect, test, type Page } from '@playwright/test'
import { cities, counties, province } from './fixtures'
import { INSURED_VILLAGE_CODES } from '../src/features/village-risk/villageRiskData'

/** 合成 13 参保村村界（330604102014 置于示例县中心以便下钻到村级；其余分布在周围）。 */
function makeVillageGeoJson(codes: string[]) {
  return {
    type: 'FeatureCollection',
    features: codes.map((code, index) => {
      const lon = 120.06 + (index % 4) * 0.12
      const lat = 29.06 + Math.floor(index / 4) * 0.12
      const geometry = code === '330604102014'
        ? { type: 'Polygon', coordinates: [[[120.2, 29.2], [120.3, 29.2], [120.3, 29.3], [120.2, 29.3], [120.2, 29.2]]] }
        : { type: 'Polygon', coordinates: [[[lon, lat], [lon + 0.02, lat], [lon + 0.02, lat + 0.02], [lon, lat + 0.02], [lon, lat]]] }
      return { type: 'Feature', properties: { code, name: `参保村${index + 1}` }, geometry }
    }),
  }
}

/** 县级下钻的乡镇 = 章镇镇（真实乡镇码 330604104000，与参保村乡镇文件匹配，验证乡镇级过滤）。 */
function makeZhangzhenTownship() {
  return {
    type: 'FeatureCollection',
    features: [{
      type: 'Feature',
      properties: { code: '330604104000', name: '章镇镇' },
      geometry: { type: 'Polygon', coordinates: [[[120.1, 29.1], [120.4, 29.1], [120.4, 29.4], [120.1, 29.4], [120.1, 29.1]]] },
    }],
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
    if (url.pathname === '/data/boundary/township/330101.geojson') return route.fulfill({ json: makeZhangzhenTownship() })
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

test('点击风险标记：下钻村级 + 右上面板显示该村风险详情；乡镇级过滤；退出清除', async ({ page }) => {
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

  // 乡镇级过滤：下钻章镇镇 → 仅 8 标记；返回县级恢复 13
  await page.locator('.map').click({ position: { x: 580, y: 420 } })
  await expect(page.locator('.crumb.active')).toHaveText('章镇镇')
  await expect(page.locator('.village-risk-marker-wrap')).toHaveCount(8)
  await page.locator('.crumb').filter({ hasText: '示例县' }).click()
  await expect(page.locator('.village-risk-marker-wrap')).toHaveCount(13)

  // 点击标记 → 下钻村级 + 右上面板显示该村详情（d1=60mm → 峰值 60 → 暴雨级 + 连阴雨 → 高风险）
  await page.locator('.village-risk-marker').first().click()
  await expect(page.locator('.crumb.active')).toHaveText('参保村1')
  await expect(page.locator('.village-risk-card')).toBeVisible()
  await expect(page.locator('.village-risk-card h2')).not.toBeEmpty()
  await expect(page.locator('.village-risk-card .risk-pill')).toHaveText('高风险')
  await expect(page.locator('.village-risk-card')).toContainText('高风险 · 8/10 暴雨 60mm')
  await expect(page.locator('.village-risk-card')).toContainText('连续 3 日累计')
  await expect(page.locator('.village-risk-card .measures li').first()).toBeVisible()
  await expect(page.locator('.village-risk-card')).toContainText('防灾措施')
  // 保单概况：仅保单结构
  await expect(page.locator('.village-risk-card')).toContainText('保单概况')
  await expect(page.locator('.village-risk-card')).toContainText('保单 5 · 大户保单')
  // 台风/预警未加载 → 降级行
  await expect(page.locator('.village-risk-card')).toContainText('台风数据暂不可用')
  await expect(page.locator('.village-risk-card')).toContainText('预警数据暂不可用')
  // 村级：风险标记消失（v3.9 无风险图层）
  await expect(page.locator('.village-risk-marker-wrap')).toHaveCount(0)
  await expect(page.locator('.village-risk-legend')).not.toBeVisible()

  // 点地图空白 → 关闭详情回列表
  await page.locator('.map').click({ position: { x: 40, y: 400 } })
  await expect(page.locator('.village-risk-card')).toHaveCount(0)

  // 退出降水 → 标记、色斑、面板与图例全部清除
  await page.locator('.precip-panel .close-button').click()
  await expect(page.locator('.village-risk-marker-wrap')).toHaveCount(0)
  await expect(page.locator('.village-risk-legend')).not.toBeVisible()
  await expect(page.locator('.disaster-workbench')).toHaveCount(0)
})

test('放大进入村级（不点标记）：右上面板自动显示当前村风险概况', async ({ page }) => {
  await installFixtures(page)
  await openPrecipitation(page)
  // 下钻县级 → 章镇镇
  await zoomStep(page, /Z 9\.5/)
  await page.locator('.map').click()
  await expect(page.locator('.map-zoom-level')).toHaveText('Z 11.25')
  await page.locator('.map').click({ position: { x: 580, y: 420 } })
  await expect(page.locator('.crumb.active')).toHaveText('章镇镇')
  // 滚轮放大至乡镇自动下钻阈值（ENTER_ZOOM.township=15.5）→ 进入村级（中心点=参保村1），不点任何标记
  await page.mouse.move(640, 360)
  for (let i = 0; i < 20; i++) {
    if ((await page.locator('.crumb.active').textContent()) === '参保村1') break
    await page.mouse.wheel(0, -120)
    await page.waitForTimeout(140)
  }
  await expect(page.locator('.crumb.active')).toHaveText('参保村1')
  // 右上面板自动展开并显示当前村风险概况
  await expect(page.locator('.disaster-workbench')).not.toHaveClass(/collapsed/)
  await expect(page.locator('.village-risk-card')).toBeVisible()
  await expect(page.locator('.village-risk-card h2')).toHaveText('参保村1')
  await expect(page.locator('.village-risk-card')).toContainText('风险依据')
  // 返回乡镇级 → 详情关闭回列表，面板展开
  await page.locator('.crumb').filter({ hasText: '章镇镇' }).click()
  await expect(page.locator('.village-risk-card')).toHaveCount(0)
  await expect(page.locator('.risk-overview')).toBeVisible()
})

test('降雨量共用面板风险 tab：统计/列表/下钻详情/村级收起/退出清除', async ({ page }) => {
  await installFixtures(page)
  await openPrecipitation(page)
  // 共用面板出现，风险 tab 激活（跟随模式）；单降水模式时 tab 栏仅风险概览
  await expect(page.locator('.disaster-workbench')).toBeVisible()
  await expect(page.locator('#dw-tab-risk')).toHaveAttribute('aria-selected', 'true')
  await expect(page.locator('#dw-tab-typhoon')).toHaveCount(0)
  await expect(page.locator('.tab-list button')).toHaveCount(1)
  // 受灾列表 13 行（等村界异步加载完成），行含峰值+敞口（真实保单 fixture 加载）
  await expect(page.locator('.village-row')).toHaveCount(13)
  await expect(page.locator('.village-row').first()).toContainText('暴雨')
  await expect(page.locator('.village-row').first()).toContainText('亩 · 保额')
  // 统计：d1=60 + 连阴雨 → 13 村全高风险
  await expect(page.locator('.risk-overview')).toContainText('13 村高风险')
  await expect(page.locator('.risk-overview')).toContainText('亩受影响参保')
  await expect(page.locator('.risk-overview')).toContainText('保额')
  // 空态不出现
  await expect(page.locator('.risk-overview')).not.toContainText('未来 7 天无高风险参保区域')
  // 点击列表行 → 下钻村级 + 右上面板展示该村风险详情（面板展开）
  await page.locator('.village-row').first().click()
  await expect(page.locator('.village-risk-card')).toBeVisible()
  await expect(page.locator('.crumb.active')).not.toHaveText('示例县')
  await expect(page.locator('.disaster-workbench')).not.toHaveClass(/collapsed/)
  await expect(page.locator('.risk-overview')).toHaveCount(0) // 列表被详情替换
  // 详情内容（依据首行/保单概况）在右上面板内
  await expect(page.locator('.village-risk-card')).toContainText('风险依据')
  await expect(page.locator('.village-risk-card')).toContainText('保单概况')
  // 关闭详情 → 回列表 + 村级默认收起为 tab 条
  await page.keyboard.press('Escape')
  await expect(page.locator('.village-risk-card')).toHaveCount(0)
  await expect(page.locator('.disaster-workbench')).toHaveClass(/collapsed/)
  // 展开面板 → 风险概览列表可见
  await page.locator('.collapse-button').click()
  await expect(page.locator('.disaster-workbench')).not.toHaveClass(/collapsed/)
  await expect(page.locator('.risk-overview')).toBeVisible()
  await expect(page.locator('.village-row').first()).toBeVisible()
  // 关闭卡片后退出降水 → 共用面板与风险 tab 清除
  await page.locator('.precip-panel .close-button').click()
  await expect(page.locator('.disaster-workbench')).toHaveCount(0)
})
