# Basemap Hover Menu Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the right-bottom basemap toggle with an accessible hover-to-open menu that lets users explicitly choose satellite or vector basemap.

**Architecture:** Keep all behavior inside `MapControlStack.vue`, which already owns the other floating menus and emits `switch-basemap`. Add one local menu-open state and pointer/focus lifecycle for the basemap trigger; selected menu buttons reuse the existing typed event without changing map-layer creation in `MapView.vue` or `api/tianditu.ts`.

**Tech Stack:** Vue 3 Composition API, TypeScript, scoped CSS, Playwright, Vite.

---

### Task 1: Add a failing browser regression test

**Files:**
- Create: `web/e2e/basemapMenu.spec.ts`
- Reference: `web/e2e/fixtures.ts`
- Reference: `web/playwright.config.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { expect, test } from '@playwright/test'

test('opens the basemap menu on hover and switches to vector', async ({ page }) => {
  await page.goto('/')
  const trigger = page.getByRole('button', { name: /底图：卫星/ })
  await trigger.hover()
  const menu = page.getByRole('radiogroup', { name: '选择底图' })
  await expect(menu).toBeVisible()
  await expect(menu.getByRole('radio', { name: '卫星底图' })).toHaveAttribute('aria-checked', 'true')
  await menu.getByRole('radio', { name: '矢量底图' }).click()
  await expect(page.getByRole('button', { name: /底图：矢量/ })).toBeVisible()
  await expect(menu).toBeHidden()
})
```

- [ ] **Step 2: Run the test and verify it fails for the missing menu**

Run: `pnpm --dir web exec playwright test e2e/basemapMenu.spec.ts`

Expected: failure because no `选择底图` radiogroup exists.

### Task 2: Implement the hover menu in the map control stack

**Files:**
- Modify: `web/src/components/map/MapControlStack.vue`

- [ ] **Step 1: Add a local open state and menu lifecycle**

```ts
const basemapMenuOpen = ref(false)
function openBasemapMenu() { basemapMenuOpen.value = true }
function closeBasemapMenu() { basemapMenuOpen.value = false }
function chooseBasemap(type: 'img' | 'vec') {
  closeBasemapMenu()
  emit('switch-basemap', type)
}
```

Wire `mouseenter` and `focusin` on the basemap control wrapper to `openBasemapMenu`; wire `mouseleave` to `closeBasemapMenu`. Extend `closeMenus`, `closeOnOutside`, and `onKeydown` so outside pointer interaction and `Esc` also close this menu.

- [ ] **Step 2: Replace the single basemap toggle template with a labelled radio menu**

```vue
<div class="tool-entry basemap-entry" @mouseenter="openBasemapMenu" @mouseleave="closeBasemapMenu" @focusin="openBasemapMenu">
  <button type="button" class="icon-btn layer-btn" :class="{ active: basemapMenuOpen }"
    :aria-label="basemap === 'img' ? '底图：卫星' : '底图：矢量'"
    aria-haspopup="true" :aria-expanded="basemapMenuOpen" aria-controls="basemap-tool-menu">
    <!-- existing layers SVG and tooltip -->
  </button>
  <Transition name="tool-menu">
    <div v-if="basemapMenuOpen" id="basemap-tool-menu" class="tool-menu" role="radiogroup" aria-label="选择底图">
      <button type="button" class="menu-action" role="radio" :aria-checked="basemap === 'img'" :class="{ selected: basemap === 'img' }" @click="chooseBasemap('img')">卫星底图</button>
      <button type="button" class="menu-action" role="radio" :aria-checked="basemap === 'vec'" :class="{ selected: basemap === 'vec' }" @click="chooseBasemap('vec')">矢量底图</button>
    </div>
  </Transition>
</div>
```

- [ ] **Step 3: Apply the compact-menu visual contract**

Reuse `.tool-menu` and `.menu-action`; add only a basemap-specific minimum width of `148px` if the existing `132px` menu width is insufficient. Preserve left-side expansion, 10px gap, 36px rows, selected blue inset bar, focus outline, reduced-motion handling, and narrow-view behavior.

### Task 3: Verify behavior and build output

**Files:**
- Test: `web/e2e/basemapMenu.spec.ts`
- Verify: `web/src/components/map/MapControlStack.vue`

- [ ] **Step 1: Re-run the focused test**

Run: `pnpm --dir web exec playwright test e2e/basemapMenu.spec.ts`

Expected: the hover menu appears, selected state is exposed, vector selection updates the trigger, and the menu closes.

- [ ] **Step 2: Run the full front-end checks**

Run: `pnpm --dir web test && pnpm --dir web build && git diff --check`

Expected: unit tests, type check/build, and whitespace validation complete without failures.

- [ ] **Step 3: Perform browser visual verification**

At desktop width, hover the bottom-right basemap button; verify the compact menu expands left, moving the pointer from trigger to menu does not close it, the selected row is visible, and selecting either option updates the map. At a narrow viewport, verify the menu remains reachable and within the viewport.
