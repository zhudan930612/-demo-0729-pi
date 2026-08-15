import { computed, nextTick, ref, watch, type Ref } from 'vue'
import L from 'leaflet'
import type { useDrilldownStore } from '../../stores/drilldown'
import type { WorkbenchTab } from '../../components/disaster/DisasterWorkbenchPanel.vue'
import { usePrecipitationStore } from '../../stores/precipitation'
import { useTyphoonStore } from '../../stores/typhoon'
import { createTyphoonLayerController, type TyphoonLayerController } from '../../map/typhoonLayerController'
import { createTyphoonPlaybackController, type TyphoonPlaybackController } from './typhoonPlaybackController'
import { createTyphoonSessionRepository, type TyphoonSessionRepository } from './typhoonRepository'
import { createDisasterModeCoordinator, mapTyphoonLayerSnapshot, shouldAutoFitTyphoon } from './disasterModeLifecycle'
import { buildTyphoonPathPanelViewModel } from './typhoonPanelViewModel'
import { buildTyphoonTimelineViewModel } from './typhoonTimelineViewModel'
import { actualNodeSelection, buildTyphoonHoverViewModel, type TyphoonHoverTarget } from './typhoonHoverViewModel'
import {
  clearPinnedPopup as clearPinnedPopupState,
  clearPinnedWindPopupOnMove,
  clearPopupForTyphoon,
  hoverPopup,
  leavePopup,
  pinPopup,
  visiblePopupTarget,
  type TyphoonPopupState,
} from './typhoonInteractionState'

export const TYPHOON_INITIAL_ZOOM = 4.5

export interface TyphoonModeContext {
  /** 由 MapView 持有的下钻 store */
  store: ReturnType<typeof useDrilldownStore>
  /** 由 MapView 持有的模式激活标记（其他模式与模板共同读取） */
  disasterActive: Ref<boolean>
  /** 共用面板当前 tab（台风/风险），由 MapView 持有 */
  workbenchTab: Ref<WorkbenchTab>
  /** 程序化缩放期间不重排视野（MapView 持有） */
  pendingNoFly: Ref<boolean>
  /** 时间轴面板可用宽度（MapView 维护 mapViewport） */
  viewportWidth(): number
  anyWeatherActive(): boolean
  hasUnsavedParcelWork(): boolean
  closeBusinessForDisaster(): void
  /** 等待省界渲染完成后保持当前相机（render(true) 包装） */
  prepareProvinceLayers(): Promise<void>
  /** 退出后恢复省界并重渲染（render().finally 包装） */
  renderProvinceView(): void
  /** 使进行中的渲染失效（flySeq += 1 等） */
  invalidateNavigation(): void
  showNotice(message: string, error?: boolean): void
}

export interface TyphoonMode {
  /** MapView onMounted 创建地图后调用：创建台风图层与仓库、挂地图事件 */
  init(map: L.Map): void
  /** MapView onBeforeUnmount 调用（先 exit 后 destroy） */
  destroy(): void
  disasterActive: Ref<boolean>
  typhoonRevealToken: Ref<number>
  typhoonPopupState: Ref<TyphoonPopupState>
  typhoonHoverPosition: Ref<{ x: number; y: number }>
  typhoonHoverModel: Ref<ReturnType<typeof buildTyphoonHoverViewModel> | null>
  typhoonPanelModel: Ref<ReturnType<typeof buildTyphoonPathPanelViewModel>>
  typhoonTimelineModel: Ref<ReturnType<typeof buildTyphoonTimelineViewModel>>
  visibleObservationCountByTyphoon: Ref<Record<string, number>>
  typhoonRepository: TyphoonSessionRepository
  enterTyphoonMode(): Promise<void>
  exitTyphoonMode(restoreView?: boolean): void
  rollbackTyphoonMode(error?: unknown): void
  revealTyphoon(typhoonId: string, nodeId?: string): void
  toggleTyphoonCard(typhoonId: string): void
  closeHistoricalTyphoon(typhoonId: string): void
  toggleHistoricalFromTimeline(typhoonId: string): void
  selectTyphoonPanelNode(typhoonId: string, nodeId: string): void
  selectActualTyphoonNode(typhoonId: string, nodeId: string): boolean
  focusTyphoonFromUser(typhoonId: string, nodeId?: string): void
  /** 地图空白点击/Esc：关闭钉住的台风浮窗 */
  clearPinnedPopup(): void
}

