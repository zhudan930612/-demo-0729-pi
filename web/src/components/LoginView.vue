<!--
DIRECTION: 全屏统一过渡背景 · 左品牌声明 / 右登录浮窗
- 背景：卫星影像 + 深靛蓝→透明渐变贯穿全宽（左靛蓝品牌wash，往右渐隐透出影像），参考遥感"一张图"的过渡
- 左：logo + 产品名 + slogan + 能力标签，浮于左侧靛蓝上
- 右：登录窗（登录系统）浮于右侧影像上，深色玻璃卡
- 无硬分割/无独立右侧底色块；移动端纵向堆叠
- 保留 .login-card 类名 + 字段结构，登录 e2e 不受影响
-->

<template>
  <div class="login-view">
    <!-- 全屏背景：卫星影像轮播 + 靛蓝过渡 -->
    <div class="bg-slider" aria-hidden="true">
      <div class="bg-slide bg-base" :style="{ backgroundImage: `url('${baseSlide}')` }"></div>
      <div v-for="(slide, index) in overlaySlides" :key="index" class="bg-slide" :class="slideClass(index)" :style="{ backgroundImage: `url('${slide.url}')` }"></div>
      <div class="tech-layer">
        <div class="tech-grid"></div>
        <div class="tech-orb orb-a"></div>
        <div class="tech-orb orb-b"></div>
        <div class="tech-orb orb-c"></div>
      </div>
    </div>
    <div class="bg-scrim" aria-hidden="true"></div>

    <!-- 左：品牌声明 -->
    <div class="brand-content">
      <div class="brand-head">
        <span class="brand-mark">
          <svg viewBox="0 0 24 24" width="26" height="26" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
            <path d="M12 21c-3.8 0-6.5-2.7-6.5-6.3C5.5 10.5 9 6.8 12 3c3 3.8 6.5 7.5 6.5 11.7 0 3.6-2.7 6.3-6.5 6.3Z" />
            <path d="M12 21v-6m0 0-2.2-2.2M12 15l2.2-2.2" />
          </svg>
        </span>
        <h1 class="brand-title">农保云<span class="brand-accent">AI</span>智能风控管理平台</h1>
      </div>
      <p class="brand-slogan">看清每一个异常，管好每一分经营</p>

      <div class="brand-pillars">
        <div class="pillar">
          <span class="pillar-icon">
            <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
              <rect x="4" y="3" width="16" height="18" rx="2" />
              <path d="M8 7h8M8 11h8M8 15h4" />
            </svg>
          </span>
          <span class="pillar-text"><strong>高分遥感</strong><em>空天观测 · 灾情空间监测</em></span>
        </div>
        <div class="pillar">
          <span class="pillar-icon">
            <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
              <circle cx="12" cy="12" r="2" />
              <path d="M12 5v3m0 8v3M5 12h3m8 0h3" />
            </svg>
          </span>
          <span class="pillar-text"><strong>AI 风控</strong><em>灾害指标 · 多元智能研判</em></span>
        </div>
        <div class="pillar">
          <span class="pillar-icon">
            <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
              <path d="M12 3 L19 5.5 V12 C19 16 16 18.4 12 20 C8 18.4 5 16 5 12 V5.5 Z" />
              <path d="M9 12 l2 2 l4 -4" />
            </svg>
          </span>
          <span class="pillar-text"><strong>智能协同</strong><em>异常即派 · 线上线下联动</em></span>
        </div>
      </div>
    </div>

    <!-- 右：登录浮窗 -->
    <div class="form-wrap">
      <div class="card-wrap">
        <form class="login-card" novalidate @submit.prevent="submit">
        <header class="card-head">
          <h2 class="card-title">登录系统</h2>
          <p class="card-sub">NONGBOYUN AI · 农保云</p>
        </header>

        <label class="field">
          <span class="field-label">用户名</span>
          <span class="input-wrap">
            <svg class="field-icon" viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
              <circle cx="12" cy="8" r="3.2" />
              <path d="M5 20c.8-3 3.5-4.5 7-4.5s6.2 1.5 7 4.5" />
            </svg>
            <input v-model.trim="username" class="input" type="text" name="username" autocomplete="username" autofocus placeholder="输入用户名" :disabled="submitting" />
          </span>
        </label>

        <label class="field">
          <span class="field-label">密码</span>
          <span class="input-wrap">
            <svg class="field-icon" viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
              <rect x="4.5" y="10.5" width="15" height="9" rx="2" />
              <path d="M8 10.5V7.8a4 4 0 0 1 8 0v2.7" />
              <circle cx="12" cy="15" r="1" />
            </svg>
            <input v-model="password" class="input" :type="showPassword ? 'text' : 'password'" name="password" autocomplete="current-password" placeholder="输入密码" :disabled="submitting" />
            <button type="button" class="reveal" :disabled="submitting" :aria-label="showPassword ? '隐藏密码' : '显示密码'" @click="showPassword = !showPassword">
              <svg v-if="!showPassword" viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                <path d="M2.5 12s3.5-6 9.5-6 9.5 6 9.5 6-3.5 6-9.5 6-9.5-6-9.5-6Z" />
                <circle cx="12" cy="12" r="2.6" />
              </svg>
              <svg v-else viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                <path d="M3 3l18 18" />
                <path d="M10.5 6.2A9.7 9.7 0 0 1 12 6c6 0 9.5 6 9.5 6a15 15 0 0 1-3 3.4M6.2 6.2A14.5 14.5 0 0 0 2.5 12s3.5 6 9.5 6a9.6 9.6 0 0 0 3-.5" />
              </svg>
            </button>
          </span>
        </label>

        <p v-if="auth.errorMessage" class="error" role="alert">{{ auth.errorMessage }}</p>

        <button class="submit" type="submit" :disabled="submitting || !username || !password">
          <span v-if="submitting" class="spinner" aria-hidden="true"></span>
          <span class="submit-label">{{ submitting ? '登录中…' : '登录系统' }}</span>
          <svg v-if="!submitting" class="submit-arrow" viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
            <path d="M5 12h14m-6-6 6 6-6 6" />
          </svg>
        </button>

        </form>
        <p class="footer-text">© {{ launchYear }}–{{ copyrightYear }} 农保云AI智能风控管理平台</p>
      </div>
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

