import { expect, test, type Page } from '@playwright/test'
import { province } from './fixtures'

// ---------- fixture 构造 ----------
function makeCity() {
  return { type: 'FeatureCollection', features: [{ type: 'Feature', properties: { code: '330600', name: '绍兴市' }, geometry: { type: 'Polygon', coordinates: [[[119.5, 29], [121.5, 29], [121.5, 30.5], [119.5, 30.5], [119.5, 29]]] } }] }
}
function makeCounty() {
  return { type: 'FeatureCollection', features: [{ type: 'Feature', properties: { code: '330604', name: '上虞区' }, geometry: { type: 'Polygon', coordinates: [[[120, 29], [120.5, 29], [120.5, 29.5], [120, 29.5], [120, 29]]] } }] }
}
function makeTownship() {
  return { type: 'FeatureCollection', features: [{ type: 'Feature', properties: { code: '330604104000', name: '章镇镇' }, geometry: { type: 'Polygon', coordinates: [[[120.1, 29.1], [120.4, 29.1], [120.4, 29.4], [120.1, 29.4], [120.1, 29.1]]] } }] }
}
function makeVillages() {
  return {
    type: 'FeatureCollection',
    features: [
      { type: 'Feature', properties: { code: '330604102014', name: '龙江村' }, geometry: { type: 'Polygon', coordinates: [[[120.26, 29.26], [120.32, 29.26], [120.32, 29.31], [120.26, 29.31], [120.26, 29.26]]] } },
      { type: 'Feature', properties: { code: '330604102011', name: '新南村' }, geometry: { type: 'Polygon', coordinates: [[[120.2, 29.26], [120.25, 29.26], [120.25, 29.31], [120.2, 29.31], [120.2, 29.26]]] } },
      { type: 'Feature', properties: { code: '330604102015', name: '大钱村' }, geometry: { type: 'Polygon', coordinates: [[[120.26, 29.2], [120.32, 29.2], [120.32, 29.25], [120.26, 29.25], [120.26, 29.2]]] } },
    ],
  }
}

