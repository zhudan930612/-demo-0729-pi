<template>
  <div class="login-view">
    <canvas ref="bgCanvas" class="login-bg" aria-hidden="true"></canvas>
    <div class="decor tape" aria-hidden="true"></div>
    <form class="login-card" novalidate @submit.prevent="submit">
      <div class="card-head">
        <span class="logo-ring" aria-hidden="true">农险</span>
        <p class="kicker">草稿版 · 内部技术验证</p>
      </div>

      <h1 class="title">
        农险双精准地图 Demo
        <span class="exclaim" aria-hidden="true">!</span>
      </h1>
      <p class="subtitle">登录后查看地图与业务数据</p>

      <label class="field">
        <span class="field-label">用户名</span>
        <input
          v-model.trim="username"
          class="input"
          type="text"
          name="username"
          autocomplete="username"
          autofocus
          placeholder="请输入用户名"
          :disabled="submitting"
        />
      </label>

      <label class="field">
        <span class="field-label">密码</span>
        <span class="password-wrap">
          <input
            v-model="password"
            class="input"
            :type="showPassword ? 'text' : 'password'"
            name="password"
            autocomplete="current-password"
            placeholder="请输入密码"
            :disabled="submitting"
          />
          <button
            type="button"
            class="reveal"
            :disabled="submitting"
            :aria-label="showPassword ? '隐藏密码' : '显示密码'"
            @click="showPassword = !showPassword"
          >{{ showPassword ? '隐藏' : '显示' }}</button>
        </span>
      </label>

      <p v-if="auth.errorMessage" class="error" role="alert">{{ auth.errorMessage }}</p>

      <button class="submit" type="submit" :disabled="submitting || !username || !password">
        {{ submitting ? '登录中…' : '登录 →' }}
      </button>

      <div class="postit" aria-label="演示账号提示">
        <span class="postit-pin" aria-hidden="true"></span>
        演示账号：admin / admin123
      </div>
    </form>
    <svg class="decor arrow" viewBox="0 0 160 100" aria-hidden="true">
      <path d="M10 20 C 60 20, 80 60, 140 80" fill="none" stroke="#2d2d2d" stroke-width="2" stroke-dasharray="6 4" />
      <path d="M130 70 L 140 80 L 128 82" fill="none" stroke="#2d2d2d" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" />
    </svg>
  </div>
</template>

<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref } from 'vue'
import { useAuthStore } from '../stores/auth'

const auth = useAuthStore()
const username = ref('')
const password = ref('')
const showPassword = ref(false)
const submitting = ref(false)

// —— 手绘风背景：漂浮的铅笔涂鸦 + 纸屑，呼应「草稿纸 + 涂鸦」主题 ——
const bgCanvas = ref<HTMLCanvasElement | null>(null)
const PENCIL = '#2d2d2d'
const BLUE = '#2d5da1'
const RED = '#ff4d4d'

interface Scribble {
  x: number
  y: number
  vx: number
  vy: number
  rot: number
  rotV: number
  kind: 'circle' | 'star' | 'cross' | 'dot' | 'dash' | 'triangle'
  size: number
  color: string
  opacity: number
}

let ctx: CanvasRenderingContext2D | null = null
let scribbles: Scribble[] = []
let width = 0
let height = 0
let raf = 0
let reducedMotion = false

const KINDS: Scribble['kind'][] = ['circle', 'star', 'cross', 'dot', 'dash', 'triangle']
const COLORS = [PENCIL, PENCIL, PENCIL, BLUE, RED, PENCIL] // 铅笔黑为主，点缀蓝/红

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
  const count = Math.min(60, Math.max(24, Math.floor((width * height) / 26000)))
  scribbles = Array.from({ length: count }, () => ({
    x: Math.random() * width,
    y: Math.random() * height,
    vx: (Math.random() - 0.5) * 0.35,
    vy: (Math.random() - 0.5) * 0.25 - 0.08, // 微微上浮
    rot: Math.random() * Math.PI * 2,
    rotV: (Math.random() - 0.5) * 0.012,
    kind: KINDS[Math.floor(Math.random() * KINDS.length)],
    size: 10 + Math.random() * 22,
    color: COLORS[Math.floor(Math.random() * COLORS.length)],
    opacity: 0.18 + Math.random() * 0.22,
  }))
}

