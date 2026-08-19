import { expect, test, type Page } from '@playwright/test'

// 登录门禁用例需要从未登录态开始，覆盖全局 storageState 的预置令牌。
test.use({ storageState: { cookies: [], origins: [] } })

async function fillLogin(page: Page, username: string, password: string) {
  await page.locator('input[name="username"]').fill(username)
  await page.locator('input[name="password"]').fill(password)
}

test('未登录时显示登录页，不渲染地图', async ({ page }) => {
  await page.goto('/')
  await expect(page.locator('.login-card')).toBeVisible()
  await expect(page.locator('.map')).toHaveCount(0)
})

test('错误密码显示错误提示并停留在登录页', async ({ page }) => {
  await page.goto('/')
  await fillLogin(page, 'admin', 'wrong')
  await page.locator('button[type="submit"]').click()
  await expect(page.locator('.error')).toHaveText('用户名或密码不正确')
  await expect(page.locator('.map')).toHaveCount(0)
})

test('正确登录进入地图，退出后回到登录页', async ({ page }) => {
  await page.goto('/')
  await fillLogin(page, 'admin', 'admin123')
  await page.locator('button[type="submit"]').click()
  await expect(page.locator('.map')).toBeVisible()
  await page.locator('.logout-btn').click()
  await expect(page.locator('.login-card')).toBeVisible()
})