const villageData = [
  { code: '330604102014', name: '龙江村', centroid: { lon: 120.29, lat: 29.285, name: '龙江村' }, insuredAreaMu: 1000, householdCount: 120, policyCount: 2, levels: { veryPoor: 0.2, poor: 0.45, normal: 0.2, good: 0.1, excellent: 0.05 }, anomalyRatio: 0.65, isAnomaly: true, countyCode: '330604', cityCode: '330600', townshipCode: '330604104000', data: true },
  { code: '330604102011', name: '新南村', centroid: { lon: 120.22, lat: 29.285, name: '新南村' }, insuredAreaMu: 400, householdCount: 60, policyCount: 2, levels: { veryPoor: 0.35, poor: 0.35, normal: 0.2, good: 0.06, excellent: 0.04 }, anomalyRatio: 0.7, isAnomaly: true, countyCode: '330604', cityCode: '330600', townshipCode: '330604104000', data: true },
  { code: '330604102015', name: '大钱村', centroid: { lon: 120.29, lat: 29.22, name: '大钱村' }, insuredAreaMu: 2000, householdCount: 180, policyCount: 3, levels: { veryPoor: 0.05, poor: 0.15, normal: 0.5, good: 0.2, excellent: 0.1 }, anomalyRatio: 0.2, isAnomaly: false, countyCode: '330604', cityCode: '330600', townshipCode: '330604104000', data: true },
]
const levelData = { byCode: {
  '330000': { code: '330000', name: '浙江省', insuredAreaMu: 3400, householdCount: 360, levels: { veryPoor: 0.18, poor: 0.3, normal: 0.28, good: 0.15, excellent: 0.09 }, data: true },
  '330600': { code: '330600', name: '绍兴市', insuredAreaMu: 3400, householdCount: 360, levels: { veryPoor: 0.18, poor: 0.3, normal: 0.28, good: 0.15, excellent: 0.09 }, data: true },
  '330604': { code: '330604', name: '上虞区', insuredAreaMu: 3400, householdCount: 360, levels: { veryPoor: 0.18, poor: 0.3, normal: 0.28, good: 0.15, excellent: 0.09 }, data: true },
  '330604104000': { code: '330604104000', name: '章镇镇', insuredAreaMu: 3400, householdCount: 360, levels: { veryPoor: 0.18, poor: 0.3, normal: 0.28, good: 0.15, excellent: 0.09 }, data: true },
} }
const tasksData = [
  { id: 'task-0001', name: '龙江村核查异常长势', type: 'poor_growth', typeName: '核查异常长势', villageCode: '330604102014', villageName: '龙江村', status: '已完成', createdAt: '2026-06-08', executor: { name: '张协保', role: '协保员' }, remark: '龙江村经遥感长势监测，异常面积占比约 65%，需核查。', sopAction: '携带遥感图斑定位异常地块，核实作物长势与承保面积是否一致、是否存在明显减产。', requirement: '到场核实并拍照留痕，48 小时内反馈核查结论。', location: { name: '龙江村', lon: 120.29, lat: 29.285 }, evidence: [{ url: '/data/agri/evidence/t1.png', time: '2026-06-08 10:00' }, { url: '/data/agri/evidence/t2.png', time: '2026-06-08 11:00' }] },
  { id: 'task-0002', name: '新南村核查农药使用', type: 'pesticide', typeName: '核查农药使用', villageCode: '330604102011', villageName: '新南村', status: '待领取', createdAt: '2026-07-06', executor: null, remark: '新南村异常面积占比约 70%，核查农药使用情况。', sopAction: '入户核实是否按规定用足农药，对农药瓶、购药凭证拍照留痕。', requirement: '核查用药记录并拍照上传，24 小时内反馈。', location: { name: '新南村', lon: 120.22, lat: 29.285 }, evidence: [{ url: '/data/agri/evidence/t3.png', time: '2026-07-06 09:00' }] },
]
const pgData = {
  '330604102014': [{ policyId: 'p1', policyNo: '3306041020142025000001', insuredName: '王大户', insuredPartyId: 'party-1', insuredAreaMu: 980, levels: { veryPoor: 0.2, poor: 0.45, normal: 0.2, good: 0.1, excellent: 0.05 }, premiumRate: '0.032' }],
  '330604102011': [{ policyId: 'p2', policyNo: '3306041020112025000002', insuredName: '李团单', insuredPartyId: 'party-2', insuredAreaMu: 380, levels: { veryPoor: 0.35, poor: 0.35, normal: 0.2, good: 0.06, excellent: 0.04 }, premiumRate: '0.032' }],
  '330604102015': [{ policyId: 'p3', policyNo: '3306041020152025000003', insuredName: '陈大户', insuredPartyId: 'party-3', insuredAreaMu: 2000, levels: { veryPoor: 0.05, poor: 0.15, normal: 0.5, good: 0.2, excellent: 0.1 }, premiumRate: '0.032' }],
}
// 极小 ndvi 栅格（3 个点，2 期）
const ndviData = {
  dates: ['2026-06-01', '2026-07-27'],
  grid: [
    { lat: 29.28, lon: 120.28, values: [62, 65] },   // NDVI 0.62/0.65  正常
    { lat: 29.285, lon: 120.29, values: [48, 49] },  // 0.48/0.49 较差
    { lat: 29.29, lon: 120.3, values: [72, 75] },    // 0.72/0.75 较好
  ],
}

const PNG_1PX = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+M8AAAMBAQDJ/pLvAAAAAElFTkSuQmCC', 'base64')

async function installFixtures(page: Page) {
  await page.route('**/*', async (route) => {
    const url = new URL(route.request().url())
    const p = url.pathname
    if (p === '/data/boundary/province.geojson') return route.fulfill({ json: province })
    if (p === '/data/boundary/city/330000.geojson') return route.fulfill({ json: makeCity() })
    if (p === '/data/boundary/county/330600.geojson') return route.fulfill({ json: makeCounty() })
    if (p === '/data/boundary/township/330604.geojson') return route.fulfill({ json: makeTownship() })
    if (p === '/data/villages/330604104000.geojson') return route.fulfill({ json: makeVillages() })
    if (p === '/data/rs.json') return route.fulfill({ status: 404, body: '' })
    if (p === '/data/agri/ndvi.json') return route.fulfill({ json: ndviData })
    if (p === '/data/agri/villages.json') return route.fulfill({ json: villageData })
    if (p === '/data/agri/levels.json') return route.fulfill({ json: levelData })
    if (p === '/data/agri/tasks.json') return route.fulfill({ json: tasksData })
    if (p.startsWith('/data/agri/policy-growth-')) {
      const code = p.replace('/data/agri/policy-growth-', '').replace('.json', '')
      return route.fulfill({ json: pgData[code as keyof typeof pgData] ?? [] })
    }
    if (p.startsWith('/data/agri/evidence/')) return route.fulfill({ status: 200, contentType: 'image/png', body: PNG_1PX })
    if (url.hostname.endsWith('tianditu.gov.cn')) return route.fulfill({ status: 204, body: '' })
    return route.continue()
  })
}

