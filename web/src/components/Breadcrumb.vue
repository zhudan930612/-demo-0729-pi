<template>
  <div class="navigation-status">
    <div class="crumb-bar">
      <button v-if="store.path.length > 1" type="button" class="back-btn" @click="store.back()">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"
             stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
          <path d="m15 18-6-6 6-6" />
        </svg>
        返回上级
      </button>
      <nav class="crumbs" aria-label="行政级别">
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
  </div>
</template>

<script setup lang="ts">
import { useDrilldownStore } from '../stores/drilldown'
const store = useDrilldownStore()
</script>

<style scoped>
.navigation-status {
  position: absolute;
  top: 12px;
  left: 12px;
  z-index: 1000;
  display: flex;
  align-items: flex-start;
}
.crumb-bar {
  min-height: 42px;
  display: flex;
  align-items: center;
  gap: 4px;
  padding: 4px;
  border: 1px solid rgba(148, 163, 184, 0.34);
  border-radius: 10px;
  background: rgba(248, 250, 252, 0.96);
  box-shadow: 0 6px 20px rgba(15, 23, 42, 0.18), 0 1px 2px rgba(15, 23, 42, 0.12);
  font-size: 13px;
  backdrop-filter: blur(8px);
}
.back-btn {
  height: 34px;
  display: inline-flex;
  align-items: center;
  gap: 5px;
  padding: 0 11px 0 8px;
  border: 0;
  border-radius: 7px;
  background: #2563eb;
  color: #fff;
  cursor: pointer;
  font: inherit;
  font-weight: 600;
  box-shadow: 0 1px 2px rgba(30, 64, 175, 0.25);
  transition: background-color 160ms ease;
}
.back-btn svg { width: 16px; height: 16px; }
.back-btn:hover { background: #1d4ed8; }
.back-btn:focus-visible { outline: 3px solid rgba(37, 99, 235, 0.28); outline-offset: 2px; }
.crumbs {
  min-width: 0;
  display: flex;
  align-items: center;
  gap: 2px;
  padding: 0 7px;
  white-space: nowrap;
}
.crumb {
  padding: 5px 4px;
  border-radius: 5px;
  color: #475569;
  line-height: 1.3;
}
.crumb.active { font-weight: 650; color: #0f172a; }
.crumb.clickable { color: #2563eb; cursor: pointer; }
.crumb.clickable:hover { background: #eff6ff; color: #1d4ed8; }
.sep { color: #94a3b8; }

@media (max-width: 720px) {
  .navigation-status { right: 12px; }
  .crumb-bar { max-width: 100%; overflow: hidden; }
  .crumbs { overflow-x: auto; }
}
</style>
