import { expect, test, type Page } from '@playwright/test'
import { cities, counties, province, townships, villages } from './fixtures'

const CITY_MARKERS = [
  { code: '330100', name: '杭州市', lat: 29.25, lon: 120.25 },
  { code: '330200', name: '宁波市', lat: 29.87, lon: 121.55 },
  { code: '330300', name: '温州市', lat: 28.0, lon: 120.7 },
  { code: '330400', name: '嘉兴市', lat: 30.75, lon: 120.75 },
  { code: '330500', name: '湖州市', lat: 30.87, lon: 120.1 },
  { code: '330600', name: '绍兴市', lat: 30.0, lon: 120.58 },
  { code: '330700', name: '金华市', lat: 29.08, lon: 119.65 },
  { code: '330800', name: '衢州市', lat: 28.94, lon: 118.87 },
  { code: '330900', name: '舟山市', lat: 29.98, lon: 122.2 },
  { code: '331000', name: '台州市', lat: 28.66, lon: 121.42 },
  { code: '331100', name: '丽水市', lat: 28.45, lon: 119.92 },
]

async function installFixtures(page: Page, options: { markerFixture?: 'failed' | 'request-error'; seatAddressUnavailable?: boolean } = {}) {
  const requests: string[] = []
  await page.route('**/*', async (route) => {
    const url = new URL(route.request().url())
    if (url.pathname === '/data/boundary/province.geojson') return route.fulfill({ json: province })
    if (url.pathname === '/data/boundary/city/330000.geojson') return route.fulfill({ json: cities })
    if (url.pathname === '/data/boundary/county/330100.geojson') return route.fulfill({ json: counties })
    if (url.pathname === '/data/boundary/township/330101.geojson') return route.fulfill({ json: townships })
    if (url.pathname === '/data/villages/330101001000.geojson') return route.fulfill({ json: villages })
    if (url.pathname === '/data/rs.json') return route.fulfill({ status: 404, body: '' })
    if (url.pathname === '/api/weather') {
      requests.push(url.search)
      const target = url.searchParams.get('target')
      if (target === 'seat') {
        if (options.seatAddressUnavailable) return route.fulfill({ status: 200, json: { ...seatBundle(), address: { status: 'error', error: { code: 'ADDRESS_UNAVAILABLE', message: '地址增强未配置' } } } })
        return route.fulfill({ status: 200, json: seatBundle() })
      }
      if (options.markerFixture === 'request-error') return route.fulfill({ status: 503, json: { error: { code: 'WEATHER_SERVICE_BUSY', message: '天气服务繁忙' } } })
      return route.continue({ url: `http://127.0.0.1:4173${url.pathname}${url.search}` })
    }
    if (url.pathname === '/api/weather/markers') {
      requests.push(`markers:${url.search}`)
      if (options.markerFixture === 'request-error') return route.fulfill({ status: 503, json: { error: { code: 'WEATHER_SERVICE_BUSY', message: '天气服务繁忙' } } })
      if (options.markerFixture === 'failed') {
        const targets = url.searchParams.get('contextLevel') === 'province' ? CITY_MARKERS.map((m) => ({ code: m.code, level: 'city', name: m.name, location: { lat: m.lat, lon: m.lon } })) : [{ code: '330101', level: 'county', name: '示例县', location: { lat: 29.25, lon: 120.25 } }]
        const lines = [{ type: 'targets', contextLevel: url.searchParams.get('contextLevel'), contextCode: url.searchParams.get('contextCode'), total: targets.length, targets }]
        targets.forEach((target, index) => {
          if (index === 0) lines.push({ type: 'error', code: target.code, error: { code: 'WEATHER_UPSTREAM_TIMEOUT', message: '上游超时' } })
          else lines.push({ type: 'ready', code: target.code, summary: markerSummary(index) })
        })
        return route.fulfill({ status: 200, contentType: 'application/x-ndjson', body: lines.map((line) => `${JSON.stringify(line)}\n`).join('') })
      }
      return route.continue({ url: `http://127.0.0.1:4173${url.pathname}${url.search}` })
    }
    if (url.hostname.endsWith('tianditu.gov.cn')) return route.fulfill({ status: 204, body: '' })
    return route.continue()
  })
  return requests
}

