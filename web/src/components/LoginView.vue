<template>
  <div class="login-view">
    <canvas ref="bgCanvas" class="login-bg" aria-hidden="true"></canvas>
    <span class="login-vortex" aria-hidden="true"></span>
    <span class="login-radar" aria-hidden="true"></span>
    <form class="login-card" novalidate @submit.prevent="submit">
      <p class="kicker">农业保险 · 空间数据</p>
      <h1 class="title">农险双精准地图 Demo</h1>
      <p class="subtitle">内部技术验证工作台，登录后查看地图与业务数据</p>

      <label class="field">
        <span class="field-label">用户名</span>
        <input
          v-model.trim="username"
          class="input"
          type="text"
          name="username"
          autocomplete="username"
          placeholder="请输入用户名"
          :disabled="submitting"
        />
      </label>

      <label class="field">
        <span class="field-label">密码</span>
        <input
          v-model="password"
          class="input"
          type="password"
          name="password"
          autocomplete="current-password"
          placeholder="请输入密码"
          :disabled="submitting"
        />
      </label>

      <p v-if="auth.errorMessage" class="error" role="alert">{{ auth.errorMessage }}</p>

      <button class="submit" type="submit" :disabled="submitting || !username || !password">
        {{ submitting ? '登录中…' : '登录' }}
      </button>

      <p class="hint">演示账号：admin / admin123</p>
    </form>
  </div>
</template>

<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref } from 'vue'
import { useAuthStore } from '../stores/auth'

const auth = useAuthStore()
const username = ref('')
const password = ref('')
const submitting = ref(false)

// —— 连线粒子网络背景（呼应参考登录页的 particleground 效果）——
const bgCanvas = ref<HTMLCanvasElement | null>(null)
const COLORS = ['#38bdf8', '#3b82f6', '#2563eb', '#7dd3fc']
const LINK_DIST = 130 // 粒子/鼠标连线距离
const MOUSE_DIST = 180 // 鼠标排斥作用半径

interface Particle {
  x: number
  y: number
  vx: number
  vy: number
  r: number
  color: string
}

let ctx: CanvasRenderingContext2D | null = null
let particles: Particle[] = []
let width = 0
let height = 0
let raf = 0
const mouse = { x: -9999, y: -9999 }

function resize() {
  const canvas = bgCanvas.value
  if (!canvas) return
  const dpr = Math.min(window.devicePixelRatio || 1, 2)
  width = window.innerWidth
  height = window.innerHeight
  canvas.width = Math.floor(width * dpr)
  canvas.height = Math.floor(height * dpr)
  canvas.style.width = `${width}px`
  canvas.style.height = `${height}px`
  ctx?.setTransform(dpr, 0, 0, dpr, 0, 0)
}

function spawn() {
  const count = Math.min(90, Math.max(40, Math.floor((width * height) / 16000)))
  particles = Array.from({ length: count }, () => ({
    x: Math.random() * width,
    y: Math.random() * height,
    vx: (Math.random() - 0.5) * 0.45,
    vy: (Math.random() - 0.5) * 0.45,
    r: Math.random() * 1.6 + 0.7,
    color: COLORS[Math.floor(Math.random() * COLORS.length)],
  }))
}

function onMouseMove(event: MouseEvent) {
  mouse.x = event.clientX
  mouse.y = event.clientY
}

function drawLink(aX: number, aY: number, bX: number, bY: number) {
  const c = ctx
  if (!c) return
  const dist = Math.hypot(aX - bX, aY - bY)
  if (dist >= LINK_DIST) return
  const alpha = (1 - dist / LINK_DIST) * 0.32
  c.strokeStyle = `rgba(56, 189, 248, ${alpha})`
  c.lineWidth = 1
  c.beginPath()
  c.moveTo(aX, aY)
  c.lineTo(bX, bY)
  c.stroke()
}

