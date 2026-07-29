<template>
  <div class="crumb-bar">
    <button v-if="store.path.length > 1" class="back-btn" @click="store.back()">
      ← 回到上级
    </button>
    <nav class="crumbs">
      <template v-for="(c, i) in store.path" :key="c.code + c.level">
        <span
          class="crumb"
          :class="{ active: i === store.path.length - 1, clickable: i < store.path.length - 1 }"
          @click="store.backTo(i)"
        >{{ c.name }}</span>
        <span v-if="i < store.path.length - 1" class="sep">/</span>
      </template>
    </nav>
  </div>
</template>

<script setup lang="ts">
import { useDrilldownStore } from '../stores/drilldown'
const store = useDrilldownStore()
</script>

<style scoped>
.crumb-bar {
  position: absolute;
  top: 12px;
  left: 12px;
  z-index: 1000;
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 8px 14px;
  background: rgba(255, 255, 255, 0.92);
  border-radius: 8px;
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.25);
  font-size: 14px;
}
.back-btn {
  border: none;
  background: #2563eb;
  color: #fff;
  padding: 4px 10px;
  border-radius: 6px;
  cursor: pointer;
  font-size: 13px;
}
.back-btn:hover { background: #1d4ed8; }
.crumbs { display: flex; align-items: center; gap: 6px; }
.crumb.active { font-weight: 600; color: #111827; }
.crumb.clickable { color: #2563eb; cursor: pointer; }
.crumb.clickable:hover { text-decoration: underline; }
.sep { color: #9ca3af; }
</style>
