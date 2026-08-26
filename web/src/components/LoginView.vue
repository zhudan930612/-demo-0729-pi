<template>
  <div class="login-view">
    <!-- 背景轮播区 -->
    <div class="bg-slider" aria-hidden="true">
      <!-- 底图：常驻 -->
      <div class="bg-slide bg-base" :style="{ backgroundImage: `url('${baseSlide}')` }"></div>

      <!-- 6 张覆盖图：依次播放 -->
      <div v-for="(slide, index) in overlaySlides" :key="index" class="bg-slide" :class="slideClass(index)" :style="{ backgroundImage: `url('${slide.url}')` }"></div>
    </div>

    <div class="product-box"></div>

    <!-- 登录卡片 -->
    <div class="login-wrapper">
      <form class="login-card" novalidate @submit.prevent="submit">
        <div class="card-header">
          <span class="logo-icon" aria-hidden="true">🌾</span>
          <div class="card-title-group">
            <h1 class="card-title">农险双精准地图</h1>
            <p class="card-subtitle">内部技术验证工作台</p>
          </div>
        </div>

        <label class="field">
          <span class="field-label">用户名</span>
          <input v-model.trim="username" class="input" type="text" name="username" autocomplete="username" autofocus placeholder="请输入用户名" :disabled="submitting" />
        </label>

        <label class="field">
          <span class="field-label">密码</span>
          <span class="password-wrap">
            <input v-model="password" class="input" :type="showPassword ? 'text' : 'password'" name="password" autocomplete="current-password" placeholder="请输入密码" :disabled="submitting" />
            <button type="button" class="reveal" :disabled="submitting" :aria-label="showPassword ? '隐藏密码' : '显示密码'" @click="showPassword = !showPassword">
              {{ showPassword ? '隐藏' : '显示' }}
            </button>
          </span>
        </label>

        <p v-if="auth.errorMessage" class="error" role="alert">{{ auth.errorMessage }}</p>

        <button class="submit" type="submit" :disabled="submitting || !username || !password">
          {{ submitting ? '登录中…' : '登 录' }}
        </button>

        <div class="demo-hint">演示账号：admin / admin123</div>
      </form>

      <p class="footer-text">© 2024 农险双精准地图 Demo · 内部技术验证</p>
    </div>
  </div>
</template>

<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref } from 'vue';
import { useRouter } from 'vue-router';
import { useAuthStore } from '../stores/auth';

const router = useRouter();
const auth = useAuthStore();
const username = ref('');
const password = ref('');
const showPassword = ref(false);
const submitting = ref(false);

// —— 底图（常驻） ——
const baseSlide = '/login/dataProduct_01.f1a826ca.webp';

// —— 6 张覆盖图 + 各自进场类型 ——
const overlaySlides = [
  { url: '/login/dataProduct_02_b.085ba46e.webp', enterType: 'inset' }, // 从右向左揭示
  { url: '/login/dataProduct_03_r.51c11ac2.webp', enterType: 'circle-tr' }, // 从右上角圆形展开
  { url: '/login/dataProduct_04_w.fa8dacce.webp', enterType: 'fade' }, // 淡入
  { url: '/login/dataProduct_05_v.6e39d4b9.webp', enterType: 'circle-bl' }, // 从左下角圆形展开
  { url: '/login/dataProduct_06_s1.13923a35.webp', enterType: 'fade' }, // 淡入
  { url: '/login/dataProduct_07_ao.c30812ed.webp', enterType: 'fade' }, // 淡入
];

// 动画时序
const ENTER_MS = 1500; // 每张图进场 1.5s
const ALL_VISIBLE_MS = 3500; // 全部显示后停留 3.5s
const EXIT_MS = 1500; // 一起淡出 1.5s
const BASE_MS = 1500; // 底图独享 1.5s

// 每张覆盖图的状态：hidden / entering / visible / exiting
const slideStates = ref(overlaySlides.map(() => 'hidden' as 'hidden' | 'entering' | 'visible' | 'exiting'));
let slideTimer: ReturnType<typeof setTimeout> | undefined;

function slideClass(index: number) {
  const state = slideStates.value[index];
  if (state === 'hidden') return 'slide-hidden';
  return [`slide-${state}`, `enter-${overlaySlides[index].enterType}`];
}

