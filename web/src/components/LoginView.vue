<template>
  <div class="login-view">
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
import { ref } from 'vue'
import { useAuthStore } from '../stores/auth'

const auth = useAuthStore()
const username = ref('')
const password = ref('')
const submitting = ref(false)

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
  background: #0f172a; /* canvas-slate */
  font-family: 'PingFang SC', 'Microsoft YaHei', sans-serif;
}
.login-card {
  width: 360px;
  max-width: calc(100vw - 32px);
  box-sizing: border-box;
  padding: 32px 28px 24px;
  background: #ffffff; /* panel-white */
  border-radius: 14px; /* rounded.dialog */
  box-shadow: 0 22px 50px rgba(15, 23, 42, 0.3); /* 确认对话框阴影 */
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