function seatBundle() {
  return {
    contextLevel: 'county', contextCode: '330101', target: 'seat',
    location: { lat: 29.25, lon: 120.25 },
    originalLocation: { lat: 29.25, lon: 120.25 },
    fetchedAt: '2026-08-03T12:00:00+08:00',
    address: { status: 'success', data: { address: '浙江省杭州市示例县', hctype: 1, jd: null }, fetchedAt: '2026-08-03T12:00:00+08:00' },
    current: { status: 'success', data: { condition: { code: '305', text: '小雨' }, temperature: { value: 26, unit: '°C' }, feelsLike: { value: 28, unit: '°C' }, precipitation: { amount: { value: 1.2, unit: 'mm' }, intensity: { value: 0.8, unit: 'mm/h' }, type: 'rain' }, humidity: 0.86 }, fetchedAt: '2026-08-03T12:00:00+08:00' },
    alerts: { status: 'success', data: [] },
    minutely: { status: 'success', data: { updateTime: '2026-08-03T12:00:00+08:00', summary: '20分钟后降雨逐渐增强', minutely: [], refer: { sources: ['QWeather fixture'], license: ['测试数据'] } }, fetchedAt: '2026-08-03T12:00:00+08:00' },
    hourly: { status: 'success', data: Array.from({ length: 24 }, (_, index) => ({ forecastTime: new Date(Date.parse('2026-08-03T03:00:00Z') + index * 3_600_000).toISOString(), condition: { code: index % 3 === 0 ? '305' : '100', text: index % 3 === 0 ? '小雨' : '晴' }, temperature: { value: 26 + (index % 4), unit: '°C' }, precipitation: { probability: 0.1, amount: { value: 0, unit: 'mm' } } })), fetchedAt: '2026-08-03T12:00:00+08:00' },
    attributions: [],
  }
}

function markerSummary(index: number) {
  const rain = index % 2 === 0
  return { condition: { code: rain ? '305' : '100', text: rain ? '小雨' : '晴' }, temperature: { value: 26, unit: '°C' }, high: { value: 29, unit: '°C' }, low: { value: 26, unit: '°C' }, fetchedAt: '2026-08-03T12:00:00+08:00' }
}

async function openWeather(page: Page) {
  await page.goto('/')
  await page.getByRole('button', { name: '查看天气' }).click()
  await page.getByRole('button', { name: '实时天气' }).click()
  await expect(page.locator('.weather-marker').first()).toBeVisible()
  await expect(page.locator('.weather-marker-wrap.loading')).toHaveCount(0)
}

/** 滚轮缩放触发自动下钻（pendingNoFly 不动相机，中心始终落在嵌套多边形内）。 */
async function zoomDrill(page: Page, zoomPattern: RegExp) {
  await page.mouse.move(640, 360)
  for (let i = 0; i < 30; i++) {
    const text = (await page.locator('.map-zoom-level').textContent()) ?? ''
    if (zoomPattern.test(text)) return
    await page.mouse.wheel(0, -120)
    await page.waitForTimeout(120)
  }
  throw new Error(`滚轮下钻未达到 ${zoomPattern}`)
}

test('进入和退出天气保持地图视角：省级展示 11 个市级标牌并恢复入口焦点', async ({ page }) => {
  await installFixtures(page)
  await page.goto('/')
  await expect(page.locator('.map-zoom-level')).toHaveText('Z 7.50')
  const before = await page.locator('.map-zoom-level').textContent()
  await page.getByRole('button', { name: '查看天气' }).click()
  await page.getByRole('button', { name: '实时天气' }).click()
  await expect(page.getByText('Ctrl', { exact: true })).toBeHidden()
  await expect(page.getByText('左键单击可以按点选查询天气')).toBeHidden()
  const seatMarkers = page.locator('.weather-marker-wrap.seat')
  await expect(seatMarkers).toHaveCount(11)
  const hangzhou = seatMarkers.filter({ hasText: '杭州市' })
  await expect(hangzhou.locator('.weather-marker')).toHaveAccessibleName(/杭州市.*小雨.*最高29.*最低26/)
  await expect(hangzhou.locator('.weather-marker-detail b')).toHaveText('杭州市')
  await expect(hangzhou.locator('.weather-marker-detail strong')).toHaveText('29/26°C')
  expect(await page.locator('.map-zoom-level').textContent()).toBe(before)
  await page.getByRole('button', { name: '当前：实时天气，点击切换' }).click()
  await page.getByRole('button', { name: '气象预警' }).click()
  await expect(page.getByRole('heading', { name: '气象预警', exact: true })).toBeVisible()
  await page.getByRole('button', { name: '关闭浙江预警' }).click()
  await expect(page.getByRole('heading', { name: '气象预警', exact: true })).toBeHidden()
  await expect(page.getByRole('button', { name: '查看天气' })).toBeFocused()
  expect(await page.locator('.map-zoom-level').textContent()).toBe(before)
})

