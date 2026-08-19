<template>
  <div v-if="auth.isChecking" class="boot" />
  <LoginView v-else-if="!auth.isAuthenticated" />
  <template v-else>
    <MapView />
    <Breadcrumb />
  </template>
</template>

<script setup lang="ts">
import { onMounted } from 'vue'
import MapView from './components/MapView.vue'
import Breadcrumb from './components/Breadcrumb.vue'
import LoginView from './components/LoginView.vue'
import { useAuthStore } from './stores/auth'

const auth = useAuthStore()

onMounted(() => {
  void auth.restore()
})
</script>

<style scoped>
.boot {
  position: fixed;
  inset: 0;
  background: #0f172a; /* canvas-slate */
}
</style>