const launchYear = 2024;
const copyrightYear = new Date().getFullYear();

const baseSlide = '/login/dataProduct_01.f1a826ca.webp';
const overlaySlides = [
  { url: '/login/dataProduct_02_b.085ba46e.webp', enterType: 'inset' },
  { url: '/login/dataProduct_03_r.51c11ac2.webp', enterType: 'circle-tr' },
  { url: '/login/dataProduct_04_w.fa8dacce.webp', enterType: 'fade' },
  { url: '/login/dataProduct_05_v.6e39d4b9.webp', enterType: 'circle-bl' },
  { url: '/login/dataProduct_06_s1.13923a35.webp', enterType: 'fade' },
  { url: '/login/dataProduct_07_ao.c30812ed.webp', enterType: 'fade' },
];
const ENTER_MS = 1500;
const ALL_VISIBLE_MS = 3500;
const EXIT_MS = 1500;
const BASE_MS = 1500;

const slideStates = ref(overlaySlides.map(() => 'hidden' as 'hidden' | 'entering' | 'visible' | 'exiting'));
let slideTimer: ReturnType<typeof setTimeout> | undefined;

function slideClass(index: number) {
  const state = slideStates.value[index];
  if (state === 'hidden') return 'slide-hidden';
  return [`slide-${state}`, `enter-${overlaySlides[index].enterType}`];
}

