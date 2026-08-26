import { expect, test, type Page } from '@playwright/test'

// 登录门禁用例需要从未登录态开始，覆盖全局 storageState 的预置令牌。
test.use({ storageState: { cookies: [], origins: [] } })

async function fillLogin(page: Page, username: string, password: string) {
  await page.locator('input[name="username"]').fill(username)
  await page.locator('input[name="password"]').fill(password)
}

test('直接输入 /login 显示登录页，不渲染地图', async ({ page }) => {
  await page.goto('/login')
  await expect(page.locator('.login-card')).toBeVisible()
  await expect(page.locator('.map')).toHaveCount(0)
})

test('未登录访问 / 被重定向到登录页', async ({ page }) => {
  await page.goto('/')
  await expect(page).toHaveURL(/\/login$/)
  await expect(page.locator('.login-card')).toBeVisible()
  await expect(page.locator('.map')).toHaveCount(0)
})

test('错误密码显示错误提示并停留在登录页', async ({ page }) => {
  await page.goto('/login')
  await fillLogin(page, 'admin', 'wrong')
  await page.locator('button[type="submit"]').click()
  await expect(page.locator('.error')).toHaveText('用户名或密码不正确')
  await expect(page.locator('.map')).toHaveCount(0)
})

test('正确登录进入地图，地址变为 /', async ({ page }) => {
  await page.goto('/login')
  await fillLogin(page, 'admin', 'admin123')
  await page.locator('button[type="submit"]').click()
  await expect(page.locator('.map')).toBeVisible()
  await expect(page).toHaveURL(/\/$/)
})

test('登录后再次访问 /login 仍显示登录页', async ({ page }) => {
  await page.goto('/login')
  await fillLogin(page, 'admin', 'admin123')
  await page.locator('button[type="submit"]').click()
  await expect(page.locator('.map')).toBeVisible()
  // 已登录状态下直接输入 /login，仍显示登录页
  await page.goto('/login')
  await expect(page.locator('.login-card')).toBeVisible()
})