test('点击市级标牌打开完整详情：不导航、浮窗跟随、空白与 Esc 关闭', async ({ page }) => {
  await installFixtures(page)
  await openWeather(page)
  const seatMarkers = page.locator('.weather-marker-wrap.seat')
  await expect(seatMarkers).toHaveCount(11)
  const before = await page.locator('.map-zoom-level').textContent()
  await seatMarkers.filter({ hasText: '杭州市' }).locator('.weather-marker').click()
  const popup = page.getByRole('dialog', { name: '位置天气详情' })
  await expect(popup.locator('header strong')).toHaveText('实时天气')
  await expect(popup.locator('.query-context')).toHaveText('浙江省杭州市示例县')
  await expect(popup).toContainText('当前天气')
  await expect(popup).toContainText('未来两小时降水')
  await expect(popup).toContainText('未来 24 小时预报')
  await expect(popup.locator('.hour-strip article')).toHaveCount(24)
  expect(await page.locator('.map-zoom-level').textContent()).toBe(before)
  await expect(page.getByRole('button', { name: '当前：实时天气，点击切换' })).toBeVisible()
  await expect(seatMarkers).toHaveCount(11)
  const popupBeforeMove = await popup.boundingBox()
  await page.locator('.map').dragTo(page.locator('.map'), { sourcePosition: { x: 420, y: 340 }, targetPosition: { x: 490, y: 340 } })
  await expect.poll(async () => {
    const moved = await popup.boundingBox()
    return Boolean(popupBeforeMove && moved && Math.abs(moved.x - popupBeforeMove.x) > 2)
  }).toBe(true)
  await page.locator('.map').click({ position: { x: 40, y: 680 } })
  await expect(popup).toBeHidden()
  await expect(seatMarkers).toHaveCount(11)
  await seatMarkers.filter({ hasText: '杭州市' }).locator('.weather-marker').click()
  await expect(popup).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(popup).toBeHidden()
  await expect(seatMarkers).toHaveCount(11)
})

test('地址增强失败时标牌详情按标牌自身完整行政路径降级且不泄露坐标', async ({ page }) => {
  await installFixtures(page, { seatAddressUnavailable: true })
  await openWeather(page)
  await page.locator('.weather-marker-wrap.seat').filter({ hasText: '杭州市' }).locator('.weather-marker').click()
  const popup = page.getByRole('dialog', { name: '位置天气详情' })
  await expect(popup.locator('header strong')).toHaveText('实时天气')
  await expect(popup.locator('.query-context')).toHaveText('浙江省 · 杭州市')
  await expect(popup.locator('.query-context')).not.toContainText(/°[NE]|\d+\.\d{2}/)
})

test('市级只显示区县标牌；县级密集乡镇标牌无重叠且可点击', async ({ page }) => {
  await installFixtures(page)
  await openWeather(page)
  await expect(page.locator('.weather-marker-wrap.seat')).toHaveCount(11)
  // 滚轮放大 -> 自动下钻市级（杭州中心位于初始视野中心，pendingNoFly 不移动相机）
  await zoomDrill(page, /Z 9\.5/)
  await expect(page.locator('.weather-marker-wrap.seat')).toHaveCount(1)
  await expect(page.locator('.weather-marker-wrap.seat').locator('.weather-marker-detail b')).toHaveText('示例县')
  await zoomDrill(page, /Z 11\.5/)
  const townships = page.locator('.weather-marker-wrap.seat')
  await expect(townships).toHaveCount(6)
  const boxes = await townships.locator('.weather-marker').evaluateAll((elements) => elements.map((element) => {
    const rect = element.getBoundingClientRect()
    return { x: rect.x, y: rect.y, right: rect.right, bottom: rect.bottom }
  }))
  for (let i = 0; i < boxes.length; i++) {
    for (let j = i + 1; j < boxes.length; j++) {
      const overlap = boxes[i]!.x < boxes[j]!.right && boxes[i]!.right > boxes[j]!.x && boxes[i]!.y < boxes[j]!.bottom && boxes[i]!.bottom > boxes[j]!.y
      expect(overlap).toBe(false)
    }
  }
  await townships.nth(1).locator('.weather-marker').click()
  const popup = page.getByRole('dialog', { name: '位置天气详情' })
  await expect(popup).toBeVisible()
  await expect(popup.locator('.query-context')).toHaveText('浙江省杭州市示例县')
  await page.keyboard.press('Escape')
  await expect(popup).toBeHidden()
  await expect(page.locator('.weather-marker-wrap.seat')).toHaveCount(6)
})

