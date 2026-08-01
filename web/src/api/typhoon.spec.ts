import { describe, expect, it, vi } from 'vitest'
import { createTyphoonApiClient, TyphoonApiError } from './typhoon'

describe('typhoon api client', () => {
  it('只请求本站列表与详情路径，并传递 AbortSignal', async () => {
    const fetchImpl = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => new Response(JSON.stringify({ code: 200 }), { status: 200 }))
    const client = createTyphoonApiClient(fetchImpl as typeof fetch)
    const controller = new AbortController()
    await client.list(2026, controller.signal)
    await client.detail('3257931', controller.signal)
    expect(fetchImpl.mock.calls.map(([url]) => url)).toEqual(['/api/typhoons?year=2026', '/api/typhoons/3257931'])
    expect(fetchImpl.mock.calls.every(([, init]) => init?.signal === controller.signal)).toBe(true)
  })

  it('解析本站统一错误', async () => {
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({ error: { code: 'UPSTREAM_ERROR', message: '暂不可用', requestId: 'req-1' } }), { status: 502 }))
    const client = createTyphoonApiClient(fetchImpl as typeof fetch)
    await expect(client.list(2026)).rejects.toMatchObject({ code: 'UPSTREAM_ERROR', message: '暂不可用', requestId: 'req-1', status: 502 } satisfies Partial<TyphoonApiError>)
  })

  it('非 JSON 响应使用安全错误', async () => {
    const client = createTyphoonApiClient(vi.fn(async () => new Response('bad', { status: 502 })) as typeof fetch)
    await expect(client.list(2026)).rejects.toMatchObject({ code: 'INVALID_RESPONSE' })
  })
})
