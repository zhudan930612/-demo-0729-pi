import { createRouter, createWebHistory, type RouteRecordRaw } from 'vue-router'
import LoginView from './components/LoginView.vue'
import HomeView from './components/HomeView.vue'
import { useAuthStore } from './stores/auth'

const routes: RouteRecordRaw[] = [
  { path: '/login', name: 'login', component: LoginView, meta: { public: true } },
  { path: '/', name: 'home', component: HomeView, meta: { requiresAuth: true } },
  { path: '/:pathMatch(.*)*', redirect: '/' },
]

export const router = createRouter({
  history: createWebHistory(),
  routes,
})

router.beforeEach(async (to) => {
  const auth = useAuthStore()
  // 首次进入前先恢复本地会话，确保守卫基于已解析的登录态判断
  if (auth.status === 'checking') {
    await auth.ensureReady()
  }
  if (to.meta.requiresAuth && !auth.isAuthenticated) {
    return { path: '/login' }
  }
  // /login 始终直接显示登录页（即使已登录也停留在登录页），由用户自行决定是否再次登录。
  return true
})

export default router