function loop() {
  const c = ctx
  if (!c) return
  c.clearRect(0, 0, width, height)

  for (const p of particles) {
    p.x += p.vx
    p.y += p.vy
    const dx = p.x - mouse.x
    const dy = p.y - mouse.y
    const dist = Math.hypot(dx, dy)
    if (dist < MOUSE_DIST && dist > 0.01) {
      const force = ((MOUSE_DIST - dist) / MOUSE_DIST) * 0.9
      p.x += (dx / dist) * force
      p.y += (dy / dist) * force
    }
    if (p.x < -20) p.x = width + 20
    else if (p.x > width + 20) p.x = -20
    if (p.y < -20) p.y = height + 20
    else if (p.y > height + 20) p.y = -20
  }

  for (let i = 0; i < particles.length; i++) {
    const a = particles[i]
    for (let j = i + 1; j < particles.length; j++) {
      drawLink(a.x, a.y, particles[j].x, particles[j].y)
    }
    drawLink(a.x, a.y, mouse.x, mouse.y)
  }

  for (const p of particles) {
    c.fillStyle = p.color
    c.globalAlpha = 0.75
    c.beginPath()
    c.arc(p.x, p.y, p.r, 0, Math.PI * 2)
    c.fill()
  }
  c.globalAlpha = 1

  raf = requestAnimationFrame(loop)
}

onMounted(() => {
  ctx = bgCanvas.value?.getContext('2d') ?? null
  if (!ctx) return
  resize()
  spawn()
  window.addEventListener('resize', resize)
  window.addEventListener('mousemove', onMouseMove)
  raf = requestAnimationFrame(loop)
})

onBeforeUnmount(() => {
  cancelAnimationFrame(raf)
  window.removeEventListener('resize', resize)
  window.removeEventListener('mousemove', onMouseMove)
})

async function submit() {
  if (submitting.value || !username.value || !password.value) return
  submitting.value = true
  try {
    await auth.login(username.value, password.value)
  } catch {
    // 错误文案已写入 store.errorMessage，交由模板展示。
  } finally {
    submitting.value = false
  }
}
</script>

