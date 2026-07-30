<template>
  <div v-if="open" class="dialog-backdrop" role="presentation" @click.self="emit('close', false)">
    <section ref="dialogEl" class="confirm-dialog" role="alertdialog" aria-modal="true" aria-labelledby="manual-dialog-title" aria-describedby="manual-dialog-description" tabindex="-1">
      <div class="dialog-icon" aria-hidden="true">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <path d="M12 3 2.8 19h18.4Z" /><path d="M12 9v4" /><path d="M12 17h.01" />
        </svg>
      </div>
      <div class="dialog-copy">
        <h2 id="manual-dialog-title">{{ title }}</h2>
        <p id="manual-dialog-description">{{ message }}</p>
      </div>
      <div class="dialog-actions">
        <button type="button" class="dialog-button secondary" @click="emit('close', false)">取消</button>
        <button type="button" class="dialog-button primary" @click="emit('close', true)">{{ confirmLabel }}</button>
      </div>
    </section>
  </div>
</template>

<script setup lang="ts">
import { nextTick, ref, watch } from 'vue'

const props = defineProps<{
  open: boolean
  title: string
  message: string
  confirmLabel: string
}>()

const emit = defineEmits<{
  close: [confirmed: boolean]
}>()

const dialogEl = ref<HTMLElement>()

watch(() => props.open, async (open) => {
  if (!open) return
  await nextTick()
  dialogEl.value?.focus()
})
</script>

<style scoped>
.dialog-backdrop {
  position: absolute;
  inset: 0;
  z-index: 1400;
  display: grid;
  place-items: center;
  padding: 20px;
  background: rgba(15, 23, 42, 0.48);
}
.confirm-dialog {
  width: min(420px, calc(100vw - 32px));
  display: grid;
  grid-template-columns: 42px 1fr;
  gap: 14px;
  padding: 20px;
  border-radius: 14px;
  background: #fff;
  box-shadow: 0 22px 50px rgba(15, 23, 42, 0.3);
  color: #0f172a;
}
.confirm-dialog:focus { outline: none; }
.dialog-icon {
  width: 42px;
  height: 42px;
  display: grid;
  place-items: center;
  border-radius: 12px;
  background: #faf5ff;
  color: #9333ea;
}
.dialog-icon svg { width: 22px; height: 22px; }
.dialog-copy h2 { margin: 1px 0 7px; font-size: 16px; line-height: 1.25; }
.dialog-copy p { margin: 0; color: #475569; font-size: 13px; line-height: 1.65; }
.dialog-actions {
  grid-column: 1 / -1;
  display: flex;
  justify-content: flex-end;
  gap: 8px;
  margin-top: 4px;
}
.dialog-button {
  height: 34px;
  padding: 0 13px;
  border: 0;
  border-radius: 7px;
  font: inherit;
  font-size: 13px;
  font-weight: 650;
  cursor: pointer;
}
.dialog-button.secondary { background: #f1f5f9; color: #475569; }
.dialog-button.secondary:hover { background: #e2e8f0; color: #0f172a; }
.dialog-button.primary { background: #7e22ce; color: #fff; }
.dialog-button.primary:hover { background: #6b21a8; }
.dialog-button:focus-visible { outline: 3px solid rgba(126, 34, 206, 0.28); outline-offset: 2px; }
</style>
