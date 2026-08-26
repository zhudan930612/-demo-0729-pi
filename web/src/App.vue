<template>
  <div v-if="auth.isChecking" class="boot" />
  <router-view v-else />
</template>

<script setup lang="ts">
import { useAuthStore } from './stores/auth'

const auth = useAuthStore()
</script>

<style scoped>
.boot {
  position: fixed;
  inset: 0;
  background: #0f172a; /* canvas-slate */
}
</style>