// 手绘圆：多段弧线，半径抖动
function drawWobblyCircle(cx: number, cy: number, r: number) {
  const c = ctx!
  const segs = 8
  c.beginPath()
  for (let i = 0; i <= segs; i++) {
    const a = (i / segs) * Math.PI * 2
    const jitter = (Math.sin(i * 3.7 + cx) * 0.5 + Math.cos(i * 2.3 + cy) * 0.4) * r * 0.08
    const x = cx + Math.cos(a) * (r + jitter)
    const y = cy + Math.sin(a) * (r + jitter)
    if (i === 0) c.moveTo(x, y)
    else c.lineTo(x, y)
  }
  c.closePath()
}

// 手绘星星（五角）
function drawWobblyStar(cx: number, cy: number, r: number) {
  const c = ctx!
  const spikes = 5
  const outerR = r
  const innerR = r * 0.45
  c.beginPath()
  for (let i = 0; i <= spikes * 2; i++) {
    const a = (i / (spikes * 2)) * Math.PI * 2 - Math.PI / 2
    const radius = i % 2 === 0 ? outerR : innerR
    const jitter = Math.sin(i * 5.1 + cx) * r * 0.06
    const x = cx + Math.cos(a) * (radius + jitter)
    const y = cy + Math.sin(a) * (radius + jitter)
    if (i === 0) c.moveTo(x, y)
    else c.lineTo(x, y)
  }
  c.closePath()
}

// 手绘叉
function drawCross(cx: number, cy: number, r: number) {
  const c = ctx!
  const off = r * 0.7
  c.beginPath()
  c.moveTo(cx - off + 1, cy - off - 1); c.lineTo(cx + off + 1, cy + off + 1)
  c.moveTo(cx + off - 1, cy - off + 1); c.lineTo(cx - off - 1, cy + off - 1)
}

// 手绘三角
function drawWobblyTriangle(cx: number, cy: number, r: number) {
  const c = ctx!
  const pts = [
    [cx, cy - r * 0.9],
    [cx - r * 0.9, cy + r * 0.7],
    [cx + r * 0.9, cy + r * 0.7],
  ]
  c.beginPath()
  c.moveTo(pts[0][0], pts[0][1])
  for (const [x, y] of pts.slice(1)) c.lineTo(x + Math.sin(y) * 2, y)
  c.closePath()
}

function drawScribble(s: Scribble) {
  const c = ctx!
  c.save()
  c.globalAlpha = s.opacity
  c.strokeStyle = s.color
  c.fillStyle = s.color
  c.lineWidth = 2.2
  c.lineCap = 'round'
  c.lineJoin = 'round'
  c.translate(s.x, s.y)
  c.rotate(s.rot)

  switch (s.kind) {
    case 'circle':
      drawWobblyCircle(0, 0, s.size * 0.5)
      c.stroke()
      break
    case 'star':
      drawWobblyStar(0, 0, s.size * 0.5)
      c.stroke()
      break
    case 'cross':
      drawCross(0, 0, s.size * 0.5)
      c.stroke()
      break
    case 'dot':
      c.beginPath()
      c.arc(0, 0, s.size * 0.15, 0, Math.PI * 2)
      c.fill()
      break
    case 'dash':
      c.beginPath()
      c.moveTo(-s.size * 0.5, 0)
      c.lineTo(s.size * 0.5, Math.sin(s.x) * 2)
      c.stroke()
      break
    case 'triangle':
      drawWobblyTriangle(0, 0, s.size * 0.5)
      c.stroke()
      break
  }
  c.restore()
}

function update() {
  for (const s of scribbles) {
    s.x += s.vx
    s.y += s.vy
    s.rot += s.rotV
    // 环绕
    if (s.x < -30) s.x = width + 30
    else if (s.x > width + 30) s.x = -30
    if (s.y < -30) s.y = height + 30
    else if (s.y > height + 30) s.y = -30
  }
}

function renderFrame() {
  const c = ctx
  if (!c) return
  c.clearRect(0, 0, width, height)
  for (const s of scribbles) drawScribble(s)
}

function loop() {
  update()
  renderFrame()
  raf = requestAnimationFrame(loop)
}

function onResize() {
  resize()
  if (reducedMotion) renderFrame()
}

onMounted(() => {
  ctx = bgCanvas.value?.getContext('2d') ?? null
  if (!ctx) return
  reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches
  resize()
  spawn()
  window.addEventListener('resize', onResize)
  if (reducedMotion) {
    renderFrame() // 尊重减少动效偏好：只画静态一帧
  } else {
    raf = requestAnimationFrame(loop)
  }
})

