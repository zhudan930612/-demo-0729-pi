import { computed, reactive, ref, toRef, type Ref } from 'vue'
import L from 'leaflet'
import type { Feature, FeatureCollection, Position } from 'geojson'
import type { useDrilldownStore } from '../../stores/drilldown'
import type ParcelDetailPanel from '../../components/map/ParcelDetailPanel.vue'
import type { ParcelId, ParcelMode } from './parcelTypes'
import { addCultivationRecord, readEffectiveCultivation, removeAddedCultivation, removeCultivationForParcel, restoreInitialCultivation, saveCultivationOverride, updateAddedCultivation } from '../policy/cultivationStorage'
import { cultivationKey, type CultivationRecord } from '../policy/cultivationState'
import { loadCultivationFixture, loadPolicyFixture } from '../policy/policyRepository'
import { fromBaseParcel, fromManualParcel, insuredCoverages, parcelPolicyContext, policyCoverages, type ParcelPolicyContext, type ParcelSummaryInput } from '../policy/policySelectors'
import type { EnrollmentItem, PolicyFixture } from '../policy/policyTypes'
import { linkedParcelStyle } from '../policy/policyVisual'
import {
  buildCultivationLookup, buildInsuranceLookup,
  INSURANCE_CATEGORIES, insuranceParcelStyle,
  isCultivationEmpty, isInsuranceEmpty,
  PLANTING_CATEGORIES, plantingParcelStyle,
  type ParcelVisualMode,
} from './parcelVisualMode'
import { createManualDrawingController, type ManualDrawingController } from '../../map/manualDrawingController'
import { createParcelLayerController, type ParcelLayerController } from '../../map/parcelLayerController'
import { createParcelDetailClickGuard } from '../../map/parcelDetailClickGuard'
import { createParcelWorkModeController, type ParcelWorkModeController } from '../../map/parcelWorkModeController'
import {
  addPendingManualParcel,
  commitManualBatch,
  createManualBatchState,
  hasManualBatchChanges,
  removeManualParcel,
  resetManualBatch,
  undoLatestPendingManualParcel,
  updateManualParcel,
} from './manualBatchState'
import { loadHiddenParcelIds, persistHiddenParcelIds } from './parcelHiddenStorage'
import {
  calculateNextHiddenIds,
  clearPendingParcelFilterState,
  createParcelFilterState,
  restoreAllParcels,
  toggleParcelFilterSelection as toggleFilterSelection,
} from './parcelFilterState'
import { MANUAL_PARCEL_NOTICE_KEY, makeManualParcel, readManualParcels, writeManualParcels, type ManualParcelFeature } from '../../utils/manualParcelStorage'
import { inspectManualGeometry, prepareManualGeometry } from '../../utils/parcelGeometry'

export interface ParcelWorkbenchContext {
  store: ReturnType<typeof useDrilldownStore>
  /** 地块模式（MapView 持有，天气交互与模板共同读取） */
  parcelMode: Ref<ParcelMode>
  /** 保单名册抽屉（MapView 持有，天气进入时关闭） */
  rosterOpen: Ref<boolean>
  /** 地块图层可见性（模板/地图核心共用） */
  parcelVisible: Ref<boolean>
  /** 地块图层开关（模板/地图核心共用） */
  parcelOn: Ref<boolean>
  /** 地块详情面板模板 ref（markSaved 用） */
  detailPanelRef: Ref<InstanceType<typeof ParcelDetailPanel> | undefined>
  /** 灾害/天气模式激活期间禁用手绘与筛选 */
  disasterActive(): boolean
  /** 实时天气激活时选中地块需清除点选天气 */
  weatherCurrentActive(): boolean
  deselectPicked(): void
  /** 全局提示（MapView 持有，多域共用） */
  showNotice(message: string, error?: boolean): void
  /** 地块渲染完成后将轮廓图层置顶（地图核心提供） */
  onAfterRender(): void
  /** 工作模式调整地图最小缩放（地图核心持有 minZoom 状态） */
  onMinZoomChange(minZoom: number): void
  /** 普通模式地图最小缩放（地图核心常量） */
  defaultMinZoom: number
  /** 地块编辑模式的最小缩放阈值（地图核心常量） */
  editMinZoom: number
}

