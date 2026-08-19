import { randomBytes, timingSafeEqual } from 'node:crypto'

/** 登录鉴权错误：携带对外安全文案与 HTTP 状态码，避免泄露账号信息。 */
export class AuthError extends Error {
  constructor(code, message, status) {
    super(message)
    this.name = 'AuthError'
    this.code = code
    this.status = status
  }
}

function safeEqual(left, right) {
  const leftBuffer = Buffer.from(String(left))
  const rightBuffer = Buffer.from(String(right))
  if (leftBuffer.length !== rightBuffer.length) return false
  return timingSafeEqual(leftBuffer, rightBuffer)
}

/**
 * 模拟登录服务（mock）：内存会话表 + 固定演示账号，仅供内部技术验证。
 * 真实生产认证应在接入统一身份体系后替换。
 */
export function createAuthService({
  username = 'admin',
  password = 'admin123',
  tokenTtlMs = 12 * 60 * 60 * 1000,
  now = Date.now,
} = {}) {
  const sessions = new Map()

  function login(candidateUsername, candidatePassword) {
    if (typeof candidateUsername !== 'string' || typeof candidatePassword !== 'string'
      || !candidateUsername || !candidatePassword) {
      throw new AuthError('INVALID_CREDENTIALS', '请输入用户名和密码', 400)
    }
    if (!safeEqual(candidateUsername, username) || !safeEqual(candidatePassword, password)) {
      throw new AuthError('INVALID_CREDENTIALS', '用户名或密码不正确', 401)
    }
    const token = randomBytes(24).toString('base64url')
    const expiresAt = now() + tokenTtlMs
    sessions.set(token, { username, expiresAt })
    return { token, username, expiresAt }
  }

  function verify(token) {
    if (typeof token !== 'string' || !token) return null
    const session = sessions.get(token)
    if (!session) return null
    if (session.expiresAt <= now()) {
      sessions.delete(token)
      return null
    }
    return { username: session.username, expiresAt: session.expiresAt }
  }

  function logout(token) {
    if (typeof token === 'string' && token) sessions.delete(token)
  }

  return { login, verify, logout }
}