onBeforeUnmount(() => {
  cancelAnimationFrame(raf)
  window.removeEventListener('resize', onResize)
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
@import url('https://fonts.googleapis.com/css2?family=Kalam:wght@700&family=Patrick+Hand&display=swap');

/* —— 手绘风设计令牌（只用于登录页） —— */
.login-view {
  --paper: #fdfbf7;
  --pencil: #2d2d2d;
  --muted: #e5e0d8;
  --accent-red: #ff4d4d;
  --accent-blue: #2d5da1;
  --postit: #fff9c4;
  --wobbly: 255px 15px 225px 15px / 15px 225px 15px 255px;
  --wobbly-md: 180px 22px 160px 18px / 18px 140px 20px 180px;
  --shadow: 4px 4px 0 0 var(--pencil);
  --shadow-lift: 2px 2px 0 0 var(--pencil);
  --shadow-press: 0 0 0 0 var(--pencil);
  --hand: 'Patrick Hand', 'Kalam', 'PingFang SC', 'Microsoft YaHei', cursive, sans-serif;
  --display: 'Kalam', 'PingFang SC', 'Microsoft YaHei', cursive, sans-serif;

  position: fixed;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  overflow: hidden;
  background-color: var(--paper);
  background-image: radial-gradient(var(--muted) 1.4px, transparent 1.4px);
  background-size: 22px 22px;
  font-family: var(--hand);
  color: var(--pencil);
}

.login-bg {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  pointer-events: none;
  z-index: 0;
}

/* 顶部胶带装饰 */
.decor.tape {
  position: absolute;
  top: -10px;
  left: 50%;
  width: 180px;
  height: 26px;
  transform: translateX(-50%) rotate(-2deg);
  background: rgba(180, 175, 165, 0.55);
  border: 1.5px solid rgba(100, 95, 85, 0.35);
  pointer-events: none;
  z-index: 2;
  animation: tape-sway 5s ease-in-out infinite;
}
@keyframes tape-sway {
  0%, 100% { transform: translateX(-50%) rotate(-2deg); }
  50% { transform: translateX(-50%) rotate(1deg); }
}

/* 手绘箭头装饰（指向表单） */
.decor.arrow {
  position: absolute;
  right: 10%;
  bottom: 16%;
  width: 160px;
  height: 100px;
  opacity: 0.85;
  pointer-events: none;
  z-index: 0;
  animation: arrow-bounce 3.2s ease-in-out infinite;
}
@keyframes arrow-bounce {
  0%, 100% { transform: translateY(0) rotate(-2deg); }
  50% { transform: translateY(-6px) rotate(0deg); }
}

.login-card {
  position: relative;
  z-index: 1;
  width: 420px;
  max-width: calc(100vw - 32px);
  box-sizing: border-box;
  padding: 36px 32px 28px;
  background: #ffffff;
  border: 3px solid var(--pencil);
  border-radius: var(--wobbly-md);
  box-shadow: var(--shadow);
  transform: rotate(-0.6deg);
  transition: transform 100ms ease, box-shadow 100ms ease;
}
.login-card:hover {
  transform: rotate(0deg);
  box-shadow: 6px 6px 0 0 var(--pencil);
}

.card-head {
  display: flex;
  align-items: center;
  gap: 12px;
  margin-bottom: 4px;
}
.logo-ring {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 56px;
  height: 44px;
  font-family: var(--display);
  font-size: 18px;
  font-weight: 700;
  color: var(--pencil);
  border: 3px solid var(--pencil);
  border-radius: var(--wobbly);
  transform: rotate(-4deg);
  background: #ffffff;
}
.kicker {
  margin: 0;
  font-size: 14px;
  font-weight: 400;
  color: var(--accent-blue);
  letter-spacing: 0.01em;
}

.title {
  margin: 14px 0 4px;
  font-family: var(--display);
  font-size: 34px;
  font-weight: 700;
  line-height: 1.05;
  color: var(--pencil);
  letter-spacing: -0.01em;
}
.exclaim {
  display: inline-block;
  color: var(--accent-red);
  transform: rotate(-6deg);
  margin-left: 2px;
  animation: exclaim-wiggle 2.4s ease-in-out infinite;
}
@keyframes exclaim-wiggle {
  0%, 100% { transform: rotate(-6deg); }
  50% { transform: rotate(4deg) translateY(-2px); }
}

.subtitle {
  margin: 0 0 22px;
  font-size: 16px;
  color: var(--pencil);
  opacity: 0.75;
}

.field {
  display: block;
  margin-bottom: 16px;
}
.field-label {
  display: block;
  margin-bottom: 6px;
  font-size: 15px;
  font-weight: 400;
  color: var(--pencil);
}
.input {
  width: 100%;
  box-sizing: border-box;
  height: 44px;
  padding: 0 14px;
  font-family: var(--hand);
  font-size: 16px;
  color: var(--pencil);
  background: #ffffff;
  border: 2.5px solid var(--pencil);
  border-radius: var(--wobbly);
  outline: none;
  transition: border-color 120ms ease, box-shadow 120ms ease, transform 100ms ease;
}
.input::placeholder {
  color: var(--pencil);
  opacity: 0.4;
}
.input:focus {
  border-color: var(--accent-blue);
  box-shadow: 0 0 0 4px rgba(45, 93, 161, 0.22);
  transform: rotate(0.4deg);
}
.input:disabled {
  background: var(--muted);
  color: var(--pencil);
  opacity: 0.6;
}
.password-wrap {
  position: relative;
  display: block;
}
.password-wrap .input {
  padding-right: 68px;
}
.reveal {
  position: absolute;
  right: 8px;
  top: 50%;
  transform: translateY(-50%);
  height: 28px;
  padding: 0 10px;
  border: 2px solid var(--pencil);
  border-radius: var(--wobbly);
  background: #ffffff;
  color: var(--accent-blue);
  font-family: var(--hand);
  font-size: 13px;
  cursor: pointer;
  transition: background-color 100ms ease, transform 100ms ease, box-shadow 100ms ease;
}
.reveal:hover:not(:disabled) {
  background: var(--postit);
  transform: translateY(-50%) rotate(-2deg);
}
.reveal:focus-visible {
  outline: 3px solid rgba(45, 93, 161, 0.35);
  outline-offset: 2px;
}
.reveal:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.error {
  margin: 0 0 14px;
  padding: 10px 12px 10px 14px;
  font-size: 15px;
  font-family: var(--hand);
  color: #8b1a1a;
  background: #fff3f0;
  border: 2.5px dashed var(--accent-red);
  border-radius: var(--wobbly);
}
.error::before {
  content: '⚠';
  margin-right: 6px;
  font-size: 16px;
}

.submit {
  width: 100%;
  height: 48px;
  margin-top: 4px;
  font-family: var(--display);
  font-size: 20px;
  font-weight: 700;
  color: var(--pencil);
  background: #ffffff;
  border: 3px solid var(--pencil);
  border-radius: var(--wobbly);
  cursor: pointer;
  box-shadow: var(--shadow);
  transform: translate(0, 0);
  transition: background-color 100ms ease, color 100ms ease, box-shadow 100ms ease, transform 100ms ease;
}
.submit:hover:not(:disabled) {
  background: var(--accent-red);
  color: #ffffff;
  box-shadow: var(--shadow-lift);
  transform: translate(2px, 2px) rotate(-0.6deg);
}
.submit:active:not(:disabled) {
  box-shadow: var(--shadow-press);
  transform: translate(4px, 4px);
}
.submit:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

/* 便签纸式演示账号提示 */
.postit {
  position: relative;
  margin: 20px auto 0;
  width: fit-content;
  padding: 8px 14px;
  background: var(--postit);
  border: 2.5px solid var(--pencil);
  border-radius: var(--wobbly);
  box-shadow: 3px 3px 0 0 var(--pencil);
  font-family: var(--hand);
  font-size: 14px;
  color: var(--pencil);
  transform: rotate(-1.4deg);
  animation: postit-flutter 4s ease-in-out infinite;
}
@keyframes postit-flutter {
  0%, 100% { transform: rotate(-1.4deg) translateY(0); }
  50% { transform: rotate(-0.6deg) translateY(-2px); }
}
.postit-pin {
  position: absolute;
  top: -8px;
  left: 50%;
  transform: translateX(-50%);
  width: 14px;
  height: 14px;
  border-radius: 50%;
  background: var(--accent-red);
  border: 2px solid var(--pencil);
  box-shadow: 1px 1px 0 0 var(--pencil);
}

/* 减少动效偏好 */
@media (prefers-reduced-motion: reduce) {
  .decor.tape,
  .decor.arrow,
  .exclaim,
  .postit {
    animation: none;
  }
}

/* 响应式 */
@media (max-width: 520px) {
  .login-card {
    padding: 28px 20px 22px;
  }
  .title { font-size: 26px; }
  .submit { font-size: 17px; height: 44px; }
  .decor.arrow { display: none; }
  .decor.tape { width: 130px; }
}
</style>