export interface ParcelWorkbench {
  init(map: L.Map): void
  destroy(): void
  /** 当前村代码（非响应式 let；由模板在 selectedParcel 变化重渲染时读取） */
  parcelVillageCode: Ref<string>
  /** 当前编辑中的待保存人工地块 id（keydown Delete 用） */
  readonly editingPendingManualId: string | null
  /** 行政导航确认后：丢弃本轮草稿与待筛选状态（导航 watch 调用） */
  onNavigateReset(): void
  hasAiParcels: Ref<boolean>
  hasManualParcels: Ref<boolean>
  hasFilterableParcels: Ref<boolean>
  manualDraftPoints: Ref<Position[]>
  batchSavedCount: Ref<number>
  batchHasChanges: Ref<boolean>
  manualDistinctPointCount: Ref<number>
  manualDraftAreaText: Ref<string>
  pendingHideCount: Ref<number>
  pendingRestoreCount: Ref<number>
  pendingChangeCount: Ref<number>
  hiddenParcelCount: Ref<number>
  manualDialog: Ref<ManualDialogState>
  parcelDisplayCount: Ref<number>
  parcelDisplayAreaText: Ref<string>
  policyLoadError: Ref<string>
  cultivationLoadError: Ref<string>
  policyFixture: Ref<PolicyFixture | null>
  selectedParcel: Ref<ParcelSummaryInput | null>
  selectedPolicyContext: Ref<ParcelPolicyContext | null>
  selectedCultivationRecords: Ref<CultivationRecord[]>
  selectedInitialRecordKeys: Ref<string[]>
  cultivationEditing: Ref<boolean>
  highlightedInsuredIds: Ref<Set<string>>
  highlightedPolicyIds: Ref<Set<string>>
  selectedRosterItems: Ref<EnrollmentItem[]>
  selectedRosterPartyDisplay: Ref<string>
  // 地图装配回调
  onMapClick(event: L.LeafletMouseEvent): void
  navigationGuard(): Promise<boolean>
  hasUnsavedParcelWork(): boolean
  closeBusinessPanels(): void
  /** 行政导航清场（render 调用：清地块/业务数据；影像与视野由地图核心处理） */
  clearForNavigation(): void
  /** 进入村级：建立当前村上下文并读取本机人工地块（render 调用） */
  enterVillageContext(code: string): void
  /** 非村级：清空业务数据避免串村（render 调用） */
  clearBusinessData(): void
  /** 村级高分影像加载后：设置 AI 地块并渲染（render 调用） */
  applyAiParcels(parcels: FeatureCollection): void
  retryBusinessData(): void
  toggleParcels(): Promise<void>
  setVisualMode(mode: ParcelVisualMode): void
  parcelVisualMode: Ref<ParcelVisualMode>
  plantingEnabledCategories: Ref<Set<string>>
  insuranceEnabledCategories: Ref<Set<string>>
  togglePlantingCategory(category: string): void
  toggleInsuranceCategory(category: string): void
  plantingDataEmpty: Ref<boolean>
  insuranceDataEmpty: Ref<boolean>
  parcelId(feature: Feature): ParcelId | null
  requestCloseDetail(): Promise<void>
  requestRestoreCultivation(): Promise<void>
  saveCultivationRecord(record: CultivationRecord, isExisting: boolean): void
  removeCultivationRecord(record: CultivationRecord): void
  selectRosterItem(item: EnrollmentItem): void
  toggleParcelFilterSelection(id: ParcelId): void
  renderParcelLayer(): void
  startParcelEditing(): Promise<void>
  finishParcelEditing(): void
  saveParcelEdits(): void
  cancelParcelEditing(): void
  restoreAllHiddenParcels(): void
  closeManualDialog(confirmed: boolean): void
  startManualDrawing(): Promise<void>
  startBatchDrawing(): Promise<void>
  exitBatchDrawing(): void
  undoManualPoint(): void
  finishManualDrawing(): Promise<void>
  startPendingManualEditing(feature: ManualParcelFeature): Promise<void>
  startBatchExistingManualEditing(feature: ManualParcelFeature): Promise<void>
  finishPendingManualEditing(): Promise<boolean>
  removeBatchManualParcel(id: string): void
  saveManualBatch(): Promise<void>
  cancelManualBatch(silent?: boolean): Promise<void>
  cancelManualSession(): void
  saveManualDraft(): Promise<void>
}

export interface ManualDialogState {
  open: boolean
  title: string
  message: string
  confirmLabel: string
}

