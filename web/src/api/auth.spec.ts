import { describe, expect, it, vi } from 'vitest'
import { AuthApiError, createAuthApiClient } from './auth'

describe('auth api client', () => {
  it('登录请求 POST 到本站路径并携带 JSON 凭据', async () => {
    const fetchImpl = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => new Response(JSON.stringify({ token: 'tok-1', username: 'admin', expiresAt: 123 }), { status: 200 }))
    const client = createAuthApiClient(fetchImpl as typeof fetch)
    const session = await client.login('admin', 'admin123')
    expect(fetchImpl).toHaveBeenCalledTimes(1)
    const [url, init] = fetchImpl.mock.calls[0]
    expect(url).toBe('/api/auth/login')
    expect(init?.method).toBe('POST')
    expect((init?.headers as Record<string, string>)['content-type']).toBe('application/json')
    expect(JSON.parse(init?.body as string)).toEqual({ username: 'admin', password: 'admin123' })
    expect(session).toEqual({ token: 'tok-1', username: 'admin', expiresAt: 123 })
  })

  it('解析登录统一错误', async () => {
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({ error: { code: 'INVALID_CREDENTIALS', message: '用户名或密码不正确', requestId: 'req-1' } }), { status: 401 }))
    const client = createAuthApiClient(fetchImpl as typeof fetch)
    await expect(client.login('admin', 'bad')).rejects.toMatchObject({ code: 'INVALID_CREDENTIALS', message: '用户名或密码不正确', requestId: 'req-1', status: 401 } satisfies Partial<AuthApiError>)
  })

  it('登录响应结构异常时使用安全错误', async () => {
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({ ok: true }), { status: 200 }))
    const client = createAuthApiClient(fetchImpl as typeof fetch)
    await expect(client.login('admin', 'admin123')).rejects.toMatchObject({ code: 'INVALID_RESPONSE' })
  })

  it('会话与退出请求携带 Bearer 令牌', async () => {
    const fetchImpl = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      if (init?.method === 'POST') return new Response(null, { status: 204 })
      return new Response(JSON.stringify({ username: 'admin', expiresAt: 123 }), { status: 200 })
    })
    const client = createAuthApiClient(fetchImpl as typeof fetch)
    await client.session('tok-1')
    await client.logout('tok-1')
    expect(fetchImpl).toHaveBeenCalledTimes(2)
    expect(fetchImpl.mock.calls[0][0]).toBe('/api/auth/session')
    expect((fetchImpl.mock.calls[0][1]?.headers as Record<string, string>).authorization).toBe('Bearer tok-1')
    expect(fetchImpl.mock.calls[1][0]).toBe('/api/auth/logout')
    expect(fetchImpl.mock.calls[1][1]?.method).toBe('POST')
    expect((fetchImpl.mock.calls[1][1]?.headers as Record<string, string>).authorization).toBe('Bearer tok-1')
  })

  it('退出时 401 视为已失效不抛错', async () => {
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({ error: { code: 'UNAUTHORIZED', message: '登录已失效' } }), { status: 401 }))
    const client = createAuthApiClient(fetchImpl as typeof fetch)
    await expect(client.logout('expired')).resolves.toBeUndefined()
  })
})