test('乡镇、村无常驻标牌，乡镇级保留 Ctrl 提示', async ({ page }) => {
  await installFixtures(page)
  await openWeather(page)
  await expect(page.locator('.weather-marker-wrap.seat')).toHaveCount(11)
  await zoomDrill(page, /Z 9\.5/)
  await expect(page.locator('.weather-marker-wrap.seat')).toHaveCount(1)
  await zoomDrill(page, /Z 11\.5/)
  await expect(page.locator('.weather-marker-wrap.seat')).toHaveCount(6)
  await zoomDrill(page, /Z 13\.5/)
  await expect(page.locator('.weather-marker-wrap.seat')).toHaveCount(0)
  await expect(page.getByText('Ctrl', { exact: true })).toBeVisible()
  await expect(page.getByText('左键单击可以按点选查询天气')).toBeVisible()
  await zoomDrill(page, /Z 15\.5/)
  await expect(page.locator('.weather-marker-wrap.seat')).toHaveCount(0)
  await expect(page.getByText('Ctrl', { exact: true })).toBeVisible()
})

test('旧层级流不会更新新层级图层', async ({ page }) => {
  const requests = await installFixtures(page)
  await openWeather(page)
  await expect(page.locator('.weather-marker-wrap.seat')).toHaveCount(11)
  await zoomDrill(page, /Z 9\.5/)
  await expect(page.locator('.weather-marker-wrap.seat')).toHaveCount(1)
  await expect(page.locator('.weather-marker-wrap.seat').filter({ hasText: '杭州市' })).toHaveCount(0)
  await expect(page.locator('.weather-marker-wrap.seat').filter({ hasText: '示例县' })).toHaveCount(1)
  expect(requests.filter((query) => query.startsWith('markers:?contextLevel=province'))).toHaveLength(1)
  expect(requests.filter((query) => query.startsWith('markers:?contextLevel=city'))).toHaveLength(1)
})

test('失败标牌独立显示且其他标牌仍可用', async ({ page }) => {
  await installFixtures(page, { markerFixture: 'failed' })
  await openWeather(page)
  const failed = page.locator('.weather-marker-wrap.seat.error')
  await expect(failed).toHaveCount(1)
  await expect(failed.locator('.weather-marker-detail b')).toHaveText('加载失败')
  await expect(failed.locator('.weather-marker-detail strong')).toHaveText('--')
  await expect(page.locator('.weather-marker-wrap.seat:not(.error)')).toHaveCount(10)
  await page.locator('.weather-marker-wrap.seat:not(.error)').first().locator('.weather-marker').click()
  const popup = page.getByRole('dialog', { name: '位置天气详情' })
  await expect(popup.locator('.query-context')).toHaveText('浙江省杭州市示例县')
  await page.keyboard.press('Escape')
  await expect(popup).toBeHidden()
})

test('整条标牌流失败时不渲染任何标牌且不伪装空数据', async ({ page }) => {
  await installFixtures(page, { markerFixture: 'request-error' })
  await page.goto('/')
  await page.getByRole('button', { name: '查看天气' }).click()
  await page.getByRole('button', { name: '实时天气' }).click()
  await expect(page.locator('.weather-marker-wrap.seat')).toHaveCount(0)
  await expect(page.getByText('Ctrl', { exact: true })).toBeHidden()
  await page.getByRole('button', { name: '当前：实时天气，点击切换' }).click()
  await page.getByRole('button', { name: '气象预警' }).click()
  await expect(page.getByRole('heading', { name: '气象预警', exact: true })).toBeVisible()
})

test('Ctrl 点选与常驻标牌集合互不干扰，Esc 后恢复集合且无默认点', async ({ page }) => {
  const requests = await installFixtures(page)
  await openWeather(page)
  await expect(page.locator('.weather-marker-wrap.seat')).toHaveCount(11)
  await page.locator('.map').click({ position: { x: 500, y: 330 }, modifiers: ['Control'] })
  const popup = page.getByRole('dialog', { name: '位置天气详情' })
  await expect(popup.locator('.query-context')).toHaveText('杭州市西湖区测试点')
  expect(requests.filter((query) => query.includes('target=picked'))).toHaveLength(1)
  expect(requests.filter((query) => query.includes('target=picked'))[0]).not.toContain('key=')
  await page.keyboard.press('Escape')
  await expect(popup).toBeHidden()
  await expect(page.locator('.weather-marker-wrap.picked')).toHaveCount(0)
  await expect(page.locator('.weather-marker-wrap.default')).toHaveCount(0)
  await expect(page.locator('.weather-marker-wrap.seat')).toHaveCount(11)
})

