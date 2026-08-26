import { defineStore } from 'pinia'
import { authApi, type AuthApiClient } from '../api/auth'
import { clearStoredAuth, loadStoredAuth, saveStoredAuth } from './authStorage'

export type AuthStatus = 'checking' | 'authenticated' | 'unauthenticated'

export const useAuthStore = defineStore('auth', {
  state: () => ({
    token: null as string | null,
    username: '',
    status: 'checking' as AuthStatus,
    errorMessage: '',
  }),
  getters: {
    isAuthenticated: (s) => s.status === 'authenticated' && Boolean(s.token),
    isChecking: (s) => s.status === 'checking',
  },
  actions: {
    async login(username: string, password: string, client: AuthApiClient = authApi) {
      this.errorMessage = ''
      try {
        const session = await client.login(username, password)
        this.token = session.token
        this.username = session.username
        this.status = 'authenticated'
        saveStoredAuth({ token: session.token, username: session.username })
      } catch (error) {
        this.errorMessage = error instanceof Error ? error.message : '登录失败，请稍后重试'
        throw error
      }
    },
    async restore(client: AuthApiClient = authApi) {
      const stored = loadStoredAuth()
      if (!stored) {
        this.status = 'unauthenticated'
        return
      }
      try {
        const user = await client.session(stored.token)
        this.token = stored.token
        this.username = user.username
        this.status = 'authenticated'
      } catch {
        clearStoredAuth()
        this.status = 'unauthenticated'
      }
    },
    /** 等待首次会话恢复完成；路由守卫据此拿到已解析的登录态。 */
    async ensureReady(client: AuthApiClient = authApi) {
      if (this.status !== 'checking') return
      try {
        await this.restore(client)
      } catch {
        // restore 内部已处理异常并置为未登录态，这里兜底
      }
    },
    async logout(client: AuthApiClient = authApi) {
      const token = this.token
      this.token = null
      this.username = ''
      this.status = 'unauthenticated'
      this.errorMessage = ''
      clearStoredAuth()
      if (token) {
        try { await client.logout(token) } catch { /* 本地已退出，忽略服务端错误 */ }
      }
    },
  },
})