<style scoped>
.login-view {
  position: fixed;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  overflow: hidden;
  background:
    radial-gradient(900px 520px at 100% 100%, rgba(56, 189, 248, 0.16), transparent 60%),
    radial-gradient(720px 440px at 0% 0%, rgba(37, 99, 235, 0.16), transparent 60%),
    linear-gradient(158deg, #0a111f 0%, #0f172a 46%, #14233d 100%);
  font-family: 'PingFang SC', 'Microsoft YaHei', sans-serif;
}
.login-bg {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  pointer-events: none;
}
/* 地图坐标网格：斜向平移，边缘径向淡出 */
.login-view::before {
  content: '';
  position: absolute;
  inset: -2px;
  background-image:
    linear-gradient(rgba(148, 163, 184, 0.1) 1px, transparent 1px),
    linear-gradient(90deg, rgba(148, 163, 184, 0.1) 1px, transparent 1px);
  background-size: 44px 44px;
  -webkit-mask-image: radial-gradient(ellipse 85% 75% at 50% 42%, rgba(0, 0, 0, 0.65), transparent 80%);
  mask-image: radial-gradient(ellipse 85% 75% at 50% 42%, rgba(0, 0, 0, 0.65), transparent 80%);
  animation: login-grid-pan 16s linear infinite;
  pointer-events: none;
}
/* 极光光斑：大块蓝色柔光漂移 */
.login-view::after {
  content: '';
  position: absolute;
  left: -160px;
  top: -200px;
  width: 680px;
  height: 680px;
  border-radius: 50%;
  background: radial-gradient(circle, rgba(37, 99, 235, 0.38), transparent 62%);
  filter: blur(70px);
  animation: login-aurora 9s ease-in-out infinite alternate;
  pointer-events: none;
}
/* 台风涡旋：左上角旋转的螺旋雨带，呼应台风专题 */
.login-vortex {
  position: absolute;
  left: -140px;
  top: -140px;
  width: 560px;
  height: 560px;
  border-radius: 50%;
  opacity: 0.75;
  background: conic-gradient(from 0deg,
    transparent 0deg,
    rgba(37, 99, 235, 0.22) 40deg,
    transparent 90deg,
    rgba(56, 189, 248, 0.18) 150deg,
    transparent 200deg,
    rgba(37, 99, 235, 0.16) 260deg,
    transparent 360deg);
  -webkit-mask-image: radial-gradient(circle, transparent 0 30%, #000 30% 76%, transparent 76%);
  mask-image: radial-gradient(circle, transparent 0 30%, #000 30% 76%, transparent 76%);
  animation: login-vortex-spin 20s linear infinite;
  pointer-events: none;
}
/* 雷达：同心圆量程环 + 旋转扫描波束 */
.login-radar {
  position: absolute;
  right: 9%;
  bottom: 11%;
  width: 280px;
  height: 280px;
  border-radius: 50%;
  opacity: 0.75;
  pointer-events: none;
  background:
    radial-gradient(circle, rgba(56, 189, 248, 0.9) 0 2px, transparent 3px),
    repeating-radial-gradient(circle, transparent 0 46px, rgba(56, 189, 248, 0.25) 46px 47px);
}
.login-radar::before {
  content: '';
  position: absolute;
  inset: 0;
  border-radius: 50%;
  background: conic-gradient(from 0deg, rgba(56, 189, 248, 0.4), transparent 70deg);
  animation: login-radar-spin 4s linear infinite;
}
.login-radar::after {
  content: '';
  position: absolute;
  inset: 0;
  border-radius: 50%;
  border: 1px solid rgba(56, 189, 248, 0.35);
}
@keyframes login-grid-pan {
  from { background-position: 0 0, 0 0; }
  to { background-position: 44px 44px, 44px 44px; }
}
@keyframes login-aurora {
  from { transform: translate3d(0, 0, 0) scale(1); }
  to { transform: translate3d(240px, 180px, 0) scale(1.15); }
}
@keyframes login-vortex-spin {
  to { transform: rotate(360deg); }
}
@keyframes login-radar-spin {
  to { transform: rotate(360deg); }
}
.login-card {
  position: relative;
  z-index: 1;
  width: 360px;
  max-width: calc(100vw - 32px);
  box-sizing: border-box;
  padding: 32px 28px 24px;
  background: #ffffff; /* panel-white */
  border-radius: 14px; /* rounded.dialog */
  box-shadow: 0 22px 50px rgba(15, 23, 42, 0.42); /* 确认对话框阴影（深底加深） */
}
.kicker {
  margin: 0 0 6px;
  font-size: 12px;
  font-weight: 600;
  color: #2563eb; /* action-blue */
  letter-spacing: 0.02em;
}
.title {
  margin: 0 0 6px;
  font-size: 20px;
  font-weight: 700;
  color: #0f172a; /* canvas-slate */
}
.subtitle {
  margin: 0 0 24px;
  font-size: 12px;
  color: #64748b; /* muted-slate */
}
.field {
  display: block;
  margin-bottom: 14px;
}
.field-label {
  display: block;
  margin-bottom: 6px;
  font-size: 13px;
  font-weight: 600;
  color: #475569; /* ink-slate */
}
.input {
  width: 100%;
  box-sizing: border-box;
  height: 34px;
  padding: 0 12px;
  font-size: 13px;
  color: #0f172a;
  border: 1px solid rgba(148, 163, 184, 0.34); /* panel-border */
  border-radius: 7px; /* rounded.control */
  outline: none;
  transition: border-color 160ms ease, box-shadow 160ms ease;
}
.input:focus {
  border-color: #2563eb;
  box-shadow: 0 0 0 3px rgba(37, 99, 235, 0.18);
}
.input:disabled {
  background: #f1f5f9;
  color: #94a3b8; /* disabled-slate */
}
.error {
  margin: 0 0 14px;
  padding: 8px 10px;
  font-size: 12px;
  color: #991b1b; /* error-text */
  background: #fef2f2; /* error-bg */
  border-radius: 6px; /* rounded.hint */
}
.submit {
  width: 100%;
  height: 34px;
  margin-top: 2px;
  font-size: 13px;
  font-weight: 600;
  color: #ffffff;
  background: #2563eb; /* action-blue */
  border: none;
  border-radius: 7px;
  cursor: pointer;
  transition: background-color 160ms ease;
}
.submit:hover:not(:disabled) {
  background: #1d4ed8; /* action-blue-hover */
}
.submit:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}
.hint {
  margin: 16px 0 0;
  font-size: 12px;
  color: #94a3b8; /* disabled-slate */
  text-align: center;
}
</style>
