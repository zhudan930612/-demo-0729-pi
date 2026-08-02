import { buildTimelineModel } from './typhoonTimeline'
import type { TyphoonDetail, TyphoonId } from './typhoonTypes'

export interface TyphoonTimelineLabelViewModel {
  id: TyphoonId
  text: string
  title: string
  leftPercent: number
  widthPercent: number
  lane: number
  opened: boolean
  focused: boolean
  disabled: boolean
  disabledReason: string
  indicatorPercent: number | null
  indicatorLabel: string
}

export interface TyphoonTimelineViewModel {
  year: number
  months: number[]
  labels: TyphoonTimelineLabelViewModel[]
  laneCount: number
  empty: boolean
  loading: boolean
  limitMessage: string
}

export interface TyphoonTimelineSource {
  details: readonly TyphoonDetail[]
  nowMs: number
  realtimeCount: number
  openedHistoricalIds: readonly TyphoonId[]
  focusedTyphoonId: TyphoonId | null
  selectedNodeByTyphoon: Readonly<Record<TyphoonId, string | undefined>>
  historyPending: number
  viewportWidth?: number
}

function limitMessage(realtimeCount: number, openedCount: number): string {
  if (realtimeCount >= 6) return '实时台风数量已达展示上限'
  if (realtimeCount + openedCount >= 6) return '台风展示数量已达上限'
  return ''
}

export function buildTyphoonTimelineViewModel(source: TyphoonTimelineSource): TyphoonTimelineViewModel {
  // 起点和原始长度来自真实生命周期；短标签补足到 64px，保证中文名可读。
  const availableWidthPx = Math.max(320, (source.viewportWidth ?? 1440) - 94)
  const model = buildTimelineModel(source.details, source.nowMs, 64 / availableWidthPx, 8 / availableWidthPx)
  const months = model?.months ?? []
  const message = limitMessage(source.realtimeCount, source.openedHistoricalIds.length)
  const detailById = new Map(source.details.map((detail) => [detail.id, detail]))
  const rawLabels = model?.labels ?? []
  const labels = rawLabels.flatMap((label) => {
    const detail = detailById.get(label.typhoonId)
    if (!detail) return []
    const opened = source.openedHistoricalIds.includes(detail.id)
    const selectedId = source.selectedNodeByTyphoon[detail.id]
    const selected = selectedId ? detail.observationsAsc.find((node) => node.id === selectedId) : undefined
    const duration = Math.max(1, label.endMs - label.startMs)
    const indicatorPercent = opened && selected
      ? Math.max(0, Math.min(100, ((selected.epochMs - label.startMs) / duration) * 100))
      : null
    const disabledReason = opened ? '' : message
    return [{
      id: detail.id,
      text: detail.nameCn || '--',
      title: `${detail.nameCn || '--'}（${detail.nameEn || '--'}）`,
      leftPercent: label.visualStartX * 100,
      widthPercent: (label.visualEndX - label.visualStartX) * 100,
      lane: label.lane,
      opened,
      focused: source.focusedTyphoonId === detail.id,
      disabled: Boolean(disabledReason),
      disabledReason,
      indicatorPercent,
      indicatorLabel: selected ? `当前节点：${selected.timeYmdh}` : '',
    }]
  })
  return {
    year: model?.year ?? new Date(source.nowMs + 8 * 60 * 60 * 1000).getUTCFullYear(),
    months,
    labels,
    laneCount: model?.laneCount ?? 0,
    empty: labels.length === 0 && source.historyPending === 0,
    loading: source.historyPending > 0,
    limitMessage: message,
  }
}