function runSlideSequence() {
  const run = () => {
    let entered = 0;
    const enterNext = () => {
      if (entered < overlaySlides.length) {
        slideStates.value[entered] = 'entering';
        entered++;
        slideTimer = setTimeout(enterNext, ENTER_MS);
      } else {
        slideStates.value = slideStates.value.map(() => 'visible');
        slideTimer = setTimeout(() => {
          slideStates.value = slideStates.value.map(() => 'exiting');
          slideTimer = setTimeout(() => {
            slideStates.value = slideStates.value.map(() => 'hidden');
            slideTimer = setTimeout(run, BASE_MS);
          }, EXIT_MS);
        }, ALL_VISIBLE_MS);
      }
    };
    slideTimer = setTimeout(enterNext, 1500);
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
  display: flex;
  overflow: hidden;
  background: #0b1510;
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', 'PingFang SC', 'Microsoft YaHei', sans-serif;
  color: #eaf4ec;
}

/* ===== 全屏背景：影像 + 靛蓝过渡 ===== */
.bg-slider { position: absolute; inset: 0; z-index: 0; width: 100%; height: 100%; }
.bg-slide { position: absolute; inset: 0; width: 100%; height: 100%; background-size: cover; background-position: center; background-repeat: no-repeat; }
.bg-base { opacity: 1; z-index: 1; }
.slide-hidden { opacity: 0; pointer-events: none; z-index: 2; }

.tech-layer { position: absolute; inset: 0; z-index: 3; pointer-events: none; overflow: hidden; }
.tech-grid {
  position: absolute; inset: -50%;
  background-image:
    linear-gradient(rgba(52, 211, 153, 0.05) 1px, transparent 1px),
    linear-gradient(90deg, rgba(52, 211, 153, 0.05) 1px, transparent 1px);
  background-size: 72px 72px, 72px 72px;
  animation: grid-pan 26s linear infinite;
  mask-image: radial-gradient(75% 75% at 50% 50%, #000 30%, transparent 80%);
  -webkit-mask-image: radial-gradient(75% 75% at 50% 50%, #000 30%, transparent 80%);
}
@keyframes grid-pan { to { background-position: 72px 72px, -72px 72px; } }
.tech-orb { position: absolute; border-radius: 50%; filter: blur(70px); opacity: 0.45; mix-blend-mode: screen; }
.orb-a { width: 420px; height: 420px; left: -6%; top: -10%; background: radial-gradient(circle, rgba(52, 211, 153, 0.5), transparent 70%); animation: drift-a 18s ease-in-out infinite; }
.orb-b { width: 480px; height: 480px; right: -8%; bottom: -14%; background: radial-gradient(circle, rgba(34, 211, 238, 0.42), transparent 70%); animation: drift-b 22s ease-in-out infinite; }
.orb-c { width: 300px; height: 300px; left: 45%; top: 55%; background: radial-gradient(circle, rgba(110, 231, 183, 0.32), transparent 70%); animation: drift-c 26s ease-in-out infinite; }
@keyframes drift-a { 0%,100% { transform: translate(0,0) scale(1);} 50% { transform: translate(40px,30px) scale(1.1);} }
@keyframes drift-b { 0%,100% { transform: translate(0,0) scale(1);} 50% { transform: translate(-50px,-40px) scale(1.05);} }
@keyframes drift-c { 0%,100% { transform: translate(0,0) scale(1);} 33% { transform: translate(-30px,-20px) scale(0.9);} 66% { transform: translate(25px,25px) scale(1.08);} }

/* 进场动画 */
.slide-entering.enter-inset { animation: enter-inset 1.5s cubic-bezier(0.4,0,0.2,1) forwards; z-index: 3; }
@keyframes enter-inset { 0% { clip-path: inset(0 100% 0 0); opacity: 1;} 100% { clip-path: inset(0 0 0 0); opacity: 1;} }
.slide-entering.enter-circle-tr { animation: enter-circle-tr 1.5s cubic-bezier(0.4,0,0.2,1) forwards; z-index: 3; }
@keyframes enter-circle-tr { 0% { clip-path: circle(0% at 100% 0%); opacity: 1;} 100% { clip-path: circle(150%); opacity: 1;} }
.slide-entering.enter-fade { animation: enter-fade 1.5s ease-in-out forwards; z-index: 3; }
@keyframes enter-fade { 0% { opacity: 0;} 100% { opacity: 1;} }
.slide-entering.enter-circle-bl { animation: enter-circle-bl 1.5s cubic-bezier(0.4,0,0.2,1) forwards; z-index: 3; }
@keyframes enter-circle-bl { 0% { clip-path: circle(0% at 0% 100%); opacity: 0;} 100% { clip-path: circle(150%); opacity: 1;} }
.slide-visible { opacity: 1; z-index: 3; }
.slide-exiting { animation: exit-fade 1.5s ease-in-out forwards; z-index: 3; }
@keyframes exit-fade { 0% { opacity: 1;} 100% { opacity: 0;} }

/* 靛蓝→透明过渡：贯穿全宽（左靛蓝，往右渐隐透出影像） */
.bg-scrim {
  position: absolute; inset: 0; z-index: 1;
  background:
    linear-gradient(90deg,
      rgba(20, 22, 62, 0.97) 0%,
      rgba(24, 26, 74, 0.9) 22%,
      rgba(28, 30, 84, 0.52) 46%,
      rgba(32, 35, 98, 0.14) 64%,
      rgba(32, 35, 98, 0) 78%),
    linear-gradient(180deg, rgba(18, 20, 56, 0.44), rgba(18, 20, 56, 0) 40%, rgba(18, 20, 56, 0.34));
}

/* ===== 左：品牌声明（浮于左侧靛蓝上） ===== */
.brand-content {
  position: relative;
  z-index: 2;
  flex: 1.5;
  min-width: 0;
  display: flex;
  flex-direction: column;
  justify-content: center;
  align-items: flex-start;
  padding: 0 0 0 10vw;
  max-width: 940px;
}
.brand-head { display: flex; align-items: center; gap: 18px; }
.brand-mark {
  width: 54px; height: 54px; margin: 0;
  display: flex; align-items: center; justify-content: center;
  color: #d8ffe9;
  background: linear-gradient(135deg, #2ea46a 0%, #0c6a4a 100%);
  border: 1px solid rgba(120, 255, 190, 0.3);
  border-radius: 16px;
  box-shadow: 0 10px 30px rgba(46, 164, 106, 0.42);
  flex-shrink: 0;
}
.brand-title {
  margin: 0;
  font-size: clamp(26px, 3vw, 44px);
  font-weight: 800;
  letter-spacing: -0.02em;
  color: #f6f8ff;
  line-height: 1.1;
  text-shadow: 0 2px 24px rgba(6, 8, 30, 0.5);
}
.brand-accent { color: #4be0b0; }
.brand-rule { display: none; }
.brand-slogan {
  margin: 28px 0 32px;
  font-size: clamp(17px, 1.7vw, 22px);
  font-weight: 500;
  letter-spacing: 0.1em;
  color: #b9c6ef;
  text-shadow: 0 2px 16px rgba(6, 8, 30, 0.45);
}
.brand-pillars {
  display: flex; flex-direction: column; gap: 18px;
  padding: 30px 0;
  border-top: 1px solid rgba(255, 255, 255, 0.14);
  border-bottom: 1px solid rgba(255, 255, 255, 0.14);
}
.pillar { display: flex; align-items: center; gap: 15px; }
.pillar-icon {
  width: 40px; height: 40px; flex-shrink: 0;
  display: flex; align-items: center; justify-content: center;
  color: #4be0b0;
  background: rgba(255, 255, 255, 0.05);
  border: 1px solid rgba(255, 255, 255, 0.14);
  border-radius: 10px;
}
.pillar-text { display: flex; flex-direction: column; }
.pillar-text strong { font-size: 16px; font-weight: 600; letter-spacing: 0.02em; color: #eef4ff; }
.pillar-text em { font-style: normal; font-size: 13px; margin-top: 2px; color: #9fb0d8; letter-spacing: 0.02em; }
/* ===== 右：登录浮窗（浮于右侧影像上） ===== */
.form-wrap {
  position: relative;
  z-index: 2;
  flex: 1;
  min-width: 0;
  display: flex;
  align-items: center;
  justify-content: flex-end;
  padding-right: 10vw;
}
.card-wrap {
  position: relative;
  width: 100%;
  max-width: 400px;
}
.login-card {
  box-sizing: border-box;
  width: 100%;
  background: linear-gradient(160deg, rgba(13, 18, 44, 0.82), rgba(9, 12, 30, 0.74));
  backdrop-filter: blur(24px) saturate(140%);
  border: 1px solid rgba(140, 160, 230, 0.2);
  border-radius: 18px;
  padding: 36px 32px 30px;
  box-shadow: 0 24px 70px rgba(0, 0, 0, 0.5), inset 0 1px 0 rgba(255, 255, 255, 0.08);
}
.card-head { margin-bottom: 26px; }
.card-title { margin: 0 0 4px; font-size: 24px; font-weight: 700; letter-spacing: -0.01em; color: #f2f4ff; }
.card-sub { margin: 0; font-size: 11px; font-weight: 600; letter-spacing: 0.14em; text-transform: uppercase; color: #9aa8dd; }

.field { display: block; margin-bottom: 18px; }
.field-label { display: block; margin-bottom: 9px; font-size: 13.5px; font-weight: 500; color: #c6d2f2; letter-spacing: 0.02em; }
.input-wrap { position: relative; display: flex; align-items: center; }
.field-icon { position: absolute; left: 14px; color: #8a99cf; pointer-events: none; transition: color 150ms ease; }
.input-wrap:focus-within .field-icon { color: #4be0b0; }

.input {
  width: 100%; box-sizing: border-box; height: 46px; padding: 0 16px;
  font-size: 15px; color: #eef2ff;
  background: rgba(255, 255, 255, 0.05);
  border: 1px solid rgba(150, 170, 230, 0.24);
  border-radius: 12px; outline: none;
  transition: border-color 180ms ease, box-shadow 180ms ease, background-color 180ms ease;
}
.input-wrap > .input { padding-left: 42px; }
.input-wrap:has(.reveal) > .input { padding-right: 52px; }
.input::placeholder { color: #7f8fca; }
.input:focus { border-color: rgba(75, 224, 176, 0.7); background-color: rgba(75, 224, 176, 0.05); box-shadow: 0 0 0 3px rgba(75, 224, 176, 0.14), 0 0 24px rgba(75, 224, 176, 0.18); }
.input:disabled { background: rgba(255, 255, 255, 0.02); color: #7f8fca; }

.reveal {
  position: absolute; right: 8px; top: 50%; transform: translateY(-50%);
  width: 40px; height: 32px; display: flex; align-items: center; justify-content: center;
  border: 1px solid transparent; border-radius: 8px; background: transparent;
  color: #8a99cf; cursor: pointer;
  transition: color 150ms ease, background-color 150ms ease, border-color 150ms ease;
}
.reveal:hover:not(:disabled) { color: #4be0b0; background: rgba(75, 224, 176, 0.1); border-color: rgba(75, 224, 176, 0.25); }
.reveal:focus-visible { outline: 2px solid #4be0b0; outline-offset: 2px; }
.reveal:disabled { opacity: 0.5; cursor: not-allowed; }

.error {
  margin: 0 0 16px; padding: 12px 14px; font-size: 14px; color: #ffb0b0;
  background: rgba(220, 38, 38, 0.16); border: 1px solid rgba(248, 113, 113, 0.35); border-radius: 10px;
}

.submit {
  width: 100%; height: 50px; margin-top: 4px; position: relative;
  display: flex; align-items: center; justify-content: center; gap: 10px;
  font-size: 16px; font-weight: 600; color: #04221a;
  background: linear-gradient(135deg, #34d399 0%, #22d3ee 100%);
  border: none; border-radius: 12px; cursor: pointer; overflow: hidden;
  box-shadow: 0 10px 26px rgba(34, 211, 238, 0.28);
  transition: transform 130ms ease, box-shadow 130ms ease, filter 130ms ease;
}
.submit::after {
  content: ''; position: absolute; top: 0; left: -80%; width: 60%; height: 100%;
  background: linear-gradient(100deg, transparent, rgba(255, 255, 255, 0.45), transparent);
  transform: skewX(-20deg); animation: sheen 3.6s ease-in-out infinite;
}
@keyframes sheen { 0%, 60% { left: -80%; } 100% { left: 130%; } }
.submit:hover:not(:disabled) { transform: translateY(-2px); filter: brightness(1.05); box-shadow: 0 14px 34px rgba(34, 211, 238, 0.4); }
.submit:active:not(:disabled) { transform: translateY(0) scale(0.99); }
.submit:focus-visible { outline: 2px solid #4be0b0; outline-offset: 3px; }
.submit:disabled { opacity: 0.5; cursor: not-allowed; }
.submit-arrow { transition: transform 150ms ease; }
.submit:hover:not(:disabled) .submit-arrow { transform: translateX(3px); }

.spinner {
  width: 18px; height: 18px;
  border: 2.5px solid rgba(5, 34, 26, 0.3); border-top-color: #04221a; border-radius: 50%;
  animation: spin 0.7s linear infinite;
}
@keyframes spin { to { transform: rotate(360deg); } }


.footer-text { position: absolute; top: calc(100% + 18px); left: 0; right: 0; text-align: center; font-size: 12px; color: rgba(214, 222, 255, 0.5); letter-spacing: 0.01em; }

/* ===== 响应式 ===== */
@media (max-width: 900px) {
  .login-view { flex-direction: column; }
  .brand-content { flex: none; min-height: 42vh; padding: 0 24px; justify-content: flex-end; padding-bottom: 22px; }
  .brand-mark { width: 38px; height: 38px; margin: 0; border-radius: 11px; }
  .brand-title { font-size: 26px; }
  .brand-slogan { font-size: 15px; margin: 18px 0 0; }
  .brand-pillars { display: none; }
  .form-wrap { flex: 1; align-items: center; justify-content: flex-start; padding: 30px 20px 0; }
}
@media (max-width: 480px) {
  .brand-content { min-height: 34vh; }
  .login-card { padding: 30px 22px 26px; }
}
</style>