test('1280x720 浮窗完整位于视口且与标牌无重叠', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 720 })
  await installFixtures(page)
  await openWeather(page)
  await page.locator('.weather-marker-wrap.seat').filter({ hasText: '杭州市' }).locator('.weather-marker').click()
  const popup = page.getByRole('dialog', { name: '位置天气详情' })
  const box = await popup.boundingBox(), close = popup.getByRole('button', { name: '关闭天气浮窗' }), closeBox = await close.boundingBox()
  expect(box).not.toBeNull(); expect(box!.x).toBeGreaterThanOrEqual(11); expect(box!.y).toBeGreaterThanOrEqual(11); expect(box!.x + box!.width).toBeLessThanOrEqual(1270); expect(box!.y + box!.height).toBeLessThanOrEqual(710)
  await expect(popup.locator('header')).toBeVisible(); await expect(popup.locator('.popup-body')).toBeVisible()
  expect(closeBox).not.toBeNull(); expect(closeBox!.x + closeBox!.width).toBeLessThanOrEqual(1280); expect(closeBox!.y + closeBox!.height).toBeLessThanOrEqual(720)
  const markerBox = await page.locator('.weather-marker-wrap.seat').filter({ hasText: '杭州市' }).locator('.weather-marker').boundingBox()
  expect(markerBox).not.toBeNull()
  const overlaps = box!.x < markerBox!.x + markerBox!.width && box!.x + box!.width > markerBox!.x && box!.y < markerBox!.y + markerBox!.height && box!.y + box!.height > markerBox!.y
  expect(overlaps).toBe(false)
})

test('520px 视口下标牌与近全宽浮窗可用，关闭可达', async ({ page }) => {
  await page.setViewportSize({ width: 500, height: 760 })
  await installFixtures(page)
  await openWeather(page)
  await expect(page.locator('.weather-marker-wrap.seat')).toHaveCount(11)
  await page.locator('.weather-marker-wrap.seat').first().locator('.weather-marker').click()
  const popup = page.getByRole('dialog', { name: '位置天气详情' })
  const box = await popup.boundingBox()
  expect(box).not.toBeNull()
  expect(box!.x).toBeGreaterThanOrEqual(11); expect(box!.y).toBeGreaterThanOrEqual(11)
  expect(box!.x + box!.width).toBeLessThanOrEqual(490); expect(box!.y + box!.height).toBeLessThanOrEqual(750)
  const close = popup.getByRole('button', { name: '关闭天气浮窗' }), closeBox = await close.boundingBox()
  await expect(close).toBeVisible()
  expect(closeBox).not.toBeNull()
  expect(closeBox!.x).toBeGreaterThanOrEqual(0); expect(closeBox!.y).toBeGreaterThanOrEqual(0)
  expect(closeBox!.x + closeBox!.width).toBeLessThanOrEqual(500); expect(closeBox!.y + closeBox!.height).toBeLessThanOrEqual(760)
  await expect(page.getByRole('button', { name: '当前：实时天气，点击切换' })).toBeVisible()
})

test('气象预警与实时天气模块互斥', async ({ page }) => {
  await installFixtures(page)
  await openWeather(page)
  await expect(page.locator('.weather-panel')).toBeHidden()
  await page.locator('.weather-marker-wrap.seat').filter({ hasText: '杭州市' }).locator('.weather-marker').click()
  const popup = page.getByRole('dialog', { name: '位置天气详情' })
  await expect(popup).toHaveClass(/(left|right)/)
  await page.getByRole('button', { name: '当前：实时天气，点击切换' }).click()
  await page.getByRole('button', { name: '气象预警' }).click()
  await expect(page.locator('.weather-marker-wrap.seat')).toHaveCount(0)
  await expect(page.getByRole('heading', { name: '气象预警', exact: true })).toBeVisible()
  await expect(page.locator('.national-alarm-panel .records button')).toHaveCount(1)
  const marker = page.locator('.national-alarm-marker')
  await expect(marker).toHaveCount(1)
  await marker.click()
  const alert = page.getByRole('dialog', { name: '浙江预警详情' })
  await expect(alert).toContainText('杭州市发布暴雨红色预警')
  await marker.click()
  await expect(alert).toBeHidden()
  await page.keyboard.press('Escape')
  await expect(alert).toBeHidden()
  await expect(popup).toBeHidden()
})
