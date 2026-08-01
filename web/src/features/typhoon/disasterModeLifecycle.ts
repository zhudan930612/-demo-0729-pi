import type { TyphoonDetail } from './typhoonTypes'
import type { TyphoonLayerSnapshot } from '../../map/typhoonLayerController'

export interface DisasterEnterPorts {
  hasUnsavedWork(): boolean
  isActive(): boolean
  setActive(active: boolean): void
  closeBusinessPanels(): void
  hideParcelLayers(): void
  resetToProvince(): Promise<boolean>
  renderProvincePanorama(): Promise<void>
  enterRepository(): void
}

/** 保证进入顺序固定为：关闭业务态 → 回省 → 省级全景 → 启动台风请求。 */
export async function enterDisasterMode(ports: DisasterEnterPorts): Promise<boolean> {
  if (ports.isActive() || ports.hasUnsavedWork()) return false
  ports.closeBusinessPanels()
  ports.hideParcelLayers()
  ports.setActive(true)
  const reset = await ports.resetToProvince()
  if (!reset) {
    ports.setActive(false)
    return false
  }
  await ports.renderProvincePanorama()
  if (!ports.isActive()) return false
  ports.enterRepository()
  return true
}

export interface DisasterExitPorts {
  isActive(): boolean
  exitRepository(): void
  clearTyphoonLayers(): void
  setActive(active: boolean): void
}

/** 退出不读取或写入地图相机，也不重新渲染行政/地块业务。 */
export function exitDisasterMode(ports: DisasterExitPorts): boolean {
  if (!ports.isActive()) return false
  ports.exitRepository()
  ports.clearTyphoonLayers()
  ports.setActive(false)
  return true
}

export interface TyphoonSnapshotSource {
  realtimeDetails: readonly TyphoonDetail[]
  openedHistoricalIds: readonly string[]
  details: Readonly<Record<string, TyphoonDetail | undefined>>
  focusedTyphoonId: string | null
  selectedNodeByTyphoon: Readonly<Record<string, string | undefined>>
  visibleObservationCountByTyphoon?: Readonly<Record<string, number | undefined>>
}

export function mapTyphoonLayerSnapshot(source: TyphoonSnapshotSource): TyphoonLayerSnapshot {
  return {
    realtime: source.realtimeDetails.map((detail) => ({ detail })),
    historical: source.openedHistoricalIds.flatMap((id) => source.details[id] ? [{
      detail: source.details[id]!,
      visibleObservationCount: source.visibleObservationCountByTyphoon?.[id],
    }] : []),
    focusedTyphoonId: source.focusedTyphoonId,
    selectedNodeByTyphoon: source.selectedNodeByTyphoon,
  }
}

export function autoLevelAllowed(disasterActive: boolean, parcelMode: string, suppressAutoZoom: boolean): boolean {
  return !disasterActive && parcelMode === 'idle' && !suppressAutoZoom
}
