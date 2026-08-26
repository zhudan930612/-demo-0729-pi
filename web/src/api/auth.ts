export interface AuthSession {
  token: string
  username: string
  expiresAt: number
}

export interface AuthUser {
  username: string
  expiresAt: number
}

export class AuthApiError extends Error {
  readonly code: string
  readonly status: number
  readonly requestId?: string
  constructor(code: string, status: number, message: string, requestId?: string) {
    super(message)
    this.name = 'AuthApiError'
    this.code = code
    this.status = status
    this.requestId = requestId
  }
}

function record(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null
}

function errorOf(payload: unknown): { code?: string; message?: string; requestId?: string } {
  const error = record(payload)?.error
  const detail = record(error)
  return {
    code: typeof detail?.code === 'string' ? detail.code : undefined,
    message: typeof detail?.message === 'string' ? detail.message : undefined,
    requestId: typeof detail?.requestId === 'string' ? detail.requestId : undefined,
  }
}

export interface AuthApiClient {
  login(username: string, password: string): Promise<AuthSession>
  session(token: string): Promise<AuthUser>
  logout(token: string): Promise<void>
}

export function createAuthApiClient(fetchImpl: typeof fetch = globalThis.fetch): AuthApiClient {
  async function parse(response: Response): Promise<unknown> {
    try { return await response.json() } catch { return null }
  }

  async function login(username: string, password: string): Promise<AuthSession> {
    const response = await fetchImpl('/api/auth/login', {
      method: 'POST',
      headers: { 'content-type': 'application/json', accept: 'application/json' },
      body: JSON.stringify({ username, password }),
    })
    const payload = await parse(response)
    if (!response.ok) {
      const error = errorOf(payload)
      throw new AuthApiError(error.code ?? 'LOGIN_FAILED', response.status, error.message ?? '登录失败，请稍后重试', error.requestId)
    }
    const root = record(payload)
    if (!root || typeof root.token !== 'string' || typeof root.username !== 'string' || typeof root.expiresAt !== 'number') {
      throw new AuthApiError('INVALID_RESPONSE', response.status, '登录响应结构异常')
    }
    return { token: root.token, username: root.username, expiresAt: root.expiresAt }
  }

  async function session(token: string): Promise<AuthUser> {
    const response = await fetchImpl('/api/auth/session', { headers: { accept: 'application/json', authorization: `Bearer ${token}` } })
    const payload = await parse(response)
    if (!response.ok) {
      const error = errorOf(payload)
      throw new AuthApiError(error.code ?? 'SESSION_INVALID', response.status, error.message ?? '登录已失效', error.requestId)
    }
    const root = record(payload)
    if (!root || typeof root.username !== 'string' || typeof root.expiresAt !== 'number') {
      throw new AuthApiError('INVALID_RESPONSE', response.status, '会话响应结构异常')
    }
    return { username: root.username, expiresAt: root.expiresAt }
  }

  async function logout(token: string): Promise<void> {
    const response = await fetchImpl('/api/auth/logout', {
      method: 'POST',
      headers: { accept: 'application/json', authorization: `Bearer ${token}` },
    })
    if (!response.ok && response.status !== 401) {
      const payload = await parse(response)
      const error = errorOf(payload)
      throw new AuthApiError(error.code ?? 'LOGOUT_FAILED', response.status, error.message ?? '退出失败', error.requestId)
    }
  }

  return { login, session, logout }
}

export const authApi = createAuthApiClient()