export function useParcelWorkbench(ctx: ParcelWorkbenchContext): ParcelWorkbench {
  const { parcelMode, rosterOpen, parcelVisible, parcelOn } = ctx

  let map!: L.Map
  let parcelLayerController!: ParcelLayerController
  let manualDrawingController!: ManualDrawingController
  let workModeController!: ParcelWorkModeController
  const parcelDetailClickGuard = createParcelDetailClickGuard()

  const hasAiParcels = ref(false)
  const hasManualParcels = ref(false)
  const hasFilterableParcels = computed(() => hasAiParcels.value || hasManualParcels.value)
  const manualDraftPoints = ref<Position[]>([])
  const manualDraftDirty = ref(false)
  const manualBatchState = reactive(createManualBatchState())
  const pendingManualParcels = toRef(manualBatchState, 'pendingParcels')
  const pendingManualEdits = toRef(manualBatchState, 'pendingEdits')
  const pendingRemovedManualIds = toRef(manualBatchState, 'removedIds')
  const batchSavedCount = computed(() => pendingManualParcels.value.length)
  const batchHasChanges = computed(() => hasManualBatchChanges(manualBatchState))
  const manualDistinctPointCount = computed(() => new Set(manualDraftPoints.value.map(([lng, lat]) => `${lng},${lat}`)).size)
  const manualDraftAreaText = computed(() => {
    const prepared = prepareManualGeometry(manualDraftPoints.value).prepared
    return prepared ? `${prepared.areaMu.toFixed(2)} 亩` : '边界待校验'
  })

  const pendingHideCount = ref(0)
  const pendingRestoreCount = ref(0)
  const pendingChangeCount = computed(() => pendingHideCount.value + pendingRestoreCount.value)
  const hiddenParcelCount = ref(0)
  const manualDialog = ref<ManualDialogState>({ open: false, title: '', message: '', confirmLabel: '确定' })
  const parcelDisplayCount = ref(0)
  const parcelDisplayAreaMu = ref(0)
  const parcelDisplayAreaText = computed(() => parcelDisplayAreaMu.value.toLocaleString('zh-CN', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }))

  const policyFixture = ref<PolicyFixture | null>(null)
  const initialCultivationRecords = ref<CultivationRecord[]>([])
  const policyLoadError = ref('')
  const cultivationLoadError = ref('')

  async function loadBusinessData(villageCode?: string) {
    const code = villageCode ?? ''
    const [policy, cultivation] = await Promise.all([
      code ? loadPolicyFixture(code) : Promise.resolve({ data: null as PolicyFixture | null, error: '' }),
      code ? loadCultivationFixture(code) : Promise.resolve({ data: null as CultivationRecord[] | null, error: '' }),
    ])
    policyFixture.value = policy.data
    initialCultivationRecords.value = cultivation.data ?? []
    policyLoadError.value = policy.error ?? ''
    cultivationLoadError.value = cultivation.error ?? ''
  }

  function clearBusinessData() {
    policyFixture.value = null
    initialCultivationRecords.value = []
    policyLoadError.value = ''
    cultivationLoadError.value = ''
  }

  function retryBusinessData() {
    if (parcelVillageCode.value) void loadBusinessData(parcelVillageCode.value)
    else clearBusinessData()
  }

  const selectedParcel = ref<ParcelSummaryInput | null>(null)
  const selectedPolicyContext = ref<ParcelPolicyContext | null>(null)
  const selectedCultivationRecords = ref<CultivationRecord[]>([])
  const selectedInitialRecordKeys = computed(() => selectedParcel.value
    ? initialCultivationRecords.value
        .filter((record) => record.villageCode === parcelVillageCode.value && record.parcelId === selectedParcel.value!.id)
        .map(cultivationKey)
    : [])
  const cultivationEditing = ref(false)
  const highlightedInsuredIds = ref<Set<string>>(new Set())
  const highlightedPolicyIds = ref<Set<string>>(new Set())
  const selectedRosterItems = computed(() => {
    const policy = selectedPolicyContext.value?.currentPolicy
    if (!policyFixture.value || !policy?.enrollmentListId) return []
    const list = policyFixture.value.enrollmentLists.find((entry) => entry.id === policy.enrollmentListId)
    if (!list) return []
    const itemById = new Map(policyFixture.value.enrollmentItems.map((item) => [item.id, item]))
    return list.itemIds.map((itemId) => itemById.get(itemId)).filter((item): item is EnrollmentItem => Boolean(item))
  })
  const selectedRosterPartyDisplay = computed(() => {
    if (selectedPolicyContext.value?.currentPolicy?.insuredMode !== 'insured_roster') return ''
    const firstItem = selectedRosterItems.value[0]
    const firstParty = firstItem && policyFixture.value?.parties.find((party) => party.id === firstItem.insuredPartyId)
    return firstParty ? `${firstParty.name}等${selectedRosterItems.value.length}户种植户` : '—'
  })

  let parcelSource: FeatureCollection | null = null
  let manualParcels: ManualParcelFeature[] = []
  let editingManualOriginal: ManualParcelFeature | null = null
  let editingPendingManualId: string | null = null
  let editingBatchManualKind: 'new' | 'existing' | null = null
  const parcelVillageCode = ref('')
  const parcelVisualMode = ref<ParcelVisualMode>('parcel')
  /** 种植图层当前启用的子分类（默认全部启用） */
  const plantingEnabledCategories = ref<Set<string>>(new Set(PLANTING_CATEGORIES))
  /** 保险图层当前启用的子分类（默认全部启用） */
  const insuranceEnabledCategories = ref<Set<string>>(new Set(INSURANCE_CATEGORIES))
  const cultivationByParcelId = computed(() =>
    buildCultivationLookup(initialCultivationRecords.value),
  )
  const insuranceByParcelId = computed(() =>
    policyFixture.value ? buildInsuranceLookup(policyFixture.value) : new Map<string, never>(),
  )
  /** 种植图层数据是否为空（Spec §12） */
  const plantingDataEmpty = computed(() => isCultivationEmpty(cultivationByParcelId.value))
  /** 保险图层数据是否为空（Spec §12） */
  const insuranceDataEmpty = computed(() => isInsuranceEmpty(insuranceByParcelId.value))
  const parcelFilterState = createParcelFilterState()
  const hiddenParcelIds = parcelFilterState.hiddenIds
  const pendingHideParcelIds = parcelFilterState.pendingHideIds
  const pendingRestoreParcelIds = parcelFilterState.pendingRestoreIds
  let manualDialogResolve: ((confirmed: boolean) => void) | null = null

  function clearSelection() {
    selectedParcel.value = null
    selectedPolicyContext.value = null
    selectedCultivationRecords.value = []
    cultivationEditing.value = false
    rosterOpen.value = false
    highlightedInsuredIds.value = new Set()
    highlightedPolicyIds.value = new Set()
  }

  function clearForNavigation() {
    clearSelection()
    leaveParcelWorkMode()
    pendingHideParcelIds.clear()
    pendingRestoreParcelIds.clear()
    pendingHideCount.value = 0
    pendingRestoreCount.value = 0
    parcelSource = null
    hasAiParcels.value = false
    hasManualParcels.value = false
    manualParcels = []
    editingManualOriginal = null
    manualDraftPoints.value = []
    manualDraftDirty.value = false
    resetManualBatch(manualBatchState)
    editingPendingManualId = null
    editingBatchManualKind = null
    parcelVillageCode.value = ''
    parcelVisualMode.value = 'parcel'
    plantingEnabledCategories.value = new Set(PLANTING_CATEGORIES)
    insuranceEnabledCategories.value = new Set(INSURANCE_CATEGORIES)
    hiddenParcelIds.clear()
    hiddenParcelCount.value = 0
    parcelDisplayCount.value = 0
    parcelDisplayAreaMu.value = 0
    clearBusinessData()
    parcelLayerController?.clear()
    manualDrawingController?.clear()
    parcelVisible.value = false
    // 台风专题与业务图层可同时显示；行政切换后地块默认保持开启。
    parcelOn.value = true
  }

  async function toggleParcels() {
    if (parcelMode.value !== 'idle') return
    if (parcelOn.value && selectedParcel.value && cultivationEditing.value) {
      const confirmed = await openManualDialog('关闭地块图层', '当前种植档案尚未保存，关闭后将丢失编辑内容。', '确认关闭')
      if (!confirmed) return
    }
    parcelOn.value = !parcelOn.value
    if (!parcelOn.value) clearSelection()
    renderParcelLayer()
  }

  function setVisualMode(mode: ParcelVisualMode) {
    if (parcelMode.value !== 'idle') return
    // 同模式再点 → 回到默认地块图层（Spec §2 单选模式）
    parcelVisualMode.value = parcelVisualMode.value === mode ? 'parcel' : mode
    renderParcelLayer()
  }

  function togglePlantingCategory(category: string) {
    const next = new Set(plantingEnabledCategories.value)
    if (next.has(category)) next.delete(category)
    else next.add(category)
    plantingEnabledCategories.value = next
    renderParcelLayer()
  }

  function toggleInsuranceCategory(category: string) {
    const next = new Set(insuranceEnabledCategories.value)
    if (next.has(category)) next.delete(category)
    else next.add(category)
    insuranceEnabledCategories.value = next
    renderParcelLayer()
  }

  function parcelId(feature: Feature): ParcelId | null {
    const id = feature.properties?.id
    return id === null || id === undefined ? null : String(id)
  }

  function refreshSelectedCultivation() {
    if (!selectedParcel.value) return
    selectedCultivationRecords.value = readEffectiveCultivation(parcelVillageCode.value, selectedParcel.value.id, initialCultivationRecords.value)
  }

  function requestSelectParcel(parcel: ParcelSummaryInput, event: L.LeafletMouseEvent) {
    parcelDetailClickGuard.markParcelClick(event.originalEvent)
    void selectParcel(parcel)
  }

  async function selectParcel(parcel: ParcelSummaryInput) {
    if (parcelMode.value !== 'idle' || !parcelOn.value) return
    if (cultivationEditing.value && !await openManualDialog('切换地块', '当前种植档案尚未保存，是否确认放弃并切换地块？', '确认切换')) return
    selectedParcel.value = parcel
    selectedPolicyContext.value = policyFixture.value
      ? parcelPolicyContext(policyFixture.value, parcel.id)
      : { currentCoverage: null, currentPolicy: null, currentItem: null, currentInsured: null, applicant: null, history: [] }
    refreshSelectedCultivation()
    const context = selectedPolicyContext.value
    rosterOpen.value = false
    const currentPolicyCoverages = policyFixture.value && context?.currentPolicy
      ? policyCoverages(policyFixture.value, context.currentPolicy.id)
      : []
    if (currentPolicyCoverages.length > 1) {
      // 只要当前保单关联多个地块，点击其中任一地块就展示同一保单的全部可见关联地块。
      // 当前地块仍由 selectionStyle 使用橙色主高亮，其余关联地块使用绿色次级高亮。
      highlightedInsuredIds.value = new Set(currentPolicyCoverages.map((entry) => entry.parcelId))
      highlightedPolicyIds.value = new Set()
    } else {
      const sameInsuredContext = selectedPolicyContext.value?.currentInsured?.id && highlightedInsuredIds.value.has(parcel.id)
      if (!sameInsuredContext) {
        highlightedInsuredIds.value = new Set()
        highlightedPolicyIds.value = new Set()
      }
    }
    renderParcelLayer()
    if (ctx.weatherCurrentActive()) ctx.deselectPicked()
  }

  async function requestCloseDetail() {
    if (cultivationEditing.value && !await openManualDialog('关闭地块详情', '当前种植档案尚未保存，是否确认放弃？', '确认放弃')) return
    clearSelection()
    renderParcelLayer()
    if (ctx.weatherCurrentActive()) ctx.deselectPicked()
  }

  async function requestRestoreCultivation() {
    if (!selectedParcel.value || !await openManualDialog('恢复初始档案', '将清除当前地块的本机覆盖与新增记录，是否继续？', '确认恢复')) return
    const result = restoreInitialCultivation(parcelVillageCode.value, selectedParcel.value.id)
    if (!result.ok) { ctx.showNotice(result.error ?? '恢复失败', true); return }
    refreshSelectedCultivation()
    ctx.showNotice('已恢复当前地块初始档案')
  }

  function saveCultivationRecord(record: CultivationRecord, isExisting: boolean) {
    const initial = selectedInitialRecordKeys.value.includes(cultivationKey(record))
    const result = isExisting
      ? (initial
          ? saveCultivationOverride(parcelVillageCode.value, record, initialCultivationRecords.value)
          : updateAddedCultivation(parcelVillageCode.value, record, initialCultivationRecords.value))
      : addCultivationRecord(parcelVillageCode.value, record, initialCultivationRecords.value)
    if (!result.ok) {
      ctx.showNotice(result.error ?? '种植档案保存失败', true)
      return
    }
    refreshSelectedCultivation()
    cultivationEditing.value = false
    ctx.detailPanelRef.value?.markSaved()
    ctx.showNotice('种植档案已保存到当前浏览器')
  }

  function removeCultivationRecord(record: CultivationRecord) {
    const result = removeAddedCultivation(parcelVillageCode.value, record)
    if (!result.ok) { ctx.showNotice(result.error ?? '删除失败', true); return }
    refreshSelectedCultivation()
    ctx.showNotice('新增种植档案已删除')
  }

  function selectRosterItem(item: EnrollmentItem) {
    if (!policyFixture.value || !selectedPolicyContext.value?.currentPolicy) return
    highlightedInsuredIds.value = new Set(insuredCoverages(policyFixture.value, item.insuredPartyId, selectedPolicyContext.value.currentPolicy.id).map((entry) => entry.parcelId))
    renderParcelLayer()
  }

  function selectionStyle(feature: Feature): L.PathOptions | null {
    const id = parcelId(feature)
    if (!id || !selectedParcel.value) {
      // 无选中时仍可按视觉模式着色
      if (id && parcelVisualMode.value === 'planting') return plantingParcelStyle(id, cultivationByParcelId.value, plantingEnabledCategories.value)
      if (id && parcelVisualMode.value === 'insurance') return insuranceParcelStyle(id, insuranceByParcelId.value, insuranceEnabledCategories.value)
      return null
    }
    if (id === selectedParcel.value.id) return { color: '#f97316', weight: 4, fillColor: '#fb923c', fillOpacity: 0.34 }
    if (highlightedInsuredIds.value.has(id)) return linkedParcelStyle(selectedPolicyContext.value?.currentPolicy?.insuredMode)
    if (highlightedPolicyIds.value.has(id)) return { color: '#a78bfa', weight: 2, dashArray: '7 5', fillColor: '#c4b5fd', fillOpacity: 0.14 }
    if (parcelVisualMode.value === 'planting') return plantingParcelStyle(id, cultivationByParcelId.value, plantingEnabledCategories.value)
    if (parcelVisualMode.value === 'insurance') return insuranceParcelStyle(id, insuranceByParcelId.value, insuranceEnabledCategories.value)
    return null
  }

  function syncPendingParcelCounts() {
    pendingHideCount.value = pendingHideParcelIds.size
    pendingRestoreCount.value = pendingRestoreParcelIds.size
  }

  function toggleParcelFilterSelection(id: ParcelId) {
    toggleFilterSelection(parcelFilterState, id)
    syncPendingParcelCounts()
  }

  function renderParcelLayer() {
    manualDrawingController.clearRemoveAction()
    const metrics = parcelLayerController.render()
    parcelVisible.value = metrics.parcelVisible
    hiddenParcelCount.value = metrics.hiddenCount
    parcelDisplayCount.value = metrics.displayCount
    parcelDisplayAreaMu.value = metrics.displayAreaMu
    if (parcelMode.value === 'batch' && editingPendingManualId) manualDrawingController.renderRemoveAction()
  }

  function enterParcelWorkMode(mode: ParcelMode, dim = true) {
    workModeController.enter(mode, dim)
  }

  function leaveParcelWorkMode() {
    workModeController?.leave()
  }

  async function startParcelEditing() {
    if (ctx.disasterActive() || !parcelOn.value || !hasFilterableParcels.value) return
    if (cultivationEditing.value && !await openManualDialog('进入筛选模式', '当前种植档案尚未保存，是否确认放弃？', '确认进入')) return
    clearSelection()
    clearPendingParcelFilterState(parcelFilterState)
    syncPendingParcelCounts()
    enterParcelWorkMode('filter')
    renderParcelLayer()
  }

  function finishParcelEditing() {
    leaveParcelWorkMode()
    clearPendingParcelFilterState(parcelFilterState)
    syncPendingParcelCounts()
    renderParcelLayer()
  }

  function saveParcelEdits() {
    if (!pendingChangeCount.value || !parcelVillageCode.value) return
    const hiddenCount = pendingHideParcelIds.size
    const restoredCount = pendingRestoreParcelIds.size
    const nextHidden = calculateNextHiddenIds(parcelFilterState)
    if (!persistHiddenParcelIds(parcelVillageCode.value, nextHidden)) {
      window.alert('保存失败，本次修改尚未生效。请检查浏览器是否允许本地存储。')
      return
    }
    hiddenParcelIds.clear()
    for (const id of nextHidden) hiddenParcelIds.add(id)
    finishParcelEditing()
    ctx.showNotice(`已隐藏 ${hiddenCount} 个地块，恢复 ${restoredCount} 个地块`)
  }

  function cancelParcelEditing() {
    finishParcelEditing()
  }

  function restoreAllHiddenParcels() {
    if (!hiddenParcelIds.size) return
    restoreAllParcels(parcelFilterState)
    syncPendingParcelCounts()
    renderParcelLayer()
  }

  function showManualStorageNoticeOnce() {
    try {
      if (localStorage.getItem(MANUAL_PARCEL_NOTICE_KEY)) return
      window.alert('人工地块仅保存在当前浏览器。清理浏览器数据、更换浏览器或设备后将无法恢复。')
      localStorage.setItem(MANUAL_PARCEL_NOTICE_KEY, 'shown')
    } catch {
      // 存储不可用会在实际保存时给出明确错误，不阻塞绘制。
    }
  }

  function effectiveBatchManualParcels(): ManualParcelFeature[] {
    const edits = new Map(pendingManualEdits.value.map((feature) => [feature.properties.id, feature]))
    return manualParcels
      .filter((feature) => !pendingRemovedManualIds.value.includes(feature.properties.id))
      .map((feature) => edits.get(feature.properties.id) ?? feature)
  }

  function manualGeometryWarnings(preparedGeometry: ManualParcelFeature['geometry'], excludedPendingId?: string) {
    const otherFeatures: Feature[] = [
      ...(parcelSource?.features ?? []),
      ...effectiveBatchManualParcels().filter((feature) => feature.properties.id !== excludedPendingId),
      ...pendingManualParcels.value.filter((feature) => feature.properties.id !== excludedPendingId),
    ]
    return inspectManualGeometry(preparedGeometry, ctx.store.current.geometry, otherFeatures)
  }

  function openManualDialog(title: string, message: string, confirmLabel = '确定'): Promise<boolean> {
    if (manualDialogResolve) manualDialogResolve(false)
    manualDialog.value = { open: true, title, message, confirmLabel }
    return new Promise((resolve) => { manualDialogResolve = resolve })
  }

  function closeManualDialog(confirmed: boolean) {
    manualDialog.value.open = false
    const resolve = manualDialogResolve
    manualDialogResolve = null
    resolve?.(confirmed)
  }

  async function confirmManualWarnings(preparedGeometry: ManualParcelFeature['geometry'], excludedPendingId?: string) {
    const warnings = manualGeometryWarnings(preparedGeometry, excludedPendingId)
    if (!(warnings.overlapCount || warnings.outsideVillage || warnings.incompleteChecks)) return true
    return openManualDialog('地块范围提醒', manualWarningMessage(warnings.overlapCount, warnings.outsideVillage, warnings.incompleteChecks), '仍要继续')
  }

  async function startManualDrawing() {
    if (ctx.disasterActive() || ctx.store.current.level !== 'village') return
    if (cultivationEditing.value && !await openManualDialog('进入新增模式', '当前种植档案尚未保存，是否确认放弃？', '确认进入')) return
    clearSelection()
    showManualStorageNoticeOnce()
    parcelOn.value = true
    editingManualOriginal = null
    editingPendingManualId = null
    manualDraftPoints.value = []
    resetManualBatch(manualBatchState)
    manualDraftDirty.value = false
    enterParcelWorkMode('batch')
    manualDrawingController.setInteraction('batch')
    renderParcelLayer()
  }

  async function startBatchDrawing() {
    if (parcelMode.value !== 'batch') return
    if (editingPendingManualId && !await finishPendingManualEditing()) return
    editingPendingManualId = null
    editingBatchManualKind = null
    manualDraftPoints.value = []
    manualDrawingController.clearDraft()
    parcelMode.value = 'drawing'
    manualDrawingController.setInteraction('drawing')
    renderParcelLayer()
  }

  function exitBatchDrawing() {
    if (parcelMode.value !== 'drawing') return
    manualDraftPoints.value = []
    manualDrawingController.clearDraft()
    parcelMode.value = 'batch'
    manualDrawingController.setInteraction('batch')
    manualDraftDirty.value = batchHasChanges.value
    renderParcelLayer()
  }

  function undoManualPoint() {
    if (parcelMode.value !== 'batch' && parcelMode.value !== 'drawing') return
    if (editingPendingManualId) {
      editingPendingManualId = null
      editingBatchManualKind = null
      manualDraftPoints.value = []
      manualDrawingController.clearDraft()
      renderParcelLayer()
      return
    }
    if (manualDraftPoints.value.length) {
      manualDraftPoints.value = manualDraftPoints.value.slice(0, -1)
      manualDrawingController.renderDraft(false)
    } else if (pendingManualParcels.value.length) {
      undoLatestPendingManualParcel(manualBatchState)
      renderParcelLayer()
    }
    manualDraftDirty.value = manualDraftPoints.value.length > 0 || pendingManualParcels.value.length > 0
  }

  async function finishManualDrawing() {
    if (parcelMode.value !== 'drawing' || editingPendingManualId) return
    const checked = prepareManualGeometry(manualDraftPoints.value)
    if (!checked.prepared) {
      ctx.showNotice(checked.error ?? '至少需要 3 个不同顶点才能闭合地块。', true)
      return
    }
    if (!await confirmManualWarnings(checked.prepared.geometry)) return
    addPendingManualParcel(manualBatchState, makeManualParcel(parcelVillageCode.value, checked.prepared))
    manualDraftPoints.value = []
    manualDraftDirty.value = true
    manualDrawingController.clearDraft()
    parcelMode.value = 'batch'
    manualDrawingController.setInteraction('batch')
    renderParcelLayer()
  }

  async function startPendingManualEditing(feature: ManualParcelFeature) {
    await startBatchManualEditing(feature, 'new')
  }

  async function startBatchExistingManualEditing(feature: ManualParcelFeature) {
    await startBatchManualEditing(feature, 'existing')
  }

  async function startBatchManualEditing(feature: ManualParcelFeature, kind: 'new' | 'existing') {
    if (manualDraftPoints.value.length && !editingPendingManualId) {
      ctx.showNotice('请先点击第一个顶点或按 N 闭合当前地块，或撤销当前顶点。', true)
      return
    }
    if (editingPendingManualId === feature.properties.id && editingBatchManualKind === kind) return
    if (editingPendingManualId && !await finishPendingManualEditing()) return
    editingPendingManualId = feature.properties.id
    editingBatchManualKind = kind
    manualDraftPoints.value = feature.geometry.coordinates[0].slice(0, -1).map(([lng, lat]) => [lng, lat])
    renderParcelLayer()
    manualDrawingController.renderDraft(true)
  }

  async function finishPendingManualEditing(): Promise<boolean> {
    if (!editingPendingManualId) return true
    const checked = prepareManualGeometry(manualDraftPoints.value)
    if (!checked.prepared) {
      ctx.showNotice(checked.error ?? '地块几何无效。', true)
      return false
    }
    if (!await confirmManualWarnings(checked.prepared.geometry, editingPendingManualId)) return false
    const source = editingBatchManualKind === 'existing' ? effectiveBatchManualParcels() : pendingManualParcels.value
    const original = source.find((feature) => feature.properties.id === editingPendingManualId)
    if (!original) return false
    const updated = makeManualParcel(parcelVillageCode.value, checked.prepared, original)
    updateManualParcel(manualBatchState, updated, editingBatchManualKind === 'existing' ? 'existing' : 'new')
    editingPendingManualId = null
    editingBatchManualKind = null
    manualDraftPoints.value = []
    manualDrawingController.clearDraft()
    renderParcelLayer()
    return true
  }

  function removeBatchManualParcel(id: string) {
    const kind = editingBatchManualKind === 'existing' || manualParcels.some((feature) => feature.properties.id === id) ? 'existing' : 'new'
    removeManualParcel(manualBatchState, id, kind)
    if (editingPendingManualId === id) {
      editingPendingManualId = null
      editingBatchManualKind = null
      manualDraftPoints.value = []
      manualDrawingController.clearDraft()
    }
    manualDraftDirty.value = batchHasChanges.value
    renderParcelLayer()
  }

  async function saveManualBatch() {
    if (!parcelVillageCode.value || (parcelMode.value !== 'batch' && parcelMode.value !== 'drawing')) return
    if (editingPendingManualId && !await finishPendingManualEditing()) return
    if (manualDraftPoints.value.length) {
      ctx.showNotice('当前地块尚未闭合，请点击第一个顶点或按 N 完成绘制。', true)
      return
    }
    if (!batchHasChanges.value) return
    const nextFeatures = commitManualBatch(manualParcels, manualBatchState)
    for (const id of pendingRemovedManualIds.value) {
      const cleaned = removeCultivationForParcel(parcelVillageCode.value, id)
      if (!cleaned.ok) { ctx.showNotice(cleaned.error ?? '删除地块关联档案失败，未保存本批次。', true); return }
    }
    const addedCount = pendingManualParcels.value.length
    const changedCount = pendingManualEdits.value.length
    const removedCount = pendingRemovedManualIds.value.length
    const persisted = writeManualParcels(parcelVillageCode.value, nextFeatures)
    if (!persisted.ok) {
      ctx.showNotice(persisted.error, true)
      return
    }
    manualParcels = persisted.features
    hasManualParcels.value = manualParcels.length > 0
    for (const id of pendingRemovedManualIds.value) {
      hiddenParcelIds.delete(id)
      pendingHideParcelIds.delete(id)
      pendingRestoreParcelIds.delete(id)
    }
    persistHiddenParcelIds(parcelVillageCode.value, hiddenParcelIds)
    resetManualBatch(manualBatchState)
    manualDraftDirty.value = false
    leaveParcelWorkMode()
    manualDrawingController.clearDraft()
    renderParcelLayer()
    ctx.showNotice(`已保存：新增 ${addedCount} 个，修改 ${changedCount} 个，移除 ${removedCount} 个`)
  }

  async function cancelManualBatch(silent = false) {
    const hasOpenDraft = manualDraftPoints.value.length > 0 && !editingPendingManualId
    const hasPendingEdit = Boolean(editingPendingManualId)
    const hasContent = pendingManualParcels.value.length > 0 || pendingManualEdits.value.length > 0 || pendingRemovedManualIds.value.length > 0 || hasOpenDraft || hasPendingEdit
    if (!silent && hasContent
        && !await openManualDialog('取消新增地块', '当前有未保存的操作，是否确认放弃？', '确认放弃')) return
    resetManualBatch(manualBatchState)
    editingPendingManualId = null
    editingBatchManualKind = null
    manualDraftPoints.value = []
    manualDraftDirty.value = false
    manualDrawingController.clearDraft()
    leaveParcelWorkMode()
    renderParcelLayer()
  }

  function cancelManualSession() {
    manualDrawingController.setInteraction('none')
    manualDrawingController.clearDraft()
    manualDraftPoints.value = []
    manualDraftDirty.value = false
    editingManualOriginal = null
    leaveParcelWorkMode()
    renderParcelLayer()
  }

  function manualWarningMessage(overlapCount: number, outsideVillage: boolean, incompleteChecks: number): string {
    const parts: string[] = []
    if (overlapCount) parts.push(`与 ${overlapCount} 个已有地块重叠`)
    if (outsideVillage) parts.push('部分范围越过当前村界')
    if (incompleteChecks) parts.push(`${incompleteChecks} 项空间关系无法完整校验`)
    return `当前地块${parts.join('，')}。是否仍要保存？`
  }

  async function saveManualDraft() {
    if (!parcelVillageCode.value) return
    const checked = prepareManualGeometry(manualDraftPoints.value)
    if (!checked.prepared) {
      ctx.showNotice(checked.error ?? '地块几何无效。', true)
      return
    }
    const editingId = editingManualOriginal?.properties.id
    const otherFeatures: Feature[] = [
      ...(parcelSource?.features ?? []),
      ...manualParcels.filter((feature) => feature.properties.id !== editingId),
    ]
    const warnings = inspectManualGeometry(checked.prepared.geometry, ctx.store.current.geometry, otherFeatures)
    if ((warnings.overlapCount || warnings.outsideVillage || warnings.incompleteChecks)
        && !await openManualDialog('地块范围提醒', manualWarningMessage(warnings.overlapCount, warnings.outsideVillage, warnings.incompleteChecks), '仍要保存')) return

    const next = makeManualParcel(
      parcelVillageCode.value,
      checked.prepared,
      editingManualOriginal ?? undefined,
      undefined,
    )
    const nextFeatures = editingManualOriginal
      ? manualParcels.map((feature) => feature.properties.id === editingManualOriginal!.properties.id ? next : feature)
      : [...manualParcels, next]
    const persisted = writeManualParcels(parcelVillageCode.value, nextFeatures)
    if (!persisted.ok) {
      ctx.showNotice(persisted.error, true)
      return
    }
    manualParcels = persisted.features
    hasManualParcels.value = manualParcels.length > 0
    manualDrawingController.clearDraft()
    manualDraftPoints.value = []
    manualDraftDirty.value = false
    editingManualOriginal = null
    leaveParcelWorkMode()
    renderParcelLayer()
    ctx.showNotice('人工地块已保存到当前浏览器')
  }

  function hasUnsavedParcelWork(): boolean {
    if (cultivationEditing.value) return true
    if (parcelMode.value === 'batch' || parcelMode.value === 'drawing') return manualDraftPoints.value.length > 0 || batchHasChanges.value || Boolean(editingPendingManualId)
    if (parcelMode.value === 'editing') return manualDraftDirty.value
    return pendingChangeCount.value > 0
  }

  function closeBusinessPanels() {
    clearSelection()
    rosterOpen.value = false
  }

  async function navigationGuard(): Promise<boolean> {
    if (!hasUnsavedParcelWork()) { clearSelection(); return true }
    return openManualDialog('离开当前村', '当前修改尚未保存，离开后将丢失。是否继续？', '确认离开')
  }

  function enterVillageContext(code: string) {
    parcelVillageCode.value = code
    const manualResult = readManualParcels(code)
    manualParcels = manualResult.features
    hasManualParcels.value = manualParcels.length > 0
    hiddenParcelIds.clear()
    for (const id of loadHiddenParcelIds(code)) hiddenParcelIds.add(id)
    if (manualResult.error) ctx.showNotice(manualResult.error, true)
    renderParcelLayer()
    // 进入村级后按村代码加载保单/种植档案业务数据（无产物村静默为空，不报阻断错误）
    void loadBusinessData(code)
  }

  function applyAiParcels(parcels: FeatureCollection) {
    parcelSource = parcels
    hasAiParcels.value = true
    const validIds = new Set([
      ...parcels.features.map(parcelId).filter((id): id is ParcelId => id !== null),
      ...manualParcels.map((feature) => feature.properties.id),
    ])
    for (const id of [...hiddenParcelIds]) {
      if (!validIds.has(id)) hiddenParcelIds.delete(id)
    }
    renderParcelLayer()
  }

  function onNavigateReset() {
    if (parcelMode.value === 'filter') {
      clearPendingParcelFilterState(parcelFilterState)
      syncPendingParcelCounts()
    }
    manualDrawingController.setInteraction('none')
    manualDrawingController.clearDraft()
    manualDraftPoints.value = []
    manualDraftDirty.value = false
  }

  function onMapClick(event: L.LeafletMouseEvent) {
    // Canvas 矢量地块共用地图 canvas；点击 canvas 不等同于地图空白，不能用于关闭详情。
    if (parcelDetailClickGuard.consumeMapClick(event.originalEvent)) return
    const target = event.originalEvent.target
    if (target instanceof HTMLCanvasElement) return
    if (parcelMode.value === 'idle' && selectedParcel.value && !rosterOpen.value) void requestCloseDetail()
  }

  function init(target: L.Map) {
    map = target
    parcelLayerController = createParcelLayerController(
      map,
      () => ({
        mode: parcelMode.value,
        parcelOn: parcelOn.value,
        parcelSource,
        manualParcels,
        pendingManualParcels: pendingManualParcels.value,
        pendingManualEdits: pendingManualEdits.value,
        removedManualIds: pendingRemovedManualIds.value,
        editingManualOriginalId: editingManualOriginal?.properties.id ?? null,
        editingPendingManualId,
        editingBatchKind: editingBatchManualKind,
        hiddenIds: hiddenParcelIds,
        pendingHideIds: pendingHideParcelIds,
        pendingRestoreIds: pendingRestoreParcelIds,
      }),
      {
        parcelId,
        onFilterToggle: toggleParcelFilterSelection,
        onSelectBase: (feature, event) => { const parcel = fromBaseParcel(feature.properties ?? {}); if (parcel) requestSelectParcel(parcel, event) },
        onSelectManual: (feature, event) => { requestSelectParcel(fromManualParcel(feature), event) },
        onEditExisting: (feature) => { void startBatchExistingManualEditing(feature) },
        onEditPending: (feature) => { void startPendingManualEditing(feature) },
        onAfterRender: ctx.onAfterRender,
        selectionStyle,
      },
    )
    manualDrawingController = createManualDrawingController(
      map,
      () => ({
        mode: parcelMode.value,
        points: manualDraftPoints.value,
        distinctPointCount: manualDistinctPointCount.value,
        selectedId: editingPendingManualId,
      }),
      {
        onPointAdded: (point) => {
          manualDraftPoints.value = [...manualDraftPoints.value, point]
          manualDraftDirty.value = true
          manualDrawingController.renderDraft(false)
        },
        onPointMoved: (index, point) => {
          manualDraftPoints.value[index] = point
          manualDraftDirty.value = true
        },
        onCloseRequested: () => { void finishManualDrawing() },
        onBlankMapClick: () => { if (parcelMode.value === 'idle' && selectedParcel.value) void requestCloseDetail(); else void finishPendingManualEditing() },
        onRemoveRequested: removeBatchManualParcel,
      },
    )
    workModeController = createParcelWorkModeController(map, {
      defaultMinZoom: ctx.defaultMinZoom,
      editMinZoom: ctx.editMinZoom,
      onModeChange: (mode) => { parcelMode.value = mode },
      onMinZoomChange: (minZoom) => { ctx.onMinZoomChange(minZoom) },
      stopDrawingInteraction: () => manualDrawingController.setInteraction('none'),
    })
  }

  function destroy() {
    workModeController?.destroy()
    manualDrawingController?.destroy()
    parcelLayerController?.destroy()
  }

  return {
    init,
    destroy,
    parcelVillageCode,
    get editingPendingManualId() { return editingPendingManualId },
    onNavigateReset,
    hasAiParcels,
    hasManualParcels,
    hasFilterableParcels,
    manualDraftPoints,
    batchSavedCount,
    batchHasChanges,
    manualDistinctPointCount,
    manualDraftAreaText,
    pendingHideCount,
    pendingRestoreCount,
    pendingChangeCount,
    hiddenParcelCount,
    manualDialog,
    parcelDisplayCount,
    parcelDisplayAreaText,
    policyLoadError,
    cultivationLoadError,
    policyFixture,
    selectedParcel,
    selectedPolicyContext,
    selectedCultivationRecords,
    selectedInitialRecordKeys,
    cultivationEditing,
    highlightedInsuredIds,
    highlightedPolicyIds,
    selectedRosterItems,
    selectedRosterPartyDisplay,
    onMapClick,
    navigationGuard,
    hasUnsavedParcelWork,
    closeBusinessPanels,
    clearForNavigation,
    enterVillageContext,
    clearBusinessData,
    applyAiParcels,
    retryBusinessData,
    toggleParcels,
    setVisualMode,
    parcelVisualMode,
    plantingEnabledCategories,
    insuranceEnabledCategories,
    togglePlantingCategory,
    toggleInsuranceCategory,
    plantingDataEmpty,
    insuranceDataEmpty,
    parcelId,
    requestCloseDetail,
    requestRestoreCultivation,
    saveCultivationRecord,
    removeCultivationRecord,
    selectRosterItem,
    toggleParcelFilterSelection,
    renderParcelLayer,
    startParcelEditing,
    finishParcelEditing,
    saveParcelEdits,
    cancelParcelEditing,
    restoreAllHiddenParcels,
    closeManualDialog,
    startManualDrawing,
    startBatchDrawing,
    exitBatchDrawing,
    undoManualPoint,
    finishManualDrawing,
    startPendingManualEditing,
    startBatchExistingManualEditing,
    finishPendingManualEditing,
    removeBatchManualParcel,
    saveManualBatch,
    cancelManualBatch,
    cancelManualSession,
    saveManualDraft,
  }
}