async function enterAgri(page: Page) {
  await page.goto('/')
  await page.waitForSelector('.demo-btn')
  await page.click('.demo-btn')
  await page.click('#demo-tool-menu button:has-text("农情监测")')
  await page.waitForSelector('.agri-panel')
}

test('R1 演示模式入口 + R8 tab 切换 + R2 默认最近一期/开关', async ({ page }) => {
  await installFixtures(page)
  await page.goto('/')
  await page.waitForSelector('.demo-btn')
  // R1-1：点击演示模式图标弹出二级菜单，含三项
  await page.click('.demo-btn')
  await expect(page.locator('#demo-tool-menu')).toBeVisible()
  await expect(page.locator('#demo-tool-menu .menu-action')).toHaveCount(3)
  // R1-3：受灾预警/受灾评估 不可进入（disabled）
  await expect(page.locator('#demo-tool-menu .menu-action:has-text("受灾预警")')).toBeDisabled()
  await expect(page.locator('#demo-tool-menu .menu-action:has-text("受灾评估")')).toBeDisabled()
  // R1-2：选「农情监测」进入，地图回省级
  await page.click('#demo-tool-menu button:has-text("农情监测")')
  await expect(page.locator('.agri-panel')).toBeVisible()
  await expect(page.locator('.agri-date-control')).toBeVisible()
  await expect(page.locator('.crumb.active')).toHaveText('浙江省')
  // R8-1：右上角三个 tab
  await expect(page.locator('.agri-panel .tab-list button')).toHaveCount(3)
  await expect(page.locator('.agri-panel .tab-list button').nth(0)).toHaveText('农情概况')
  await expect(page.locator('.agri-panel .tab-list button').nth(1)).toHaveText('异常top')
  await expect(page.locator('.agri-panel .tab-list button').nth(2)).toHaveText('任务列表')
  // R8-3：切换 tab 时热力图保留（日期控制仍在）
  await page.click('.agri-panel .tab-list button:has-text("异常top")')
  await expect(page.locator('.agri-anomaly')).toBeVisible()
  await expect(page.locator('.agri-date-control')).toBeVisible()
  // R2-1：默认显示最近一期（最后日期 07-27）
  await expect(page.locator('.agri-date-control')).toContainText('7/27')
  await expect(page.locator('.agri-date-control')).toContainText('2026-07-27')
  // R2-6/R2-7：日期轴 + 播放
  await expect(page.locator('.agri-date-control .day-node')).toHaveCount(2)
  await expect(page.locator('.agri-date-control .play-button')).toBeVisible()
  // R2-2：热力图开关
  await page.locator('.agri-date-control button[aria-label="隐藏长势热力图"]').click()
  await expect(page.locator('.agri-date-control button[aria-label="显示长势热力图"]')).toBeVisible()
  // R7-2：退出清除面板与日期控制（后续退出测试）
})

test('R3 农情概况：顶部概况 + 下一级列表（默认 tab）', async ({ page }) => {
  await installFixtures(page)
  await enterAgri(page)
  // R3-1：默认选中农情概况
  await expect(page.locator('.agri-overview')).toBeVisible()
  await expect(page.locator('.agri-overview .tab-list')).toHaveCount(0)
  // R3-2：顶部当前层级概况（承保面积 + 户数 + 5 级色带）
  await expect(page.locator('.agri-overview .ov-title')).toHaveText('浙江省')
  await expect(page.locator('.agri-overview .ov-summary')).toContainText('3,400')
  await expect(page.locator('.agri-overview .ov-band .band-seg').first()).toBeVisible()
  // R3-3：下一级区划列表（省级→市级，按承保面积降序，完整5档）
  await expect(page.locator('.agri-overview .child-row').first()).toBeVisible()
  await expect(page.locator('.agri-overview .child-row').first()).toContainText('绍兴市')
  await expect(page.locator('.agri-overview .child-row').first().locator('.level-cell')).toHaveCount(5)
  // R3-6：下钻后概况刷新（点击绍兴市 → 县级列表）
  await page.locator('.agri-overview .child-row').first().click()
  await expect(page.locator('.crumb.active')).toHaveText('绍兴市')
  await expect(page.locator('.agri-overview .ov-title')).toHaveText('绍兴市')
  // R3-4：下钻到村 → 保单列表（村级视角）
  // （进一步下钻到村级）
  await page.click('.crumb:has-text("浙江省")') // 返回省
  await page.waitForTimeout(200)
})