function runSlideSequence() {
  const run = () => {
    // 阶段 1：依次进场（每张间隔 1.5s）
    let entered = 0;
    const enterNext = () => {
      if (entered < overlaySlides.length) {
        slideStates.value[entered] = 'entering';
        entered++;
        slideTimer = setTimeout(enterNext, ENTER_MS);
      } else {
        // 阶段 2：全部进入 visible
        slideStates.value = slideStates.value.map(() => 'visible');
        slideTimer = setTimeout(() => {
          // 阶段 3：一起淡出
          slideStates.value = slideStates.value.map(() => 'exiting');
          slideTimer = setTimeout(() => {
            // 阶段 4：回到底图
            slideStates.value = slideStates.value.map(() => 'hidden');
            slideTimer = setTimeout(run, BASE_MS);
          }, EXIT_MS);
        }, ALL_VISIBLE_MS);
      }
    };
    slideTimer = setTimeout(enterNext, 1500); // 初始 1.5s 底图展示
  };
  run();
}

onMounted(() => {
  runSlideSequence();
});

onBeforeUnmount(() => {
  if (slideTimer !== undefined) clearTimeout(slideTimer);
});

async function submit() {
  if (submitting.value || !username.value || !password.value) return;
  submitting.value = true;
  try {
    await auth.login(username.value, password.value);
    await router.push('/');
  } catch {
    // 错误文案已写入 store.errorMessage，交由模板展示。
  } finally {
    submitting.value = false;
  }
}
</script>

<style scoped>
.login-view {
  position: fixed;
  inset: 0;
  width: 100%;
  height: 100%;
  overflow: hidden;
  display: flex;
  align-items: center;
  justify-content: center;
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', 'PingFang SC', 'Microsoft YaHei', sans-serif;
}

/* ===== 背景轮播 ===== */
.bg-slider {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  z-index: 0;
}
.product-box {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  z-index: 1;
  background: linear-gradient(180deg, rgba(0, 0, 2, 0.4), rgba(32, 32, 32, 0.06));
}

.bg-slide {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  background-size: cover;
  background-position: center;
  background-repeat: no-repeat;
}

/* 底图：常驻显示 */
.bg-base {
  opacity: 1;
  z-index: 1;
}

/* 覆盖图默认隐藏 */
.slide-hidden {
  opacity: 0;
  pointer-events: none;
  z-index: 2;
}

/* ===== 进场动画 ===== */

/* 类型 1：inset 揭示（从右向左） */
.slide-entering.enter-inset {
  animation: enter-inset 1.5s cubic-bezier(0.4, 0, 0.2, 1) forwards;
  z-index: 3;
}
@keyframes enter-inset {
  0% {
    clip-path: inset(0 100% 0 0);
    opacity: 1;
  }
  100% {
    clip-path: inset(0 0 0 0);
    opacity: 1;
  }
}

/* 类型 2：从右上角圆形展开 */
.slide-entering.enter-circle-tr {
  animation: enter-circle-tr 1.5s cubic-bezier(0.4, 0, 0.2, 1) forwards;
  z-index: 3;
}
@keyframes enter-circle-tr {
  0% {
    clip-path: circle(0% at 100% 0%);
    opacity: 1;
  }
  100% {
    clip-path: circle(150%);
    opacity: 1;
  }
}

/* 类型 3：淡入 */
.slide-entering.enter-fade {
  animation: enter-fade 1.5s ease-in-out forwards;
  z-index: 3;
}
@keyframes enter-fade {
  0% {
    opacity: 0;
  }
  100% {
    opacity: 1;
  }
}

/* 类型 4：从左下角圆形展开 */
.slide-entering.enter-circle-bl {
  animation: enter-circle-bl 1.5s cubic-bezier(0.4, 0, 0.2, 1) forwards;
  z-index: 3;
}
@keyframes enter-circle-bl {
  0% {
    clip-path: circle(0% at 0% 100%);
    opacity: 0;
  }
  100% {
    clip-path: circle(150%);
    opacity: 1;
  }
}

/* ===== 显示状态 ===== */
.slide-visible {
  opacity: 1;
  z-index: 3;
}

/* ===== 退场动画（统一淡出） ===== */
.slide-exiting {
  animation: exit-fade 1.5s ease-in-out forwards;
  z-index: 3;
}
@keyframes exit-fade {
  0% {
    opacity: 1;
  }
  100% {
    opacity: 0;
  }
}

/* ===== 登录卡片 ===== */
.login-wrapper {
  position: relative;
  z-index: 10;
  width: 100%;
  max-width: 440px;
  padding: 0 20px;
}

