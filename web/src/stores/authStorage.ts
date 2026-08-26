const AUTH_STORAGE_KEY = 'agri-map:auth:v1'

export interface StoredAuth {
  token: string
  username: string
}

function browserStorage(storage?: Storage): Storage | null {
  if (storage) return storage
  try {
    if (typeof window === 'undefined' || !window.localStorage) return null
    return window.localStorage
  } catch {
    return null
  }
}

export function loadStoredAuth(storage?: Storage): StoredAuth | null {
  const resolved = browserStorage(storage)
  if (!resolved) return null
  try {
    const raw = resolved.getItem(AUTH_STORAGE_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw) as Partial<StoredAuth>
    if (typeof parsed.token === 'string' && parsed.token && typeof parsed.username === 'string') {
      return { token: parsed.token, username: parsed.username }
    }
    return null
  } catch {
    return null
  }
}

export function saveStoredAuth(auth: StoredAuth, storage?: Storage): boolean {
  const resolved = browserStorage(storage)
  if (!resolved) return false
  try {
    resolved.setItem(AUTH_STORAGE_KEY, JSON.stringify(auth))
    return true
  } catch {
    return false
  }
}

export function clearStoredAuth(storage?: Storage): void {
  const resolved = browserStorage(storage)
  if (!resolved) return
  try { resolved.removeItem(AUTH_STORAGE_KEY) } catch { /* 忽略：本地清理失败不影响内存态退出 */ }
}
