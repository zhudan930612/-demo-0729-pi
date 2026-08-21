import { expect, test, type Page } from '@playwright/test'
import { province } from './fixtures'

async function installFixtures(page: Page) {
  await page.route('**/*', async (route) => {
    const url = new URL(route.request().url())
    if (url.pathname === '/data/boundary/province.geojson') return route.fulfill({ json: province })
    if (url.hostname.endsWith('tianditu.gov.cn')) return route.fulfill({ status: 204, body: '' })
    return route.continue()
  })
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
