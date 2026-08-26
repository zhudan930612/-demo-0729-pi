import { describe, expect, it } from 'vitest'
import { clearStoredAuth, loadStoredAuth, saveStoredAuth } from './authStorage'

function memoryStorage(initial: Record<string, string> = {}): Storage {
  const map = new Map(Object.entries(initial))
  return {
    getItem: (key: string) => map.get(key) ?? null,
    setItem: (key: string, value: string) => { map.set(key, value) },
    removeItem: (key: string) => { map.delete(key) },
    clear: () => map.clear(),
    key: (index: number) => [...map.keys()][index] ?? null,
    get length() { return map.size },
  } as Storage
}

describe('authStorage', () => {
  it('保存后可读回，清除后不可读', () => {
    const storage = memoryStorage()
    expect(saveStoredAuth({ token: 'tok', username: 'admin' }, storage)).toBe(true)
    expect(loadStoredAuth(storage)).toEqual({ token: 'tok', username: 'admin' })
    clearStoredAuth(storage)
    expect(loadStoredAuth(storage)).toBeNull()
  })

  it('损坏或缺少字段的数据按未登录处理', () => {
    const storage = memoryStorage({ 'agri-map:auth:v1': '{bad json' })
    expect(loadStoredAuth(storage)).toBeNull()
    expect(loadStoredAuth(memoryStorage({ 'agri-map:auth:v1': JSON.stringify({ username: 'x' }) }))).toBeNull()
  })

  it('无可用存储时不抛错', () => {
    expect(loadStoredAuth(undefined)).toBeNull()
    expect(saveStoredAuth({ token: 'tok', username: 'admin' }, undefined)).toBe(false)
  })
})