test('R4 异常top + R6 一键转任务 + R5 任务列表', async ({ page }) => {
  await installFixtures(page)
  await enterAgri(page)
  // R4-1：异常top 列表只列超标村，按占比降序
  await page.click('.agri-panel .tab-list button:has-text("异常top")')
  await expect(page.locator('.agri-anomaly')).toBeVisible()
  const rows = page.locator('.agri-anomaly .anomaly-row')
  await expect(rows).toHaveCount(2) // 龙江村65% + 新南村70%（大钱村不超标不列）
  // R4-2：按占比降序（新南村70% 在 龙江村65% 前）
  await expect(rows.nth(0)).toContainText('新南村')
  await expect(rows.nth(0)).toContainText('70%')
  await expect(rows.nth(1)).toContainText('龙江村')
  // R4-5：点击某村 → 异常详情（村名 + 5档占比 + 一键转任务，无判断依据区块）
  await rows.nth(1).click()
  await expect(page.locator('.agri-anomaly .anomaly-detail')).toBeVisible()
  await expect(page.locator('.agri-anomaly .anomaly-detail .detail-title')).toHaveText('龙江村')
  await expect(page.locator('.agri-anomaly .anomaly-detail .detail-band .band-seg')).toHaveCount(5)
  await expect(page.locator('.agri-anomaly .anomaly-detail')).not.toContainText('判断依据')
  // R6-1：一键转任务 → 待领取，进任务列表
  await page.locator('.agri-anomaly .anomaly-detail .convert-btn').click()
  await expect(page.locator('.agri-tasks')).toBeVisible() // 切到任务列表 tab
  await expect(page.locator('.agri-tasks .task-list')).toContainText('龙江村核查异常长势')
  // R6-3：重复点击不重复生成（回异常 top，详情仍打开，按钮已禁用）
  await page.click('.agri-panel .tab-list button:has-text("异常top")')
  await expect(page.locator('.agri-anomaly .anomaly-detail')).toBeVisible()
  await expect(page.locator('.agri-anomaly .detail-actions .convert-btn')).toBeDisabled()
  // R5-1：任务列表行字段（名称/类型/状态/村/时间，不含 SOP）
  await page.click('.agri-panel .tab-list button:has-text("任务列表")')
  await expect(page.locator('.agri-tasks .task-row').first()).toContainText('核查异常长势')
  // R5-3：点开任务详情（执行人 + 备注 + SOP + 执行要求 + 定位 + 证据）
  await page.locator('.agri-tasks .task-row').first().click()
  await expect(page.locator('.agri-tasks .task-detail')).toBeVisible()
  await expect(page.locator('.agri-tasks .task-detail')).toContainText('SOP 动作')
  await expect(page.locator('.agri-tasks .task-detail')).toContainText('执行要求')
  await expect(page.locator('.agri-tasks .task-detail')).toContainText('备注')
  await expect(page.locator('.agri-tasks .task-detail')).toContainText('定位到地图')
  await expect(page.locator('.agri-tasks .task-detail .ev-thumb').first()).toBeVisible()
  // R5-4：定位到地图 → 显示定位（无报错）
  await page.locator('.agri-tasks .locate-btn').click()
  // R5-5：退出任务详情 → 定位图标移除
  await page.locator('.agri-tasks .task-detail .back-btn').click()
  await expect(page.locator('.agri-tasks .task-detail')).toHaveCount(0)
  // R5-7：查看全部任务浮窗
  await page.locator('.agri-tasks .view-all').click()
  await expect(page.locator('.agri-tasks .all-panel')).toBeVisible()
})

test('R7 模式互斥：进入农情监测退出其他模式 / 退出清除农情状态', async ({ page }) => {
  await installFixtures(page)
  await enterAgri(page)
  await expect(page.locator('.agri-panel')).toBeVisible()
  // R7-2：退出 → 清除面板与日期控制
  await page.locator('.agri-date-control .close-button').click()
  await expect(page.locator('.agri-panel')).toHaveCount(0)
  await expect(page.locator('.agri-date-control')).toHaveCount(0)
})