.login-card {
  background: rgba(255, 255, 255, 0.95);
  backdrop-filter: blur(20px);
  border-radius: 16px;
  padding: 40px 36px 32px;
  box-shadow:
    0 20px 60px rgba(0, 0, 0, 0.3),
    0 0 0 1px rgba(255, 255, 255, 0.1);
}

.card-header {
  display: flex;
  align-items: center;
  gap: 14px;
  margin-bottom: 28px;
}

.logo-icon {
  font-size: 32px;
  width: 48px;
  height: 48px;
  display: flex;
  align-items: center;
  justify-content: center;
  background: linear-gradient(135deg, #4a7c23 0%, #2d3a1e 100%);
  border-radius: 12px;
  flex-shrink: 0;
}

.card-title-group {
  flex: 1;
  min-width: 0;
}

.card-title {
  margin: 0 0 4px;
  font-size: 22px;
  font-weight: 700;
  color: #2d3a1e;
  letter-spacing: -0.01em;
}

.card-subtitle {
  margin: 0;
  font-size: 13px;
  color: #6b7a5f;
}

.field {
  display: block;
  margin-bottom: 18px;
}

.field-label {
  display: block;
  margin-bottom: 8px;
  font-size: 14px;
  font-weight: 500;
  color: #2d3a1e;
}

.input {
  width: 100%;
  box-sizing: border-box;
  height: 44px;
  padding: 0 16px;
  font-size: 15px;
  color: #2d3a1e;
  background: #ffffff;
  border: 1.5px solid #d4e0c8;
  border-radius: 10px;
  outline: none;
  transition:
    border-color 150ms ease,
    box-shadow 150ms ease;
}

.input::placeholder {
  color: #9aa88f;
}

.input:focus {
  border-color: #4a7c23;
  box-shadow: 0 0 0 3px rgba(74, 124, 35, 0.12);
}

.input:disabled {
  background: #f5f7f3;
  color: #6b7a5f;
}

.password-wrap {
  position: relative;
  display: block;
}

.password-wrap .input {
  padding-right: 72px;
}

.reveal {
  position: absolute;
  right: 8px;
  top: 50%;
  transform: translateY(-50%);
  height: 30px;
  padding: 0 12px;
  border: 1px solid #d4e0c8;
  border-radius: 6px;
  background: #ffffff;
  color: #4a7c23;
  font-size: 13px;
  font-weight: 500;
  cursor: pointer;
  transition:
    background-color 150ms ease,
    border-color 150ms ease;
}

.reveal:hover:not(:disabled) {
  background: #f5f9f0;
  border-color: #4a7c23;
}

.reveal:focus-visible {
  outline: 2px solid #4a7c23;
  outline-offset: 2px;
}

.reveal:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.error {
  margin: 0 0 16px;
  padding: 12px 14px;
  font-size: 14px;
  color: #c0392b;
  background: #fdf2f0;
  border: 1px solid #f5c6cb;
  border-radius: 8px;
}

.submit {
  width: 100%;
  height: 48px;
  margin-top: 4px;
  font-size: 16px;
  font-weight: 600;
  color: #ffffff;
  background: linear-gradient(135deg, #4a7c23 0%, #2d3a1e 100%);
  border: none;
  border-radius: 10px;
  cursor: pointer;
  transition:
    opacity 150ms ease,
    transform 100ms ease,
    box-shadow 150ms ease;
  box-shadow: 0 4px 12px rgba(74, 124, 35, 0.3);
}

.submit:hover:not(:disabled) {
  opacity: 0.92;
  transform: translateY(-1px);
  box-shadow: 0 6px 16px rgba(74, 124, 35, 0.4);
}

.submit:active:not(:disabled) {
  transform: translateY(0);
  box-shadow: 0 2px 8px rgba(74, 124, 35, 0.25);
}

.submit:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.demo-hint {
  margin-top: 20px;
  text-align: center;
  font-size: 13px;
  color: #8b9a7f;
}

.footer-text {
  margin-top: 24px;
  text-align: center;
  font-size: 12px;
  color: rgba(255, 255, 255, 0.6);
  letter-spacing: 0.01em;
}

/* 响应式 */
@media (max-width: 480px) {
  .login-card {
    padding: 32px 24px 24px;
  }
  .card-title {
    font-size: 19px;
  }
  .logo-icon {
    width: 42px;
    height: 42px;
    font-size: 28px;
  }
}
</style>
