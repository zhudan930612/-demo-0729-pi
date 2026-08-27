import type { Ref } from 'vue'
import type L from 'leaflet'
import type { useDrilldownStore } from '../../stores/drilldown'
import { useDisasterWarningStore } from '../../stores/disasterWarning'
import { loadDisasterWarningData } from './disasterWarningRepository'
import type { DisasterWarningTab } from './types'

export interface DisasterWarningContext {
  store: ReturnType<typeof useDrilldownStore>
  /** 台风/灾害模式激活标记（MapView 持有，供互斥判定） */
  disasterActive: Ref<boolean>
  anyWeatherActive(): boolean
  hasUnsavedParcelWork(): boolean
  exits: {
    typhoon(restoreView?: boolean): void
    weather(): void
    nationalAlarms(): void
    precipitation(): void
    lodging(): void
    agri(): void
  }
  resetToProvince: () => Promise<boolean>
  render: () => Promise<void>
  showNotice: (msg: string, error?: boolean) => void
}

export interface DisasterWarningMode {
  init(map: L.Map): void
  destroy(): void
  enter(): Promise<void>
  exit(): void
  setTab(tab: DisasterWarningTab): void
}

/** 受灾预警模式装配（R1~R6 共享装配层；播放/标记/灾损/任务切片挂在此层，不堆回 MapView）。 */
export function useDisasterWarningMode(ctx: DisasterWarningContext): DisasterWarningMode {
  const store = useDisasterWarningStore()

  async function loadAll() {
    const generation = store.generation
    try {
      const data = await loadDisasterWarningData()
      store.receive(generation, data)
    } catch (e) {
      store.fail(generation, e instanceof Error ? e.message : '受灾预警数据加载失败')
      // R2-18：降雨/轨迹/预警数据任一缺失 → 面板级降级提示
      ctx.showNotice('受灾预警数据加载失败，已按降级模式展示（预警监测空态、灾损预估 0、派发不可用）。', true)
    }
  }

  async function enter() {
    if (ctx.hasUnsavedParcelWork()) return
    // R1-4 模式互斥：进入受灾预警退出农情监测/台风/天气/降水/倒伏评估等其他模式
    if (ctx.anyWeatherActive()) { ctx.exits.weather(); ctx.exits.nationalAlarms() }
    if (ctx.disasterActive.value) ctx.exits.typhoon()
    ctx.exits.precipitation()
    ctx.exits.lodging()
    ctx.exits.agri()
    store.open()
    // R1-2：进入后地图切回省级视角
    await ctx.resetToProvince()
    void ctx.render()
    void loadAll()
  }

  function exit() {
    store.close()
    if (!ctx.disasterActive.value) {
      void ctx.resetToProvince().then((reset) => { if (reset) void ctx.render() })
    }
  }

  function setTab(tab: DisasterWarningTab) { store.setTab(tab) }

  function init(_target: L.Map) { /* 图层由 T4/T5 挂载时使用 */ }
  function destroy() { /* T4/T5 清理图层 */ }

  return { init, destroy, enter, exit, setTab }
}
