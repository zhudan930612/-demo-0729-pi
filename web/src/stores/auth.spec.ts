import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { useAuthStore } from './auth'
import type { AuthApiClient } from '../api/auth'

beforeEach(() => setActivePinia(createPinia()))

function client(overrides: Partial<AuthApiClient> = {}): AuthApiClient {
  return {
    login: vi.fn(async () => ({ token: 'tok', username: 'admin', expiresAt: 123 })),
    session: vi.fn(async () => ({ username: 'admin', expiresAt: 123 })),
    logout: vi.fn(async () => undefined),
    ...overrides,
  }
}

describe('auth store', () => {
  it('登录成功进入已认证态', async () => {
    const store = useAuthStore()
    await store.login('admin', 'admin123', client())
    expect(store.isAuthenticated).toBe(true)
    expect(store.username).toBe('admin')
    expect(store.token).toBe('tok')
  })

  it('登录失败写入错误文案并保持未认证态', async () => {
    const store = useAuthStore()
    await expect(store.login('admin', 'bad', client({ login: vi.fn(async () => { throw new Error('用户名或密码不正确') }) }))).rejects.toThrow()
    expect(store.isAuthenticated).toBe(false)
    expect(store.errorMessage).toBe('用户名或密码不正确')
  })

  it('无本地会话时恢复为未认证态', async () => {
    vi.stubGlobal('window', { localStorage: undefined })
    const store = useAuthStore()
    await store.restore(client())
    expect(store.isAuthenticated).toBe(false)
    vi.unstubAllGlobals()
  })

  it('会话校验失败时清除本地并回到未认证态', async () => {
    const store = useAuthStore()
    await expect(store.restore(client({ session: vi.fn(async () => { throw new Error('登录已失效') }) }))).resolves.toBeUndefined()
    expect(store.isAuthenticated).toBe(false)
  })

  it('退出清空状态并调用服务端退出', async () => {
    const store = useAuthStore()
    const api = client()
    await store.login('admin', 'admin123', api)
    await store.logout(api)
    expect(store.isAuthenticated).toBe(false)
    expect(store.token).toBeNull()
    expect(api.logout).toHaveBeenCalledWith('tok')
  })
})