export function useTyphoonMode(ctx: TyphoonModeContext): TyphoonMode {
  const typhoonStore = useTyphoonStore()
  const precipitationStore = usePrecipitationStore()
  const { store, disasterActive, workbenchTab, pendingNoFly } = ctx

  let map!: L.Map
  let typhoonLayerController!: TyphoonLayerController
  let typhoonRepository!: TyphoonSessionRepository
  let typhoonPlaybackController!: TyphoonPlaybackController
  let fittedTyphoonSessionId: number | null = null
  const disasterModeCoordinator = createDisasterModeCoordinator()

  const typhoonRevealToken = ref(0)
  const typhoonPopupState = ref<TyphoonPopupState>({ hover: null, pinned: null })
  const typhoonHoverPosition = ref({ x: 0, y: 0 })
  const visibleObservationCountByTyphoon = ref<Record<string, number>>({})

  const typhoonHoverTarget = computed(() => visiblePopupTarget(typhoonPopupState.value))
  const typhoonHoverModel = computed(() => typhoonHoverTarget.value ? buildTyphoonHoverViewModel(typhoonStore.details, typhoonHoverTarget.value) : null)
  const typhoonPanelModel = computed(() => buildTyphoonPathPanelViewModel({
    liveIds: typhoonStore.liveIds,
    openedHistoricalIds: typhoonStore.openedHistoricalIds,
    details: typhoonStore.details,
    focusedTyphoonId: typhoonStore.focusedTyphoonId,
    expandedIds: typhoonStore.expandedIds,
    selectedNodeByTyphoon: typhoonStore.selectedNodeByTyphoon,
  }))
  const typhoonTimelineModel = computed(() => buildTyphoonTimelineViewModel({
    details: typhoonStore.historicalDetails,
    nowMs: Date.now(),
    realtimeCount: typhoonStore.liveIds.length,
    openedHistoricalIds: typhoonStore.openedHistoricalIds,
    focusedTyphoonId: typhoonStore.focusedTyphoonId,
    selectedNodeByTyphoon: typhoonStore.selectedNodeByTyphoon,
    historyPending: typhoonStore.historyLoad.pending,
    viewportWidth: ctx.viewportWidth(),
  }))

  // 台风专题视图渲染：快照/焦点/可见观测数任一变化即重渲（含自动接管首次视角）
  watch(() => ({
    active: disasterActive.value,
    sessionId: typhoonStore.sessionId,
    realtime: typhoonStore.realtimeDetails,
    opened: typhoonStore.openedHistoricalIds,
    focused: typhoonStore.focusedTyphoonId,
    selected: { ...typhoonStore.selectedNodeByTyphoon },
    visibleCounts: { ...visibleObservationCountByTyphoon.value },
    phase: typhoonStore.phase,
  }), (state) => {
    if (!state.active || !typhoonLayerController) return
    typhoonLayerController.render(mapTyphoonLayerSnapshot({
      realtimeDetails: state.realtime,
      openedHistoricalIds: state.opened,
      details: typhoonStore.details,
      focusedTyphoonId: state.focused,
      selectedNodeByTyphoon: state.selected,
      visibleObservationCountByTyphoon: state.visibleCounts,
    }))
    if (shouldAutoFitTyphoon({ active: state.active, phase: state.phase, focusedId: state.focused, realtimeIds: state.realtime.map((detail) => detail.id), sessionId: state.sessionId, fittedSessionId: fittedTyphoonSessionId })) {
      // 台风视角优先：降水叠加时进入台风也切台风路径视野（用户 2026-08-11 确认）
      if (typhoonLayerController.setInitialViewForTyphoon(state.focused!, TYPHOON_INITIAL_ZOOM)) {
        fittedTyphoonSessionId = state.sessionId
      }
    }
  }, { deep: true })

  function rollbackTyphoonMode(error?: unknown) {
    typhoonRepository?.exit()
    typhoonLayerController?.clear()
    typhoonPlaybackController?.cancel()
    visibleObservationCountByTyphoon.value = {}
    typhoonPopupState.value = { hover: null, pinned: null }
    disasterActive.value = false
    fittedTyphoonSessionId = null
    ctx.invalidateNavigation()
    if (error) ctx.showNotice('台风模式加载异常，请稍后重新进入。', true)
  }

  async function enterTyphoonMode() {
    if (ctx.anyWeatherActive()) return
    // 立即切台风 tab（与点击台风 tab 一致的视图路径；用户 2026-08-11 反馈：按钮进入后面板未显示台风）
    workbenchTab.value = 'typhoon'
    // 省级状态 watch 只换行政图层；保持当前相机，等待实时台风直接接管首次视角。
    pendingNoFly.value = true
    const entered = await disasterModeCoordinator.enter({
      hasUnsavedWork: ctx.hasUnsavedParcelWork,
      isActive: () => disasterActive.value,
      setActive: (active) => { disasterActive.value = active },
      closeBusinessPanels: ctx.closeBusinessForDisaster,
      resetToProvince: () => store.resetToProvince(),
      prepareProvinceLayers: ctx.prepareProvinceLayers,
      enterRepository: () => {
        pendingNoFly.value = false
        fittedTyphoonSessionId = null
        // 台风视角优先：降水叠加时进入台风也切台风初始视野（用户 2026-08-11 确认）
        map.setZoom(TYPHOON_INITIAL_ZOOM, { animate: false })
        void typhoonRepository.enter()
      },
      rollback: rollbackTyphoonMode,
    })
    if (!entered) { pendingNoFly.value = false; ctx.invalidateNavigation() }
  }

  function focusTyphoonFromUser(typhoonId: string, nodeId?: string) {
    typhoonStore.focusTyphoon(typhoonId)
    if (nodeId) typhoonStore.selectNode(typhoonId, nodeId)
  }

  function revealTyphoon(typhoonId: string, nodeId?: string) {
    focusTyphoonFromUser(typhoonId, nodeId)
    if (!typhoonStore.expandedIds.includes(typhoonId)) typhoonStore.toggleExpanded(typhoonId)
    typhoonRevealToken.value += 1
  }

  function toggleTyphoonCard(typhoonId: string) {
    focusTyphoonFromUser(typhoonId)
    typhoonStore.toggleExpanded(typhoonId)
    typhoonRevealToken.value += 1
  }

  function closeHistoricalTyphoon(typhoonId: string) {
    typhoonPlaybackController?.cancel(typhoonId)
    typhoonPopupState.value = clearPopupForTyphoon(typhoonPopupState.value, typhoonId)
    const nextVisible = { ...visibleObservationCountByTyphoon.value }
    delete nextVisible[typhoonId]
    visibleObservationCountByTyphoon.value = nextVisible
    typhoonStore.closeHistorical(typhoonId)
  }

  function playHistoricalTyphoon(typhoonId: string) {
    const detail = typhoonStore.details[typhoonId]
    if (!detail || detail.status !== 'stop') return
    typhoonPlaybackController.play(detail, {
      onStep: (node, visibleCount) => {
        visibleObservationCountByTyphoon.value = { ...visibleObservationCountByTyphoon.value, [typhoonId]: visibleCount }
        typhoonStore.advancePlaybackNode(typhoonId, node.id)
      },
      onComplete: (node, visibleCount) => {
        visibleObservationCountByTyphoon.value = { ...visibleObservationCountByTyphoon.value, [typhoonId]: visibleCount }
        typhoonStore.advancePlaybackNode(typhoonId, node.id)
      },
    })
  }

  function toggleHistoricalFromTimeline(typhoonId: string) {
    if (typhoonStore.openedHistoricalIds.includes(typhoonId)) {
      closeHistoricalTyphoon(typhoonId)
      return
    }
    // 每条历史台风独立播放；打开新台风不停止其他台风的计时器。
    if (!typhoonStore.openHistorical(typhoonId)) return
    const detail = typhoonStore.details[typhoonId]!
    visibleObservationCountByTyphoon.value = { ...visibleObservationCountByTyphoon.value, [typhoonId]: Math.min(1, detail.observationsAsc.length) }
    const fullSnapshot = mapTyphoonLayerSnapshot({
      realtimeDetails: typhoonStore.realtimeDetails,
      openedHistoricalIds: typhoonStore.openedHistoricalIds,
      details: typhoonStore.details,
      focusedTyphoonId: typhoonId,
      selectedNodeByTyphoon: typhoonStore.selectedNodeByTyphoon,
    })
    typhoonLayerController.render(fullSnapshot)
    const firstNode = detail.observationsAsc[0]
    if (firstNode && !precipitationStore.isOpen) typhoonLayerController.setViewForTyphoonNode(typhoonId, firstNode.id, TYPHOON_INITIAL_ZOOM)
    playHistoricalTyphoon(typhoonId)
  }

  function selectActualTyphoonNode(typhoonId: string, nodeId: string) {
    typhoonPlaybackController?.cancel(typhoonId)
    const detail = typhoonStore.details[typhoonId]
    const selection = actualNodeSelection(detail, 'actual', nodeId)
    if (!selection) return false
    if (selection.visibleObservationCount !== undefined) {
      visibleObservationCountByTyphoon.value = { ...visibleObservationCountByTyphoon.value, [typhoonId]: selection.visibleObservationCount }
    }
    revealTyphoon(typhoonId, nodeId)
    void nextTick(() => typhoonLayerController.panNodeIntoView(typhoonId, nodeId, { padding: [40, 40] }))
    return true
  }

  function selectTyphoonPanelNode(typhoonId: string, nodeId: string) {
    selectActualTyphoonNode(typhoonId, nodeId)
  }

  function clearPinnedPopup() {
    typhoonPopupState.value = clearPinnedPopupState(typhoonPopupState.value)
  }

  function exitTyphoonMode(restoreView = true) {
    disasterModeCoordinator.exit({
      isActive: () => disasterActive.value,
      exitRepository: () => typhoonRepository?.exit(),
      clearTyphoonLayers: () => typhoonLayerController?.clear(),
      setActive: (active) => { disasterActive.value = active },
      invalidateNavigation: ctx.invalidateNavigation,
      restoreProvinceView: () => {
        if (!restoreView || precipitationStore.isOpen) return
        const alreadyProvince = store.path.length === 1 && store.current.level === 'province'
        void store.resetToProvince().then((reset) => {
          if (!reset || !alreadyProvince) return
          ctx.renderProvinceView()
        })
      },
    })
    fittedTyphoonSessionId = null
    typhoonPlaybackController?.cancel()
    visibleObservationCountByTyphoon.value = {}
    typhoonPopupState.value = { hover: null, pinned: null }
    // 业务抽屉保持关闭；行政状态和相机恢复浙江省默认视角。
  }

  function init(target: L.Map) {
    map = target
    const setHover = (hoverTarget: TyphoonHoverTarget, point: { x: number; y: number }) => {
      typhoonPopupState.value = hoverPopup(typhoonPopupState.value, hoverTarget)
      typhoonHoverPosition.value = point
    }
    const clearHover = (hoverTarget: TyphoonHoverTarget) => { typhoonPopupState.value = leavePopup(typhoonPopupState.value, hoverTarget) }
    const pinTyphoonPopup = (hoverTarget: TyphoonHoverTarget, point: { x: number; y: number }) => {
      typhoonPopupState.value = pinPopup(typhoonPopupState.value, hoverTarget)
      typhoonHoverPosition.value = point
    }
    typhoonLayerController = createTyphoonLayerController(map, {
      onTyphoonClick: ({ typhoonId }) => revealTyphoon(typhoonId),
      onNodeClick: ({ typhoonId, nodeId, kind, containerPoint }) => {
        if (kind === 'actual') selectActualTyphoonNode(typhoonId, nodeId)
        else revealTyphoon(typhoonId)
        if (kind === 'actual') pinTyphoonPopup({ kind: 'center', typhoonId, nodeId }, containerPoint)
      },
      onNodeEnter: ({ typhoonId, nodeId, kind, containerPoint }) => {
        setHover({ kind: kind === 'actual' ? 'center' : 'forecast', typhoonId, nodeId }, containerPoint)
      },
      onNodeLeave: ({ typhoonId, nodeId, kind }) => {
        clearHover({ kind: kind === 'actual' ? 'center' : 'forecast', typhoonId, nodeId })
      },
      onCenterClick: ({ typhoonId, nodeId, containerPoint }) => { selectActualTyphoonNode(typhoonId, nodeId); pinTyphoonPopup({ kind: 'center', typhoonId, nodeId }, containerPoint) },
      onWindCircleClick: ({ typhoonId, nodeId, grade, containerPoint }) => { selectActualTyphoonNode(typhoonId, nodeId); pinTyphoonPopup({ kind: 'wind', typhoonId, nodeId, grade }, containerPoint) },
      onCenterEnter: ({ typhoonId, nodeId, containerPoint }) => setHover({ kind: 'center', typhoonId, nodeId }, containerPoint),
      onCenterLeave: ({ typhoonId, nodeId }) => clearHover({ kind: 'center', typhoonId, nodeId }),
    })
    typhoonRepository = createTyphoonSessionRepository(typhoonStore)
    typhoonPlaybackController = createTyphoonPlaybackController({
      reducedMotion: () => window.matchMedia('(prefers-reduced-motion: reduce)').matches,
    })
    map.getContainer().addEventListener('pointermove', () => {
      typhoonPopupState.value = clearPinnedWindPopupOnMove(typhoonPopupState.value)
    })
  }

  function destroy() {
    typhoonPlaybackController?.destroy()
    typhoonLayerController?.destroy()
  }

  return {
    init,
    destroy,
    disasterActive,
    typhoonRevealToken,
    typhoonPopupState,
    typhoonHoverPosition,
    typhoonHoverModel,
    typhoonPanelModel,
    typhoonTimelineModel,
    visibleObservationCountByTyphoon,
    typhoonRepository,
    enterTyphoonMode,
    exitTyphoonMode,
    rollbackTyphoonMode,
    revealTyphoon,
    toggleTyphoonCard,
    closeHistoricalTyphoon,
    toggleHistoricalFromTimeline,
    selectTyphoonPanelNode,
    selectActualTyphoonNode,
    focusTyphoonFromUser,
    clearPinnedPopup,
  }
}
