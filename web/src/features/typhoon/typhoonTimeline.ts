import { beijingDateParts, beijingMonthStartMs, beijingYearRange } from './typhoonTime'
import type { TyphoonDetail } from './typhoonTypes'

export interface TimelineLabel {
  typhoonId: string
  startMs: number
  endMs: number
  startX: number
  endX: number
  visualStartX: number
  visualEndX: number
  lane: number
  sourceIndex: number
}
export interface TimelineModel { year: number; months: number[]; labels: TimelineLabel[]; laneCount: number }

function monthCoordinate(epochMs: number, year: number, months: readonly number[], rangeEndMs: number): number {
  const parts = beijingDateParts(epochMs)
  const monthIndex = months.indexOf(parts.month)
  const monthStart = beijingMonthStartMs(year, parts.month)
  const nextMonth = parts.month === 12 ? beijingMonthStartMs(year + 1, 1) : beijingMonthStartMs(year, parts.month + 1)
  // 当前月份只映射到北京时间 now；未来日期不占据时间轴空间。
  const visibleMonthEnd = Math.min(nextMonth, rangeEndMs)
  return (monthIndex + (epochMs - monthStart) / (visibleMonthEnd - monthStart)) / months.length
}

export function buildTimelineModel(details: readonly TyphoonDetail[], nowMs: number, minWidthRatio = 0.02, laneGapRatio = 0.005): TimelineModel | null {
  const range = beijingYearRange(nowMs)
  if (!range) return null
  const histories = details.filter((detail) => detail.status === 'stop' && detail.observationsAsc.length > 0)
  const activeMonths = new Set<number>()
  for (const detail of histories) {
    for (const node of detail.observationsAsc) {
      if (node.epochMs >= range.startMs && node.epochMs <= range.endMs) activeMonths.add(beijingDateParts(node.epochMs).month)
    }
  }
  const months = [...activeMonths].sort((a, b) => a - b)
  if (!months.length) return { year: range.year, months, labels: [], laneCount: 0 }

  const pending = histories.flatMap((detail) => {
    const rawStart = detail.observationsAsc[0]!.epochMs
    const rawEnd = detail.observationsAsc[detail.observationsAsc.length - 1]!.epochMs
    const startMs = Math.max(rawStart, range.startMs)
    const endMs = Math.min(rawEnd, range.endMs)
    if (startMs > endMs) return []
    const startX = monthCoordinate(startMs, range.year, months, range.endMs)
    const endX = monthCoordinate(endMs, range.year, months, range.endMs)
    const visualStartX = Math.max(0, Math.min(startX, 1 - minWidthRatio))
    const visualEndX = Math.min(1, Math.max(endX, visualStartX + minWidthRatio))
    return [{ typhoonId: detail.id, startMs, endMs, startX, endX, visualStartX, visualEndX, lane: 0, sourceIndex: detail.sourceIndex }]
  }).sort((left, right) => left.visualStartX - right.visualStartX || left.visualEndX - right.visualEndX || left.sourceIndex - right.sourceIndex)

  const laneEnds: number[] = []
  for (const label of pending) {
    let lane = laneEnds.findIndex((end) => label.visualStartX >= end + laneGapRatio)
    if (lane < 0) lane = laneEnds.length
    laneEnds[lane] = label.visualEndX
    label.lane = lane
  }
  return { year: range.year, months, labels: pending, laneCount: laneEnds.length }
}
