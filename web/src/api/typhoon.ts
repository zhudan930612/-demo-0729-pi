export interface TyphoonApiClient {
  list(year: number, signal?: AbortSignal): Promise<unknown>
  detail(no: string, signal?: AbortSignal): Promise<unknown>
}

export class TyphoonApiError extends Error {
  readonly code: string
  readonly requestId?: string
  readonly status: number

  constructor(message: string, code: string, status: number, requestId?: string) {
    super(message)
    this.name = 'TyphoonApiError'
    this.code = code
    this.status = status
    this.requestId = requestId
  }
}

function errorRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const root = value as Record<string, unknown>
  const error = root.error
  return error && typeof error === 'object' && !Array.isArray(error) ? error as Record<string, unknown> : null
}

export function createTyphoonApiClient(fetchImpl: typeof fetch = globalThis.fetch): TyphoonApiClient {
  async function request(path: string, signal?: AbortSignal): Promise<unknown> {
    const response = await fetchImpl(path, {
      method: 'GET',
      headers: { accept: 'application/json' },
      signal,
    })
    let payload: unknown
    try {
      payload = await response.json()
    } catch {
      throw new TyphoonApiError('台风数据响应格式异常', 'INVALID_RESPONSE', response.status)
    }
    if (!response.ok) {
      const error = errorRecord(payload)
      throw new TyphoonApiError(
        typeof error?.message === 'string' ? error.message : '台风数据加载失败',
        typeof error?.code === 'string' ? error.code : 'REQUEST_FAILED',
        response.status,
        typeof error?.requestId === 'string' ? error.requestId : undefined,
      )
    }
    return payload
  }

  return {
    list(year, signal) {
      return request(`/api/typhoons?year=${encodeURIComponent(String(year))}`, signal)
    },
    detail(no, signal) {
      return request(`/api/typhoons/${encodeURIComponent(no)}`, signal)
    },
  }
}

export const typhoonApi = createTyphoonApiClient()
