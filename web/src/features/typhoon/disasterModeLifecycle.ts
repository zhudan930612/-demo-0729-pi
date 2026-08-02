import type { TyphoonDetail } from './typhoonTypes'
import type { TyphoonLayerSnapshot } from '../../map/typhoonLayerController'

export interface DisasterEnterPorts {
  hasUnsavedWork(): boolean
  isActive(): boolean
  setActive(active: boolean): void
  closeBusinessPanels(): void
  hideParcelLayers(): void
  resetToProvince(): Promise<boolean>
  prepareProvinceLayers(): Promise<void>
  enterRepository(): void
  rollback(error?: unknown): void
}

export interface DisasterExitPorts {
  isActive(): boolean
  exitRepository(): void
  clearTyphoonLayers(): void
  setActive(active: boolean): void
  invalidateNavigation(): void
}

/** 唯一 generation owner：旧 enter 无法借随后重进产生的新 active 状态复活。 */
export function createDisasterModeCoordinator() {
  let generation = 0
  async function enter(ports: DisasterEnterPorts): Promise<boolean> {
    if (ports.isActive() || ports.hasUnsavedWork()) return false
    const token = ++generation
    const current = () => token === generation && ports.isActive()
    try {
      ports.closeBusinessPanels()
      ports.hideParcelLayers()
      ports.setActive(true)
      const reset = await ports.resetToProvince()
      if (!current()) return false
      if (!reset) { generation += 1; ports.rollback(); return false }
      await ports.prepareProvinceLayers()
      if (!current()) return false
      ports.enterRepository()
      return true
    } catch (error) {
      if (token !== generation) return false
      generation += 1
      ports.rollback(error)
      return false
    }
  }
  function exit(ports: DisasterExitPorts): boolean {
    generation += 1
    ports.invalidateNavigation()
    if (!ports.isActive()) return false
    ports.exitRepository()
    ports.clearTyphoonLayers()
    ports.setActive(false)
    return true
  }
  return { enter, exit, get generation() { return generation } }
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
    historical: source.openedHistoricalIds.flatMap((id) => source.details[id] ? [{ detail: source.details[id]!, visibleObservationCount: source.visibleObservationCountByTyphoon?.[id] }] : []),
    focusedTyphoonId: source.focusedTyphoonId,
    selectedNodeByTyphoon: source.selectedNodeByTyphoon,
  }
}
export function autoLevelAllowed(disasterActive: boolean, parcelMode: string, suppressAutoZoom: boolean): boolean { return !disasterActive && parcelMode === 'idle' && !suppressAutoZoom }
export function shouldAutoFitTyphoon(input: { active: boolean; phase: string; focusedId: string | null; realtimeIds: readonly string[]; sessionId: number; fittedSessionId: number | null }): boolean {
  return input.active && input.phase === 'ready' && input.focusedId !== null && input.realtimeIds.includes(input.focusedId) && input.fittedSessionId !== input.sessionId
}
