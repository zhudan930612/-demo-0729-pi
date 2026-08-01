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
  trackWidthPx: number
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
}

function limitMessage(realtimeCount: number, openedCount: number): string {
  if (realtimeCount >= 6) return '实时台风数量已达展示上限'
  if (realtimeCount + openedCount >= 6) return '台风展示数量已达上限'
  return ''
}

export function buildTyphoonTimelineViewModel(source: TyphoonTimelineSource): TyphoonTimelineViewModel {
  // 第一次只确定月份和标签数量；最终 50px 可点宽度必须在 lane 分配前参与。
  const sizingModel = buildTimelineModel(source.details, source.nowMs, 0)
  const months = sizingModel?.months ?? []
  const trackWidthPx = Math.max(720, months.length * 180, (sizingModel?.labels.length ?? 0) * 100)
  const model = buildTimelineModel(source.details, source.nowMs, 50 / trackWidthPx)
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
    const number = detail.domesticNo || detail.id
    return [{
      id: detail.id,
      text: `${number} · ${detail.nameCn || '--'}`,
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
    trackWidthPx,
    empty: labels.length === 0 && source.historyPending === 0,
    loading: source.historyPending > 0,
    limitMessage: message,
  }
}
